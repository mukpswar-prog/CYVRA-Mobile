# CYVRA Mobile — Activity Review: Every Command After the Journey Freeze

**Date:** 2026-10-10
**Status:** DRAFT — uncommitted
**Purpose:** Step back before building again. Identify what we did, where it landed, and
which effects must now be reproduced **inside the desktop `.exe`**.
**Mandate:** No web-based version of the core product. Web is the frozen commercial control
plane only.

---

## 1. The freeze anchor

The confirming command is **yours, 08-Oct-2026**, message `[195]` at `10-08 16:38`:

> **TASK P + TASK O (REVISED) — CORE ENGINE GOVERNED DOCUMENT + RESEARCH HARNESS**
> Authority: Chief Engineer ruling 08-Oct-2026. **Mandates M1-M4 in force.**
> NO merge — NO deploy — NO Neon write — NO physical-device adb runs

Codified the same day in `docs/CYVRA_CORE_ENGINE_JOURNEY_FINAL_V2_2026-10-08.txt:8`:

> **M1 Customer journey (purchase->licence->download) FROZEN COMPLETE; no changes.**
> M2 .exe upgrades ONLY on fully verified outcome.
> M3 Android deep research + Android Studio verification.
> M4 AI scope & integration. Core application only: `apps/desktop`, `apps/host`,
> `apps/android`, telemetry service, docs.

Ratified on `main` as **`205be95`** (10-08 22:25). From `[198]` onward, every single
commission you issued repeats the header: *"Mandates M1-M4 in force. Customer journey
FROZEN."*

A second, earlier freeze also applies: **Design Freeze v1.0 (05-Oct-2026)**, `73d3f3a`.

---

## 2. Where effort actually went — the measurement

File-touches on `main`, grouped by surface:

| Surface | **Pre-freeze** 10-06 09:33 → 10-08 16:38 | **Post-freeze** 10-08 16:38 → now |
|---|---:|---:|
| `apps/web` | **53** | **1** |
| `services/api` | 18 | 0 |
| `database/migrations` | 8 | 0 |
| `apps/android` | 0 | **10** |
| `apps/host` | 0 | **10** |
| `scripts/pur-do-wipe` | 0 | 5 |
| `scripts/android-probe` | 0 | 3 |
| `docs` | ~12 | ~9 |
| **total** | **98** | **41** |

**The freeze worked.** Pre-freeze effort was 54 % web. Post-freeze effort is **0 % web
product code** (the single `apps/web` touch is `public/build-manifest.json`, a generated
artefact) and **49 % core product** (`apps/host` + `apps/android` + `scripts`).

No post-freeze commit re-opened the customer journey.

---

## 3. Pre-freeze era — what was built (context, not blame)

| Date | Work | Landed in |
|---|---|---|
| 10-06 | WS-H1 atomic licence issue + row action zone | `apps/web`, `services/api` |
| 10-06 | WS-H2 registry polish, IST dates, payment method | `apps/web` |
| 10-06 | Trophy Journey Step 1 closure record | `docs` |
| 10-07 | WS-K1-01 hotfix — stopped minting a fabricated NIST erasure certificate | `apps/web` |
| 10-07 | WS-K Phases 1-3 — light-steel shell, Overview, Purchase, Payment, honest Download card | `apps/web` |
| 10-08 | WS-K3 licence-request endpoint, migration 0010, WS-I v2 release pipeline | `services/api`, `.github` |
| 10-08 | WS-K1-11 comment-leak fix | `apps/web` |
| 10-08 | Release publish — installer manifest (WS-I) | `.github`, `docs` |

This is the **purchase->licence->download** journey (M1). It is frozen, it works, and it is
correct where it is.

---

## 4. Post-freeze era — every commission you issued

