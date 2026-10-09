# CORE ENGINE — SIGNED PATCH VERIFIER

| Field | Value |
|---|---|
| Status | `DESIGN-DOC` — architecture only; **no signing code, no key material in this task** |
| Authority | `docs/CYVRA_CORE_ENGINE_JOURNEY_FINAL_V2_2026-10-08.txt` §5.2 (patch form), §5.3 (execute only signed patches + reproducibility), §5.6 (no self-modification) — Level 1 |
| Related | `docs/CYVRA_CAPABILITY_PATCH_SCHEMA.md` (`ACTIVE-CONTRACT`, TASK O — **the contract**), `docs/CYVRA_FLEET_TELEMETRY_SPEC.md` §4.5 (challenge-event transport), `docs/CORE_ENGINE_CAPABILITY_MATRIX_RUNTIME.md` |
| Date | 09-Oct-2026 — TASK R (CORE-ENG-1) |
| Kind | Documentation. No key, no endpoint, no verification binary changed. |
| Mandate | M1–M4 in force; customer journey FROZEN; DOCS ONLY. |

---

## 1. Relationship to the contract

`CYVRA_CAPABILITY_PATCH_SCHEMA.md` is the **contract**: envelope, payload schema,
canonicalisation, the ordered 11-step verification, rejection/rollback table, report
versioning fields, conformance checklist.

This document is the **engine-side design**: how the customer core engine is structured
around that contract — verification order and fail-closed plumbing, the
`engine_min_version` comparison, the report-versioning invariant, and the halt-on-failure
rule. Where both speak, **the contract wins**; this doc adds no field and relaxes no rule.

If any statement here appears to contradict the contract, the contract governs and this
document is the defect.

## 2. Scope

| In | Out |
|---|---|
| Ed25519 verification plumbing | Key custody (contract §9.1 — open, needs a named owner) |
| `engine_min_version` gate | Patch distribution endpoint (contract §9.2 — later phase) |
| Patch-set version recording in every report | The ML training path (governed §5.1) |
| Rollback + honest halt | Promotion policy (governed §5.5 — human + governed PR) |

## 3. Verification pipeline

### 3.1 Structure

The verifier is a **pure function** over bytes:

```
verify(envelope_bytes, engine_state, trust_anchors, live_device_profile)
    → ACCEPT(patch) | REJECT(reason_code) | NOT_APPLICABLE(patch, reason)
```

It has no network access, no clock-dependent I/O beyond a supplied time source, no
filesystem writes, and no way to mutate `trust_anchors`, the authorisation gate, or its
own logic. That is governed §5.6 (*no runtime self-modification*) expressed structurally:
**the verifier ships inside the engine binary; no patch may alter verification logic,
trust anchors, or the authorisation gate.**

### 3.2 Ordered, fail-closed

Steps run **exactly** in the contract's §6 order. Every step MUST pass. Any failure
rejects the whole patch — there is no partial acceptance, no "apply what verified", no
best-effort subset.

| # | Step | Reject code | Note |
|---|---|---|---|
| 1 | Read (strict UTF-8, no BOM, no trailing data, depth cap) | `PATCH_MALFORMED` | |
| 2 | Structure / schema validation | `PATCH_SCHEMA_INVALID` | Empty `matrix_rows[]` rejects. |
| 3 | `key_id` → compiled trust anchor | `PATCH_UNKNOWN_KEY` | `trusted_for_verify_only` key cannot authorise. |
| 4 | Canonicalise `payload`, verify Ed25519 signature | `PATCH_SIGNATURE_INVALID` | **Emits a capability challenge event** (telemetry §4.5). |
| 5 | `engine_min_version` vs engine version | `PATCH_ENGINE_TOO_OLD` | See §4. |
| 6 | `valid_from` / `valid_until` | `PATCH_NOT_YET_VALID` / `PATCH_EXPIRED` | |
| 7 | `oem_scope` vs live device | *(not a rejection)* | Result is **NOT APPLICABLE** — see §3.4. |
| 8 | `matrix_rows[]` resolution + preconditions | `PATCH_ROW_UNKNOWN` / `PATCH_PRECONDITION_UNMET` | |
| 9 | Authorisation gate for purge/reset/wipe overrides | `PATCH_AUTHORISATION_REQUIRED` | **A patch can never grant authorisation.** |
| 10 | Stage full set, re-validate, swap atomically | — | Crash mid-apply ⇒ previous set stays active. |
| 11 | Record `patch_id`, `key_id`, payload sha256 → state and every report | — | |

