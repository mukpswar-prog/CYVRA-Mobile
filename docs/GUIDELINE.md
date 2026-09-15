# CYVRA Mobile Evidence — Engineering Guideline (governing)

**Status:** GOVERNING. This is the execution law for the mobile product.  
**Date:** 8 September 2026, **amended 10 September 2026** (domain cutover: `cyvoriq.co.in`).  
**Company:** CYVORIQ Solutions Pvt. Ltd.  
**Platform:** CYVRA  
**Product GitHub:** https://github.com/mukpswar-prog/CYVRA-Mobile  

This file is the single guideline an engineer should follow before writing code. Older analysis notes remain useful history. If they conflict with this file, **this file wins**.

---

## 0. Conclusion (read this first)

CYVRA Mobile Evidence is a **new product** on a **new GitHub**, a **new Cloudflare Pages/Worker pair**, a **new Neon project**, and **Resend for mobile transactional email**. It shares the CYVRA evidence language with Windows Erase. It does **not** share Erase’s repository, Worker, admin host, or database.

| Bound system | What it is | What we do with it |
|---|---|---|
| GitHub | https://github.com/mukpswar-prog/CYVRA-Mobile | **Only** source of truth for mobile code and this guideline. Empty today except a one-line README. |
| Cloudflare | Account `5a3eeb2b3d42726a8ba08732464a0eda` | Same **account** as Windows. **New** Pages + Worker + Hyperdrive + DNS. Never reuse `cyvra-www`, `cyvoriq-erase-api`, `cyvra-approvals`. |
| Neon | Project `floral-art-02749206` | **Authoritative** Postgres for mobile users, sessions, evidence, reports. Not the Windows database. |
| Resend | https://resend.com/emails | **Transactional** mail. Today `cyvra.co.in` (Verified). Target From domain after cutover: `cyvoriq.co.in`. Not marketing. Not called from the browser. |

**Do not rename** `cyvra-approvals` into this product. **Do not put folders in** `mukpswar-prog/Erase`. **Do not point mobile login at** `api.cyvra.co.in`.

**Amendment 11 Sep 2026 (ops licences):** Mobile licence keys are parseable: `CYVRA{dd}{mm}{yyyy}{S|B}{hex4}-1-{1|3|5|7|25}` (example `CYVRA11092026SA3F1-1-1` for single-user, one device). Super admin is `ceo@cyvoriq.com`. Only `@cyvoriq.com` operators nominated by the CEO can sign in. The key is emailed to the customer’s verified inbox only. Same key, same brand, up to the slab. Ops UI: [docs/admin-scope-freeze.md](docs/admin-scope-freeze.md).

**Amendment 14 Sep 2026 (Android freeze accepted):** The CEO freeze is engineering law for the **Android product path** only. It does **not** unfreeze public www, live API, OTP, `API_ENV`, Station, Knox, or Erase. Pins: Kotlin **2.3.21**, AGP **8.13.2**, Gradle **9.1.0**, JDK **21**, compileSdk/targetSdk **36**, Android-component minSdk **26**. Windows host is the orchestrator; USB → controlled ADB; APK is a supporting component. G5 is no longer “Samsung APK only.” Station Decision **5.1.20.2** stays parked — do not create `apps/station`. Start: [docs/resume-android-freeze.md](docs/resume-android-freeze.md). Map: [docs/ANDROID_COMPATIBILITY_FREEZE.md](docs/ANDROID_COMPATIBILITY_FREEZE.md). Full text: [docs/CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md](docs/CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md). Review notes (history): [docs/android-version-stack-review.md](docs/android-version-stack-review.md).

**Amendment 11 Sep 2026:** Public `www.cyvoriq.co.in` is frozen. Overnight save / morning start: [docs/resume-g8-freeze.md](docs/resume-g8-freeze.md). Next is G7 inbox proof, then G5 on one owned Samsung. Do not start Station or Knox.

**Amendment 10 Sep 2026 (management):** Mobile Evidence’s public and ops hosts move to **`cyvoriq.co.in`** (new Cloudflare zone on the same account). Not a subdomain of `cyvra.co.in`. No Erase repo changes. Same Neon `floral-art-02749206`. Do not delete `mobile.cyvra.co.in` until the new origin is proven. Detail: [docs/cyvoriq-co-in-cutover.txt](docs/cyvoriq-co-in-cutover.txt).

