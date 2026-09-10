#!/usr/bin/env bash
#
# Attach api.cyvoriq.co.in to existing Worker cyvra-mobile-api and prove it.
# Does not touch cyvra.co.in. Does not create a second Worker.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
. "$ROOT/scripts/tooling-env.sh"

export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-5a3eeb2b3d42726a8ba08732464a0eda}"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "[api] CLOUDFLARE_API_TOKEN is unset."
  echo "[api] Paste cyvoriq-mobile (same token as live-g7-deploy). Cursor will not move."
  read -r -s CLOUDFLARE_API_TOKEN
  echo
  export CLOUDFLARE_API_TOKEN
fi

echo "[api] deploying Worker with custom domain api.cyvoriq.co.in"
bash scripts/deploy-api-preview.sh

probe() {
  local url="$1"
  local want="$2"
  local code=""
  local i=0
  while [ "$i" -lt 15 ]; do
    code="$(curl -sS -o /tmp/cyvra-api-probe.body -w "%{http_code}" --max-time 25 "$url" || true)"
    echo "[api] $url  try $((i + 1))/15  HTTP ${code:-000}"
    if [ "$code" = "$want" ]; then
      head -c 240 /tmp/cyvra-api-probe.body 2>/dev/null || true
      echo
      return 0
    fi
    i=$((i + 1))
    sleep 3
  done
  echo "[api] last body:"
  head -c 300 /tmp/cyvra-api-probe.body 2>/dev/null || true
  echo
  rm -f /tmp/cyvra-api-probe.body
  return 1
}

echo "[api] prove workers.dev still works"
probe "https://cyvra-mobile-api.mukpswar.workers.dev/health" "200"
probe "https://cyvra-mobile-api.mukpswar.workers.dev/admin/serials" "401"

echo "[api] prove api.cyvoriq.co.in (DNS + TLS can take a minute)"
if ! probe "https://api.cyvoriq.co.in/health" "200"; then
  echo "[api] health on api.cyvoriq.co.in not 200 yet." >&2
  echo "[api] Cloudflare → Workers → cyvra-mobile-api → Domains should list api.cyvoriq.co.in" >&2
  echo "[api] Do not add that name on cyvra.co.in or on Erase Workers." >&2
  exit 1
fi
probe "https://api.cyvoriq.co.in/admin/serials" "401"

rm -f /tmp/cyvra-api-probe.body
echo "[api] PASS. api.cyvoriq.co.in is the Mobile API hostname."
echo "[api] workers.dev kept as preview. Erase api.cyvra.co.in was not touched."
echo "[api] Next: Resend domain cyvoriq.co.in, then new Pages www/admin/accounts."
