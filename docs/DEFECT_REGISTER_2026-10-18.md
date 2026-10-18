# Defect Register — 18 October 2026

**Author:** Engineering assistant
**Prepared for:** Chief Engineer (CE)
**Purpose:** Complete record of every problem found during the hands-on session of
18 October 2026, so that each one can be reviewed and approved individually before
any code is changed.
**Status:** Register only. No fix has been applied to anything in this document
except where explicitly stated under **B1**.

---

## 1. How these were found

Everything below was established by running the shipped 1.1.0 installer on the
engineer's own workstation, driving the product screen by screen against a
connected bench device, and then reading the exact source lines responsible for
each observation.

Three kinds of evidence are used, and they are distinguished throughout:

- **Measured** — observed directly on disk, in the running application, or by a
  controlled test. Highest confidence.
- **Read** — taken from a specific file and line of the shipped source.
- **Inferred** — concluded from the two above but not itself directly observed.

Where a finding rests on inference, it says so.

---

## 2. The root problem found and proven — resolution of a month-old blocker

### What was wrong

The application kept its licence, its entitlement and its audit trail inside the
folder that also holds its own tools:

```
C:\Program Files\CYVRA Mobile\resources\
    ├── adb.exe, Java runtime, host JARs     (tools)
    ├── entitlement.json                     (licence)
    └── logs\ledger.jsonl                    (audit trail)
```

Windows protects `C:\Program Files` so that ordinary programs cannot write to it.
The result was that every attempt to save the licence after a successful
activation was refused by the operating system.

### What happened on screen when it was refused

The full path from button press to blank screen, each step read from source:

| Step | Location | Behaviour |
|---|---|---|
| 1 | `ActivationScreen.tsx:67-73` | The operator submits the form |
| 2 | `ActivationGate.tsx:106-118` | The gate calls the `activation_submit` command |
| 3 | `commands.rs:139-172` | Rust builds the request and calls the state machine |
| 4 | `state.rs:241-269` | The server answers; on success `commit()` runs |
| 5 | `state.rs:389-391` | `entitlement::export()` is called before anything is stored |
| 6 | **`entitlement.rs:319`** | **`std::fs::write()` — this call is refused by Windows** |
| 7 | `state.rs:390` | The failure returns `ENTITLEMENT_EXPORT_FAILED` |
| 8 | `commands.rs:72` | `LocalFault` maps to `message: None` |
| 9 | `ActivationGate.tsx:104` | `state !== "enter"`, so the application does not open |

The operator therefore saw a screen with no text that did not move.

### Why the cause could not be seen for a month

The code states that the cause is never displayed:

- `commands.rs:30-31` — *"Internal causes … reach the audit trail and this
  module's log line, and never the `message` field."*
- `state.rs:449-451` — *"the screen never names a cause, it only stays on the
  activation view."*

All three possible destinations for that cause were closed at the same time:

| Destination | Why it was closed |
|---|---|
| Audit trail `logs/ledger.jsonl` | `state.rs:168-170` creates the directory inside the same locked folder, so the write failed |
| Log line | `lib.rs:61` installs the log plugin only `if cfg!(debug_assertions)` — absent from release builds |
| The screen | `message: None` by design |

### How it was proven — controlled experiment

One variable was changed. Nothing else.

**Before:** `entitlement.json` absent, `logs` absent, ACTIVATE did not move.

A write permission for ordinary users was granted on that single folder. The same
executable, the same server, the same licence key and the same machine were used.

**After:** the application entered the workspace, and on disk appeared
`entitlement.json` (744 bytes), `activation-audit.jsonl` (121 bytes) and
`ledger.jsonl` (267 bytes).

Every alternative explanation was separately excluded by measurement:

| Alternative | Excluded by |
|---|---|
| Server refusal | A refusal renders text on screen; none appeared |
| `FINGERPRINT_UNAVAILABLE` | All three fingerprint components read successfully: `MachineGuid` (36 characters), SMBIOS UUID `01A4CFB4-41E5-11E8-9379-8C1645693971`, volume serial `C8382029` |
| Empty home | `C:\Program Files\CYVRA Mobile` exists |
| Store read failure | `activation.dat` absent, so `store::read` returns `Ok(None)`, not an error |
| Export failure | Home measured unwritable; `entitlement.json` never existed before the permission was granted |

**Conclusion, established by controlled experiment rather than inference:**
the blocker was that `<cyvra.home>` resolved to a folder the application was not
permitted to write to.

**Honest limit:** the literal string `ENTITLEMENT_EXPORT_FAILED` was never
observed, because the file that would have recorded it was itself unwritable.
Elimination stands in its place. After the fix the audit file becomes writable,
so any future fault will be permanently visible.

### Fix already written — awaiting gates

**Option C: state is separated from binaries.** Nine files changed, all staged
and none committed:

