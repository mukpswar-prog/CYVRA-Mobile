# CYVRA Android Read-Only Probe Harness (`scripts/android-probe/`)

| Field | Value |
|---|---|
| Status | `ACTIVE-REFERENCE` — harness written; **fixture capture BLOCKED on this machine** |
| Authority | `docs/CYVRA_CORE_ENGINE_JOURNEY_FINAL_V2_2026-10-08.txt` §2 (planes), §9 (verification plan) |
| Files | `probe.ps1`, `README.md` (this file) |
| Date | 08-Oct-2026 — TASK O |
| Kind | Read-only diagnostic script. No product code, no build change, no dependency added. |

---

## 1. What it does

`probe.ps1` runs a **read-only** probe battery against an Android emulator and records the raw
outputs as a fixture with a provenance header.

Commands probed (exactly this list, nothing more):

| Command | Purpose |
|---|---|
| `getprop` (selected keys) | build, model, manufacturer, Android version, ABI, SDK, qemu flag |
| `dumpsys battery` | battery state, health, level, temperature |
| `dumpsys display` | density, resolution, refresh fields |
| `dumpsys sensorservice` | sensor list and mode |
| `dumpsys wifi` | Wi-Fi state |
| `dumpsys diskstats` | storage stats |
| `pm list packages` | installed package inventory |
| `df` | filesystem usage |
| `wm size` / `wm density` | window metrics |
| CID sysfs read | `/sys/class/block/*/device/cid` — recorded `NOT AVAILABLE` when absent |

No `input`, no `screencap`, no `reboot`, no writes, no package installs, no `/data/data` access, no
reset. Every call is a read.

## 2. Safety rails (enforced in code, not by convention)

1. **Emulator-only.** The script enumerates devices and will only target a serial beginning
   `emulator-`. Physical serials are listed for awareness and are never selected.
2. **Kernel proof.** Before probing, `ro.kernel.qemu` on the target must equal `1`. Anything else
   aborts the run.
3. **No `-a` fallback, no auto-select.** With no emulator attached the script exits `BLOCKED` and
   prints the exact missing component. It never guesses a serial.
4. **Physical-device runs are forbidden** in this session. If a physical device is the only device
   present, the script says so and refuses.
5. **Read-only allowlist.** Commands are fixed in the script; there is no user-supplied command
   passthrough, so the harness cannot be turned into a general adb runner.
6. **Local only.** Output is written under `apps/android/core/src/test/fixtures/`. No network call,
   no upload, no egress of any kind.

## 3. Usage

```powershell
# from the repository root
powershell -ExecutionPolicy Bypass -File scripts\android-probe\probe.ps1 -ApiLevel 36
```

Parameters:

| Parameter | Default | Meaning |
|---|---|---|
| `-ApiLevel` | from `ro.build.version.sdk` | Fixture folder name / matrix label. Expected: 26, 30, 33, 36. |
| `-Serial` | auto (`emulator-*` only) | Target emulator serial. A physical serial is refused. |
| `-OutDir` | `apps/android/core/src/test/fixtures` | Fixture root. |
| `-ListOnly` | off | Print discovered devices and exit; probes nothing. |

Exit codes: `0` fixture written · `2` no emulator (BLOCKED) · `3` physical-device target refused ·
`4` not a qemu target · `5` adb unavailable.

## 4. Fixture layout

```
apps/android/core/src/test/fixtures/
  api-36/
    provenance.json      <- header: host, adb version, serial, API, image, command list, timestamps
    battery.txt
    display.txt
    sensors.txt
    wifi.txt
    diskstats.txt
    packages.txt
    df.txt
    wm.txt
    getprop.txt
    cid.txt
    manifest.json        <- per-command exit code, byte length, sha256 of each output
```

`provenance.json` records the environment so a fixture is never mistaken for a device capture from
somewhere else: host OS, harness revision, adb path and version, emulator serial, API level,
`ro.build.fingerprint`, run start/end, and the explicit statement `READ_ONLY=TRUE`.

Values that do not exist on a target (typically the storage CID on an emulator) are recorded as the
status token `NOT AVAILABLE` — never invented.

## 5. BLOCKED — this machine (08-Oct-2026)

The harness was written, but **no fixture was produced**, because the emulator matrix required by
§9 cannot be created here. Exact missing components:

| # | Component | Observed state |
|---|---|---|
| 1 | Android Virtual Devices | **None.** `%USERPROFILE%\.android\avd` does not exist; `ANDROID_AVD_HOME` unset. No bootable AVD for any API level. |
| 2 | System image, API 26 | **Missing.** `system-images\` holds only `android-34\google_apis\x86_64` and `android-36\google_apis_playstore\x86_64`. |
| 3 | System image, API 30 | **Missing** (same inventory). |
| 4 | System image, API 33 | **Missing** (same inventory). |
| 5 | `avdmanager` | **Missing.** `cmdline-tools\` absent (and legacy `tools\bin\` absent), so no AVD can be created from the CLI either. |

Present but insufficient: emulator package (`Sdk\emulator\emulator.exe`), platform-tools
(`Sdk\platform-tools\adb.exe`), Android Studio at `C:\Program Files\Android\Android Studio`.

Also observed: a **physical device is attached** (`R9BN3015NQJ`, unauthorised). It was **not
probed** — no command was executed against it, and the harness will refuse it by design.

**Not done, deliberately:** no fixture was simulated, synthesised or copied from elsewhere, and no
API level was substituted for another. Fixture inventory for TASK O: **0**.

### To unblock

1. Install `cmdline-tools` (provides `sdkmanager` and `avdmanager`).
2. Install system images `android-26`, `android-30`, `android-33` (x86_64) — API 36 image already
   present, though its `google_apis_playstore` variant should be confirmed against what §9 intends.
3. Create the four AVDs, then run `probe.ps1 -ApiLevel <n>` for each.
4. Physical-device sessions remain a separate, Chief-Engineer-present activity (§9) and are out of
   scope for this harness.

## 6. Conformance

- [x] Read-only command allowlist, no user-supplied commands.
- [x] Emulator-only selection with `ro.kernel.qemu=1` proof.
- [x] Physical serials refused; physical session not run.
- [x] Output local-only under the fixtures path; no egress.
- [x] Provenance header + per-file sha256 recorded.
- [x] Missing values recorded as status tokens, never fabricated.
- [x] No product code, customer route or API endpoint touched.
