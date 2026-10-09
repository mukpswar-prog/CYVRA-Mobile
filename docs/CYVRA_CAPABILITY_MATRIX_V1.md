# CYVRA CAPABILITY MATRIX — v1 SEED (real fixtures)

Status: **v1 SEED — DRAFT, not ratified.** Authority: TASK Q commission, Chief Engineer.
Branch: `feature/core-engine-matrix-v1`. Captured: 09-Oct-2026.
Scope: seed only. This document maps **observed** evidence to the four access planes
and the 22 master diagnostic domains. It creates no product behaviour, installs nothing
and runs no wipe/purge probe.

---

## 1. Authority and vocabulary

| Rule | Source | How this document obeys it |
|---|---|---|
| Four access planes P1–P4 | Governed `CYVRA_CORE_ENGINE_JOURNEY_FINAL_V2_2026-10-08.txt` §2 (Precedence Level 1) | Section 3 |
| 22 master diagnostic domains | Spec §21 | Section 4 — all 22 present, none dropped |
| Capability states `YES / PARTIAL / CONDITIONAL / ASSISTED / NO` | Spec §22 | Used verbatim; never flattened to PASS/FAIL |
| Result vocabulary | Spec §23 | `PASS / NOT TESTED / NOT AVAILABLE / RESTRICTED / PHYSICAL VERIFICATION REQUIRED / …` |
| Identifier rule — never fabricate | Spec §24 | Section 6 register; statuses `NOT COLLECTED / RESTRICTED / NOT AVAILABLE` |
| Purge result principle — claim no more than evidence proves | Spec §29 | Sanitization domain is `NOT TESTED`; no purge claim anywhere |
| No false automation | Spec §82 | `not observable` never becomes `pass`; `not tested` never becomes `fail` |
| Matrix row shape and example IDs | Spec §84 | Section 4 column set follows §84 |
| Evidence confidence (qualitative, no score in V1) | Spec §86 | `FIXTURE` / `OBSERVATION` provenance per row |

**Capability ≠ result.** A domain can be `YES` capable and still `NOT TESTED` in this run,
and a `RESTRICTED` observation is not a `FAIL` (Spec §23).

---

## 2. Fixture inventory (evidence base)

All four sets were produced by `scripts/android-probe/probe.ps1` in READ-ONLY mode:
no install, no input, no screencap, no reboot, no purge. Identifier `getprop` keys
(IMEI / MEID / android_id / MAC / advertising id) are excluded by the harness allowlist.

| Fixture set | Path (relative to repo root) | Files | Bytes | Probe exit |
|---|---|---:|---:|---:|
| Emulator API 36 | `apps/android/core/src/test/fixtures/emulator_api36/` | 13 | 70,879 | 0 |
| Physical State 1 — unlocked, debugging ON | `apps/android/core/src/test/fixtures/physical_api30_arm/state_1_unlocked_debugON/` | 13 | 1,777,635 | 0 |
| Physical State 2 — locked, debugging ON | `apps/android/core/src/test/fixtures/physical_api30_arm/state_2_locked_debugON/` | 13 | 193,059 | 0 |
| Physical State 3 — debugging OFF | `apps/android/core/src/test/fixtures/physical_api30_arm/state_3_debugOFF/` | 13 | 6,368 | **6** (target not usable, evidence retained) |

Each set contains 11 command outputs plus `provenance.txt` (timestamp, ABI, API level,
target kind/state/serial, `degraded_services`) and `manifest.txt` (per-file byte count,
SHA-256, adb exit code).

**Targets**

| | Emulator | Physical |
|---|---|---|
| Target (label only) | `EMULATOR-TARGET` | `PHYSICAL-TARGET` |
| Kind | EMULATOR (`ro.kernel.qemu=1`) | PHYSICAL (`ro.kernel.qemu=0`) |
| Identity | Google / `sdk_gphone64_x86_64` | samsung / `SM-A107F` (Galaxy A10s) |
| API / release | 36 / Android 16 | 30 / Android 11 |
| ABI | x86_64 | armeabi-v7a |
| Fingerprint | `google/sdk_gphone64_x86_64/emu64xa:16/BE2A.250530.026.D1/13818094:user/release-keys` | `samsung/a10sxx/a10s:11/RP1A.200720.012/A107FXXU8CVG2:user/release-keys` |
| Hardware | `ranchu` | `mt6762` / board `mt6765` |
| Resolution / density | 1080×2400 @ 420 dpi | 720×1520 @ 280 dpi |
| Packages listed | 249 | 378 (identical in State 1 and State 2) |
| build.tags / type / ro.debuggable | `release-keys` / `user` / `0` | `release-keys` / `user` / `0` |
| File-based encryption | `true` | `true` |

