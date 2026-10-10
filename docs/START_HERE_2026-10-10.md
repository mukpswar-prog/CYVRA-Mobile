# START HERE — 10-Oct-2026

**Status:** RESUME POINT · supersedes `START_HERE_2026-10-07.md`.
**Read with:** `docs/FORENSIC_AUDIT_2026-10-10.md` (the evidence behind every claim here).

---

## 60-second orientation

You are mid-way through **TASK T — the PUR-DO-WIPE proof** on sacrificial device **D-P5**
(Samsung SM-A107F, Android 11).

Everything needed to run the proof is built, tested and **already enrolled on the device**:

- `Accounts: 0` ✅
- Device owner = **our APK** (`com.cyvra.sanitization/.SanitizationAdmin`) ✅
- Agent installed, `0.0.1-poc` ✅
- All §6 gates green, re-verified today ✅

**The only thing left is to press the button** — `wipeData(0)` — and capture the evidence.

> The wipe has **not** been executed. Matrix row 22 correctly reads `NOT TESTED`.
> No purge is claimed anywhere in this repository.

---

## THE NEXT ACTION

```
adb shell am broadcast -a com.cyvra.sanitization.WIPE
```

That is phase **2b**. It is already **authorized in principle**, but the last attempt
**halted at pre-flight** — correctly — because Android Studio was still running.

### Pre-flight checklist (must all pass, else ABORT)

1. **`studio64.exe` count = 0.** Standing rule: during phase 2b *only* CLI
   `platform-tools` adb may touch the device. Studio's `AdbService` holds a live
   `track-devices` connection and pushes `process-tracker`; any churn it causes would
   produce a **false disconnect timestamp**, destroying the evidence the proof rests on.
   *Note: `Close` on a Studio error dialog does NOT close the IDE — exit the window itself.*
2. **Device online, state `device`**, via CLI adb. If not → ABORT and report. Never assume.
3. Snapshot pre-wipe state (owner, accounts, agent) read-only.

### Then, in order

| Phase | Action |
|---|---|
| **2b** | Fire the broadcast. Record the **disconnect timestamp** and a timestamped poll trace. No reconnect, no re-authorize, no pushes during the wipe window. |
| **2c** | **HALT.** Report per §9: disconnect timestamp, poll trace, attestation with `wipe.executed = true`, and the exact on-device manual steps. Wait for `Ready`. |
| **2d** | On the phone: Settings → About → tap Build 7× → Developer options → enable **USB debugging**. Then read-only post-purge evidence → `apps/android/core/src/test/fixtures/purge_proof_samsung_a107f/` (**content stays local**, hash manifest only) → `docs/PUR_DO_WIPE_PROOF_SAMSUNG_A107F.md` → matrix row 22 → gates → §9 report → STOP. |

---

## DO NOT

- ❌ **Do not press ▶ Run in Android Studio** while the run config is `sanitization-agent` —
  it rebuilds and reinstalls onto D-P5, shifting `lastUpdateTime` and muddying provenance.
- ❌ **Do not cite `scripts/pur-do-wipe/attestation-latest.json`** — it has an internally
  impossible timeline and disagrees with its own README (**defect A-1**). Re-run to regenerate.
- ❌ **Do not claim a purge** from device-owner enrolment. Enrolment ≠ wipe.
- ❌ **Do not commit real-device fixture content.** Standing rule: real-device fixture content
  never egresses. Hash manifest only; serials redacted from everything that leaves the machine.
- ❌ **Do not merge / deploy / write to Neon** without your named approval.
- ❌ **Do not touch** `docs/design-freeze/` `@ 73d3f3a` — it is LAW.
- ❌ **Do not** run `Reset Settings&Plugins` in Studio, or delete legacy Studio system dirs.

---

## Quick reference

| Thing | Value |
|---|---|
| Worktree | `.worktrees/cyvra-mobile-implementation` |
| Branch | `feature/pur-do-wipe-proof` @ `842dcf4` (= `origin/main`), 0 dirty |
| adb | `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe` |
| adb keys | `$env:ADB_VENDOR_KEYS = 'C:\Android\.android\adbkey'` (see note N-4) |
| Wipe action | `com.cyvra.sanitization.WIPE` |
| Device admin | `com.cyvra.sanitization/.SanitizationAdmin` |
| Android build | `apps\android\gradlew.bat :sanitization-agent:build` |
| pnpm | `%APPDATA%\npm\pnpm.cmd` — run tests **serially** (host has 2 logical CPUs) |
| Worker dry-run | run `pnpm exec wrangler deploy --dry-run` **from `services/api`**, not `apps/web` |

---

## Recommended after TASK T

**TASK V — QR/DPC provisioning bootstrap.** The app cannot remove accounts (UID == authenticator,
signature-level `MANAGE_ACCOUNTS`, and FRP depends on it) — that is settled and closed.

But it doesn't need to. After a wipe the device is at the setup wizard with `Accounts: 0` **by
construction**, and QR provisioning sets device owner during setup before any account exists.
First bootstrap = one human step. **Every cycle after that = autonomous.**

---

## Housekeeping worth a ruling (not blocking)

| ID | Item |
|---|---|
| A-3 | `:sanitization-agent:test` is missing from the Android root `test` task — CI silently skips the wipe-action tests |
| A-6 | `apps/desktop` vitest is resource-starved on 2 CPUs; `isolate: false` would fix (config change, needs approval) |
| A-2 | Matrix coverage summary arithmetic is wrong (23 categories across 22 rows) |
| A-7 | `NIST_SP_800_88_REV2_…` still live in `HostSanitizationProvider.kt:154` — not a §6 breach, but a latent hazard |
| — | WS-K approvals **A5–A16** still PENDING; 38 branches need cleanup |