### 3.3 Fail-closed plumbing

- Rejects are **exceptions-free values**: every reject carries a reason code from a fixed
  enum, so the caller cannot accidentally ignore a failure by missing a throw.
- A reject never partially mutates engine state. State changes occur only at step 10.
- Every reject emits one capability challenge event with `outcome` matching its nature
  (`FAILURE` for a bad signature, `NOT_APPLICABLE` for scope miss, `RESTRICTED` where a
  gate is the cause) — never `SUCCESS`.

### 3.4 NOT APPLICABLE is not failure

A patch scoped to another OEM is retained and exerts no effect. It is recorded as
`NOT APPLICABLE` — **never as a pass and never as a failure** (Spec §82; contract §6.7).
A fleet full of out-of-scope patches must not read as a wall of errors, and equally must
not read as success.

## 4. `engine_min_version` check

### 4.1 Rule

The engine MUST refuse a patch whose `engine_min_version` exceeds its own version.
Reason: a patch may reference matrix rows, procedure verbs or OEM scopes that an older
engine does not have, and partial interpretation of a signed document is how an engine
starts guessing.

### 4.2 Comparison

| Aspect | Decision |
|---|---|
| Format | Semver `MAJOR.MINOR.PATCH`, strict. Non-conforming → reject at step 2 (`PATCH_SCHEMA_INVALID`), never coerced. |
| Ordering | Numeric per component, **not** string ordering (`1.10.0 > 1.9.0`). Pre-release/build metadata: rejected at step 2 until a policy exists (open item §8.2). |
| Equal versions | Accept — `engine_min_version == engine_version` satisfies the floor. |
| Engine too old | Reject `PATCH_ENGINE_TOO_OLD`. The engine MUST NOT attempt a partial interpretation, MUST NOT apply the rows it happens to understand, and MUST NOT "downgrade" the patch's requirements to fit. |
| Reporting | A rejected-too-old patch is recorded in `patch_set_mode` history and reported — an engine deliberately left behind is a visible condition, not a silent one. |

### 4.3 What it protects

`engine_min_version` is a **compatibility floor**, not a licence gate and not a
self-destruct. It must never be used to force an upgrade: the engine continues to operate
on its current verified patch set and continues to produce reports.

## 5. Patch-set version in every report

### 5.1 The invariant (governed §5.3)

> Engine version + patch-set version recorded in EVERY report (reproducibility invariant).

Every report MUST carry all five fields; a report missing any is **invalid** and MUST NOT
be presented as final:

| Field | Rule |
|---|---|
| `engine_version` | Semver of the engine binary that produced the report. |
| `patch_set_version` | Monotonic id of the applied set (e.g. `2026.10.08-3`). Regenerated on **any** apply or rollback. |
| `patch_set_hash` | sha256 over the sorted concatenation of applied patches' canonical payload hashes. |
| `applied_patches[]` | `{patch_id, sha256, key_id, applied_at}`, including rolled-back entries with `rolled_back_at`. |
| `patch_set_mode` | `SIGNED-CURRENT` \| `SIGNED-ROLLED-BACK` \| `NO-PATCHES`. Never blank, never inferred. |

`NO-PATCHES` is a legitimate, reportable state — an engine running with no patches is not
a broken engine, and must not be reported as one.

### 5.2 Reproducibility

Same `engine_version` + `patch_set_version` + evidence inputs ⇒ same report. Two reports
with identical version fields that disagree are a defect to be raised, not a discrepancy
to average away.

### 5.3 Why the fields are unconditionally present

