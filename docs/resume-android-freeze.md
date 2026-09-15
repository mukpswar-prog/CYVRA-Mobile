# Resume here — after A5 (15 Sep 2026)

**Start the next session from this file.**  
**Governing freeze:** [ANDROID_COMPATIBILITY_FREEZE.md](./ANDROID_COMPATIBILITY_FREEZE.md)  
**Full law:** [CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md](./CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md)  
**Customer application freeze:** [CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md](./CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md)

Public www, live API, OTP, `API_ENV`, Station, Knox, and Erase stay frozen.

## Status

| Slice | State |
|---|---|
| A0 docs | Done |
| A1 Kotlin 2.3.21 | Done. Laptop `:core:test` passed |
| A2 SDK 36 / minSdk 26 | Done. Laptop `:app:assembleDebug` passed with JDK 21. `app-debug.apk` built. |
| A3 Windows USB/ADB Host | Done. `apps/host` transport layer implemented & tested. |
| A4 Generic evidence in :core | Done. Device identity, storage, battery, security collectors implemented and tested (`:core:test` & `:host:test` pass). |
| A5 Capability Engine / Resolver | **Done.** Capability assessment models & standard assessment engine in `:core`, host capability coordinator in `apps/host`. All tests pass (`:core:test` & `:host:test`). |
| A6 APK as ANDROID_COMPONENT | **Next.** Device-side supporting component bridge. |

`minSdk = 26` is the **APK install floor** (Android 8.0+), not the Windows-host device-service floor.

## Laptop — type only these lines in Git Bash

```bash
cd /c/Users/User/StudioProjects/CYVRA-Mobile
git pull
cd apps/android
export JAVA_HOME="C:/Program Files/Java/jdk-21"
./gradlew.bat --stop
./gradlew.bat -Dorg.gradle.java.home="C:/Program Files/Java/jdk-21" test
```

Expected: `cyvra-mobile-android: Java 21...` and `BUILD SUCCESSFUL` running `:core:test` and `:host:test`.

### Alternative: Build / Test directly inside Android Studio
1. Open Android Studio with `apps/android` open.
2. Confirm **File → Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK** is set to **`C:\Program Files\Java\jdk-21 Oracle OpenJDK 21.0.8`**.
3. **File → Sync Project with Gradle Files**. All `:core`, `:app`, and `:host` will sync.
4. Run Gradle task `test` or click **Build → Make Project**.

## Next (A6)

A6 connects the APK as `ANDROID_COMPONENT` to collect device-side metrics where permitted.

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
