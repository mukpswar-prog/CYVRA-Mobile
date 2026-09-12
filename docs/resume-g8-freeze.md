# Resume here — 12 Sep 2026 morning (in progress)

**Start the next session from this file.**  
Governing law: [GUIDELINE.md](../GUIDELINE.md) (also `docs/GUIDELINE.md`).  
Branch: `cursor/g0-g3-mobile-slice-7474`.  
Public www is **frozen**. Ops freeze: [admin-scope-freeze.md](./admin-scope-freeze.md).

Sister files: [admin-scope-freeze.md](./admin-scope-freeze.md), [codespaces-g5.md](./codespaces-g5.md).

---

## Status at 12 Sep 2026 ~05:25 UTC

| Item | State |
|---|---|
| Pages `cyvoriq-www` | Ops card already shows on-screen code + mailError. Create-account mailError ships after the next Pages Action. |
| Worker `cyvra-mobile-api` | **Stale.** `workers.dev` `/health` has no `mailConfigured`. Last API Action was 11 Sep 14:25 UTC. |
| OTP mailbox | Resend key `235c5518-…` returned **200** on 9 Sep, then **403** after From moved to `noreply@cyvoriq.co.in`. Key is still Erase-scoped. |
| G5 / Report / production / Station | Parked. Do later. |

Runbook: [resend-mobile-otp.md](./resend-mobile-otp.md).

---

## Do this next, in this order

Stay on `cursor/g0-g3-mobile-slice-7474`. `git pull`. Do not reopen G8. Do not start Station or Knox.

| # | What | Who |
|---|---|---|
| 1 | **G7 Resend key.** Follow [resend-mobile-otp.md](./resend-mobile-otp.md): new sending key named `cyvra-mobile-otp` with Domain `cyvoriq.co.in`; put it only on Worker `cyvra-mobile-api`; keep `RESEND_FROM` on `noreply@cyvoriq.co.in`; keep `API_ENV=preview`. Do not rotate Erase keys. | You |
| 2 | GitHub → Actions, this branch: **Deploy mobile API preview**, then **Deploy cyvoriq-www Pages**. Expect `/health` `mailConfigured: true` and `mailFromHost: "cyvoriq.co.in"`. | You |
| 3 | Prove **both** OTPs: `https://admin.cyvoriq.co.in/` and `https://cyvoriq.co.in/create-account`. Success = Resend 200 + inbox, no on-screen code. On-screen code means send still failed — read the red `mailError`. Do not paste codes in chat. Do not Create PENDING with dummy payment on live. | You |
| 4 | **G5** (later). One owned Samsung. USB copy ≠ authorization. | Later |
| 5 | Wire that batch to Report 1. | Later |
| 6 | `API_ENV=production` only after a real OTP is trusted. | Later |
| 7 | Station / Knox. | Later |

Inbox still unproven. Keep `API_ENV=preview` until a real code lands.

---

## Saved at stop (do not redo)

| Item | State |
|---|---|
| `origin/main` merged | `2703f98`. Kept this branch’s later ops/licence work. Dropped www `/#ops` token bench (`OpsTest.tsx`). Do not put it back. |
| Licence keys | `CYVRA{dd}{mm}{yyyy}{S\|B}{hex4}-1-{1\|3\|5\|7\|25}`. `1-1` is single-user only. |
| Ops login in git | Staff OTP. Failed send shows Resend error + on-screen preview code. `/health` has `mailConfigured`. |
| Local proof | `pnpm --filter @cyvra/api test` 22 pass. `bash scripts/run-local-admin-serials.sh` created `…-1-1` and rejected bulk 1-device. |
| Live Worker / Pages | May still be the **previous** bundle until both Actions run. Live `/health` did not yet show `mailConfigured`. |
| OTP mailbox | Not trusted. On-screen preview means Resend did not deliver. |
| Public www | Frozen. Do not polish. |

---

## Live proof (11 Sep 2026, ~08:10–08:20 UTC)

```
https://cyvoriq.co.in/            assets/index-5y20CkGP.js  +  index-CDj2zkGN.css
https://www.cyvoriq.co.in/        same bundle
JS contains: site-drop-btn, feature-frame, center-band, Get Started
```

PowerShell that passed:

```powershell
curl.exe -sS https://cyvoriq.co.in/ | findstr /C:"assets/index"
```

API:

```
GET https://api.cyvoriq.co.in/health
{"status":"ok","service":"cyvra-mobile-api","env":"preview","database":"connected"}

GET https://api.cyvoriq.co.in/admin/serials
HTTP 401  {"error":"Admin token required."}

OPTIONS Origin: https://www.cyvoriq.co.in  → CORS allow, credentials true
```

Header on the frozen public site:

- Home, Platform, How It Works (dropdown: How It Works, Device Verification, Sanitization, Reports), CYVRA Station, Industries, Resources
- Get Started only (no Sign In in the nav)
- Evidence Across the Device and Built for the Modern Device Lifecycle are stacked heading → photo → cards
- Designed for Real-World Android Device Diversity is center-aligned

---

## Gate scorecard

| Gate | Deliverable | Status |
|---|---|---|
| **G0** | Guideline in repo. Repo private. | Done. GitHub description click may still be old. |
| **G1** | Pages + Worker + Hyperdrive + Resend | Done. |
| **G2** | Users / OTP / sessions | Done. |
| **G3** | Register / sign-in on Pages | Done on `www.cyvoriq.co.in` and `mobile.cyvra.co.in`. |
| **G4** | Evidence schema + capability contract | Done in `packages/evidence`. |
| **G5** | S1 Android on **one owned Samsung** | **Core collect-from-plan added.** `:core` tests pass. No phone ingest yet. |
| **G6** | Report 1 from frozen manifest | **API + web exist.** No real phone ingest yet. |
| **G7** | Ops serials / licences on `admin.cyvoriq.co.in` | **Console live.** Staff OTP preview works. Inbox delivery still unproven. `1-1` slab added. |
| **G8** | Public `www.cyvoriq.co.in` | **Done. Frozen.** |
| **G9** | Station (Decision 5.1.20.2) | Blocked. |
| **G10** | Knox / UEM / OEM | Blocked. |