Making the fields mandatory at report *construction* — rather than adding them at render
time — is what stops a report from being produced with an unknown provenance. If the
engine cannot state its patch set, it cannot state its conclusions.

## 6. Rollback rules — halt with an honest error

### 6.1 Principle

**If patch verification fails, the engine halts the patched operation and reports the
reason in honest language.** It does not continue on a partially verified set, does not
silently revert to defaults, and does not convert a verification failure into a device
verdict.

### 6.2 Rules

| Situation | Engine behaviour |
|---|---|
| Any §3.2 failure | Reject whole patch; keep prior set; emit challenge event with the reason code. |
| Applied patch later shown wrong | **Rollback** via a *signed* rollback patch, or restore the retained last-known-good *signed* set. An unsigned revert is not permitted. |
| Trust anchor unusable | Fail closed: keep last-known-good, `patch_set_mode = SIGNED-ROLLED-BACK`, emit `PATCH_TRUST_ANCHOR_UNUSABLE`. **Never** fall back to unsigned or default-on behaviour. |
| Rollback required offline | Apply local last-known-good immediately; reconcile on next uplink. **Device work must not be blocked on connectivity.** |
| Same `patch_id`, different bytes | Reject `PATCH_ID_REUSE`; treat as an integrity incident; apply neither version. |
| Report generation fails after apply | Automatic rollback to the previous set, reason recorded. |

Rollback records `patch_id`, reason code, timestamp, engine version and resulting
`patch_set_version`. **Rollback history is part of the report, not hidden state.**

### 6.3 Honest error language

The verifier's failure text states what failed and what the engine will do, in Spec §23
vocabulary — never a device verdict. Spec §82 forbids converting *not tested* into
*fail*; by symmetry, an engine that could not verify a patch must not report the
**device** as failed.

| Verifier outcome | Report language |
|---|---|
| `PATCH_SIGNATURE_INVALID` | "Capability patch rejected: signature verification failed. Engine is running its previous verified patch set." |
| `PATCH_ENGINE_TOO_OLD` | "Capability patch requires a newer engine. Patch not applied; current patch set unchanged." |
| `PATCH_UNKNOWN_KEY` | "Capability patch signed by an unrecognised key. Rejected." |
| `PATCH_AUTHORISATION_REQUIRED` | "Patch touches a purge path. Ownership attestation required. Patch not applied." |
| `PATCH_ROW_UNKNOWN` | "Patch references a matrix row this engine does not recognise. Rejected." |

None of these is a statement about the customer's device.

### 6.4 What is never permitted

- Continuing with an unverified or partially verified patch.
- Re-signing, re-hashing or "repairing" a failed patch locally.
- Fetching a replacement trust anchor over the network inside the actuation path
  (contract §3 — no network key fetch).
- Suppressing a challenge event because it is inconvenient.
- Degrading `patch_set_mode` to a blank or inferred value.

## 7. Invariants

1. Verify-then-act; there is no act-then-verify path.
2. The verifier, trust anchors and authorisation gate are outside patch reach.
3. Rejection is total — never a subset.
4. `NOT APPLICABLE` ≠ pass, ≠ fail.
5. Every report carries all five version fields or is invalid.
6. Rollback is signed, recorded and reportable.
7. No private key exists in this repository, in a patch, in telemetry, or in a report.
8. Promotion requires a governed PR plus Chief Engineer approval (governed §5.5).

## 8. Open items

1. **Key custody** — who holds the Ed25519 private key (contract §9.1). Needs a named
   owner before any signing happens.
2. **Pre-release/build-metadata policy** for `engine_min_version` — currently rejected
   rather than interpreted; needs a ruling.
3. **Distribution endpoint** — later phase (contract §9.2).
4. **Verification performance budget** on low-end hosts — unmeasured (contract §9.5).
5. **`matrix_rows[]` vocabulary** — depends on the capability matrix seed rows; 15 of 22
   item IDs are still provisional `[P]`.

---

*Documentation only. No key material, endpoint, verification code or report path was
changed by this file.*
