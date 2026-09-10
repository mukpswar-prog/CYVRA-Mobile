#!/usr/bin/env bash
# Local G6 Report 1 freeze against wrangler dev (:8787). No phone, no cloud.
set -euo pipefail
API="${API_URL:-http://127.0.0.1:8787}"
PY="$(cd "$(dirname "$0")" && pwd)/python"

case "$API" in
  http://127.0.0.1:*|http://localhost:*|http://[::1]:*) ;;
  *)
    echo "[test] refusing non-local API $API"
    echo "[test] this script is wrangler on 127.0.0.1:8787 only"
    exit 1
    ;;
esac

echo "[test] GET $API/health"
if ! HEALTH="$(curl -fsS --max-time 5 "$API/health")"; then
  echo "[test] cannot reach $API (wrangler is not running)."
  echo "[test] Codespaces:  bash scripts/run-local-report.sh"
  echo "[test] Manual:      bash scripts/start.sh"
  echo "[test]              pnpm --filter @cyvra/api dev    # other terminal"
  echo "[test]              API_URL=http://127.0.0.1:8787 bash scripts/test-local-report.sh"
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

EMAIL="report-tester@resend.dev"
PROFILE='{"fullName":"Report Tester","companyName":"CYVORIQ","addressLine1":"Line 1","pincode":"560001","state":"Karnataka","email":"'"$EMAIL"'"}'

echo "[test] POST /auth/request"
REQ="$(curl -fsS -X POST "$API/auth/request" \
  -H "content-type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d "$PROFILE")"
REQ="$REQ" "$PY" - << 'PY'
import json, os
d = json.loads(os.environ["REQ"])
assert d.get("devCode") and d.get("challengeId"), d
open("/tmp/cyvra-r1-otp.txt","w").write(d["devCode"] + "\n" + d["challengeId"])
print("[test] request otp ok")
PY
CODE="$(sed -n '1p' /tmp/cyvra-r1-otp.txt)"
CHALLENGE="$(sed -n '2p' /tmp/cyvra-r1-otp.txt)"

echo "[test] POST /auth/verify"
VERIFY="$(curl -fsS -X POST "$API/auth/verify" \
  -H "content-type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d "{\"challengeId\":\"$CHALLENGE\",\"code\":\"$CODE\"}")"
VERIFY="$VERIFY" "$PY" - << 'PY'
import json, os
d = json.loads(os.environ["VERIFY"])
assert d.get("token"), d
open("/tmp/cyvra-r1-token.txt","w").write(d["token"])
print("[test] verify ok")
PY
TOKEN="$(cat /tmp/cyvra-r1-token.txt)"

echo "[test] POST /reports/freeze without session is 401"
UNAUTH="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/reports/freeze" \
  -H "content-type: application/json" \
  -H "Origin: http://localhost:5173" \
  -d '{"processingSessionId":"11111111-1111-4111-8111-111111111111"}')"
echo "$UNAUTH"
echo "$UNAUTH" | grep -q "HTTP:401"

"$PY" - << 'PY'
import json, uuid
ids = {
    "lifecycle": str(uuid.uuid4()),
    "session": str(uuid.uuid4()),
    "batch": str(uuid.uuid4()),
    "profile": str(uuid.uuid4()),
    "imei": str(uuid.uuid4()),
    "camera": str(uuid.uuid4()),
    "cellular": str(uuid.uuid4()),
}
open("/tmp/cyvra-r1-ids.json","w").write(json.dumps(ids))
print("[test] fixture ids written")
PY

echo "[test] ingest IMEI NOT_AVAILABLE + camera PERMISSION_DENIED + cellular NOT_SUPPORTED"
BATCH="$("$PY" - << 'PY'
import json
ids = json.load(open("/tmp/cyvra-r1-ids.json"))
def rec(evidence_id, test_id, result, method, limitation=None):
    row = {
        "schemaVersion": "1.0.0",
        "evidenceId": evidence_id,
        "deviceLifecycleId": ids["lifecycle"],
        "processingSessionId": ids["session"],
        "testId": test_id,
        "source": "S1_APPLICATION",
        "result": result,
        "collectedAt": "2026-09-10T12:00:00.000Z",
        "method": method,
    }
    if limitation:
        row["limitation"] = limitation
    return row
print(json.dumps({
    "schemaVersion": "1.0.0",
    "batchId": ids["batch"],
    "deviceLifecycleId": ids["lifecycle"],
    "processingSessionId": ids["session"],
    "createdAt": "2026-09-10T12:05:00.000Z",
    "records": [
        rec(ids["imei"], "IDN.IMEI_SERIAL", "NOT_AVAILABLE", "s1-telephony-manager-absent", "API_PRIVILEGED"),
        rec(ids["camera"], "FN.CAMERA_BACK_CAPTURE", "PERMISSION_DENIED", "user-denied-camera"),
        rec(ids["cellular"], "NET.CELLULAR", "NOT_SUPPORTED", "telephony-feature-absent", "HARDWARE_ABSENT"),
    ],
    "profile": {
        "schemaVersion": "1.0.0",
        "profileId": ids["profile"],
        "deviceLifecycleId": ids["lifecycle"],
        "processingSessionId": ids["session"],
        "version": 1,
        "capturedAt": "2026-09-10T12:00:00.000Z",
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
            {"feature": "android.hardware.camera", "declared": True, "state": "DECLARED"},
            {"feature": "android.hardware.telephony", "declared": False, "state": "DECLARED"},
        ],
        "permissions": [],
        "limitations": ["API_PRIVILEGED", "PERMISSION_DENIED", "HARDWARE_ABSENT"],
    },
}))
PY
)"
INGEST="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/evidence/batches" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: http://localhost:5173" \
  -d "$BATCH")"
