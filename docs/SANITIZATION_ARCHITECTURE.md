# Sanitization architecture

**Freeze:** [ANDROID_COMPATIBILITY_FREEZE.md](./ANDROID_COMPATIBILITY_FREEZE.md)  
**Reference:** NIST SP 800-88 Rev. 2 (September 2025).  
**G5 rule:** architecture and assessment only. No destructive APIs from the UI.

## Lifecycle

```text
DEVICE CONNECT
  → PRE-SANITIZATION SCAN
  → CAPABILITY ASSESSMENT
  → USER / SERVER AUTHORIZATION
  → METHOD SELECTION
  → EXECUTION
  → REBOOT / RESET
  → DEVICE RECONNECTION
  → POST-SANITIZATION VERIFICATION
  → FINAL REPORT
```

The Windows host must survive the Android reset. Persist operation ID, identity evidence, method, start time, authorization, and expected reboot **before** a destructive step.

## Separate from scanning

Interfaces (A8, in `:core`, not a new Gradle module):

- `SanitizationProvider` — assess, request authorization, execute, verify
- `VerificationProvider`

Capability statuses: `SUPPORTED`, `PARTIAL`, `UNSUPPORTED`, `REQUIRES_PERMISSION`, `REQUIRES_DEVICE_OWNER`, `REQUIRES_OEM_SERVICE`, `UNKNOWN`.

Verification states: `VERIFIED`, `PARTIALLY_VERIFIED`, `PLATFORM_REPORTED_COMPLETE`, `REQUIRES_EXTERNAL_VERIFICATION`, `FAILED`, `UNKNOWN`.

Do not reduce sanitization to PASS/FAIL.

## Claims that are forbidden

- “SECURE ERASE COMPLETE” merely because a factory reset command returned success
- “Factory reset = NIST purge”
- “One overwrite = secure erase”
- Naive file overwrite labelled as secure sanitization
- Device-owner wipe assumed on ordinary customer devices

The report must name method, authority, execution status, verification status, limitations, and assurance level.

## Pre-sanitization record (minimum)

session ID, timestamp, manufacturer/brand/model/device, Android version/API/patch, storage, battery, management state, available identifiers, capability assessment, selected method, operator/session identity, authorization, software versions.

## Device owner / enterprise

`DevicePolicyManager` wipe is not an ordinary app privilege. Treat device-owner / profile-owner / managed-enterprise as a **future** capability unless separately approved. Do not start Knox (G10).
