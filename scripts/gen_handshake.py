# -*- coding: utf-8 -*-
"""
Generate the CYVRA Final Plan-vs-Actual Handshake Matrix (rows & columns).

Sources are read directly from the Chief Engineer's two workbooks so that no
row is transcribed by hand. Current-code state comes from two mechanisms:
rows that have a collector are transcribed from a source reading performed
12-Oct-2026 (listed explicitly below; it is small and auditable), and rows the
provider declines are read live from AdbExtendedEvidenceProvider.kt on every
run, so the product's own reason text is what the matrix prints.

Why this file is committed
--------------------------
The matrix it writes claims that every figure in it is reproducible. That claim
is only honest if the counting program is preserved beside the document it
produces, so this script lives in scripts/ rather than in a scratch directory.

The two workbooks are the Chief Engineer's source documents and sit OUTSIDE
this repository. Point CYVRA_WORKBOOK_DIR at the folder holding them, or edit
BLUE and MATRIX below. Running without them fails loudly on the first read
rather than emitting a half-populated matrix.

The script exits non-zero if the product's technician checklist and the
workbook disagree, because a silently drifting count is worse than no count.
The single sanctioned addition is CE2_CHECKLIST_ADDITIONS (ruling CE-2).
"""
import os, re, collections, datetime
from openpyxl import load_workbook

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)

_WB_DIR = os.environ.get(
    "CYVRA_WORKBOOK_DIR",
    r"E:\swarup new\Cyvoriq\CYVORIQ-Project\CYVORIQ -MOBILE (A)",
)
BLUE  = os.path.join(_WB_DIR, "CYVRA_Mobile_AI_Physical_Inspection_and_Certified_Grading_Engineering_Report.xlsx")
MATRIX= os.path.join(_WB_DIR, "CYVRA_Mobile_Diagnostic_vs_Physical_Verification_Matrix.xlsx")
OUT   = os.path.join(_REPO, "docs",
                     "CYVRA_FINAL_PLAN_VS_ACTUAL_HANDSHAKE_MATRIX_2026-10-12.md")

def sheet_rows(path, sheet):
    wb = load_workbook(path, data_only=True)
    ws = wb[sheet]
    rows = list(ws.iter_rows(min_row=1, max_row=ws.max_row, values_only=True))
    hi = next(i for i, r in enumerate(rows) if r and r[0] == "ID")
    hdr = [("" if c is None else str(c).strip()) for c in rows[hi]]
    out = []
    for r in rows[hi + 1:]:
        if not r or r[0] is None:
            continue
        out.append({hdr[j]: ("" if (j < len(r) and r[j] is None) else str(r[j]).strip())
                    for j in range(len(hdr))})
    return out

mtx = {d["ID"]: d for d in sheet_rows(MATRIX, "Capability Matrix")}
aut = {d["ID"]: d for d in sheet_rows(BLUE, "Automation Impact Matrix")}
ids = [d["ID"] for d in sheet_rows(MATRIX, "Capability Matrix")]
assert len(ids) == 114, len(ids)

# ---------------------------------------------------------------------------
# TECHNICIAN CHECKLIST  <- parsed out of the product's own Kotlin source, then
# cross-checked against the workbook. Parsing rather than re-typing is what stops
# this document and the shipped code drifting apart silently.
# ---------------------------------------------------------------------------
KOTLIN_CATALOG = (r"C:\Users\User\Documents\GitHub\CYVRA-Mobile\apps\android\core"
                  r"\src\main\kotlin\cyvra\mobile\core\TechnicianChecklistCatalog.kt")

def load_technician_catalog():
    src = open(KOTLIN_CATALOG, encoding="utf-8").read()
    out = {}
    for block in re.findall(r"TechnicianCheckDefinition\((.*?)\n\s*\)", src, re.S):
        def field(name):
            m = re.search(r"\b%s\s*=\s*\"(.*?)\"" % name, block, re.S)
            return m.group(1) if m else ""
        pid = field("id")
        if pid:
            out[pid] = (field("item"), field("priority"), field("domain"))
    return out

TechnicianChecklistCatalog_map = load_technician_catalog()
TechnicianChecklistCatalog_ids = sorted(TechnicianChecklistCatalog_map)

# Ruling CE-2 (Chief Engineer, 13-Oct-2026)
# ---------------------------------------------------------------------------
# PHY-008 "SIM tray/slot integrity" joins the technician checklist.
#
# The two ratified workbooks disagree about this row, and the disagreement is
# the defect this ruling resolves:
#   Capability Matrix        -> CYVRA Capability = No, Evidence Type =
#                               Physical required, Limitation =
#                               "Software SIM state is insufficient"
#   Automation Impact Matrix -> AI/Camera Automation = "Conditional / assisted"
#
# Read literally, "Conditional / assisted" mapped to the application bucket,
# putting a check the workbook itself says software cannot perform into a
# column where it could never be closed. The Automation Impact wording
# describes a human working the check WITH the application guiding them, so
# the Capability Matrix - which is the capability statement - governs.
#
# This set is explicit rather than inferred from a column value, so that the
# reason is visible at the point of use and so no other row can drift into the
# checklist by a cell being edited.
CE2_CHECKLIST_ADDITIONS = {"PHY-008"}

# The workbook is the source of truth; the code must match it exactly.
WORKBOOK_HUMAN = sorted(
    set(k for k, v in aut.items()
        if v.get("AI/Camera Automation", "") == "No / not safely replaceable")
    | CE2_CHECKLIST_ADDITIONS
)
if TechnicianChecklistCatalog_ids != WORKBOOK_HUMAN:
    only_code = set(TechnicianChecklistCatalog_ids) - set(WORKBOOK_HUMAN)
    only_wb   = set(WORKBOOK_HUMAN) - set(TechnicianChecklistCatalog_ids)
    raise SystemExit(
        "TECHNICIAN CHECKLIST HAS DRIFTED FROM THE WORKBOOK\n"
        "  in product code but not the workbook: %s\n"
        "  in the workbook but not the product code: %s\n"
        "Reconcile TechnicianChecklistCatalog.kt against the workbook before publishing."
        % (sorted(only_code) or "none", sorted(only_wb) or "none"))
