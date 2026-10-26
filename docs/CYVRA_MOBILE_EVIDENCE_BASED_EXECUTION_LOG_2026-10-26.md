# CYVRA MOBILE — EVIDENCE-BASED EXECUTION LOG
**Authorised Sanitization Agent Delivery & Physical Device Verification**  
**Date / Timestamp:** 2026-10-26T15:22:00+05:30  
**Target Device Serial:** `R9BN3015NQJ` (Samsung Galaxy A10s, `SM-A107F`, Android 11, API 30)  
**Execution Authority:** Authorised Execution Directive from Chief Engineer  

---

## 1. Baseline & Environment Verification

- **Repository Root:** `C:\Users\User\Documents\GitHub\CYVRA-Mobile`
- **Branch:** `main` (commit `335f4ea4ed642b05d341621a85db35028ece1dc2`)
- **Status:** Uncommitted changes preserved on `main` (no commits, pushes, resets, or discarded files).
- **Target Hardware Identity:**
  - Serial: `R9BN3015NQJ`
  - Model: `SM-A107F`
  - OS Version: Android 11 (SDK 30)
  - Transport: USB (`transport_id: 1`)
  - State: `device` (Authorized on ADB)

---

## 2. Release-Grade Sanitization Agent Verification

- **Source Module:** `apps/android/sanitization-agent`
- **Release APK Output:** `apps/android/sanitization-agent/build/outputs/apk/release/sanitization-agent-release.apk`
- **APK File Size:** 663,084 bytes
- **APK SHA-256 Hash:** `21BF1CA80DBAB1444D6A7645EFFE1FEB85729810F89C0764152FDACA2FB90A3F` (Matches Expected Exactly)
- **Package Name:** `com.cyvra.sanitization`
- **Version Name / Code:** `1.0.0` / `1`
- **SDK Range:** Min SDK `26` (Android 8.0 Oreo), Target SDK `36`
- **Flags:** `testOnly=false`, `debuggable=false`
- **Signature Scheme:** APK Signature Scheme v2 (`apksigner verify --verbose` verified `true`)
- **Signer Certificate SHA-256 Digest:** `00:97:E3:82:91:8A:30:0F:8A:F7:1B:4E:27:69:41:FC:B4:11:58:F8:0C:F1:67:76:B0:77:24:54:BC:B9:CC:2A` (Matches Expected Exactly)

---

## 3. Physical Installation & Device Owner Provisioning

### 3.1 Installation Output
```powershell
adb -s R9BN3015NQJ install -r "C:\Users\User\Documents\GitHub\CYVRA-Mobile\apps\android\sanitization-agent\build\outputs\apk\release\sanitization-agent-release.apk"
# Result: Success (390 KB/s, 663084 bytes in 1.658s)
```

### 3.2 Package Verification on Device
```powershell
adb -s R9BN3015NQJ shell pm list packages -f com.cyvra.sanitization
# Output:
# package:/data/app/~~xtMuY22itpBqJq1heCpjbg==/com.cyvra.sanitization-_7QM_8ID0bnXmxg4sk-Ncg==/base.apk=com.cyvra.sanitization
# versionCode=1 minSdk=26 targetSdk=36
# versionName=1.0.0
# signatures=PackageSignatures{2c859a version:2, signatures:[14cd0f5e], past signatures:[]}
```

### 3.3 Account Preflight & Device Owner Provisioning
```powershell
# Account check: 0 accounts present on device
# Command:
adb -s R9BN3015NQJ shell dpm set-device-owner com.cyvra.sanitization/.SanitizationAdmin

# Output:
Success: Device owner set to package ComponentInfo{com.cyvra.sanitization/com.cyvra.sanitization.SanitizationAdmin}
Active admin set to component {com.cyvra.sanitization/com.cyvra.sanitization.SanitizationAdmin}
```

### 3.4 Device Policy Verification
```powershell
adb -s R9BN3015NQJ shell dumpsys device_policy
# Output:
# Current Device Policy Manager state:
#   Device Owner: 
#     admin=ComponentInfo{com.cyvra.sanitization/com.cyvra.sanitization.SanitizationAdmin}
#     package=com.cyvra.sanitization
#     com.cyvra.sanitization/.SanitizationAdmin:
#       uid=10223
#       testOnlyAdmin=false
#       policies:
#         wipe-data
```

### 3.5 Foreground UI Verification
```powershell
adb -s R9BN3015NQJ shell am start -n com.cyvra.sanitization/.MainActivity
# Output:
# Starting: Intent { cmp=com.cyvra.sanitization/.MainActivity }
# mCurrentFocus=Window{33ced31 u0 com.cyvra.sanitization/com.cyvra.sanitization.MainActivity}
```

---

## 4. Live Host Diagnostic Scans & PDF Generation

### 4.1 Entitlement & Host Preflight
- **License File:** `C:\ProgramData\CYVRA Mobile\entitlement.json` (server-signed, verified `cyvra.entitlement.v1`)
- **License ID:** `LIC-***REDACTED***` (Customer: `[REDACTED_OPERATOR]`, `[REDACTED_EMAIL]`)
- **Status:** `ACTIVE` (10 remaining scans, valid until 2027-10-18)
- **Host Preflight (`GET_PREFLIGHT`):** `readyToScan: true` across OS, 64-bit architecture, Java 21, and bundled ADB locator.
- **Device Discovery (`GET_CONNECTED_DEVICES`):** Serial `R9BN3015NQJ`, State `authorized`, Model `SM_A107F`, Make `samsung`.

