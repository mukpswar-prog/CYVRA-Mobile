# Resume here — Android freeze accepted (14 Sep 2026)

**Start the next session from this file.**  
**Governing freeze:** [ANDROID_COMPATIBILITY_FREEZE.md](./ANDROID_COMPATIBILITY_FREEZE.md)  
**Full text:** [CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md](./CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md)  
Older www/OTP pause notes: [resume-g8-freeze.md](./resume-g8-freeze.md) (history; G8 www still frozen).

## What is frozen (Android product)

| Knob | Value |
|---|---|
| Kotlin / KGP | **2.3.21** (A1) |
| AGP | **8.13.2** (keep; not AGP 9) |
| Gradle | **9.1.0** |
| JDK | **21** |
| compileSdk / targetSdk | **36** (A2) |
| APK minSdk | **26** (A2; not the host service floor) |
| Host | Windows 10/11, USB → controlled ADB |
| APK | Supporting component |
| Sanitization | Capability / execution / verification separated; G5 non-destructive |
| Evidence | Generic Android first; OEM adapters only when verified |
| Honesty | No fabricated IMEI/serial; no security bypass |
| Reference | NIST SP 800-88 Rev. 2 terminology |

## What stays frozen (not this work)

Public `www.cyvoriq.co.in`, live Worker/API, OTP, `API_ENV=preview`, Erase, CYVRA Station (`apps/station`, Decision 5.1.20.2), Knox.

## Branch

`cursor/g0-g3-mobile-slice-7474`

Laptop: `C:\Users\User\StudioProjects\CYVRA-Mobile`  
Open Android Studio on `apps\android` only. Gradle JDK **jbr-21**.

```powershell
git checkout cursor/g0-g3-mobile-slice-7474
git pull
```

## Order of work

1. **A0** — architecture docs on GitHub (this commit).
2. **A1** — Kotlin 2.2.10 → 2.3.21. Do not change minSdk. `./gradlew :core:test`.
3. **A2** — compileSdk/targetSdk 36, minSdk 26. Laptop must install **SDK Platform 36** before `:app:assembleDebug` / lint.
4. **A3+** — Windows host transport, then generic evidence. Physical Samsung is G5-A, not “APK only”.

## Do not

- Upgrade AGP to 9
- Change minSdk in the A1 commit
- Start `apps/station` or Knox
- Call `wipeData()` / factory reset from G5 UI
- Fabricate identifiers
- Touch www, Worker secrets, or Erase
- Commit `.idea/`, `local.properties`, APKs, or `adb.exe`