print("technician checklist: %d checks, in sync with the workbook"
      % len(TechnicianChecklistCatalog_ids))

# ---------------------------------------------------------------------------
# OWNER  <- derived from the CE workbook's own "AI/Camera Automation" column
# ---------------------------------------------------------------------------
OWNER_MAP = {
    "Yes \u2014 deterministic software test"      : "APP",
    "Yes \u2014 controlled test + optional AI"    : "APP+H",
    "Yes \u2014 controlled vision"                : "AI",
    "Conditional / assisted"                      : "APP*",
    "No AI replacement; status only"              : "APP",
    "No"                                          : "APP",
    "No / not safely replaceable"                 : "HUMAN",
}
OWNER_LABEL = {
    "APP"   : "Application alone",
    "APP*"  : "Application (OEM-conditional)",
    "APP+H" : "Application + human stimulus",
    "AI"    : "AI vision agent",
    "HUMAN" : "Human / specialist",
}
STAGE = {
    "APP"   : "Stage 1",
    "APP*"  : "Stage 1 (conditional)",
    "APP+H" : "Stage 6 (fixture)",
    "AI"    : "Stage 6 (vision)",
    "HUMAN" : "Stage 6 (protocol)",
}

# ---------------------------------------------------------------------------
# CURRENT CODE STATE  <- read from source 12-Oct-2026, exact lines
# apps/host/.../evidence/AdbGenericEvidenceProvider.kt
# ---------------------------------------------------------------------------
# --- Tier A: product path present BEFORE this work package ------------------
IMPLEMENTED_BASE = {
    "CON-001": "Windows USB/PnP plane observes the device (desktop observer, hardware-validated)",
    "CON-002": "ADB reachability established before any shell is issued",
    "CON-003": "ADB authorisation state is a distinct, separately-held state",
    "ID-001" : "getprop ro.product.manufacturer",
    "ID-002" : "getprop ro.product.brand",
    "ID-003" : "getprop ro.product.model",
    "ID-004" : "getprop ro.build.version.release + ro.build.version.sdk",
    "ID-005" : "getprop ro.build.id + ro.build.fingerprint (fingerprint added in Stage 1)",
    "ID-006" : "getprop ro.build.version.security_patch",
    "ID-007" : "recorded honestly as RESTRICTED (no value asserted)",
    "ID-008" : "recorded honestly as RESTRICTED (no value asserted)",
    "ID-009" : "settings get secure android_id",
    "APP-001": "pm list packages -U via AdbApplicationInventoryProvider",
    "STO-001": "df -k /data -> total bytes",
    "STO-002": "df -k /data -> available bytes",
    "BAT-001": "dumpsys battery -> present/state",
    "BAT-002": "dumpsys battery -> level:",
    "BAT-003": "dumpsys battery -> AC/USB powered:",
    "BAT-006": "dumpsys battery -> health:  (a health string, not a wear estimate)",
    "SEC-001": "dumpsys trust -> deviceLocked/currentUserIsSecure",
    # --- PUR-001..PUR-005 ---------------------------------------------------
    # Implemented by the sanitization subsystem but never keyed to the ratified
    # workbook IDs, which is why they were counted as having no code in the
    # evidence path. Read from source 13-Oct-2026; each states what the code
    # actually does, including where it declines to act.
    # PUR-006 was DELIBERATELY ABSENT until 14-Oct-2026, when verifyPostReset
    # began taking the residual application inventory itself through supported
    # paths. Account, contact and media counts still sit outside the supported
    # command set and remain disclosed in `limitations` as not measured.
    "PUR-001": "HostSanitizationProvider.assessCapability(DeviceCapabilityAssessment) "
               "-> SanitizationMethodType; exercised by the workflow tests",
    "PUR-002": "2-step authorization barrier (requestAuthorization + "
               "toggleStep1Acknowledgement/submitStep2Confirmation); "
               "preventsExecutionWithoutSatisfying2StepConfirmationBarrier",
    "PUR-003": "HostSanitizationWorkflowEngine.selectMethod() behind the barrier; "
               "exercised by executesPurgeAndVerifiesPostResetReconnection",
    "PUR-004": "executePurge()/execute() - unit-tested for dry-run only; real purge "
               "returns BLOCKED_NOT_IMPLEMENTED (no validated provider bound)",
    "PUR-005": "verifyPostReset(); returns PARTIALLY_VERIFIED or "
               "REQUIRES_EXTERNAL_VERIFICATION, never VERIFIED (WP-1b fix)",
    "PUR-006": "HostVerificationProvider.residualInventory() inside verifyPostReset(): "
               "`pm list packages` and `pm list packages -3` counted into "
               "residualTotal/ThirdParty/CyvraPackages on VerificationResult, each null "
               "when not established; account/contact/media counts still declined",
}
# --- Tier B: added by Stage 1, 12-Oct-2026 --------------------------------
# Code exists, compiles, and is unit-tested. NONE of these has yet been run
# against a device through the product, so none is claimed as hardware-validated.
STAGE1 = {
    "HW-001": "getprop ro.board.platform",
    "HW-002": "count of `processor` entries in /proc/cpuinfo",
    "HW-003": "cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq",
    "HW-004": "MemTotal from /proc/meminfo",
    "DIS-001": "dumpsys display -> mDisplayId",
    "DIS-002": "wm size",
    "DIS-003": "dumpsys display -> fps",
    "CAM-001": "dumpsys media.camera -> camera-device count heading",
    "AUD-001": "ls /proc/asound (path presence only)",
    "AUD-003": "ls /proc/asound (path presence only)",
    "SEN-001": "dumpsys sensorservice -> accelerometer entry",
    "SEN-002": "dumpsys sensorservice -> gyroscope entry",
    "SEN-003": "dumpsys sensorservice -> magnetometer entry",
    "SEN-004": "dumpsys sensorservice -> proximity entry",
    "SEN-005": "dumpsys sensorservice -> light entry",
    "SEN-006": "dumpsys sensorservice -> barometer entry",
    "HAP-001": "service list -> vibrator service",
    "WIFI-001": "dumpsys wifi -> Wi-Fi state",
    "WIFI-002": "dumpsys wifi -> count of scan-result access points",
    "BT-001": "settings get global bluetooth_on",
    "CELL-001": "getprop ro.telephony.default_network",
    "CELL-002": "getprop gsm.sim.state",
    "CELL-003": "dumpsys telephony.registry -> mServiceState",
    "CELL-004": "settings get global mobile_data",
    "GNSS-001": "pm list features -> android.hardware.location.gps",
    "PERF-002": "MemAvailable vs MemTotal from /proc/meminfo",
    "PERF-004": "getprop sys.boot_completed",
    "SYS-001" : "date -u + getprop persist.sys.timezone",
    "SYS-002" : "getprop persist.sys.locale",
    "SYS-003" : "dumpsys power -> mWakefulness or Display Power state",
    "SEC-002" : "settings get global adb_enabled  (was fabricated)",
    "SEC-003" : "getprop ro.crypto.state",
    "SEC-004" : "getprop ro.boot.verifiedbootstate  (was fabricated)",
    "SEC-005" : "dumpsys device_policy -> device-owner component  (was fabricated AND was wrong)",
    "BAT-004" : "temperature: from dumpsys battery (device-native units; divisor not yet measured)",
    "APP-002" : "dumpsys package versionName over a bounded sample of 25 packages",
}
IMPLEMENTED = dict(IMPLEMENTED_BASE)
IMPLEMENTED.update(STAGE1)

