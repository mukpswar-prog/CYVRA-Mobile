# Customer Desktop Report Architecture

**Reference:** [CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md](./CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md) §40–§48, §74

---

## 1. Supported Report Types

The Windows desktop application generates two authoritative customer report documents:

1. **CYVRA Device Verification Report (Report 1):** Pre-sanitization condition report documenting physical and logical device status, identity, battery condition, storage allocations, security status, and capability assessments.
2. **CYVRA Data Sanitization & Verification Certificate (Final Report):** Complete tamper-evident record combining pre-purge identity snapshot, operator authorization, execution timestamp, method specifics, post-reboot verification evidence, and NIST SP 800-88 Rev. 2 assurance declarations.

---

## 2. Report Formats & Integrity

- **PDF Export:** Customer-facing, formatted vector document with corporate header, device identifiers, timestamp, operator signature block, and QR code verification link.
- **JSON Export:** Machine-readable payload matching frozen schema (`GenericDeviceEvidence` and `DeviceCapabilityAssessment`) for enterprise asset management and ingestion.
- **Cryptographic Digest:** Each report embeds a SHA-256 integrity hash calculated over the immutable evidence records.

---

## 3. Implementation Status (Slice A9)

- Implemented in `:core`: `ReportModels.kt` (`ReportHeader`, `ReportCoverageLabel`, `ReportIntegrityRecord`, `DeviceVerificationReport`, `SanitizationCertificateReport`).
- Implemented in `apps/host`: `HostReportEngine.kt` supporting Report 1 generation, Final Sanitization Certificate generation, SHA-256 cryptographic digest calculation, JSON export, and Markdown human-readable rendering.
- Unit tested in `:core:test` (`ReportModelsTest`) and `:host:test` (`HostReportEngineTest`). All tests pass.
