#!/usr/bin/env bash
#
# After Neon 0004 is applied: unlock wrangler, put ADMIN_API_TOKEN, deploy G7.
# Never prints secrets. Never git-adds .env.
#
# You will see TWO blank prompts. That is normal (hidden paste, no echo).
#   1) Cloudflare user token named cyvra-mobile  (unlocks wrangler)
#   2) A NEW random string you invent             (ADMIN_API_TOKEN ops secret)
# Do not paste the same value twice. Do not paste an erase token.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
. "$ROOT/scripts/tooling-env.sh"

export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-5a3eeb2b3d42726a8ba08732464a0eda}"

is_placeholder() {
  case "${1:-}" in
    ""|"..."|"…"|"xxx"|"TODO"|"changeme"|"your-token"|"<token>"|"<TOKEN>"|"paste-here")
      return 0
      ;;
  esac
  if [[ "${1:-}" == *" "* ]] || [[ "${1:-}" == Bearer* ]] || [[ "${1:-}" == bearer* ]]; then
    return 0
  fi
  if [ "${#1}" -lt 20 ]; then
    return 0
  fi
  return 1
}

echo "[g7] Neon 0004 should already be applied (mobile_serials)."
echo "[g7] This script does NOT migrate. If migrate is not done: bash scripts/migrate-neon.sh"
echo

if is_placeholder "${CLOUDFLARE_API_TOKEN:-}"; then
  echo "[g7] Prompt 1/2 — Cloudflare user token named cyvra-mobile"
  echo "[g7] Dashboard: https://dash.cloudflare.com/profile/api-tokens"
  echo "[g7] Paste once, then Enter. The cursor will not move. That is hiding the secret."
  unset CLOUDFLARE_API_TOKEN
  read -r -s CLOUDFLARE_API_TOKEN
  echo
  export CLOUDFLARE_API_TOKEN
fi

if is_placeholder "${CLOUDFLARE_API_TOKEN:-}"; then
  echo "[g7] CLOUDFLARE_API_TOKEN is still empty or a placeholder." >&2
  echo "[g7] Do not type the three dots from the docs. Paste the real token." >&2
  exit 1
fi

echo "[g7] wrangler whoami (proves the token unlocks this account)"
if ! pnpm --filter @cyvra/api exec wrangler whoami; then
  echo "[g7] Token was rejected (9109 / 10000)." >&2
  echo "[g7] Use the token named cyvra-mobile. Do not use cyvra-erase-* tokens." >&2
  echo "[g7] Then: unset CLOUDFLARE_API_TOKEN && bash scripts/live-g7-deploy.sh" >&2
  exit 1
fi

echo
echo "[g7] Prompt 2/2 — invent ADMIN_API_TOKEN (NOT the Cloudflare token)"
echo "[g7] Create a long random string. Store it in a password manager."
echo "[g7] Paste once, then Enter. Cursor will not move."
unset ADMIN_API_TOKEN
read -r -s ADMIN_API_TOKEN
echo
if is_placeholder "${ADMIN_API_TOKEN:-}"; then
  echo "[g7] ADMIN_API_TOKEN was empty. Invent a long random string." >&2
  exit 1
fi
if [ "$ADMIN_API_TOKEN" = "$CLOUDFLARE_API_TOKEN" ]; then
  echo "[g7] That was the same as the Cloudflare token. They must be different." >&2
  exit 1
fi

echo "[g7] putting ADMIN_API_TOKEN on Worker cyvra-mobile-api (value not printed)"
printf '%s' "$ADMIN_API_TOKEN" | pnpm --filter @cyvra/api exec wrangler secret put ADMIN_API_TOKEN
unset ADMIN_API_TOKEN

echo "[g7] deploying preview Worker (API_ENV=preview)"
bash scripts/deploy-api-preview.sh

echo
echo "[g7] prove live /admin/serials is 401 (not 404/503/500)"
CODE="$(curl -sS -o /tmp/cyvra-g7-live.body -w "%{http_code}" --max-time 20 \
  https://cyvra-mobile-api.mukpswar.workers.dev/admin/serials || true)"
echo "[g7] HTTP $CODE"
head -c 300 /tmp/cyvra-g7-live.body 2>/dev/null || true
echo
rm -f /tmp/cyvra-g7-live.body
case "$CODE" in
  401)
    echo "[g7] PASS. G7 is live on workers.dev. Unauth is 401."
    echo "[g7] Next: Cloudflare → Worker cyvra-mobile-api → Custom domain api.cyvoriq.co.in"
    ;;
  404)
    echo "[g7] still 404 — deploy did not ship /admin/serials. Paste the wrangler deploy output." >&2
    exit 1
    ;;
  503)
    echo "[g7] 503 — ADMIN_API_TOKEN is not on this Worker. Re-run this script." >&2
    exit 1
    ;;
  500)
    echo "[g7] 500 — Neon likely missing mobile_serials. Re-run bash scripts/migrate-neon.sh" >&2
    exit 1
    ;;
  *)
    echo "[g7] unexpected HTTP $CODE. Paste this block (no secrets)." >&2
    exit 1
    ;;
esac
