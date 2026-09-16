#!/usr/bin/env bash
#
# Build apps/web and Direct-Upload to Pages project cyvoriq-admin.
# Never target cyvra-www, admin.cyvra.co.in, or overwrite cyvoriq-www.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
. "$ROOT/scripts/tooling-env.sh"

export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-5a3eeb2b3d42726a8ba08732464a0eda}"
PAGES_NAME="cyvoriq-admin"
VITE_API_URL="${VITE_API_URL:-https://api.cyvoriq.co.in}"

token="${CLOUDFLARE_API_TOKEN:-}"
placeholder=0
case "$token" in
  ""|"..."|"…"|"xxx"|"TODO"|"changeme"|"your-token"|"<token>"|"<TOKEN>"|"paste-here")
    placeholder=1
    ;;
esac
if [[ "$token" == *" "* ]] || [[ "$token" == Bearer* ]] || [[ "$token" == bearer* ]]; then
  echo "[admin] CLOUDFLARE_API_TOKEN has spaces or a Bearer prefix."
  exit 1
fi
if [ "$placeholder" -eq 1 ] || [ "${#token}" -lt 20 ]; then
  echo "[admin] CLOUDFLARE_API_TOKEN is missing. Dashboard: docs/admin-cyvoriq-start.txt"
  exit 1
fi
if [[ "$PAGES_NAME" != "cyvoriq-admin" ]]; then
  echo "[admin] refusing unexpected project name: $PAGES_NAME"
  exit 1
fi

export VITE_API_URL
pnpm --filter @cyvra/web build
(
  cd services/api
  pnpm exec wrangler pages project create "$PAGES_NAME" --production-branch=main || true
  pnpm exec wrangler pages deploy ../../apps/web/dist \
    --project-name="$PAGES_NAME" \
    --commit-dirty=true
)
echo "[admin] next: Pages → cyvoriq-admin → Custom domain admin.cyvoriq.co.in"