**First code (when you say go), in this order:**

1. Put this guideline and repo skeleton into `CYVRA-Mobile`.
2. Neon schema (users + sessions) + Cloudflare Worker + Hyperdrive.
3. Customer web on `mobile.cyvra.co.in`: registration first, via Resend.
4. S1 Android app on one Samsung phone you own.
5. CYVRA Station (Windows bench) only after Decision 5.1.20.2.
6. Public `www.cyvoriq.co.in` (new Pages in this repo). Do **not** rebuild Windows Get Started. Do **not** add a Mobile tab on `www.cyvra.co.in`.

This Cursor session is still the parked **approvals** workspace. Product work belongs in `CYVRA-Mobile`. This agent could **read** the public GitHub repo and could **not** log into Cloudflare, Neon, or Resend from here (no dashboard credentials / MCP auth in this environment). Bind the IDs below; inspect live resources from a session that has those logins.

---

## 1. What was restudied

Approved 8 Sep 2026 baseline plus architecture 5.1.20.4.1–4.8, 5.1.20.5, 5.1.20.6, Samsung S1/S2/S3, USB-first Station strategy, website upgrade plan, GitHub/Cloudflare/Neon master plan, QC feasibility, Windows Reports A/D (Swaroop), prior execution decisions, and CYVORIQ brand notes.

Those documents agree on honesty and compliance. They disagree on **where code lives**. The master plan’s “put it in the existing CYVRA repo” is **rejected**. The 8 Sep baseline and the freeze on Erase are **accepted**.

---

## 2. Product names (locked)

| Name | Meaning |
|---|---|
| CYVORIQ Solutions | Company |
| CYVRA | Platform |
| CYVRA Erase | Windows product — **frozen** |
| CYVRA Mobile Evidence | Android phones **and** tablets — one product |
| CYVRA Station | Professional Windows workstation (S2 orchestrator) |
| CYVRA Enterprise | Later Knox / UEM / OEM — S3 |
| `mobile.cyvra.co.in` | Preview customer web (keep until `www.cyvoriq.co.in` is proven) |
| `www.cyvoriq.co.in` | Approved long-term customer / public web (decision 10 Sep 2026) |
| `admin.cyvoriq.co.in` | Mobile ops (new Pages, not Erase admin) |
| `accounts.cyvoriq.co.in` | Mobile accounts (new Pages, not Erase accounts) |
| `api.cyvoriq.co.in` | Mobile API hostname on Worker `cyvra-mobile-api` |

Tablet is **not** a separate product. Feature discovery decides the test list, not “this is a phone.”

Public site story: two products, two domain families. Windows Erase stays on `cyvra.co.in`. Mobile Evidence lives on `cyvoriq.co.in`.

---

## 3. Lifecycle (locked)

```
DEVICE VERIFICATION
        ↓
REPORT 1  (Device Verification Report — pre-sanitization)
        ↓
SEPARATE SANITIZATION AUTHORIZATION
        ↓
SANITIZATION (only a permitted method)
        ↓
POST-SANITIZATION VERIFICATION
        ↓
FINAL REPORT
```

Verification, sanitization, and post-sanitization are **different evidence stages**. Pairing a Station, plugging USB, or finishing Report 1 does **not** authorize wipe/reset.

### Report names vs Windows Erase

| Windows Erase (keep on Windows) | Mobile Evidence (use these names) |
|---|---|
| Report A — intake / pre-sanitization | Folded into **Report 1** identity + intake |
| Report D — diagnostic / condition | Folded into **Report 1** functional + coverage |
| Report S — sanitization | **Final Report** sanitization chapter only after an authorized job |

Do **not** print “Report A / D / S” on the mobile customer UI. Do **not** issue a sanitization claim because Report 1 exists. Honesty pattern from Windows D still applies: missing required evidence → **withhold / LIMITED / NOT AVAILABLE**, never a guessed grade.

Report 1 official name: **CYVRA Device Verification Report**.  
Numbering concept: `CYVRA-R1-<YEAR>-<UNIQUE>` (exact format at implementation).

