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

## Amendment - 12 Oct 2026 - remote factory reset EXECUTED on the bench device

Commissioned by the Chief Engineer in writing after the consequences (irreversible,
device re-setup by hand, loss of USB contact during the wipe) were stated. Standing hold
H1 permits a destructive device operation only as an explicitly commissioned sequence;
this was that sequence. Record: `docs/CYVRA_FACTORY_RESET_PROOF_2026-10-12.md`.

### Ruling - rebuild-and-clear was tried first and FAILED

Before wiping, the Chief Engineer chose to attempt removal **without** a factory reset.
A build declaring `android:testOnly="true"` was produced, installed over the existing
Device Owner, and confirmed present via `dumpsys` (`TEST_ONLY` set). Every removal
method was then retried. All five refused:

| Method | Result |
|---|---|
| `pm uninstall` | `DELETE_FAILED_DEVICE_POLICY_MANAGER` |
| `pm uninstall` per-user | `DELETE_FAILED_DEVICE_POLICY_MANAGER` |
| `pm disable-user` | `Cannot disable a protected package` |
| `pm clear` | `Cannot clear data for a protected package` |
| `dpm remove-active-admin` | `Attempt to remove non-test admin` |

The system stores the test-only answer **at grant time** and never re-reads it, so
retrofitting the flag onto an existing grant accomplishes nothing. Recorded as a
negative result, not smoothed over (H8).

### Two defects found by running it

1. **The documented wipe command never fired.** `am broadcast -a <action>` is an
   *implicit* broadcast; Android 8.0+ does not deliver those to manifest-declared
   receivers of background apps. The command printed `Broadcast completed: result=0`,
   reading exactly like success, while Android logged `BroadcastQueue: Background
   execution not allowed` and the receiver never ran. Two attempts were lost to this.
   The README now names the component explicitly and explains why.
2. **`testOnly` is a precondition, not a repair** — see the ruling above. The manifest
   now declares it with a comment recording the measured failure.

### Result

One command over ADB erased the device: packages 363 -> 333, third-party 40 -> 4
(the 4 installed +222 s to +267 s **after** the reset boot by the device's own
provisioning, not survivors), contacts 294 -> 1, media 288 -> 20 (stock entries the OS
recreates), accounts 1 -> 0, CYVRA packages 2 -> 0. The bootloader independently
records `ro.boot.bootreason = reboot,factory_reset`, boot pinned to 11:41:24 from
monotonic `/proc/uptime`.

The **decisive** line is CYVRA Device Owner references 4 -> 0: no command could remove
that owner, only a factory reset could, and it is gone. That follows from a measured
negative result rather than from an inference about what a wipe should look like.

### An observation I could not explain and did not use as evidence

After the wipe the device reported `adb_enabled=1`, `development_settings_enabled=1`,
`user_setup_complete=1` and the launcher in front — a state a factory reset does not
produce by itself, since developer options are normally off afterwards. The device was
not in my custody between the reset and those readings, so I cannot say who completed
setup or re-enabled debugging, and I did not do it. Reported as observed only.

A separate check I ran produced a phantom "5.5-hour clock skew". That was a defect in
**my epoch arithmetic** (a naive local-1970 baseline), not in the device. Phone and PC
agree. Recorded here so the faulty check is not mistaken later for a finding.

### What this does not claim (H8)

- **Not agent-less.** The proof used an installed sacrificial artifact holding Device
  Owner rights. It does **not** demonstrate purging a device on which nothing of ours
  is installed. The agent-less question remains open and untested.
- **One device.** Android 11, one OEM, one model. Cross-OEM support is not established.
- **Verification still unratified.** The erasure is confirmed; a ratified verification
  contract under governed §29 is not, and capability-matrix row `PUR-DO-WIPE` is not
  changed by this record.
- **Scale untested.** One device under direct supervision, not 50 per batch.

### Gates

`pnpm -r typecheck` 0 · desktop 71/71 · web 305/305 · `packages/evidence` 0 ·
`services/api` 0 · `cargo test` 236/0 · `:sanitization-agent:assembleDebug` 0 ·
`:sanitization-agent:testDebugUnitTest` 0 · `wrangler deploy --dry-run` 0 · holds
harness ALL HOLDS INTACT — 0 breaches · journey paths 0 touched · UTF-8 clean, no BOM ·
real identifiers 0 · absolute-claim scan 0.

`pnpm -r test` reported a failure that was **environmental, not a test defect**: parallel
vitest workers exhausted this machine's 6.9 GB RAM (`Failed to start threads worker`).
Each suite passes when run with a single worker, and no change in this work package
touches TypeScript test code. §11.7 governs the same class of failure and forbids
weakening the gate to make it pass (H7) — so the gate was not weakened, it was re-run
under the memory constraint the machine actually has.

---

## Amendment - 12 Oct 2026 - Stage 0/1: fabricated measurements removed, collector extended

**Authority:** Chief Engineer rulings, 12-Oct-2026 (A1 Option B, A3, A4, A5, and the
instruction that everything unimplemented is implemented first and tested after).

### How the defect was found

Not by a test. By comparing the three external forensics documents and the two
engineering workbooks against the production source, field by field. A test suite
could not have found it, because the existing unit test asserted the fabricated
values - it pinned the defect rather than catching it.

### The defect

`apps/host/.../evidence/AdbGenericEvidenceProvider.kt` returned hardcoded literals for
security and storage state, stamped `EvidenceStatus.AVAILABLE`:

| Field | Line | Asserted | Reality |
|---|---|---|---|
| `secureBootEnabled` | `:156` | `true` | never queried |
| `deviceOwnerActive` | `:157` | `false` | never queried, and **proven wrong** - the bench device *was* a device owner that five separate commands refused to remove |
| `adbEnabled` | `:158` | `true` | never queried |
| `externalStoragePresent` | `:142` | `false` | never queried |
| `scopedStorageEnforced` | `:143` | `true` | never queried |

