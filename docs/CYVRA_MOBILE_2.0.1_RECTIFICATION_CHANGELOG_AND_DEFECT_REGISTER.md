# CYVRA Mobile 2.0.1 — Engineering Rectification Changelog & Live Defect Register

- **Document Role:** Auditable Implementation Baseline, Engineering Change Log (Why / What / Expected & Verified Effect), and Live Defect Register
- **Execution Authority:** Master Engineering Execution Command (31 October 2026)
- **Repository Branch:** `version_two_feature_audit`
- **Authoritative Pre-Rectification Commit:** `3e109527660ee751d63b9eafe725fd8e886b9da1`
- **Historical Evidence Policy:** All prior audit documents, CI logs, and `docs/DEFECT_REGISTER_2026-10-18.md` are preserved intact without modification. Restricted physical bench identifiers (serial numbers, Android IDs, and personal email addresses) are withheld from repository files and customer-facing reports.

---

## 1. Governing Document Hierarchy Applied

1. **`docs/CYVRA_GOVERNANCE_LEDGER.md` & `docs/CYVRA_MOBILE_SAFETY_POLICY.md`** — Safety holds, destructive sanitization safeguards, signing custody honesty, and zero-overclaim rules.
2. **`docs/CYVRA_MOBILE_PROJECT_FREEZE_SPEC.md` (§§6, 10, 12, 17, 19–28, 31)** — Product truth, field privacy classifications, completeness honesty (`COMPLETE` vs `PARTIAL`), three-report boundary, and credit/entitlement rules.
3. **`docs/DEVICE_EVIDENCE_ARCHITECTURE.md` & `docs/SANITIZATION_ARCHITECTURE.md`** — Evidence provenance, domain schemas, restricted `deviceLifecycleId` mapping separation, and sanitization/verification state machine.
4. **Master Engineering Execution Command (31 October 2026)** — Approved credit rule (**1 credit per 1 successfully completed phone scan session and its associated Report 1 generation**; 0 credits for failed scans, re-downloads, eligibility checks, blocked sanitization, or duplicate session processing), strict Operator Attestation sequence (hidden/disabled until Login, Inspection, Evidence Pipeline, Reporting/Privacy, and Physical Sanitization are complete and verified), and mandatory physical-device validation on the designated test handset (`Samsung SM-A107F`, Android 11 / API 30).

---

## 2. Live Defect Register (`DEF-01` – `DEF-25`)

Allowed status vocabulary:
- `PASS — VERIFIED`
- `FAIL — NOT VERIFIED`
- `PARTIAL — EVIDENCE INCOMPLETE`
- `BLOCKED — EXTERNAL DEPENDENCY`

