# WS-K3 — Licence Request Endpoint + Migration `0010`

| Field | Value |
|---|---|
| Status | `DRAFT` — authored under TASK L, **NOT executed**, no migration run, no route written |
| Authored | 08-Oct-2026, TASK L (RESUME protocol) |
| Branch | `feature/ws-i-v2-ws-k3` off `origin/main` @ `17a37b4` |
| Scope | one endpoint in `services/api` + one additive migration (`0010`) + the client call that replaces the honest "NOT SENT" state |
| Approvals used | TASK L instruction (RESUME 08-Oct-2026) to **draft** |
| Approvals **not** used | no commit · no merge · no deploy · **no Neon write** · no schema applied |

---

## 1. The gap

`apps/web/src/site/CustomerWorkspaceShell.tsx` already renders the §8 purchase area,
the §9 form and the §10 record — and states the truth about it:

> `NOT SENT: no endpoint accepts a licence request yet. Place it with the business.`

There is no purchase or licence-request route anywhere in `services/api`
(grep of `purchase|licence-request|license-request` returns only two incidental
comments in `activation.ts` and `bridge.ts`). The §10 record is built on the
device and discarded. WS-K3 makes it real.

---

## 2. What already exists — the finding that shapes the design

Before designing a table, I counted the §10 fields against the schema.

**§10 lists 14 fields. 13 of them are already stored.**

| §10 field | Existing column | Table |
|---|---|---|
| Request ID | `id` (uuid) | `mobile_serials` |
| Customer account ID | `user_id` | `mobile_serials` |
| Registered email | `customer_email` | `mobile_serials` |
| Customer / company name | `customer_full_name`, `company_name` | `mobile_serials` |
| Address | `address_line1`, `address_line2`, `state` | `mobile_serials` |
| PIN code | `pincode` | `mobile_serials` |
| Selected licence type | `plan_code` + `device_max` | `mobile_serials` |
| Payment status | `status` | `payments` (one row per serial) |
| **Request date/time** | **— nothing** | **⇒ migration `0010`** |
| Licence status | `licence_status` | `mobile_serials` |
| Licence issued date/time | `issued_at` | `mobile_serials` |
| Licence reference | `public_number` | `mobile_serials` |
| Application entitlement | `plan_code` / `device_max` → `projectEntitlement` | derived |
| Download availability | `build-manifest.json` → `normalizeBuild()` | derived |

And the §9 form already has a **precedent for every write it needs**:

| Evidence | Location | What it proves |
|---|---|---|
| Registration already captures name, company, address 1/2, state, pincode | `services/api/src/registration.ts` — `RegistrationProfile`, `profileColumns()` | §9's fields are *already collected once*; §9 says "avoid repeatedly asking the customer for information already available in the authenticated account" |
| `PINCODE_RE = /^\d{6}$/` | `registration.ts` | Indian PIN validation exists; do not write a second regex |
| `parseRegistration()` validates name/email/pin/plan in one place | `registration.ts` | reuse it; a second validator is a second place to get out of sync |
| `ensureSerialForUser()` creates a row at `status: "PAYMENT_PENDING"` with profile + `payments` row + audit row, idempotently | `services/api/src/bridge.ts` | the *entire* customer→licence lifecycle already starts here |
| Audit actor for customer-initiated writes | `actor_role = "SYSTEM"`, `actor_id = NULL` | the actor model for a non-staff write already exists and is documented |
| Route mounting convention | `index.ts:288-308` — `app.route("/v1", …)` | a new module mounted beside `entitlementRoutes` is the house style |

**Conclusion:** WS-K3 is *not* "add a purchase table". It is "let the customer
submit, through a session-authenticated route, the facts registration already
knows how to hold — and stamp when they asked."

---

## 3. Design decisions

### D1 — Where the request record lives (the central choice)

| | Option A — stamp the existing `mobile_serials` row | Option B — new `licence_requests` table | Option C — new `purchase_requests` + FK to serial |
|---|---|---|---|
| §10 fields available | 13/14 immediately | must copy ~8 columns | must copy ~8 columns |
| Duplicate sources of truth | **none** | profile duplicated | profile duplicated |
| Reuses bridge/state machine/payments | **yes, unchanged** | no — needs a conversion step into a serial | no |
| Operator sees requests in the existing queue | **yes** | no — a second screen | partially |
| Request history over time | one current request (§10 asks for *a* status summary, not an audit trail — §96 owns that) | full history | full history |
| Abandoned rows polluting the register | possible (see D5) | isolated | isolated |

