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

# Seed gitignored local files from examples when missing. Never overwrite.
if [ ! -f services/api/.dev.vars ]; then
  cp services/api/.dev.vars.example services/api/.dev.vars
  echo "[start] created services/api/.dev.vars from example"
fi
if [ ! -f database/.env ]; then
  cp database/.env.example database/.env
  echo "[start] created database/.env from example (local Postgres)"
fi
if [ ! -f apps/web/.env ]; then
  cp apps/web/.env.example apps/web/.env
  echo "[start] created apps/web/.env from example"
fi

echo "[start] done"
