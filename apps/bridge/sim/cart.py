"""
CartSim — logistics shuttle ("brouette").

Reuses Pure Pursuit but follows dynamic goals issued by the scenario player:
  POST /sim/goto {lat, lon}   → drive to a point        (state EN_ROUTE → DOCKED)
  POST /sim/return_base       → drive home              (state RETURNING → IDLE)

States: IDLE · EN_ROUTE · DOCKED · RETURNING
"""
from . import geo
from .base import BaseSim

CRUISE = 3.0
KAPPA_FACTOR = 18.0
MIN_SPEED = 0.5
OMEGA_MAX = 2.0
ARRIVE_M = 1.5  # docking tolerance


class CartSim(BaseSim):
    robot_type = "cart"

    def __init__(self, robot_id: str):
        super().__init__(robot_id, home_lat=48.8000, home_lon=2.3199)
        self.cart_state = "IDLE"
        self._path: list = []
        self._goal = None  # (lat, lon)

    def initial_state(self):
        self.cart_state = "IDLE"
        self._path = []
        self._goal = None

    # ── Player-driven goals ────────────────────────────────────────────────────

    def goto(self, lat: float, lon: float):
        with self.lock:
            if self.estop:
                return {"ok": False, "reason": "E-STOP active"}
            self._goal = (lat, lon)
            self._path = geo.straight_path(self.lat, self.lon, lat, lon, step_m=4.0)
            self.total_wp = len(self._path)
            self.current_wp = 0
            self.cart_state = "EN_ROUTE"
            self.mission_running = True
            self.mission_paused = False
            self.mission_state = "RUNNING"
            self.mode = "MISSION"
        return {"ok": True}

    def return_base(self):
        with self.lock:
            if self.estop:
                return {"ok": False, "reason": "E-STOP active"}
            self._goal = (self.home_lat, self.home_lon)
            self._path = geo.straight_path(
                self.lat, self.lon, self.home_lat, self.home_lon, step_m=4.0)
            self.total_wp = len(self._path)
            self.current_wp = 0
            self.cart_state = "RETURNING"
            self.mission_running = True
            self.mission_paused = False
            self.mission_state = "RUNNING"
            self.mode = "MISSION"
        return {"ok": True}

    def advance(self, now: float):
        if len(self._path) < 2 or self._goal is None:
            self._arrive()
            return
        reached_end = not self._pure_pursuit_step(
            self._path, CRUISE, KAPPA_FACTOR, MIN_SPEED, OMEGA_MAX)
        dist_goal = geo.distance_m(self.lat, self.lon, self._goal[0], self._goal[1])
        if reached_end or dist_goal <= ARRIVE_M:
            self._arrive()

    def _arrive(self):
        """Stop and settle into the terminal state (lock held)."""
        self.linear_x = 0.0
        self.angular_z = 0.0
        self.mission_running = False
        self.mission_state = "COMPLETED"
        self.mode = "STANDBY"
        if self.cart_state == "EN_ROUTE":
            self.cart_state = "DOCKED"
        elif self.cart_state == "RETURNING":
            self.cart_state = "IDLE"
        self._path = []
        self._goal = None

    # Frontend "START" on the cart simply sends it home (no fixed field path).
    def on_mission_start(self):
        pass

    def start_mission(self):
        return self.return_base()

    def extra_telemetry(self) -> dict:
        return {"cart_state": self.cart_state}

    def extra_state(self) -> dict:
        return {"state": self.cart_state}
