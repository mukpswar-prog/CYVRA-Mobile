# Device Evidence Architecture

**Status:** ACTIVE CONTRACT — P1.5A.4 CONSOLIDATED
**Date:** 2026-09-19
**Product:** CYVRA Mobile
**Audited repository baseline:** `81309e28e32fa638fd7fcaa1bd0ab0a007888748`
**Primary code homes:** `packages/evidence`, `apps/android/core`, `apps/host`, `apps/desktop/src-tauri`, `services/api`, `database`
**Related transport contract:** [`WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md`](./WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md)
**Related WPD contract:** [`architecture/d2-3-wpd-mtp-evidence-contract.md`](./architecture/d2-3-wpd-mtp-evidence-contract.md)

---

## 0. Purpose

This document defines how CYVRA Mobile observes, represents, preserves, compares, synchronizes, and reports device evidence.

It replaces the older evidence architecture assumption that new Windows-native observations should be forced into the original G4/S1/S2 evidence hierarchy.

The contract preserves Evidence V1 as historical/current compatibility while defining the semantic requirements for Evidence V2.

This document answers:

- what counts as evidence,
- which software layer owns an observation,
- how provenance is represented,
- how missing/restricted evidence is represented honestly,
- how USB/WPD/ADB/Android-component evidence coexist,
- how evidence identity and canonical digests work,
- how replay and integrity conflicts are handled,
- how conflicting observations are preserved,
- how local and cloud evidence authority is divided,
- how Report 1 binds to evidence,
- and which privacy/retention rules apply.

---

# 1. Core evidence principle

CYVRA Mobile follows:

> **Observe → preserve provenance → preserve limitations → canonicalize → digest → correlate → report.**

Evidence must never be invented to make a report look complete.

The following are valid outcomes:

```text
AVAILABLE
NOT_AVAILABLE
RESTRICTED
PERMISSION_REQUIRED
UNSUPPORTED
NOT_TESTED
INCONCLUSIVE
ERROR
```

The exact enum depends on whether the object is a field observation or a test result, but the semantic rule is permanent:

> **Unavailable is not failure. Restricted is not failure. Not tested is not pass. Unknown is not false.**

---

# 2. Evidence ownership

## 2.1 Windows Native Layer — Rust / Tauri

The Native Layer owns direct Windows observations:

```text
WINDOWS_USB
WINDOWS_WPD_MTP
```

Examples:

- present Windows USB/PnP device instance,
- WPD device visibility,
- WPD friendly/manufacturer/description metadata,
- future WPD storage metadata,
- future WPD object hierarchy metadata.

The Native Layer must not label these observations as ADB evidence.

---

## 2.2 Kotlin Domain Engine

The Domain Engine owns:

- Android/ADB evidence collection,
- Android capability interpretation,
- evidence normalization/business semantics,
- session workflow,
- report-domain semantics,
- sanitization-domain semantics.

Its evidence must retain the actual collector source.

---

## 2.3 Android Component

The Android component may contribute device-side evidence using:

```text
ANDROID_COMPONENT
```

The component must not overwrite Windows or ADB observations simply because it can provide a more detailed value.

---

## 2.4 Operator

Explicit human observations use:

```text
OPERATOR
```

Human review creates a new evidence/review record.

It must not mutate the original machine observation.

---

## 2.5 System

Derived workflow facts may use:

```text
SYSTEM
```

`SYSTEM` is for computed/system events and must not be used to disguise an unknown physical source.

---

# 3. Evidence V1 — preserved compatibility

The existing `packages/evidence` V1 contract is not deleted.

Its current schema version is:

```text
1.0.0
```

Its historical source vocabulary is:

```text
S1_APPLICATION
S2_STATION
S2_AUTHORIZED_ADB
S3_ENTERPRISE
TECHNICIAN_OBSERVATION
```

Its current evidence result vocabulary includes:

```text
PASS
FAIL
LIMITED
NOT_AVAILABLE
NOT_SUPPORTED
NOT_TESTED
CANCELLED
ERROR
PERMISSION_DENIED
```

Existing V1 evidence records, reports, tests, and database rows remain valid historical records.

Evidence V1 must not be silently reinterpreted as Evidence V2.

---

# 4. Why Evidence V2 is required

The V1 source hierarchy was created before the current Windows-native architecture was established.

