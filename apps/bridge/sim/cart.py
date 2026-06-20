"""
CartSim — logistics shuttle ("brouette").

Driven by the scenario player:
  POST /sim/patrol            → drive the field perimeter (state PATROL → IDLE)
  POST /sim/goto {lat, lon}   → drive to a point          (EN_ROUTE → DOCKED)
  POST /sim/return_base       → drive home                (RETURNING → IDLE)

States: IDLE · EN_ROUTE · DOCKED · RETURNING · PATROL
Straight goals use Pure Pursuit; the looping perimeter uses an index-based
follower (robust to the self-overlapping, closed path).
"""
import math

from . import geo
from .base import BaseSim

CRUISE = 3.0
KAPPA_FACTOR = 18.0
MIN_SPEED = 0.8
OMEGA_MAX = 1.0     # round the rectangle corners instead of pivoting
L_MIN = 2.5
K_LOOKAHEAD = 1.2
ARRIVE_M = 1.5      # docking tolerance


class CartSim(BaseSim):
    robot_type = "cart"

    def __init__(self, robot_id: str):
        super().__init__(robot_id, home_lat=geo.FIELD_BASE["lat"], home_lon=geo.FIELD_BASE["lon"])
        self.cart_state = "IDLE"
        self._path: list = []
        self._goal = None  # (lat, lon)
        self._idx = 0      # index for perimeter follower

    def initial_state(self):
        self.cart_state = "IDLE"
        self._path = []
        self._goal = None
        self._idx = 0

    # ── Player-driven goals ────────────────────────────────────────────────────

    def goto(self, lat: float, lon: float):
        with self.lock:
            if self.estop:
                return {"ok": False, "reason": "E-STOP active"}
            self._goal = (lat, lon)
            self._path = geo.straight_path(self.lat, self.lon, lat, lon, step_m=4.0)
            self.active_path = self._path
            self.total_wp = len(self._path)
            self.current_wp = 0
            self.cart_state = "EN_ROUTE"
            self.mission_running = True
            self.mission_paused = False
            self.mission_state = "RUNNING"
            self.mode = "MISSION"
            self.mission_completed = False
        return {"ok": True}

    def patrol(self):
        """Drive a rectangular perimeter around the whole working area."""
        with self.lock:
            if self.estop:
                return {"ok": False, "reason": "E-STOP active"}
            self._path = geo.perimeter_path()
            self.active_path = self._path
            self._goal = None
            self._idx = 0
            self.total_wp = len(self._path)
            self.current_wp = 0
            self.cart_state = "PATROL"
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
            self._goal = (self.home_lat, self.home_lon)
            self._path = geo.straight_path(
                self.lat, self.lon, self.home_lat, self.home_lon, step_m=4.0)
            self.active_path = self._path
            self.total_wp = len(self._path)
            self.current_wp = 0
            self.cart_state = "RETURNING"
            self.mission_running = True
            self.mission_paused = False
            self.mission_state = "RUNNING"
            self.mode = "MISSION"
            self.mission_completed = False
        return {"ok": True}

    def advance(self, now: float):
        if self.cart_state == "PATROL":
            self._advance_patrol()
            return
        if len(self._path) < 2 or self._goal is None:
            self._arrive()
            return
        reached_end = not self._pure_pursuit_step(
            self._path, CRUISE, KAPPA_FACTOR, MIN_SPEED, OMEGA_MAX,
            l_min=L_MIN, k_lookahead=K_LOOKAHEAD)
        dist_goal = geo.distance_m(self.lat, self.lon, self._goal[0], self._goal[1])
        if reached_end or dist_goal <= ARRIVE_M:
            self._arrive()

    def _advance_patrol(self):
        """Index-based follower around the closed perimeter (lock held)."""
        if self._idx >= len(self._path):
            self._arrive()
            return
        tgt = self._path[self._idx]
        dist = geo.distance_m(self.lat, self.lon, tgt["lat"], tgt["lon"])
        desired = geo.bearing_rad(self.lat, self.lon, tgt["lat"], tgt["lon"])
        err = math.atan2(math.sin(desired - self.yaw_rad),
                         math.cos(desired - self.yaw_rad))
        omega = max(-OMEGA_MAX, min(OMEGA_MAX, 2.0 * err))
        speed = max(MIN_SPEED, CRUISE * max(0.2, 1.0 - abs(err) / 1.5))
        self._integrate_unicycle(speed, omega)
        self.current_wp = self._idx
        if dist <= ARRIVE_M * 2.0:
            self._idx += 1

    def _arrive(self):
        """Stop and settle into the terminal state (lock held)."""
        self.mark_completed()
        if self.cart_state == "EN_ROUTE":
            self.cart_state = "DOCKED"
        else:  # RETURNING or PATROL → settle at base/idle
            self.cart_state = "IDLE"
        self._path = []
        self._goal = None

    def abort_mission(self):
        res = super().abort_mission()
        with self.lock:
            self.cart_state = "IDLE"
            self._path = []
            self._goal = None
        return res

    # Frontend "START" on the cart simply sends it home (no fixed field path).
    def on_mission_start(self):
        pass

    def start_mission(self):
        return self.return_base()

    def extra_telemetry(self) -> dict:
        return {"cart_state": self.cart_state}

    def extra_state(self) -> dict:
        return {"state": self.cart_state}