# Fabrications found 12-Oct-2026 and REMOVED the same day (Stage 0).
# Kept as a record of a defect that was found, not as a live condition.
# (workbook-id, field, what the code did, why it was wrong, in-114?)
FAB_LIST = [
    ("SEC-002", "adbEnabled", "AdbGenericEvidenceProvider.kt:158", "hardcoded `true`, stamped AVAILABLE",
     "`true` was returned whatever the device actually reported \u2014 **REPLACED by `settings get global adb_enabled`**", True),
    ("SEC-004", "secureBootEnabled", "AdbGenericEvidenceProvider.kt:156", "hardcoded `true`, stamped AVAILABLE",
     "`true` was returned whatever the device reported \u2014 **REPLACED by `ro.boot.verifiedbootstate`**", True),
    ("SEC-005", "deviceOwnerActive", "AdbGenericEvidenceProvider.kt:157", "hardcoded `false`, stamped AVAILABLE",
     "**Proven wrong** \u2014 the bench device *was* a device owner that five commands refused to remove \u2014 **REPLACED by `dumpsys device_policy`**", True),
    ("", "externalStoragePresent", "AdbGenericEvidenceProvider.kt:142", "hardcoded `false`, stamped AVAILABLE",
     "Not one of the ratified 114 \u2014 **REPLACED by a real `ls /storage` observation**", False),
    ("", "scopedStorageEnforced", "AdbGenericEvidenceProvider.kt:143", "hardcoded `true`, stamped AVAILABLE",
     "Not one of the ratified 114; propagated into report text at `:144` \u2014 **REPLACED by NOT_AVAILABLE with the true reason**", False),
]
FABRICATED = {}     # zero remain as of 12-Oct-2026 Stage 0
EXTRA_FAB = []

# ---------------------------------------------------------------------------
# Q1-measured obtainable set  (docs/CYVRA_AGENTLESS_RESEARCH_Q1_2026-10-12.md)
# ---------------------------------------------------------------------------
Q1_OBTAINABLE = set("""ID-001 ID-002 ID-003 ID-004 ID-005 ID-006 ID-009
SEC-001 SEC-002 SEC-003 SEC-004
APP-001 APP-002
HW-001 HW-002 HW-004
STO-001 STO-002 STO-003
BAT-001 BAT-002 BAT-003 BAT-004 BAT-006
DIS-001 DIS-002 DIS-003
CAM-001 CAM-002 CAM-003
AUD-001 AUD-003
SEN-001 SEN-002 SEN-003 SEN-004 SEN-005 SEN-006
HAP-001
WIFI-001 WIFI-002 WIFI-003
BT-001 BT-002 BT-003
CELL-001 CELL-002 CELL-003 CELL-004
GNSS-001 GNSS-002
PERF-001 PERF-002 PERF-003 PERF-004
SYS-001 SYS-002 SYS-003
CON-001 CON-002 CON-003""".split())

