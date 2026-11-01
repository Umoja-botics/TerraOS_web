from fastapi import APIRouter
import state
from config import ROBOT_ID

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    node_ok = state.node is not None
    payload: dict = {
        "status":    "ok" if node_ok else "degraded",
        "robot_id":  ROBOT_ID,
        "transport": "mqtt",
        "node":      node_ok,
    }
    if state.node is not None and hasattr(state.node, "command_snapshot"):
        payload["commands"] = state.node.command_snapshot()
    return payload