Two of these five are **not among the ratified 114 parameters** at all - ad-hoc fields
with no requirement behind them. `scopedStorageEnforced` additionally propagated into
customer-facing narrative text at `:144`, so the fabrication reached report output.

### A second fault in the same function

`collectSecurity()` substituted `false` when `dumpsys trust` **failed**, then still
stamped the result `AVAILABLE`. A failed measurement was being converted into a
negative finding. It was the only collector that degraded this way - `collectBattery()`
correctly returned `ERROR` and `collectStorage()` correctly returned `NOT_AVAILABLE`.
This breaches the standing honesty rule directly: unavailable evidence is never
converted to FAIL.

### What was built

- Security states are now **read**: `ro.boot.verifiedbootstate`, `settings get global
  adb_enabled`, `dumpsys device_policy`. Each carries the raw observation in its reason
  so a boolean never stands alone unsupported.
- Device-owner parsing treats the empty `Device Owner:` header as evidence of *neither*
  direction; only a resolved component name establishes an owner.
- `externalStoragePresent` is genuinely measured (`ls /storage`).
  `scopedStorageEnforced` is reported `NOT_AVAILABLE` with the true reason - it is a
  per-application policy with no shell-visible signal.
- Failure now reports `ERROR` with the reason, never a substituted value.
- **BAT-004** battery temperature was in the `dumpsys battery` output the collector
  already fetched and discarded. It is now captured - and deliberately **not converted
  to Celsius**, because the device's native divisor has not been measured against a
  reference. A wrong divisor would put a wrong number in a customer report.
- **ID-005** now also captures the build fingerprint, binding a report to one specific
  software image rather than to a marketing version.
- `ExtendedDeviceEvidence` added: additive, default-null, carrying ~34 further
  parameters across hardware, display, sensors, camera, audio, radios, performance,
  system and SEC-003.
- Every parameter carries its ratified workbook identifier, so product coverage is
  **computed from the data** rather than asserted by a person.

### The honesty primitive

All extended measurements pass through one choke point that maps *failed command ->
ERROR*, *succeeded but uninterpretable -> NOT_AVAILABLE with reason*, *interpretable ->
AVAILABLE*. No collector can produce a value by any other route. This is what makes the
honesty rule structural rather than a convention a future contributor may forget.

### Rulings recorded

- **A1 Option B approved** - Stage 6 physical/AI inspection track added. CYVRA AI-Enabled
  Grading is gated behind all three verifications, purge, factory reset and post-purge
  verification. A grade issued before purge describes the previous owner's data.
- **A4 approved** - the change boundary is "anything except `apps/web` and
  `services/api`". `apps/desktop` is in scope; it is the product surface, not a
  nice-to-have.
- **A5 approved** - Stage 5 names the document, not the number: the purge-verification
  contract, governed section 29 of this ledger.
- **Stage 1 approved first**, then WP-4.
- **Technician checklist approved** for the 13 human/specialist parameters, so the 114
  is complete in process where it cannot be complete in automation.

### Supporting documents produced

- `docs/CYVRA_FINAL_PLAN_VS_ACTUAL_HANDSHAKE_MATRIX_2026-10-12.md` - all 114 parameters
  in rows and columns: today's code state, application role, AI agent role, human role,
  gap, tested status, stage.
- `scripts/verify-stage-gates.ps1` - the acceptance gate runner, so every stage exits
  against the same published definition of done.

### What this does not claim (H8)

- It does **not** claim the product is complete. The measured position is **20 of 114
  parameters** collected before this work package; the ratified plan authorises 74 as
  collectible by the application alone.
- It does **not** claim any extended parameter is *validated*. They are implemented and
  compile; whether each command returns a usable reading on real hardware is a separate
  measurement, and any that does not must be reported as not available rather than
  quietly dropped.
- It does **not** claim purge is verified. That contract remains unratified.
- Battery temperature is recorded in **device-native units**, not Celsius, because the
  divisor has not been measured.
- Nothing here is RELEASE-VALIDATED.

### Gates

PENDING - to be run by the Chief Engineer via `scripts/verify-stage-gates.ps1` and
recorded here with the actual output. **No gate is recorded as passed until its output
has been observed.**

---

## Amendment - Post-reset verification claims corrected, and the acceptance gate made fail-able (WP-1b)

Date: 12-Oct-2026. Status: CODE COMPLETE. Gates: PENDING (Chief Engineer to run
`scripts/verify-stage-gates.ps1`).

This work package was opened by reading, not by building. Two fabrications of the same
class as the Stage 0 findings were found in product code and corrected. Neither was
reported by a test; both had tests asserting the fabricated behaviour.

### Finding 1 - the sanitization certificate asserted NIST-verified erasure from a lock-screen check

`HostSanitizationProvider.verifyPostReset` (PUR-005) treated the absence of a screen lock
as proof of erasure. It returned `VERIFIED`, stamped
`assuranceLevel = "NIST_SP_800_88_REV2_CLEAR_PLATFORM_VERIFIED"`, set
`userDataInaccessible = !lockPresent`, and recorded
`notes = "Device returned to factory setup state; user account data cleared"`.

A device whose owner had simply never set a screen lock presented identically to a
factory-reset device. The check cannot distinguish the two, so both `true` and `false`
were claims about the device, and neither had been measured.

This reached the customer-facing **CYVRA Data Sanitization & Verification Certificate**
via `assuranceDeclaration = assuranceLevel` and
`userAccountsRemoved = userDataInaccessible`. The overall outcome was protected -
`deriveSanitizationLifecycleOutcome` prevents a blocked execution reaching
`EXECUTED_VERIFIED` - but those two fields were set unconditionally, so even a
"blocked, not executed" certificate carried a NIST clear-verified declaration and a claim
that user accounts had been removed.

Two adjacent defects of the same shape:

