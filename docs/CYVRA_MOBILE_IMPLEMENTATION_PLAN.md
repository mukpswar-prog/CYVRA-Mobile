# CYVRA MOBILE — Engineering Implementation Plan

**Governing Freeze:** [ANDROID_COMPATIBILITY_FREEZE.md](./ANDROID_COMPATIBILITY_FREEZE.md)  
**Host Architecture Law:** [CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md](./CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md)  
**Customer Product Spec:** [CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md](./CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md)  
**Master AI & Commercial Workflow:** [CYVRA_Mobile_Advanced_Customer_Application_AI_Grading_Licensing_Master_Workflow.md](./CYVRA_Mobile_Advanced_Customer_Application_AI_Grading_Licensing_Master_Workflow.md)

---

## 1. Architectural Architecture & Module Topology

```text
                                  +------------------------------------+
                                  |         CYVORIQ Web / API          |
                                  | (Plans, Payment, Admin Approval,   |
                                  |  Entitlement Revisions, Updates)   |
                                  +-----------------+------------------+
                                                    | HTTPS / Signed Manifests
                                                    v
+-------------------------------------------------------------------------------------------------------+
| CYVRA MOBILE WINDOWS DESKTOP HOST (Operational Authority)                                             |
|                                                                                                       |
|  +-------------------------------------------------------------------------------------------------+  |
|  | Customer Shell UI (Overview, Diagnostics, AI Station, Data Purge, Reports, License, Settings)   |  |
|  +-------------------------------------------------------------------------------------------------+  |
|                                                    |                                                  |
|  +-------------------------------------------------+-----------------------------------------------+  |
|  | Desktop Orchestration & Service Layer                                                            |  |
|  |   - License & Entitlement Service (scans used/remaining, immutable license_id, revision tokens)  |  |
|  |   - Scan Accounting Coordinator (commit at diagnostic start, debit on verified completion)       |  |
|  |   - Software Update Agent (manifest verification, SHA-256 signature check, staged restart)       |  |
|  |   - Device Session State Machine (CYVRA-SESSION-UUID, USB, ADB, unauthorized, offline, ready)   |  |
|  |   - AI Inspection Station Coordinator (view sequence guide, image quality gate, defect localize)|  |
|  |   - Grading Rules Engine (Safety S0/S1, Cosmetic A-D, Functional F0-F2, Certified Grade)        |  |
|  |   - Report & Certification Engine (Report 1, Condition Report, Purge Cert, SHA-256 digest)       |  |
|  |   - Sanitization & Post-Purge Verification Coordinator (NIST SP 800-88 Rev. 2)                  |  |
|  +-------------------------------------------------+-----------------------------------------------+  |
|                                                    |                                                  |
|  +-------------------------------------------------+-----------------------------------------------+  |
|  | apps/host (Kotlin JVM 21) & Controlled ADB Transport Layer                                       |  |
|  |   - AdbBinaryLocator, AdbClient, AdbDeviceInspector                                             |  |
|  |   - AdbGenericEvidenceProvider, HostCapabilityCoordinator                                        |  |
|  |   - HostSanitizationProvider, HostVerificationProvider, HostReportEngine                         |  |
|  +-------------------------------------------------+-----------------------------------------------+  |
+----------------------------------------------------|--------------------------------------------------+
                                                     | USB / Controlled ADB (Port 5037)
                                                     v
                                       +----------------------------+
                                       |   ONE Physical Android     |
                                       |   Device Under Test        |
                                       |   (minSdk 26 for APK,      |
                                       |    Android 8-16 for ADB)   |
                                       +----------------------------+
```

---

## 2. Core Invariants & Engineering Freeze Laws

1. **Host Operational Authority:** The Windows host application is the primary orchestrator. The Android device never orchestrates its own audit or grading.
2. **One Device at a Time:** The application strictly enforces a single-device session lifecycle (`CYVRA-SESSION-YYYYMMDD-XXXXXX`). Concurrent multi-device multiplexing is prohibited.
3. **No Fabrication of Identifiers:** If telephony IMEI, hardware serial, or MAC address is restricted by Android OS (Android 10+ non-resettable identifier privacy), record `RESTRICTED_BY_PLATFORM_POLICY`. Never generate fake identifiers.
4. **Honest Capability Assessment:** If an OEM adapter is not available or Device Owner is not provisioned, fall back honestly to generic Android platform reset. Never label platform factory reset as "NIST Cryptographic Erase".
5. **Separation of UPDATE and UPGRADE:**
   - **UPDATE:** Software maintenance (executable binaries, platform-tools, diagnostic engine, AI model weights). Signed with SHA-256 integrity.
   - **UPGRADE:** Entitlement expansion (scans 1, 3, 5, 7, 25). Web-authenticated checkout handoff; immutable `license_id` with incremented entitlement revisions (`SUPERSEDED` -> `ACTIVE`).
6. **AI Physical Inspection Boundary:**
   - AI is an advanced integrated module **inside** CYVRA Mobile, not a separate standalone application.
   - AI physical inspection is optional (customer workstation may operate without camera station).
   - AI never claims to inspect what camera optics cannot see (internal battery health, internal motherboard corrosion, NAND block health).
   - Suspicious physical anomalies trigger `SAFETY HOLD — S1: Physical Confirmation Required`.
   - AI findings feed into a deterministic, versioned grading rules engine (`GRADE-IN-001`). AI never directly decides destructive purge.

---

## 3. Phased Implementation Roadmap

