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
assert "mailConfigured" in h, h
print("[test] health ok")
PY

echo "$HEALTH" | grep -q "cyvra-mobile-api"

echo "[test] CORS allows https://admin.cyvoriq.co.in"
CORS="$(curl -sS -D - -o /dev/null --max-time 5 -X OPTIONS "$API/admin/serials" \
  -H "Origin: https://admin.cyvoriq.co.in" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,authorization,x-admin-email")"
echo "$CORS" | grep -qi "access-control-allow-origin: https://admin.cyvoriq.co.in"

echo "[test] CORS denies https://www.cyvra.co.in"
DENY="$(curl -sS -D - -o /dev/null --max-time 5 -X OPTIONS "$API/admin/serials" \
  -H "Origin: https://www.cyvra.co.in" \
  -H "Access-Control-Request-Method: POST")"
if echo "$DENY" | grep -qi "access-control-allow-origin: https://www.cyvra.co.in"; then
  echo "[test] Erase www must not be allowlisted"
  exit 1
fi

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
  -H "Origin: https://admin.cyvoriq.co.in" \
  -d '{"customerEmail":"buyer@example.com","paymentNoted":"UPI transferred 2026-09-10"}')"
echo "$WRONG"
echo "$WRONG" | grep -q "HTTP:401"

echo "[test] POST /admin/auth/request rejects gmail"
GMAIL="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/admin/auth/request" \
  -H "content-type: application/json" \
  -H "Origin: https://admin.cyvoriq.co.in" \
  -d '{"email":"user@gmail.com"}')"
echo "$GMAIL"
echo "$GMAIL" | grep -q "HTTP:403"

echo "[test] POST /admin/auth/request rejects unnominated @cyvoriq.com"
UNNOM="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/admin/auth/request" \
  -H "content-type: application/json" \
  -H "Origin: https://admin.cyvoriq.co.in" \
  -d '{"email":"nobody@cyvoriq.com"}')"
echo "$UNNOM"
echo "$UNNOM" | grep -q "HTTP:403"

echo "[test] POST /admin/auth/request emails ceo@cyvoriq.com (preview code locally)"
STAFF_REQ="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/admin/auth/request" \
  -H "content-type: application/json" \
  -H "Origin: https://admin.cyvoriq.co.in" \
  -d "{\"email\":\"$ADMIN_EMAIL\"}")"
echo "$STAFF_REQ"
STAFF_REQ="$STAFF_REQ" "$PY" - << 'PY'
import json, os
raw = os.environ["STAFF_REQ"]
body, _, status = raw.rpartition("\nHTTP:")
d = json.loads(body)
assert status.strip() == "200", raw
assert d.get("challengeId"), d
assert d.get("devCode") and len(d["devCode"]) == 6, d
assert d.get("mailError"), d
assert d.get("mailConfigured") is False, d
open("/tmp/cyvra-staff-otp.json","w").write(json.dumps(d))
print("[test] staff otp challenge", d["challengeId"])
PY

echo "[test] POST /admin/auth/verify"
STAFF_CH="$( "$PY" - << 'PY'
import json
print(json.load(open("/tmp/cyvra-staff-otp.json"))["challengeId"])
PY
)"
STAFF_CODE="$( "$PY" - << 'PY'
import json
print(json.load(open("/tmp/cyvra-staff-otp.json"))["devCode"])
PY
)"
STAFF_VERIFY="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/admin/auth/verify" \
  -H "content-type: application/json" \
  -H "Origin: https://admin.cyvoriq.co.in" \
  -d "{\"challengeId\":\"$STAFF_CH\",\"code\":\"$STAFF_CODE\"}")"
echo "$STAFF_VERIFY"
STAFF_VERIFY="$STAFF_VERIFY" "$PY" - << 'PY'
import json, os
raw = os.environ["STAFF_VERIFY"]
body, _, status = raw.rpartition("\nHTTP:")
d = json.loads(body)
assert status.strip() == "200", raw
assert d["operator"]["email"] == "ceo@cyvoriq.com", d
assert d["operator"]["superAdmin"] is True, d
assert d.get("token"), d
open("/tmp/cyvra-staff-session.json","w").write(json.dumps(d))
print("[test] staff session for", d["operator"]["email"])
PY

