# Resume here — 14 Sep 2026 evening break

**Start the next session from this file.**  
**GitHub HEAD:** `a705396` on `cursor/g0-g3-mobile-slice-7474`  
**Governing freeze:** [ANDROID_COMPATIBILITY_FREEZE.md](./ANDROID_COMPATIBILITY_FREEZE.md)  
**Full law:** [CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md](./CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md)  
Laptop APK notes: [g5-laptop-work.md](./g5-laptop-work.md). G8 www history: [resume-g8-freeze.md](./resume-g8-freeze.md).

Public www, live API, OTP, `API_ENV`, Station, Knox, and Erase stay frozen.

---

## Saved at stop (14 Sep ~11:10 UTC)

| Item | State |
|---|---|
| Branch | `cursor/g0-g3-mobile-slice-7474` @ **`a705396`** |
| A0 | Freeze docs on GitHub |
| A1 | Kotlin **2.3.21**. AGP **8.13.2**. Gradle **9.1.0**. `minSdk` still **29** |
| Laptop `:core:test` | **BUILD SUCCESSFUL** (6 tasks). Do not re-do A1 |
| Printed Java | **25.0.3** on that successful run — not the freeze. After break, force **jbr-21** |
| SDK Platform 36.0 | **Installed** (`C:\Users\User\AppData\Local\Android\Sdk`) |
| A2 | **Not started.** `compileSdk`/`targetSdk` still 35. `minSdk` still 29 |
| `:app:assembleDebug` | **Not done.** Blocked earlier by JDK-25 toolchain download |
| Upgrade Assistant | Offered AGP **9.4.0** / Gradle **9.6.0**. **Do not Run selected steps** |
| `gradle-daemon-jvm.properties` | Deleted on the laptop. Gitignored. If Studio recreates it with `toolchainVersion=25`, delete again |
| Laptop `git pull` | **Aborted.** Local `apps/android/gradle.properties` would be overwritten. Fix this first after the break |

---

## First commands after the break (Git Bash)

Do not paste the `User@Swaroop` prompt. Type only:

```bash
cd /c/Users/User/StudioProjects/CYVRA-Mobile
git checkout cursor/g0-g3-mobile-slice-7474
git restore apps/android/gradle.properties
git pull
git log -1 --oneline
```

Expected: `a705396` (or later on this branch) and **working tree clean**.

Then force JDK 21 and prove A1 is still green:

```bash
cd apps/android
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
./gradlew.bat --stop
./gradlew.bat -Dorg.gradle.java.home="$JAVA_HOME" :core:test
```

Expected line: `cyvra-mobile-android: Java 21...` (not 25) and `BUILD SUCCESSFUL`.

IDE: open **`apps\android` only**. Gradle JDK = **jbr-21**. Close Upgrade Assistant.

---

## Next slice (say “execute A2”)

| Knob | On disk now | A2 |
|---|---|---|
| compileSdk / targetSdk | 35 | **36** |
| minSdk | 29 | **26** (APK floor, not host service floor) |
| Kotlin / AGP / Gradle / JDK | 2.3.21 / 8.13.2 / 9.1.0 / 21 | unchanged |

SDK Platform **36.0** is already installed. Do not install Android 17, Auto simulators, or Build-Tools 3.x. Do not take AGP 9.

After A2 is in git: `git pull`, then:

```bash
cd /c/Users/User/StudioProjects/CYVRA-Mobile/apps/android
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
./gradlew.bat -Dorg.gradle.java.home="$JAVA_HOME" :core:test :app:assembleDebug
```

---

## Frozen pins

| Knob | Value |
|---|---|
| Kotlin / KGP | **2.3.21** |
| AGP | **8.13.2** (not 9.4.0) |
| Gradle | **9.1.0** (not 9.6.0) |
| JDK | **21** (not 25) |
| compileSdk / targetSdk | **36** after A2 |
| APK minSdk | **26** after A2 |
| Host | Windows + USB + controlled ADB |
| APK | Supporting component |

## Do not

- Click **Run selected steps** on Upgrade Assistant
- Commit `.idea/`, `local.properties`, APKs, `gradle-daemon-jvm.properties`
- Start Station or Knox
- Touch www, Worker secrets, or Erase
- Fabricate IMEI/serial
