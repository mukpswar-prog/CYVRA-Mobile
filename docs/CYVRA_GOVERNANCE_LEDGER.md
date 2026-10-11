# CYVRA GOVERNANCE LEDGER

**Status:** living record · **Opened:** 11-Oct-2026 · **Authority:** Chief Engineer ruling, 11-Oct-2026

This ledger exists to hold rulings that would otherwise live only in conversation
transcripts. It is append-forward: entries are added and superseded, never
rewritten. Historical forensic records (for example
`docs/FORENSIC_AUDIT_2026-10-10.md`) are **not** amended to reflect anything here.

---

## 1. Standing holds

These are permanent prohibitions, not tasks. They do not expire when a work
package completes.

| ID | Hold | Status |
|----|------|--------|
| **H1** | No destructive device operation. `wipeData` is never executed; ADB stays read-only except for an explicitly commissioned sequence. | **IN FORCE** |
| **H2** | The M1 customer journey (`purchase → licence → download`, across `apps/web` and `services/api`) is frozen. The Integration Sprint owns none of it. | **IN FORCE** |
| **H3** | No code may claim a capability it does not have. Text, status values and schema markers must stay honest even when the governed contract promises the capability later. | **IN FORCE** |
| **H4** | No private key is generated or used, and no APK is signed, until Ed25519 custody is ruled. | **IN FORCE** |
| **H5** | No third-party driver binary is committed to this public repository while R-B is open with legal. | **IN FORCE** |
| **H6** | Sanitization execution stays gated on a live entitlement granting `sanitizeExecute`. A cached entitlement must never be coerced into granting it. | **IN FORCE** |
| **H7** | No release gate is weakened. No `continue-on-error`, no relaxed grep, no skip flag added to make a build pass. | **IN FORCE** |

---

## 2. Rulings

### R-B — USB driver redistribution · **OPEN, commercial**

- **Ruling:** **Option B.** Driver packages are supplied to CI as a **private
  secret** at release-build time.
- **Prohibited:** committing Samsung or Google driver binaries to this public
  repository while the redistribution/licence question is unresolved.
- **Scope:** gates **only** the final release `.exe` build. It gates nothing else.
- **Recorded in:** `scripts/stage-windows-installer-resources.ps1` (drivers
  comment), commit `3d62589`.
- **State:** open with legal.

### R-I — APK signing key custody · **DEFERRED**

- **Ruling:** no keystore is generated, no key is used, no APK is signed.
- **State:** deferred pending a custody ruling. Nothing may be built that
  assumes it.
- **Enforced by:** the unsigned-APK guard in the staging script, which verifies
  three independent signals (name, v1 `META-INF` entries, v2/v2v3 APK Signing
  Block) and throws `AGENT_APK_SIGNED_UNEXPECTED` on any match.

### R-2 / R-3 — forbidden certification strings · **PRECONDITION**

- **Ruling:** the `CYVRA-CERT-` generator is renamed and the NIST verification
  string is deleted **before** WP-5 and before any final report wording.
- **State:** precondition, not yet executed. Currently clean under grep, so this
  is about preventing reintroduction in the new purge/report path.

---

## 3. Held code — must not change until the stated step

| Location | Held content | Released at |
|----------|--------------|-------------|
| `apps/host/.../engine/ReportGenerator.kt` **L52–53** | §7 chain docstring; must continue to state that normalisation, customer authorisation and sealing are **not** claimed by this class | **Step 5 — report finalisation** |
| `apps/host/.../engine/ReportGenerator.kt` **L63** | `schemaVersion: String = "0011-DRAFT"` | **Step 5 — report finalisation** |

**Verified 11-Oct-2026:** the file did not exist at the Design Freeze
(`73d3f3a`, 0 lines). It was authored in `f09b3f5` (TASK S, 09-Oct, 264 lines).
Line 63 has read `0011-DRAFT` since creation and the diff history shows a single
addition with **no subsequent modification**. The hold is intact.

---

## 4. Gated work

### WP-5 — sanitization execution · **GATED**

Blocked on a live server-side entitlement granting `sanitizeExecute=true`. The
cached entitlement refusal observed at `HostProtocolDispatcher.kt:832` is the
correct behaviour and must not be bypassed.

