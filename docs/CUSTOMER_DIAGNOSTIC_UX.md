# Customer Diagnostic User Experience & Workflows

**Reference:** [CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md](./CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md) §16–§22, §74

---

## 1. Workstation Interface Structure

The customer application is frozen to a clear four-region layout:

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ CYVRA MOBILE                         Customer: ABC Technologies    ● ACTIVE │
│ Android Diagnostics & Data Purge     License: 25 Device Scans              │
│                                      Scans: 8 / 25        [UPDATE] [UPGRADE]│
├───────────────┬────────────────────────────────────────────────────────────┤
│ OVERVIEW      │                                                            │
│ ADVANCED      │                    MAIN WORKSPACE                          │
│ DIAGNOSTIC    │  - Device Connection Card (USB/ADB/Auth Status)           │
│ DATA PURGE    │  - Device Identity Snapshot                                │
│ RESULTS &     │  - Real-Time Diagnostic Test Suite                         │
│ REPORTS       │  - Evidence Collector Output & Limitations                 │
│ LICENSE &     │                                                            │
│ USAGE         │                                                            │
│ HELP / SETTING│                                                            │
│ ───────────   │                                                            │
│ 17 REMAINING  │                                                            │
├───────────────┴────────────────────────────────────────────────────────────┤
│ USB: CONNECTED (Port 3) | ADB: AUTHORIZED | Worker API: SYNCHRONIZED       │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Advanced Diagnostic Lifecycle

1. **Pre-flight & Discovery:** Verifies Windows host runtime, controlled ADB binary, and physical USB connection.
2. **Device State Handshake:** Guides operator through unlocking screen and checking "Always allow from this computer" for RSA authorization.
3. **Evidence Extraction:** Invokes independent collectors (Identity, Battery, Storage, Security). Failure in one collector never aborts the overall scan.
4. **Honesty Verification:** Restricted fields (telephony IMEI, hardware serial, battery SOH) are explicitly flagged with reason documentation instead of placeholders or fabrication.
5. **Report Generation:** Generates Report 1 (CYVRA Device Verification Report) with cryptographic digest.
