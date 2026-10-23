# CYVRA Mobile — Agent-Based Scanning Architecture and Execution Plan

**Document date:** 23 October 2026
**Status:** WORKING SPECIFICATION — SOURCE-BACKED RECONCILIATION. **Not an engineering ruling, not an architecture ratification, not a release approval.** The recommendations in §3 and §4 remain recommendations until the designated engineering authority records rulings; nothing here authorises implementation, hardware execution, CI, packaging or any APK.
**Repository baseline for this document:** branch `docs/session-handoff-2026-10-20`, HEAD `d6502425de39d42e9edba692298e70f5a7b71551`, `origin/main` `4e7224e625d208d21441140f0114451fdb0035ac`, working tree = the uncommitted Phase 5 / WP-S1 changes (5 modified, 3 untracked, nothing staged).
**Program strategy (unchanged):** CONSOLIDATE → CORRECT → INTEGRATE → HARDWARE-PROVE → RELEASE-PROVE (`docs/CYVRA_MOBILE_PROJECT_INDEX.md:8`).

**Source material reconciled (read, not copied verbatim):**

- `CYVRA_AGENT_BASED_SCANNING_CURRENT_STATE_AND_FREEZE_PLAN_2026-10-23.txt` (998 lines, session-supplied; **not present in this repository** — this document is its canonical, evidence-cited consolidation for the repo).
- `docs/CYVRA_AGENTLESS_RESEARCH_Q1_2026-10-12.md`, `docs/CYVRA_AGENTLESS_STRATEGY_DESIGN_2026-10-13.md`.
- `docs/CYVRA_MOBILE_PROJECT_INDEX.md`, `GUIDELINE.md`, `docs/ANDROID_COMPATIBILITY_FREEZE.md`.
- `docs/WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md`, `docs/DEVICE_EVIDENCE_ARCHITECTURE.md`, `docs/SANITIZATION_ARCHITECTURE.md`, `docs/CUSTOMER_REPORT_ARCHITECTURE.md`.
- `docs/CYVRA_GOVERNANCE_LEDGER.md`, `docs/CYVRA_MOBILE_PENDING_ENGINEERING_WORK_PLAN_2026-10-22.md`, `docs/CYVRA_MOBILE_TODAYS_MASTER_WORK_PLAN_2026-10-22.txt`, `docs/DEFECT_REGISTER_2026-10-18.md`, `docs/CYVRA_MOBILE_SESSION_HANDOFF_2026-10-22.txt`.
- Phase 3 multi-device strategy research and Phase 5 WP-S1 implementation record (this programme's in-session research; the Phase 1–5 report files themselves are not stored in the workspace, and the referenced scanning PDF is not present — both are unavailable as files).
- Current source and tests, inspected directly (paths cited inline below).

Evidence classes used throughout: **[FACT]** = confirmed directly in current source/tests; **[MEASURED]** = test result run in this checkout; **[INFERENCE]** = architectural reasoning from facts; **[HYPOTHESIS]** = unproven; **[DECISION]** = requires an authority.

---

## 1. Product objective and precise terminology

**Objective.** A reliable Windows-hosted Android evidence-scanning and reporting application, with a *future, genuinely validated* path to 1–50-device operation.

**Terminology (normative for this document):**

| Term | Meaning |
|---|---|
| Scan | Evidence collection against exactly one selected device, producing session-bound records and Report 1. |
| Scan session | The unit of correlation: one selected device + one session UUID + the evidence/report set produced under it. |
| Physical identity | What the transport observes (ADB serial, USB/PnP identifiers). Never assumed stable across replug without re-discovery. |
| Opaque session identity | A host-generated session UUID that must accompany every request/response, evidence record and report artefact. |
| "Agent-based" split | **(A) host-side per-device workers** (execution/session model in the existing Kotlin host) vs **(B) a phone-installed Android scanning agent** (new APK). The two must never be conflated (`GUIDELINE`-level distinction; source TXT §0). |
| Five capacity values (kept distinct, never interchangeable) | 1. **licensed quota** (1–50 entitlement slab); 2. **detected devices** (OS/transport inventory); 3. **active sessions** (operations running now); 4. **configured concurrency** (scheduler bound); 5. **validated capacity** (count for which required evidence/tests are complete). |
| Maturity ladder | MODELLED → UNIT-TESTED → PROTOCOL-EXPOSED → UI-INTEGRATED → HARDWARE-VALIDATED → RELEASE-VALIDATED (`docs/CYVRA_MOBILE_PROJECT_INDEX.md:144-151`). |

**[DECISION-anchored fact]** A licence entitlement of 50 is not an engineering or validation result (`CYVRA_GOVERNANCE_LEDGER.md:1586` D7 wording; four-port protocol `:35,:40`). Current honest position: multi-device isolation **NOT TESTED**, 50-device capacity **NOT TESTED**, four-port baseline **0/4** (`docs/CYVRA_MOBILE_SESSION_HANDOFF_2026-10-22.txt:456,462-464`); capability position 62 of 114 coded, 0 end-to-end, 0 RELEASE-VALIDATED (`:496-498`); verdict **NOT RELEASE-READY** (`:541`).

---

## 2. Current-source component inventory (EXISTS / PARTIAL / ABSENT / UNVERIFIED)

All statuses below were verified against this checkout (HEAD `d650242` + WP-S1 working tree), not against documentation claims.

| Component | Status | Evidence (path / symbol) | Maturity |
|---|---|---|---|
| ADB transport with per-device targeting | **EXISTS** | `apps/host/.../transport/AdbClient.kt` — `getDeviceState(serial)`, `runShell(serial, …)` issue `adb -s <serial>`; `listDevices()` parses serial/state/product/model/transport_id | UNIT-TESTED (transport tests) + PROTOCOL-EXPOSED |
| Transport plane framework (USB/PnP, WPD/MTP, ADB, companion) with honest refusal | **EXISTS** | `TransportManager.kt:13-124` — `PlaneAvailability`, `ProbeOutcome.NOT_OBSERVABLE` ("never assumed; always carries a reason" `:13-14,:24`) | UNIT-TESTED / PARTIAL production registration |
| Host protocol dispatcher, single scan session, deterministic refusal | **EXISTS** | `HostProtocolDispatcher.kt`; `serialOwnershipRefusal` helper `:1641`, six guarded sites `:675,:712,:758,:937,:1169,:1286` | PROTOCOL-EXPOSED + UNIT-TESTED (404/405 green; D-1 marker red by design) |
| Ownership-guard mechanical coverage test (six-path + negative control) | **EXISTS** | `HostProtocolWorkflowTest.kt:1369` (`…_isMechanicalAcrossAllSixPaths_andDetectsMissingGuards`), negative self-test `:1432-1437` vs unguarded `GET_HOST_INFO` | UNIT-TESTED |
| D2 refusal / absent-serial compatibility / recovery semantics | **EXISTS (pinned)** | `HostProtocolWorkflowTest.kt:1456` (`…_noTrustworthyBindingRefuses_andCompatibilityStillRecovers`), absent-serial pin `:1322`, recovery `:1538,:1574` | UNIT-TESTED |
| Desktop stale-target invalidation | **EXISTS** | `apps/desktop/src/scanBinding.ts` (pure `nextScanBinding`), wired `App.tsx:8,:884,:1271,:1313` | UNIT-TESTED (8 tests) + UI-INTEGRATED |
| Request envelope with session/target correlation fields | **ABSENT** | `HostRequest.kt:7-11` = `{protocolVersion, requestId, command, payload}` only; target travels ad-hoc inside payload | — |
| Per-device `DeviceSession` / `SessionManager` / bounded scheduler | **ABSENT** | grep over `apps/host/src/main`: no `SessionManager`, `DeviceSession`, `sessionDeviceRef`, `sessionId`, `SupervisorJob`, `Semaphore` matches | — |
| Global single-session state as current authority | **EXISTS (known limitation)** | `WorkstationSessionOrchestrator.kt` (singleton orchestration; scans serialized by design today) | — |
| Rust/Tauri bridge with single-host lock + append-forward scan ledger | **EXISTS** | `apps/desktop/src-tauri/src/host_process.rs`, `commands.rs:276` (`record_scan_ledger`), `:415` (`get_device_state`) | UI-INTEGRATED (local, unproven in CI) |
| Android supporting component (P4 plane): device-side `PackageManager` evidence over broadcast | **EXISTS (wired, optional, fail-closed)** | trigger: `WorkstationSessionOrchestrator.kt:209` → `HostAndroidComponentBridge.triggerEvidenceCollection`; device side: `apps/android/app/.../ComponentEvidenceReceiver.kt:29-147` (component payload + S1 inventory in one instant); manifest declares CAMERA/RECORD_AUDIO/BLUETOOTH*/NEARBY_WIFI/INTERNET + exported receiver (`apps/android/app/src/main/AndroidManifest.xml:5-14`) | UNIT-TESTED / PROTOCOL-EXPOSED; receiver hardening open (Project Index §11.4) |
| Android scanning agent (general evidence scanner APK) | **ABSENT** | no such module; `apps/android/sanitization-agent` is the wipe POC only (MainActivity/SanitizationAdmin/BroadcastReceiver) | — |
| Sanitization POC + unsigned-APK guard | **EXISTS (deliberately gated)** | `sanitization-agent` module; R-I guard throws `AGENT_APK_SIGNED_UNEXPECTED` (ledger `:49-56`); H4 unsigned policy (ledger `:22`) | gated by H4/H6 |
| Report store + Report 1 (JSON+Markdown, SHA-256 manifest) | **EXISTS** | `HostReportStore.kt`, `ReportGenerator`/`ReportFinaliser`/`HostReportEngine`; format evidence per defect register A2 (`docs/DEFECT_REGISTER_2026-10-18.md`) | UNIT-TESTED; separate-deliverables requirement open (ENG-11) |
| Evidence providers (generic ADB, extended, application inventory, capability profile) | **EXISTS** | `apps/host/.../evidence/` — `AdbGenericEvidenceProvider`, `AdbExtendedEvidenceProvider`, `AdbApplicationInventoryProvider`; S1+S2 → `ApplicationInventoryReconciler` | UNIT-TESTED |
| Windows USB/PnP discovery in production path | **PARTIAL** | `wpd/discovery.rs`, `UsbPnpTransport` exist; production integration open (EW-08 / ENG-08, P1) | PARTIAL |
| CI (Windows engineering build) | **ABSENT (never run)** | workflow exists; "No run has ever occurred" (work plan `:59`); D-CE-26-08 pending | — |
| Four-port physical validation | **ABSENT (0/4)** | handoff `:456`; protocol prepared at `docs/CYVRA_FOUR_PORT_SEQUENTIAL_HARDWARE_VALIDATION_PROTOCOL_2026-10-23.md` (plan-only) | MODELLED |
| Device lifecycle identity (real identity) | **UNVERIFIED / defective (D-1)** | `DeviceLifecycleIdentityContractTest.kt:112` red marker (measured 23-Oct: 405 tests, 1 failed, exit 1) | red by design pending D-CE-26-01 |
| Live report defect: `AdbGenericEvidenceProvider.kt:58-62` `?: 0` | **EXISTS as defect (out of current scope)** | live code, noted in Phase 5 review | not fixed; belongs to EW-11/EW-12 lane |

---

## 3. Recommended host-side per-device worker baseline (recommendation only)

**[RECOMMENDATION — NOT A RULING]** Adopt **host-side, isolated per-device workers** in the existing Kotlin/JVM host using structured concurrency (Kotlin coroutines) and a **bounded scheduler**, as the execution/session model. Rationale:

- Reuses what already exists: `AdbClient` `-s` targeting, `TransportManager` plane/honesty model, dispatcher refusal semantics, evidence-provider seams, report store — no new runtime, no new trust boundary.
- The trust boundary stays the existing local JSON-lines pipe with its consistency guard; worker isolation is an execution model, not a security boundary.
- Capacity is retained at **1** (current single-session truth) through correctness closure (Stage 0–2, §11); a worker-per-device design does not itself prove concurrency.
- [INFERENCE] Worker isolation alone cannot prevent report contamination if the report builder still consumes global "last scan" state; session-scoping of report/evidence stores is a prerequisite, not a follow-up (risk R9, source TXT §8).

Explicitly **not** authorised by this document: `SessionManager`/`DeviceSession` implementation, Protocol V2, `SessionDeviceRef` migration, concurrency > 1. Those require recorded design + engineering rulings (§12 gates) and a separately scoped authorization.

---

## 4. The separate decision: is a phone-installed Android scanning agent necessary?

**[DECISION O1 — pending; recommendation below]**

**Recommendation:** a phone-installed **scanning** agent is **not required for the first supported release**, and should be commissioned **only for a proven evidence gap**. Reasons:

1. The evidence paths the product needs today are already reachable: ADB read-only plane (63/69 probes returned data with **no agent installed**, `docs/CYVRA_AGENTLESS_RESEARCH_Q1_2026-10-12.md:31`, complete 363-package inventory `:35`), Windows USB/WPD planes, and the existing optional P4 component (`apps/android/app`) which already supplies device-side `PackageManager` inventory over broadcast (§2).
2. An agent is not inherently more private: local processing helps only if it is permission-bounded, minimises what leaves the device, authenticates its host, and has a clear evidence/provenance contract (source TXT §4.4). The agentless research's strongest counter-argument — exposing a previous owner's data (contacts **294 rows**, media **288 entries**) to the PC (`:72-83`) — is a *privacy* driver for bounded local processing, but does not by itself authorise personal-data extraction.
3. Constraints that would apply the moment an APK is built: H4 (no private key generated/used, no APK signed until Ed25519 custody is ruled — ledger `:22`), R-I unsigned-APK guard, `ANDROID_COMPATIBILITY_FREEZE` toolchain pins (`:15-23`, "Do not upgrade these pins as incidental cleanup" `:27`), minSdk 26 as installation floor only (`:25`), OEM/background-execution/permission variability (risk R8).

**Distinction preserved:** the **sanitization** agent (`apps/android/sanitization-agent`) and the **component** (`apps/android/app`) are not scanning agents. Neither may be repurposed into one without a new scoped decision.

**CE-4 interplay:** CE-4 requires the *product* to fall back to agent-based scan/purge after five agentless attempts (§9). That legacy requirement must be **reconciled, not deleted** — and it is a separate question from whether the fallback agent exists for scanning.

---

## 5. Device discovery, identity, and reconnect rules

**[FACT] current behaviour; [SPEC] target rules.**

1. **Discovery:** Windows USB/PnP and WPD/MTP records + ADB `listDevices()` remain the discovery sources; three independently observed states (USB presence ≠ ADB detected ≠ ADB authorized) are never collapsed (`GUIDELINE.md:143-146`; `ANDROID_COMPATIBILITY_FREEZE.md:40-48`).
2. **Physical identity:** an ADB serial (or transport identity where serial absent) is *observational*. It may change meaning across replug/reimage; it is never a session.
3. **Opaque session identity:** every scan gets a host-generated session UUID; it must appear on every request/response, evidence record, export and report artefact. [FACT] today the UUID exists in evidence records (orchestrator passes `sessionUuid` through providers) but **not** in the request envelope (`HostRequest.kt:7-11`).
4. **Reconnect/replug:** physical port change or replug triggers fresh authoritative discovery and correlation; no session survives a transport identity change without re-correlation (source TXT §6 G3).
5. **Stale-state invalidation:** stale UI target (`lastScanSerial`) must not survive failed scan, device change, or the bound phone leaving inventory — **implemented** in `scanBinding.ts` + `App.tsx` effect (WP-S1, §2) and covered by 8 unit tests.
6. **Absent-serial policy (preserved):** an absent serial is **not** automatically a mismatch (`HostProtocolWorkflowTest.kt:1316,1326,1331`); Host-side binding resolves the target in the single-device session. Removal of the UI's `{}`-payload fallback belongs to a future UI-transmits-target package (WP-C lane), not to this stage.
7. **Guard semantics (preserved):** present + mismatching serial → `SERIAL_MISMATCH` empty refusal; present + no scan → `NO_SCAN_SESSION`; absent → served when binding resolves (`HostProtocolWorkflowTest.kt:1322-1349,1456-1520`).

---

## 6. Per-device session state, correlation, cancellation, timeouts, recovery

**[SPEC] (target design; none of it exists yet beyond the single-session baseline):**

- **Session state:** one `DeviceSession` per active device: identity inputs, state machine (idle → scanning → evidence → reporting → closed), bounded timeout budget, cancellation hook, cleanup journal with honest terminal states (`CLEANUP_VERIFIED` / `CLEANUP_FAILED` / `CLEANUP_UNVERIFIED` — never "guaranteed cleanup", risk R10).
- **Correlation:** every request carries {session UUID, target identity, request id}; responses echo them; mismatch → deterministic refusal (extending the existing `serialOwnershipRefusal` pattern). [FACT] envelope currently has no such fields → requires a **protocol amendment** (V2 design approval + `transport` contract amendment, see `docs/WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md` one-device rule discussion at `:524`).
- **Cancellation & timeouts:** per-session scope (`SupervisorJob` + `Semaphore`-bounded), independent errors — one device's failure never cancels another's session [INFERENCE once implemented].
- **Recovery:** failed scan leaves no servable scan state (`HostProtocolWorkflowTest.kt:1538`); a later successful scan serves only its own evidence (`:1574`) — these single-device invariants become the per-device invariants in Stage 3.
- **Serialization caveat:** today's global serialized request handling must not silently block queued progress; response ordering/correlation is preserved until a multiplexing design is approved (source TXT §6 G4).

---

## 7. Bounded scheduling and the five capacity values

**[SPEC]** A bounded scheduler admits at most `configuredConcurrency` sessions (initial value **1**), queueing or refusing beyond it with explicit reasons.

The five capacity values are reported **separately, always**:

| Value | Meaning | Current measured/known value |
|---|---|---|
| Licensed quota | entitlement slab | 1–50 (entitlement only) |
| Detected devices | OS/transport inventory | per-run observation; multi-device rows exist in UI/discovery |
| Active sessions | sessions running now | 1 (single-session architecture) |
| Configured concurrency | scheduler bound | 1 (retained through Stage 4) |
| Validated capacity | count with completed required evidence | **0 devices validated end-to-end**; four-port 0/4 |

No 50-device concurrent claim may be derived from licence, data structures, unit tests or sequential testing (D7 ledger `:1586`; risk R7: USB topology/hubs/power/ADB contention/thermals **unmeasured**).

---

## 8. Evidence provenance, privacy boundaries, partial outcomes, report isolation, integrity

1. **Provenance:** evidence before report; immutable raw records; canonicalize-then-digest; preserve `COLLECTED_AT`; human review creates a new record, never an edit; Report 1 freezes a manifest (`GUIDELINE.md:346-360`).
2. **Privacy/least privilege:** per-plane consent gates (`TransportManager` consent gate `:98`); no `/data/data`, no private-content extraction, no destructive fallback in the customer path (`GUIDELINE.md:126-141`); declared-but-requested-only-when-needed permission pattern (`apps/android/app/AndroidManifest.xml:4`); agentless exposure figures (294 contacts / 288 media entries) recorded as a *privacy risk driver*, not a capability (`AGENTLESS_RESEARCH:72-83`).
3. **Partial outcomes:** `UNAVAILABLE/NOT_TESTED/NOT_SUPPORTED/PERMISSION_DENIED` are never converted to `FAIL` (`GUIDELINE.md:137-141`); coverage labels COMPLETE/LIMITED/PARTIAL are not quality grades (`:108`).
4. **Report isolation:** every report/inventory/export/checklist/finalisation binds to the same session; refusal on wrong target/stale session/unknown target/partial evidence (source TXT §6 G5). [FACT] store is session-aware in records but still single-report-store today → session-scoping is a Stage-3 work item (risk R9).
5. **Integrity:** SHA-256 manifest exists for Report 1 export; separate-deliverables/filenames/indexing requirement (ENG-11 / EW-11, A2/A7) remains open and is **not** claimed satisfied.

---

## 9. Retained agentless route and required CE-4 reconciliation

**[FACT] CE-4 exists as a recorded product requirement** (`docs/CYVRA_GOVERNANCE_LEDGER.md:977-991`): the product "tries agent-less five times … falls back to agent-based on failure … completes the operation either way - the user never meets a dead end on scanning or purging. Every attempt and its outcome is written to the log."

**[FACT] The implementing design is DRAFT and not implemented** (`docs/CYVRA_AGENTLESS_STRATEGY_DESIGN_2026-10-13.md:7,:195` — "DRAFT for Chief Engineer ratification. Not implemented."; five-attempt scan ladder `:129-145`; purge fallback `:147-159` marked "MEASURED working end-to-end on 12-Oct" for one route only; tiers 1–3 "a design, not a capability" `:178-189`).

**Reconciliation required [DECISION]:** the agentless product strategy (S1–S4: inspect → *freeze* scan architecture → implement → validate) and CE-4's five-attempt/agent-fallback ladder are two live requirements that must be explicitly reconciled by the Chief Engineer — the ladder needs (a) a decision on whether the scanning fallback implies a scanning agent (§4), (b) what "five attempts" means against one Samsung/Android-11 data point (`:84-86` — OEM dependence unmeasured), and (c) recording attempt outcomes in the log. **This document does not amend, weaken or delete CE-4**, and the un-implemented draft status is stated wherever the ladder is referenced. Also preserved: hold **H8** — "agent-less route must not flatter itself" (ledger `:26,:28-32`), and the13-Oct honesty note that the 63 probes' underlying commands were never recorded (`:124-129`).

---

## 10. Security, authorization, entitlement, APK-signing and sanitization boundaries

Unchanged and non-negotiable for every stage of this plan:

- **Holds H1–H8** (`CYVRA_GOVERNANCE_LEDGER.md:17-26`): no destructive ops (H1), no capability claims (H3), **H4** no keygen/no APK signing until Ed25519 custody is ruled (`:22`), H5 no third-party driver binaries, **H6** `sanitizeExecute` requires live entitlement, H7 no gate weakening, H8 agentless honesty.
- **Separate-sanitization gate** (locked lifecycle: Verification → Report 1 → *separate* sanitization authorization → sanitization → post-verification → Final Report; pairing/USB/Report 1 never authorize wipe — `GUIDELINE.md:79-93`).
- **Authorized-ADB rule:** "NO AUTHORIZED ADB = NO ADB OPERATION", read-only first, versioned command registry, no arbitrary shell (`GUIDELINE.md:336-341`).
- **Compliance charter locks:** no lock/PIN/FRP bypass, no rooting/flashing, no private-content extraction, no forensic chain-of-custody default claim (say *evidence traceability*) (`GUIDELINE.md:126-141`).
- **Packaging:** NSIS-only (`bundle.targets: ["nsis"]`); no MSI/WiX; unsigned engineering artifacts remain the development scope; no installer rebuild in this task.
- **Open governance that gates security claims:** SEC-03 unresolved (ledger `:1600`); `HostProtocolDispatcher.kt:1622` still carries an unratified "U-2(a), ratified 21 October 2026" comment — correction belongs to the designated authority (Path 1/Path 2 undecided); D-CE-26-03 remains an unconfirmed *request* identifier (ledger `:1588,:1596`); D-CE-26-08 (CI) pending; entitlement offline/cached/unknown-state refusal paths covered by H6 tests but still part of ENG-28's threat-model inventory.

---

## 11. Dependency-ordered implementation stages and acceptance tests

Stages reuse the programme's existing numbering (Phase 3 strategy + source TXT Stages 0–7). Capacity stays **1** until Stage 5 exit. Each stage lists its acceptance evidence; none may begin without its gate.

| Stage | Content | Acceptance test / evidence | Gate |
|---|---|---|---|
| **0. Evidence & governance freeze** | This document + WP-S1 record; working-tree truth published | Reconciliation report (this Phase 6 output) | none (documentation) |
| **1. WP-S1 correctness close** *(implemented, pending formal closure)* | sixth inventory guard, six-path coverage + negative self-test, D2 semantics, stale-target invalidation, 8 binding tests | focused `:host:test *HostProtocolWorkflowTest*` exit 0 (measured 23-Oct); full `:host:test` 405/1 (D-1 red by design); desktop 79/79 exit 0; `tsc -b` exit 0 | **formal engineering rulings outstanding** (§12) |
| **2. Identity & correlation** | lifecycle identity (D-1/D-CE-26-01), request-envelope session/target fields (protocol amendment), UI transmits target | D-1 marker turns green *by fix, not edit*; new correlation refusal tests; stale-target E2E cases | D-CE-26-01 + protocol amendment approval + `transport:524` contract amendment |
| **3. Worker/session architecture** | `DeviceSession`/`SessionManager`, bounded scheduler, session mailboxes, session-scoped report/evidence stores, cancellation/supervision | deterministic tests: sessions cannot contaminate each other; backpressure and per-device outcomes; existing 405-test suite stays green | Stage-2 exit + recorded design approval + scoped authorization |
| **4. Deterministic simulation & fault injection** | seeded interleavings, replayable seeds: disconnect/replug, changed/reused serial, unauthorized ADB, timeout, host restart, cancellation, partial evidence, stale request, worker crash | simulation suite with recorded seeds; no cross-session contamination; honest cleanup states | Stage-3 exit |
| **5. Physical validation** | four-port **sequential** single-device runs per `docs/CYVRA_FOUR_PORT_SEQUENTIAL_HARDWARE_VALIDATION_PROTOCOL_2026-10-23.md`, then progressive multi-device isolation checks | per-port worksheet, per-run logs, report hashes, ambiguity-fails records; claim limited to *four-port single-device sequential* | **separate explicit hardware authorization** |
| **6. Capacity measurement** | only after isolation is proven: progressive concurrency, measured throughput/memory/failure isolation/timeouts | documented measured capacity figure distinct from all four other values | requirements + authorization; USB topology/power/thermal measurements |
| **7. Release evidence** | CI engineering build, installed-layout acceptance, security/privacy review (ENG-28), capability rows re-labelled truthfully | qualifying CI run, install-layout report, release security signoff, 0 unlabelled `[P]` rows | D-CE-26-08 + release gates G0–G10 (`GUIDELINE.md:397-413`) |

---

## 12. Current maturity, evidence links, open questions, approval gates

**Maturity of this document's subjects:** worker/session/bounded-scheduler/correlation → **MODELLED** (this spec) — everything else in §3/§6/§7 is *not* implemented; WP-S1 guard/coverage/D2 → **PROTOCOL-EXPOSED + UNIT-TESTED**; UI binding rules → **UNIT-TESTED** (wiring **UI-INTEGRATED**); component plane (P4) → **UNIT-TESTED/PROTOCOL-EXPOSED**; four-port → **MODELLED** (0/4); **HARDWARE-VALIDATED: none. RELEASE-VALIDATED: none.**

**Evidence links:** WP-S1 diff summary (this checkout: `HostProtocolDispatcher.kt` +7, `HostProtocolWorkflowTest.kt` +173, `App.tsx` +30/−1, `scanBinding.ts`/`.test.ts` new, ledger +92, work plan +19, four-port protocol new); measured runs 23-Oct: host full 405/1 exit 1 (D-1 only), focused suite exit 0, desktop 79/79 exit 0 (one load-flake run reproduced then cleared: isolated 24/24 + full re-run 79/79), `tsc -b` exit 0.

**Open questions (carried, not resolved):** O1 scanning-agent necessity (§4); O2 session identity origin/registry/propagation (= D-1/D-CE-26-01); O3 protocol versioning & correlation strategy (V1.1 vs V2); O4 report store session-scoping design; O5 CE-4 five-attempt reconciliation (§9); O6 absent-serial fallback removal home (WP-C); O7 capacity-measurement method/topology; O8 privacy budget: what may leave the device, ever (minimisation contract). Unverified hypotheses H-1/H-3/H-4 from earlier phases remain unverified.

**Approval gates (all currently open):**

1. **Engineering rulings** for D7/D2/D4 engineering counterparts (owner decisions exist at ledger `:1586-1599` but are *owner decisions, not ratifications*).
2. **D-CE-26-03 disposition** — request identifier, unconfirmed (ledger `:1588,:1596`).
3. **SEC-03 Path 1/Path 2** with correction of `HostProtocolDispatcher.kt:1622` by designated authority (ledger `:1600-1608`).
4. **D-CE-26-01** (lifecycle identity) before Stage 2; **protocol/contract amendment** before Stage 2 correlation fields.
5. **Stage-3 design approval** before any `SessionManager`/`DeviceSession`/scheduler code.
6. **Separate explicit authorization** before four-port hardware execution (§11 Stage 5).
7. **H4 key custody ruling** before any APK signing (incl. any scanning agent).
8. **D-CE-26-08** before any CI dispatch.
9. EW-02 formal status update + P1–P5 formal governance records remain pending.

---

## 13. Proposed source changes for each future implementation package

Precise, gated, and **not authorised by this document**:

**Package S1 (WP-S1) — already implemented in this working tree, uncommitted:**
- `apps/host/.../protocol/HostProtocolDispatcher.kt` — sixth `serialOwnershipRefusal` guard for `GET_APPLICATION_INVENTORY` (`:712`).
- `apps/host/.../protocol/HostProtocolWorkflowTest.kt` — six-path coverage + negative control (`:1369-1445`); D2 refusal/compatibility/recovery (`:1456-1520`).
- `apps/desktop/src/scanBinding.ts` (new) + `scanBinding.test.ts` (new, 8 tests) + `apps/desktop/src/App.tsx` wiring (`:8,:884,:1271,:1313`).
- Governance: ledger 23-Oct amendment; work-plan EW-02 correction pointer; four-port protocol document (new).

**Package B — identity & correlation (next gated implementation):**
- `HostRequest.kt` — add session/target fields (protocol amendment required first).
- `HostProtocolDispatcher.kt` — correlation checks on every command path; `:1622` comment corrected *after* SEC-03 ruling.
- `DeviceLifecycleIdentityContractTest.kt` — D-1 marker turns green by implementing identity, never by weakening the assertion.
- `apps/desktop/src-tauri/src/commands.rs` + `apps/desktop/src/App.tsx` — UI transmits target serial/session.
- New/extended tests: correlation refusal, replug/re-identification, stale-session E2E.

**Package C — session/worker architecture (design approval required):**
- New `apps/host/.../service/DeviceSession.kt`, `SessionManager.kt` (or bounded scheduler inside `WorkstationSessionOrchestrator.kt` refactored to per-session scopes).
- Report/evidence store session-scoping (`HostReportStore` + generator/finaliser).
- UI per-session progress/error surfaces (App.tsx), bridge serialization review (`commands.rs`).
- Tests: interleaving contamination suite (Package D).

**Package D — simulation/fault injection:** new deterministic seeded test suite over Package C seams; no production changes beyond hooks.

**Package E — Android scanning agent (only on proven gap + O1 decision + H4):** new module decision, manifest/permission review, signing/custody ruling, provenance contract — or explicitly *no package* if O1 resolves "not required".

**Package F — capacity harness & physical validation:** four-port worksheet automation (non-destructive), progressive-concurrency measurement tooling — hardware runs only under separate authorization.

---

**Closing statement.** This document consolidates, and does not duplicate, the existing programme. It creates no new decision identifiers, ratifies nothing, and claims no capability beyond what §2's evidence shows. The shortest safe dependency path is: **publish this consolidation → close WP-S1 formally (rulings 1–3, 9) → Package B (rulings 4) → Package C/D (gate 5) → hardware (gate 6) → release evidence (gates 7–8).**