- `SanitizationCertificateReport` defaulted `userAccountsRemoved = true` and
  `setupWizardConfirmed = true`. Any constructor omitting them published both as achieved.
  A claim issued by omission is the hardest kind to notice, because no line of code looks
  like a claim.
- `HostSanitizationWorkflowEngine` set `screenLockAbsent = verification.userDataInaccessible`
  - "user data is inaccessible" mapped onto "screen lock is absent". The two only ever
  coincided because both had been derived from the same single boolean.

### Finding 2 - the system acceptance gate could not fail

`HostAcceptanceVerificationEngine.evaluateSystemAcceptance` marked all 20 §80 acceptance
checks `PASSED` unconditionally, marked all 18 journey stages completed, and sealed the
result with an SHA-256 over the string `"VERIFIED-ACCEPTANCE"`. It performed no
verification of anything. `AcceptanceCheckItem.status` also defaulted to `PASSED`, so an
omitted status published a passing check that had never been run.

A gate that cannot fail is not a gate.

### What changed

Honesty model:

- `VerificationResult.userDataInaccessible` is now `Boolean?`, default `null`. `null`
  means NOT ESTABLISHED and is the default because both `true` and `false` are claims
  about the device, whereas `null` is a claim about our knowledge. `null` survives the
  protocol as `JsonNull` rather than being coerced to a boolean.
- `verifyPostReset` reports `PARTIALLY_VERIFIED` where the lock state was readable and
  `REQUIRES_EXTERNAL_VERIFICATION` where it was not. It never returns `VERIFIED`, and its
  `assuranceLevel` is `OBSERVED_POST_RESET_STATE_ERASURE_NOT_ESTABLISHED` - it names what
  was observed, not a standard this product has not executed.
- Its limitations now state plainly that screen-lock absence cannot distinguish a reset
  device from a device never given a lock, and that account and contact counts were never
  taken after reset (PUR-006).
- Certificate defaults for `userAccountsRemoved` / `setupWizardConfirmed` are now `null`.
- The report renderer prints `NOT_ESTABLISHED` rather than a bare `null`.
- The workflow parks at `POST_RESET_VERIFIED` instead of advancing to
  `CERTIFICATION_READY`: a partially verified reset must not be advanced toward a
  certificate.
- Test-fixture strings that supplied the NIST assurance value were replaced with the
  value the product actually emits.

Acceptance gate:

- `AcceptanceStatus` gains `NOT_EVALUATED`; `AcceptanceCheckItem.status` defaults to it.
- `evaluateSystemAcceptance` accepts `observations: Map<String, AcceptanceStatus>` and
  `completedStages`. An unobserved check reports `NOT_EVALUATED`; no journey stage is
  marked completed unless supplied.
- `isSystemAcceptancePassed` now requires every check `PASSED`, so a non-zero
  `notEvaluatedCount` withholds acceptance.
- The seal records the counts that produced it instead of asserting "VERIFIED".
- The capability is retained: a new test supplies a complete observation set and the
  engine still reaches acceptance. It is no longer able to pass for free.

Scope note on Finding 2: this engine was wired only to its own test. No product flow,
report or protocol route consumed it, so no customer-facing claim had yet been issued by
it. It is corrected because it sits in `apps/host/src/main` and is shaped like the §80
release gate (H7), where an always-passing check is the most expensive defect available.

### Effect on the ratified 114

- **Correction to my own earlier reporting.** The previous entry's figure of 20 uncoded
  application-owned rows over-states the gap. PUR-001 through PUR-005 already exist in
  the sanitization subsystem - `assessCapability`, `requestAuthorization`, `selectMethod`,
  `execute`/`executePurge`, `verifyPostReset` - but are not keyed to the ratified workbook
  identifiers, so the handshake matrix reported them as NOT IMPLEMENTED. The honest count
  of genuinely uncoded application-owned rows is **15**.
- PUR-004 stays counted as not implemented on purpose: the code is present but execution
  is blocked and records `BLOCKED_NOT_IMPLEMENTED`. Code presence is not execution.
- PUR-006 (residual user-data evidence) has no implementation. `AdbApplicationInventoryProvider.collect()`
  already counts the very artefacts PUR-006 would need, so PUR-006 is implementable by
  re-running that inventory post-reset against a pre-purge baseline - the same measurement
  that was taken by hand on the bench. Identified, not built.
- The 15 uncoded rows are stimulus-dependent (BT-002, BT-003, CAM-002, CAM-003, DIS-010,
  GNSS-002, HW-005, PERF-001, PERF-003, STO-003, STO-004, WIFI-003, WIFI-004, PUR-006)
  with one exception: **PHY-008**, SIM tray/slot integrity, which the workbook marks
  physical-required with capability "No" yet maps to "Conditional / assisted". That is an
  inconsistency internal to the ratified workbook. It is flagged for the Chief Engineer,
  not silently corrected.

### What this does not claim (H8)

- It does not claim purge is verified. The purge-verification contract remains unratified
  and PUR-004 execution remains blocked.
- It does not claim any of the 56 coded parameters has been validated on hardware. None
  has run end-to-end against a real device through the product path.
- Correcting these claims narrows what the product asserts. It adds no capability, and no
  stage of the plan is advanced by it.
- Nothing here is RELEASE-VALIDATED.

### Gates

PENDING - to be run by the Chief Engineer via `scripts/verify-stage-gates.ps1` and
recorded here with the actual output. **No gate is recorded as passed until its output
has been observed.**

Assisted evidence available at the time of writing: `:core:test` and `:host:test` both
BUILD SUCCESSFUL (3m 30s) with both fixes in the tree. That is assistant-run evidence on
the bench machine, not Chief Engineer verification.

---

## Amendment - 13 Oct 2026 - Chief Engineer rulings: H2 exception, PHY-008, deferred work

Date: 13-Oct-2026. Authority: Chief Engineer, in session.

### Ruling CE-1 - H2 exception, scoped, option A

