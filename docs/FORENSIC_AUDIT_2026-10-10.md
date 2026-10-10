# CYVRA Mobile — Forensic Audit

**Status:** AUDIT — evidence-based, no claims from memory.
**Captured:** 10-Oct-2026
**Branch of record:** `feature/pur-do-wipe-proof` @ `842dcf4` (= `origin/main`), 0 dirty.
**Method:** live gate re-run + git forensics + full source/doc inventory. Every "achieved" claim below was re-verified against the tree or the device today.

> **Privacy rule applied throughout:** no device serial, account name, Gmail address or
> identifier appears in this document. Device referred to only as **D-P5 / SM-A107F**.

---

## 0. Executive summary

**What we actually have:** a real, working, evidence-backed capability chain from *diagnostic
capture* up to *device-owner enrolment on a live Samsung*. The last verified action today is
that **our own APK holds device owner on D-P5 with `Accounts: 0`** — the hard precondition of
the governed wipe proof. The single remaining act in that chain is `wipeData(0)` itself.

**What we do not have:** the wipe has **not** been executed. Matrix row 22 therefore remains
`NOT TESTED` — correctly. There is no purge-proof document, no purge-proof fixture, and no
purge claim anywhere in the repository. That silence is deliberate and is the project's
strongest integrity property: *nothing is claimed that has not been run.*

**Net position:** ~95% of the PUR-DO-WIPE capability is built and proven. The last 5% is one
authorized command plus its evidence capture.

---

## 1. Verified achievements

### 1.1 Repository state

| Metric | Value |
|---|---|
| `origin/main` | `842dcf4` — *Merge pull request #58* (09-Oct-2026) |
| PRs merged to main | **58** (first `c36186d` 08-Sep-2026 → `842dcf4` 09-Oct-2026) |
| Tracked files | **599** |
| — `docs/` | 91 |
| — `apps/android/` | 87 |
| — `apps/web/` | 92 |
| — `services/api/` | 56 |
| — `scripts/` | 33 |
| Branches | 38 (27 local, 11 remote) — see §5.7 |

### 1.2 The recent capability chain (all merged 09-Oct-2026)

| PR | Branch | Deliverable |
|---|---|---|
| #53 | `feature/core-engine-research` | Capability research baseline |
| #54 | `feature/core-engine-matrix-v1` | **TASK Q** — `CYVRA_CAPABILITY_MATRIX_V1.md` + fixture capture + hash manifest |
| #55 | `feature/core-eng-1-design` | **TASK R** — capability-matrix-as-data design |
| #56 | `feature/core-eng-2-kotlin` | **TASK S** — Kotlin matrix runtime/loader |
| #57 | `feature/sanitization-agent-poc` | **TASK T-PREP** — the wipe-proof APK |
| #58 | `feature/pur-do-wipe-force-clean` | **TASK U** — force-clean account ladder |

### 1.3 TASK U — force-clean ladder (`scripts/pur-do-wipe/`)

5 files. Pure core `.psm1` (309 lines) + driver `.ps1` (368) + tests `.Tests.ps1` (257) + README (124).

- **43 unit tests**, no device required, no Pester dependency.
- 3-rung ladder: `PRIMITIVE` → `AUTHENTICATOR` → `HUMAN`.
- Exit codes `0 / 3 / 4 / 5 / 6`.
- **Field-proven findings baked in:** `cmd account remove-account` is absent on Android 11
  (exit 255, probed not assumed); Samsung hides the count from `dumpsys account`, so the tool
  reads `dumpsys content` → `Accounts: <n>`; unreadable count returns **-1 and aborts**, never
  coerced to 0; `pm uninstall --user 0 <pkg>` removes that authenticator's accounts but
  `AccountManager` is async, so the tool settles before re-reading.
- Privacy: `Get-IdentifierToken` reduces an address to `[type local-part-len=N]`, and the
  driver refuses to write the attestation at all (exit 6) if it matches an email regex.

### 1.4 TASK T-PREP — the wipe-proof APK (`apps/android/sanitization-agent/`)

