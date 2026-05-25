"""
MQTT transport for terra-bridge.

Alternative (or complement) to direct ROS2 when USE_MQTT=true.

Connects to the faucon_mqtt_bridge Mosquitto broker (port 1883) and:
  - Subscribes to faucon/{robot_id}/telemetry/* → pushes to terra-api via HTTP
  - Publishes to faucon/{robot_id}/commands/* for robot control

This decouples terra-bridge from the ROS2 installation — the robot only needs
the faucon_mqtt_bridge package running alongside the Faucon stack.

MQTT topic schema (matches faucon_mqtt_bridge):
  Telemetry (robot → bridge):
    faucon/{id}/telemetry/robot/gps       {"lat", "lon", "altitude", "fix"}
    faucon/{id}/telemetry/robot/imu       {"roll", "pitch", "yaw"}   (degrees)
    faucon/{id}/telemetry/robot/odom      {"linear_x", "angular_z"}
    faucon/{id}/telemetry/robot/battery   {"percentage", "voltage"}
    faucon/{id}/telemetry/system/health   {"level", "faults"}
    faucon/{id}/telemetry/system/mode     {"mode"}
    faucon/{id}/telemetry/mission/status  {...}
    faucon/{id}/telemetry/brouette/gps    {"lat", "lon", ...}
    faucon/{id}/telemetry/drone/gps       {"lat", "lon", ...}
    faucon/{id}/telemetry/brouette/status {...}
    faucon/{id}/telemetry/drone/status    {...}

  Commands (bridge → robot):
    faucon/{id}/commands/estop                     {"data": bool}
    faucon/{id}/commands/cmd_vel                   {"linear": {"x": v}, "angular": {"z": v}}
    faucon/{id}/commands/mission/load              YAML string (UGV)
    faucon/{id}/commands/mission/command           string command
    faucon/{id}/commands/brouette/mission/load     JSON string
    faucon/{id}/commands/brouette/mission/command  string command
    faucon/{id}/commands/drone/mission/load        JSON string
    faucon/{id}/commands/drone/mission/command     string command
    faucon/{id}/commands/mode/request              {"type": "..."}
    faucon/{id}/commands/mode/set                  string mode
"""
from __future__ import annotations

import json
import logging
import math
import threading
import time
from datetime import datetime, timezone

import httpx
import yaml

try:
    import paho.mqtt.client as mqtt
    HAS_MQTT = True
except ImportError:
    HAS_MQTT = False

from config import API_URL, ROBOT_ID, MQTT_HOST, MQTT_PORT, MQTT_ROBOT_ID

log = logging.getLogger("terra_mqtt")

GPS_INTERVAL_S = 2.0
GPS_MIN_DIST_M = 0.3


def _ugv_payload_to_yaml(payload: dict) -> str:
    return yaml.dump(payload, allow_unicode=True, default_flow_style=False, sort_keys=False)


