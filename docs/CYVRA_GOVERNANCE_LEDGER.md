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
| **H8** | No feature, and no part of the product vision or mission, may be compromised, removed, downgraded or quietly scoped out in order to make the agent-less route look better. Where the agent-less route is **weaker** than the agent-based route, the report must say so in those words, with the measurement that shows it. An agent-less finding that reads as favourable must be reproducible from the recorded commands. | **IN FORCE** |

**H8 origin (Chief Engineer, 12-Oct-2026), verbatim intent:** the agent-less
investigation is approved on the condition that it does not flatter itself. The
rule exists so that a conclusion reached in favour of "no agent installed" is
earned, not arranged. It applies to the Question 1/2/3 research package and to
every later decision that cites it.

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
| Report finalisation | Normalise → operator authorisation → seal → final report, wired to `FINALISE_REPORT` and a desktop control | **DONE** |
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

## 11. WP-3 execution — decisions and findings

### 11.1 Rulings taken during execution (Chief Engineer, 11-Oct-2026)

| # | Question | Ruling |
|---|---|---|
| 1 | The reference attestation records `tool = "ForceCleanAccounts.ps1"`. A Rust port emitting that string would attest to a script that never ran — an A-10 violation. No oracle assertion covers this field. | **Honest provenance.** `tool` now reads `cyvra-mobile-desktop force_clean (rust)`. The schema ID `cyvra.pur-do-wipe.attestation/1` is unchanged, so existing consumers still key on it. |
| 2 | PowerShell *throws* when the account count overflows `[int]`. Rust must not panic inside a shipping Tauri command. | **Return `-1`.** Consistent with the module's own documented contract ("−1 when the header cannot be found, treated as failure, never as zero"). Divergence from the reference's throw is deliberate and recorded here. |

### 11.2 `regex` dependency — declared, and proven cost-free

`regex = "1"` was added to `Cargo.toml` so the port reuses the reference engine
rather than hand-rolling a re-implementation of patterns whose exact semantics
are the entire point of the parity suite.

This was verified before it was done, not assumed:

```
cargo tree -i regex --edges normal
  regex v1.13.1
  ├── tauri-utils v2.9.3 → tauri v2.11.5 → cyvra-mobile-desktop
  └── urlpattern v0.3.0 → tauri-utils v2.9.3
cargo tree -i regex --edges dev
  warning: nothing to print.
```

`regex` was already a **shipping** dependency of this binary, compiled and linked
today. Declaring it directly therefore added **zero** new `[[package]]` entries to
`Cargo.lock` and zero bytes to the installed product.

### 11.3 Three probe "divergences" that were defects in the probe, not the code

Before writing the port, PowerShell's behaviour was measured rather than
reasoned about. Three of my own expectations came back wrong, and in each case
the reference was correct:

| Expectation | Actual | Why the reference is right |
|---|---|---|
| `remove-accounts` (plural) should match | no match | `\b` requires a word boundary; `t`→`s` is not one. The probe recognises the subcommand, not a longer word beginning with it. |
| `{type= sp } , ComponentInfo{ pkgX /S}` should parse | no match | The pattern demands `},` with no space before the comma. Capture classes exclude `,`/`}` and `/`; `Trim` runs after capture. |
| A 12-digit count should yield a number | **throws** | PowerShell casts to `[int]`. See ruling 2 above — the port returns `-1`. |

Recording these matters: a report claiming "the PowerShell has bugs" would have
been wrong three times over.

### 11.4 Defect found in the parity oracle — **not** corrected during WP-3

`scripts/pur-do-wipe/ForceCleanAccounts.Tests.ps1` line 217:

```powershell
$opaque = Get-IdentifierToken -Identifier 'someone@example.org' -Type 'com.samsung.android.email'
Assert-True -Condition ($token -cnotmatch 'gmail') -Because 'redaction is case-safe and identifier-free'
```

The assertion re-checks `$token` — the value from line 210 — instead of
`$opaque`. It passes, but it tests the wrong variable and so does not prove what
it says it proves.

