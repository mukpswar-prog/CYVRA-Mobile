# CYVRA Mobile — Pending Engineering Work Inventory

**Date:** 22 October 2026
**Repository:** `mukpswar-prog/CYVRA-Mobile`
**Branch:** `docs/session-handoff-2026-10-20`
**Baseline commit:** `9c7697dd85b6b295725cd69892bb8755fb8c6ae8`
**Prepared by:** OpenCode, controlled execution agent

## DRAFT — ENGINEERING WORK INVENTORY — NOT A RELEASE APPROVAL

This is a **planning document**, not a governance ruling. It does not close, approve,
ratify or supersede anything in the governance ledger, the defect registers, or the
session handoffs. Every decision identifier appearing here remains **PENDING**.

A recommendation is not an authorisation. A source-code comment is not an approval.
A passing unit test is not hardware evidence. A local test run is not CI evidence.

---

## Section 1. Executive summary

### 1.1 What CYVRA Mobile is intended to do

CYVRA Mobile is a **device diagnostic and data-sanitisation product** for Windows
workstations. In plain English it is meant to:

1. **See** Android phones and tablets connected to a Windows PC — over USB, over the
   media-transfer protocol phones expose when unlocked (MTP/WPD), and over the
   Android Debug Bridge (ADB) that appears when USB debugging is switched on.
2. **Inspect** each device and collect *evidence* about it: make, model, software
   version, installed applications, storage, security settings, battery, and so on.
3. **Report** that evidence in a signed, tamper-evident report — one report per
   device, plus a combined verification report.
4. **Erase** a device on request, using a method that follows recognised standards
   (NIST SP 800-88 Rev. 2), and then prove the erasure happened.
5. **License** that capability per device, through a Cloudflare-backed server, so
   erasure is only performed for a device the operator is entitled to erase.

The safety-critical property is that **erasure must never happen to the wrong
device**, and **a report must never claim more than the evidence supports**.

### 1.2 Current engineering position — what the evidence actually shows

Verified against the source tree at commit `9c7697d`:

| Area | Position | Evidence class |
|---|---|---|
| Protocol command surface (scan, report, export, sanitise start/execute, final report) | Implemented and wired | VERIFIED in source |
| Report/sanitisation **ownership guards** (a request naming the wrong device serial is refused) | Implemented at five call sites | VERIFIED in source |
| Patch-state **trust anchors** | Intentionally **empty** — no production key exists | VERIFIED in source |
| Six focused host test suites | **117 passed, 0 failed, 0 errors, 0 skipped**, all exit 0, at `7e8439d` | VERIFIED, **LOCAL ONLY** |
| Device lifecycle identity (D-1) | **Defect confirmed present** | VERIFIED in source |
| Windows USB/PnP enumeration | **Real implementation exists** (Rust) | VERIFIED in source |
| Windows WPD/MTP enumeration | **Real implementation exists** (Rust) | VERIFIED in source |
| ADB transport | **Real implementation exists** (Kotlin) | VERIFIED in source |
| Capability matrix | 22 rows: **15 `[P]` provisional, 7 `[S]` ratified** | VERIFIED in source |
| End-to-end hardware scan/report | **NOT TESTED** | No evidence exists |
| Four-port physical baseline | **0 of 4**; every row PENDING | Source document |
| CI / GitHub Actions | **No run has ever occurred** | VERIFIED |
| Release readiness | **NOT RELEASE-READY** | Verdict |

**There is no completion percentage to give.** The honest statement is: a great deal
of the code is written and unit-tested, almost none of it has been exercised against
a real phone, and the two decisions that gate the security-sensitive work have not
been made.

### 1.3 Why the project is not release-ready

Five reasons, in descending order of severity:

1. **No hardware validation exists at all.** Not a single end-to-end scan and report
   has been run against a real physical device through the product. The four-port
   baseline that was supposed to provide this is 0/4 — every row still PENDING.
2. **The erasure subsystem is deliberately switched off.** The patch-trust-anchor
   table is empty by design because no production signing key has ever been issued.
   The code fails closed, which is *correct* behaviour — but it means the product's
   headline feature cannot run.
3. **Device identity is broken (D-1).** The identifier used for a device is a
   prefixed random value, not a real registered identity. It therefore cannot be
   stored in the evidence database, which requires a UUID foreign key.
4. **No CI exists.** All testing is manual and local. There is no automated gate.
5. **Twelve governance decisions are outstanding**, including which defect register
   is authoritative.

### 1.4 Being able to continue engineering ≠ being authorised to complete a task

This is the single most important distinction in this document.

A great deal of useful engineering work can start **right now** without anyone's
permission — better tests, defect investigations, interface contracts, documentation,
hardware-test planning. Section 5 lists it.

But three specific categories of work **cannot start**, no matter how competent the
engineer, because they require a decision from a named person:

- **Anything that creates or installs cryptographic key material** — Security Owner
  decision SO-1, SO-2.
- **The D-1 lifecycle-identity repair** — Chief Engineer decision D-CE-26-01, because
  the fix depends on which identity architecture is chosen.
- **Anything that runs a real erasure against a real device** — requires U-5
  authorisation plus a qualified entitlement plus hardware access.

Mixing these up is how a project convinces itself it is further along than it is.

---

## Section 2. Engineering status in plain English

The product's maturity labels, from weakest to strongest claim. **An item may only
carry a label if the evidence for it exists.**

| Label | Plain-English meaning | What it does NOT imply |
|---|---|---|
| `MODELLED` | The shape of the thing is designed — a type, a schema, a document. | That any code runs. |
| `UNIT-TESTED` | Code exists and passes tests against **fakes** — stand-ins, not real devices or services. | That it works with a real phone, a real network, or a real database. |
| `PROTOCOL-EXPOSED` | A command exists on the wire; the host will accept and dispatch it. | That the command does anything meaningful end to end. |
| `UI-INTEGRATED` | A user can reach the feature from the desktop application. | That the feature works behind the UI. |
| `HARDWARE-VALIDATED` | Run against a **real physical device** and produced correct results. | That it is safe to release. |
| `RELEASE-VALIDATED` | Hardware-validated **plus** the release evidence required to ship. | — |

**Current position by area (verified):**

| Area | Highest label honestly supported | Why not higher |
|---|---|---|
| Protocol command surface | `PROTOCOL-EXPOSED` | Dispatch verified; end-to-end effect not hardware-tested |
| Ownership guards (D-2/D-3) | `UNIT-TESTED` | Guards present; no hardware proof they hold under real conditions |
| USB/PnP + WPD/MTP (Rust) | `UNIT-TESTED` | Real Windows API code exists; no hardware run recorded |
| ADB transport (Kotlin) | `UNIT-TESTED` | Real process-invocation code; verified only against fakes |
| Capability matrix loading | `UNIT-TESTED` | Parses correctly; 15/22 rows are provisional |
| Patch-state authenticity | `MODELLED` | Trust anchors empty by design; no key, no store wiring |
| End-to-end scan + report | — | `NOT TESTED` |
| Erasure / sanitisation | — | `NOT TESTED`, and blocked by design |
| Multi-device (2–50 devices) | — | `NOT TESTED`; no evidence any path was exercised |

**Nothing in this product is `RELEASE-VALIDATED`.** Confirmed independently by
`docs/CYVRA_FINAL_PLAN_VS_ACTUAL_HANDSHAKE_MATRIX_2026-10-12.md` L307:
*"nothing in this repository is RELEASE-VALIDATED"*.

---

## Section 3. Detailed pending engineering work

Each entry follows the required format. Where a status is `NOT REVERIFIED`, the item
was asserted by an earlier audit document but could not be re-confirmed in this
session's source inspection.

---

### EW-01 — Device lifecycle identity is not a real identity (D-1 / U-1)

- **Status:** `OPEN` — defect confirmed present in current source.
- **Priority:** Critical.
- **What is pending:** The application invents a device identifier at runtime instead
  of using a registered one. The identifier is generated by prefixing a truncated
  random UUID, which produces a string that is **not a UUID at all**.
- **Where:**
  - `apps/host/src/main/kotlin/cyvra/mobile/host/service/WorkstationSessionOrchestrator.kt:149`
    — `val sessionUuid = "CYVRA-SESSION-${UUID.randomUUID().toString().take(12).uppercase()}"`
  - `apps/android/app/src/main/java/cyvra/mobile/ComponentEvidenceReceiver.kt:35`
    — falls back to the literal `"unknown-lifecycle"` when the extra is absent.
