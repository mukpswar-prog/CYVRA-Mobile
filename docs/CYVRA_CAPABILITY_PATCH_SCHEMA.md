# CYVRA Capability Patch Schema

| Field | Value |
|---|---|
| Status | `ACTIVE-CONTRACT` — specification only; no signing code in this task |
| Authority | `docs/CYVRA_CORE_ENGINE_JOURNEY_FINAL_V2_2026-10-08.txt` §5.2, §5.3 (Level 1, §2.3 of the Project Index) |
| Related | `docs/CYVRA_FLEET_TELEMETRY_SPEC.md` (§5.4 challenge-event transport) |
| Date | 08-Oct-2026 — TASK O |
| Kind | Documentation. No key material, no endpoint, no engine change. |
| Open | Key custody, distribution endpoint, engine integration — §9 |

---

## 1. Purpose

The core ML engine in this repository produces a **capability patch**: a versioned, ed25519-signed
JSON document that tells a customer engine what its Android access capability actually is for a
given scope, and how a procedure may be overridden for that scope.

The customer engine consumes patches to *decide capability* and *adjust procedures*. It never
consumes a patch to weaken a safety, privacy or honesty rule. This schema defines the document, the
signature, the engine-side verification, the rollback rules, and the two report-versioning fields
that make a report reproducible.

This is an **advisor-actor** boundary: the core engine advises through signed documents; the
customer engine remains the only actor, and it verifies before it acts.

## 2. Normative keywords

MUST / MUST NOT / SHOULD / MAY are used in the RFC 2119 sense. Everything marked MUST is a
conformance gate; a failure means the patch is rejected, not partially applied.

## 3. Signature model

| Rule | Requirement |
|---|---|
| Algorithm | Ed25519 (RFC 8032). Fixed; no algorithm negotiation, no `alg` from the document. |
| Form | Detached signature over the **canonical bytes of `payload` only**. `signature` is never inside `payload`. |
| Canonicalisation | UTF-8, no BOM; object keys sorted lexicographically by code point; no insignificant whitespace; strings minimal-escaped; numbers in shortest round-trip form; no floats in normative numeric fields (integers or strings only). |
| Encoding | Base64 (standard alphabet, with padding) for `signature`; `key_id` is a printable ASCII slug. |
| Trust anchor | Public keys are compiled into the engine at governed build time. Unknown `key_id` MUST be rejected. There is **no network key fetch inside the actuation path**. |
| Key rotation | A rollover patch is signed by the **outgoing** key and carries the incoming public key under `procedure_overrides[]` with `procedure_id = KEY-ROLLOVER`. The incoming key MAY sign the next patch. Retired keys MUST be retained for verification of historical reports, marked `trusted_for_verify_only`. |
| Private keys | MUST NOT exist in this repository, in any patch file, in telemetry, or in a report. Custody is an open item (§9). |

## 4. Envelope

```json
{
  "payload": { },
  "signature": "<base64>",
  "alg": "Ed25519",
  "key_id": "EXAMPLE-KEY-001"
}
```