---

## 3. Plane coverage (governed §2)

| Plane | Consent gate | Scope (governed §2) | Fixture coverage this task | Result |
|---|---|---|---|---|
| **P1 USB/PnP** | none | VID/PID, USB serial string, mfg/product, connect state; nothing internal | **No fixture** — harness is ADB-only | **NOT TESTED** |
| **P2 WPD/MTP** | unlocked | shared-storage volumes + file metadata; locked = empty; no identifiers/props | **No fixture** — no MTP probe in harness | **NOT TESTED** |
| **P3 ADB** | debugging + key accept | getprop, dumpsys battery/display/sensors/wifi/diskstats, `pm list packages`, `df`, `wm size`, …; **no /data/data**; **no non-interactive reset**; **IMEI masked A10+** | **All 4 fixture sets** (10-command battery) | **YES** (States 1–2, emulator) → **NOT AVAILABLE** (State 3) |
| **P4 Companion APK** | install + runtime grants | Camera2 frames, sensors, audio loopback, touch grid, GNSS, Wi-Fi/BT scans; IMEI still restricted A10+; no root | **No fixture** — companion APKs forbidden by mandate | **NOT TESTED** |

Independence rule (docs/ANDROID_COMPATIBILITY_FREEZE.md): *USB presence does not imply ADB;
WPD/MTP visibility does not imply full filesystem access; ADB is optional advanced evidence.*
State 3 is the live demonstration of that rule — see §5.

---

## 4. The 22 master diagnostic domains

`ITEM ID` values marked **[S]** are the ratified examples given in Spec §84/§85.
Values marked **[P]** are **provisional seeds**: the Master Diagnostic Capability Matrix
(the 114-parameter engineering workbook) is not present in this repository, so these IDs
are placeholders pending alignment — see NOTE N-1 in §7. They carry no authority yet.

| # | Domain | ITEM ID | Capability | Plane / source | Evidence type | Result | Evidence reference |
|---:|---|---|---|---|---|---|---|
| 1 | Connection | CON-001 **[S]** | YES (S1/S2/emu) · NO (S3) | P1 + P3 | FIXTURE | PASS · State 3 **NOT AVAILABLE** | `adb_devices.txt` ×4 |
| 2 | Identity | ID-003 **[S]** | YES | P3 | FIXTURE | PASS | `getprop.txt` — model, manufacturer, device, fingerprint, ABI, SDK |
| 3 | Security | SEC-001 **[P]** | PARTIAL | P3 | FIXTURE | CONDITIONAL | FBE `true`, `release-keys`, `user`, `ro.debuggable=0`; lock-screen strength / keystore **NOT TESTED** |
| 4 | Applications | APP-001 **[P]** | YES | P3 | FIXTURE | PASS | `packages.txt` — 249 emu / 378 physical |
| 5 | Hardware | HW-001 **[P]** | PARTIAL | P3 | FIXTURE | PASS (props only) | `ro.hardware`, `ro.board.platform`, `ro.product.*`; component function **NOT TESTED** |
| 6 | Storage | STO-001 **[P]** | YES | P3 | FIXTURE | PASS · CID **NOT AVAILABLE** | `df.txt`, `diskstats.txt`; CID sysfs → `Permission denied` / `No such file` |
| 7 | Battery | BAT-002 **[S]** | YES | P3 | FIXTURE | PASS · swelling **PHYSICAL VERIFICATION REQUIRED** | `battery.txt` — level 100, health 2, status 2/4, temp 250/330/360 |
| 8 | Display | DIS-001 **[P]** | YES | P3 | FIXTURE | PASS | `wm.txt`, `display.txt` — 1080×2400@420 emu, 720×1520@280 physical |
| 9 | Touch | DIS-005 **[S]** | ASSISTED (P3 `input stimulus` exists; P4 touch grid) | P3 + P4 | — | **NOT TESTED** | Input stimulus forbidden by mandate — never `FAIL` (§82) |
| 10 | Camera | CAM-003 **[S]** | ASSISTED (P4 only) | P4 | — | **NOT TESTED** | Companion APK forbidden |
| 11 | Audio | AUD-001 **[P]** | ASSISTED (P4 only) | P4 | — | **NOT TESTED** | Audio loopback needs install |
| 12 | Sensors | SEN-001 **[P]** | YES (unlocked) · **PARTIAL** (locked) | P3 | FIXTURE | PASS · **RESTRICTED** (State 2) | `sensors.txt` — 20 emu / 17 S1 / 16 S2 entries; 9,840 / 92,463 / 12,578 bytes |
| 13 | Biometrics | BIO-001 **[P]** | ASSISTED | P3 + physical | — | **NOT TESTED** · presence **PHYSICAL VERIFICATION REQUIRED** | Not probed; enrolment is user-interactive |
| 14 | Haptics | HAP-001 **[P]** | ASSISTED (P4) | P4 + physical | — | **NOT TESTED** | Not probed |
| 15 | Wi-Fi | WIFI-001 **[P]** | YES (unlocked) · **PARTIAL** (locked) | P3 | FIXTURE | PASS · **RESTRICTED** (State 2) | `wifi.txt` — BSSID hits 656 → 92; scan results 24 → 12; 1,624,151 → 118,399 bytes |
| 16 | Bluetooth | BT-001 **[P]** | NO evidence | P3 (not in allowlist) | — | **NOT TESTED** | `dumpsys bluetooth_manager` outside the read-only allowlist |
| 17 | Cellular | CEL-001 **[P]** | PARTIAL | P3 | FIXTURE | **RESTRICTED** | Radio state not in allowlist; **IMEI masked A10+** (governed §2/§4) |
| 18 | GNSS | GNSS-001 **[P]** | ASSISTED (P4) | P4 | — | **NOT TESTED** | Not probed |
| 19 | Mechanical | PHY-005 **[S]** | **NO** for software | physical | — | **PHYSICAL VERIFICATION REQUIRED** | Spec §82 — frame/corner dents, battery swelling not software-determinable |
| 20 | Performance | PERF-001 **[P]** | PARTIAL | P3 | FIXTURE | **NOT AVAILABLE** | `diskstats.txt` — “Recent Disk Write Speed data unavailable”; read speed captured |
| 21 | System | SYS-001 **[P]** | YES | P3 | FIXTURE | PASS | build props, `df`, `diskstats` |
| 22 | Sanitization | PUR-005 **[S]** | CONDITIONAL (PUR-DO-WIPE) | P3 + P4 | — | **NOT TESTED** | No wipe/purge probe permitted this task; no purge claim made (§29) |