- `applicationId com.cyvra.sanitization`, minSdk 26 / targetSdk 36, **zero runtime dependencies**.
- **No release signingConfig** — release assembles *unsigned*; debug is V2-signed.
- **Declares zero `<uses-permission>`** entries.
- `device_admin.xml` declares exactly one policy: `<wipe-data />`.
- `SanitizationAdmin.triggerWipe()` → `DevicePolicyManager.wipeData(0)` — flags `0` deliberately
  (no `WIPE_EXTERNAL_STORAGE`, no `WIPE_RESET_PROTECTION_DATA`).
- `MainActivity` is **three TextViews and no buttons** — a mis-tap cannot start a purge.
- **5/5 unit tests**, confirmed passed via committed JUnit XML (`tests="5" failures="0"`).
- Wipe action string pinned by test and manifest, in two places:
  `com.cyvra.sanitization.WIPE`

### 1.5 Live device capability (D-P5, SM-A107F, Android 11) — verified today

| Property | Value | Verified by |
|---|---|---|
| Accounts | **0** | `dumpsys content` header, read directly |
| Device owner | **ENROLLED** → `com.cyvra.sanitization/.SanitizationAdmin` | `dumpsys device_policy` |
| `isOrganizationOwnedDevice` | **true** | same |
| Agent version | `0.0.1-poc`, `versionCode 1` | `dumpsys package` |
| Agent last installed | 2026-10-09 21:56:20 | `lastUpdateTime` |
| **wipeData** | **NOT EXECUTED** | — |

The `dpm set-device-owner` call that produced this succeeded with `exit=0` — the first time on
this engagement that a real Samsung accepted device-owner enrolment from our APK.

### 1.6 §6 standing gates — re-run today, 10-Oct-2026

| Gate | Command | Result |
|---|---|---|
| Typecheck | `pnpm -r typecheck` | **EXIT 0** ✅ |
| Tests | `pnpm -r --workspace-concurrency=1 test` | EXIT 1 — **environmental only, 0 test failures** (see §3.1) |
| Worker dry-run | `pnpm exec wrangler deploy --dry-run` (from `services/api`) | **EXIT 0** ✅ — 759.74 KiB / gzip 156.12 KiB |
| `NIST_SP_800_88` | grep over `apps/web` + `services/api` | **0 hits** ✅ |
| `SUCCESS_VERIFIED` | idem | **0 hits** ✅ |
| `CYVRA-CERT` | idem | **0 hits** ✅ |
| `"100% clean"` | idem | **0 hits** ✅ |
| `"device is perfect"` | idem | **0 hits** ✅ |
| `toLocaleString(` (zone drift) | idem | **0 hits** ✅ |
| Fabricated IMEI/serial/MAC literals | regex `[0-9]{15}` and `(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}` | **0 hits** ✅ |
| Responsive proofs 320/768/1024/1440/3840 | — | not re-run in this audit |
| UTF-8 clean | — | not re-run in this audit |

**Conclusion: no fabricated assurance, and no identifier fabrication, exists in
customer-facing code.** The WS-K1-01 hotfix (PR, `17c06a2`) that removed the fake
`CYVRA-CERT-2026-90412` certificate has held.

---

## 2. Capability matrix — honest current state

`docs/CYVRA_CAPABILITY_MATRIX_V1.md`, `Status: **v1 SEED — DRAFT, not ratified**`.

| Result | Rows |
|---|---|
| `PASS` (incl. qualified) | 10 |
| `NOT TESTED` | 8 |
| `PHYSICAL VERIFICATION REQUIRED` | 1 (Mechanical) |
| `NOT AVAILABLE` | 1 (Performance) |
| `RESTRICTED` | 1 (Cellular) |
| `CONDITIONAL` | 1 (Security) |

**Row 22 — Sanitization / `PUR-005` / PUR-DO-WIPE: `CONDITIONAL` + `NOT TESTED`.**
Doc comment verbatim: *"No wipe/purge probe permitted this task; no purge claim made (§29)."*