- **Current evidence:** Three inconsistent producers exist for what should be one
  identity. The host emits a `CYVRA-SESSION-…` prefix; the Android receiver emits a
  random value per run and falls back to `"unknown-lifecycle"`; the desktop ledger
  test fixtures use `"CYVRA-SESSION-AAAA"` and `"CYVRA-SESSION-ABC"`
  (`apps/desktop/src-tauri/src/ledger.rs:593`, `:1061`).
- **Why it remains pending:** The value is rejected downstream on **two independent
  grounds**:
  1. The evidence package validates it as a UUID — `packages/evidence/src/ids.ts`
     and `packages/evidence/src/validate.ts` enforce the uuid format.
  2. The database column is declared `uuid("id").primaryKey()`
     (`database/src/schema.ts:302-316`), and `device_lifecycles` is the target of
     foreign keys from `capability_profiles`, `evidence_records`, `evidence_batches`,
     `processing_sessions` and `reports` (`database/migrations/0002_sturdy_salo.sql`,
     `0003_smiling_gideon.sql`). A prefixed string **cannot** satisfy that foreign key.
- **Why it matters:** Every piece of collected evidence, every report, and every
  erasure record is supposed to hang off a device identity. If the identity is
  fabricated per run, evidence cannot be attributed to a device across sessions, and
  the audit trail the product exists to provide is broken at its root.
- **How we will solve it:**
  1. Obtain decision D-CE-26-01 (which identity architecture is authoritative).
  2. Introduce a lifecycle-registration call that creates a `device_lifecycles` row
     and returns its UUID.
  3. Replace the three producers with that single call.
  4. Keep session-scoped correlation as a **separate** field — it is a legitimate
     concept, just not a device identity.
  5. Add the five required test cases (valid, missing, invalid, unregistered,
     mismatched ownership).
- **Dependencies and approvals:** **Genuine approval gate.** Blocked on
  **D-CE-26-01**. Do not invent an identity authority before that decision.
- **Acceptance criteria:** One producer; every emitted id is a UUID; the id resolves
  to an existing `device_lifecycles` row; no `"unknown-lifecycle"` literal remains.
- **Required verification:** The five lifecycle test cases, plus a database round-trip
  test proving the foreign key is satisfied.
- **Completion evidence:** Test output retained, plus the D-CE-26-01 decision record.
- **Can work start now?:** `PARTIALLY` — investigation and test authoring can start;
  implementation cannot.
- **Next action:** Author the five lifecycle test cases as **failing tests** against
  the current implementation, so the defect is executable and visible.

---

### EW-02 — Report ownership guards (D-2 / U-2(a))

- **Status:** `CLOSED WITH EVIDENCE` at the source level — guards verified present.
  **Not** hardware-validated.
- **Priority:** High.
- **What is pending:** Nothing in the guard implementation itself. What remains is
  hardware validation and an authoritative approval record for the design.
- **Where:** `apps/host/src/main/kotlin/cyvra/mobile/host/protocol/HostProtocolDispatcher.kt`
  — the shared refusal helper `serialOwnershipRefusal` is defined at `:1634` and
  returns code `SERIAL_MISMATCH` at `:1643`. It is invoked at **five** call sites:
  - `deviceReportResponse` — `:675`
  - `exportReportResponse` — `:751`
  - `sanitizeStartResponse` — `:930`
  - `sanitizeExecuteResponse` — `:1162`
  - `finalReportResponse` — `:1279`
- **Current evidence:** Verified present in the current tree at `9c7697d`. The doc
  comment at `:1626` states that a mismatched serial is refused with
  `SERIAL_MISMATCH` and that **an absent serial is NOT treated as a match** — the
  safe direction.
- **Why it remains pending:** The guards are sound, but (a) no hardware test has ever
  proven they hold under real conditions, and (b) the design carries no dated
  approval record — it exists as working code and comments only.
- **Why it matters:** This is the guard that stops a report or an erasure being
  redirected to a different device. It is the product's most important safety
  property.
- **How we will solve it:**
  1. Obtain D-CE-26-03 to record an explicit approval against the evidence.
  2. Write an integration test that drives the full request-to-response path with a
     mismatched serial and asserts `SERIAL_MISMATCH` at each of the five points.
  3. Include a redirection test in the hardware plan (EW-20).
- **Dependencies and approvals:** D-CE-26-03 (approval gate). The tests are **not**
  gated and can start now.
- **Acceptance criteria:** A dated ruling exists; an integration test proves
  redirection is refused at all five points.
- **Required verification:** Integration test plus one hardware redirection test.
- **Completion evidence:** Test output and the D-CE-26-03 decision record.
- **Can work start now?:** `YES` — for the test work. `NO` — for the approval.
- **Next action:** Write the five-point redirection integration test.

