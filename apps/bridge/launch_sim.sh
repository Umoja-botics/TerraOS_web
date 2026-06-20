#!/usr/bin/env bash
# launch_sim.sh — Start terra-bridge in simulation mode (no ROS2 required)
#
# Usage:
#   ./launch_sim.sh
#   ./launch_sim.sh type=cart port=8201 robot_id=<uuid>
#   ./launch_sim.sh api_url=http://192.168.1.10:4000
#
# The sim robot UUID must match the robot registered in terra-api.

set -euo pipefail

SIM_ROBOT_ID="00000000-0000-0000-0000-000000000001"
ROBOT_TYPE="ugv"
API_URL="http://localhost:4000"
PORT=8200

# Parse CLI args
for arg in "$@"; do
  case "$arg" in
    api_url=*)  API_URL="${arg#api_url=}" ;;
    port=*)     PORT="${arg#port=}" ;;
    type=*)     ROBOT_TYPE="${arg#type=}" ;;
    robot_id=*) SIM_ROBOT_ID="${arg#robot_id=}" ;;
  esac
done

BRIDGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Activate venv if present
if [ -f "$BRIDGE_DIR/.venv/bin/activate" ]; then
  source "$BRIDGE_DIR/.venv/bin/activate"
else
  echo "[SIM] Warning: no .venv found — using system Python"
fi

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║         TerraOS — SIMULATION BRIDGE                 ║"
echo "╠══════════════════════════════════════════════════════╣"
printf "║  Type     : %-39s║\n" "$ROBOT_TYPE"
printf "║  Robot ID : %-39s║\n" "$SIM_ROBOT_ID"
printf "║  API URL  : %-39s║\n" "$API_URL"
printf "║  Port     : %-39s║\n" "$PORT"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  → Enable SIM MODE in TerraOS UI to see this robot"
echo "  → No ROS2 or MQTT needed"
echo ""

cd "$BRIDGE_DIR"

ROBOT_ID="$SIM_ROBOT_ID" \
ROBOT_TYPE="$ROBOT_TYPE" \
TERRA_API_URL="$API_URL" \
BRIDGE_PORT="$PORT" \
  uvicorn sim_bridge:app --host 0.0.0.0 --port "$PORT"
