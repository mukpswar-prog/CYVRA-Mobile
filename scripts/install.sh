#!/usr/bin/env bash
#
# Idempotent dependency refresh for the CYVRA Mobile monorepo.
# Runs after checkout. Safe to run repeatedly.
set -euo pipefail
cd "$(dirname "$0")/.."

# System dependency: local Postgres server (stands in for Neon in dev).
bash scripts/local-postgres.sh install

# JS/TS workspace dependencies.
pnpm install --frozen-lockfile

echo "[install] done"
