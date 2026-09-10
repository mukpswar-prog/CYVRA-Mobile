# CYVRA Mobile Evidence — S1 Android (G5 scaffold)

Application id `co.in.cyvra.mobile` (Kotlin package `cyvra.mobile` — `in` is a keyword).
G4 contract is loaded from `packages/evidence/schema/s1-catalog.v1.json`.

Gradle **9.1.0** is required so Codespaces Java 25 can run the wrapper.
Gradle 8.13 fails on Java 25 with `What went wrong: 25.0.4.1`.

- **`:core`** — JVM. Catalog, plan, honesty, offline queue. Runs in Codespaces.
- **`:app`** — Android UI. Included only when `ANDROID_HOME` or `local.properties` exists.

No Knox. No IMEI collection. No lock bypass. USB ≠ authorization.

Codespaces: [docs/codespaces-g5.md](../../docs/codespaces-g5.md).
Device tests: [docs/testing/pool.md](../../docs/testing/pool.md).