**Recommendation: Option A.** The spec's §10 is a *status summary for the
customer*, not an append-only ledger; §96 (audit trail) already owns history via
`audit_events`, which the bridge proves can record customer-initiated writes.
Building a parallel table would mean re-storing eight columns that exist, plus a
conversion step that has to stay in sync with `mobile_serials` forever. Option A
buys the whole lifecycle for one column.

### D2 — The customer never retypes what the account already holds
`POST` accepts only what is genuinely missing. **Registered email is not
accepted from the body at all** — it is taken from the session:

```ts
const parsed = parseRegistration({ ...body, email: sessionEmail });
```

Spreading `email` **after** `body` means a client-supplied email is always
overwritten. A customer cannot file a request against someone else's address,
and there is no second validation path.

### D3 — Payment status is never the customer's to write
Spec §3 step 3: *"Payment status is recorded manually by the authorized
business/admin."* Spec §11: *"Payment Done alone should not be treated as an
application entitlement."* Spec §2: no gateway, no processing.

⇒ The endpoint **ignores** any `paymentStatus`, `licenceStatus`,
`publicNumber`, `issuedAt`, `entitlement` or `downloadAvailability` in the body.
It has no code path that reads them. See ruling **R-K2** for the §11 dropdown.

### D4 — What the customer may change, and when

| Field group | Editable while | Refused (409) once |
|---|---|---|
| Profile: name, company, address 1/2, state, pincode | `DRAFT`, `PAYMENT_PENDING`, `PAYMENT_CONFIRMED` | `READY_TO_GENERATE`, `KEY_GENERATED`, `ISSUED`, `ACTIVE`, `SUSPENDED`, `REVOKED` |
| **Plan**: `plan_code` / `device_max` | `DRAFT`, `PAYMENT_PENDING` only | `PAYMENT_CONFIRMED` onward — after payment is confirmed, changing the plan silently changes what was paid for |

Rationale: once a key is generated the profile is bound into the issued
licence; letting a customer rewrite it afterwards would desynchronise the
emailed licence from the database.

### D5 — Idempotency
Same shape as `ensureSerialForUser`: a row already exists ⇒ **update it**, never
insert a second one (`mobile_serials` deliberately has no unique constraint on
`customer_email` — see `bridge.ts` — so the endpoint must not create rows).
A repeat submission re-stamps `requested_at` and writes a fresh audit row.

### D6 — Audit
New value on `audit_action_enum`: **`LICENCE_REQUESTED`**, written with
`actor_role = "SYSTEM"`, `actor_id = NULL`, `entity_type = "mobile_serials"`,
`previous_state` / `new_state` carrying only the fields that actually changed.

### D7 — Read path: no second GET
The §10 projection is `entitlement` plus one timestamp. Rather than add
`GET /v1/me/licence-request`, add **`requestedAt`** to the existing
`GET /v1/me/entitlement` projection. One new route total.

---

## 4. Migration `0010` (drafted, not generated, not run)

Next free slot confirmed: `database/migrations/meta/_journal.json` ends at
`idx: 9` (`0009_payment_method`), files `0000`–`0009` exist. **`0010` is free**
and is the number reserved by the ledger entry A6.

```sql
/*
 * WS-K3 — the one field Section 2 proved was missing.
 * ===================================================
 *
 * `requested_at` answers spec 10's "Request date/time". `created_at` cannot:
 * it is written by the registration bridge when the ROW is born, which may be
 * months before the customer actually asks for a licence. Stamping the request
 * onto `created_at` would date a request from an event that is not the request.
 *
 * NULL IS THE TRUTHFUL DEFAULT. NULL means "this customer has never submitted
 * a licence request" - the state every existing row is in today. Backfilling
 * it would assert that somebody asked for something when nobody did, which is
 * the exact defect this project keeps removing. No DEFAULT, no backfill.
 *
 * PURELY ADDITIVE: one enum value + one nullable column. No constraint, index
 * or row is touched, so rollback is DROP COLUMN + DROP TYPE (after 0010 is
 * retired from the journal).
 *
 * WHY NOT A TABLE: 13 of spec 10's 14 fields already live in
 * `mobile_serials`/`payments`. See docs/WS-K3_PURCHASE_ENDPOINT_MIGRATION_0010.md §3 D1.
 *
 * ENUM-ADDITION CAVEAT: `ALTER TYPE … ADD VALUE` cannot be *used* inside the
 * transaction that adds it. This migration only declares it; the first INSERT
 * naming it happens later, in the endpoint. If the migration driver wraps both
 * statements in one transaction, split them across two migration files.
 */
--> statement-breakpoint
ALTER TYPE "public"."audit_action_enum" ADD VALUE 'LICENCE_REQUESTED';--> statement-breakpoint
ALTER TABLE "mobile_serials" ADD COLUMN "requested_at" timestamp with time zone;
```

