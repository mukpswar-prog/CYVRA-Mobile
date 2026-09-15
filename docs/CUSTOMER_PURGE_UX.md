# Customer Data Purge & Verification UX

**Reference:** [CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md](./CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md) §27–§36, §70, §74

---

## 1. Purge Lifecycle

Data Purge is strictly decoupled from diagnostics. A diagnostic scan does NOT authorize a destructive operation.

```text
CONNECT DEVICE
      │
      ▼
PRE-PURGE DIAGNOSTIC & CAPABILITY ASSESSMENT (Slice A5)
      │
      ▼
TWO-STEP OPERATOR AUTHORIZATION (Explicit confirmation + Confirmation phrase)
      │
      ▼
METHOD SELECTION (Platform Factory Reset vs OEM-Verified Erase)
      │
      ▼
PERSIST PRE-PURGE EVIDENCE & SESSION UUID
      │
      ▼
EXECUTION TRIGGER (ADB platform command or OEM reset trigger)
      │
      ▼
EXPECTED DEVICE REBOOT & DISCONNECTION
      │
      ▼
DEVICE RE-DETECTION & RECONNECTION
      │
      ▼
POST-RESET VERIFICATION (Android Setup Wizard / OOBE state detection)
      │
      ▼
FINAL PURGE CERTIFICATE & AUDIT REPORT
```

---

## 2. NIST SP 800-88 Rev. 2 Terminology & Guardrails

- **No False Claims:** Factory reset is documented as "Platform Factory Reset", never misrepresented as "NIST Purge" or "Cryptographic Erase" unless verified hardware cryptographic erasing occurs.
- **Verification States:** `VERIFIED`, `PARTIALLY_VERIFIED`, `PLATFORM_REPORTED_COMPLETE`, `REQUIRES_EXTERNAL_VERIFICATION`, `FAILED`. Simple PASS/FAIL binaries are forbidden.