def _mode_request_type(type_str: str) -> str:
    request = type_str.strip().upper()
    return "REQUEST_AUTONOMOUS" if request == "REQUEST_AUTO" else request


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_m = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return radius_m * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class MqttTransport:
    """MQTT-based robot transport — mirrors the TerraRosNode public API.

    ROBOT_ID     — DB/API robot identifier (UUID), used in HTTP calls to terra-api.
    MQTT_ROBOT_ID — MQTT topic namespace faucon/{id}/..., must match faucon_mqtt_bridge's
                    robot_id (bridge_params.yaml). Defaults to ROBOT_ID if not set.
    """

    def __init__(self) -> None:
        if not HAS_MQTT:
            raise RuntimeError("paho-mqtt not installed — run: pip install paho-mqtt>=2.0")

        self._http      = httpx.Client(base_url=API_URL, timeout=2.0)
        self._lock      = threading.Lock()
        self._robot_id  = ROBOT_ID        # for API calls
        self._mqtt_id   = MQTT_ROBOT_ID   # for MQTT topic namespace
        self._report: dict | None = None
        self._fault_seen: set[str] = set()
        self._prev_mission_state = "IDLE"
        self._mission_state = "IDLE"
        self._mission_name = ""
        self._mission_agents: set[str] = set()
        self._mission_t0: float | None = None
        self._last_report_gps_t = 0.0
        self._last_report_gps: tuple[float, float] | None = None
        self._pending_ugv_start = False
        self._last_estop_halt_at = 0.0

        self._client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"terra_bridge_{MQTT_ROBOT_ID}",
        )
        self._client.on_connect    = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message    = self._on_message

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self) -> None:
        try:
            self._client.connect_async(MQTT_HOST, MQTT_PORT, 60)
            self._client.loop_start()
            log.info(f"MQTT transport connecting to {MQTT_HOST}:{MQTT_PORT} (mqtt_id={MQTT_ROBOT_ID} api_id={ROBOT_ID})")
        except Exception as exc:
            log.error(f"MQTT connect failed: {exc}")

    def stop(self) -> None:
        self._client.loop_stop()
        self._client.disconnect()

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _t(self, suffix: str) -> str:
        return f"faucon/{self._mqtt_id}/{suffix}"

    def _publish(self, suffix: str, payload: str | dict | bool, qos: int = 0) -> None:
        data = json.dumps(payload) if not isinstance(payload, str) else payload
        self._client.publish(self._t(suffix), data, qos=qos)

    def _push_api(self, sub: str, data: dict) -> None:
        url = f"/api/v1/robots/{ROBOT_ID}/telemetry{sub}"
        try:
            self._http.post(url, json=data)
        except Exception as exc:
            log.warning(f"API push {sub!r} failed: {exc}")

    def _push_agent(self, agent_id: str, data: dict) -> None:
        try:
            self._http.post(f"/api/v1/robots/{ROBOT_ID}/agents/{agent_id}/status", json=data)
        except Exception as exc:
            log.warning(f"API agent push {agent_id} failed: {exc}")

    def _post_report(self, report: dict) -> None:
        try:
            self._http.post(f"/api/v1/robots/{ROBOT_ID}/reports", json=report)
        except Exception as exc:
            log.warning(f"API report push failed: {exc}")

    def _elapsed(self) -> float:
        return round(time.monotonic() - self._mission_t0, 1) if self._mission_t0 else 0.0

    def _push_report_event(self, etype: str, msg: str) -> None:
        if self._report is not None:
            self._report["events"].append({"t": self._elapsed(), "type": etype, "msg": msg})

    def _capture_mission_name(self, yaml_content: str) -> None:
        name = ""
        try:
            data = yaml.safe_load(yaml_content) or {}
            if isinstance(data, dict):
                name = str(data.get("name", "")).strip()
        except Exception:
            pass

        if not name:
            for line in yaml_content.splitlines():
                if line.strip().startswith("name:"):
                    name = line.split(":", 1)[1].strip().strip('"\'')
                    break

        if name:
            with self._lock:
                self._mission_name = name

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
            self._mission_t0 = time.monotonic()
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
        now = time.monotonic()
        if now - self._last_report_gps_t < GPS_INTERVAL_S:
            return

        lat = gps.get("lat")
        lon = gps.get("lon")
        if lat is None or lon is None:
            return
        lat = float(lat)
        lon = float(lon)

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
                "t": self._elapsed(),
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
        self._report["duration_s"] = self._elapsed()
        self._report["distance_m"] = round(float(self._report["distance_m"]), 1)
        report = dict(self._report)
        self._report = None
        self._mission_t0 = None
        self._mission_agents = set()
        return report

    # ── MQTT callbacks ────────────────────────────────────────────────────────

    def _on_connect(self, client, userdata, flags, reason_code, properties) -> None:
        if reason_code != 0:
            log.warning(f"MQTT connect refused: {reason_code}")
            return
        log.info("MQTT broker connected — subscribing to telemetry topics")
        for suffix in [
            "telemetry/robot/gps",
            "telemetry/robot/imu",
            "telemetry/robot/odom",
            "telemetry/robot/battery",
            "telemetry/system/health",
            "telemetry/system/mode",
            "telemetry/mission/status",
            "telemetry/brouette/gps",
            "telemetry/drone/gps",
            "telemetry/brouette/status",
            "telemetry/drone/status",
        ]:
            client.subscribe(self._t(suffix), qos=0)

    def _on_disconnect(self, client, userdata, flags, reason_code, properties) -> None:
        log.warning(f"MQTT disconnected (rc={reason_code}) — auto-reconnect active")

    def _on_message(self, client, userdata, msg) -> None:
        try:
            payload = json.loads(msg.payload.decode())
        except Exception:
            return

        prefix = f"faucon/{self._mqtt_id}/telemetry/"
        suffix = msg.topic.removeprefix(prefix)

        try:
            if suffix == "robot/gps":
                # faucon_mqtt_bridge uses latitude/longitude; remap to lat/lon for API compat
                gps = {
                    "lat":      payload.get("latitude", payload.get("lat")),
                    "lon":      payload.get("longitude", payload.get("lon")),
                    "altitude": payload.get("altitude", 0.0),
                    "fix":      payload.get("fix", 0),
                }
                with self._lock:
                    self._track_report_gps(gps)
                self._push_api("", {"gps": gps})

            elif suffix == "robot/imu":
                # faucon_mqtt_bridge sends degrees — convert to radians for API compat
                imu = {
                    "roll":  math.radians(payload.get("roll",  0.0)),
                    "pitch": math.radians(payload.get("pitch", 0.0)),
                    "yaw":   math.radians(payload.get("yaw",   0.0)),
                }
                self._push_api("", {"imu": imu})

            elif suffix == "robot/odom":
                vel = {
                    "linear":  payload.get("linear_x",  0.0),
                    "angular": payload.get("angular_z", 0.0),
                }
                self._push_api("", {"velocity": vel})

            elif suffix == "robot/battery":
                pct = payload.get("percentage")
                if pct is not None:
                    pct = float(pct)
                    if pct > 1:
                        pct = pct / 100
                self._push_api("/status", {
                    "battery":   pct,
                    "voltage":   payload.get("voltage"),
                    "connected": True,
                })

            elif suffix == "system/health":
                with self._lock:
                    self._track_report_faults(payload)
                self._push_api("/health", payload)

            elif suffix == "system/mode":
                mode = str(payload.get("mode", "")).upper()
                self._push_api("/status", {"mode": mode, "connected": True})
                if mode in {"ESTOP", "EMERGENCY_STOP"}:
                    self._halt_for_estop_mode()

            elif suffix == "mission/status":
                report_to_post = None
                should_start = False
                with self._lock:
                    state = str(payload.get("state", "IDLE")).upper()
                    self._mission_state = state
                    if state == "READY" and self._pending_ugv_start:
                        self._pending_ugv_start = False
                        should_start = True
                    elif state in {"IDLE", "RUNNING", "PAUSED", "COMPLETED", "ABORTED", "ERROR"}:
                        self._pending_ugv_start = False
                    report_to_post = self._track_mission_report(payload)
                self._push_api("/mission", payload)
                if should_start:
                    self._publish("commands/mission/command", "START", qos=1)
                if report_to_post:
                    self._post_report(report_to_post)

            elif suffix in ("brouette/gps", "drone/gps"):
                agent_id = suffix.split("/")[0]
                gps = {
                    "lat":      payload.get("latitude", payload.get("lat")),
                    "lon":      payload.get("longitude", payload.get("lon")),
                    "altitude": payload.get("altitude", 0.0),
                    "fix":      payload.get("fix", 0),
                }
                self._push_api("", {"agentId": agent_id, "gps": gps})

            elif suffix in ("brouette/status", "drone/status"):
                agent_id = suffix.split("/")[0]
                self._push_agent(agent_id, payload)

        except Exception as exc:
            log.warning(f"MQTT message handling error on {msg.topic}: {exc}")

    # ── Public command API (same interface as TerraRosNode) ───────────────────

    def publish_teleop(self, linear: float, angular: float) -> None:
        self._publish("commands/cmd_vel", {
            "linear":  {"x": max(-0.3, min(0.5, float(linear)))},
            "angular": {"z": max(-0.8, min(0.8, float(angular)))},
        }, qos=0)

    def publish_estop(self, active: bool) -> None:
        self._publish("commands/estop", {"data": active}, qos=1)

    def _halt_for_estop_mode(self) -> None:
        now = time.monotonic()
        if now - self._last_estop_halt_at < 0.5:
            return
        self._last_estop_halt_at = now

    def publish_mode_request(self, type_str: str) -> None:
        self._publish("commands/mode/request", {"type": _mode_request_type(type_str)}, qos=1)

    def publish_set_mode(self, mode: str) -> None:
        self._publish("commands/mode/set", mode, qos=1)

    def publish_mission_command(self, agent_id: str, command: str) -> None:
        """Route mission command to correct MQTT topic(s)."""
        command = command.upper()
        if command == "ABORT":
            command = "CANCEL"
        suffix_map = {
            "ugv":      "commands/mission/command",
            "brouette": "commands/brouette/mission/command",
            "drone":    "commands/drone/mission/command",
        }
        supported = {
            "ugv": {"START", "PAUSE", "RESUME", "CANCEL", "STOP", "ACKNOWLEDGE"},
            "brouette": {"START", "RESUME", "CANCEL"},
            "drone": {"START", "CANCEL"},
        }
        targets = list(suffix_map.keys()) if agent_id == "all" else [agent_id]
        for target in targets:
            if command not in supported.get(target, set()):
                continue
            if s := suffix_map.get(target):
                if target == "ugv" and command == "START" and not self._is_ugv_ready_to_start():
                    with self._lock:
                        self._pending_ugv_start = True
                    log.warning("UGV START deferred until MQTT mission/status reaches READY")
                else:
                    if target == "ugv" and command in {"PAUSE", "CANCEL", "STOP", "ACKNOWLEDGE"}:
                        with self._lock:
                            self._pending_ugv_start = False
                    self._publish(s, command, qos=1)

    def publish_mission_load(self, agent_id: str, payload: dict) -> None:
        """Publish mission load to correct agent MQTT topic.

        UGV: YAML string (faucon nav_mission_manager expects YAML on /mission/load_path).
        Brouette / Drone: JSON string.
        """
        suffix_map = {
            "ugv":      "commands/mission/load",
            "brouette": "commands/brouette/mission/load",
            "drone":    "commands/drone/mission/load",
        }
        if suffix := suffix_map.get(agent_id):
            data = _ugv_payload_to_yaml(payload) if agent_id == "ugv" else json.dumps(payload)
            if agent_id == "ugv":
                self._capture_mission_name(data)
            with self._lock:
                self._mission_agents.add(agent_id)
            self._client.publish(self._t(suffix), data, qos=1)

    def publish_raw_load_path(self, yaml_content: str) -> None:
        self._capture_mission_name(yaml_content)
        self._client.publish(self._t("commands/mission/load"), yaml_content, qos=1)

    def _is_ugv_ready_to_start(self) -> bool:
        with self._lock:
            return self._mission_state == "READY"

    def publish_orchestration_command(self, command: str) -> None:
        self._publish("commands/orchestration/command", command, qos=1)

    def publish_orchestration_mission(self, profile: dict) -> None:
        self._publish("commands/orchestration/mission", profile, qos=1)
