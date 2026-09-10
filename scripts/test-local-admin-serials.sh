#!/usr/bin/env bash
# Local G7 admin serials against wrangler dev (:8787). No Erase frontend, no cloud.
set -euo pipefail
API="${API_URL:-http://127.0.0.1:8787}"
PY="$(cd "$(dirname "$0")" && pwd)/python"
ADMIN_TOKEN="${ADMIN_API_TOKEN:-local-admin-token-change-me}"
ADMIN_EMAIL="ceo@cyvoriq.com"

case "$API" in
  http://127.0.0.1:*|http://localhost:*|http://[::1]:*) ;;
  *)
    echo "[test] refusing non-local API $API"
    exit 1
    ;;
esac

echo "[test] GET $API/health"
if ! HEALTH="$(curl -fsS --max-time 5 "$API/health")"; then
  echo "[test] cannot reach $API. Codespaces: bash scripts/run-local-admin-serials.sh"
  exit 1
fi
echo "$HEALTH"
HEALTH="$HEALTH" "$PY" - << 'PY'
import json, os
h = json.loads(os.environ["HEALTH"])
assert h.get("status") == "ok", h
assert h.get("database") == "connected", h
print("[test] health ok")
PY

echo "[test] POST /admin/serials without token is 401"
UNAUTH="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/admin/serials" \
  -H "content-type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d '{"customerEmail":"buyer@example.com","paymentNoted":"transferred"}')"
echo "$UNAUTH"
if echo "$UNAUTH" | grep -q "ADMIN_API_TOKEN is not configured"; then
  echo "[test] wrangler is running without ADMIN_API_TOKEN in its process."
  echo "[test] start.sh may have appended the key after wrangler started."
  echo "[test] Fix: bash scripts/run-local-admin-serials.sh"
  echo "[test] (that script restarts the :8787 pid so .dev.vars reloads)"
  exit 1
fi
echo "$UNAUTH" | grep -q "HTTP:401"
echo "$UNAUTH" | grep -q "Admin token required"

echo "[test] POST /admin/serials with wrong email is 401"
WRONG="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/admin/serials" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Admin-Email: not-the-super-admin@example.com" \
  -H "Origin: https://admin.cyvra.co.in" \
  -d '{"customerEmail":"buyer@example.com","paymentNoted":"UPI transferred 2026-09-10"}')"
echo "$WRONG"
echo "$WRONG" | grep -q "HTTP:401"

echo "[test] POST /admin/serials creates PENDING"
CREATE="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/admin/serials" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Admin-Email: $ADMIN_EMAIL" \
  -H "Origin: https://admin.cyvra.co.in" \
  -d '{"customerEmail":"Buyer@Example.com","paymentNoted":"UPI transferred 2026-09-10"}')"
echo "$CREATE"
CREATE="$CREATE" "$PY" - << 'PY'
import json, os, re
raw = os.environ["CREATE"]
body, _, status = raw.rpartition("\nHTTP:")
d = json.loads(body)
assert status.strip() == "201", raw
s = d["serial"]
assert s["status"] == "PENDING", s
assert s["customerEmail"] == "buyer@example.com", s
assert s["issuedAt"] is None, s
assert re.match(r"^CYVRA-M-\d{4}-[0-9A-F]{8}$", s["publicNumber"]), s
open("/tmp/cyvra-g7-serial.json","w").write(json.dumps(s))
print("[test] create PENDING", s["publicNumber"])
PY

SERIAL_ID="$("$PY" - << 'PY'
import json
print(json.load(open("/tmp/cyvra-g7-serial.json"))["serialId"])
PY
)"

echo "[test] POST /admin/serials/$SERIAL_ID/issue"
ISSUE="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/admin/serials/$SERIAL_ID/issue" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Admin-Email: $ADMIN_EMAIL" \
  -H "Origin: https://admin.cyvra.co.in")"
echo "$ISSUE"
ISSUE="$ISSUE" "$PY" - << 'PY'
import json, os
raw = os.environ["ISSUE"]
body, _, status = raw.rpartition("\nHTTP:")
d = json.loads(body)
assert status.strip() == "200", raw
assert d["replayed"] is False, d
assert d["serial"]["status"] == "ISSUED", d
assert d["serial"]["issuedAt"], d
assert d["serial"]["issuedBy"] == "ceo@cyvoriq.com", d
open("/tmp/cyvra-g7-issued.json","w").write(json.dumps(d["serial"]))
print("[test] issued", d["serial"]["issuedAt"])
PY

echo "[test] replay issue keeps issuedAt"
REPLAY="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/admin/serials/$SERIAL_ID/issue" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Admin-Email: $ADMIN_EMAIL" \
  -H "Origin: https://admin.cyvra.co.in")"
echo "$REPLAY"
REPLAY="$REPLAY" "$PY" - << 'PY'
import json, os
raw = os.environ["REPLAY"]
body, _, status = raw.rpartition("\nHTTP:")
d = json.loads(body)
first = json.load(open("/tmp/cyvra-g7-issued.json"))
assert status.strip() == "200", raw
assert d["replayed"] is True, d
assert d["serial"]["issuedAt"] == first["issuedAt"], (d["serial"]["issuedAt"], first["issuedAt"])
print("[test] issue replay keeps issuedAt")
PY

echo "[test] GET /admin/serials lists the issued serial"
LIST="$(curl -fsS "$API/admin/serials" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Admin-Email: $ADMIN_EMAIL" \
  -H "Origin: https://admin.cyvra.co.in")"
LIST="$LIST" SERIAL_ID="$SERIAL_ID" "$PY" - << 'PY'
import json, os
d = json.loads(os.environ["LIST"])
sid = os.environ["SERIAL_ID"]
assert d["superAdmin"] == "ceo@cyvoriq.com", d
assert any(row["serialId"] == sid and row["status"] == "ISSUED" for row in d["serials"]), d
print("[test] list ok")
PY

echo "[test] POST revoke"
REVOKE="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/admin/serials/$SERIAL_ID/revoke" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Admin-Email: $ADMIN_EMAIL" \
  -H "Origin: https://admin.cyvra.co.in")"
echo "$REVOKE"
echo "$REVOKE" | grep -q "HTTP:200"
echo "$REVOKE" | grep -q '"REVOKED"'

rm -f /tmp/cyvra-g7-serial.json /tmp/cyvra-g7-issued.json
echo "[test] local G7 admin serials passed"
