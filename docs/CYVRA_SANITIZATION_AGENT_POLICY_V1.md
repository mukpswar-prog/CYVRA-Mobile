# CYVRA MOBILE — Sanitization Agent Policy (v1.0)

**Document ID:** `CYVRA-POL-AGENT-01`  
**Version:** 1.0.0  
**Date:** 2026-10-26  
**Status:** DRAFT POLICY FOR CHIEF ENGINEER RATIFICATION  
**Governing Authorities:**
- Freeze Guide (`CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md` §27–§36)
- Engineering Execution Directive (2026-10-25 §4.8, §4.10)
- Factory Reset Proof (`CYVRA_FACTORY_RESET_PROOF_2026-10-12.md`)
- Stage 5 Purge Verification Contract (`CYVRA_STAGE5_PURGE_VERIFICATION_CONTRACT.md`)
- Governance Ledger (`CYVRA_GOVERNANCE_LEDGER.md` §A29)

---

## 1. Purpose, Boundaries, Trust Model, and OEM Assumptions

### 1.1 Purpose
The CYVRA Sanitization Agent (`com.cyvra.sanitization`) is a dedicated on-device Android security component that executes verified, operator-authorized, cryptographic and factory-reset data erasures compliant with NIST SP 800-88 Rev. 2.

### 1.2 Boundaries & Trust Model
- `[APPROVED REQUIREMENT]` The agent operates under the principle of **least privilege**. It declares no `INTERNET` permission and cannot establish remote network connections.
- `[APPROVED REQUIREMENT]` The agent is not an autonomous background daemon. It executes only in response to explicit, authenticated commands issued via controlled desktop ADB transport from the operator workstation.
- `[APPROVED REQUIREMENT]` Workstation trust is rooted in the host licensing and entitlement engine (`HostLicenseService`); the agent itself never authenticates cloud accounts directly.
- `[PROPOSED CONTROL]` The agent trust model is **fail-closed**: if preflight validation, token verification, device identity, or Device Owner status is missing, incomplete, or ambiguous, the agent refuses execution immediately.

### 1.3 OEM Assumptions
- `[APPROVED REQUIREMENT]` Target Android OS floor is Android 8.0 (API level 26) up to Android 16 (API level 36).
- `[PROPOSED CONTROL]` Standard Android Device Policy Management APIs (`DevicePolicyManager.wipeData(0)`) are assumed to format userdata and cache partitions across certified Android Open Source Project (AOSP) and standard OEM distributions (Samsung, Google, Xiaomi, Motorola, BBK).
- `[PROPOSED CONTROL]` Devices with active proprietary FRP (Factory Reset Protection) or enterprise MDM locks outside CYVRA must be unenrolled prior to provisioning.

---

## 2. Package Identity, Release Signing, and Key Custody

### 2.1 Package Identity
- `[APPROVED REQUIREMENT]` Package Name: `com.cyvra.sanitization`
- `[APPROVED REQUIREMENT]` Admin Component: `com.cyvra.sanitization/.SanitizationAdmin`
- `[APPROVED REQUIREMENT]` Command Receiver: `com.cyvra.sanitization/.SanitizationBroadcastReceiver`

### 2.2 Release Signing & Key Custody
- `[APPROVED REQUIREMENT]` **Zero Private Keys in Source Control**: Production signing keystores, key aliases, and passwords must NEVER be committed to Git, staged in CI scripts, or stored in public directories.
- `[APPROVED REQUIREMENT]` The debug keystore is strictly reserved for local development and unit test fixtures.
- `[PROPOSED CONTROL]` Release builds must be signed using a dedicated release keystore owned and held exclusively by the Chief Engineer.
- `[PROPOSED CONTROL]` The Windows Host and staging scripts verify the agent's SHA-256 signing certificate fingerprint against an allowlist pinned in `HostSecurityAuditEngine` before allowing deployment to any intake device.

---

## 3. Operator-Controlled Installation & Device Owner Provisioning

### 3.1 Installation Policy
- `[APPROVED REQUIREMENT]` **No Unconditional Installer Installation**: The Windows desktop application installer must never run `adb install` against connected devices during workstation software setup.
- `[APPROVED REQUIREMENT]` Installation onto a mobile device occurs **only** when an operator explicitly initiates "Prepare Device" in the desktop UI for that specific device slot.

### 3.2 Provisioning Workflow
- `[APPROVED REQUIREMENT]` Step 1: Push release-signed APK via `adb -s <serial> install -r <apkPath>`.
- `[APPROVED REQUIREMENT]` Step 2: Query device account status (`dumpsys account`).
  - If accounts exist: Refuse Device Owner setup with error `ACCOUNTS_PRESENT: Remove all Google/OEM accounts before provisioning`.
- `[APPROVED REQUIREMENT]` Step 3: Enroll as Device Owner via `adb -s <serial> shell dpm set-device-owner com.cyvra.sanitization/.SanitizationAdmin`.
- `[APPROVED REQUIREMENT]` Step 4: Verify enrollment via `dumpsys device_policy`.

---

## 4. Permissions, Command Validation, and Replay Protection

