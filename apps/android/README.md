# CYVRA Mobile Evidence — S1 Android (G5 scaffold)

Application id `co.in.cyvra.mobile` (Kotlin package `cyvra.mobile` — `in` is a keyword).
G4 contract is loaded from `packages/evidence/schema/s1-catalog.v1.json`.

Gradle **9.1.0** is required so Codespaces Java 25 can run the wrapper.
Gradle 8.13 fails on Java 25 with `What went wrong: 25.0.4.1`.

- **`:core`** — JVM. Catalog, plan, honesty, offline queue, planned-batch collect. Runs without a phone.
- **`:app`** — Android UI. Included only when `ANDROID_HOME` or `local.properties` exists.
  Shares `files/cyvra-g5-batch.json` for laptop `POST /evidence/batches`.

No Knox. No IMEI collection. No lock bypass. USB file copy is not device authorization.

Laptop, after a customer sign-in (not `ADMIN_API_TOKEN`):

```bash
API_URL=https://api.cyvoriq.co.in CYVRA_SESSION_TOKEN=… \
  bash scripts/post-g5-batch.sh --live ./cyvra-g5-batch.json
```

Codespaces: [docs/codespaces-g5.md](../../docs/codespaces-g5.md).
Device tests: [docs/testing/pool.md](../../docs/testing/pool.md).