Coverage labels (not quality grades): **COMPLETE / LIMITED / PARTIAL**.

---

## 4. Capability layers (not three apps)

```
S1  CYVRA Mobile Evidence app     normal Android APIs, least privilege
S2  CYVRA Station                 USB / local pair + allowlisted ADB
S3  CYVRA Enterprise              Knox / UEM / OEM only with real authority
```

One device lifecycle ID, one evidence schema, one report engine. Sources stay labelled. S2 must not overwrite S1. S3 must not be claimed from S1.

**Build the generic Android core and the CYVRA Mobile Windows host first.** USB-first orchestration belongs to the Mobile host (`apps/host` from slice A3), not CYVRA Station. The Android APK is a supporting device-side component. Decision **5.1.20.2** (Station Windows stack) remains **not** approved — do not start `apps/station` or Knox.

---

## 5. Compliance charter (LOCKED — software must not offer these)

CYVRA processes only legitimate, authorized devices.

**CYVRA does not:**

- break screen locks, guess/bypass PIN/password/pattern
- bypass FRP or remove accounts by unauthorized means
- root as a normal workflow, use exploits, or flash firmware to “get access”
- treat USB, QR pairing, LAN membership, or ADB-visible as authorization
- extract private content (messages, photos, contacts, credentials) for QC
- claim Samsung-authorized, Knox, IMEI authority, or battery SOH in S1
- claim forensic chain of custody by default (say **evidence traceability**)
- convert UNAVAILABLE / NOT_TESTED / NOT_SUPPORTED / PERMISSION_DENIED into FAIL

If legitimate access is missing: **no workflow**. Forgotten PIN ≠ authority.

**USB CONNECTION ≠ DEVICE AUTHORIZATION**  
**QR PAIRING ≠ OWNERSHIP**  
**ADB DETECTED ≠ ADB AUTHORIZED**  
**PAIRING ≠ SANITIZATION AUTHORIZATION**

Sanitization methods (locked): M0 none → M1 owner-assisted reset (guide + record + verify) → M2 Station orchestration → M3 authorized ADB (never from `ADB_UNAUTHORIZED`) → M4 enterprise → M5 OEM/partner.

---

## 6. Bound infrastructure

### 6.1 GitHub — `mukpswar-prog/CYVRA-Mobile`

Inspected 8 Sep 2026 (public API):

| Field | Value |
|---|---|
| URL | https://github.com/mukpswar-prog/CYVRA-Mobile |
| Visibility | **Public** |
| Created | 2026-09-08 |
| Contents | `README.md` only: “Mobile hardware scanner & reporting” |
| Default branch | `main` |
| Default commit | `c36186d13d14b9e2505afbe1a7445487a6713750` |

**Actions:**

1. Use this repo. Do not create a second mobile GitHub. Do not rename `cyvra-approvals`.
2. **Make it private** as soon as you can. This will hold evidence schema, Station protocol, and eventually ADB registry notes. Public is the wrong default for an evidence product.
3. Change the GitHub description to: `CYVRA Mobile Evidence — Android phone & tablet verification, reports, and CYVRA Station`.
4. Connect **Cloudflare Pages Git** to **this** repo, production branch `main`.
5. Open the next Cursor / cloud-agent session **on this repository**, not on approvals.

Monorepo **inside this repo** (new, not Erase):

```
CYVRA-Mobile/
  apps/web/                 customer UI → mobile.cyvra.co.in
  apps/android/             Android component (`:core` JVM + optional `:app` APK)
  apps/host/                CYVRA Mobile Windows host (A3+; not Station)
  apps/station/             CYVRA Station Windows (after 5.1.20.2; still parked)
  services/api/             Cloudflare Worker cyvra-mobile-api
  packages/evidence/        schema, capability contract, protocol
  packages/cyvra-evidence-protocol/
  database/                 Drizzle schema + migrations
  docs/                     this guideline + approved baselines
  .github/workflows/
```

Branching: `main` = production. Feature branches + PR. No experimental mobile code on Erase `main`. No Codespaces (Cursor + Cloudflare). No Vercel.

### 6.2 Cloudflare — account `5a3eeb2b3d42726a8ba08732464a0eda`

