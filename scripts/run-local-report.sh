#!/usr/bin/env bash
#
# Codespaces / fresh machine path for G6 local Report 1 freeze.
# Starts local Postgres (Neon stand-in), applies migrations, starts wrangler
# on :8787 if it is down, then runs scripts/test-local-report.sh.
# Leaves wrangler running. Does not touch live Neon or the production Worker.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
. "$ROOT/scripts/tooling-env.sh"

LOG="${CYVRA_WRANGLER_LOG:-/tmp/cyvra-wrangler.log}"
API="http://127.0.0.1:8787"
export API_URL="$API"

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
    echo "[run] last wrangler log:"
    tail -n 50 "$LOG" || true
    exit 1
  fi
fi

API_URL=http://127.0.0.1:8787 bash scripts/test-local-report.sh