It cannot represent the current system cleanly because:

1. `WINDOWS_WPD_MTP` has no native V1 source;
2. Windows physical USB truth is not the same as Android application evidence;
3. ADB is no longer the primary device-connection truth;
4. `S2_STATION` refers to a parked architecture and must not become a dumping ground for WPD evidence;
5. current cloud ingest accepts only `S1_APPLICATION`;
6. the new workstation needs source-specific provenance without false mapping;
7. a global source-precedence ranking is insufficient when independent collectors measure different facts;
8. Report 1 must bind to immutable evidence digests rather than only evidence IDs.

Therefore:

> **Do not map new WPD evidence to `S2_AUTHORIZED_ADB`, `S2_STATION`, or another inaccurate V1 source merely to satisfy the old schema.**

---

# 5. Evidence V2 source vocabulary

The required semantic source vocabulary is:

```text
WINDOWS_USB
WINDOWS_WPD_MTP
ANDROID_ADB
ANDROID_COMPONENT
OPERATOR
SYSTEM
```

Future controlled extensions may add sources only through a schema/version change.

Examples of future extension candidates include an enterprise/OEM collector, but no source is added merely because historical documents named one.

---

# 6. Evidence object types

CYVRA needs to distinguish at least three classes of evidence.

## 6.1 Observation / field evidence

A factual observation such as:

```text
manufacturer = Samsung
battery level = 72
USB device present
MTP storage count = 1
hardware serial = restricted
```

Conceptually:

```text
value
availability/status
source
reason/limitation
collectedAt
method
```

---

## 6.2 Test evidence

A defined verification test such as:

```text
camera test
speaker test
USB communication test
storage check
```

Conceptually:

```text
testId
result
source
collectedAt
method
limitations
payload
```

A test result uses outcome semantics such as:

```text
PASS
FAIL
LIMITED
NOT_AVAILABLE
NOT_SUPPORTED
NOT_TESTED
CANCELLED
ERROR
PERMISSION_DENIED
```

---

## 6.3 Derived/report evidence

A summary, conflict classification, coverage calculation, or report manifest is derived evidence.

Derived evidence must reference the immutable source evidence from which it was produced.

It must not replace the source evidence.

---

# 7. Availability and result are different dimensions

The existing Kotlin model uses field-level `EvidenceStatus`, while the TypeScript V1 model uses test-level `EvidenceResult`.

Evidence V2 must preserve this distinction.

For example:

```text
hardwareSerial:
  availability = RESTRICTED
```

is different from:

```text
serial-validation-test:
  result = NOT_AVAILABLE
```

Do not collapse both into a single ambiguous enum merely to simplify serialization.

---

# 8. Minimum Evidence V2 identity model

Every persisted evidence record must be bound to stable internal identities.

Conceptually:

```text
schemaVersion
evidenceId
deviceLifecycleId
processingSessionId
sessionDeviceRef
source
collectedAt
method
payload/result
limitations
digest
```

Not every field above must be exposed in every UI representation.

The exact JSON Schema is frozen in a separate implementation gate before V2 API deployment.

---

# 9. Identity meanings

## 9.1 `evidenceId`

`evidenceId` identifies one immutable evidence record.

It is not:

- a device identifier,
- a report identifier,
- a processing-session identifier.

---

## 9.2 `processingSessionId`

Identifies one CYVRA processing workflow.

Evidence collected during a processing session must remain attributable to that session.

---

## 9.3 `deviceLifecycleId`

Represents CYVRA's longer-lived service/registry identity for a device lifecycle.

It is not proof of physical identity by itself.

It must not be derived solely from IMEI, serial, MAC address, or Android ID.

---

## 9.4 `sessionDeviceRef`

`sessionDeviceRef` is the preferred processing-time correlation identity.

It is:

- opaque,
- session-scoped,
- produced from legitimate correlation,
- safe to expose across IPC compared with raw Windows identifiers.

It may internally correlate:

```text
Windows USB/PnP identity
WPD identity
ADB identity
Android-component session identity
operator-confirmed device selection
```

It does not require IMEI.

---

# 10. Collection time vs receive time

CYVRA must distinguish:

```text
collectedAt
receivedAt
```

`collectedAt`:

- belongs to the evidence,
- is set when the observation occurs,
- is immutable after collection,
- is included in the canonical evidence content.

