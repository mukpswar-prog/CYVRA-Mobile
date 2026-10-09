# CORE ENGINE — CAPABILITY MATRIX RUNTIME

| Field | Value |
|---|---|
| Status | `DESIGN-DOC` — architecture only; **no product code in this task** |
| Authority | `docs/CYVRA_CORE_ENGINE_JOURNEY_FINAL_V2_2026-10-08.txt` §2 (planes), §5.1 (core engine), §5.3 (reproducibility) — Level 1 |
| Related | `docs/CYVRA_CAPABILITY_MATRIX_V1.md` (the data), Spec §21–§24, §82, §84, `docs/CORE_ENGINE_TRANSPORT_ABSTRACTION.md`, `docs/CORE_ENGINE_SIGNED_PATCH_VERIFIER.md` |
| Date | 09-Oct-2026 — TASK R (CORE-ENG-1) |
| Kind | Documentation. No parser, no dispatcher, no report path changed. |
| Mandate | M1–M4 in force; customer journey FROZEN; DOCS ONLY. |

---

## 1. Purpose and non-goals

**Purpose.** Define how the customer-side core engine consumes the capability matrix as
*data*, turns it into a resolved capability for a live device, dispatches the correct
read-only probe for each of the 22 diagnostic domains, and records what it could not see
without ever inventing an answer.

**Non-goals.** This document does not: implement the parser or dispatcher; alter the
matrix content; add a domain; change the read-only probe allowlist; or make any domain
produce a `PASS` it did not observe. The matrix is a **seed** (its own header says
*DRAFT, not ratified*) — the runtime must behave correctly while it is still a seed.

**Governing instinct.** The matrix tells the engine *what may be possible*. The device
tells it *what actually happened*. When they disagree, the observation wins and the
disagreement is recorded. This is Spec §82 (*no false automation*) expressed as a runtime
rule.

## 2. What the engine loads, and when

### 2.1 Load point

On engine start, **before** any transport is opened, the engine loads
`docs/CYVRA_CAPABILITY_MATRIX_V1.md`. Loading is a parse of a Markdown document with a
fixed column contract — Section 4 of that document (22 rows, 8 columns) is the only
machine-relevant region; Sections 1–3 and 5–7 are provenance and are read for the audit
trail, not for decisions.

Loading happens once per engine start. It does **not** re-read per device, because the
matrix describes *capability classes*, not individual devices.

### 2.2 Parse, validate, refuse

| Step | Requirement |
|---|---|
| Encoding | Strict UTF-8, no BOM (matches the §6 gate: UTF-8 clean). |
| Row shape | Exactly 22 data rows, each with the §84 column set: `# · Domain · ITEM ID · Capability · Plane / source · Evidence type · Result · Evidence reference`. |
| Domain set | Must equal the 22 domains of Spec §21, by name and order. Any missing, extra or renamed domain → **refuse to load**. |
| Capability enum | Every `Capability` cell must resolve to one of `YES / PARTIAL / CONDITIONAL / ASSISTED / NO` (Spec §22). A `PASS`/`FAIL` found in that column is a **contract violation** → refuse to load. |
| Result enum | Every `Result` cell must resolve to the Spec §23 vocabulary. |
| Item ID provenance | `[S]` = ratified by Spec §84/§85. `[P]` = provisional. Provisional IDs load, but they are marked `provisional: true` and can never be *required* by a patch (`PATCH_ROW_UNKNOWN` semantics, patch schema §6.8). |
| Provenance | The document's own `Status`, `Branch` and `Captured` header values are copied into engine state so every report can say which matrix revision produced it. |

**Refusal is honest, not fatal to the host.** A matrix that fails validation puts the
engine in `MATRIX-UNUSABLE` mode: no probe that depends on a matrix row is dispatched,
every domain is recorded as `NOT AVAILABLE`, and the report says why. The engine does
not fall back to "assume everything is YES", and does not fall back to a cached copy
without saying so.

### 2.3 Matrix is data, not authority over safety

Loading the matrix never enables a capability that a consent gate forbids. The matrix can
say `YES`; if the plane's consent gate is closed, the resolved capability is still not
available. See §3.

