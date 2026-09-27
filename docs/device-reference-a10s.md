# Device Reference — Samsung Galaxy A10s ("Korwar's A10s")

> **Reference hardware / observed configuration.**
> **Not a production whitelist. Not a hard-coded identity.**

This document records one observed handset on one Windows workstation as a
**reference point** for the `REQ-DEV-011` Android-device classifier work.
Classification in CYVRA Mobile must rely on evidence categories
(external device + Android identity + device-stack/transport evidence),
never on the values recorded here.

- Captured: 2026-09-27
- Workstation: Windows 10/11 x64, CYVRA-Mobile worktree (`phase2-correct`)
- Capture sources: WMI/CIM (`Win32_PnPEntity`, `Win32_PnPSignedDriver`),
  Windows Portable Devices (Rust `wpd::discovery`), bounded metadata scan
  (Rust `wpd::scanner`, G6 contract), `adb devices` (observation only)

## Identity

| Field | Observed value |
|---|---|
| Marketing name | Samsung Galaxy A10s |
| Device name (WPD friendly name) | Korwar's A10s |
| USB VID / PID | `04E8:6860` (Samsung composite device) |
| USB serial | `R9BN****QJ` (redacted per REQ-DEV-010) |
| USB composite stack | service `dg_ssudbus` (Samsung) |

## Interfaces and drivers (observed)

| Interface | Class | Service | Driver |
|---|---|---|---|
| SAMSUNG Mobile USB Composite Device | USB | `dg_ssudbus` | Samsung Electronics 2.21.4.0 (oem22.inf, 2026-08-04) |
| Korwar's A10s (MTP) | WPD | `WUDFWpdMtp` | Standard Microsoft MTP stack |
| SAMSUNG Mobile USB Modem | Modem | `Modem` | Samsung Electronics 2.21.4.0 (oem23.inf, 2026-08-04) |

All three interfaces observed `Status=OK`, `ConfigManagerErrorCode=0`.

## WPD device view (Rust WPD discovery)

| Field | Observed value |
|---|---|
| Friendly name | `Korwar's A10s` |
| Manufacturer | `(Standard MTP Device)` |
| Description | `MTP USB Device` |
| Read access | `GENERIC_READ`, open/close read-only verified |

## Storage and scan (G6 bounded metadata scan)

| Field | Observed value |
|---|---|
| Storages | 1 (functional storage object) |
| Root objects | 2 (`s10001` storage, `RenderingInformation`) |
| Objects scanned | 138 (metadata only, depth-bounded) |
| Digest | `bf8769f41d7bad7ae9d347d7d965414a4c49528eef78f6d6023ac8bd910a5c40` |
| Determinism | Verified stable against the recorded G6 digest (same device, different day) |
| Limitations | `WPD_SCAN_BOUNDS_DEPTH` (depth bound honestly reported) |
| Privacy contract | Maintained — metadata only, no content streams |

## ADB observation at capture time

| Field | Observed value |
|---|---|
| `adb devices` | empty (USB debugging **disabled**) |
| FSB-003 device state | `USB_DETECTED` / `USB_CONNECTED` / `USB_PRESENT` |

This is the acceptance condition of FSB-003: Windows detects the handset
through native enumeration and the WPD/MTP stack while ADB cannot see it.
ADB remains optional enrichment (REQ-DEV-003), never a detection prerequisite
(REQ-DEV-011).

## Status of this reference

- **Reference hardware / observed configuration** — a baseline for comparison.
- **Not a production whitelist** — qualifying evidence, not these values,
  decides classification.
- **Not a hard-coded identity** — no VID/PID/serial/name from this file may be
  baked into classifier logic; OEM breadth (Samsung, OnePlus, Xiaomi, Vivo,
  Oppo, Motorola, others) must come from evidence categories per REQ-DEV-011.