**Coverage summary:** 22/22 domains enumerated · evidence-backed **10** · `NOT TESTED` **9** ·
`PHYSICAL VERIFICATION REQUIRED` **1** (Mechanical) · `NOT AVAILABLE` **1** (Performance) ·
`RESTRICTED` **2** (Cellular identifiers, plus State-2 reductions on Wi-Fi/Sensors).

No domain is recorded as `FAIL`. No `not observable` was converted to `pass` (Spec §82).

---

## 5. State differential (the reason three states were required)

| Signal | State 1 unlocked + debug ON | State 2 locked + debug ON | State 3 debug OFF |
|---|---:|---:|---|
| `adb devices` | `device`, `transport_id:1` | `device`, `transport_id:4` | **empty list** |
| Fixture bytes | 1,777,635 | 193,059 (−89.1%) | 6,368 (−99.6%) |
| Probe exit | 0 | 0 | **6** |
| Wi-Fi BSSID hits | 656 | 92 (−86%) | n/a |
| Wi-Fi scan results | 24 | 12 (−50%) | n/a |
| Sensor entries | 17 | 16 | n/a |
| `sensors.txt` bytes | 92,463 | 12,578 (−86.4%) | 40 (error stub) |
| Packages / `df` / `diskstats` | 14,979 / 824 / 20,942 | **identical** | unavailable |
| Battery temperature | 330 (33.0 °C) | 360 (36.0 °C) | n/a |
| Per-command error | none | none | `adb.exe: device '<SERIAL-REDACTED>' not found` |

**Interpretation**

1. **Locking restricts observability, not storage.** `packages`, `df` and `diskstats` are
   byte-identical between States 1 and 2, while `wifi` and `sensors` shrink by 86–93 %.
   Restricted state is therefore recorded per-domain, not as a blanket device verdict.
2. **Debugging OFF removes the transport entirely.** There is no `unauthorized` and no
   `offline` state to observe: the ADB interface leaves the USB composite device, so the
   blocked reason is `device not found`. Connection and Identity fall to `NOT AVAILABLE`;
   every domain below them is `NOT OBSERVABLE` — which is **not** `FAIL` (Spec §82/§23).
3. **First State-2 capture was a transition artifact, not lock policy.** Locking re-enumerated
   USB (`transport_id` 1 → 4); one attempt caught the device mid-reconnect and recorded
   `target_state=NOT_LISTED` with exit 6. It was superseded by a capture taken under
   verified lock (`mScreenOn=true mScreenLocked=true`, `isKeyguardShowing=true`) and is
   **not** part of this matrix. Recorded here for provenance honesty.

---

## 6. Restricted-state register (Spec §24 / §29 / §82)