---

## Live IDs (no secrets)

| Resource | Value |
|---|---|
| GitHub | `mukpswar-prog/CYVRA-Mobile` branch `cursor/g0-g3-mobile-slice-7474` |
| Pages public | `cyvoriq-www` → https://www.cyvoriq.co.in/ and apex https://cyvoriq.co.in/ |
| Pages preview (keep) | `cyvra-mobile` → https://cyvra-mobile.pages.dev and https://mobile.cyvra.co.in/ |
| Worker | `cyvra-mobile-api` → https://api.cyvoriq.co.in and workers.dev |
| Hyperdrive | `cyvra-mobile-neon` `db31fc8dafca49b29172da7046b97175` |
| Neon | `floral-art-02749206` / `neondb` / production `br-empty-silence-b3a7hhss` |
| Cloudflare account | `5a3eeb2b3d42726a8ba08732464a0eda` |
| Super admin | `ceo@cyvoriq.com` |
| Resend | Domain `cyvoriq.co.in` Verified (Tokyo). Keep `cyvra.co.in` for Erase. From: `CYVRA Mobile <noreply@cyvoriq.co.in>` |

Worker variables (names only):

```
ADMIN_API_TOKEN     Secret
API_ENV             preview          ← do not flip yet
APP_ORIGIN          https://cyvra-mobile.pages.dev
RESEND_API_KEY      Secret           ← replace with cyvra-mobile-otp (cyvoriq.co.in). Do not rotate Erase keys.
RESEND_FROM         Secret           ← CYVRA Mobile <noreply@cyvoriq.co.in>
SESSION_SECRET      Secret
```

CORS allows `*.cyvoriq.co.in`. Cookie path is first-party on that zone.  
`accounts.cyvoriq.co.in` does not exist (correct — do not create it yet).

---

## Admin host caveat (read before clicking)

| URL | What it actually is |
|---|---|
| `https://admin.cyvoriq.co.in/` | HTTP 200. **Same asset hash as www** (`index-5y20CkGP.js`). The Vite bundle hostname-gates to `AdminApp` when host is `admin.cyvoriq.co.in`. Browser should show **CYVRA Mobile ops** + serials form, not the marketing homepage. |
| `https://cyvoriq-admin.pages.dev/` | HTTP 200. **Wrong app.** Title `CYVRA Admin \| CYVORIQ SOLUTIONS PVT LTD`, Fraunces / IBM Plex. **Not this repo.** Do **not** attach `admin.cyvoriq.co.in` to that project. |

Staff OTP is the ops login. `ADMIN_API_TOKEN` is scripts-only. **Never** put it on Pages.  
Do **not** restore www `/#ops` / `OpsTest.tsx` (removed when `main` was merged).

---

## GitHub is not attached to Cloudflare Pages (by design)

Saved 11 Sep 2026. Do **not** Connect to Git on Pages `cyvra-mobile` Builds.
That project is preview (`mobile.cyvra.co.in` / `cyvra-mobile.pages.dev`).
Worker deploys are GitHub Actions **Direct Upload** using repo secret
`CLOUDFLARE_API_TOKEN` (user token named `cyvoriq-mobile`).
Workflows live on `main` so **Run workflow** appears; pick branch
`cursor/g0-g3-mobile-slice-7474` so the licence engine ships.
Do not create a blank `.github/workflows/main.yml`.
Do not attach `admin.cyvoriq.co.in` to `cyvoriq-admin.pages.dev`.

---

## After the break — 11 Sep evening (history)

The morning-of-12-Sep header at the top of this file is the start point. The CEO order is unchanged. Do not paste OTP codes in chat. Do not Create PENDING with dummy payment text on the live Worker.

---

## Do not (still forbidden)

- Polish or reopen the frozen public site
- Touch Erase, `mukpswar-prog/Erase`, `www.cyvra.co.in`, `api.cyvra.co.in`, `cyvra-www`, `cyvoriq-erase-api`
- Bind www / apex / admin to Worker `cyvra-mobile-api`
- Put `ADMIN_API_TOKEN`, `DATABASE_URL`, `RESEND_*`, or `SESSION_SECRET` on Pages
- Point `admin.cyvoriq.co.in` at `cyvoriq-admin.pages.dev` until that project is rebuilt from **this** repo
- Delete `mobile.cyvra.co.in` or Pages `cyvra-mobile`
- Delete Resend domain `cyvra.co.in` or rotate **Erase** `RESEND_API_KEY` values. Replacing the Mobile Worker key with a `cyvoriq.co.in` sending key is required — see [resend-mobile-otp.md](./resend-mobile-otp.md).
- Flip `API_ENV` to production until an OTP lands in a real inbox
- Create `cyvoriq-accounts` yet
- Start G9 Station or G10 Knox
- Secrets in Git. `git add database/.env`

---

## After you pull

```powershell
git checkout cursor/g0-g3-mobile-slice-7474
git pull
```

Windows live checks:

```powershell
curl.exe -sS https://api.cyvoriq.co.in/health
curl.exe -sS https://cyvoriq.co.in/ | findstr /C:"assets/index"
curl.exe -sS -I https://admin.cyvoriq.co.in/
```

Hard-refresh if the public page looks stale: `Ctrl + Shift + R`.
