# Codespaces — what you run (G4 + G5 core + ingest)

You opened Codespaces on **`main`**. Work is on
`cursor/g0-g3-mobile-slice-7474`. Switch first, then verify. Do **not** force-push.

## 1. Switch branch (required)

In the Codespaces terminal (`/workspaces/CYVRA-Mobile`):

```bash
cd /workspaces/CYVRA-Mobile
git fetch origin
git checkout cursor/g0-g3-mobile-slice-7474
git pull --rebase origin cursor/g0-g3-mobile-slice-7474
```

If `git pull --rebase` asks you to stash, `git stash -u` then pull, then `git stash pop`.

## 2. Node + G4 evidence tests

```bash
nvm install && nvm use
corepack enable && corepack prepare pnpm@12.3.4 --activate
pnpm install
pnpm --filter @cyvra/evidence test
pnpm typecheck
```

Expected: G4 + parse tests pass (19); typecheck clean.

## 3. G5 Android **core** (no phone, no Android SDK)

Codespaces default JDK is **Java 25**. The wrapper is Gradle **9.1.0** so that JVM can run Gradle (8.13 dies with `What went wrong: 25.0.4.1`).

```bash
cd /workspaces/CYVRA-Mobile/apps/android
java -version
./gradlew :core:test --no-daemon
```

Expected: log line `cyvra-mobile-android: Java 25…`, then `BUILD SUCCESSFUL`, `G5CoreTest` PASS.

## 4. Live hosts (optional)

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://mobile.cyvra.co.in/
curl -sS https://cyvra-mobile-api.mukpswar.workers.dev/health
```

Expected: `200` and `status=ok`.

## 5. G5 evidence ingest (Codespaces)

Codespaces does **not** start Postgres or wrangler. `pnpm db:migrate` with no
Neon URL talks to `127.0.0.1:5432`. The ingest script talks to `:8787`. If
those are down you get `ECONNREFUSED` / `curl: (7)` — that is missing local
services, not a bad migration.

One command (installs Postgres if needed, migrates the **local** cluster,
starts wrangler if `:8787` is down, runs the ingest test, leaves wrangler up):

```bash
cd /workspaces/CYVRA-Mobile
git pull --rebase origin cursor/g0-g3-mobile-slice-7474
bash scripts/run-local-evidence.sh
```

First run may `apt-get install postgresql` (sudo). Expected: 401 without a
session; honest IMEI `NOT_AVAILABLE` is 200; IMEI `PASS` is 400; replay keeps
the original `collectedAt`.

Do **not** run bare `pnpm db:migrate` until Postgres is up (the command above
does that). Live Neon is a different URL:

```bash
# gitignored database/.env — Neon direct host (no -pooler). Never commit this file.
# DATABASE_URL_DIRECT=postgres://neondb_owner:***@ep-….aws.neon.tech/neondb?sslmode=require
pnpm db:migrate
```

Do **not** deploy ingest routes to the live Worker until that Neon migrate
succeeds. `/health` does not need the new tables; `POST /evidence/batches` does.

## 6. Live Neon migrate + Worker deploy (Codespaces)

A4 (password rotate + live `/health` `database=connected`) can succeed **before**
evidence tables exist. Neon SQL listing only `users` / `sessions` /
`email_otp_challenges` (and maybe leftover `books_to_read`) means **A6 did not
run against Neon**. `start.sh` seeds `DATABASE_URL_DIRECT` as `127.0.0.1`.
Changing only `DATABASE_URL` still migrates local Postgres.

Do **not** `source` or `bash database/.env`. Comments and Neon passwords can
contain `(` and `$`. `migrate-neon.sh` parses the file; it does not execute it.

### 6.1 Point `DATABASE_URL_DIRECT` at Neon, then migrate

Do **not** use `nano` (often missing in Codespaces). `database/.env` is
gitignored, so the file tree may hide it.

```bash
cd /workspaces/CYVRA-Mobile
git pull --rebase origin cursor/g0-g3-mobile-slice-7474
bash scripts/open-db-env.sh
```

That creates the file if needed and opens it in the editor. Change **only**
the `DATABASE_URL_DIRECT=` line to the Neon **direct** string: Connect →
production / `neondb` / `neondb_owner` → **Pooled connection unchecked**.
Host must **not** contain `-pooler`. Leave `DATABASE_URL` as `127.0.0.1`.
Save the file (Ctrl+S).

If the editor did not open: Command Palette (`Ctrl+Shift+P`) → type
`excludeGitIgnore` → turn **Explorer: Exclude Git Ignore** off, then
`Ctrl+P` and open `database/.env`.

```bash
git check-ignore -v database/.env
git status --short
bash scripts/migrate-neon.sh
```

`migrate-neon.sh` prints the **host only** and refuses `127.0.0.1` or `-pooler`.
Expect `[migrate] target ep-….neon.tech:5432` then `[migrate] done`.

Neon SQL Editor again: you must see `device_lifecycles`, `processing_sessions`,
`capability_profiles`, `evidence_records`, `evidence_batches`.

### 6.2 Deploy the Worker (API token — not `wrangler login`)

`wrangler login` in Codespaces **always times out**. OAuth callback is
`http://localhost:8976` on the codespace, not your Windows browser.

1. https://dash.cloudflare.com/profile/api-tokens → **Create Token**.
2. Template **Edit Cloudflare Workers**.
3. Account resources: include `5a3eeb2b3d42726a8ba08732464a0eda`.
4. Create. Copy once. Do not paste it into chat. Prefer a **new** token (an
   older one was pasted in chat and should stay rotated).
5. In the Codespaces terminal (this session only):

```bash
export CLOUDFLARE_API_TOKEN=...   # paste in the terminal, not in Git or chat
bash scripts/deploy-api-preview.sh
```

To persist across rebuilds: GitHub repo **Settings → Secrets and variables →
Codespaces →** `CLOUDFLARE_API_TOKEN`, then rebuild the codespace.

Expect whoami on account `5a3eeb2b3d42726a8ba08732464a0eda`, deploy of
`cyvra-mobile-api` with `API_ENV=preview` and
`APP_ORIGIN=https://cyvra-mobile.pages.dev`. Do not add a second `API_ENV`.
Do not flip to `production`. The deploy script passes those `--var`s so
local `wrangler.jsonc` (`localhost:5173` / `development`) does not overwrite
the live Worker.

## Do not run here

- `./gradlew :app:assembleDebug` — needs Android SDK + `local.properties`. Use Android Studio on a machine with SDK when a Samsung is available.
- Device rows in `docs/testing/pool.md` (`queued-no-device`).
