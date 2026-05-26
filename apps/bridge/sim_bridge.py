"""
terra-bridge SIMULATION — no ROS2, no MQTT, no physical robot.

Pushes stable, physics-coherent fake telemetry to terra-api under a
dedicated sim ROBOT_ID. Real robots are completely unaffected (different
Socket.IO room).

Run:
    ROBOT_ID=<sim-uuid> TERRA_API_URL=http://localhost:4000 uvicorn sim_bridge:app --host 0.0.0.0 --port 8200
Or via:
    ./launch_sim.sh
"""
import asyncio
import logging
import math
import os
import random
import time
import threading
from contextlib import asynccontextmanager
from typing import Optional

import httpx
import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [SIM] %(message)s")
log = logging.getLogger("sim_bridge")

# ── Config ────────────────────────────────────────────────────────────────────

ROBOT_ID = os.environ.get("ROBOT_ID", "00000000-0000-0000-0000-000000000001")
API_URL  = os.environ.get("TERRA_API_URL", "http://localhost:4000")
# BRIDGE_PORT for local dev, PORT is injected by Render/Heroku/etc.
PORT     = int(os.environ.get("BRIDGE_PORT") or os.environ.get("PORT", "8200"))

# Conversion constants for lat ~48.8°
METERS_PER_LAT = 111_000.0
METERS_PER_LON = 111_000.0 * math.cos(math.radians(48.8))

# GPS noise: σ ≈ 0.0001 m — quasi-perfect signal for clean demo traces
GPS_NOISE_M = 0.0001
GPS_NOISE_DEG_LAT = GPS_NOISE_M / METERS_PER_LAT
GPS_NOISE_DEG_LON = GPS_NOISE_M / METERS_PER_LON

# Aller-retour path: 4 straight WP + 48-segment smooth arc (R=8 m) + 4 straight WP
# Arc center (48.8009001, 2.3202094) — 180° sweep W→N→E
# Tested: max CTE 0.113 m, max heading err 5.0°, zero reversals — see test_trajectory.py
def _build_field_waypoints() -> list:
    _lat_c, _lon_c, _R = 48.8009001, 2.3202094, 8.0
    straight_n = [
        {"lat": 48.8001, "lon": 2.3201},
        {"lat": 48.8003, "lon": 2.3201},
        {"lat": 48.8005, "lon": 2.3201},
        {"lat": 48.8007, "lon": 2.3201},
        {"lat": 48.8009, "lon": 2.3201},
    ]
    arc = []
    for i in range(1, 49):   # skip i=0 (= straight_n[-1])
        a = math.pi - (i / 48) * math.pi
        arc.append({
            "lat": _lat_c + _R * math.sin(a) / METERS_PER_LAT,
            "lon": _lon_c + _R * math.cos(a) / METERS_PER_LON,
        })
    straight_s = [
        {"lat": 48.8007, "lon": 2.3203188},
        {"lat": 48.8005, "lon": 2.3203188},
        {"lat": 48.8003, "lon": 2.3203188},
        {"lat": 48.8001, "lon": 2.3203188},
    ]
    return straight_n + arc + straight_s


FIELD_WAYPOINTS = _build_field_waypoints()   # 57 waypoints total

DT            = 0.2   # seconds per telemetry tick
AUTO_SPEED_MS = 4.0   # m/s cruise speed

# Adaptive lookahead: L_d = K_LOOKAHEAD * v, clamped [L_MIN, L_MAX]
K_LOOKAHEAD        = 1.0    # s
L_MIN              = 0.8    # m — minimum (tight curves)
L_MAX              = 5.0    # m — maximum (straight / fast)

# Speed reduction in curves: speed = AUTO / (1 + |κ| * factor)
SPEED_KAPPA_FACTOR = 20.0   # ~1.1 m/s at R=8 m, ~4 m/s on straights
MIN_SPEED          = 0.5    # m/s floor
OMEGA_MAX          = 2.0    # rad/s cap

# ── Simulation state ──────────────────────────────────────────────────────────