> **Amendment — 23 Oct 2026 (append-forward; the original text above is left intact).**
> Two corrections of record, both detailed in `docs/CYVRA_GOVERNANCE_LEDGER.md`
> under `Amendment - 23 Oct 2026`:
>
> 1. **Polarity.** The evidence line above ("an absent serial is NOT treated as a
>    match") inverts the actual behaviour. The accurate rule is that **an absent
>    serial is NOT automatically a mismatch**: `serialOwnershipRefusal`
>    (`HostProtocolDispatcher.kt:1634-1643`) serves an absent serial from the active
>    Host-side scan and refuses only a *present, non-matching* serial with
>    `SERIAL_MISMATCH`; a present serial with no active scan is refused as
>    `NO_SCAN_SESSION`. The boundary is pinned by
>    `HostProtocolWorkflowTest.kt:1321-1349`.
> 2. **Site count and next action.** There are now **six** guarded call sites, not
>    five: `GET_APPLICATION_INVENTORY` was added under the owner-approved WP-S1
>    scope (23-Oct-2026), the six-point redirection test described under "Next
>    action" now exists (`serialOwnership_guardCoverage_isMechanicalAcrossAllSixPaths_andDetectsMissingGuards`),
>    and it is still NOT hardware-validated and NOT formally ratified — D-CE-26-03
>    remains an unrecorded request identifier.

---

### EW-03 — Sanitisation-target ownership and A-9 / R-2 / R-3

- **Status:** `OPEN` — two separate facts, deliberately not merged.
- **Priority:** High.
- **What is pending:** The NIST verification string was removed from the sanitisation
  models, but a **live `CYVRA-CERT-` certificate generator still exists**. These are
  two different things and must not be reported as one fix.
- **Where:**
  - Certificate generator: `apps/host/src/main/kotlin/cyvra/mobile/host/service/WorkstationSessionOrchestrator.kt:457`
    — `certificateId = "CYVRA-CERT-${java.time.Year.now().value}-${UUID.randomUUID().toString().take(6).uppercase()}"`
  - The governance ledger records R-2 as "clean under grep" — **that statement is now
    contradicted** by the live generator. Tracked as conflict **C-2**.
- **Current evidence:** The generator is live and reachable in production code.
  Elsewhere the product is careful: `HostSanitizationProvider.kt:195` carries a
  comment refusing to assert a standard the product has not been certified against,
  and `HostReportEngineTest.kt:168` records *"the product no longer emits a NIST
  assurance"*. Note that `HostReportEngine.kt:134` still sets
  `nistStandardReference = "NIST SP 800-88 Rev. 2"` — this is a **reference
  citation**, not an assurance claim, and the two must not be conflated.
- **Why it remains pending:** The R-2/R-3 precondition was never executed. The
  governance record and the source disagree.
- **Why it matters:** A certificate identifier implies certification. If the product
  mints `CYVRA-CERT-…` values, a customer may reasonably read them as evidence of a
  certified sanitisation, which the product has not achieved.
- **How we will solve it:** Decide whether the certificate identifier is a benign
  internal correlation key or an implied certification. If the latter, remove the
  generator or change the prefix to something unambiguous. Then update the ledger.
- **Dependencies and approvals:** Engineering judgement, then a ledger entry. No
  security key involved.
- **Acceptance criteria:** Ledger statement and source agree; no string implies a
  certification the product does not hold.
- **Required verification:** Grep plus a unit test pinning the identifier format.
- **Completion evidence:** Updated ledger entry with date.
- **Can work start now?:** `YES`.
- **Next action:** Determine whether any customer-facing artefact surfaces the
  `CYVRA-CERT-` value.

---

### EW-04 — Failed-scan state retention (D-4 / U-3(a))

- **Status:** `OPEN` — guard present; the required scenario is **not executed**.
- **Priority:** High.
- **What is pending:** After a failed scan, stale scan state must be cleared so that
  a later report cannot accidentally include evidence from the failed attempt.
- **Where:** `HostProtocolDispatcher.kt` — `runScanResponse` at `:515`.
- **Current evidence:** The handler exists and clears state. **However**, no executed
  test proves the full workflow behaves correctly across a real fail-then-succeed
  sequence.
- **Why it remains pending:** A source-code guard is not proof that the workflow
  works. The required scenarios have not been run.
- **Why it matters:** Stale evidence in a report is a data-integrity failure — the
  report would claim facts about a device state that no longer holds.
- **How we will solve it:** Write a scenario test: scan fails → assert state cleared
  → scan succeeds → assert report contains only the successful scan's evidence.
- **Dependencies and approvals:** None. This is ordinary engineering.
- **Acceptance criteria:** The scenario test passes; no evidence from a failed scan
  can appear in a subsequent report.
- **Required verification:** Scenario integration test.
- **Completion evidence:** Test output.
- **Can work start now?:** `YES`.
- **Next action:** Write the fail-then-succeed scenario test.

---

### EW-05 — FINALISE_REPORT behaviour (U-6)

- **Status:** `NOT TESTED` — asserted in source only, no governance record.
- **Priority:** High.
- **What is pending:** The intended behaviour of `FINALISE_REPORT` is documented
  nowhere with authority. The 20-Oct handoff §C L94 records the concern: finalisation
  currently finalises a freshly-created object.
- **Where:** `HostProtocolDispatcher.kt` — `finalReportResponse` at `:1269`.
- **Current evidence:** Handler exists. **No `U-6` citation and no `template` string
  exists anywhere under `apps/host/src/main`** (grep exit 1). The only dated claim is
  a source comment at `HostProtocolDispatcher.kt:1622`.
- **Why it remains pending:** No governance record contains any 21-October entry. The
  behaviour is asserted in source only.
- **Why it matters:** Finalisation is the moment a report becomes immutable. If it
  finalises the wrong object, the sealed report describes something other than what
  was scanned.
- **How we will solve it:**
  1. Obtain D-CE-26-04 to establish the intended behaviour.
  2. Write a test that finalises and asserts the sealed report matches the scanned
     device.
- **Dependencies and approvals:** D-CE-26-04 (approval gate).
- **Acceptance criteria:** Dated ruling on intended behaviour; test proving the
  sealed report matches the scan.
- **Required verification:** Unit test plus hardware finalisation test.
- **Completion evidence:** Test output and decision record.
- **Can work start now?:** `PARTIALLY` — tests yes, ruling no.
- **Next action:** Document the current finalisation behaviour precisely as a
  baseline, so the eventual ruling has something to be measured against.

---

### EW-06 — Patch-state authenticity (D-5)

- **Status:** `BLOCKED BY DEPENDENCY` — blocked **by design**, which is correct.
- **Priority:** Critical.
- **What is pending:** The entire production patch-verification chain: a signing key,
  a key identifier, populated trust anchors, a patch-state store, a procedure
  registry, and the authenticity binding between them.
- **Where:**
  - `apps/host/src/main/kotlin/cyvra/mobile/host/engine/PatchTrustAnchors.kt:67`
    — `val ALL: Map<String, TrustAnchor> = emptyMap()`
  - The comment at `:11` states this is **not** a placeholder to be filled in later.
  - `:32` records that `FileBasedPatchStateProviderTest` **pins the emptiness** so it
    cannot regress silently.
  - `PatchStateStore.kt` returns `NoGovernedPatchApplicationAuthoriser` and
    `UngovernedAppliedStateAuthenticator`.
- **Current evidence:** Verified. The system fails closed — it refuses to accept a
  patch because nothing is trusted. **This is the correct behaviour and must not be
  "fixed" by adding keys.**
- **Why it remains pending:** No production key has ever been issued. Creating one
  requires a custody process, not a code change.
- **Why it matters:** This is the mechanism that would prove a patch was applied by
  an authorised party. Without it the product cannot claim any patch was applied.
- **How we will solve it:**
  1. Chief Engineer decides the authenticity architecture (D-CE-26-02).
  2. Security Owner issues or declines a key (SO-1), and defines rotation (SO-2).
  3. Then — and only then — wire the store and registry.
- **Dependencies and approvals:** **Genuine approval gates.** D-CE-26-02, SO-1,
  SO-2, SO-3, SO-4.
- **Acceptance criteria:** A key exists through an approved custody process; anchors
  are populated from it; the store is wired; a governed patch verifies; an ungoverned
  patch is refused.
- **Required verification:** Positive and negative verification tests; a refusal test
  proving the fail-closed gate still holds when anchors are empty.
- **Completion evidence:** Key-custody record plus test output.
- **Can work start now?:** `NO` — for implementation. `YES` — for the design
  evaluation in D-CE-26-02.
- **Next action:** Produce the D-CE-26-02 design comparison for the Chief Engineer.

---

### EW-07 — Provisional capability rows accepted as production (CE-7)

- **Status:** `DECISION REQUIRED`.
- **Priority:** High.
- **What is pending:** 15 of the 22 capability rows are marked `[P]` (provisional).
  A decision is needed on whether the production verification path may accept them.
- **Where:** `docs/CYVRA_CAPABILITY_MATRIX_V1.md` §4, table rows at L89–L110.
  Loader: `apps/host/src/main/kotlin/cyvra/mobile/host/engine/CapabilityMatrixLoader.kt`
  — `:415` sets `provisional = cells[ITEM_ID].contains("[P]")`, and `:459` names the
  matrix path `docs/CYVRA_CAPABILITY_MATRIX_V1.md`.
- **Current evidence — VERIFIED, counts confirmed:**
  - **22 total rows**
  - **15 `[P]`** (provisional): Security, Applications, Hardware, Storage, Display,
    Audio, Sensors, Biometrics, Haptics, Wi-Fi, Bluetooth, Cellular, GNSS,
    Performance, System
  - **7 `[S]`** (ratified): Connection, Identity, Battery, Touch, Camera, Mechanical,
    Sanitization
  - `docs/CORE_ENGINE_CAPABILITY_MATRIX_RUNTIME.md` §2 states: *"Provisional `[P]`
    item IDs are never a conformance requirement"* and provisional rows carry
    `PATCH_ROW_UNKNOWN` semantics.
  - The matrix itself flags **N-1** at L173: *"15 of 22 `ITEM ID`s are `[P]` seeds."*
- **Why it remains pending:** The engineering Master Diagnostic Capability Matrix has
  not ratified the provisional rows.
- **Why it matters:** Accepting a provisional row as a production capability would
  let the product claim a capability it has not ratified.
- **How we will solve it:** Fail closed until ratified (already the design); obtain
  D-CE-26-07; then promote rows individually with evidence.
- **Dependencies and approvals:** D-CE-26-07 (approval gate).
- **Acceptance criteria:** Each promoted row carries a dated ratification.
- **Required verification:** Loader tests for supported, provisional, unsupported,
  malformed and unknown entries.
- **Completion evidence:** Decision record plus loader test output.
- **Can work start now?:** `PARTIALLY` — the five loader test cases can be written
  now; promotion cannot.
- **Next action:** Write the five capability-entry loader tests.

---

### EW-08 — Windows USB/PnP discovery

- **Status:** `UNIT-TESTED` — real implementation exists; **not** hardware-validated.
- **Priority:** High.
- **What is pending:** Hardware validation. Note carefully: this is **not** missing
  code. A real Windows implementation exists.
- **Where:**
  - Rust side (real Windows enumeration): `apps/desktop/src-tauri/src/usb/enumerate.rs`,
    `apps/desktop/src-tauri/src/usb/reconcile.rs`
  - Kotlin side: `apps/host/src/main/kotlin/cyvra/mobile/host/transport/TransportManager.kt`
    — `UsbPnpTransport` at `:120`, taking an injected `UsbPnpProbe` (`fun interface`
    at `:159`).
- **Current evidence:** The Kotlin layer is an **injected seam by design** — the
  comment at `:118` records "Nothing internal" and `:144` "Descriptors only. No
  internal property is read on this plane." The real enumeration lives in the Rust
  binary. This is a legitimate architecture, **not** a stub.
- **Why it remains pending:** No hardware run has been recorded.
- **Why it matters:** USB/PnP is the discovery plane — without it the product cannot
  see a device at all.
- **How we will solve it:** Connect a real device; confirm enumeration returns
  VID/PID, serial, manufacturer and product; record the output.
- **Dependencies and approvals:** Hardware access only. No decision gate.
- **Acceptance criteria:** A physical device is enumerated and its descriptors
  recorded.
- **Required verification:** Physical-device enumeration run.
- **Completion evidence:** Captured enumeration output attached to the baseline.
- **Can work start now?:** `PARTIALLY` — test planning yes; execution needs hardware.
- **Next action:** Draft the USB/PnP hardware test procedure.

---

### EW-09 — Windows WPD/MTP discovery and access

- **Status:** `UNIT-TESTED` — real implementation exists; **not** hardware-validated.
- **Priority:** High.
- **What is pending:** Hardware validation of volume listing and lock-state handling.
- **Where:**
  - Rust side (real WPD): `apps/desktop/src-tauri/src/wpd/discovery.rs`,
    `apps/desktop/src-tauri/src/wpd/scanner.rs`
    (design record: `apps/desktop/src-tauri/docs/architecture/g6-wpd-metadata-scanner.md`)
  - Kotlin side: `MtpTransport` with injected `MtpProbe` (`fun interface` at
    `TransportManager.kt:230`).
- **Current evidence:** The design at `:171-173` is explicit and important: **a locked
  device returns an empty result by definition**, and that empty result is *not*
  evidence that storage is empty. This is the correct safe behaviour.
- **Why it remains pending:** No hardware run. Also, lock-state handling has never
  been exercised against a genuinely locked physical device.
- **Why it matters:** If an empty result on a locked device were misread as "storage
  is clean", the product would under-report — a silent failure in a forensic context.
- **How we will solve it:** Test with the device locked and unlocked; assert the two
  outcomes are distinguishable and correctly labelled.
- **Dependencies and approvals:** Hardware access. No decision gate.
- **Acceptance criteria:** Locked and unlocked states produce distinct, correctly
  labelled results.
- **Required verification:** Two physical-device runs.
- **Completion evidence:** Both outputs retained.
- **Can work start now?:** `PARTIALLY`.
- **Next action:** Draft the locked-versus-unlocked MTP test procedure.

---

### EW-10 — ADB transport and the Android companion

- **Status:** `UNIT-TESTED` — substantive real implementation; **not**
  hardware-validated.
- **Priority:** High.
- **What is pending:** Hardware validation of the full ADB path.
- **Where:** `apps/host/src/main/kotlin/cyvra/mobile/host/transport/` —
  `AdbClient.kt`, `AdbBinaryLocator.kt`, `AdbDeviceInspector.kt`, `ProcessRunner.kt`,
  `ConnectionStateMachine.kt`, `ConnectionStates.kt`, `HostPreflightVerifier.kt`,
  `AdbTransport` (`TransportManager.kt:240`).
  Evidence providers: `apps/host/src/main/kotlin/cyvra/mobile/host/evidence/` —
  `AdbApplicationInventoryProvider.kt`, `AdbExtendedEvidenceProvider.kt`,
  `AdbGenericEvidenceProvider.kt`, `HostAndroidComponentBridge.kt`.
  Android side: `apps/android/` — modules `app`, `core`, `sanitization-agent`.
- **Current evidence:** This is the "workhorse" plane (`TransportManager.kt:239`).
  `WorkstationSessionOrchestrator.kt:226` notes that ADB being off, unauthorised or
  failing changes the reconciliation outcome — so the code already contemplates
  failure states.
- **Why it remains pending:** Verified only against deterministic fakes
  (`IntegratedEvidenceWorkflowTest.kt:62`, `AdbApplicationInventoryProviderTest.kt:29`).
  Fakes are good; they are not hardware.
- **Why it matters:** ADB carries most of the evidence the product collects.
- **How we will solve it:** Run the full ADB path against a physical device with USB
  debugging enabled, and again with it disabled, and record both.
- **Dependencies and approvals:** Hardware access plus user consent on the device.
- **Acceptance criteria:** Application inventory collected from a real device;
  the unauthorised case correctly refuses.
- **Required verification:** Two physical-device runs.
- **Completion evidence:** Captured `packages.txt` and device properties.
- **Can work start now?:** `PARTIALLY`.
- **Next action:** Draft the ADB authorised/unauthorised test pair.

---

### EW-11 — End-to-end evidence collection and the Device Verification Report

- **Status:** `NOT TESTED`.
- **Priority:** Critical.
- **What is pending:** The whole point of the product: scan a device, collect
  evidence, produce a report, download it.
- **Where:** `apps/host/src/main/kotlin/cyvra/mobile/host/report/HostReportEngine.kt`,
  `HostReportEngineTest.kt`; Android `apps/android/core/.../ReportModels.kt`.
- **Current evidence:** **None at the hardware level.** The handshake matrix
  (`docs/CYVRA_FINAL_PLAN_VS_ACTUAL_HANDSHAKE_MATRIX_2026-10-12.md` L208) records
  *"End-to-end product scan validated on hardware: 0 — no full scan has yet been run
  through the product against a real device"*.
- **Why it remains pending:** No hardware run has ever been performed.
- **Why it matters:** This is the deliverable. Everything else supports it.
- **How we will solve it:** Execute EW-20 (the hardware baseline), one device at a
  time, then end to end.
- **Dependencies and approvals:** Hardware access. Decision D-CE-26-04 for the
  finalisation behaviour.
- **Acceptance criteria:** A real device is scanned and a correct report is
  downloaded.
- **Required verification:** Physical-device end-to-end run.
- **Completion evidence:** The downloaded report retained as evidence.
- **Can work start now?:** `NO` — requires hardware.
- **Next action:** Prepare the hardware test plan (EW-20).

---

### EW-12 — Evidence provenance and report accuracy

- **Status:** `NOT REVERIFIED`.
- **Priority:** High.
- **What is pending:** Whether reports contain provenance (timestamps, device
  ownership, collection method) and whether they refuse to claim more than the
  evidence supports when evidence is absent, stale, incomplete or contradictory.
- **Where:** Report engine and the evidence package (`packages/evidence/`).
- **Current evidence:** Assertion from earlier audit documents only. **Not
  re-verified in this session.**
- **Why it remains pending:** Not inspected.
- **Why it matters:** A report that silently fills gaps with plausible values is
  worse than no report, in a forensic product.
- **How we will solve it:** Inspect the report builder for every field; for each,
  determine what happens when the underlying evidence is missing.
- **Dependencies and approvals:** None.
- **Acceptance criteria:** Every field is either sourced or explicitly absent; no
  field is defaulted into a plausible value.
- **Required verification:** Unit tests for absent, stale, incomplete and
  contradictory evidence.
- **Completion evidence:** Test output.
- **Can work start now?:** `YES`.
- **Next action:** Inspect the report builder and enumerate every field's
  missing-evidence behaviour.

---

### EW-13 — Application-list-read requirement (A-10)

- **Status:** `NOT REVERIFIED` — the offending string is **absent** from the tree,
  but this is **not** claimed as a fix.
- **Priority:** Medium.
- **What is pending:** Confirming whether the application-inventory read is genuinely
  complete or merely no longer contains the previously flagged text.
- **Where:** `apps/host/src/main/kotlin/cyvra/mobile/host/evidence/AdbApplicationInventoryProvider.kt`.
- **Current evidence:** The previously flagged string was not found. Absence of a
  string is not proof the requirement is met.
- **Why it remains pending:** Nobody established that the underlying requirement is
  satisfied.
- **Why it matters:** Application inventory is a listed capability (APP-001).
- **How we will solve it:** Test the provider against a real device and compare the
  produced inventory to the documented requirement.
- **Dependencies and approvals:** Hardware for final proof; unit test work is
  ungated.
- **Acceptance criteria:** Inventory matches the requirement on a real device.
- **Required verification:** Physical-device inventory capture.
- **Completion evidence:** Captured inventory plus comparison.
- **Can work start now?:** `PARTIALLY`.
- **Next action:** Write down exactly what A-10 requires, so the gap is measurable.

---

### EW-14 — Sanitisation safety and correctness

- **Status:** `BLOCKED BY DEPENDENCY` — and **must not be executed** during this
  work.
- **Priority:** Critical.
- **What is pending:** Authorisation, live entitlement, correct targeting,
  preconditions, execution-state reporting, post-operation reconnect and
  verification, and final report correctness.
- **Where:** `apps/host/src/main/kotlin/cyvra/mobile/host/sanitization/` —
  `HostSanitizationProvider.kt`, `HostSanitizationWorkflowEngine.kt`,
  `HostDestructiveWipeProvider.kt`.
- **Current evidence:** The gate exists. `HostSanitizationProvider.kt:195` refuses to
  assert a standard the product is not certified against. `OfflinePermissions.NONE`
  is fail-closed (`sanitizeExecute = false`); `UNRESTRICTED` exists **only** as the
  `license.json` test/development seam.
- **Why it remains pending:** Requires U-4, U-5, a qualified entitlement, and
  hardware. Sanitisation is destructive and irreversible — it must never be run
  speculatively.
- **Why it matters:** Running an erasure against the wrong device destroys a
  customer's data irrecoverably.
- **How we will solve it:** Everything up to the point of execution can be built and
  tested against fakes. Execution requires the full gate.
- **Dependencies and approvals:** **Genuine approval gate.** U-4, U-5, entitlement
  qualification, hardware.
- **Acceptance criteria:** Authorisation is checked; targeting is verified;
  post-operation verification proves the claimed outcome.
- **Required verification:** Post-operation evidence that the device was actually
  wiped — not merely that an operation was attempted.
- **Completion evidence:** Post-operation verification output.
- **Can work start now?:** `PARTIALLY` — pre-execution work yes; execution **NO**.
- **Next action:** Separate the "attempted" outcome from the "verified wiped"
  outcome in the report model, so the product cannot claim one for the other.

---

### EW-15 — Entitlement, backend and the P2B discrepancy (C-1)

- **Status:** `OPEN` — conflict **C-1** unresolved.
- **Priority:** High.
- **What is pending:** `docs/P2B-SERVER-GAPS.md` line 4 states **"STATUS: APPLIED,
  NOT COMMITTED"**, claiming four `src/` files carry an uncommitted diff with 56 new
  tests.
- **Where:** `services/api/src/admin.ts`, `services/api/src/admin/search.ts`,
  `services/api/src/admin/audit.ts`.
- **Current evidence — verified this session:**
  - `paymentStatusesFor` appears **only** inside `docs/P2B-SERVER-GAPS.md`, and
    always as **commented-out proposed code** (lines 152, 241, 702).
  - It appears in **no** source file. The worktree is clean and committed.
  - `docs/FORENSIC_AUDIT_2026-10-10.md:449` records the symbol was **renamed** to
    `paymentsFor`; `docs/TROPHY_JOURNEY_STEP_1.md:61` and
    `docs/START_HERE_2026-10-07.md:52` record that P2B still quotes the **old** name
    as a known recorded deviation.
- **Why it remains pending:** The document's status line is stale. Either the diff was
  never applied, or it was applied and later superseded/renamed. **Nobody has
  established which.** This is exactly what conflict C-1 tracks, and it must not be
  resolved by assumption.
- **Why it matters:** Five Phase-3 admin-console deliverables are declared blocked on
  these gaps. If the gaps are already closed, the block is fictional. If they are
  real, the work is unstarted.
- **How we will solve it:** Diff the document's proposed changes against the current
  `services/api` source, gap by gap, and record for each: PRESENT / ABSENT /
  SUPERSEDED-AS-`paymentsFor`.
- **Dependencies and approvals:** None. Pure read-only investigation.
- **Acceptance criteria:** Each of the five gaps is individually dispositioned with
  evidence.
- **Required verification:** Source diff per gap.
- **Completion evidence:** A disposition table.
- **Can work start now?:** `YES` — and it is the highest-value ungated work available.
- **Next action:** Run the five-gap disposition.

> **Disposition (23 Oct 2026, append-forward; the text above is left intact).** The
> five-gap disposition table required by this item's completion criteria has been
> produced: `docs/CYVRA_P2B_FIVE_GAP_DISPOSITION_2026-10-23.md`. Finding: the P2B diff
> was **applied and committed** in `6ff8065` (3 Oct 2026), an ancestor of both `main`
> and this branch, so the document's "APPLIED, NOT COMMITTED" status line is stale.
> All five gaps are dispositioned (PRESENT, or SUPERSEDED-by-a-committed-implementation
> for the `paymentStatusesFor` naming) with file/line evidence, and the API suite passes
> 413/413 (exit 0) at `7c02787`. This note records evidence only; any EW-15 status
> transition follows the plan's retained closure format and owner review.

---

### EW-16 — Unresolved register, authority and citation conflicts (C-2 … C-6)

- **Status:** `OPEN` — all carried forward, none resolved.
- **Priority:** Medium.
- **What is pending:** Five further conflicts beyond C-1:
  - **C-2:** Ledger records R-2 as "clean under grep", but a live `CYVRA-CERT-`
    generator exists at `WorkstationSessionOrchestrator.kt:457`. (See EW-03.)
  - **C-3:** The ledger cites B1 / "item 7" at `:993`, but the Option C ruling is
    item 2 at `:1395`.
  - **C-4:** Two distinct 16-October numbering sets exist. In the ledger, "B1" means
    the H2 enforcement entry; in the defect register, "B1" is the ACTIVATE defect at
    `:407`.
  - **C-5:** `ACTIVITY_REVIEW_POST_FREEZE_2026-10-10.md` carries a "DRAFT" header
    while being tracked at commit `bdbb32c`.
  - **C-6:** The U-6 citation to `HostProtocolDispatcher` lines 681-685 is stale by
    roughly 278 lines. (The handlers now sit at `:1269` and `:1634`.)
- **Where:** `docs/CYVRA_GOVERNANCE_LEDGER.md`, `docs/DEFECT_REGISTER_2026-10-18.md`,
  `docs/ACTIVITY_REVIEW_POST_FREEZE_2026-10-10.md`.
- **Why it remains pending:** Resolving them requires the proper authority, not an
  agent's assumption.
- **Why it matters:** Ambiguous identifiers mean a returned decision can be read two
  ways. This already produced one incident this session: the 22-Oct handoff
  initially mislabelled U-4 and U-5, corrected in commit `9c7697d`.
- **How we will solve it:** A single reconciliation pass under U-4, producing a
  dated disposition for each conflict.
- **Dependencies and approvals:** U-4 for register authority.
- **Acceptance criteria:** Each conflict has a dated disposition.
- **Required verification:** Ledger entry.
- **Completion evidence:** The dated reconciliation record.
- **Can work start now?:** `PARTIALLY` — the analysis can be prepared now; the
  ruling cannot.
- **Next action:** Prepare the C-2…C-6 disposition analysis for U-4.

---

### EW-17 — Authoritative defect-register selection (U-4)

- **Status:** `DECISION REQUIRED`.
- **Priority:** High.
- **What is pending:** Two competing registers exist and their identities must be
  preserved separately until this is decided:
  - `docs/DEFECT_REGISTER_2026-10-18.md` (tracked, in-repository)
  - `Desktop\Defect Register.txt` (referenced by the 20-Oct handoff §C L88 as the
    register-of-record; **outside the repository**, not inspected)
- **Why it remains pending:** No dated ruling selects one.
- **Why it matters:** Every "is this defect open?" question is unanswerable while two
  registers disagree.
- **How we will solve it:** Obtain D-CE-26-05; do **not** merge the two by assumption.
- **Dependencies and approvals:** **Genuine approval gate.**
- **Acceptance criteria:** A dated ruling names one register of record.
- **Required verification:** Decision record.
- **Completion evidence:** The dated ruling.
- **Can work start now?:** `NO`.
- **Next action:** Prepare a side-by-side comparison of the two registers so the
  decision-maker sees the divergence.

---

### EW-18 — Authorization to correct the Phase A audit records (U-5)

- **Status:** `DECISION REQUIRED`.
- **Priority:** Medium.
- **What is pending:**
  - **Decision required:** Determine and record the authorization to correct the
    Phase A audit records (corrections C1/C3/C4).
  - **Required evidence:** Provide the authoritative source record or explicitly
    disposition the outstanding authorization in a dated successor record.
  - **If unresolved:** U-5 remains open. **No corrections are authorized by this
    decision-sheet draft.**
- **Where:** Phase A audit records, referenced from the 20-Oct handoff §C L91.
- **Why it remains pending:** The source record has not been supplied.
- **Why it matters:** Correcting an audit record without authorisation destroys the
  audit's evidential value.
- **How we will solve it:** Obtain D-CE-26-06.
- **Dependencies and approvals:** **Genuine approval gate.**
- **Acceptance criteria:** Source record supplied, or the authorization explicitly
  declined in a dated record.
- **Required verification:** The dated record.
- **Completion evidence:** The record itself.
- **Can work start now?:** `NO`.
- **Next action:** Ask the record owner for the Phase A source document.

---

### EW-19 — Build, packaging and CI evidence

- **Status:** `CLOSED WITH EVIDENCE` for packaging scope; `NOT TESTED` for CI.
- **Priority:** Medium.
- **What is pending:** CI has never run. Packaging is frozen and must stay frozen.
- **Where:** `.github/workflows/`.
- **Current evidence — verified this session:**
  - `apps/desktop/src-tauri/tauri.conf.json:29` — `"targets": ["nsis"]`. **NSIS only;
    no MSI or WiX target.** Packaging freeze intact.
  - `windows-engineering-build.yml:30-33` — triggers on
    `push: branches: [phase2-correct, feature/p2-protocol-completion]` plus
    `workflow_dispatch`. **Neither branch exists in this repository.**
  - `deploy-admin-cyvoriq.yml`, `deploy-api-preview.yml`,
    `deploy-www-cyvoriq.yml` — `workflow_dispatch` only.
  - `release-windows-installer.yml` — its own header states **"STATUS: DRAFT (E10) —
    NOT WIRED TO PRODUCTION. NEVER RUNS ON PUSH."**
  - **No `pull_request` trigger exists in any of the five workflows.**
  - GitHub status API returned `total_count: 0`.
- **Why no CI status exists:** Not because tests failed — because **no workflow was
  ever capable of running**. Zero statuses is the configured outcome.
- **Why it matters:** Without CI there is no automated regression gate, and local
  results can drift from reality unnoticed.
- **How we will solve it:** Obtain D-CE-26-08 to define an authorised CI path, then
  add a `pull_request` trigger.
- **Dependencies and approvals:** D-CE-26-08 (approval gate). **Do not edit workflow
  YAML or dispatch CI** — frozen.
- **Acceptance criteria:** A workflow runs on pull requests and reports a status.
- **Required verification:** A real Actions run with a recorded status.
- **Completion evidence:** The run URL and status.
- **Can work start now?:** `NO` — YAML edits are frozen pending the decision.
- **Next action:** Prepare the proposed CI trigger change for D-CE-26-08, as a
  proposal only.

---

### EW-20 — Physical-device and multi-device validation

- **Status:** `NOT TESTED` — 0 of 4 ports.
- **Priority:** Critical.
- **What is pending:** All of it.
- **Where:** `C:\Users\User\Desktop\CYVRA-Four-Port-Baseline-Test-2026-10-20.txt`.
- **Current evidence:** Every row remains **PENDING**. The baseline document states at
  L58 that *"no row may be read as a pass"*.
- **Also pending:** Multi-device isolation and the intended 1–50 device capacity have
  **never been tested**. **No claim about multi-device or 50-device behaviour is
  permitted.**
- **Why it remains pending:** No hardware session has been run since the baseline was
  created.
- **Why it matters:** This is the only evidence class that can move the product
  toward release.
- **How we will solve it:** Follow the phased plan in Section 7 — one device first,
  then multi-device.
- **Dependencies and approvals:** Hardware access. Sanitisation steps additionally
  require U-5 and a qualified entitlement.
- **Acceptance criteria:** Every baseline row carries a real result; zero rows remain
  PENDING.
- **Required verification:** Physical-device runs with retained raw output.
- **Completion evidence:** The completed baseline file.
- **Can work start now?:** `NO` — requires hardware.
- **Next action:** Convert the baseline file into an executable test procedure with
  explicit pass/fail criteria per row.

---

### EW-21 — Desktop UI integration

- **Status:** `NOT REVERIFIED`.
- **Priority:** Medium.
- **What is pending:** Whether the connect/scan workflow, error states, per-device
  report download, device counts, capability-limitation display, progress,
  cancellation and retry are implemented.
- **Where:** `apps/desktop/src/` (Tauri + TypeScript frontend);
  `apps/desktop/src-tauri/src/commands.rs`, `host_process.rs`.
- **Current evidence:** Structure verified (Tauri; ledger screens with tests exist,
  e.g. `apps/desktop/src/ledger/LedgerScreen.test.tsx`). **Individual workflow states
  were not inspected in this session** and are therefore `NOT REVERIFIED`.
- **Why it remains pending:** Not inspected.
- **Why it matters:** A correct engine behind an unclear UI still produces operator
  error — dangerous in a product that erases devices.
- **How we will solve it:** Walk each workflow state against the requirements and
  record implemented / missing.
- **Dependencies and approvals:** None.
- **Acceptance criteria:** Every state enumerated with evidence.
- **Required verification:** UI walkthrough against the spec.
- **Completion evidence:** The walkthrough record.
- **Can work start now?:** `YES`.
- **Next action:** Enumerate the UI states that exist versus those the requirements
  demand.

---

### EW-22 — Documentation and identifier hygiene

- **Status:** `OPEN`.
- **Priority:** Low.
- **What is pending:** Stale line citations and mismatched file extensions in
  governing documents.
- **Where:** various.
- **Current evidence — two confirmed this session:**
  - The 22-Oct handoff initially cited the handshake matrix with a `.txt` extension;
    the real file is `docs/CYVRA_FINAL_PLAN_VS_ACTUAL_HANDSHAKE_MATRIX_2026-10-12.md`.
  - C-6's stale line citation (see EW-16).
- **Why it matters:** A stale citation in a governing record silently erodes trust in
  every other citation in it.
- **How we will solve it:** A citation-verification pass across the governing
  documents.
- **Dependencies and approvals:** None, but do not rewrite history — correct forward.
- **Acceptance criteria:** Every cited path and line resolves.
- **Required verification:** Automated path-and-line check.
- **Completion evidence:** The check output.
- **Can work start now?:** `YES`.
- **Next action:** Write the automated citation checker.

---

## Section 4. Mandatory technical areas — coverage confirmation

| Area | Covered by | Verified this session? |
|---|---|---|
| A. Device identity and lifecycle | EW-01 | YES |
| B. Report ownership and evidence integrity | EW-02, EW-12 | YES (EW-02), partly |
| C. Failed scan and finalisation | EW-04, EW-05 | YES (structure), scenario not run |
| D. Patch-state authenticity | EW-06 | YES |
| E. Capability policy | EW-07 | YES — counts confirmed |
| F. Device transports and integrations | EW-08, EW-09, EW-10 | YES — real vs seam distinguished |
| G. Evidence collection and reports | EW-11, EW-12, EW-13 | PARTLY |
| H. Sanitisation safety and correctness | EW-14 | YES (gates), execution not run |
| I. Entitlement, backend, administration | EW-15, EW-16 | YES — C-1 investigated |
| J. User interface and desktop | EW-21 | NO — `NOT REVERIFIED` |
| K. Build, packaging, release readiness | EW-19 | YES |
| L. Physical-device and multi-device | EW-20 | YES (status), no runs |
| M. Governance and evidence reconciliation | EW-16, EW-17, EW-18 | YES |
| N. Other gaps | EW-03, EW-22 | YES |

**Documents named in the task that were not found at the stated path:**

- The competing defect register lives at `Desktop\Defect Register.txt` — **outside the
  repository**. Not inspected; recorded as such, not substituted.
- No document named `CYVRA_MOBILE_PENDING_ENGINEERING_WORK_PLAN_2026-10-22.md`
  existed before this one.

**Findings that could not be verified (labelled `NOT REVERIFIED`):** EW-12
(provenance), EW-13 (A-10), EW-21 (UI). These come from earlier audit documents and
were not re-confirmed against source in this session.

---

## Section 5. Work that can safely start now

None of the following requires a decision, a key, a device, or a workflow edit.

1. **Five-gap P2B disposition (EW-15).** Diff `P2B-SERVER-GAPS.md` against current
   `services/api`. *Benefit:* resolves the single largest evidence conflict.
   *Boundary:* read-only; produces a table, not code.
2. **Lifecycle test harness (EW-01).** Write the five lifecycle test cases as
   failing tests. *Benefit:* makes D-1 executable and visible. *Boundary:* do not
   implement an identity architecture before D-CE-26-01.
3. **Five-point redirection test (EW-02).** *Benefit:* proves the safety guard at
   every call site. *Boundary:* unit/integration only.
4. **Fail-then-succeed scan scenario (EW-04).** *Benefit:* closes the D-4 evidence
   gap. *Boundary:* fakes only.
5. **Five capability-entry loader tests (EW-07).** Supported, provisional,
   unsupported, malformed, unknown. *Benefit:* pins the fail-closed behaviour.
6. **Report field audit (EW-12).** Enumerate every field and its missing-evidence
   behaviour. *Benefit:* finds silent-default defects. *Boundary:* analysis only.
7. **A-10 requirement transcription (EW-13).** Write down exactly what it requires.
   *Benefit:* makes the gap measurable.
8. **UI state inventory (EW-21).** Enumerate implemented versus required states.
9. **Citation checker (EW-22).** Automated path-and-line verification.
10. **Hardware test procedures (EW-08…EW-11, EW-20).** Draft the procedures now so a
    hardware session is spent testing rather than planning. *Boundary:* planning
    only; no device operation.
11. **"Attempted" versus "verified wiped" report split (EW-14).** Model-level change
    that makes it structurally impossible to claim an erasure that was only
    attempted. *Boundary:* no execution, no entitlement change.

---

## Section 6. Work blocked by decisions or dependencies

All outcomes below are **PENDING**. A recommendation is not an authorisation.

| Decision | Affects | Why it must wait | Who resolves | Evidence needed to unblock | Safe parallel work |
|---|---|---|---|---|---|
| **D-CE-26-01** | EW-01 | Identity architecture choice determines the fix | Chief Engineer | Dated ruling naming the authoritative identity | Lifecycle test harness |
| **D-CE-26-02** | EW-06 | Authenticity architecture must precede implementation | Chief Engineer | Dated architecture ruling | Design comparison document |
| **D-CE-26-03** | EW-02 | Guard design has no approval record | Chief Engineer | Dated ruling against the evidence | Redirection integration test |
| **D-CE-26-04** | EW-05, EW-11 | Intended finalisation behaviour undefined | Chief Engineer | Dated ruling plus test evidence | Behaviour baseline documentation |
| **D-CE-26-05** | EW-17, EW-16 | Two registers disagree | Chief Engineer | Dated selection of register of record | Side-by-side comparison |
| **D-CE-26-06** | EW-18 | Phase A source record not supplied | Chief Engineer | Source record **or** explicit dated disposition | None |
| **D-CE-26-07** | EW-07 | 15 `[P]` rows unratified | Chief Engineer | Per-row ratification with evidence | Five loader tests |
| **D-CE-26-08** | EW-19 | No authorised CI path | Chief Engineer | Approved trigger and evidence policy | Proposed YAML (as a proposal) |
| **SO-1** | EW-06 | No production key exists | Security Owner | Key issued **or declined** through custody | Design evaluation |
| **SO-2** | EW-06 | No rotation/retirement lifecycle | Security Owner | Documented lifecycle and approval process | Design evaluation |
| **SO-3** | EW-14 | Offline policy undefined | Security Owner | Defined permitted offline behaviour | Report "attempted" vs "wiped" split |
| **SO-4** | EW-06 | Sequence authority undefined | Security Owner | Authoritative source and anti-replay rules | Design evaluation |
| **U-5** | EW-14 | No authorisation to correct Phase A | Record owner | Source record or explicit disposition | None |
| **Hardware access** | EW-08…EW-11, EW-20 | No device session | Project owner | Completed baseline runs | All test-procedure drafting |

**Approved U-5 wording (source-aligned, per the corrected handoff):**

> **Decision required:** Determine and record the authorization to correct the Phase
> A audit records (corrections C1/C3/C4).
>
> **Required evidence:** Provide the authoritative source record or explicitly
> disposition the outstanding authorization in a dated successor record.
>
> **If unresolved:** U-5 remains open. No corrections are authorized by this
> decision-sheet draft.

`D-CE-26-*` and `SO-*` are **request identifiers, not approvals**. The `D-CE-26-*`
prefix was introduced specifically to avoid collision with the already-recorded
`CE-1`…`CE-5` rulings in `CYVRA_GOVERNANCE_LEDGER.md` (L901, L932, L956, L977,
L1440–L1503), which are retained untouched as historical cross-references.

---

## Section 7. Prioritised execution roadmap

### Phase 1 — Reconcile and establish reliable baseline evidence

- **Entry:** none.
- **Work:** EW-15 (P2B five-gap disposition), EW-16 (C-2…C-6 analysis), EW-17
  preparation, EW-22 (citation checker).
- **Dependencies:** none.
- **Exit:** every conflict has a prepared disposition; every citation resolves.
- **Evidence retained:** the disposition tables.

### Phase 2 — Resolve immediate correctness and evidence-integrity defects

- **Entry:** Phase 1 analysis complete.
- **Work:** EW-03 (`CYVRA-CERT-`), EW-04 (failed-scan scenario), EW-12 (report field
  audit), EW-13 (A-10), EW-14's "attempted vs verified" model split.
- **Dependencies:** none.
- **Exit:** no report field silently defaults; failed-scan state proven cleared.
- **Evidence retained:** test outputs.

### Phase 3 — Complete approved security and identity architecture decisions

- **Entry:** decision-makers available.
- **Work:** obtain D-CE-26-01, -02, -03, -04, -05, -06, -07, -08 and SO-1…SO-4.
- **Dependencies:** the authorised decision-makers.
- **Exit:** every decision dated and recorded.
- **Evidence retained:** the decision records.
- **Note:** Phases 1, 2 and 5's planning work **do not wait for this phase**.

### Phase 4 — Complete the authorised implementations

- **Entry:** Phase 3 decisions recorded.
- **Work:** EW-01 (lifecycle repair), EW-06 (key wiring and store integration),
  EW-17/EW-16 (register reconciliation).
- **Dependencies:** the corresponding Phase 3 decisions.
- **Exit:** D-1 fixed and lifecycle tests pass; D-5 chain wired and refusing
  ungoverned patches.
- **Evidence retained:** test outputs plus key-custody record.

### Phase 5 — Integrate real device transports and backend dependencies

- **Entry:** Phase 4 complete for identity.
- **Work:** EW-08, EW-09, EW-10 — hardware runs of USB/PnP, WPD/MTP and ADB.
- **Dependencies:** hardware access, device consent.
- **Exit:** each transport proven against a real device, locked and unlocked cases
  distinguished.
- **Evidence retained:** raw captured output per transport.

### Phase 6 — Verify reports and UI end to end

- **Entry:** Phase 5 transports proven.
- **Work:** EW-11, EW-12, EW-21.
- **Dependencies:** hardware.
- **Exit:** a real device scanned end to end; a correct report downloaded; UI states
  enumerated and correct.
- **Evidence retained:** the downloaded report.

### Phase 7 — Physical-device and multi-device validation

- **Entry:** single-device end-to-end proven.
- **Work:** EW-20 — full four-port baseline, then multi-device isolation, then the
  1–50 capacity range.
- **Dependencies:** hardware; U-5 plus qualified entitlement for any erasure step.
- **Exit:** zero PENDING rows; multi-device isolation proven.
- **Evidence retained:** the completed baseline.

### Phase 8 — Release-readiness assessment

- **Entry:** Phases 1–7 complete.
- **Work:** assessment against the release criteria.
- **Dependencies:** all of the above.
- **Exit:** a documented readiness verdict. **This plan does not assert that the exit
  will be "ready".**
- **Evidence retained:** the assessment.

---

## Section 8. Definition of done

A task may carry a label **only** when the stated condition holds.

| Label | Required condition |
|---|---|
| `CLOSED WITH EVIDENCE` | Work complete **and** the acceptance criteria demonstrated **and** the completion evidence retained. A report existing is not sufficient. |
| `IMPLEMENTED — TESTS PENDING` | Code exists and compiles, but the tests that would prove it have not been written or run. |
| `TESTED — HARDWARE VALIDATION PENDING` | Unit/integration tests pass, but no physical device has exercised it. |
| `DECISION REQUIRED` | Work is specified but blocked on a named decision-maker's ruling. |
| `BLOCKED BY DEPENDENCY` | Blocked on a key, a service, a hardware session, or another task — not a judgement call. |
| `NOT TESTED` | No test of any kind has been executed. |
| `DEFERRED` | Deliberately postponed, with the reason recorded. |

**Explicitly insufficient for closure:** code compiles; a unit test passes; a source
comment asserts behaviour; a developer believes it works; a document claims it was
applied.

---

## Section 9. Immediate next actions — the first ten

| # | Action | Why now | Area | Dependencies | Verification | Authorised now? |
|---|---|---|---|---|---|---|
| 1 | Run the five-gap P2B disposition | Largest unresolved evidence conflict; fully read-only | `services/api` vs `docs/P2B-SERVER-GAPS.md` | none | A disposition table, one row per gap | **YES** |
| 2 | Prepare the C-2…C-6 disposition analysis | Feeds U-4; ungated analysis | governance ledger, defect register | none | Analysis document | **YES** |
| 3 | Write the five lifecycle test cases as failing tests | Makes D-1 executable and visible before any decision | `WorkstationSessionOrchestrator.kt` | none | Tests fail against current code, for the right reason | **YES** |
| 4 | Write the five-point `SERIAL_MISMATCH` redirection test | Proves the product's most important safety guard | `HostProtocolDispatcher.kt` | none | Test passes at all five sites | **YES** |
| 5 | Write the fail-then-succeed scan scenario test | Closes the D-4 evidence gap | `runScanResponse` | none | Test passes | **YES** |
| 6 | Audit every report field's missing-evidence behaviour | Finds silent-default defects before hardware time is spent | report engine | none | A field-by-field table | **YES** |
| 7 | Write the five capability-entry loader tests | Pins the fail-closed provisional behaviour | `CapabilityMatrixLoader.kt` | none | Five tests pass | **YES** |
| 8 | Determine whether `CYVRA-CERT-` reaches a customer | Resolves C-2 without guessing | orchestrator, report engine | none | A yes/no with evidence | **YES** |
| 9 | Enumerate UI states implemented versus required | Ungated; identifies UI work before hardware | `apps/desktop/src/` | none | A state inventory | **YES** |
| 10 | Draft the four-port hardware test procedures | Converts future hardware time into testing, not planning | baseline file | hardware for *execution* only | Procedures with explicit pass/fail per row | **YES** (drafting only) |

**All ten are authorised to begin immediately.** None requires a decision, a key, a
device, an entitlement, or a workflow edit. None of them may be reported as
release-validation.

---

## Closing statement

This document records the current state of outstanding engineering work as evidence
supports it. It closes nothing, approves nothing, and grants nothing.

CYVRA Mobile is **NOT RELEASE-READY**. No capability in this repository is
`RELEASE-VALIDATED`. The four-port baseline is 0 of 4. The end-to-end hardware scan
has never been run. Multi-device and 50-device behaviour is untested and no claim
about them is permitted. The patch-trust anchors remain empty and **no key may be
created or inserted**. Sanitisation must not be executed.

Every decision identifier in this document — `D-CE-26-01` through `D-CE-26-08`,
`SO-1` through `SO-4`, `U-1` through `U-6` — remains **PENDING**.

END OF DRAFT ENGINEERING WORK INVENTORY, 22 OCTOBER 2026

---

## Amendment - 23 Oct 2026 - work-plan variant reconciliation (owner-approved 23 Oct 2026 as planning identifiers only; creates no governance ID, approval, or ruling)

### A. Source-variant registry (reference rule: variant + immutable hash)

Verified at execution time, 23 October 2026:

- **V-BRANCH (canonical inventory):** this file; pre-amendment git blob
  `f42ca591ebee2d662b3eb1bb5768e656105f506f`, SHA-256 `2D0CAE2F238FAFEB...`.
- **V-MAIN:** `origin/main` git blob
  `848f86277a636cee56d61bd6708a9b62d79f3c27` (327 lines, added to main by commit
  `4e7224e625d208d21441140f0114451fdb0035ac`), preserved verbatim as
  `docs/archive/CYVRA_MOBILE_PENDING_ENGINEERING_WORK_PLAN_2026-10-22_VMAIN_848f862.md`
  (archive re-hashed to the identical git blob `848f862...` - byte-for-byte verified).
- **V-DOWNLOADS (ENG-b):** ENG review prepared against head `9c7697d`, 707 lines,
  SHA-256 `39D3BB3B062AF9F2004ECD739386AF17BF7BB67ECEDD32E1C088365331C99558`,
  git blob `cda7336b88eb27e083a1f756563304ada04a2ecd`, preserved verbatim as
  `docs/archive/CYVRA_MOBILE_PENDING_ENGINEERING_WORK_PLAN_2026-10-22_ENGB_39D3BB.md`
  (archive SHA-256 identical to source - byte-for-byte verified).

No variant is deleted, renumbered or overwritten. References to any `ENG-xx` item
must state `[V-MAIN@848f862]` or `[ENG-b@39D3BB]`.

### B. Identifier-collision warnings (standing text)

1. `ENG-01..ENG-28` denote **different topics** in V-MAIN and ENG-b (17 of 28
   positions diverge, including ENG-08 and ENG-24). Never resolve an ENG
   reference without its variant qualifier.
2. `D-CE-26-02`, `-03`, `-04`, `-07` and `-08` carry **different meanings** in
   V-MAIN than in V-BRANCH/ENG-b (the governance ledger follows the
   V-BRANCH/ENG-b sense). Any formal ruling quoting a `D-CE-26-*` ID must state
   the variant + hash of the definition being ruled on.

### C. Preserved unique requirements (new planning items; owner-approved identifiers; none duplicates existing EW coverage)

- **EW-23** Desktop workflow, help-text and gate-behaviour consistency (A1/A3/A4;
  sources: V-MAIN ENG-08 + ENG-b ENG-13, verbatim "help says five steps /
  source defines six steps").
- **EW-24** Report deliverables: destination, filename, manifest/index and label
  truthfulness (A2/A7/A11; sources: V-MAIN ENG-09 + ENG-b ENG-11 and ENG-25).
- **EW-25** Operator-identity control placement and attribution truthfulness
  (A1/A8; sources: V-MAIN ENG-11 + ENG-b ENG-12; defect A8).
- **EW-26** Release logging and privacy-safe diagnosability (A5/B3; sources:
  V-MAIN ENG-12 + ENG-b ENG-15).
- **EW-27** Desktop/root typecheck coverage and named small defects (A6;
  sources: V-MAIN ENG-13 + ENG-b ENG-16; note: `apps/desktop` `build` already
  runs `tsc -b`, so remaining scope is the root/workspace command and the
  triage of `hostVersion=0.0.0`, the duplicate React-key warning and the
  `retention-days` upload-step text).
- **EW-28** Ordinary-user-writable state root and installed-layout proof
  (B1/B2/B3; sources: ENG-b ENG-19 + defect register B1 root cause).
- **EW-29** Project-wide security/privacy/unsupported-claim threat review
  (source: ENG-b ENG-28; references holds H1-H8; complements, does not
  duplicate, EW-21/EW-22).

### D. Structural elements retained by reference

V-MAIN's decision/dependency register, required test/evidence matrix, stop
conditions/protected boundaries and per-item closure format
(`..._VMAIN_848f862.md` sections 4, 7, 8, 9), and ENG-b's "Evidence limits and
repository discrepancies" section (`..._ENGB_39D3BB.md` section 9), remain
binding references for this inventory until superseded by an explicit dated
amendment. V-MAIN's protected-path rule (`apps/web/src/api.ts`) is retained.

### E. Non-closure and pending-status rule

No item is closed by appearing in any variant, amendment or commit message.
`D-CE-26-01` through `D-CE-26-08`, `SO-1..SO-4`, SEC-03/U-2(a), CE-4/O5 and the
EW-02 formal status update remain exactly as pending as the governance ledger
records them; this amendment changes none of them.

### F. Stale-evidence register (preserved as history, not current proof)

- V-MAIN's "117 passed" six-suite figure is superseded by the 23-Oct local runs
  (host 405 completed / 1 failed = the intentional D-1 contract marker; desktop
  79/79; `tsc -b` clean). Local evidence only - not CI, hardware or release evidence.
- ENG-b's `paymentStatusesFor` vs current `paymentsFor` conflict remains open (C-1).
