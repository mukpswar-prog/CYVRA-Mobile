# ADMIN OPS / LICENCE APPROVAL CENTER — RECONNAISSANCE REPORT

**Date:** 2026-10-01
**Mode:** READ-ONLY analysis. No code changes made. No credentials reproduced.
**Scope tree:** `C:\Users\User\Documents\GitHub\CYVRA-Mobile` (branch `audit-and-planning-2026-09-26`, HEAD `c1a43c7`). The `.worktrees/` subtree was **excluded** — it carries unrelated in-flight work.
**Plan analysed:** `docs/admin-cyvoriq-upgrade-plan.txt` (31,002 B, 509 lines, LF, no BOM, **git-untracked — verified via `git ls-files --error-unmatch`**).

---

## 0. PREMISE CORRECTIONS (read first — honesty rules absolute)

The task brief cites a "68-section design plan", "plan §50", and "the plan's 21 acceptance criteria (§68)". **None of those references exist.** Verified directly against the plan file:

| Brief says | Actual state | Evidence |
|---|---|---|
| "68-section design plan" | **13 top-level sections, numbered 0–13**, plus Appendix A–D. 509 lines total. | Grep of `^\s*\d{1,2}\.\s+[A-Z]` returns exactly 14 hits, max section `13. DEFINITION OF DONE` (L447) |
| "plan §50 (customers, licences, payments, host_bindings, staff, audit_events, communications)" | **No §50 exists.** The plan's schema section is **§5.4** (L237–259), and it specifies *four* tables — `licence_verification_events`, `licence_decisions`, `mobile_admin_sessions`, `admin_audit_log`. None of the seven tables named in the brief appear in the plan; `host_bindings`, `payments` and `communications` appear **nowhere in the file at all**. | Grep for `customers\|licences\|payments\|host_bindings\|staff\|audit_events\|communications\|CREATE TABLE` → 40 hits, zero for `host_bindings`/`payments`/`communications` as tables |
| "the plan's 21 acceptance criteria (§68)" | **No §68 exists.** Acceptance criteria live in **§9** (L372–394) as **T-01 … T-15 = 15 criteria**, with the explicit rule L394: `ACCEPTANCE = T-01..T-15 green in preview + P6 smoke signed + freeze recorded` | Direct read of L372–394 |
| — | Related counts for completeness: **§13 DoD = 7 checkboxes** (L449–455); **§11 = 6 decision points D-1..D-6 + 5 risks R-1..R-5** (L418–434); **§8 = 7 phases P0..P6** (L336–369). No combination of these is labelled "21" anywhere in the document. | Direct reads |

**Consequence:** deliverables 3 and 7 below are scored against the plan's *real* anchors — §5.4 for schema, §9 T-01..T-15 for acceptance — not against non-existent §50/§68. Where the brief's assumed artefact has no counterpart, the row is marked **ABSENT (brief premise)** rather than silently substituted.

Two further stale-plan findings, both material to Phase 1:

1. **Migration number 0005 is already consumed.** Plan §3.1 L79 states *"Next free number: 0005"* and §5.4/P1/§10.2 all plan around `0005`. The repo already contains `database/migrations/0005_mobile_licences.sql`. The plan's 0005 does not exist; **next free is 0006.**
2. **`apps/admin` does not exist.** Plan §5.2 L170 and §P3 L351 both say *"ADMIN UI (apps/admin)"*. `glob apps/admin/**` returns **no files**; `apps/` contains exactly `android`, `desktop`, `host`, `web`. The admin UI is host-gated inside `apps/web`.

---

## 1. Admin app location, framework, Cloudflare Pages mapping

### 1.1 Location — `apps/admin` NOT PRESENT

- **Admin UI:** `apps/web/src/site/AdminApp.tsx` (879 lines), `export function AdminApp()` at `apps/web/src/site/AdminApp.tsx:155`.
- **Render gate:** `apps/web/src/App.tsx:20` imports it; `apps/web/src/App.tsx:55` — `if (isAdminHost()) return <AdminApp />;` This check runs **before every path check**, so on an admin host *all* paths render the console.
- **Entry chain:** `apps/web/index.html:21` → `src/main.tsx:3` → renders `<App />`.
- **Routing:** host-gated, **not** hash/path routing. `apps/web/src/site/hosts.ts:3-12` `isAdminHost()`:
  - `hosts.ts:4-6` — on `localhost`/`127.0.0.1` it is the query flag `?ops=1`.
  - `hosts.ts:7-11` — production: `admin.cyvoriq.co.in`, `cyvoriq-admin.pages.dev`, `*.cyvoriq-admin.pages.dev`.
  - The router is a hand-rolled History-API router with no hash routing (`apps/web/src/site/router.tsx:3-25`).

### 1.2 Framework

React + Vite + TypeScript, inside the pnpm workspace (`pnpm-workspace.yaml` globs `apps/*`, `services/*`, `packages/*`, `database`). Output directory `./dist`. *(Detail sourced from `apps/web/package.json` / `vite.config.*`; no `apps/admin` package exists to describe.)*

### 1.3 Cloudflare Pages mapping — three projects, ONE bundle

| Pages project | Config file | Host(s) | Source |
|---|---|---|---|
| `cyvra-mobile` | `apps/web/wrangler.jsonc:3` | (project preview) | `"name": "cyvra-mobile"` |
| `cyvoriq-www` | `apps/web/wrangler.cyvoriq-www.jsonc:5` | `www.cyvoriq.co.in`, apex `cyvoriq.co.in` | comment L3 + `"name"` L5 |
| `cyvoriq-admin` | `apps/web/wrangler.cyvoriq-admin.jsonc:5` | **`admin.cyvoriq.co.in`** | comment L2–L3: *"`cyvoriq-admin`. Host: admin.cyvoriq.co.in. Same apps/web bundle as cyvoriq-www."* |