⚠️ **The matrix's own coverage summary is arithmetically wrong** — see defect **A-2**.

---

## 3. Defects found by THIS audit

These are new. They were not in any prior report.

### A-1 — `attestation-latest.json` has an impossible timeline — **HIGH**

`scripts/pur-do-wipe/attestation-latest.json` records:
- `baselineAccounts: 9`, `finalAccounts: 6`, `clean: false`, `accountsRemoved: 3`
- `startedAt: 2026-10-09T21:24:56.097…`, `completedAt: 2026-10-09T21:24:57.009…` → **~0.9 s run**
- but the `attempts` array contains entries timestamped `21:22:29` … `21:24:55` — **all before `startedAt`**

No single run of the driver can emit attempts earlier than its own start; each invocation
begins a fresh attempts list. The file is internally inconsistent and must be treated as
hand-merged or regenerated.

It also **disagrees with its own README**, which narrates the D-P5 run as `9 → 3`.

**Consequence:** this committed attestation **cannot be cited as evidence**. It must be
re-generated by a real run before any reference to it.

### A-2 — Matrix coverage summary does not add up — MEDIUM

`CYVRA_CAPABILITY_MATRIX_V1.md` §4 claims: *"evidence-backed 10 · `NOT TESTED` 9 ·
`PHYSICAL VERIFICATION REQUIRED` 1 · `NOT AVAILABLE` 1 · `RESTRICTED` 2"*.

Actual per-row count:
- `NOT TESTED` is **8**, not 9.
- `RESTRICTED` is **1** primary (Cellular); the doc's "2" folds in sub-results of rows already
  counted as `PASS` (Wi-Fi/Sensors State-2 reductions) → double-counted.
- The single **`CONDITIONAL`** row (row 3, Security) is **omitted from the summary entirely**.
- Categories sum to **23 across 22 rows**.

### A-3 — `:sanitization-agent:test` is not in the Android root aggregate — MEDIUM

`apps/android/build.gradle.kts`:
```kotlin
tasks.register("test") { dependsOn(":core:test", ":host:test") }
```
`:sanitization-agent` is absent. **Any CI running `gradlew test` at the Android root silently
skips the 5 wipe-receiver tests** — the tests that pin the wipe action string. A regression
there would ship unnoticed.

### A-4 — `apps/android/README.md` does not mention the module it now contains — LOW

It documents modules `:core`, `:host`, `:app` only. `:sanitization-agent` is missing despite
being included in `settings.gradle.kts`.

### A-5 — `scripts/android-probe/README.md` is stale — LOW

§5 still reads *"fixture capture BLOCKED on this machine (08-Oct-2026)"*, but the matrix records
**4 fixture sets captured 09-Oct** (3 physical + 1 emulator, exit codes 0/0/0/6).

### A-6 — Test gate is fragile on this host — MEDIUM (process)

`pnpm -r test` fails **only** because vitest spawns isolate workers that each take ~15–21 s to
start on **2 logical CPUs**. Evidence: the recursive run reported
`Test Files 3 passed (3) · Tests 25 passed (25) · Errors 2 errors`, where both errors were
`[vitest-pool] Timeout waiting for worker to respond` — not assertions.

Re-running `apps/desktop` in isolation today: **5 files, 71 tests, all passed, EXIT 0** (160 s).

Vitest's own hint is the fix: *"at least ~85.59s faster with `isolate: false`"*. **No test is
failing; the harness is resource-starved.** Recommend `isolate: false` for `apps/desktop`
vitest config — *requires your approval as a config change.*

### A-7 — The §6 grep target still exists in host code — INFORMATIONAL

`NIST_SP_800_88_REV2_CLEAR_PLATFORM_VERIFIED` is still live at
`apps/host/src/main/kotlin/cyvra/mobile/host/sanitization/HostSanitizationProvider.kt:154`,
alongside the honest `BLOCKED_NOT_IMPLEMENTED` state at ~:95.

This is **not a §6 violation** — §6 scopes greps to *customer-facing* code (`apps/web`,
`services/api`), where it is absent. But it is a latent hazard: host code carries an
assurance string that the product's own `SANITIZATION_ARCHITECTURE.md` §31 declares unsafe.

