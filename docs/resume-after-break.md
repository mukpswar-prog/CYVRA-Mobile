# Resume after break — 10 Sep 2026

You asked to **save everything** and join after the break. This file is the single
handoff. The repo is on branch `cursor/g0-g3-mobile-slice-7474`.

## What you already did (management + registrar)

- Product **CYVRA Mobile Evidence** lives on **`cyvoriq.co.in`** (new Cloudflare
  zone). **Not** a subdomain of `cyvra.co.in`.
- **Do not change** `mukpswar-prog/Erase`. Keep old `mobile.cyvra.co.in` until the
  new origin is proven.
- Same Neon. Same Worker. Same CYVORIQ logo.
- You **added the site** in Cloudflare and **updated nameservers** at the
  registrar.

## Nameserver check (this session, 10 Sep 2026)

Public DNS via `1.1.1.1` and `8.8.8.8`:

| Zone | Nameservers | SOA | Notes |
|---|---|---|---|
| **cyvoriq.co.in** | `guy.ns.cloudflare.com` / `sloan.ns.cloudflare.com` | Cloudflare (`ns.cloudflare.com`) | **On Cloudflare.** Apex **A empty**, **MX empty**, **TXT empty**. Parking IPs (`13.251.230.115`, `18.139.194.140`) **gone**. |
| **cyvra.co.in** | `guy.ns.cloudflare.com` / `sloan.ns.cloudflare.com` | Cloudflare | **Unchanged.** Erase still on this zone. **Do not touch.** |

Cloudflare assigned the **same pair** (`guy` / `sloan`) to both zones. That is
normal for one account. It does **not** merge the zones. Records for
`cyvra.co.in` stay on that zone; records for `cyvoriq.co.in` stay on this one.

If the Cloudflare dashboard still shows **Pending** for `cyvoriq.co.in`, wait
until it is **Active**. Public NS already match; Active is the dashboard flag.

## What is live today (do not break)

| Resource | Status |
|---|---|
| Pages `cyvra-mobile` | https://cyvra-mobile.pages.dev and https://mobile.cyvra.co.in/ |
| Worker `cyvra-mobile-api` | https://cyvra-mobile-api.mukpswar.workers.dev — G6 preview. `/health` ok, `database=connected`. Version `38ef01e5-8400-4452-87d1-e1e576e2e27a`. |
| Hyperdrive `cyvra-mobile-neon` | `db31fc8dafca49b29172da7046b97175` → Neon `floral-art-02749206` |
| Neon | `neondb` / `neondb_owner`. Migrations **0001–0003** applied. **0004 not applied** (G7 serials). |
| Worker `/admin/serials` | **HTTP 404** on live (G7 not deployed). Local Codespaces **passed** (`CYVRA-M-2026-76FD83B5`). |
| `cyvoriq.co.in` DNS | Empty. No www, no api, no MX. Safe to add records. |
| Erase / `www.cyvra.co.in` / `api.cyvra.co.in` | **Untouched.** |

CORS on the live Worker still allowlists only `*.cyvra-mobile.pages.dev`,
`mobile.cyvra.co.in`, `admin.cyvra.co.in`, `accounts.cyvra.co.in`.
**`*.cyvoriq.co.in` is not allowlisted yet.** Do not point browsers at
cyvoriq hosts until CORS is deployed.

## What is in this repo (not all live)

- G0–G6: auth, evidence, Report 1 freeze, HTML print.
- G7 **this-repo** serial API: `services/api/src/admin.ts`, schema `0004`,
  local `bash scripts/run-local-admin-serials.sh`, hidden `/#ops`.
- Cutover plan: `docs/cyvoriq-co-in-cutover.txt`.
- G7 freeze: `docs/g7-freeze.md`.
- Cross-repo map: `docs/cross-repo-next-gates.txt` (Erase-host G7 section is
  **superseded** by the cyvoriq.co.in decision).
- Logo: `apps/web/public/brand/cyvoriq-logo.png`.

## Ordered plan after the break (do not skip)

### 0 — Confirm zone Active (2 min)

In Cloudflare → **cyvoriq.co.in** → status **Active**. Inventory MX (none in
public DNS). Do **not** change `cyvra.co.in` nameservers.

### 1 — G7 live on the **existing** Worker (same as before the domain decision)

This is still required. New hostnames do nothing if `/admin/serials` is 404.

1. `bash scripts/migrate-neon.sh` — apply **0004** (`mobile_serials`).
2. `wrangler secret put ADMIN_API_TOKEN` — invent a long random string. This is
   **not** the Cloudflare user token named `cyvra-mobile`.
3. `bash scripts/deploy-api-preview.sh` — keep `API_ENV=preview`.
4. Prove live: unauth `GET /admin/serials` → **401**, not 404/503/500.
5. Optional: `/#ops` create one real `CYVRA-M-…`.

Do **not** attach `mobile.cyvra.co.in` to the Worker.

### 2 — Attach **new zone only** (after G7 API is 401)

| Hostname | Bind to |
|---|---|
| `api.cyvoriq.co.in` | Worker `cyvra-mobile-api` (custom domain). Same Hyperdrive. |
| `www.cyvoriq.co.in` + apex | **New** Pages `cyvoriq-www` (this repo). |
| `admin.cyvoriq.co.in` | **New** Pages `cyvoriq-admin` (this repo). |
| `accounts.cyvoriq.co.in` | **New** Pages `cyvoriq-accounts` (this repo). |

Never bind Erase Pages (`cyvra-www`) to this zone. Never put `DATABASE_URL` on Pages.

### 3 — Code still needed in this repo

- CORS + `APP_ORIGIN` for `https://www.cyvoriq.co.in` (and admin/accounts).
- Public www (logo, Get Started → OTP on **this** API, not Erase).
- Real admin UI (replace hidden `/#ops` for production).
- Verify Resend domain `cyvoriq.co.in` (keep `cyvra.co.in` verified for Erase).

### 4 — Cutover, not deletion

Keep `mobile.cyvra.co.in` until www is proven. Optional 301 **last**. Do not
delete old hosts on day one.

## Still forbidden

- Touch Erase, Station, Knox, S3, live Android, `www.cyvra.co.in` Get Started.
- Second Neon. Second Worker on day one (new **hostname** only).
- Roll `cyvra-erase-*` Cloudflare tokens.
- USB wipe / ADB / Knox as S1 claims.
- Secrets in Git. `git add database/.env`.

## Tokens (two different things)

| Name | What |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Your Cloudflare **user** token named `cyvra-mobile`. Unlocks wrangler. Does **not** go in Worker secrets. |
| `ADMIN_API_TOKEN` | Invented Worker secret. Bearer for `/admin/serials`. `wrangler secret put`. Never on Pages. |

Set the user token with `read -r -s CLOUDFLARE_API_TOKEN` then paste. Do not
`export CLOUDFLARE_API_TOKEN=...` (that is a placeholder and Cloudflare returns 6111).

## After you pull

```bash
cd /workspaces/CYVRA-Mobile   # or your clone
git pull
pnpm --filter @cyvra/api typecheck
pnpm --filter @cyvra/web typecheck
# local G7 (optional): bash scripts/start.sh then bash scripts/run-local-admin-serials.sh
```

Do not start G9/G10. Do not delete old hosts. First live move after the break is
**G7 on the existing Worker**, then **api.cyvoriq.co.in**.
