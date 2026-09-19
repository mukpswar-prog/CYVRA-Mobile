# CYVRA Mobile Test Pool

**Status:** LIVING TEST RECORD
**Date:** 2026-09-19

## Status vocabulary

```text
AUTOMATED
HARDWARE-PROVEN
PENDING-INTEGRATION
PENDING-HARDWARE
PENDING-RELEASE
BLOCKED
```

## Current automated baseline

| Area | Evidence |
|---|---|
| Evidence V1 package | canonical JSON/digest, honesty, catalog/schema/report unit tests exist |
| Worker local evidence | local ingest route/tests exist |
| Worker Report 1 | local freeze/replay tests exist |
| Kotlin core/domain | evidence, capability, sanitization-model, report, compatibility tests exist |
| Kotlin host | ADB/domain/workflow tests exist |
| Rust desktop | native USB/WPD tests are being expanded under D2.3 |

Historical G0–G7 dashboard/deployment rows remain available in Git history/archive and are not treated as current support claims.

## D2.3 Windows native pool

| ID | Scenario | Current status |
|---|---|---|
| D23-USB-001 | present Windows USB device-instance enumeration | HARDWARE-PROVEN on current bench |
| D23-WPD-001 | WPD COM/manager/device enumeration | HARDWARE-PROVEN on current Samsung handset |
| D23-WPD-002 | production Tauri WPD discovery command | HARDWARE-PROVEN on current bench |
| D23-WPD-003 | no customer storage content opened during discovery | HARDWARE-PROVEN for discovery slice |
| D23-WPD-004 | bounded two-pass topology retry | PENDING-INTEGRATION |
| D23-WPD-005 | privacy-safe session-scoped frontend device ID | PENDING-INTEGRATION |
| D23-WPD-006 | deterministic WPD error-code tests | PENDING-INTEGRATION |
| D23-WPD-007 | read-only WPD device open | PENDING-INTEGRATION |
| D23-WPD-008 | storage/root discovery | PENDING-INTEGRATION |
| D23-WPD-009 | recursive metadata-only traversal | PENDING-INTEGRATION |
| D23-WPD-010 | prove no content stream opened/copied | PENDING-HARDWARE |

Current Samsung bench proof does not imply universal Samsung/Android support.

## Device-state pool

| ID | Scenario | Status |
|---|---|---|
| DEV-001 | USB only | PENDING-HARDWARE |
| DEV-002 | USB + WPD, ADB disabled | PENDING-HARDWARE |
| DEV-003 | ADB unauthorized | PENDING-HARDWARE |
| DEV-004 | ADB offline | PENDING-HARDWARE |
| DEV-005 | reconnect same device | PENDING-INTEGRATION |
| DEV-006 | multiple devices | PENDING-INTEGRATION |
| DEV-007 | target ambiguity blocks charge/destructive action | PENDING-INTEGRATION |

## Evidence V2 pool

| ID | Scenario | Status |
|---|---|---|
| EV2-001 | same ID + same digest replay | PENDING-INTEGRATION |
| EV2-002 | same ID + changed payload conflict | PENDING-INTEGRATION |
| EV2-003 | TypeScript/Kotlin canonical fixtures match | PENDING-INTEGRATION |
| EV2-004 | WPD provenance preserved | PENDING-INTEGRATION |
| EV2-005 | report manifest binds evidence digest | PENDING-INTEGRATION |
| EV2-006 | cloud receive time does not replace collectedAt | PENDING-INTEGRATION |

## Licensing pool

| ID | Scenario | Status |
|---|---|---|
| LIC-001 | passive preflight free | PENDING-INTEGRATION |
| LIC-002 | explicit verification reserves transaction | PENDING-INTEGRATION |
| LIC-003 | report freeze consumes once | PENDING-INTEGRATION |
| LIC-004 | retry/replay no double consume | PENDING-INTEGRATION |
| LIC-005 | device binding separate from consumption | PENDING-INTEGRATION |

## Sanitization pool

Until a method is qualified, destructive execution is not a release acceptance test.

| ID | Scenario | Status |
|---|---|---|
| SAN-001 | unauthorized execution blocked | AUTOMATED |
| SAN-002 | dry-run path | AUTOMATED; simulation only |
| SAN-003 | unqualified method rejected | PENDING-INTEGRATION |
| SAN-004 | same-device reconnect proof | PENDING-INTEGRATION |
| SAN-005 | multi-signal verification | PENDING-INTEGRATION |
| SAN-006 | validation separate from verification | PENDING-INTEGRATION |
| SAN-007 | no certificate on inconclusive outcome | PENDING-INTEGRATION |
| SAN-008 | real qualified Clear method | PENDING-HARDWARE |
| SAN-009 | real qualified Purge method | BLOCKED until method qualification |

## Release pool

| ID | Scenario | Status |
|---|---|---|
| REL-001 | signed installer Windows 10 clean machine | PENDING-RELEASE |
| REL-002 | signed installer Windows 11 clean machine | PENDING-RELEASE |
| REL-003 | bundled Domain Engine/runtime | PENDING-RELEASE |
| REL-004 | update path | PENDING-RELEASE |
| REL-005 | checksums/signatures/release notes | PENDING-RELEASE |
