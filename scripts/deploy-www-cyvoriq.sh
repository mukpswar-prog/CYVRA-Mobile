#!/usr/bin/env bash
#
# Build apps/web and Direct-Upload to Pages project cyvoriq-www.
# Never target cyvra-www (Erase) or cyvra-mobile (preview).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
. "$ROOT/scripts/tooling-env.sh"

export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-5a3eeb2b3d42726a8ba08732464a0eda}"
PAGES_NAME="cyvoriq-www"
VITE_API_URL="${VITE_API_URL:-https://api.cyvoriq.co.in}"

token="${CLOUDFLARE_API_TOKEN:-}"
placeholder=0
case "$token" in
  ""|"..."|"…"|"xxx"|"TODO"|"changeme"|"your-token"|"<token>"|"<TOKEN>"|"paste-here")
    placeholder=1
    ;;
esac
if [[ "$token" == *" "* ]] || [[ "$token" == Bearer* ]] || [[ "$token" == bearer* ]]; then
  echo "[www] CLOUDFLARE_API_TOKEN has spaces or a Bearer prefix."
  echo "[www] Export the raw token only. Do not paste it into chat."
  exit 1
fi
if [ "$placeholder" -eq 1 ] || [ "${#token}" -lt 20 ]; then
  echo "[www] CLOUDFLARE_API_TOKEN is missing or is a placeholder."
  echo "[www] Dashboard path (no token): docs/www-cyvoriq-start.txt"
  echo "[www] Or: read -r -s CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN"
  echo "[www] Token needs Account Cloudflare Pages Edit (cyvoriq-mobile)."
  exit 1
fi

if [[ "$PAGES_NAME" != "cyvoriq-www" ]]; then
  echo "[www] refusing unexpected project name: $PAGES_NAME"
  exit 1
fi

echo "[www] account $CLOUDFLARE_ACCOUNT_ID project $PAGES_NAME"
echo "[www] VITE_API_URL=$VITE_API_URL"
echo "[www] whoami"
pnpm --filter @cyvra/api exec wrangler whoami

export VITE_API_URL
pnpm --filter @cyvra/web build

# wrangler lives in services/api — do not add it to the web package just for deploy.
(
  cd services/api
  pnpm exec wrangler pages project create "$PAGES_NAME" --production-branch=main || true
  pnpm exec wrangler pages deploy ../../apps/web/dist \
    --project-name="$PAGES_NAME" \
    --commit-dirty=true
)

echo "[www] next (dashboard): Pages → cyvoriq-www → Custom domains"
echo "[www]   www.cyvoriq.co.in  and  cyvoriq.co.in"
echo "[www] do not attach these hosts to Worker cyvra-mobile-api"