# ---------------------------------------------------------------------------
# CORRECTION, 13-Oct-2026 - recorded here rather than edited away silently, so
# that the belief and its refutation both stay in the tree.
#
# Two groups were carried in Q1_OBTAINABLE that the cited document does not
# support. Each was checked line by line against
# docs/CYVRA_AGENTLESS_RESEARCH_Q1_2026-10-12.md:
#
# PROBE_NOT_MEASURED. The words bluetooth, gnss, location, gps, wifi, wi-fi,
# responsiveness, latency, throughput, fix, pair and scan do not occur in that
# file at all. camera and disk occur on one line each of a six-row class
# summary, and neither read/write responsiveness nor frame delivery was
# measured there. The file carries no 114-parameter ID whatever - the only
# ID-shaped match in it is "Oct-202", a fragment of its own date. So Q1 never
# exercised Bluetooth, GNSS or Wi-Fi, and never measured responsiveness, frame
# delivery, pairing or fix acquisition. Those nine could not have been
# measured obtainable by it.
#
# Q1_NOT_STATED. The words "brand" and "security patch" are absent from the
# file too, and neither property appears in its Identity & build row, which
# lists build fingerprint, API level, hardware/chipset, board platform,
# manufacturer and model. Both product paths are unit-tested and stay
# implemented; what goes is only the assertion that Q1 proved them.
#
# CON-001/002/003 stay. Section 4 records that USB debugging must be enabled
# and the host authorised on the device screen, which is exactly what those
# three parameters assert.
#
# Everything here failed independent re-execution, which the prohibition rule
# does not permit. Row counts move: TESTED 18 -> 16, UNIT-TESTED 4 -> 6,
# Q1_OBTAINABLE 61 -> 50. No row changes owner, stage or implementation state.
PROBE_NOT_MEASURED = set("""STO-003 CAM-002 CAM-003 WIFI-003 BT-002 BT-003
GNSS-002 PERF-001 PERF-003""".split())

Q1_NOT_STATED = set("""ID-002 ID-006""".split())

Q1_OBTAINABLE -= PROBE_NOT_MEASURED | Q1_NOT_STATED

# ---------------------------------------------------------------------------
# Rows the product already handles in the evidence path, by declining honestly
# ---------------------------------------------------------------------------
# These are NOT "no code". AdbExtendedEvidenceProvider.collect() emits a
# DeviceParameter for each, keyed to its ratified workbook ID, with value null,
# status NOT_AVAILABLE, source ADB, and a reason.
#
# The reasons are read from the Kotlin source at generation time instead of
# being copied into this file. A transcription can drift away from what the
# product actually says, and the matrix's Method table claims its TODAY column
# comes from source - reading it makes that claim true rather than asserted.
# If the file moves or the helper is renamed this fails loudly instead of
# quietly reporting "not collected" again, which is the defect being fixed.
EXTENDED_PROVIDER = os.path.join(
    "apps", "host", "src", "main", "kotlin", "cyvra", "mobile", "host",
    "evidence", "AdbExtendedEvidenceProvider.kt")

_DECLINED_RE = re.compile(
    r'notMeasurableByShell\(\s*"([A-Z]{2,4}-\d{3})"\s*,\s*"[^"]*"\s*,\s*'
    r'"[^"]*"\s*,\s*"([^"]*)"', re.S)

def read_declined_from_source():
    if not os.path.isfile(EXTENDED_PROVIDER):
        raise SystemExit(
            "FATAL: %s not found. The matrix would silently revert to "
            "'not collected' for rows that have code." % EXTENDED_PROVIDER)
    with open(EXTENDED_PROVIDER, encoding="utf-8") as fh:
        text = fh.read()
    found = dict(_DECLINED_RE.findall(text))
    if len(found) < 10:
        raise SystemExit(
            "FATAL: parsed %d notMeasurableByShell rows from %s; expected at "
            "least 10. Refusing to emit a matrix that under-reports the "
            "evidence path." % (len(found), EXTENDED_PROVIDER))
    return found

# id -> the product's own reason text, escaped for the markdown table cell.
DECLINED_IN_EVIDENCE = {k: v.replace("|", "\\|")
                        for k, v in read_declined_from_source().items()}

PUR_PROVEN = {   # bench proof. 12-Oct-2026 measurement plus, for PUR-006, the
                 # 14-Oct product-path re-run logged in docs/evidence/
    "PUR-003": "PROVEN on bench - factory reset executed via installed artifact",
    "PUR-004": "PROVEN on bench - ro.boot.bootreason=reboot,factory_reset; boot pinned 11:41:24",
    "PUR-005": "PROVEN on bench - packages 363->333, contacts 294->1, media 288->20, accounts 1->0, DO refs 4->0",
    "PUR-006": "PROVEN on bench - 12-Oct third-party 40->4; 14-Oct product path "
               "re-measured 333 total / 4 third-party / 0 CYVRA "
               "(docs/evidence/pur006-product-path-2026-10-14.log)",
}

def tested_status(oid, owner):
    """Three honest tiers. IMPLEMENTED is deliberately kept separate from VALIDATED:
    code that compiles and passes unit tests has not been run on a device."""
    if oid in PUR_PROVEN:
        return "TESTED on bench (hardware) \u2014 re-executable proof exists"
    if oid in IMPLEMENTED_BASE:
        if oid in Q1_OBTAINABLE:
            return "TESTED \u2014 data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run"
        return "UNIT-TESTED only \u2014 product path exists; NOT device-run"
    if oid in STAGE1:
        return "IMPLEMENTED (Stage 1) \u2014 compiles + unit-tested; **NOT validated on hardware**"
    if oid in PROBE_NOT_MEASURED:
        return "NOT IMPLEMENTED \u2014 probe obtainability NOT measured for this parameter; the product emits NOT_AVAILABLE with a stated reason rather than a value"
    if oid in Q1_OBTAINABLE:
        return "NOT IMPLEMENTED \u2014 Q1 measured the probe obtainable; product does not collect it"
    if owner in ("AI", "APP+H"):
        return "NOT TESTED \u2014 requires station/fixture that does not exist yet"
    if owner == "HUMAN":
        return "CHECKLIST IN PRODUCT \u2014 technician attestation recorded; **no execution recorded yet**"
    return "NOT TESTED"