**How it must actually be produced (execution step, needs approval):**

```bash
# 1. add the enum value + column to database/src/schema.ts first
# 2. generate, so meta/0010_snapshot.json is produced by drizzle-kit, not by hand
pnpm --filter @cyvra/database generate
# 3. apply against LOCAL Postgres only, then verify
pnpm --filter @cyvra/database migrate
pnpm --filter @cyvra/database typecheck
```

⚠️ **Snapshot-chain caution (pre-existing, discovered while numbering this):**
`database/migrations/0005_mobile_licences.sql` exists but
`database/migrations/meta/0005_snapshot.json` **does not** — the snapshot chain
jumps `0004 → 0006`. `drizzle-kit generate` diffs against the last snapshot, so
before trusting a generated `0010` diff, confirm the generator is not about to
re-derive `0005`'s changes. This is a pre-existing repository condition, not
something WS-K3 introduced; it must be checked rather than assumed.

**Never run against Neon without named approval (Master Plan §9).**

---

## 5. Endpoint contract

```
POST /v1/me/licence-request
```

| Aspect | Spec |
|---|---|
| Module | `services/api/src/purchase.ts` exporting `purchaseRoutes`, mounted `app.route("/v1", purchaseRoutes)` at `index.ts` beside `entitlementRoutes` (house convention) |
| Auth | browser **session cookie** — same `readSessionToken` / `lookupSessionUser` path `GET /v1/me/entitlement` uses. Not the device-token model in `activation.ts`; the two must not look interchangeable (comment at `index.ts:296-307` says exactly this) |
| Origin | passes the existing `isAllowedOrigin` CORS middleware; `allowMethods` already permits `POST` |
| Body | `plan` (or `deviceMax`), `fullName`, `companyName?`, `addressLine1`, `addressLine2?`, `state?`, `pincode` — **`email` deliberately absent** (D2) |
| Validation | `parseRegistration({ ...body, email: sessionEmail })` — one validator, one PIN regex, one slab check (`ISSUABLE_SLABS` already refuses CAP-3/CAP-7) |
| Success | `200` with the **§10 customer-safe projection**: request id, registered email, name, address (masked PIN per §12 if displayed), licence type, payment status in §11 words (`Not Done` / `Done`), request date/time, licence status in customer words, issued date, masked reference, entitlement, download availability |
| `401` | `{"error":"Sign in required."}` — same wording as entitlement |
| `400` | validation message from the parser, unchanged |
| `409` | row is past the D4 edit window, with the reason in customer language |
| `503` | DB failure — body contains only `error`, so an absent counter/status can never be mistaken for a zero (entitlement precedent) |
| Never returned | raw `public_number` (masking rule), staff fields, `created_by`, `issued_by`, `host_fingerprint`, `device_token_hash` |

**Read path:** `requestedAt` added to `GET /v1/me/entitlement` (D7).

---

## 6. What must be written (implementation scope — *not* done in TASK L)

| # | File | Change |
|---|---|---|
| 1 | `database/src/schema.ts` | `audit_action_enum` += `LICENCE_REQUESTED`; `mobileSerials.requestedAt` |
| 2 | `database/migrations/0010_*.sql` + `meta/0010_snapshot.json` | generated, then applied (A6 + Neon approval required) |
| 3 | `services/api/src/purchase.ts` | new route module |
| 4 | `services/api/src/index.ts` | import + mount |
| 5 | `services/api/src/entitlement.ts` | project `requestedAt` |
| 6 | `apps/web/src/api.ts` | `licenceRequest()` next to `api.entitlement()` |
| 7 | `apps/web/src/site/CustomerWorkspaceShell.tsx` | submit + error/success states; retire the "NOT SENT" copy **only once the endpoint exists** |
| 8 | tests | `services/api` (395 baseline) + `CustomerWorkspaceShell.test.tsx` (41 specs) |

Steps 1-5 are `services/api` + `database` → **E15 freeze applies**; see R-K5.

---

## 7. Test plan