### A-8 — No purge-proof artifacts exist — EXPECTED, but must be closed

- `docs/PUR_DO_WIPE_PROOF_*.md` — **does not exist**.
- `apps/android/core/src/test/fixtures/purge_proof_samsung_a107f/` — **does not exist**.

Both are TASK T phase 2d deliverables. Correct that they're absent today; they are the
reason row 22 is still `NOT TESTED`.

### A-9 — The §6 grep scope does not cover the product, and the product carries the defect class — **HIGH**

Raised by the Chief Engineer. The §6 standing greps are scoped to `apps/web` +
`services/api` only. **The desktop `.exe` product — `apps/desktop` (Tauri/Rust, 43 `.rs`
files), `apps/host` (Kotlin host engine), `apps/android` — is entirely outside that scope.**

Re-running the identical greps across the product surfaces:

| String | Inside §6 scope | Outside §6 scope (the product) |
|---|---|---|
| `NIST_SP_800_88` | 0 ✅ | **7** |
| `CYVRA-CERT` | 0 ✅ | **13** |
| `SUCCESS_VERIFIED` | 0 ✅ | 0 |
| `100% clean` / `device is perfect` | 0 ✅ | 0 |

Two of those sit in `main` source and therefore compile into the shipped installer.
`windows-engineering-build.yml` builds the real product chain
(`pnpm build` → `pnpm stage:resources` → `gradlew :core:test` → `gradlew :host:test` →
`cargo test` → `cargo build` → `tauri build` → `--selftest SELFTEST_OK`) — **none of which is
part of §6.**

**Reachability verdict** — established by full call-chain trace on 10-Oct-2026, read-only,
no build run:

#### ① `apps/host/.../HostSanitizationProvider.kt:154` — `NIST_SP_800_88_REV2_CLEAR_PLATFORM_VERIFIED`
**NOT REACHABLE in production today — but armed.**

```
HostProtocolDispatcher.kt:876  completeSanitizationLifecycle(...)   ← production entry
  → WorkstationSessionOrchestrator.kt:408  verifyPostReset(...)
      postRebootEvidence = <parameter, DEFAULT null at :319>        ← caller omits it
  → HostSanitizationProvider.kt:116  if (postRebootEvidence == null)
        return ... assuranceLevel = "REQUIRES_EXTERNAL_VERIFICATION"   ← early exit
  → :154 never reached
```

The production caller **omits** `postRebootEvidence`, so the declared default `= null`
applies and `verifyPostReset` returns at `:116`. No `main` source anywhere in the repo
constructs non-null post-reset evidence — only tests do.

Three latent hazards remain regardless:
- The string is **unconditional** on that branch: it stamps `…_VERIFIED` even when the
  computed status is `PARTIALLY_VERIFIED`.
- Its sole input is `screenLockPresent` — precisely the "weak post-reset evidence" that
  `SANITIZATION_ARCHITECTURE.md` §31 condemns, and the file itself concedes
  *"Flash wear-leveling prevents direct physical NAND cell verification"*.
- **TASK T phase 2d is exactly the task that wires up post-reset evidence.** The moment it
  lands, this string activates automatically unless removed first.

#### ② `apps/host/.../WorkstationSessionOrchestrator.kt:419` — `"CYVRA-CERT-…"` generator
**REACHABLE in production.**

```
HostProtocolDispatcher.kt:876 → completeSanitizationLifecycle()
  guards: eligibility/report/preRecord/session (:325) · target lock (:340)
          · operator 2-step barrier (:364) · executionResult non-null (:389)
  → :418 always runs → reportEngine.generateSanitizationCertificate(certificateId = "CYVRA-CERT-…")
  → HostReportEngine.kt:122 reportTitle = "CYVRA Data Sanitization & Verification Certificate"
  → GET_FINAL_REPORT (HostProtocolDispatcher.kt:957) serialises it and
    PERSISTS it to disk under `<cyvra.home>/certificates/<certificateId>/`
```

