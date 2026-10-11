# RESUME — CYVRA Integration Sprint

**Date:** 11-Oct-2026 · **Status:** mid-sprint, clean stop point · **Next:** report finalisation

This is the re-entry point. Read this file first, then
`docs/CYVRA_GOVERNANCE_LEDGER.md` for the rules, then continue.

---

## 1. Where we are, in one paragraph

The desktop `.exe` integration sprint is **on plan**. WP-1 (self-contained
installer: USB drivers, offline WebView2, `perMachine`), WP-2 (keystore ignore
rules, unsigned agent bundling) and **WP-3 (force-clean decision core as native
Rust)** are all **merged to `main`** and accepted. WP-3 landed at `fba759d` with
all 43 parity assertions holding. Two A-class defects found during the sprint,
A-10 (dishonest inventory status) and A-12 (adb pipe deadlock), are fixed,
regression-tested and merged. The governance ledger is open, the standing holds
are machine-verified by a repeatable script rather than remembered, and all nine
prohibitions were confirmed against evidence. Nothing destructive has ever been
executed: the bench phone is unharmed, the agent is installed, device ownership
is intact, and `wipeData` has never run.

---

## 2. Repository state

**`main` = `fba759d`** = `origin/main`, working tree **CLEAN**, **0 untracked**.

