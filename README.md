# CYVRA Mobile Evidence

Android phone and tablet verification, evidence, and reports for the CYVRA platform.

**Governing document:** [GUIDELINE.md](GUIDELINE.md) — read it before writing code.

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

1. Enter your email on the web app → the Worker creates an OTP challenge.
2. The Worker emails the 6-digit code via **Resend** (from the Worker only). In
   local dev, with no `RESEND_API_KEY`, the code is logged and returned so the
   flow completes without a verified domain.
3. Enter the code → the Worker upserts the user, creates a session, and sets an
   HttpOnly cookie. `GET /me` returns the signed-in user.

## Local development

The Cloud Agent environment is configured in [`.cursor/environment.json`](.cursor/environment.json):

- **install** (`scripts/install.sh`): installs Postgres + `pnpm install`.
- **start** (`scripts/start.sh`): starts a local Postgres cluster (a stand-in
  for Neon so nothing cloud is required), applies Drizzle migrations, and seeds
  `services/api/.dev.vars`.
- **terminals**: `api` (`wrangler dev`, port 8787) and `web` (Vite, port 5173).

Manual equivalent:

```bash
pnpm install
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
- In production the Worker binds Neon's **pooled** URL through a Hyperdrive
  config (`cyvra-mobile-neon`); migrations use the **direct** URL. See
  [GUIDELINE.md](GUIDELINE.md) §6 and §11.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the Worker API and web app together |
| `pnpm --filter @cyvra/api dev` | Worker API only (`wrangler dev`) |
| `pnpm --filter @cyvra/web dev` | Web app only (Vite) |
| `pnpm db:generate` | Generate Drizzle SQL migrations from the schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm typecheck` | Type-check every package |