def tier_of(st):
    """Short label for the totals table. Explicit rather than string-splitting:
    splitting on a separator the statuses no longer contain produced garbled rows."""
    if st.startswith("TESTED on bench"):   return "TESTED on bench (hardware)"
    if st.startswith("TESTED"):            return "TESTED (data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run)"
    if st.startswith("UNIT-TESTED"):       return "UNIT-TESTED only (NOT device-run)"
    if st.startswith("IMPLEMENTED"):       return "IMPLEMENTED (Stage 1) - NOT validated on hardware"
    if st.startswith("NOT IMPLEMENTED"):   return "NOT IMPLEMENTED"
    if st.startswith("NOT TESTED"):        return "NOT TESTED"
    return st

def today_state(oid):
    if oid in STAGE1:
        return "**Stage 1** " + STAGE1[oid]
    if oid in IMPLEMENTED_BASE:
        return IMPLEMENTED_BASE[oid]
    if oid in DECLINED_IN_EVIDENCE:
        return ("**In evidence path** \u2014 emits `NOT_AVAILABLE` with value "
                "null and the reason the product itself records: \"%s\""
                % DECLINED_IN_EVIDENCE[oid])
    return "not collected"

def app_role(owner):
    return {
        "APP"   : "Collects, attributes to ANDROID_ADB, reports state honestly",
        "APP*"  : "Collects where OEM/version permits; else reports NOT_AVAILABLE",
        "APP+H" : "Drives the stimulus and records the response",
        "AI"    : "Records the AI finding + confidence; never invents one",
        "HUMAN" : "Records the technician's result; never converts it to software evidence",
    }[owner]

def ai_role(owner):
    return {
        "APP"   : "\u2013",
        "APP*"  : "\u2013",
        "APP+H" : "Optional defect assist on captured frames",
        "AI"    : "Detects + localises the defect from controlled frames",
        "HUMAN" : "\u2013",
    }[owner]

def human_role(owner):
    return {
        "APP"   : "None",
        "APP*"  : "Guided exception when the OEM blocks it",
        "APP+H" : "Places device, supplies stimulus/fixture",
        "AI"    : "Reviews low-confidence / occluded frames only",
        "HUMAN" : "Performs the physical or specialist check",
    }[owner]

# PUR rows carry bespoke gap text because "None - in place" would be false for
# PUR-004 (execution deliberately blocked) and for PUR-006 (package counts are in
# place since 14-Oct, but account/contact/media counts still are not).
PUR_GAP = {
    "PUR-001": "None \u2014 capability assessment in place; **not yet run through the "
               "product against hardware**",
    "PUR-002": "None \u2014 authorization barrier in place; **not yet run through the "
               "product against hardware**",
    "PUR-003": "None \u2014 method selection in place; **not yet run through the product "
               "against hardware**",
    "PUR-004": "Execution gated twice: `execute()` returns BLOCKED_NOT_IMPLEMENTED "
               "(no validated sanitization provider bound) **and** the offline "
               "entitlement must grant `sanitizeExecute` (WP-5)",
    "PUR-005": "None \u2014 post-reset verification in place and deliberately declines to "
               "claim erasure; residual counts still require PUR-006",
    "PUR-006": "None for applications \u2014 residual package counts are taken inside "
               "`verifyPostReset()` and reported on `VerificationResult`. Account, "
               "contact and media counts remain outside the supported command set and "
               "are still disclosed as not measured",
}

def gap(oid, owner):
    if oid in PUR_GAP:
        return PUR_GAP[oid]
    if oid in DECLINED_IN_EVIDENCE:
        return ("Collector in place and emitting an honest `NOT_AVAILABLE` \u2014 "
                "the value itself is still not obtained")
    if oid in STAGE1:
        base = "Collector in place \u2014 **must be validated against real hardware, then re-measured**"
        if owner == "APP+H":
            return base + "; the controlled-stimulus test still awaits the Stage 6 fixture"
        if owner == "AI":
            return base + "; the cosmetic defect pass still awaits the Stage 6 station"
        if owner == "HUMAN":
            return base + "; the physical check itself remains a technician item"
        return base
    if oid in IMPLEMENTED_BASE:
        if oid in ("ID-005", "BAT-006"):
            return "BAT-006 still reports a health string, not a wear estimate"
        if owner == "APP+H":
            return "Basic reading in place; controlled-stimulus test awaits the Stage 6 fixture"
        if owner == "AI":
            return "Software reading in place; cosmetic defect pass awaits the Stage 6 station"
        return "None \u2014 in place"
    if owner in ("APP", "APP*"):
        if oid in Q1_OBTAINABLE:
            return "Implement ADB collector (Stage 1)"
        return "Implement collector (Stage 1)"
    if owner == "APP+H":
        return "Requires controlled fixture + operator handling (Stage 6)"
    if owner == "AI":
        return "Requires inspection station + model (Stage 6)"
    return ("Checklist delivered in product \u2014 awaiting technician execution; recorded as an "
            "OPERATOR attestation, never as software evidence")

# ---------------------------------------------------------------------------
# BUILD
# ---------------------------------------------------------------------------
owner_ct = collections.Counter()
stage_ct = collections.Counter()
tested_ct = collections.Counter()
rows = []
for oid in ids:
    m = mtx.get(oid, {})
    a = aut.get(oid, {})
    dom  = m.get("Domain", a.get("Domain", ""))
    item = m.get("Diagnostic / Evidence Item", a.get("Existing Diagnostic Item", ""))
    auto = a.get("AI/Camera Automation", "")
    owner = OWNER_MAP.get(auto, "APP")
    # Ruling CE-2: PHY-008 is HUMAN regardless of its "Conditional / assisted"
    # automation cell - see CE2_CHECKLIST_ADDITIONS above for why.
    if oid in CE2_CHECKLIST_ADDITIONS:
        owner = "HUMAN"
    owner_ct[owner] += 1
    stage_ct[STAGE[owner]] += 1
    st = tested_status(oid, owner)
    tested_ct[tier_of(st)] += 1
    rows.append((oid, dom, item, today_state(oid), app_role(owner), ai_role(owner),
                 human_role(owner), gap(oid, owner), st, STAGE[owner], owner))

