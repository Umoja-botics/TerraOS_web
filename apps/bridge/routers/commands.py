"""
Bridge command endpoints — called by terra-api to send commands to the robot.

POST /commands/teleop                Joystick velocity command
POST /commands/estop                 Emergency stop (/faucon/ihm/estop)
POST /commands/mission               Simple mission lifecycle (START/PAUSE/RESUME/CANCEL)
POST /commands/mission/load          Load mission profile per agent
POST /commands/mission/command       Send command to specific agent(s)
POST /commands/mode                  Publish /mode_manager/requests (MISSION_LOCK etc.)
POST /commands/set_mode              Publish /mission/set_mode
POST /commands/load_path             Receive path YAML (legacy / simple path)
POST /commands/orchestration/load    Multi-agent mission profile → orchestrator
POST /commands/orchestration/command Orchestration lifecycle command
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import state

router = APIRouter(prefix="/commands", tags=["commands"])


# ── Teleop ────────────────────────────────────────────────────────────────────

class TeleopCmd(BaseModel):
    linear:  float  # m/s (already scaled by web)
    angular: float  # rad/s


@router.post("/teleop")
def teleop(cmd: TeleopCmd):
    if state.node is None:
        raise HTTPException(503, "ROS node not ready")
    state.node.publish_teleop(cmd.linear, cmd.angular)
    return {"ok": True}


# ── E-Stop ────────────────────────────────────────────────────────────────────

class EstopCmd(BaseModel):
    active: bool = True


@router.post("/estop")
def estop(cmd: EstopCmd = EstopCmd()):
    if state.node is None:
        raise HTTPException(503, "ROS node not ready")
    state.node.publish_estop(cmd.active)
    return {"ok": True}


# ── Mission lifecycle (simple, one agent = UGV) ───────────────────────────────

class MissionCmd(BaseModel):
    command: str  # START | PAUSE | RESUME | CANCEL


@router.post("/mission")
def mission_command(cmd: MissionCmd):
    if state.node is None:
        raise HTTPException(503, "ROS node not ready")
    state.node.publish_mission_command("ugv", cmd.command)
    return {"ok": True}


# ── Mission load per agent ────────────────────────────────────────────────────

class MissionLoadCmd(BaseModel):
    agent_id:   str   # 'ugv' | 'brouette' | 'drone'
    mission_id: str
    payload:    dict  # YAML string for UGV, JSON dict for others


@router.post("/mission/load")
def mission_load(cmd: MissionLoadCmd):
    if state.node is None:
        raise HTTPException(503, "ROS node not ready")
    state.node.publish_mission_load(cmd.agent_id, cmd.payload)
    return {"ok": True}


# ── Mission command per agent ─────────────────────────────────────────────────

class MissionAgentCmd(BaseModel):
    agent_id: str   # 'ugv' | 'brouette' | 'drone' | 'all'
    command:  str   # START | PAUSE | RESUME | CANCEL


@router.post("/mission/command")
def mission_agent_command(cmd: MissionAgentCmd):
    if state.node is None:
        raise HTTPException(503, "ROS node not ready")
    state.node.publish_mission_command(cmd.agent_id, cmd.command)
    return {"ok": True}


# ── Mode manager ──────────────────────────────────────────────────────────────

class ModeCmd(BaseModel):
    type: str  # REQUEST_TELEOP | REQUEST_AUTO/REQUEST_AUTONOMOUS | MISSION_LOCK | MISSION_UNLOCK


@router.post("/mode")
def mode_request(cmd: ModeCmd):
    if state.node is None:
        raise HTTPException(503, "ROS node not ready")
    state.node.publish_mode_request(cmd.type)
    return {"ok": True}


class SetModeCmd(BaseModel):
    mode: str  # STANDBY


@router.post("/set_mode")
def set_mode(cmd: SetModeCmd):
    if state.node is None:
        raise HTTPException(503, "ROS node not ready")
    state.node.publish_set_mode(cmd.mode)
    return {"ok": True}


# ── Path load (legacy / single path) ─────────────────────────────────────────

class LoadPathCmd(BaseModel):
    yaml_content: str


@router.post("/load_path")
def load_path(cmd: LoadPathCmd):
    if state.node is None:
        raise HTTPException(503, "ROS node not ready")
    state.node.publish_raw_load_path(cmd.yaml_content)
    return {"ok": True, "bytes": len(cmd.yaml_content)}


# ── Orchestration endpoints ───────────────────────────────────────────────────

class OrchMissionCmd(BaseModel):
    mission_id: str
    name:       str
    agents:     list


class OrchCommandCmd(BaseModel):
    command: str  # START | PAUSE | RESUME | CANCEL | CANCEL_BROUETTE | CANCEL_DRONE


@router.post("/orchestration/load")
def orchestration_load(cmd: OrchMissionCmd):
    if state.node is None:
        raise HTTPException(503, "ROS node not ready")
    state.node.publish_orchestration_mission(cmd.model_dump())
    return {"ok": True}


@router.post("/orchestration/command")
def orchestration_command(cmd: OrchCommandCmd):
    if state.node is None:
        raise HTTPException(503, "ROS node not ready")
    state.node.publish_orchestration_command(cmd.command)
    return {"ok": True}