class SimState:
    def __init__(self):
        self.lock = threading.Lock()

        # Position
        self.lat: float = FIELD_WAYPOINTS[0]["lat"]
        self.lon: float = FIELD_WAYPOINTS[0]["lon"]
        self.altitude: float = 0.0

        # Physics
        self.linear_x: float = 0.0   # m/s
        self.angular_z: float = 0.0  # rad/s
        self.yaw_rad: float = 0.0    # current heading in radians

        # IMU (smooth, physics-based)
        self.roll_deg: float = 0.0
        self.pitch_deg: float = 0.0

        # Robot state
        self.mode: str = "STANDBY"
        self.battery: float = 100.0
        self.connected: bool = True

        # Mission state
        self.mission_running: bool = False
        self.mission_paused: bool = False
        self.current_wp: int = 0
        self.total_wp: int = len(FIELD_WAYPOINTS)
        self.mission_state: str = "IDLE"
        self.mission_id: Optional[str] = None

        # Health
        self.health_level: str = "OK"
        self.faults: list = []
        self._fault_timer: float = time.time()

        # E-Stop
        self.estop: bool = False


sim = SimState()

# ── Physics helpers ───────────────────────────────────────────────────────────

def _smooth(current: float, target: float, alpha: float = 0.25) -> float:
    """Low-pass filter: blend toward target with factor alpha."""
    return current + (target - current) * alpha


def _update_imu():
    """Compute roll/pitch from current motion — stable, no random jumps."""
    with sim.lock:
        # Roll: lean into turns, proportional to angular rate
        target_roll = -math.degrees(sim.angular_z) * 2.5
        sim.roll_deg = _smooth(sim.roll_deg, target_roll, 0.2)
        # Pitch: nose down when accelerating, nose up when braking
        speed_fraction = min(abs(sim.linear_x) / 5.0, 1.0)
        target_pitch = speed_fraction * 1.5 * (1.0 if sim.linear_x >= 0 else -1.0)
        sim.pitch_deg = _smooth(sim.pitch_deg, target_pitch, 0.2)


def _pure_pursuit_lookahead(lat: float, lon: float, yaw: float,
                            waypoints: list, L_d: float):
    """
    Pure Pursuit — arc-length lookahead with path-tangent heading.

    Returns (y_left, seg, tangent_yaw):
      y_left       — signed lateral distance to lookahead in robot frame
                     (positive = left, negative = right)
      seg          — segment index where lookahead was found
      tangent_yaw  — path heading at the closest point (world yaw, rad)

    Returns (None, seg, tangent_yaw) when the robot reaches the path end.

    Robot frame:
        x_fwd  =  East·sin(yaw) + North·cos(yaw)
        y_left = −East·cos(yaw) + North·sin(yaw)
    """
    n   = len(waypoints)
    pts = [
        ((wp["lon"] - lon) * METERS_PER_LON,
         (wp["lat"] - lat) * METERS_PER_LAT)
        for wp in waypoints
    ]

    # ── 1. Closest point ────────────────────────────────────────────────
    best_seg, best_t, best_dist = 0, 0.0, float("inf")
    for s in range(n - 1):
        ex1, ey1 = pts[s]
        ex2, ey2 = pts[s + 1]
        dx, dy   = ex2 - ex1, ey2 - ey1
        sl2      = dx * dx + dy * dy
        if sl2 < 1e-9:
            continue
        t        = max(0.0, min(1.0, ((-ex1) * dx + (-ey1) * dy) / sl2))
        cx, cy   = ex1 + t * dx, ey1 + t * dy
        d        = math.sqrt(cx * cx + cy * cy)
        if d < best_dist:
            best_dist, best_seg, best_t = d, s, t

    # Path tangent at closest point (direction of the best segment)
    ex1, ey1 = pts[best_seg]
    ex2, ey2 = pts[best_seg + 1]
    tangent_yaw = math.atan2(ex2 - ex1, ey2 - ey1)  # atan2(East, North)

    # ── 2. Walk L_d ahead ───────────────────────────────────────────────
    remaining, seg, t = L_d, best_seg, best_t
    while seg < n - 1:
        ex1, ey1 = pts[seg]
        ex2, ey2 = pts[seg + 1]
        dx, dy   = ex2 - ex1, ey2 - ey1
        sl       = math.sqrt(dx * dx + dy * dy)
        if sl < 1e-9:
            seg += 1; t = 0.0; continue
        avail = sl * (1.0 - t)
        if remaining <= avail:
            tt     = t + remaining / sl
            ex     = ex1 + tt * dx
            ey     = ey1 + tt * dy
            y_left = -ex * math.cos(yaw) + ey * math.sin(yaw)
            return y_left, seg, tangent_yaw
        remaining -= avail
        seg += 1; t = 0.0

    # ── 3. Past last waypoint ────────────────────────────────────────────
    ex, ey = pts[-1]
    if math.sqrt(ex * ex + ey * ey) < 2.0:
        return None, n - 1, tangent_yaw
    y_left = -ex * math.cos(yaw) + ey * math.sin(yaw)
    return y_left, n - 2, tangent_yaw