Execution reaching this point is `BLOCKED_NOT_IMPLEMENTED` (`isSuccess = false`) — yet a
document titled **"CYVRA Data Sanitization & Verification Certificate"** under a
`CYVRA-CERT-<year>-<6 hex>` ID is still generated and written to disk. **This is the same
defect class the WS-K1-01 hotfix (`17c06a2`) removed from the web app.**

**Mitigations already present and working** — real, and worth crediting:
- `sanitizationSuccessClaimed = lifecycleOutcome == EXECUTED_VERIFIED` — **fail-closed**
  (`HostReportEngine.kt:146`)
- `blockReason` derived and carried; `executionStatus = "BLOCKED_NOT_IMPLEMENTED"`, `isSuccess = false`
- The `SANITIZE_EXECUTE` response returns `successClaimed = false` and
  `decision = "D-1 OUTCOME B: destructive trigger remains hardware-gated"` (`:919`)

So the **contents are honest; the naming is not.** The product will not tell a customer the
device was sanitized — but it will hand them a file called a certificate.

Also: the literal fabricated ID **`CYVRA-CERT-2026-90412`** from the WS-K1-01 hotfix survives
in `apps/android/core/src/test/kotlin/…/ReportModelsTest.kt:192,213`.

**Recommended ruling:** widen the §6 grep scope to all product surfaces · remove or rename the
`CYVRA-CERT-` generator · delete the NIST string **before** phase 2d wires up evidence.

---

### A-10 — The UI claims an application list was read when none was — **HIGH** · *PHASE 1 blocker*

Discovered empirically during WP-0 (physical run, 2026-10-10), not by inspection.

| | |
|---|---|
| What the UI says | `apps/desktop/src/App.tsx:888` status row: **"Application list read for this phone."** |
| What the payload says | `UNAVAILABLE` · **0** applications · `Process timed out after 10000ms` |

The status row is an **optimistic default** set independently of the payload. Enumeration
failed; the row reports success anyway.

This is precisely the defect class §6 exists to catch — a claim stronger than its evidence.
The sting is that **the product's own report is more honest than its UI**: in the same run the
report correctly carried no `successClaimed`, no `executionStatus`, no assurance level, and
`sanitizationSuccessClaimed` was absent.

**Action:** replace the optimistic default at `App.tsx:888` with status text derived from the
payload (state the actual limitation, and the actual application count — including zero).

**Ruling R-P: fix this before any other PHASE 1 work.** The hold released by R-T does not
clear until A-10 is fixed, because shipping a UI that overclaims violates the core mandate.

---

### A-11 — Help copy asserts the hardware gate D-1 while the live decision was `SANITIZE_LOCKED_OFFLINE` — **MEDIUM**

The help text tells the operator the purge is blocked by the **D-1 hardware gate**. The live
dispatch in the WP-0 run returned `SANITIZE_LOCKED_OFFLINE` (`HostProtocolDispatcher.kt:832`)
— an **entitlement/licence** gate, not a hardware one.

Two different reasons to refuse, and the UI narrates the one that did not fire. A technician
would then troubleshoot hardware that is not at fault.

**Action:** render the help copy from the actual `decision` / `blockReason` in the response
rather than a fixed string.

---

### A-12 — ADB application enumeration times out at 10,000 ms — **MEDIUM**

| | |
|---|---|
| Timeout source | `apps/host/.../transport/ProcessRunner.kt:39` — `Process timed out after ${timeoutMs}ms` |
| Failing consumer | `apps/host/.../evidence/AdbApplicationInventoryProvider.kt:70` — maps to `UNAVAILABLE` |

Root cause is **not yet established**. Three candidates: One UI device slowness, a degraded
ADB connection, or a command blocking on something.

**Ruling R-R: investigate before raising the timeout.** Measure with
`adb shell time pm list packages`.
- Consistently >10 s → the timeout is wrong; raise it.
- Sporadic → the connection is wrong; fix ADB stability.

Do not blindly increase the timeout without understanding the root cause.

