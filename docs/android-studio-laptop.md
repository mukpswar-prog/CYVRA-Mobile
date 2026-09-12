# Android Studio on the Windows laptop (configure now, phone later)

Android Studio **Otter 2 / 2026.1.4** is enough. Configure the SDK
**before** the Samsung arrives. Do not wait for the phone to do this.

Open **`apps/android`**, not the repo root. Stay on branch
`cursor/g0-g3-mobile-slice-7474`.

**12 Sep afternoon check:** Android Studio still had
`C:\Users\User\StudioProjects\CYVRA-Mobile` open (whole repo, git `main`).
Expanding `apps/android` in that tree is not enough. Close the project,
put that clone on the slice branch, then File → Open `apps\android`.
Skip the Gemini “Confirm your product tier” panel — we do not use it.

Do not start Station or Knox. Do not flip `API_ENV`. Do not commit
`apps/android/local.properties`.

---

## What this project needs

| Item | Value |
|---|---|
| Open folder | `apps/android` |
| Modules | `:core` (always) and `:app` (only after SDK / `local.properties` exist) |
| Application id | `co.in.cyvra.mobile` |
| compileSdk / targetSdk | **35** |
| minSdk | **29** |
| Gradle wrapper | **9.1.0** (Java 25 Gradle daemon needs this) |
| Android Gradle Plugin | **8.13.2** (Otter 2 max is 8.13. Do not use 9.0.1) |
| JVM / Kotlin target | **21** |
| NDK / CMake / Play App Signing | Not needed |
| Emulator | Optional. G5 proof is one **owned Samsung**, not an AVD |

---

## Step 1 — Switch the laptop repo off `main`

Cursor showed **Current branch: main**. G5 lives on the Mobile slice
branch. In Git Bash, in the repo folder:

```bash
git fetch origin
git checkout cursor/g0-g3-mobile-slice-7474
git pull
git branch --show-current
```

Expected print: `cursor/g0-g3-mobile-slice-7474`.

In Cursor Desktop: the branch picker (top left) must show the same name.
If it still says `main`, click it and pick `cursor/g0-g3-mobile-slice-7474`.
Do **not** commit G5 work to `main`.

---

## Step 2 — First Android Studio launch

1. Open **Android Studio** from the desktop shortcut (Otter 2 splash is
   correct).
2. If it asks to import settings: **Do not import** unless this same
   laptop already had a working SDK you trust. A clean Standard install
   is safer.
3. Choose **Standard** install. Let it download the default SDK.
4. Accept the SDK licences.
5. If it offers to create a new project or a virtual device: **Skip /
   Cancel**. We open an existing folder. An emulator is optional.
6. Wait until you see the **Welcome** screen (New Project / Open).

First download can take 10–20 minutes. Leave it running.

---

## Step 3 — SDK Manager (match API 35)

On the Welcome screen: **More Actions → SDK Manager**.  
Or later: **File → Settings → Languages & Frameworks → Android SDK**.

### SDK Platforms tab

Tick **Android 15.0 (“VanillaIceCream”) API 35**.  
Show Package Details → also tick **Android SDK Platform 35**.

You do **not** need every older API. API 35 is the one `:app` compiles
against.

### SDK Tools tab

Tick:

- **Android SDK Build-Tools** (35.x or **36.x** — AGP 9 may ask for 36)
- **Android SDK Platform-Tools**
- **Android SDK Command-line Tools (latest)**

Leave **unchecked** unless Studio already installed them:

- NDK (Side by side)
- CMake
- Android Emulator (only if you want an AVD later; G5 does not need it)
- Google Play services / Instant Apps / Layout Inspector extras

Apply → Accept licences → wait for **Done**.

SDK location is usually:

```text
C:\Users\<you>\AppData\Local\Android\Sdk
```

Copy that path. You will see it again in `local.properties`.

---

## Step 4 — Gradle JDK 21

**File → Settings → Build, Execution, Deployment → Build Tools → Gradle**.

**Gradle JDK:** pick **jbr-21** (JetBrains Runtime bundled with Android
Studio) or any **JDK 21**.

Do not pick JDK 17. This project targets JVM 21.  
Do not download Gradle 8.x. The wrapper already pins **9.1.0**.

---

## Step 5 — Open `apps/android` (not the repo root)

**Wrong (12 Sep laptop check):** Android Studio opened
`C:\Users\…\StudioProjects\CYVRA-Mobile` (the whole repo). The yellow
banner “Android Gradle Plugin build script found apps/android” means
Studio is not in the Android project. The top git dropdown still said
`main`. **File → Close Project**, then open the inner folder below.

1. Welcome → **Open**.
2. Browse to the clone, then **`apps\android`**.
3. Select that folder → OK. The window title should end in `android`,
   and the tree should show `:app` / `:core`, not `apps/web`.
4. If it asks to trust the project: **Trust**.
5. If it asks to use Gradle wrapper: **Yes** (use the project wrapper).
6. Let it sync. First sync downloads Gradle 9.1.0 and dependencies.

Success:

- Bottom status is not red.
- Gradle tool window shows **`:core`** and **`:app`**.
- File `apps/android/local.properties` exists and contains
  `sdk.dir=C\:\\Users\\…\\AppData\\Local\\Android\\Sdk` (path will vary).

If you only see `:core`:

1. Confirm Step 3 finished (API 35 installed).
2. Open `apps/android/local.properties`. If the file is missing, in
   Studio: **File → Sync Project with Gradle Files**.
3. If it still has no `sdk.dir`, File → Settings → Android SDK → copy
   **Android SDK Location** into `sdk.dir=` yourself. Use doubled
   backslashes (`C\:\\Users\\…`) or forward slashes.
4. Sync again.

`local.properties` is gitignored. Do not commit it. Do not put secrets
in it.

---

## Step 6 — Prove the SDK without a phone

In Android Studio: **Build → Make Project**.

Or Git Bash:

```bash
cd apps/android
./gradlew.bat :core:test :app:assembleDebug
```

Expected:

- `:core:test` PASS
- File
  `apps/android/app/build/outputs/apk/debug/app-debug.apk`

That APK waits on the laptop until the owned Samsung arrives. You do
**not** need to install it on an emulator today.

If assembleDebug fails with “SDK location not found”, return to Step 5.
If it fails with Java / 21, return to Step 4.

If sync says `Unable to load class … BaseVariant`: the laptop is still on
AGP **9.0.1**. Otter 2 only supports AGP **4.1–8.13**. Git Bash cannot
`git pull` (unsigned-in). Open `apps/android/settings.gradle.kts` and
change the application plugin version to `8.13.2`, Save, then
**File → Sync Project with Gradle Files**. Do not click “Re-download
dependencies” first. Set Gradle JDK to **jbr-21**.

---

## Step 7 — Stop (phone not here yet)

Close Android Studio. The SDK and APK stay on disk.

When the **owned** Samsung is in your hand, continue
[g5-owned-samsung.md](./g5-owned-samsung.md) from **Step 4** (install the
APK). Skip its Studio install steps — you already did them here.

Unlock only with the owner’s credentials. USB debugging can stay off.
USB file copy is not authorization. No IMEI. No Knox.

---

## Do not

- Open the monorepo root in Android Studio as the Gradle project
- Commit `local.properties`, `.idea/`, or `app-debug.apk`
- Create a Play Console / App Signing setup
- Enable Knox, USB debugging, or an emulator as a substitute for the
  owned phone
- Switch Cursor back to `main` and build from there
- Flip Worker `API_ENV` or start Station