def _mission_advance():
    """Pure Pursuit path following."""
    with sim.lock:
        # Stop on health fault (mirrors MissionPanel STANDBY transition)
        if sim.health_level not in ("OK", "NOTIFICATION") and sim.mission_running:
            sim.linear_x  = 0.0
            sim.angular_z = 0.0
            return

        if not sim.mission_running or sim.mission_paused or sim.estop:
            sim.linear_x  = _smooth(sim.linear_x, 0.0, 0.4)
            sim.angular_z = _smooth(sim.angular_z, 0.0, 0.4)
            return

        # Adaptive lookahead: shorter in curves/slow, longer on straights/fast
        L_d = max(L_MIN, min(L_MAX, K_LOOKAHEAD * max(0.5, sim.linear_x)))

        y_left, seg, _ = _pure_pursuit_lookahead(
            sim.lat, sim.lon, sim.yaw_rad, FIELD_WAYPOINTS, L_d
        )
        sim.current_wp = seg

        if y_left is None:
            sim.mission_running = False
            sim.mission_state   = "COMPLETED"
            sim.mode            = "STANDBY"
            sim.linear_x        = 0.0
            sim.angular_z       = 0.0
            log.info("Sim mission COMPLETED")
            return

        # ── Pure Pursuit curvature ──────────────────────────────────────
        # κ = 2·y_left / L_d²   ω = −v·κ  (clockwise-positive yaw)
        kappa_pp = 2.0 * y_left / (L_d ** 2)

        # ── Speed: slow down proportionally to curvature ───────────────
        speed = AUTO_SPEED_MS / (1.0 + abs(kappa_pp) * SPEED_KAPPA_FACTOR)
        speed = max(MIN_SPEED, min(AUTO_SPEED_MS, speed))

        # ── Angular rate (no heading feedforward — smooth arc eliminates lag)
        omega = max(-OMEGA_MAX, min(OMEGA_MAX, -speed * kappa_pp))

        sim.linear_x  = _smooth(sim.linear_x, speed, 0.3)
        sim.linear_x  = max(0.0, sim.linear_x)
        sim.angular_z = omega

        # Integrate heading + position
        sim.yaw_rad += omega * DT
        sim.yaw_rad  = (sim.yaw_rad + math.pi) % (2 * math.pi) - math.pi
        step = sim.linear_x * DT
        sim.lat += math.cos(sim.yaw_rad) * step / METERS_PER_LAT
        sim.lon += math.sin(sim.yaw_rad) * step / METERS_PER_LON


def _teleop_advance():
    """Integrate velocity commands into position when in TELEOP mode."""
    with sim.lock:
        if sim.estop or sim.mode != "TELEOP":
            return
        # Integrate heading, normalized to [-π, π]
        sim.yaw_rad += sim.angular_z * DT
        sim.yaw_rad  = (sim.yaw_rad + math.pi) % (2 * math.pi) - math.pi
        # Integrate position
        step = sim.linear_x * DT
        sim.lat += math.cos(sim.yaw_rad) * step / METERS_PER_LAT
        sim.lon += math.sin(sim.yaw_rad) * step / METERS_PER_LON


def _drain_battery():
    with sim.lock:
        if sim.mission_running and not sim.mission_paused:
            sim.battery = max(0.0, sim.battery - 0.003)   # ~10% per ~3 min mission
        elif sim.mode == "TELEOP" and abs(sim.linear_x) > 0.05:
            sim.battery = max(0.0, sim.battery - 0.002)
        elif not sim.mission_running and sim.battery < 100.0:
            sim.battery = min(100.0, sim.battery + 0.015)  # recharge when idle


def _simulate_health(now: float):
    """Inject a 5 s WARNING fault every ~90 s to demo the alarm system."""
    with sim.lock:
        if sim.health_level == "OK" and now - sim._fault_timer > 90.0:
            sim.health_level = "WARNING"
            sim.faults = [{
                "severity": "WARNING",
                "source": "sim_battery_sensor",
                "msg": "Battery voltage slightly below threshold (simulated)",
            }]
            sim._fault_timer = now
        elif sim.health_level == "WARNING" and now - sim._fault_timer > 5.0:
            sim.health_level = "OK"
            sim.faults = []


