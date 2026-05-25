#!/bin/bash
set -e

# Launch terra-bridge for an external deployment where terra-api is remote
# (Render) and the bridge runs on a machine reachable from the API.
#
# Usage:
#   ./launch-external.sh mqtt_host=<host> api_url=<url> bridge_port=<port> robot_id=<uuid>
#
# Examples:
#   ./launch-external.sh api_url=https://terraos-api-jdxg.onrender.com mqtt_host=localhost
#   ./launch-external.sh api_url=https://terraos-api-jdxg.onrender.com mqtt_host=192.168.1.79

USE_MQTT="true"
MQTT_HOST="localhost"
MQTT_PORT="1883"
BRIDGE_PORT="8100"
ROBOT_ID="11697df4-1aa7-4f68-8b2c-d75d549862fe"
MQTT_ROBOT_ID="faucon_1"
API_URL="https://terraos-api-jdxg.onrender.com"
NGROK="false"
NGROK_TOKEN=""

for arg in "$@"; do
  case "$arg" in
    mqtt=true)           USE_MQTT="true" ;;
    mqtt=false)          USE_MQTT="false" ;;
    mqtt_host=*)         MQTT_HOST="${arg#*=}" ;;
    mqtt_port=*)         MQTT_PORT="${arg#*=}" ;;
    bridge_port=*)       BRIDGE_PORT="${arg#*=}" ;;
    api_url=*)           API_URL="${arg#*=}" ;;
    robot_id=*)          ROBOT_ID="${arg#*=}" ;;
    mqtt_robot_id=*)     MQTT_ROBOT_ID="${arg#*=}" ;;
    ngrok=true)          NGROK="true" ;;
    ngrok=false)         NGROK="false" ;;
    ngrok_token=*)       NGROK_TOKEN="${arg#*=}" ;;
    *) echo "[launch-external] Unknown argument: $arg" ; exit 1 ;;
  esac
done

export TERRA_API_URL="${TERRA_API_URL:-$API_URL}"
export USE_MQTT="$USE_MQTT"
export MQTT_HOST="$MQTT_HOST"
export MQTT_PORT="$MQTT_PORT"
export BRIDGE_PORT="$BRIDGE_PORT"
export ROBOT_ID="$ROBOT_ID"
export MQTT_ROBOT_ID="$MQTT_ROBOT_ID"

if [ -f "/opt/ros/jazzy/setup.bash" ]; then
  source "/opt/ros/jazzy/setup.bash"
fi
if [ -n "$FAUCON_SETUP" ] && [ -f "$FAUCON_SETUP" ]; then
  source "$FAUCON_SETUP"
fi

cd "$(dirname "$0")"

trap "echo '[launch-external] stopping bridge…'; kill ${PIDS[*]} 2>/dev/null" EXIT INT TERM

PIDS=()

uvicorn main:app --host 0.0.0.0 --port "$BRIDGE_PORT" &
PIDS+=("$!")

if [ "$NGROK" = "true" ]; then
  if ! command -v ngrok >/dev/null 2>&1; then
    echo "[launch-external] ngrok is not installed. Install it and rerun with ngrok=true."
    exit 1
  fi

  if [ -n "$NGROK_TOKEN" ]; then
    ngrok config add-authtoken "$NGROK_TOKEN" >/dev/null 2>&1 || true
  fi

  ngrok http "$BRIDGE_PORT" --log=stdout &
  PIDS+=("$!")
  echo "[launch-external] ngrok started (PID ${PIDS[-1]})"
  echo "[launch-external] Check ngrok dashboard at http://127.0.0.1:4040"
fi

echo "[launch-external] terra-bridge started (PID ${PIDS[0]})"
echo "[launch-external] API_URL=$TERRA_API_URL"
echo "[launch-external] USE_MQTT=$USE_MQTT"
echo "[launch-external] MQTT_HOST=$MQTT_HOST:$MQTT_PORT"
echo "[launch-external] BRIDGE_PORT=$BRIDGE_PORT"

echo "[launch-external] Use bridgeUrl=http://<public-ip>:$BRIDGE_PORT or the ngrok URL in terra-api/terra-web"

echo "[launch-external] If using ngrok, fetch the public URL from http://127.0.0.1:4040"

wait "${PIDS[@]}"