# Measured, not asserted: application-owned rows still showing no code in the
# evidence path. Printed so the correction itself is re-checkable on every run
# rather than living as a prose claim in a document.
_app_rows   = [r for r in rows if r[10] in ("APP", "APP*")]
_uncoded    = [r for r in _app_rows if r[3] == "not collected"]
print("application-owned: %d  |  no code in evidence path: %d  [%s]"
      % (len(_app_rows), len(_uncoded), " ".join(r[0] for r in _uncoded) or "none"))

L = []
w = L.append
w("# CYVRA \u2014 FINAL PLAN-vs-ACTUAL HANDSHAKE MATRIX")
w("")
w("**Purpose:** the single row-and-column record of the 114 ratified diagnostic")
w("parameters, showing what the product does today, what the application will do,")
w("what the AI agent does, what the human verifies, what is still missing, and what")
w("has genuinely been tested versus what has not.")
w("")
w("**Status:** DRAFT for Chief Engineer handshake \u00b7 **Date:** 12-Oct-2026")
w("**Authority:** Chief Engineer instruction, 12-Oct-2026 \u00b7 **Governing holds:** ledger H1\u2013H8")
w("")
w("> **This document may not be used to claim the .exe is complete.** It exists so")
w("> that the handshake is made against measured facts rather than intent. In")
w("> particular, *implemented* and *validated* are separate columns here \u2014 code that")
w("> compiles and passes unit tests has not thereby been run on a device.")
w("")
w("---")
w("")
w("## 1. Method \u2014 how every row below was produced")
w("")
w("| Step | Method | Reproducible? |")
w("|---|---|---|")
w("| The 114 parameters, domains, capability and evidence type | read directly from `CYVRA_Mobile_Diagnostic_vs_Physical_Verification_Matrix.xlsx` \u2192 `Capability Matrix` | yes \u2014 open the workbook |")
w("| Owner (Application / AI / Human) | derived from the Chief Engineer's own `AI/Camera Automation` column in `Automation Impact Matrix` | yes \u2014 rules in \u00a72 |")
w("| Today's code state | transcribed from source on 12-Oct-2026 for rows that have a collector; **read live** from `AdbExtendedEvidenceProvider.kt` for every row the provider declines | yes \u2014 open the files |")
w("| Tested / not tested | `docs/CYVRA_AGENTLESS_RESEARCH_Q1_2026-10-12.md` + `docs/CYVRA_FACTORY_RESET_PROOF_2026-10-12.md` | yes \u2014 both are committed |")
w("")
w("No row in this table was invented. Two mechanisms produce the *Today* column and they differ in strength: a row that has a collector carries a summary transcribed from source on 12-Oct-2026, which can drift if the code changes afterwards; a row the provider declines carries the product's own reason text, read from that source every time this matrix is generated, so it cannot drift. Where the two disagree, the source wins.")
w("")
w("---")
w("")
w("## 2. Ownership model \u2014 the four hands")
w("")
w("The Chief Engineer's workbook already answers *who does each job*. These are its")
w("own words, not mine:")
w("")
w("| Owner | Workbook's own label | Count | Meaning |")
w("|---|---|---|---|")
for k in ("APP", "APP*", "APP+H", "AI", "HUMAN"):
    w("| **%s** | %s | %d | %s |" % (OWNER_LABEL[k], {
        "APP"   : "`Yes \u2014 deterministic software test` / `status only` / `No` (AI not needed)",
        "APP*"  : "`Conditional / assisted`",
        "APP+H" : "`Yes \u2014 controlled test + optional AI`",
        "AI"    : "`Yes \u2014 controlled vision`",
        "HUMAN" : "`No / not safely replaceable`",
    }[k], owner_ct[k], {
        "APP"   : "the .exe alone",
        "APP*"  : "the .exe, where the OEM permits it",
        "APP+H" : "the .exe drives, a human supplies the stimulus",
        "AI"    : "the CYVRA AI-Enabled vision agent",
        "HUMAN" : "a technician; the .exe only records the result",
    }[k]))
w("| | **TOTAL** | **114** | |")
w("")
w("---")
w("")
w("## 3. Handshake matrix \u2014 all 114 parameters")
w("")
w("**Column key.** *Today* = what the code does right now: a transcribed summary for rows with a collector, and the product's own reason text read live from source for rows it declines.")
w("*Application / AI agent / Human* = the target split once the plan is executed.")
w("*Gap* = what must still be included. *Tested?* = the honest evidence position.")
w("")
w("| ID | Domain | Parameter | **TODAY \u2014 what the code does** | **APPLICATION (.exe)** | **AI AGENT** | **HUMAN** | **GAP \u2014 must be included** | **TESTED?** | Stage |")
w("|---|---|---|---|---|---|---|---|---|---|")
for (oid, dom, item, today, ap, ai, hu, gp, st, sg, _o) in rows:
    def c(s):
        return s.replace("|", "/").replace("\n", " ")
    w("| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |" % (
        oid, c(dom), c(item), c(today), c(ap), c(ai), c(hu), c(gp), c(st), c(sg)))

w("")
w("---")
w("")
w("## 4. Totals \u2014 the handshake position")
w("")
w("### 4.1 By owner")
w("")
w("| Owner | Count | % of 114 |")
w("|---|---|---|")
for k in ("APP", "APP*", "APP+H", "AI", "HUMAN"):
    w("| %s | %d | %.1f%% |" % (OWNER_LABEL[k], owner_ct[k], 100.0 * owner_ct[k] / 114))
