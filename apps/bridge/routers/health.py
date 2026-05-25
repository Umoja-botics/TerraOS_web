from fastapi import APIRouter
import state
from config import ROBOT_ID, USE_MQTT

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    node_ok = state.node is not None
    payload: dict = {
        "status":    "ok" if node_ok else "degraded",
        "robot_id":  ROBOT_ID,
        "transport": "mqtt" if USE_MQTT else "ros2",
        "node":      node_ok,
    }
    if state.node is not None:
        if hasattr(state.node, "ros_diagnostic"):
            payload["ros"] = state.node.ros_diagnostic()
        if hasattr(state.node, "command_snapshot"):
            payload["commands"] = state.node.command_snapshot()
    else:
        payload["ros"] = {"has_ros": False, "last_rx_age": None, "receiving": False}
    return payload