All three set `"pages_build_output_dir": "./dist"` and all three deploy the **same `apps/web` bundle**. The admin console is a *hostname+bundle switch*, not a separate app.

**Plan agreement:** plan §5.1 L155 `admin.cyvoriq.co.in (Pages: cyvoriq-admin, direct upload)` — **MATCHES**. The plan's §5.2/§P3 "`apps/admin`" framing is the stale part.

⚠️ `wrangler.cyvoriq-admin.jsonc:4` carries an explicit guard: *"Never deploy this to cyvra-www or admin.cyvra.co.in."*

### 1.4 Admin UI action inventory (`AdminApp.tsx`)

| Action | Line | Backend call |
|---|---|---|
| List serials | ~469 area | `GET /admin/serials` |
| Create/generate serial (slab `<option>` list) | `AdminApp.tsx:469-490` | `POST /admin/serials` |
| Issue (approve+email) | — | `POST /admin/serials/:id/issue` |
| Revoke | — | `POST /admin/serials/:id/revoke` |
| Staff list / nominate / revoke staff | — | `GET /admin/staff`, `POST /admin/staff`, `POST /admin/staff/:id/revoke` |
| Licence CSV export | — | `GET /admin/reports/licences` |
| Staff login (OTP) | — | `POST /admin/auth/request`, `POST /admin/auth/verify` |

API client: `apps/web/src/api.ts` (admin calls set `X-Admin-Email` at `api.ts:234`).

**Not present in UI (no screen, no route):** licence **queue** with `PENDING_VERIFICATION` filter, **detail/verification bundle**, **VERIFY** button, **APPROVE/REJECT decision log**, **audit view**, and any **resend/suspend** control.

---

## 2. Licence backend endpoints, serial/key generator, signing

### 2.1 Route mounting

`services/api/src/index.ts:241-244` — the Worker mounts exactly four routers:

```
app.route("/evidence", evidenceRoutes)   // 241
app.route("/reports",  reportRoutes)     // 242
app.route("/license",  licenseRoutes)    // 243
app.route("/admin",    adminRoutes)      // 244
```

### 2.2 Full `/admin/*` route inventory (`services/api/src/admin.ts`)

| Method + path | Line | Auth |
|---|---|---|
| `POST /admin/auth/request` | 220 | none (login flow; domain+nomination gated — see §4) |
| `POST /admin/auth/verify` | 265 | none (login flow) |
| `POST /admin/auth/logout` | 318 | none |
| `GET /admin/me` | 330 | `requireAdmin` (331) |
| `GET /admin/staff` | 340 | `requireAdmin` (341) |
| `POST /admin/staff` | 361 | `requireAdmin` (362) + super-admin |
| `POST /admin/staff/:staffId/revoke` | 433 | `requireAdmin` (434) + super-admin |
| `GET /admin/serials` | 463 | `requireAdmin` (464) |
| `POST /admin/serials` | 478 | `requireAdmin` (479) |
| `POST /admin/serials/:serialId/issue` | 542 | `requireAdmin` (543) |
| `POST /admin/serials/:serialId/revoke` | 597 | `requireAdmin` (598) |
| `GET /admin/reports/licences` | 626 | `requireAdmin` (627) |

### 2.3 Brief's requested endpoint set — verdict

| Requested | Status | Location / evidence |
|---|---|---|
| **create / generate** | ✅ PRESENT | `POST /admin/serials` (478). Pipeline: `licenceDraftError` (488) → `isLicenceSlab` (499–501) → `uniqueLicenceKey` (507) |
| **approve** | ❌ **ABSENT as a route** | There is **no `/approve`**. Approval is **folded into `POST /admin/serials/:serialId/issue` (542)** — there is no separate VERIFY/APPROVE state transition |
| **issue** | ✅ PRESENT | `POST /admin/serials/:serialId/issue` (542–595) |
| **resend** | ❌ **ABSENT** | Email is sent **only inside `/issue`** (566–573). No resend route; no re-send path if delivery fails |
| **suspend** | ❌ **ABSENT** | `type SerialStatus = "PENDING" \| "ISSUED" \| "REVOKED"` (`admin.ts:39`) — **no `SUSPENDED` state exists** |
| **revoke** | ✅ PRESENT | `POST /admin/serials/:serialId/revoke` (597) |

### 2.4 Serial / key generator logic

Format (`licenceKey.ts:4-16`): `CYVRA{dd}{mm}{yyyy}{S|B}{hex4}-1-{max}` — e.g. `CYVRA11092026SA3F1-1-5`.

- `LICENCE_PREFIX = "CYVRA"` — `licenceKey.ts:18`
- `LICENCE_SLABS = [1, 3, 5, 7, 25]` — `licenceKey.ts:19` (see §5)
- `LICENCE_KEY_RE` — `licenceKey.ts:23-24`: `/^CYVRA(\d{2})(\d{2})(\d{4})([SB])([0-9A-F]{4})-1-(1|3|5|7|25)$/`
- `randomHex4()` — `licenceKey.ts:51-54`, `crypto.getRandomValues(new Uint16Array(1))`
- `utcDateParts()` — `licenceKey.ts:44-49`, **UTC** date embedded in the key
- `formatLicenceKey()` — `licenceKey.ts:56-74`; guards: hex4 shape (63), slab (66–68), *1-device ⇒ SINGLE* (69–71)
- `parseLicenceKey()` — `licenceKey.ts:76-100`; regex exec (85), `isLicenceSlab` re-check (89), 1-device rule (90)
- `generateLicenceKey()` — `licenceKey.ts:102-108`
- **Uniqueness:** `uniqueLicenceKey()` — `admin.ts:149-165` — a **12-attempt SELECT-then-insert pre-check loop**; throws `"Could not allocate a unique licence key."` (164) if exhausted. Backed by a unique index on `mobile_serials.public_number`.