**Finding.** `readEntitlementPolicy()` in `services/api/src/entitlementSigner.ts`
built the offline permission triple with `sanitizeExecute: false` as a **literal**.
`ENTITLEMENT_VALIDITY_SECONDS` and `ENTITLEMENT_GRACE_SECONDS`, the two settings
on either side of it, are read from the environment; this one was not. It was not
plan-driven, not customer-driven and not configurable.

Consequence: `HostProtocolDispatcher.sanitizeExecuteResponse` refuses when
`isLicensed && !offline.sanitizeExecute`. Since the server could only ever sign
`false`, **a licensed workstation could never purge under any data change**.
WP-5 was therefore not "waiting for an entitlement to be issued"; the entitlement
could only ever be a refusal. This corrects the assistant's 12-Oct statement that
WP-5 was blocked on "arranging the live entitlement".

**Ruling:** H2 exception granted, **scoped to `readEntitlementPolicy()` in
`entitlementSigner.ts`**, option A - the value becomes env-driven
(`SANITIZE_EXECUTE`, compared strictly to `"true"`) with **the default left
`false`**.

Why this shape rather than a hard `true`: two M1 tests assert the frozen posture
- `activation.test.ts:512` and `entitlementSigner.test.ts:221` ("destructive work
stays off offline"). With the default still `false`, **both continue to pass**,
so no gate is relaxed (H7) and the offline safety property is preserved.
Configuring nothing therefore behaves exactly as before.

A typo such as `True`, `1` or `yes` fails closed rather than half-open.

**Scope recorded:** this is the only sanctioned M1 edit in the Integration Sprint
to date. `apps/web` remains untouched.

### Ruling CE-2 - PHY-008, option A

The two ratified workbooks read differently because they answer different
questions. The Capability Matrix says CYVRA Capability **No**, Evidence Type
**Physical required**, Limitation **"Software SIM state is insufficient"**, Report
Treatment **Physical section**. The Automation Impact Matrix says automation mode
**"Conditional / assisted"**, recommended action **"capability-aware collector +
guided exception workflow"** - a human performing the check with the application
guiding them, not software answering it.

The assistant's generator had mapped `Conditional / assisted` to
"application-owned", which placed a check the workbook itself says software
cannot perform into the software bucket, where it could never be closed. **That
mapping was the defect, not the workbook.**

**Ruling: option A.** PHY-008 becomes the **14th technician checklist item**. The
application never claims it. The generator's checklist sync check is updated to
14 with this ruling recorded as the reason. The rated parameter is tray integrity
- fit, contact, retention - which software cannot observe.

Option C (splitting PHY-008 into a human check plus a separate software SIM-state
parameter) was considered and **not** taken, because it would change the ratified
total from 114 to 115. The Chief Engineer has not authorised that change.

### Ruling CE-3 - previously deferred work, all approved

The Chief Engineer ruled: *"overrule all my previous rules to Deferred."* Recorded
as approved, each with its trigger:

| Item | Now | Trigger for execution |
|---|---|---|
| §80 check-description rewording | **APPROVED** | after hardware verification (original condition retained) |
| IP register into git | **APPROVED** | assistant still to confirm the exact path and irreversibility before writing it |
| Stage 6 procurement | **APPROVED** | physical ordering, external lead time |
| A-15 staging quirk | **APPROVED** | opportunistic |
| A2 acceptance-policy file | **APPROVED** | only if still wanted; superseded in practice by `verify-stage-gates.ps1` |

Also approved: the 15 uncoded collectors (route a), the end-to-end bench scan
(route b), WP-4 and the checklist UI (route c), PUR-006, Stage 5 drafting, and a
purge run through the product path with before/after counts.

**Not covered by this ruling:** standing holds H1-H8. H2 is a standing hold, not
a deferred item, which is why CE-1 was put to the Chief Engineer explicitly
rather than treated as implied.

### Ruling CE-4 - agent-less attempt strategy (product requirement)

Recorded as a build requirement: the product **tries agent-less five times**
across differing Android models and versions, **falls back to agent-based on
failure**, and **completes the operation either way** - the user never meets a
dead end on scanning or purging. Every attempt and its outcome is written to the
log.

H8 note, stated because it must be: on a locked bootloader, `uid=2000(shell)`,
no root and no Device Owner, the assistant knows of no Android mechanism that
erases user data. The assistant's **belief**, labelled as belief and unproven, is
that agent-less erase will return "cannot" on most devices. Global technology
research has been commissioned to establish this with measurements rather than
assumptions. A "cannot" result is a result, not a failure, and the fallback is
what makes it a product.

### Ruling B1 - how H2 is enforced (named sanctioned-exception list, option A)

CE-1 sanctioned two files inside the frozen journey. The automated H2 check
counts files touched, so it reported a breach every run and could not tell an
approved edit from an unapproved one. The Chief Engineer was given three
options and chose **A** on the assistant's recommendation:

- **A - named sanctioned-exception list.** Chosen.
- **B - revert CE-1.** Rejected: purge could never work on a licensed
  workstation, because `SANITIZE_EXECUTE` would stay hard-coded `false`.
- **C - leave the gate red forever.** Rejected: no work package could ever be
  committed.

**What the check now enforces.** H2's meaning is unchanged: *no unapproved edit
to the customer journey.* What changed is that "approved" is now a thing the
check can distinguish. It previously reported only "touch", so it could neither
allow CE-1 nor explain it.

The five conditions that keep this from being a weakening of the gate (H7):

1. Every sanctioned file is **still printed on every run**, with its ruling ID
   beside it. Nothing is hidden from this gate at any time.
2. A ruling counts only if its ID literally appears in this ledger. An
   unrecorded ruling is not a ruling, and the file breaches anyway.
3. Entries must be exact file paths; a directory is rejected outright.
4. Any journey file not named in the list still breaches, without exception.
5. A sanctioned file the sprint no longer touches is reported **STALE**, so the
   list cannot quietly accumulate dead entries.

**Evidence the safeguard holds (13-Oct, negative test).** The assistant ran the
harness with the ruling ID changed to `CE-999`, which does not exist in this
ledger. Output: `SANCTION REJECTED (ruling CE-999 is not recorded in the
governance ledger)` for both files, both files then listed as `VIOLATION`,
`HOLD BREACHES: 1`, **exit 1**. The same run with `CE-1` reads
`sanctioned 2, unapproved 0`, both files printed under `SANCTIONED [CE-1]`,
**exit 0**.

**Where it lives:** `scripts/verify-standing-holds.ps1`, `$SanctionedM1`, with
the ruling text above the declaration. Adding an entry there is a governance
act, not a code change.

### Gates

`:services/api` typecheck **exit 0**; `:services/api` tests **413 passed / 0
failed / exit 0** - assistant-run after the CE-1 change. `activation.test.ts:512`
and `entitlementSigner.test.ts:221` both still pass, which is the evidence that
the frozen posture was preserved.

Stage gate runner, Chief Engineer's run **13-Oct 11:24:56** - **10 PASS /
1 FAIL** (log written to `gate-run-20261013-112456.log`). G-B (unit tests)
**PASS** on this run, confirming the earlier G-B failure was transient rather
than a defect. The single failure was **G-D**, which is exactly what ruling B1
addresses. Harness run standalone after B1: **0 breaches, exit 0**.

**G-D could not pass at all - gate defect, fixed 13-Oct.** The runner tested
the harness output with `-notmatch 'BREACH'`. PowerShell's `-match` is
case-insensitive, so it also matched the harness's own success line
`ALL HOLDS INTACT - 0 breaches`. G-D therefore failed on the word "breaches"
inside a message reporting none, whatever the repository's state - which is
why it still read red after B1 had made the holds clean. Corrected to match the
`[BREACH]` tag printed once per failing finding. The exit code stays
authoritative, the harness documenting "Exit code 0 means every hold is
intact", and the double-check still trips both ways: verified clean run returns
True, verified breached run returns False. This repairs a gate that could never
report success and relaxes nothing (H7).

**G-F never covered untracked files** - `git diff --name-only HEAD` omits them,
so a brand-new document escaped the UTF-8 gate. Added
`git ls-files --others --exclude-standard`.

**Full gate run, 13-Oct 12:42:46 - 11 PASS / 0 FAIL: "ALL EXECUTED GATES
GREEN."** Log `gate-run-20261013-124246.log`. G-B passed at 11:24 and again at
12:42; the single 12:22 failure did not reproduce, and `apps/desktop` passes
**71/71 in isolation**, so the failure is attributed to parallel-worker memory
exhaustion on this 6.9 GB machine rather than to a defect in the suite.

Full suite: **PENDING** the Chief Engineer via `scripts/verify-stage-gates.ps1`.

---

## Amendment - 13 Oct 2026 - Q1 provenance corrected before the 14 collectors (WP-A)

### How it was found

Beginning the 14 uncoded collectors, the assistant read the generator's status
string for those rows instead of trusting it. The string carries a citation -
`gen_handshake.py` names `docs/CYVRA_AGENTLESS_RESEARCH_Q1_2026-10-12.md`
directly above the set it depends on. That document exists, is tracked, and is
126 lines long. **None of the 14 row IDs appears anywhere in it.**

### The defect - 27 rows asserted a Q1 measurement

**Tier B - nine rows, a false attribution.** `NOT IMPLEMENTED - Q1 measured the
probe obtainable`. Checked line by line against the cited file:

| What was searched for | Result |
|---|---|
| `bluetooth`, `gnss`, `location`, `gps`, `wifi`, `wi-fi` | absent from the file entirely |
| `responsiveness`, `latency`, `throughput`, `fix`, `pair`, `scan` | absent - these are the dimensions the nine rows measure |
| `camera`, `disk` | one line each, inside a six-row class summary |
| any 114-parameter ID | none; the only ID-shaped match in the file is `Oct-202`, a fragment of its own date |

Q1 therefore never exercised Bluetooth, GNSS or Wi-Fi, and never measured
responsiveness, frame delivery, pairing or fix acquisition. The nine could not
have been measured obtainable by it.

**Tier A - eighteen rows, overstated rather than false.** Thirteen map to a
named entry in Q1's class table (manufacturer, API level, build fingerprint,
package inventory, storage volumes, battery state and health, screen-lock
state, Android ID). `CON-001/002/003` are supported by section 4, which records
that USB debugging must be enabled and the host authorised on the device
screen. Two - `ID-002` Brand and `ID-006` Security patch level - are absent
from the file entirely: neither the word "brand" nor "security patch" occurs in
it, and neither appears in its Identity & build row.

