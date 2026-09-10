# CYVRA Mobile — test pool

Living list of **what to test** and **how**. Software is written first; device
tests wait until a Samsung handset is on the bench. Do not invent PASS/FAIL
from this file.

Status values: `automated` | `queued-no-device` | `queued-dashboard` | `blocked`.

Index: [README.md](./README.md). Research: [samsung-s1-sources.md](../research/samsung-s1-sources.md).

---

## G0 — GitHub description

| ID | How | Expected | Status |
|---|---|---|---|
| T-G0-DESC | GitHub → Settings → General → Description. Exact string in [g0-github-description.md](../g0-github-description.md). | `CYVRA Mobile Evidence — Android phone & tablet verification, reports, and CYVRA Station` | `queued-dashboard` (`gh` is read-only here) |

---

## G3 — custom domain (no Samsung needed)

| ID | How | Expected | Status |
|---|---|---|---|
| T-G3-MOBILE | `curl -I https://mobile.cyvra.co.in/` | HTTP 200, HTML title CYVRA Mobile Evidence | `automated` (checked 9 Sep 2026) |
| T-G3-PAGES | `curl -I https://cyvra-mobile.pages.dev/` | HTTP 200 | `automated` |
| T-G3-API | `curl https://cyvra-mobile-api.mukpswar.workers.dev/health` | `status=ok`, `database=connected`, `env=preview` | `automated` |
| T-G3-API-HOST | `curl https://api-mobile.cyvra.co.in/health` | Host should resolve only after Worker custom domain | `queued-dashboard` (NXDOMAIN on 9 Sep 2026) |
| T-G3-SIGNIN | Open https://mobile.cyvra.co.in/ → register with name + pincode + email → OTP | Signed-in home; logins separate from Windows | `queued-dashboard` (preview already proven on pages.dev) |
| T-G3-PROD-ENV | Flip `API_ENV=production` only after a real OTP email arrives | Production never returns `devCode` | `queued-dashboard` |

---

## G4 — evidence package (this slice)

Run: `pnpm --filter @cyvra/evidence test` and `pnpm --filter @cyvra/evidence typecheck`.

| ID | How | Expected | Status |
|---|---|---|---|
| T-G4-PERM | Unit: `isNonFailure("PERMISSION_DENIED")` | true; coerce-to-FAIL throws | `automated` |
| T-G4-DIGEST | Unit: key order / pretty JSON | Same digest; pretty JSON is not the hash input | `automated` |
| T-G4-CAMERA-ABSENT | Unit: feature camera false | `FN.CAMERA_BACK_CAPTURE` → `NOT_SUPPORTED`, not FAIL | `automated` |
| T-G4-CAMERA-PERM | Unit: camera present, permission false | `PERMISSION_DENIED`, UI “Permission required” | `automated` |
| T-G4-READY | Unit: camera + permission | UI “Ready to test”, result still `NOT_TESTED` | `automated` |
| T-G4-TABLET | Unit: telephony feature false | `NET.CELLULAR` → `NOT_SUPPORTED` | `automated` |
| T-G4-FORBIDDEN | Unit: IMEI / SOH / Knox PASS from S1 | Honesty issues; planned `NOT_AVAILABLE` | `automated` |
| T-G4-CONFLICT | Unit: S1 LIMITED + S3 PASS | Summary S3; both raw records kept | `automated` |
| T-G4-SCHEMA | Unit: five JSON Schema files load | `$id` under `https://mobile.cyvra.co.in/schema/` | `automated` |
| T-G4-TYPECHECK | `pnpm --filter @cyvra/evidence typecheck` | clean | `automated` |

---

## G5 — S1 Android scaffold + Worker ingest (no Samsung in hand)

Codespaces can verify the JVM core and local ingest. APK install waits for a phone + Android Studio. Live Neon ingest waits for migration `0002_sturdy_salo` on the direct URL.

| ID | How | Expected | Status |
|---|---|---|---|
| T-G5-CORE | Codespaces: `cd apps/android && ./gradlew :core:test --no-daemon` | Gradle **9.1.0** (Java 25 OK). `G5CoreTest` PASS | `automated` |
| T-G5-CATALOG-SYNC | `pnpm --filter @cyvra/evidence test` | `s1-catalog.v1.json` IDs match TypeScript catalog | `automated` |
| T-G5-PARSE | Unit: `parseEvidenceIngest` on honest IMEI `NOT_AVAILABLE` | Parses; honesty is a later gate | `automated` |
| T-G5-INGEST | Codespaces: `bash scripts/run-local-evidence.sh` | Starts local Postgres + wrangler if needed. 401 without session; honest IMEI 200; IMEI PASS 400; replay keeps `collectedAt` | `automated` (local Postgres) |
| T-G5-NEON | Codespaces: `bash scripts/migrate-neon.sh` then Neon SQL table list | Tables `device_lifecycles`, `processing_sessions`, `capability_profiles`, `evidence_records`, `evidence_batches`. Script refuses local/`-pooler`. | `automated` (10 Sep 2026) |
| T-G5-APP-SDK | Android Studio: open `apps/android` with SDK, `local.properties` sdk.dir | `:app` module appears; assembleDebug | `queued-dashboard` (needs Android SDK) |