`receivedAt`:

- belongs to server synchronization,
- may be later,
- must not overwrite the original observation time,
- is not evidence that the device was observed at receive time.

The current database already distinguishes these concepts; Evidence V2 must retain them.

---

# 11. Immutable evidence rule

After an evidence record has been accepted/frozen:

> **Do not update the record in place.**

A changed observation creates a new evidence record.

Examples:

```text
battery 72% at T1
battery 71% at T2
```

are two observations.

A human correction creates a new review/correction record referencing the original evidence.

It does not rewrite the original machine record.

---

# 12. Canonicalization

Evidence integrity requires deterministic canonical serialization.

The repository already contains a canonical JSON implementation in `packages/evidence`.

Permanent requirements:

- sort object keys deterministically;
- preserve array order unless the schema explicitly defines set semantics;
- omit only fields whose schema semantics define them as absent;
- reject non-finite numbers;
- encode strings/booleans/numbers consistently;
- never hash pretty-printed display JSON as the canonical representation;
- version the canonicalization contract if behavior changes.

---

# 13. Evidence digest

Each immutable evidence record intended for persistence/report binding should have:

```text
algorithm = SHA-256
digest = SHA256(canonical evidence record excluding digest field)
```

The digest provides tamper/integrity evidence.

It does **not** by itself provide:

- signer identity,
- non-repudiation,
- trusted timestamping,
- certificate-chain assurance.

Those require a separate signing/trust architecture if later adopted.

---

# 14. Replay semantics

Evidence synchronization must explicitly distinguish safe replay from integrity conflict.

## 14.1 Same ID + same canonical digest

```text
same evidenceId
same canonical digest
```

Result:

```text
IDEMPOTENT_REPLAY
```

The server may acknowledge the existing record.

It must not duplicate or mutate it.

---

## 14.2 Same ID + different canonical digest

```text
same evidenceId
different canonical digest
```

Result:

```text
INTEGRITY_CONFLICT
```

Required behavior:

- reject the conflicting upload;
- do not silently ignore it;
- do not overwrite the existing row;
- record/audit the conflict according to control-plane policy;
- require investigation if the operation is material.

---

## 14.3 Current implementation gap

The current V1 API uses database `ON CONFLICT DO NOTHING` behavior for evidence IDs.

That is acceptable only as historical V1 behavior.

It is insufficient for Evidence V2 because a conflicting payload can be ignored without proving that the existing record is byte/canonically equivalent.

P2 correction must compare canonical digests.

---

# 15. Batch replay

Evidence batches require equivalent semantics.

Conceptually:

```text
same batchId + same batch manifest digest
    → idempotent replay

same batchId + different batch manifest digest
    → integrity conflict
```

A batch replay flag must never be interpreted as proof that all submitted records matched the prior accepted records unless digest equivalence was actually checked.

---

# 16. Server verification of digest

A client-supplied digest is not trusted merely because it is present.

The receiving implementation should:

1. validate schema;
2. canonicalize the accepted record using the frozen algorithm;
3. recompute the digest;
4. compare with any supplied digest;
5. reject mismatch;
6. compare with the stored digest for replay;
7. only then accept/replay.

This protects against accidental or malicious mismatch.

---

# 17. Collector independence

Evidence is collected through independent collectors.

Permanent behavior:

```text
collector A fails
    !=
entire verification crashes
```

Instead:

```text
collector A → ERROR / limitation
collector B → valid evidence
collector C → valid evidence
```

The resulting report may be `LIMITED` or `PARTIAL` as appropriate.

Do not fabricate collector A's values from collector B merely to fill gaps.

---

# 18. Source-specific evidence rules

## 18.1 `WINDOWS_USB`

May establish:

- present Windows USB device instance,
- connection/reconciliation timing,
- Windows-native topology facts.

Must not establish by itself:

- Android version,
- ADB authorization,
- MTP availability,
- application state,
- sanitization completion.

---

## 18.2 `WINDOWS_WPD_MTP`

May establish, where exposed:

- WPD device visibility,
- device descriptive metadata,
- storage metadata,
- object hierarchy metadata,
- names/types/formats/extensions,
- sizes/timestamps,
- aggregate metadata counts.

Must not establish by itself:

- full filesystem state,
- application execution/history,
- private Android application data,
- whole-device sanitization completion.

---