echo "[test] POST /admin/serials creates PENDING with parseable key"
CREATE="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/admin/serials" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Admin-Email: $ADMIN_EMAIL" \
  -H "Origin: https://admin.cyvoriq.co.in" \
  -d '{"customerEmail":"Buyer@Example.com","paymentNoted":"UPI transferred 2026-09-10","customerKind":"SINGLE","deviceMax":5,"brandScope":"SAMSUNG","customerFullName":"Test Buyer","companyName":"Example ITAD","addressLine1":"1 Test Street","pincode":"400001","state":"Maharashtra"}')"
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
assert s["customerKind"] == "SINGLE", s
assert s["deviceMax"] == 5, s
assert s["slabLabel"] == "1-5", s
assert s["brandScope"] == "SAMSUNG", s
assert s["licenceKey"] == s["publicNumber"], s
assert re.match(r"^CYVRA\d{8}S[0-9A-F]{4}-1-5$", s["publicNumber"]), s
open("/tmp/cyvra-g7-serial.json","w").write(json.dumps(s))
print("[test] create PENDING", s["publicNumber"])
PY

echo "[test] POST /admin/serials 1-device single-user key"
ONE="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/admin/serials" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Admin-Email: $ADMIN_EMAIL" \
  -H "Origin: https://admin.cyvoriq.co.in" \
  -d '{"customerEmail":"one@example.com","paymentNoted":"UPI transferred 2026-09-11","customerKind":"SINGLE","deviceMax":1,"brandScope":"SAMSUNG","customerFullName":"One Device Buyer"}')"
echo "$ONE"
ONE="$ONE" "$PY" - << 'PY'
import json, os, re
raw = os.environ["ONE"]
body, _, status = raw.rpartition("\nHTTP:")
d = json.loads(body)
assert status.strip() == "201", raw
s = d["serial"]
assert s["customerKind"] == "SINGLE", s
assert s["deviceMax"] == 1, s
assert s["slabLabel"] == "1-1", s
assert re.match(r"^CYVRA\d{8}S[0-9A-F]{4}-1-1$", s["publicNumber"]), s
print("[test] create 1-device", s["publicNumber"])
PY

echo "[test] POST /admin/serials rejects bulk 1-device"
BULK1="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/admin/serials" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Admin-Email: $ADMIN_EMAIL" \
  -H "Origin: https://admin.cyvoriq.co.in" \
  -d '{"customerEmail":"bulk@example.com","paymentNoted":"UPI transferred 2026-09-11","customerKind":"BULK","deviceMax":1,"brandScope":"SAMSUNG","customerFullName":"Bulk Buyer"}')"
echo "$BULK1"
echo "$BULK1" | grep -q "HTTP:400"
echo "$BULK1" | grep -q "single-user only"

SERIAL_ID="$("$PY" - << 'PY'
import json
print(json.load(open("/tmp/cyvra-g7-serial.json"))["serialId"])
PY
)"

echo "[test] POST /admin/serials/$SERIAL_ID/issue"
ISSUE="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/admin/serials/$SERIAL_ID/issue" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Admin-Email: $ADMIN_EMAIL" \
  -H "Origin: https://admin.cyvoriq.co.in")"
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
  -H "Origin: https://admin.cyvoriq.co.in")"
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
  -H "Origin: https://admin.cyvoriq.co.in")"
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
  -H "Origin: https://admin.cyvoriq.co.in")"
echo "$REVOKE"
echo "$REVOKE" | grep -q "HTTP:200"
echo "$REVOKE" | grep -q '"REVOKED"'

echo "[test] GET /admin/reports/licences CSV includes the revoked key"
FROM="2020-01-01"
TO="2099-12-31"
REPORT="$(curl -sS -w "\nHTTP:%{http_code}\n" "$API/admin/reports/licences?from=$FROM&to=$TO" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Admin-Email: $ADMIN_EMAIL" \
  -H "Origin: https://admin.cyvoriq.co.in")"
echo "$REPORT" | tail -n 1
REPORT="$REPORT" "$PY" - << 'PY'
import json, os
raw = os.environ["REPORT"]
body, _, status = raw.rpartition("\nHTTP:")
d = json.loads(body)
assert status.strip() == "200", raw
assert d["count"] >= 1, d
assert any(row["licenceKey"].endswith("-1-5") for row in d["rows"]), d
print("[test] report json", d["count"], "rows")
PY
CSV="$(curl -fsS "$API/admin/reports/licences?from=$FROM&to=$TO&format=csv" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Admin-Email: $ADMIN_EMAIL" \
  -H "Accept: text/csv" \
  -H "Origin: https://admin.cyvoriq.co.in")"
echo "$CSV" | head -n 2
echo "$CSV" | grep -q "licenceKey,status,customerKind"
echo "$CSV" | grep -q "buyer@example.com"

echo "[test] GET /admin/reports/licences without token is 401"
UNAUTH_R="$(curl -sS -w "\nHTTP:%{http_code}\n" "$API/admin/reports/licences")"
echo "$UNAUTH_R" | grep -q "HTTP:401"

rm -f /tmp/cyvra-g7-serial.json /tmp/cyvra-g7-issued.json /tmp/cyvra-staff-otp.json /tmp/cyvra-staff-session.json
echo "[test] local G7 admin licences passed"
