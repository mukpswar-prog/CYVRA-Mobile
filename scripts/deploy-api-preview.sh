#!/usr/bin/env bash
#
# Deploy Worker cyvra-mobile-api with API_ENV=preview.
# Codespaces cannot complete `wrangler login` OAuth (callback is
# http://localhost:8976 on the codespace, not your laptop). Use an API token.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
. "$ROOT/scripts/tooling-env.sh"

export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-5a3eeb2b3d42726a8ba08732464a0eda}"
# shellcheck disable=SC1091
. "$ROOT/scripts/sanitize-cf-token.sh"

echo "[deploy] Cloudflare account $CLOUDFLARE_ACCOUNT_ID"
echo "[deploy] whoami"
pnpm --filter @cyvra/api exec wrangler whoami

echo "[deploy] cyvra-mobile-api with API_ENV=preview and APP_ORIGIN=pages.dev"
echo "[deploy] (wrangler.jsonc localhost vars must not overwrite production)"
pnpm --filter @cyvra/api exec wrangler deploy \
  --var API_ENV:preview \
  --var APP_ORIGIN:https://cyvra-mobile.pages.dev

echo "[deploy] health"
curl -sS https://cyvra-mobile-api.mukpswar.workers.dev/health
echo