**Deliberately left unfixed.** Editing the oracle while porting it would mean the
reference changed underneath the parity claim. The Rust test asserts against
`$opaque`, which is plainly what was meant, so the port is *stricter* than the
original while still passing it. Correct the oracle in a separate change, after
WP-3 is accepted, with the count remaining 43.

### 11.5 The oracle itself was not touched

```
git status --porcelain -- scripts/pur-do-wipe/   →   0 files
```

`ForceCleanAccounts.psm1` and `ForceCleanAccounts.Tests.ps1` are byte-identical
to `HEAD`. They remain the reference; the Rust module is measured against them
and does not replace them.

### 11.6 A real account identifier was carried into the port — caught, not shipped

The reference fixture embedded a genuine Gmail address. Copying the redaction tests
across, that address was reproduced verbatim in `force_clean.rs`, which would
have put a second copy of a real account identifier into the tree — in breach of
the standing rule that no account name or Gmail address appears in any file.

It was caught by grepping the **working tree**, not by `git grep`, which silently
reports zero for untracked files and so returned a false clean on the very first
pass. The lesson is recorded because the method matters as much as the catch:
a check that cannot see the file under test will always report success.

The port now uses a synthetic local part of the same length. Nothing the
assertion proves depends on the address being genuine — only on its local-part
length — so parity is unaffected.

**Closed by TASK R-1a, after WP-3 acceptance.** The original address was
removed from `ForceCleanAccounts.Tests.ps1` and replaced by
`fixtureacct13@example.invalid` — the identical value the port already used, so
both halves now redact the same input rather than two compatible ones. The local
part remains 13 characters, so the `local-part-len=13` pins were untouched, and
the oracle re-ran at **43 pass / 0 fail**. Line 217 was corrected from `$token`
to `$opaque` in the same pass (R-1b), so the reference and the port now assert
the same variable rather than the port merely clearing a weaker original.

Both identifiers remain visible in **git history**; the correction is
forward-only, and no history rewrite was ordered. Detection now runs in
`scripts/verify-standing-holds.ps1`, which carries a denylist check for the
bench device serial and the retired account address. A second instance was
found by that wider sweep and is recorded as **F-3**, pending ruling.

### 11.7 Gate 2 (`pnpm -r test`) failed for an environmental reason

The recursive run failed with *"Failed to start threads worker"*. That is vitest
being unable to **start**, not a test asserting wrongly. Investigated before
reporting, per the standing rule:

- **0** TypeScript files were touched by WP-3 — the change is Rust and docs only.
- The machine had ~2 GB free of 6.9 GB, with Chrome, Defender and GitHub Desktop
  resident. `vitest.config.ts` runs `pool: 'threads'` with `environment: 'jsdom'`,
  whose own comment already records a prior Windows struggle with `forks`.

Each suite passes when run package-by-package with `--maxWorkers=1`:

| Package | Result |
|---|---|
| `apps/desktop` | 5 files, 71 passed, exit 0 |
| `apps/web` | 15 files, 305 passed, exit 0 |
| `services/api` | exit 0, assertions ran |
| `packages/evidence` | exit 0, assertions ran |

**This is pre-existing fragility, not a WP-3 regression.** It will recur on any
machine under memory pressure regardless of this change.

---

*Amendments append below this line with a date and the ruling that authorised
them. Do not edit the entries above in place.*

---

## Amendment — 11 Oct 2026 — Chief Engineer rulings on R-2, F-3 and the sanitization sweep

### §11.7 CLOSED — environmental, resolved by host configuration

Gate 2 re-run after the Chief Engineer increased virtual memory on 11 Oct 2026,
executed by the Chief Engineer on his own machine:

| Package | Files / suites | Tests | Result |
|---|---|---|---|
| `apps/desktop` | 5 files | 71 | pass |
| `apps/web` | 15 files | 305 | pass |
| `packages/evidence` | 8 suites | 26 | pass |
| `services/api` | 72 suites | 413 | pass |
| **Total** | | **815** | **0 fail — EXIT=0** |

