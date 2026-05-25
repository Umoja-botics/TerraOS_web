"""Shared mutable state — avoids circular imports between main.py and routers."""
from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ros_node import TerraRosNode

node: "TerraRosNode | None" = None
