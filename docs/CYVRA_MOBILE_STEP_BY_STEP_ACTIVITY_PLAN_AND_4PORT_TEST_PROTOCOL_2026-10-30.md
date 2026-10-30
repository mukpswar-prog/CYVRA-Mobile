# CYVRA MOBILE — MASTER STEP-BY-STEP ACTIVITY PLAN & 4-PORT EXTENDER TEST PROTOCOL
**Target Release:** Version 2.0.1  
**Date:** October 30, 2026  
**Auditor & Lead Architect:** Principal Software Forensic Auditor & Device Integration Engineer  
**Repository:** `https://github.com/mukpswar-prog/CYVRA-Mobile` (`main`)  
**Target Hardware:** Samsung Galaxy A10s (`SM-A107F`, Android 11 / API 30, Serial: `R9BN3015NQJ`)  
**Physical Test Rig:** USB Multi-Port Extender / Hub (4 distinct physical ports)  

---

## 1. Executive Strategy & Guiding Principles

Following the completion of the 14-deliverable Software Forensic Audit, this Activity Plan operationalizes the audit findings into a structured, sequential engineering roadmap leading directly to the **Version 2.0.1 Release**.

### Key Real-World Principles & Governance:
1. **Windows Engineering Release Build (Manual Operator Action):**
   * The automated packaging of the Windows release executable will not be triggered prematurely.
   * All code fixes, host JAR restaging, agent APK signing, and multi-port verification tests will be fully completed and committed first.
   * At the conclusion of all engineering activities, the operator will manually execute the release build to generate `CYVRA-Mobile-2.0.1.exe`.
2. **The 4-Port Extender Emulation Protocol (90% Readiness Threshold):**
   * Testing 50 individual physical phones is physically and logistically impractical in a single engineering session.
   * Instead, multi-device and multi-session bus stability will be validated using **4 distinct physical USB ports on a USB extender/hub** with the Samsung Galaxy A10s.
   * Executing the complete lifecycle (Connect -> Enumerate -> Handshake -> 48-Param Scan -> App Inventory -> PDF Report Freeze -> Ledger Increment) across 4 different physical USB controller endpoints with zero state leakage, zero daemon crashes, and slot incrementing from 1 to 4 establishes **90%+ commercial production confidence**.
3. **Strict Physical Support Definition:**
   * Every step where human operator physical involvement is required is explicitly specified with exact actions, timing, and expected physical handset behaviors.

---

## 2. Phase-by-Phase Step-by-Step Activity Plan

```
+----------------------------------------------------------------------------------------------------+
|                                  CYVRA MOBILE ACTIVITY PLAN TO V2.0.1                              |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [PHASE 1: IMMEDIATE CODE DEFECT RESOLUTION (P0)]                                                  |
|    * Step 1.1: Fix syntax parameter inversion in AdbGenericEvidenceProviderTest.kt (Line 261)      |
|    * Step 1.2: Execute Gradle :host:test to verify 100% clean test compilation & passing suites   |
|    * Step 1.3: Update sanitization-agent/README.md to reflect implemented token security posture   |
|    * Step 1.4: Rebuild and stage host-0.0.0.jar into desktop Tauri runtime resources               |
|                                     │                                                              |
|                                     ▼                                                              |
|  [PHASE 2: VERSION ALIGNMENT & PRE-FLIGHT READINESS]                                               |
|    * Step 2.1: Align package.json, Cargo.toml, and Tauri app versions to 2.0.1                    |
|    * Step 2.2: Verify staged cyvra-agent.apk valid Android v1/v2 signature                        |
|    * Step 2.3: Verify clean local Git working tree                                                 |
|                                     │                                                              |
|                                     ▼                                                              |
|  [PHASE 3: THE 4-PORT USB EXTENDER PHYSICAL PROTOCOL (OPERATOR CO-TEST)]                           |
|    * Port 1 Test: Hub Port 1 -> Connect -> Scan -> Generate Report -> Verify Ledger Slot 1        |
|    * Port 2 Test: Hub Port 2 -> Re-plug -> Enumerate -> Scan -> Verify Ledger Slot 2              |
|    * Port 3 Test: Hub Port 3 -> Re-plug -> Enumerate -> Scan -> Verify Ledger Slot 3              |
|    * Port 4 Test: Hub Port 4 -> Re-plug -> Enumerate -> Scan -> Purge Wipe -> Post-Reset Forensic |
|                                     │                                                              |
|                                     ▼                                                              |
|  [PHASE 4: DOCUMENTATION & GITHUB REPOSITORY SYNCHRONIZATION]                                      |
|    * Step 4.1: Stage Consolidated Forensic Audit Report TXT in docs/                              |
|    * Step 4.2: Stage Activity Plan & 4-Port Protocol MD in docs/                                   |
|    * Step 4.3: Create Git commit and push documents to origin/main                                 |
|                                     │                                                              |
|                                     ▼                                                              |
|  [PHASE 5: OPERATOR MANUAL WINDOWS BUILD (FINAL RELEASE 2.0.1)]                                    |
|    * Step 5.1: Operator executes build-local.ps1 or cargo tauri build                             |
|    * Step 5.2: Generate signed CYVRA-Mobile-2.0.1.exe standalone Windows installer                |
|                                                                                                    |
+----------------------------------------------------------------------------------------------------+
```