Dashboard: https://dash.cloudflare.com/5a3eeb2b3d42726a8ba08732464a0eda/home

Same login as Windows. **New resources only.**

| Resource | Name (create) | Must not be |
|---|---|---|
| Pages | `cyvra-mobile` | `cyvra-www` |
| Worker | `cyvra-mobile-api` | `cyvoriq-erase-api`, `cyvra-approvals` |
| Custom domain | `www.cyvoriq.co.in` (cutover) | `www` / `admin` / `api.cyvra.co.in` |
| Optional preview | `mobile.cyvra.co.in` (keep until cutover) | Erase hosts |
| API host | `api.cyvoriq.co.in` | `api.cyvra.co.in` |
| Ops | `admin.cyvoriq.co.in`, `accounts.cyvoriq.co.in` | Erase `admin` / `accounts` |
| Hyperdrive | `cyvra-mobile-neon` → Neon pooled URL | D1 as evidence SoT |
| Secrets | `RESEND_API_KEY`, session secrets | Windows `CYVRA_ADMIN_SESSION` |

Worker rules (Cloudflare current practice):

- `wrangler.jsonc`, recent `compatibility_date`, `nodejs_compat`
- **Hyperdrive** for Neon (`pg` + `env.HYPERDRIVE.connectionString`). Do not open raw Neon from the browser.
- Secrets via `wrangler secret put`, never in Git
- Observability on; no module-level request state
- Resend **only** from the Worker (Resend API has no CORS on purpose)

Pages: customer web on `www.cyvoriq.co.in` (cutover). Until that zone is
Active, `mobile.cyvra.co.in` remains the working preview. Serial-key /
payment approval is **`admin.cyvoriq.co.in` / `accounts.cyvoriq.co.in`**
(new Pages in this repo, 10 Sep 2026). Super admin `ceo@cyvoriq.com`.
Do **not** add a CYVRA Mobile section on Erase `admin.cyvra.co.in`.
Do **not** copy Windows licence tables; mobile serial records live in Neon
`floral-art-02749206`.

Git flow: feature branch → Pages preview → review → merge `main` → production.

This environment could not run `wrangler whoami` (not logged in). Create Pages/Worker/Hyperdrive from the dashboard or a logged-in machine.

### 6.3 Neon — project `floral-art-02749206`

Console: https://console.neon.tech/app/projects/floral-art-02749206

This project **is** the mobile system of record. Do not create a second “just in case” production DB. Do not put Erase licence tables here.

**Use:**

