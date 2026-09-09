# Codespaces verify → GitHub → Cloudflare Pages

Use GitHub Codespaces for verification. Push to GitHub. Cloudflare Pages
project **`cyvra-mobile`** builds from this repo. Do **not** connect or change
`cyvra-www`.

Codespace: `https://supreme-umbrella-6v4rwwwxrwq524w4j.github.dev/`  
Path: `/workspaces/CYVRA-Mobile`

Never commit `.env`, `.dev.vars`, or connection strings.

## 0. Split of systems

| Piece | How it updates |
| --- | --- |
| Customer web `cyvra-mobile` | GitHub `main` (and preview branches) → Cloudflare Pages, after dashboard **Connect Git**. Until then, Direct Upload to **`cyvra-mobile` only** |
| Worker `cyvra-mobile-api` | Live at `https://cyvra-mobile-api.mukpswar.workers.dev`. Hyperdrive `cyvra-mobile-neon` (`db31fc8dafca49b29172da7046b97175`) is bound as `HYPERDRIVE` |
| Neon `floral-art-02749206` | Migrations from Codespaces (`pnpm db:migrate`) using **direct** URL |
| Resend | Worker secret only; optional for preview OTP |

## 1. In Codespaces — get the G0–G3 branch

You opened Codespaces on **`main`**. The preview-ready web/API work is on
`cursor/g0-g3-mobile-slice-7474` (PR #2). Pull it first:

```bash
cd /workspaces/CYVRA-Mobile
git fetch origin
git checkout cursor/g0-g3-mobile-slice-7474
# or, after you merge PR #2: git checkout main && git pull
corepack enable
pnpm install
```

## 2. Point local files at Neon (gitignored)

```bash
cp database/.env.example database/.env
cp services/api/.dev.vars.example services/api/.dev.vars
cp apps/web/.env.example apps/web/.env
```

Edit `database/.env`:

- `DATABASE_URL` = Neon **pooled** URL (`-pooler` in the host)
- `DATABASE_URL_DIRECT` = Neon **direct** URL (same host **without** `-pooler`)

Leave `apps/web/.env` as `VITE_API_URL=http://localhost:8787` for Codespaces.

Leave `RESEND_API_KEY` empty in `.dev.vars` until the domain is verified. Preview
shows the OTP on screen.

## 3. Verify in Codespaces

```bash
export DATABASE_URL_DIRECT='…direct…'   # or rely on database/.env
pnpm db:migrate
pnpm --filter @cyvra/api dev            # http://localhost:8787
# new terminal
pnpm --filter @cyvra/web dev            # http://localhost:5173
```

Open the forwarded **5173** URL. Request a code → enter the on-screen Dev
code → you should see “You're signed in”.

Also:

```bash
curl -sS http://127.0.0.1:8787/health
pnpm typecheck
```

Do not deploy Erase workers. Do not run `wrangler pages deploy` to `cyvra-www`.

## 4. Connect Pages Git (once, in the dashboard)

Account: `5a3eeb2b3d42726a8ba08732464a0eda`  
Project: **`cyvra-mobile` only**  
https://dash.cloudflare.com/5a3eeb2b3d42726a8ba08732464a0eda/workers-and-pages

If `cyvra-mobile` is not yet attached to GitHub:

1. Open **`cyvra-mobile`** → Settings → Builds & deployments.
2. Connect Git: repo **`mukpswar-prog/CYVRA-Mobile`**.
3. Production branch: **`main`**.
4. Leave **root directory empty** (monorepo root). Do not set it to `apps/web`
   (pnpm workspaces need the repo root).
5. Build command:

```text
corepack enable && pnpm install --frozen-lockfile && pnpm --filter @cyvra/web build
```

6. Build output directory: `apps/web/dist`
7. Environment variable (Pages, production **and** preview) — already set:

```text
VITE_API_URL=https://cyvra-mobile-api.mukpswar.workers.dev
```

No `DATABASE_URL` on Pages.

`cyvra-mobile` is still a Direct Uploads project (Git provider = No). The API
cannot attach Git (`8000069`). Use the dashboard **Connect Git** step above.
Until then, do **not** run `wrangler pages deploy` against `cyvra-www`. A
Direct Upload is only allowed for project **`cyvra-mobile`**.

## 5. Push so Pages builds

After Codespaces verification:

```bash
git status
git push -u origin HEAD
```

- Feature branch → Pages **preview** URL (`*.cyvra-mobile.pages.dev`).
- Merge to **`main`** → Pages **production** URL for `cyvra-mobile`.

Then tell the Worker the Pages origin (CORS): Worker `cyvra-mobile-api` →
Settings → Variables → `APP_ORIGIN` = the Pages URL, `API_ENV` = `preview`
until custom domain.

## 6. Hyperdrive (already created)

Hyperdrive **`cyvra-mobile-neon`** id `db31fc8dafca49b29172da7046b97175` is
bound on Worker `cyvra-mobile-api` as **`HYPERDRIVE`**. The same id is in
`services/api/wrangler.jsonc`. Never commit the Neon connection string.

Worker vars on preview: `API_ENV=preview`,
`APP_ORIGIN=https://cyvra-mobile.pages.dev`. After the first Pages URL is
live, keep `APP_ORIGIN` pointed at that origin (CORS also allowlists
`*.cyvra-mobile.pages.dev`).
