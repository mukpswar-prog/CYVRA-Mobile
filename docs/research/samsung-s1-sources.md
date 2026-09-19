# Samsung / Android Public-API Research

**Status:** ACTIVE RESEARCH REFERENCE — historical S1 terminology retained for traceability
**Original research period:** September 2026

## Purpose

This file records public Android/Samsung API constraints that informed the early S1 evidence contract.

`S1` is historical Evidence V1 terminology. New architecture uses explicit provenance such as `ANDROID_COMPONENT`, `ANDROID_ADB`, `WINDOWS_USB`, and `WINDOWS_WPD_MTP`.

Research does not equal hardware validation.

## Public Android observations

Normal Android application APIs can generally expose facts such as:

- manufacturer/brand/model/build/version;
- package-manager feature flags;
- app-scoped Android ID;
- camera/sensor presence subject to platform/permission rules;
- battery status/charge information;
- scoped storage information;
- lock-presence state;
- selected connectivity state.

Availability changes by Android version, permission, OEM, management state, and API restrictions.

## Restricted identifiers

IMEI and hardware serial are restricted on modern Android for ordinary applications.

CYVRA must not:

- fabricate them;
- substitute Android ID/MAC/app UUID and keep the IMEI/serial label;
- bypass platform restrictions.

Restricted/unavailable is a valid evidence outcome.

## Battery state of health

Battery charge/status exposed through public Android APIs is not equivalent to manufacturer/enterprise battery state-of-health.

Do not infer a battery SOH percentage/grade from ordinary public status fields.

## Samsung / Knox

Knox and related Samsung enterprise capabilities require the appropriate Samsung/enterprise authority and supported deployment context.

A consumer/supporting APK must not claim Samsung/Knox authority merely because the device is Samsung.

## Capability model

Preserve:

```text
DECLARED
DETECTED
TESTED
```

as distinct concepts.

A model name must not unlock a capability.

## Evidence rule

Current product implementation must follow the active contracts:

- [`../ANDROID_COMPATIBILITY_FREEZE.md`](../ANDROID_COMPATIBILITY_FREEZE.md)
- [`../DEVICE_EVIDENCE_ARCHITECTURE.md`](../DEVICE_EVIDENCE_ARCHITECTURE.md)
- [`../OEM_ADAPTER_ARCHITECTURE.md`](../OEM_ADAPTER_ARCHITECTURE.md)

This research file is supporting evidence, not governing architecture.
