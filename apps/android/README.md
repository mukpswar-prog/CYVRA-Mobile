# CYVRA Mobile Evidence — Android component (G5 scaffold)

The APK is a **supporting device-side component**. The Windows host is the
orchestrator (slice A3, `apps/host`). Freeze:
[docs/ANDROID_COMPATIBILITY_FREEZE.md](../../docs/ANDROID_COMPATIBILITY_FREEZE.md).

Application id `co.in.cyvra.mobile` (Kotlin package `cyvra.mobile` — `in` is a keyword).
G4 contract is loaded from `packages/evidence/schema/s1-catalog.v1.json`.

| Knob | Frozen |
|---|---|
| Kotlin / KGP | **2.3.21** (A1; was 2.2.10) |
| AGP | **8.13.2** (do not move to AGP 9) |
| Gradle wrapper | **9.1.0** (Codespaces Java 25 needs 9.1+) |
| JDK | **21** |
| compileSdk / targetSdk | **36** (A2; still 35 until A2) |
| minSdk | **26** APK floor (A2; still 29 until A2). Not the host service floor. |

- **`:core`** — JVM. Catalog, plan, honesty, offline queue, planned-batch collect. Runs without a phone. Home for generic evidence interfaces.
- **`:app`** — Optional Android UI. Included only when `ANDROID_HOME` or `local.properties` exists.
  Shares `files/cyvra-g5-batch.json` for laptop `POST /evidence/batches`.

No Knox. No IMEI collection. No lock bypass. USB file copy is not device authorization.
Laptop `:app:assembleDebug` after A2 needs **SDK Platform 36**.

Laptop, after a customer sign-in (not `ADMIN_API_TOKEN`):

```bash
API_URL=https://api.cyvoriq.co.in CYVRA_SESSION_TOKEN=… \
  bash scripts/post-g5-batch.sh --live ./cyvra-g5-batch.json
```

Codespaces: [docs/codespaces-g5.md](../../docs/codespaces-g5.md).
Device tests: [docs/testing/pool.md](../../docs/testing/pool.md).
