#!/usr/bin/env bash
# Hourly demo reset: log in as the admin demo account, call POST /demo/reset.
#
#   API_URL=https://demo.example.com DEMO_ADMIN_PASSWORD=... ./reset-demo.sh
#
# Requires: curl. (No jq — token is extracted with a portable sed.)
set -euo pipefail

API_URL="${API_URL:-http://localhost:8080}"
ADMIN_EMAIL="${DEMO_ADMIN_EMAIL:-demo-admin@terraos.app}"
ADMIN_PASSWORD="${DEMO_ADMIN_PASSWORD:?set DEMO_ADMIN_PASSWORD}"

token=$(curl -fsS -X POST "$API_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

if [ -z "$token" ]; then
  echo "$(date -Is) login failed" >&2
  exit 1
fi

curl -fsS -X POST "$API_URL/api/v1/demo/reset" \
  -H "Authorization: Bearer $token"
echo "  $(date -Is) demo reset OK"