# ── HTTP push to terra-api ────────────────────────────────────────────────────

def _push(path: str, payload: dict):
    url = f"{API_URL}/api/v1/robots/{ROBOT_ID}{path}"
    try:
        with httpx.Client(timeout=2.0) as c:
            c.post(url, json=payload)
    except Exception as exc:
        log.warning("push %s → %s failed: %s", path, url, exc)


# ── Main telemetry loop ───────────────────────────────────────────────────────

def telemetry_loop():
    log.info("Sim telemetry loop started — robot_id=%s", ROBOT_ID)
    tick = 0

    # Initial status push so the robot shows connected immediately
    _push("/telemetry/status", {"mode": "STANDBY", "battery": sim.battery, "connected": True})

    while True:
        now = time.time()

        # Physics updates
        _mission_advance()
        _teleop_advance()
        _update_imu()
        _drain_battery()

        if tick % 5 == 0:
            _simulate_health(now)

        with sim.lock:
            # GPS with sub-meter Gaussian noise
            noisy_lat = sim.lat + random.gauss(0, GPS_NOISE_DEG_LAT)
            noisy_lon = sim.lon + random.gauss(0, GPS_NOISE_DEG_LON)
            yaw_deg   = math.degrees(sim.yaw_rad) % 360.0

            telemetry_payload = {
                "gps": {
                    "lat": round(noisy_lat, 7),
                    "lon": round(noisy_lon, 7),
                    "altitude": sim.altitude,
                    "fix": True,
                },
                "imu": {
                    "roll":  round(sim.roll_deg, 3),
                    "pitch": round(sim.pitch_deg, 3),
                    "yaw":   round(yaw_deg, 3),
                },
                "velocity": {
                    "linear_x":  round(sim.linear_x, 3),
                    "angular_z": round(sim.angular_z, 3),
                },
            }

            status_payload = {
                "mode":      sim.mode,
                "battery":   round(sim.battery, 1),
                "connected": True,
            }

            health_payload = {
                "level":  sim.health_level,
                "faults": list(sim.faults),
            }

            mission_running = sim.mission_running
            mission_state   = sim.mission_state
            mission_id      = sim.mission_id
            current_wp      = sim.current_wp
            total_wp        = sim.total_wp

        # GPS + IMU + velocity — every tick (200 ms)
        _push("/telemetry", telemetry_payload)

        # Status + health — every 5 ticks (~1 s)
        if tick % 5 == 0:
            _push("/telemetry/status", status_payload)
            _push("/telemetry/health", health_payload)

        # Mission update — every tick when active
        if mission_running or mission_state in ("COMPLETED", "ABORTED"):
            _push("/telemetry/mission", {
                "state":     mission_state,
                "currentWp": current_wp,
                "totalWp":   total_wp,
                "missionId": mission_id,
            })
            if mission_state in ("COMPLETED", "ABORTED"):
                with sim.lock:
                    sim.mission_state = "IDLE"
                    sim.mission_id    = None

        tick += 1
        time.sleep(DT)


# ── FastAPI app ───────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    t = threading.Thread(target=telemetry_loop, daemon=True)
    t.start()
    yield


app = FastAPI(title="terra-bridge-sim", version="1.0.0", lifespan=lifespan)


# ── Command endpoints (mirror real bridge HTTP API) ───────────────────────────

class TeleopCmd(BaseModel):
    linear: float
    angular: float

class EstopCmd(BaseModel):
    active: bool = True

class MissionAgentCmd(BaseModel):
    agent_id: str
    command: str

class MissionLoadCmd(BaseModel):
    agent_id: str
    mission_id: str
    payload: dict = {}

class ModeCmd(BaseModel):
    type: str

class SetModeCmd(BaseModel):
    mode: str

class LoadPathCmd(BaseModel):
    yaml_content: str = ""

class OrchMissionCmd(BaseModel):
    mission_id: str
    name: str
    agents: list

class OrchCommandCmd(BaseModel):
    command: str


@app.post("/commands/teleop")
def teleop(cmd: TeleopCmd):
    with sim.lock:
        if not sim.estop:
            sim.linear_x  = cmd.linear
            sim.angular_z = cmd.angular
    return {"ok": True}