### 2.5 Signing mechanism — **NONE EXISTS**

> **Finding (material):** A repo-wide search of all `*.ts` for `hmac|createHmac|sign\(|ed25519|signature|verifySignature` returned **No matches found.**

`services/api/src/crypto.ts` is **32 lines total** and contains only:

| Function | Line | Purpose |
|---|---|---|
| `sha256Hex` | 5 | digest for OTP/session-token storage |
| `generateOtpCode` | 13 | 6-digit numeric OTP |
| `generateSessionToken` | 19 | 32-byte opaque hex session token |
| `timingSafeEqualHex` | 25 | constant-time-ish hex compare |

**The licence key carries no MAC and no signature.** Its integrity model is:
1. Uniqueness enforced by DB unique index + the 12-attempt pre-check loop.
2. Validity established **by server-side lookup** of `mobile_serials.public_number` — the key is a *lookup handle*, not a bearer capability.
3. OTP/session secrets are stored as `sha256Hex` hashes (`admin.ts:235`, `308`), never plaintext.

⚠️ **Do not confuse this with the offline entitlement signing.** Ed25519 signing exists only on the **desktop/offline** path (`SignedEntitlementProvider`, Kotlin/desktop `entitlement.json`), which signs an entitlement *snapshot*. That mechanism is **not** part of the issuance API and provides no protection to `mobile_serials`.

⚠️ **Observation:** `jsonSerial()` returns `publicNumber` (`admin.ts:63`) and `GET /admin/serials` returns **every row, unpaginated** (`admin.ts:463-475`) — i.e. the full licence-key set in one response to any authenticated operator. Plan §5.6 L283–284 restricts key material to per-view fetches and forbids logging; a bulk unpaginated dump is a deviation from that posture worth logging.

---

## 3. Schema inventory vs plan §50 → real anchor **§5.4**

### 3.1 Brief's seven tables (no §50 exists)

| Brief table | Status | Real counterpart in repo |
|---|---|---|
| `customers` | **PARTIAL** | `users` (`database/src/schema.ts:22`, migration 0000) + **denormalised customer fields on `mobile_serials`** (`customer_full_name`, `company_name`, `address_line1/2`, `pincode`, `state`, `customer_kind` — all added by 0005) |
| `licences` | **PARTIAL** | `mobile_serials` (migration 0004) *is* the licence row: `public_number` (key), `status`, `device_max`, `brand_scope`, `issued_at`, `revoked_at`. **No table named `licences`/`licenses`. No `licence_decisions`. No `licence_verification_events`.** |
| `payments` | **PARTIAL** | Only `mobile_serials.payment_noted` — a **free-text column** (`schema.ts:265`, migration 0004 L7). Its own validation string says so (`licenceKey.ts:121`: *"a human note that payment transferred, not a gateway proof"*). **No `payments` table.** |
| `host_bindings` | **MISSING** | **No table.** Nearest analogue is `mobile_serials.devices_bound` — an integer counter (0005), *not* a binding ledger (no device id, no timestamp, no row-per-binding) |
| `staff` | **PRESENT** | `staff_operators`, `staff_otp_challenges`, `staff_sessions` (all migration **0005**) |
| `audit_events` | **MISSING** | **No audit table anywhere in `database/`.** Grep of `database/` for `audit` → zero table hits |
| `communications` | **PARTIAL** | Only three columns on `mobile_serials`: `emailed_at`, `email_message_id`, `email_error` (0005). **No `communications` table**, no per-message row, no send log |

**Score: 1 present · 4 partial · 2 missing (0 of the 7 exist literally).**

### 3.2 The plan's own §5.4 target tables — all four MISSING

| Plan §5.4 table (L237–254) | Exists? |
|---|---|
| `licence_verification_events` | ❌ |
| `licence_decisions` (with `idempotency_key UNIQUE`, `UNIQUE(licence_id, decision)`) | ❌ |
| `mobile_admin_sessions` | ❌ — closest is `staff_sessions` (0005), which has **no `scope` column** and no `revoked_at` |
| `admin_audit_log` (append-only, no UPDATE/DELETE grants) | ❌ |

### 3.3 Complete table inventory (14 tables)

| Migration | Tables |
|---|---|
| `0000_young_darkstar.sql` | `users`, `email_otp_challenges`, `sessions` |
| `0001_next_maverick.sql` | *(no `CREATE TABLE`)* |
| `0002_sturdy_salo.sql` | `device_lifecycles`, `processing_sessions`, `capability_profiles`, `evidence_records`, `evidence_batches` |
| `0003_smiling_gideon.sql` | `reports`, `report_manifests` |
| `0004_happy_centennial.sql` | `mobile_serials` |
| **`0005_mobile_licences.sql`** | `staff_operators`, `staff_otp_challenges`, `staff_sessions` + **13 `ALTER TABLE mobile_serials` ADD COLUMN** |

Source of truth: `database/src/schema.ts` (350 lines).

🔴 **`0005` is taken** — see §0 and §8 Risk A.

---

