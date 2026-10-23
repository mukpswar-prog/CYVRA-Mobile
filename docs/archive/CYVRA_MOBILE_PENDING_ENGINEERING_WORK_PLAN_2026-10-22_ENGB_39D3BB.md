# CYVRA Mobile — Pending Engineering Work Plan

**Document status:** DRAFT — ENGINEERING WORK INVENTORY — NOT A RELEASE APPROVAL  
**Prepared:** 22 October 2026  
**Repository:** [mukpswar-prog/CYVRA-Mobile](https://github.com/mukpswar-prog/CYVRA-Mobile)  
**Reviewed ref:** `docs/session-handoff-2026-10-20`  
**Reviewed branch head:** [`9c7697dd85b6b295725cd69892bb8755fb8c6ae8`](https://github.com/mukpswar-prog/CYVRA-Mobile/commit/9c7697dd85b6b295725cd69892bb8755fb8c6ae8)  
**Purpose:** Explain the unfinished engineering work, why it matters, where it belongs, how to resolve it, which work can proceed safely, and what evidence is required to close each task.

> This document is an engineering inventory, not an authoritative ruling. Recommendations are not approvals. All identified decision requests remain PENDING unless an authorised, dated source record says otherwise. No application code, tests, CI, packaging, device operations, governance records, or remote refs were changed as part of this review.

## 1. Executive summary

CYVRA Mobile is intended to be a Windows 10/11 workstation application for Android-device evidence collection, verification, reporting, and—only where supported and separately authorised—controlled sanitization. The expected operator journey is: connect and identify a supported Android device; collect legitimately available non-destructive evidence; generate Report 1, the **CYVRA Device Verification Report**; separately check current entitlement and obtain explicit sanitization authorization; perform only a supported and qualified method; reconnect and verify the result; and produce a final report whose claims match the actual evidence.

The architecture intentionally separates React/TypeScript desktop presentation, Rust/Tauri Windows-native device discovery and process lifecycle, Kotlin/JVM domain and workflow logic, an Android supporting evidence component, Cloudflare Worker/Neon account and entitlement services, and Resend transactional mail. CYVRA Mobile remains a separate product from CYVRA Erase.

The repository contains meaningful implementations and tests, but it is **not release-ready**. Six focused local test suites were recorded as 117 passed, zero failures, errors, or skips at commit `7e8439d`; these are local test results, not CI, hardware, or release evidence. The latest reviewed branch contains later documentation commits, but those do not establish that the tests were re-run against `9c7697d`. The GitHub Actions history read during this review showed no Windows Engineering Build run, and the combined status query for `9c7697d` returned no statuses. No four-port test had passed (baseline 0/4), no end-to-end hardware scan/report had been validated, multi-device isolation and 50-device capacity remained untested, and no capability was RELEASE-VALIDATED in the latest handoff.

The main outstanding work falls into four different categories; these must not be mixed together:

1. **Correctness and evidence integrity:** lifecycle identity is conflated; report and scan state need well-defined ownership; failed-scan and finalisation paths need approved, reproducible end-to-end scenarios.
2. **Incomplete integration:** USB/PnP and WPD/MTP transport classes use injected probes; the documented production transport path and metadata scanner are not proved complete. Some backend work described in `P2B-SERVER-GAPS.md` is not present under the same names in the current server source.
3. **Security and authorization dependencies:** production patch-state trust anchors and key are absent; the governed patch-application and rollback boundary is not implemented; provisional capability policy is unresolved; sanitization must remain blocked unless its actual conditions and authorisation are satisfied.
4. **Validation and product completeness:** reports, UI descriptions, entitlement flows, backend acceptance, multi-device behaviour, physical hardware, Windows build, and release evidence need work and proof.

**Engineering should not be globally frozen.** Read-only investigations, non-destructive regression tests, interface-contract tests, evidence accuracy improvements, reproducible builds that do not package installers, and hardware test planning can proceed when they do not cross a documented gate. Work that establishes security authority, changes the lifecycle identity contract, authorizes report-record corrections, claims provisional capability authority, signs the agent, applies/rolls back a patch, or executes sanitization must wait for the applicable decision and authorization.

## 2. What the engineering status labels mean

- **MODELLED:** a design or data structure exists. It does not prove that the feature runs.
- **UNIT-TESTED:** code has passed focused tests in a controlled local environment. It does not prove real transport, full workflow, or device behaviour.
- **PROTOCOL-EXPOSED:** a command or interface is available. It does not prove the UI is correctly wired or the real operation succeeds.
- **UI-INTEGRATED:** the desktop application calls the relevant interface and displays a result. This does not establish that the underlying transport/service is production-complete.
- **HARDWARE-VALIDATED:** the exact workflow has been exercised on physical hardware with retained evidence. A hardware test of one low-level enumerator does not validate the whole customer journey.
- **RELEASE-VALIDATED:** the approved release candidate passes the required automated, installed-layout, security, hardware, and operational gates with reproducible evidence.

The project handoff records the six focused tests (117/117) as **LOCAL ONLY**. It reports 0/4 ports passed, no end-to-end scan/report hardware test, no multi-device isolation test, no 50-device capacity test, and no RELEASE-VALIDATED capability. The 12-Oct handshake matrix is a dated engineering snapshot; its 114 parameters and per-row statuses must be rechecked before being treated as today's precise count.

## 3. Detailed pending engineering work

The entries below distinguish the condition visible in the reviewed source from claims in older audit documents. Where the public repository cannot show a local Windows file, private stash, physical device, or historical runtime observation, it is marked accordingly.

### ENG-01 — Device lifecycle identity and producer alignment (D-1 / U-1)

- **Status:** BLOCKED BY DEPENDENCY; defect source-visible.
- **Priority:** High — evidence correlation and downstream database validity.
- **What is pending:** The workstation currently sends the same session value as both `sessionUuid` and `deviceLifecycleId`. Those identities have different meanings. Other producers are reported to use a random lifecycle UUID per APK run or the literal `unknown-lifecycle`; all producers need one coherent contract.
- **Where:** `apps/host/src/main/kotlin/cyvra/mobile/host/service/WorkstationSessionOrchestrator.kt:210`; Android component interface `triggerEvidenceCollection(sessionUuid, deviceLifecycleId)`; bridge and evidence receiver; backend lifecycle/evidence schema and validation.
- **Current evidence:** Current source call is `.triggerEvidenceCollection(sessionUuid, sessionUuid)`. Project audit says the host has no lifecycle registry; the host-generated `CYVRA-SESSION-...` form is not a UUID and a syntactically valid UUID alone will not satisfy a foreign key unless the lifecycle row exists. U-1 is OPEN.
- **Why it remains pending:** No authoritative source/service/registry is established for the longer-lived lifecycle identity. A developer cannot invent the source by substituting a serial, IMEI, MAC, Android ID, session UUID, or hardware hash.
- **Why it matters:** Evidence can fail validation or cannot be reliably correlated across separate sessions. A fake “fix” could make the value look like a UUID but still reference no registered lifecycle.
- **How we will solve it:** (1) CE decides the identity origin and lifecycle semantics. (2) Define the registry record creation and lookup contract, including failure behaviour. (3) Add a host-side registry/lookup path and explicit propagation to the bridge, Android component, receiver, and backend. (4) Keep `sessionUuid` as a distinct session correlation ID and use opaque session-scoped device references where the design requires them. (5) Add a red-first orchestrator test asserting the two values differ and the lifecycle is registered. (6) Test successful, missing, malformed, unregistered, wrong-lifecycle, and backend-FK-refusal cases.
- **Dependencies and approvals:** `D-CE-26-01` / U-1 must be decided. Backend schema and architecture owner must be identified. No implementation that invents identity authority.
- **Acceptance criteria:** Every producer uses the same contract; lifecycle ID has the required format and a registered lifecycle row; session ID remains distinct; no sensitive hardware identifier is used as lifecycle authority; mismatches fail closed and are observable.
- **Required verification:** Unit + orchestrator binding tests; protocol/DB integration tests for registered and unregistered lifecycle IDs; then a physical-device evidence collection test.
- **Completion evidence:** Dated architecture ruling, schema/contract reference, test logs tied to a commit, and an end-to-end evidence record.
- **Can work start now?:** **PARTIALLY** — write red-first tests and map producers now; implementation waits for U-1.
- **Next action:** Draft the lifecycle identity contract and a test matrix without editing production code.

### ENG-02 — Report request ownership and empty-payload policy (D-2 / U-2(a))

- **Status:** Source-level serial guard is present; formal policy/ratification remains pending; broader multi-device proof NOT TESTED.
- **Priority:** High.
- **What is pending:** Define which active scan/session a request is allowed to read, and whether an omitted serial is allowed to mean “use the active scan” for the current single-session UI.
- **Where:** `HostProtocolDispatcher.kt` report handlers `deviceReportResponse` (around line 672), `exportReportResponse` (around 748), and `finalReportResponse` (around 1269); helper `serialOwnershipRefusal` (around 1634); UI command payloads.
- **Current evidence:** The current handlers call `serialOwnershipRefusal` against the recorded active scan serial. The helper refuses a supplied mismatched serial but permits an omitted serial. This is a source-level guard, not proof of physical multi-device isolation. Handoff says U-2(a) is claimed in a source comment but no formal governance ruling was found.
- **Why it remains pending:** The desktop UI ordinarily omits serial on commands other than `RUN_SCAN`; changing to mandatory session-keyed requests could break the current UI unless updated in the same scope. The explicit empty-payload policy is not recorded as an authorized decision.
- **Why it matters:** If request state is not bound to the expected session/device, the UI or another protocol client may show or export stale/unexpected evidence. The current serial guard reduces one class of mismatch, but does not prove all session or concurrency cases.
- **How we will solve it:** (1) CE records U-2 ownership and empty-payload semantics. (2) Trace every report/inventory/export/final report request from UI to host. (3) Add tests for absent, matching, mismatching, malformed, and stale-session references. (4) If session-keyed binding is selected, update the wire contract and UI together. (5) Preserve serial privacy and never expose a serial in a filename. (6) Validate separate device/report mapping on actual hardware after multi-device architecture is approved.
- **Dependencies and approvals:** `D-CE-26-03` / U-2(a); do not infer approval from a source comment dated 21-Oct.
- **Acceptance criteria:** Every command either has a defined current-session policy or a validated identity; mismatch requests are refused; omitted payload semantics are documented and tested; no wrong-device report is returned in the approved scenario.
- **Required verification:** Host dispatcher unit tests, UI protocol contract tests, interleaved-session integration tests, then multi-device hardware test.
- **Completion evidence:** Formal ruling, test output, reviewed payload examples and hardware record.
- **Can work start now?:** **PARTIALLY** — test audit and contract map can start; changing the policy waits for U-2.
- **Next action:** Inventory all report and inventory commands and record the exact UI payload each sends.

### ENG-03 — Sanitization target binding (D-3)

- **Status:** Guard present in source; regression and physical isolation validation remain required; sanitization itself remains gated.
- **Priority:** Critical for any future destructive execution; execution must remain disabled until authorized.
- **What is pending:** Prove that the target used throughout the sanitization lifecycle remains the same target recorded by the active scan and lifecycle start, including mismatched wire payloads.
- **Where:** `HostProtocolDispatcher.kt`, `sanitizeStartResponse` (around line 919 / serial guard around 930), `sanitizeExecuteResponse` (around line 1103 / guard around 1162), the lifecycle barrier and sanitization provider.
- **Current evidence:** Source compares any supplied serial with the recorded active-scan/locked target and refuses mismatches. The host also checks current offline entitlement flags and requires operator acknowledgement and confirmation phrase. This is not method qualification or destructive authorization.
- **Why it remains pending:** The policy's formal record is still pending; source guards do not prove same-device behaviour under reconnect, process failure, concurrency, or real hardware conditions.
- **Why it matters:** Any target drift in a destructive workflow risks acting on a device different from the one the operator assessed.
- **How we will solve it:** (1) Confirm U-2/U-3 semantics and the sanitization state machine contract. (2) Keep the active scan serial authoritative and bind lifecycle start to it. (3) Add red-first tests for matching, absent, mismatched and post-reconnect target identity. (4) Verify every refusal occurs before any destructive call. (5) Test only non-destructive refusal paths unless separate formal authorization and live entitlement permit more.
- **Dependencies and approvals:** U-2/U-3 and the standing sanitization authorization/live-entitlement requirements. This plan does not authorize wipe or sanitization.
- **Acceptance criteria:** Mismatched target is refused before destructive call; target is unchanged from scan to execution; absent identity cannot silently select another device; refusals are reported accurately.
- **Required verification:** Unit tests with a spy proving destructive provider call count is zero on refusals; protocol integration tests; approved physical validation under a separately authorized procedure.
- **Completion evidence:** Test logs and source review; if a qualified operation is later authorized, separate signed/dated hardware evidence and final report review.
- **Can work start now?:** **PARTIALLY** — non-destructive guard regression tests can start; never run sanitization under this task.
- **Next action:** Add tests that assert `sanitizeExecute` is never invoked for a target mismatch.

### ENG-04 — Failed-scan state invalidation and recovery (D-4 / U-3(a))

- **Status:** Source fix present; scenario revalidation needed; governance decision remains OPEN.
- **Priority:** High.
- **What is pending:** Ensure that a failed scan does not leave previous scan evidence, report state, or sanitization state available to later commands, while an entitlement refusal before scan work begins follows the approved policy.
- **Where:** `HostProtocolDispatcher.kt:591-609` in `runScanResponse`; state holders `lastScan`, `scanEvidence`, `patchStateRefusalReason`, lifecycle/sanitization state and the `noScanError` handlers.
- **Current evidence:** The exception path clears those state holders and returns `SCAN_FAILED`. The comment explicitly distinguishes a real execution failure from an early `SCAN_REFUSED` path. Handoff says no regression was found when D-4 was rechecked; it does not prove all crash/retry paths. U-3 remains asserted in source only.
- **Why it remains pending:** The clearing behaviour exists, but the CE has not formally ratified retain-vs-clear behaviour in the governing record, and full restart/retry/concurrency scenarios have not been proved.
- **Why it matters:** An old device report must not be returned after a failed attempt on another device; clearing too early on a pre-work refusal may also degrade a legitimate operator workflow if not specified.
- **How we will solve it:** (1) Record U-3's intended semantics. (2) Add failure injection after target resolution, during collection, during report serialization and during state transition. (3) After each execution failure, issue report/export/inventory/sanitize-start requests and confirm they refuse rather than return old state. (4) Separately test entitlement refusal before work begins. (5) Test host restart and re-scan recovery.
- **Dependencies and approvals:** `D-CE-26-04` covers U-3(a) and U-6 behaviour/testing; do not reimplement the source fix unless tests show a regression.
- **Acceptance criteria:** Failed scan cannot serve previous scan evidence; pre-work refusal behaves per signed-off policy; a fresh successful scan restores normal behaviour; reset behaviour is deterministic.
- **Required verification:** Host protocol unit and workflow tests, fault-injection tests, process-restart test; later physical multi-device test.
- **Completion evidence:** Test logs, exact failure-injection cases and observed response codes.
- **Can work start now?:** **YES** for read-only trace and regression tests, subject to the project's test-scope approval; **NO** for changing the agreed policy before U-3.
- **Next action:** Build a table of each exception/refusal path and the state that should remain or clear.

### ENG-05 — Controlled final report (`FINALISE_REPORT`) and U-6

- **Status:** BLOCKED BY DESIGN when authoritative scan evidence is unavailable; intended product behaviour and end-to-end path require confirmation.
- **Priority:** High for evidence integrity.
- **What is pending:** Confirm what a finalised report is meant to be and prove that the result is tied to the current scan and its captured evidence rather than a default/template or stale report.
- **Where:** `HostProtocolDispatcher.kt:807-832` (`finaliseReportResponse`), the `ScanEvidencePacket`, `ReportGenerator`, `ReportFinaliser`, report store and the desktop finalisation/export UI.
- **Current evidence:** The current code requires `lastScan` and checks `scanEvidence` exists, matches `scan.sessionUuid`, and has probe results. Otherwise it returns `FINALISE_INPUTS_UNAVAILABLE` before writing an artifact. `CYVRA_PATCH_STATE_PROVIDER.md` says the patch state is not authoritatively established because trust and application boundaries remain missing. The old U-6 citation to lines 681–685 in the 20-Oct audit is stale; current path is around 807–843. The latest handoff says O-3 was NOT RE-EXECUTED.
- **Why it remains pending:** The patch-state input is blocked, and the CE has not formally recorded the intended final report semantics. A refusal may be correct security behaviour; it must not be “fixed” by fabricating empty/default evidence.
- **Why it matters:** A final report can become an audit artifact. It must not imply a controlled verification, patch state, or action that did not occur.
- **How we will solve it:** (1) Resolve U-6 and the D-5 contract first. (2) Specify the required inputs and provenance for Report 1 versus a final report/certificate. (3) Test missing, stale, wrong-session, empty-probe, unavailable-patch-state, and valid-input paths. (4) Confirm no artifact is created on refusal, and that generated file contents match the response and manifest. (5) Do not relax refusal gates just to produce a file.
- **Dependencies and approvals:** `D-CE-26-04` for U-6 behaviour plus D-5 decisions D-CE-26-02 and SO-1 through SO-4 as applicable.
- **Acceptance criteria:** Valid finalization uses the approved authoritative inputs of the active scan; invalid/missing inputs refuse before writing; artifacts and manifest hashes agree; no placeholder claim is mistaken for completed sanitization.
- **Required verification:** Unit/integration tests plus artifact/hash verification; approved hardware end-to-end test after D-5 is resolved.
- **Completion evidence:** Dated U-6 ruling, source/test logs, sample report with redacted device identity and matching SHA-256 manifest.
- **Can work start now?:** **PARTIALLY** — test design and artifact-provenance review can start; production finalisation completion is blocked by D-5/U-6.
- **Next action:** Write the expected input/output/refusal matrix for `FINALISE_REPORT` from the current code, marking old line references stale.

### ENG-06 — Production patch-state authenticity and application lifecycle (D-5)

- **Status:** BLOCKED BY DESIGN; not production-complete.
- **Priority:** Critical for any claim about signed capability patches or authoritative applied state.
- **What is pending:** Complete a governed chain from signed patch validation to approved procedure selection, actual application/rollback, durable state, authenticated applied-state evidence, and truthful report finalization.
- **Where:** `docs/CYVRA_PATCH_STATE_PROVIDER.md`; `PatchTrustAnchors.kt`; `PatchVerifier.kt`; `PatchStateStore.kt`; `PatchSetState`; the application authorizer/authenticator seams; finalization and report generation.
- **Current evidence:** The provider document says `PatchTrustAnchors.ALL` is empty and no public key/`key_id` has been issued; `PatchStateStore` implements persistence mechanics but is not wired in production; `NoGovernedPatchApplicationAuthoriser` and `UngovernedAppliedStateAuthenticator` refuse by default; there is no procedure registry; `VerifiedPatch` never leaves the verifier into a production application lifecycle; `PatchSetState.with(...)`/`rollback(...)` have no production callers. A local applied-state record cannot prove itself authoritative. The only legitimate `NO-PATCHES` result requires a positively read, authenticated state record which explicitly declares an empty set.
- **Why it remains pending:** The missing elements are not just coding details. They require approved authenticity architecture, record format, key issuance/custody and lifecycle policies, offline behaviour, monotonic sequence authority, and provisional capability policy.
- **Why it matters:** Without the full chain, the application cannot honestly claim which patch set is applied or that a patch was applied/rolled back. A missing file is not proof of no patches.
- **How we will solve it:** (1) CE chooses the applied-state authenticity model and ratifies the schema/record format together. (2) Security Owner answers SO-1 through SO-4. (3) Only after real approved key material is issued through custody, provision the authorized public key and `key_id`; never commit a private key or generate a test key as a substitute. (4) Design an explicit procedure registry that maps governed procedure IDs to already-approved operations. (5) Implement a staged/revalidated atomic application or rollback lifecycle that only records actions actually performed. (6) Wire `PatchStateStore` into the same governed lifecycle and require authenticated state read/write. (7) Make reports include patch ID, payload hash, key ID, sequence/mode and provenance, with refusals on ambiguity. (8) add negative tests at every gate, then do separate integration and security review.
- **Dependencies and approvals:** `D-CE-26-02`; `SO-1` key + `key_id`, `SO-2` rotation/retirement record, `SO-3` offline policy, `SO-4` monotonic sequence authority, and `D-CE-26-07` provisional-row policy. D-5 must not be implemented as a partial chain.
- **Acceptance criteria:** Approved schema and threat/trust model; issued genuine production public key and key ID; private key remains outside repository; procedure registry limits execution to approved procedures; applied/rollback records only occur after an actual action; records are authenticated and monotonic; absent/unreadable/unauthenticated state never becomes `NO-PATCHES`; final report refuses if authoritative inputs are unavailable.
- **Required verification:** Schema contract tests, signature/key-policy tests, record corruption/replay/stale sequence tests, procedure allowlist tests, atomic interruption/recovery tests, application/rollback integration tests in a governed non-destructive test environment, security review, then release validation.
- **Completion evidence:** Dated CE/SO rulings; key custody issuance record containing no private key; schema version and code review; tests and security review; artifact/report examples.
- **Can work start now?:** **PARTIALLY** — threat-model comparison, spec review and red-team/fail-closed tests can be prepared; production trust, application and rollback implementation is blocked.
- **Next action:** Prepare a decision memo comparing hardware-rooted attestation limits with external-uplink countersigning; do not insert any key or wire the store yet.

### ENG-07 — Capability policy and provisional `[P]` rows

- **Status:** DECISION REQUIRED; validation path presently recognises row IDs but does not itself settle authority of provisional rows.
- **Priority:** High for the correctness of capability/patch claims.
- **What is pending:** Define whether a patch may rely on any of the 15 provisional `[P]` entries in the 22-row matrix.
- **Where:** `docs/CYVRA_CAPABILITY_MATRIX_V1.md`; `CapabilityMatrixLoader.kt`; `PatchVerifier.kt` step 8; the signed patch schema and report `provisional` marker.
- **Current evidence:** The provider document records 22 row IDs, 15 provisional and 7 ratified, and notes that lookup by bare `ITEM ID` was corrected. It also says a `[P]` row currently resolves by exact string membership, while authority to depend on that row has not been settled.
- **Why it remains pending:** Resolving a row ID answers “does the row exist?” It does not answer “has this row been approved for production authority?” Those are different checks.
- **Why it matters:** A cryptographically signed patch could otherwise point to a known but still provisional capability and be treated as authorized.
- **How we will solve it:** (1) CE determines what `[P]` means in the production verification contract. (2) Define separate parsing/existence and authority checks. (3) If fail-closed policy is ratified, reject provisional rows in production patches with an explicit reason while preserving them for draft/analysis contexts. (4) Test ratified, provisional, unsupported, malformed and unknown row IDs. (5) Document migration and report disclosure.
- **Dependencies and approvals:** `D-CE-26-07`; D-5 schema and authenticator/application path must be ratified coherently.
- **Acceptance criteria:** The production verification behaviour matches the signed policy; provisional rows cannot acquire authority by mere presence; reports clearly state provisional/unavailable conditions.
- **Required verification:** Loader and verifier tests for all row classes; schema/conformance review.
- **Completion evidence:** CE ruling and tests tied to approved commit.
- **Can work start now?:** **PARTIALLY** — tests and policy options can be prepared; changing authority behaviour awaits CE decision.
- **Next action:** Build the explicit 22-row list with each row’s ID, marker, current verification behaviour and required policy outcome.

### ENG-08 — Windows USB/PnP production integration (P1)

- **Status:** BLOCKED BY DEPENDENCY for the full production path; injected probe abstraction exists. Do not call it entirely absent.
- **Priority:** High for identifying attached devices when ADB is disabled.
- **What is pending:** Connect physical Windows enumeration to the product’s transport/domain/UI flow so the app can independently establish USB presence, distinguish charge-only/unplugged/debugging-off cases, and retain safe evidence provenance.
- **Where:** `apps/host/src/main/kotlin/cyvra/mobile/host/transport/TransportManager.kt:120-165` (`UsbPnpTransport`, `UsbPnpProbe`); native Windows USB path in `apps/desktop/src-tauri/src/usb/`; transport coordinator and preflight/UI.
- **Current evidence:** Host transport logic uses an injected `UsbPnpProbe` to enumerate `UsbDeviceRecord`s; it returns an availability signal and descriptor-only evidence. The active architecture contract defines Windows USB/PnP as a separate observation plane. Handoff states production integration is still incomplete. Repository connector review did not establish a current end-to-end runtime path.
- **Why it remains pending:** The transport abstraction and test seam exist, but the real Windows discovery adapter/lifecycle, device-change handling, stable enumeration and product integration are not shown to be production-complete by the evidence reviewed here.
- **Why it matters:** The app must not infer that a cable is absent merely because ADB is unavailable, nor infer ADB authorization from USB presence.
- **How we will solve it:** (1) Trace Rust native USB observer events and actual SetupAPI/Configuration Manager enumeration. (2) Connect the production adapter to `UsbPnpProbe` without leaking raw PnP identity over public IPC. (3) Implement settle/debounce windows, reconnect/disconnect handling and error statuses. (4) keep descriptor-only scope. (5) Map host observations to the explicit transport result and UI preflight. (6) test both live device events and no-device/permission/error states.
- **Dependencies and approvals:** Architecture contract and relevant protected-path rules; no new driver binaries (standing H5). Hardware access required for validation.
- **Acceptance criteria:** Unplugged, USB-present/ADB-off, USB-present/ADB-unauthorized and fully authorized device states are reported separately; no false inference between planes; only allowed descriptors are collected.
- **Required verification:** Adapter unit tests, Windows integration tests, device-event tests on Win10/11, then four-port physical baseline.
- **Completion evidence:** Windows test logs, sanitized device-state traces, UI evidence and per-port hardware worksheet.
- **Can work start now?:** **PARTIALLY** — source mapping and adapter tests can start; production integration should follow the approved transport boundary and validation requires hardware.
- **Next action:** Trace whether the current Rust native USB observer is reachable from the Tauri commands and how it supplies `UsbPnpProbe`.

### ENG-09 — WPD/MTP production integration and bounded metadata scanner (P2)

- **Status:** BLOCKED BY DEPENDENCY / incomplete integration; some lower-level device-manager enumeration may have historical hardware evidence.
- **Priority:** High for independent shared-storage corroboration, but strictly read-only.
- **What is pending:** Establish real Windows Portable Devices/WPD/MTP discovery and a bounded, consent-respecting metadata scanner, integrated through the host and desktop.
- **Where:** `TransportManager.kt:177-237` (`MtpTransport`, injected `MtpProbe`); `docs/WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md`; native WPD/MTP code in `apps/desktop/src-tauri/src/wpd/`; transport/coordinator/UI and report provenance.
- **Current evidence:** `MtpTransport` accepts an injected `MtpProbe` and only returns volume metadata when the authorization/lock state is open. The project index says device-manager enumeration on a real Samsung handset was `HARDWARE-VALIDATED`, but also expressly says the WPD storage/content metadata scanner is not implemented. The newer handoff still treats production USB/PnP and WPD/MTP integration as blocked. These can both be true: low-level enumeration can be hardware-proved while the full product evidence path remains incomplete.
- **Why it remains pending:** Actual WPD device-manager/COM runtime wiring, unlocked-device consent gates, bounded object metadata enumeration and end-to-end report integration are not proved complete.
- **Why it matters:** MTP exposure is not full filesystem access and does not imply ADB access. An empty locked-device result must be labelled as not exposed, not “storage empty.”
- **How we will solve it:** (1) Trace and reuse any existing production WPD manager/discovery implementation. (2) Wire it to the injected probe seam. (3) limit reads to shared-storage volumes and approved metadata; no identifiers, personal content, `/data/data`, or writes. (4) Enforce locked/consent behavior and bounded enumeration/timeouts. (5) report enumeration completeness/limitations honestly. (6) run Windows integration tests and separately validate locked/unlocked devices.
- **Dependencies and approvals:** Active transport contract, device unlock/consent and physical test device. No private-content extraction; no change to sanitization.
- **Acceptance criteria:** Real WPD visibility is independent of ADB; locked devices yield NOT_EXPOSED/not-tested rather than an empty-storage assertion; unlocked path returns bounded metadata only; errors, disconnects and partial enumeration are explicit.
- **Required verification:** Probe contract tests, Windows WPD integration tests, metadata scope/privacy tests, physical-device tests.
- **Completion evidence:** Test logs, source-reviewed allowlist, device-state screenshots/trace and report manifest.
- **Can work start now?:** **PARTIALLY** — implementation trace and tests can start; physical integration proof needs an authorised device.
- **Next action:** Map every WPD/PnP native implementation file to the Kotlin injection point and mark which path is actually invoked in production.

### ENG-10 — ADB transport resilience and Android companion integration (P3/P4)

- **Status:** ADB implementation exists; end-to-end support/companion coverage remains incomplete or NOT TESTED by the latest handoff.
- **Priority:** High.
- **What is pending:** Validate per-device ADB process targeting, authorization state, timeouts, command allowlist, reconnect behaviour, and the optional Android companion evidence path with correct scope/consent and lifecycle identity.
- **Where:** `TransportManager.kt` ADB transport; ADB client and process lifecycle; `apps/android/app`/component; `HostAndroidComponentBridge`; receiver and UI connection state.
- **Current evidence:** The transport abstraction identifies ADB as P3 and the primary richer evidence plane, requiring debugging and accepted-key authorization. Project handoff reports a prior ADB-unauthorized bench condition; it is historical and must be rechecked. Companion transport seams have been described as injected lambdas; the repository review does not prove the full APK-to-host flow is operational for a production-approved scenario. An unsigned sanitizer APK is intentionally held under H4 and is not eligible for installation as shipped.
- **Why it remains pending:** Devices differ by Android version/OEM, and physical presence, ADB availability, ADB authorization and companion permission are separate facts. Device-side lifecycle IDs also depend on U-1.
- **Why it matters:** The app must not equate “not authorized for ADB” with “not connected,” silently target the wrong device, or overstate the scope of collected evidence.
- **How we will solve it:** (1) Establish independent connection states across USB and ADB. (2) prove each ADB invocation includes the approved target serial. (3) test offline, unauthorized, device-not-found, timeout, disconnect and reconnect. (4) verify the exact read-only command allowlist and privacy restrictions. (5) wire the companion trigger/readback to the agreed identity and explicit user scope grant. (6) keep sanitizer agent signing/installation separate and blocked by H4 until separately resolved.
- **Dependencies and approvals:** U-1 for lifecycle identity propagation; current companion scope/consent contract; H4 and Security Owner ruling for any agent signing. Do not sign or install an unsigned agent.
- **Acceptance criteria:** ADB and physical USB states are separately represented; target serial is bound to the operation; only allowed read-only probes run; companion data includes correct identity/provenance and only permitted scope; refusals are clear.
- **Required verification:** Host/ADB client unit tests, Android component/bridge tests, protocol integration tests, physical Android device matrix across supported API/OEM targets.
- **Completion evidence:** Sanitized ADB traces, component test reports, device/version/consent matrix and per-device evidence references.
- **Can work start now?:** **PARTIALLY** — safe ADB contract tests and read-only path tracing can start; lifecycle-sensitive companion implementation waits on U-1, and signing is blocked by H4.
- **Next action:** Create a four-state test table for USB presence × ADB availability × ADB authorization and ensure UI reports each state separately.

### ENG-11 — Report formats, separate deliverables, destinations, filenames and indexing (A2/A7)

- **Status:** INCOMPLETE requirement set; confirm current store behaviour before editing.
- **Priority:** High (user-facing deliverable requirement).
- **What is pending:** Meet the approved report format and delivery requirements: Report 1, the separate application inventory report if required, and final sanitization report only where legitimately produced; human-readable format, location, filename, and a manifest/index. Avoid merging reports with different meanings.
- **Where:** `HostReportStore.kt`; host `EXPORT_REPORT`; desktop report/export step in `apps/desktop/src/App.tsx`; report schemas, path configuration and SHA-256 manifest.
- **Current evidence:** Current dispatcher returns and writes JSON and Markdown (`format: json+markdown`) for Report 1 and returns JSON/Markdown paths and a SHA-256 manifest. The 18-Oct defect register describes the product as JSON/Markdown only, filenames `report.json`/`report.md`/`manifest.json`, no PDF capability, and one combined export rather than three separate reports. Its historical path under `C:\Program Files` may be stale after the state-root change; verify the actual `HostReportStore` implementation and installed configuration before concluding where files currently land.
- **Why it remains pending:** Output format, whether plain text or PDF is required, the final destination (fixed folder vs save dialog), and exactly which reports are separate are product decisions. The path must be writable by an ordinary user and must not imply unsupported sanitization has occurred.
- **Why it matters:** Operators need to find, open and hand over the correct report. A combined file or opaque path can confuse evidence custody, and a filename containing a serial may leak sensitive device identity.
- **How we will solve it:** (1) Re-check the current requirements and report store. (2) CE selects plain text first or PDF now, destination folder vs Save As, and the report split. (3) Define distinct schemas/filenames and a top-level index manifest. (4) Generate formats from the same canonical data, not independently. (5) keep serials out of filenames; sanitize/allowlist names and avoid path traversal. (6) validate SHA-256 for every file and ensure response paths match the files written. (7) test ordinary-user permissions, collisions, overwrite behavior and partial failure.
- **Dependencies and approvals:** Product/CE decision on format, destination and report set; output must not manufacture a final sanitization report without authorized operation evidence.
- **Acceptance criteria:** Operator can download/open every required report; all names are readable and privacy-safe; output is written to an ordinary-user-writable chosen path; every exported item is indexed and hashed; report content is consistent with evidence and UI status.
- **Required verification:** Host report-store unit tests, path permissions tests, export/UI integration tests, file hash verification on Windows.
- **Completion evidence:** Redacted sample exports, checksum manifest, destination and permissions test result, decision record.
- **Can work start now?:** **PARTIALLY** — source audit, manifest/hash tests, and report-format proposal can start; format/scope UI changes wait for CE decision.
- **Next action:** Inspect `HostReportStore.kt` current write paths and create a requirements-to-current-output table before choosing implementation scope.

### ENG-12 — Operator ID control placement and truthfulness (A1/A8)

- **Status:** Reported defect; latest source requires a UI/runtime recheck before final closure.
- **Priority:** High in the defect register.
- **What is pending:** The control should be accessible where the finalization/sealing action requires an operator ID, and its label/help text must accurately distinguish optional scan metadata from required report finalization input.
- **Where:** `apps/desktop/src/App.tsx` (current `Operator ID (optional)` appears around line 2825; finalization/export UI is farther down); host `finaliseReportResponse` defaults the operator ID from request or scan report header.
- **Current evidence:** Current source retains an `Operator ID (optional)` label and “Sent only when filled in” style help in the scan branch. The 18-Oct defect register says the final seal button requires a non-empty operator ID but the input is not on that step; that runtime observation was not repeated in this GitHub-only review. It should be marked `NOT REVERIFIED` until UI conditions are traced and tested.
- **Why it remains pending:** A shared React state variable may make a value persist even while the control is not rendered on the final step, but the operator may not be able to enter/correct the value there. The current label may contradict a downstream required field.
- **Why it matters:** The operator can be blocked at sealing, or a final artifact can carry placeholder identity such as `unspecified-operator`, reducing traceability.
- **How we will solve it:** (1) Trace state and render conditions for every step. (2) reproduce the seal flow with empty and non-empty operator ID. (3) place the required field at the point of use, or clearly explain where it is set. (4) distinguish the scan-time optional field from sealing-time required input if both roles exist. (5) test keyboard navigation, validation, persistence and output report identity.
- **Dependencies and approvals:** Confirm whether operator identity is required for Report 1, finalization or both; preserve no-sanitization claims and report audit rules.
- **Acceptance criteria:** Operator can supply a required identity where needed; no false “optional” label when mandatory; no silent placeholder is used for an action that mandates operator attribution.
- **Required verification:** React component/UI tests, host protocol tests, final report sample review.
- **Completion evidence:** UI test results, screenshot of the final step, redacted sample report.
- **Can work start now?:** **YES** for a current-source reproduction and test; actual behavior change after confirmation.
- **Next action:** Trace the `operatorId` state from the input render through the finalization request and report header.

### ENG-13 — UI Help and workflow unlock semantics (A3/A4)

- **Status:** Current-source discrepancy VERIFIED.
- **Priority:** Medium to Medium-High (misleading operator instructions).
- **What is pending:** Correct the help text or make the lock rules match it. The current help says “five steps” and strict sequential unlocking; source defines six steps and uses prerequisites that do not form a strict sequence.
- **Where:** `apps/desktop/src/App.tsx`: `stepLock` around line 1613; help text around line 3404.
- **Current evidence:** `stepLock` has six entries (`connect`, `scan`, `inventory`, `sanitize`, `checklist`, `export`); `checklist` is intentionally never locked, and inventory/sanitize/export depend on a completed scan rather than each preceding step. Help still says “Work through the five steps above in order. A step unlocks only when the one before it has finished.”
- **Why it remains pending:** Product intent may intentionally allow checklist and export independently of another step; forcing a strict sequence could block valid workflows. The help is demonstrably inconsistent with current behavior.
- **Why it matters:** Operators may think the app is broken or follow incorrect steps; tests and operator training may encode the wrong assumption.
- **How we will solve it:** (1) CE confirms intended step order and reason each step can unlock. (2) If current gates are intended, rewrite the help to describe six steps and actual prerequisites. (3) If strict order is required, change `stepLock`, UI disabled state and protocol gate together. (4) add tests that compare gate behaviour with documented help semantics.
- **Dependencies and approvals:** Decision on A4 workflow intention; no broad UI redesign required.
- **Acceptance criteria:** Help accurately describes the number of steps and lock rules; each enabled button matches host preconditions; tests prevent drift.
- **Required verification:** UI component tests, click-through workflow tests, keyboard/accessibility check.
- **Completion evidence:** Decision record, diff, test output and screenshot walkthrough.
- **Can work start now?:** **PARTIALLY** — documenting the discrepancy and tests can start; selecting a different workflow needs CE decision.
- **Next action:** Prepare a six-row table listing each step’s actual prerequisites and the corresponding help sentence.

### ENG-14 — Application inventory completeness, A-10, and coverage truthfulness (A-9)

- **Status:** Decision/test required; A-10 NOT PROVEN fixed; A-13 NOT REVERIFIED.
- **Priority:** High for A-10 in the defect register; A-9 requires CE decision.
- **What is pending:** Confirm that application-list collection is actually read and attributed with evidence, and the UI does not present a step as fully successful when the report says coverage is PARTIAL or unavailable.
- **Where:** `App.tsx` functions using `enumerationCompleteness`/`inventoryOutcomeText`; host `applicationInventoryResponse`; Android package inventory providers; `HostProtocolDispatcher.kt:705-738`; capability matrix rows for applications and coverage.
- **Current evidence:** Host response returns counts, source availability, S1/S2 evidence flags, `enumerationCompleteness`, conflicts, limitations, and `rawUidWithheld = true`. UI reads `enumerationCompleteness`. The handoff says the offending A-10 string is absent from current source but explicitly does not call this a fix. The old register’s measured report/UI mismatch `Coverage Level: PARTIAL` vs `COMPLETED` was not reproduced in the current run.
- **Why it remains pending:** Missing phrase, source implementation, or one sample report is not proof that the underlying requirement is satisfied. A partial scan can be a legitimate outcome, but the UI must distinguish “workflow step finished” from “coverage complete.”
- **Why it matters:** An operator may confuse completion of an attempt with full coverage and overstate the report.
- **How we will solve it:** (1) Define separate operation status and evidence coverage status. (2) exercise success, partial, unavailable, filtered, conflicting S1/S2 and empty inventory cases. (3) ensure report and UI use the same canonical coverage result. (4) verify raw app UIDs remain withheld. (5) CE rules whether the reported `PARTIAL` case is expected and whether to surface coverage more prominently. (6) re-run A-13/O-3 scenarios before closing their related records.
- **Dependencies and approvals:** CE ruling for A-9; use the authoritative matrix and privacy restrictions.
- **Acceptance criteria:** `COMPLETED` means the collection step reached its end; coverage is separately and visibly `COMPLETE`, `PARTIAL`, `UNAVAILABLE`, or equivalent; no unsupported completeness claim is made; application evidence provenance is retained.
- **Required verification:** App inventory provider tests, report schema/content tests, UI integration tests, target-device package-list check.
- **Completion evidence:** Retained sample response, report excerpt, test output and dated CE resolution for A-9.
- **Can work start now?:** **YES** for scenario/test design and tracing; a coverage-policy change requires the CE decision.
- **Next action:** Add a test matrix mapping each `enumerationCompleteness` value to the exact displayed status and report wording.

### ENG-15 — Release logging and diagnosability (A5/B3)

- **Status:** Reported issue; exact current Rust setup NOT REVERIFIED in this review.
- **Priority:** Medium; operationally important when release failures occur.
- **What is pending:** Decide whether release builds must log to a protected, writable state directory and ensure the actual configuration records errors without leaking secrets or personal device data.
- **Where:** `apps/desktop/src-tauri/src/lib.rs` logging plugin setup; `commands.rs`; `cyvra.home` and audit-file destination; Windows log lifecycle.
- **Current evidence:** The 18-Oct defect register says `tauri_plugin_log` setup is conditional on `cfg!(debug_assertions)` at `lib.rs` and that release warnings are consequently silent. Option C is described in that register as addressing writable state/audit destination, but the release logger itself remains open. This was not independently re-read in the latest GitHub call, so the exact current code must be rechecked before edits.
- **Why it remains pending:** Logging destinations and behaviour are product/security decisions. The application must not write state under a protected install folder or leak serials, private app data, entitlements, secrets, or patch keys.
- **Why it matters:** Unexplained failures cost operator time and can make post-incident reconstruction impossible.
- **How we will solve it:** (1) Reverify logger and audit sink in the current branch. (2) CE selects release logging policy and destination. (3) route safe operational codes to a standard writable state/log directory. (4) apply size/retention caps and secret/identifier redaction. (5) test on a normal user account and when the disk/path is unavailable. (6) ensure logging failure does not authorize an unsafe operation or mask the original refusal.
- **Dependencies and approvals:** CE decision from defect register; state-root behavior and privacy/log retention policy.
- **Acceptance criteria:** approved events are available in release-mode test; logs are writable under ordinary user privileges; no secrets or prohibited personal content are emitted; rotation/retention and failure behavior are defined.
- **Required verification:** logger tests, redaction scans, Windows installed-layout test using a non-admin account, audit-failure injection.
- **Completion evidence:** decision record, sample redacted log, retention policy and test output.
- **Can work start now?:** **PARTIALLY** — read-only audit of current logging and design proposal can start; behaviour change waits for policy decision.
- **Next action:** Re-read `lib.rs`, `commands.rs`, the current state-root configuration and log plugin config from the current ref.

### ENG-16 — Desktop typecheck coverage and standing small defects (A6 + backlog)

- **Status:** Build typecheck exists; dedicated workspace `typecheck` target and other standing items need cleanup/reverification.
- **Priority:** Medium for consistent gates; Low-Medium for cosmetic warnings.
- **What is pending:** Make root/workspace typecheck commands consistently include `apps/desktop`; triage `hostVersion=0.0.0`, duplicate React key warning, stage-gate Help text, H3 wording and `retention-days` upload-step text.
- **Where:** `apps/desktop/package.json`, root and workspace scripts; `apps/host/build.gradle.kts:8`; `licenceTable.test.tsx`; `scripts/verify-stage-gates.ps1`; `apps/web/src/site/CustomerWorkspaceShell.tsx`; upload UI retention text.
- **Current evidence:** Current `apps/desktop/package.json` has `build: tsc -b && vite build` but no standalone `typecheck` script. Therefore CI’s desktop `pnpm run build` performs TypeScript compilation, but a recursive `pnpm -r typecheck` can omit the desktop package. Other standing defects are listed in the defect register but have not all been independently reverified against the current ref.
- **Why it remains pending:** A successful production build is not the same as a uniform workspace check, and old register entries can become stale when scripts or labels change.
- **Why it matters:** A recursive check can report green while not running the intended check in every package; stale version/copy text may mislead operators or support.
- **How we will solve it:** (1) Add a desktop typecheck script mirroring `tsc -b --pretty false` or current project conventions. (2) verify root recursive command now runs it. (3) re-test build script separately. (4) reverify each small backlog item and split real function defects from cosmetic copy. (5) fix in separate, narrow changes so regressions are attributable.
- **Dependencies and approvals:** Must obey current documentation consolidation freeze and scope rules; this inventory does not authorize modifying the product.
- **Acceptance criteria:** Recursive typecheck invokes every intended package and fails on a deliberate test type error; each standing issue has verified current status and a small acceptance test.
- **Required verification:** `pnpm -r typecheck`, existing desktop build/typecheck, targeted tests; do not trigger CI during this review.
- **Completion evidence:** package script diff, command output and updated verified backlog item list.
- **Can work start now?:** **YES** for read-only gate audit; implementation should be scheduled after the applicable product-code scope is confirmed.
- **Next action:** Compare root workspace scripts with each package and record which packages are actually included in `pnpm -r typecheck`.

### ENG-17 — Backend/admin server-gap record conflicts with current source (C-1 / P2B)

- **Status:** CONFLICT UNRESOLVED; current source checked for the relevant function names.
- **Priority:** Medium/High depending on which Phase 3 admin deliverable is required; stale/unverified state is the immediate concern.
- **What is pending:** Reconcile `docs/P2B-SERVER-GAPS.md` with the actual committed server implementation and tests, especially the payment metadata helper and five described gaps.
- **Where:** `docs/P2B-SERVER-GAPS.md`; `services/api/src/admin.ts` (current implementation has `paymentsFor`; `paymentStatusesFor` is absent); related admin API tests and historical stashes/worktree evidence.
- **Current evidence:** The server-gap document states “APPLIED, NOT COMMITTED” and contains a proposed `paymentStatusesFor` body, but current `admin.ts` has an implemented `paymentsFor` and no `paymentStatusesFor` symbol. The handoff C-1 explicitly calls out this conflict. The historical local stash contents are not accessible through the public GitHub connector, so their presence or relationship is not established here.
- **Why it remains pending:** The document may describe a prior uncommitted version or an intended change that never landed. Neither explanation should be assumed. Similarity in behaviour between `paymentsFor` and the old proposal must be assessed, not inferred from names.
- **Why it matters:** Admin tables/drawers can show inconsistent payment state if the actual acceptance contract is incomplete; blindly applying stale code could overwrite a later implementation or repeat work.
- **How we will solve it:** (1) Compare the five named requirements in P2B with current endpoints and `paymentsFor`. (2) inspect current server tests and API behaviour. (3) identify which requirements already exist, partially exist or remain missing. (4) retrieve/review stash contents locally if still relevant, without applying them. (5) write a reconciled result to a new engineering ticket or successor note only after review; do not rewrite the governance ledger during this work.
- **Dependencies and approvals:** No assumed stash access; code changes need a separate authorized server task and tests. Keep C-1 open until reconciled.
- **Acceptance criteria:** Each of the five original gaps maps to current code, tests and expected request/response; any remaining change is specified by a failing regression test.
- **Required verification:** API/service unit tests, database query tests, admin UI tests and a before/after requirements matrix.
- **Completion evidence:** Diff review, targeted test output and resolved source/document discrepancy record.
- **Can work start now?:** **YES** for read-only comparison and tests; implementation begins only for confirmed missing behaviour.
- **Next action:** Extract the five original P2B acceptance items and map each to a current function and existing test.

### ENG-18 — Entitlement qualification and sanitization readiness

- **Status:** BLOCKED BY DEPENDENCY; sanitization must not be executed as part of this plan.
- **Priority:** Critical for any destructive capability.
- **What is pending:** Demonstrate a supported, qualified sanitization method with explicit operator authorization, same-device targeting, current live entitlement that grants `sanitizeExecute`, controlled lifecycle state, reconnect and truthful post-operation evidence.
- **Where:** host license/entitlement provider and policy; `HostProtocolDispatcher.kt` sanitization gates; `HostDestructiveWipeProvider`; method eligibility/capability matrix; server entitlement API; final report and post-operation verifier.
- **Current evidence:** H6 in the governance ledger requires a live entitlement with `sanitizeExecute`; cached entitlements must never be coerced into granting it. Source rejects when the installed cached entitlement disallows destructive sanitization. The handoff says `OfflinePermissions.NONE` is fail-closed and sanitization qualification is blocked. The unsigned sanitizer agent remains intentionally unsigned under H4, with no key generation or signing permitted.
- **Why it remains pending:** Method qualification, agent/key custody, production entitlement, device eligibility, live authorization, and physical post-operation evidence are separate requirements. A host class or compile is not proof of safe/qualified erasure.
- **Why it matters:** An unauthorized or mis-targeted destructive operation can cause irreversible data loss and expose the business to false claims about sanitization.
- **How we will solve it:** (1) List each supported method and its platform/OEM/Android prerequisites. (2) require separate explicit user authorization and live entitlement for that exact same target. (3) resolve the relevant key/agent holds only through formal decisions. (4) test eligibility and refusal states without performing destructive action. (5) develop a separately commissioned, tightly controlled hardware test plan with target confirmation and stop conditions. (6) record operation attempted, completed, verified, or failed as separate statuses. (7) issue a final report only with evidence supporting the claim.
- **Dependencies and approvals:** H4/H6; relevant CE/Security Owner decisions; U-5 where audit corrections affect authorization prerequisites; method qualification, device authorization, and live entitlement. No destructive operation is authorized by this document.
- **Acceptance criteria:** Only approved qualified method is selectable; current live entitlement and explicit operator confirmation checked for the same device; no agent signing/install unless explicitly authorized; post-operation verification is genuine and report claim does not exceed evidence.
- **Required verification:** Refusal/entitlement unit tests, method qualification matrix, authorized hardware verification plan, post-operation evidence review and release security review.
- **Completion evidence:** Decision records, method-specific qualification dossier, entitlement check trace, test reports, physical evidence and approved final report.
- **Can work start now?:** **PARTIALLY** — methods/prerequisites/refusal tests can be reviewed; execution, signing, and destructive testing are **NO**.
- **Next action:** Produce a method-by-method qualification checklist and map each prerequisite to current gate code; run no destructive operation.

### ENG-19 — Desktop activation, writable state-root and installed-layout proof (B1/B2/B3)

- **Status:** Reported fix exists in prior records; current installed-layout proof NOT ESTABLISHED in this review.
- **Priority:** High if activation/export depends on it.
- **What is pending:** Verify that licence/entitlement, audit logs and reports use an ordinary-user-writable state root rather than `Program Files`, and that an installed app can activate, persist and re-open state as designed.
- **Where:** `HostSystemProperties.kt`; `AdbBinaryLocator`, entitlement providers, `HostReportStore`; `apps/desktop/src-tauri/src/host_process.rs`; `installer-hooks.nsh`; `tauri.conf.json` and NSIS package.
- **Current evidence:** The defect register describes Option C: separating writable state (`%ProgramData%\CYVRA Mobile`) from read-only installed tools (`Program Files`). The same document says B2 was addressed by changing the store to the state root and B3 only partly addressed because release logging remains an issue. But the old document also says nine files were staged/uncommitted at `fa3420a`; that historical status is stale for the current branch. This review did not build/install the product or verify current end-user permissions.
- **Why it remains pending:** Source/config state alone cannot prove NSIS hooks, process launch arguments, installed paths, ACLs, migration and uninstall/reinstall behaviour work together on a clean Windows machine.
- **Why it matters:** A failure to write entitlement/audit/report state can prevent activation or lose evidence while displaying an opaque UI state.
- **How we will solve it:** (1) Compare current source to the Option C decision and current branch. (2) check state/install properties flow from NSIS hooks to Tauri process and host. (3) prepare a non-admin installed-layout acceptance procedure. (4) on an authorized environment and separately approved build, confirm `%ProgramData%` creation, permissions, activation persistence, report write, logs, upgrade and uninstall/reinstall retention policy. (5) decide the uninstall retention and migration questions instead of inferring them.
- **Dependencies and approvals:** Existing freeze says no installer rebuild in the current task; new NSIS build/install only after separate reason and explicit authorization. Unsigned engineering output remains permitted; no MSI/WiX.
- **Acceptance criteria:** ordinary user can activate and write expected state; install directory remains read-only; configured state path is consistent; logs are diagnosable; uninstall/upgrade behaviour follows an explicit retention decision.
- **Required verification:** static configuration review now; later Rust/Gradle tests, install-layout self-test, NSIS installed acceptance on Windows 10/11.
- **Completion evidence:** config diff, logs, path/ACL transcript and installed-layout test report.
- **Can work start now?:** **YES** for read-only wiring and acceptance-script review; packaging/build/install is **NO** until separately approved.
- **Next action:** Trace `cyvra.home` and `cyvra.install` from Tauri launch configuration through Kotlin stores and NSIS hooks.

### ENG-20 — R-2/R-3 certification precondition and current generator (A-9/R-2/R-3 references)

- **Status:** OPEN; precondition NOT EXECUTED.
- **Priority:** High due to false-certification/provenance risk.
- **What is pending:** Complete the authorized precondition concerning the prohibited certification string and the live `CYVRA-CERT-` generator, then verify every affected report path.
- **Where:** `apps/host/src/main/kotlin/cyvra/mobile/host/service/WorkstationSessionOrchestrator.kt:457`; `SanitizationModels.kt:104-109` historical removal comment; `CYVRA_GOVERNANCE_LEDGER.md` R-2/R-3 entry and relevant gate scripts/report code.
- **Current evidence:** Handoff explicitly distinguishes two facts: the NIST verification string was removed from active code, while the `CYVRA-CERT-` generator remains live. It says the R-2/R-3 precondition was not executed and neither is closed. The ledger's “clean under grep” statement conflicts with current source according to the handoff.
- **Why it remains pending:** A removal note is not proof the whole precondition ran; the generator is a different issue from a historical string.
- **Why it matters:** Reports must not imitate a certification/verification process that was not run and must not state a certificate status unsupported by evidence.
- **How we will solve it:** (1) Re-read the governing precondition and all report/generator locations. (2) agree the required naming/wording changes with authority. (3) add a gate that tests the actual active generated output and prohibited string set, not just a comment. (4) run it against the approved paths and preserve the transcript. (5) ensure the report does not claim certification unless the approved process happened.
- **Dependencies and approvals:** R-2/R-3 governing instruction and any required CE decision; do not infer closure from existing grep/comment text.
- **Acceptance criteria:** The specified precondition has been executed; active generators and produced artifacts pass the gate; historical comments are explicitly excluded where appropriate; related register entries updated by authorized process.
- **Required verification:** targeted source search, report output inspection and project standing-hold gate in an authorized test scope.
- **Completion evidence:** gate transcript, source refs, report samples, approval record.
- **Can work start now?:** **YES** for read-only trace and a test proposal; changes wait for applicable approval.
- **Next action:** Compare the ledger's R-2/R-3 wording with the current generator and draft exact acceptance tests.

### ENG-21 — Four-port and multi-device end-to-end validation

- **Status:** NOT TESTED; physical authorization/dependencies required.
- **Priority:** Critical for any multi-device or capacity claim.
- **What is pending:** Demonstrate per-device identity/report isolation through connect, scan, evidence collection, export, and supported finalization on four physical ports, then validate any intended concurrency/capacity up to 50 devices.
- **Where:** Full path from Rust USB/PnP/WPD device enumeration, ADB transport, host protocol dispatcher, per-device/session state, UI, report store and entitlement ledger; bench baseline document and capacity test harness.
- **Current evidence:** Latest handoff says the four-port baseline is 0/4, end-to-end hardware scan/report is NOT TESTED, multi-device isolation is NOT TESTED and 50-device capacity is NOT TESTED. ADB was reported unauthorized on a previous bench device; that is historical and needs recheck. The architecture warns that physical presence, ADB availability and authorization are independent states.
- **Why it remains pending:** Unit tests and single-process state do not model real USB timing, reconnects, parallel devices, port differences, resource pressure or UI interleaving.
- **Why it matters:** A multi-device mistake could display or export another phone's evidence, misattribute entitlement or mis-target a later operation.
- **How we will solve it:** (1) Obtain hardware/operator authorization, supported device matrix and same-target safeguards. (2) complete and review the non-destructive single-device acceptance plan. (3) capture per-port device and session reference, scan/report IDs and hashes. (4) run exactly the documented four-port baseline with screenshots/traces and stop immediately on identity mismatch or destructive invocation. (5) introduce concurrent devices progressively, checking state isolation and resource limits. (6) attempt 50-device capacity only when the product and approved requirements genuinely intend it; define throughput, memory, failure isolation and timeouts first. (7) repeat disconnect/reconnect and partial failure tests.
- **Dependencies and approvals:** physical hardware authorisation, lifecycle/ownership decisions, production transport path and valid test entitlement; no sanitization without separate authorization. Four-port baseline must not be read as pass until each row is observed.
- **Acceptance criteria:** each device’s report consistently maps to the correct attached device; no prior-session report is served during failure/interleaving; disconnect/reconnect and failure conditions are safely handled; measured capacity claims match the verified count.
- **Required verification:** hardware acceptance, per-port state table, multi-device interleaving, repeated failure/reconnect tests, performance/resource measurements.
- **Completion evidence:** complete signed/dated test worksheet, logs and screenshots with serials masked, report hashes and incident/stop-condition transcript.
- **Can work start now?:** **PARTIALLY** — hardware test plan and non-destructive scripts can start; physical run waits for authorization and prerequisite integration.
- **Next action:** Turn the existing four-port operator checklist into a pass/fail worksheet with an explicit stop condition for any report/device mismatch.

### ENG-22 — Windows engineering CI, release build and packaging evidence

- **Status:** No Windows Engineering Build run seen in the reviewed Actions history; current commit status list empty. Packaging configuration is NSIS-only.
- **Priority:** High before any release claim.
- **What is pending:** Obtain a reproducible, authorized Windows engineering build with actual test/build/install-layout evidence on the correct source revision, then preserve the artifact metadata. Do not confuse no run with failed tests.
- **Where:** `.github/workflows/windows-engineering-build.yml`; `apps/desktop/src-tauri/tauri.conf.json`; Gradle, Cargo and pnpm build/test jobs; stage resource and installed-layout self-test.
- **Current evidence:** Workflow triggers on pushes to `phase2-correct` and `feature/p2-protocol-completion`, or manual `workflow_dispatch`; there is no `pull_request` trigger in the reviewed YAML. Those named branches were not among the current repository branches inspected. API history showed other deployment runs but no Windows Engineering Build run; combined status for `9c7697d` was empty. This proves only that no such run/status was found for this evidence window, not that source failed. Existing config has `bundle.targets: ["nsis"]`, and unsigned engineering artifacts are the approved development packaging scope.
- **Why it remains pending:** No qualifying run/artifact provides automated Windows compile/test/package and installed-layout proof for the target revision. Branch trigger design is a known constraint but workflow edits/dispatch are outside this task and require authorization.
- **Why it matters:** Local JVM tests do not prove Rust/Windows build, bundled Java/ADB payload, NSIS packaging, install permissions or actual startup on Windows.
- **How we will solve it:** (1) Verify current branch/HEAD and approved scope. (2) obtain explicit permission for any CI dispatch or workflow change. (3) use a permitted trigger path that runs against the intended SHA, without quietly altering triggers. (4) capture every job/test result, build artifact name/hash, installed-layout self-test and payload assertions. (5) test ordinary-user launch and capture logs. (6) keep artifact unsigned and labelled engineering-only.
- **Dependencies and approvals:** Separate full-suite/CI authorization. Do not run CI, edit workflow triggers, rebuild NSIS installer or generate `.exe` during this inventory. No WiX/MSI; no signing claims.
- **Acceptance criteria:** Windows workflow has a real successful run for the exact approved revision; all gates and tests are green; installed-layout self-test says `SELFTEST_OK` with `readyToScan=true`; NSIS output contains expected payload and passes approved install checks; artifact provenance/hash recorded.
- **Required verification:** Windows Gradle test, Rust `cargo test`/build, desktop TS build, resource staging, Tauri+NSIS build, artifact content assertions, installed-layout self-test and clean Windows install test.
- **Completion evidence:** Workflow/run URL, job logs, commit SHA, artifact SHA-256 and install test report.
- **Can work start now?:** **PARTIALLY** — read-only workflow audit and run-history inspection can continue; dispatch/workflow modification/build packaging requires explicit approval.
- **Next action:** Confirm the intended authorized CI route and exact commit before considering a dispatch; do not dispatch from this plan.

### ENG-23 — Entitlement/backend external integration and deployment evidence

- **Status:** PARTIAL / NOT END-TO-END VERIFIED; some current backend implementation exists, remote acceptance evidence incomplete.
- **Priority:** High where it gates scans or destructive operations.
- **What is pending:** Verify end-to-end account, entitlement, registry, audit, payment/admin and transactional-mail flows; ensure live snapshots cannot be widened locally and errors remain visible.
- **Where:** Cloudflare Worker API and `services/api`; Neon database/schema; admin UI; entitlement signer/provider; Resend; activation/persistence logic; deployment environments and integration tests.
- **Current evidence:** Project architecture identifies Worker+Neon for account, entitlement, registry, audit and cloud coordination, and Resend for transactional mail. Current admin source uses `paymentsFor`; old P2B document conflicts as captured in ENG-17. Handoff describes entitlement/sanitization qualification as blocked. Prior defect-register notes on public download URL vs private-host rule, Resend key for `cyvoriq.co.in`, and agent re-enrolment are standing reports; these were not reverified against remote secrets/services.
- **Why it remains pending:** Source code alone does not establish deployed schema/configuration, secrets, live endpoints, mail delivery, correct entitlement claims or audit consistency.
- **Why it matters:** Wrong, stale or locally widened entitlement can permit an operation not authorized by the server; broken account/payment/admin state can prevent legitimate use or misrepresent the licence.
- **How we will solve it:** (1) Reconcile every documented server gap with current source and tests. (2) create a service acceptance matrix for allowed/denied/expired/offline/revoked entitlement. (3) confirm database foreign keys and audit state. (4) test admin table/detail consistency and payment-null vs pending semantics. (5) validate configuration and mail delivery in an authorized test environment using no production secret disclosure. (6) confirm deploy commit and health check, then document rollback.
- **Dependencies and approvals:** Environment access and authorized test data/credentials; live entitlement must retain fail-closed policy; no sanitization/secret changes as part of planning.
- **Acceptance criteria:** API/database/UI agree on account and entitlement state; expired/revoked/offline restricted state cannot widen permissions; audit events match state transitions; missing payment and pending payment are distinct; mail and deployment acceptance recorded.
- **Required verification:** API integration tests, schema tests, admin UI tests, entitlement refusal tests, deployment health checks and test-message delivery.
- **Completion evidence:** redacted run logs, test reports, deployment SHA and service acceptance matrix.
- **Can work start now?:** **PARTIALLY** — source/test audit now; remote integration tests need authorization and a controlled environment.
- **Next action:** Map each entitlement state to server payload, signed local snapshot and host command decision.

### ENG-24 — Requirement matrix, unsupported domains, and documentation consolidation

- **Status:** NOT COMPLETE; several roadmap phases explicitly BLOCKED in Project Index.
- **Priority:** Medium/High because requirements and support claims must match reality.
- **What is pending:** Reconcile each of the 114 diagnostic parameters and physical/manual boundaries with the current collectors, report fields and supported claims; finish the project documentation consolidation flow without promoting draft documents to approvals.
- **Where:** `docs/CYVRA_MOBILE_PROJECT_INDEX.md`; `docs/CYVRA_CAPABILITY_MATRIX_V1.md`; `docs/CYVRA_FINAL_PLAN_VS_ACTUAL_HANDSHAKE_MATRIX_2026-10-12.md`; active transport/evidence architecture contracts; `README.md`; requirements workbook mentioned by matrix but not present in repository.
- **Current evidence:** Project Index records P1.5 documentation consolidation as IN PROGRESS, with README rewrite next and later stages blocked. The 114-parameter matrix says some fields are not tested or need a human/physical check and states that nothing is RELEASE-VALIDATED. It also says the source workbook is not in the repository. The reported 62/114 coded count is from the latest handoff and should be treated as the recorded baseline, not a newly recalculated statistic.
- **Why it remains pending:** Multiple historic documents can disagree about the same capability; the governing requirement workbook is not in the checked GitHub tree. Old manuals do not prove current support.
- **Why it matters:** Developers may implement the wrong behaviour or market a capability that exists only as a model, fixture, or human checklist.
- **How we will solve it:** (1) Establish the governing source and obtain the missing workbook or replace it only by a formally approved successor. (2) map every parameter to collector, source plane, evidence fields, status and test. (3) identify unsupported, physical-only and not-tested cases explicitly. (4) finish docs in the project-index dependency order; avoid edits that the documentation freeze does not permit. (5) update customer-facing claims only after capability evidence.
- **Dependencies and approvals:** CE/requirements owner confirms source-of-truth and any contract changes; repository documentation sequencing.
- **Acceptance criteria:** every claimed automated parameter traces to a source and test; unsupported/physical items are labelled honestly; current README and active contracts point to the correct governing version; no obsolete manual upgrades a feature to RELEASE-VALIDATED.
- **Required verification:** documentation cross-reference check, matrix traceability, test-link validation and source-to-report sampling.
- **Completion evidence:** traceability matrix, list of missing external source artifacts, reviewed docs diff and acceptance record.
- **Can work start now?:** **YES** for read-only mapping and gap identification; changing governing documents or customer claims requires the normal approval.
- **Next action:** Create a traceability table for all 22 capability rows first, then map the 114 detailed parameters as source material becomes available.

### ENG-25 — User-facing table labels and standing defect-register items

- **Status:** Several items REPORTED; current runtime/source status needs recheck.
- **Priority:** Low to Medium unless reproduced as a workflow blocker.
- **What is pending:** Triage the misleading `IMEI NO`/`Not reported` column and other standing copy/version defects from the 18-Oct register, while preserving the policy not to collect IMEI where the design forbids it.
- **Where:** Desktop device details table and the standing backlog in `docs/DEFECT_REGISTER_2026-10-18.md`: `hostVersion=0.0.0`; duplicate-key warning in `licenceTable.test.tsx`; Help text in `scripts/verify-stage-gates.ps1`; H3 wording in `apps/web/src/site/CustomerWorkspaceShell.tsx`; `retention-days` upload step.
- **Current evidence:** The defect register says the IMEI column always reports `Not reported`, although IMEI is deliberately not collected; it also lists the other text/version/warning items. The most recent review did not re-run each app screen or gate, so except for Help’s six-vs-five-step mismatch described in ENG-13, these are `NOT REVERIFIED`.
- **Why it remains pending:** An old screenshot/register may no longer match the current app. Removing the column or renaming it should reflect actual product intent and not increase personal data collection.
- **Why it matters:** Misleading labels reduce user trust and can imply unsupported collection; duplicate warnings and stale versions can confuse support or future builds.
- **How we will solve it:** (1) reproduce each item against current source/UI. (2) classify as functional, security, test, version, or copy issue. (3) do not add IMEI collection; remove/rename the column as approved. (4) fix each small item in a separate change with the relevant regression test. (5) close only after current build/screens verify the correction.
- **Dependencies and approvals:** Current requirements and UI freeze; do not change unrelated files together.
- **Acceptance criteria:** every standing item has a verified status; real defects have a test or observable correction; cosmetic text matches current behaviour; privacy boundaries remain intact.
- **Required verification:** UI screenshot checks, targeted test suites, release/config display check.
- **Completion evidence:** dated item recheck, source diff/test logs and screenshot where relevant.
- **Can work start now?:** **YES** for read-only triage; fixes after the specific defect is verified and scoped.
- **Next action:** Revalidate each standing backlog item and move stale entries to a clearly labelled historical state rather than silently deleting them.

### ENG-26 — U-4/U-5 record authority and Phase A audit corrections

- **Status:** DECISION REQUIRED; U-4 and U-5 remain OPEN.
- **Priority:** High for audit traceability.
- **What is pending:** CE selects which defect register is authoritative and establishes authorization to correct Phase A audit records (C1/C3/C4), including the closeout mirror.
- **Where:** `docs/CYVRA_MOBILE_SESSION_HANDOFF_2026-10-20.txt` §C; `docs/CYVRA_GOVERNANCE_LEDGER.md`; `docs/DEFECT_REGISTER_2026-10-18.md`; the external Desktop file is not present in the GitHub repository; missing `CYVRA-PhaseA-Closeout-Alignment-2026-10-20.txt`.
- **Current evidence:** The 20-Oct handoff says Desktop `Defect Register.txt` and repo `DEFECT_REGISTER_2026-10-18.md` are distinct in size/date and must not be assumed equivalent. The Phase A closeout-alignment TXT could not be located in the repository. The 22-Oct handoff §9 has been corrected to label U-4 as the authoritative defect-register decision and U-5 as authorization to correct the Phase A audit records (C1/C3/C4).
- **Why it remains pending:** Publishing a corrected handoff only fixed the identifier mapping. It did not grant U-4/U-5 or authorize edits to historical audit records.
- **Why it matters:** Merging separate registers or rewriting a historical audit without permission can destroy provenance and make it impossible to determine which evidence was authoritative at the time.
- **How we will solve it:** (1) CE explicitly selects the register-of-record. (2) supply the authoritative Phase A closeout file or explicitly disposition its absence. (3) CE identifies which precise C1/C3/C4 statements may be corrected and the permitted mirror. (4) prepare an exact before/after diff. (5) obtain explicit authorization of that diff before editing any historical artifact. (6) retain the old record and append the correction/supersession notice according to ledger rules.
- **Dependencies and approvals:** `D-CE-26-05` U-4; `D-CE-26-06` U-5. Both PENDING. Approved wording is below.
- **Acceptance criteria:** authoritative source declared; missing record supplied or formally dispositioned; exact correction set authorized and traceable; no unapproved historical edits.
- **Required verification:** byte-level/line-level source comparison and a reviewed diff; governance-ledger append-forward rules.
- **Completion evidence:** dated CE ruling, source documents, authorized diff and final artifact hashes.
- **Can work start now?:** **PARTIALLY** — inventory and diff preparation can start; historical corrections are **NO** until authorized.
- **Next action:** Request the authoritative Desktop register and Phase A alignment record; prepare no edits yet.

**Approved wording for U-5 (decision request, not a granted authorization):**

> **Decision required:** Determine and record the authorization to correct the Phase A audit records (corrections C1/C3/C4).  
> **Required evidence:** Provide the authoritative source record or explicitly disposition the outstanding authorization in a dated successor record.  
> **If unresolved:** U-5 remains open. No corrections are authorized by this decision-sheet draft.

### ENG-27 — Governance record IDs and approval traceability

- **Status:** OPEN.
- **Priority:** Medium/High, because a comment or planning note must not be mistaken for authority.
- **What is pending:** Establish a reliable cross-reference between historic ruling IDs, the new request IDs, source comments, and actual authorized dated records.
- **Where:** `docs/CYVRA_GOVERNANCE_LEDGER.md`; section 9 of the latest handoff; the conversation-approved draft decision sheet; relevant code comments in `HostProtocolDispatcher.kt`.
- **Current evidence:** CE-1 through CE-5 already identify historic rulings in the ledger (H2 exception, PHY-008, deferred-work ruling, agent-less attempt strategy, and 16-Oct amendment rulings). Therefore the new requests use `D-CE-26-01` through `D-CE-26-08`, not CE-1 through CE-8 as fresh ruling IDs. SO-1 through SO-4 are request IDs, and the latest handoff says they are not found in existing records. Source comments claim U-2/U-3/21-Oct ratification, but formal records are absent in the examined docs.
- **Why it remains pending:** The ledger is append-forward and historical identifiers cannot be silently reused or rewritten. A recommendation or code comment is not proof that a ruling was issued.
- **Why it matters:** Confused IDs can make the wrong decision appear approved and can authorize engineering work without accountable permission.
- **How we will solve it:** (1) Keep the new request IDs in a separate decision-request document. (2) each decision-maker returns an explicit result, authority, date, evidence and scope. (3) authorised outcome is recorded by the ledger’s append-forward process. (4) source comments are reconciled only after a formal record exists. (5) do not mark status approved by mere draft creation.
- **Dependencies and approvals:** CE/Security Owner, formal decision process, governance ledger owner.
- **Acceptance criteria:** each request uniquely maps to one pending or dated approved ruling; no historical ID reused; approval status and evidence agree across source comments and ledger.
- **Required verification:** ID search across ledger, decision request and source; reviewer confirmation.
- **Completion evidence:** dated ruling and ledger entry with retained history.
- **Can work start now?:** **YES** for request document and ID map; actual rulings are external decisions.
- **Next action:** Maintain a table mapping each `D-CE-26-*` and `SO-*` to its question, source requirement, decision-maker and resulting evidence record.

### ENG-28 — Project-wide security, privacy and unsupported-capability claim review

- **Status:** NOT COMPLETE as a release verification activity.
- **Priority:** High before release.
- **What is pending:** Verify that every evidence source respects least privilege, data minimization, transport-specific consent, and truthful unsupported/partial status; confirm no prohibited content extraction or destructive fallback exists in the customer path.
- **Where:** Core architecture contracts; `TransportManager.kt`; ADB allowlists; report generator and schemas; UI text; agent packaging gates; standing holds H1–H8; sanitizer eligibility.
- **Current evidence:** Transport docs distinguish P1 descriptor-only USB, P2 shared-storage metadata while unlocked, P3 read-only ADB evidence with user authorization and restrictions (including no `/data/data` and no non-interactive reset), and optional consent-based P4 companion. H4 forbids private key generation/signing the agent before key custody decision; H5 restricts third-party driver binaries; H6 requires live `sanitizeExecute` entitlement; H7 forbids weakening release gates. No release validation has been established in latest handoff.
- **Why it remains pending:** The contracts, injected seams, and unit tests do not prove every reachable runtime path stays within bounds, especially after reconnect, error, offline entitlement or UI/protocol edge cases.
- **Why it matters:** Privacy boundary violations, unsupported data claims, or gate weakening create serious safety, compliance and trust risks.
- **How we will solve it:** (1) create a threat-model test inventory by transport plane and command. (2) inspect read-only allowlists and device identity leakage. (3) add negative tests for disallowed methods, private-content paths and missing consent. (4) inspect actual reports and logs for secrets/serials/personal payload. (5) ensure destructive commands fail closed across expired/cached/offline/unknown entitlement. (6) preserve existing hold gates and produce a release security review before any release claim.
- **Dependencies and approvals:** Standing holds H1–H8 and all applicable architecture/security approvals.
- **Acceptance criteria:** no prohibited operation is reachable without its gate; unsupported/partial capabilities are explicitly labelled; evidence outputs are privacy-filtered and provenance-preserving; no gate is softened.
- **Required verification:** static/code review, command allowlist tests, refusal-path tests, report/log leakage scan, penetration/threat review, authorised physical acceptance.
- **Completion evidence:** security test report, approved threat model and release review signoff.
- **Can work start now?:** **YES** for read-only threat-model and test review; release claim is blocked until evidence complete.
- **Next action:** Build a command × transport × permission × expected-refusal matrix from the active contract and current code.

## 4. Work that can safely start now

These actions are bounded and non-destructive. They must still respect any narrower repo freeze or protected-file instruction. “Can start” means investigation/test preparation; it does not authorize source edits where a separate approval is required.

1. **Read-only trace of identity producers** — benefit: makes U-1 decision concrete and prevents speculative ID fixes. Deliverable: table of every identity producer, format, lifetime, registry relationship and tests.
2. **Red-first tests for report ownership** — benefit: pins down missing, matching, mismatching, stale and interleaved request behaviour before changing policy. Use mocks; do not connect or sanitize physical devices.
3. **Failed-scan state fault-injection test plan** — benefit: demonstrates whether stale evidence is served after each failure point and preserves pre-work refusal behaviour.
4. **Finalisation input/response matrix** — benefit: makes current `FINALISE_INPUTS_UNAVAILABLE` refusals understandable and gives U-6/D-5 decisions a testable target.
5. **Capability row-policy test design** — benefit: separates a row that exists from a row approved for production authority; leave runtime authority unchanged until CE ruling.
6. **Transport seam wiring map** — benefit: tells the team where real Windows USB and WPD adapters connect, without inferring support from ADB.
7. **Read-only report-store audit and format proposal** — benefit: resolves the current path/format/split ambiguity before implementation; do not assume older Program Files paths are still accurate.
8. **Reconcile P2B against server source/tests** — benefit: prevent stale proposed code from being applied over current `paymentsFor`; do not apply stashes or modify service code during the audit.
9. **Workspace gate coverage audit** — benefit: expose packages skipped by recursive typecheck. Add no scripts as part of this inventory.
10. **Hardware acceptance planning** — benefit: define supported devices, port baseline, test prerequisites and stop conditions before any operator touches real hardware.
11. **Capability traceability and documentation cross-reference** — benefit: makes unsupported and physical-only rows explicit; flag the missing 114-parameter workbook rather than inventing its values.
12. **Decision package preparation** — benefit: CE/Security Owner can approve specific, testable designs rather than broad intentions. All outcomes stay PENDING until formally recorded.

## 5. Work blocked by decisions or dependencies

| Decision/dependency | Affected work | Why it must wait | What unblocks it | Safe parallel work |
|---|---|---|---|---|
| `D-CE-26-01` / U-1 lifecycle identity | ENG-01; companion identity path | Lifecycle authority/registry is not established; no serial or session substitution permitted | Dated CE identity/registry ruling, then contract + tests | Producer inventory, red-first test, DB relationship map |
| `D-CE-26-03` / U-2(a) | ENG-02, ENG-03 | Ownership and omitted-payload semantics are not formally authorized | Dated CE ruling and formal evidence record; code comment alone insufficient | Handler/UI payload map and test plan |
| `D-CE-26-04` / U-3(a), U-6 | ENG-04, ENG-05 | Failure-state policy and `FINALISE_REPORT` intent require ruling; required scenarios not re-run | Dated decision plus scenario evidence | Failure-matrix design, test scaffolding proposal, artifact provenance map |
| `D-CE-26-02` patch authenticity + record schema | ENG-05, ENG-06 | No approved full applied-state authenticity model; finalizer correctly refuses missing authority | CE ratifies authenticity and schema as one coherent chain | threat-model comparison, parser/negative tests, schema diff proposal |
| `SO-1` key + `key_id` | ENG-06 | No actual production key issued; trust anchors remain empty | Approved custody issuance of genuine key material; only public key/ID enters repo | custody process design; no key generation |
| `SO-2` retirement/rotation ledger | ENG-06 | Key lifecycle policy absent | Dated Security Owner policy | Historical verification test design |
| `SO-3` offline policy | ENG-06/ENG-18 | Offline boundary must be explicit; fail-closed defaults remain | Dated Security Owner decision | refusal test matrix |
| `SO-4` monotonic sequence authority | ENG-06 | Anti-replay/sequence source is not governed | Dated Security Owner decision | stale/replay test design |
| `D-CE-26-07` provisional `[P]` row policy | ENG-07 and D-5 | Existence of a row does not confer production authority | Dated CE decision and tests | classify all 22 rows; test proposal |
| `D-CE-26-05` U-4 register-of-record | ENG-26 | Two distinct artifacts must not be merged by assumption | CE identifies authoritative register and scope | compare accessible repository copy; request Desktop artifact |
| `D-CE-26-06` U-5 Phase A correction authority | ENG-26 | Editing old audit records is not authorized by the new handoff mapping | Dated authorization or explicit successor-record disposition | prepare exact diff, do not apply it |
| Physical-device/bench authorization | ENG-08–ENG-10, ENG-21 | Software source cannot prove device visibility, reconnection, cross-port or capacity behaviour | Authorized bench access, supported devices and test procedure | build worksheet, create non-destructive test fixtures |
| Explicit CI/full suite permission | ENG-22 | Workflow dispatch is a separate engineering gate; no qualifying Windows build run found | Explicit authorization and approved exact commit/route | read-only workflow audit and artifact acceptance checklist |
| H4/H6 and sanitization qualification | ENG-18 | Private key/agent signing is prohibited until custody ruling; destructive action needs live entitlement and same-target confirmation | Specific Security Owner/CE rulings, supported method qualification, explicit live entitlement and separate test authorization | test refusal paths and method prerequisite list |
| Backend environment access | ENG-17, ENG-23 | GitHub source does not reveal local stash or production secret/deployed state | Controlled access, current test environment and authorized acceptance procedure | static requirement mapping and local unit-test design |

### Decision requests still PENDING

- `D-CE-26-01`: Lifecycle identity origin/registry/propagation (U-1).
- `D-CE-26-02`: Patch-state authenticity architecture and associated schema/record requirements (D-5; consider external-uplink countersignature and its operational trust assumptions before implementation).
- `D-CE-26-03`: Authoritative scope of report-ownership guards and empty-payload policy (U-2(a)).
- `D-CE-26-04`: Failed-scan state and `FINALISE_REPORT` intended behaviour/testing (U-3(a), U-6).
- `D-CE-26-05`: Register-of-record for U-4.
- `D-CE-26-06`: Phase A correction authorization for U-5.
- `D-CE-26-07`: Production authority policy for provisional `[P]` rows.
- `D-CE-26-08`: Authorized CI trigger and evidence policy.
- `SO-1` through `SO-4`: Genuine production key/key ID, key retirement/rotation, offline policy and monotonic sequence authority.

These identifiers are requests, not rulings. All outcomes remain PENDING. U-5 approved request wording is preserved above; the decision-sheet draft does not authorize the corrections.

## 6. Prioritised execution roadmap

### Phase 1 — Reconcile and establish a reliable baseline

**Entry condition:** Current source ref and scope confirmed; no change to working tree or remote refs required.  
**Work:** ENG-17 (P2B/server source reconciliation), ENG-16/25 current status of standing defects, ENG-01 identity producer map, ENG-02 report handler/payload map, ENG-22 workflow/status evidence audit, ENG-24 requirements trace.  
**Why first:** It prevents stale registers and assumptions from deciding what gets implemented.  
**Exit criteria:** Every finding has a source/evidence link and is classified as verified, reported, decision-required, dependency-blocked, or not reverified; the missing external Desktop register/workbook is explicitly recorded.  
**Evidence:** source-path inventory, current test names, comparison tables and a list of inaccessible artifacts.

### Phase 2 — Resolve immediate correctness and evidence-integrity tests

**Entry condition:** Current source has been read and test scope permits non-destructive tests.  
**Work:** Add/review red-first test designs for ENG-02 through ENG-05; verify D-2/D-3/D-4 source guard behaviour, stale scan recovery and report provenance without changing their approved semantics.  
**Why:** These tests can expose regressions without waiting for every architecture choice.  
**Exit criteria:** Tests clearly distinguish matching, omitted, mismatched, stale and unavailable input paths; no destructive method is executed.  
**Evidence:** focused test output with exact commit and case list.

### Phase 3 — Record architecture and policy decisions

**Entry condition:** Decision packages are ready and the authorized decision-maker is available.  
**Work:** Resolve U-1/U-2/U-3/U-4/U-5/U-6; D-CE-26-02; D-CE-26-07; SO-1–SO-4.  
**Why:** These decisions determine the permitted identity, evidence ownership, report semantics and production trust boundary.  
**Exit criteria:** Each decision has an explicit result, scope, date, authority and supporting record; rejected options are documented; new request IDs do not overwrite historical CE rulings.  
**Evidence:** formal governance record or a recorded open/blocker state.

### Phase 4 — Implement authorized correctness and security changes

**Entry condition:** Exact design and implementation scope approved; current source baseline/test expectations established.  
**Work:** Implement registry-backed identity; chosen report ownership policy; approved failure/finalization behavior; complete D-5 only as a coherent authenticity + format + key + procedure + store application/rollback chain; enforce provisional-row policy.  
**Why:** Partial implementation could create a misleading sense of safety, especially for applied-state authenticity.  
**Exit criteria:** Required tests pass; fail-closed conditions remain intact; no local file alone authenticates its own application; report claims are evidence-based.  
**Evidence:** reviewed diff, test logs, approval references, security review.

### Phase 5 — Integrate real transports and backend dependencies

**Entry condition:** Approved transport contracts and available supported Windows/device/service test environments.  
**Work:** USB/PnP adapter integration, WPD/MTP COM/runtime and metadata scanner, ADB resilience, companion bridge, backend/entitlement consistency and report-store integration.  
**Why:** Injected probe seams and protocol exposure are not end-to-end customer capability.  
**Exit criteria:** Each plane is independently observed and reported, with correct consent and limitations; each server contract has an integration test.  
**Evidence:** Windows/Android/API integration reports and traces.

### Phase 6 — Verify report/UI journey end to end

**Entry condition:** Report scope/format decisions resolved, necessary transports wired and safe test entitlement set up.  
**Work:** Report 1, application inventory, export paths, help/unlock rules, operator identity, report indexes/hashes and truthful coverage statuses.  
**Why:** The UI must not mark incomplete evidence as full coverage or hide the place where a required operator input is needed.  
**Exit criteria:** A non-destructive test scan yields matching device identity, session/reference, UI status, report data, files and manifest hashes; unsupported data is clearly reported.  
**Evidence:** redacted screenshot, wire output, sample report and SHA-256 manifest.

### Phase 7 — Physical-device and multi-device validation

**Entry condition:** Hardware access and procedure authorization; identity/ownership, transport integration and non-destructive flows stable.  
**Work:** Four-port baseline, disconnect/reconnect/failure cases, target/report ownership and concurrency; capacity tests only for an approved target count.  
**Why:** Real port behaviour and isolation cannot be inferred from mocks.  
**Exit criteria:** Every test row has measured evidence, every failure is tracked, all stop conditions honoured. No 50-device claim without a measured 50-device test.  
**Evidence:** signed/dated hardware worksheets, sanitized traces, screenshots, artifact hashes.

### Phase 8 — Release-readiness assessment

**Entry condition:** Prior phases have closure evidence, the approved version/requirements are stable, and release/CI scope is authorized.  
**Work:** Reproducible Windows build, all required suites, installed-layout self-test, NSIS bundle verification, security and entitlement checks, support/retention documentation, final hardware matrix.  
**Why:** Compilation, local tests, an unsigned artifact, and hardware testing are different claims.  
**Exit criteria:** All mandatory release gates meet the defined criteria on the exact release candidate. Otherwise retain NOT RELEASE-READY.  
**Evidence:** CI run URL/logs, commit SHA, artifact hash, installation test, security review, hardware evidence and release decision.

Safe work in Phases 1 and 2 can run in parallel with decision preparation in Phase 3. Phase 4 work must not silently start ahead of its required approvals. Current packaging remains NSIS `.exe` only and unsigned for development; no MSI/WiX, CI dispatch, or installer rebuild is included in this inventory.

## 7. Definition of done and status labels

- **CLOSED WITH EVIDENCE:** Acceptance criteria met and objective evidence attached/referenced. A document existing is not enough.
- **IMPLEMENTED — TESTS PENDING:** Exact code change has been made and reviewed, but required tests have not passed or been run. Do not describe it as working.
- **TESTED — HARDWARE VALIDATION PENDING:** Appropriate local/integration tests passed, but physical behaviour has not been proved.
- **DECISION REQUIRED:** The implementation path depends on an explicit unresolved policy/design/authorization answer. Recommendations remain recommendations.
- **BLOCKED BY DEPENDENCY:** A concrete prerequisite such as registry, issued key, test environment, physical hardware or live entitlement is unavailable.
- **NOT TESTED:** There is no current evidence that the stated scenario was executed. Historical tests are labelled with their old commit/date and not treated as current.
- **DEFERRED:** Explicitly moved out of current scope with rationale, trigger for reconsideration, and no implication that it is fixed.

A task can only close when its acceptance criteria, required tests, review/approval dependencies and evidence retention are satisfied. A compile or unit test does not prove UI integration, production transport, physical hardware, multi-device isolation or release readiness. A source comment is not a governance ruling; an empty state file is not proof that no patch is applied; an attempted operation is not proof that it completed or that its result was verified.

## 8. First ten recommended engineering actions

1. **Create the baseline traceability tables.**  
   **Why now:** it establishes which findings are current rather than inherited. **Where:** handoff, patch-state provider, consolidated audit, current source. **Dependency:** none for read-only work. **Verify:** every item links to current file/symbol and a status; mark inaccessible local artifacts `NOT REVERIFIED`. **Start now:** YES.

2. **Map every identity producer and backend lifecycle constraint.**  
   **Why now:** D-1 is a hard dependency for device-side correlation. **Where:** orchestrator, Android interface/bridge/receiver, schema validators and lifecycle FK. **Dependency:** U-1 for implementation only. **Verify:** producer/format/lifetime/registered-row matrix and red-first test design. **Start now:** YES for audit/tests, PARTIALLY for implementation.

3. **Add or review report ownership regression tests.**  
   **Why now:** visible guards need proof of matching/mismatching/stale cases. **Where:** host dispatcher handlers and UI request payloads. **Dependency:** U-2 policy before changing semantics. **Verify:** tests cover absent/matching/mismatch/session drift, without physical/destructive operations. **Start now:** PARTIALLY.

4. **Create the failed-scan/finalization fault matrix.**  
   **Why now:** old evidence must never leak after scan failure and finalization must not fabricate state. **Where:** `runScanResponse`, `finaliseReportResponse`, scan evidence packet and report store. **Dependency:** U-3/U-6 for policy. **Verify:** each failure path expected state and response code, plus no-file-on-refusal assertion. **Start now:** YES for design and tests.

5. **Write the D-5 architecture decision package.**  
   **Why now:** trust and application gaps cannot be solved responsibly by isolated coding. **Where:** provider contract, trust anchors, store seams, patch verifier and schema. **Dependency:** CE decision plus SO-1–SO-4. **Verify:** options, threats, failure behaviour and implementation dependencies are written, no keys created. **Start now:** YES.

6. **Trace production wiring of USB/PnP and WPD/MTP.**  
   **Why now:** injected probes are not proof of production integration. **Where:** Kotlin transport classes, Tauri native USB/WPD paths and command wiring. **Dependency:** hardware required later. **Verify:** call path from real enumeration to host result and UI; clearly separate WPD enumerator hardware proof from full scanner. **Start now:** YES.

7. **Reconcile report requirements with current store and UI.**  
   **Why now:** format, destination and report split are user-visible acceptance issues. **Where:** `HostReportStore`, `EXPORT_REPORT`, final report flow, `App.tsx`. **Dependency:** decision on plain text/PDF, path and report split. **Verify:** current output/paths/hashes table and draft acceptance cases. **Start now:** YES for read-only work.

8. **Reconcile `P2B-SERVER-GAPS.md` with current admin source/tests.**  
   **Why now:** applying a stale “not committed” proposal could duplicate or overwrite existing logic. **Where:** `services/api/src/admin.ts`, admin API tests and P2B doc. **Dependency:** access to local stashes is unavailable through this GitHub-only review. **Verify:** each original gap mapped to code and test; unknowns kept open. **Start now:** YES.

9. **Prepare a safe hardware acceptance worksheet.**  
   **Why now:** the four-port baseline is still 0/4 and there is no multi-device evidence. **Where:** hardware matrix, transport planes, scan/report flow. **Dependency:** explicit hardware authorization and stable identity/ownership paths. **Verify:** per-port, failure and stop-condition checklists; no sanitization. **Start now:** YES for planning.

10. **Confirm the authorized Windows CI route before running anything.**  
    **Why now:** no Windows engineering build run/status was found, and the current trigger is branch-limited. **Where:** `.github/workflows/windows-engineering-build.yml`, Actions history and target commit. **Dependency:** separate CI/full-suite authorization. **Verify:** approved SHA, trigger route, required outputs and evidence retention. Do not dispatch, edit workflow, or rebuild `.exe` under this plan. **Start now:** YES for read-only planning only.

## 9. Evidence limits and repository discrepancies

- This was a **read-only review of committed GitHub files** at branch `docs/session-handoff-2026-10-20`, with head `9c7697d`. The connected public repository cannot show the developer's uncommitted local working tree, local stash contents, desktop-only register, physical test bench, deployed secrets, or live customer configuration. Those require local/authorized environment evidence.
- `Desktop\Defect Register.txt` is not in the GitHub repository tree; only `docs/DEFECT_REGISTER_2026-10-18.md` is accessible here. U-4 therefore cannot be decided by this review.
- `CYVRA-PhaseA-Closeout-Alignment-2026-10-20.txt` and the 114-parameter source workbook are not found in the repository paths referenced by the project docs. Their absence is not replaced by guessing from summaries.
- `P2B-SERVER-GAPS.md` documents `paymentStatusesFor` as uncommitted, while current `services/api/src/admin.ts` has `paymentsFor` and no `paymentStatusesFor`. This is an unresolved record/source conflict, not an instruction to apply the older snippet.
- The 20-Oct audit's historical `FINALISE_REPORT` line references are stale; current code is around `HostProtocolDispatcher.kt:807-843` and refuses when authoritative evidence inputs are unavailable. The actual O-3 scenario is still marked NOT RE-EXECUTED in the handoff.
- Prior A-series findings about runtime UI, logger setup, exact exported report contents, placeholder operator name, and the `PARTIAL` coverage example do not all have fresh runtime proof here. The help-text/step-lock mismatch and absence of a standalone desktop `typecheck` script are source-visible; other items are labelled reported or NOT REVERIFIED above.
- Current workflow file uses `push` on `phase2-correct` and `feature/p2-protocol-completion` plus `workflow_dispatch`, with no `pull_request` trigger. No Windows Engineering Build run was present in the Actions list checked, and the combined commit status for `9c7697d` was empty. That is absence of a qualifying run/status in this evidence set, not proof that tests failed.
- The latest handoff records local six-suite evidence at `7e8439d`, not an independent run at `9c7697d`. No tests, CI, packaging or hardware were executed for this document.
- The current installer configuration remains `bundle.targets: ["nsis"]`. Unsigned engineering artifacts are the development policy. MSI/WiX are outside scope; no `.exe` rebuild or signing is authorised by this document.
- The handoff calls out C-1 through C-6 and other governance conflicts as unresolved. They must be carried forward rather than silently cleaned up or rewritten.

## Final position

The highest-value next work is to **establish a precise baseline, prepare focused non-destructive tests, and obtain the decisions needed for the tasks that truly depend on them**. Continue safe work in parallel; do not wait for every governance item before doing independent source investigations. But do not implement substitute identity authority, manufacture patch-state trust, sign the sanitizer APK, correct historical audit records, weaken a gate, run CI, rebuild an installer, or execute sanitization without the explicit prerequisites described above.

**Status:** DRAFT — ENGINEERING WORK INVENTORY — NOT A RELEASE APPROVAL.  
**No product capability is declared RELEASE-VALIDATED by this document.**
