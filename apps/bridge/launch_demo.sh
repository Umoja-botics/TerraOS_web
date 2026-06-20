#!/usr/bin/env bash
# launch_demo.sh — start the 3 demo simulators + scenario player locally (no Docker).
#
#   ./launch_demo.sh
#   TERRA_API_URL=http://localhost:4000 ./launch_demo.sh
#
# Robot IDs must match the demo fleet seeded by terra-api (DEMO_MODE=true).
# Ctrl+C stops everything.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

API_URL="${TERRA_API_URL:-http://localhost:4000}"
export TERRA_API_URL="$API_URL"
export SIM_AUTO_HEALTH=false                       # quiet faults during the demo
export SIM_UGV_URL=http://localhost:8200
export SIM_CART_URL=http://localhost:8201
export SIM_DRONE_URL=http://localhost:8202

# Activate a venv if present (else use system python)
[ -f .venv/bin/activate ] && source .venv/bin/activate

PIDS=()
run() { "$@" & PIDS+=($!); }

echo "→ sim-ugv   :8200   → sim-cart  :8201   → sim-drone :8202   → player :8300"
echo "  API = $API_URL"

ROBOT_TYPE=ugv   ROBOT_ID=00000000-0000-0000-0000-000000000001 BRIDGE_PORT=8200 \
  run uvicorn sim_bridge:app --host 0.0.0.0 --port 8200
ROBOT_TYPE=cart  ROBOT_ID=00000000-0000-0000-0000-000000000004 BRIDGE_PORT=8201 \
  run uvicorn sim_bridge:app --host 0.0.0.0 --port 8201
ROBOT_TYPE=drone ROBOT_ID=00000000-0000-0000-0000-000000000005 BRIDGE_PORT=8202 \
  run uvicorn sim_bridge:app --host 0.0.0.0 --port 8202
SCENARIO_FILE=scenarios/demo_agri.yaml PLAYER_PORT=8300 \
  run uvicorn scenario_player:app --host 0.0.0.0 --port 8300

trap 'echo; echo "stopping…"; kill ${PIDS[*]} 2>/dev/null || true' EXIT INT TERM
wait
