# CYVRA Mobile Admin Scope

**Status:** ACTIVE ADMIN BOUNDARY
**Date:** 2026-09-19

## Purpose

The CYVRA Mobile admin surface manages Mobile operational authority. It is not the CYVRA Erase admin system.

## Separation

Keep separate:

```text
customer authentication
staff authentication
desktop authentication
licence/entitlement administration
break-glass/service credentials
```

Do not reuse Erase sessions, databases, tokens, or workers.

## Staff authentication

Normal staff access should use staff OTP/session authentication.

Requirements:

- authorized staff identities only;
- non-enumerating challenge response;
- durable source + identity rate limiting;
- atomic OTP consume;
- HttpOnly/same-site web session where applicable;
- append-only audit of privileged actions.

A service/break-glass admin token is not normal browser authentication and must never be shipped to Pages or the customer desktop.

## Licence administration

Admin may:

```text
create/issue entitlement
associate customer
upgrade/revise entitlement
revoke
review usage/transactions
review reports/audit
```

A human-readable licence/reference number is not a secret authenticator.

Device binding and verification scan consumption are separate concepts.

## Payment

Admin may record payment/approval state according to business process.

The Mobile admin console is not itself a card-payment processor unless a separately integrated payment system is added.

## Destructive authority

Sanitization policy/authorization is a separate high-risk permission.

Do not infer destructive authority from the ability to create a licence.

## Data

Administrative exports must follow customer-data minimization and retention policy.

Never expose:

```text
OTP plaintext
session tokens
email-provider keys
database credentials
signing private keys
```

## Current maturity

Existing admin/API slices are useful implementation foundations, but final security hardening and entitlement accounting remain Phase-2/3 work. Do not treat historical `devicesBound` or public-key formats as the final accounting/security design.
