# CYVRA Mobile Evidence

Android phone and tablet verification, evidence, and reports for the CYVRA platform.

**Governing document:** [GUIDELINE.md](GUIDELINE.md) (also [docs/GUIDELINE.md](docs/GUIDELINE.md) for gate G0). G0–G3 notes: [docs/g0-g3.md](docs/g0-g3.md). Freeze audit: [docs/freeze-audit.md](docs/freeze-audit.md). G4 evidence package: [packages/evidence](packages/evidence). Test pool: [docs/testing/pool.md](docs/testing/pool.md). Samsung/AOSP research: [docs/research/samsung-s1-sources.md](docs/research/samsung-s1-sources.md). Neon vs Pages vs Workers: [docs/neon-cloudflare.md](docs/neon-cloudflare.md). Neon / Resend / Worker / `mobile.cyvra.co.in` dashboard steps: [docs/dashboard-configure.md](docs/dashboard-configure.md). Thin www Mobile button (link only, no Erase OTP merge): [docs/www-mobile-button.md](docs/www-mobile-button.md). Paused next-slice / G7 admin section: [docs/parked-next-slice.md](docs/parked-next-slice.md),
[docs/admin-mobile-section.md](docs/admin-mobile-section.md).

- Company: CYVORIQ Solutions Pvt. Ltd.
- Planned site: https://mobile.cyvra.co.in (live)
- Frozen Windows product: https://www.cyvra.co.in — **not** this repository

> Do not start CYVRA Station or Knox/S3. G5 Android **core** is in `apps/android`
> (Codespaces: `./gradlew :core:test`). Worker ingest is `POST /evidence/batches`
> (local: `pnpm test:local-evidence`). Report 1 freeze is `POST /reports/freeze`
> (local: `pnpm test:local-report`). Device/APK tests wait for a Samsung phone.
> Cutover host is `www.cyvoriq.co.in` (decision 10 Sep 2026). Keep
> `mobile.cyvra.co.in` until that zone is proven. Same Neon. Do not patch Erase.
> Zone `cyvoriq.co.in` is on Cloudflare (NS checked 10 Sep 2026). After-break
> handoff: [docs/resume-after-break.md](docs/resume-after-break.md). Plan:
> [docs/cyvoriq-co-in-cutover.txt](docs/cyvoriq-co-in-cutover.txt). Follow-along
> audit: [docs/cyvoriq-migration-audit.txt](docs/cyvoriq-migration-audit.txt).
> Codespaces quota is not required: [docs/without-codespaces.txt](docs/without-codespaces.txt).

---

## Monorepo layout

```
apps/web/            Customer web (Vite + React) → mobile.cyvra.co.in
apps/android/        S1 Android scaffold (`:core` JVM tests in Codespaces)
services/api/        Cloudflare Worker `cyvra-mobile-api` (Hono + pg via Hyperdrive)
database/            Drizzle schema + migrations (Neon project floral-art-02749206)
packages/evidence/   Evidence JSON Schema + S1 capability contract (G4)
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

Full steps: [docs/codespaces-g5.md](docs/codespaces-g5.md) (switch off `main` first), then [docs/codespaces-pages.md](docs/codespaces-pages.md).

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
| `pnpm test:local-evidence` | Start local Postgres + wrangler if needed, then ingest honesty/`collectedAt` tests |
| `pnpm test:local-report` | Start local Postgres + wrangler if needed, then freeze Report 1 (PARTIAL + replay) |
| `pnpm test:local-admin-serials` | Local G7 serial create / issue / replay / revoke (no Erase UI) |
| Tooling pins | Node 24, npm 12.0.2, pnpm 12, Python 3.14 — [docs/tooling.md](docs/tooling.md) |
| `bash scripts/g1-cloud-preview.sh` | Create Hyperdrive / Worker / Pages **after** Cloudflare+Neon login |