## 18.3 `ANDROID_ADB`

May establish Android facts legitimately exposed to authorized ADB.

Must preserve:

- command/method provenance,
- device/session binding,
- authorization state,
- restricted/unavailable results.

ADB must not be treated as physical USB truth.

---

## 18.4 `ANDROID_COMPONENT`

May establish facts legitimately available to the application under Android permissions/platform rules.

Permission denial becomes evidence of limitation.

It must not be converted into FAIL.

---

## 18.5 `OPERATOR`

May establish documented physical/manual observations.

Operator evidence must include enough audit context to identify:

- who recorded it,
- when,
- what observation method was used,
- whether it was a review/correction of another record.

---

## 18.6 `SYSTEM`

May establish deterministic system-derived facts such as:

- coverage classification,
- conflict classification,
- transaction state,
- report freeze event.

Derived facts must identify their input records or manifest.

---

# 19. WPD privacy boundary

Default WPD evidence is metadata-first.

Allowed default collection may include:

```text
object name
format/type
extension
size
timestamps
hierarchy
storage metadata
aggregate counts
```

Default verification must not automatically:

```text
open file content streams
copy customer files
upload customer files
preview photos/videos
parse documents/messages
extract private app databases
bypass Android storage/security controls
```

If a future product feature requires content inspection, it needs a separate privacy/consent/evidence contract.

---

# 20. WPD folder/application inference

CYVRA must preserve this rule:

> **Presence of a folder or file name associated with an application is not proof that the application is installed, running, currently used, or owned by the user.**

A WPD metadata observation may be reported as:

```text
folder/object observed
```

It must not be promoted to:

```text
application installed
```

without an appropriate Android-side source.

---

# 21. Restricted identifiers

IMEI, hardware serial, Android ID, MAC address, and similar identifiers have different scopes and availability.

Rules:

- never fabricate;
- never replace one identifier type with another while retaining the original label;
- do not make IMEI the primary device identity;
- distinguish hardware identifier from platform/application identifier;
- retain source and scope;
- report `RESTRICTED` / `NOT_AVAILABLE` when appropriate;
- minimize raw identifier exposure in UI/logs/cloud where not required.

---

# 22. Current Kotlin evidence-model debt

The current Kotlin evidence aggregate remains useful but is not the final cross-source Evidence V2 model.

Examples requiring later correction/normalization include fields that can currently be populated with fallback/default values and marked as available.

Production Evidence V2 must ensure:

> **A fallback presentation value is never represented as an observed fact unless it was actually observed.**

Examples of prohibited final behavior:

```text
unknown model → value "UNKNOWN" + AVAILABLE
unproven secure boot → true + AVAILABLE
unproven external-storage absence → false + AVAILABLE
```

Use explicit limitation/unknown states instead.

This is a P2 implementation correction, not a reason to discard the Kotlin Domain Engine.

---

# 23. Conflict preservation

If two legitimate sources disagree:

```text
preserve both
compare
classify
surface material conflict
```

Do not overwrite one with the other.

Example:

```text
ANDROID_ADB says value A
ANDROID_COMPONENT says value B
```

Both records remain immutable.

A conflict-resolution record may later explain which evidence was used for a report conclusion.

---

# 24. No universal source-precedence ladder in V2

The V1 package currently contains a global source summary ranking.

That historical rule must not become the universal Evidence V2 rule.

Reason:

- Windows USB is authoritative for Windows USB presence;
- WPD is authoritative for WPD observations;
- ADB is authoritative for what the executed Android query returned;
- Android Component is authoritative for the application-side observation it performed;
- none is universally "higher" for every fact.

Evidence V2 should use:

```text
fact/test-specific authority rules
```

rather than:

```text
one global source rank
```

Any automatic conflict resolution must be explicit, deterministic, test-specific, and versioned.

---

# 25. Coverage

Coverage is not device quality.

Preserve:

```text
COMPLETE
LIMITED
PARTIAL
```

or a later versioned equivalent.

Meaning:

- `COMPLETE` means required report evidence is complete under the defined catalog;
- `LIMITED` means required entries exist but legitimate restrictions/limitations affect coverage;
- `PARTIAL` means required tests/evidence are missing or not completed.

It does not mean:

```text
COMPLETE = perfect device
LIMITED = bad device
PARTIAL = failed device
```

---

# 26. Report 1 boundary

