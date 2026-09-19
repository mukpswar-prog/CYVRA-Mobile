# @cyvra/evidence

Shared evidence/report contract package for CYVRA Mobile.

## Evidence V1

The repository currently contains V1 schemas and code for the historical G4/S1 contract.

V1 remains supported for historical compatibility.

Current V1 sources include legacy values such as:

```text
S1_APPLICATION
S2_STATION
S2_AUTHORIZED_ADB
S3_ENTERPRISE
TECHNICIAN_OBSERVATION
```

Do not silently change the meaning of V1.

## Evidence V2 direction

The active architecture requires source-native provenance:

```text
WINDOWS_USB
WINDOWS_WPD_MTP
ANDROID_ADB
ANDROID_COMPONENT
OPERATOR
SYSTEM
```

V2 is introduced additively after its schema/digest/replay contract is frozen.

## Integrity

Canonicalization and SHA-256 digest behavior must be deterministic.

Target replay rule:

```text
same evidenceId + same canonical digest
  → idempotent replay

same evidenceId + different canonical digest
  → integrity conflict
```

Server-side code must recompute/verify canonical digests rather than trusting a client string.

## Reports

Report 1 converges on one canonical manifest/digest shared by local and cloud flows.

PDF/web/Markdown are renderings, not separate sources of truth.

## Commands

```text
pnpm --filter @cyvra/evidence test
pnpm --filter @cyvra/evidence typecheck
```

See [`../../docs/DEVICE_EVIDENCE_ARCHITECTURE.md`](../../docs/DEVICE_EVIDENCE_ARCHITECTURE.md).