### Phase 0: Repository Audit & Specification Ingestion (COMPLETE)
- Ingested master specification: `docs/CYVRA_Mobile_Advanced_Customer_Application_AI_Grading_Licensing_Master_Workflow.md`.
- Completed exhaustive read-only audit across all monorepo modules (`apps/android`, `apps/host`, `apps/web`, `services/api`, `database`, `packages/evidence`).

### Phase 1: Architecture Plan & Freeze (CURRENT)
- Established `docs/CYVRA_MOBILE_IMPLEMENTATION_PLAN.md` with explicit module contracts, dependency DAG, and testing matrices.

### Phase 2: Customer Desktop Shell
- Header: Customer name, Plan, Scans Used/Remaining, License Status, `[ UPDATE ]`, `[ UPGRADE ]`.
- Left navigation: Overview, Advanced Diagnostic, AI Physical Inspection, Data Purge, Results & Reports, License & Usage, Help, Settings.
- Main workspace and connection status footer.

### Phase 3: License & Entitlement Service
- Client-side license domain models: `license_id`, `serial`, `customer`, `plan`, `device_scan_entitlement`, `scans_used`, `scans_remaining`, `status` (`ACTIVE`, `EXPIRED`, `REVOKED`, `SUPERSEDED`, `SERVER_UNAVAILABLE`).
- Grace period cache handling: offline fallback without misleading "Invalid License" alerts.

### Phase 4: Commercial Backend Handshake (Web / API)
- Align API order, entitlement revision, and staff approval endpoints.
- Ensure immutable `license_id` mapping when slabs upgrade.

### Phase 5: Web Upgrade Handoff
- In-app `[ UPGRADE ]` button opens browser handoff URL (`/upgrade?session=...`).
- Desktop background poll/refresh for entitlement activation upon completion.

### Phase 6: Device Session & Connection State Machine
- Strict states: `USB_NOT_CONNECTED`, `USB_CONNECTED`, `ADB_UNAVAILABLE`, `ADB_UNAUTHORIZED`, `ADB_OFFLINE`, `ADB_READY`, `DEVICE_RECONNECTING`.
- Unique `CYVRA-SESSION-UUID` generated and bound to all subsequent evidence.

### Phase 7: Advanced Diagnostic Stabilization
- Connect `HostAdbTransport`, `AdbGenericEvidenceProvider`, and `HostCapabilityCoordinator` into the customer workflow.
- Pre-flight checks and non-blocking multi-collector execution.

### Phase 8: AI Physical Inspection Station V0 (Capture Workflow)
- Camera intake module (webcam / USB camera feed).
- 6-view guided capture sequence: Front, Back, Left, Right, Top, Bottom (+ optional oblique views).
- Image Quality Gate: framing, focus, blur, exposure, glare detection.
- Raw image cryptographic hashing (SHA-256) and session association.

### Phase 9: AI Screen Inspection
- Controlled screen test pattern trigger via Android component/ADB (white, black, red, green, blue).
- Defect detection: cracks, chips, deep scratches, dead/stuck pixels, display burn-in.
- Localization bounding boxes, severity, and confidence scores.

### Phase 10: AI Body Inspection
- Defect detection across back glass, frame, rails, camera lens cover, and exterior ports.
- Classification: cosmetic scratch, dent, discoloration, separation/swelling anomaly.

### Phase 11: Deterministic Grading Rules Engine
- Grade components: Safety (`S0`, `S1`), Cosmetic (`A`, `B`, `C`, `D`), Functional (`F0`, `F1`, `F2`).
- Overall CYVORIQ Certified Grade calculation (`A`, `B`, `C`, `D`, `SAFETY_HOLD`).
- Versioned rule registry (`GRADE-IN-001`, `GRADE-IN-002`).

### Phase 12: Human Review & Exception Handling
- Operator exception review interface for low-confidence detections or safety warnings.
- Actions: `[ ACCEPT ]`, `[ REJECT ]`, `[ RECAPTURE ]`, `[ PHYSICAL VERIFICATION ]`.
- Audit logging of human overrides.

### Phase 13: CYVORIQ Certified Condition Report
- Comprehensive pre-purge certificate combining software diagnostic evidence + AI physical inspection findings + human review audit trail + tamper-evident SHA-256 signature.

### Phase 14: Data Purge & Verification Flow
- 2-step operator confirmation barrier.
- Sanitization method selection (Platform Factory Reset vs OEM Secure Erase).
- Automated post-reboot reconnect detection and verification check (OOBE / Setup Wizard state).

### Phase 15: Final Sanitization & Lifecycle Certificate
- Final NIST SP 800-88 Rev. 2 compliant sanitization certificate.
- Multi-format export: JSON and human-readable PDF / Markdown.

### Phase 16: Secure Software Update System
- Signed manifest retrieval, delta package download, cryptographic verification, and safe staged installation on restart.

---

## 4. Verification & Testing Matrix

| Component | Test Suite | Baseline Requirement |
|---|---|---|
| `:core` JVM Models | `./gradlew :core:test` | 100% pass on JDK 21 |
| `:host` JVM Transport | `./gradlew :host:test` | 100% pass on JDK 21 |
| `:app` Android Component | `./gradlew :app:assembleDebug` | Valid APK, minSdk 26, targetSdk 36 |
| `@cyvra/evidence` | `pnpm --filter @cyvra/evidence test` | Canonical JSON & SHA-256 digests verified |
| `@cyvra/api` | `pnpm --filter @cyvra/api test` | Route contracts and auth valid |
| Monorepo Typecheck | `pnpm typecheck` | Zero TypeScript errors across packages |
