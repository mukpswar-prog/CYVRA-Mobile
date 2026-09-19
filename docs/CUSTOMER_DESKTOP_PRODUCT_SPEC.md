# Customer Desktop Product Specification

**Status:** ACTIVE PRODUCT CONTRACT
**Date:** 2026-09-19
**Product:** CYVRA Mobile
**Immediate host target:** Windows 10/11 64-bit

## Product

CYVRA Mobile is a Windows workstation for Android device discovery, verification, evidence preservation, reporting, and separately authorized sanitization.

Customers should not need Android Studio, Gradle, or an arbitrary system `adb.exe` to operate a release build.

## Core lifecycle

```text
Launch / sign in / entitlement
        ↓
Workstation preflight
        ↓
USB/WPD device discovery
        ↓
select one target device
        ↓
optional ADB / Android-component enrichment
        ↓
Device Verification
        ↓
canonical Report 1
        ↓
optional separate Sanitization workflow
        ↓
reconnect / verify / validate
        ↓
final outcome report or certificate
```

## Device model

The product must present independent states for:

```text
WINDOWS_USB
WINDOWS_WPD_MTP
ANDROID_ADB
ANDROID_COMPONENT
```

ADB is not required for every basic verification.

One selected target is processed at a time, while all attached candidates are detected and safely disambiguated.

## Architecture boundary

```text
React Desktop UI
    presentation/operator interaction

Rust/Tauri Native Layer
    Windows USB/PnP/WPD/native lifecycle

Kotlin Domain Engine
    Android semantics/evidence/licensing/reports/sanitization policy

Android Component
    optional supporting device-side evidence

Cloud Control Plane
    auth/entitlement/registry/audit
```

## Product honesty

CYVRA Mobile must not claim:

- universal Android compatibility;
- unavailable identifiers;
- password/PIN/FRP bypass;
- WPD full-filesystem access;
- factory reset equals Purge;
- release support based only on unit tests.

## Commercial boundary

Passive discovery is free.

Chargeable Device Verification begins only at an explicit transaction boundary and is finalized after the canonical Report 1 is successfully frozen.

Sanitization is a separate authorization boundary.

## Current maturity

The full end-to-end customer product is still under engineering integration.

Current proven pieces include native USB observation, WPD device enumeration on current test hardware, substantial Kotlin domain logic, and existing cloud evidence/report slices.

Installer, complete UI integration, multi-device correlation, Evidence V2, and production sanitization remain subject to later acceptance gates.

See [`CYVRA_MOBILE_PROJECT_INDEX.md`](./CYVRA_MOBILE_PROJECT_INDEX.md).
