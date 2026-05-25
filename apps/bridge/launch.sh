#!/bin/bash
set -e

#  Arguments 
# Usage: ./launch.sh [use_brouette=true] [use_drone=true] [mqtt=true] [mqtt_host=<ip>]
#
# Transport:
#   mqtt=false (default) — direct ROS2 DDS, requires ROS2 sourced locally
#   mqtt=true            — MQTT via Mosquitto broker, no local ROS2 required
#                          Set mqtt_host=<robot-ip> when bridge runs off-robot
USE_BROUETTE=false
USE_DRONE=false
MQTT_OVERRIDE=""

for arg in "$@"; do
  case "$arg" in
    use_brouette=true)  USE_BROUETTE=true ;;
    use_brouette=false) USE_BROUETTE=false ;;
    use_drone=true)     USE_DRONE=true ;;
    use_drone=false)    USE_DRONE=false ;;
    mqtt=true)          MQTT_OVERRIDE=true ;;
    mqtt=false)         MQTT_OVERRIDE=false ;;
    mqtt_host=*)        export MQTT_HOST="${arg#*=}" ;;
    *) echo "[launch] Unknown argument: $arg"; exit 1 ;;
  esac
done

#  Common env 
export TERRA_API_URL="${TERRA_API_URL:-http://localhost:4000}"
# USE_MQTT: command-line flag > env var > default false
if [ -n "$MQTT_OVERRIDE" ]; then
  export USE_MQTT="$MQTT_OVERRIDE"
else
  export USE_MQTT="${USE_MQTT:-true}"
fi
export MQTT_HOST="${MQTT_HOST:-localhost}"
export MQTT_PORT="${MQTT_PORT:-1883}"

echo "[launch] Transport: $([ "$USE_MQTT" = "true" ] && echo "MQTT (broker=${MQTT_HOST}:${MQTT_PORT})" || echo "ROS2 DDS")"

source /opt/ros/jazzy/setup.bash
FAUCON_SETUP="${FAUCON_SETUP:-/home/klein/umoja_project/robotics/Faucon/install/setup.bash}"
if [ -f "$FAUCON_SETUP" ]; then source "$FAUCON_SETUP"; fi

cd "$(dirname "$0")"

PIDS=()

#  UGV bridge — port 8100 (always) 
ROBOT_ID="0c2cd9f4-816c-4669-b5a4-2f3a2e7093f6" \
MQTT_ROBOT_ID="faucon_1" \
uvicorn main:app --host 0.0.0.0 --port 8100 &
PIDS+=($!)
echo "[launch] UGV      bridge started (PID ${PIDS[-1]}) — port 8100"

#  Brouette bridge — port 8101 
if [ "$USE_BROUETTE" = "true" ]; then
  ROBOT_ID="94fd1da8-5949-43f8-b377-32b5a556e630" \
  MQTT_ROBOT_ID="faucon_brouette" \
  uvicorn main:app --host 0.0.0.0 --port 8101 &
  PIDS+=($!)
  echo "[launch] Brouette bridge started (PID ${PIDS[-1]}) — port 8101"
fi

#  Drone bridge — port 8102 
if [ "$USE_DRONE" = "true" ]; then
  ROBOT_ID="0890340d-f8dc-493e-86eb-6697243cdea1" \
  MQTT_ROBOT_ID="faucon_drone" \
  uvicorn main:app --host 0.0.0.0 --port 8102 &
  PIDS+=($!)
  echo "[launch] Drone    bridge started (PID ${PIDS[-1]}) — port 8102"
fi

trap "echo '[launch] stopping bridges…'; kill ${PIDS[*]} 2>/dev/null" EXIT INT TERM

wait "${PIDS[@]}"
