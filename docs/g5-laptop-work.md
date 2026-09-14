# G5 laptop work — start here after this break

**No Samsung required for A1.** Phone work is [g5-owned-samsung.md](./g5-owned-samsung.md) Step 4+, later. G5-A is Windows + USB + ADB + owned Samsung, not APK-only.

**14 Sep freeze accepted:** [ANDROID_COMPATIBILITY_FREEZE.md](./ANDROID_COMPATIBILITY_FREEZE.md). Start: [resume-android-freeze.md](./resume-android-freeze.md).

- A1: Kotlin **2.3.21**. AGP **8.13.2**, Gradle **9.1.0**, JDK **21**.
- A2: compileSdk/targetSdk **36**, minSdk **26** (APK floor). SDK Platform 36 required for `:app:assembleDebug`.
- Do not upgrade to AGP 9.

Governing start: [resume-android-freeze.md](./resume-android-freeze.md).  
Branch: `cursor/g0-g3-mobile-slice-7474`.  
Clone: `C:\Users\User\StudioProjects\CYVRA-Mobile`

Do not reopen G8. Do not flip `API_ENV`. Do not Freeze Report 1.  
Do not start Station or Knox. Do not commit `.idea/` or `local.properties`.

---

## How far we can go without a phone

| Done on the laptop | Blocked until owned Samsung |
|---|---|
| Git signed in, branch pulled, AGP **8.13.2** on disk | Install `app-debug.apk` |
| Android Studio **Quail 4 / 2026.1.4** opened on `apps\android` | Real `MANUFACTURER` / `MODEL` / Android ID |
| Gradle import started | Share `cyvra-g5-batch.json` |
| Build `:app:assembleDebug` (this session) | Customer `POST /evidence/batches` |
| `:core:test` (optional) | Dashboard processing-session row |

An emulator is not a substitute. USB copy of a made-up JSON is not authorization.

---

## Already done (do not redo)

| Item | Where | Result |
|---|---|---|
| G7 ops + customer OTP | `admin.cyvoriq.co.in` / `cyvoriq.co.in` | Inbox trusted. Keep `API_ENV=preview`. |
| Worker mail | Cloudflare `cyvra-mobile-api` | `/health` `mailConfigured: true`, `mailFromHost: "cyvoriq.co.in"` |
| Git for Windows 2.55 | Fresh install | PATH = command line + 3rd-party; Secure Channel; CRLF→LF; MinTTY; pull = merge; **Git Credential Manager** |
| GitHub login in Git Bash | First `git fetch` after reinstall | Signed in as the owner of `mukpswar-prog/CYVRA-Mobile` |
| Repo branch | `StudioProjects\CYVRA-Mobile` | `git pull` fast-forward to `a59ebbb`. Plugin line is `8.13.2`. |
| Android Studio | Reinstalled **Standard** | SDK `C:\Users\User\AppData\Local\Android\Sdk` |
| Project open | File → Open | `apps\android` trusted. Tree is `app` + `core`. Git dropdown shows the slice branch. |
| Why not AGP 9.0.1 | Otter 2 / first Studio | AGP 9 removes `BaseVariant`. Pinned **8.13.2**. Quail 4 can run 8.13.2. Do not bump to 9.0.1. |

---

## What you need on the laptop (checklist)

| Need | Where to set it | Expected |
|---|---|---|
| Branch `cursor/g0-g3-mobile-slice-7474` | Git Bash in the clone, or Studio git dropdown | `git branch --show-current` prints that name |
| Latest commits | Git Bash: `git pull` (now works) | Includes `settings.gradle.kts` **8.13.2** |
| Open folder `apps\android` | Studio Welcome → **Open** (not New, not Clone) | Title `android`. No `apps/web` in the tree |
| Gradle JDK **21** | Studio **File → Settings → Build Tools → Gradle → Gradle JDK** = **Oracle OpenJDK 21.0.8** (`C:\Program Files\Java\jdk-21`) | Field shows 21, not 25 or 17 |
| SDK Platform **36** | **Settings → Android SDK → SDK Platforms** | Android 16.0 API 36 ticked |
| Build-Tools 35.x or 36.x | **SDK Tools** | Ticked. Accept if Studio prompts |
| Command-line Tools + Platform-Tools | **SDK Tools** | Ticked. No NDK, no CMake, no emulator |
| `local.properties` `sdk.dir=` | Studio writes this under `apps\android` | File exists. **Do not commit** |
| AGP **8.13.2** | `apps/android/settings.gradle.kts` | `id("com.android.application") version "8.13.2"` |
| Gradle wrapper **9.1.0** | `apps/android/gradle/wrapper/gradle-wrapper.properties` | Do not download Gradle 8.x |
| Sync | **File → Sync Project with Gradle Files** | Gradle tool window: **`:app`** and **`:core`**. No `BaseVariant` |
| Debug APK | **Build → Build Bundle(s) / APK(s) → Build APK(s)** | `apps\android\app\build\outputs\apk\debug\app-debug.apk` |

Optional check: Git Bash

```bash
cd /c/Users/User/StudioProjects/CYVRA-Mobile/apps/android
./gradlew.bat --stop
./gradlew.bat :core:test
```

If the error is `com/android/build/gradle/BaseExtension`, root `build.gradle.kts` must list AGP **8.13.2** and `kotlin("android")` **2.3.21** with `apply false` (same classpath as `:app`). Then `--stop` and re-run. Do not bump to AGP 9.

If the error is `Unable to download toolchain ... languageVersion=25 ... vendor=JetBrains`, delete `apps/android/gradle/gradle-daemon-jvm.properties` (Studio `updateDaemonJvm` pin). Use Gradle JDK **jbr-21**. Do not install JDK 25. Do not run Upgrade Assistant.

---

## After the break — laptop only, in this order

1. Open Android Studio. If Welcome: **Open** → `C:\Users\User\StudioProjects\CYVRA-Mobile\apps\android`.
2. Confirm title `android`, branch `cursor/g0-g3-mobile-slice-7474`, tree `app` + `core`.
3. Git Bash (optional): `cd /c/Users/User/StudioProjects/CYVRA-Mobile` then `git pull`.
4. Settings → Gradle JDK = **jbr-21**.
5. Settings → Android SDK: **API 36** Installed. Do not run Upgrade Assistant.
6. Open `settings.gradle.kts`. Must say **8.13.2**. If it says `9.0.1`, stop.
7. **File → Sync Project with Gradle Files.** Wait. Expected: `:app` + `:core`, no `BaseVariant`.
8. **Build → Build APK(s).** Expected: `app-debug.apk` path above.
9. **Stop.** Leave the APK on disk. Do not install. Do not make an AVD.

When the owned Samsung arrives, switch to [g5-owned-samsung.md](./g5-owned-samsung.md) Step 4.

---

## Do not

- Open the repo root in Studio as the Gradle project
- `git pull` until Git Bash is in `CYVRA-Mobile` (prompt must not be `~`)
- Commit `.idea/`, `local.properties`, or the APK
- Create PENDING with dummy payment
- Flip `API_ENV` or start Station / Knox
