import os

ROBOT_ID    = os.environ.get("ROBOT_ID", "robot-01")
API_URL     = os.environ.get("TERRA_API_URL", "http://localhost:4000")
BRIDGE_PORT = int(os.environ.get("BRIDGE_PORT", "8100"))

# MQTT transport — set USE_MQTT=true to connect to faucon_mqtt_bridge (Mosquitto)
# instead of requiring a local ROS2 installation.
USE_MQTT    = os.environ.get("USE_MQTT", "false").lower() == "true"
MQTT_HOST   = os.environ.get("MQTT_HOST", "localhost")
MQTT_PORT   = int(os.environ.get("MQTT_PORT", "1883"))

# MQTT_ROBOT_ID sets the MQTT topic namespace (faucon/{MQTT_ROBOT_ID}/...).
# Defaults to ROBOT_ID but can differ when the DB UUID doesn't match the
# robot_id configured in faucon_mqtt_bridge (bridge_params.yaml).
MQTT_ROBOT_ID = os.environ.get("MQTT_ROBOT_ID", ROBOT_ID)