| Commit | Content | State |
|---|---|---|
| `842dcf4` | PR #58 — force-clean (TASK U) | merged |
| `e175945` | A-10 — inventory status derives from payload | merged |
| `45687d7` | A-12 — drain child pipes before `waitFor()` | merged |
| `bdbb32c` | V3 amendment, forensic audit, activity review | merged |
| `2866db0` | **WP-1** — self-contained installer | merged (PR #59) |
| `3d62589` | **WP-2** — keystore rules, unsigned agent | merged (PR #60) |
| `ec1d441` | Governance ledger | merged (PR #61) |
| `bbfc08a` | `verify-standing-holds.ps1` | merged (PR #61) |
| `12c817a` | Previous resume document | merged (PR #61) |
| `af9bd02` | Ledger registered as Governance Record; WP-3 rationale | merged |
| `fba759d` | **WP-3** — force-clean decision core in Rust | merged |

**Your main folder** `C:\Users\User\Documents\GitHub\CYVRA-Mobile` was switched
from the stale `audit-and-planning-2026-09-26` branch to `main` earlier today.
That branch still exists with its commit intact.

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

## 4. WP-3 — DONE, merged at `fba759d`

Force-clean is now a native capability the `.exe` invokes directly, with no
PowerShell dependency on the operator's machine.

### What landed

| Path | Content |
|---|---|
| `apps/desktop/src-tauri/src/force_clean.rs` | decision core, 1,034 lines, all 9 functions |
| `apps/desktop/src-tauri/src/commands.rs` | `force_clean_assess`, `force_clean_redact`, `force_clean_redact_view`, `force_clean_attestation` |
| `apps/desktop/src-tauri/src/lib.rs` | commands registered |
| `apps/desktop/src-tauri/Cargo.toml` | `regex = "1"` |

The four commands are **pure text in, text out**. None opens a device, starts a
process, writes a file, or removes an account. The destructive driver remains
operator-driven and separately gated.

### Gates at merge

`cargo test --lib` 236 passed / 0 failed · `cargo test --lib force_clean`
49 passed / 0 failed · `cargo check` 0 warnings, 0 dead code ·
`pnpm -r typecheck` exit 0 · `pnpm -r test` desktop 71, web 305, api, evidence
all pass · `wrangler deploy --dry-run` exit 0 at 759.74 KiB · UTF-8 clean,
no BOM · standing holds 0 breaches.

### Parity

The oracle `scripts/pur-do-wipe/ForceCleanAccounts.Tests.ps1` is reproduced
verbatim as `P-01`…`P-43`, labelled so the count is verifiable by search rather
than trusted. **The oracle itself was never modified** — it remains the
reference.

### Two load-bearing behaviours, preserved

1. An unreadable count yields **`-1`, never `0`**.
2. Nothing reaching the attestation carries an account identifier — only the
   local-part *length* survives.

### Three defects caught in my own work

- A **real Gmail address** was carried into the new fixture from the reference
  test. Replaced with a synthetic local part of identical length. (The first
  grep reported clean only because `git grep` returns zero for untracked files —
  a check that cannot see the file under test will always report success.)
- `is_platform_package` **sliced a `str` by byte offset**, panicking when a
  multi-byte character straddles it. Now uses `str::get`, with a test that
  reproduces the exact panic.
- `serde_json::to_value` **reorders keys** through a `BTreeMap`, so the claimed
  field order held only for direct serialisation. The guard now asserts on the
  serialised string, which is what actually ships.

---

## 5. The five questions — ALL ANSWERED, applied and merged

| # | Question | Ruling | Applied |
|---|---|---|---|
| 1 | Register the ledger in the Project Index? | **Yes, but below Level 1** — its own class "Governance Records" | `af9bd02`, index §2.4 |
| 2 | Merge PR #61 now or with WP-3? | **Void** — already merged during the break | moot |
| 3 | S1 agent wiring in WP-3 or separate? | **Separate — WP-3b** | not started |
| 4 | R-2/R-3 string cleanup now or before WP-5? | **Just before WP-5** | not started |
| 5 | A-15 staging quirk — fix or leave? | **Leave**, fix opportunistically | recorded |

Ledger precedence sentence, as ruled:

> The ledger records rulings; it does not override Level 1 contracts. Any ruling
> that amends a contract takes effect only through that contract's own
> ratification path.

### Two deferred fixes to the oracle itself — DONE (R-1a, R-1b)

Both were deliberately **not** corrected during the port, because editing the
reference under a parity claim would undermine the claim. Both are now applied
after WP-3 acceptance, with parity re-run and still **43 pass / 0 fail**.

1. **A real Gmail address** has been removed from
   `ForceCleanAccounts.Tests.ps1`, replaced by
   `fixtureacct13@example.invalid` — the same synthetic fixture the Rust side
   already used, so both halves now redact identical input. The local part is
   still 13 characters, so the pins `local-part-len=13` and
   `[com.google local-part-len=13]` were unchanged.
2. **Line 217 asserted the wrong variable** — it re-checked `$token` instead of
   `$opaque`. Corrected to `$opaque`, which is what the Rust port asserts, so
   the two now assert the same variable rather than the port passing a weaker
   original.

Neither identifier is gone from **git history**; both corrections are
forward-only. A denylist check for them now runs in
`scripts/verify-standing-holds.ps1`.

---

## 6. Plan ahead

| Phase | Content | Gate |
|---|---|---|
| ~~**WP-3**~~ | ~~PowerShell → Rust force-clean, 43 parity assertions~~ | **DONE** `fba759d` |
| ~~**Report finalisation**~~ | ~~normalise → operator authorisation → seal → final report; releases `ReportGenerator` L52–53 and L63~~ | **DONE** this commit |
| WP-3b | S1 agent wiring — device-side application labels | approved, separate |
| WP-4 | real-hardware UI proof — human clicks Scan, evidence returns, report generated | needs WP-3 ✓ |
| Final `.exe` | desktop build for you to install and verify feature-by-feature | needs WP-4 + R-B drivers as CI secret |
| WP-5 | sanitization execution | **gated**: live entitlement + R-2/R-3 + key custody |
| P-C | limitation rectification (all Android users/work profiles; positive source wording) | approved, before P-B |
| P-B | stage PDF reports (LOCKED/PROCESSING/READY/FAILED) | after P-C |
| P-D | physical verification module, operator-attested | after UI hardware validation |
| P-E | 1–50 concurrent devices — **session-model redesign**, not tuning | after final `.exe` |
| P-F | AI / certified grading | after hardware, legal/T&C, P-D |

### Still blocked, unchanged

- **WP-5** — gated on live entitlement granting `sanitizeExecute`; A-13 licence
  gate at `HostProtocolDispatcher.kt:832` fires before D-1, and that refusal is
  correct behaviour.
- **WP-2 signing / agent release-signing** — blocked on Ed25519 custody (R-I);
  no keystore may be generated.
- **R-B** — driver redistribution open with legal; gates only the final release
  `.exe` build.

### Known environment note — CLOSED by TASK R-2, 11 Oct 2026

`pnpm -r test` failed **recursively** on this 6.9 GB machine at ~2 GB free —
vitest could not start its threads workers. Zero TypeScript was touched by WP-3,
and every suite passed when run package-by-package with `--maxWorkers=1`.

**Closed.** Virtual memory was increased on 11 Oct 2026 and the Chief Engineer
re-ran the full recursive gate, which passed: **815 tests, 0 fail, EXIT=0**
(desktop 71, web 305, evidence 26, api 413; 5 of 6 workspace projects).

Environmental throughout — vitest could not *start*, which is not a test asserting
wrongly. No code was changed to achieve it and no release gate was weakened (H7).
Recorded in ledger §11.7, now **CLOSED**.

Note: this "R-2" is *host config verification*. It is a different item from the
**R-2/R-3 string-cleanup ruling**, which still stands and is still due before WP-5.

---

*Standing rule on return: address the Chief Engineer as **Chief Engineer**.
Understand → verify → explain how to → approve → execute → push and commit.
Report per §9 with paths, gate table, hashes and notes, then STOP.*