| # | When | Msg | Commission | Landed in | Effect |
|---|---|---|---|---|---|
| 1 | 10-08 16:38 | `[195]` | TASK P + TASK O — governed document + research harness | `docs`, `scripts/android-probe` | the contract everything now cites |
| 2 | 10-08 22:25 | — | ratify journey FINAL v2 (**`205be95`**) | `docs` | M1-M4 in force |
| 3 | 10-08 22:54 | — | TASK O artifacts (**`fc59cd6`**) | `docs`, `scripts` | probe harness, patch schema, telemetry spec, T&C draft |
| 4 | 10-09 05:28 | `[198]` | TASK Q — capability matrix v1 seed from real fixtures | `docs`, `apps/android/core` fixtures | ground truth, not assumption |
| 5 | 10-09 09:25 | `[203]` | TASK R — CORE-ENG-1 advanced engine design | `docs` only | design before code |
| 6 | 10-09 11:20 | `[204]` | TASK S — CORE-ENG-2 Kotlin engine | **`apps/host` only** | the engine that ships in the `.exe` |
| 7 | 10-09 14:02 | `[206]` | TASK T-PREP — sanitization agent APK POC | `apps/android/sanitization-agent` | the wipe-capable component |
| 8 | 10-09 15:08 | `[207]` | TASK T — PUR-DO-WIPE proof on D-P5 | physical device | device-owner enrolled, `exit=0` |
| 9 | 10-09 | `[208]` | your ruling: **OPTION B** — force-clean first, then re-run TASK T | — | corrected the sequence |
| 10 | 10-09 16:23 | `[209]` | *"why cant we do this action from our application, find all reasons, can we tune our application"* | — | **the integration question is raised by you here** |
| 11 | 10-09 16:30 | `[210]` | AUTHORIZATION: EXECUTE WIPE (phase 2b) | physical | halted at 2b pre-flight |
| 12 | 10-10 04:01-05:12 | `[212]`-`[214]` | Studio lock analysis (no kill, no reset); TASK T 2b authorized | physical | root-caused a double-launch race |
| 13 | 10-10 05:18 | `[215]` | deep forensic audit + "read all our previous chat" | `docs` | the resume/audit set |
| 14 | 10-10 06:31 | `[216]` | ***"are we actually upgrading the .exe desktop application or the wrong web application"*** | — | **the doubt this document answers** |
| 15 | 10-10 06:52 | `[217]` | HOLD all build/commit/push until exact track confirmed | — | the standing hold |
| 16 | 10-10 07:09 | `[218]` | *"we will not touch any thing in the customer journey which we build successfully"* | — | customer journey untouchable |
| 17 | 10-10 07:37 | `[219]` | self-contained `.exe`: every USB driver pre-installed | — | WP-1 requirement |
| 18 | 10-10 08:01 | `[220]` | R-A counter-audit accepted (Kotlin engine IS integrated) | — | corrected a wrong diagnosis |
| 19 | 10-10 08:25 | `[221]` | R-E `offlineInstaller`; R-F WP-0 authorized | — | true offline install |
| 20 | 10-10 (today) | R-F | **WP-0** — you ran the full 5-step journey through the product on D-P5 | `apps/desktop`, `apps/host` | integration empirically proven |
| 21 | 10-10 11:25 | `[225]` | **INTEGRATION DIRECTION CONFIRMED** — nothing stays isolated | — | the direction for the next build |

---

## 5. Activities that read as detours but produced what we need

You are right that these were not mistakes. Each produced an effect that must now be
reproduced **natively in the `.exe`**:

| Activity | Why it was right | The effect the desktop needs |
|---|---|---|
| WS-K1-01 hotfix (10-07) | Stopped the product minting a certificate for a purge that never happened | the desktop's own `CYVRA-CERT-` generator (A-9) needs the **same** correction — R-2/R-3 |
| WS-K Phase 2-3 shell (10-07) | Replaced a dark shell with a light, honest UI | the desktop UI already inherits the same visual language; keep it |
| WS-K1-09 "honest Download card" | Showed only what entitlement actually allows | the desktop status row must do the same — this is exactly **A-10**, now fixed |
| WS-K1-11 (10-08) | A JSDoc comment was rendering as visible text on screen | same defect class as A-10: the UI claiming something the payload does not support |
| WS-K3 + WS-I v2 (10-08) | Real licence request + a signed release manifest | the desktop needs the same: a **live entitlement** carrying `sanitizeExecute=true` (**A-13 / R-Q**) |
| Probe harness (TASK O) | Ground truth from a real device instead of assumption | the desktop's ADB timeout must be measured the same way (**A-12 / R-R**) |
| Kotlin engine (TASK S) | Built in `apps/host`, the layer that actually ships in the `.exe` | already correct — this is what the counter-audit R-A vindicated |

**The pattern that worked:** every time we made the product *say only what its evidence
supports*, it got better. Every time a claim outran its evidence, we found a defect
(WS-K1-01, WS-K1-11, A-10). That is the effect to reproduce.

---

## 6. What this means for the desktop build

Core objective = **scan the phone, generate the report, purge the device** — installed on
the customer's own laptop. You named this at `[173]` (10-06) and again at `[182]` (10-07):
*"Advance Diagnostic, Ai Physical, data purge result and report are the core feature of our
main application, desktop application."*

State of that objective today, verified by WP-0 on real hardware:

| Capability | State |
|---|---|
| Rust -> JVM bridge | **proven** (WP-0) |
| Host -> ADB -> device | **proven** (WP-0) |
| Scan + evidence + ledger | **proven** (WP-0, chain intact, hashes recomputed) |
| Report generation + download | **proven** (WP-0, `CYVRA-R1-2026-B3A47D`) |
| Licence gate (read ops) | **proven** (WP-0) |
| Purge trigger from the product | **not wired** (WP-2, WP-3) |
| Purge entitlement | **absent** — `sanitizeExecute=false` (A-13) |
| Self-contained install | **not yet** — drivers + `offlineInstaller` (WP-1) |

---

## 7. No web version

Stated explicitly so it cannot drift:

- `apps/web` is the **frozen commercial control plane** (M1) and receives **no new product
  features**.
- Every core capability — scan, report, purge — is implemented in `apps/host` +
  `apps/desktop` + `apps/android` and ships inside the **`.exe`**.
- Post-freeze file-touch data confirms this is already how we are working: **1 web touch
  (generated manifest) vs 28 core-product touches.**

---

*Compiled from the local session transcript DB (`session_message`, 227 Chief Engineer
commands in the main thread) and from `git log` on `origin/main`. Emails and the device
serial are redacted at extraction; no fixture content egressed.*