### 4.2 Hardware Scan (`RUN_SCAN`)
- **Request ID:** `req-scan-1`
- **Session UUID:** `c9a4febe-05ac-44e5-8936-d82bada831c3`
- **Device Lifecycle ID:** `26d7d7ee-c33d-340f-99f8-8a4c9d63d1f2`
- **Report ID:** `CYVRA-R1-2026-AB3F49`
- **Status:** `COMPLETED`
- **PDF Report Path:** `C:\Users\User\Downloads\CYVRA\CYVRA_001_R9BN3015NQJ-c9a4febe_HW_SCAN_20261026-093734.pdf`
- **PDF File Size:** 3,923 bytes
- **PDF SHA-256 Digest:** `3319DEA7838B7D38571033A9365DE423613CD7A7E585687E020BAD9BE46CB311` (Confirmed on disk)

### 4.3 Application Inventory Scan (`GET_APPLICATION_INVENTORY`)
- **Request ID:** `req-app-1`
- **Session UUID:** `c9a4febe-05ac-44e5-8936-d82bada831c3`
- **Device Lifecycle ID:** `26d7d7ee-c33d-340f-99f8-8a4c9d63d1f2`
- **Total Applications Enumerated:** 334
  - Preinstalled System Apps: 329
  - User 3rd-Party Apps: 5
  - Enabled Apps: 333
  - Disabled Apps: 1
- **Completeness:** `COMPLETE`
- **PDF Report Path:** `C:\Users\User\Downloads\CYVRA\CYVRA_002_R9BN3015NQJ-c9a4febe_APP_SCAN_20261026-093734.pdf`
- **PDF File Size:** 35,845 bytes
- **PDF SHA-256 Digest:** `9935210193752178046C71940E823E304B9D688FEDC0C6FBA5476CA48907E022` (Confirmed on disk)

---

## 5. Sanitization Protocol & Token Safeguards Verification

Physical validation of the two-step ARM $\rightarrow$ WIPE safeguard on device `R9BN3015NQJ`:

```powershell
# 1. Unarmed WIPE attempt
adb -s R9BN3015NQJ shell am broadcast -n com.cyvra.sanitization/.SanitizationBroadcastReceiver -p com.cyvra.sanitization -a com.cyvra.sanitization.WIPE --es wipeToken FAKE_TOKEN_UNARMED
# Logcat: 10-26 15:13:23.346 27214 27214 W CYVRA-SanitizeReceiver: WIPE rejected: agent was not armed with token

# 2. ARM command with token
adb -s R9BN3015NQJ shell am broadcast -n com.cyvra.sanitization/.SanitizationBroadcastReceiver -p com.cyvra.sanitization -a com.cyvra.sanitization.ARM --es wipeToken TEST_ARM_TOKEN_SAFE
# Logcat: 10-26 15:13:23.772 27214 27214 I CYVRA-SanitizeReceiver: Agent armed with token for 60s window

# 3. Mismatched token WIPE attempt
adb -s R9BN3015NQJ shell am broadcast -n com.cyvra.sanitization/.SanitizationBroadcastReceiver -p com.cyvra.sanitization -a com.cyvra.sanitization.WIPE --es wipeToken MISMATCHED_TOKEN
# Logcat: 10-26 15:13:24.725 27214 27214 W CYVRA-SanitizeReceiver: WIPE rejected: token mismatch
```

**Verification Verdict:**
- The mobile agent successfully rejected unauthorized / unarmed triggers.
- The mobile agent armed successfully with a 60-second TTL.
- The mobile agent failed closed on token mismatch and disarmed immediately.
- The device remains intact without unintended data loss.

---

## 6. Automated Test Suite Results

- **Sanitization Agent Debug Unit Tests:**
  - Command: `.\gradlew.bat :sanitization-agent:testDebugUnitTest --console=plain`
  - Total Tests: 9 passed, 0 failed, 100% success rate.
- **Host Subsystem Tests:**
  - Command: `.\gradlew.bat :host:test --console=plain`
  - Total Tests: 416 passed, 0 failed, 100% success rate.
- **Desktop Typecheck & Unit Tests:**
  - `pnpm.cmd run typecheck`: 0 errors.
  - Vitest Desktop Suite: 83 passed across 7 test files, 100% success rate.

---

## 7. Status & Destructive Wipe Execution Boundary

| Milestone / Gate | Status | Evidence |
| :--- | :--- | :--- |
| Baseline Verified | **PASSED** | Commit `335f4ea`, working tree changes preserved |
| Agent Policy Documented | **PASSED** | [`docs/CYVRA_SANITIZATION_AGENT_POLICY_V1.md`](file:///C:/Users/User/Documents/GitHub/CYVRA-Mobile/docs/CYVRA_SANITIZATION_AGENT_POLICY_V1.md) |
| Release Agent Hardened & Built | **PASSED** | APK SHA-256 `21BF1CA8...`, cert verified |
| Agent Installed on Hardware | **PASSED** | `com.cyvra.sanitization` v1.0.0 on `R9BN3015NQJ` |
| Device Owner Provisioned | **PASSED** | `dpm set-device-owner` Success, `wipe-data` active |
| H/W Scan Completed & PDF Generated | **PASSED** | `CYVRA_001_..._HW_SCAN_...pdf` (3,923 B) on disk |
| App Scan Completed & PDF Generated | **PASSED** | `CYVRA_002_..._APP_SCAN_...pdf` (35,845 B) on disk |
| ARM/WIPE Protocol Safeguard Tested | **PASSED** | Logcat confirms rejection of unarmed & mismatched tokens |
| Missing PDF Mystery Resolved | **RESOLVED** | PDFs write to `%USERPROFILE%\Downloads\CYVRA\`, not root Downloads |
| Destructive Hardware Wipe Trigger | **HOLDING AT BOUNDARY** | Awaiting final Chief Engineer go-ahead |
