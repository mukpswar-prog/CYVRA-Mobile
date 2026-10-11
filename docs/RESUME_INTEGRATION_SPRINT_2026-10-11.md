# RESUME — CYVRA Integration Sprint

**Date:** 11-Oct-2026 · **Status:** mid-sprint, clean stop point · **Next:** WP-3

This is the re-entry point. Read this file first, then
`docs/CYVRA_GOVERNANCE_LEDGER.md` for the rules, then continue.

---

## 1. Where we are, in one paragraph

The desktop `.exe` integration sprint is **on plan**. WP-1 (self-contained
installer: USB drivers, offline WebView2, `perMachine`) and WP-2 (keystore
ignore rules, unsigned agent bundling) are **both merged to `main`** and
accepted. Two A-class defects found during the sprint, A-10 (dishonest
inventory status) and A-12 (adb pipe deadlock), are fixed, regression-tested and
merged. The governance ledger is open, and the standing holds are now
machine-verified by a repeatable script rather than remembered. All nine
prohibitions were confirmed today against evidence. Nothing destructive has ever
been executed: the bench phone is unharmed, the agent is installed, device
ownership is intact, and `wipeData` has never run.

---

## 2. Repository state

**`main` = `b0c0a2a`** — contains everything below.

| Commit | Content | State |
|---|---|---|
| `842dcf4` | PR #58 — force-clean (TASK U) | merged |
| `e175945` | A-10 — inventory status derives from payload | merged |
| `45687d7` | A-12 — drain child pipes before `waitFor()` | merged |
| `bdbb32c` | V3 amendment, forensic audit, activity review | merged |
| `2866db0` | **WP-1** — self-contained installer | merged (PR #59) |
| `3d62589` | **WP-2** — keystore rules, unsigned agent | merged (PR #60) |

**Branch `feat/wp2-agent-bundle-unsigned`** — 2 commits **not yet merged**:

| Commit | Content |
|---|---|
| `ec1d441` | `docs/CYVRA_GOVERNANCE_LEDGER.md` |
| `bbfc08a` | `scripts/verify-standing-holds.ps1` |

Working tree **CLEAN**, **0 unpushed commits**. Awaiting a PR whenever you want it.

---

## 3. Standing holds

**H1** no destructive device operation · **H2** customer journey frozen ·
**H3** no code claims a capability it does not have · **H4** no key generation or
APK signing · **H5** no driver binaries in the public repo · **H6** sanitization
gated on live entitlement · **H7** no release gate weakened.

Full text, plus rulings R-B / R-I / R-2/R-3, the held code lines, the P-A
sequence and the ratified AI boundary:
**`docs/CYVRA_GOVERNANCE_LEDGER.md`**

Verify at any time:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-standing-holds.ps1
```

Last run: **ALL HOLDS INTACT — 0 breaches.**

---

## 4. NEXT TASK — WP-3

**Convert the PowerShell force-clean logic to native Rust product code, with the
existing assertions as parity oracles.**

### Source of truth

`scripts/pur-do-wipe/ForceCleanAccounts.psm1` — **309 lines, 9 functions:**

| # | Function | Concern |
|---|---|---|
| 1 | `Get-AccountCountFromContentDump` | parse count; **-1 on failure, never 0** |
| 2 | `Test-DeviceOwnerPrecondition` | owner must be enrolled |
| 3 | `Test-RemoveAccountPrimitiveAvailable` | ladder rung availability |
| 4 | `Get-AuthenticatorMap` | authenticator resolution |
| 5 | `Get-IdentifierToken` | stable redaction token |
| 6 | `Get-RedactedAccountView` | identifier-free view |
| 7 | `Get-RemovalLadder` | AUTHENTICATOR → PRIMITIVE |
| 8 | `Get-RemovalOrder` | deterministic ordering |
| 9 | `New-AttestationRecord` | identifier-free by construction |

### Parity oracle

`scripts/pur-do-wipe/ForceCleanAccounts.Tests.ps1` — **43 assertions.**

```
Baseline run 11-Oct-2026:   TOTAL  pass=43  fail=0   (exit 0)
```

> **Correction to earlier notes:** these are **not Pester tests**. They are a
> standalone harness using `Assert-Equal` / `Assert-True` / `Assert-False`.
> The count 43 is correct; the framework name was not.

### Port target

`apps/desktop/src-tauri/` — crate `cyvra-mobile-desktop` (lib `app_lib`).
Existing modules: `commands.rs`, `host_process.rs`, `ledger.rs`, `lib.rs`,
`main.rs`. **65 `#[test]`/`#[cfg(test)]` sites already exist**, so the crate has
an established test convention to follow.

**Proposed:** new module `apps/desktop/src-tauri/src/force_clean.rs` with a
`#[cfg(test)]` block carrying all 43 cases as Rust tests.

### The two load-bearing behaviours

These are the reasons the port is not a mechanical translation:

1. **A failed parse must yield `-1`, never `0`.** A silent `0` reports a clean
   device that is not clean. This is the exact false-positive Samsung's dump
   format causes, and it is the single most dangerous bug this module could have.
2. **Nothing reaching the attestation may carry an account identifier.** No
   email, no local part, no domain, no IMEI-shaped literal, no serial. Only the
   local-part *length* survives.

### Constraints (unchanged, restated)

No signing key · no APK signing · **no device wipe** · no customer-journey
change · no `ReportGenerator` early claim · no release gate weakened.
Purge execution remains gated on live entitlement.

---

## 5. Open questions awaiting your ruling

1. **Register the ledger in `CYVRA_MOBILE_PROJECT_INDEX.md`?** That file is a
   Precedence Level 1 governed document, and it was not maintained for the 10-Oct
   documents either. I did not restructure it unasked.
2. **Merge the two documentation commits** (`ec1d441`, `bbfc08a`) as PR #61 now,
   or hold them until WP-3 lands and merge together?
3. **S1 agent wiring** — you approved bringing device-side application labels
   into "the next evidence/agent work package". Should that be folded into WP-3,
   or kept as a separate WP-3b?
4. **R-2/R-3 string cleanup** — precondition before WP-5. Do it as its own small
   package now, or immediately before WP-5?
5. **A-15** (`-SkipHost` validation quirk) — recorded as low-priority
   housekeeping. Fix opportunistically, or leave?

---

## 6. Plan ahead

| Phase | Content | Gate |
|---|---|---|
| **WP-3** | PowerShell → Rust force-clean, 43 parity assertions | next |
| Report finalisation | normalise → operator authorisation → seal → final report; releases `ReportGenerator` L52–53 and L63 | after WP-3 |
| WP-4 | real-hardware UI proof — human clicks Scan, evidence returns, report generated | needs WP-3 |
| Final `.exe` | desktop build for you to install and verify feature-by-feature | needs WP-4 + R-B drivers as CI secret |
| WP-5 | sanitization execution | **gated**: live entitlement + R-2/R-3 + key custody |
| P-C | limitation rectification (all Android users/work profiles; positive source wording) | approved, before P-B |
| P-B | stage PDF reports (LOCKED/PROCESSING/READY/FAILED) | after P-C |
| P-D | physical verification module, operator-attested | after UI hardware validation |
| P-E | 1–50 concurrent devices — **session-model redesign**, not tuning | after final `.exe` |
| P-F | AI / certified grading | after hardware, legal/T&C, P-D |

---

*Standing rule on return: address the Chief Engineer as **Chief Engineer**.
Understand → verify → explain how to → approve → execute → push and commit.
Report per §9 with paths, gate table, hashes and notes, then STOP.*
