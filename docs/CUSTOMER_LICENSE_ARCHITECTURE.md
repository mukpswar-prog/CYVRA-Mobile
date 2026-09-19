# Customer Licence & Entitlement Architecture

**Status:** ACTIVE CONTRACT
**Date:** 2026-09-19

## Commercial concepts

Keep these separate:

```text
customer/account access
operator seats
licence/entitlement identity
device binding
verification transaction
scan consumption
sanitization policy
```

Do not use one counter to represent several concepts.

## Public licence number

A human-readable licence/reference number is a lookup/reference identifier.

It is not sufficient as a secret authenticator or destructive-operation authority.

Authentication/authorization must rely on server-side protected state and appropriate credentials/tokens.

## Verification transaction

Target lifecycle:

```text
CREATED
  ↓
RESERVED
  ↓
EVIDENCE_CAPTURED
  ↓
REPORT_FROZEN
  ↓
CONSUMED
```

Failure/exception states may include:

```text
EXPIRED
RELEASED
FAILED
MANUAL_REVIEW
```

Exact schema is frozen during implementation.

## Charge boundary

Passive operations are free:

```text
USB discovery
WPD/MTP discovery
preflight
device-card construction
licence-state display
```

Explicit `Start Device Verification` creates/reserves the transaction.

Consumption finalizes only after the canonical Report 1 has been successfully frozen.

A crash, retry, or report replay must not double-charge.

## Device binding

Device binding and scan consumption are separate records.

A device can be correlated/bound without implying a new scan was consumed.

Do not use a single `devicesBound` counter as the final accounting model.

## Upgrade

Commercial upgrade creates a new entitlement revision/state without rewriting historical transactions or reports.

The desktop refreshes server-authoritative entitlement after the web purchase/approval flow.

The desktop never handles raw payment-card data.

## Offline

No fixed offline grace duration is frozen here.

If offline commercial authorization is supported, it must use a protected, expiring, anti-replay lease bound to the customer/workstation/operation as appropriate.

## Audit

Record append-only commercial events for:

```text
issue
activate
reserve
release
consume
upgrade
revoke
manual adjustment
```

Administrative action requires authenticated staff authority, not possession of the public licence string.
