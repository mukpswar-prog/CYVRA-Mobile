#!/usr/bin/env bash
#
# Prove the live Mobile API after wrangler deploy.
# Product host is api.cyvoriq.co.in. workers.dev is CI backup (1042 if disabled).
# Never prints secrets. Retries: custom domain TLS / workers.dev can lag.
set -euo pipefail

probe() {
  local url="$1"
  local want="$2"
  local body="$3"
  local code
  code="$(curl -sS -o "$body" -w "%{http_code}" --max-time 20 -A "cyvra-g7-prove/1" "$url" || true)"
  echo "[prove] $url HTTP $code"
  if [ -s "$body" ]; then
    head -c 240 "$body"
    echo
  fi
  [ "$code" = "$want" ]
}

try_base() {
  local base="$1"
  local i
  echo "[prove] trying $base"
  for i in $(seq 1 12); do
    if probe "$base/health" "200" /tmp/cyvra-health.body; then
      if grep -q '"status":"ok"' /tmp/cyvra-health.body \
        && grep -q 'cyvra-mobile-api' /tmp/cyvra-health.body; then
        probe "$base/admin/serials" "401" /tmp/cyvra-admin.body
        echo "[prove] PASS $base"
        return 0
      fi
      echo "[prove] health 200 but body is not cyvra-mobile-api"
    fi
    sleep 2
  done
  return 1
}

if try_base "https://api.cyvoriq.co.in"; then
  exit 0
fi
echo "[prove] api.cyvoriq.co.in not ready (bot challenge 403 from some IPs is possible)"
if try_base "https://cyvra-mobile-api.mukpswar.workers.dev"; then
  exit 0
fi
echo "[prove] FAIL. Worker deploy may still have succeeded; this check used the wrong host before."
echo "[prove] Live product URL is https://api.cyvoriq.co.in/health — not workers.dev."
exit 1