## 4. Auth / RBAC — is the `@cyvoriq.com` rule enforced SERVER-side?

### **YES. Enforced server-side at three independent points, plus a per-request re-check.**

| # | Check | Location | Behaviour |
|---|---|---|---|
| 1 | Domain predicate | `admin.ts:49-51` `isCyvoriqEmail()` = `email.endsWith("@cyvoriq.com")` | Server-side function, not client-side |
| 2 | **OTP request gate** | `admin.ts:224-226` | `!isCyvoriqEmail` → **403** `"Only @cyvoriq.com emails can sign in to ops."` |
| 3 | **OTP request nomination gate** | `admin.ts:228-233` | `!isApprovedOperator` → **403** `"This email is not nominated by ceo@cyvoriq.com."` — **before any OTP is issued** |
| 4 | **Verify-time re-check** | `admin.ts:298-300` | `!isApprovedOperator` → **403** again *after* code match — closes the window where nomination was revoked between request and verify |
| 5 | Nomination predicate | `admin.ts:90-99` `isApprovedOperator()` | super-admin short-circuit (91) → domain check (92) → **DB lookup `staff_operators.status === "APPROVED"`** (93–98) |
| 6 | Session re-validation **every request** | `admin.ts:101-115` `lookupStaffEmail()` | token-hash lookup (106–111) → expiry (112) → **`isApprovedOperator` re-check (113)** — a demoted operator's live session dies immediately |
| 7 | `requireAdmin` | `admin.ts:117-147` | called by **every** non-login route (12 call sites, all verified above) |
| 8 | Bearer path | `admin.ts:124-138` | SHA-256 of configured vs presented, `timingSafeEqualHex` (134–136). Missing secret → **503** (131–133). Mismatch → **401** (136–138) |
| 9 | `X-Admin-Email` **is not trusted** | `admin.ts:139-145` | the client-supplied header is re-validated server-side via `isApprovedOperator`; failure → **401** naming super admin / nominated operator |

**Routes without `requireAdmin`:** only `POST /auth/request` (220), `POST /auth/verify` (265), `POST /auth/logout` (318) — correct; they *are* the login flow.

**Policy source agreement:** `GUIDELINE.md:26` Amendment — *"Only `@cyvoriq.com` operators nominated by the CEO can sign in."* Matches implementation.

⚠️ **Observation (deviation, not a domain-rule failure):** `POST /admin/auth/verify` returns the **raw session `token` in the JSON response body** (`admin.ts:314`) *in addition to* setting the HttpOnly cookie (`admin.ts:311`). Plan §5.6 L283 forbids credential material being readable by client JS. Cookie + body both carrying the token means JS *can* read it. Log as a Phase-1 hardening item.

⚠️ **Observation:** there is **no `scope` claim** on staff sessions. Plan §5.4/§5.3 require `scope='mobile-admin'`; `staff_sessions` (0005) has no `scope` column, so the planned scope-mismatch **403** (plan L227–228) is currently unimplementable.

---

## 5. Slab validation — where slabs live, and adding 1-50

### 5.1 Where the slabs are defined

**Canonical definition: `services/api/src/licenceKey.ts:19`**

```ts
export const LICENCE_SLABS = [1, 3, 5, 7, 25] as const;
```

> ⚠️ The **plan file does not define slabs at all.** Slabs originate from `GUIDELINE.md:26` (*"`CYVRA{dd}{mm}{yyyy}{S|B}{hex4}-1-{1|3|5|7|25}`"*) and `licenceKey.ts`. There is no "plan §50 slabs" — see §0.

### 5.2 Enforcement sites — **dual source of truth, 6 call sites**

| # | Site | Line | Notes |
|---|---|---|---|
| 1 | `LICENCE_SLABS` array | `licenceKey.ts:19` | canonical list |
| 2 | **`LICENCE_KEY_RE` alternation** | `licenceKey.ts:23-24` | **hardcodes `(1\|3\|5\|7\|25)` — a SECOND, independent definition** |
| 3 | `isLicenceSlab()` | `licenceKey.ts:36-38` | type guard |
| 4 | `formatLicenceKey` | `licenceKey.ts:66-68` | throws `"slab must be 1-1, 1-3, 1-5, 1-7 or 1-25."` |
| 5 | `parseLicenceKey` | `licenceKey.ts:89` | rejects a key whose regex matched but slab isn't in list |
| 6 | `licenceDraftError` | `licenceKey.ts:127-129` | returns `"deviceMax slab must be 1, 3, 5, 7 or 25 (1-1 / 1-3 / 1-5 / 1-7 / 1-25)."` |
| 7 | `POST /serials` | `admin.ts:499-501` | duplicates the same message inline |
| 8 | Frontend `<option>` list | `apps/web/src/site/AdminApp.tsx:469-490` | UI-only |
| 9 | DB default | `0005_mobile_licences.sql` L2 | `device_max integer DEFAULT 3 NOT NULL` |
| 10 | Tests | `services/api/test/licenceKey.test.ts:10-76` | pins `1-1`, `1-3`, `1-5`, `1-7`, `1-25`, rejects unknown |

**DB has no `CHECK` constraint on `device_max`** (0005 L2 is `DEFAULT 3 NOT NULL` only) — slab validity is enforced **entirely at the application layer**.

### 5.3 Adding the 1-50 tier without breaking grandfathering

**Assessment: SAFE — but only if the change is strictly additive and touches both sources of truth.**

**Why grandfathering is preserved:** every existing `mobile_serials.device_max ∈ {1,3,5,7,25} ⊂ {1,3,5,7,25,50}`. No existing row and no already-issued key stops parsing, because nothing is *removed*.

