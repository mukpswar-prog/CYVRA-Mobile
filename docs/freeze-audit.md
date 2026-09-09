# Freeze audit + main-coding plan (awaiting approval)

**Status:** SAVE POINT. Do **not** freeze-and-code until this file is approved.  
**Date:** 9 September 2026  
**Governing law:** [GUIDELINE.md](../GUIDELINE.md) (also [docs/GUIDELINE.md](./GUIDELINE.md)).  
**Branch:** `cursor/g0-g3-mobile-slice-7474`

This document is the break save. It restudies the freeze rules, audits what is
live versus G0–G10, and proposes the first main-coding slices. **No G4+ code
starts until you say go.**

---

## 1. What “freeze” means here

Three different freezes. They are not the same action.

| Freeze | Meaning | When |
|---|---|---|
| **Erase freeze** | Do not rebuild Windows Erase, `cyvra-www`, `cyvoriq-erase-api`, Knox, Station, or Approvals. | Always |
| **G0–G3 save** | Lock the current pipe (Pages + Worker + Neon auth) as the baseline. Resume dashboard DNS later. | Now |
| **Main-coding freeze** | After approval, lock the evidence contract (G4) **before** Android / Report PDF / admin / www. | After you approve §7 |

Guideline §9 and §5 are the compliance freeze. Software must not offer lock/FRP
bypass, root, unrestricted ADB, or invented grades.

---

## 2. Hard rules (will not be coded around)

From GUIDELINE §2–§9 and the 9 Sep freeze plan:

1. Code lives only in `mukpswar-prog/CYVRA-Mobile`. No folders in Erase.
2. Cloudflare account `5a3eeb2b3d42726a8ba08732464a0eda` — **new** Pages/Worker/Hyperdrive only. Never `cyvra-www`, `cyvoriq-erase-api`, `cyvra-approvals`.
3. Neon `floral-art-02749206` is the mobile SoT. Do not reuse Erase Neon or Hyperdrive `cyvra-erase-neon-production`.
4. Resend from the Worker only. Domain `cyvra.co.in` is already Verified. Do not merge Windows OTP into mobile.
5. Customer web is `mobile.cyvra.co.in` (today: `cyvra-mobile.pages.dev`). Optional API host `api-mobile.cyvra.co.in`. **Not** `api.cyvra.co.in`.
6. No second admin host. G7 is a **CYVRA Mobile** section on existing `admin.cyvra.co.in` / `accounts.cyvra.co.in` (same login, super admin `ceo@cyvoriq.com`).
7. www is a **link** last (G8). No Journey B inside `cyvra-www`. No OTP form on www.
8. Lifecycle: verification → Report 1 → separate sanitization auth → wipe → Final Report. Report 1 ≠ wipe.
9. USB / QR / ADB-visible ≠ authorization. No lock/FRP bypass. No root as workflow.
10. Detect, don’t assume. `NOT_AVAILABLE` / `NOT_SUPPORTED` / `NOT_TESTED` / `PERMISSION_DENIED` are not FAIL.
11. No IMEI / battery SOH / Knox as S1 claims. No forensic chain-of-custody claim.
12. Station (G9) only after Decision **5.1.20.2**. Knox/S3 (G10) only with a real contract path.
13. Secrets never in Git. No `DATABASE_URL` on Pages. No browser Resend/Neon.
14. Tablet is the same product; tests are feature-based, not “this is a phone.”

---

## 3. Quick audit — gates vs live

| Gate | Guideline deliverable | Audit |
|---|---|---|
| **G0** | Guideline in `docs/`. Repo private. GitHub description fixed. | Guideline is in repo root and `docs/`. Repo is private. Description is still `Mobile hardware scanner & reporting` (`gh` is read-only here). |
| **G1** | Pages `cyvra-mobile`, Worker `cyvra-mobile-api`, Hyperdrive `cyvra-mobile-neon` → Neon, Resend verified | **Live.** Pages, Worker, Hyperdrive id `db31fc8dafca49b29172da7046b97175`, Neon `floral-art-02749206`. Resend `cyvra.co.in` Verified. Pages Git **not** connected (API `8000069`). Hyperdrive origin still uses Neon `-pooler` (works; Workers guide prefers **direct**). |
| **G2** | `users` / `email_otp_challenges` / `sessions`. `/health`, `POST /auth/request`, `POST /auth/verify` | **Live.** Neon tables exist. Worker `/health` = `status=ok`, `env=preview`, `database=connected`. Preview may still return `devCode` until `API_ENV=production`. Full guideline tables (`device_lifecycles`, `evidence_records`, …) are **not** created yet — by design. |
| **G3** | Registration on Pages preview, then `mobile.cyvra.co.in`. Honest empty home. Name + pincode mandatory. | **Preview live.** Signed-in on `https://cyvra-mobile.pages.dev`. Custom domain **DNS not created**. Copy says logins are separate from Windows. No fake grades. |
| **G4** | Evidence JSON Schema + capability contract v1 in `packages/evidence` | **Not started.** Package is enums only (`PASS`/`FAIL`/…, sources, coverage). No JSON Schema, no test catalog, no digest, no profile snapshot. |
| **G5** | S1 Android on **one** owned Samsung | **Not started.** No `apps/android`. |
| **G6** | Render Report 1 from a frozen manifest | **Not started.** No report engine, no PDF, no manifest freeze. |
| **G7** | Mobile section on existing admin/accounts | **Spec only** (`docs/admin-mobile-section.md`). Erase `admin-frontend` is another repo. CORS already allowlists those hosts. |
| **G8** | Thin `cyvra-www` tab → `mobile.cyvra.co.in` | **Plan only** (`docs/www-mobile-button.md`). **Last.** Do not do this before custom domains exist. |
| **G9** | Decision 5.1.20.2 then Station | **Forbidden until decision.** No `apps/station`. |
| **G10** | S3 Knox / UEM | **Forbidden until S1 reports + real contract.** |

