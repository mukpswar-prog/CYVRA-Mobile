# Codespaces — what you run (G4 + G5 core)

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

Expected: all G4 tests pass; typecheck clean.

## 3. G5 Android **core** (no phone, no Android SDK)

This VM/Codespace can run the JVM module. It cannot install an APK.

```bash
cd /workspaces/CYVRA-Mobile/apps/android
./gradlew :core:test --no-daemon
```

Expected: `G5CoreTest` PASS.

## 4. Live hosts (optional)

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://mobile.cyvra.co.in/
curl -sS https://cyvra-mobile-api.mukpswar.workers.dev/health
```

Expected: `200` and `status=ok`.

## Do not run here

- `./gradlew :app:assembleDebug` — needs Android SDK + `local.properties`. Use Android Studio on a machine with SDK when a Samsung is available.
- Device rows in `docs/testing/pool.md` (`queued-no-device`).
