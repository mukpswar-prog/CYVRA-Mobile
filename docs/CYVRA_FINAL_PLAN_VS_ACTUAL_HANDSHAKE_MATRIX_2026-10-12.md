# CYVRA — FINAL PLAN-vs-ACTUAL HANDSHAKE MATRIX

**Purpose:** the single row-and-column record of the 114 ratified diagnostic
parameters, showing what the product does today, what the application will do,
what the AI agent does, what the human verifies, what is still missing, and what
has genuinely been tested versus what has not.

**Status:** DRAFT for Chief Engineer handshake · **Date:** 12-Oct-2026
**Authority:** Chief Engineer instruction, 12-Oct-2026 · **Governing holds:** ledger H1–H8

> **This document may not be used to claim the .exe is complete.** It exists so
> that the handshake is made against measured facts rather than intent. In
> particular, *implemented* and *validated* are separate columns here — code that
> compiles and passes unit tests has not thereby been run on a device.

---

## 1. Method — how every row below was produced

| Step | Method | Reproducible? |
|---|---|---|
| The 114 parameters, domains, capability and evidence type | read directly from `CYVRA_Mobile_Diagnostic_vs_Physical_Verification_Matrix.xlsx` → `Capability Matrix` | yes — open the workbook |
| Owner (Application / AI / Human) | derived from the Chief Engineer's own `AI/Camera Automation` column in `Automation Impact Matrix` | yes — rules in §2 |
| Today's code state | transcribed from source on 12-Oct-2026 for rows that have a collector; **read live** from `AdbExtendedEvidenceProvider.kt` for every row the provider declines | yes — open the files |
| Tested / not tested | `docs/CYVRA_AGENTLESS_RESEARCH_Q1_2026-10-12.md` + `docs/CYVRA_FACTORY_RESET_PROOF_2026-10-12.md` | yes — both are committed |

No row in this table was invented. Two mechanisms produce the *Today* column and they differ in strength: a row that has a collector carries a summary transcribed from source on 12-Oct-2026, which can drift if the code changes afterwards; a row the provider declines carries the product's own reason text, read from that source every time this matrix is generated, so it cannot drift. Where the two disagree, the source wins.

---

## 2. Ownership model — the four hands

The Chief Engineer's workbook already answers *who does each job*. These are its
own words, not mine:

| Owner | Workbook's own label | Count | Meaning |
|---|---|---|---|
| **Application alone** | `Yes — deterministic software test` / `status only` / `No` (AI not needed) | 61 | the .exe alone |
| **Application (OEM-conditional)** | `Conditional / assisted` | 12 | the .exe, where the OEM permits it |
| **Application + human stimulus** | `Yes — controlled test + optional AI` | 17 | the .exe drives, a human supplies the stimulus |
| **AI vision agent** | `Yes — controlled vision` | 10 | the CYVRA AI-Enabled vision agent |
| **Human / specialist** | `No / not safely replaceable` | 14 | a technician; the .exe only records the result |
| | **TOTAL** | **114** | |

---

## 3. Handshake matrix — all 114 parameters

**Column key.** *Today* = what the code does right now: a transcribed summary for rows with a collector, and the product's own reason text read live from source for rows it declines.
*Application / AI agent / Human* = the target split once the plan is executed.
*Gap* = what must still be included. *Tested?* = the honest evidence position.

