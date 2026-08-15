"""
TerraOS ROS2 bridge node — terra-bridge.

Topics souscrits (13) :
  /terra/robot/gps                NavSatFix   → telemetry.gps          (200 ms)
  /terra/robot/imu                Imu         → telemetry.imu          (100 ms)
  /terra/robot/battery            BatteryState→ status.battery         (5 000 ms)
  /terra/robot/odom               Odometry    → telemetry.velocity     (100 ms)
  /terra/system/mode              String/JSON → status.mode            (event-driven)
  /terra/system/health            String/JSON → health                 (1 000 ms)
  /mission/status                  String/JSON → telemetry/mission      (event-driven)
  /terra/orchestration/status     String/JSON → orchestration/status   (event-driven)
  /terra/brouette/gps             NavSatFix   → telemetry agentId=brouette (200 ms)
  /terra/drone/gps                NavSatFix   → telemetry agentId=drone    (200 ms)
  /terra/brouette/mission/status  String/JSON → agents/brouette/status (event-driven)
  /terra/drone/mission/status     String/JSON → agents/drone/status    (event-driven)

Topics publiés (12) :
  /teleop/ihm/cmd_vel              Twist       ← joystick
  /terra/ihm/estop                Bool        ← e-stop
  /terra/orchestration/command    String      ← commandes orchestrateur
  /terra/orchestration/mission    String      ← profil mission JSON
  /mode_manager/requests           String      ← demandes de mode (MISSION_LOCK etc.)
  /mission/set_mode                String      ← forcer le mode (STANDBY etc.)
  /mission/command                 String      ← commande UGV (START/PAUSE/RESUME/CANCEL)
  /mission/load_path               String      ← chargement path UGV (YAML)
  /terra/brouette/mission/command String      ← commande Brouette
  /terra/brouette/mission/load    String      ← chargement mission Brouette (JSON)
  /terra/drone/mission/command    String      ← commande Drone
  /terra/drone/mission/load       String      ← chargement mission Drone (JSON)
"""
from __future__ import annotations

import json
import math
import threading
import time
from queue import Empty, Queue
from datetime import datetime, timezone
from typing import Callable

import httpx
import yaml

try:
    import rclpy
    from rclpy.node import Node
    from rclpy.qos import qos_profile_sensor_data, QoSProfile, ReliabilityPolicy, DurabilityPolicy
    from sensor_msgs.msg import NavSatFix, Imu, BatteryState
    from std_msgs.msg import String, Bool
    from geometry_msgs.msg import Twist
    from nav_msgs.msg import Odometry
    from faucon_msgs.msg import (
        MissionCommand, AgentStatus, OrchestratorStatus,
        SafetyLevel, SystemMode, ModeRequest,
        MissionProfile, MissionAgent, Waypoint as FauconWaypoint,
    )
    HAS_ROS = True
except ImportError:
    HAS_ROS = False
    Node = object  # type: ignore[misc, assignment]

from config import API_URL, ROBOT_ID

GPS_INTERVAL_S = 2.0
GPS_MIN_DIST_M = 0.3

# ── faucon_msgs lookup tables (populated after HAS_ROS import) ────────────────

