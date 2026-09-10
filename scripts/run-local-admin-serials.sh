#!/usr/bin/env bash
#
# Local G7 serials: Postgres + migrate + wrangler :8787 + test-local-admin-serials.sh
# Leaves wrangler running. Does not touch live Neon or Erase admin.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
. "$ROOT/scripts/tooling-env.sh"

LOG="${CYVRA_WRANGLER_LOG:-/tmp/cyvra-wrangler.log}"
API="http://127.0.0.1:8787"
export API_URL="$API"
export ADMIN_API_TOKEN="${ADMIN_API_TOKEN:-local-admin-token-change-me}"

echo "[run] ensuring local Postgres (Neon stand-in on 127.0.0.1:5432)"
bash scripts/local-postgres.sh install
bash scripts/start.sh

api_up() {
  curl -fsS --max-time 2 "$API/health" >/dev/null 2>&1
}

# 401 "Admin token required" means the Worker loaded ADMIN_API_TOKEN.
# 503 "not configured" means wrangler started before start.sh appended the key.
admin_token_loaded() {
  local raw
  raw="$(curl -sS -w '\nHTTP:%{http_code}' --max-time 5 -X POST "$API/admin/serials" \
    -H 'content-type: application/json' \
    -d '{}' || true)"
  echo "$raw" | grep -q 'HTTP:401' && echo "$raw" | grep -q 'Admin token required'
}

listener_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:8787 -sTCP:LISTEN 2>/dev/null || true
    return
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser 8787/tcp 2>/dev/null || true
    return
  fi
}

stop_listener() {
  local pid
  for pid in $(listener_pids); do
    [ -n "$pid" ] || continue
    echo "[run] stopping :8787 pid $pid so wrangler reloads .dev.vars"
    kill "$pid" || true
  done
  local i
  for i in $(seq 1 20); do
    api_up || return 0
    sleep 0.3
  done
}

start_wrangler() {
  echo "[run] starting wrangler dev on $API (leave this process running)"
  pnpm --filter @cyvra/api dev >"$LOG" 2>&1 &
  echo "[run] wrangler log: $LOG"
  local ready=0
  local _
  for _ in $(seq 1 90); do
    if api_up; then
      ready=1
      break
    fi
    sleep 1
  done
  if [ "$ready" -ne 1 ]; then
    echo "[run] Worker did not become healthy on $API after 90s"
    tail -n 50 "$LOG" || true
    exit 1
  fi
}

if api_up; then
  echo "[run] Worker already healthy on $API"
  if admin_token_loaded; then
    echo "[run] ADMIN_API_TOKEN is loaded"
  else
    echo "[run] Worker is up but ADMIN_API_TOKEN is not loaded (503)."
    echo "[run] start.sh just appended the key to .dev.vars; wrangler must restart."
    stop_listener
    start_wrangler
  fi
else
  start_wrangler
fi

API_URL=http://127.0.0.1:8787 ADMIN_API_TOKEN="$ADMIN_API_TOKEN" \
  bash scripts/test-local-admin-serials.sh