**Required edits (all of them):**
1. `licenceKey.ts:19` → `LICENCE_SLABS = [1, 3, 5, 7, 25, 50] as const`
2. `licenceKey.ts:24` → regex `(1|3|5|7|25|50)` — **must be changed in the same commit as (1)**; otherwise a `1-50` key passes `isLicenceSlab` but `LICENCE_KEY_RE` rejects it, so `parseLicenceKey` returns `null` and `slabLabel` falls back to `` `1-${deviceMax}` ``
3. `licenceKey.ts:67`, `licenceKey.ts:128`, `admin.ts:500` → literal error strings
4. `AdminApp.tsx:469-490` → add the `<option>`
5. `licenceKey.test.ts` → add `1-50` positive case **and keep** the existing `1-3`/`1-7` assertions at `:43-44`

**Regex safety note:** `-1-50$` resolves correctly even with `5` preceding `50`, because `$` anchors and backtracking re-tries `50` after `5` fails to reach end-of-string. Recommend ordering `25|50` for readability, but ordering is **not** a correctness requirement here.

**Grandfathering risks to flag (do not "clean up"):**

| Risk | Failure mode |
|---|---|
| 🔴 **Subtractive edit** — someone "normalises" the list (e.g. drops `3`, or rewrites to `1\|5\|7\|25\|50`) | Existing `-1-3` keys become **unparseable while their rows still exist** → `parseLicenceKey` → `null` → `slabLabel` degrades, CSV `slabLabel` wrong, and any future sign/verify path silently rejects live customers. **Guard: `licenceKey.test.ts:43-44` must stay green.** |
| 🟡 Regex/array divergence | Sites 1 and 2 are independent — editing only one produces keys that *format* but never *parse* |
| 🟡 `device_max DEFAULT 3` | Do **not** change the default — it would alter semantics for every future row. 1-50 must be an explicit per-row value |
| 🟡 No DB `CHECK` | DB will happily accept `device_max = 4` or `= 999`. Consider adding a `CHECK (device_max IN (1,3,5,7,25,50))` — but **adding it retroactively will fail if any legacy row violates it**, so run a `SELECT DISTINCT device_max` audit first |
| 🟡 `slabMax === 1 ⇒ SINGLE` rule | `licenceKey.ts:69-71`, `:90`, `:130` — unaffected by 50, but must not be regressed |

---

## 6. Usage meter — where are "scans used" counted?

### 6.1 Server-side: a single counter column that is **never incremented**

`services/api/src/license.ts` (`GET /license`, mounted at `index.ts:243`):

| Line | Code |
|---|---|
| 45 | `const scansRemaining = Math.max(0, activeSerial.deviceMax - activeSerial.devicesBound);` |
| 54–56 | `deviceScanEntitlement: activeSerial.deviceMax,` · `scansUsed: activeSerial.devicesBound,` · `scansRemaining` |
| 36–38 | fallback (no serial): hardcodes `deviceScanEntitlement: 3, scansUsed: 0, scansRemaining: 3` |

**Where `devices_bound` is written — exhaustive search of `services/`:**

| Line | Operation |
|---|---|
| `admin.ts:533` | `devicesBound: 0` — **the only write, at serial creation** |
| `admin.ts:79` | read (serial JSON) |
| `admin.ts:188` | read (CSV header list) |
| `license.ts:45`, `license.ts:55` | read |

> **Finding (material): there is no `UPDATE ... devices_bound = devices_bound + 1` anywhere.** The server-side usage meter is **dead** — it always reports `scansUsed = 0` for every serial, because nothing ever increments it.

### 6.2 Debit / transaction table: **DOES NOT EXIST**

A grep of `database/` for `transaction|debit|ledger|usage|audit|host_binding|payment|communication|approve|decision` returned **exactly one hit**: `payment_noted` (a text column).

**No ledger, no debits table, no transactions table, no usage table exists server-side.**

### 6.3 Where scans are *actually* counted — client-side, three unreconciled sources

1. **Web customer shell (client React state):** `apps/web/src/site/CustomerDesktopShell.tsx`
   - `:76-77` `scansUsed: props.reports.length`, `scansRemaining: Math.max(0, 25 - props.reports.length)`
   - `:100` `scansRemaining: 25`
   - `:304` `const newUsed = prev.scansUsed + 1;` → `:308-309` `scansUsed: newUsed, scansRemaining: newRemaining` — **optimistic local mutation, never persisted**
   - `:321` `scanNumber: license.scansUsed + 1`
2. **Desktop offline ledger:** `ledger.jsonl` events (`SCAN_DEBITED`, `SCAN_COMMITTED`) + `entitlement.json` debits — a **local file**, not the database.
3. **Server `mobile_serials.devices_bound`** — never incremented (§6.1).

🔴 **Three sources of truth, none reconciled.** Additionally, the server **conflates two different concepts**: the column is named `devices_bound` (device *bindings*) but is exposed as `scansUsed` (scans *consumed*), and `scansRemaining = deviceMax - devicesBound` therefore treats a device binding as a consumed scan. Plan §50-style debit semantics (as the brief assumes) have **no server-side implementation at all**.

---

## 7. Gap analysis vs the plan's acceptance criteria (real anchor: **§9 T-01..T-15**, not §68)

Plan L394: `ACCEPTANCE = T-01..T-15 green in preview + P6 smoke signed + freeze recorded` — **15 criteria, not 21.**