Scope reported by pnpm: *5 of 6 workspace projects*.

The finding was environmental from the start: vitest could not **start** its threads
workers under memory pressure, which is not a test asserting wrongly. Confirmed two
ways — the same suites already passed package-by-package before, and the whole
recursive run now passes after the host change. **No code was altered to achieve
this and no release gate was weakened (H7).**

### F-3 CLOSED

`docs/token-inventory.txt:205` carried a real personal account address in a public
repo. Replaced with `<redacted email>`; the instruction still reads "pick the specific
account, not all accounts". The literal now occurs **0** times. Authorised by the
Chief Engineer: *"keep the content, remove the email ID."* Detection added to the
holds harness denylist so a reintroduction fails the check.

### Sanitization sweep — three rulings

1. **`services/api/test/staff.test.ts:12` — LEAVE AS IS.** H2 freezes `services/api`
   by path and the harness asserts by path. The address there is a synthetic
   placeholder, not a real mailbox, so keeping it costs nothing while editing it
   would cross a standing hold. Chief Engineer: *"leave it … You take a call."*
2. **Corporate addresses — RETAIN as product identity.** Analysis below.
3. **Archived baseline edit — ACCEPTED.** Chief Engineer: *"editing the archived
   baseline was acceptable."*

### Corporate address impact analysis — 317 occurrences, 69 files

Sanitizing was assessed against the running product and **rejected**, because it
breaks real behaviour:

- `services/api/src/admin/principal.ts:74` exports `SUPER_ADMIN_EMAIL` — the identity
  the entire admin authorisation gate is built on.
- `database/migrations/0007_w5_admin_control_plane.sql:306` **promotes that exact
  address to `SUPER_ADMIN`**, and line 521 is a migration assertion that **raises an
  exception** if it is not. The migration has already been applied to the live
  database; an applied migration is not edited.
- `services/api/src/email.ts:174` uses `noreply@cyvoriq.co.in` as the sending From
  address, a domain verified in Resend. A substituted address would fail SPF/DKIM and
  outbound mail would stop.
- `services/api/src/bridge.ts:127` names the audit actor for registration events.
- `services/api/src/admin.ts:950` and `principal.ts:362,371` appear inside
  customer-facing refusal sentences.

**Retaining has no negative impact: sanitizing does.** These are the product's own
corporate identity, deliberately published in its own user interface — not device
fixture content, and not a consumer mailbox. Retained on that basis.

### Sweep results recorded

- **Phone numbers: 0.** A loose pattern first reported 812 hits, all dates, version
  strings and checksums. Tightened to `+` international prefix (0) and bare 10-digit
  mobile (24, every one a `Cargo.lock` checksum). No phone number exists in the tree.
- **Real personal identifiers: 0** — account address, local part and device serial all
  absent. The only remaining consumer-domain string is the frozen-path placeholder
  ruled on above.


---

## Amendment — 11 Oct 2026 — Step 5 report finalisation EXECUTED

Authorised by the Chief Engineer ("Go ahead and approved"). Delivers the ratified V3
§7 tail — RAW REPORT → NORMALIZE → OPERATOR AUTHORISATION → SEAL → FINAL CONTROLLED
REPORT — with every step executed inside the .exe (M5), no web surface required.

### §3 held lines — RELEASED

Both lines held in §3 were released at Step 5 and are now changed. The holds harness
was **not modified**:

- **L52–53** — the §7 docstring was rewritten from the superseded V2 wording (which
  routed the four steps to "CUSTOMER WORKSPACE (schema 0011, later)") to the ratified V3
  chain. It **continues to decline** the claim, exactly as §3 requires: those steps are
  **not** claimed by this class. That phrase is kept verbatim on one line because the
  harness matches it literally.
- **L63** — keeps the value `0011-DRAFT`. See the ruling below.

### Ruling — schema 0011 stays a DRAFT reservation

The Chief Engineer delegated this decision to a reading of our own documents.

Two governed documents both defer it:

- `CYVRA_CAPABILITY_PATCH_SCHEMA.md` §9.4 — "Report schema integration — `schema 0011`
  is a later phase; the fields above are reserved now."