Device rows below stay `queued-no-device`. Unlock with the **owner’s** credentials. If lock is unknown: **stop**. No bypass. No Knox enrollment. USB debugging off unless a later S2 session needs it.

### Setup (when a Samsung exists)

1. Unlock the device with the **owner’s** credentials. If lock is unknown: **stop**. No bypass.
2. Install the CYVRA Mobile Evidence debug APK (sideload). No root. No Knox enrollment.
3. Keep USB debugging **off** unless a later S2 session explicitly needs it. USB ≠ authorization.

### Identity

| ID | Steps | Expected |
|---|---|---|
| T-G5-BUILD | Open Identity → Build identity | `MANUFACTURER`, `MODEL`, `FINGERPRINT`, SDK recorded. No IMEI on screen. |
| T-G5-ANDROID-ID | Open App-scoped Android ID | A 64-bit hex id. Label says it is not IMEI. |
| T-G5-IMEI | Open IMEI / serial row | Result `NOT_AVAILABLE` (not FAIL). Copy does not claim Knox. |
| T-G5-FORM | Note `smallestScreenWidthDp` | Phone typically < 600; tablet ≥ 600. No product split. |

### Permissions (request at test start)

| ID | Steps | Expected |
|---|---|---|
| T-G5-CAM-DENY | Start Camera Check → Deny | `PERMISSION_DENIED`, not FAIL. |
| T-G5-CAM-ALLOW | Start Camera Check → Allow → capture | `PASS` or `LIMITED` with a stated limitation. |
| T-G5-MIC-DENY | Start Microphone Check → Deny | `PERMISSION_DENIED`. |

### Hardware absent vs fail

| ID | Steps | Expected |
|---|---|---|
| T-G5-NO-TELEPHONY | On a tablet without SIM/radio | `NET.CELLULAR` = `NOT_SUPPORTED`. |
| T-G5-SENSOR-MISMATCH | Compare feature flag vs `getDefaultSensor` | If declared but sensor null: limitation `SENSOR_DECLARED_BUT_MISSING`, not FAIL. |

### Power

| ID | Steps | Expected |
|---|---|---|
| T-G5-BATT-STATUS | Battery status test | Level/scale/plugged/`EXTRA_HEALTH` only. |
| T-G5-BATT-SOH | Battery SOH row | `NOT_AVAILABLE` on S1. No Good/Weak/Bad grade from Knox AI. |

### Security

| ID | Steps | Expected |
|---|---|---|
| T-G5-LOCK | Lock present | Boolean only. App offers no PIN/FRP bypass. |
| T-G5-USB-ADB | USB + ADB rows | Independent fields. ADB visible ≠ authorized. |
| T-G5-KNOX | Knox row | `NOT_AVAILABLE`. No Samsung-authorized claim. |

### Offline sync

| ID | Steps | Expected |
|---|---|---|
| T-G5-OFFLINE | Airplane mode → run two tests → go online | Queue uploads. `collectedAt` unchanged after sync. |

All G5 rows: status `queued-no-device`.

---

## G6 — Report 1 (frozen manifest)

Run units: `pnpm --filter @cyvra/evidence test`. Local freeze: `bash scripts/run-local-report.sh`.

| ID | How | Expected | Status |
|---|---|---|---|
| T-G6-COVERAGE | Unit: missing catalog test / withheld / all PASS\|FAIL | PARTIAL / LIMITED / COMPLETE | `automated` |
| T-G6-FREEZE | Codespaces: `bash scripts/run-local-report.sh` | `POST /reports/freeze` 200, `frozenAt` set; replay returns the same `frozenAt` | `automated` (local Postgres) |
| T-G6-WITHHOLD | Same script: IMEI `NOT_AVAILABLE` + camera `PERMISSION_DENIED` + cellular `NOT_SUPPORTED` | Coverage PARTIAL (catalog incomplete). No invented PASS/FAIL | `automated` (local Postgres) |
| T-G6-NAMES | GET `/reports/:id` | User name + objective name (`Camera Check` / `Camera Functional Verification`) | `automated` |
| T-G6-NONGOALS | GET report footer | No sanitization-done, OEM authority, ownership, warranty, “certified perfect” | `automated` |
| T-G6-NEON | `bash scripts/migrate-neon.sh` after `0003` exists | Tables `reports`, `report_manifests` on Neon. Do this **before** live Worker deploy | `automated` (10 Sep 2026) |
| T-G6-DEPLOY | `bash scripts/deploy-api-preview.sh` | Live `/health` `ok` / `preview` / `connected`. Unauth `POST /reports/freeze` is 401 | `automated` (10 Sep 2026, version `38ef01e5-8400-4452-87d1-e1e576e2e27a`) |
| T-G6-PRINT | Signed-in web → Freeze / View → Print / Save as PDF | HTML print view; PDF is a view, not a second SoT | `queued-dashboard` |

---

## Out of pool until later gates

- G7 admin Mobile section (Erase repo)
- G8 www nav link (last)
- G9 Station / authorized ADB
- G10 Knox / UEM