| ID | Criterion (§9, verbatim intent) | Status | Evidence |
|---|---|---|---|
| **T-01** | Queue lists only `PENDING_VERIFICATION` by default; paging stable | ❌ **MISSING** | No queue route. `GET /admin/serials` (463) returns **all** rows, `orderBy(desc(createdAt))`, **no state filter, no paging** |
| **T-02** | Detail bundle matches frozen report snapshot | ❌ **MISSING** | No `GET /admin/licences/:id` route at all |
| **T-03** | Verify writes once; replay returns original `checked_at` (200) | ❌ **MISSING** | No verify route; no `licence_verification_events` table |
| **T-04** | Approve from non-`VERIFIED` ⇒ 409/422 | ❌ **MISSING** | No state machine. `/issue` only guards `REVOKED`→409 (556–558) and `ISSUED`→replay (559–564). There is no `VERIFIED` state to enforce |
| **T-05** | Approve happy path: decision + serial + key + audit + notify in **ONE tx** | ❌ **MISSING** | `/issue` is **not transactional**: `SELECT` (550–554) → **`sendLicenceEmail` network I/O** (566–573) → `UPDATE` (582–593). No `db.transaction`. No audit table. **Email is sent BEFORE the status commit** → if the `UPDATE` fails, the customer holds a key for a serial still `PENDING`; a retry re-emails (non-idempotent notify) |
| **T-06** | Replay same `Idempotency-Key` ⇒ 200 original `decided_at`; conflict ⇒ 409 | ⚠️ **PARTIAL** | **Implicit, state-keyed** replay only: `:559-564` returns `{replayed:true}` if already `ISSUED`; `:556-558` ⇒ 409 if `REVOKED`. **No `Idempotency-Key` header handling anywhere**, and no conflicting-decision detection |
| **T-07** | Dishonest verdict ⇒ approve 422 + button disabled + audit row | ❌ **MISSING** | No honesty verdict enters the issuance path; no audit row possible |
| **T-08** | `PARTIAL` coverage ⇒ approve 422 | ❌ **MISSING** | No coverage verdict concept in issuance |
| **T-09** | Ops bearer w/o token ⇒ **503**; wrong token ⇒ **401** | ✅ **PRESENT** | `admin.ts:131-133` (503 when `ADMIN_API_TOKEN` unset), `admin.ts:136-138` (401 on mismatch) |
| **T-10** | Windows admin cookie ⇒ 403 + audit `auth.windows_cookie_rejected` | ⚠️ **PARTIAL / partly N/A** | The Worker has no Windows-cookie concept (that is an Erase-desktop artefact). `isAdminHost()` is **client-side only** (`hosts.ts`). No audit table ⇒ no row possible |
| **T-11** | `mobile_serials` untouched by Windows flows; keys parseable as 1-device mobile keys | ✅ **DE FACTO HOLDS** | Desktop/Windows never writes `mobile_serials` (writes are `admin.ts:533`/`582` only); keys parse via `parseLicenceKey` (`licenceKey.ts:76`) and are pinned by `licenceKey.test.ts` |
| **T-12** | Notify exactly once per decision id; preview `devCode` visible; **production response contains no code/key material** | ⚠️ **PARTIAL** | Email sent once inside `/issue` (`emailedAt` `:588`); production guard `:574` (`!mail.sent && API_ENV === "production"` ⇒ 502, not issued). **But** there is no decision id (no decisions table), and `jsonSerial()` returns `publicNumber` — the **full key** — in bulk responses (`admin.ts:63`, `:474`) |
| **T-13** | Report view serves frozen snapshot only; no second source of truth | ✅ **PRESENT** | Report freeze/write-once is implemented (G6; `reports`/`report_manifests`, `frozen_at` write-once, migration 0003) |
| **T-14** | Rate limits: 6th approve/min ⇒ 429 + audit row | ❌ **MISSING** | No rate limiting on any `/admin/*` route |
| **T-15** | CORS: admin origin allowed; foreign origin blocked; credentials only for admin | ✅ **PRESENT (with caveats)** | `origins.ts:16-21` allowlists Pages project `cyvoriq-admin`; `origins.ts:57` allows `*.cyvoriq.co.in` (⇒ `admin.cyvoriq.co.in`); `origins.ts:55` requires `https:`; missing/unknown origin ⇒ `false` (`:43`, `:67`) |

**Score: 4 PRESENT · 3 PARTIAL · 7 MISSING · 1 N/A-ish.**
**The plan's own stated acceptance rule (T-01..T-15 green) is not met — 7 of 15 criteria have no implementation, and the two defining features of the design (VERIFY + APPROVE/REJECT decision state machine, and an append-only audit log) are entirely absent.**

### 7.1 CORS caveats (T-15)

- `origins.ts:11-14` allows `http://localhost:5173` / `127.0.0.1:5173`, but plan §5.6 L278 specifies `http://localhost:8787` — **mismatch**.
- `origins.ts:59-60` still allowlists Erase hosts `admin.cyvra.co.in` and `accounts.cyvra.co.in`; the file's own header (L6–7) says these must be removed at Phase 5 of the migration audit. **Still present.**
- Whether `Access-Control-Allow-Credentials` is restricted to `admin.cyvoriq.co.in` specifically is **UNKNOWN** from this pass — it is set in `index.ts` (not read in full during this reconnaissance).

---

## 8. Phase-1 file-level work packages & migration risks

### 8.1 Proposed work packages (file-level, ordered by dependency)