---

### A-13 — Cached entitlement ships `sanitizeExecute=false` — **HIGH**

The cached entitlement grants the read operations but carries **`sanitizeExecute=false`**. The
gate fires at `HostProtocolDispatcher.kt:832` **before** D-1 is ever evaluated — so WP-5 code
work alone cannot produce a purge; there is no code path to it without a live entitlement.

**Ruling R-Q (c): both, in that order.**
1. Pursue a live entitlement granting `sanitizeExecute=true` — a server-side/commercial
   dependency. Implementing WP-5 before this exists is wasted engineering.
2. Once available, execute WP-5.

In the interim the purge mechanism is validated independently via the command-line proof
(TASK T 2b), which does not pass through the product's entitlement gate.

---

## 4. Device position

| | |
|---|---|
| Device | **D-P5**, Samsung **SM-A107F**, Android 11 (API 30), bootloader locked, verified-boot green |
| Accounts | **0** — reached via TASK U rung 2 (9 → 3) then your manual removal of the last 3 + reboot |
| Device owner | **ENROLLED** to `com.cyvra.sanitization/.SanitizationAdmin`, `dpm` exit 0 |
| Agent | installed, `0.0.1-poc`, debug-signed |
| **Wipe** | **NOT EXECUTED** — userdata intact |
| Android Studio | **closed** (your precondition) — standing rule: CLI `platform-tools` adb only during phase 2b |

---

## 5. What needs achieving

### 5.1 Immediate — TASK T phases 2b → 2d

| Phase | Work | Status |
|---|---|---|
| **2b** | Fire `com.cyvra.sanitization.WIPE`; record disconnect timestamp as evidence; no reconnect/push during the window | **AUTHORIZED, halted at pre-flight** |
| **2c** | On-device setup-wizard handoff: Developer options → USB debugging → `Ready` | not started |
| **2d** | Read-only post-purge evidence → `purge_proof_samsung_a107f/` (content stays local, hash manifest only) → `docs/PUR_DO_WIPE_PROOF_SAMSUNG_A107F.md` → matrix row 22 → gates → §9 report | not started |

**Why it halted this morning:** pre-flight found `studio64.exe` count = **1** (PID 12212 — the
same instance from the double-launch incident; `Close` on the *error dialog* does not close the
IDE). The gate was correct and the device is unharmed.

### 5.2 Recommended next — TASK V (QR/DPC provisioning bootstrap)

Research verdict from this engagement: the app **cannot** remove accounts, and **no tuning
changes that**. Eleven reasons, three of them decisive:

1. `removeAccountExplicitly()` requires the caller's **UID == the authenticator's UID**
   (GMS owns `com.google`). Permanent.
2. `removeAccount()` requires `MANAGE_ACCOUNTS` — **signature-level**, not grantable.
3. **FRP depends on accounts being non-removable.** Google's own support text confirms it.

**But the problem dissolves by inversion:** after `wipeData` the device sits at the setup
wizard with `Accounts: 0` *by construction*, and QR/DPC provisioning
(`com.android.managedprovisioning`) sets device owner during setup **before any account
exists** — no adb, no account removal.

- First bootstrap: one human step.
- **Every cycle after the first wipe: fully autonomous.**

The wipe creates the exact precondition enrolment requires. That is the "great achievement"
you asked about, and it is genuinely reachable.

### 5.3 Governance — approvals still pending

`docs/WS-K_MASTER_PLAN.txt` §0 records **A5–A16 as PENDING**; only A1–A4 approved. There is no
record anywhere in the tree that A5–A16 were ever granted. The plan's Phases 1–9 are
consequently unexecuted.

### 5.4 Other carried open items

- **N-1** — 15 of 22 `ITEM ID`s are `[P]` provisional; the 114-parameter engineering matrix is
  not in this repo. Blocks the patch schema's `matrix_rows[]` vocabulary.
- **N-4** — host dual-key defect (`ANDROID_SDK_HOME=C:\Android`), worked around via
  `ADB_VENDOR_KEYS`. Host config only.
