#!/usr/bin/env bash
#
# POST one S1 planned-batch JSON to the Mobile API.
# Default: local wrangler :8787 only.
# Live: API_URL=https://api.cyvoriq.co.in --live  (customer session, not ADMIN_API_TOKEN).
# Never prints the session token. USB copy of the JSON is not device authorization.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="$ROOT/scripts/python"

LIVE=0
FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --live) LIVE=1; shift ;;
    -*) echo "[g5] unknown flag $1"; exit 1 ;;
    *) FILE="$1"; shift ;;
  esac
done

if [ -z "$FILE" ]; then
  echo "usage: bash scripts/post-g5-batch.sh [--live] /path/to/cyvra-g5-batch.json"
  echo "local:  CYVRA_SESSION_TOKEN=… bash scripts/post-g5-batch.sh ./batch.json"
  echo "live:   API_URL=https://api.cyvoriq.co.in CYVRA_SESSION_TOKEN=… \\"
  echo "          bash scripts/post-g5-batch.sh --live ./batch.json"
  exit 1
fi

API="${API_URL:-http://127.0.0.1:8787}"
TOKEN="${CYVRA_SESSION_TOKEN:-}"

if [ ! -f "$FILE" ]; then
  echo "[g5] missing file $FILE"
  exit 1
fi

if [ -z "$TOKEN" ]; then
  echo "[g5] CYVRA_SESSION_TOKEN is empty."
  echo "[g5] Sign in at https://www.cyvoriq.co.in/create-account (preview may show an on-screen code)."
  echo "[g5] Then copy the customer session token from the browser. Not ADMIN_API_TOKEN."
  echo "[g5] Do not paste the token into chat."
  exit 1
fi

case "$TOKEN" in
  *" "*|Bearer*|bearer*)
    echo "[g5] token has spaces or a Bearer prefix. Export the raw customer session only."
    exit 1
    ;;
esac

if [ "$LIVE" -eq 1 ]; then
  case "$API" in
    https://api.cyvoriq.co.in|https://api.cyvoriq.co.in/) ;;
    *)
      echo "[g5] --live requires API_URL=https://api.cyvoriq.co.in"
      exit 1
      ;;
  esac
else
  case "$API" in
    http://127.0.0.1:*|http://localhost:*|http://[::1]:*) ;;
    *)
      echo "[g5] refusing non-local API $API without --live"
      exit 1
      ;;
  esac
fi

ORIGIN="http://localhost:5173"
if [ "$LIVE" -eq 1 ]; then
  ORIGIN="https://www.cyvoriq.co.in"
fi

echo "[g5] POST $API/evidence/batches (token not printed)"
RESP="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/evidence/batches" \
  -H "content-type: application/json" \
  -H "Origin: $ORIGIN" \
  -H "Authorization: Bearer $TOKEN" \
  --data-binary @"$FILE")"
echo "$RESP" | "$PY" - << 'PY'
import os, sys
raw = sys.stdin.read()
body, _, status = raw.rpartition("\nHTTP:")
print("[g5] HTTP", status.strip())
print(body[:800])
if status.strip() != "200":
    sys.exit(1)
PY