Report 1 is:

> **CYVRA Device Verification Report**

Report 1 is not:

- a sanitization certificate;
- proof that wipe was authorized;
- proof that wipe completed;
- ownership proof;
- universal OEM certification;
- a statement that unavailable evidence passed.

---

# 27. Canonical Report 1 manifest

CYVRA must converge on one canonical report manifest.

Target flow:

```text
immutable evidence records
        ↓
fact/test conflict classification
        ↓
coverage calculation
        ↓
canonical Report 1 manifest
        ↓
canonical digest
        ├─ local JSON representation
        ├─ PDF representation
        └─ cloud registry verification/storage
```

The canonical manifest is the report truth.

PDF/web/Markdown are renderings.

---

# 28. Report-to-evidence binding

Evidence V2 Report 1 entries must bind to immutable evidence strongly enough that later substitution can be detected.

At minimum, a manifest entry should bind:

```text
test/fact identity
evidenceId
evidence digest
source
result/status
```

The exact V2 schema is frozen separately.

Referencing only an `evidenceId` without its immutable digest is insufficient for a self-verifiable canonical manifest.

---

# 29. Local vs cloud report authority

The current repository has two report-generation paths:

1. Kotlin `HostReportEngine`;
2. Worker `/reports/freeze` using `packages/evidence`.

They must not remain two independent sources of canonical report truth.

Target ownership:

```text
WORKSTATION
  capture/normalize evidence
  freeze canonical local manifest
  compute canonical digest
        ↓
CLOUD
  validate schema
  validate/recompute digest
  enforce account/entitlement policy
  store/register the same canonical manifest
        ↓
RENDERERS
  JSON / PDF / web
```

The cloud must not silently reconstruct a materially different report from the same session.

---

# 30. Current cloud Report 1 limitation

Current `/reports/freeze`:

- queries evidence rows from Neon;
- rebuilds a V1 manifest server-side;
- uses V1 source vocabulary;
- accepts the current V1 cloud evidence path;
- does not bind manifest entries to evidence digests.

Therefore it remains a valid V1 implementation slice, but it is not the final Evidence V2 canonical-report architecture.

Do not delete it during Phase 1.

Correct it during the appropriate P2/P3 implementation gate after V2 contract freeze.

---

# 31. Current HostReportEngine limitation

The Kotlin `HostReportEngine` currently computes SHA-256 over its own serialized report representation.

Evidence V2 must not allow multiple incompatible "canonical" serialization/digest rules.

Target:

- one canonical serialization contract;
- one canonical report manifest;
- one canonical digest implementation/fixture set across languages.

Pretty JSON/Markdown/PDF output must not define the digest.

---

# 32. Digest test vectors

Before multi-language Evidence V2 implementation is accepted, freeze deterministic test vectors.

For each fixture:

```text
input object
canonical JSON
expected SHA-256
```

The same fixtures must pass in:

- TypeScript,
- Kotlin,
- Rust if Rust emits canonical evidence/report records.

This prevents language-specific serialization drift.

---

# 33. Local evidence authority

The workstation owns the fact that it observed a device state.

A local canonical evidence artifact should remain independently verifiable even if:

- cloud sync is delayed,
- the network is temporarily unavailable,
- the cloud registry is later queried.

Cloud absence must not convert an observed local fact into "not observed."

Commercial/report-finalization policy may still require cloud authorization separately.

---

# 34. Cloud registry authority

The cloud owns:

- authenticated account association,
- entitlement/transaction authority,
- accepted evidence registry,
- report registry,
- audit events,
- server receive times,
- synchronization status.

The cloud does not retroactively change what a collector observed.

If the cloud rejects evidence, preserve local evidence and record the sync rejection separately.

---

# 35. Synchronization state

Evidence synchronization state is not evidence result.

Examples:

```text
LOCAL_ONLY
SYNC_PENDING
SYNCED
SYNC_REJECTED
INTEGRITY_CONFLICT
```

must remain separate from:

```text
PASS
FAIL
NOT_AVAILABLE
ERROR
```

A network failure does not turn device evidence into FAIL.

---

# 36. Evidence retention

Evidence/report retention must be governed separately from authentication/account cleanup.

Current database foreign-key cascades can delete device/evidence/report rows when parent account/lifecycle records are deleted.

That is not the final forensic/commercial retention architecture.