| WP | Scope | Files |
|---|---|---|
| **WP-0** | **Freeze + premise reconciliation (NO CODE).** Record that plan §5.4's `0005` is consumed → renumber to **0006**. Record `apps/admin` → `apps/web`. Resolve plan decisions **D-1..D-6** (§11) before any schema work | `docs/admin-cyvoriq-upgrade-plan.txt` (stays local/untracked) |
| **WP-1** | **Schema migration `0006`.** Add `licence_verification_events`, `licence_decisions`, `mobile_admin_sessions`, `admin_audit_log`. Add `scope` to `staff_sessions` (or new scoped-session table). Append-only grants on `admin_audit_log`. **Audit-first:** `SELECT DISTINCT device_max FROM mobile_serials` before any `CHECK` constraint | `database/src/schema.ts` (350 L, add 4 tables) · **new** `database/migrations/0006_*.sql` · `database/migrations/meta/_journal.json` |
| **WP-2** | **Worker routes.** `/admin/session/*`, `/admin/licences`, `/admin/licences/:id`, `/admin/licences/:id/verify`, `/admin/licences/:id/approve`, `/admin/licences/:id/reject`, `/admin/audit`. Idempotency-Key handling + error contract 401/403/404/409/422/429/503 (plan §5.3) | **new** `services/api/src/licences.ts` (or extend) · `services/api/src/admin.ts` · `services/api/src/index.ts:244` mount |
| **WP-3** | **Transactional approve.** Wrap decision+serial+key+audit+notify in one transaction; **move `sendLicenceEmail` out of the pre-commit path** (fixes T-05 / double-email risk). Reuse `uniqueLicenceKey` (`admin.ts:149-165`) inside the tx and roll back cleanly on throw | `services/api/src/admin.ts:542-595` (`/issue`), `:149-165` |
| **WP-4** | **Rate limiting + CORS tightening.** 5 decision POSTs/min/session, 20 GETs/min, 10 OTP/hour/email (plan §5.6). Reconcile `localhost:5173` vs `:8787`. Remove Erase origins when Phase 5 gates | **new** limiter module · `services/api/src/origins.ts:11-14`, `:59-60` |
| **WP-5** | **Session scope + credential hygiene.** Add `scope='mobile-admin'`; **stop returning the raw session token in the `/auth/verify` body** (`admin.ts:314`) | `services/api/src/admin.ts:301-316` · `database/migrations/0006_*` |
| **WP-6** | **Admin UI S1–S7.** Queue, detail+verification bundle, VERIFY/APPROVE action bar with disabled tooltips, reason modal (≥10 chars), decision log, audit view — **built inside `apps/web`, not a new `apps/admin`** | `apps/web/src/site/AdminApp.tsx` (879 L) · `apps/web/src/api.ts` · `apps/web/src/App.tsx:55` |
| **WP-7** | **Slab 1-50** (if in scope for Phase 1) — strictly additive, both sources of truth, tests | `services/api/src/licenceKey.ts:19`,`:24`,`:67`,`:128` · `services/api/src/admin.ts:500` · `apps/web/src/site/AdminApp.tsx:469-490` · `services/api/test/licenceKey.test.ts` |

### 8.2 Migration risks to the **LIVE issuance flow**

| # | Risk | Severity | Detail |
|---|---|---|---|
| **A** | 🔴 **Migration `0005` collision** | **CRITICAL** | Plan §3.1 L79 / §5.4 / §P1 / §10.2 all reference `0005`. Repo already has `0005_mobile_licences.sql` (staff tables + 13 columns). Running the plan's `verify 0005` on Neon would **pass against the WRONG migration** and mask that the four new tables were never created. **Renumber to `0006`; re-verify against `migrate-neon.sh` with `DATABASE_URL_DIRECT` only (never 127.0.0.1 / `-pooler`).** |
| **B** | 🔴 **`issue` is non-atomic and emails before commit** | **HIGH** | `admin.ts:566-573` sends mail, then `:582-593` updates status. Failure between them ⇒ key delivered for a non-`ISSUED` serial; retry ⇒ **second email** (plan T-12 "exactly once" violated). Any refactor must invert this order. |
| **C** | 🟠 **State-machine change touches every `status` consumer** | **HIGH** | `SerialStatus` is a 3-value union (`admin.ts:39`). Introducing `PENDING_VERIFICATION`/`VERIFIED`/`APPROVED`/`REJECTED` changes `jsonSerial`, CSV export, `GET /serials`, `POST /serials`, `/issue` guards, `/revoke`, and the frontend status chips. A missed site silently mis-renders or mis-guards live rows. |
| **D** | 🟠 **Live `POST /admin/serials` + `/issue` are the production path today** | **HIGH** | No `/approve` exists — operators currently use `/issue` directly. If `/issue` is re-gated behind `VERIFIED`, **existing operator muscle-memory and any automation break on deploy**. Need a compatibility window or a 409 with an explicit message. |
| **E** | 🟠 **Three Pages projects share one bundle** | **MEDIUM** | `wrangler.cyvoriq-admin.jsonc:3` = "Same apps/web bundle as cyvoriq-www". Plan §10.7 rollback ("Pages rollback to previous direct upload") would **roll back the public www site too**. Rollback must be per-project and tested; admin UI bugs ship to `cyvoriq-www` simultaneously. |
| **F** | 🟡 **Idempotency-Key requires a unique index** | **MEDIUM** | `licence_decisions.idempotency_key UNIQUE` (plan L245). Adding a unique index to a live table can fail on existing rows — audit first. Today there is **no** idempotency-key handling at all, so no backfill concern, only new-table concern. |
| **G** | 🟡 **`uniqueLicenceKey` throw inside a transaction** | **MEDIUM** | `admin.ts:164` throws after 12 attempts. Inside WP-3's transaction this must roll back all prior writes, or plan risk **R-4 (double-issue race)** materialises. |
| **H** | 🟡 **Slab 1-50 subtractive-edit hazard** | **MEDIUM** | See §5.3 — a "cleaned up" regex/list breaks live `-1-3`/`-1-7` keys. Guard: `licenceKey.test.ts:43-44`. |
| **I** | 🟡 **No `scope` on sessions ⇒ plan's 403 unimplementable** | **MEDIUM** | `staff_sessions` has no `scope` column; scope-mismatch rejection (plan L227-228) needs WP-1/WP-5 first. |
| **J** | 🟡 **No audit table ⇒ T-10/T-14/T-07 audit rows impossible** | **MEDIUM** | Three acceptance criteria require an audit row that cannot exist until WP-1 lands. Phase ordering is therefore forced: **WP-1 → WP-2 → WP-4**. |
| **K** | 🟡 **Freeze culture** | **Process** | Plan §12 L439–444: no commit/push of plan artefacts before gate; no deploy before P0 sign-off; **"Do not start G8"** remains in force; this slice is ADMIN only. |

