#!/usr/bin/env bash
# Local G5 evidence ingest against wrangler dev (:8787). No phone, no cloud.
set -euo pipefail
API="${API_URL:-http://localhost:8787}"
PY="$(cd "$(dirname "$0")" && pwd)/python"

echo "[test] GET $API/health"
HEALTH="$(curl -fsS "$API/health")"
echo "$HEALTH"
HEALTH="$HEALTH" "$PY" - << 'PY'
import json, os
h = json.loads(os.environ["HEALTH"])
assert h.get("status") == "ok", h
assert h.get("database") == "connected", h
print("[test] health ok")
PY

EMAIL="evidence-tester@resend.dev"
PROFILE='{"fullName":"Evidence Tester","companyName":"CYVORIQ","addressLine1":"Line 1","pincode":"560001","state":"Karnataka","email":"'"$EMAIL"'"}'

echo "[test] POST /auth/request"
REQ="$(curl -fsS -X POST "$API/auth/request" \
  -H "content-type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d "$PROFILE")"
echo "$REQ"
REQ="$REQ" "$PY" - << 'PY'
import json, os
d = json.loads(os.environ["REQ"])
assert d.get("devCode") and d.get("challengeId"), d
open("/tmp/cyvra-ev-otp.txt","w").write(d["devCode"] + "\n" + d["challengeId"])
print("[test] request otp ok")
PY
CODE="$(sed -n '1p' /tmp/cyvra-ev-otp.txt)"
CHALLENGE="$(sed -n '2p' /tmp/cyvra-ev-otp.txt)"

echo "[test] POST /auth/verify"
VERIFY="$(curl -fsS -X POST "$API/auth/verify" \
  -H "content-type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d "{\"challengeId\":\"$CHALLENGE\",\"code\":\"$CODE\"}")"
VERIFY="$VERIFY" "$PY" - << 'PY'
import json, os
d = json.loads(os.environ["VERIFY"])
assert d.get("token"), d
open("/tmp/cyvra-ev-token.txt","w").write(d["token"])
print("[test] verify ok")
PY
TOKEN="$(cat /tmp/cyvra-ev-token.txt)"

echo "[test] POST /evidence/batches without session is 401"
UNAUTH="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/evidence/batches" \
  -H "content-type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d '{"schemaVersion":"1.0.0"}')"
echo "$UNAUTH"
echo "$UNAUTH" | grep -q "HTTP:401"

"$PY" - << 'PY'
import json, uuid
ids = {
    "lifecycle": str(uuid.uuid4()),
    "session": str(uuid.uuid4()),
    "batch": str(uuid.uuid4()),
    "evidence": str(uuid.uuid4()),
    "profile": str(uuid.uuid4()),
    "bad_batch": str(uuid.uuid4()),
    "bad_evidence": str(uuid.uuid4()),
    "fail_batch": str(uuid.uuid4()),
    "fail_evidence": str(uuid.uuid4()),
}
open("/tmp/cyvra-ev-ids.json","w").write(json.dumps(ids))
print("[test] fixture ids written")
PY

echo "[test] honest IMEI NOT_AVAILABLE is accepted"
HONEST="$("$PY" - << 'PY'
import json
ids = json.load(open("/tmp/cyvra-ev-ids.json"))
record = {
    "schemaVersion": "1.0.0",
    "evidenceId": ids["evidence"],
    "deviceLifecycleId": ids["lifecycle"],
    "processingSessionId": ids["session"],
    "capabilityProfileId": ids["profile"],
    "testId": "IDN.IMEI_SERIAL",
    "source": "S1_APPLICATION",
    "result": "NOT_AVAILABLE",
    "collectedAt": "2026-09-09T12:00:00.000Z",
    "method": "s1-telephony-manager-absent",
    "limitation": "API_PRIVILEGED",
    "notes": "S1 cannot read IMEI",
}
body = {
    "schemaVersion": "1.0.0",
    "batchId": ids["batch"],
    "deviceLifecycleId": ids["lifecycle"],
    "processingSessionId": ids["session"],
    "createdAt": "2026-09-09T12:05:00.000Z",
    "records": [record],
    "profile": {
        "schemaVersion": "1.0.0",
        "profileId": ids["profile"],
        "deviceLifecycleId": ids["lifecycle"],
        "processingSessionId": ids["session"],
        "version": 1,
        "capturedAt": "2026-09-09T12:00:00.000Z",
        "accessLevel": "L2_S1_APP",
        "usbState": "USB_DISCONNECTED",
        "adbState": "ADB_DISABLED",
        "manufacturer": "samsung",
        "brand": "samsung",
        "model": "generic",
        "product": "generic",
        "device": "generic",
        "fingerprint": "samsung/generic/generic:14/UP1A/1:user/release-keys",
        "androidRelease": "14",
        "sdkInt": 34,
        "features": [
            {"feature": "android.hardware.telephony", "declared": True, "state": "DECLARED"}
        ],
        "permissions": [],
        "limitations": ["API_PRIVILEGED"],
    },
}
print(json.dumps(body))
PY
)"
FIRST="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/evidence/batches" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: http://localhost:5173" \
  -d "$HONEST")"
