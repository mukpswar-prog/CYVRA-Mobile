# KEY ROTATION — 2026-10-01

**Status:** prepared, **NOT committed**. Rotation is a two-sided change (server
secret + client constant) and must land atomically or every signature becomes
unverifiable.

---

## 1. Why

The rotation reason is **the private half is unavailable**.

The previous public key was a placeholder whose private half was never
provisioned anywhere the server can reach. `SignedEntitlementProvider`'s own
comment claimed *"the private half lives with the CYVORIQ server"* — it did not.
The consequence was concrete: **the server could not produce a single signature
the Host would accept**, so `POST /v1/activation` could never have returned a
verifiable entitlement even with the route in place.

Rotating to a keypair the server actually holds is what makes activation
possible at all. It is not a response to compromise.

## 2. Keys

| | Value | Where it lives |
|---|---|---|
| **OLD public** (SPKI, b64) | `MCowBQYDK2VwAyEAnfVRu1V0YzDkz9zC1lymY5Tz6TvOE9Lnizs89cbv6Tc=` | Former value of `SERVER_PUBLIC_KEY_B64` |
| **NEW public** (SPKI, b64) | `MCowBQYDK2VwAyEAUM2pNrv+Hszyo9rujw50XpSRSOSoAWiZEKm1oKQ/phQ=` | `SERVER_PUBLIC_KEY_B64` (this rotation) |
| **NEW private** (PKCS#8, b64) | *(printed to the operator in chat only)* | Cloudflare secret `ENTITLEMENT_PRIVATE_KEY_B64` |

Both public keys are X.509 SubjectPublicKeyInfo DER, standard Base64 — the
`MCowBQYDK2Vw…` prefix is the fixed SPKI prefix for Ed25519 and is expected on
both. The **private** key is PKCS#8 DER, standard Base64, and **must never
appear in any file in this repository**.

> **The private key is deliberately absent from this document and from every
> other tracked file.** It was emitted once, in chat, for the operator to paste
> into Cloudflare. If it ever appears in a diff, a log, or a test fixture, treat
> it as burned and rotate again.

## 3. Blast radius — there is none

**No previously issued production signatures exist yet.**

Nothing has ever been signed with either key in production:

- `POST /v1/activation` did not exist before this work — the desktop's request
  fell through to Hono's default 404.
- `POST /admin/serials/:serialId/issue` gained signing in this same, still
  uncommitted changeset; before it, §2.5 of the recon report records that **no
  signing mechanism existed at all**.
- No `entitlement.json` has been issued to any workstation in the field.

Therefore no signature becomes invalid, no workstation needs re-provisioning,
and there is no back-signing or migration window to plan. This is the cheapest
moment rotation will ever be.

## 4. What changes, and where

| Side | File | Change |
|---|---|---|
| Client (verify) | `apps/host/src/main/kotlin/cyvra/mobile/host/license/SignedEntitlementProvider.kt` | **One line** — the `SERVER_PUBLIC_KEY_B64` string literal |
| Server (sign) | Cloudflare Worker secret `ENTITLEMENT_PRIVATE_KEY_B64` | Set to the new private half |

No other code is touched. `SCHEMA` (`cyvra.entitlement.v1`), the algorithm
(`Ed25519`), the standard-Base64 encoding and the UTF-8 payload bytes are all
unchanged — those are the contract, not the key.

## 5. Deployment order

Signing and verification must agree at every instant:

1. Set the **Cloudflare secret** first (`wrangler secret put
   ENTITLEMENT_PRIVATE_KEY_B64`), then deploy the Worker that reads it.
2. Ship the **Kotlin constant** with the next Host build.
3. Between (1) and (2) the old build still verifies the *old* key and simply
   receives signatures it cannot check — but see §3: no build in the field has
   ever received one, so in practice there is no window to manage.

`ENTITLEMENT_VALIDITY_SECONDS` must be set alongside the key or `/issue` and
`/v1/activation` both fail closed with 503 rather than signing with an unstated
validity window.

## 6. Prerequisite verified

Ed25519 via `crypto.subtle` was confirmed working in the **actual workerd
runtime** (not Node) before this rotation was prepared:

- workerd `1.20260908.1` · miniflare `5.20260908.0-alpha` · wrangler `4.130.0`
- `compatibility_date: 2026-09-09`, `nodejs_compat`
- Runtime key generation, `signPayload`, `signEntitlement`, verify, and a
  tampered-payload negative control — all passed.

The pure-JS `@noble/ed25519` fallback is **not required** and was not
implemented.

## 7. Outstanding before commit

- Fixture-revert checklist (see prior reports) still precedes any commit.
- `SignedEntitlementProvider.kt` lives on `feature/p2-protocol-completion`, not
  on `audit-and-planning-2026-09-26` where the server changes sit. The rotation
  spans **two branches**; decide how to land them together before committing
  either side.
- This document and the Kotlin edit are uncommitted, as instructed.