Before production:

- define retention periods;
- define deletion/legal basis;
- separate auth-session cleanup from evidence/report retention;
- preserve auditability where required;
- support deletion/anonymization policy without silently breaking report integrity.

No retention duration is frozen by this document.

---

# 37. Privacy and data minimization

Default evidence collection must follow minimum necessary data.

Do not collect or upload customer content merely because an interface exposes it.

Examples generally out of scope for default verification:

```text
photo content
video content
message bodies
documents
contacts
private application databases
passwords
authentication tokens
```

Metadata can itself be sensitive.

Production policy must define:

- which metadata is persisted;
- which metadata remains local;
- which identifiers are redacted/hashed;
- retention;
- support-log handling.

---

# 38. Evidence logs

Logs are not the canonical evidence store unless explicitly promoted through an evidence collector.

Rules:

- avoid raw customer content;
- avoid secrets;
- avoid unrestricted raw identifiers;
- use `sessionDeviceRef` where possible;
- keep diagnostic/native error detail separate from customer-facing error text;
- do not rely on log order as canonical event ordering without a defined event sequence.

---

# 39. Capability evidence

Capability is evidence-driven.

Preserve:

```text
DECLARED
DETECTED
TESTED
```

as distinct concepts or their V2 equivalent.

Examples:

```text
feature declared
    !=
hardware detected

hardware detected
    !=
function tested

command exists
    !=
method qualified
```

Capability changes create a new snapshot/version.

Do not mutate old capability snapshots.

---

# 40. Evidence catalog versioning

A Report 1 coverage label depends on a defined evidence/test catalog.

Therefore every canonical report must be attributable to:

```text
evidence schema version
catalog version
rule/method version where relevant
```

If the catalog changes, historical Report 1 coverage must not be recomputed silently under the new catalog.

---

# 41. Method provenance

`method` must describe how evidence was obtained sufficiently for interpretation.

Examples:

```text
WINDOWS_SETUPAPI_PRESENT_DEVICE_ENUMERATION
WINDOWS_WPD_DEVICE_MANAGER_ENUMERATION
ADB_GETPROP
ADB_DUMPSYS_BATTERY
ANDROID_PACKAGE_MANAGER
OPERATOR_VISUAL_INSPECTION
```

Exact stable method identifiers are frozen by implementation contracts.

Free-text-only method naming is not sufficient for mature analytics/audit.

---

# 42. Collector version provenance

For evidence whose interpretation may change with collector behavior, preserve collector/method version through one of:

- evidence schema field,
- method-version field,
- report manifest metadata,
- immutable application build/release context.

The final exact representation is part of V2 schema freeze.

---

# 43. Error provenance

A collector error should preserve:

```text
stable error code
source
method
collectedAt
safe diagnostic context
```

The UI may render a user-friendly message.

Do not make raw exception strings the only durable semantics.

---

# 44. Evidence ordering

Evidence ordering must never rely only on database insertion order.

Use explicit:

- collection timestamp,
- sequence/event identity where needed,
- immutable identifiers.

Server receive order may differ from observation order due to offline synchronization.

---

# 45. Evidence and licence consumption

Passive evidence discovery is not a chargeable scan.

Preserve:

```text
USB/WPD preflight
    → free

explicit Device Verification start
    → reserve/start transaction

evidence captured
    → transaction in progress

canonical Report 1 successfully frozen
    → consumption finalization
```

Evidence architecture must expose the report-freeze event needed by the licensing transaction without making evidence validity depend on payment terminology.

---

# 46. Evidence and sanitization

Report 1 captures pre-sanitization verification evidence.

Sanitization creates a separate evidence sequence.

A final sanitization report/certificate must bind:

- pre-sanitization identity/session evidence;
- authorization;
- method capability;
- execution evidence;
- reconnect/post-state evidence;
- limitations;
- final verification conclusion.

Later sanitization must not rewrite the frozen Report 1 evidence manifest.

---

# 47. Post-sanitization evidence

Post-sanitization verification must be multi-signal.

Potential signals include:

```text
USB/PnP rediscovery
WPD/MTP rediscovery
ADB state change
setup/OOBE indicators
account/user-data accessibility checks
method-specific verification
operator confirmation where required
```

No single transport signal is universally sufficient.

---

# 48. AI / grading evidence boundary