def _build_faucon_maps() -> None:
    global _AGENT_STATE_NAMES, _ORCH_STATE_NAMES, _MODE_NAMES, _SAFETY_NAMES
    global _MODE_REQUEST_MAP, _MODE_NAME_TO_UINT, _CMD_MAP
    if not HAS_ROS:
        return
    _AGENT_STATE_NAMES = {
        AgentStatus.IDLE:      "IDLE",
        AgentStatus.LOADING:   "LOADING",
        AgentStatus.READY:     "READY",
        AgentStatus.RUNNING:   "RUNNING",
        AgentStatus.PAUSED:    "PAUSED",
        AgentStatus.COMPLETED: "COMPLETED",
        AgentStatus.ABORTED:   "ABORTED",
        AgentStatus.ERROR:     "ERROR",
    }
    _ORCH_STATE_NAMES = {
        OrchestratorStatus.IDLE:      "IDLE",
        OrchestratorStatus.PENDING:   "PENDING",
        OrchestratorStatus.RUNNING:   "RUNNING",
        OrchestratorStatus.PAUSED:    "PAUSED",
        OrchestratorStatus.COMPLETED: "COMPLETED",
        OrchestratorStatus.ABORTED:   "ABORTED",
        OrchestratorStatus.ERROR:     "ERROR",
    }
    _MODE_NAMES = {
        SystemMode.ESTOP:      "ESTOP",
        SystemMode.STANDBY:    "STANDBY",
        SystemMode.TELEOP:     "TELEOP",
        SystemMode.AUTONOMOUS: "AUTONOMOUS",
    }
    _SAFETY_NAMES = {
        SafetyLevel.OK:           "OK",
        SafetyLevel.NOTIFICATION: "NOTIFICATION",
        SafetyLevel.WARNING:      "WARNING",
        SafetyLevel.ERROR:        "ERROR",
    }
    _MODE_REQUEST_MAP = {
        "REQUEST_AUTONOMOUS": ModeRequest.REQUEST_AUTONOMOUS,
        "REQUEST_AUTO":       ModeRequest.REQUEST_AUTONOMOUS,
        "REQUEST_TELEOP":     ModeRequest.REQUEST_TELEOP,
        "MISSION_LOCK":       ModeRequest.MISSION_LOCK,
        "MISSION_UNLOCK":     ModeRequest.MISSION_UNLOCK,
        "MISSION_DONE":       ModeRequest.MISSION_DONE,
    }
    _MODE_NAME_TO_UINT = {
        "ESTOP":     SystemMode.ESTOP,
        "STANDBY":   SystemMode.STANDBY,
        "TELEOP":    SystemMode.TELEOP,
        "AUTONOMOUS": SystemMode.AUTONOMOUS,
    }
    _CMD_MAP = {
        "START":           MissionCommand.START,
        "PAUSE":           MissionCommand.PAUSE,
        "RESUME":          MissionCommand.RESUME,
        "CANCEL":          MissionCommand.CANCEL,
        "CANCEL_BROUETTE": MissionCommand.CANCEL_BROUETTE,
        "CANCEL_DRONE":    MissionCommand.CANCEL_DRONE,
    }

_AGENT_STATE_NAMES: dict = {}
_ORCH_STATE_NAMES:  dict = {}
_MODE_NAMES:        dict = {}
_SAFETY_NAMES:      dict = {}
_MODE_REQUEST_MAP:  dict = {}
_MODE_NAME_TO_UINT: dict = {}
_CMD_MAP:           dict = {}
_build_faucon_maps()


# ── Quaternion → Euler ────────────────────────────────────────────────────────

def _quat_to_euler(qx: float, qy: float, qz: float, qw: float) -> tuple[float, float, float]:
    roll  = math.atan2(2 * (qw * qx + qy * qz), 1 - 2 * (qx * qx + qy * qy))
    sinp  = 2 * (qw * qy - qz * qx)
    pitch = math.asin(max(-1.0, min(1.0, sinp)))
    yaw   = math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz))
    return roll, pitch, yaw


def _parse_gps(msg: "NavSatFix") -> dict | None:
    if msg.status.status < 0:
        return None
    return {
        "lat":      msg.latitude,
        "lon":      msg.longitude,
        "altitude": msg.altitude,
        "fix":      int(msg.status.status),
    }


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_m = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return radius_m * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ugv_payload_to_yaml(payload: dict) -> str:
    """Convert UGV mission payload dict to YAML string for /mission/load_path.

    Faucon nav_mission_manager expects:
      name: <str>
      nav_mode: follow_path | goto_waypoint
      waypoints:
        - latitude: <float>
          longitude: <float>
    """
    return yaml.dump(payload, allow_unicode=True, default_flow_style=False, sort_keys=False)


def _mode_request_type(type_str: str) -> str:
    request = type_str.strip().upper()
    return "REQUEST_AUTONOMOUS" if request == "REQUEST_AUTO" else request


def _extract_mode(raw: str) -> str:
    data = raw.strip()
    try:
        parsed = json.loads(data)
        if isinstance(parsed, dict):
            data = str(parsed.get("mode", data))
    except Exception:
        pass
    return data.strip().upper()


# ── Node ─────────────────────────────────────────────────────────────────────

