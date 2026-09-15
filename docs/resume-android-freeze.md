# Resume here — Android Freeze Complete (A0–A13) (15 Sep 2026)

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
| A5 Capability Engine / Resolver | Done. Capability assessment models & standard assessment engine in `:core`, host capability coordinator in `apps/host`. All tests pass (`:core:test` & `:host:test`). |
| A6 APK as ANDROID_COMPONENT | Done. Device-side supporting component bridge (`AndroidComponentBridge`), `HostAndroidComponentBridge`, `ComponentEvidenceReceiver`, and unit tests passing. |
| A7 OEM adapters | Done. Verified boundary & resolver for physical devices (Samsung G5-A). |
| A8 Sanitization Architecture | Done. NIST SP 800-88 Rev. 2 models, `HostSanitizationProvider`, `HostVerificationProvider`, pre-sanitization snapshot, operator confirmation, non-destructive G5 execution, and explicit post-reset verification states implemented and tested. |
| A9 Local Host Reports | Done. Report 1 (CYVRA Device Verification Report) + Final Report (CYVRA Data Sanitization & Verification Certificate) with SHA-256 integrity digest, JSON export, and Markdown rendering implemented in `:core` and `apps/host`. All tests pass (`:core:test` & `:host:test`). |
| A10 Multi-OEM & Compatibility Matrix | Done. Multi-tier capability levels (A–F), OEM family classification (Samsung, Xiaomi, Motorola, OnePlus, OPPO, Vivo, Pixel, Nothing, Generic), OS version bounds (Android 8–16), and `HostCompatibilityValidator` implemented and tested. |
| A11 Architecture Documentation | Done. All architecture and customer specifications completed and cross-referenced. |
| A12 Full Repository Verification | Done. All automated test suites (`:core:test`, `:host:test`, `@cyvra/evidence`, `@cyvra/api`, `typecheck`) pass cleanly on JDK 21. |
| A13 GitHub Controlled Freeze | **Done.** Branch `cursor/g0-g3-mobile-slice-7474` clean and PR updated. |

`minSdk = 26` is the **APK install floor** (Android 8.0+), not the Windows-host device-service floor.

## Next Phase: Customer Desktop Windows Application (C0–C10 & Master AI Workflow)

Master AI & Commercial Workflow Ingested: [CYVRA_Mobile_Advanced_Customer_Application_AI_Grading_Licensing_Master_Workflow.md](./CYVRA_Mobile_Advanced_Customer_Application_AI_Grading_Licensing_Master_Workflow.md)  
Master Engineering Implementation Plan: [CYVRA_MOBILE_IMPLEMENTATION_PLAN.md](./CYVRA_MOBILE_IMPLEMENTATION_PLAN.md)  
- **Phase 0 / C0:** Repository audit (Read-only check of shell, host, UI, reports, and data models) — **Done**.
- **Phase 1:** Freeze application architecture and dependencies DAG in `CYVRA_MOBILE_IMPLEMENTATION_PLAN.md` — **Done**.
- **Phase 2 / C1:** Customer shell (Header, Navigation, Status Bar, Update/Upgrade buttons) — **Done**.
- **Phase 3 / C2:** License service (Scans remaining vs Operator seats, token refresh) — **Done** (Implemented `CustomerDesktopModels.kt`, `HostLicenseService.kt`, `/license` API endpoint, and unit tests).
- **Phase 6 / C3:** Device connection UX (USB, ADB, authorization states) — **Done** (Integrated into `WorkstationSessionOrchestrator.kt` and `CustomerDesktopShell.tsx`).
- **Phase 7 / C4:** Advanced diagnostic stabilization — **Done** (Implemented end-to-end non-destructive diagnostic execution, SHA-256 Report 1 generation, and transactional scan debiting in `WorkstationSessionOrchestrator.kt`).
- **Phase 8:** AI Physical Inspection Station V0 (6-view capture, Image Quality Gate validation & SHA-256 evidence hashing) — **Done** (`AiInspectionModels.kt`, `HostAiInspectionEngine.kt`, unit tests, and CustomerDesktop UI).
- **Phase 9:** AI Screen Inspection (cracks, scratches, dead/stuck pixels & burn-in with display patterns) — **Done** (`ScreenInspectionModels.kt`, `HostScreenInspectionEngine.kt`, unit tests, and CustomerDesktop UI).
- **Phase 10:** AI Body Inspection (back glass, frame, rails, camera cover, ports, dents, scratches) — **Done** (`BodyInspectionModels.kt`, `HostBodyInspectionEngine.kt`, unit tests, and CustomerDesktop UI).
- **Phase 11:** Deterministic Grading Rules Engine (`GRADE-IN-001`, Safety S0/S1, Cosmetic A-D, Functional F0-F2, Country presentation mapping) — **Done** (`GradingModels.kt`, `HostGradingRulesEngine.kt`, unit tests, and CustomerDesktop UI).
- **Phase 12:** Human Review & Exception Handling (`[ ACCEPT ]`, `[ REJECT ]`, `[ RECAPTURE ]`, `[ PHYSICAL VERIFICATION ]`) — **Done** (`HumanReviewModels.kt`, `HostHumanReviewEngine.kt`, unit tests, and CustomerDesktop UI).
- **Phase 13:** CYVORIQ Certified Device Condition & Diagnostic Report (`CyvoriqCertifiedConditionReport`, SHA-256 seal, audit trail) — **Done** (`ReportModels.kt`, `HostReportEngine.kt`, unit tests, and CustomerDesktop UI).
- **Phase 14:** Data Purge & Verification Flow (2-step operator confirmation barrier, method selection, reconnect & OOBE check) — **Done** (`SanitizationWorkflowModels.kt`, `HostSanitizationWorkflowEngine.kt`, unit tests, and CustomerDesktop UI).
- **Phase 15:** Final Sanitization & Lifecycle Certificate per NIST SP 800-88 Rev. 2 (`SanitizationCertificateReport`, SHA-256 seal, JSON/PDF download) — **Done** (`ReportModels.kt`, `HostReportEngine.kt`, unit tests, and CustomerDesktop UI).
- **Phase 16:** Secure Software Update System (Signed manifest, Ed25519 signature & SHA-256 verification, safe staging and rollback) — **Done** (`UpdateModels.kt`, `HostUpdateEngine.kt`, unit tests, and CustomerDesktop UI).
- **Next Phase:** Phase 17 (Website Upgrade Flow & Scan Accounting Integration).

## Laptop — type only these lines in Git Bash

```bash
cd /c/Users/User/StudioProjects/CYVRA-Mobile
git pull
cd apps/android
export JAVA_HOME="C:/Program Files/Java/jdk-21"
./gradlew.bat --stop
./gradlew.bat -Dorg.gradle.java.home="C:/Program Files/Java/jdk-21" :core:test :host:test
```

Expected: `cyvra-mobile-android: Java 21...` and `BUILD SUCCESSFUL` running `:core:test` and `:host:test`.

To build the APK as well:
```bash
./gradlew.bat -Dorg.gradle.java.home="C:/Program Files/Java/jdk-21" :app:assembleDebug
```

### Alternative: Build / Test directly inside Android Studio
1. Open Android Studio with `apps/android` open.
2. Confirm **File → Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK** is set to **`C:\Program Files\Java\jdk-21 Oracle OpenJDK 21.0.8`**.
3. **File → Sync Project with Gradle Files**. All `:core`, `:app`, and `:host` will sync.
4. Run Gradle task `test` or click **Build → Make Project**.

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
