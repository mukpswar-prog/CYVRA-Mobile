#!/usr/bin/env bash
# Local G2 auth slice check against wrangler dev (:8787). No cloud, no secrets.
set -euo pipefail
API="${API_URL:-http://localhost:8787}"

echo "[test] GET $API/health"
HEALTH="$(curl -fsS "$API/health")"
echo "$HEALTH"
HEALTH="$HEALTH" python3 - << 'PY'
import json, os
h = json.loads(os.environ["HEALTH"])
assert h.get("status") == "ok", h
assert h.get("service") == "cyvra-mobile-api", h
assert h.get("database") == "connected", h
print("[test] health ok")
PY

echo "[test] CORS preflight from a Pages preview origin"
PREFLIGHT="$(curl -sS -D - -o /dev/null -X OPTIONS "$API/auth/request" \
  -H "Origin: https://g0-g3-preview.cyvra-mobile.pages.dev" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,authorization")"
echo "$PREFLIGHT"
echo "$PREFLIGHT" | grep -qi "access-control-allow-origin: https://g0-g3-preview.cyvra-mobile.pages.dev"
echo "[test] CORS allowlist ok"

EMAIL="preview-tester@resend.dev"
echo "[test] POST /auth/request"
REQ="$(curl -fsS -X POST "$API/auth/request" \
  -H "content-type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d "{\"email\":\"$EMAIL\"}")"
echo "$REQ"
REQ="$REQ" python3 - << 'PY'
import json, os
d = json.loads(os.environ["REQ"])
assert d.get("delivery") == "dev-log", d
assert d.get("challengeId"), d
assert d.get("devCode") and len(d["devCode"]) == 6, d
open("/tmp/cyvra-otp.txt","w").write(d["devCode"] + "\n" + d["challengeId"])
print("[test] request otp ok")
PY
CODE="$(sed -n '1p' /tmp/cyvra-otp.txt)"
CHALLENGE="$(sed -n '2p' /tmp/cyvra-otp.txt)"

echo "[test] POST /auth/verify"
VERIFY="$(curl -fsS -X POST "$API/auth/verify" \
  -H "content-type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d "{\"challengeId\":\"$CHALLENGE\",\"code\":\"$CODE\"}")"
echo "$VERIFY"
VERIFY="$VERIFY" EMAIL="$EMAIL" python3 - << 'PY'
import json, os
d = json.loads(os.environ["VERIFY"])
assert d["user"]["email"] == os.environ["EMAIL"], d
assert d.get("token"), d
open("/tmp/cyvra-token.txt","w").write(d["token"])
print("[test] verify ok, token length", len(d["token"]))
PY
TOKEN="$(cat /tmp/cyvra-token.txt)"

echo "[test] GET /me with Authorization Bearer"
ME="$(curl -fsS "$API/me" -H "Authorization: Bearer $TOKEN")"
echo "$ME"
ME="$ME" EMAIL="$EMAIL" python3 - << 'PY'
import json, os
d = json.loads(os.environ["ME"])
assert d["user"]["email"] == os.environ["EMAIL"], d
print("[test] bearer session ok")
PY

echo "[test] POST /auth/logout"
curl -fsS -X POST "$API/auth/logout" -H "Authorization: Bearer $TOKEN" >/dev/null
ME2="$(curl -fsS "$API/me" -H "Authorization: Bearer $TOKEN")"
ME2="$ME2" python3 - << 'PY'
import json, os
d = json.loads(os.environ["ME2"])
assert d.get("user") is None, d
print("[test] logout ok")
PY

rm -f /tmp/cyvra-otp.txt /tmp/cyvra-token.txt
echo "[test] local G2 auth slice passed"
