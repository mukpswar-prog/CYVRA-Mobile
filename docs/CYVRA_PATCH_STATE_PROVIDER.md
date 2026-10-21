# CYVRA Mobile — Patch-State Provider: Implemented Scope and Contract Gaps

Status: **engineering record; no contract amendment is in force until the Chief Engineer
ratifies one.** Nothing below changes the wire protocol, the report schema, or any
gate. It records what was implemented, and precisely which governed inputs are still
missing so that D-5 cannot be closed by inference.

Companion to `docs/CYVRA_CAPABILITY_PATCH_SCHEMA.md` (the contract) and
`docs/CORE_ENGINE_SIGNED_PATCH_VERIFIER.md` (engine-side design).

---

## 1. What is implemented

### 1.1 Production call chain

```
HostMain.main
  └─ HostProtocolDispatcher(patchStateProvider = FileBasedPatchStateProvider::establish)
       └─ RUN_SCAN
            ├─ orchestrator.executeDiagnostic(...)       → the completed scan
            ├─ probeCapture(serial)                      → real probe results, once
            └─ patchStateProvider(deviceProfileFor(descriptor))
                 ├─ gate 1  trust anchors        (schema §3)
                 ├─ gate 2  installation root    (-Dcyvra.install)
                 ├─ gate 3  corpus directory     <install>/patches
                 ├─ gate 4  corpus is non-empty  (absence ≠ NO-PATCHES)
                 ├─ gate 5  PatchVerifier.verify (schema §6, ordered, fail-closed)
                 │          └─ step 8 resolves matrix_rows[] against MatrixDomainRow.rowId
                 ├─ gate 6  applied-state record (schema §6.11)
                 └─ gate 7  record reconciles with the verified corpus
            └─ ScanEvidencePacket(sessionUuid, probeResults, patchState)   [or null]
       └─ FINALISE_REPORT
            └─ refuses FINALISE_INPUTS_UNAVAILABLE when the packet is absent,
               naming the gate that refused, before any artifact is written
```

### 1.2 Trust-anchor configuration and key custody

`cyvra.mobile.host.engine.PatchTrustAnchors.ALL` is the single, build-time,
no-network-fetch point of configuration required by schema §3. It is **empty**, and
`FileBasedPatchStateProviderTest.productionTrustAnchorRegistryIsEmpiricallyEmpty` pins
that emptiness.

**Custody decision (schema §9.1): APPROVED.** The Chief Engineer has named **the
security owner** as the Ed25519 private-key custodian. That resolves *who* holds the
key. It does **not** supply a key:

- no key pair has been issued by the custodian, therefore
- no public key and no `key_id` exist, therefore
- `PatchTrustAnchors.ALL` stays empty and every production finalisation still refuses.

**Pending provisioning step.** The security owner generates the Ed25519 key pair outside
this repository, and delivers *only* the public key and its `key_id` to be placed in the
map literal shown in `PatchTrustAnchors`'s KDoc. The private key must never enter this
repository, a patch file, telemetry, or a report (schema §3).

**Pending key-lifecycle policy.** Rotation is by signed rollover patch (schema §3);
retired keys are retained for verifying historical reports with
`trustedForVerifyOnly = true` and cannot authorise a new patch. The retirement cadence
and the approval ledger for `key_id`s are not yet written down and need the security
owner's ruling.

### 1.3 Applied-state persistence (implemented, **not wired**)

`cyvra.mobile.host.engine.PatchStateStore` implements the persistence half of the
lifecycle. It is deliberately **not** wired into production — see §3.1 and §3.2.

- Atomic write: sibling `.tmp`, then `ATOMIC_MOVE`.
- Single writer: exclusive lock on a **dedicated** `applied-state.lock`. The lock cannot
  be the record itself, because Windows refuses to rename over an open handle — locking
  the record makes the atomic replace fail on every call.
- Interrupted-write recovery: an orphaned `.tmp` is cleared and never read as state; if
  it cannot be cleared, the store refuses rather than guessing which record is live.
- Staleness: a strictly monotonic `sequence` per state root.
- Consistency: hash/mode/rollback-reason invariants validated on read *and* before write.
- Provenance (contract §6 step 11): `patch_id`, payload `sha256`, `key_id`, envelope
  `schema_version`, and the matched device scope.
- Rollback: entries are stamped, never deleted; mode and reason become authoritative.

Two injectable seams, both refusing by default in production:

| Seam | Production implementation | Why it refuses |
|---|---|---|
| `AppliedStateAuthenticator` (read) | `UngovernedAppliedStateAuthenticator` | No governed binding for a local record |
| `PatchApplicationAuthoriser` (write) | `NoGovernedPatchApplicationAuthoriser` | No patch-application step exists |

---

## 2. Fail-closed posture today

With an empty anchor registry, no applied-state record format in force, and both store
seams refusing, a production `FINALISE_REPORT` after a real scan **always refuses** with
`FINALISE_INPUTS_UNAVAILABLE`. That is the intended behaviour, not a defect.

| Situation | Reported as |
|---|---|
| No approved trust anchor | refusal (`NO_APPROVED_TRUST_ANCHOR`) |
| Corpus directory absent | refusal (`PATCH_CORPUS_MISSING`) |
| Corpus present but empty | refusal (`PATCH_CORPUS_EMPTY`) — **not** `NO-PATCHES` |
| Any envelope fails verification | refusal (`PATCH_REJECTED_<reason>`) |
| `matrix_rows[]` unresolvable | refusal (`PATCH_ROW_UNKNOWN`) |
| No applied-state record readable | refusal (source's reason) |
| Applied record not corroborated by the corpus | refusal (`APPLIED_PATCH_NOT_IN_VERIFIED_CORPUS`) |
| Applied record internally inconsistent | refusal (`APPLIED_STATE_INCONSISTENT`) |
| Applied record unauthenticated | refusal (`APPLIED_STATE_UNAUTHENTICATED`) |
| Transition with no application step behind it | refusal (`PATCH_APPLICATION_BOUNDARY_MISSING`) |
| A record positively states an empty applied set | `NO-PATCHES` |

The last row is the only path to `NO-PATCHES`, and it requires a positively-read
persisted record — never an absent one.

---

## 3. Contract gaps

### 3.1 Gap — no production patch-application or rollback lifecycle (ROOT CAUSE)

Schema §6 step 10 is *"stage full set, re-validate, swap atomically"* and step 11 is
*"record `patch_id`, `key_id`, payload sha256 → state and every report"*. **Neither has a
target in this engine**, for three independently verifiable reasons:

1. **No procedure registry.** A patch's `procedure_overrides[]` name a `procedure_id` and
   an `action`, but no component resolves a `procedure_id` to executable behaviour. The
   string `procedure_id` is read only inside `PatchVerifier.kt` — for schema validation
   and the authorisation-gate keyword scan. `CapabilityMatrixLoader` even supplies
   `Plane.wireName` so `plane` can be matched, but the verb side has no registry to match
   against.
2. **`VerifiedPatch` never leaves `PatchVerifier.kt`.** Its only other reference in the
   tree is the provider's type usage for reconciliation.
3. Consequently there is **no set to swap** and **no event to record**.

`PatchSetState.with(...)` and `PatchSetState.rollback(...)` have **zero production
callers**; both are exercised only by their own tests.

**Named missing boundary: the patch-application step** — the component that takes a
`VerifiedPatch`, executes its overrides against real procedures, and then authorises the
store to record the fact. Building it is a separate, governed task. Until it exists,
`NoGovernedPatchApplicationAuthoriser` refuses every transition, so no application can be
recorded that did not happen. The ability to *claim* and the ability to *make* are
released together.

### 3.2 Gap — a local applied-state record cannot authenticate itself

Contract §6 step 11 requires the applied set to be written to engine state, but no
on-disk format, writer, location, or authenticity rule is governed. Two structural
problems follow:

- **No format** is specified, so none may be parsed as contract. The format in
  `AppliedStateRecord` is a *proposal* pending §4.1.
- **No binding makes it authoritative.** `cyvra.home` is writable by the signed-in
  operator, and the Ed25519 private key is held off-device by the security owner. A
  signature from the patch key can authorise **which** set may be applied; it can never
  attest **that** a set was applied, because application is a local runtime fact that
  happens without the custodian present.

Options that would close this, none available today: a hardware-rooted attestation
(TPM/DPAPI), or an uplink that countersigns the applied set. `UngovernedAppliedStateAuthenticator`
refuses until one is governed.

### 3.3 Gap RESOLVED — `matrix_rows[]` vocabulary

**Confirmed authoritative identifier: the bare `ITEM ID`, e.g. `CON-001`.**

| Source | What it establishes |
|---|---|
| `CYVRA_CAPABILITY_PATCH_SCHEMA.md` §5 | "`matrix_rows[]` … every id MUST resolve in the signed capability matrix. Unknown id → reject." |
| `CYVRA_CAPABILITY_MATRIX_V1.md` §4 (lines 82-85) | "`ITEM ID` values marked **[S]** are the ratified examples … Values marked **[P]** are provisional seeds" — the marker *annotates* the id. |
| Same document, rows 91 vs 94 | `SEC-001 **[P]**` keeps `SEC-001` when ratified. Identity is stable; status is not. |
| `CapabilityMatrixLoader.kt:394-395` | `itemId` strips `**` but keeps the marker; `provisional` is parsed out **separately**. |
| `PatchVerifier.kt` step 8 (line 415) | Exact string membership: `rows.filterNot { it in known }`. |

**The inconsistency was in the provider, not the contract.** It passed the marked
`itemId`, which would reject a patch at the exact moment its row gained authority — the
opposite of the intent.

**Smallest correction applied:**
- Added `MatrixDomainRow.rowId` — a computed property returning the bare id.
- The provider now resolves against `rowId`. Ids are taken verbatim; nothing is
  normalised, case-folded or trimmed of markers, so `PATCH_ROW_UNKNOWN` is not weakened.
- `itemId` is **unchanged**: it feeds the report's `itemId` field
  (`ReportGenerator.kt:141`) and the separate `provisional` flag, neither of which moved.
- No existing test assertion or report field changed.

**Backward compatibility:** no patch has ever been issued — there is no approved key, so
there is no corpus — so no issued `matrix_rows[]` entry can break.

### 3.4 Still open — provisional-row authority

15 of 22 row ids are `[P]` and, per the matrix §4, "carry no authority yet". A patch
referencing `SEC-001` resolves today (step 8 passes). Whether a `[P]` row should be
*authoritative enough for a patch to depend on* is a policy question for the Chief
Engineer and is **not** enforced either way in code.

---

## 4. Proposed schema amendments (all pending ratification)

Adds text only; no gate is relaxed and no new permissive surface is introduced.

1. **§9.1 — record the custody decision.** The Ed25519 private-key custodian is **the
   security owner** (approved by the Chief Engineer). Add that a public key and `key_id`
   are provisioned into the engine's build-time registry only after the custodian issues
   them, and that the registry stays empty until then.

2. **§6.11 — name the applied-state record.** Specify that the applied set is persisted
   as one canonical JSON document at `<cyvra.home>/patches/applied-state.json`, written
   by a single named writer, atomically via temp-file-then-rename under an exclusive
   lock, carrying a strictly monotonic `sequence`, and that an absent, unreadable or
   unauthenticated document means *state unavailable* — never `NO-PATCHES`. Add that
   `NO-PATCHES` is reportable only from a document that exists and states an empty
   applied set.

3. **§6.11 / §7 — define what makes the record authoritative.** The record must be bound
   to something an operator cannot forge locally: either a hardware-rooted attestation or
   an uplink countersignature. Until one is specified, every local record is refused as
   `APPLIED_STATE_UNAUTHENTICATED`.

4. **§9.3 — settle the row-id spelling.** State that `matrix_rows[]` entries are the
   capability matrix's **bare `ITEM ID`** (`CON-001`), excluding the `[S]`/`[P]`
   ratification marker, and that the marker is status carried separately.

5. **§9 — record the remaining open items**: key issuance by the security owner,
   key-lifecycle/retirement policy, and whether `[P]` rows may carry patch authority.

Nothing in this proposal may be treated as in force until ratified. Until then the store
stays unwired and the provider keeps refusing, exactly as it does now.

---

## 5. What must not be manufactured

Two things, and only two, keep D-5 open. Neither may be synthesised to make the flow
complete:

- **The signing authority.** The custodian is named, but no key exists. No generated,
  test, illustrative or temporary key may enter `PatchTrustAnchors.ALL`, and no private
  key may exist anywhere in the repository, in a patch file, in telemetry, or in a report
  (schema §3).
- **The evidence of which patch set is actually applied.** No default, inferred or
  corpus-derived `PatchSetState` may be presented as an authoritative applied set, and no
  application may be *recorded* that was not *performed*.

A deployment where both are absent is a *correctly refusing* deployment. It is not a
working D-5, and it must not be recorded as one.