w("| **TOTAL** | **114** | **100%** |")
w("")
w("### 4.2 By evidence position")
w("")
w("| Evidence position | Count |")
w("|---|---|")
for k, v in tested_ct.most_common():
    w("| %s | %d |" % (k, v))
w("")
w("### 4.3 What the numbers mean, in plain terms")
w("")
n_impl   = len(IMPLEMENTED)
n_base   = len(IMPLEMENTED_BASE)
n_stage1 = len(STAGE1)
n_fab    = len(FAB_LIST)
w("> **The product now holds code to collect %d of 114 parameters (%.0f%%), up from %d.**" % (n_impl, 100.0 * n_impl / 114, n_base))
w(">")
w("> **Read that number carefully \u2014 it is not a validation claim.** The %d split three ways:" % n_impl)
w(">")
w("> | Tier | Count | What it means |")
w("> |---|---|---|")
w("> | Code present **before** Stage 1 | %d | product path exists and is unit-tested |" % n_base)
w("> | Added **by Stage 1** | %d | compiles and unit-tested; **zero hardware validation so far** |" % n_stage1)
w("> | Of those, commands independently proven on hardware by Q1 | %d | the *command* works on the device class; our *product path* has not been run on a device |" % len(set(IMPLEMENTED) & Q1_OBTAINABLE))
w("> | **End-to-end product scan validated on hardware** | **0** | **no full scan has yet been run through the product against a real device** |")
w(">")
w("> The plan authorises **%d** of the 114 as collectible by the application alone," % (owner_ct["APP"] + owner_ct["APP*"]))
w("> with no camera and no human.")
w(">")
w("> **All 5 fabrications found on 12-Oct-2026 were removed the same day (Stage 0).** Code")
w("> no longer asserts a measurement it never took. This is reported as a defect that was")
w("> *found and fixed*, not as a feature \u2014 and the removal does not by itself prove the")
w("> replacements are right; they must be measured on hardware in Stage 1 validation.")
w("")
w("---")
w("")
w("## 5. Fabricated measurements \u2014 found and removed")
w("")
w("**Status: REMOVED 12-Oct-2026 (Stage 0).** These were the only places in the production")
w("path where a value was asserted without a measurement. They are recorded here so the")
w("defect is never lost, and so that the *correction* itself can be independently checked.")
w("")
w("| # | Field | Location | What the code did | Disposition | In the ratified 114? |")
w("|---|---|---|---|---|---|")
for i, (oid, field, loc, claim, why, in114) in enumerate(FAB_LIST, 1):
    w("| %d | `%s` | `%s` | %s | %s | %s |" % (
        i, field, loc, claim, why, ("yes \u2014 " + oid) if in114 else "**no \u2014 ad-hoc field**"))
w("")
w("**Second fault, also removed:** `collectSecurity()` substituted `false` when `dumpsys trust`")
w("*failed*, then stamped it `EvidenceStatus.AVAILABLE`. That converted a **failed measurement")
w("into a negative result**. It was the only collector that degraded this way \u2014")
w("`collectBattery()` correctly returned `ERROR` and `collectStorage()` correctly returned")
w("`NOT_AVAILABLE`. A failure now reports `ERROR` with the reason attached.")
w("")
w("**The regression guard:** `AdbGenericEvidenceProviderTest` now contains")
w("`neverSubstitutesAValueWhenTheCommandFails`, which fails the build if any of these four")
w("states ever reports a value from a failed command again. The original test had *pinned* the")
w("fabricated constants, which is why no test could find the defect.")
w("")
w("---")
w("")
w("## 6. Domains measured, end to end")
w("")
w("| Domain | Rows | In place | Missing | Position |")
w("|---|---|---|---|---|")
dom_rows = collections.defaultdict(lambda: [0, 0])
for (oid, dom, *_rest) in rows:
    dom_rows[dom][0] += 1
    if oid in IMPLEMENTED:
        dom_rows[dom][1] += 1
for dom in sorted(dom_rows):
    tot, have = dom_rows[dom]
    if have == tot and tot > 0:
        pos = "complete"
    elif have == 0:
        pos = "**entirely absent**"
    else:
        pos = "partial"
    w("| %s | %d | %d | %d | %s |" % (dom, tot, have, tot - have, pos))
