"""
TerraOS robot simulators (demo mode).

Each simulator emits the exact same telemetry/status/health/mission payloads
to terra-api as a real bridge would. The frontend and API never need to know
whether they talk to a sim or a real robot.

Pick the concrete sim by ROBOT_TYPE (ugv|cart|drone); see sim_bridge.py.
"""
from .base import BaseSim
from .ugv import UgvSim
from .cart import CartSim
from .drone import DroneSim


def make_sim(robot_type: str, robot_id: str) -> BaseSim:
    """Factory: build the simulator matching ROBOT_TYPE (default ugv)."""
    t = (robot_type or "ugv").strip().lower()
    if t in ("ugv", ""):
        return UgvSim(robot_id)
    if t in ("cart", "brouette"):
        return CartSim(robot_id)
    if t == "drone":
        return DroneSim(robot_id)
    raise ValueError(f"Unknown ROBOT_TYPE={robot_type!r} (expected ugv|cart|drone)")


__all__ = ["BaseSim", "UgvSim", "CartSim", "DroneSim", "make_sim"]
