# Android Studio / Android Component Development

**Status:** ACTIVE DEVELOPMENT RUNBOOK
**Date:** 2026-09-19

## Scope

Android Studio is required only for Android-component development/debugging.

CYVRA Mobile customer operation must not require Android Studio.

## Open project

Open:

```text
apps/android
```

not the monorepo root as an Android Gradle project.

## Frozen toolchain

| Item | Value |
|---|---:|
| Kotlin / KGP | 2.3.21 |
| AGP | 8.13.2 |
| Gradle | 9.1.0 |
| JDK | 21 |
| compileSdk / targetSdk | 36 |
| minSdk | 26 |

Use the project Gradle wrapper.

Do not upgrade AGP/Kotlin/Gradle/JDK as incidental IDE cleanup.

## SDK

Install Android SDK Platform 36 and normal build/platform tools needed by the current project.

NDK/CMake are not required unless a later native Android feature explicitly introduces them.

## Local configuration

`local.properties` may contain the local SDK path.

Do not commit:

```text
local.properties
.idea/
.gradle/
build/
APK artifacts
secrets
```

## Build/test

From `apps/android`:

```powershell
.\gradlew.bat :core:test :host:test
```

With a configured Android SDK:

```powershell
.\gradlew.bat :app:assembleDebug
```

The APK is a supporting component. APK compilation does not prove device compatibility.

## Physical device

Use only devices you are authorized to test.

Do not bypass:

- screen lock/PIN/pattern;
- ADB authorization;
- FRP;
- bootloader/OEM protections.

USB debugging is optional for ADB-specific testing. USB/WPD testing must also cover devices where ADB is unavailable.

## Related

- [`ANDROID_COMPATIBILITY_FREEZE.md`](./ANDROID_COMPATIBILITY_FREEZE.md)
- [`TEST_MATRIX.md`](./TEST_MATRIX.md)
