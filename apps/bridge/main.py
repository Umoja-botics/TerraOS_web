"""
terra-bridge — FastAPI + ROS2/MQTT bridge.

Two transport modes (set via env vars):

  ROS2 mode (default, USE_MQTT=false):
    Starts a rclpy node in a background thread.
    Requires ROS2 Jazzy sourced in the environment.

  MQTT mode (USE_MQTT=true):
    Connects to the faucon_mqtt_bridge Mosquitto broker.
    Does NOT require ROS2 — terra-bridge can run anywhere on the network.
    Set MQTT_HOST to the robot's IP (default: localhost).

Both modes expose the same HTTP API so terra-api routes commands identically.

Run:
    uvicorn main:app --host 0.0.0.0 --port 8100
"""
import logging
import threading
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.responses import Response

import state
from config import BRIDGE_PORT, USE_MQTT, ROBOT_ID

from routers import commands, health as health_router

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("terra_bridge")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if USE_MQTT:
        # ── MQTT transport ────────────────────────────────────────────────
        try:
            from mqtt_transport import MqttTransport
            transport = MqttTransport()
            transport.start()
            state.node = transport
            log.info("MQTT transport started — terra-bridge running without ROS2")
        except Exception as exc:
            log.error(f"MQTT transport init failed: {exc}")
    else:
        # ── ROS2 direct ───────────────────────────────────────────────────
        try:
            import rclpy
            from ros_node import TerraRosNode

            rclpy.init()
            state.node = TerraRosNode()
            thread = threading.Thread(target=rclpy.spin, args=(state.node,), daemon=True)
            thread.start()
            log.info("ROS2 node started — robot_id=%s — check /health for ROS2 status", ROBOT_ID)
        except ImportError as exc:
            log.error(
                "rclpy not importable (%s). "
                "Run the bridge via launch.sh (which sources ROS2) or set USE_MQTT=true.", exc
            )
        except Exception as exc:
            log.error("ROS2 init failed: %s", exc)

    yield

    if state.node is not None:
        if USE_MQTT:
            try:
                state.node.stop()
            except Exception:
                pass
        else:
            try:
                import rclpy
                state.node.destroy_node()
                rclpy.shutdown()
            except Exception:
                pass


app = FastAPI(title="terra-bridge", version="1.0.0", lifespan=lifespan)

app.include_router(commands.router)
app.include_router(health_router.router)


# ── Camera endpoints ───────────────────────────────────────────────────────────
# Replace these with your actual camera driver (e.g. MJPEG server from /camera/image/compressed)

@app.get("/stream/camera")
async def stream_camera():
    return Response(status_code=503, content="Camera driver not configured")


@app.get("/api/camera/snapshot")
async def snapshot():
    return Response(status_code=503, content="Camera driver not configured")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=BRIDGE_PORT, reload=False)