echo "$INGEST"
INGEST="$INGEST" "$PY" - << 'PY'
import json, os
raw = os.environ["INGEST"]
body, _, status = raw.rpartition("\nHTTP:")
d = json.loads(body)
assert status.strip() == "200", raw
assert d["inserted"] == 3, d
print("[test] withheld ingest ok")
PY

SESSION_ID="$("$PY" - << 'PY'
import json
print(json.load(open("/tmp/cyvra-r1-ids.json"))["session"])
PY
)"

echo "[test] GET /reports/sessions includes the new session"
SESSIONS="$(curl -fsS "$API/reports/sessions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: http://localhost:5173")"
SESSIONS="$SESSIONS" SESSION_ID="$SESSION_ID" "$PY" - << 'PY'
import json, os
d = json.loads(os.environ["SESSIONS"])
sid = os.environ["SESSION_ID"]
assert any(row["processingSessionId"] == sid for row in d["sessions"]), d
print("[test] session listed")
PY

echo "[test] POST /reports/freeze is PARTIAL and sets frozenAt"
FIRST="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/reports/freeze" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: http://localhost:5173" \
  -d "{\"processingSessionId\":\"$SESSION_ID\"}")"
echo "$FIRST"
FIRST="$FIRST" "$PY" - << 'PY'
import json, os, re
raw = os.environ["FIRST"]
body, _, status = raw.rpartition("\nHTTP:")
d = json.loads(body)
assert status.strip() == "200", raw
assert d["replayed"] is False, d
assert d["coverage"] == "PARTIAL", d
assert d["title"] == "CYVRA Device Verification Report", d
assert re.match(r"^CYVRA-R1-\d{4}-[0-9A-F]{8}$", d["publicNumber"]), d
assert d.get("frozenAt"), d
camera = next(e for e in d["entries"] if e["testId"] == "FN.CAMERA_BACK_CAPTURE")
assert camera["result"] == "PERMISSION_DENIED", camera
assert camera["userName"] == "Camera Check", camera
assert "Camera Functional Verification" in camera["objectiveName"], camera
assert any("sanitization" in line.lower() for line in d["nongoals"]), d
assert any("certified perfect" in line.lower() for line in d["nongoals"]), d
open("/tmp/cyvra-r1-freeze.json","w").write(json.dumps(d))
print("[test] freeze PARTIAL ok", d["publicNumber"])
PY

echo "[test] replay freeze keeps the same frozenAt"
SECOND="$(curl -sS -w "\nHTTP:%{http_code}\n" -X POST "$API/reports/freeze" \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: http://localhost:5173" \
  -d "{\"processingSessionId\":\"$SESSION_ID\"}")"
echo "$SECOND"
SECOND="$SECOND" "$PY" - << 'PY'
import json, os
raw = os.environ["SECOND"]
body, _, status = raw.rpartition("\nHTTP:")
d = json.loads(body)
first = json.load(open("/tmp/cyvra-r1-freeze.json"))
assert status.strip() == "200", raw
assert d["replayed"] is True, d
assert d["reportId"] == first["reportId"], d
assert d["frozenAt"] == first["frozenAt"], (d["frozenAt"], first["frozenAt"])
assert d["publicNumber"] == first["publicNumber"], d
print("[test] freeze replay keeps frozenAt")
PY

REPORT_ID="$("$PY" - << 'PY'
import json
print(json.load(open("/tmp/cyvra-r1-freeze.json"))["reportId"])
PY
)"

echo "[test] GET /reports/$REPORT_ID returns names and footer"
GOT="$(curl -fsS "$API/reports/$REPORT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: http://localhost:5173")"
GOT="$GOT" "$PY" - << 'PY'
import json, os
d = json.loads(os.environ["GOT"])
assert d["title"] == "CYVRA Device Verification Report", d
assert d["coverage"] == "PARTIAL", d
camera = next(e for e in d["entries"] if e["userName"] == "Camera Check")
assert "Camera Functional Verification" in camera["objectiveName"], camera
assert camera["result"] == "PERMISSION_DENIED", camera
cellular = next(e for e in d["entries"] if e["testId"] == "NET.CELLULAR")
assert cellular["result"] == "NOT_SUPPORTED", cellular
imei = next(e for e in d["entries"] if e["testId"] == "IDN.IMEI_SERIAL")
assert imei["result"] == "NOT_AVAILABLE", imei
assert any("certified perfect" in line.lower() for line in d["nongoals"]), d
assert any("ownership" in line.lower() for line in d["nongoals"]), d
print("[test] GET report names + footer ok")
PY

echo "[test] GET /reports lists the frozen report"
LIST="$(curl -fsS "$API/reports" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: http://localhost:5173")"
LIST="$LIST" REPORT_ID="$REPORT_ID" "$PY" - << 'PY'
import json, os
d = json.loads(os.environ["LIST"])
rid = os.environ["REPORT_ID"]
assert any(row["reportId"] == rid for row in d["reports"]), d
print("[test] report listed")
PY

rm -f /tmp/cyvra-r1-otp.txt /tmp/cyvra-r1-token.txt /tmp/cyvra-r1-ids.json /tmp/cyvra-r1-freeze.json
echo "[test] local G6 Report 1 freeze passed"
