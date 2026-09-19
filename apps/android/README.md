# CYVRA Mobile Android Component

The Android APK is an optional supporting component of CYVRA Mobile.

The Windows workstation remains the product orchestrator.

## Modules

```text
:core
  Kotlin/JVM domain models and shared logic

:host
  Kotlin/JVM Domain Engine used by the Windows desktop

:app
  optional Android supporting component
```

`:app` is included when an Android SDK is configured.

## Toolchain

```text
Kotlin/KGP   2.3.21
AGP          8.13.2
Gradle       9.1.0
JDK          21
compileSdk   36
targetSdk    36
minSdk       26
```

`minSdk 26` is the APK installation floor, not the Windows workstation service floor.

## Build/test

```powershell
.\gradlew.bat :core:test :host:test
```

With Android SDK:

```powershell
.\gradlew.bat :app:assembleDebug
```

## Security boundary

The component must not:

- bypass locks/FRP/bootloader/OEM controls;
- fabricate IMEI/serial;
- claim Knox/enterprise authority without legitimate authority;
- treat USB or APK presence as authorization.

## Evidence

The component is one optional evidence source.

New architecture distinguishes:

```text
WINDOWS_USB
WINDOWS_WPD_MTP
ANDROID_ADB
ANDROID_COMPONENT
```

See [`../../docs/ANDROID_COMPATIBILITY_FREEZE.md`](../../docs/ANDROID_COMPATIBILITY_FREEZE.md).