### 4.1 Permissions
- `[APPROVED REQUIREMENT]` Declares `<uses-policies><wipe-data /></uses-policies>` in `res/xml/device_admin.xml`.
- `[APPROVED REQUIREMENT]` Receivers must be guarded with `android:permission="android.permission.BIND_DEVICE_ADMIN"` or signature-level permission so unauthorized 3rd-party apps cannot invoke administrative actions.
- `[APPROVED REQUIREMENT]` Does not request `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `CAMERA`, or `INTERNET`.

### 4.2 Two-Step ARM → WIPE Protocol & Replay Protection
- `[PROPOSED CONTROL]` **Step 1: ARM Phase**
  - Host generates a cryptographically random, canonical UUID one-time token (`wipeToken`) with a 60-second time-to-live (TTL).
  - Host broadcasts `com.cyvra.sanitization.ARM` with extras: `targetSerial`, `sessionUuid`, `wipeToken`, `timestamp`.
  - Agent validates target parameters, stores `wipeToken`, enters `ARMED` state, and returns `ARM_ACK`.
- `[PROPOSED CONTROL]` **Step 2: WIPE Phase**
  - Host broadcasts `com.cyvra.sanitization.WIPE` with matching `wipeToken` and operator authorization phrase hash.
  - Agent validates `wipeToken`:
    - If token does not match, is expired (>60s), or has already been used: agent immediately disarms, logs `TOKEN_REJECTED`, and fails closed.
    - If valid: agent consumes the token (invalidating it for any future invocation) and invokes `DevicePolicyManager.wipeData(0)`.

---

## 5. Diagnostics & Inventory Interfaces

### 5.1 Hardware Diagnostics Interface
- `[APPROVED REQUIREMENT]` Hardware inventory data is collected via standard Android system services and ADB host shell queries.
- `[APPROVED REQUIREMENT]` Sensor coverage reports honest tri-state outcomes:
  - `WORKING`: Functional test verified valid response within bounds.
  - `NOT WORKING`: Hardware detected but test failed.
  - `N/A`: Component/sensor confirmed absent on this device SKU.
  - `NOT VERIFIED`: Capability detected but not exercised.

### 5.2 Application Inventory Interface
- `[APPROVED REQUIREMENT]` Collected pre-sanitization via `pm list packages -f -u` and parsed into structured JSON before wipe authorization.
- `[APPROVED REQUIREMENT]` Packages classified into `SYSTEM` vs `USER` applications.

---

## 6. Device Identity Binding & Slot Isolation

- `[APPROVED REQUIREMENT]` Every request, report, and agent operation is strictly bound to `(deviceSerial, deviceLifecycleId, sessionUuid)`.
- `[APPROVED REQUIREMENT]` A disconnect or USB port change immediately invalidates cached slot state and cancels any pending ARM token.
- `[APPROVED REQUIREMENT]` Multi-device isolation guarantees that commands dispatched to Slot N can never execute on Slot M.

---

## 7. Sanitization Dispatch & Immediate Session Closure

- `[APPROVED REQUIREMENT]` **Immediate Session Closure Law**:
  - Once `WIPE` is successfully dispatched to the agent, the desktop application immediately closes that device's active application session and marks the workflow `COMPLETED`.
  - The desktop application does **NOT** hang waiting for the reset phone to reboot or reconnect over USB.
- `[APPROVED REQUIREMENT]` **Delivery is Not Erasure**:
  - Dispatch success indicates the trigger was accepted by the Device Owner agent.
  - Physical completion is recorded in the third report (`Sanitization Verification Report`) as *Pending Post-Reset Verification* until a separate intake verification scan is conducted.

---

## 8. Agent Removal and Post-Reset Behavior

- `[APPROVED REQUIREMENT]` `DevicePolicyManager.wipeData(0)` triggers internal storage formatting and factory reset.
- `[APPROVED REQUIREMENT]` Because the agent is installed on `/data/app` (not integrated into `/system`), standard AOSP factory reset clears `/data` and completely removes the CYVRA sanitization agent APK and its device admin enrollment.
- `[PROPOSED CONTROL]` Acceptance testing must physically verify on the test device that post-reboot `pm list packages com.cyvra.sanitization` returns absent (exit code non-zero or empty).

---

## 9. Rollback & Recovery

- `[PROPOSED CONTROL]` **Operator Removal Flow**: If the operator cancels sanitization prior to the `WIPE` command, the desktop provides a "Remove Agent" action:
  1. `adb shell dpm remove-active-admin com.cyvra.sanitization/.SanitizationAdmin`
  2. `adb shell pm uninstall com.cyvra.sanitization`
- `[PROPOSED CONTROL]` Restores device to clean, unmanaged state with zero residual admin permissions.

---

## 10. Status Classification Matrix

| Clause | Description | Governing Category |
|---|---|---|
| §1.1–1.3 | Boundaries, trust model, least privilege | `[APPROVED REQUIREMENT]` |
| §2.1–2.2 | Package ID, release signing outside Git | `[APPROVED REQUIREMENT]` |
| §2.2 (Cert Pin) | Host SHA-256 certificate pinning | `[PROPOSED CONTROL]` |
| §3.1–3.2 | Operator-driven install & account pre-check | `[APPROVED REQUIREMENT]` |
| §4.1 | Device admin permissions, no INTERNET | `[APPROVED REQUIREMENT]` |
| §4.2 | Two-step ARM → WIPE with one-time tokens | `[PROPOSED CONTROL]` |
| §5.1–5.2 | Honest diagnostics & App inventory | `[APPROVED REQUIREMENT]` |
| §6 | Device identity binding & slot isolation | `[APPROVED REQUIREMENT]` |
| §7 | Immediate session closure after dispatch | `[APPROVED REQUIREMENT]` |
| §8 | Complete agent self-removal post-reset | `[APPROVED REQUIREMENT]` |
| §9 | Rollback via `remove-active-admin` | `[PROPOSED CONTROL]` |
| §11 | Physical test device acceptance gating | `[APPROVED REQUIREMENT]` |

---

## 11. Acceptance Gating & Non-Goals

### Non-Goals:
1. Universal Knox/FRP bypass without operator credentials.
2. Unattended mass installation via desktop installer hooks.
3. Software attestation of physical NAND gate degaussing (requires chip destruction).

### Release Gate:
The agent must pass Phase 4 automated tests and Phase 5 physical device verification before any destructive execution may be triggered.
