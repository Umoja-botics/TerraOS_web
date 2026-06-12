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

    def initial_state(self):
        self.bin_level = 0.0
        self.total_wp = len(self._waypoints)

    def mission_waypoints(self) -> list:
        return self._waypoints

    def on_mission_start(self):
        self.total_wp = len(self._waypoints)

    def advance(self, now: float):
        following = self._pure_pursuit_step(
            self._waypoints, CRUISE, KAPPA_FACTOR, MIN_SPEED, OMEGA_MAX)
        if not following:
            self.mission_running = False
            self.mission_state = "COMPLETED"
            self.mode = "STANDBY"
            self.linear_x = 0.0
            self.angular_z = 0.0
            return
        # Bin fills with distance worked
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