Q1 records **four commands, all of them refusals** (`ls /data/data`,
`cat /data/system/packages.xml`, `su -c id`, call log). No successful probe's
command is recoverable, so "command proven" was not supportable wording.

**A third defect, inside Q1 itself.** Its closing line read *"Reproduce every
figure above from the commands recorded in this report."* Only the four
refusals were recorded. Omitting the raw dumps was correct and stays - the
egress rule required it - but commands carry no identifiers, so nothing
required omitting them.

### What was corrected

1. `PROBE_NOT_MEASURED` (9) and `Q1_NOT_STATED` (2) subtracted from
   `Q1_OBTAINABLE`, with the reasoning and the measurements written into a
   comment above the subtraction, so that the belief and its refutation both
   remain in the tree.
2. `tested_status()` gained a branch returning `probe obtainability NOT
   measured for this parameter` for the nine. The tier stays `NOT IMPLEMENTED`.
3. `gap()` now returns `Implement collector (Stage 1)` for those nine rather
   than `Implement ADB collector (Stage 1)`. That removes an unmeasured
   presumption - that ADB suffices for `BT-003` pairing and `WIFI-003`'s
   controlled access point. Nothing has measured it.
4. Tier A wording became `data class returned on hardware by Q1; per-parameter
   command not recorded`, in both `tested_status()` and `tier_of()`.