`alg` and `key_id` are envelope metadata. They MUST equal `Ed25519` and a trust-anchor id
respectively; they are covered by the signature indirectly because `key_id` selects the key used to
verify the payload — therefore `key_id` MUST NOT be tampered to select a different key without
invalidating the signature (verification uses the payload bytes, so a swapped `key_id` simply fails
against the new key's public key unless the signature also verifies, which it will not).

## 5. Payload schema

| Field | Type | Req | Rule |
|---|---|---|---|
| `schema_version` | string | MUST | `"1.0"`. Unknown major → reject. |
| `patch_id` | string | MUST | `PATCH-<scope-slug>-<YYYYMMDD>-<seq>`. Unique and immutable once published; re-issuing the same id with different bytes is a rejection event. |
| `engine_min_version` | string | MUST | Semver `MAJOR.MINOR.PATCH`. Engine MUST refuse a patch whose minimum exceeds its own version. |
| `matrix_rows[]` | string[] | MUST, ≥1 | Every id MUST resolve in the signed capability matrix. Unknown id → reject. |
| `procedure_overrides[]` | object[] | MAY be empty | Each: `{procedure_id, plane, action, preconditions[], evidence_required[], reason}`. `plane` ∈ {`USB_PNP`,`WPD_MTP`,`ADB`,`COMPANION`}. `action` MUST be one of the engine's existing procedure verbs; a patch cannot invent a verb. |
| `oem_scope` | object | MUST | `{manufacturer, models[], android_min, android_max, skins[]}`. Non-match with the live device is **NOT APPLICABLE**, not an error. |
| `evidence_refs[]` | string[] | MUST, ≥1 | Governed document/section ids or fixture provenance ids. Free prose is rejected — provenance must be resolvable. |
| `created_by` | string | MUST | Identifier of the governed authoring step (e.g. `core-ml-engine`). |
| `approved_by` | string | MUST | MUST be `Chief Engineer` or a named approver recorded in the approval ledger. This is the §5.5 promotion gate. |
| `created_at` | string | MUST | RFC 3339 UTC. |
| `valid_from` | string | optional | RFC 3339 UTC. Absent → immediately valid. |
| `valid_until` | string | optional | RFC 3339 UTC. Absent → no expiry. |
| `supersedes` | string | optional | `patch_id` it replaces. |
| `notes` | string | optional | Non-normative; MUST NOT be relied on by the engine. |

### 5.1 Example (illustrative only — not a real patch)

```json
{
  "payload": {
    "approved_by": "Chief Engineer",
    "created_at": "2026-10-08T00:00:00Z",
    "created_by": "core-ml-engine",
    "engine_min_version": "1.0.0",
    "evidence_refs": ["JOURNEY-V2-§2-P3", "FIXTURE-API36-DISPLAY"],
    "matrix_rows": ["ADB-GETPROP-READ", "ADB-DUMPSYS-BATTERY"],
    "notes": "EXAMPLE ONLY - illustrative payload, unsigned",
    "oem_scope": {
      "android_max": 36,
      "android_min": 33,
      "manufacturer": "EXAMPLE-OEM",
      "models": ["EXAMPLE-MODEL"],
      "skins": ["EXAMPLE-SKIN"]
    },
    "patch_id": "PATCH-EXAMPLE-20261008-001",
    "procedure_overrides": [
      {
        "action": "ADD-EVIDENCE-FIELD",
        "evidence_required": ["ADB-DUMPSYS-BATTERY"],
        "plane": "ADB",
        "preconditions": ["DEBUGGING-AUTHORIZED", "EMULATOR-OR-CONSENTED-PHYSICAL"],
        "procedure_id": "PUR-DO-WIPE-STEP-RECONNECT",
        "reason": "EXAMPLE ONLY"
      }
    ],
    "schema_version": "1.0",
    "supersedes": null,
    "valid_from": "2026-10-08T00:00:00Z"
  },
  "signature": "BASE64-EXAMPLE-NOT-A-REAL-SIGNATURE",
  "alg": "Ed25519",
  "key_id": "EXAMPLE-KEY-001"
}
```

Note the canonical key ordering: it is required, not decorative — the engine recomputes exactly these
bytes before verifying.

## 6. Engine-side verification (ordered, fail-closed)

Every step MUST pass. Any failure rejects the whole patch; there is no partial acceptance.

1. **Read** — bytes are decoded as strict UTF-8. A BOM, invalid UTF-8, trailing data, or nesting
   deeper than the engine's cap → reject `PATCH_MALFORMED`.
2. **Structure** — types, required fields, enums, string formats are validated against §5. An empty
   `matrix_rows[]` → reject `PATCH_SCHEMA_INVALID`.
3. **Key** — `key_id` is resolved against the compiled trust anchor. Unknown key, or a key marked
   `trusted_for_verify_only` being used to authorise a new patch → reject `PATCH_UNKNOWN_KEY`.
4. **Signature** — canonical bytes of `payload` are recomputed and the Ed25519 signature verified.
   Mismatch → reject `PATCH_SIGNATURE_INVALID` and emit a capability challenge event (transport:
   §5.4 of the telemetry spec).
5. **Engine floor** — compare `engine_min_version` to the engine's own version. Too old an engine →
   reject `PATCH_ENGINE_TOO_OLD` (the engine MUST NOT attempt a partial interpretation).
6. **Validity window** — outside `valid_from`/`valid_until` → `PATCH_NOT_YET_VALID` /
   `PATCH_EXPIRED`.
7. **Scope match** — device manufacturer/model/android/skin vs `oem_scope`. No match → result is
   **NOT APPLICABLE**: the patch is retained but exerts no effect, and this is recorded as such
   (never as a pass or a failure).
8. **Row resolution** — every `matrix_rows[]` id must resolve, and each row's preconditions must be
   satisfiable in the current plane/authorisation state. Unknown row → `PATCH_ROW_UNKNOWN`.
   Unsatisfiable precondition → `PATCH_PRECONDITION_UNMET`.
9. **Authorisation gate** — any override touching a purge, reset or wipe path additionally requires
   an active, recorded ownership-attestation event for the device under work (governed doc §6.2).
   Absent → reject `PATCH_AUTHORISATION_REQUIRED`. A patch can never grant authorisation.
10. **Atomic apply** — the patch set is staged in full, re-validated, then swapped in one step. A
    crash mid-apply MUST leave the previous set active.
11. **Record** — applied `patch_id`, `key_id`, and the sha256 of the canonical payload bytes are
    written to engine state and to every subsequent report.

**Invariants the verification code itself is not patchable.** The verifier ships inside the engine
binary; no patch may alter verification logic, trust anchors, or the authorisation gate. This is the
§5.6 no-runtime-self-modification rule expressed at the schema level.

## 7. Rejection and rollback rules

| Situation | Engine behaviour |
|---|---|
| Any §6 failure | Reject whole patch; keep prior patch set; emit challenge event with the reason code. |
| Patch applied, then evidence shows it is wrong | **Rollback.** Rollback is executed either by a *signed rollback patch* or by restoring the retained last-known-good *signed* set. An unsigned revert is not permitted. |
| Trust anchor unusable | Fail closed: keep the last known-good signed set, set `patch_set_mode = SIGNED-ROLLED-BACK`, emit `PATCH_TRUST_ANCHOR_UNUSABLE`. Never fall back to unsigned or default-on behaviour. |
| Rollback required while offline | Apply the local last-known-good set immediately; reconcile on next uplink. Device work must not be blocked on connectivity. |
| Same `patch_id`, different bytes | Reject `PATCH_ID_REUSE`; treat as an integrity incident; do not apply either version. |
| Report generation fails after apply | Automatic rollback to the previous set, with reason recorded. |

Rollback MUST record: `patch_id`, reason code, timestamp, engine version, and the resulting
`patch_set_version`. Rollback history is part of the report, not a hidden state change.

## 8. Report versioning fields (§5.3)

Every report MUST carry these fields. A report missing any of them is invalid.

| Field | Type | Rule |
|---|---|---|
| `engine_version` | string | Semver of the engine binary that produced the report. |
| `patch_set_version` | string | Monotonic id of the applied set, e.g. `2026.10.08-3`. Regenerated on any apply or rollback. |
| `patch_set_hash` | string | sha256 over the sorted concatenation of the applied patches' canonical payload hashes. |
| `applied_patches[]` | object[] | `{patch_id, sha256, key_id, applied_at}` — includes rolled-back entries with `rolled_back_at`. |
| `patch_set_mode` | enum | `SIGNED-CURRENT` \| `SIGNED-ROLLED-BACK` \| `NO-PATCHES`. Never blank, never inferred. |

**Reproducibility invariant:** the same `engine_version` + `patch_set_version` + evidence inputs MUST
reproduce the same report. Any report whose version fields are absent, blank or internally
inconsistent MUST NOT be presented as a final report.

## 9. Open items

1. Key custody and rotation ownership (who holds the Ed25519 private key) — needs a named owner.
2. Distribution endpoint for patches — later phase; no Worker/API code in TASK O.
3. `matrix_rows[]` vocabulary — depends on the capability matrix seed rows (governed doc §10).
4. Report schema integration — `schema 0011` is a later phase; the fields above are reserved now.
5. Signature verification performance budget on low-end hosts — unmeasured.

## 10. Conformance checklist

- [ ] Envelope carries only `payload`, `signature`, `alg`, `key_id`.
- [ ] Canonical bytes are reproducible independently of the signing implementation.
- [ ] Verification is fail-closed and ordered exactly as §6.
- [ ] No patch can alter the verifier, the trust anchors, or the authorisation gate (§5.6).
- [ ] No private key material anywhere in the repository or in any generated document.
- [ ] Non-scope patch is recorded as NOT APPLICABLE, never as a pass or a failure (Spec §82).
- [ ] Every report carries `engine_version`, `patch_set_version`, `patch_set_hash`,
      `applied_patches[]`, `patch_set_mode`.
- [ ] Rollback is signed, recorded and reportable.
- [ ] Promotion to a released patch requires a governed PR plus Chief Engineer approval (§5.5).

---

*Documentation only. No code, key, endpoint or report path was changed by this file.*
