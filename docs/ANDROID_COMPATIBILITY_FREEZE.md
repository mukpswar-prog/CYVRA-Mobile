# Android Compatibility Contract

**Status:** ACTIVE CONTRACT
**Date:** 2026-09-19
**Product:** CYVRA Mobile

## Purpose

This document defines the Android compatibility baseline without turning a build target into a support claim.

CYVRA Mobile is a Windows-hosted product. The Android APK is an optional supporting component. The workstation may observe and verify a device through Windows USB/WPD even when the APK cannot be installed or ADB is unavailable.

## Frozen Android toolchain

| Component | Value |
|---|---:|
| Kotlin / KGP | 2.3.21 |
| Android Gradle Plugin | 8.13.2 |
| Gradle Wrapper | 9.1.0 |
| JDK | 21 |
| compileSdk | 36 |
| targetSdk | 36 |
| Android component minSdk | 26 |

`minSdk = 26` is the APK installation floor. It is not the entire Windows workstation service floor.

Do not upgrade these pins as incidental cleanup.

## Compatibility architecture

Independent evidence/transport planes:

```text
WINDOWS_USB
WINDOWS_WPD_MTP
ANDROID_ADB
ANDROID_COMPONENT
```

Rules:

- USB presence does not imply ADB.
- WPD/MTP visibility does not imply full filesystem access.
- ADB is optional advanced evidence.
- Android Component is optional supporting evidence.
- unknown OEM falls back to generic capability assessment rather than failing by brand.
- unavailable or restricted evidence remains unavailable/restricted.
- no screen-lock, FRP, bootloader, OEM, or permission bypass.

## Android-version support language

The engineering test target includes Android API 26 through current API 36-era builds, but compilation/minSdk alone does not prove compatibility.

A customer-facing support claim requires physical validation for the relevant:

```text
Android version
OEM/device family
Windows version
USB/WPD/ADB state
workflow capability
```

Support may be partial by capability.

## OEM policy

The generic Android path is primary.

Add an OEM adapter only when a real device exposes a verified OEM-specific capability or behavior that cannot be represented safely by the generic path.

Brand/model detection alone must not unlock privileged behavior.

See [`OEM_ADAPTER_ARCHITECTURE.md`](./OEM_ADAPTER_ARCHITECTURE.md).

## Sanitization policy

A device being compatible with verification does not mean sanitization is supported.

Sanitization support is method-specific and requires qualification under [`SANITIZATION_ARCHITECTURE.md`](./SANITIZATION_ARCHITECTURE.md).

## Maturity

Use the repository maturity vocabulary:

```text
MODELLED
UNIT-TESTED
PROTOCOL-EXPOSED
UI-INTEGRATED
HARDWARE-VALIDATED
RELEASE-VALIDATED
```

One handset test proves only that tested capability on that tested environment.

## Current baseline

- Windows 10/11 64-bit are immediate host qualification targets.
- Native Windows USB observation exists.
- WPD/MTP device discovery has been hardware exercised on a Samsung handset.
- ADB/domain collectors are unit-tested.
- WPD storage/object metadata traversal is still under implementation.
- full multi-device correlation is not release-validated.
- sanitization methods are not yet qualified for production destructive execution.

## Related contracts

- [`WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md`](./WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md)
- [`DEVICE_EVIDENCE_ARCHITECTURE.md`](./DEVICE_EVIDENCE_ARCHITECTURE.md)
- [`SANITIZATION_ARCHITECTURE.md`](./SANITIZATION_ARCHITECTURE.md)
- [`TEST_MATRIX.md`](./TEST_MATRIX.md)
