"""Shared mutable state — évite les imports circulaires entre main.py et routers."""
from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mqtt_transport import MqttTransport

node: "MqttTransport | None" = None