w("| **TOTAL** | **114** | **%d** | **%d** | |" % (n_impl, 114 - n_impl))
w("")
w("---")
w("")
w("## 7. What has genuinely been tested \u2014 and what has not")
w("")
w("The standing rule applies: **unit tests and compilation are not product support.**")
w("Only a measurement that survives independent re-execution counts.")
w("")
w("### 7.1 Genuinely tested \u2014 re-executable evidence exists")
w("")
w("| Claim | Evidence | Re-executable? |")
w("|---|---|---|")
w("| Agent-less acquisition is possible with nothing installed | `docs/CYVRA_AGENTLESS_RESEARCH_Q1_2026-10-12.md` \u2014 63 of 69 probes returned | yes |")
w("| Factory reset erases user data end to end | `docs/CYVRA_FACTORY_RESET_PROOF_2026-10-12.md` \u2014 packages 363\u2192333, contacts 294\u21921, media 288\u219220, accounts 1\u21920, DO refs 4\u21920 | yes |")
w("| The reset was a factory reset, not a reboot | `ro.boot.bootreason = reboot,factory_reset`; boot pinned 11:41:24 from monotonic `/proc/uptime` | yes |")
w("| Device-owner cannot be cleared without a reset | five commands each refused and the refusal recorded | yes |")
w("| WPD read-only plane opens on real hardware | G4/G5 acceptance, Samsung A10s | yes |")
w("| Product collects identity/storage/battery/package fields | `AdbGenericEvidenceProvider.kt` + committed unit tests | code yes; **not hardware-qualified as a product path** |")
w("")
w("### 7.2 NOT tested \u2014 stated as such")
w("")
w("| Area | Honest position |")
w("|---|---|")
w("| **All %d collected parameters, as a product path** | **none has been run end-to-end through the .exe against a real device.** Compilation and unit tests are not product support |" % n_impl)
w("| The %d Stage 1 additions specifically | compiled and unit-tested; **zero hardware validation**; several of their commands were not in Q1's probe set at all |" % n_stage1)
w("| Device-owner detection via `dumpsys device_policy` | **not yet measured since the reset** \u2014 labelled unproven until measured, not assumed |")
w("| Battery temperature conversion | recorded in **device-native units**; the divisor has never been compared against a reference thermometer |")
w("| The remaining %d parameters | no product collection exists |" % (114 - n_impl))
w("| Purge verification | `governed \u00a729` contract remains **unratified**; the bench proof is not a verification contract |")
w("| Physical verification PV-001..PV-017 | protocol exists in the workbook only; no station, no fixtures |")
w("| CYVRA AI-Enabled Grading | not built; depends on Stage 6 station and models |")
w("| SQLite parsing | **none in product code** \u2014 all 280 grep hits are `@types/node` ambient declarations |")
w("| Report export beyond JSON | `ReportGenerator.writeZip()` emits `report.json` + `PROVENANCE.txt` only |")
w("| Any release claim | nothing in this repository is RELEASE-VALIDATED |")
w("")
w("---")
w("")
w("### 7.3 The technician checklist \u2014 complete in process, not in automation")
w("")
w("Thirteen of the 114 are marked in the workbook as `No / not safely replaceable`,")
w("with CYVRA Capability `No` or `Assisted`. Each is a physical or specialist condition")
w("\u2014 a swollen cell, a corroded port, an antenna, a NAND array \u2014 that no collector on")
w("any plane can establish. Rather than leave them absent, they are delivered into the")
w("product as a checklist the .exe presents and records.")
w("")
w("| ID | Check | Priority |")
w("|---|---|---|")
for k in sorted(TechnicianChecklistCatalog_ids):
    d = TechnicianChecklistCatalog_map[k]
    w("| %s | %s | %s |" % (k, d[0], d[1]))
w("")
w("**What the checklist does:**")
w("")
w("- Records that a named technician carried out each check, when, and what they found.")
w("- Attributes every result to `OPERATOR`, by a fixed getter that no constructor can")
w("  override. A human opinion can therefore never be indistinguishable in the report")
w("  from a shell observation \u2014 which is what a fabrication looks like to a reader.")
w("- Treats `NOT_PERFORMED` as **unanswered**, so a checklist nobody worked cannot")
w("  summarise identically to one where a technician found nothing.")
w("- Treats `NOT_APPLICABLE` as a real answer, because a device with no microSD slot is")
w("  not a device that passed a microSD check.")
w("")
w("**What it does not claim:**")
w("")
w("- **No execution has been recorded.** The capability is in the product; the evidence")
w("  is not. Until a technician works a device, these 13 remain untested.")
w("- It does not convert a technician's finding into software evidence, and never will.")
w("- `PHY-001` / `PHY-002` are `Assisted` in the workbook: the application can prompt for")
w("  a press and observe that the input event arrived. That is an **electrical**")
w("  observation. A button that reports while feeling wrong is still a defect, and only")
w("  the technician judges the feel.")
w("- `PUR-007` (NAND cell-level verification) is the one P0. The workbook records its")
w("  evidence type as `Not reliably determinable`, so no software method may claim it.")
w("")
w("---")
w("")
w("## 8. The handshake \u2014 what may and may not be claimed")
w("")
w("**May be claimed today, with the cited evidence:**")
w("")
w("- Agent-less acquisition works, with nothing installed, on the measured device class.")
w("- Factory reset erases user data, proven end to end on real hardware.")
w("- Identity, storage, battery and package inventory are collected by the product.")
w("- IMEI and serial are honestly reported RESTRICTED rather than fabricated.")
w("- No production code path asserts a measurement it did not take \u2014 enforced by a")
w("  regression test that fails the build if it happens again.")
w("")
w("**May NOT be claimed today:**")
w("")
w("- That the .exe covers the 114-parameter plan. It has code for %d." % n_impl)
w("- That those %d are verified. **Zero** have been validated as a product path on hardware." % n_impl)
w("- That the %d Stage 1 additions work at all on a real device. That is the next measurement." % n_stage1)
w("- That removing the fabrications proves their replacements correct. Removal and")
w("  verification are separate acts; only the second one counts.")
w("- That purge is verified. The contract is unratified.")
w("- That grading exists. It is Stage 6, after purge.")
w("- That anything is release-validated.")
w("")
w("---")
w("")
w("*Generated %s by scripts/gen_handshake.py from the two Chief Engineer workbooks"
  % datetime.date.today().isoformat())
w("*plus source reading of the code named in each row. Re-run that script against the*")
w("*workbooks to reproduce every figure above. It exits non-zero if the product's*")
w("*technician checklist and the workbook disagree, so a drifting count cannot publish.*")
w("")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(L))

print("rows:", len(rows))
print("owners:", dict(owner_ct))
print("stages:", dict(stage_ct))
print("tested:", dict(tested_ct))
print("implemented:", n_impl, "  fabrications-removed:", n_fab, "  live-fabrications:", len(FABRICATED))
print("provenance-corrections:", len(PROBE_NOT_MEASURED) + len(Q1_NOT_STATED),
      " (Q1 attribution withdrawn: 9 never measured + 2 never stated)")
print("wrote:", OUT, os.path.getsize(OUT), "bytes")