5. Q1's closing line replaced with a dated re-execution caveat.
6. `RESUME` section 5 restated to measured values; it also still carried the
   pre-`797693a` note saying the PUR remap had not been done.
7. The generator now prints `provenance-corrections`, so the correction is
   visible in its own output rather than only in prose.

### Why the fabrication counters did not move

`fabrications-removed: 5` and `live-fabrications: 0` are unchanged, deliberately.
That counter covers `FAB_LIST` - five hardcoded values stamped `AVAILABLE` in
product code - a different class from a research attribution error in a
documentation generator. Folding these eleven in with those five would merge two
distinct defects under one number. The new `provenance-corrections: 11` line
keeps them separate and both visible.

### Measured effect

| Quantity | Before | After |
|---|---:|---:|
| rows | 114 | 114 |
| implemented | 61 | 61 |
| TESTED (Q1) | 18 | 16 |
| UNIT-TESTED only | 4 | 6 |
| NOT IMPLEMENTED | 9 | 9 |
| NOT TESTED | 29 | 29 |
| CHECKLIST IN PRODUCT | 14 | 14 |
| TESTED on bench | 4 | 4 |
| Q1_OBTAINABLE | 61 | 50 |
| provenance-corrections | absent | 11 |

4 + 16 + 6 + 36 + 14 + 9 + 29 = 114. No row changed owner, stage or
implementation state. `ID-002` and `ID-006` change tier only, and their product
paths remain unit-tested: `AdbGenericEvidenceProviderTest.kt:22` stubs
`ro.product.brand`, `:29` stubs `ro.build.version.security_patch`, with four
workflow tests behind them.

`tested_status()`'s branch reading `Q1 measured the probe obtainable` is now
reached by **zero rows**, measured directly. It is retained because it stays
correct for whatever remains in the set, and would be true by construction for
any genuinely measured row added later.

### Standing

Nothing here weakens a gate (H7) and no frozen file was touched - `apps/web`
and `services/api` are unchanged. The nine rows now say what is true today, and
what replaces `NOT measured` is the collector run on the bench device, which is
the next work package.

---

## Amendment - 13 Oct 2026 - the matrix under-reported its own product (WP-A2)

### Ruling

Chief Engineer, 13-Oct-2026, option A: **credit the thirteen as in evidence
path with an honest `NOT_AVAILABLE`, distinguish them from `PUR-006`, and
correct the Method table's provenance claim.** `no code in evidence path`
**14 -> 1**.

### How it was found

Planning the fourteen uncoded collectors, the assistant grepped the provider
instead of trusting the plan. All fourteen identifiers are in tracked source.

| Where | What the code does |
|---|---|
| `AdbExtendedEvidenceProvider.kt` | 13 of the 14 emitted via `notMeasurableByShell(...)` - ratified ID, `value = null`, `NOT_AVAILABLE`, `source = "ADB"`, and a reason |
| `HostSanitizationProvider.kt:168` | `PUR-006` appears only inside a `limitations` string, where the product declares it did **not** measure it |

`collect()` adds every group, so all thirteen emit at runtime.

### The defect

The matrix printed `not collected` for those rows and counted them as `no code
in evidence path`. Its Method table also claimed:

> `| Today's code state | read from source at exact line references, 12-Oct-2026 | yes - open the files |`
> "No row in this table was written from memory or estimation."
> *Today* = what the code does right now (measured from source).

`today_state()` opens no file. It returns from two maintained lists or the
literal `"not collected"`, and for those thirteen the literal contradicted the
source it claimed to have read. This is the same class as the Q1 defect
corrected the same day: an attribution that does not survive inspection.

### What was corrected

1. `read_declined_from_source()` parses `notMeasurableByShell(...)` out of the
   Kotlin at generation time, storing id -> the product's own reason. **The
   matrix now reads the source it says it reads.** It raises `FATAL` if the
   file moves, and `FATAL` if fewer than ten rows parse, so it cannot quietly
   revert to printing `not collected`.
2. `today_state()` returns `In evidence path - emits NOT_AVAILABLE with value
   null and the reason the product itself records: "..."`.
3. `gap()` returns `Collector in place and emitting an honest NOT_AVAILABLE -
   the value itself is still not obtained`, replacing `Implement collector`,
   which told a reader to build what already exists.
4. `tested_status()` for the nine dropped `product does not collect it`, which
   contradicted the new TODAY text. The tier label stays `NOT IMPLEMENTED`,
   because what is not implemented is the *measurement*.
5. Method table, column key and module docstring now describe both mechanisms
   and their differing strength, including that transcribed rows **can** drift
   while source-read rows cannot.

### Measured effect

| Quantity | Before | After |
|---|---:|---:|
| no code in evidence path | 14 | **1 [PUR-006]** |
| rows / implemented / owners / stages | 114 / 61 / unchanged | unchanged |
| TESTED 16 - UNIT-TESTED 6 - NOT IMPLEMENTED 9 - NOT TESTED 29 - CHECKLIST 14 - bench 4 | - | unchanged |

Fourteen rows change TODAY text: the thirteen application-owned ones plus
`CELL-005`, which the provider also declines but which is technician-owned and
therefore was never in the printed fourteen.

Markdown integrity: all 114 parameter rows carry 11 cells. A naive check flags
fourteen 3-cell rows, but those belong to the separate checklist-index table
and are identical before and after this change (`128 rows, 14 short` on both
sides), so this edit introduced no malformed row.

### Not claimed

- **No test covers `AdbExtendedEvidenceProvider`.** Emission of those thirteen
  rows is established by static reading and by the generator's parse - not by a
  unit test and not by a device run. The new `FATAL` guards the *matrix*, not
  the *product*.
