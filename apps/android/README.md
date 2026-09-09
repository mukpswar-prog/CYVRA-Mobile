# CYVRA Mobile Evidence — S1 Android (G5 scaffold)

Kotlin app applicationId `co.in.cyvra.mobile` (package `cyvra.mobile` — `in` is a Kotlin keyword).
`packages/evidence/schema/s1-catalog.v1.json`.

- **`:core`** — JVM. Catalog, plan, honesty, offline queue. Runs in Codespaces.
- **`:app`** — Android UI. Included only when `ANDROID_HOME` or `local.properties` exists.

No Knox. No IMEI collection. No lock bypass. USB ≠ authorization.

Codespaces: [docs/codespaces-g5.md](../../docs/codespaces-g5.md).
Device tests: [docs/testing/pool.md](../../docs/testing/pool.md).
