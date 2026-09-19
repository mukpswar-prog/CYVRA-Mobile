# Customer Sanitization UX

**Status:** ACTIVE UX CONTRACT
**Date:** 2026-09-19

## Boundary

Device Verification does not authorize sanitization.

The sanitization workspace begins only after an explicit operator action.

## Safe lifecycle

```text
select same correlated target
        ↓
show qualified methods only
        ↓
show scope + limitations
        ↓
freeze pre-operation evidence
        ↓
policy/entitlement authority
        ↓
two-step operator confirmation
        ↓
re-check same target
        ↓
method-specific execution
        ↓
expected disconnect/reboot
        ↓
reconnect + same-device correlation
        ↓
multi-signal verification
        ↓
validation
        ↓
certificate only if accepted
```

## Method wording

Use:

```text
Platform Factory Reset
Qualified Clear
Qualified Purge
Cryptographic Erase — only when qualified
OEM Sanitization — only when qualified
External Verification Required
Sanitization Unsupported
```

Do not use unsupported marketing language such as "100% unrecoverable" or "NIST wipe".

## Authorization

Step 1: acknowledge destructive effect.

Step 2: confirm an operation/target-bound phrase or equivalent challenge.

If target identity/topology changes after confirmation, authorization becomes stale.

## Simulation

A dry run is visibly labelled simulation.

`SIMULATION_COMPLETE` must never look like successful sanitization and must never enable a successful certificate.

## Reconnect

ADB may be unavailable after reset.

The UI must support USB/WPD-based reconnect evidence and operator verification where required.

## Outcome

Successful validation may produce a **CYVRA Data Sanitization & Verification Certificate**.

Inconclusive, unsupported, failed, or externally verified cases produce a non-success outcome/attempt report with limitations.

See [`SANITIZATION_ARCHITECTURE.md`](./SANITIZATION_ARCHITECTURE.md).