- New `apps/host/src/main/kotlin/cyvra/mobile/host/config/HostSystemProperties.kt`
  declares `cyvra.home` (writable state) and `cyvra.install` (read-only tools).
- `AdbBinaryLocator` now reads `cyvra.install`; its old companion constant was
  removed deliberately so the compiler would surface every stale reference.
- `SignedEntitlementProvider`, `FileBasedLicenseProvider` and `HostReportStore`
  now read `cyvra.home`.
- `host_process.rs` resolves `<cyvra.home>` to `%ProgramData%\CYVRA Mobile`,
  creates it, and passes both `-D` arguments to the host.
- `installer-hooks.nsh` creates that directory and grants `BUILTIN\Users` modify
  permission on it, deliberately not on `$INSTDIR`.

After the fix the layout is:

| Purpose | Location | Permission |
|---|---|---|
| Licence, entitlement, audit, reports | `C:\ProgramData\CYVRA Mobile` | Writable by ordinary users |
| adb, Java runtime, host JARs | `C:\Program Files\CYVRA Mobile\resources` | Read-only |

`tauri.conf.json` required no change; its `installerHooks` entry was already
wired.

---

## 3. New defects — found this session, not covered by any existing plan

### A1 · The operator control that unblocks the final step is not on that step, and is mislabelled — **HIGH**

**Measured.** The field is declared inside a conditional on a different screen:

```
App.tsx:1908   {activeStep === "scan" && (
App.tsx:1929     <label className="field">
App.tsx:1930       <span>Operator ID (optional)</span>
```

The button that requires it is on Step 6:

```
App.tsx:2459   disabled={!scanOk || busy !== null || operatorId.trim() === ""}
App.tsx:2461     ? "Name the operator authorising this report before it can be sealed."
```

While Step 6 is active, the Step 2 branch is not rendered, so the field does not
exist on screen. The engineer could not find it, correctly.

**Second, separate fault in the same control.** The label reads *"(optional)"*
and the help text reads *"Omitted from the payload when blank - the Host applies
its default."* That is true for scanning — the generated report confirms it, show
ing `Operator ID: unspecified-operator`. It is false for sealing, where a non-empty
value is mandatory.

**Proposed fix.** Move or duplicate the control onto Step 6 beside the seal
button, and label each role truthfully — for example "Operator ID — required to
seal this report". Keep the Step 2 copy only if scanning still wants it.

---

### A2 · Reports do not meet the required format, destination, naming or scope — **HIGH**

**Measured.**

| Required | Current state | Evidence |
|---|---|---|
| PDF or plain text | JSON and Markdown only | `HostReportStore.kt:160-164` |
| Any PDF capability at all | None in the workspace | `apps/desktop/package.json` lists only `@tauri-apps/api`, `react`, `react-dom` |
| Saved to C: where it can be found | Under `C:\Program Files\CYVRA Mobile\resources\reports\<id>\` | `HostReportStore.kt:104` |
| Readable filenames | `report.json`, `report.md`, `manifest.json` | `HostReportStore.kt:160-162` |
| Three separate reports | One combined export | Single `EXPORT_REPORT` command |
| Present in Downloads | Zero CYVRA files found there | Direct directory listing |

**Proposed fix.**

1. Render **plain text** alongside the existing Markdown. This needs no new
   dependency. PDF is possible but requires introducing a library into a build we
   have not yet proved, and should be its own later task.
2. Split into three deliverables:
   - **SCAN** — device and hardware identification
   - **APPLICATIONS** — inventory, classification, evidence and reconciliation
   - **SANITIZE** — purge outcome and decision
3. Write to a fixed, findable folder such as `C:\CYVRA Reports\`.
4. Name files readably, for example
   `CYVRA-Scan-Report-SM_A107F-2026-10-18.txt`. **The device serial must not
   appear in a filename** — the bench serial is denylisted.
5. Keep the SHA-256 manifest covering all three files.

---

### A3 · The Help panel states the wrong number of steps — **MEDIUM**

**Read.** `App.tsx:2509`:

> *"Work through the five steps above in order."*

The workflow declares six: `STEPS` contains six entries (`App.tsx:153, 164, 175,
186, 196, 209`) and six render branches exist (`App.tsx:1860, 1908, 1995, 2121,
2309, 2406`). The screen itself shows six numbered cards.

**Proposed fix.** Correct the number.

---

### A4 · The Help panel states an unlocking rule the application does not enforce — **MEDIUM-HIGH**

**Read and measured.** `App.tsx:2509` also says:

> *"A step unlocks only when the one before it has finished."*

and `App.tsx:2519` says:

> *"If a button will not run, hover it to see why. The reason on the button is
> the same rule the workstation is enforcing."*

The actual gate table is:

```
App.tsx:1176
    connect:     null,
    scan:        hostConnected ? null : "The Host is not connected yet.",
    inventory:   scanOk ? null : "Complete a scan first.",
    sanitize:    scanOk ? null : "Complete a scan first.",
    checklist:   null,        // never locked — its own comment says so at :1181
    export:      scanOk ? null : "Complete a scan first.",
