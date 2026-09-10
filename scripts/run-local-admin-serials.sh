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

if api_up; then
  echo "[run] Worker already healthy on $API"
else
  echo "[run] starting wrangler dev on $API (leave this process running)"
  pnpm --filter @cyvra/api dev >"$LOG" 2>&1 &
  echo "[run] wrangler log: $LOG"
  ready=0
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
fi

API_URL=http://127.0.0.1:8787 ADMIN_API_TOKEN="$ADMIN_API_TOKEN" \
  bash scripts/test-local-admin-serials.sh
