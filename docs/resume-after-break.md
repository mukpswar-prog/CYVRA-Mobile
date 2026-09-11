# Resume here — superseded 11 Sep 2026

**Current start file:** [resume-g8-freeze.md](./resume-g8-freeze.md) (saved 11 Sep evening for 12 Sep morning).

Public `www.cyvoriq.co.in` is frozen. Next is G7 inbox proof, then G5 on one Samsung. This file is older history. Keep it.

Branch: `cursor/g0-g3-mobile-slice-7474`.

Clicks if admin must be rebuilt: [admin-cyvoriq-start.txt](./admin-cyvoriq-start.txt).

---

## Done (do not redo)

| Item | Proof |
|---|---|
| Zone `cyvoriq.co.in` Active | Cloudflare dashboard. NS `guy` / `sloan`. |
| Neon 0004 `mobile_serials` | Applied on `floral-art-02749206`. |
| Worker G7 | `GET /admin/serials` **401** `Admin token required.` |
| Custom domain **`api.cyvoriq.co.in`** | Worker `cyvra-mobile-api` Domains table. |
| Health | `{"status":"ok","env":"preview","database":"connected"}` |
| CORS | Allows `*.cyvoriq.co.in`. Blocks `www.cyvra.co.in`. |
| Resend domain `cyvoriq.co.in` | **Verified** (Tokyo). Keep `cyvra.co.in` for Erase. |
| Worker secret `RESEND_FROM` | Added. Same existing `RESEND_API_KEY` (do not rotate). |
| `API_ENV` | Still **`preview`**. Do not flip to production yet. |
| Pages **`cyvoriq-www`** | https://www.cyvoriq.co.in/ and apex **HTTP 200** (11 Sep 2026). |

Worker variables (10 Sep 2026, names only):

```
ADMIN_API_TOKEN     Secret
API_ENV             preview
APP_ORIGIN          https://cyvra-mobile.pages.dev
RESEND_API_KEY      Secret   (unchanged — do not delete)
RESEND_FROM         Secret   (CYVRA Mobile <noreply@cyvoriq.co.in>)
SESSION_SECRET      Secret
```

OTP From `noreply@cyvoriq.co.in` was **not** proven in an inbox before the
stop. Keep `API_ENV=preview`. After www is 200, register on
`https://www.cyvoriq.co.in` with a real inbox.

## Live IDs (no secrets)

| Resource | Value |
|---|---|
| Pages preview (keep) | `cyvra-mobile` → https://cyvra-mobile.pages.dev and https://mobile.cyvra.co.in/ |
| Pages public | `cyvoriq-www` → https://www.cyvoriq.co.in/ + apex |
| New Pages (next) | `cyvoriq-admin` → `admin.cyvoriq.co.in` |
| Worker | `cyvra-mobile-api` → https://api.cyvoriq.co.in and workers.dev |
| Hyperdrive | `cyvra-mobile-neon` `db31fc8dafca49b29172da7046b97175` |
| Neon | `floral-art-02749206` / `neondb` / production `br-empty-silence-b3a7hhss` |
| Cloudflare account | `5a3eeb2b3d42726a8ba08732464a0eda` |
| Super admin | `ceo@cyvoriq.com` |

## Next — admin only (not accounts)

You (dashboard): [admin-cyvoriq-start.txt](./admin-cyvoriq-start.txt).

1. Create **new** Pages **`cyvoriq-admin`** from the same GitHub repo.
2. Same build as www. Same `VITE_API_URL`. **No** `ADMIN_API_TOKEN` on Pages.
3. Custom domain: **`admin.cyvoriq.co.in`** only.
4. Prove HTTP 200 and the serials form. Token stays in the browser.

Leave `mobile.cyvra.co.in` up. Do not create `cyvoriq-accounts` yet.
Optional in parallel: one OTP on https://www.cyvoriq.co.in/create-account
(keep `API_ENV=preview`; do not paste the code in chat).

## Still forbidden

- Touch Erase, `cyvra.co.in` NS, `www.cyvra.co.in`, `api.cyvra.co.in`,
  `cyvra-www`, `cyvoriq-erase-api`, Station, Knox.
- Second Neon. Second Worker.
- Bind www / apex to Worker `cyvra-mobile-api`.
- Delete `mobile.cyvra.co.in` or Pages `cyvra-mobile`.
- Delete Resend domain `cyvra.co.in` or rotate `RESEND_API_KEY`.
- Secrets in Git. `git add database/.env`.
- G9 / G10.

## After you pull

```bash
git checkout cursor/g0-g3-mobile-slice-7474
git pull
# first clicks are dashboard — docs/admin-cyvoriq-start.txt
```

Windows checks:

```powershell
curl.exe -sS https://api.cyvoriq.co.in/health
curl.exe -sS -I https://www.cyvoriq.co.in/
curl.exe -sS -I https://admin.cyvoriq.co.in/
```
