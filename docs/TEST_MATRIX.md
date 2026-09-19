# CYVRA Mobile Engineering Acceptance Matrix

**Status:** ACTIVE REFERENCE
**Date:** 2026-09-19

## Purpose

This is the engineering acceptance matrix for CYVRA Mobile. Compilation, unit tests, or a single handset do not establish broad product support.

## Maturity levels

```text
MODELLED
UNIT-TESTED
PROTOCOL-EXPOSED
UI-INTEGRATED
HARDWARE-VALIDATED
RELEASE-VALIDATED
```

A capability is reported at the highest level actually proven.

## Host matrix

| Area | Required coverage |
|---|---|
| Windows | Windows 10 x64, Windows 11 x64 |
| Clean machine | fresh supported Windows install |
| Installer | install, launch, update, uninstall |
| Runtime | bundled/managed prerequisites; no Android Studio required |
| USB | attach, detach, reconnect, topology change |
| WPD/MTP | absent, available, enumeration race, metadata-only |
| ADB | unavailable, unauthorized, offline, ready |
| Multiple devices | detection, ambiguity, explicit selection |
| Network | online, offline, reconnect, sync rejection |

## Device transport scenarios

| ID | Scenario | Required outcome |
|---|---|---|
| TR-001 | no handset | no false device |
| TR-002 | USB present, WPD absent | USB evidence preserved |
| TR-003 | USB + WPD, ADB unavailable | basic verification remains possible |
| TR-004 | USB + WPD, ADB unauthorized | no bypass; limitation shown |
| TR-005 | ADB offline | separate ADB state |
| TR-006 | unplug during scan | bounded failure; no crash |
| TR-007 | reconnect same handset | re-correlate identity |
| TR-008 | two plausible handsets | no implicit first-device selection |
| TR-009 | WPD topology changes between two-pass calls | bounded retry / deterministic error |
| TR-010 | WPD metadata scan | no customer content stream opened |

## Evidence scenarios

- unavailable/restricted fields never become PASS;
- same evidence ID + same canonical digest is idempotent replay;
- same evidence ID + different digest is integrity conflict;
- collector failure preserves other collectors;
- WPD evidence remains `WINDOWS_WPD_MTP`;
- cloud receive time never replaces collection time;
- Report 1 binds immutable evidence and digest in Evidence V2;
- historical Evidence V1 remains readable.

## Licensing scenarios

- passive USB/WPD preflight consumes nothing;
- explicit Device Verification starts/reserves a transaction;
- successfully frozen canonical Report 1 finalizes consumption;
- crash/retry cannot double-consume;
- device binding and scan consumption are separate;
- public licence/reference number alone is not authority;
- offline authorization, if introduced, is bounded and anti-replay.

## Sanitization scenarios

Simulation and production destructive qualification are separate.

Minimum destructive qualification coverage includes:

- unauthorized attempt;
- unsupported/unqualified method;
- target ambiguity;
- target changes after confirmation;
- disconnect before and after trigger;
- desktop process interruption;
- reboot/reconnect;
- ADB unavailable after reset;
- WPD/USB-only post-state;
- method-reported error;
- method-reported success but expected state absent;
- removable/secondary storage limitation;
- replay/retry attempt;
- same-device identity mismatch;
- external verification required.

No sanitization method is customer-supported until the exact method/device scope is `HARDWARE-VALIDATED` and the packaged product path is `RELEASE-VALIDATED`.

## Current hardware evidence

Current D2.3 testing has proven Windows WPD device discovery on a Samsung handset in the current bench environment.

That does not prove:

- recursive metadata scanning;
- all Samsung models;
- all Android versions;
- other OEMs;
- sanitization;
- clean-machine release readiness.

## Automated commands

Repository-level checks include:

```text
pnpm typecheck
pnpm build
pnpm test:evidence
pnpm test:api-origins
```

Android/domain tests:

```text
apps\android\gradlew.bat :core:test :host:test
```

Desktop/native checks:

```text
pnpm build
pnpm validate:shell
cargo check
cargo test
```

Use the exact command appropriate to the component under test.

## Evidence recording

Each hardware acceptance row should record:

```text
date
Windows version
device OEM/model
Android version
transport state
software build/commit
test ID
expected
actual
maturity reached
limitations
```