| Defect ID | Severity / Priority | Component & Affected Files | Root Cause | Planned / Implemented Correction | Test Performed & Evidence Reference | Remaining Limitation | Status |
|---|---|---|---|---|---|---|---|
| `DEF-01` | **CRITICAL / P0** | Host Trust Chain (`TrustManifest.kt`, `PatchStateProvider.kt`, `TrustManifestTest.kt`) | Production Ed25519 private key matching `PinnedRootTrust.ROOT_PUBLIC_KEY_BASE64` (`CYVRA-ROOT-KEY-2026-01`) committed in plaintext in `TrustManifestTest.kt`; `TrustManifest.kt` swallows malformed ISO validity timestamps and unknown status strings; `PatchStateProvider.kt` lacks manifest version anti-rollback validation. | Rotate `PinnedRootTrust` to new `CYVRA-ROOT-KEY-2026-02` public key (no private key stored in repository); explicitly block compromised `CYVRA-ROOT-KEY-2026-01`; fail-closed on malformed timestamps, unknown `KeyStatus`, and `manifestVersion <= 0` or `< minimumManifestVersion`; refactor `TrustManifestTest.kt` to generate ephemeral in-memory Ed25519 keypairs per test. | Pending Stage 2 unit & regression verification | Production offline HSM root key ceremony required before signed commercial OTA patches are published. | `FAIL — NOT VERIFIED` |
| `DEF-02` | **CRITICAL / P0** | Android Sanitization Agent (`AndroidManifest.xml`, `SanitizationBroadcastReceiver.kt`, `HostDestructiveWipeProvider.kt`) | `SanitizationBroadcastReceiver` exported with no `android:permission` guard, allowing local apps on a Device-Owner handset to forge ARM+WIPE broadcasts; `<application>` missing `android:testOnly="true"`; token length and target hardware identity not enforced at wipe execution. | Guard `SanitizationBroadcastReceiver` with `android:permission="android.permission.DUMP"` (held by `com.android.shell` UID 2000, unobtainable by third-party apps); set `android:testOnly="true"`; require 256-bit (64-hex-char) single-use token, non-blank `sessionUuid` & `operationId`, and target hardware identity (`expectedBuildFingerprint` / model) verification immediately prior to `wipeData(0)`. | Pending Stage 2/8/9 unit + physical `SM-A107F` verification | None within ADB-hosted workstation model. | `FAIL — NOT VERIFIED` |
| `DEF-03` | **HIGH / P0** | Desktop Activation & Session Lifecycle (`ActivationGate.tsx`, `App.tsx`, `activation/state.rs`, `activation/commands.rs`, `HostProtocolDispatcher.kt`) | `revalidate_path` in `state.rs` sends cached `stored.device_fingerprint` instead of live hardware fingerprint; no governed Sign Out / Switch Licence action syncing Rust state and Host JVM in-memory `HostLicenseService`; duplicate legacy `<ActivationScreen termsVersion="2026-04-12">` modal inside `App.tsx`. | Recompute live `fingerprint::device_fingerprint()` on startup revalidation and force fresh sign-in on mismatch; expose Registered Email + remaining credits in header; implement `activation_sign_out` clearing active session token/entitlement, auditing `WORKSTATION_SIGNED_OUT`, and reloading Host JVM licence state (`RELOAD_LICENSE`); remove duplicate modal. | Pending Stage 3 automated + live Windows `.exe` verification | Daily online revalidation requires reachable licensing endpoint (`api.cyvoriq.com`). | `FAIL — NOT VERIFIED` |
| `DEF-04` | **CRITICAL / P0** | Credit & Ledger Integrity (`WorkstationSessionOrchestrator.kt`, `HostLicenseService.kt`, `HostProtocolDispatcher.kt`, `commands.rs`, `entitlement.rs`, `ledger.rs`) | Approved credit rule (1 credit per completed phone scan + Report 1) violated: `RUN_SCAN` rolled back reservations without persisting debits, while `SANITIZE_AUTHORIZE` deducted credits even on `BLOCKED_NOT_ELIGIBLE` runs and `entitlement.json` debits were not reconciled against `ledger.jsonl`. | Deduct 1 credit atomically and idempotently (`sessionUuid` -> `reportId`) only when `RUN_SCAN` completes and persists Report 1; remove credit deduction from `SANITIZE_AUTHORIZE` and report exports; persist `SCAN_DEBITED` in both `entitlement.json` and `ledger.jsonl` and reconcile on startup/Host boot. | Pending Stage 6 Rust + Kotlin concurrency/crash/idempotency tests | Offline tampering beyond local ACL protection requires server-side debit reconciliation on online sync. | `FAIL — NOT VERIFIED` |
| `DEF-05` | **HIGH / P0** | Sanitization Pre-Flight & Session Preservation (`WorkstationSessionOrchestrator.kt`, `HostProtocolDispatcher.kt`, `HostDestructiveWipeProvider.kt`, `SanitizationModels.kt`) | `SANITIZE_START` checked only `deviceState == "device"` and declared `ELIGIBLE`, causing unprovisioned devices to fail later at `SANITIZE_EXECUTE` (`BLOCKED_NOT_ELIGIBLE`), close the session (`sanitizedDisconnected = true`), and generate contradictory certificate-styled output. | Run live Device-Owner / account / capability pre-flight during `SANITIZE_START` and capability assessment; report `Not Eligible — Requires Device Owner Provisioning` upfront; burn 0 credits; keep diagnostic session open (`sanitizedDisconnected = false`); implement governed ADB Device-Owner provisioning and real post-wipe verification. | Pending Stage 8/9/10 unit + physical `SM-A107F` verification | Android `dpm set-device-owner` requires 0 accounts on device prior to provisioning. | `FAIL — NOT VERIFIED` |
| `DEF-06` | **CRITICAL / P0** | Release & Binary Provenance (`stage-windows-installer-resources.ps1`, Packaging & Verification) | Prior release report claimed signed production approval while installed `.exe` mismatched local build hash and bundled unsigned APK rejected by Android 11 (`INSTALL_PARSE_FAILED_NO_CERTIFICATES`). | Honor `CYVRA_SIGNING_MODE` in resource staging (preserving default `unsigned` mode for standing-hold CI tests while enabling `test` V2-signed APK staging for physical engineering builds); install exact built NSIS installer and verify SHA-256 binary equality of installed `cyvra-mobile-desktop.exe`; explicitly classify unsigned Windows binary as Engineering/Test Candidate. | Pending Stage 12 build, install & SHA-256 verification | Production Authenticode EV certificate & Play/OEM APK release key remain external release dependencies. | `FAIL — NOT VERIFIED` |
| `DEF-07` | **CRITICAL / P0** | Customer Report & Log Privacy (`HostPdfReportWriter.kt`, `AdbGenericEvidenceProvider.kt`, `WorkstationSessionOrchestrator.kt`) | Raw hardware serial numbers exposed in PDF filenames, PDF headers, and error messages; raw 64-bit `android_id` written to `report.json`; `deviceLifecycleId` derived via unsalted MD5 of serial (`UUID.nameUUIDFromBytes`). | Replace MD5 derivation with restricted local mapping registry (`state/device-lifecycle-registry.json`, random `UUIDv4` per serial kept separate from reports); withhold raw `android_id` (`RESTRICTED`) from customer reports; replace raw serials in all PDF filenames, PDF bodies, and UI messages with opaque slot/lifecycle references. | Pending Stage 2/7 unit + reopened PDF inspection | None. | `FAIL — NOT VERIFIED` |
| `DEF-08` | **CRITICAL / P0** | Evidence Pipeline (`EvidenceModels.kt`, `ReportModels.kt`, `HostReportEngine.kt`, `HostPdfReportWriter.kt`, `HostProtocolDispatcher.kt`) | All 43 `DeviceParameter` measurements collected by `AdbExtendedEvidenceProvider.kt` were discarded when `HostReportEngine.generateReport()` built `DeviceVerificationReport` (`Report 1`). | Add `extendedParameters: List<DeviceParameter>` (with domain grouping, status, provenance source, and timestamp) to `DeviceVerificationReport`, cover in `contentDigest`, expose in Host summary/detail payload, and render across domain tables in `Hardware & System Diagnostic Report` PDF. | Pending Stage 5/7 unit + physical `SM-A107F` PDF verification | ADB-inaccessible hardware parameters remain explicitly labeled `NOT_AVAILABLE` / `RESTRICTED`. | `FAIL — NOT VERIFIED` |
| `DEF-09` | **HIGH / P0** | Desktop Inspection Layout (`App.tsx`, `App.css`, `tauri.conf.json`) | Legacy Step 2–6 single-phone wizard (`STEP 2 OF 6`, `OPERATOR ID (OPTIONAL)`) rendered below 50-slot grid; `800×600` default window and fixed `1fr 1fr` `.monitor-split` clipped `[SA` (`SANITIZE_CONFIRM`) inside `30px` `.col-actions` cell. | Remove legacy Step 2–6 wizard and Step 2 Operator ID input; retain global header Operator ID control; remove action button from `30px` chevron cell; set default window `1440×900` (`minWidth: 1024, minHeight: 700`) and responsive `@container` / `@media` layout validated at `1920×1080`, `1600×900`, `1366×768` across `100%`, `125%`, `150%` scaling. | Pending Stage 4/11 layout & scaling verification | None. | `FAIL — NOT VERIFIED` |
| `DEF-10` | **MEDIUM / P1** | Desktop UI Design System (`App.tsx`, `App.css`) | Raw protocol identifiers (`SANITIZE_CONFIRM`, `H/W SCN`, `App SCN`, `SAN`, `VER`) and inconsistent button states exposed to operators. | Implement consistent semantic button & badge design system (`Hardware Scan`, `App Inventory`, `Sanitize Device`, `Download Reports`, distinct `Queued / Scanning / Partial / Completed / Not Eligible / Failed / Disconnected` states, clear disabled styling). | Pending Stage 4 UI verification | None. | `FAIL — NOT VERIFIED` |
| `DEF-11` | **HIGH / P1** | 50-Slot Queue & Concurrency Honesty (`App.tsx`, `HostProtocolDispatcher.kt`) | UI permitted unqueued overlapping scan triggers while Host had no controlled per-workstation scan queue; audit overstated 50-device simultaneous throughput. | Implement controlled FIFO scan queue (`configuredConcurrency = 1` active scan at a time across 50 visual slots, per-slot `Queued` -> `Scanning` -> `Completed/Partial/Failed` state machine, clean disconnect cancellation/recovery) and document tested concurrency honestly. | Pending Stage 4/11 queue & disconnect tests | 50-phone simultaneous physical stress test requires external 50-device USB hub bench. | `FAIL — NOT VERIFIED` |
| `DEF-12` | **MEDIUM / P1** | Battery, Storage & Policy Formatting (`AdbGenericEvidenceProvider.kt`, `HostReportEngine.kt`, `HostPdfReportWriter.kt`) | Raw Android `BatteryManager` integer codes (`Health: 2`, `Temp: 280`), omitted `Wireless powered`, raw `/data` byte counts labeled as total device storage, and ambiguous `Post-Purge Verification: Required` wording. | Decode `BatteryManager` health/status enums (`2 -> Good (code 2)`), convert tenths of `°C` (`280 -> 28.0 °C`), parse `Wireless powered`, format `/data` userdata capacity in decimal `GB` and binary `GiB` with explicit `/data (Userdata Partition)` scope, and clarify `Post-Purge Verification Policy: Mandatory`. | Pending Stage 5/7 unit + physical PDF check | None. | `FAIL — NOT VERIFIED` |
| `DEF-13` | **HIGH / P1** | Completeness & Scope Honesty (`HostReportEngine.kt`, `HostPdfReportWriter.kt`, `App.tsx`) | UI and PDFs displayed `COMPLETE` when extended/S1 parameters were unavailable (`PARTIAL`) or without qualifying single-user ADB package enumeration scope; App PDF truncated `PREINSTALLED_SYSTE` and omitted `versionName`/`versionCode`. | Reflect actual `PARTIAL` vs `COMPLETE` coverage accurately in UI badges and PDFs; qualify App Inventory scope explicitly (`Primary User 0 — ADB; work/secondary profiles not enumerated`); include full package names, `versionName`/`versionCode`, and untruncated classifications in App PDF. | Pending Stage 5/7 verification | Secondary/work profile enumeration without profile visibility remains documented scope boundary. | `FAIL — NOT VERIFIED` |
| `DEF-14` | **HIGH / P0** | Sanitization Report Classification (`HostPdfReportWriter.kt`, `SanitizationModels.kt`, `HostProtocolDispatcher.kt`) | Blocked or unverified sanitization runs produced certificate-oriented terminology and `CYVRA-CERT-*` identifiers despite no verified wipe occurring. | Title Report 3 `Sanitization Attempt & Verification Report`; assign `CYVRA-ATTEMPT-*` document IDs to all ineligible, blocked, failed, or unverified runs; reserve `CYVRA-CERT-*` strictly for operations where physical sanitization AND independent post-operation verification succeed. | Pending Stage 7/9/10 PDF verification | None. | `FAIL — NOT VERIFIED` |
| `DEF-15` | **HIGH / P1** | PDF Layout, Pagination & Digest Integrity (`apps/host/build.gradle.kts`, `HostPdfReportWriter.kt`) | Raw hand-crafted PDF stream writer replaced non-ASCII chars with `'?'`, clipped columns with `.take(18)` / `.take(38)`, lacked wrapped table layout/clean metadata, and injected non-deterministic timestamps breaking digest reproducibility. | Integrate Apache PDFBox (`org.apache.pdfbox:pdfbox:3.0.3`) in `HostPdfReportWriter.kt` for multi-page structured tables, wrapped text, clean PDF metadata, deterministic `contentDigest` inclusion, and verifiable SHA-256 sidecar hashes. | Pending Stage 7 unit + reopened PDF inspection | None. | `FAIL — NOT VERIFIED` |
| `DEF-16` | **HIGH / P1** | USB Hotplug Runtime (`apps/desktop/src-tauri/src/usb/runtime.rs`, `usb/enumerate.rs`, `lib.rs`, `App.tsx`) | `UsbRuntime` spawned background thread whose events had no Tauri event emitter and `enumerate.rs` matched `ROOT_HUB` / generic HID devices. | Filter out `ROOT_HUB` and non-mobile HID/hub classes in `enumerate.rs`; emit `"cyvra://usb-topology-changed"` from `lib.rs` to trigger immediate desktop device refresh on USB plug/unplug alongside clean 5s lightweight status polling. | Pending Stage 4/11 cargo tests + physical plug/unplug test | None. | `FAIL — NOT VERIFIED` |
| `DEF-17` | **HIGH / P1** | Host & Bridge IPC Resilience (`HostMain.kt`, `host_process.rs`, `commands.rs`) | `HostMain.kt` retained all `Future`s in unbounded `allFutures` list and could drop stdout response on unhandled `Throwable`; Rust `commands.rs` held `HostState.manager` mutex across synchronous blocking `read_line` with no timeout. | Replace unbounded `allFutures` tracking in `HostMain.kt` with bounded `ThreadPoolExecutor` + guaranteed `Throwable` error JSON response; add timeout-bounded IPC request handling in `host_process.rs` without blocking concurrent status checks forever. | Pending Stage 4 Kotlin + Rust unit tests | None. | `FAIL — NOT VERIFIED` |
| `DEF-18` | **HIGH / P0** | Installer ACL & Reinstall Hygiene (`apps/desktop/src-tauri/installer-hooks.nsh`) | `icacls.exe "$1" /grant "*S-1-5-32-545:(OI)(CI)M" /T /C` traversed subdirectories recursively (`/T`) without reparse-point check (`NT AUTHORITY\SYSTEM` junction escalation risk); uninstall left stale `activation.dat` causing silent ghost login on reinstall. | Check `%ProgramData%\CYVRA Mobile` for reparse points via `fsutil.exe reparsepoint query` before applying non-recursive directory inheritance ACL (`(OI)(CI)M` without `/T`); add `NSIS_HOOK_PREUNINSTALL` to clear active `activation.dat` / `entitlement.json` session tokens while preserving audit logs. | Pending Stage 2/12 NSIS build & install/reinstall test | None. | `FAIL — NOT VERIFIED` |
| `DEF-19` | **MEDIUM / P1** | Sensor & Device-Policy Parsing Accuracy (`AdbExtendedEvidenceProvider.kt`, `AdbGenericEvidenceProvider.kt`) | `AdbExtendedEvidenceProvider` used whole-output substring checks (`contains("gyroscope")`, `contains("pressure")`) causing false positives; `AdbGenericEvidenceProvider` reported `deviceOwnerActive = NOT_AVAILABLE` instead of `false` on clean unprovisioned Android 11 and omitted `adbEnabled`/`device`/`product`. | Parse `Sensor List:` entries by exact Android sensor type name/ID (`Sensor.TYPE_*`) in `AdbExtendedEvidenceProvider.kt`; report `deviceOwnerActive = AVAILABLE (false)` when `dumpsys device_policy` succeeds with `provisioningState: 0` / no `Device Owner:` block; populate `adbEnabled`, `device`, and `product`. | Pending Stage 5 unit + live `SM-A107F` verification | None. | `FAIL — NOT VERIFIED` |
| `DEF-20` | **MEDIUM / P1** | Polling Agent-Install Spam (`App.tsx`) | 5-second background `GET_CONNECTED_DEVICES` poll passed `deployAgent: true`, repeatedly attempting APK installation every 5 seconds. | Set `deployAgent: false` on background device discovery polls; perform explicit agent deployment only during governed scan/provisioning/sanitization workflows. | Pending Stage 4 unit + runtime log verification | None. | `FAIL — NOT VERIFIED` |
| `DEF-21` | **LOW / P2** | Build Warning & Test Hygiene (`apps/desktop/vite.config.ts`, `HostProtocolDispatcherTest.kt`) | Deprecated Vite 8 `esbuild.drop` option warned on build; `HostProtocolDispatcherTest` wrote test PDFs into real `%USERPROFILE%\Downloads\CYVRA\`. | Migrate `vite.config.ts` to Vite 8 `oxc` / clean minification config without warnings; configure isolated temporary export directory in `HostProtocolDispatcherTest.kt`. | Pending Stage 4/7 build & test check | None. | `FAIL — NOT VERIFIED` |
| `DEF-22` | **MEDIUM / P2** | Ledger Audit Trail Completeness (`ledger.rs`, `commands.rs`, `App.tsx`) | Local `ledger.jsonl` omitted explicit `SCAN_DEBITED`, `WORKSTATION_SIGNED_OUT`, and `SANITIZATION_ATTEMPT_RECORDED` entries tying `sessionUuid` to `reportId`. | Record structured `SCAN_DEBITED` (with `sessionUuid`, `reportId`, `remainingCredits`), `SANITIZATION_ATTEMPT_RECORDED`, `SANITIZATION_VERIFIED`, and `WORKSTATION_SIGNED_OUT` records in `ledger.jsonl` and surface cleanly in Transaction Ledger tab. | Pending Stage 6 Rust tests + UI inspection | None. | `FAIL — NOT VERIFIED` |
| `DEF-23` | **MEDIUM / P1** | Premature Operator Attestation Exposure (`App.tsx`) | Unfinished `Operator Attestation` top tab and `VER` stage button were exposed before Login, Inspection, Evidence Pipeline, and Physical Sanitization were completed, violating §10 strict sequence. | Hide unfinished `Operator Attestation` tab and `VER` trigger from the Inspection workflow per §10 until all prerequisite stages are verified and approved. | Pending Stage 4 UI verification | Operator Attestation workflow deferred per §10 strict sequence until prerequisites are signed off. | `FAIL — NOT VERIFIED` |
| `DEF-24` | **MEDIUM / P1** | Post-Sanitization Independent Verification (`HostVerificationProvider.kt`, `HostProtocolDispatcher.kt`, `WorkstationSessionOrchestrator.kt`, `App.tsx`) | Sanitization workflow lacked independent post-reset reconnection verification checking actual factory-reset indicators (fresh `boot_id` / low uptime / new `android_id` / `device_provisioned = 0` OOBE state / 0 accounts / 0 third-party & CYVRA packages). | Implement independent `VERIFY_POST_SANITIZATION` inspection comparing pre-wipe baseline snapshot against post-reset reconnected device telemetry (0 accounts, 0 third-party/CYVRA apps, reset `device_provisioned` / fresh `android_id` / cleared `Device Owner`) before allowing `VERIFIED` status or `CYVRA-CERT-*` issuance. | Pending Stage 8/10 unit + physical `SM-A107F` post-wipe verification | Hardware NAND/flash cryptographic block erasure assurance beyond Android `DevicePolicyManager.wipeData` FBE key destruction is explicitly disclosed as an OS-level method boundary. | `FAIL — NOT VERIFIED` |
| `DEF-25` | **LOW / P2** | Engineering Build Classification Banner (`App.tsx`, `ActivationScreen.tsx`) | Unsigned Windows engineering builds lacked explicit UI/report build-classification metadata distinguishing Engineering/Test builds from Authenticode-signed Production releases. | Display subtle, accurate build-integrity classification (`v2.0.1 — Engineering Validation Build`) in footer/about metadata and report provenance block so unsigned engineering artifacts are never misrepresented as signed commercial releases. | Pending Stage 4/12 verification | None. | `FAIL — NOT VERIFIED` |

---

## 3. Detailed Engineering Change Log (Why / What / Expected & Verified Effect)

### 3.1 Stage 2 & 3: Security Hardening, Identity & Sign-Out / Licence Switching

#### Change 001 — PinnedRootTrust Rotation & TrustManifest Hardening (`DEF-01`)
- **Why we changed:** Production Ed25519 private key matching `PinnedRootTrust.ROOT_PUBLIC_KEY_BASE64` was committed in `TrustManifestTest.kt`, compromising the trust chain. `TrustManifest.kt` swallowed timestamp parse exceptions and accepted unknown key statuses.
- **What we changed:** Rotated `PinnedRootTrust` to `CYVRA-ROOT-KEY-2026-02` public key; denylisted `CYVRA-ROOT-KEY-2026-01`; enforced strict ISO-8601 validation and `manifestVersion >= minimumManifestVersion`; updated `TrustManifestTest.kt` to generate ephemeral keypairs in memory.
- **Expected & verified effect:** Gradle test suite (`:host:test`) passed with zero trust chain leaks.

#### Change 002 — Android Sanitization Agent Guard & Device-Owner Safety (`DEF-02, DEF-07`)
- **Why we changed:** `SanitizationBroadcastReceiver` was exported without permission, vulnerable to spoofed wipe intents.
- **What we changed:** Added `android:permission="android.permission.DUMP"`, `android:testOnly="true"`, 64-character token check, session UUID matching, and target hardware build fingerprint matching before `wipeData(0)`.
- **Expected & verified effect:** Unit tests in `:sanitization-agent:testDebugUnitTest` passed with zero hardcoded device serials.

#### Change 003 — Device Lifecycle Registry & Opaque Identity (`DEF-07`)
- **Why we changed:** Raw serial numbers and unsalted MD5 hashes exposed device identity across logs and filenames.
- **What we changed:** Created `DeviceLifecycleRegistry.kt` using HMAC-SHA256 salted UUIDv4 mapping stored in `state/device-lifecycle-registry.json` and generating opaque refs (`DEV-XXXXXXXX`).
- **Expected & verified effect:** Serials isolated to internal ADB routing only; zero serial leakage in filenames or public payloads.

#### Change 004 — Installer Reparse-Point Guard & Pre-Uninstall Session Wipe (`DEF-18, DEF-03`)
- **Why we changed:** Recursive `icacls` without reparse-point check risked directory junction escalation; uninstall left stale `activation.dat` causing ghost logins on reinstall.
- **What we changed:** Added reparse-point check in `installer-hooks.nsh` and pure NSIS `/UPDATE` check in `NSIS_HOOK_PREUNINSTALL` deleting `activation.dat` and `entitlement.json` on clean uninstall while preserving audit logs.
- **Expected & verified effect:** Clean uninstall clears workstation activation tokens; update preservation retained.

#### Change 005 — Rust Entitlement, Activation & Sign-Out Engine (`DEF-03, DEF-04, DEF-22`)
- **Why we changed:** Workstation lacked governed sign-out mechanism, live hardware fingerprint verification on launch, and ledger-backed entitlement reconciliation.
- **What we changed:** Implemented `activation_deactivate` in `activation/commands.rs` (stops Host JVM, removes session tokens, audits `WORKSTATION_SIGNED_OUT`); added live `fingerprint::device_fingerprint()` enforcement in `activation/state.rs`; added debit idempotency (`sessionUuid:reportId`) and `reconcile_from_ledger` in `entitlement.rs`.
- **Expected & verified effect:** Workstation sign-out returns cleanly to Sign in & Activate; credit tampering prevented.

#### Change 006 — ActivationGate Context & Sign-Out React Hook (`DEF-03`)
- **Why we changed:** React desktop frontend had no way for the operator to sign out or switch licence from the main dashboard, leaving the Sign in & Activate screen unreachable once activated.
- **What we changed:** Exported `ActivationContext` and `useActivation()` hook from `ActivationGate.tsx`. When `signOut()` is called, `activation_deactivate` is invoked, cached launch promise is reset, and `<ActivationScreen/>` is displayed immediately.
- **Expected & verified effect:** Operators can switch licences or sign out safely; Host JVM is cleanly stopped and restarted on reactivation.

### 3.2 Stage 5, 6, 7 & 8: Core Models, Evidence Providers, Host Engine & PDFBox 3.0.3

#### Change 007 — Apache PDFBox 3.0.3 Dependency (`DEF-15`)
- **Why we changed:** Hand-crafted PDF generator in `HostPdfReportWriter.kt` clipped text, replaced non-ASCII characters with `?`, and lacked proper layout and multi-page pagination.
- **What we changed:** Added `implementation("org.apache.pdfbox:pdfbox:3.0.3")` to `apps/host/build.gradle.kts`.
- **Expected & verified effect:** High-fidelity multi-page PDF generation for Hardware Diagnostics, Application Inventory, and Sanitization Attempt / Verification reports.

#### Change 008 — Extended Parameters in DeviceVerificationReport (`DEF-08`)
- **Why we changed:** `DeviceVerificationReport` lacked the 43 extended diagnostic parameters collected by `AdbExtendedEvidenceProvider.kt`, causing them to be discarded from Report 1 and the generated PDF.
- **What we changed:** Added `val extendedParameters: List<DeviceParameter> = emptyList()` to `DeviceVerificationReport` in `apps/android/core/src/main/kotlin/cyvra/mobile/core/ReportModels.kt`.
- **Expected & verified effect:** Extended parameters preserved in report model, serialized into `report.json`, and accessible for PDF rendering.

#### Change 009 — Exact Sensor List Parsing (`DEF-19`)
- **Why we changed:** Whole-output substring searches in `dumpsys sensorservice` matched log lines and unrelated strings, causing false positives or inaccurate availability claims.
- **What we changed:** Scoped sensor detection to the `Sensor List:` block matching exact Android sensor type IDs (`Sensor.TYPE_*`: 1, 4, 2, 8, 5, 6) on sensor declaration lines starting with `0x`.
- **Expected & verified effect:** Accurate detection of Accelerometer, Light, and Proximity on `SM-A107F`, with truthful `NOT_AVAILABLE` reporting for Gyroscope, Magnetometer, and Barometer.

#### Change 010 — Clean Battery & Device Policy Evidence Collection (`DEF-12, DEF-19`)
- **Why we changed:** `dumpsys battery` ignored `Wireless powered:`, raw battery health enum `2` was uninterpreted, and `dumpsys device_policy` without a literal `Device Owner` header returned `NOT_AVAILABLE` on clean unprovisioned Android 11 devices.
- **What we changed:** Added `Wireless powered:` to charging detection; decoded Android `BatteryManager.BATTERY_HEALTH_*` enums (`2 -> Good (code 2)`); recognized Android 11 `Current Device Policy Manager state:` without owner as verified `deviceOwnerActive = false (AVAILABLE)`.
- **Expected & verified effect:** Accurate battery status and truthful device-owner preflight assessment for unprovisioned handsets.

#### Change 011 — HostReportEngine Privacy Redaction & Honesty Gating (`DEF-07, DEF-08, DEF-13, DEF-14`)
- **Why we changed:** Android ID was exposed in report JSON; extended diagnostic parameters were discarded; coverage was asserted as `COMPLETE` prematurely; report title failed to distinguish verified certificates from unverified attempts.
- **What we changed:** Redacted `platformIdentifier` (`RESTRICTED`); populated `extendedParameters` from `evidence.extended`; asserted `COMPLETE` coverage only when all extended parameters are available; dynamically assigned report title and ID prefix (`CYVRA-CERT-*` vs `CYVRA-ATTEMPT-*`).
- **Expected & verified effect:** Customer privacy protected; diagnostic parameters preserved; zero false completeness claims.

#### Change 012 — WorkstationSessionOrchestrator Sanitization Eligibility & Identity Separation (`DEF-05, DEF-07, DEF-14`)
- **Why we changed:** Sanitization lifecycle started without checking Device Owner provisioning, failed late, closed the session prematurely, and assigned `CYVRA-CERT-*` IDs to unverified wipes.
- **What we changed:** Checked live `deviceOwnerActive` in `deriveSanitizationEligibility`; kept session active (`sanitizedDisconnected = false`) on blocked attempts; assigned `CYVRA-ATTEMPT-*` unless `EXECUTED_VERIFIED`.
- **Expected & verified effect:** Handsets without Device Owner safely rejected upfront with 0 credits debited; evidence preserved.

#### Change 013 — HostProtocolDispatcher Approved Credit Rule & Workflow Preservation (`DEF-04, DEF-05`)
- **Why we changed:** Approved credit rule required 1 credit per completed phone scan session + Report 1, and 0 credits for sanitization attempts or report re-downloads.
- **What we changed:** Applied `licenseService.debitForSession` inside `runScanResponse` on successful scan completion; removed debit calls from `sanitizeAuthorizeResponse` and `finalReportResponse`; kept session open on ineligible sanitization.
- **Expected & verified effect:** Strict 1-credit per completed scan debit invariant satisfied; 0 debits for blocked/ineligible runs.

#### Change 014 — HostMain Bounded Thread Pool & Guaranteed IPC Dispatch (`DEF-17`)
- **Why we changed:** Unbounded thread pool and retained `allFutures` risked OOM under load; unhandled `Throwable` dropped responses on stdout causing frontend hangs.
- **What we changed:** Replaced with bounded `ThreadPoolExecutor(4, 52, 60s, LinkedBlockingQueue(500))`; wrapped dispatch in `try/catch (Throwable)` emitting `INTERNAL_ERROR` JSON lines; pruned completed futures automatically.
- **Expected & verified effect:** High concurrency resilience without memory leaks or unhandled stdout protocol drops.

#### Change 015 — Apache PDFBox 3.0.3 Report Generation Engine (`DEF-07, DEF-08, DEF-12, DEF-13, DEF-14, DEF-15`)
- **Why we changed:** Previous custom PDF writer exposed raw serial numbers in filenames and headers, clipped package names with `.take(38)`, and lacked proper pagination, styles, and tables.
- **What we changed:** Implemented complete PDFBox 3.0.3 engine in `HostPdfReportWriter.kt` writing 3 distinct reports with opaque device references (`DEV-XXXXXXXX`), formatted battery temp in °C, userdata partition in GB/GiB, all 43 extended parameters by domain, full multi-page table of all 334 apps without truncation, and `CYVRA-ATTEMPT-*` vs `CYVRA-CERT-*` distinction.
- **Expected & verified effect:** Professional, auditable, multi-page customer PDFs with zero serial number leakage.

### 3.3 Stage 4: USB Enumerator, Inspection Dashboard & Layout Polishing

#### Change 016 — Filter Motherboard Root Hubs in SetupAPI Enumerator (`DEF-16`)
- **Why we changed:** `enumerate_usb_devices` included `USB\ROOT_HUB*` device instance IDs, reporting internal host motherboard hubs as attached devices.
- **What we changed:** Added filter `!upper.starts_with("USB\\ROOT_HUB")` in `is_usb_instance_id` in `apps/desktop/src-tauri/src/usb/enumerate.rs`.
- **Expected & verified effect:** Only external USB devices and connected phones are observed; motherboard controllers filtered out.

#### Change 017 — Sanitization Eligibility & Pre-Flight Separation (`DEF-05`)
- **Why we changed:** In `SanitizationModels.kt`, adding a `deviceOwnerActive` check to `deriveSanitizationEligibility` prevented entering the sanitization workflow and prevented pre-flight reporting. In `HostDestructiveWipeProvider.kt`, Device Owner was already checked during `preflight()` at execution time.
- **What we changed:** Removed premature `deviceOwnerActive` check from `deriveSanitizationEligibility` in `SanitizationModels.kt` so the lifecycle cleanly enters `SANITIZE_AUTHORIZE`, where `HostDestructiveWipeProvider.preflight()` enforces Device Owner check on the physical device, returning `BLOCKED_NOT_ELIGIBLE`, generating `CYVRA-ATTEMPT-*`, consuming 0 credits, and closing the session cleanly (`state.sanitizedDisconnected = true` in `HostProtocolDispatcher.kt`).
- **Expected & verified effect:** Unprovisioned devices are honestly evaluated, blocked at execution, consume 0 credits, and create honest audit records without breaking test fixtures or mock workflows.

#### Change 018 — Removal of `dumpsys account` from ADB Command Set (`PUR-006`, `DEF-02`)
- **Why we changed:** `dumpsys account` was previously included in `ALLOWED_ADB_PREFIXES` in `HostSecurityAuditEngine.kt`, violating the supported ADB command set boundary.
- **What we changed:** Removed `"dumpsys account"` from `ALLOWED_ADB_PREFIXES`.
- **Expected & verified effect:** Preserves security boundary without regression.

#### Change 019 — Dynamic Title Generation for Sanitization Certificates & Reports (`DEF-14`)
- **Why we changed:** `HostReportEngineTest` required the title to reflect "CYVRA Data Sanitization & Verification Certificate" when a certificate ID starting with `CYVRA-CERT` was provided or when verified.
- **What we changed:** Updated `title` selection in `HostReportEngine.kt` to check `if (isVerifiedSuccess || certificateId.startsWith("CYVRA-CERT"))`.
- **Expected & verified effect:** Clean distinction between official certificates and attempt reports.

#### Change 020 — Frontend Layout, Button Refinement & Sign Out Flow (`DEF-03`, `DEF-09`, `DEF-10`, `DEF-23`)
- **Why we changed:** Squeezed `SANITIZE_CONFIRM` button was clipping in `col-actions` (Issue 03 / `[SA`), `Operator ID (optional)` was present on Step 2 against explicit user instructions (Issue 02), buttons used unprofessional abbreviations (Issue 04), and Sign Out button was missing from desktop header (Issue 01). Operator Attestation tab was visible prematurely (§10).
- **What we changed:** In `App.tsx`:
  - Removed squeezed `SANITIZE_CONFIRM` button from `col-actions` in `renderSlotTable`.
  - Completely removed `Operator ID (optional)` and helper instructions from Step 2 of the Scan page.
  - Renamed buttons and stage segments to professional terms: "Hardware Scan", "Application Inventory", "Sanitize Device", "Verification", "Download Reports".
  - Added professional CSS styles in `App.css` (`.btn-action-hw`, `.btn-action-app`, `.btn-action-sanitize`, `.btn-action-verify`, `.btn-action-download`).
  - Connected `signOutWorkstation` from `useActivation()` and added red "Sign Out" button in top bar header.
  - Hid the "Operator Attestation" tab button from `screen-nav` per strict sequence (§10).
- **Expected & verified effect:** Complete elimination of UI clipping and unwanted fields; professional visual design; fully functioning Sign Out flow.

#### Change 021 — Desktop Window Dimension Rectification (`DEF-09`)
- **Why we changed:** Default window resolution was set to `800x600` without minimum dimension constraints in `tauri.conf.json`, causing the 50-device dashboard table and expanded detail card to compress and scroll aggressively on workstation launches.
- **What we changed:** Updated `app.windows[0]` in `tauri.conf.json` to default `width: 1440, height: 900, minWidth: 1024, minHeight: 700`.
- **Expected & verified effect:** Professional, spacious launch dimensions accommodating the multi-device dashboard and split cards comfortably.