## 3. Capability resolution

```
capability = f(plane, authorization, Android version, OEM)
```

This is the governed formula (journey §2, closing line). Each argument is evaluated
independently, then combined.

### 3.1 `plane`

Which transport could carry the observation. Evaluated by the transport abstraction —
see `CORE_ENGINE_TRANSPORT_ABSTRACTION.md`. Each plane reports `AVAILABLE | UNAVAILABLE`
plus the reason. A plane is `AVAILABLE` only if the transport is actually open and the
target is in state `device` **and** the health scan found no degraded services (the
probe harness `target_usable` rule).

### 3.2 `authorization`

The consent gate for that plane, per governed §2:

| Plane | Gate | Satisfied by |
|---|---|---|
| P1 USB/PnP | `none` | Physical connection only. |
| P2 WPD/MTP | `unlocked` | Device screen unlocked and MTP exposed. Locked ⇒ empty, by definition of the plane. |
| P3 ADB | `debugging` | USB debugging on **and** the host key accepted (`device`, not `unauthorized`). |
| P4 Companion | `install` | Companion APK installed **and** runtime permissions granted. |

Authorization is **observed**, never assumed, and never *granted by a patch* (patch
schema §6.9). An authorization state that cannot be read resolves to `UNKNOWN`, which
behaves as *closed*.

### 3.3 `Android version`

The live `ro.build.version.sdk` API level, compared against the row's or the signed
patch's `oem_scope.android_min`/`android_max`. Outside the range ⇒ **NOT APPLICABLE**
(Spec §23) — not a failure, and not silently clamped to the nearest in-range value.

### 3.4 `OEM`

`manufacturer`, `model`, `ro.build.fingerprint` skin, and `ro.kernel.qemu`
(emulator-vs-physical) matched against the row's scope. No match ⇒ NOT APPLICABLE and
recorded as such.

### 3.5 Composition table

The four inputs are combined with **the most restrictive answer winning**:

| plane | authorization | version/OEM | → resolved capability |
|---|---|---|---|
| UNAVAILABLE | any | any | `NO` for that plane (reason: plane reason) |
| AVAILABLE | closed | any | `NO` (reason: gate) — the matrix's `YES` does **not** override this |
| AVAILABLE | open | NOT APPLICABLE | recorded `NOT APPLICABLE`; row exerts no effect |
| AVAILABLE | open | applicable | matrix row's own state: `YES / PARTIAL / CONDITIONAL / ASSISTED / NO` |

Because a domain may be reachable on several planes, the domain-level result is the
**best available plane**, with each plane's outcome retained. P1 can report a connection
`YES` while P3 reports `NO` (debugging off) — that is the State 3 observation, and both
facts belong in the report.

**The resolved value is never `PASS` or `FAIL`.** Capability (§22) and result (§23) are
distinct axes: capability answers *could this ever be observed*, result answers *what
did this run show*.

## 4. Probe dispatch per domain

### 4.1 Domain → plane → command

Dispatch is driven by the matrix row's `Plane / source` and `Evidence type` cells. The
engine holds a table of 22 entries; each entry names the plane, the read-only command
allowlist for that domain, and the fallback behaviour when the plane is closed.

