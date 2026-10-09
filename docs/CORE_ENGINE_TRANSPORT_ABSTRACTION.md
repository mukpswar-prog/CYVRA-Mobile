# CORE ENGINE — TRANSPORT ABSTRACTION

| Field | Value |
|---|---|
| Status | `DESIGN-DOC` — architecture only; **no product code in this task** |
| Authority | `docs/CYVRA_CORE_ENGINE_JOURNEY_FINAL_V2_2026-10-08.txt` §2 (Android access planes, verified 08-Oct) — Level 1 |
| Related | `docs/ANDROID_COMPATIBILITY_FREEZE.md` (four independent evidence/transport planes), `docs/CORE_ENGINE_CAPABILITY_MATRIX_RUNTIME.md`, `docs/CYVRA_CAPABILITY_MATRIX_V1.md` §3, `scripts/android-probe/probe.ps1` |
| Date | 09-Oct-2026 — TASK R (CORE-ENG-1) |
| Kind | Documentation. No transport code, driver or probe changed. |
| Mandate | M1–M4 in force; customer journey FROZEN; DOCS ONLY. |

---

## 1. Purpose

Define a single interface over the four governed access planes so the engine can treat
*how it reaches a device* as a swappable concern, selected by the capability matrix and
the live authorisation state — rather than as four special cases bolted onto the
diagnostic logic.

