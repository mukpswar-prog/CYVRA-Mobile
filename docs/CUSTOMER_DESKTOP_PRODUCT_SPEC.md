# Customer Desktop Product Specification

**Freeze status:** ACCEPTED CUSTOMER-SIDE ENGINEERING BASELINE  
**Product:** CYVRA Mobile — Android Device Diagnostics & Data Purge  
**Primary Host:** Windows 10/11 64-bit  
**Primary Operating Model:** One Windows CYVRA desktop application servicing Android devices one at a time via USB/ADB.  
**Reference Document:** [CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md](./CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md)

---

## 1. Executive Summary

CYVRA Mobile delivers a professional Windows desktop application for Android device intake, diagnostics, evidence preservation, and data sanitization verification. 

Technicians and customers operate the system with zero prerequisite knowledge of Android Studio, Gradle, command-line interfaces, or Java runtimes.

---

## 2. Core Operational Flow

```text
CYVRA Website (Purchase / Entitlement)
       ↓
Protected Windows Desktop Application Download
       ↓
Windows Installation & License Activation
       ↓
Windows Preflight (OS, Architecture, ADB component, Driver status)
       ↓
Connect ONE Android Device via USB
       ↓
Connection & Authorization Handshake (USB detected → ADB authorized)
       ↓
Advanced Diagnostic (Identity, Battery, Storage, Security)
       ↓
Diagnostic Results & Signed Report Generation
       ↓
[Optionally] Controlled Data Purge Workflow (Capability Assessment → Authorization → Platform Reset → Reconnect → Post-Purge Verification → Final Report)
       ↓
Disconnect & Ready for Next Device
```

---

## 3. Product Positioning & Boundary

- **Positioning:** Professional Android Device Diagnostics & Data Purge workstation.
- **Honesty Rule:** No claim of universal compatibility ("Works on every Android phone" is strictly forbidden). CYVRA explicitly assesses and reports capabilities per device.
- **Security Boundary:** Never bypass Android lock screens, FRP (Factory Reset Protection), bootloader security, or Knox/OEM tamper protections.
- **Device Service Floor:** The Windows host services Android devices via ADB independently of whether the optional Android APK is installed (`minSdk = 26` applies solely to the APK component).
