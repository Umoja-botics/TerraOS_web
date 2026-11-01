"""
terra-bridge — FastAPI + MQTT bridge.

Transport unique : MQTT (Mosquitto broker).
La stack Terra publie la télémétrie sur MQTT via agv_bridge + mission_bridge.
Ce bridge s'y abonne et pousse les données vers terra-api via HTTP.

Run:
    uvicorn main:app --host 0.0.0.0 --port 8100
"""
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.responses import Response

import state
from config import BRIDGE_PORT, ROBOT_ID
from mqtt_transport import MqttTransport

from routers import commands, health as health_router

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("terra_bridge")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        transport = MqttTransport()
        transport.start()
        state.node = transport
        log.info("MQTT transport démarré — terra-bridge actif (robot_id=%s)", ROBOT_ID)
    except Exception as exc:
        log.error("MQTT transport init échoué: %s", exc)

    yield

    if state.node is not None:
        try:
            state.node.stop()
        except Exception:
            pass


app = FastAPI(title="terra-bridge", version="2.0.0", lifespan=lifespan)

app.include_router(commands.router)
app.include_router(health_router.router)


@app.get("/stream/camera")
async def stream_camera():
    return Response(status_code=503, content="Camera driver not configured")


@app.get("/api/camera/snapshot")
async def snapshot():
    return Response(status_code=503, content="Camera driver not configured")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=BRIDGE_PORT, reload=False)
