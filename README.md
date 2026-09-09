# CYVRA Mobile Evidence

Android phone and tablet verification, evidence, and reports for the CYVRA platform.

**Governing document:** [GUIDELINE.md](GUIDELINE.md) (also [docs/GUIDELINE.md](docs/GUIDELINE.md) for gate G0). G0–G3 notes: [docs/g0-g3.md](docs/g0-g3.md). Freeze audit + G4+ plan (awaiting approval): [docs/freeze-audit.md](docs/freeze-audit.md). Neon vs Pages vs Workers: [docs/neon-cloudflare.md](docs/neon-cloudflare.md). Neon / Resend / Worker / `mobile.cyvra.co.in` dashboard steps: [docs/dashboard-configure.md](docs/dashboard-configure.md). Thin www Mobile button (link only, no Erase OTP merge): [docs/www-mobile-button.md](docs/www-mobile-button.md). Paused next-slice / G7 admin section: [docs/parked-next-slice.md](docs/parked-next-slice.md),
[docs/admin-mobile-section.md](docs/admin-mobile-section.md).

- Company: CYVORIQ Solutions Pvt. Ltd.
- Planned site: https://mobile.cyvra.co.in
- Frozen Windows product: https://www.cyvra.co.in — **not** this repository

> Do not start CYVRA Station, Knox/S3, or the Android app yet. This repo is the
> mobile web + API first slice (gates G1–G3). See [GUIDELINE.md](GUIDELINE.md) §10.

---

## Monorepo layout

```
apps/web/            Customer web (Vite + React) → mobile.cyvra.co.in
services/api/        Cloudflare Worker `cyvra-mobile-api` (Hono + pg via Hyperdrive)
database/            Drizzle schema + migrations (Neon project floral-art-02749206)
packages/evidence/   Shared evidence vocabulary (guideline §8.6)
scripts/             Dev environment helpers (local Postgres, install, start)
```

## First vertical slice (implemented)

Resend-style email OTP sign-in, matching guideline gates **G2** (Worker health +
`POST /auth/request` + `POST /auth/verify`, Neon-backed) and **G3** (registration
web on Pages):

1. Fill **Create your account**: full name and pincode are required, plus
   company, two address lines, state, and email.
2. Email is only for the Worker to send a Resend OTP. Domain `cyvra.co.in` is
   Verified. Worker `API_ENV` is still `preview`, so the UI may show `devCode`
   until production is flipped.
3. Enter the code → the Worker upserts the user (profile + email), creates a
   session, sets an HttpOnly cookie, and returns a Bearer token.

## Codespaces → GitHub → Pages

Day-to-day verification is in GitHub Codespaces
(`https://supreme-umbrella-6v4rwwwxrwq524w4j.github.dev/`,
`/workspaces/CYVRA-Mobile`). After checks pass, push to GitHub. Cloudflare
Pages project **`cyvra-mobile`** builds from this repo (`main` = production).
Do not connect Pages to Erase / `cyvra-www`.

Full steps: [docs/codespaces-pages.md](docs/codespaces-pages.md).

## Local development

The Cloud Agent environment is configured in [`.cursor/environment.json`](.cursor/environment.json):

- **install** (`scripts/install.sh`): Node 24 LTS, npm 12.0.2, pnpm 12, Python 3.14, Postgres, then `pnpm install`. Versions: [docs/tooling.md](docs/tooling.md).
- **start** (`scripts/start.sh`): starts a local Postgres cluster (a stand-in
  for Neon so nothing cloud is required), applies Drizzle migrations, and seeds
  `services/api/.dev.vars`.
- **terminals**: `api` (`wrangler dev`, port 8787) and `web` (Vite, port 5173).

Manual equivalent:

```bash
nvm install && nvm use                  # Node 24.21.0 from .nvmrc
npm install -g npm@12.0.2               # current npm CLI
corepack enable && corepack prepare pnpm@12.3.4 --activate
pnpm install                            # uses pnpm-lock.yaml (not package-lock.json)
bash scripts/local-postgres.sh start   # local Neon stand-in on :5432
pnpm --filter @cyvra/database migrate
pnpm dev                                # runs api (:8787) + web (:5173)
```

Open http://localhost:5173 and sign in.

### Environment & secrets

- Real values are never committed. Copy the examples:
  - `services/api/.dev.vars.example` → `services/api/.dev.vars` (`RESEND_API_KEY`, ...)
  - `database/.env.example` → `database/.env` (local `DATABASE_URL*`)
  - `apps/web/.env.example` → `apps/web/.env` (`VITE_API_URL`)
- In production the Worker binds Neon through Hyperdrive `cyvra-mobile-neon`
  using the **direct** (unpooled) origin. See
  [docs/neon-cloudflare.md](docs/neon-cloudflare.md). Migrations use
  `DATABASE_URL_DIRECT`. Never put `DATABASE_URL` on Pages.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the Worker API and web app together |
| `pnpm --filter @cyvra/api dev` | Worker API only (`wrangler dev`) |
| `pnpm --filter @cyvra/web dev` | Web app only (Vite) |
| `pnpm db:generate` | Generate Drizzle SQL migrations from the schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm typecheck` | Type-check every package |
| `pnpm test:local-auth` | Curl the local Worker health + OTP + session slice |
| Tooling pins | Node 24, npm 12.0.2, pnpm 12, Python 3.14 — [docs/tooling.md](docs/tooling.md) |
| `bash scripts/g1-cloud-preview.sh` | Create Hyperdrive / Worker / Pages **after** Cloudflare+Neon login |