### Code vs guideline gaps (not bugs)

- `packages/evidence` stub omits `PERMISSION_DENIED` as a result, while §5 lists it as not-FAIL. G4 must resolve: result enum vs limitation code.
- Schema has auth tables only. Guideline §6.3 lists organizations, device lifecycles, evidence, reports, sanitization events. Those belong with G4 types then G5 ingest — not all at once.
- README still says Resend is pending / `devCode`. Resend domain is Verified; Worker has `RESEND_API_KEY`. `API_ENV` is still `preview`.
- GitHub description not updated (G0 leftover).
- Neon password was pasted in an earlier chat; rotation may still be pending (dashboard, not this repo).

### Bound live IDs (no secrets)

| Resource | Value |
|---|---|
| Pages | `cyvra-mobile` → `https://cyvra-mobile.pages.dev` |
| Worker | `cyvra-mobile-api` → `https://cyvra-mobile-api.mukpswar.workers.dev` |
| Hyperdrive | `cyvra-mobile-neon` → `db31fc8dafca49b29172da7046b97175` |
| Neon | `floral-art-02749206` / `neondb` / `neondb_owner` |
| Worker env | `API_ENV=preview`, `APP_ORIGIN=https://cyvra-mobile.pages.dev` |
| Pages env | `VITE_API_URL=https://cyvra-mobile-api.mukpswar.workers.dev` (no `DATABASE_URL`) |

---

## 4. Dashboard leftover (human clicks, not main coding)

Resume this **when you are back**, still before or in parallel with G4. Order:

1. Pages project **`cyvra-mobile` only** → Custom domains → `mobile.cyvra.co.in`. Do **not** add that name on the Worker.
2. Worker `cyvra-mobile-api` → Custom domain `api-mobile.cyvra.co.in`.
3. Pages `VITE_API_URL=https://api-mobile.cyvra.co.in` and **rebuild** (Vite bakes at build).
4. Keep `API_ENV=preview` until a real OTP email arrives with no `devCode` needed.
5. Then `API_ENV=production` and `APP_ORIGIN=https://mobile.cyvra.co.in`. Production never returns `devCode`.
6. Connect Pages Git in the dashboard (`8000069` blocks API attach).
7. Optional: Hyperdrive origin host **without** `-pooler`. Rotate leaked Neon password, then confirm `/health` is still `database=connected`.
8. **Last (G8):** thin www nav Windows \| Mobile \| Tablet **links**. Erase repo, not this one.

Click-paths: [dashboard-configure.md](./dashboard-configure.md), [neon-cloudflare.md](./neon-cloudflare.md).

---

## 5. Proposed main-coding order (after approval)

Guideline first-code order after G3: evidence contract → S1 on one Samsung → Report 1 → (later) Station → tiny www tab last.

### Step 1 — G4 freeze (first coding slice)

**Where:** `packages/evidence` only (+ tests). GitHub. No Android. No PDF. No www. No admin UI. No new Cloudflare resources.

**Why first:** S1, Report 1, Station, and admin all consume the same vocabulary. If we invent tests in the app first, reports will lie.

**Build:**

1. JSON Schema (Draft 2020-12) for:
   - `capability_contract` v1 (data-driven rules; **not** `if (model === "S21")`)
   - `capability_profile` snapshot (access level, USB state, ADB state independent, features declared vs detected vs tested)
   - `evidence_record` (immutable raw; `COLLECTED_AT`; source; result; `TEST_ID`; limitation)
   - `evidence_batch` (idempotent sync envelope)
   - `report_manifest` **shape** (freeze happens at G6; G4 only defines the type)