Deferred physical-inspection/AI grading remains a separate evidence family.

AI evidence must record:

```text
capture/view identity
image-quality outcome
model version
finding
confidence
processing session/device reference
human-review outcome where applicable
```

AI output does not overwrite device-transport evidence.

A deterministic/versioned grading rule consumes accepted evidence.

The current AI/report implementation is not release proof.

---

# 49. V1 → V2 migration rule

Migration must be additive and explicit.

Do:

```text
keep V1 schema
keep V1 parser/tests
introduce V2 schema/types
introduce V2 ingest path/version negotiation
migrate new desktop evidence producers to V2
keep historical reports readable
```

Do not:

```text
change the meaning of V1 enum strings in place
reinterpret S2_STATION as WPD
rewrite historical V1 evidence rows
silently widen V1 validation
```

---

# 50. V2 API transition

Before production V2 ingest:

1. freeze V2 JSON Schema;
2. freeze source/status/result vocabulary;
3. freeze canonicalization;
4. freeze digest rules;
5. freeze replay/conflict semantics;
6. freeze batch semantics;
7. add API parser/validator;
8. add database fields/migration where required;
9. implement idempotency + integrity conflict tests;
10. support V1 historical read path;
11. update Report 1 manifest;
12. update cloud report registry;
13. update local canonical manifest generation.

Until then, current V1 routes remain V1.

---

# 51. Evidence V2 acceptance tests

At minimum:

```text
A. same record, same ID, same digest → replay accepted
B. same ID, changed payload → integrity conflict
C. changed JSON key order → same canonical digest
D. changed array order where ordered → different digest
E. client digest mismatch → rejected
F. unavailable field remains unavailable, not FAIL
G. restricted identifier remains restricted
H. WPD evidence stays WINDOWS_WPD_MTP
I. ADB unavailable does not invalidate USB/WPD evidence
J. one collector error preserves other collectors
K. source conflict preserves both records
L. report entry binds evidence ID + digest
M. local/cloud canonical manifest digest matches
N. TypeScript/Kotlin/Rust canonical fixtures match where implemented
O. server receive time does not replace collectedAt
P. offline sync does not alter result
Q. same report/session replay does not double-freeze/double-charge
R. historical V1 report remains readable
```

---

# 52. Current implementation findings to carry into P2/P3

The following are known implementation gaps, not Phase-1 code tasks:

1. V1 source vocabulary cannot represent WPD natively.
2. `/evidence/batches` currently accepts only `S1_APPLICATION`.
3. current database conflict handling does not prove same-ID/same-content replay.
4. record digest is stored optionally but not enforced as canonical server-verified integrity.
5. current V1 Report 1 manifest does not bind each entry to its evidence digest.
6. Worker and Kotlin report engines can produce separate canonical concepts.
7. Kotlin report hashing and TypeScript canonical hashing are not yet one cross-language contract.
8. current global V1 source ranking is not suitable as universal V2 authority.
9. some Kotlin evidence fields use fallback/default values that require honesty hardening.
10. account/lifecycle cascades require retention redesign before forensic/commercial production use.
11. WPD evidence producer is still at device-discovery maturity; storage/object metadata scanning is pending.
12. SessionDeviceRef correlation is not yet end-to-end.

These findings are expected inputs to **PHASE 2 — CORRECT** and **PHASE 3 — INTEGRATE**.

---

# 53. Stop conditions

Stop and report rather than creating evidence if:

1. source is unknown;
2. device/session correlation is ambiguous;
3. a restricted identifier cannot be obtained legitimately;
4. a collector needs an unapproved content stream;
5. canonicalization/digest version is uncertain;
6. replay ID exists with a different canonical digest;
7. conflicting evidence cannot be explained by a deterministic rule;
8. cloud sync would require mutating original collection time;
9. a report would need to fabricate a missing test;
10. a sanitization conclusion is stronger than its evidence.

---

# 54. Final evidence principle

The permanent CYVRA Mobile evidence principle is:

> **Every material claim must be traceable to immutable evidence with a known source, collection time, method, limitation state, and canonical integrity identity. Independent sources are preserved rather than blended. Missing evidence is reported honestly. Local observation remains verifiable, while the cloud validates and registers — it does not rewrite physical truth.**

This is the active evidence architecture for subsequent CYVRA Mobile implementation.
