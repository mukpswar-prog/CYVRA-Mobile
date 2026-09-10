# Resume here — 11 Sep 2026 (www.cyvoriq.co.in)

You stopped the evening of **10 Sep 2026**. This file is the single handoff.
Branch: `cursor/g0-g3-mobile-slice-7474`.

**First thing tomorrow:** create Pages **`cyvoriq-www`** and attach
**`www.cyvoriq.co.in`** (+ apex). Clicks: [www-cyvoriq-start.txt](./www-cyvoriq-start.txt).

The browser error `DNS_PROBE_FINISHED_NXDOMAIN` on `https://cyvoriq.co.in` is
**expected**. Only `api.cyvoriq.co.in` exists on this zone. www / apex are not
created yet.

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
| New Pages (create tomorrow) | `cyvoriq-www` → `www.cyvoriq.co.in` + apex |
| Worker | `cyvra-mobile-api` → https://api.cyvoriq.co.in and workers.dev |
| Hyperdrive | `cyvra-mobile-neon` `db31fc8dafca49b29172da7046b97175` |
| Neon | `floral-art-02749206` / `neondb` / production `br-empty-silence-b3a7hhss` |
| Cloudflare account | `5a3eeb2b3d42726a8ba08732464a0eda` |
| Super admin | `ceo@cyvoriq.com` |

## Tomorrow — only www (not admin / accounts)

You (dashboard), in order:

1. Create **new** Pages project **`cyvoriq-www`**. Never reuse `cyvra-www` or
   `cyvra-mobile`.
2. Build env: `VITE_API_URL=https://api.cyvoriq.co.in` (build-time only).
   No `DATABASE_URL`. No `ADMIN_API_TOKEN`.
3. Custom domains: **`www.cyvoriq.co.in`** and apex **`cyvoriq.co.in`**.
   Zone must be `cyvoriq.co.in`. Cloudflare writes DNS. Do not add a manual
   CNAME first (that blocked Add Domain on the Worker).
4. Prove `https://www.cyvoriq.co.in/` HTTP 200 (logo + register).
5. Optional: one OTP to your inbox. Resend → Emails From =
   `noreply@cyvoriq.co.in`. Do not paste the code in chat.

Agent already: CORS allowlists `*.cyvoriq.co.in` and `*.cyvoriq-www.pages.dev`.
Same `apps/web` bundle is the public site (logo, honest home, register).
Deploy helper: `scripts/deploy-www-cyvoriq.sh` and
`.github/workflows/deploy-www-cyvoriq.yml`.

Leave `mobile.cyvra.co.in` up. Do not start `cyvoriq-admin` /
`cyvoriq-accounts` until www is 200.

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
# first clicks are dashboard — docs/www-cyvoriq-start.txt
```

Windows checks after www is attached:

```powershell
curl.exe -sS https://api.cyvoriq.co.in/health
curl.exe -sS -I https://www.cyvoriq.co.in/
curl.exe -sS -I https://cyvoriq.co.in/
```