class TerraRosNode(Node if HAS_ROS else object):  # type: ignore[misc]

    def __init__(self) -> None:
        if HAS_ROS:
            super().__init__("terra_bridge")

        # ── State cache ────────────────────────────────────────────────
        self._lock              = threading.Lock()
        self._gps               : dict | None  = None
        self._imu               : dict | None  = None
        self._mode              : str          = "STANDBY"
        self._battery           : float | None = None
        self._safety            : str          = "OK"
        self._health            : dict | None  = None
        self._brouette_gps      : dict | None  = None
        self._drone_gps         : dict | None  = None
        self._velocity_linear   : float        = 0.0
        self._velocity_angular  : float        = 0.0
        self._last_ros_rx       : float        = 0.0

        # Mission report state, mirroring FauconBridgeNode's report contract.
        self._report            : dict | None  = None
        self._fault_seen        : set[str]     = set()
        self._prev_mission_state: str          = "IDLE"
        self._mission_state     : str          = "IDLE"
        self._mission_name      : str          = ""
        self._mission_agents    : set[str]     = set()
        self._mission_t0        : float | None = None
        self._last_report_gps_t : float        = 0.0
        self._last_report_gps   : tuple[float, float] | None = None
        self._pending_ugv_start : bool         = False
        self._last_estop_halt_at: float        = 0.0
        self._ros_commands      : Queue[Callable[[], None]] = Queue()
        self._ros_thread_id     : int | None   = None
        self._command_counts    : dict[str, int] = {}
        self._last_command      : dict | None = None

        # ── Push timestamps (monotonic seconds) ────────────────────────
        _now = time.monotonic()
        self._t_gps         : float = _now  # 200 ms
        self._t_imu         : float = _now  # 100 ms
        self._t_battery     : float = _now  # 5 000 ms — delay first push to let ROS settle
        self._t_health      : float = _now  # 1 000 ms
        self._t_brouette    : float = _now  # 200 ms
        self._t_drone       : float = _now  # 200 ms

        # ── HTTP client (synchronous, runs in ROS spin thread) ─────────
        self._http = httpx.Client(base_url=API_URL, timeout=2.0)

        if not HAS_ROS:
            return  # mock mode

        # ── Subscriptions ──────────────────────────────────────────────

        # UGV telemetry
        self.create_subscription(NavSatFix,    "/terra/robot/gps",     self._on_gps,      qos_profile_sensor_data)
        self.create_subscription(Imu,          "/terra/robot/imu",     self._on_imu,      qos_profile_sensor_data)
        self.create_subscription(BatteryState, "/terra/robot/battery", self._on_battery,  qos_profile_sensor_data)
        self.create_subscription(Odometry,     "/terra/robot/odom",    self._on_odom,     qos_profile_sensor_data)

        # System
        self.create_subscription(SystemMode,  "/terra/system/mode",   self._on_mode,   10)
        self.create_subscription(SafetyLevel, "/terra/system/health", self._on_health, 10)

        # Mission UGV — only /mission/status exists in the Faucon stack
        self.create_subscription(String, "/mission/status", self._on_mission_status, 10)
        self.create_subscription(String, "/mission/load_path", self._on_load_path, 10)

        # Multi-agent GPS
        self.create_subscription(NavSatFix, "/terra/brouette/gps", self._on_brouette_gps, qos_profile_sensor_data)
        self.create_subscription(NavSatFix, "/terra/drone/gps",    self._on_drone_gps,    qos_profile_sensor_data)

        # Agent mission status
        self.create_subscription(AgentStatus, "/terra/brouette/mission/status", self._on_brouette_mission_status, 10)
        self.create_subscription(AgentStatus, "/terra/drone/mission/status",    self._on_drone_mission_status,    10)

        # Orchestration
        self.create_subscription(OrchestratorStatus, "/terra/orchestration/status", self._on_orch_status, 10)

        # ── Publishers ─────────────────────────────────────────────────

        # QoS matching mode_manager_node.py _RELIABLE subscriptions so estop/commands
        # are not silently dropped due to BEST_EFFORT vs RELIABLE mismatch.
        _reliable = QoSProfile(
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.VOLATILE,
            depth=10,
        )

        # Teleop / safety
        self._cmd_vel_pub        = self.create_publisher(Twist, "/teleop/ihm/cmd_vel",    10)
        self._estop_pub          = self.create_publisher(Bool,  "/terra/ihm/estop",      _reliable)
        # Hardware gate in ugv_adapter — triggers immediate zero-vel on /cmd_vel
        self._robot_estop_pub    = self.create_publisher(Bool,  "/terra/robot/estop",    _reliable)

        # Orchestration
        self._orch_cmd_pub     = self.create_publisher(MissionCommand,  "/terra/orchestration/command", 10)
        self._orch_mission_pub = self.create_publisher(MissionProfile, "/terra/orchestration/mission", 10)

        # Mode manager — RELIABLE so requests are not dropped
        self._mode_request_pub = self.create_publisher(ModeRequest, "/mode_manager/requests", _reliable)
        self._set_mode_pub     = self.create_publisher(SystemMode,  "/mission/set_mode",      _reliable)

        # UGV mission — RELIABLE so CANCEL reaches mission_manager → task_executor
        self._mission_cmd_pub  = self.create_publisher(String, "/mission/command",   _reliable)
        self._mission_load_pub = self.create_publisher(String, "/mission/load_path", 10)

        # Brouette mission
        self._brouette_cmd_pub  = self.create_publisher(MissionCommand, "/terra/brouette/mission/command", 10)
        self._brouette_load_pub = self.create_publisher(String,         "/terra/brouette/mission/load",    10)

        # Drone mission
        self._drone_cmd_pub  = self.create_publisher(MissionCommand, "/terra/drone/mission/command", 10)
        self._drone_load_pub = self.create_publisher(String,         "/terra/drone/mission/load",    10)

        # ── Timers ─────────────────────────────────────────────────────
        self.create_timer(0.05, self._tick)   # 20 Hz master tick

    # ── ROS callbacks ─────────────────────────────────────────────────────────

    def _on_gps(self, msg: "NavSatFix") -> None:
        gps = _parse_gps(msg)
        if gps:
            with self._lock:
                self._last_ros_rx = time.monotonic()
                self._gps = gps
                self._track_report_gps(gps)

    def _on_imu(self, msg: "Imu") -> None:
        q = msg.orientation
        roll, pitch, yaw = _quat_to_euler(q.x, q.y, q.z, q.w)
        with self._lock:
            self._last_ros_rx = time.monotonic()
            self._imu = {"roll": round(roll, 5), "pitch": round(pitch, 5), "yaw": round(yaw, 5)}

    def _on_battery(self, msg: "BatteryState") -> None:
        pct = float(msg.percentage)
        if pct > 1.0:
            pct /= 100.0
        voltage = round(float(msg.voltage), 2)
        with self._lock:
            self._last_ros_rx = time.monotonic()
            self._battery = round(max(0.0, min(1.0, pct)), 3)
            self._voltage = voltage

    def _on_odom(self, msg: "Odometry") -> None:
        with self._lock:
            self._last_ros_rx = time.monotonic()
            self._velocity_linear  = round(msg.twist.twist.linear.x,  3)
            self._velocity_angular = round(msg.twist.twist.angular.z, 3)

    def _on_mode(self, msg: "SystemMode") -> None:
        mode = _MODE_NAMES.get(msg.mode, "STANDBY")
        with self._lock:
            self._last_ros_rx = time.monotonic()
            self._mode = mode
        self._push("/status", self._build_status())
        if mode in {"ESTOP", "EMERGENCY_STOP"}:
            self._halt_for_estop_mode()

    def _on_health(self, msg: "SafetyLevel") -> None:
        level_name = _SAFETY_NAMES.get(msg.level, "OK")
        faults = [] if level_name == "OK" else [{
            "severity": level_name,
            "source":   msg.source,
            "msg":      msg.message,
        }]
        health_dict = {"level": level_name, "faults": faults}
        with self._lock:
            self._last_ros_rx = time.monotonic()
            self._safety = level_name
            self._health = health_dict
            self._track_report_faults(health_dict)

    def _on_load_path(self, msg: "String") -> None:
        name = ""
        try:
            data = yaml.safe_load(msg.data) or {}
            if isinstance(data, dict):
                name = str(data.get("name", "")).strip()
        except Exception:
            pass

        if not name:
            for line in msg.data.splitlines():
                if line.strip().startswith("name:"):
                    name = line.split(":", 1)[1].strip().strip('"\'')
                    break

        if name:
            with self._lock:
                self._mission_name = name

    def _on_mission_status(self, msg: "String") -> None:
        try:
            data = json.loads(msg.data)
            report_to_post = None
            should_start = False
            with self._lock:
                state = str(data.get("state", "IDLE")).upper()
                self._mission_state = state
                if state == "READY" and self._pending_ugv_start:
                    self._pending_ugv_start = False
                    should_start = True
                elif state in {"IDLE", "RUNNING", "PAUSED", "COMPLETED", "ABORTED", "ERROR"}:
                    self._pending_ugv_start = False
                report_to_post = self._track_mission_report(data)
            self._push("/mission", data)
            if should_start:
                self._publish_ugv_command("START")
            if report_to_post:
                self._post_report(report_to_post)
        except Exception as exc:
            self._warn(f"mission/status parse error: {exc}")

    def _on_brouette_gps(self, msg: "NavSatFix") -> None:
        gps = _parse_gps(msg)
        if gps:
            with self._lock:
                self._last_ros_rx = time.monotonic()
                self._brouette_gps = gps

    def _on_drone_gps(self, msg: "NavSatFix") -> None:
        gps = _parse_gps(msg)
        if gps:
            with self._lock:
                self._last_ros_rx = time.monotonic()
                self._drone_gps = gps

    def _on_brouette_mission_status(self, msg: "AgentStatus") -> None:
        data = {
            "state":           _AGENT_STATE_NAMES.get(msg.state, "IDLE"),
            "agent_id":        msg.agent_id,
            "mission_id":      msg.mission_id,
            "current_wp":      msg.current_wp,
            "total_wp":        msg.total_wp,
            "distance_to_wp_m": round(float(msg.distance_to_wp_m), 2),
        }
        self._push_agent_status("brouette", data)

    def _on_drone_mission_status(self, msg: "AgentStatus") -> None:
        data = {
            "state":           _AGENT_STATE_NAMES.get(msg.state, "IDLE"),
            "agent_id":        msg.agent_id,
            "mission_id":      msg.mission_id,
            "current_wp":      msg.current_wp,
            "total_wp":        msg.total_wp,
            "distance_to_wp_m": round(float(msg.distance_to_wp_m), 2),
        }
        self._push_agent_status("drone", data)

    def _on_orch_status(self, msg: "OrchestratorStatus") -> None:
        try:
            data = {
                "state":            _ORCH_STATE_NAMES.get(msg.state, "IDLE"),
                "current_wp":       msg.current_wp,
                "total_wp":         msg.total_wp,
                "ugv_paused":       msg.ugv_paused,
                "brouette_active":  msg.brouette_active,
                "drone_active":     msg.drone_active,
            }
            self._http.post("/api/v1/orchestration/status", json=data)
        except Exception as exc:
            self._warn(f"orch status error: {exc}")

    # ── Master tick (20 Hz) ───────────────────────────────────────────────────

    def _tick(self) -> None:
        self._ros_thread_id = threading.get_ident()
        self._drain_ros_commands()

        now = time.monotonic()
        with self._lock:
            gps              = self._gps
            imu              = self._imu
            health           = self._health
            brouette         = self._brouette_gps
            drone            = self._drone_gps
            vel_linear       = self._velocity_linear
            vel_angular      = self._velocity_angular

        # IMU — 100 ms
        if now - self._t_imu >= 0.1 and imu is not None:
            self._t_imu = now
            self._push("", {
                "gps":      gps or {},
                "imu":      imu,
                "velocity": {"linear": vel_linear, "angular": vel_angular},
            })

        # GPS (UGV) — 200 ms
        if now - self._t_gps >= 0.2 and gps is not None:
            self._t_gps = now
            self._push("", {
                "gps":      gps,
                "imu":      imu or {"roll": 0.0, "pitch": 0.0, "yaw": 0.0},
                "velocity": {"linear": vel_linear, "angular": vel_angular},
            })

        # Battery + status — 5 000 ms
        if now - self._t_battery >= 5.0:
            self._t_battery = now
            self._push("/status", self._build_status())

        # Health — 1 000 ms
        if now - self._t_health >= 1.0 and health is not None:
            self._t_health = now
            self._push("/health", health)

        # Brouette GPS — 200 ms
        if now - self._t_brouette >= 0.2 and brouette is not None:
            self._t_brouette = now
            self._push("", {
                "agentId":  "brouette",
                "gps":      brouette,
                "imu":      {"roll": 0.0, "pitch": 0.0, "yaw": 0.0},
                "velocity": {"linear": 0.0, "angular": 0.0},
            })

        # Drone GPS — 200 ms
        if now - self._t_drone >= 0.2 and drone is not None:
            self._t_drone = now
            self._push("", {
                "agentId":  "drone",
                "gps":      drone,
                "imu":      {"roll": 0.0, "pitch": 0.0, "yaw": 0.0},
                "velocity": {"linear": 0.0, "angular": 0.0},
            })

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _ros_now(self) -> float:
        if HAS_ROS:
            return self.get_clock().now().nanoseconds / 1e9
        return time.monotonic()

    def _report_elapsed(self) -> float:
        return round(self._ros_now() - self._mission_t0, 1) if self._mission_t0 else 0.0

    def _push_report_event(self, etype: str, msg: str) -> None:
        if self._report is not None:
            self._report["events"].append({"t": self._report_elapsed(), "type": etype, "msg": msg})

    def _track_mission_report(self, data: dict) -> dict | None:
        state = str(data.get("state", "IDLE"))
        mission_id = str(data.get("mission_id", data.get("missionId", "unknown")))
        nav_mode = str(data.get("nav_mode", data.get("navMode", "FOLLOW_WAYPOINTS")))
        total_wp = int(data.get("total_wp", data.get("totalWp", 0)) or 0)
        current_wp = int(data.get("current_wp", data.get("currentWp", 0)) or 0)
        error = str(data.get("error", "") or "")
        previous = self._prev_mission_state

        report_to_post = None
        if state != previous:
            report_to_post = self._on_mission_transition(state, previous, mission_id, nav_mode, total_wp, current_wp, error)
            self._prev_mission_state = state
        elif self._report is not None:
            self._report["completed_wp"] = current_wp
            self._report["total_wp"] = total_wp
        return report_to_post

    def _on_mission_transition(
        self,
        state: str,
        previous: str,
        mission_id: str,
        nav_mode: str,
        total_wp: int,
        current_wp: int,
        error: str,
    ) -> dict | None:
        if state == "RUNNING" and previous not in ("RUNNING", "PAUSED"):
            self._mission_t0 = self._ros_now()
            self._report = {
                "report_id": f"{mission_id}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}",
                "mission_id": mission_id,
                "name": self._mission_name or mission_id,
                "nav_mode": nav_mode,
                "started_at": _now_iso(),
                "ended_at": None,
                "duration_s": None,
                "status": "RUNNING",
                "total_wp": total_wp,
                "completed_wp": current_wp,
                "distance_m": 0.0,
                "agents": sorted(self._mission_agents) if self._mission_agents else ["ugv"],
                "path_name": self._mission_name or None,
                "gps_trace": [],
                "events": [],
                "fault_history": [],
            }
            self._fault_seen = set()
            self._last_report_gps = None
            self._last_report_gps_t = 0.0
            self._push_report_event("mission", f"Mission demarree - {nav_mode}")

        elif state == "PAUSED" and self._report:
            self._report["status"] = "PAUSED"
            self._push_report_event("warn", "Mission en pause")

        elif state == "RUNNING" and previous == "PAUSED" and self._report:
            self._report["status"] = "RUNNING"
            self._push_report_event("mission", "Mission reprise")

        elif state in ("COMPLETED", "ABORTED", "ERROR") and self._report:
            labels = {
                "COMPLETED": ("ok", "Mission completee"),
                "ABORTED": ("warn", "Mission annulee"),
                "ERROR": ("alarm", f"Erreur mission{': ' + error if error else ''}"),
            }
            etype, emsg = labels[state]
            self._report["status"] = state
            self._report["completed_wp"] = total_wp if state == "COMPLETED" else current_wp
            self._push_report_event(etype, emsg)
            return self._flush_report()
        return None

    def _track_report_gps(self, gps: dict) -> None:
        if self._report is None or self._mission_t0 is None:
            return
        now = self._ros_now()
        if now - self._last_report_gps_t < GPS_INTERVAL_S:
            return

        lat = float(gps["lat"])
        lon = float(gps["lon"])
        if self._last_report_gps:
            distance = _haversine(self._last_report_gps[0], self._last_report_gps[1], lat, lon)
            if distance < GPS_MIN_DIST_M:
                return
            self._report["distance_m"] += distance

        self._report["gps_trace"].append({
            "lat": round(lat, 8),
            "lon": round(lon, 8),
            "t": round(now - self._mission_t0, 1),
        })
        self._last_report_gps = (lat, lon)
        self._last_report_gps_t = now

    def _track_report_faults(self, health: dict) -> None:
        if self._report is None:
            return
        for fault in health.get("faults", []):
            key = f"{fault.get('severity')}:{fault.get('source')}"
            if key in self._fault_seen:
                continue
            self._fault_seen.add(key)
            fmsg = fault.get("msg") or fault.get("message", "")
            self._report["fault_history"].append({
                "t": self._report_elapsed(),
                "severity": fault.get("severity"),
                "source": fault.get("source"),
                "msg": fmsg,
            })
            etype = "alarm" if fault.get("severity") == "ERROR" else "warn"
            self._push_report_event(etype, f"{fault.get('source')} - {fmsg}")

    def _flush_report(self) -> dict | None:
        if self._report is None:
            return None
        self._report["ended_at"] = _now_iso()
        self._report["duration_s"] = self._report_elapsed()
        self._report["distance_m"] = round(float(self._report["distance_m"]), 1)
        report = dict(self._report)
        self._report = None
        self._mission_t0 = None
        self._mission_agents = set()
        return report

    def _post_report(self, report: dict) -> None:
        try:
            self._http.post(f"/api/v1/robots/{ROBOT_ID}/reports", json=report)
        except Exception as exc:
            self._warn(f"post report failed: {exc}")

    def _build_status(self) -> dict:
        with self._lock:
            age = time.monotonic() - self._last_ros_rx if self._last_ros_rx > 0 else None
            connected = age is not None and age < 10.0
            return {
                "mode":         self._mode,
                "safety_level": self._safety,
                "battery":      self._battery,
                "connected":    connected,
            }

    def ros_diagnostic(self) -> dict:
        with self._lock:
            age = time.monotonic() - self._last_ros_rx if self._last_ros_rx > 0 else None
        return {
            "has_ros":      HAS_ROS,
            "last_rx_age":  round(age, 2) if age is not None else None,
            "receiving":    age is not None and age < 10.0,
        }

    def _push(self, sub: str, data: dict) -> None:
        url = f"/api/v1/robots/{ROBOT_ID}/telemetry{sub}"
        try:
            self._http.post(url, json=data)
        except Exception as exc:
            self._warn(f"push {sub!r} failed: {exc}")

    def _push_agent_status(self, agent_id: str, data: dict) -> None:
        url = f"/api/v1/robots/{ROBOT_ID}/agents/{agent_id}/status"
        try:
            self._http.post(url, json=data)
        except Exception as exc:
            self._warn(f"push agent status {agent_id} failed: {exc}")

    def _warn(self, msg: str) -> None:
        if HAS_ROS:
            self.get_logger().warn(msg)
        else:
            import logging
            logging.getLogger("terra_bridge").warning(msg)

    def _halt_for_estop_mode(self) -> None:
        """E-Stop is handled by the Faucon safety stack."""
        now = time.monotonic()
        if now - self._last_estop_halt_at < 0.5:
            return
        self._last_estop_halt_at = now

    # ── Public API — appelé par les routers FastAPI ───────────────────────────

    def publish_teleop(self, linear: float, angular: float) -> None:
        if not HAS_ROS:
            return
        self._enqueue_ros_command(lambda: self._publish_teleop_now(linear, angular))

    def _publish_teleop_now(self, linear: float, angular: float) -> None:
        msg = Twist()
        msg.linear.x  = max(-0.3, min(0.5, float(linear)))
        msg.angular.z = max(-0.8, min(0.8, float(angular)))
        self._cmd_vel_pub.publish(msg)
        self._record_command("teleop", {"linear": msg.linear.x, "angular": msg.angular.z})

    def publish_estop(self, active: bool) -> None:
        if not HAS_ROS:
            return
        self._enqueue_ros_command(lambda: self._publish_estop_now(active))

    def _publish_estop_now(self, active: bool) -> None:
        msg = Bool()
        msg.data = active
        # IHM path: mode_manager software arbitration (blocks nav2/cmd_vel)
        self._estop_pub.publish(msg)
        # Hardware path: ugv_adapter gate (immediate zero-vel to /cmd_vel, bypasses nav2 chain)
        self._robot_estop_pub.publish(msg)
        self._record_command("estop", {"active": active})

    def publish_mode_request(self, type_str: str) -> None:
        if not HAS_ROS:
            return
        self._enqueue_ros_command(lambda: self._publish_mode_request_now(type_str))

    def _publish_mode_request_now(self, type_str: str) -> None:
        req_type = _mode_request_type(type_str)
        msg = ModeRequest()
        msg.type = _MODE_REQUEST_MAP.get(req_type, ModeRequest.MISSION_LOCK)
        self._mode_request_pub.publish(msg)
        self._record_command("mode_request", {"type": req_type})

    def publish_set_mode(self, mode: str) -> None:
        if not HAS_ROS:
            return
        self._enqueue_ros_command(lambda: self._publish_set_mode_now(mode))

    def _publish_set_mode_now(self, mode: str) -> None:
        msg = SystemMode()
        msg.mode = _MODE_NAME_TO_UINT.get(mode.upper(), SystemMode.STANDBY)
        self._set_mode_pub.publish(msg)
        self._record_command("set_mode", {"mode": mode})

    def publish_mission_command(self, agent_id: str, command: str) -> None:
        """Route mission command to the correct agent topic(s).

        Faucon accepts UGV START/PAUSE/RESUME/CANCEL, Brouette
        START/RESUME/CANCEL, and Drone START/CANCEL.
        """
        if not HAS_ROS:
            return
        self._enqueue_ros_command(lambda: self._publish_mission_command_now(agent_id, command))

    def _publish_mission_command_now(self, agent_id: str, command: str) -> None:
        command = command.upper()
        if command == "ABORT":
            command = "CANCEL"

        if agent_id in ("ugv", "all") and command in {"START", "PAUSE", "RESUME", "CANCEL", "STOP", "ACKNOWLEDGE"}:
            if command == "START" and not self._is_ugv_ready_to_start():
                with self._lock:
                    self._pending_ugv_start = True
                self._warn("UGV START deferred until /mission/status reaches READY")
            else:
                if command in {"PAUSE", "CANCEL", "STOP", "ACKNOWLEDGE"}:
                    with self._lock:
                        self._pending_ugv_start = False
                self._publish_ugv_command(command)
        if agent_id in ("brouette", "all") and command in {"START", "PAUSE", "RESUME", "CANCEL"}:
            msg = MissionCommand()
            msg.cmd = _CMD_MAP.get(command, MissionCommand.CANCEL)
            self._brouette_cmd_pub.publish(msg)
        if agent_id in ("drone", "all") and command in {"START", "PAUSE", "RESUME", "CANCEL"}:
            msg = MissionCommand()
            msg.cmd = _CMD_MAP.get(command, MissionCommand.CANCEL)
            self._drone_cmd_pub.publish(msg)
        self._record_command("mission_command", {"agent_id": agent_id, "command": command})

    def publish_mission_load(self, agent_id: str, payload: dict) -> None:
        """Publish mission load to the correct agent topic.

        UGV (/mission/load_path): YAML string — Faucon nav_mission_manager expects YAML.
        Brouette / Drone: JSON string.
        """
        if not HAS_ROS:
            return
        self._enqueue_ros_command(lambda: self._publish_mission_load_now(agent_id, payload))

    def _publish_mission_load_now(self, agent_id: str, payload: dict) -> None:
        msg = String()
        if agent_id == "ugv":
            msg.data = _ugv_payload_to_yaml(payload)
            self._mission_load_pub.publish(msg)
        elif agent_id == "brouette":
            msg.data = json.dumps(payload)
            self._brouette_load_pub.publish(msg)
        elif agent_id == "drone":
            msg.data = json.dumps(payload)
            self._drone_load_pub.publish(msg)
        with self._lock:
            self._mission_agents.add(agent_id)
        self._record_command("mission_load", {"agent_id": agent_id})

    def publish_raw_load_path(self, yaml_content: str) -> None:
        if not HAS_ROS:
            return
        self._enqueue_ros_command(lambda: self._publish_raw_load_path_now(yaml_content))

    def _publish_raw_load_path_now(self, yaml_content: str) -> None:
        msg = String()
        msg.data = yaml_content
        self._mission_load_pub.publish(msg)
        self._record_command("load_path", {"bytes": len(yaml_content)})

    def _is_ugv_ready_to_start(self) -> bool:
        with self._lock:
            return self._mission_state == "READY"

    def _publish_ugv_command(self, command: str) -> None:
        msg = String()
        msg.data = command
        self._mission_cmd_pub.publish(msg)

    def publish_orchestration_command(self, command: str) -> None:
        if not HAS_ROS:
            return
        self._enqueue_ros_command(lambda: self._publish_orchestration_command_now(command))

    def _publish_orchestration_command_now(self, command: str) -> None:
        cmd_upper = command.upper()
        msg = MissionCommand()
        msg.cmd = _CMD_MAP.get(cmd_upper, MissionCommand.CANCEL)
        self._orch_cmd_pub.publish(msg)
        self._record_command("orchestration_command", {"command": command})

    def publish_orchestration_mission(self, profile: dict) -> None:
        if not HAS_ROS:
            return
        self._enqueue_ros_command(lambda: self._publish_orchestration_mission_now(profile))

    def _publish_orchestration_mission_now(self, profile: dict) -> None:
        msg = MissionProfile()
        msg.mission_id = str(profile.get("mission_id", ""))
        for agent_dict in profile.get("agents", []):
            agent = MissionAgent()
            agent.id   = str(agent_dict.get("id", ""))
            agent.task = str(agent_dict.get("task", ""))
            for wp_dict in agent_dict.get("waypoints", []):
                wp = FauconWaypoint()
                wp.latitude  = float(wp_dict.get("latitude",  0.0))
                wp.longitude = float(wp_dict.get("longitude", 0.0))
                wp.altitude  = float(wp_dict.get("altitude",  0.0))
                agent.waypoints.append(wp)
            msg.agents.append(agent)
        self._orch_mission_pub.publish(msg)
        self._record_command("orchestration_mission", {"mission_id": profile.get("mission_id")})

    def command_snapshot(self) -> dict:
        with self._lock:
            return {
                "counts": dict(self._command_counts),
                "last": dict(self._last_command) if self._last_command else None,
            }

    def _record_command(self, name: str, data: dict) -> None:
        with self._lock:
            self._command_counts[name] = self._command_counts.get(name, 0) + 1
            self._last_command = {"name": name, "data": data, "at": _now_iso()}

    def _enqueue_ros_command(self, command: Callable[[], None]) -> None:
        if threading.get_ident() == self._ros_thread_id:
            command()
            return

        done = threading.Event()
        errors: list[Exception] = []

        def wrapped() -> None:
            try:
                command()
            except Exception as exc:
                errors.append(exc)
            finally:
                done.set()

        self._ros_commands.put(wrapped)
        if not done.wait(timeout=2.0):
            raise RuntimeError("ROS command timed out")
        if errors:
            raise errors[0]

    def _drain_ros_commands(self) -> None:
        for _ in range(100):
            try:
                command = self._ros_commands.get_nowait()
            except Empty:
                return
            try:
                command()
            except Exception as exc:
                self._warn(f"ROS command failed: {exc}")