- Journey V3 §10 Open Items — "schema 0011 (later)".

V3 also records that routing these steps to "CUSTOMER WORKSPACE (schema 0011, later)"
was **Withdrawn**. So no document defines what `0011` looks like.

**Therefore no schema shape was invented.** The reservation is kept, and finality is
carried by the operator authorisation and the seal rather than by a version number. The
final controlled report echoes the identifier and states in its own provenance that the
schema is an open item. `ReportFinaliserTest.theFinalReportMirrorsTheReservedSchemaTheRawReportCarries`
pins the raw and final identifiers together so they cannot drift.

### What was built

- `apps/host/.../engine/ReportFinaliser.kt` — the four steps.
  - **Normalise** is deterministic and idempotent: only ordering and whitespace move, so
    the same report always encodes to the same bytes and therefore the same digest.
  - **Authorise** records operator, timestamp and attestation hash as governed §6.2
    requires. A blank operator is refused rather than sealed.
  - **Seal** covers the canonical normalised report and separately records the digest of
    the authorisation, binding artifact to approver.
  - **Safety property:** `finalise` refuses to seal when the sealed digest is not the
    digest the operator attested to. An operator can never be shown one artifact and
    have a different one sealed.
- `FINALISE_REPORT` host command (protocol v1, 15 → 16 commands) and a desktop control on
  the report step. The raw report is built from the capability matrix on disk and is
  never read off the wire, so a caller cannot hand the Host a report of its own to seal.
- **Entitlement: nothing is spent.** `record_scan_ledger` falls through to `Ok(())` for
  this command — finalising is neither a scan nor a certificate, so there is no debit.

### What "FINAL" does not claim

Only that the report was normalised, authorised and sealed. It is not a sanitization
certificate, it never reports a purge as performed, and every domain keeps the honest
status the raw report recorded (Spec §82). Per the rev-2 instruction, unit tests are
**not** treated as product support: the proof this works on an installed workstation is
the `.exe` verification, not this suite.

### Note on an observation

One desktop run failed after Gradle and cargo had saturated memory, with the vitest
worker-timeout signature already recorded in §11.7. It did not reproduce: two clean runs
followed at 71/71 with the 172–175 s baseline duration.

### Gates

`pnpm -r typecheck` 0 · desktop `tsc -b` 0 · `cargo test --lib` 236 pass / 0 fail ·
host `:host:test` 271 pass / 0 fail (ReportFinaliserTest 13/13) · desktop `pnpm test`
71 pass / 0 fail, twice · holds harness ALL HOLDS INTACT — 0 breaches, harness file
unmodified · journey paths 0 touched · UTF-8 clean, no BOM · real identifiers 0.

## Amendment - 12 Oct 2026 - WP-3b S1 agent wiring EXECUTED

WP-3b closes the gap the collector recorded about itself: *"Not wired into orchestration,
report generation, or the receiver in this checkpoint - collector + tests only."*

Four pieces existed and none of them connected to each other:

| Piece | Built | Production caller |
|---|---|---|
| `S1ApplicationInventoryCollector` (`:core`) | yes — 29-test suite | **none** |
| `PackageManagerPackageMetadataSource` (`:app`) | yes | **none** |
| `HostAndroidComponentBridge` (`:host`) | yes — tested | **none** |
| `RUN_SCAN` `deviceSideInventory` parameter | yes — validated | desktop never sent it |

The destination already existed: the host reconciles S1+S2 through
`ApplicationInventoryReconciler` and `GenericDeviceEvidence` already carried the slot. WP-3b
is the wiring that makes anything arrive there.

### Ruling - the host collects S1 itself (Chief Engineer, 12-Oct-2026)

Two routes were offered: the host pulling S1 over the ADB transport it already owns, or the
desktop collecting it and passing it up inside `RUN_SCAN`. **The Chief Engineer chose the
host route.** Consequence: WP-3b makes **no desktop change at all**, and the existing
`deviceSideInventory` parameter remains valid and unchanged for other callers and tests.

