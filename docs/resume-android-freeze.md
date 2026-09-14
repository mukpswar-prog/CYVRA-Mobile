# Resume here — after A2 (14 Sep 2026)

**Start the next session from this file.**  
**Governing freeze:** [ANDROID_COMPATIBILITY_FREEZE.md](./ANDROID_COMPATIBILITY_FREEZE.md)  
**Full law:** [CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md](./CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md)

Public www, live API, OTP, `API_ENV`, Station, Knox, and Erase stay frozen.

## Status

| Slice | State |
|---|---|
| A0 docs | Done |
| A1 Kotlin 2.3.21 | Done. Laptop `:core:test` passed |
| A2 SDK 36 / minSdk 26 | **In git.** Laptop must `git pull`, use **jbr-21**, then assemble |

`minSdk = 26` is the **APK install floor** (Android 8.0+), not the Windows-host device-service floor.

## Laptop — type only these lines in Git Bash

```bash
cd /c/Users/User/StudioProjects/CYVRA-Mobile
git pull
cd apps/android
export JAVA_HOME="C:/Program Files/Android/Android Studio/jbr"
./gradlew.bat --stop
./gradlew.bat -Dorg.gradle.java.home="C:/Program Files/Android/Android Studio/jbr" :core:test :app:assembleDebug
```

Note on paths: use Windows-style `C:/Program Files/...` (not `/c/...`) so Windows Java/Gradle detects the JDK path.

Expected: `cyvra-mobile-android: Java 21...` and `BUILD SUCCESSFUL`.  
APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk`

### Alternative: Build directly inside Android Studio (recommended)
1. Open Android Studio with `apps/android` open.
2. Confirm **File → Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK** is **jbr-21** (API 21 / version 21.0.8).
3. Confirm **File → Settings → Languages & Frameworks → Android SDK → SDK Platforms** has **Android 16.0 (API 36)** installed.
4. Click **Build → Make Project** (or **Build → Build Bundle(s) / APK(s) → Build APK(s)**).

If `gradle/gradle-daemon-jvm.properties` reappears with `toolchainVersion=25`, delete it and re-run.  
If Upgrade Assistant offers AGP 9.4: **do not Run selected steps**.

## Next (not A2)

A3 is the CYVRA Mobile Windows host USB/ADB transport (`apps/host`). Not Station. Say **execute A3** when ready. Physical Samsung is G5-A.

## Frozen pins

| Knob | Value |
|---|---|
| Kotlin / KGP | **2.3.21** |
| AGP | **8.13.2** |
| Gradle | **9.1.0** |
| JDK | **21** |
| compileSdk / targetSdk | **36** |
| APK minSdk | **26** |

## Do not

- Upgrade AGP to 9
- Click Upgrade Assistant
- Commit `.idea/`, `local.properties`, APKs, `gradle-daemon-jvm.properties`
- Start Station or Knox
- Touch www, Worker, or Erase