- The reason strings are the product's own words. Sorting them into "the
  workstation can stimulus this" against "this needs a fixture" is
  interpretation, and is recorded here as interpretation, not as measurement.

---

## Amendment - 15 Oct 2026 - STAGED VERIFICATION adopted as the standard working method

### Ruling - Chief Engineer, 15-Oct-2026

> "Staged verification is the standard working method: the activity runs as
> four parts - rules and types, JavaScript tests, Android, Rust - with the
> three memory-heavy suites each isolated in their own part. The Gradle
> daemon is stopped when Android work ends, so no process survives into the
> next part. All 13 checks run; none is skipped, relaxed, or reordered into
> concurrency. The one-shot gate remains the release authority."

Approved verbatim by the Chief Engineer on 15-Oct-2026, with the instruction
to implement it before returning to the build.

### Why - the cause, measured rather than assumed

The gate run of 15-Oct 10:17 failed with **12 PASS / 1 FAIL** and **zero
tests failing**: `Failed to start threads worker ... ActivationScreen.test.tsx
/ Timeout waiting for worker to respond`, with `Test Files 4 passed (4)` out
of the five files that exist. Forty-seven of seventy-one desktop tests did
run and every one of them passed; one file never started.

Measured on the machine at the time:

| Quantity | Reading | Source |
|---|---|---|
| total RAM | 6.89 GB | `Win32_OperatingSystem` |
| free RAM at the failure | 2.18 GB | same |
| idle Gradle daemon found | 493 MB | `Get-Process java`, working set |
| age of that daemon | about 12 h | process start time; left from the 14-Oct 21:17 run |

That daemon was stopped - housekeeping, no gate change - and the same checks
were re-run: **13 PASS / 0 FAIL**, log `gate-run-20261015-104306.log`.

**The finding that shaped the ruling:** the failure occurred *inside* the
one-shot gate, which already executes its checks one after another.
Separating the activity into four parts on its own would not have prevented
it. What poisoned the run was a process left behind by the *previous* run.
The ruling therefore has two halves - the four-part split, and the daemon
release - and it is the second half that addresses the measured cause.

### What was built

`scripts/verify-stage-gates.ps1` gained a `-Stage` parameter:

| Part | Contents | Rows |
|---|---|---:|
| 1 | G-E M1 freeze, G-D code checks, G-D bench-phone probe, G-F UTF-8, G-G absolute claims, G-A typecheck, G-A desktop tsc, G-C wrangler dry-run | 8 |
| 2 | G-B `pnpm -r test`, alone | 1 |
| 3 | G-H three rows, then `gradlew --stop` | 3 |
| 4 | G-I `cargo test`, alone | 1 |
| | **total** | **13** |

`-Stage` selects which checks run. It never changes how any check is judged:
the same command, the same exit-code test, the same result. The default - no
`-Stage` argument - is the one-shot release authority and is unchanged.

The daemon release sits at the end of part 3. It is housekeeping, not a
check: it can neither pass nor fail anything, and a failure to stop is written
to the gate log and to nothing else.

`scripts/verify-staged.ps1` was rewritten as an orchestrator that calls the
gate four times by part number. It now contains no check of its own.

### Why that file was rewritten rather than adjusted

The previous version re-implemented eight of the thirteen checks and had
drifted from the gate on several of them: `cargo test --lib` where the gate
runs `cargo test`, different Gradle targets, and it did not run the M1
freeze, the UTF-8 scan or the absolute-claim scan at all - which its own
header did disclose. It also described the H1 device probe in terms of a
binary `$intact` test that was reworked on 14-Oct, and stated that the gate
runs `-SkipDevice` and therefore never exercises the device probe, which has
been false since `646596d`.

Two definitions of one check will drift, and the copy that drifts is the one
that ends up being run. There is now exactly one definition of each check,
in the gate.

### Measured evidence

| Run | Result | Exit | Time |
|---|---|---:|---:|
| part 1 | 8 rows, all PASS | 0 | 169.5 s |
| part 2 | 1 row, PASS | 0 | 486.1 s |
| part 3 | 3 rows, PASS, daemon released | 0 | 93.8 s |
| part 4 | 1 row, PASS (cargo 236 passed, 0 failed) | 0 | 59.1 s |
| **four parts through the orchestrator** | **13 of 13, ALL FOUR PARTS GREEN** | **0** | **893.9 s** |
| **full pass, no `-Stage`** | **13 rows, all PASS, original row order** | **0** | **932.1 s** |

Live `java` processes measured after every one of those runs: **0**.

Row order in the full pass was preserved on purpose. The part 1 block was
split three ways so that G-C - which belongs to part 1 - still prints after
G-B, which belongs to part 2, exactly as it did before staging existed.

### What this does not claim (H8)

- A single green part is **not** "gates green". Only the full pass is.
- The split does not create memory headroom; it removes *concurrency*. Free
  memory read 2.78 GB at the start of the four-part run and 2.75 GB at the
  end. The benefit is that the three loaded suites never overlap, not that
  the machine has more memory than it has.
- There is no safe free-memory threshold, and any document offering one
  would be offering a belief. G-B has failed at 2.21 GB free and passed at
  2.14 GB.
- The 15-Oct stall of the bench-phone probe was a separate defect, fixed in
  the same session by giving every adb call a 30-second timeout and per-call
  timing. That fix is recorded in the probe's own source, not here.

### Gates

`pnpm -r typecheck`, desktop `tsc -b`, `pnpm -r test -- --maxWorkers=1`
(5 files / 71 tests), `wrangler deploy --dry-run`, `:core` and `:host`
compile, `:host` tests, `:sanitization-agent` assembleDebug and tests,
`cargo test` (236 passed, 0 failed), standing-holds code checks, bench-phone
probe - **13 PASS / 0 FAIL** as a full pass, and the same thirteen green when
run as four parts.

---