### What was built

- `apps/android/core/.../AndroidComponentModels.kt` — `applicationInventory` added to
  `AndroidComponentEvidencePayload`, **additive and default-null**. A payload written by an
  APK that predates the field still decodes, and decodes to **null** rather than to an
  invented empty inventory a reader would take as "this phone has no applications
  installed". Pinned by `AndroidComponentModelsTest.aPayloadWrittenBeforeTheInventoryFieldStillDecodesToNull`.
- `apps/android/app/.../ComponentEvidenceReceiver.kt` — the receiver now runs the collector
  through `PackageManagerPackageMetadataSource`, so the phone's own inventory is produced on
  the device in the same pass as the component facts, under one shared collection instant.
  A failure degrades only that field to null; the component evidence is still written.
- `apps/host/.../WorkstationSessionOrchestrator.kt` — the orchestrator now instantiates
  `HostAndroidComponentBridge`, its first production caller, and prefers the inventory the
  host collected from the device over a caller-supplied document: its provenance is that the
  host triggered the collection and read the result back.

### Honesty properties carried

- **Completeness is never raised.** S1 enumeration is filtered by Android package-visibility
  rules, so `enumerationCompleteness` stays `FILTERED` and the reason travels with the
  evidence. The label — the human-readable application name that is the point of this
  package — is proven to survive the wire in `AndroidComponentModelsTest.inventoryTravelsWithThePayloadAndKeepsItsLabel`.
- **Null means "not collected", never "no applications installed."**
- **Fail-closed.** A workstation with no APK installed still scans: the bridge contributes
  nothing and breaks nothing
  (`IntegratedEvidenceWorkflowTest.scanStillSucceedsWhenTheComponentIsNotInstalled`).
- **No serial reaches an evidence file.** `HostAndroidComponentBridge` requires a
  `deviceLifecycleId`; the host passes the session id that drove the collection — deliberately
  **not** the device serial, which is a machine identifier. The host tracks no device
  lifecycle, so it does not invent one either.
- The receiver reads metadata only: package names, labels, platform flags, enabled setting,
  version, UID. Application content is never touched.

### Android SDK enablement - ruled and recorded (Chief Engineer, 12-Oct-2026)

`settings.gradle.kts` excludes `:app` and `:sanitization-agent` unless an SDK is wired in,
so the device-side change could not be compiled on this workstation. The Chief Engineer chose
to enable it now rather than defer to WP-4.

- `apps/android/local.properties` created with `sdk.dir=…` — **gitignored**
  (`.gitignore:35`), so it does not enter the repository.
- `ANDROID_HOME` set at User scope so Android Studio and other tools resolve the same SDK.

**Effect, stated plainly:** `:app` and `:sanitization-agent` now join every Gradle
configuration on this machine. That is a deliberate build-configuration change and it is
recorded here rather than left implicit. It does not sign anything: release builds of the
sanitization agent remain intentionally unsigned (H4) and no key generation is involved.

A green baseline for `:app:compileDebugKotlin` was captured **before** any source change
(5 m 38 s, exit 0), so a later failure could be attributed correctly.

### What WP-3b does not claim

Per the rev-2 instruction, compilation and unit tests are **not** product support. The
device-side collection is proven to compile, to carry its label, and to preserve completeness
through the wire; it is **not** yet proven against a physical phone. That proof is WP-4, where
the Chief Engineer clicks Scan on the installed application against the bench device. On
Android 11 S1 legitimately reports a visibility-filtered subset, and that is honest behaviour
encoded in the collector rather than a defect.

### Gates

`pnpm -r typecheck` 0 · desktop `pnpm test` 71 pass / 0 fail · `cargo test --lib` 236 pass /
0 fail · core `:core:test` 148 pass / 0 fail · host `:host:test` 273 pass / 0 fail (was 271,
+2 WP-3b wiring tests) · `:app:compileDebugKotlin` 0 · holds harness ALL HOLDS INTACT —
0 breaches · journey paths 0 touched · UTF-8 clean, no BOM · real identifiers 0.