---

## 5. Approved sequence

### P-A — Integration Sprint · **APPROVED, IN PROGRESS**

| Step | Content | State |
|------|---------|-------|
| WP-1 | Self-contained installer: USB drivers, offline WebView2, `perMachine` | **DONE** `2866db0` |
| WP-2 | Keystore ignore rules, unsigned agent bundling | **DONE** `3d62589` |
| WP-3 | PowerShell force-clean → Rust, **43 assertions from the standalone assertion harness (`Assert-Equal`/`Assert-True`/`Assert-False`)** as parity oracles | **NEXT** |
| Report finalisation | Normalise → operator authorisation → seal → final report | pending |
| WP-4 | Real-hardware UI proof | pending |
| Final `.exe` | Desktop build for installation and verification | pending |

### Phase order · **P-C BEFORE P-B**

Evidence limitations are rectified **before** stage PDF reports are built, so
that no PDF is generated over evidence that is about to widen.

---

## 6. AI / certified grading boundary · **RATIFIED**

> AI output is **assisted evidence only**. It never produces an automatic PASS.
> Certified grading comes only after physical verification, legal/T&C,
> hardware calibration, and operator confirmation.

Corollaries, all in force:

- Human or fixture observations are **never** converted into automated software
  evidence.
- Cell-level verification is never claimed from a logical reset.
- Report availability derives from verified operation results — not from a
  button click, and not from a UI label reading "Completed".

---

## 7. Open housekeeping

| ID | Item | Priority |
|----|------|----------|
| **A-15** | In `scripts/stage-windows-installer-resources.ps1` the host-JAR validation is not gated by `-SkipHost`, so that switch cannot be combined with a fresh `-ResourcesDir`. | **Low.** Housekeeping. Do not fix inside WP-3 unless it blocks parity work. |

---

## 8. Commit index

| Commit | Content |
|--------|---------|
| `2866db0` | WP-1 — self-contained Windows installer (drivers, offline WebView2, `perMachine`) — merged PR #59 |
| `3d62589` | WP-2 — keystore ignore rules and unsigned agent bundling — merged PR #60 |
| `ec1d441` | Governance ledger opened — merged PR #61 |
| `bbfc08a` | `verify-standing-holds.ps1`, makes H1–H7 machine-checked — merged PR #61 |
| `12c817a` | Integration-sprint resume document — merged PR #61 |

---

## 9. WP-3 rationale — recorded as ruled, both reasons labelled

**PRIMARY — this is the acceptance criterion for "done":**

> Force-clean becomes a **native product capability that the `.exe` invokes
> directly**, removing any PowerShell dependency on the customer's machine.

**SECONDARY BENEFIT — recorded, but not the acceptance criterion:**

> Reduced Defender/EDR friction.

**Correction on record.** An earlier plain-English summary justified WP-3 on the
ground that *"PowerShell scripts inside a commercial installer trigger security
warnings."* That rationale was wrong on the facts: `scripts/pur-do-wipe/` is a
source-tree development artifact and is **never staged into the installer**. The
staging script produces exactly `host/`, `runtime/`, `platform-tools/`,
`drivers/` and `agent/`. The distinction is load-bearing, not cosmetic — if the
reason were security warnings, the goal could appear met simply by not shipping
the script, when the actual requirement is a native invocation path.

---

## 10. Precedence classification — recorded as ruled

The ledger is registered in `CYVRA_MOBILE_PROJECT_INDEX.md` §2.4 as its own class,
**Governance Records** — `ACTIVE-GOVERNING`, but **not** Precedence Level 1.

> The ledger records rulings; it does not override Level 1 contracts. Any ruling
> that amends a contract takes effect only through that contract's own
> ratification path.

This supersedes the earlier instruction to register it at Level 1 (Chief Engineer,
11-Oct-2026). Level 1 remains held exclusively by the three Supreme Contracts:
§2.1 Design Freeze, §2.2 Customer Workspace Specification, §2.3 Core Engine
Journey FINAL v2.

---

*Amendments append below this line with a date and the ruling that authorised
them. Do not edit the entries above in place.*