### 8.3 Suggested Phase-1 sequence

`WP-0 (freeze, D-1..D-6, renumber 0006)` → `WP-1 (schema 0006 + audit-first SELECTs)` → `WP-2 (routes + error contract)` → `WP-3 (transactional, notify-after-commit)` → `WP-4 (rate limit + CORS)` → `WP-5 (scope + credential hygiene)` → `WP-6 (UI)` → `WP-7 (slab 1-50, optional)`.

Each WP gated by the plan's entry/exit-gate discipline (§0.2) and by the existing test gates.

---

## 9. UNKNOWN / RESTRICTED (explicit non-claims)

| Item | Status |
|---|---|
| Live DB contents of `Neon floral-art-*` / any row counts | **RESTRICTED** — not queried; read-only repo analysis only. No connection identifiers reproduced here (plan file is local/untracked) |
| Whether `ADMIN_API_TOKEN` is currently set in production, and its value | **UNKNOWN** — never read; no credential is reproduced in this document |
| Resend production sending status / domain verification state | **UNKNOWN** — only the code path (`admin.ts:250-251`, `:574`) and `email.ts:84`'s own error text were read |
| `Access-Control-Allow-Credentials` exact policy in `index.ts` | **UNKNOWN** — `origins.ts` was read in full; `index.ts` was only grepped for `.route` |
| Whether a `CHECK` constraint on `device_max` exists in the **live** DB (vs migrations) | **UNKNOWN** — absent from migrations 0000–0005; live state not queried |
| Whether `cyvoriq-admin` Pages project has actually been **created/deployed** | **UNKNOWN** — config file exists; no `wrangler pages project list` was run (would be a network/deploy operation) |
| Whether the plan's §5.4 four tables exist on Neon under a different migration number | **UNKNOWN** — repo migrations 0000–0005 contain none of them |
| The brief's "21 acceptance criteria" | **ABSENT (brief premise)** — see §0 and §7 |

---

## 10. Summary scorecard

| Deliverable | Headline finding |
|---|---|
| 1. App / framework / Pages | **`apps/admin` does not exist.** Admin UI = host-gated `AdminApp.tsx` inside `apps/web`. Three Pages projects (`cyvra-mobile`, `cyvoriq-www`, `cyvoriq-admin`) all deploy the **same** `./dist` bundle |
| 2. Endpoints / generator / signing | 12 admin routes. **create ✅ · issue ✅ · revoke ✅ · approve ❌(folded into `/issue`) · resend ❌ · suspend ❌.** Generator = `CYVRA…hex4-1-max` + 12-attempt uniqueness loop. **Signing mechanism: NONE — no HMAC/Ed25519 in any `.ts`; validity is a DB lookup** |
| 3. Schema vs §50 | **No §50.** Real anchor §5.4. Of the 7 named tables: **1 present (`staff`), 4 partial, 2 missing** — and **all 4 of the plan's own §5.4 tables are missing**. **14 tables total; `0005` already consumed** |
| 4. `@cyvoriq.com` server-side? | **YES — 3 enforcement points + per-request re-validation** (`admin.ts:224`, `:228`, `:298`, and `:113`). `X-Admin-Email` is **not** trusted (`:139-145`). Caveat: raw session token returned in `/auth/verify` body (`:314`) |
| 5. Slabs + 1-50 | `licenceKey.ts:19`. **Dual source of truth** (array *and* regex alternation) + 6 call sites + 10 with tests/DB. **Additive change is grandfather-safe**; hazard is any *subtractive* "cleanup", guarded by `licenceKey.test.ts:43-44` |
| 6. Usage meter | **Dead server counter.** `devices_bound` is written once (`=0`) and **never incremented**. **No debit/transaction/ledger table exists.** Scans counted in **3 unreconciled places** (web client state, desktop `ledger.jsonl`, server counter), and `devicesBound` is conflated with `scansUsed` |
| 7. vs acceptance criteria | **No §68 / no 21 criteria.** Real set = **T-01..T-15 (15)**: **4 present · 3 partial · 7 missing.** The two defining features (VERIFY + APPROVE/REJECT decision machine, append-only audit log) are **entirely absent** |
| 8. Phase-1 packages / risks | 7 work packages (WP-0..WP-7). **Risk A (migration `0005` collision) is CRITICAL**; Risk B (`issue` emails before commit) is HIGH and already a live correctness defect |

---

*Read-only reconnaissance. No files modified other than the creation of this document. Nothing committed.*