## Amendment - 16 Oct 2026 - Chief Engineer rulings: version, activation, download, email scope, evidence redaction

Recorded from the Chief Engineer's message of 16-Oct. Append-forward: this entry
supersedes nothing and rewrites nothing. Items are numbered as the Chief Engineer
numbered them.

| # | Question put | Ruling |
|---|---|---|
| 1 | Which version | **`1.1.0`.** The rebuild is what makes it real |
| 2 | Activation rectification | **Option C - the real product fix, P6 task 6.2.** Keep the install per-machine so `pnputil` keeps its elevation; make `<cyvra.home>` writable |
| 3 | Installer download host | **Always private, accept signed-in-only.** The repository stays private |
| 5 | Scope of the no-email rule | **Account identities only.** The rule reaches real, personal and bench account identifiers - not test fixtures on the product's own domain |
| 6 | Evidence log holding fixture addresses | **Redaction approved** - "edit an evidence log approved" |
| 7 | What ACTIVATE showed | **No text at all, completely blank, and it did not move to the next screen** |

### What ruling 7 settles - with the code that settles it

`state.rs:251-268`: `activate()` asks the server **first**. `ActivationOutcome::Refused`
takes `Launch::Refused`, and `render()` (`commands.rs:73-74`) gives that branch
`Some(failure.as_str())` - **a verdict on screen**. `Launch::LocalFault` maps to
`("localFault", false, None)` (`commands.rs:72`), and `ActivationDecision::declined()`
is likewise `message: None` (`commands.rs:56`), both rendering through
`ActivationGate` as `message={null}`.

A completely blank screen therefore **rules out any server verdict** - it was
eliminated by reading the branch, not by assuming the server's state. What remains is
the local-fault path, of which two candidates render identically:

- `ENTITLEMENT_EXPORT_FAILED` - `state.rs:389`, `commit()` calls `entitlement::export(home, ...)`
  first, and `home` resolves to a folder this user cannot write (measured, `0x80131501`).
  **Leading candidate, backed by measured disk evidence.**
- `FINGERPRINT_UNAVAILABLE` - `commands.rs:165`, raised when `activation_request()`
  cannot be formed. **Cannot be excluded from the screen alone.**

Both are addressed by Option C. No claim is made that one has been proven over the
other; the screen cannot separate them and has not been said to.

### Executed under ruling 6, same day

`docs/evidence/gate-run-20261016-111425.log` - three distinct fixture addresses,
8 occurrences, replaced with the literal token `[FIXTURE-EMAIL]`. Characters
89117 -> 89104, a delta of exactly -13. All 13 gate rows unchanged (11 PASS, 2 FAIL),
no BOM, strict UTF-8. None of the four denylisted values was present in that file.

### Still open after this amendment

**The H2 scope ruling** - extend `$SprintCommits`, or scope
`apps/web/public/build-manifest.json` out of journey scope as release metadata. It was
not among the items ruled above. The gate stands at **11 PASS / 2 FAIL** and both
failing rows are this one cause; no gate logic, flag, grep or `$SprintCommits` entry
has been altered (H7).

---

## Amendment - CE-5, Chief Engineer, 16 Oct 2026 (afternoon)

The five rulings below close the item left open immediately above. They were issued
together, before a break, and are recorded here because
`scripts/verify-standing-holds.ps1` accepts a sanctioned file only when its ruling ID
appears literally in this ledger.

| # | Ruling | Recorded as |
|---|---|---|
| 1 | `apps/web/public/build-manifest.json` is classified as **Release Metadata** and exempt from the M1 Customer Journey freeze. *"Update the gate parameters accordingly and run the gate to 13/0."* | CE-5 |
| 2 | **Option B approved**: add `SANITIZE_EXECUTE=true` to `services/api/wrangler.jsonc`, and add the file to the sanctioned M1 list so the setting survives deploys | CE-5 |
| 3 | Excluded documents: **"Read first"** - summarise both in plain English, then await the final decision on push vs keep-local | CE-5 |
| 4 | Gate window: *"The phone is plugged in, authorized, and the machine is free of heavy jobs. Go."* | CE-5 |
| 5 | Phase 1: proceed once the gate is 13/0, with **Deploy mobile API preview immediately after the publish** | CE-5 |

### What changed in the gate, and what did not

The exemption removes **one path, not a check**. The filter runs before the count, so a
commit that touches `build-manifest.json` **and** any other journey file still enters
`$journeyInRange` and still has to be listed in `$SprintCommits`. The exemption is
printed on every run as `release-metadata exemption (CE-5)` - the gate states what it
is not looking at rather than staying quiet about it.

**H7 is untouched.** No `continue-on-error`, no relaxed grep, no skip flag, no
`$SprintCommits` entry added. `services/api/wrangler.jsonc` is sanctioned through the
documented procedure the gate itself enforces - exact path, ruling ID present in this
ledger - and it prints as `SANCTIONED [CE-5]` on every run.

### Why the exemption was sufficient on its own

`15bc902` and `eb6afed` each touched **exactly one** M1 file: the manifest. Verified
with `git show --name-only --format='' <sha> -- apps/web services/api` before the
edit was made, so the ruling was applied to measured facts rather than to a guess.

### The two-deploy trap (P6), restated as part of ruling 5

`.github/workflows/release-windows-installer.yml:51-57` documents it:
`services/api/src/entitlement.ts` imports the manifest at **build time**, so the Pages
site picks the new file up on the push to main, but **the API Worker keeps serving the
manifest it bundled until it is rebuilt.** The deploy that follows a publish is
therefore mandatory, not advisory - dispatch #16 on 15-Oct ran 1h18m *before* the
publish and the dashboard read the previous release as a result.

### Status of the two previously failing rows

Both rows were the same cause: the two publish commits above. With ruling 1 applied
they leave the scope check on measurement, not by being added to the list. The gate has
to be re-run to report the new standing; **nothing here claims 13/0 before it is
measured.**