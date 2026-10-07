# START HERE — 2026-10-07

**Purpose:** a 60-second resume. Read this, run the verification block, pick one item from §3.
**Preceded by:** `TROPHY_JOURNEY_STEP_1.md` (closure record + full forensic audit — read it if you need the *why*).
**State at the end of 2026-10-06:** everything saved, nothing actioned beyond the closure record. Step 2 was ruled **audit only**.

---

## 1. Verify where we are (30 seconds)

Run from `.worktrees\cyvra-mobile-implementation`:

```
git status -sb
git log --oneline -3
```

Expect: branch `docs/trophy-journey-step-1`, clean, HEAD = the Step 1 record, and `main` still at `2797615`.

Cross-check the two things that must **not** have moved:

```
git log --oneline -1 main          -> 2797615  (Merge PR #47, WS-H2)
git ls-files database/migrations   -> 0009 files present; APPLIED to Neon 06-Oct-2026 (C1) - DO NOT RE-APPLY
```

If `main` is ahead of `2797615`, something ran after the break — stop and re-audit before acting.

---

## 2. Closed — do not reopen

| Workstream | Commit | Merge |
|---|---|---|
| WS-H1 — atomic issue + row action zone | `6b0733f` | `09b3072` |
| WS-H2 — §13/§65 columns, payment method + 0009, §58 IST, §12/§56 polish | `2c6af90` | `2797615` (PR #47) |

Gates at closure: **typecheck 0 · 753 tests 0 fail (71 desktop / 261 web / 26 evidence / 395 api) · wrangler dry-run 0**.
Deployment confirmed in production by observation: `REGISTERED EMAIL` + Export XLSX on the admin; real entitlement (`1 Device Scans`, `Build unavailable`) on the customer dashboard.

Also closed: registration plan picker, `GET /v1/me/entitlement` wiring, the fabricated-`25 Device Scans` mock, the fake-installer `alert()`.

---

## 3. Pending — pick one

### §3.1 Decisions only you can make — **these gate everything else**

| ID | Decision | Why it blocks |
|---|---|---|
| **E15** | Lift or waive the **P1.5 documentation freeze** (`CYVRA_MOBILE_PROJECT_INDEX.md:169`) | §3.3 and §3.4 are all *product code* and frozen behind it. **Do this first.** |
| **E17** | Disposition of the WS-H2 recorded deviations (§65 vs §13 label drift, §56 "Plan" vs "Licence Plan", mixed CSV headers, `P2B-SERVER-GAPS.md` citing the old `paymentStatusesFor`) | leaves the registry record ambiguous |
| **E14** | **Retro / upgrade path** — is a plan chosen once at registration, or upgradable later? `POST /v1/licence-request` has never existed | customer-facing, no API exists either way |
| **E16** | *(largely discharged 2026-10-06 — the parked checkout was committed for safekeeping; still needs a call: archive permanently, or discard)* | tree hygiene |
| ~~**M-0009**~~ | **DONE 06-Oct-2026 ~21:34 IST** — `0009_payment_method.sql` applied manually by the Chief Engineer; verified 07-Oct (`payment_method_enum` + 7 ordered labels + `payments.payment_method`). **Do not re-apply.** Open follow-up: N1 tracker desync. | closed |

### §3.2 Unblocked **today** — no hardware, no product-code freeze problem

These are CI/docs/hygiene. Start here if no decision has come back yet.

- [ ] **E10 — installer release job.** `.github/workflows/windows-engineering-build.yml` still has `permissions: contents: read` and `branches: [phase2-correct, feature/p2-protocol-completion]` — **it does not run on `main`.** Fix: `contents: write`, add `main`, `Get-FileHash` → `SHA256SUMS.txt`, re-download and re-verify. This is the direct cause of the dashboard's `Build unavailable` badge.
- [ ] **E11 — P6 clean-VM validation + P7 CI gate.** `docs/P6_INSTALLER_VALIDATION.md:5-7` — exit gates are **open, not met**. Requires a clean Windows 10/11 64-bit VM.
- [ ] Delete the merged remote branch `origin/feature/ws-h2-registry-polish`.
- [ ] Reconcile `docs/P2B-SERVER-GAPS.md` naming drift (if E17 lands).

### §3.3 Blocked on **one hardware session** — the true gate on the product objective

One Samsung A10s + one ADB-capable handset unlocks all five.

- [ ] **E1 — first real-device `RUN_SCAN` end-to-end.** Lifts the frozen *"fake ADB only, ZERO real-device calls"* rule. Today: PROTOCOL-EXPOSED, never HARDWARE-VALIDATED.
- [ ] **E2 — D2.3 WPD pool tests `D23-WPD-004..010`.**
- [ ] **E3 — flip decision D-1: OUTCOME B → OUTCOME A.** This is what arms the purge.
- [ ] **E4 — G14 sanitization method qualification.** Until this passes, *no release may represent purge as universally functioning* (canonical §13).
- [ ] **E5 — post-reset verification redesign.** Kill the "absence of a screen lock == OOBE" inference (P0 #8, canonical §13.3).

### §3.4 Blocked on engineering — no hardware, but frozen by E15

- [ ] **E6** — fuse `scan_wpd_device_metadata` into `HostReportEngine`. The Rust scanner is hardware-validated with **zero callers**; it is an orphan.
- [ ] **E7** — reconcile local `HostReportEngine` vs cloud `/reports/freeze` (canonical §12).
- [ ] **E8** — extend `services/api/src/evidence.ts:183` beyond `S1_APPLICATION` (currently *"This endpoint accepts S1_APPLICATION evidence only."*), or define a device-session endpoint.
- [ ] **E9** — desktop → cloud upload. `git grep -rn "v1/evidence|freezeReport|uploadEvidence" -- apps/desktop/src` returns **nothing** — the desktop app never sends a byte.
- [ ] **E12** — wire or retire the simulated device panels (`CustomerDesktopShell.tsx:44,45,48,632,665` — `isUsbPlugged`, `simulatedDevice`, `fakeSha`, `runSimulatedLiveDiagnostic`). **Cannot start before E8/E9** — there is no data source.
- [ ] **E13** — the missing E2E gate: a signed-in customer loads `/dashboard` and their shown plan must equal `mobile_serials.device_max` for that email. This is the gate that would have caught the 2026-09-15 drift on 2026-09-17.

---

## 4. Suggested order for tomorrow

1. **Rule on E15.** Everything in §3.4 is behind it. (~2 minutes)
2. **E10 — installer CI.** Pure workflow YAML, no hardware, no DB, and it removes a visible production error badge. (~half session)
3. **Rule on E17** so the registry record stops being ambiguous.
4. **Book the hardware session (§3.3).** It is the critical path to the actual product objective and cannot be simulated — start scheduling it even while E10 is in progress.
5. Only after a real session exists: **E8 → E9 → E12.** Wiring the dashboard's device panels earlier would mean inventing an endpoint for data nobody produces.

**Critical path:** the product objective (scan → report → purge) is gated by **E3**, which is gated by **E1**, which needs hardware. Everything else is parallel work.

---

## 5. Do NOT do these

- ❌ Do not run `drizzle-kit push` / `migrate` / touch Neon from this machine. **0009 was applied by the Chief Engineer on 06-Oct-2026 and must not be re-applied** (bare `CREATE TYPE` → hard failure). `drizzle-kit migrate` is additionally unsafe until N1 (tracker 2 behind) is reconciled in D4.
- ❌ Do not implement a destructive ADB provider to "unblock" purge. D-1 is a signed safety interlock (OUTCOME B), not a bug — `wipe_data` exists only in a *denylist*.
- ❌ Do not work in the parked main checkout (`..\..\CYVRA-Mobile`, branch `audit-and-planning-2026-09-26`). Per `SESSION_HANDOFF_2026-09-29.md` §2: **PARKED, do not work here.**
- ❌ Do not present the installer as a signed release — there is no code-signing infrastructure.
- ❌ Do not redeploy the customer dashboard expecting the device panels to come alive. The live bundle is already current; those panels have no data source (three verified facts in `TROPHY_JOURNEY_STEP_1.md` §D.2).

---

## 6. Where things live

```
main checkout   ...\CYVRA-Mobile                                    PARKED, saved, branch audit-and-planning-2026-09-26
worktree        ...\CYVRA-Mobile\.worktrees\cyvra-mobile-implementation
branch          docs/trophy-journey-step-1                          (this file's branch)
main            2797615 = origin/main                               clean
live admin      https://admin.cyvoriq.co.in                         REGISTERED EMAIL + Export XLSX
live www        https://cyvoriq.co.in/dashboard                     entitlement live, device panels simulated
live API        https://api.cyvoriq.co.in                           /v1/me/entitlement healthy
migration       0009_payment_method.sql                             APPLIED to Neon 06-Oct-2026 (C1); DO NOT RE-APPLY; tracker at 0007 (N1)
full audit      docs/TROPHY_JOURNEY_STEP_1.md
```
