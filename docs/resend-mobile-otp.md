# CYVRA Mobile Email OTP Runbook

**Status:** ACTIVE RUNBOOK
**Date:** 2026-09-19

## Scope

This runbook applies to CYVRA Mobile transactional email only.

Do not share secrets with CYVRA Erase infrastructure accidentally.

## Production principles

- Resend/API email secrets live only on the Worker/server side.
- Pages/browser bundles never contain `RESEND_API_KEY`.
- production never returns OTP plaintext in the UI/API response;
- customer and staff OTP authorization remain separate policy surfaces even if they share an email-sending helper;
- staff login must not reveal whether an email is an authorized staff identity;
- rate limiting must cover both source and identity;
- OTP consumption must be atomic;
- OTP storage should use a keyed/HMAC-style verifier or equivalent hardened design rather than relying on a bare low-entropy-code hash.

Some hardening items are Phase-2 implementation work; do not claim them complete until code/tests prove them.

## Required configuration

Worker secrets/config should include the approved transactional-email key and From identity.

Never commit:

```text
API keys
OTP codes
session tokens
admin break-glass tokens
```

## Verification

In preview/development, diagnostic behavior may differ.

Before production:

1. send a real OTP to a controlled inbox;
2. verify provider accepted the email;
3. verify delivery;
4. verify OTP expiry and attempt limits;
5. verify replay/second-use fails;
6. verify production response never contains the code;
7. verify unauthorized staff identity receives a non-enumerating response;
8. verify customer/admin origins and sessions are separated.

## Failure handling

A mail-provider failure is an authentication-delivery failure.

Do not:

- fall back to another product's credentials;
- expose the OTP to compensate in production;
- issue a licence/admin action without completing the required authentication flow.

## Ownership

Operational domain/provider details can change. The architecture requirement is stable: email delivery is server-side, secrets remain server-side, and authentication state is durable and auditable.