| Restricted item | Status (§24 vocabulary) | Source / basis | Observed in fixtures? |
|---|---|---|---|
| **IMEI** | **NOT COLLECTED** | Governed §2 P3 “IMEI masked A10+”; §4 — IMEI is OPERATOR-captured evidence (photo of `*#06#` / sticker / About) with photo reference; no software extraction A10+ | Yes — zero `imei`/`meid` keys in any `getprop.txt` (verified) |
| **Serial number** | **NOT COLLECTED** | Identifier allowlist excludes `serial` | Yes — absent from all `getprop.txt` |
| **MAC / advertising id / android_id** | **NOT COLLECTED** | Identifier allowlist | Yes — absent. Host-side Wi-Fi BSSIDs appear in `wifi.txt` as *scan results*, not as device identifiers |
| **/data/data contents** | **RESTRICTED** | Governed §2 P3 “no /data/data” | Consistent — `df` exposes `/data` **mount statistics** only; no directory contents are read by the battery |
| **Non-interactive reset / purge** | **RESTRICTED** | Governed §2 P3 “no non-interactive reset”; §3 PUR-DO-WIPE is conditional and was not run | No purge probe executed (mandate forbids it) |
| **Storage CID (sysfs)** | **NOT AVAILABLE** | Empirical: `/sys/block/mmcblk0/device/cid` → `Permission denied`; other paths → `No such file or directory` | Yes — all three reachable sets, `RESULT => NOT AVAILABLE` |
| **Wi-Fi scan history, sensor registrations while locked** | **RESTRICTED** | Observed State-1 → State-2 reduction | Yes — see §5 |
| **Cellular radio detail** | **RESTRICTED** | Not in the read-only allowlist | Not captured |

Per §29, no row above is reported as a positive result, and this matrix makes no claim
stronger than the captured evidence proves (no NAND claim, no purge claim, no “device is
perfect” language).

---

## 7. Notes and open items (no silent edits)

- **N-1 — Provisional item IDs.** 15 of 22 `ITEM ID`s are `[P]` seeds. The engineering
  Master Diagnostic Capability Matrix is not in this repository; Spec §84 makes it the
  source for diagnostic semantics. These IDs must be reconciled before ratification.
- **N-2 — P1/P2/P4 have no fixture.** In-session Windows-side enumeration during state
  verification showed the Samsung USB composite device, `SAMSUNG Android ADB Interface`,
  `SAMSUNG Mobile USB Modem`, and WPD entries (`Korwar's A10s` = OK, `MTP USB Device` =
  Unknown). That is **OBSERVATION**, not FIXTURE (Spec §86), is untimestamped in the
  evidence set, and is therefore **not** used to claim P1/P2 capability.
- **N-3 — Provisional IDs are not a matrix revision.** Adding real P1/P2/P4 fixtures and
  reconciling N-1 are prerequisites to moving this from SEED to ratified v1.
- **N-4 — Host dual-key defect (outside product code).** The workstation carries two adb
  key pairs because the persisted user variable `ANDROID_SDK_HOME=C:\Android` points at a
  legacy SDK. The emulator injects `C:\Android\.android\adbkey.pub` while adb signs with
  `C:\Users\User\.android\adbkey`, producing permanent `unauthorized`. Worked around with
  `ADB_VENDOR_KEYS=C:\Android\.android\adbkey`. Host configuration only — no product code
  touched, no key file modified.
- **N-5 — Wi-Fi dump size.** Samsung `dumpsys wifi` returns ~1.6 MB (656 BSSID entries)
  versus 7.8 KB on the emulator. Any ingest path must bound this.
- **N-6 — Fixtures and the TASK O no-egress rule — RESOLVED BY RULING.** TASK Q
  required these fixtures committed and pushed; governed §9 / TASK O records
  *"fixtures stay local; no egress"*. **Chief Engineer ruling, 09-Oct-2026:**
  this repository is **PUBLIC**, so the privacy-maximal path applies — all fixture
  **content** stays in the local evidence locker and the `.gitignore` exclusion is
  **not** lifted. Option 2 (push all except `wifi.txt`) was **REJECTED**: a
  378-app inventory is personal-data egress (DPDP Act 2023), not merely MAC-class.
  Commitment is made at **metadata level** via `fixtures/MANIFEST.md` — path, bytes
  and SHA-256 for all 52 files (2,047,941 bytes), with `wifi.txt` and `packages.txt`
  marked *withheld — no egress*. Device serials appear **only** in local provenance
  headers; they are redacted from every file that egresses.
  **STANDING RULE ADDED:** real-device fixture content never egresses. Synthetic
  emulator fixtures may be considered for commit later **only** after a
  zero-identifier privacy scan **and** explicit Chief Engineer approval.

---

*End of document — CYVRA CAPABILITY MATRIX v1 SEED.*