Representative entries (the full table is seeded from the matrix's Section 4):

| Domain | Primary plane | Allowlisted observation | If plane closed |
|---|---|---|---|
| Connection | P1 + P3 | `adb devices -l`, PnP enumeration | `NOT AVAILABLE` |
| Identity | P3 | `getprop` **allowlist only** (16 keys) | `NOT AVAILABLE` |
| Storage | P3 | `df`, `diskstats`, CID sysfs read | `NOT AVAILABLE` |
| Battery | P3 | `dumpsys battery` | `NOT AVAILABLE` |
| Display | P3 | `dumpsys display`, `wm size/density` | `NOT AVAILABLE` |
| Sensors | P3 | `dumpsys sensorservice` | `NOT AVAILABLE` |
| Wi-Fi | P3 | `dumpsys wifi` (size-capped) | `NOT AVAILABLE` |
| Applications | P3 | `pm list packages` | `NOT AVAILABLE` |
| Camera / Audio / Haptics / GNSS | P4 | companion sensors (consent-gated) | `NOT TESTED` |
| Touch | P3 `input stimulus` / P4 grid | not dispatched under read-only mandate | `NOT TESTED` |
| Mechanical | physical | never dispatched by software | `PHYSICAL VERIFICATION REQUIRED` |
| Sanitization | P3 + P4 | **no purge probe** without §6.2 attestation | `NOT TESTED` |

### 4.2 Three dispatch classes

Every domain is classified exactly once:

1. **Evidence-backed** — the matrix has a fixture reference for this domain on an
   available plane. Dispatch the allowlisted read-only command. Record the observation
   with its provenance id.
2. **NOT TESTED** — the capability exists on a plane that is closed, or the observation
   requires a write/stimulus/install that the current mandate forbids. **Do not
   dispatch.** Record `NOT TESTED`. Never `FAIL` (Spec §82).
3. **RESTRICTED** — the observation is expressly blocked by a governed rule
   (`/data/data`, IMEI on A10+, non-interactive reset, CID). **Do not attempt**, do not
   retry, do not "try a different path". Record the §24 status token and the governing
   clause.

Mechanical is a fourth, degenerate class: it is never dispatched because software
cannot determine it — `PHYSICAL VERIFICATION REQUIRED`, exactly as Spec §82 requires.

### 4.3 Dispatch safety rules

- **Read-only allowlist is closed.** The engine may only issue commands present in its
  compiled allowlist. No command that installs, inputs, captures the screen, reboots or
  purges may be dispatched outside an explicitly attested procedure.
- **Health scan before trust.** Target state `device` is necessary but not sufficient.
  Post-capture scanning for `DEAD_OBJECT`, `DUMP TIMEOUT`, `Can't find service`,
  `Failure calling service`, `Broken pipe` sets `target_usable = false` and records
  `degraded_services`. A degraded capture is **not** evidence — it is recorded as
  `NOT AVAILABLE` with the degraded list, and is never promoted over a good one.
- **Staging then promote.** A capture is written to a staging location and only
  promoted to the fixture of record if it validates. A bad run can never overwrite a
  good fixture. (This rule exists because it already caught a 12,278-byte corrupted
  capture being overwritten by a 70,879-byte good one.)
- **Size bounds.** A command whose output exceeds its per-domain cap is truncated
  *with the truncation recorded*, never silently and never by discarding the command
  entirely. See §6.2.

## 5. Recording restricted states (Spec §24)

### 5.1 The rule

Never fabricate. When a value is unavailable, the engine writes the **status token** for
that field, so the fact that it was sought and withheld remains visible:

`NOT EXPOSED` · `RESTRICTED` · `NOT AVAILABLE` · `NOT COLLECTED` · `CONDITIONAL`

### 5.2 Distinction the engine must preserve

| Token | Meaning | Example |
|---|---|---|
| `NOT EXPOSED` | The platform does not surface it at this API level / permission. | IMEI via software on Android 10+. |
| `RESTRICTED` | A governed rule forbids collecting it. | `/data/data` contents; non-interactive reset. |
| `NOT AVAILABLE` | Sought, and the source was absent or denied. | storage CID: `Permission denied`. |
| `NOT COLLECTED` | Not sought at all this run, by policy or mandate. | device serial in an egressed artefact. |
| `CONDITIONAL` | Available only under stated conditions. | IMEI via operator photo evidence. |

**An absent field and an uncollected field are different**, and the runtime keeps them
different — this is the same distinction the telemetry envelope makes with
`dropped_sections[]`.

### 5.3 Composition into results

- Restricted ≠ fail. A `RESTRICTED` domain carries Spec §23 result `RESTRICTED`.
- Restricted ≠ pass. It may never be reported as `PASS`.
- Restricted on one plane does not condemn the domain: State 2 showed Wi-Fi and Sensors
  `PARTIAL` while Applications and Storage stayed `YES` — restriction is recorded
  **per domain**, never as a blanket device verdict.
- The report's language follows Spec §29: it must not claim more than the evidence
  proves. No NAND claim, no purge claim, and no absolute-assurance phrasing of the
  kind Spec §83 excludes from report language.

## 6. OEM quirk handling

Quirks are **observed behaviour**, not defects to be papered over. They are keyed by
`oem_scope` and applied only as `procedure_overrides[]` arriving on a **signed** patch —
the engine never special-cases an OEM in a way a patch did not authorise, and a patch
can never invent a new action verb (patch schema §5).

### 6.1 Samsung lock re-enumeration (observed, SM-A107F / API 30)

Locking the screen causes the USB/ADB interface to re-enumerate: `transport_id` changes
and a command in flight returns `device '<serial>' not found` while the target state
reads `NOT_LISTED`.

**Handling.** Distinguish *transition* from *end state*:
1. Re-read the target after a settle window (one re-enumeration is expected).
2. Read the lock state directly (`mScreenLocked`, `isKeyguardShowing`) rather than
   inferring it from ADB availability.
3. Only if the state is stable and still `NOT_LISTED` is the run recorded as a genuine
   blocked state. Otherwise the run is a **transition artifact**: recorded as such,
   superseded, and never presented as the locked-state evidence.

A transient USB loss must never be reported as "debugging off", and a locked device must
never be reported as "not present".

### 6.2 Wi-Fi dump size bound (observed: 1.62 MB physical vs 7.8 KB emulator)

`dumpsys wifi` on a Samsung returns ~207× the emulator volume, carrying full scan
history and hundreds of BSSID entries.

**Handling.** A per-domain byte cap with three outcomes, all recorded: `ok`,
`truncated(offset, cap)`, or `skipped(size_over_hard_limit)`. Truncation preserves the
provenance and the original byte count. Because scan history is MAC-class location data,
truncation also serves privacy: the engine never retains more scan history than the
observation needs.

### 6.3 Storage CID permission denied (observed: `Permission denied` on Samsung, `No such file` on emulator)

The two failures are *different facts* and are recorded differently: a denial means the
node exists and is protected (`NOT AVAILABLE`, denied); a missing node means the path
differs on that platform (probe alternate paths, then `NOT AVAILABLE`, not found). Both
resolve to Spec §23 `NOT AVAILABLE`; neither becomes `FAIL`.

### 6.4 Adding a quirk

A new OEM quirk enters the engine only through: observed fixture evidence → an entry in
`evidence_refs[]` → a signed capability patch with `oem_scope` → Chief Engineer approval
(governed §5.5). Hard-coded OEM exceptions in engine binaries are prohibited.

## 7. Output contract

For every run the resolver emits, per domain: `domain`, `item_id`, `capability`
(§22), `result` (§23), `plane`, `authorization_state`, `evidence_ref`, `status_token`
(§24, when withheld), `confidence` (`FIXTURE` / `OBSERVATION`, Spec §86), and
`degraded_services`. The report additionally carries `engine_version`,
`patch_set_version`, `patch_set_hash`, `applied_patches[]`, `patch_set_mode` — see
`CORE_ENGINE_SIGNED_PATCH_VERIFIER.md` §4.

## 8. Invariants

1. A `Capability` cell is never `PASS`/`FAIL`; a `Result` is never inferred from a
   capability state.
2. `not observable` never becomes `pass`; `not tested` never becomes `fail` (§82).
3. Withheld values carry a §24 token, never a fabricated value and never a blank.
4. A matrix row cannot open a consent gate.
5. An observation overrides the matrix; the disagreement is recorded.
6. A degraded capture is not evidence.
7. Provisional `[P]` item IDs are never a conformance requirement.

## 9. Open items

1. Parser implementation and its failure tests — later phase.
2. 15 of 22 `ITEM ID`s are `[P]` pending the engineering Master Diagnostic Capability
   Matrix (matrix doc NOTE N-1). `matrix_rows[]` vocabulary in the patch schema depends
   on this.
3. Per-domain size caps — proposed, not yet approved values.
4. Emulator fixture corpus for API 26/30/33 (governed §9) is still absent, so version
   matching is validated against one emulator and one physical target only.

---

*Documentation only. No product code, matrix row, probe allowlist or report path was
changed by this file.*
