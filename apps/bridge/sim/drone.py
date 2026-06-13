"""
DroneSim — aerial scout flying a boustrophedon (lawn-mower) survey.

No Pure Pursuit: holonomic flight straight between waypoints over a rectangle.
  POST /sim/survey {area: {corner_a, corner_b}}  → cover the zone (coverage 0→100 %)
  POST /sim/return_base                          → fly home and land

States: IDLE · SURVEYING · RETURNING
"""
import math

from . import geo
from .base import BaseSim

SPEED = 14.0          # m/s ground speed — brisk recon so ground robots engage soon
SURVEY_ALT = 30.0     # m
SWATH_M = 12.0        # lane spacing (fewer, faster lanes)
ARRIVE_M = 3.0
CLIMB_RATE = 4.0      # m/s


class DroneSim(BaseSim):
    robot_type = "drone"

    def __init__(self, robot_id: str):
        super().__init__(robot_id, home_lat=geo.FIELD_BASE["lat"], home_lon=geo.FIELD_BASE["lon"])
        self.drone_state = "IDLE"
        self.coverage = 0.0
        self._path: list = []
        self._idx = 0
        self._total_len = 0.0
        self._covered = 0.0
        self._target_alt = 0.0

    def initial_state(self):
        self.drone_state = "IDLE"
        self.coverage = 0.0
        self._path = []
        self._idx = 0
        self._total_len = self._covered = 0.0
        self._target_alt = 0.0

    # ── Player-driven goals ────────────────────────────────────────────────────

    def survey(self, area: dict):
        with self.lock:
            if self.estop:
                return {"ok": False, "reason": "E-STOP active"}
            path = geo.boustrophedon(area["corner_a"], area["corner_b"], SWATH_M)
            # Start from current position so the climb-out reads naturally
            self._path = [{"lat": self.lat, "lon": self.lon}] + path
            self.active_path = self._path
            self._idx = 1
            self._total_len = max(1e-6, geo.path_length_m(self._path))
            self._covered = 0.0
            self.coverage = 0.0
            self.total_wp = len(self._path)
            self.current_wp = 0
            self._target_alt = SURVEY_ALT
            self.drone_state = "SURVEYING"
            self.mission_running = True
            self.mission_paused = False
            self.mission_state = "RUNNING"
            self.mode = "MISSION"
            self.mission_completed = False
        return {"ok": True}

    def return_base(self):
        with self.lock:
            if self.estop:
                return {"ok": False, "reason": "E-STOP active"}
            self._path = [{"lat": self.lat, "lon": self.lon},
                          {"lat": self.home_lat, "lon": self.home_lon}]
            self.active_path = self._path
            self._idx = 1
            self._target_alt = 0.0
            self.drone_state = "RETURNING"
            self.mission_running = True
            self.mission_paused = False
            self.mission_state = "RUNNING"
            self.mode = "MISSION"
            self.mission_completed = False
        return {"ok": True}

    def advance(self, now: float):
        # Altitude ramp
        if self.altitude < self._target_alt:
            self.altitude = min(self._target_alt, self.altitude + CLIMB_RATE * 0.2)
        elif self.altitude > self._target_alt:
            self.altitude = max(self._target_alt, self.altitude - CLIMB_RATE * 0.2)

        if self._idx >= len(self._path):
            self._finish()
            return

        tgt = self._path[self._idx]
        dist = geo.distance_m(self.lat, self.lon, tgt["lat"], tgt["lon"])
        bearing = geo.bearing_rad(self.lat, self.lon, tgt["lat"], tgt["lon"])
        self.yaw_rad = bearing
        step = min(SPEED * 0.2 * self.speed_mult, dist)
        self.lat += math.cos(bearing) * step / geo.METERS_PER_LAT
        self.lon += math.sin(bearing) * step / geo.METERS_PER_LON
        self.linear_x = SPEED
        self.angular_z = 0.0

        if self.drone_state == "SURVEYING":
            self._covered += step
            self.coverage = min(100.0, self._covered / self._total_len * 100.0)

        if dist - step <= ARRIVE_M:
            self._idx += 1
            self.current_wp = self._idx

    def _finish(self):
        """Path exhausted (lock held)."""
        if self.drone_state == "SURVEYING":
            self.coverage = 100.0
        self.drone_state = "IDLE"
        self.mark_completed()
        self._path = []

    def _update_imu(self):
        # Drone banks into turns but stays roughly level; keep it gentle.
        self.roll_deg = geo.smooth(self.roll_deg, 0.0, 0.2)
        self.pitch_deg = geo.smooth(self.pitch_deg, -2.0 if self.linear_x > 0.1 else 0.0, 0.2)

    def abort_mission(self):
        res = super().abort_mission()
        with self.lock:
            self.drone_state = "IDLE"
            self._path = []
        return res

    def start_mission(self):
        # No default survey area from the frontend → just return home/hover.
        return self.return_base()

    def extra_telemetry(self) -> dict:
        return {"coverage": round(self.coverage, 1)}

    def extra_state(self) -> dict:
        return {"state": self.drone_state, "coverage": round(self.coverage, 1)}
