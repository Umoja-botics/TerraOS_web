import os

ROBOT_ID    = os.environ.get("ROBOT_ID", "robot-01")
API_URL     = os.environ.get("TERRA_API_URL", "http://localhost:4000")
BRIDGE_PORT = int(os.environ.get("BRIDGE_PORT", "8100"))

# MQTT est le seul transport — le bridge se connecte toujours au broker Mosquitto.
MQTT_HOST     = os.environ.get("MQTT_HOST", "localhost")
MQTT_PORT     = int(os.environ.get("MQTT_PORT", "1883"))

# MQTT_ROBOT_ID = namespace MQTT (terra/{MQTT_ROBOT_ID}/...).
# Doit correspondre au robot_id configuré dans agv_bridge / mission_bridge.
MQTT_ROBOT_ID = os.environ.get("MQTT_ROBOT_ID", ROBOT_ID)
