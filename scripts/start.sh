#!/usr/bin/env bash
#
# Per-boot runtime reconciliation: bring up local Postgres, apply migrations,
# and ensure the Worker's local dev vars exist. Idempotent and returns.
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/local-postgres.sh start

export DATABASE_URL="postgres://cyvra:cyvra@127.0.0.1:5432/cyvra_mobile"
export DATABASE_URL_DIRECT="$DATABASE_URL"

echo "[start] applying database migrations"
pnpm --filter @cyvra/database migrate

# Seed local Worker dev vars from the example if not already present.
if [ ! -f services/api/.dev.vars ]; then
  cp services/api/.dev.vars.example services/api/.dev.vars
  echo "[start] created services/api/.dev.vars from example"
fi

echo "[start] done"