- **Hyperdrive origin** = Neon **direct** URL (uncheck Pooled; host has **no** `-pooler`). Hyperdrive is the pooler. Do not stack Neon PgBouncer. Native `pg` in the Worker ([Neon Cloudflare Workers](https://neon.com/docs/guides/cloudflare-workers)).
- **Direct** connection also for Drizzle migrations (`DATABASE_URL_DIRECT`)
- Do **not** follow [Neon Cloudflare Pages](https://neon.com/docs/guides/cloudflare-pages) (that puts `DATABASE_URL` on Pages Functions)
- Drizzle as the schema tool; migrations in `database/`
- Neon **branches** for preview/PR schema tests; reset from parent when dirty
- Scale-to-zero is acceptable for v1; first query after idle will be slower

**Do not:**

- Expose `DATABASE_URL` to Pages `NEXT_PUBLIC_*`
- Use Neon Auth as the first login (keep auth in the Worker so Resend OTP and sessions stay one place)
- Store raw customer photos/messages; attachments are evidence objects with integrity refs (R2 later if needed)

Logical tables (align names to 5.1.20.5; first migration may be a subset):

`organizations`, `users`, `roles`, `processing_sessions`, `device_lifecycles`, `capability_profiles`, `capability_contracts`, `test_runs`, `evidence_records`, `evidence_batches`, `reviews`, `reports`, `report_manifests`, `sanitization_events`, `audit_events`, `email_otp_challenges`

IDs are not interchangeable: `PROCESSING_SESSION_ID` ≠ `DEVICE_LIFECYCLE_ID` ≠ `EVIDENCE_ID` ≠ `REPORT_ID`.

This environment could not authenticate `neonctl` or Neon MCP. Confirm region, existing databases, and that the project is empty before the first migration.

### 6.4 Resend — https://resend.com/emails

Resend is how **mobile registration** proves an email. Windows Erase login stays on Erase.

| Rule | Detail |
|---|---|
| Kind | Transactional only (OTP, magic link, later “report ready”). No broadcasts in v1. |
| From | A **verified** CYVRA domain. Not `onboarding@resend.dev` in production (that sandbox only delivers to the Resend account email). |
| Suggested from | `CYVRA Mobile <noreply@cyvra.co.in>` **or** `noreply@mobile.cyvra.co.in` after DNS (SPF/DKIM/DMARC) on the domain you actually send from. The `from` domain must **exactly** match a verified Resend domain. |
| Send path | Worker only. Never the browser. |
| Idempotency | Always. Format `otp/<email-hash>/<challenge-id>`. 24h window. |
| SDK | Node `resend` ≥ 6.14. Check `{ data, error }` — the SDK does not throw API errors. |
| Test addresses | `delivered@resend.dev` / `bounced@resend.dev` / `complained@resend.dev`. Never fake `test@gmail.com`. |
| Webhooks | Verify Svix signatures. Treat bounce/complaint as suppression. |
| Key | `RESEND_API_KEY` Worker secret. Sending-only key is enough for v1 mail. |

v1 emails: (1) sign-in / register OTP or magic link, (2) optional “new sign-in” notice. No newsletters.

This environment had no Resend MCP/CLI login. Verify in the dashboard: domain status, region, and that you are not sending from an unverified domain.

---

## 7. Website boundary (the only allowed Erase-adjacent change)

**Product story** (www): Windows | Mobile | Tablet as equal journeys.  
**Deploy unit:** www remains the Windows SPA.

When you explicitly allow a **small** `cyvra-www` patch:

- Nav/hero control: Windows | Mobile | Tablet
- Mobile and Tablet **navigate** to `https://mobile.cyvra.co.in` (tablet: `?device=tablet`)
- Copy: Samsung-compatible, in development. No Knox / all-OEM / IMEI / SOH claims
- Windows Get Started / OTP / download **untouched**

Do **not** implement Journey B inside the Windows Pages build. OEM catalog lives on the **mobile** frontend, backend-driven, Samsung first, others “not fully supported.”

Auth v1: **separate** mobile accounts in Neon. Same email as Windows is allowed; **not** the same cookie. Tell users the logins are separate until joined. Never copy `cyvoriq_admin_session`.

---

## 8. Engineering rules that must appear in code

### 8.1 Discovery before tests (5.1.20.4.1)

Detect → classify access → discover capabilities → policy filter → permitted ops → evidence plan → record limitations.

Every session gets a **Device Capability Profile** (snapshot). State changes create a **new version**, previous kept.

Access levels: L0 locked/no access → L1 limited → L2 S1 app → L3 Station → L4 enterprise.

USB states classified independently of ADB states.

### 8.2 S1 app (5.1.20.4.2)

Normal Android app. No root, Knox, forced debugging, or OEM-authoritative identity.

Permissions requested **when a test starts**, with purpose copy. Denied permission = limitation, not FAIL.

Hardware absent = `NOT_SUPPORTED`, not FAIL.

Declare vs detect vs tested are three different facts.

S1 v1 priority: identity/build/features/storage/battery status → camera, display, touch, audio, mic, vibration, sensors → Wi-Fi / Bluetooth / network classification → evidence envelope.

Phone vs tablet: **feature-based**. No SIM on a tablet is not a defect.

Prototype target: **one Samsung phone**, then **one Samsung tablet**. Do not ship “all Galaxy” from one device.

Offline-first local session store + sync queue.

### 8.3 App ↔ Station protocol (5.1.20.4.3) — implement with Station, not in S1 v0

Hybrid transport: USB when a real app channel exists, else paired LAN, else offline.

Pair **session** (QR primary, short code fallback). Short-lived, single-use tokens. Allowlisted operations only — **no** `EXECUTE_COMMAND`.

Wrong-device prevention: session id + app instance + identity card + technician confirm. Do not auto-merge on reconnect if uncertain.

Sanitization is a later, separate authorization.

### 8.4 Authorized ADB (5.1.20.4.4) — S2 only

`NO AUTHORIZED ADB = NO ADB OPERATION`. Version 1: **read-only first**, versioned command registry, session-matched, audited. Source = `S2_AUTHORIZED_ADB`.

Prohibit wipe, lock/FRP bypass, root, bootloader unlock, flash, arbitrary shell, technician-typed commands.

`ADB_UNAUTHORIZED` UI: **user authorization required**, not device failure.

### 8.5 Capability matrix (5.1.20.4.5)

Data-driven rules, not `if (model === "S21")`. Capability ≠ test result. UI shows **Ready to test**, not PASS, before the test runs.

### 8.6 Evidence protocol (5.1.20.5)

Evidence **before** report. Immutable raw records. Canonicalize then digest (do not hash pretty-printed JSON). Idempotent sync. Preserve `COLLECTED_AT` (never replace with sync time).

Sources: `S1_APPLICATION`, `S2_STATION`, `S2_AUTHORIZED_ADB`, `S3_*`, `TECHNICIAN_OBSERVATION`.

Results: `PASS | FAIL | LIMITED | NOT_AVAILABLE | NOT_SUPPORTED | NOT_TESTED | CANCELLED | ERROR`.

Conflict: preserve + compare + classify; prefer S3→S2 ADB→S2 Station→S1→observation for **summary only**; disclose material conflicts; human review is a **new** record, never an edit of raw evidence.

Report 1 **freezes** a manifest. Later sanitization does not rewrite it.

v1 confidence = source + method + time + limitation. No invented % scores.

Do not claim forensic chain of custody.

### 8.7 Report 1 (5.1.20.6)

Seven domains: Identity & configuration; Physical condition; Hardware configuration; Functional verification; Connectivity; Power/battery/storage; Security/access/limitations.

PDF is a **view**. Neon evidence + manifest are authoritative.

Non-goals: sanitization done, OEM authority, ownership proof, warranty, future reliability, “certified perfect.”

User-friendly name + objective name on every test (Camera Check / Camera Functional Verification). Keep that pair in app, Station, API, and PDF.

### 8.8 Naming in UI vs evidence

UI may say “Wi-Fi Check”. Evidence stores stable `TEST_ID`. Never key the database on display copy.

---

## 9. What this guideline forbids

- Rebuilding Windows Erase, `cyvra-www`, or `cyvoriq-erase-api` in this repo
- Renaming or converting `cyvra-approvals` / Worker `cyvra-approvals`
- Reusing Windows licence APIs or Windows Neon for mobile customer data
- Putting Mobile ops on Erase `admin.cyvra.co.in` / `accounts.cyvra.co.in` (decision 10 Sep 2026: new hosts `admin.cyvoriq.co.in` / `accounts.cyvoriq.co.in`)
- Binding Erase Pages `cyvra-www` to `cyvoriq.co.in`
- Journey B inside `cyvra-www` as the v1 frontend
- Vercel Publish; GitHub Codespaces as the build path
- FRP/lock bypass, root-default, unrestricted ADB console
- Report 1 that implies wipe; grades invented to fill a template
- IMEI / battery SOH / Knox as S1 promises
- Browser Resend or Neon
- Secrets in GitHub
- Starting CYVRA Station Windows UI before 5.1.20.2
- Starting S3 Knox before S1 reports exist and a real contract path exists

---

## 10. Execution gates

Nothing below starts until this guideline is accepted. Then work **only** in `CYVRA-Mobile`.

| Gate | Deliverable | Systems |
|---|---|---|
| **G0** | This guideline in `CYVRA-Mobile/docs`. Repo private. Description fixed. | GitHub |
| **G1** | Empty pipe: Pages `cyvra-mobile`, Worker `cyvra-mobile-api`, Hyperdrive → Neon `floral-art-02749206`, Resend domain verified | CF + Neon + Resend |
| **G2** | Drizzle schema: users, OTP challenges, sessions. Worker health + `POST /auth/request` + `POST /auth/verify` | Worker + Neon + Resend |
| **G3** | `apps/web` registration / sign-in on Pages preview, then custom domain. Honest empty home. Name + pincode mandatory. **Cutover host:** `www.cyvoriq.co.in`. Preview host `mobile.cyvra.co.in` kept until proven. | Pages |
| **G4** | Evidence JSON Schema + capability contract v1 in `packages/evidence` (no pretty marketing) | GitHub |
| **G5** | Windows USB/ADB + generic evidence. G5-A is Windows + USB + ADB + one owned Samsung (APK is supporting). Sanitization execution stays non-destructive until transport/evidence gates pass. | Host + App + API + Neon |
| **G6** | Render Report 1 (LIMITED/withheld where due) from frozen manifest | API + web |
| **G7** | Ops on **`admin.cyvoriq.co.in` / `accounts.cyvoriq.co.in`** (new Pages in this repo). Serial issue/approval via `cyvra-mobile-api` + Neon. Super admin `ceo@cyvoriq.com`. **Not** Erase admin. | New Pages + mobile Worker/Neon |
| **G8** | Public `www.cyvoriq.co.in` (new Pages, CYVORIQ logo). **Not** a tab on `www.cyvra.co.in`. Erase www stays frozen. | Pages `cyvoriq-www` |
| **G9** | Decision 5.1.20.2 then Station + optional S2 ADB | Later |
| **G10** | S3 only with real enterprise/OEM path | Later |

---

## 11. Secrets and env (never commit values)

Worker / Hyperdrive:

```
HYPERDRIVE          # binding, not a pasted password in source
RESEND_API_KEY
SESSION_SECRET
APP_ORIGIN=https://mobile.cyvra.co.in
```

Local `.env` (gitignored):

```
DATABASE_URL=           # Neon pooled, for local only
DATABASE_URL_DIRECT=    # migrations
RESEND_API_KEY=
```

Pages public env: **only** `NEXT_PUBLIC_API_URL` (or equivalent). No keys.

---

## 12. Live inspection gaps (this session)

| System | Result |
|---|---|
| GitHub `CYVRA-Mobile` | Read OK. Empty public repo. |
| Cloudflare account | ID known. `wrangler` not authenticated here. Pages/Workers for mobile **not created from this agent**. |
| Neon `floral-art-02749206` | ID known. `neonctl` OAuth timed out. Schema **not** inspected. |
| Resend | Dashboard URL known. No API key in this environment. Domain verify status **unknown**. |

Before G1, on a logged-in machine (or after authenticating Cloudflare / Neon / Resend MCP in Cursor Desktop): confirm no tables yet, pick Neon region, verify Resend domain, create Hyperdrive from the **pooled** Neon URL.

---

## 13. Brand note (out of engineering scope)

LinkedIn/company copy: CYVORIQ Solutions, CYVRA, `www.cyvra.co.in`, `www.cyvoriq.com`. BidX is a **different** product. Do not put BidX or Erase download into the mobile app.

---

## 14. One-page law

1. Code lives in **https://github.com/mukpswar-prog/CYVRA-Mobile**.
2. Cloudflare account **`5a3eeb2b3d42726a8ba08732464a0eda`**, new Pages/Worker only.
3. Neon **`floral-art-02749206`** is the mobile database.
4. Resend sends mobile OTP from the Worker, verified domain only.
5. Erase stays frozen. Approvals stays parked.
6. `mobile.cyvra.co.in` is the frontend; www only **links** to it.
7. S1 → evidence → Report 1 → (later) Station → (later) sanitization Final Report.
8. Detect, don’t assume. Limitations are evidence. Unavailable is not fail.
9. No bypass. USB is not authority. Reports are derived from preserved evidence.

**Next human action:** open [docs/resume-android-freeze.md](docs/resume-android-freeze.md). Android Multi-OEM & Host Architecture freeze slices **A0 through A13 are complete**, **Customer Desktop Workstation C1–C4 are complete**, **Phase 8 (AI Physical Inspection V0) is complete**, **Phase 9 (AI Screen Inspection) is complete**, and **Phase 10 (AI Body Inspection) is complete**. Next phase is Phase 11 (Deterministic Grading Rules Engine). Do not touch frozen www/API. Do not start Station or Knox. Do not run AGP Upgrade Assistant.
