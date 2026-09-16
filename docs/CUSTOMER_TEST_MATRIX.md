# Customer Compatibility & UX Test Matrix

**Reference:** [CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md](./CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md) §68–§70, §74

---

## 1. Operating System Host Matrix

| Host Environment | Architecture | Test Profile | Status |
|---|---|---|---|
| Windows 10 Pro / Enterprise | 64-bit (x86_64) | Production Host | Target Baseline |
| Windows 11 Pro / Enterprise | 64-bit (x86_64) | Production Host | Target Baseline |
| Ubuntu Linux / CI | 64-bit (x86_64) | Automated Host Unit/Integration Tests | CI Target |

---

## 2. Customer Workflow Test Cases

- **TC-LIC-001:** First launch license activation and token persistence.
- **TC-LIC-002:** Remaining device scan decrement upon completed report.
- **TC-LIC-003:** In-place license upgrade handoff and automatic UI refresh.
- **TC-DEV-001:** USB cable physical connection detection without ADB.
- **TC-DEV-002:** ADB visible but unauthorized (prompting operator guidance).
- **TC-DEV-003:** ADB authorized state transition to `ADB_READY`.
- **TC-DEV-004:** Graceful disconnection during active scan (no application crash).
- **TC-DEV-005:** Capability assessment on consumer device without OEM adapter.
- **TC-PUR-001:** Pre-purge authorization confirmation gate.
- **TC-PUR-002:** Expected device reboot and re-identification on same session UUID.
- **TC-PUR-003:** Post-purge verification state evaluation (`VERIFIED` vs `PLATFORM_REPORTED_COMPLETE`).
