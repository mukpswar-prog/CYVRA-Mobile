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
| T-G5-NEON | Codespaces: `pnpm db:migrate` with Neon `DATABASE_URL_DIRECT` | Tables `device_lifecycles`, `processing_sessions`, `capability_profiles`, `evidence_records`, `evidence_batches` | `queued-dashboard` (do not migrate from this agent) |
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

## G6 — Report 1 (queued)

| ID | How | Expected | Status |
|---|---|---|---|
| T-G6-FREEZE | Freeze manifest after S1 session | `frozenAt` set; later edits do not rewrite it | `queued-no-device` |
| T-G6-WITHHOLD | Session with denied camera + no telephony | Report shows LIMITED/NOT_SUPPORTED, no invented grade | `queued-no-device` |
| T-G6-NAMES | PDF/web | User name + objective name per test (`Camera Check` / `Camera Functional Verification`) | `queued-no-device` |
| T-G6-NONGOALS | Read report footer | No sanitization-done, OEM authority, ownership, warranty, “certified perfect” | `queued-no-device` |

---

## Out of pool until later gates

- G7 admin Mobile section (Erase repo)
- G8 www nav link (last)
- G9 Station / authorized ADB
- G10 Knox / UEM
