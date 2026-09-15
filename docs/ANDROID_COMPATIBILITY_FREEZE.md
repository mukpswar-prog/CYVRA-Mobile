# Android compatibility freeze (GitHub engineering baseline)

**Accepted:** 14 Sep 2026  
**Scope:** Android product path in this repo only. Public www, live API, OTP, `API_ENV`, Station, Knox, and Erase stay frozen.  
**Authoritative guide:** [CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md](./CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md)  
**Start:** [resume-android-freeze.md](./resume-android-freeze.md)

## Product principle

One Windows CYVRA application. One generic Android platform core. Controlled USB/ADB transport. Optional Android device-side capabilities. OEM-specific extensions only behind capability interfaces. No fabricated evidence. No universal sanitization claims. Every destructive operation must be authorized, recorded, and followed by verification.

CYVRA Mobile is **not** a Samsung-first APK. The Windows host is the orchestrator. The Android APK is a supporting component.

## Frozen toolchain

| Component | Frozen value | On disk until the matching slice |
|---|---|---|
| Kotlin / KGP | **2.3.21** | A1 applied |
| Android Gradle Plugin | **8.13.2** | already frozen; do not move to AGP 9 |
| Gradle Wrapper | **9.1.0** | already frozen |
| JDK | **21** | Gradle JDK = jbr-21 |
| compileSdk | **36** | A2 applied |
| targetSdk | **36** | A2 applied |
| Android **component** minSdk | **26** | A2 applied. APK floor, not host service floor. |

`minSdk = 26` is the APK install floor (Android 8.0+). It is **not** the Windows-host device-service floor. The host may still detect or inspect a device that cannot install the APK.

Do not upgrade to AGP 9 as part of this freeze. Keep applying `kotlin("android")`.

## Architecture (A0 confirmed)

```text
Windows host (primary orchestrator)
  USB physical connection
  Controlled ADB transport
  Evidence engine
  Sanitization engine (assess / authorize / execute / verify — execute stays non-destructive in G5)
    Generic Android provider
    OEM adapters (verified hardware only)
    Optional Android APK (device-side APIs the host cannot obtain)
→ Android device (OS + storage)
```

This is **not** Decision 5.1.20.2. Do not create `apps/station`. Do not start Knox.

## Execution slices

| Slice | What | Status |
|---|---|---|
| A0 | Architecture confirmation. No product code. | **Done** (this docs commit) |
| A1 | Kotlin 2.2.10 → 2.3.21 only. Keep AGP 8.13.2 / Gradle 9.1.0 / JDK 21. Do not change minSdk. `:core:test`. | **Done** on GitHub and laptop (`BUILD SUCCESSFUL`). After break, force jbr-21 so the banner is Java 21, not 25. |
| A2 | compileSdk 36 / targetSdk 36 / minSdk 26. Laptop SDK Platform 36.0 is installed. | **Done** in git and laptop (`BUILD SUCCESSFUL`, `app-debug.apk` built). |
| A3 | `apps/host` USB/ADB transport. No sanitization execution. | **Done** in git (`:host:test` passes). |
| A4 | Generic evidence in `:core` + host integration. | **Done** in git (`:core:test` & `:host:test` pass). |
| A5 | Capability engine & OEM capability resolver. | **Done** in git (`:core:test` & `:host:test` pass). |
| A6 | APK as `ANDROID_COMPONENT`. | **Done** in git (`:core:test` & `:host:test` pass). |
| A7 | OEM adapters only when a real device needs them | Verified physical devices (Samsung G5-A) |
| A8 | Sanitization **architecture** (NIST SP 800-88 Rev. 2, non-destructive in G5) | **Done** in git (`:core:test` & `:host:test` pass). |
| A9 | Local host reports (Report 1 Verification + Final Sanitization Certificate with SHA-256 integrity). | **Done** in git (`:core:test` & `:host:test` pass). |
| A10 | Multi-OEM & Compatibility Matrix (Levels A–F, Android 8–16, Windows 10/11 baseline). | **Done** in git (`:core:test` & `:host:test` pass). |
| A11–A13 | Customer desktop freeze alignment, docs, and final branch verification | Ongoing |

## Identifier / honesty policy

- Do not make IMEI the primary identity.
- Never fabricate IMEI, serial, or other hardware identifiers.
- Never substitute Android ID / app UUID / MAC for IMEI or serial.
- Unavailable is valid: `value = null`, status restricted/unavailable, reason documented.
- Do not bypass screen lock, ADB authorization, FRP, bootloader, OEM controls, or Android permissions.

## G4 wire format (frozen API)

Live `POST /evidence/batches` keeps the G4 vocabulary in `packages/evidence`.

Host-internal states (`ADB_READY`, `USB_CONNECTED`, sources such as `ANDROID_COMPONENT`) must **map** onto existing G4 `usbState` / `adbState` / `source` enums at ingest. Do not widen Worker validation until the API freeze lifts.

## GitHub process

- Branch: `cursor/g0-g3-mobile-slice-7474` (stay unless a new feature branch is named).
- Do not commit `.idea/`, `local.properties`, `.gradle/`, `build/`, APKs, `adb.exe`, secrets.
- Logical commits: Kotlin → SDK baseline → host transport → evidence → capability/sanitization abstractions → tests → docs.
- Merge to `main` only after PR review.

## Related architecture docs

- [WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md](./WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md)
- [DEVICE_EVIDENCE_ARCHITECTURE.md](./DEVICE_EVIDENCE_ARCHITECTURE.md)
- [SANITIZATION_ARCHITECTURE.md](./SANITIZATION_ARCHITECTURE.md)
- [OEM_ADAPTER_ARCHITECTURE.md](./OEM_ADAPTER_ARCHITECTURE.md)
- [TEST_MATRIX.md](./TEST_MATRIX.md)
