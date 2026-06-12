"""
BaseSim — common simulator core shared by ugv / cart / drone.

Holds the kinematic + telemetry state, runs the fixed-rate loop, pushes the
exact same payloads to terra-api as a real bridge, and exposes the command
surface (teleop, e-stop, mission, mode). Concrete behaviours (pure pursuit,
boustrophedon, type-specific quantities) live in subclasses.
"""
import logging
import math
import os
import random
import threading
import time
from datetime import datetime, timezone
from typing import Optional

import httpx

from . import geo

log = logging.getLogger("sim_bridge")

DT = 0.2  # seconds per telemetry tick (5 Hz)

# GPS noise: σ ≈ 0.0001 m — quasi-perfect signal for clean demo traces
GPS_NOISE_M = 0.0001

# Periodic auto health-fault (legacy single-UGV demo). Disabled for the
# scripted multi-robot scenario, which drives faults via the player.
AUTO_HEALTH = os.environ.get("SIM_AUTO_HEALTH", "true").lower() == "true"


class BaseSim:
    """Shared simulator state + loop. Subclasses implement `advance()`."""

    robot_type = "base"

    def __init__(self, robot_id: str, home_lat: float, home_lon: float):
        self.robot_id = robot_id
        self.lock = threading.RLock()

        # Home / base (return point, reset origin)
        self.home_lat = home_lat
        self.home_lon = home_lon

        # Position
        self.lat = home_lat
        self.lon = home_lon
        self.altitude = 0.0

        # Kinematics
        self.linear_x = 0.0    # m/s
        self.angular_z = 0.0   # rad/s
        self.yaw_rad = 0.0     # heading, rad

        # IMU (smooth, physics-based)
        self.roll_deg = 0.0
        self.pitch_deg = 0.0

        # Robot state
        self.mode = "STANDBY"
        self.battery = 100.0
        self.connected = True

        # Mission state
        self.mission_running = False
        self.mission_paused = False
        self.current_wp = 0
        self.total_wp = 0
        self.mission_state = "IDLE"
        self.mission_id: Optional[str] = None

        # Health
        self.health_level = "OK"
        self.faults: list = []
        self._fault_timer = time.time()

        # E-Stop
        self.estop = False

        # Failure-injection modifiers (set via /sim/inject)
        self.gps_noise_mult = 1.0
        self.speed_mult = 1.0
        self._inject_until = 0.0

        self.api_url = os.environ.get("TERRA_API_URL", "http://localhost:4000")

    # ── Motion hooks (subclasses override) ─────────────────────────────────────

    def advance(self, now: float):
        """Auto-mode motion (mission/survey). Default: nothing. Lock held."""

    def initial_state(self):
        """Subclass hook: reset type-specific quantities. Lock held."""

    def extra_telemetry(self) -> dict:
        """Subclass hook: extra fields merged into the telemetry payload."""
        return {}

    def extra_state(self) -> dict:
        """Subclass hook: extra fields for GET /sim/state."""
        return {}

    # ── Common kinematics ──────────────────────────────────────────────────────

    def _integrate_unicycle(self, speed: float, omega: float):
        """Advance pose with a unicycle model (lock held)."""
        self.angular_z = omega
        self.linear_x = max(0.0, geo.smooth(self.linear_x, speed, 0.3))
        self.yaw_rad = geo.normalize_angle(self.yaw_rad + omega * DT)
        step = self.linear_x * DT * self.speed_mult
        self.lat += math.cos(self.yaw_rad) * step / geo.METERS_PER_LAT
        self.lon += math.sin(self.yaw_rad) * step / geo.METERS_PER_LON

    def _integrate_teleop(self):
        """Integrate raw velocity commands in TELEOP mode (lock held)."""
        if self.estop or self.mode != "TELEOP":
            return
        self.yaw_rad = geo.normalize_angle(self.yaw_rad + self.angular_z * DT)
        step = self.linear_x * DT
        self.lat += math.cos(self.yaw_rad) * step / geo.METERS_PER_LAT
        self.lon += math.sin(self.yaw_rad) * step / geo.METERS_PER_LON

    def _pure_pursuit_step(self, waypoints: list,
                           cruise: float, kappa_factor: float,
                           min_speed: float, omega_max: float,
                           l_min: float = 0.8, l_max: float = 5.0,
                           k_lookahead: float = 1.0) -> bool:
        """
        One Pure Pursuit control step along `waypoints` (lock held).
        Returns True while following, False when the path end is reached.
        """
        L_d = max(l_min, min(l_max, k_lookahead * max(0.5, self.linear_x)))
        y_left, seg, _ = geo.pure_pursuit_lookahead(
            self.lat, self.lon, self.yaw_rad, waypoints, L_d
        )
        self.current_wp = seg
        if y_left is None:
            return False

        kappa = 2.0 * y_left / (L_d ** 2)
        speed = cruise / (1.0 + abs(kappa) * kappa_factor)
        speed = max(min_speed, min(cruise, speed))
        omega = max(-omega_max, min(omega_max, -speed * kappa))
        self._integrate_unicycle(speed, omega)
        return True

    def _update_imu(self):
        """Roll/pitch from current motion — stable, no random jumps (lock held)."""
        target_roll = -math.degrees(self.angular_z) * 2.5
        self.roll_deg = geo.smooth(self.roll_deg, target_roll, 0.2)
        speed_fraction = min(abs(self.linear_x) / 5.0, 1.0)
        target_pitch = speed_fraction * 1.5 * (1.0 if self.linear_x >= 0 else -1.0)
        self.pitch_deg = geo.smooth(self.pitch_deg, target_pitch, 0.2)

    def _drain_battery(self):
        """Battery model (lock held)."""
        if self.mission_running and not self.mission_paused:
            self.battery = max(0.0, self.battery - 0.003)
        elif self.mode == "TELEOP" and abs(self.linear_x) > 0.05:
            self.battery = max(0.0, self.battery - 0.002)
        elif not self.mission_running and self.battery < 100.0:
            self.battery = min(100.0, self.battery + 0.015)

    def _simulate_health(self, now: float):
        """Inject a 5 s WARNING every ~90 s (lock held). Demo only."""
        if not AUTO_HEALTH:
            return
        if self.health_level == "OK" and now - self._fault_timer > 90.0:
            self.health_level = "WARNING"
            self.faults = [{
                "severity": "WARNING",
                "source": "sim_battery_sensor",
                "msg": "Battery voltage slightly below threshold (simulated)",
            }]
            self._fault_timer = now
        elif self.health_level == "WARNING" and now - self._fault_timer > 5.0:
            self.health_level = "OK"
            self.faults = []

    def _expire_injections(self, now: float):
        """Clear timed failure injections (lock held)."""
        if self._inject_until and now >= self._inject_until:
            self.gps_noise_mult = 1.0
            self.speed_mult = 1.0
            self._inject_until = 0.0
            if self.health_level == "WARNING":
                self.health_level = "OK"
                self.faults = []

    # ── Telemetry loop ─────────────────────────────────────────────────────────

    def run(self):
        log.info("Sim loop started — type=%s robot_id=%s", self.robot_type, self.robot_id)
        self._push("/telemetry/status",
                   {"mode": "STANDBY", "battery": self.battery, "connected": True})
        tick = 0
        while True:
            now = time.time()
            with self.lock:
                self._expire_injections(now)
                if self.mission_running and not self.mission_paused and not self.estop \
                        and self.health_level in ("OK", "NOTIFICATION"):
                    self.advance(now)
                elif self.mode != "TELEOP":
                    self.linear_x = geo.smooth(self.linear_x, 0.0, 0.4)
                    self.angular_z = geo.smooth(self.angular_z, 0.0, 0.4)
                self._integrate_teleop()
                self._update_imu()
                self._drain_battery()
                if tick % 5 == 0:
                    self._simulate_health(now)
                payloads = self._snapshot()

            self._push("/telemetry", payloads["telemetry"])
            if tick % 5 == 0:
                self._push("/telemetry/status", payloads["status"])
                self._push("/telemetry/health", payloads["health"])
            if payloads["mission_active"]:
                self._push("/telemetry/mission", payloads["mission"])
                if payloads["mission"]["state"] in ("COMPLETED", "ABORTED"):
                    with self.lock:
                        self.mission_state = "IDLE"
                        self.mission_id = None
            tick += 1
            time.sleep(DT)

    def _snapshot(self) -> dict:
        """Build all push payloads under the lock."""
        noisy_lat = self.lat + random.gauss(
            0, (GPS_NOISE_M / geo.METERS_PER_LAT) * self.gps_noise_mult)
        noisy_lon = self.lon + random.gauss(
            0, (GPS_NOISE_M / geo.METERS_PER_LON) * self.gps_noise_mult)
        telemetry = {
            "gps": {"lat": round(noisy_lat, 7), "lon": round(noisy_lon, 7),
                    "altitude": round(self.altitude, 2), "fix": True},
            "imu": {"roll": round(self.roll_deg, 3), "pitch": round(self.pitch_deg, 3),
                    "yaw": round(math.degrees(self.yaw_rad) % 360.0, 3)},
            "velocity": {"linear_x": round(self.linear_x, 3),
                         "angular_z": round(self.angular_z, 3)},
            **self.extra_telemetry(),
        }
        return {
            "telemetry": telemetry,
            "status": {"mode": self.mode, "battery": round(self.battery, 1),
                       "connected": True},
            "health": {"level": self.health_level, "faults": list(self.faults)},
            "mission_active": self.mission_running
            or self.mission_state in ("COMPLETED", "ABORTED"),
            "mission": {"state": self.mission_state, "currentWp": self.current_wp,
                        "totalWp": self.total_wp, "missionId": self.mission_id},
        }

    def _push(self, path: str, payload: dict):
        url = f"{self.api_url}/api/v1/robots/{self.robot_id}{path}"
        try:
            with httpx.Client(timeout=2.0) as c:
                c.post(url, json=payload)
        except Exception as exc:  # noqa: BLE001 — best-effort push
            log.warning("push %s → %s failed: %s", path, url, exc)

    def push_event(self, type_: str, msg: str):
        """Push a one-off RobotEvent (used by the player's emit_event)."""
        self._push("/telemetry/event", {
            "type": type_, "msg": msg,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

    # ── Mission lifecycle (subclasses may extend) ──────────────────────────────

    def mission_waypoints(self) -> list:
        """Subclass hook: the path a START mission should follow."""
        return []

    def start_mission(self):
        with self.lock:
            if self.estop:
                return {"ok": False, "reason": "E-STOP active"}
            self.lat, self.lon = self.home_lat, self.home_lon
            self.yaw_rad = 0.0
            self.mission_running = True
            self.mission_paused = False
            self.mission_state = "RUNNING"
            self.mode = "MISSION"
            self.current_wp = 0
            self.on_mission_start()
            log.info("[%s] mission START — %d wp", self.robot_type, self.total_wp)
        return {"ok": True}

    def on_mission_start(self):
        """Subclass hook (lock held): prime the active path."""

    def pause_mission(self):
        with self.lock:
            self.mission_paused = True
            self.mission_state = "PAUSED"
            self.mode = "STANDBY"
            self.linear_x = 0.0
        return {"ok": True}

    def resume_mission(self):
        with self.lock:
            self.mission_paused = False
            self.mission_state = "RUNNING"
            self.mode = "MISSION"
        return {"ok": True}

    def abort_mission(self):
        with self.lock:
            self.mission_running = False
            self.mission_paused = False
            self.mission_state = "ABORTED"
            self.mode = "STANDBY"
            self.linear_x = 0.0
            self.angular_z = 0.0
        return {"ok": True}

    def command(self, command: str):
        c = (command or "").upper()
        if c == "START":
            return self.start_mission()
        if c == "PAUSE":
            return self.pause_mission()
        if c == "RESUME":
            return self.resume_mission()
        if c in ("CANCEL", "STOP", "ABORT"):
            return self.abort_mission()
        return {"ok": True}

    # ── Teleop / e-stop / mode ─────────────────────────────────────────────────

    def teleop(self, linear: float, angular: float):
        with self.lock:
            if not self.estop:
                self.linear_x = linear
                self.angular_z = angular
        return {"ok": True}

    def set_estop(self, active: bool):
        with self.lock:
            self.estop = active
            if active:
                self.mode = "ESTOP"
                self.linear_x = 0.0
                self.angular_z = 0.0
                if self.mission_running:
                    self.mission_running = False
                    self.mission_state = "ABORTED"
            else:
                self.mode = "STANDBY"
        log.info("[%s] E-STOP active=%s", self.robot_type, active)
        return {"ok": True}

    def set_mode(self, mode: str):
        with self.lock:
            self.mode = mode
        return {"ok": True}

    def request_mode(self, type_: str):
        with self.lock:
            if "TELEOP" in type_:
                self.mode = "TELEOP"
            elif "MISSION_LOCK" in type_:
                self.mode = "MISSION"
            elif "MISSION_UNLOCK" in type_:
                self.mode = "STANDBY"
        return {"ok": True}

    def load_mission(self, mission_id: str, payload: dict):
        with self.lock:
            self.mission_id = mission_id
            wp = len(payload.get("waypoints", []))
            if wp > 0:
                self.total_wp = wp
        return {"ok": True}

    # ── Failure injection (called by the scenario player) ──────────────────────

    def inject(self, effect: str, duration: float = 0.0, message: str = ""):
        now = time.time()
        with self.lock:
            if effect == "gps_noise_x100":
                self.gps_noise_mult = 100.0
                self.speed_mult = 0.5
                self._inject_until = now + (duration or 30.0)
                self.health_level = "WARNING"
                self.faults = [{"severity": "WARNING", "source": "sim_gps",
                                "msg": message or "GPS dégradé (simulé)"}]
            elif effect == "battery_drop_to_15":
                self.battery = 15.0
            else:
                return {"ok": False, "reason": f"unknown effect {effect}"}
        if message:
            self.push_event("warn", message)
        log.info("[%s] inject %s (%.0fs)", self.robot_type, effect, duration)
        return {"ok": True}

    # ── State / reset ──────────────────────────────────────────────────────────

    def state(self) -> dict:
        with self.lock:
            return {
                "robot_id": self.robot_id,
                "type": self.robot_type,
                "position": {"lat": round(self.lat, 7), "lon": round(self.lon, 7),
                             "altitude": round(self.altitude, 2)},
                "yaw_deg": round(math.degrees(self.yaw_rad) % 360.0, 2),
                "mode": self.mode,
                "battery": round(self.battery, 1),
                "estop": self.estop,
                "health_level": self.health_level,
                "mission_running": self.mission_running,
                "mission_state": self.mission_state,
                "mission_complete": self.mission_state == "COMPLETED",
                "current_wp": self.current_wp,
                "total_wp": self.total_wp,
                **self.extra_state(),
            }

    def reset(self):
        with self.lock:
            self.lat, self.lon = self.home_lat, self.home_lon
            self.altitude = 0.0
            self.linear_x = self.angular_z = self.yaw_rad = 0.0
            self.roll_deg = self.pitch_deg = 0.0
            self.mode = "STANDBY"
            self.battery = 100.0
            self.connected = True
            self.mission_running = self.mission_paused = False
            self.current_wp = 0
            self.mission_state = "IDLE"
            self.mission_id = None
            self.health_level = "OK"
            self.faults = []
            self.estop = False
            self.gps_noise_mult = self.speed_mult = 1.0
            self._inject_until = 0.0
            self._fault_timer = time.time()
            self.initial_state()
        log.info("[%s] reset", self.robot_type)
        return {"ok": True}