| ID | Domain | Parameter | **TODAY — what the code does** | **APPLICATION (.exe)** | **AI AGENT** | **HUMAN** | **GAP — must be included** | **TESTED?** | Stage |
|---|---|---|---|---|---|---|---|---|---|
| CON-001 | Connection | USB device detection | Windows USB/PnP plane observes the device (desktop observer, hardware-validated) | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — in place | TESTED — data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run | Stage 1 |
| CON-002 | Connection | ADB availability | ADB reachability established before any shell is issued | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — in place | TESTED — data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run | Stage 1 |
| CON-003 | Connection | ADB authorization | ADB authorisation state is a distinct, separately-held state | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — in place | TESTED — data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run | Stage 1 |
| CON-004 | Connection | Session stability | not collected | Drives the stimulus and records the response | Optional defect assist on captured frames | Places device, supplies stimulus/fixture | Requires controlled fixture + operator handling (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (fixture) |
| CON-005 | Connection | USB data vs charge-only behavior | not collected | Drives the stimulus and records the response | Optional defect assist on captured frames | Places device, supplies stimulus/fixture | Requires controlled fixture + operator handling (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (fixture) |
| CON-006 | Connection | USB port physical damage | not collected | Records the AI finding + confidence; never invents one | Detects + localises the defect from controlled frames | Reviews low-confidence / occluded frames only | Requires inspection station + model (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (vision) |
| ID-001 | Identity | Manufacturer | getprop ro.product.manufacturer | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — in place | TESTED — data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run | Stage 1 |
| ID-002 | Identity | Brand | getprop ro.product.brand | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — in place | UNIT-TESTED only — product path exists; NOT device-run | Stage 1 |
| ID-003 | Identity | Model / model code | getprop ro.product.model | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — in place | TESTED — data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run | Stage 1 |
| ID-004 | Identity | Android version / API level | getprop ro.build.version.release + ro.build.version.sdk | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — in place | TESTED — data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run | Stage 1 |
| ID-005 | Identity | Build ID / fingerprint where permitted | getprop ro.build.id + ro.build.fingerprint (fingerprint added in Stage 1) | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | BAT-006 still reports a health string, not a wear estimate | TESTED — data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run | Stage 1 |
| ID-006 | Identity | Security patch level | getprop ro.build.version.security_patch | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — in place | UNIT-TESTED only — product path exists; NOT device-run | Stage 1 |
| ID-007 | Identity | IMEI | recorded honestly as RESTRICTED (no value asserted) | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — in place | UNIT-TESTED only — product path exists; NOT device-run | Stage 1 |
| ID-008 | Identity | Device serial | recorded honestly as RESTRICTED (no value asserted) | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — in place | UNIT-TESTED only — product path exists; NOT device-run | Stage 1 |
| ID-009 | Identity | Android/app-scoped ID | settings get secure android_id | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — in place | TESTED — data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run | Stage 1 |
| SEC-001 | Security | Screen lock state | dumpsys trust -> deviceLocked/currentUserIsSecure | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — in place | TESTED — data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run | Stage 1 |
| SEC-002 | Security | USB debugging state | **Stage 1** settings get global adb_enabled  (was fabricated) | Collects where OEM/version permits; else reports NOT_AVAILABLE | – | Guided exception when the OEM blocks it | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 (conditional) |
| SEC-003 | Security | Encryption status where exposed | **Stage 1** getprop ro.crypto.state | Collects where OEM/version permits; else reports NOT_AVAILABLE | – | Guided exception when the OEM blocks it | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 (conditional) |
| SEC-004 | Security | Bootloader state where legitimately exposed | **Stage 1** getprop ro.boot.verifiedbootstate  (was fabricated) | Collects where OEM/version permits; else reports NOT_AVAILABLE | – | Guided exception when the OEM blocks it | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 (conditional) |
| SEC-005 | Security | FRP/account/setup state | **Stage 1** dumpsys device_policy -> device-owner component  (was fabricated AND was wrong) | Collects where OEM/version permits; else reports NOT_AVAILABLE | – | Guided exception when the OEM blocks it | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 (conditional) |
| APP-001 | Applications | Installed package inventory | pm list packages -U via AdbApplicationInventoryProvider | Collects where OEM/version permits; else reports NOT_AVAILABLE | – | Guided exception when the OEM blocks it | None — in place | TESTED — data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run | Stage 1 (conditional) |
| APP-002 | Applications | App version inventory | **Stage 1** dumpsys package versionName over a bounded sample of 25 packages | Collects where OEM/version permits; else reports NOT_AVAILABLE | – | Guided exception when the OEM blocks it | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 (conditional) |
| HW-001 | Hardware | CPU model / architecture | **Stage 1** getprop ro.board.platform | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| HW-002 | Hardware | CPU core count | **Stage 1** count of `processor` entries in /proc/cpuinfo | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| HW-003 | Hardware | CPU frequency observation | **Stage 1** cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq | Collects where OEM/version permits; else reports NOT_AVAILABLE | – | Guided exception when the OEM blocks it | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 (conditional) |
| HW-004 | Hardware | Installed/visible RAM | **Stage 1** MemTotal from /proc/meminfo | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| HW-005 | Hardware | RAM spot/stress test | **In evidence path** — emits `NOT_AVAILABLE` with value null and the reason the product itself records: "requires a controlled memory-stimulus harness on the workstation; it is not a passive shell reading" | Collects where OEM/version permits; else reports NOT_AVAILABLE | – | Guided exception when the OEM blocks it | Collector in place and emitting an honest `NOT_AVAILABLE` — the value itself is still not obtained | NOT TESTED | Stage 1 (conditional) |
| STO-001 | Storage | Internal storage capacity | df -k /data -> total bytes | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — in place | TESTED — data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run | Stage 1 |
| STO-002 | Storage | Used/free storage | df -k /data -> available bytes | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — in place | TESTED — data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run | Stage 1 |
| STO-003 | Storage | Storage read/write responsiveness | **In evidence path** — emits `NOT_AVAILABLE` with value null and the reason the product itself records: "requires a controlled read/write stimulus; a passive shell call cannot establish throughput" | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place and emitting an honest `NOT_AVAILABLE` — the value itself is still not obtained | NOT IMPLEMENTED — probe obtainability NOT measured for this parameter; the product emits NOT_AVAILABLE with a stated reason rather than a value | Stage 1 |
| STO-004 | Storage | NAND health/wear | **In evidence path** — emits `NOT_AVAILABLE` with value null and the reason the product itself records: "NAND wear counters are privileged manufacturer diagnostics and are not exposed through ADB" | Collects where OEM/version permits; else reports NOT_AVAILABLE | – | Guided exception when the OEM blocks it | Collector in place and emitting an honest `NOT_AVAILABLE` — the value itself is still not obtained | NOT TESTED | Stage 1 (conditional) |
| BAT-001 | Battery | Battery present / state | dumpsys battery -> present/state | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — in place | TESTED — data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run | Stage 1 |
| BAT-002 | Battery | Battery percentage | dumpsys battery -> level: | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — in place | TESTED — data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run | Stage 1 |
| BAT-003 | Battery | Charging state | dumpsys battery -> AC/USB powered: | Drives the stimulus and records the response | Optional defect assist on captured frames | Places device, supplies stimulus/fixture | Basic reading in place; controlled-stimulus test awaits the Stage 6 fixture | TESTED — data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run | Stage 6 (fixture) |
| BAT-004 | Battery | Battery temperature | **Stage 1** temperature: from dumpsys battery (device-native units; divisor not yet measured) | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| BAT-005 | Battery | Full-charge/design capacity | not collected | Drives the stimulus and records the response | Optional defect assist on captured frames | Places device, supplies stimulus/fixture | Requires controlled fixture + operator handling (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (fixture) |
| BAT-006 | Battery | Battery health/wear estimate | dumpsys battery -> health:  (a health string, not a wear estimate) | Drives the stimulus and records the response | Optional defect assist on captured frames | Places device, supplies stimulus/fixture | BAT-006 still reports a health string, not a wear estimate | TESTED — data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run | Stage 6 (fixture) |
| BAT-007 | Battery | Battery swelling | not collected | Records the technician's result; never converts it to software evidence | – | Performs the physical or specialist check | Checklist delivered in product — awaiting technician execution; recorded as an OPERATOR attestation, never as software evidence | CHECKLIST IN PRODUCT — technician attestation recorded; **no execution recorded yet** | Stage 6 (protocol) |
| BAT-008 | Battery | Charging connector looseness | not collected | Records the technician's result; never converts it to software evidence | – | Performs the physical or specialist check | Checklist delivered in product — awaiting technician execution; recorded as an OPERATOR attestation, never as software evidence | CHECKLIST IN PRODUCT — technician attestation recorded; **no execution recorded yet** | Stage 6 (protocol) |
| DIS-001 | Display | Display presence/logical display | **Stage 1** dumpsys display -> mDisplayId | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| DIS-002 | Display | Resolution | **Stage 1** wm size | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| DIS-003 | Display | Refresh rate | **Stage 1** dumpsys display -> fps | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| DIS-004 | Display | Brightness control response | not collected | Drives the stimulus and records the response | Optional defect assist on captured frames | Places device, supplies stimulus/fixture | Requires controlled fixture + operator handling (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (fixture) |
| DIS-005 | Touch | Touch grid / edge response | not collected | Drives the stimulus and records the response | Optional defect assist on captured frames | Places device, supplies stimulus/fixture | Requires controlled fixture + operator handling (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (fixture) |
| DIS-006 | Touch | Multi-touch | not collected | Drives the stimulus and records the response | Optional defect assist on captured frames | Places device, supplies stimulus/fixture | Requires controlled fixture + operator handling (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (fixture) |
| DIS-007 | Display | Dead/stuck pixels | not collected | Records the AI finding + confidence; never invents one | Detects + localises the defect from controlled frames | Reviews low-confidence / occluded frames only | Requires inspection station + model (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (vision) |
| DIS-008 | Display | Burn-in/image retention | not collected | Records the AI finding + confidence; never invents one | Detects + localises the defect from controlled frames | Reviews low-confidence / occluded frames only | Requires inspection station + model (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (vision) |
| DIS-009 | Display | Cracked/chipped glass | not collected | Records the AI finding + confidence; never invents one | Detects + localises the defect from controlled frames | Reviews low-confidence / occluded frames only | Requires inspection station + model (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (vision) |
| DIS-010 | Display | Panel uniformity | **In evidence path** — emits `NOT_AVAILABLE` with value null and the reason the product itself records: "requires controlled display patterns and optical capture; no shell reading establishes uniformity" | Collects where OEM/version permits; else reports NOT_AVAILABLE | – | Guided exception when the OEM blocks it | Collector in place and emitting an honest `NOT_AVAILABLE` — the value itself is still not obtained | NOT TESTED | Stage 1 (conditional) |
| CAM-001 | Camera | Camera enumeration | **Stage 1** dumpsys media.camera -> camera-device count heading | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| CAM-002 | Camera | Camera initialization | **In evidence path** — emits `NOT_AVAILABLE` with value null and the reason the product itself records: "initialisation requires an application to open the camera HAL; not observable passively" | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place and emitting an honest `NOT_AVAILABLE` — the value itself is still not obtained | NOT IMPLEMENTED — probe obtainability NOT measured for this parameter; the product emits NOT_AVAILABLE with a stated reason rather than a value | Stage 1 |
| CAM-003 | Camera | Live preview/frame delivery | **In evidence path** — emits `NOT_AVAILABLE` with value null and the reason the product itself records: "frame delivery requires an application to open the camera HAL; not observable passively" | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place and emitting an honest `NOT_AVAILABLE` — the value itself is still not obtained | NOT IMPLEMENTED — probe obtainability NOT measured for this parameter; the product emits NOT_AVAILABLE with a stated reason rather than a value | Stage 1 |
| CAM-004 | Camera | Autofocus behavior | not collected | Drives the stimulus and records the response | Optional defect assist on captured frames | Places device, supplies stimulus/fixture | Requires controlled fixture + operator handling (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (fixture) |
| CAM-005 | Camera | Torch/flash activation | not collected | Drives the stimulus and records the response | Optional defect assist on captured frames | Places device, supplies stimulus/fixture | Requires controlled fixture + operator handling (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (fixture) |
| CAM-006 | Camera | Lens glass condition | not collected | Records the AI finding + confidence; never invents one | Detects + localises the defect from controlled frames | Reviews low-confidence / occluded frames only | Requires inspection station + model (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (vision) |
| CAM-007 | Camera | Image quality/haze/artifacts | not collected | Drives the stimulus and records the response | Optional defect assist on captured frames | Places device, supplies stimulus/fixture | Requires controlled fixture + operator handling (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (fixture) |
| AUD-001 | Audio | Speaker playback path | **Stage 1** ls /proc/asound (path presence only) | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| AUD-002 | Audio | Speaker distortion/weakness | not collected | Records the technician's result; never converts it to software evidence | – | Performs the physical or specialist check | Checklist delivered in product — awaiting technician execution; recorded as an OPERATOR attestation, never as software evidence | CHECKLIST IN PRODUCT — technician attestation recorded; **no execution recorded yet** | Stage 6 (protocol) |
| AUD-003 | Audio | Microphone input path | **Stage 1** ls /proc/asound (path presence only) | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| AUD-004 | Audio | Microphone distortion/noise | not collected | Drives the stimulus and records the response | Optional defect assist on captured frames | Places device, supplies stimulus/fixture | Requires controlled fixture + operator handling (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (fixture) |
| AUD-005 | Audio | Headphone jack function where present | not collected | Drives the stimulus and records the response | Optional defect assist on captured frames | Places device, supplies stimulus/fixture | Requires controlled fixture + operator handling (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (fixture) |
| SEN-001 | Sensors | Accelerometer | **Stage 1** dumpsys sensorservice -> accelerometer entry | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| SEN-002 | Sensors | Gyroscope | **Stage 1** dumpsys sensorservice -> gyroscope entry | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| SEN-003 | Sensors | Magnetometer/compass | **Stage 1** dumpsys sensorservice -> magnetometer entry | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| SEN-004 | Sensors | Proximity sensor | **Stage 1** dumpsys sensorservice -> proximity entry | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| SEN-005 | Sensors | Ambient light sensor | **Stage 1** dumpsys sensorservice -> light entry | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| SEN-006 | Sensors | Barometer | **Stage 1** dumpsys sensorservice -> barometer entry | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| BIO-001 | Biometrics | Fingerprint capability/state | not collected | Drives the stimulus and records the response | Optional defect assist on captured frames | Places device, supplies stimulus/fixture | Requires controlled fixture + operator handling (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (fixture) |
| BIO-002 | Biometrics | Fingerprint sensor surface condition | not collected | Records the technician's result; never converts it to software evidence | – | Performs the physical or specialist check | Checklist delivered in product — awaiting technician execution; recorded as an OPERATOR attestation, never as software evidence | CHECKLIST IN PRODUCT — technician attestation recorded; **no execution recorded yet** | Stage 6 (protocol) |
| HAP-001 | Haptics | Vibration command/response | **Stage 1** service list -> vibrator service | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| WIFI-001 | Wi-Fi | Wi-Fi capability/state | **Stage 1** dumpsys wifi -> Wi-Fi state | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| WIFI-002 | Wi-Fi | Wi-Fi scan/discovery | **Stage 1** dumpsys wifi -> count of scan-result access points | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| WIFI-003 | Wi-Fi | Connection to controlled AP | **In evidence path** — emits `NOT_AVAILABLE` with value null and the reason the product itself records: "requires a controlled access point on the bench; not a passive reading" | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place and emitting an honest `NOT_AVAILABLE` — the value itself is still not obtained | NOT IMPLEMENTED — probe obtainability NOT measured for this parameter; the product emits NOT_AVAILABLE with a stated reason rather than a value | Stage 1 |
| WIFI-004 | Wi-Fi | Signal/link quality | **In evidence path** — emits `NOT_AVAILABLE` with value null and the reason the product itself records: "link quality requires an associated session with a controlled AP; not a passive reading" | Collects where OEM/version permits; else reports NOT_AVAILABLE | – | Guided exception when the OEM blocks it | Collector in place and emitting an honest `NOT_AVAILABLE` — the value itself is still not obtained | NOT TESTED | Stage 1 (conditional) |
| BT-001 | Bluetooth | Bluetooth capability/state | **Stage 1** settings get global bluetooth_on | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| BT-002 | Bluetooth | Discovery scan | **In evidence path** — emits `NOT_AVAILABLE` with value null and the reason the product itself records: "requires the operator to authorise a discovery window; not a passive reading" | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place and emitting an honest `NOT_AVAILABLE` — the value itself is still not obtained | NOT IMPLEMENTED — probe obtainability NOT measured for this parameter; the product emits NOT_AVAILABLE with a stated reason rather than a value | Stage 1 |
| BT-003 | Bluetooth | Pair/connect to known-good fixture | **In evidence path** — emits `NOT_AVAILABLE` with value null and the reason the product itself records: "requires a controlled fixture and operator-supplied pairing consent" | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place and emitting an honest `NOT_AVAILABLE` — the value itself is still not obtained | NOT IMPLEMENTED — probe obtainability NOT measured for this parameter; the product emits NOT_AVAILABLE with a stated reason rather than a value | Stage 1 |
| CELL-001 | Cellular | Modem/radio capability | **Stage 1** getprop ro.telephony.default_network | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| CELL-002 | Cellular | SIM detected | **Stage 1** getprop gsm.sim.state | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| CELL-003 | Cellular | Network registration | **Stage 1** dumpsys telephony.registry -> mServiceState | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| CELL-004 | Cellular | Mobile data path | **Stage 1** settings get global mobile_data | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| CELL-005 | Cellular | RF/antenna performance | **In evidence path** — emits `NOT_AVAILABLE` with value null and the reason the product itself records: "requires a specialist RF fixture; antenna performance is never inferable from software" | Records the technician's result; never converts it to software evidence | – | Performs the physical or specialist check | Collector in place and emitting an honest `NOT_AVAILABLE` — the value itself is still not obtained | CHECKLIST IN PRODUCT — technician attestation recorded; **no execution recorded yet** | Stage 6 (protocol) |
| GNSS-001 | GNSS | GNSS capability | **Stage 1** pm list features -> android.hardware.location.gps | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| GNSS-002 | GNSS | GNSS fix acquisition | **In evidence path** — emits `NOT_AVAILABLE` with value null and the reason the product itself records: "requires sky view and a dwell period under controlled conditions; not a passive reading" | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place and emitting an honest `NOT_AVAILABLE` — the value itself is still not obtained | NOT IMPLEMENTED — probe obtainability NOT measured for this parameter; the product emits NOT_AVAILABLE with a stated reason rather than a value | Stage 1 |
| PHY-001 | Mechanical | Power button tactile function | not collected | Records the technician's result; never converts it to software evidence | – | Performs the physical or specialist check | Checklist delivered in product — awaiting technician execution; recorded as an OPERATOR attestation, never as software evidence | CHECKLIST IN PRODUCT — technician attestation recorded; **no execution recorded yet** | Stage 6 (protocol) |
| PHY-002 | Mechanical | Volume buttons tactile function | not collected | Records the technician's result; never converts it to software evidence | – | Performs the physical or specialist check | Checklist delivered in product — awaiting technician execution; recorded as an OPERATOR attestation, never as software evidence | CHECKLIST IN PRODUCT — technician attestation recorded; **no execution recorded yet** | Stage 6 (protocol) |
| PHY-003 | Mechanical | USB connector mechanical fit | not collected | Records the technician's result; never converts it to software evidence | – | Performs the physical or specialist check | Checklist delivered in product — awaiting technician execution; recorded as an OPERATOR attestation, never as software evidence | CHECKLIST IN PRODUCT — technician attestation recorded; **no execution recorded yet** | Stage 6 (protocol) |
| PHY-004 | Mechanical | USB port debris/corrosion | not collected | Records the technician's result; never converts it to software evidence | – | Performs the physical or specialist check | Checklist delivered in product — awaiting technician execution; recorded as an OPERATOR attestation, never as software evidence | CHECKLIST IN PRODUCT — technician attestation recorded; **no execution recorded yet** | Stage 6 (protocol) |
| PHY-005 | Mechanical | Frame/corner dents | not collected | Records the AI finding + confidence; never invents one | Detects + localises the defect from controlled frames | Reviews low-confidence / occluded frames only | Requires inspection station + model (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (vision) |
| PHY-006 | Mechanical | Back cover cracks/lift | not collected | Records the AI finding + confidence; never invents one | Detects + localises the defect from controlled frames | Reviews low-confidence / occluded frames only | Requires inspection station + model (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (vision) |
| PHY-007 | Mechanical | Liquid/corrosion evidence | not collected | Records the AI finding + confidence; never invents one | Detects + localises the defect from controlled frames | Reviews low-confidence / occluded frames only | Requires inspection station + model (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (vision) |
| PHY-008 | Mechanical | SIM tray/slot integrity | not collected | Records the technician's result; never converts it to software evidence | – | Performs the physical or specialist check | Checklist delivered in product — awaiting technician execution; recorded as an OPERATOR attestation, never as software evidence | CHECKLIST IN PRODUCT — technician attestation recorded; **no execution recorded yet** | Stage 6 (protocol) |
| PHY-009 | Mechanical | microSD slot integrity where present | not collected | Records the technician's result; never converts it to software evidence | – | Performs the physical or specialist check | Checklist delivered in product — awaiting technician execution; recorded as an OPERATOR attestation, never as software evidence | CHECKLIST IN PRODUCT — technician attestation recorded; **no execution recorded yet** | Stage 6 (protocol) |
| PHY-010 | Mechanical | Wireless charging function where supported | not collected | Drives the stimulus and records the response | Optional defect assist on captured frames | Places device, supplies stimulus/fixture | Requires controlled fixture + operator handling (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (fixture) |
| PHY-011 | Mechanical | Sustained charging rate | not collected | Drives the stimulus and records the response | Optional defect assist on captured frames | Places device, supplies stimulus/fixture | Requires controlled fixture + operator handling (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (fixture) |
| PHY-012 | Mechanical | Speaker grille/mesh condition | not collected | Records the AI finding + confidence; never invents one | Detects + localises the defect from controlled frames | Reviews low-confidence / occluded frames only | Requires inspection station + model (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (vision) |
| PHY-013 | Mechanical | Chassis deformation | not collected | Records the AI finding + confidence; never invents one | Detects + localises the defect from controlled frames | Reviews low-confidence / occluded frames only | Requires inspection station + model (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (vision) |
| PHY-014 | Mechanical | Water-resistance/IP seal integrity | not collected | Records the technician's result; never converts it to software evidence | – | Performs the physical or specialist check | Checklist delivered in product — awaiting technician execution; recorded as an OPERATOR attestation, never as software evidence | CHECKLIST IN PRODUCT — technician attestation recorded; **no execution recorded yet** | Stage 6 (protocol) |
| PHY-015 | Mechanical | Internal screws/fasteners condition | not collected | Records the technician's result; never converts it to software evidence | – | Performs the physical or specialist check | Checklist delivered in product — awaiting technician execution; recorded as an OPERATOR attestation, never as software evidence | CHECKLIST IN PRODUCT — technician attestation recorded; **no execution recorded yet** | Stage 6 (protocol) |
| PERF-001 | Performance | CPU workload response | **In evidence path** — emits `NOT_AVAILABLE` with value null and the reason the product itself records: "requires a controlled workload stimulus applied by the workstation" | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place and emitting an honest `NOT_AVAILABLE` — the value itself is still not obtained | NOT IMPLEMENTED — probe obtainability NOT measured for this parameter; the product emits NOT_AVAILABLE with a stated reason rather than a value | Stage 1 |
| PERF-002 | Performance | Memory pressure behavior | **Stage 1** MemAvailable vs MemTotal from /proc/meminfo | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| PERF-003 | Performance | Storage I/O responsiveness | **In evidence path** — emits `NOT_AVAILABLE` with value null and the reason the product itself records: "requires a controlled read/write stimulus applied by the workstation" | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place and emitting an honest `NOT_AVAILABLE` — the value itself is still not obtained | NOT IMPLEMENTED — probe obtainability NOT measured for this parameter; the product emits NOT_AVAILABLE with a stated reason rather than a value | Stage 1 |
| PERF-004 | Performance | Boot/reboot completion | **Stage 1** getprop sys.boot_completed | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| PERF-005 | Performance | Thermal throttling behavior | not collected | Drives the stimulus and records the response | Optional defect assist on captured frames | Places device, supplies stimulus/fixture | Requires controlled fixture + operator handling (Stage 6) | NOT TESTED — requires station/fixture that does not exist yet | Stage 6 (fixture) |
| SYS-001 | System | Date/time/timezone | **Stage 1** date -u + getprop persist.sys.timezone | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| SYS-002 | System | Locale/language | **Stage 1** getprop persist.sys.locale | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| SYS-003 | System | Screen-on/power/display state | **Stage 1** dumpsys power -> mWakefulness or Display Power state | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | Collector in place — **must be validated against real hardware, then re-measured** | IMPLEMENTED (Stage 1) — compiles + unit-tested; **NOT validated on hardware** | Stage 1 |
| PUR-001 | Sanitization | Purge capability assessment | HostSanitizationProvider.assessCapability(DeviceCapabilityAssessment) -> SanitizationMethodType; exercised by the workflow tests | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — capability assessment in place; **not yet run through the product against hardware** | UNIT-TESTED only — product path exists; NOT device-run | Stage 1 |
| PUR-002 | Sanitization | Purge authorization | 2-step authorization barrier (requestAuthorization + toggleStep1Acknowledgement/submitStep2Confirmation); preventsExecutionWithoutSatisfying2StepConfirmationBarrier | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — authorization barrier in place; **not yet run through the product against hardware** | UNIT-TESTED only — product path exists; NOT device-run | Stage 1 |
| PUR-003 | Sanitization | Supported purge/reset method | HostSanitizationWorkflowEngine.selectMethod() behind the barrier; exercised by executesPurgeAndVerifiesPostResetReconnection | Collects where OEM/version permits; else reports NOT_AVAILABLE | – | Guided exception when the OEM blocks it | None — method selection in place; **not yet run through the product against hardware** | TESTED on bench (hardware) — re-executable proof exists | Stage 1 (conditional) |
| PUR-004 | Sanitization | Purge execution/reboot completion | HostDestructiveWipeProvider.preflight() + trigger() bound into execute(): pre-flight reads agent presence and device-owner state, then issues the 12-Oct wipe broadcast; refuses honestly when the agent is absent, not enrolled, or unreadable | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None for the agent-based route — execution is bound and gated behind the offline entitlement, operator acknowledgement, typed phrase and a device pre-flight. Purge remains agent-based: a device without the enrolled CYVRA agent is refused rather than silently failing, and the agent-less route is still unproven for erase | TESTED on bench (hardware) — re-executable proof exists | Stage 1 |
| PUR-005 | Sanitization | Post-purge state | verifyPostReset(); returns PARTIALLY_VERIFIED or REQUIRES_EXTERNAL_VERIFICATION, never VERIFIED (WP-1b fix) | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None — post-reset verification in place and deliberately declines to claim erasure; residual counts still require PUR-006 | TESTED on bench (hardware) — re-executable proof exists | Stage 1 |
| PUR-006 | Sanitization | Residual user-data evidence through supported paths | HostVerificationProvider.residualInventory() inside verifyPostReset(): `pm list packages` and `pm list packages -3` counted into residualTotal/ThirdParty/CyvraPackages on VerificationResult, each null when not established; account/contact/media counts still declined | Collects, attributes to ANDROID_ADB, reports state honestly | – | None | None for applications — residual package counts are taken inside `verifyPostReset()` and reported on `VerificationResult`. Account, contact and media counts remain outside the supported command set and are still disclosed as not measured | TESTED on bench (hardware) — re-executable proof exists | Stage 1 |
| PUR-007 | Sanitization | Physical NAND cell-level verification | not collected | Records the technician's result; never converts it to software evidence | – | Performs the physical or specialist check | Checklist delivered in product — awaiting technician execution; recorded as an OPERATOR attestation, never as software evidence | CHECKLIST IN PRODUCT — technician attestation recorded; **no execution recorded yet** | Stage 6 (protocol) |

---

## 4. Totals — the handshake position

### 4.1 By owner

| Owner | Count | % of 114 |
|---|---|---|
| Application alone | 61 | 53.5% |
| Application (OEM-conditional) | 12 | 10.5% |
| Application + human stimulus | 17 | 14.9% |
| AI vision agent | 10 | 8.8% |
| Human / specialist | 14 | 12.3% |
| **TOTAL** | **114** | **100%** |

### 4.2 By evidence position

| Evidence position | Count |
|---|---|
| IMPLEMENTED (Stage 1) - NOT validated on hardware | 36 |
| NOT TESTED | 29 |
| TESTED (data class returned on hardware by Q1; per-parameter command not recorded; product path unit-tested, NOT device-run) | 16 |
| CHECKLIST IN PRODUCT — technician attestation recorded; **no execution recorded yet** | 14 |
| NOT IMPLEMENTED | 9 |
| UNIT-TESTED only (NOT device-run) | 6 |
| TESTED on bench (hardware) | 4 |

### 4.3 What the numbers mean, in plain terms

> **The product now holds code to collect 62 of 114 parameters (54%), up from 26.**
>
> **Read that number carefully — it is not a validation claim.** The 62 split three ways:
>
> | Tier | Count | What it means |
> |---|---|---|
> | Code present **before** Stage 1 | 26 | product path exists and is unit-tested |
> | Added **by Stage 1** | 36 | compiles and unit-tested; **zero hardware validation so far** |
> | Of those, commands independently proven on hardware by Q1 | 50 | the *command* works on the device class; our *product path* has not been run on a device |
> | **End-to-end product scan validated on hardware** | **0** | **no full scan has yet been run through the product against a real device** |
>
> The plan authorises **73** of the 114 as collectible by the application alone,
> with no camera and no human.
>
> **All 5 fabrications found on 12-Oct-2026 were removed the same day (Stage 0).** Code
> no longer asserts a measurement it never took. This is reported as a defect that was
> *found and fixed*, not as a feature — and the removal does not by itself prove the
> replacements are right; they must be measured on hardware in Stage 1 validation.

---

## 5. Fabricated measurements — found and removed

**Status: REMOVED 12-Oct-2026 (Stage 0).** These were the only places in the production
path where a value was asserted without a measurement. They are recorded here so the
defect is never lost, and so that the *correction* itself can be independently checked.

| # | Field | Location | What the code did | Disposition | In the ratified 114? |
|---|---|---|---|---|---|
| 1 | `adbEnabled` | `AdbGenericEvidenceProvider.kt:158` | hardcoded `true`, stamped AVAILABLE | `true` was returned whatever the device actually reported — **REPLACED by `settings get global adb_enabled`** | yes — SEC-002 |
| 2 | `secureBootEnabled` | `AdbGenericEvidenceProvider.kt:156` | hardcoded `true`, stamped AVAILABLE | `true` was returned whatever the device reported — **REPLACED by `ro.boot.verifiedbootstate`** | yes — SEC-004 |
| 3 | `deviceOwnerActive` | `AdbGenericEvidenceProvider.kt:157` | hardcoded `false`, stamped AVAILABLE | **Proven wrong** — the bench device *was* a device owner that five commands refused to remove — **REPLACED by `dumpsys device_policy`** | yes — SEC-005 |
| 4 | `externalStoragePresent` | `AdbGenericEvidenceProvider.kt:142` | hardcoded `false`, stamped AVAILABLE | Not one of the ratified 114 — **REPLACED by a real `ls /storage` observation** | **no — ad-hoc field** |
| 5 | `scopedStorageEnforced` | `AdbGenericEvidenceProvider.kt:143` | hardcoded `true`, stamped AVAILABLE | Not one of the ratified 114; propagated into report text at `:144` — **REPLACED by NOT_AVAILABLE with the true reason** | **no — ad-hoc field** |

**Second fault, also removed:** `collectSecurity()` substituted `false` when `dumpsys trust`
*failed*, then stamped it `EvidenceStatus.AVAILABLE`. That converted a **failed measurement
into a negative result**. It was the only collector that degraded this way —
`collectBattery()` correctly returned `ERROR` and `collectStorage()` correctly returned
`NOT_AVAILABLE`. A failure now reports `ERROR` with the reason attached.

**The regression guard:** `AdbGenericEvidenceProviderTest` now contains
`neverSubstitutesAValueWhenTheCommandFails`, which fails the build if any of these four
states ever reports a value from a failed command again. The original test had *pinned* the
fabricated constants, which is why no test could find the defect.

---

## 6. Domains measured, end to end

| Domain | Rows | In place | Missing | Position |
|---|---|---|---|---|
| Applications | 2 | 2 | 0 | complete |
| Audio | 5 | 2 | 3 | partial |
| Battery | 8 | 5 | 3 | partial |
| Biometrics | 2 | 0 | 2 | **entirely absent** |
| Bluetooth | 3 | 1 | 2 | partial |
| Camera | 7 | 1 | 6 | partial |
| Cellular | 5 | 4 | 1 | partial |
| Connection | 6 | 3 | 3 | partial |
| Display | 8 | 3 | 5 | partial |
| GNSS | 2 | 1 | 1 | partial |
| Haptics | 1 | 1 | 0 | complete |
| Hardware | 5 | 4 | 1 | partial |
| Identity | 9 | 9 | 0 | complete |
| Mechanical | 15 | 0 | 15 | **entirely absent** |
| Performance | 5 | 2 | 3 | partial |
| Sanitization | 7 | 6 | 1 | partial |
| Security | 5 | 5 | 0 | complete |
| Sensors | 6 | 6 | 0 | complete |
| Storage | 4 | 2 | 2 | partial |
| System | 3 | 3 | 0 | complete |
| Touch | 2 | 0 | 2 | **entirely absent** |
| Wi-Fi | 4 | 2 | 2 | partial |
| **TOTAL** | **114** | **62** | **52** | |

---

## 7. What has genuinely been tested — and what has not

The standing rule applies: **unit tests and compilation are not product support.**
Only a measurement that survives independent re-execution counts.

### 7.1 Genuinely tested — re-executable evidence exists

| Claim | Evidence | Re-executable? |
|---|---|---|
| Agent-less acquisition is possible with nothing installed | `docs/CYVRA_AGENTLESS_RESEARCH_Q1_2026-10-12.md` — 63 of 69 probes returned | yes |
| Factory reset erases user data end to end | `docs/CYVRA_FACTORY_RESET_PROOF_2026-10-12.md` — packages 363→333, contacts 294→1, media 288→20, accounts 1→0, DO refs 4→0 | yes |
| The reset was a factory reset, not a reboot | `ro.boot.bootreason = reboot,factory_reset`; boot pinned 11:41:24 from monotonic `/proc/uptime` | yes |
| Device-owner cannot be cleared without a reset | five commands each refused and the refusal recorded | yes |
| WPD read-only plane opens on real hardware | G4/G5 acceptance, Samsung A10s | yes |
| Product collects identity/storage/battery/package fields | `AdbGenericEvidenceProvider.kt` + committed unit tests | code yes; **not hardware-qualified as a product path** |

### 7.2 NOT tested — stated as such

| Area | Honest position |
|---|---|
| **All 62 collected parameters, as a product path** | **none has been run end-to-end through the .exe against a real device.** Compilation and unit tests are not product support |
| The 36 Stage 1 additions specifically | compiled and unit-tested; **zero hardware validation**; several of their commands were not in Q1's probe set at all |
| Device-owner detection via `dumpsys device_policy` | **not yet measured since the reset** — labelled unproven until measured, not assumed |
| Battery temperature conversion | recorded in **device-native units**; the divisor has never been compared against a reference thermometer |
| The remaining 52 parameters | no product collection exists |
| Purge verification | `governed §29` contract remains **unratified**; the bench proof is not a verification contract |
| Physical verification PV-001..PV-017 | protocol exists in the workbook only; no station, no fixtures |
| CYVRA AI-Enabled Grading | not built; depends on Stage 6 station and models |
| SQLite parsing | **none in product code** — all 280 grep hits are `@types/node` ambient declarations |
| Report export beyond JSON | `ReportGenerator.writeZip()` emits `report.json` + `PROVENANCE.txt` only |
| Any release claim | nothing in this repository is RELEASE-VALIDATED |

---

### 7.3 The technician checklist — complete in process, not in automation

Thirteen of the 114 are marked in the workbook as `No / not safely replaceable`,
with CYVRA Capability `No` or `Assisted`. Each is a physical or specialist condition
— a swollen cell, a corroded port, an antenna, a NAND array — that no collector on
any plane can establish. Rather than leave them absent, they are delivered into the
product as a checklist the .exe presents and records.

| ID | Check | Priority |
|---|---|---|
| AUD-002 | Speaker distortion/weakness | P1 |
| BAT-007 | Battery swelling | P1 |
| BAT-008 | Charging connector looseness | P1 |
| BIO-002 | Fingerprint sensor surface condition | P1 |
| CELL-005 | RF/antenna performance | P1 |
| PHY-001 | Power button tactile function | P1 |
| PHY-002 | Volume buttons tactile function | P1 |
| PHY-003 | USB connector mechanical fit | P1 |
| PHY-004 | USB port debris/corrosion | P1 |
| PHY-008 | SIM tray/slot integrity | P1 |
| PHY-009 | microSD slot integrity where present | P1 |
| PHY-014 | Water-resistance/IP seal integrity | P1 |
| PHY-015 | Internal screws/fasteners condition | P1 |
| PUR-007 | Physical NAND cell-level verification | P0 |

**What the checklist does:**

- Records that a named technician carried out each check, when, and what they found.
- Attributes every result to `OPERATOR`, by a fixed getter that no constructor can
  override. A human opinion can therefore never be indistinguishable in the report
  from a shell observation — which is what a fabrication looks like to a reader.
- Treats `NOT_PERFORMED` as **unanswered**, so a checklist nobody worked cannot
  summarise identically to one where a technician found nothing.
- Treats `NOT_APPLICABLE` as a real answer, because a device with no microSD slot is
  not a device that passed a microSD check.

**What it does not claim:**

- **No execution has been recorded.** The capability is in the product; the evidence
  is not. Until a technician works a device, these 13 remain untested.
- It does not convert a technician's finding into software evidence, and never will.
- `PHY-001` / `PHY-002` are `Assisted` in the workbook: the application can prompt for
  a press and observe that the input event arrived. That is an **electrical**
  observation. A button that reports while feeling wrong is still a defect, and only
  the technician judges the feel.
- `PUR-007` (NAND cell-level verification) is the one P0. The workbook records its
  evidence type as `Not reliably determinable`, so no software method may claim it.

---

## 8. The handshake — what may and may not be claimed

**May be claimed today, with the cited evidence:**

- Agent-less acquisition works, with nothing installed, on the measured device class.
- Factory reset erases user data, proven end to end on real hardware.
- Identity, storage, battery and package inventory are collected by the product.
- IMEI and serial are honestly reported RESTRICTED rather than fabricated.
- No production code path asserts a measurement it did not take — enforced by a
  regression test that fails the build if it happens again.

**May NOT be claimed today:**

- That the .exe covers the 114-parameter plan. It has code for 62.
- That those 62 are verified. **Zero** have been validated as a product path on hardware.
- That the 36 Stage 1 additions work at all on a real device. That is the next measurement.
- That removing the fabrications proves their replacements correct. Removal and
  verification are separate acts; only the second one counts.
- That purge is verified. The contract is unratified.
- That grading exists. It is Stage 6, after purge.
- That anything is release-validated.

---

*Generated 2026-10-14 by scripts/gen_handshake.py from the two Chief Engineer workbooks
*plus source reading of the code named in each row. Re-run that script against the*
*workbooks to reproduce every figure above. It exits non-zero if the product's*
*technician checklist and the workbook disagree, so a drifting count cannot publish.*