```

Consequently:

- Step 5 never requires step 4 to finish.
- Step 6 unlocks on a completed scan alone, regardless of steps 3, 4 or 5.
- Step 4 does not require step 3.

**Observed in use:** step 4 reported `BLOCKED`, and steps 5 and 6 both reported
`COMPLETED`.

The behaviour may well be deliberate — a blocked purge should not halt the whole
workflow. The defect is that the **Help text describes a rule the workstation does
not apply**, while simultaneously asserting that the two are identical.

**Proposed fix.** Decide which is correct. If sequential unlocking is intended,
enforce it in `stepLock`. If it is not, rewrite both sentences so the Help
describes what the product actually does.

---

### A5 · Release builds install no logging at all — **MEDIUM**

**Read.** `lib.rs:61`:

```rust
if cfg!(debug_assertions) {
    app.handle().plugin(tauri_plugin_log::Builder::default()...)
}
```

Every `log::warn!` in `commands.rs` — an unresolvable home, a decision that could
not be computed, an audit line that failed to write — is therefore silent in a
shipped build.

Option C restores the audit-file destination, which is a substantial improvement.
This sink remains closed.

**Proposed fix.** Decide whether release builds should log, and to where. If yes,
install the plugin unconditionally with a fixed destination under the state root.
If no, state that decision explicitly so the silence is a choice rather than an
oversight.

---

### A6 · `apps/desktop` has no `typecheck` script, unlike every other package — **MEDIUM**

**Measured.**

| Package | `typecheck` script |
|---|---|
| `cyvra-mobile` (root) | Yes |
| `@cyvra/web` | Yes |
| `@cyvra/database` | Yes |
| `@cyvra/evidence` | Yes |
| `@cyvra/api` | Yes |
| **`@cyvra/desktop`** | **No** |

**Important qualification:** continuous integration does type-check the desktop
application, because `windows-engineering-build.yml:105-107` runs `pnpm run build`,
and that task begins with `tsc -b`. So the pipeline is not blind.

The cost is recorded in the repository's own comment, `App.tsx:1149-1151`:

> *"which is what kept this line a type error while every gate reported green:
> desktop has no `typecheck` task, so `pnpm -r typecheck` skipped it entirely."*

Any root-level `pnpm -r typecheck` therefore reports success while omitting the
largest application in the workspace.

**Proposed fix.** Add a `typecheck` script to `apps/desktop/package.json` so the
task covers every package uniformly.

---

### A7 · Reports accumulate without an index — **MEDIUM**

**Measured.** Two artefact directories now exist — `CYVRA-R1-2026-5E132A` and
`CYVRA-R1-2026-A5B26F` — with opaque identifiers, no index, no timestamp in the
name and nothing on disk telling the operator which is which.

**Proposed fix.** Folded into A2: readable filenames, a single destination folder,
and a manifest that indexes what is present.

---

### A8 · The generated report prints a placeholder operator name — **LOW-MEDIUM**

**Measured.** `report.md` line 4 reads:

```
- **Operator ID:** unspecified-operator
```

This is the Host's default when the field is left blank, and it appears in a
document intended for hand-over.

**Proposed fix.** Folded into A1 and A2: require the name at the point of sealing
and render it in all three reports.

---

### A9 · The report states `Coverage Level: PARTIAL` while the interface reports completion — **DECISION REQUIRED**

**Measured.** `report.md` records `Coverage Level: PARTIAL`, while the interface
shows the corresponding step as `COMPLETED` and `Ok`.

This may be entirely correct — partial coverage may be the expected answer for
this device. It cannot be settled from the source alone.

**Action:** Chief Engineer to confirm whether `PARTIAL` is correct. If it is, the
interface should surface it. If it is not, the coverage calculation is at fault.

---

### A10 · The purge capability cannot be exercised in the state it ships in — **REGISTERED, NOT A DEFECT TO PATCH**

**Measured and read.**

- The bundled `sanitization-agent-unsigned.apk` carries **no signature of either
  kind**: no v1 signing entries in `META-INF`, and no `APK Sig Block 42` block
  near the end of the file. Android refuses to install an unsigned package, so it
  cannot be installed as it stands.
- The product contains **no installation code**. The only agent-related functions
  are reads: `pm list packages com.cyvra.sanitization` and `dumpsys device_policy`
  (`HostDestructiveWipeProvider.kt:194-195`).
- Governance rules this state deliberately: `CYVRA_GOVERNANCE_LEDGER.md:51` records
  *"no keystore is generated, no key is used, no APK is signed"*, `:542` records
  that the agent *"remain[s] intentionally unsigned (H4)"*, and the standing item
  R-I records *"no keystore may be generated"* until key custody is ruled.
- A standing gate asserts this state and passes: `[OK] H4 Staged agent APK is
  unsigned`.

**The product reports the condition truthfully** — `BLOCKED_NOT_ELIGIBLE`,
`successClaimed: false`, `verificationStatus: REQUIRES_EXTERNAL_VERIFICATION`,
and the Help panel states that the purge is blocked on purpose. The product
therefore does not present a capability it does not have.

**Registered because** the capability appears on the product surface while being
unreachable until two things happen: a ruling on H4 / R-I key custody, and WP-4
physical-device validation.

**Action:** no code change. Recorded so the position is visible in one place.

---

### A11 · The device table advertises a value the product deliberately never collects — **LOW**

**Measured.** The column is headed `IMEI NO` and always reads `Not reported`.

Not reading the IMEI is consistent with the product's stated rule that nothing
personal is copied from the phone, and the panel is honest about the value being
unread. The concern is the header, which implies a collection the product does not
perform.

**Proposed fix:** either remove the column, or rename it to what it actually
reports.

---

## 4. Items already covered by the existing plan

| ID | Item | Position |
|---|---|---|
| **B1** | ACTIVATE screen blocked because `<cyvra.home>` was unwritable | Ruled 16 October, item 7. Fix written as Option C, staged as nine files. Proven by controlled experiment on 18 October. Remaining: three gates, build, install. |
| **B2** | Reports written inside Program Files | Already addressed by Option C — `HostReportStore` now reads the state root, so reports move to `C:\ProgramData\CYVRA Mobile\reports`. **This does not by itself satisfy A2**, which additionally requires plain text or PDF, readable names, a findable destination and three separate documents. |
| **B3** | Fault causes undiagnosable | Half addressed by Option C: the audit file becomes writable. **A5 remains open.** |

---

## 5. Standing backlog — carried forward unchanged

- `hostVersion=0.0.0` at `apps/host/build.gradle.kts:8`
- Duplicate-key warning in `licenceTable.test.tsx`
- Help text at `scripts/verify-stage-gates.ps1:218`
- H3 wording at `apps/web/src/site/CustomerWorkspaceShell.tsx:742`
- `retention-days` on the upload step

---

## 6. Proposed execution order

Each step below is to be approved individually before it is started. One change
per step, so that any later problem can be attributed to a known cause.

| Step | Work | Reason it sits here |
|---|---|---|
| **0** | Run `:host:test`, `cargo test`, `cargo build`; then `pnpm run build`, `stage:resources`, `tauri build`; then install and confirm `C:\ProgramData\CYVRA Mobile` is created and used | Option C is written and proven. It must land first so every subsequent change sits on a known-good baseline. |
| **1** | **A1** operator control placement and label · **A3** "five" to "six" · **A4** Help unlock wording | All three are confined to `App.tsx`, need no backend change, and remove the blockage the engineer hit today. |
| **2** | **A2 + A7 + A8** plain-text output, three separate reports, readable filenames, a findable destination folder, an index | The principal unmet requirement. Sufficient scope to warrant its own change. |
| **3** | **A5** logging behaviour in release builds | Makes every subsequent fault visible rather than silent. |
| **4** | **A6** add a `typecheck` script to `apps/desktop` | Small, and closes the false-green. |
| **5** | **A9, A10, A11** | Each requires a decision first, not code. |

**Deliberately sequenced after step 0** so that the report work is never mixed
into the same build as the activation fix.

---

## 7. Decisions required from the Chief Engineer

1. **A9** — is `Coverage Level: PARTIAL` correct for this device?
2. **A4** — should steps unlock strictly in sequence, or should the Help text be
   rewritten to describe the current behaviour?
3. **A5** — should release builds log, and to where?
4. **A2** — plain text first with PDF later, or PDF now? Fixed destination folder
   or a save dialog?
5. **Uninstall behaviour** — after Option C, uninstalling leaves
   `C:\ProgramData\CYVRA Mobile` behind, so a reinstall keeps the licence instead
   of clearing it. Retain, or remove?
6. **Migration** — no migration is needed, because the previous location held no
   `entitlement.json`. This needs formal acceptance.
7. Standing items still open: the public download URL against the private-host
   rule, the Resend key for `cyvoriq.co.in`, and agent re-enrolment.

---

## 8. Repository state at the time of writing

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD | `fa3420a` — release: publish 1.1.0 installer manifest (WS-I) |
| In sync with `origin/main` | Yes |
| Staged | 9 files, 215 insertions, 46 deletions — the Option C change only |
| Committed today | None |
| Pushed | Nothing |

**No code in section 3 has been written. Nothing has been committed or pushed.**
