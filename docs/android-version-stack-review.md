# Android version stack — review only (14 Sep 2026)

**Do not upgrade. Do not change pins. Do not Build APK until the CEO guidebook is accepted.**

This file records the **input to verify**, what is on disk today, and why we did **not** jump to AGP 9 on 12 Sep. It is not an implementation ticket.

Start file: [resume-g8-freeze.md](./resume-g8-freeze.md).  
Laptop checklist (paused): [g5-laptop-work.md](./g5-laptop-work.md).

---

## Input 1 — “Upgrade all to latest; AGP 9 has built-in Kotlin / KGP 2.2.10”

**Verdict: the Google/JetBrains fact is true. Taking AGP 9.0.1 on this laptop on 12 Sep was not.**

Android’s AGP 9.0 notes:

- Built-in Kotlin is **on by default**. You should **not** apply `org.jetbrains.kotlin.android` unless you opt out.
- AGP 9 has a **runtime dependency on KGP 2.2.10**. A lower KGP is upgraded to 2.2.10. Built-in Kotlin **requires** KGP ≥ 2.2.10.
- Opt-out (`android.builtInKotlin=false`, `android.newDsl=false`) is temporary and goes away in AGP 10.
- JetBrains: AGP 9 in Android Studio needs **Otter 3 Feature Drop or later**.

What we hit on 12 Sep:

| Machine | Studio | What happened |
|---|---|---|
| First install | Otter 2 | Official max AGP **8.13**. AGP **9.0.1** + `kotlin-android` → `Unable to load class BaseVariant` / `KotlinAndroidTarget`. |
| After reinstall | **Quail 4 / 2026.1.4** | This Studio **can** load AGP 9 in principle. We still pinned **8.13.2** so Otter-2 crash did not return, and so the APK path stayed unblocked. |

So: Kotlin 2.2.10 **is** the KGP that AGP 9 embeds. That does **not** mean “flip to AGP 9 today.” Quail 4 makes AGP 9 a **review candidate**, not an automatic upgrade. Wait for the guidebook.

---

## Input 2 — name the six parameters

**Verdict: the table is correct.** These are different knobs. Do not collapse them into “latest Android.”

| Parameter | Purpose | On disk now (`apps/android`) |
|---|---|---|
| **Kotlin** | Language + compiler (`jvmTarget` 21) | Kotlin **2.2.10** for `:core` and `:app` (`kotlin("jvm")` / `kotlin("android")`) |
| **KGP** | Kotlin Gradle Plugin — how Kotlin hooks into Gradle | Same **2.2.10** (explicit). AGP 9 would **also** bring KGP 2.2.10 as a runtime dep if we moved |
| **AGP** | Android Gradle Plugin — Android packaging, R, dex, variants | **8.13.2** (`com.android.application`). Not 9.0.1 |
| **Gradle** | Build engine (wrapper) | **9.1.0** (needed so a Java 25 Gradle daemon can start) |
| **compileSdk** | APIs allowed **at compile time** | **35** |
| **targetSdk** | Which Android **behaviour** the OS applies | **35** |
| **minSdk** | Oldest Android that **may install/run** the APK | **29** (Android 10) |

`compileSdk` / `targetSdk` 35 do **not** drop old phones. **`minSdk` does.**

---

## `minSdk` and an old Samsung fleet

**`minSdk` is the fleet gate.** Store and `PackageManager` refuse install if `Build.VERSION.SDK_INT < minSdk`.

| minSdk | Android | Who it cuts |
|---|---|---|
| **29** (current) | 10 | Android 9 (Pie, API 28) and older cannot install |
| 28 | 9 | Still excludes Oreo/Nougat |
| 26 | 8.0 | Common “old A-series / J-series” floor |
| 24 | 7.0 | Very old; more API gaps in S1 |

S1 uses public APIs (`Build`, feature flags, `ANDROID_ID`). GUIDELINE: no IMEI, no Knox in S1. Lowering `minSdk` is a **product** decision (which owned Samsungs must run Evidence), not a compiler fashion upgrade. Do not lower or raise it in this pause.

We have **not** enumerated the live fleet here. When the guidebook lists models, map each to `Build.VERSION.SDK_INT` before touching `minSdk`.

---

## Current vs “latest” (do not apply)

| Knob | Now | “Latest” input (review) | Decision |
|---|---|---|---|
| AGP | 8.13.2 | 9.0.1 + built-in Kotlin, drop `kotlin-android` | **Hold.** Quail 4 could try this later; Otter 2 could not |
| KGP / Kotlin | 2.2.10 explicit | 2.2.10 bundled inside AGP 9 | Already on 2.2.10. No hurry |
| Gradle | 9.1.0 | 9.1.0 is AGP 9’s minimum | Keep |
| compileSdk / targetSdk | 35 | 36.x exists under AGP 9 | Hold until guidebook |
| minSdk | 29 | Fleet-driven | Hold until model list |
| Studio | Quail 4 / 2026.1.4 | — | Keep. Do not reinstall again for this review |

---

## Paused human work

1. CEO guidebook / process book (in progress). This agent waits.
2. After that book is accepted: decide AGP 8.13.2 vs AGP 9 **once**, then laptop **Build APK**.
3. Owned Samsung still required for G5 ingest. No emulator substitute.

Do not: bump AGP, drop `kotlin-android`, change `minSdk`, flip `API_ENV`, start Station/Knox, or Build APK in this pause.
