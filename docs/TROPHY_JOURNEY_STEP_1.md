# Trophy Journey — Step 1: Closure of Prior Workstreams + Forensic Audit

**Date:** 2026-10-06
**Status:** STEP 1 — CLOSE THE PAST, THEN LOOK AT WHAT IS ACTUALLY LEFT
**Repo:** `mukpswar-prog/CYVRA-Mobile` · `main` @ `2797615`
**Method:** static analysis of both checkouts, full `git` history across all refs, read-only inspection of the live production bundles, and the three gates.

---

## 0. Why this document exists

Two things were asked:

1. *Save all our previous activity and mark it closed.*
2. *Explain why we still cannot start the actual objective — scan the mobile, generate a report, purge the device — and why the customer dashboard is still the old one.*

Part A closes the past. Part B–E is the audit. Part F proposes the next action.

Nothing in this document is a plan for new code. `docs/CYVRA_MOBILE_PROJECT_INDEX.md:169` still freezes product-code work behind documentation consolidation, and that freeze is respected here.

---

# PART A — CLOSURE RECORD

## A.1 What is closed

| Workstream | Commit | Merge | State |
|---|---|---|---|
| WS-H1 — atomic issue (Path 6B) + Freeze-compliant row action zone | `6b0733f` | `09b3072` (into `main`) | **CLOSED** |
| WS-H2 — registry columns (§13/§65), payment method + migration 0009, IST dates (§58), registry polish (§12/§56) | `2c6af90` | `2797615` = **PR #47** (into `main`) | **CLOSED** |

Both are on `main`, pushed to `origin/main`, and `main...origin/main` is level. The working tree of the implementation worktree is **clean** — 0 modified, 0 staged.

## A.2 WS-H2 final gate evidence (the last gate run before this step)

| Gate | Command | Result |
|---|---|---|
| 1 | `pnpm.cmd -r typecheck` | **EXIT=0** — apps/web, database, packages/evidence, services/api all Done |
| 2 | `pnpm.cmd -r test` | **EXIT=0** — desktop **71** (5 files), web **261** (14 files), evidence **26**, api **395** = **753 tests, 0 fail** |
| 3 | `wrangler deploy --dry-run` | **EXIT=0** — wrangler 4.130.0, 751.47 KiB / gzip 154.07 KiB |
| Sweep | `git grep -i "Asia/Kolkata"` | exit 0; exactly **2** `ADMIN_TIME_ZONE` constants (one per runtime) |

Baselines: web 237 → 261, api 383 → 395.

## A.3 Deployment verified — independent confirmation in the operator's own screenshots

Not a claim; observed:

- `admin.cyvoriq.co.in` Licence Registry header reads **`REGISTERED EMAIL`** (§13 field 2 / Chief Engineer's ruling) with `No.` and `Registered Email` pinned as the sticky pair and the remaining columns reached by horizontal scroll — **§65's order, live.**
- The **Export XLSX** control is in the toolbar (PILLAR 4).
- A real licence `CYVRA06102026SC60B-1-1` was issued and **emailed** (`Type SINGLE · Devices 1-1 · Brand UNSPECIFIED`) — the issue path end-to-end, in production.
- `cyvoriq.co.in/dashboard` header reads **`PLAN · 1 Device Scans`** and **`VERSION · Build unavailable`** — that is the *real* entitlement row (`CAP-1 / 1-1`, slab 1), not the old fabricated `25 Device Scans`.

**WS-H1 and WS-H2 are closed.**

## A.4 Loose ends deliberately left open at closure

1. **Migration 0009 is not applied to Neon.** Files only (`0009_payment_method.sql`, `meta/0009_snapshot.json`, journal idx 9). The Chief Engineer applies it manually — as ruled.
2. **The `feature/ws-h2-registry-polish` branch still exists on the remote** after merge (PR #47). Safe to delete; not deleted here.
3. **The main checkout `C:\Users\User\Documents\GitHub\CYVRA-Mobile` is parked and dirty.** It sits on `audit-and-planning-2026-09-26` @ `c1a43c7` with ~10 modified/untracked files (`docs/KEY_ROTATION_2026-10-01.md` staged, `0006_*.sql`, `activation.ts`, `entitlementSigner.ts`…). Per `docs/SESSION_HANDOFF_2026-09-29.md` §2 that checkout is **PARKED — do not work here**. It has *not* been touched, committed, or discarded. **It needs a ruling: commit as an archive, or discard.**
4. **Recorded deviations awaiting disposition** from the WS-H2 report: §65 label drift vs §13, "Plan" vs "Licence Plan" in §56, mixed CSV header naming, `docs/P2B-SERVER-GAPS.md` still quoting the old `paymentStatusesFor` name (now `paymentsFor`), and the two-runtime duplication of the IST formatter and payment vocabulary.

---

# PART B — WHAT WE HAVE ACTUALLY ACHIEVED

## B.1 Delivered and production-wired

| Domain | Evidence |
|---|---|
| **Licence state machine** (10 states, 13 §49 edges, exhaustive 10×10 matrix) | `services/api` §49 suites |
| **RBAC / permission matrix** — 60 cells, §41 exact | `answers all 60 cells the way §41 does` |
| **Audit trail** — single insertion path, append-only, 3 immutability triggers from 0007 | `one insertion path` suite; route-coverage suite throws at load for an unclassified write |
| **Atomic issue (Path 6B)** — one transaction, one audit row, email bookkeeping | WS-H1 |
| **Payment confirmation** — `paymentMethod` enum, atomic gate inside the transaction, replay-safe | WS-H2, migration 0009 (files) |
| **Admin console** — table-first registry, drawer, staff, audit, reports, KPIs, server-side search/filters/pagination | `apps/web/src/admin/*` (~50 files), 261 web tests |
| **Design Freeze conformance** — §13/§65 columns, §58 IST, §19 date style, §12 subtitle, §56 export, §57 filename | WS-H2, all gates green |
| **Registration bridge (WS-A)** — plan snapshot onto OTP challenge, self-healing on every sign-in | `registration.ts`, `bridge.ts`, `entitlement.ts` |
| **Entitlement API** — `GET /v1/me/entitlement` with ensure-on-session backfill, production-verified (401 unauthenticated) | `entitlement.ts` |
| **Evidence contract package** — 6 JSON Schemas, S1 catalog, Report-1 assembly, G4/G5/G6 suites | `packages/evidence` |
| **Windows USB enumeration** — SetupAPI observer + reconcile | `src-tauri/src/usb/*`, hardware-validated |
| **WPD/MTP metadata scanner (G6)** — bounded 10k objects / depth 5 / 30 s, SHA-256 inventory digest | `src-tauri/src/wpd/scanner.rs`, hardware-validated on Samsung A10s |
| **Host engine (Kotlin)** — ADB transport, evidence collection, session orchestrator, report engine, sanitization model | `apps/host`, 46 files, unit-tested |
| **Host Protocol — 13 commands** | `RUN_SCAN`, `GET_CONNECTED_DEVICES`, `GET_DEVICE_REPORT`, `GET_APPLICATION_INVENTORY`, `EXPORT_REPORT`, `SANITIZE_START/AUTHORIZE/CONFIRM/EXECUTE/VERIFY`, `GET_FINAL_REPORT`, `GET_LICENSE_STATE` |
| **Desktop 5-step wizard** — Connect / Scan / Applications / Sanitize / Download, behind an activation gate | `apps/desktop/src/App.tsx:125` |
| **Installer CI** — Windows engineering build + artifact upload | `.github/workflows/windows-engineering-build.yml` |

## B.2 Two customer surfaces, honestly compared

| | Admin console | Customer dashboard |
|---|---|---|
| Licence / plan / version | real | **real** (entitlement wired, PR-era work) |
| Registration plan picker | n/a | **real** (`PLAN_SLABS` radio group → `requestOtp({...form, plan})`) |
| Device connection, AI inspection, sessions | n/a | **still hardcoded simulation** |
| Installer download | n/a | honest empty state (`"No installer published yet"`) |

---

# PART C — WHY WE CANNOT START THE ACTUAL OBJECTIVE

**The objective:** connect an Android handset → **scan** → **generate a report** → **purge** the device.

Four blockers, in causal order. The first two are ours to fix; the third is a hardware gate by signed decision; the fourth is a governance freeze.

## BLOCKER 1 — The scan has never been run on real hardware

The frozen rule in `docs/SESSION_HANDOFF_2026-09-29.md` §5 is explicit: **"fake ADB only, ZERO real-device calls."** Every ADB-path test in the suite runs against a fake ADB binary.

- `WorkstationSessionOrchestrator.executeDiagnostic()` is unit-tested and now protocol-reachable via `RUN_SCAN`.
- It has **never executed against a handset.**
- `docs/SESSION_HANDOFF_2026-09-29.md` §7 item 4 still lists as outstanding: *"Hardware: connect Samsung A10s; run D2.3 pool tests (D23-WPD-004..010 …); D-1 flip B → A"*.
- `docs/SESSION_HANDOFF` also records that the new desktop UI was *"verified by build/typecheck/E2E only, **never visually inspected**"*.

**Consequence:** maturity for scan is **PROTOCOL-EXPOSED**, not HARDWARE-VALIDATED. There is no evidence a scan has ever completed end-to-end on a real phone.

## BLOCKER 2 — WPD evidence never reaches the report

`scan_wpd_device_metadata` (Rust, hardware-validated, produces a SHA-256 inventory digest) has **zero callers** in `apps/desktop/src`. `WINDOWS_WPD_MTP` appears in no Kotlin file.

So the one piece of device evidence that *is* hardware-proven is an orphan: the WPD scan result never enters `HostReportEngine`.

Canonical guideline §12 states the report path is incomplete because *"WPD evidence is not yet included … local report semantics and cloud `/reports/freeze` semantics are not yet reconciled … sanitization verification confidence is not yet strong enough for a final certificate."*

## BLOCKER 3 — Purge is disarmed **by signed decision**, and that is correct

`apps/host/.../sanitization/HostSanitizationProvider.kt:95`:

```
executionStatus = "BLOCKED_NOT_IMPLEMENTED",
error = "Sanitization execution is blocked: no validated sanitization
         provider exists for this device target (engineering build;
         see eligibility gate)."
```

- **There is no destructive ADB command anywhere in the codebase.** `wipe_data` / `MASTER_CLEAR` / `recovery` appear only in a *denylist* (`HostSecurityAuditEngine.kt:43`) and an OEM description string.
- Signed decision `docs/cyvra-desktop-full-package-plan.txt:20-23`: **"D-1 PURGE GATE = HARDWARE-GATED … Ships as OUTCOME B, flips to OUTCOME A on hardware validation."**
- Canonical guideline §13: *"The current sanitization code is not production-ready … **No release may represent this as universally functioning.**"* §13.3: post-reset verification *"is insufficient"* (infers OOBE from absence of a screen lock).
- Gate **G14 — Sanitization method qualification** has not started.

**Everything around the purge is built and tested**: eligibility gate, two-step operator barrier with typed phrase, target-serial lock, method selection (`PLATFORM_FACTORY_RESET` / `DEVICE_OWNER_WIPE` / `PURGE_OEM_SECURE_ERASE`), post-reset verification, fail-closed Final Report, and a full 7-command E2E transcript test. Only the destructive provider itself is absent — deliberately.

> **This is not a bug to fix. It is a safety interlock that opens only after a qualified method is physically validated on a device.**

## BLOCKER 4 — No installer, so there is no host engine in the field

- `/build-manifest.json` → `"state": "unavailable"`; the dashboard honestly shows `Build unavailable`.
- `.github/workflows/windows-engineering-build.yml` is still `permissions: contents: read` and `branches: [phase2-correct, feature/p2-protocol-completion]` — **it does not trigger on `main`.**
- `docs/P6_INSTALLER_VALIDATION.md:5-7`: *"the **P6/P7 exit gates are open**, not met"* — clean-VM validation never executed.
- Artifact policy: **UNSIGNED ENGINEERING ARTIFACT**, no code-signing infrastructure.

Until the installer ships, the host engine does not exist outside this repo, and the desktop workflow cannot run on a customer machine.

## BLOCKER 5 — Governance freeze (housekeeping, not engineering)

`docs/CYVRA_MOBILE_PROJECT_INDEX.md`:

```
P1.5 Documentation Consolidation            IN PROGRESS
  P1.5A.1 Project Index consolidation        CURRENT FILE
  P1.5A.2 Root README rewrite                NEXT
  ...
P1.6 Final Consolidation Acceptance          BLOCKED
Product-code work remains frozen during the documentation consolidation
except for the already-understood D2.3 local engineering delta.
```

**This freeze is the reason the next action cannot be "start coding". It must be lifted or explicitly waived first.**

---

# PART D — WHY THE CUSTOMER DASHBOARD "IS STILL THE OLD ONE"

**It is half-new. The half you are looking at is not stale — it was never wired, and it has no server to wire to.**

## D.1 What is already fixed (prior audit `CUSTOMER_DASHBOARD_FORENSIC_AUDIT_2026-10-05.md` §6, items A and B)

The 2026-10-05 audit's two top recommendations **have landed and are live**:

| Prior item | Now |
|---|---|
| **A. Plan picker at registration** | ✅ `WorkspaceApp.tsx:48` `useState<PlanSlab>(PLAN_SLABS[0])`; `<fieldset className="plan-picker">` at `:311`; `api.requestOtp({ ...form, plan })` at `:110`. No server change was needed, exactly as the audit predicted. |
| **B. Wire dashboard to `GET /v1/me/entitlement`** | ✅ `api.ts:249` `entitlement()`, `WorkspaceApp.tsx:76` fetches it *outside* the `Promise.all` so a reports failure cannot blank the licence panel, passed into the shell at `:216`. |
| Mock `license` `useState` (`LIC-MOB-2026-00124`, `scansTotal: 25`) | ✅ **deleted** — only a comment remains at `CustomerDesktopShell.tsx:711`. |
| RC-5 fake installer `alert()` | ✅ **gone** — replaced by the honest `"No installer published yet"` empty state. |

Your screenshot confirms it: `PLAN · 1 Device Scans` and `USAGE · Available after first scan` are the real entitlement, and `VERSION · Build unavailable` is the real absence of a build manifest.

**So the licence header is no longer old.** The 2026-10-05 audit's §1 verdict — *"The server-side plan plumbing is already finished and waiting"* — was acted on.

## D.2 What is still simulated, and why it cannot be wired yet

`apps/web/src/site/CustomerDesktopShell.tsx` still hardcodes the **device** half:

```ts
44:  const [isUsbPlugged] = useState(true);
45:  const [isAdbAuthorized] = useState(true);
48:  const [simulatedDevice] = useState({ model: "Moto G54 5G (Live Device)", ... });
632: const fakeSha = Array.from({ length: 64 }, () => ... Math.random() ...);
665: function runSimulatedLiveDiagnostic() { ... }
```

Rendered at `:908`, `:1030`, `:1037`, `:1041`, `:1045`, `:1049`, `:1053`, `:1075`, `:2072`, `:2076` — the Device Connection Status panel, the AI Physical Inspection Station, and the connected-device detail views.

**Three facts make this unwireable today — each verified just now:**

1. **No desktop → cloud upload path exists.** `git grep -rn "v1/evidence|freezeReport|uploadEvidence" -- apps/desktop/src` returns **nothing**. The desktop app, which is the only thing that can *know* a phone is plugged in, never sends a byte to the server.
2. **No device-state endpoint exists for the web.** `apps/web/src/api.ts` has no device/connection method at all (the only `devicesBound` hit is a projection field on the licence).
3. **The cloud cannot ingest device evidence anyway.** `services/api/src/evidence.ts:183`:
   ```ts
   if (record.source !== "S1_APPLICATION") {
     return c.json({ error: "This endpoint accepts S1_APPLICATION evidence only." }, ...);
   ```
   That is the Android APK's batch evidence type — not ADB evidence, not WPD evidence.

**Therefore:** the dashboard's device panels are not stale code waiting for a redeploy. They are a UI with no data source, and the data source does not exist yet. Redeploying would change nothing.

## D.3 The honest read of "0 recorded session(s)"

`ACTIVE SESSIONS & READY TO FREEZE · 0 recorded session(s)` is the **one fully honest panel** in that half — because `WorkspaceApp` does fetch `reportSessions()`/`listReports()` from the real API, and no session has ever been recorded. It is telling the truth about a system that has not yet run.

## D.4 The root failure mode (from the prior audit, still the governing lesson)

> *"Every prior workstream was gated on **server** correctness … and all of those gates passed. Nothing ever gated on **"does the customer see real data?"**."*

WS-H1 and WS-H2 added exactly such a gate for the **admin** (KPI counts tested against server pagination). The **customer** device surface still has no gate, because it has no endpoint to test against. Until it has one, it will keep drifting silently.

---

# PART E — PENDING INVENTORY

## E.1 Blocked on hardware (one session, one Samsung A10s, one ADB-capable handset)

| # | Item | Gate |
|---|---|---|
| E1 | First real-device `RUN_SCAN` end-to-end | lifts "fake ADB only" |
| E2 | D2.3 WPD pool tests `D23-WPD-004..010` | G6 follow-through |
| E3 | **D-1 flip: OUTCOME B → OUTCOME A** | purge interlock |
| E4 | G14 sanitization method qualification | no release may claim purge works until this |
| E5 | Post-reset verification redesign (kill "no lock == OOBE") | P0 #8, canonical §13.3 |

## E.2 Blocked on engineering (no hardware needed)

| # | Item | Notes |
|---|---|---|
| E6 | Fuse WPD evidence into `HostReportEngine` | orphaned Rust scanner → report |
| E7 | Reconcile local `HostReportEngine` vs cloud `/reports/freeze` | canonical §12 |
| E8 | Extend `/v1/evidence` beyond `S1_APPLICATION`, **or** define a separate device-session endpoint | prerequisite for any live dashboard device panel |
| E9 | Desktop → cloud upload of sessions | prerequisite for E8's consumer |
| E10 | Installer release job: `contents: write`, trigger on `main`, `Get-FileHash` → `SHA256SUMS.txt`, re-download and re-verify | also unblocks `Build unavailable` |
| E11 | P6 clean-VM validation + P7 CI gate | exit gates **open** |
| E12 | Wire or retire the simulated device panels (and the `fakeSha` diagnostic) | cannot start until E8/E9 exist |
| E13 | One customer-surface E2E assertion: signed-in customer loads `/dashboard`, shown plan == `mobile_serials.device_max` for that email | the gate that would have caught the 2026-09-15 drift on 2026-09-17 |

## E.3 Blocked on a decision

| # | Decision required |
|---|---|
| E14 | **Retro / upgrade path** — does a customer pick a slab only once at registration, or can they upgrade later? `POST /v1/licence-request` has never existed. |
| E15 | **Lift or waive the P1.5 documentation freeze** before any product code moves (E6–E13 are product code). |
| E16 | **Disposition of the parked main checkout** — commit as archive, or discard. |
| E17 | **Disposition of the WS-H2 recorded deviations** (§65 label drift, §56 naming, mixed CSV headers, docs citation drift, two-runtime duplication). |

---

# PART F — THE NEXT ACTION (proposed, awaiting your ruling)

The objective cannot be started by writing code. In dependency order, the shortest path to *"scan a phone, get a report, purge it"* is:

1. **Rule on E15** — lift/waive the P1.5 freeze. Everything below is product code.
2. **Rule on E16/E17** — close the loose ends from Part A so the tree is unambiguous.
3. **E10 → E11** — ship an installer. Without it there is no host engine in the field and no version badge on the dashboard. This is pure CI work, needs no hardware, and unblocks two other items.
4. **E1 → E3** — one hardware session with a real handset. This is the single action that turns PROTOCOL-EXPOSED into HARDWARE-VALIDATED and opens the purge interlock. *It cannot be deferred forever, and it cannot be simulated.*
5. **E8 → E9 → E12** — only after a real session exists is there anything for the customer dashboard's device panels to display. Wiring them before that would mean inventing an endpoint for data nobody produces.

**The critical-path insight:** steps 1–3 are unblocked *today* with no hardware. Step 4 is the true gate on the product objective. Step 5 is downstream of 4 and cannot honestly precede it.

---

## Appendix — current coordinates

```
main checkout   ...\CYVRA-Mobile                              PARKED, dirty, branch audit-and-planning-2026-09-26 @ c1a43c7
worktree        ...\CYVRA-Mobile\.worktrees\cyvra-mobile-implementation
branch          main                                          (clean, == origin/main)
HEAD            2797615  Merge PR #47 (WS-H2)
parent          2c6af90  WS-H2 commit
predecessor     09b3072  WS-H1 merge
gates           typecheck 0 · test 0 (753 = 71/261/26/395) · wrangler dry-run 0 (4.130.0, 751.47 KiB / gzip 154.07 KiB)
live admin      https://admin.cyvoriq.co.in     REGISTERED EMAIL + Export XLSX observed
live www        https://cyvoriq.co.in/dashboard  entitlement live; device panels simulated
live API        https://api.cyvoriq.co.in        /v1/me/entitlement healthy
migration       0009_payment_method.sql         NOT applied to Neon (by ruling)
```