The planes are **independent by design** (freeze document, *"Independent
evidence/transport planes"*):

> USB presence does not imply ADB; WPD/MTP visibility does not imply full filesystem
> access; ADB is optional advanced evidence.

The abstraction exists to make that independence structurally true instead of a
convention someone has to remember.

## 2. The four planes (governed §2, verbatim scope)

| Plane | Consent gate | Scope — what it may observe | What it must never do |
|---|---|---|---|
| **P1 USB/PnP** | `none` | VID/PID, USB serial string, mfg/product, connect state | Nothing internal. |
| **P2 WPD/MTP** | `unlocked` | Shared-storage volumes + file metadata; **locked = empty** | No identifiers, no props. |
| **P3 ADB** | `debugging` + key accept | `getprop`, `dumpsys` battery/display/sensors/wifi/diskstats, `pm list packages`, `df`, `wm size`, `screencap`, `input stimulus`, `reboot`/`recovery` | **No `/data/data`**; **no non-interactive reset**; **IMEI masked A10+**. |
| **P4 Companion APK** | `install` + runtime grants | Camera2 frames, sensors, audio loopback, touch grid, GNSS, Wi-Fi/BT scans | IMEI still restricted A10+; **no root**. |

Capability in every case is a function of *plane, authorization, Android version and OEM
skin* — never of the plane alone.

**P3 is the workhorse**: it carries the entire 10-command read-only probe battery that
produced all four fixture sets. P1 and P2 are cheap, always-on corroboration. P4 is the
only route to physical sensors that a `dumpsys` cannot honestly answer.

## 3. Transport interface (conceptual)

Each plane implements the same shape. This is a design contract for later implementation,
not a type definition:

| Member | Contract |
|---|---|
| `plane_id` | `USB_PNP` \| `WPD_MTP` \| `ADB` \| `COMPANION` — matches the patch schema's plane enum. |
| `probe_availability()` | `AVAILABLE(reason)` \| `UNAVAILABLE(reason)` — observed, never assumed. |
| `consent_gate` | The governed gate for this plane; **reported, not granted**. |
| `observe(domain)` | Executes the domain's allowlisted read-only observation, or returns a typed refusal. |
| `health()` | Post-observation integrity: degraded-service detection, byte counts, exit codes. |
| `capability_hint(domain)` | What this plane *can* ever answer for this domain — feeds the matrix resolver. |
| `close()` | Releases the transport; idempotent. |

Refusals are **values**, not exceptions: `PLANE_UNAVAILABLE`, `GATE_CLOSED`,
`DOMAIN_NOT_ON_PLANE`, `HEALTH_DEGRADED`, `SIZE_CAP_EXCEEDED`, `RESTRICTED_BY_POLICY`.
Each carries a §23-compatible result so no caller can mistake a refusal for an
observation.

### 3.1 Universal rules

1. **Read-only by default.** `observe()` may only issue compiled-allowlist commands.
   Stimulus (`input`, `screencap`) and lifecycle (`reboot`, `recovery`) verbs are
   separated into an attested-procedure namespace and are unreachable from ordinary
   diagnostic dispatch.
2. **Authorization is observed, never inferred from presence.** A connected device is not
   an authorised device.
3. **A patch cannot open a gate.** Transport availability may be *described* by a signed
   patch; authorisation itself comes only from the user/device state (patch schema §6.9).
4. **Emulators are labelled as emulators** — `ro.kernel.qemu`, never inferred from model
   strings.
5. **Health before trust.** Target state `device` is necessary, not sufficient.

## 4. Plane-by-plane design notes

### 4.1 P1 — USB/PnP

The cheapest and most durable signal: a device is physically present.

- **No consent required.** Enumerate VID/PID, USB serial string, manufacturer/product
  strings, connect state.
- **Nothing internal.** The plane must not attempt to read properties, storage or
  identifiers beyond the USB descriptors themselves.
- **Value:** it is the one plane that still answers "is anything plugged in?" when ADB is
  off. State 3 (debugging disabled) proved the point — ADB reported *nothing at all*,
  while the device remained physically attached. P1 is what distinguishes "cable
  unplugged" from "debugging disabled", which are different findings with different
  remedies.
- **Known limitation:** PnP re-enumeration on lock can transiently hide entries (see
  §6.1); P1 state must be sampled with a settle window, not a single read.

### 4.2 P2 — WPD/MTP

Shared storage as seen by a file-transfer client.

- **Gate: unlocked.** Locked ⇒ the plane returns **empty by definition**. An empty
  result on a locked device is the expected behaviour of this plane, not a failure and
  not evidence that storage is empty.
- **Metadata only**: volume and file metadata. **No identifiers, no properties.**
- **Value:** corroborates that the device is unlocked and sharing storage, and gives a
  second, independent view of storage that does not depend on ADB.
- **Independent of ADB:** MTP visibility proves nothing about ADB, and vice versa — the
  freeze rule, enforced here by keeping the planes in separate implementations.

### 4.3 P3 — ADB (the workhorse)

Carries the entire read-only probe battery.

- **Gate: debugging + key accept.** Three distinct states must be told apart:
  `unauthorized` (key not accepted), `offline` (transient), and *absent* (interface gone).
  Each is a different fact and each is recorded verbatim.
- **Closed allowlist:** `getprop` (16-key identifier-free allowlist), `dumpsys`
  battery/display/sensors/wifi/diskstats, `pm list packages`, `df`, `wm size/density`,
  CID sysfs read. Identifier keys are excluded at the harness, not filtered downstream.
- **Prohibited by the plane's own definition:** `/data/data`, non-interactive reset,
  IMEI on A10+.
- **Health validation is part of the transport, not an afterthought**: post-capture scan
  for `DEAD_OBJECT`, `DUMP TIMEOUT`, `Can't find service`, `Failure calling service`,
  `Broken pipe` → `HEALTH_DEGRADED`. A framework that is dying still reports state
  `device`, so the transport cannot rely on `adb devices` alone.
- **Size caps enforced per domain** (§6.2), with truncation recorded rather than
  silent.
- **Provenance**: every observation records timestamp, ABI, API level, target kind,
  target state and `degraded_services`.

### 4.4 P4 — Companion APK (consent-based, optional)

The only route to observations a `dumpsys` cannot honestly produce.

- **Gate: install + runtime permissions.** Each permission is its own sub-gate; a
  denied permission yields `GATE_CLOSED` for that sensor, **not** a failure of the
  domain.
- **Optional by construction.** The engine must be fully functional when P4 is absent:
  domains reachable only through P4 record `NOT TESTED`, never `FAIL` (Spec §82).
- **Never root.** The plane has no privilege-escalation path.
- **IMEI still restricted on A10+** even with every runtime permission granted —
  granting an app permission does not lift an identifier policy rule.
- **Test builds only, debug-signed**, per governed §9 verification plan; production
  distribution is out of scope here.

## 5. Transport selection

### 5.1 Algorithm

```
for each domain:
    candidates = planes where capability_hint(domain) != NONE
    for each candidate in precedence order:
        if probe_availability() is UNAVAILABLE   → record reason, continue
        if consent_gate is closed/unknown        → record GATE_CLOSED, continue
        if scope (version/OEM) is NOT APPLICABLE → record, continue
        dispatch observe(domain) on that plane
        if health() is degraded                  → record degraded, continue to next plane
        accept observation; stop
    if no plane yielded an observation:
        emit the domain's refusal class (NOT TESTED / NOT AVAILABLE / RESTRICTED /
        PHYSICAL VERIFICATION REQUIRED) with the reason from the most informative attempt
```

Selection is **per domain**, not per device: a device may be observed on P1+P3 while its
camera stays `NOT TESTED` because P4 is absent.

### 5.2 Precedence

Default ordering, refined by the matrix's `Plane / source` cell:

| Order | Plane | Why |
|---|---|---|
| 1 | P1 USB/PnP | Always permitted; confirms presence cheaply; never wrong to ask. |
| 2 | P3 ADB | Fullest read-only coverage — the workhorse. |
| 3 | P2 WPD/MTP | Independent corroboration of unlock + shared storage. |
| 4 | P4 Companion | Highest fidelity for physical sensors, but consent-heavy and optional. |

Precedence is a **cost/fidelity hint, not a trust ranking**: an observation from any
plane is equally valid evidence, and each records its own plane in provenance. P1 never
"outvotes" P3 on a domain P3 actually answered — the runtime keeps per-plane outcomes and
reports the best available (see the matrix runtime's composition table).

### 5.3 Swapping triggers

| Event | Effect on transports |
|---|---|
| Screen locked | P2 → empty; P3 stays open but Wi-Fi/Sensor observability narrows (observed: PARTIAL). |
| Screen unlocked | P2 becomes usable; P3 observability returns to full. |
| USB debugging toggled off | P3 closes entirely — the interface leaves the composite device, so there is no `unauthorized`/`offline` to observe. P1 remains. |
| Key rejected | P3 `unauthorized` → gate closed until accepted; P1/P2 unaffected. |
| Companion installed / permissions granted | P4 opens for the granted sensors only. |
| OEM quirk matched by a signed patch | Procedure override applies to that `oem_scope` only. |
| Target health degraded | That plane is skipped for the affected domains; others continue. |
| ADB re-enumeration (§6.1) | P3 marked *transitioning*; settle and re-sample before concluding. |

Transports are opened lazily — only when a candidate domain needs them — and closed
after use, so no plane is held open without purpose.

## 6. OEM quirks at the transport layer

These are observed behaviours from the TASK Q fixture captures. They are handled **in the
transport**, and any per-OEM variation enters only via a signed capability patch with a
matching `oem_scope` (governed §5.5) — never as hard-coded OEM branches.

### 6.1 Samsung lock re-enumeration

Locking the screen causes USB/ADB re-enumeration: `transport_id` changes and an in-flight
command returns `device '<serial>' not found` with target state `NOT_LISTED`.

- Sample P3 with a settle window; one re-enumeration is expected.
- Read lock state directly (`mScreenLocked`, `isKeyguardShowing`) rather than inferring
  it from ADB availability.
- A transient loss must never be reported as "debugging disabled", and a locked device
  must never be reported as "not present".
- P1 (USB) remains present throughout — which is exactly how the transition is
  distinguished from a genuine transport loss.

### 6.2 Wi-Fi dump size bound

Samsung `dumpsys wifi` ≈ 1.62 MB vs 7.8 KB on the emulator (~207×), carrying full scan
history and hundreds of BSSIDs.

- Per-domain byte cap with outcomes `ok` / `truncated(offset, cap)` /
  `skipped(size_over_hard_limit)`; original byte count always retained.
- Truncation is a privacy property too: scan history is MAC-class location data, and the
  transport never retains more than the observation needs.

### 6.3 CID `Permission denied`

Two different facts, recorded differently: a **denial** means the node exists and is
protected; a **missing node** means the path differs on that platform (probe alternates,
then record). Both resolve to §23 `NOT AVAILABLE` — neither becomes `FAIL`.

## 7. Invariants

1. The four planes stay independent: no plane's availability implies another's.
2. USB presence does not imply ADB; WPD/MTP visibility does not imply filesystem access.
3. Gates are observed, never assumed, and never granted by a patch.
4. Read-only allowlist is closed; stimulus/lifecycle verbs are attested-procedure only.
5. Health before trust — `device` state alone certifies nothing.
6. Refusals are typed values with §23-compatible results, never silent gaps.
7. P4 is optional; engine correctness never depends on it.
8. Emulators are labelled as emulators.
9. OEM variation enters only through signed `oem_scope` patches.
10. `/data/data`, non-interactive reset and A10+ IMEI are prohibited by the plane
    definition itself, not by configuration.

## 8. Open items

1. Driver/transport implementations — later phase; this is the interface contract only.
2. Emulator matrix API 26/30/33 fixtures (governed §9) absent — plane behaviour is
   validated against one emulator (API 36) and one physical target (API 30) only.
3. P1/P2/P4 currently have **no fixture evidence** (capability matrix §3 records all
   three as `NOT TESTED`); capturing them is a prerequisite to claiming coverage.
4. P4 production distribution policy and signing — out of scope for this design.
5. Per-domain size cap values — proposed, not yet approved.

---

*Documentation only. No transport code, driver, probe allowlist or consent gate was
changed by this file.*
