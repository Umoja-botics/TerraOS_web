"""
terra-bridge SIMULATION — no ROS2, no MQTT, no physical robot.

A single simulator process. Pick the robot it impersonates with ROBOT_TYPE
(ugv|cart|drone); it pushes the exact same telemetry/status/health/mission
payloads to terra-api as a real bridge under its own ROBOT_ID, so the frontend
and API never know it is simulated.

Run:
    ROBOT_TYPE=ugv ROBOT_ID=<uuid> TERRA_API_URL=http://localhost:4000 \
        uvicorn sim_bridge:app --host 0.0.0.0 --port 8200
Or via:
    ./launch_sim.sh

Backwards compatible: no ROBOT_TYPE → ugv with the original behaviour.
"""
import logging
import os
import threading
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from sim import CartSim, DroneSim, UgvSim, make_sim

logging.basicConfig(level=logging.INFO, format="%(asctime)s [SIM] %(message)s")
log = logging.getLogger("sim_bridge")

# ── Config ────────────────────────────────────────────────────────────────────

ROBOT_ID   = os.environ.get("ROBOT_ID", "00000000-0000-0000-0000-000000000001")
ROBOT_TYPE = os.environ.get("ROBOT_TYPE", "ugv")
# BRIDGE_PORT for local dev, PORT is injected by Render/Heroku/etc.
PORT       = int(os.environ.get("BRIDGE_PORT") or os.environ.get("PORT", "8200"))

robot = make_sim(ROBOT_TYPE, ROBOT_ID)


# ── FastAPI app ───────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    threading.Thread(target=robot.run, daemon=True).start()
    yield


app = FastAPI(title=f"terra-bridge-sim ({robot.robot_type})",
              version="2.0.0", lifespan=lifespan)


# ── Command payloads (mirror the real bridge HTTP API) ────────────────────────

class TeleopCmd(BaseModel):
    linear: float
    angular: float

class EstopCmd(BaseModel):
    active: bool = True

class MissionAgentCmd(BaseModel):
    agent_id: str = "ugv"
    command: str

class MissionLoadCmd(BaseModel):
    agent_id: str = "ugv"
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
    return robot.teleop(cmd.linear, cmd.angular)


@app.post("/commands/estop")
def estop(cmd: EstopCmd = EstopCmd()):
    return robot.set_estop(cmd.active)


@app.post("/commands/mission/command")
def mission_command(cmd: MissionAgentCmd):
    return robot.command(cmd.command)


@app.post("/commands/mission")
def mission_simple(cmd: MissionAgentCmd):
    return robot.command(cmd.command)


@app.post("/commands/mission/load")
def mission_load(cmd: MissionLoadCmd):
    return robot.load_mission(cmd.mission_id, cmd.payload)


@app.post("/commands/mode")
def mode_request(cmd: ModeCmd):
    return robot.request_mode(cmd.type)


@app.post("/commands/set_mode")
def set_mode(cmd: SetModeCmd):
    return robot.set_mode(cmd.mode)


@app.post("/commands/load_path")
def load_path(cmd: LoadPathCmd):
    return {"ok": True}


@app.post("/commands/orchestration/load")
def orchestration_load(cmd: OrchMissionCmd):
    return robot.load_mission(cmd.mission_id, {})


@app.post("/commands/orchestration/command")
def orchestration_command(cmd: OrchCommandCmd):
    return robot.command(cmd.command)


# ── Simulation control surface (used by the scenario player) ──────────────────

class GotoCmd(BaseModel):
    lat: float
    lon: float

class SurveyCmd(BaseModel):
    area: dict

class InjectCmd(BaseModel):
    effect: str
    duration: float = 0.0
    message: str = ""


@app.get("/sim/state")
def sim_state():
    return robot.state()


@app.post("/sim/reset")
def sim_reset():
    return robot.reset()


@app.post("/sim/inject")
def sim_inject(cmd: InjectCmd):
    return robot.inject(cmd.effect, cmd.duration, cmd.message)


@app.post("/sim/transfer")
def sim_transfer():
    if not isinstance(robot, UgvSim):
        raise HTTPException(400, "transfer is only available on a ugv sim")
    return robot.transfer()


@app.post("/sim/goto")
def sim_goto(cmd: GotoCmd):
    if not isinstance(robot, CartSim):
        raise HTTPException(400, "goto is only available on a cart sim")
    return robot.goto(cmd.lat, cmd.lon)


@app.post("/sim/patrol")
def sim_patrol():
    if not isinstance(robot, CartSim):
        raise HTTPException(400, "patrol is only available on a cart sim")
    return robot.patrol()


@app.post("/sim/survey")
def sim_survey(cmd: SurveyCmd):
    if not isinstance(robot, DroneSim):
        raise HTTPException(400, "survey is only available on a drone sim")
    return robot.survey(cmd.area)


@app.post("/sim/return_base")
def sim_return_base():
    if not hasattr(robot, "return_base"):
        raise HTTPException(400, "return_base is not available on this sim")
    return robot.return_base()


# ── Health & status ───────────────────────────────────────────────────────────

@app.get("/health")
def health():
    s = robot.state()
    return {"status": "ok", "simulation": True, "ros2": False, "mqtt": False,
            "robot_id": ROBOT_ID, "type": robot.robot_type,
            "mode": s["mode"], "battery": s["battery"]}


@app.get("/telemetry/status")
def telemetry_status():
    s = robot.state()
    return {"mode": s["mode"], "battery": s["battery"], "connected": True,
            "estop": s["estop"],
            "mission": {"state": s["mission_state"], "currentWp": s["current_wp"],
                        "totalWp": s["total_wp"]}}


if __name__ == "__main__":
    uvicorn.run("sim_bridge:app", host="0.0.0.0", port=PORT, reload=False)
