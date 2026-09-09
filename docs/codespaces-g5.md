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

## 5. G5 evidence ingest (local Postgres, no phone)

`wrangler dev` and the local cluster must already be up (`scripts/start.sh` or `pnpm dev`).

```bash
cd /workspaces/CYVRA-Mobile
pnpm db:migrate
API_URL=http://127.0.0.1:8787 bash scripts/test-local-evidence.sh
```

Expected: unauthenticated POST is 401; honest IMEI `NOT_AVAILABLE` is 200; IMEI `PASS` is 400; replay keeps the original `collectedAt`.

Live Neon still has auth tables only until you apply migration `0002_sturdy_salo` with the **direct** URL in gitignored `database/.env`:

```bash
# database/.env — Neon direct host (no -pooler). Never commit this file.
# DATABASE_URL_DIRECT=postgres://neondb_owner:***@ep-….aws.neon.tech/neondb?sslmode=require
pnpm db:migrate
```

Do **not** deploy ingest routes to the live Worker until that Neon migrate succeeds. `/health` does not need the new tables; `POST /evidence/batches` does.

## Do not run here

- `./gradlew :app:assembleDebug` — needs Android SDK + `local.properties`. Use Android Studio on a machine with SDK when a Samsung is available.
- Device rows in `docs/testing/pool.md` (`queued-no-device`).