- **N-5** — Samsung `dumpsys wifi` returns ~1.6 MB (656 BSSIDs) vs 7.8 KB on emulator; ingest
  must bound this.
- **TASK O** — API 26/30/33 system images + AVDs still absent. (An API 36 emulator now exists
  in Studio, but does **not** satisfy that requirement.)
- `P2B-SERVER-GAPS.md` still `STATUS: APPLIED, NOT COMMITTED`, and still cites the old
  `paymentStatusesFor` name (now `paymentsFor`).
- Open items previously flagged for ruling: `CYVRA15092026SA3F1-1-25` literal in
  `services/api/src/entitlement.ts`; Ed25519 key custody (so `PatchVerifier` rejects all);
  per-domain size caps; TASK S offline-queue persistence.
- Housekeeping: `docs/design-freeze` `73d3f3a` is LAW; merged-branch cleanup (38 branches);
  `apps/desktop` vitest `isolate` config (A-6).

---

## 6. Integrity observations

Worth stating plainly, because they are the project's real asset:

1. **Nothing is claimed that has not been run.** Row 22 stayed `NOT TESTED` through TASK U, the
   APK build, and even successful device-owner enrolment. Enrolment is *not* a purge, and the
   matrix does not say it is.
2. **The tool refuses to lie.** TASK U returns `-1` and aborts rather than reporting 0 when the
   count is unreadable; it exits 6 rather than write an attestation that might contain an
   address; it never disabled GMS because that risked orphaning accounts into an unfixable state.
3. **The APK cannot be mis-tapped into a purge.** `MainActivity` has no buttons by design, and
   the only trigger is an explicit shell broadcast.
4. **The §6 greps are genuinely clean** in customer-facing code — re-verified today.

---

## 7. Immediate defects to close, ranked

| ID | Severity | Defect | Action |
|---|---|---|---|
| **A-9** | **CRITICAL** | §6 grep scope excludes the product; product carries a live `CYVRA-CERT-` generator and an armed NIST `…_VERIFIED` string | Widen grep scope · rename/remove the generator · delete the NIST string **before** phase 2d |
| **A-10** | **HIGH** | UI status row claims "Application list read for this phone." while payload = `UNAVAILABLE`, 0 apps, 10 s timeout | Replace the optimistic default at `App.tsx:888` with payload-derived text — **R-P: fix before any other PHASE 1 work** |
| **A-13** | **HIGH** | Cached entitlement ships `sanitizeExecute=false`; gate at `HostProtocolDispatcher.kt:832` fires *before* D-1 | Pursue live entitlement first, then WP-5 — **R-Q(c)**; validate mechanism meanwhile via command-line proof |
| **A-1** | HIGH | `attestation-latest.json` impossible timeline + disagrees with README | Re-run TASK U to regenerate, or delete the stale file |
| **A-11** | MEDIUM | Help copy asserts hardware gate D-1; live decision was `SANITIZE_LOCKED_OFFLINE` (licence) | Render help from the actual `decision`/`blockReason` in the response |
| **A-12** | MEDIUM | ADB enumeration times out at 10,000 ms | Root-cause first — `adb shell time pm list packages` — then decide the timeout — **R-R** |
| **A-3** | MEDIUM | `:sanitization-agent:test` missing from Android root `test` task | Add to `dependsOn` |
| **A-6** | MEDIUM | Test gate resource-starved on 2 CPUs | `isolate: false` for desktop vitest (needs approval) |
| **A-2** | MEDIUM | Matrix coverage summary arithmetic wrong | Correct §4 summary counts |
| **A-7** | INFO | NIST string still live in host sanitization provider | Rule on removal |
| **A-4** | LOW | `apps/android/README.md` omits the module | Document it |
| **A-5** | LOW | Probe README stale vs captured fixtures | Update status line |

**A-10 is the PHASE 1 precondition (R-T):** the hold stands until it is fixed.

---

*Audit performed read-only. No build artefacts committed, no migrations run, no Neon write,
no device action taken. Both gate failures investigated to root cause: neither was a code defect.*