echo "$FIRST"
FIRST="$FIRST" "$PY" - << 'PY'
import json, os
raw = os.environ["FIRST"]
body, _, status = raw.rpartition("\nHTTP:")
d = json.loads(body)
assert status.strip() == "200", raw
assert d["replayed"] is False, d
assert d["inserted"] == 1, d
assert d["records"][0]["collectedAt"] == "2026-09-09T12:00:00.000Z", d
assert d["records"][0]["result"] == "NOT_AVAILABLE", d
print("[test] honest ingest ok")
PY

echo "[test] IMEI PASS from S1 is rejected"
DISHONEST="$("$PY" - << 'PY'
import json
ids = json.load(open("/tmp/cyvra-ev-ids.json"))
print(json.dumps({
    "schemaVersion": "1.0.0",
    "batchId": ids["bad_batch"],
    "deviceLifecycleId": ids["lifecycle"],
    "processingSessionId": ids["session"],
    "createdAt": "2026-09-09T12:06:00.000Z",
    "records": [{
        "schemaVersion": "1.0.0",
        "evidenceId": ids["bad_evidence"],
        "deviceLifecycleId": ids["lifecycle"],
        "processingSessionId": ids["session"],
        "testId": "IDN.IMEI_SERIAL",
        "source": "S1_APPLICATION",
        "result": "PASS",
        "collectedAt": "2026-09-09T12:06:00.000Z",
        "method": "invented",
    }],
}))
PY
)"
BAD="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/evidence/batches" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: http://localhost:5173" \
  -d "$DISHONEST")"
echo "$BAD"
echo "$BAD" | grep -q "HTTP:400"
echo "$BAD" | grep -q "Dishonest S1 evidence rejected"

echo "[test] FAIL plus limitation is rejected"
FAIL_LIM="$("$PY" - << 'PY'
import json
ids = json.load(open("/tmp/cyvra-ev-ids.json"))
print(json.dumps({
    "schemaVersion": "1.0.0",
    "batchId": ids["fail_batch"],
    "deviceLifecycleId": ids["lifecycle"],
    "processingSessionId": ids["session"],
    "createdAt": "2026-09-09T12:07:00.000Z",
    "records": [{
        "schemaVersion": "1.0.0",
        "evidenceId": ids["fail_evidence"],
        "deviceLifecycleId": ids["lifecycle"],
        "processingSessionId": ids["session"],
        "testId": "FN.CAMERA_BACK_CAPTURE",
        "source": "S1_APPLICATION",
        "result": "FAIL",
        "limitation": "PERMISSION_DENIED",
        "collectedAt": "2026-09-09T12:07:00.000Z",
        "method": "coerced",
    }],
}))
PY
)"
FAIL="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/evidence/batches" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: http://localhost:5173" \
  -d "$FAIL_LIM")"
echo "$FAIL"
echo "$FAIL" | grep -q "HTTP:400"

echo "[test] replay does not overwrite collectedAt"
REPLAY="$("$PY" - << 'PY'
import json
ids = json.load(open("/tmp/cyvra-ev-ids.json"))
print(json.dumps({
    "schemaVersion": "1.0.0",
    "batchId": ids["batch"],
    "deviceLifecycleId": ids["lifecycle"],
    "processingSessionId": ids["session"],
    "createdAt": "2026-09-09T18:00:00.000Z",
    "records": [{
        "schemaVersion": "1.0.0",
        "evidenceId": ids["evidence"],
        "deviceLifecycleId": ids["lifecycle"],
        "processingSessionId": ids["session"],
        "testId": "IDN.IMEI_SERIAL",
        "source": "S1_APPLICATION",
        "result": "NOT_AVAILABLE",
        "collectedAt": "2026-09-09T18:00:00.000Z",
        "method": "replay-should-not-win",
        "limitation": "API_PRIVILEGED",
    }],
}))
PY
)"
SECOND="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/evidence/batches" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: http://localhost:5173" \
  -d "$REPLAY")"
echo "$SECOND"
SECOND="$SECOND" "$PY" - << 'PY'
import json, os
raw = os.environ["SECOND"]
body, _, status = raw.rpartition("\nHTTP:")
d = json.loads(body)
assert status.strip() == "200", raw
assert d["replayed"] is True, d
assert d["inserted"] == 0, d
assert d["records"][0]["collectedAt"] == "2026-09-09T12:00:00.000Z", d
print("[test] collectedAt preserved")
PY

SESSION_ID="$("$PY" - << 'PY'
import json
print(json.load(open("/tmp/cyvra-ev-ids.json"))["session"])
PY
)"
echo "[test] GET /evidence/records for own session"
GOT="$(curl -fsS "$API/evidence/records?processingSessionId=$SESSION_ID" \
  -H "Authorization: Bearer $TOKEN")"
echo "$GOT"
GOT="$GOT" "$PY" - << 'PY'
import json, os
d = json.loads(os.environ["GOT"])
assert len(d["records"]) == 1, d
assert d["records"][0]["collectedAt"] == "2026-09-09T12:00:00.000Z", d
assert d["records"][0]["result"] == "NOT_AVAILABLE", d
print("[test] get own records ok")
PY

rm -f /tmp/cyvra-ev-otp.txt /tmp/cyvra-ev-token.txt /tmp/cyvra-ev-ids.json
echo "[test] local G5 evidence ingest passed"