2. Stable IDs: `PROCESSING_SESSION_ID` ≠ `DEVICE_LIFECYCLE_ID` ≠ `EVIDENCE_ID` ≠ `REPORT_ID`.
3. Canonicalize-then-digest helper. Hash canonical bytes, never pretty-printed JSON. Do not replace `COLLECTED_AT` with sync time.
4. Result rules: only explicit `FAIL` is a failure. `NOT_AVAILABLE` / `NOT_SUPPORTED` / `NOT_TESTED` / `CANCELLED` / `PERMISSION_DENIED` never coerce to FAIL.
5. Conflict rule encoded as data: preserve + compare; summary preference S3 → S2 ADB → S2 Station → S1 → observation; human review is a **new** record.
6. S1 v1 **test catalog** for Report 1’s seven domains, Samsung-first, feature-based:
   - Identity & configuration
   - Physical condition (observation placeholders; no invented grades)
   - Hardware configuration
   - Functional verification (camera, display, touch, audio, mic, vibration, sensors)
   - Connectivity (Wi-Fi / Bluetooth / network classification)
   - Power / battery **status** / storage (no SOH claim)
   - Security / access / limitations
7. Each test: `TEST_ID` + user-friendly name + objective name. UI copy is not the database key.
8. Coverage labels `COMPLETE` / `LIMITED` / `PARTIAL` — not quality grades.
9. Access levels L0–L4. Capability ≠ test result. UI language later: “Ready to test”, not PASS before the test runs.
10. Package tests: schema validates fixtures; non-failure results stay non-failure; digest is stable; missing evidence cannot become PASS.

**Explicitly out of G4:** Kotlin app, Worker evidence ingest, Neon evidence tables, PDF, sanitization events, Station protocol (`EXECUTE_COMMAND` remains forbidden forever), Knox, IMEI, OEM catalog UI.

### Step 2 — G4.5 schema tables (only if you want them before Android)

Add Drizzle tables that G5 upload needs: `device_lifecycles`, `capability_profiles`, `capability_contracts`, `processing_sessions`, `test_runs`, `evidence_records`, `evidence_batches`. No sanitization tables. No report PDF rows yet (`reports` / `report_manifests` can wait for G6).

**Default recommendation:** skip G4.5 until G5 so G4 stays a reviewable contract with no production migration risk.

### Step 3 — G5 S1 Android (one owned Samsung)

`apps/android`: normal APIs, least privilege, permission at test start, offline store + sync queue, upload to `cyvra-mobile-api`. Denied permission = limitation. Hardware absent = `NOT_SUPPORTED`. Then one Samsung tablet. Do not ship “all Galaxy” from one device.

### Step 4 — G6 Report 1

Worker + web render **CYVRA Device Verification Report** from a **frozen** manifest. PDF is a view. Neon evidence is SoT. Withhold / LIMITED where due. Numbering `CYVRA-R1-<YEAR>-<UNIQUE>`. Non-goals: sanitization done, OEM authority, ownership, warranty, “certified perfect.”

### Step 5 — G7 admin section (Erase repo)

Thin **CYVRA Mobile** button on existing admin/accounts. Serial records in mobile Neon via `cyvra-mobile-api`. Do not copy Windows licence tables. Do not point customers at `api.cyvra.co.in`.

### Step 6 — G8 www link (last)

Erase `cyvra-www` nav only. Mobile and Tablet **navigate** to `https://mobile.cyvra.co.in`. Windows Get Started / OTP / download untouched.

### Later — G9 / G10

Station after 5.1.20.2. Knox after S1 reports + a real enterprise path.

---

## 6. What we will not do in the next coding session (even after approval)

- Touch Erase, `cyvra-www`, `cyvoriq-erase-api`, `cyvra-approvals`, Station, Knox, Android (until G5 is the approved slice).
- Attach `mobile.cyvra.co.in` to the Worker.
- Put `DATABASE_URL` on Pages.
- Flip `API_ENV=production` from code.
- Merge Windows and mobile OTP.
- Invent grades, IMEI, SOH, Knox, or sanitization claims.
- Start `apps/station` or `packages/cyvra-evidence-protocol` USB/ADB command channel.
- Pretty marketing copy in the evidence package.

---

## 7. Approval checklist (reply to start)

Reply with go / change, then we freeze G4 and start coding **only** that slice.

- [ ] **A.** G0–G3 save is accepted. Dashboard DNS stays paused until you return to it.
- [ ] **B.** First coding slice is **G4** in `packages/evidence` (schema + contract + S1 test catalog + digest + tests). No Android in that slice.
- [ ] **C.** Skip Neon evidence tables until G5 (**recommended**) — or do G4.5 tables immediately after G4.
- [ ] **D.** `PERMISSION_DENIED` is a first-class non-failure (limitation or result — decide in G4, do not map to FAIL).
- [ ] **E.** Do **not** start G7/G8/G9/G10, www rewrite, or Erase admin in this repo.

Until those boxes are ticked in chat, this agent waits.
