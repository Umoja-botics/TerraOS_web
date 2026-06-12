"""
UgvSim — ground robot following a fixed field path with Pure Pursuit.

Identical motion to the original single-robot sim, plus a `bin_level` (0–100 %)
that fills while working and a `POST /sim/transfer` that empties it.
"""
from . import geo
from .base import BaseSim

CRUISE = 4.0          # m/s
KAPPA_FACTOR = 20.0   # speed = CRUISE / (1 + |κ| * factor)
MIN_SPEED = 0.5
OMEGA_MAX = 2.0

FILL_DISTANCE_M = 60.0  # metres of work to fill the bin from 0 → 100 %


class UgvSim(BaseSim):
    robot_type = "ugv"

    def __init__(self, robot_id: str):
        self._waypoints = geo.build_field_waypoints()
        super().__init__(robot_id,
                         home_lat=self._waypoints[0]["lat"],
                         home_lon=self._waypoints[0]["lon"])
        self.total_wp = len(self._waypoints)
        self.bin_level = 0.0
        self._returning = False
        self._return_path: list = []

    def initial_state(self):
        self.bin_level = 0.0
        self.total_wp = len(self._waypoints)
        self._returning = False
        self._return_path = []

    def mission_waypoints(self) -> list:
        return self._waypoints

    def on_mission_start(self):
        self.total_wp = len(self._waypoints)
        self._returning = False

    def return_base(self):
        """Drive back to the field entry point (used by the 'fin' phase)."""
        with self.lock:
            if self.estop:
                return {"ok": False, "reason": "E-STOP active"}
            self._return_path = geo.straight_path(
                self.lat, self.lon, self.home_lat, self.home_lon, step_m=4.0)
            self._returning = True
            self.total_wp = len(self._return_path)
            self.current_wp = 0
            self.mission_running = True
            self.mission_paused = False
            self.mission_state = "RUNNING"
            self.mode = "MISSION"
        return {"ok": True}

    def advance(self, now: float):
        path = self._return_path if self._returning else self._waypoints
        following = self._pure_pursuit_step(
            path, CRUISE, KAPPA_FACTOR, MIN_SPEED, OMEGA_MAX)
        if not following:
            self._returning = False
            self._return_path = []
            self.mission_running = False
            self.mission_state = "COMPLETED"
            self.mode = "STANDBY"
            self.linear_x = 0.0
            self.angular_z = 0.0
            return
        # Bin fills only while actively working the field (not when returning)
        if not self._returning:
            dist_step = self.linear_x * 0.2 * self.speed_mult
            self.bin_level = min(100.0, self.bin_level + dist_step / FILL_DISTANCE_M * 100.0)

    def transfer(self):
        """Empty the bin into the logistics cart (called when docked)."""
        with self.lock:
            self.bin_level = 0.0
        self.push_event("ok", "Bac UGV vidé dans la navette")
        return {"ok": True}

    def extra_telemetry(self) -> dict:
        return {"bin_level": round(self.bin_level, 1)}

    def extra_state(self) -> dict:
        return {"bin_level": round(self.bin_level, 1)}
