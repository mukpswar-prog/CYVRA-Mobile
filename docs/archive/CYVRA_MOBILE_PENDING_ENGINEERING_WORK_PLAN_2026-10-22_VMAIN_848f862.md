# CYVRA Mobile — Pending Engineering Work Plan

**Document status:** DRAFT — ENGINEERING WORK INVENTORY — NOT A RELEASE APPROVAL  
**Prepared:** 22 October 2026  
**Repository:** [mukpswar-prog/CYVRA-Mobile](https://github.com/mukpswar-prog/CYVRA-Mobile)  
**Publication branch:** `main`  
**Source reviewed:** `docs/session-handoff-2026-10-20` at `9c7697dd85b6b295725cd69892bb8755fb8c6ae8`, together with the 20-Oct consolidated audit, 22-Oct handoff and work plan, patch-state blocker, capability/transport architecture, defect register, desktop source, host source, server source, and Windows engineering workflow.  
**Purpose:** Record unfinished work, evidence, dependencies, acceptance criteria, and safe execution order. This document does not grant engineering or security approval.

> **Evidence rule:** Recommendations are not decisions. A source comment is not a governance ruling. Local unit tests are not CI, hardware, or release validation. Do not mark a capability RELEASE-VALIDATED without the required reproducible evidence. No application code, tests, installer, device operations, workflow, or security boundary was changed or run to publish this document.

## 1. Executive status

CYVRA Mobile is intended to be a Windows 10/11 Android evidence collection, verification, reporting, and controlled-sanitization application, separate from CYVRA Erase. The intended operator flow is to connect a supported device, collect non-destructive evidence, generate Report 1 (the **CYVRA Device Verification Report**), separately verify entitlement and authorize sanitization, execute only a supported qualified method, reconnect and verify, and generate a truthful final report.

The architecture separates React/TypeScript desktop UI; Rust/Tauri Windows-native discovery and process lifecycle; Kotlin/JVM domain, protocol, evidence and sanitization orchestration; an Android evidence-support component; Cloudflare Worker/Neon account, entitlement, registry and audit services; and Resend transactional mail.

**Current disposition: NOT RELEASE-READY.** The 22-Oct work plan records six focused local test suites with 117 passed, 0 failed, 0 errors and 0 skipped at the earlier test checkpoint. Those results are local-only and are not proof that the tests were rerun against the currently reviewed head. The GitHub Actions history checked during the review did not show a Windows Engineering Build run, and the status lookup for the reviewed head had no statuses. The four-port baseline remains 0/4; full scan-to-report hardware validation, multi-device isolation and 50-device capacity are unproven. Do not claim any capability RELEASE-VALIDATED.

Engineering is not globally frozen. Read-only investigation, non-destructive regression tests, contract tests, evidence-accuracy work, build troubleshooting that does not create/install a package, and hardware-test planning can proceed when they do not cross a documented approval gate. Identity-authority decisions, patch trust/key issuance, governed patch application/rollback, signing, sanitization and other gated actions remain blocked until their required approvals exist.

## 2. Status vocabulary

- **MODELLED:** a design or data structure exists; runtime behaviour is not thereby proved.
- **UNIT-TESTED:** focused controlled tests pass; transport, full workflow and hardware remain unproven.
- **PROTOCOL-EXPOSED:** a command/interface exists; UI wiring and actual operation are not thereby proved.
- **UI-INTEGRATED:** UI calls an interface and renders a result; the underlying production transport may still be incomplete.
- **HARDWARE-VALIDATED:** the exact workflow has been exercised on physical hardware and retained evidence exists.
- **RELEASE-VALIDATED:** the approved release candidate passes required automated, installed-layout, security, hardware and operational gates with reproducible evidence.

Use the plan statuses **CLOSED WITH EVIDENCE**, **IMPLEMENTED — TESTS PENDING**, **TESTED — HARDWARE VALIDATION PENDING**, **DECISION REQUIRED**, **BLOCKED BY DEPENDENCY**, **NOT TESTED**, or **DEFERRED**. A source-only observation should not be upgraded to a runtime or hardware result.

## 3. Pending engineering work inventory

### ENG-01 — Device lifecycle identity and producer alignment (D-1 / U-1)
**Status:** BLOCKED BY DEPENDENCY. **Priority:** High.  
**Evidence/location:** `apps/host/src/main/kotlin/cyvra/mobile/host/service/WorkstationSessionOrchestrator.kt`; Android component trigger interface and bridge; evidence receiver; server lifecycle/evidence schema. Current workstation call passes `sessionUuid` for both `sessionUuid` and `deviceLifecycleId`. These identities have different semantics. The documented contract describes lifecycle ID as a longer-lived service/registry identity, not a hardware-derived identity. The host has no established lifecycle registry; a syntactically valid UUID would still fail a foreign-key constraint if no lifecycle row exists.  
**Work:** Obtain a recorded architecture decision for lifecycle identity origin; define lifecycle registration/lookup and failure semantics; implement only after that decision; keep session identity distinct; align all producers and backend validation. Add red-first orchestrator tests and registered/unregistered DB integration tests.  
**Acceptance:** Every producer uses one approved contract; lifecycle IDs are registered; session IDs remain distinct; no serial/IMEI/MAC/Android ID/hash is treated as identity authority; missing or mismatched lifecycle fails closed.  
**Gate:** U-1; request ID `D-CE-26-01`. No invented identity source.

### ENG-02 — Report retrieval ownership and empty-payload policy (D-2 / U-2)
**Status:** DECISION REQUIRED; source guards need regression and multi-device validation. **Priority:** High.  
**Evidence/location:** `HostProtocolDispatcher.kt` report, export and final-report handlers; `serialOwnershipRefusal`; desktop payloads. The reviewed source contains a serial mismatch refusal for supplied serials but permits an omitted serial. The UI ordinarily omits serial on commands other than RUN_SCAN. A source comment claiming ratification is not a formal governance record.  
**Work:** Record the ownership and empty-payload rule; trace each report/inventory/export/final-report request from UI through host; test absent, matching, mismatching, malformed and stale-session references; update UI and wire contract together if session-keyed binding is selected; then verify multi-device isolation on hardware.  
**Acceptance:** Every request has documented binding semantics; mismatches are refused; omitted-payload behaviour is explicit and tested; no wrong-device report is returned in the approved scenario.  
**Gate:** U-2; request ID `D-CE-26-02`. Do not assume physical cross-device exposure without evidence.

### ENG-03 — Sanitization target binding (D-3)
**Status:** Source guard present; regression and physical isolation validation pending. **Priority:** Critical.  
**Evidence/location:** `HostProtocolDispatcher.kt` sanitize-start and sanitize-execute handlers. The current source compares a wire-supplied serial with the recorded scan/lifecycle serial and refuses mismatch; this must be pinned by tests and confirmed against the exact current head.  
**Work:** Add mismatch/match/absent-serial tests for both commands; ensure the target remains bound to the scanned device and refusals are observable.  
**Acceptance:** A supplied mismatching target can never redirect the operation; tests prove refusal; hardware proof is required before any sanitization claim.  
**Gate:** Sanitization remains separately authorized and entitlement-gated. No destructive test execution is authorized by this plan.

### ENG-04 — Clear stale state after failed scan (D-4 / U-3)
**Status:** DECISION REQUIRED / implementation must follow confirmed current source. **Priority:** High.  
**Evidence/location:** `HostProtocolDispatcher.kt` scan failure path and retained `lastScan`/lifecycle state. The 20-Oct audit documented that failed scans could leave a previous scan servable; later source may contain a clearing fix, so the exact current implementation and tests must be checked before changing code.  
**Work:** Diff the current branch against the audit claim; preserve an accurate before/after record; add a regression test that first creates scan state, then fails a new scan, then proves report/inventory/export/final-report paths cannot return stale evidence.  
**Acceptance:** The approved failure policy is explicit; stale prior-device evidence is never presented as the failed scan's result; existing entitlement and sanitization state-reset invariants remain intact.  
**Gate:** U-3; request ID `D-CE-26-03`. Do not reintroduce clearing logic if it already exists.

### ENG-05 — Finalise-report intent and source binding (U-6 / O-3)
**Status:** DECISION REQUIRED; current gate path needs re-verification. **Priority:** High.  
**Evidence/location:** `HostProtocolDispatcher.kt` finalise/final-report paths and `HostReportStore`. The 20-Oct audit observed FINALISE_REPORT generating a fresh template rather than finalising the scan report; the 22-Oct handoff notes stale source-line citations and an unexecuted scenario.  
**Work:** Confirm intended product semantics with the Chief Engineer; trace scan report, final report, certificate, manifest and entitlement-debit inputs; update test plan to current line references; re-run the approved O-3 scenario only after authorization.  
**Acceptance:** The implementation matches a recorded product decision; report IDs, session binding, artifact hashes and debit idempotency are covered by tests.  
**Gate:** U-6. Do not silently treat an old source observation as current proof.

### ENG-06 — Production patch-state trust anchors and key governance (D-5 / SO-1…SO-4)
**Status:** BLOCKED BY DESIGN. **Priority:** Critical.  
**Evidence/location:** `PatchTrustAnchors`, `PatchStateStore`, patch verifier, procedure registry and dispatcher finalisation path. The blocker record says the production trust-anchor map is empty, no production key/key ID has been issued, verified patch data does not reach a governed apply/rollback boundary, and fail-closed authorisers refuse.  
**Work:** Obtain approved decisions for genuine Ed25519 key and key ID, custody, retirement/revocation, offline behaviour, monotonic sequence authority and the schema/authority proposal. Design registry, signature verification, persistence, replay prevention, apply/rollback and audit boundaries. Only then implement with real authorised keys and tests.  
**Acceptance:** Production-issued key provenance and custody; approved schema and sequence authority; signed state verifies; replay/rollback attacks fail; apply/rollback is genuinely governed; audit and recovery tests pass.  
**Gate:** SO-1…SO-4 plus CE architecture approval. Never generate demo, test, temporary or invented production keys. Never populate trust anchors to make tests pass. `NO-PATCHES` is valid only when an authenticated, positively read record says the set is empty.

### ENG-07 — Capability matrix [P] policy
**Status:** DECISION REQUIRED. **Priority:** High.  
**Evidence/location:** `docs/CYVRA_CAPABILITY_MATRIX_V1.md`, `PatchVerifier.kt`, patch schema. The audit reports 22 matrix rows (15 [P], 7 [S]) and string-membership validation that does not itself enforce provisional authority.  
**Work:** CE defines whether [P] rows fail closed, require an explicit exception, or are treated under another approved rule. Add negative tests for unknown, provisional, unsupported and retired capabilities.  
**Acceptance:** Capability authority is unambiguous, documented and enforced in code; tests prove unsupported/provisional capabilities cannot be authorised accidentally.  
**Gate:** Request ID `D-CE-26-04`. No policy implementation before the ruling.

### ENG-08 — Desktop workflow and help consistency (A1/A3/A4)
**Status:** NOT TESTED against the current UI. **Priority:** Medium.  
**Evidence/location:** `apps/desktop/src/App.tsx`, help copy and operator controls. The defect register describes mismatched step counts and help text that may describe an unlocking rule not enforced by the application.  
**Work:** Compare each displayed step and help statement with actual state transitions and gates; place controls on the step where operators need them; add UI tests for reachable, blocked and recovery states.  
**Acceptance:** Help text, step count, operator control placement and actual gate behaviour agree. Do not weaken the sanitization two-step barrier.

### ENG-09 — Report content, destination, naming and indexing (A2/A7/A8/A9/A11)
**Status:** OPEN / source and current product behaviour need tests. **Priority:** High.  
**Evidence/location:** Desktop report-generation path, host report store, operator identity, coverage fields and device table. The register lists format/destination/naming/scope, missing report index, placeholder operator identity, coverage/completion mismatch and an advertised device-table value that may not be collected.  
**Work:** Convert report requirements into a field-by-field acceptance matrix; trace source values to report output; remove unsupported claims and placeholders; define report indexing and retention; verify directory layout, filenames, hashes and access errors. Confirm whether PARTIAL coverage is correct before changing it.  
**Acceptance:** Every report claim is evidence-backed; required fields and destinations match approved specification; no fabricated operator/device values; report index and retention policy are tested.  
**Gate:** U-6 or additional CE decisions where product semantics are unresolved. Do not treat a report as complete merely because the UI says so.

### ENG-10 — Purge/sanitization capability and product claim (A-10)
**Status:** HIGH / NOT TESTED. **Priority:** Critical.  
**Evidence/location:** Defect register A-10 and sanitization capability gates. The audit reports that the purge capability cannot be exercised as shipped; whether payload-derived text satisfies the intended behaviour was not tested.  
**Work:** Define the exact intended supported method and truthful product claim; map each advertised capability to actual qualified implementation and proof; test refusal paths without destructive execution.  
**Acceptance:** No purge/sanitization claim exceeds verified method, authorization, entitlement, target binding, verification and reporting. Unsupported methods fail closed.  
**Gate:** Formal CE/security approval and approved physical validation plan before any destructive operation.

### ENG-11 — Operator identity and report attribution
**Status:** NOT TESTED. **Priority:** Medium.  
**Evidence/location:** Report headers and operator-ID input.  
**Work:** Define whether operator identity is mandatory, optional or externally supplied; remove placeholder identities; test empty, malformed and authenticated values; protect personal data.  
**Acceptance:** Reports accurately distinguish unknown, supplied and authenticated operator identity; no placeholder is represented as a real person.

### ENG-12 — Release logging and diagnosability (A5/B3)
**Status:** OPEN. **Priority:** Medium.  
**Evidence/location:** Desktop release configuration and fault/report paths. The defect register reports missing release logging and only partial fault diagnosability.  
**Work:** Verify actual logging configuration by build type; define privacy-safe event schema, retention and redaction; test errors across UI, Tauri, host and backend.  
**Acceptance:** Supportable failures carry a correlation ID, safe diagnostic context and explicit user outcome; no serial, token or private content leaks into logs.  
**Gate:** Do not alter release packaging or logging secrets without review.

### ENG-13 — Desktop typecheck and reproducible quality gates (A6)
**Status:** OPEN / recheck current scripts. **Priority:** Medium.  
**Evidence/location:** `apps/desktop/package.json` and root scripts. The register states no desktop typecheck script existed at the earlier audit; verify the current file before adding one.  
**Work:** Add or repair a deterministic typecheck command, ensure it is part of the approved quality workflow, and document Node/pnpm versions.  
**Acceptance:** Typecheck fails on a deliberately introduced type error and passes on the target commit; results are reproducible. No installer build is implied.

### ENG-14 — Windows USB/PnP production enumeration (P1)
**Status:** Integration incomplete / NOT HARDWARE-VALIDATED. **Priority:** High.  
**Evidence/location:** Host `UsbPnpTransport` and `UsbPnpProbe`, Windows transport architecture. The reviewed implementation uses an injected probe; a class/interface does not prove real SetupAPI/Configuration Manager enumeration.  
**Work:** Specify supported Windows versions and device identity semantics; implement/verify native enumeration behind the probe; prevent raw PnP instance IDs crossing public IPC; add mock and native integration tests.  
**Acceptance:** Connected/disconnected devices enumerate accurately, errors are diagnosable, identifiers remain in the permitted boundary, and four-port evidence is retained.  
**Gate:** No physical validation claim before bench execution.

### ENG-15 — Windows WPD/MTP production transport and metadata scanner (P2)
**Status:** Integration incomplete / NOT HARDWARE-VALIDATED. **Priority:** High.  
**Evidence/location:** Host `MtpTransport` / `MtpProbe` and `WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md`. The source uses an injected probe; production WPD COM/device-manager discovery and the approved metadata scanner are not established by that interface alone.  
**Work:** Define metadata-only scope and permission boundary; implement/verify WPD device discovery and supported MTP metadata access; handle no device, multiple devices, locked devices, permission errors and device removal.  
**Acceptance:** Only explicitly permitted metadata is collected; no private-content extraction; UI/report accurately states limitations; real Windows devices validate the exact supported path.

### ENG-16 — ADB transport and authorization-state clarity (P3)
**Status:** Protocol/runtime path exists; full workflow validation pending. **Priority:** High.  
**Evidence/location:** Host ADB CLI transport, connected-device/preflight and scan flows. An ADB-visible device is not proof that every operation is authorized or that a USB/PnP/MTP path is healthy.  
**Work:** Test authorized, unauthorized, offline, missing executable, multiple device and disconnect/reconnect cases; bind every command to the selected serial; keep ADB state distinct from USB/MTP claims.  
**Acceptance:** Refusal reasons are explicit; no command silently retargets; device transport and authorization are accurately reported.

### ENG-17 — Android companion integration and evidence contract
**Status:** Integration and lifecycle alignment pending. **Priority:** High.  
**Evidence/location:** Android component, host bridge, receiver, evidence schema and lifecycle database.  
**Work:** Verify actual APK/component availability, explicit scope grant, broadcast/IPC contract, producer identity fields, receiver failure semantics and server acceptance.  
**Acceptance:** Evidence is emitted only under the approved scope; lifecycle/session identities match the contract; evidence validates end to end; no claim of app/private-data access without proof.

### ENG-18 — Multi-device state isolation and 50-device capacity
**Status:** NOT TESTED. **Priority:** High.  
**Evidence/location:** Dispatcher state holders, desktop device selection, transport registry, report ownership and capacity claims. The handoff records 0/4 physical baseline and no 50-device proof.  
**Work:** First establish approved architecture for per-device/session state; build deterministic interleaving tests; then define a staged bench plan for 1, 2, 4 and larger device counts up to the advertised maximum. Record resource use, timing, failure/recovery and cross-device report binding.  
**Acceptance:** Each device's scan, report, export, lifecycle and entitlement accounting remain isolated; unsupported counts fail safely; 50-device claim is made only after a retained reproducible run.  
**Gate:** Do not advertise multi-device or 50-device support from code shape or unit tests.

### ENG-19 — Backend server-gap reconciliation (C-1…C-6)
**Status:** OPEN / source and document mismatch. **Priority:** High.  
**Evidence/location:** `docs/P2B-SERVER-GAPS.md`, `services/api/src/admin.ts`, relevant schema, routes and tests. The server-gap document describes `paymentStatusesFor` as applied/not committed, while the reviewed source uses `paymentsFor` and does not show the same function. The document may be stale; the exact intended change is not established.  
**Work:** Reconcile each C-item against current source, history and tests; classify present, absent, superseded or unverified; document API contracts and database effects; add red-first tests before implementing any confirmed gap.  
**Acceptance:** Every gap has a current source reference, owner, test, disposition and evidence; no change is applied merely because an old note says “APPLIED, NOT COMMITTED.”

### ENG-20 — Entitlement, licensing and debit idempotency
**Status:** Regression coverage required; no unauthorised changes. **Priority:** Critical.  
**Evidence/location:** Host licence/entitlement service, server entitlement and payment APIs, final-report debit path.  
**Work:** Map entitlement check/debit/refusal and idempotency boundaries; test retries, timeouts, duplicate requests, offline behaviour and report-finalisation refusal.  
**Acceptance:** No operation proceeds without valid live authorization; duplicate attempts do not double debit; failed/refused operations are auditable.  
**Gate:** Preserve existing licence/entitlement code unless a specific reviewed change is approved.

### ENG-21 — Canonical defect register and missing closeout record (U-4/U-5)
**Status:** DECISION REQUIRED. **Priority:** Medium.  
**Evidence/location:** Desktop `Defect Register.txt` and `docs/DEFECT_REGISTER_2026-10-18.md` differ in size/date and must not be assumed equivalent; `CYVRA-PhaseA-Closeout-Alignment-2026-10-20.txt` was reported missing from the repo and accessible audit locations.  
**Work:** CE declares the register of record and whether the two registers are equivalent; locate or explicitly disposition the missing closeout; only then propose corrections to historical Phase A records.  
**Acceptance:** A dated decision names canonical source, supersession/equivalence and correction authority. No historical audit text is silently rewritten.  
**Gate:** U-4/U-5. Request IDs must not collide with existing CE-1…CE-5 ledger rulings.

### ENG-22 — Governance identifier collision prevention
**Status:** OPEN. **Priority:** High for decision integrity.  
**Evidence/location:** Governance ledger already assigns CE-1 through CE-5 to earlier rulings. New request IDs must not reuse those identifiers.  
**Work:** Use `D-CE-26-01` through `D-CE-26-08` for new proposed decision requests, preserving all historical CE-1…CE-5 references as historical IDs. Verify whether SO-1…SO-4 already exist before circulating the decision sheet.  
**Acceptance:** Every decision request is unique, dated, scoped, owned and explicitly pending/decided; no source comment is mistaken for approval.

### ENG-23 — NIST claim, certificate identifier and historical closeout claims (R-2/R-3)
**Status:** PRECONDITION UNEXECUTED. **Priority:** High.  
**Evidence/location:** Sanitization model and workstation certificate-ID generator; governance ledger. The audit notes that a NIST string was removed from active code but retained as a removal note, while a live `CYVRA-CERT-` generator remains.  
**Work:** Re-read the current source and claim wording; establish what each identifier certifies; execute the specified R-2/R-3 preconditions only when authorized; update records with evidence rather than inference.  
**Acceptance:** No standard, compliance or certification claim exceeds what was actually tested and approved.

### ENG-24 — Four-port baseline and physical test evidence
**Status:** NOT TESTED; baseline 0/4. **Priority:** High.  
**Work:** Prepare the bench checklist, device/port inventory, approved build identity, ADB authorization state, licence state, exact commands, screenshots/logs, serial masking, report hashes and stop conditions. Execute only under explicit bench authorization and with sanitization disabled unless separately authorized.  
**Acceptance:** Four individual ports have retained evidence, correct device/report correlation, clean refusal and recovery behaviour, artifact/hash checks and entitlement reconciliation.  
**Gate:** Any wrong serial, ambiguous identity, unexpected destructive action or unstable USB condition stops the run.

### ENG-25 — Windows Engineering Build workflow and release gates
**Status:** NO RUN EVIDENCE FOUND for the reviewed head; NOT RELEASE-VALIDATED. **Priority:** High.  
**Evidence/location:** `.github/workflows/windows-engineering-build.yml` and Actions history. The existing packaging freeze is NSIS setup `.exe` only; unsigned engineering artifacts remain accepted during development; MSI/WiX is dropped. No CI workflow was triggered by this review.  
**Work:** Review workflow triggers, dependencies, artifact naming and retention; confirm the branch-trigger policy; execute only with separate full-suite authorization. Record commit SHA, runner, toolchain, job logs and artifact hashes.  
**Acceptance:** Approved Windows build/test gates pass on the intended commit; any packaging output matches the frozen NSIS-only rule; no MSI/WiX artifacts are introduced.  
**Gate:** Do not rebuild the installer or trigger a workflow without explicit approval.

### ENG-26 — Release signing and APK signing hold
**Status:** DEFERRED / BLOCKED BY APPROVAL. **Priority:** High.  
**Work:** Keep the existing H4 APK signing hold distinct from patch-state key custody. Identify signing authority, key custody, reproducible signing process and release evidence.  
**Acceptance:** Genuine authorized signing key and custody record; build provenance and signatures verified. Never substitute a temporary/demo key or conflate app signing with patch trust anchors.

### ENG-27 — Documentation/source-of-truth and evidence traceability
**Status:** OPEN. **Priority:** Medium.  
**Work:** For each engineering claim, record source path/ref, exact observation, confidence category, test/hardware evidence, owner, dependency and dated closure. Identify stale line citations and distinguish local machine-only files/stashes from GitHub-visible records.  
**Acceptance:** No stale citation is treated as current proof; source, tests and decision records link to the exact commit; discrepancies are preserved and explicitly reconciled.

### ENG-28 — End-to-end customer workflow and release qualification
**Status:** NOT TESTED. **Priority:** Critical.  
**Work:** After all upstream decisions and integrations, validate install/startup, device discovery, preflight, non-destructive scan, Report 1 generation/download, entitlement, separately authorized sanitization, reconnect/reverification and final report. Exercise error, disconnect, retry, stale state, multiple device, report integrity and recovery paths.  
**Acceptance:** Each advertised supported workflow passes on the approved Windows environment and physical device set; report claims match evidence; security/authorization gates hold; logs and artifacts are retained; all required release gates pass.  
**Gate:** This is the final qualification phase, not a substitute for the preceding decision and hardware gates.

## 4. Decision and dependency register

All items below remain pending unless a dated, authoritative governance record proves otherwise.

| Request ID | Decision required | Why it blocks work |
|---|---|---|
| D-CE-26-01 | U-1: lifecycle identity origin, registry and propagation | Prevents inventing an identity or producing unregistered evidence |
| D-CE-26-02 | U-2: report ownership and empty-payload policy | Defines compatible and safe retrieval semantics |
| D-CE-26-03 | U-3: clear-on-failure versus another explicit stale-state policy | Defines scan failure behaviour and stale evidence handling |
| D-CE-26-04 | [P] capability-row authority | Prevents provisional capability rows being treated as authorised |
| D-CE-26-05 | U-4: canonical defect register | Prevents conflicting records being silently treated as equivalent |
| D-CE-26-06 | U-5: Phase A correction authority / missing record disposition | Prevents unauthorised historical audit edits |
| D-CE-26-07 | U-6/O-3: FINALISE_REPORT intent | Defines which report is finalised and what the certificate means |
| D-CE-26-08 | Architecture/implementation boundary for production patch-state | Coordinates schema/authority ratification with D-5 dependencies |
| SO-1…SO-4 | Security Owner decisions for production patch trust | Key issuance/custody, retirement, offline behaviour, monotonic sequence authority; verify these IDs against existing records before circulation |

**Identifier warning:** CE-1 through CE-5 already exist in the historical governance ledger for different subjects. Do not reuse them for these requests. New request IDs are labels for proposed decisions, not approvals and not replacements for historical references.

## 5. Safe work that can begin without changing protected boundaries

1. Read-only current-head trace of each item above and reconciliation of stale line references.
2. Red-first unit/contract tests for identity binding, retrieval mismatch, scan-failure stale state, report finalisation and sanitization target mismatch. Tests must avoid destructive execution.
3. A payload map for every UI command: request fields, response fields, state source, authorization gate and refusal codes.
4. A transport evidence map distinguishing Windows USB/PnP, WPD/MTP, ADB and Android companion; do not infer one transport's capabilities from another.
5. Report field/source acceptance matrix and report output fixture review.
6. A current-source reconciliation of all C-1…C-6 backend gaps and the defect register.
7. A hardware test plan and evidence templates only; no physical run without approval.
8. A reproducible non-packaging build/typecheck plan; do not trigger CI or rebuild NSIS without separate authorization.
9. Decision sheet preparation with unique IDs, explicit options, recommendation, risk, owner and signature/date field.
10. A release-evidence checklist with commit SHA, toolchain, test logs, hardware inventory, screenshots, report hashes and stop conditions.

## 6. Recommended phase order

### Phase 0 — Baseline and source reconciliation
Record branch/head, file hashes, current source lines, existing tests, Actions status and discrepancies. Preserve all stashes, worktrees, protected files and uncommitted work. Do not infer local-only state from GitHub.

### Phase 1 — Governance decisions
Resolve lifecycle identity, retrieval policy, failed-scan state, capability [P] authority, defect-register authority, Phase A correction authority and finalise-report intent. Prepare patch trust decisions and verify identifier uniqueness.

### Phase 2 — Red-first correctness tests
Pin down report ownership, failure-state clearing, sanitization target binding, lifecycle propagation, final-report source and entitlement debit idempotency. Confirm tests fail for the defect before implementation where applicable.

### Phase 3 — Correctness fixes
Implement only approved changes in small reviewed patches. Preserve the sanitization two-step barrier, entitlement/idempotency, privacy rules and fail-closed defaults. Do not mix unrelated defects.

### Phase 4 — Production transport integration
Complete and test real Windows USB/PnP and WPD/MTP discovery behind their existing boundaries; validate ADB and companion paths independently. Document supported device/OS matrix and exact limitations.

### Phase 5 — Reporting, desktop and backend integration
Resolve report format/naming/indexing and truthful coverage; correct help/step/controls; reconcile server gaps against current source; add contract and failure tests.

### Phase 6 — Governed patch-state/security
Proceed only after key/custody/schema/sequence/offline decisions. Implement registry, verification, persistence, replay prevention, apply/rollback boundary and audit tests with real authorized trust material.

### Phase 7 — Hardware, CI and release qualification
Obtain separate authorization for the full Windows engineering workflow and physical bench tests. Complete 4-port baseline, one-to-many device validation, scan-to-report and final workflow, capacity test, security/refusal checks and evidence retention. Release validation is only possible after all required gates pass.

## 7. Required test/evidence matrix

| Area | Minimum evidence before closure |
|---|---|
| Lifecycle identity | Approved contract, red-first producer test, registered/unregistered DB integration, end-to-end evidence validation |
| Report retrieval | Match/mismatch/absent/stale tests for every handler, UI payload contract, multi-device isolation evidence |
| Scan failure | Successful scan followed by failed scan; all retrieval paths refuse stale result; lifecycle reset invariants tested |
| Sanitization target | Match/mismatch/absent payload tests for start and execute; no destructive run unless separately authorized |
| Final report | CE intent ruling, scan/final report binding, manifest/hash checks, debit idempotency and refusal cases |
| Patch trust | Genuine approved key/custody, schema ratification, signature/replay/rollback tests, governed apply/rollback and audit |
| USB/PnP | Native discovery, connect/disconnect/error tests, four-port physical evidence |
| WPD/MTP | Real Windows device-manager integration, metadata scope tests, locked/removed/multiple-device cases |
| ADB/companion | Authorized/unauthorized/offline/disconnect tests; explicit scope and identity contract |
| Reports/UI | Field-to-source matrix, filenames/destination/index, truthful coverage, operator attribution, help/step consistency |
| Backend | Each gap classified against current source, API/database contract tests and retained logs |
| CI/release | Approved workflow pass on exact SHA, reproducible artifacts/hashes, install/startup checks, security and hardware gates |
| Capacity | Measured device-count ramp with per-device isolation, failure recovery and resource/timing evidence |
| End-to-end | Approved device/OS matrix, full evidence/report flow, refusal cases, retained report hashes and operator record |

## 8. Stop conditions and protected boundaries

Stop immediately if any report or operation is bound to a different device than the selected/attached device; lifecycle identity is missing or ambiguous; a failed scan exposes previous-device evidence; an unsupported or provisional capability is authorised; a sanitization action can proceed without explicit target binding, live entitlement and authorization; a patch is accepted without approved trust material; a report claims a method or standard that was not verified; or evidence cannot be tied to the exact source/build.

Preserve the following constraints:

- NSIS setup `.exe` remains the only current installer format. WiX/MSI is dropped.
- No installer rebuild without explicit approval. Unsigned engineering artifacts remain acceptable during development.
- No CI/workflow run without separate full-suite authorization. No hardware/destructive operation without explicit approval.
- Do not modify protected `apps/web/src/api.ts`, stash contents, unrelated worktrees or user changes while addressing this inventory.
- Do not run `git add .`, force-push, reset, clean, rebase or amend as part of this work.
- Do not create demo/test/temporary production keys or populate production trust anchors without genuine key issuance and ratified architecture.
- Do not claim four-port, multi-device, 50-device or RELEASE-VALIDATED support until evidence proves it.
- Keep lifecycle IDs, session IDs, physical identifiers and session-scoped opaque device references distinct.
- Keep all sanitization and patch-application barriers fail-closed.

## 9. Closure format for each engineering item

Every item is closed only when its record contains: (1) approved decision/authority if required; (2) exact changed files and commit SHA; (3) red-first test or justified test plan; (4) actual test output and environment; (5) relevant integration/hardware evidence; (6) security/privacy review where applicable; (7) remaining limitations; and (8) a dated status update. “Code exists”, “compiles”, “unit tests pass” and “workflow is exposed” are not substitutes for hardware or release validation.

## 10. Immediate next actions

1. Confirm the actual current `main` head and compare the worktree/remote state before implementation.
2. Reconcile the current `HostProtocolDispatcher.kt` against D-2/D-3/D-4/O-3 observations; retain corrected line references.
3. Prepare decision requests D-CE-26-01 through D-CE-26-08 without marking any as approved.
4. Verify whether SO-1…SO-4 are unique in existing governance records before circulation.
5. Write red-first, non-destructive tests for report ownership and failed-scan stale state.
6. Map every UI command payload to the host protocol and state holder.
7. Reconcile C-1…C-6 against current server source and tests.
8. Prepare the Windows USB/PnP, WPD/MTP, ADB and companion integration acceptance matrix.
9. Prepare the four-port bench evidence pack; do not execute it until authorized.
10. Keep the overall release status **NOT RELEASE-READY** until all required gates have retained evidence.

---

**Final disposition:** This plan is an engineering work inventory and dependency map only. It authorizes no implementation, signing, patch application, sanitization, installer rebuild, CI run, hardware operation, governance amendment, or release claim. All pending decisions remain pending until recorded by the proper authority.