| Case | Expectation |
|---|---|
| No session | `401`, exact entitlement wording |
| Valid body, no existing row | row created via the bridge path, `PAYMENT_PENDING`, `requested_at` set, audit `LICENCE_REQUESTED` with `SYSTEM` actor |
| Valid body, row exists | **updated, not duplicated** — row count unchanged |
| Body carries `email: someone@else` | ignored; stored email is the session's |
| Body carries `paymentStatus: "Done"` | ignored; `payments.status` unchanged — *the fabrication test* |
| Body carries `licenceStatus: "ISSUED"` | ignored; status unchanged |
| `pincode: "12345"` | `400` (existing `PINCODE_RE`) |
| `plan: 3` or `7` | `400` — legacy slabs refused by `ISSUABLE_SLABS` |
| Row already `ISSUED` | `409` |
| Row `PAYMENT_CONFIRMED`, plan change | `409`; profile change still `200` |
| Repeated identical submission | idempotent update, no second row |
| Projection | raw serial never appears; PIN masked per §12 |

---

## 8. Open rulings requested

| # | Ruling | Recommendation |
|---|---|---|
| **A1** | Licence slabs: commission said "(1, 5, 7, 25)"; config says `PLAN_SLABS = [1,5,10,25,50]` | **Close A1 for the config.** Evidence: `plan_code_enum` marks CAP-3/CAP-7 *"LEGACY … never issuable to new records"*; `registration.ts` cites *"the 05 Oct 2026 design freeze fixes the standard plans at 1, 5, 10, 25 and 50 (RULE 4)"*; `REGISTRATION_DEFAULT_SLAB = 1`. A `7` option would be refused by the API it talks to. |
| **R-K2** | §11's `Payment status` dropdown sits in the Phase 3 form. It must never reach the endpoint (D3) | Keep it as a **local, clearly-labelled intent marker** ("recorded by the authorised business"), or remove it from the customer form entirely and show only the server's value |
| **R-K3** | No rate limiting exists on authenticated routes; an authenticated customer could re-stamp `requested_at` and flood `audit_events` | Add a minimum interval (e.g. refuse re-submission within 60 s with `429`) — needs a ruling, since it is a new policy |
| **R-K4** | Row does not exist (account created before the bridge) | Reuse `ensureSerialForUser`; **do not** add a second insert path |
| **R-K5** | E15 P1.5 freeze gates WS-K1 code | WS-K3 is `services/api` + `database` → needs E15 lifted, or an explicit carve-out naming WS-K3 |
| **A6** | First Workspace schema migration, `0010` reserved | This draft is what `0010` becomes; approval to generate + apply is still pending |

---

## 9. Verification performed on this draft

| Gate | Result |
|---|---|
| Files written by TASK L | 2 documents under `docs/` only |
| `database/src/schema.ts` modified | **no** |
| Migrations generated or applied | **no** |
| Neon touched | **no** |
| Production touched | **no** |
| Standing §6 gates on this branch | typecheck **0** · tests **794 passed / 0 fail** (desktop 71 · evidence 26 · web 302 · api 395) · `wrangler deploy --dry-run` **0** (751.47 KiB) · §6 forensic greps **0 hits / 16 tokens** · responsive proofs **N/A** — no file under `apps/web` changed, so the `688db80` proof (320/768/1024/1440/3840, 0 overflow) still covers this tree |
| `git status --porcelain` | `?? docs/WS-I_V2_GITHUB_RELEASES_PIPELINE.md` · `?? docs/WS-K3_PURCHASE_ENDPOINT_MIGRATION_0010.md` — nothing else |

---

## 10. Traceability

- **Master plan:** `docs/WS-K_MASTER_PLAN.txt` §6 (gates), §9 (report protocol).
- **TASK L** — WS-K3 drafting, RESUME 08-Oct-2026.
- **Spec:** §2 (no payment gateway), §3 (7-step licensing principle), §9 (customer information), §10 (purchase record), §11 (payment status), §12 (licence delivery / masking), §67 (audit logging), §96 (audit trail).
- **Existing precedents:** `services/api/src/bridge.ts` (`ensureSerialForUser`, `SYSTEM` actor), `services/api/src/registration.ts` (`parseRegistration`, `PINCODE_RE`, `ISSUABLE_SLABS`), `services/api/src/entitlement.ts` (401/404/503 shape).
- **Not superseded:** Design Freeze @ `73d3f3a` remains LAW for the admin panel; this document adds no admin surface.