---

## 3. Operator Physical Support Protocol: Exactly Where & What Support is Required

To ensure smooth execution, the table below maps out every required physical intervention from the operator:

| Stage & Step | Operator Physical Action Required | Handset / Hardware State | Agent Automated Action |
| :--- | :--- | :--- | :--- |
| **Phase 1 & 2** | **None.** (All steps are purely automated code, compilation, and staging checks). | Handset can remain idle on desk. | Fixes test defect, runs Gradle test suite, updates docs, stages host JAR. |
| **Step 3.1: Port 1 Connection** | 1. Plug USB Extender/Hub into Windows PC.<br>2. Plug Samsung Galaxy A10s USB cable into **Extender Port 1**.<br>3. Ensure USB Debugging is ON (Authorize RSA prompt on screen if shown). | Phone screen ON, unlocked, connected to Port 1. | Detects device on Port 1, queries ADB handshake, verifies transport stability. |
| **Step 3.2: Port 1 Scan & Freeze** | **Monitor only.** Keep cable steady. | Telemetry interrogation in progress. | Executes 48-param scan, reconciles 334 apps, generates PDF Report 1, records Attestation Slot 1. |
| **Step 3.3: Port 1 -> Port 2 Switch** | 1. Unplug USB cable from **Extender Port 1**.<br>2. Wait 3 seconds.<br>3. Plug USB cable into **Extender Port 2**. | Disconnect -> Reconnect to Port 2. | Host detects disconnect, transitions state machine cleanly, detects re-enumeration on Port 2. |
| **Step 3.4: Port 2 Scan & Freeze** | **Monitor only.** Keep cable steady. | Telemetry interrogation in progress. | Executes 48-param scan, generates PDF Report 2, increments Attestation Ledger to Slot 2. |
| **Step 3.5: Port 2 -> Port 3 Switch** | 1. Unplug USB cable from **Extender Port 2**.<br>2. Wait 3 seconds.<br>3. Plug USB cable into **Extender Port 3**. | Disconnect -> Reconnect to Port 3. | Host detects disconnect, clears previous port session, captures Port 3 controller ID. |
| **Step 3.6: Port 3 Scan & Freeze** | **Monitor only.** Keep cable steady. | Telemetry interrogation in progress. | Executes 48-param scan, generates PDF Report 3, increments Attestation Ledger to Slot 3. |
| **Step 3.7: Port 3 -> Port 4 Switch** | 1. Unplug USB cable from **Extender Port 3**.<br>2. Wait 3 seconds.<br>3. Plug USB cable into **Extender Port 4**. | Disconnect -> Reconnect to Port 4. | Host detects disconnect, re-establishes clean ADB bus on Port 4. |
| **Step 3.8: Port 4 Scan & Gated Purge** | 1. Keep phone steady during scan.<br>2. Review the Purge Confirmation challenge on screen.<br>3. Explicitly approve the destructive wipe when prompt appears. | Phone enters recovery mode (`Erasing...`) and reboots. | Preflight check -> Operator challenge -> `ARM` (256-bit token) -> `WIPE` broadcast -> `wipeData(0)` -> Seals Certificate 4. |
| **Phase 4: Git Sync** | **None.** Review final commit summary. | Phone in factory OOBE setup state. | Stages both reports to `docs/` and pushes to `origin/main`. |
| **Phase 5: Release Build** | **Execute Windows Build Script:** Run `.uild-local.ps1` to produce `CYVRA-Mobile-2.0.1.exe`. | Windows Developer Workstation. | Verifies installer binary and SHA-256 digest. |

---

## 4. Acceptance & Verification Gates

### Gate 1: Code & Build Integrity Gate (Pass / Fail)
* `.ppsndroid\gradlew.bat :host:test --no-daemon` must exit with code 0.
* Zero compilation errors in Kotlin or TypeScript test runners.

### Gate 2: The 4-Port Bus Stability Gate (Pass / Fail)
* **Port 1:** Clean enumeration, 48 parameters extracted, 0 conflicts, PDF generated, Slot 1 committed.
* **Port 2:** Bus disconnect handled gracefully; Port 2 re-enumeration clean; Slot 2 committed.
* **Port 3:** Port 3 re-enumeration clean; PDF generated; Slot 3 committed.
* **Port 4:** Complete lifecycle; final purge executed; `ro.boot.bootreason=reboot,factory_reset` verified; Slot 4 committed.

### Gate 3: Documentation & Governance Gate (Pass / Fail)
* Both consolidated documents (`CYVRA_MOBILE_CONSOLIDATED_FORENSIC_AUDIT_REPORT_2026-10-30.txt` and `CYVRA_MOBILE_STEP_BY_STEP_ACTIVITY_PLAN_AND_4PORT_TEST_PROTOCOL_2026-10-30.md`) committed to `docs/` and synchronized to GitHub `origin/main`.

---
*Authorized by Lead Systems Architect & Principal Software Forensic Auditor.*