@app.post("/commands/estop")
def estop(cmd: EstopCmd = EstopCmd()):
    with sim.lock:
        sim.estop = cmd.active
        if cmd.active:
            sim.mode      = "ESTOP"
            sim.linear_x  = 0.0
            sim.angular_z = 0.0
            if sim.mission_running:
                sim.mission_running = False
                sim.mission_state   = "ABORTED"
        else:
            sim.mode = "STANDBY"
    log.info("E-STOP: active=%s", cmd.active)
    return {"ok": True}


@app.post("/commands/mission/command")
def mission_command(cmd: MissionAgentCmd):
    with sim.lock:
        if sim.estop:
            return {"ok": False, "reason": "E-STOP active"}

        c = cmd.command.upper()
        if c == "START":
            sim.mission_running = True
            sim.mission_paused  = False
            sim.mission_state   = "RUNNING"
            sim.mode            = "MISSION"
            sim.current_wp      = 0
            sim.lat = FIELD_WAYPOINTS[0]["lat"]
            sim.lon = FIELD_WAYPOINTS[0]["lon"]
            sim.yaw_rad = 0.0
            log.info("Mission START — %d waypoints", sim.total_wp)
        elif c == "PAUSE":
            sim.mission_paused = True
            sim.mission_state  = "PAUSED"
            sim.mode           = "STANDBY"
            sim.linear_x       = 0.0
            log.info("Mission PAUSED")
        elif c == "RESUME":
            sim.mission_paused = False
            sim.mission_state  = "RUNNING"
            sim.mode           = "MISSION"
            log.info("Mission RESUMED")
        elif c in ("CANCEL", "STOP", "ABORT"):
            sim.mission_running = False
            sim.mission_paused  = False
            sim.mission_state   = "ABORTED"
            sim.mode            = "STANDBY"
            sim.linear_x        = 0.0
            sim.angular_z       = 0.0
            log.info("Mission ABORTED")
        elif c == "ACKNOWLEDGE":
            pass

    return {"ok": True}


@app.post("/commands/mission")
def mission_simple(cmd: MissionAgentCmd):
    return mission_command(cmd)


@app.post("/commands/mission/load")
def mission_load(cmd: MissionLoadCmd):
    with sim.lock:
        sim.mission_id = cmd.mission_id
        wp_count = len(cmd.payload.get("waypoints", []))
        sim.total_wp = wp_count if wp_count > 0 else len(FIELD_WAYPOINTS)
    log.info("Mission loaded — id=%s  wp=%d", cmd.mission_id, sim.total_wp)
    return {"ok": True}


@app.post("/commands/mode")
def mode_request(cmd: ModeCmd):
    with sim.lock:
        if "TELEOP" in cmd.type:
            sim.mode = "TELEOP"
        elif "MISSION_LOCK" in cmd.type:
            sim.mode = "MISSION"
        elif "MISSION_UNLOCK" in cmd.type:
            sim.mode = "STANDBY"
    log.info("Mode request: %s → %s", cmd.type, sim.mode)
    return {"ok": True}


@app.post("/commands/set_mode")
def set_mode(cmd: SetModeCmd):
    with sim.lock:
        sim.mode = cmd.mode
    return {"ok": True}


@app.post("/commands/load_path")
def load_path(cmd: LoadPathCmd):
    return {"ok": True}


@app.post("/commands/orchestration/load")
def orchestration_load(cmd: OrchMissionCmd):
    with sim.lock:
        sim.mission_id = cmd.mission_id
    return {"ok": True}


@app.post("/commands/orchestration/command")
def orchestration_command(cmd: OrchCommandCmd):
    return mission_command(MissionAgentCmd(agent_id="ugv", command=cmd.command))


# ── Health & status ───────────────────────────────────────────────────────────

@app.get("/health")
def health():
    with sim.lock:
        return {
            "status":     "ok",
            "simulation": True,
            "ros2":       False,
            "mqtt":       False,
            "robot_id":   ROBOT_ID,
            "mode":       sim.mode,
            "battery":    round(sim.battery, 1),
        }


@app.get("/telemetry/status")
def telemetry_status():
    with sim.lock:
        return {
            "mode":      sim.mode,
            "battery":   round(sim.battery, 1),
            "connected": True,
            "estop":     sim.estop,
            "mission": {
                "state":     sim.mission_state,
                "currentWp": sim.current_wp,
                "totalWp":   sim.total_wp,
            },
        }


if __name__ == "__main__":
    uvicorn.run("sim_bridge:app", host="0.0.0.0", port=PORT, reload=False)
