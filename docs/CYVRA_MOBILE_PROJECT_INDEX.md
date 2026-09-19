# CYVRA Mobile — Project Index & Documentation Register

**Document date:** 2026-09-19
**Status:** ACTIVE PROJECT INDEX — P1.5A.1 CONSOLIDATED EDITION
**Repository:** `mukpswar-prog/CYVRA-Mobile`
**Audited remote baseline:** `main` at `81309e28e32fa638fd7fcaa1bd0ab0a007888748`
**Active local engineering branch at consolidation:** `d2-3-wpd-mtp-evidence-plane`
**Program strategy:** **CONSOLIDATE → CORRECT → INTEGRATE → HARDWARE-PROVE → RELEASE-PROVE**

---

## 0. Purpose

This file is the repository navigation and documentation-control index for CYVRA Mobile.

It answers:

- where to start,
- which document is authoritative,
- which component owns which responsibility,
- which documents remain active,
- which documents must be rewritten,
- which documents are historical,
- which files are blocked from archival because of live references,
- which requirements must survive consolidation,
- where deferred product capabilities are recorded,
- and what the current execution gate is.

This file is **not** a replacement for the Canonical Engineering Guideline or the Final Forensic/System-Design Baseline.

---

# 1. Start here

An engineer resuming CYVRA Mobile must read in this order:

1. `GUIDELINE.md`
   - transitional root compliance/safety charter;
   - remains active until its unique compliance provisions are deliberately absorbed.

2. `docs/CYVRA_MOBILE_CANONICAL_ENGINEERING_GUIDELINE_2026-09-19.md`
   - canonical product objective;
   - architecture;
   - maturity model;
   - engineering process;
   - detailed execution gates.

3. `docs/CYVRA_MOBILE_FINAL_FORENSIC_SYSTEM_DESIGN_BASELINE_2026-09-19.md`
   - final forensic issue register;
   - mandatory mitigations;
   - macro Phase 1–5 execution model.

4. `docs/CYVRA_MOBILE_PROJECT_INDEX.md`
   - this document;
   - repository map;
   - documentation classification;
   - archive policy;
   - requirement-preservation map.

5. The specific active component contract relevant to the work being changed.

Do **not** start from:

- `resume-*`,
- `g0-*` / `g5-*` / `g7-*`,
- migration/cutover notes,
- old “final freeze” guides,
- old customer/admin manuals,
- old implementation/rectification plans,
- or any document that claims broad completion without current maturity evidence.

---

# 2. Governing precedence

When documents disagree, use this order:

1. safety/compliance prohibition,
2. Canonical Engineering Guideline,
3. Final Forensic/System-Design Baseline,
4. this Project Index,
5. active component contracts,
6. active runbooks/reference documents,
7. historical archive.

Additional rules:

- newer evidence-backed architecture supersedes older implementation assumptions;
- historical “DONE” wording never overrides actual maturity evidence;
- stronger privacy/safety restriction remains in force unless explicitly amended;
- archived files preserve history but cannot direct new implementation.

---

# 3. Documentation status vocabulary

Every documentation file must be classified as exactly one of the following.

| Status | Meaning |
|---|---|
| `ACTIVE-GOVERNING` | Project-wide product, safety, architecture, or execution authority |
| `ACTIVE-CONTRACT` | Narrow binding technical contract |
| `ACTIVE-RUNBOOK` | Current operational procedure |
| `ACTIVE-REFERENCE` | Current technical/research/test/tooling reference |
| `REWRITE-ACTIVE` | Subject remains active but document contains stale architecture/status |
| `EXTRACT-THEN-ARCHIVE` | Valuable unique requirements remain; old file must not remain execution authority |
| `HISTORICAL-SUPERSEDED` | Historical evidence only; archive after references are repaired |
| `REPLACE` | File remains at same logical role/path but content must be replaced |
| `DELETE-CANDIDATE` | Only exact duplicate/generated/empty/obsolete material after dependency + requirement review |

No current CYVRA Mobile document is authorized for immediate deletion solely because it is old.

---

# 4. Primary governing documents

| Path | Status | Purpose |
|---|---|---|
| `GUIDELINE.md` | `ACTIVE-GOVERNING` — transitional | Compliance/product-safety charter until unique provisions are absorbed |
| `docs/CYVRA_MOBILE_CANONICAL_ENGINEERING_GUIDELINE_2026-09-19.md` | `ACTIVE-GOVERNING` | Canonical objective, architecture, maturity model, engineering process |
| `docs/CYVRA_MOBILE_FINAL_FORENSIC_SYSTEM_DESIGN_BASELINE_2026-09-19.md` | `ACTIVE-GOVERNING` | Forensic defects, mitigations, macro program |
| `docs/CYVRA_MOBILE_PROJECT_INDEX.md` | `ACTIVE-GOVERNING` | Navigation, ownership, document classification, archive policy |

Long-term target: the three documents under `docs/` become the permanent primary governance set after root `GUIDELINE.md` has been safely consolidated.

---

# 5. Phase-1 audit artifacts

These files document the consolidation process but are not permanent governing authorities.

| File | Status | Long-term action |
|---|---|---|
| `docs/CYVRA_MOBILE_P1_3_CLASSIFICATION_ARCHIVE_PLAN_FREEZE_2026-09-19.md` | `HISTORICAL-AUDIT` after P1.5 | Preserve in historical audit archive after this index fully absorbs its classification decisions |
| `CYVRA_MOBILE_P1_4_ARCHITECTURE_REQUIREMENT_EXTRACTION_INVENTORY_2026-09-19.md` | working extraction artifact | If retained in repository, place in historical audit archive; do not make it a fourth governing file |

P1.4 normalized **146 requirements**:

- 109 `KEEP`,
- 26 `KEEP + MODIFY`,
- 3 `MISSING FROM NEW BASELINE`,
- 4 `SUPERSEDED`,
- 4 `DEFERRED`.

The accepted decisions are represented in the requirement-preservation map below and in active contracts as they are rewritten.

---

# 6. Current program status

```text
PHASE 1 — CONSOLIDATE

P1.1 Governance Baseline                    PASS
P1.2 Documentation Dependency Audit         PASS
P1.3 Classification & Archive Plan          PASS
P1.4 Architecture/Requirement Extraction    PASS
P1.5 Documentation Consolidation            IN PROGRESS
  P1.5A.1 Project Index consolidation        CURRENT FILE
  P1.5A.2 Root README rewrite                NEXT
  P1.5A.3 Active architecture contracts      BLOCKED on A.2
  P1.5A.4 Customer/component documents       BLOCKED on A.3
  P1.5B Reference repair                     BLOCKED on A
  P1.5C Historical archive moves             BLOCKED on B
  P1.5D Repository documentation audit       BLOCKED on C
P1.6 Final Consolidation Acceptance          BLOCKED
```

Product-code work remains frozen during the documentation consolidation except for the already-understood D2.3 local engineering delta.

---

# 7. Frozen target architecture

```text
CYVRA Desktop UI
React / TypeScript
presentation + operator interaction
        │
        ▼
CYVRA Native Layer
Rust / Tauri
Windows USB / PnP / WPD / process lifecycle
        │
        ▼
CYVRA Domain Engine
Kotlin / JVM
Android semantics / workflow / capability policy
licensing / reports / sanitization policy
        │
        ├──────────────┐
        ▼              ▼
ADB / Android      Android Component
optional advanced  optional legitimate
evidence           device-side evidence
```

Separate control plane:

```text
Cloudflare Worker
   ├─ customer auth
   ├─ staff/admin auth
   ├─ entitlement authority
   ├─ evidence/report registry
   ├─ audit
   └─ Resend
        │
        ▼
      Neon
```

The workstation owns observational device truth.
The cloud owns account, entitlement, registry, and audit truth.

---

# 8. Permanent architecture invariants

1. Physical USB presence ≠ ADB availability.
2. ADB availability ≠ ADB authorization.
3. WPD/MTP visibility ≠ complete Android filesystem access.
4. Folder/file metadata ≠ installed/running/used application.
5. Device connection ≠ operator authorization.
6. Passive preflight/discovery ≠ licence consumption.
7. Device Verification ≠ sanitization authorization.
8. File deletion ≠ certified whole-device sanitization.
9. Unavailable evidence is never fabricated.
10. Report claims may be no stronger than evidence.
11. React does not own physical device truth.
12. Rust owns Windows-native truth.
13. Kotlin owns domain/business/Android semantics.
14. Android APK is supporting evidence, not the workstation orchestrator.
15. Local evidence capture must not depend on internet access.
16. Cloud sync must not silently redefine workstation observations.
17. One selected device may be processed at a time, but multiple connected devices must be detected and safely disambiguated.
18. Sanitizer and verifier remain separate responsibilities.
19. No production feature is called complete without a stated maturity level.
20. Destructive behavior is not exposed merely because implementation code exists.

---

# 9. Maturity vocabulary

Use only:

1. `MODELLED`
2. `UNIT-TESTED`
3. `PROTOCOL-EXPOSED`
4. `UI-INTEGRATED`
5. `HARDWARE-VALIDATED`
6. `RELEASE-VALIDATED`

Examples:

- WPD device-manager enumeration on the real Samsung test handset: `HARDWARE-VALIDATED`.
- WPD storage/content metadata scanner: not yet implemented.
- Host sanitization classes: not production sanitization merely because unit tests exist.
- old customer manuals: not evidence of `RELEASE-VALIDATED` functionality.

---

# 10. Repository system map

```text
CYVRA-Mobile/
├── GUIDELINE.md
├── README.md
├── apps/
│   ├── android/
│   │   ├── app/                  supporting Android APK
│   │   └── core/                 Android/domain evidence models and tests
│   ├── desktop/
│   │   ├── src/                  React customer desktop UI
│   │   └── src-tauri/            Rust/Tauri Windows Native Layer
│   ├── host/                     Kotlin/JVM Domain Engine
│   └── web/                      public/customer/admin web surface
├── services/
│   └── api/                      Cloudflare Worker control-plane API
├── database/
│   ├── migrations/
│   └── src/schema.ts
├── packages/
│   └── evidence/                 evidence/report contracts
├── scripts/                      engineering/deployment helpers
├── docs/
│   ├── architecture/
│   ├── testing/
│   ├── research/
│   └── future archive/
└── .github/workflows/
```

---

# 11. Component ownership index

## 11.1 `apps/desktop/src`

**Owner:** CYVRA Desktop UI.

Responsibilities:

- presentation,
- operator interaction,
- explicit user action,
- status display,
- report presentation.

Must not become the owner of:

- raw physical-device truth,
- WPD enumeration,
- entitlement accounting authority,
- evidence integrity,
- sanitization execution truth.

Current maturity: foundation/shell; full customer lifecycle is not yet UI-integrated.

---

## 11.2 `apps/desktop/src-tauri`

**Owner:** CYVRA Native Layer.

Key areas:

| Area | Purpose |
|---|---|
| `src/main.rs` | native app entry |
| `src/lib.rs` | Tauri composition and command registration |
| `src/commands.rs` | IPC boundary |
| `src/host_process.rs` | Kotlin Domain Engine process bridge |
| `src/usb/` | Windows USB/PnP observation |
| `src/wpd/` | WPD/MTP native evidence plane |
| `Cargo.toml` | Rust/Tauri/Windows dependencies |
| `tauri.conf.json` | packaging/runtime configuration |
| `capabilities/` | Tauri permissions |

Rules:

- notification is a trigger; enumeration is truth;
- WPD default scan is read-only metadata-first;
- raw PnP/WPD identity should stay native unless a justified UI need exists;
- native device observations feed a normalized snapshot to the Domain Engine.

---

## 11.3 `apps/host`

**Owner:** CYVRA Domain Engine.

Key responsibilities:

- Android/ADB semantics,
- capability evaluation,
- evidence interpretation,
- workflow state,
- licensing workflow,
- report semantics,
- sanitization policy/orchestration,
- OEM capability extensions,
- future grading/AI domain logic.

Known debt:

- Protocol V1 exposes only a small fraction of available domain functionality;
- current device-state code contains ADB-derived physical-USB semantics that must be removed;
- implicit first-device selection is unsafe for a multi-device physical environment.

---

## 11.4 `apps/android`

**Owner:** Supporting Android Component.

Accepted toolchain baseline:

- Kotlin/KGP 2.3.21
- AGP 8.13.2
- Gradle 9.1.0
- JDK 21
- compileSdk 36
- targetSdk 36
- minSdk 26

Rules:

- APK installability does not define the Windows host's service floor;
- permission denial is a limitation, not fabricated failure;
- supporting component invocation must become session-bound and replay-resistant;
- exported receiver design requires hardening rather than a blind `exported=false` change.

---

## 11.5 `packages/evidence`

Purpose:

- evidence vocabulary,
- capability/test contracts,
- honesty/conflict semantics,
- canonical digest helpers,
- report manifest/contracts,
- validation.

Current direction:

- preserve historical Evidence V1;
- introduce Evidence V2 with:
  - `WINDOWS_USB`
  - `WINDOWS_WPD_MTP`
  - `ANDROID_ADB`
  - `ANDROID_COMPONENT`
  - `OPERATOR`
  - `SYSTEM`.

---

## 11.6 `services/api`

**Owner:** CYVRA Control Plane API.

Responsibilities:

- customer authentication,
- staff/admin authentication,
- entitlement authority,
- evidence/report registry,
- transactional email,
- audit/control-plane state.

Important current hardening work:

- narrow CORS to exact origins;
- remove JavaScript-readable production web session secret;
- add OTP source/identity rate limiting;
- make OTP consume atomic;
- use keyed verification for low-entropy OTP values;
- secure internal maintenance endpoints;
- separate normal staff auth from break-glass infrastructure auth.

---

## 11.7 `database`

Current logical areas include:

- customer accounts/sessions,
- OTP challenges,
- device lifecycles,
- processing sessions,
- capability/evidence data,
- reports,
- mobile serial/licence data,
- staff operators/sessions.

Mandatory future corrections:

- retention-safe evidence/report relations,
- append-only audit ledger,
- durable verification/entitlement transaction model,
- separate device binding from scan consumption,
- evidence replay digest-conflict semantics,
- auth-artifact retention/cleanup.

---

## 11.8 `apps/web`

Current scope:

- public site,
- registration/sign-in,
- customer workspace,
- admin UI.

Current architectural note:

- public/admin presently share one web bundle;
- server authorization remains authoritative;
- separate entrypoints/builds are recommended before mature release.

---

# 12. Active technical contracts

## 12.1 Keep active now

| Path | Status | Purpose |
|---|---|---|
| `docs/architecture/d2-3-wpd-mtp-evidence-contract.md` | `ACTIVE-CONTRACT` | Current WPD/MTP evidence-plane boundary |
| `docs/ANDROID_COMPATIBILITY_FREEZE.md` | `ACTIVE-CONTRACT` + `REWRITE-ACTIVE` | Android toolchain and compatibility baseline |
| `docs/OEM_ADAPTER_ARCHITECTURE.md` | `ACTIVE-CONTRACT` / review | Generic-first OEM extension rules |

## 12.2 Rewrite as active architecture contracts

| Path | Status | Required correction |
|---|---|---|
| `docs/WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md` | `REWRITE-ACTIVE` | independent USB + WPD/MTP + optional ADB |
| `docs/DEVICE_EVIDENCE_ARCHITECTURE.md` | `REWRITE-ACTIVE` | Evidence V2 provenance + canonical integrity |
| `docs/SANITIZATION_ARCHITECTURE.md` | `REWRITE-ACTIVE` | qualified methods + multi-signal verification |
| `docs/TEST_MATRIX.md` | `REWRITE-ACTIVE` | WPD/ADB/correlation/failure/hardware matrix |

These files remain in place during P1.5A. They are not archive candidates until replacement contracts exist and are reviewed.

---

# 13. Customer/product contract status

| Path | Status | Required correction |
|---|---|---|
| `docs/CUSTOMER_DESKTOP_PRODUCT_SPEC.md` | `REWRITE-ACTIVE` | current architecture/maturity |
| `docs/CUSTOMER_DIAGNOSTIC_UX.md` | `REWRITE-ACTIVE` | independent USB/MTP/ADB states |
| `docs/CUSTOMER_LICENSE_ARCHITECTURE.md` | `REWRITE-ACTIVE` | durable verification transaction |
| `docs/CUSTOMER_PURGE_UX.md` | `REWRITE-ACTIVE` | qualified methods + same-device authorization |
| `docs/CUSTOMER_REPORT_ARCHITECTURE.md` | `REWRITE-ACTIVE` | one canonical local/cloud report manifest |
| `docs/CUSTOMER_TEST_MATRIX.md` | `REWRITE-ACTIVE` | real hardware/failure coverage |
| `docs/CUSTOMER_UPDATE_UPGRADE_ARCHITECTURE.md` | `ACTIVE-CONTRACT` / review | reconcile with release/updater implementation |

---

# 14. Active references and runbooks

| Path | Status | Notes |
|---|---|---|
| `docs/testing/README.md` | `ACTIVE-REFERENCE` / rewrite | simplify around current maturity/test model |
| `docs/testing/pool.md` | `ACTIVE-REFERENCE` / rewrite | preserve historical test evidence |
| `docs/research/samsung-s1-sources.md` | `ACTIVE-REFERENCE` | keep research; S1 wording is historical |
| `docs/tooling.md` | `ACTIVE-REFERENCE` | `scripts/install.sh` depends on it |
| `docs/neon-cloudflare.md` | `ACTIVE-REFERENCE` / review | verify current live topology later |
| `docs/resend-mobile-otp.md` | `ACTIVE-RUNBOOK` / rewrite | retain setup knowledge; align auth hardening |
| `docs/android-studio-laptop.md` | `ACTIVE-RUNBOOK` / rewrite | preserve setup; remove obsolete resume chain |
| `docs/admin-scope-freeze.md` | `ACTIVE-REFERENCE` / review | preserve useful admin policy |
| `docs/token-inventory.txt` | `ACTIVE-RUNBOOK` / security review | keep only if no secrets |

---

# 15. README policy

## 15.1 Root `README.md`

Status: `REPLACE`.

Its replacement must contain only:

1. what CYVRA Mobile is,
2. current architecture,
3. current maturity,
4. repository layout,
5. basic build/test entrypoints,
6. link to this Project Index.

It must not be a historical resume log.

## 15.2 `apps/desktop/README.md`

Status: `REPLACE`.

New content must explain:

- Desktop UI / Native Layer / Domain Engine split,
- Windows build prerequisites,
- USB/WPD rules,
- Host process packaging,
- tests,
- release limitations.

## 15.3 `apps/android/README.md`

Status: `REWRITE-ACTIVE`.

Keep:

- supporting-component role,
- toolchain/build instructions,
- test instructions.

Remove:

- old G5 resume chain,
- obsolete completion status.

## 15.4 `packages/evidence/README.md`

Status: `REWRITE-ACTIVE`.

Must distinguish Evidence V1 from planned Evidence V2 and document compatibility expectations.

---

# 16. High-value legacy sources — extract then archive

The following contain unique product intent but must not remain active execution authority.

| Path | Status | Unique material to preserve |
|---|---|---|
| `docs/CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md` | `EXTRACT-THEN-ARCHIVE` | Windows customer workflow, entitlement/update/report UX |
| `docs/CYVRA_Mobile_Advanced_Customer_Application_AI_Grading_Licensing_Master_Workflow.md` | `EXTRACT-THEN-ARCHIVE` | AI inspection, grading, human review, commercial UX |
| `docs/CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md` | `EXTRACT-THEN-ARCHIVE` | Android/OEM/toolchain policy; ADB-first parts superseded |
| `docs/CYVRA_MOBILE_GENERAL_APPLICATION_GUIDELINES.txt` | `EXTRACT-THEN-ARCHIVE` | security, offline, evidence and release invariants |

P1.4 has already extracted their surviving requirements.
They move only after active contracts contain those decisions.

---

# 17. Old manuals

| Path | Status | Decision |
|---|---|---|
| `docs/CYVRA_MOBILE_ADMINISTRATOR_MANUAL.txt` | `REPLACE` / archive old | regenerate from validated admin system |
| `docs/CYVRA_MOBILE_CUSTOMER_USER_MANUAL.txt` | `REPLACE` / archive old | regenerate after desktop workflow is integrated |
| `docs/CYVRA_MOBILE_DOWNLOAD_AND_INSTALLATION_GUIDE.txt` | `REPLACE` / archive old | regenerate after signed clean-machine release |

Old manuals must not be used as evidence that a feature currently exists.

Specific historical claims that are not release authority include:

- `v3.2.2-release`,
- exact installer filename/path,
- exact ADB version,
- Windows Server support,
- unconditional cryptographic erase/overwrite methods,
- guaranteed NIST-style certificate claims,
- fixed offline-grace duration,
- fixed commercial plan/pricing examples.

---

# 18. Historical implementation/audit plans

Classify as `HISTORICAL-SUPERSEDED`:

- `docs/CYVRA_MOBILE_IMPLEMENTATION_PLAN.md`
- `docs/CYVRA_MOBILE_RECTIFICATION_PLAN.txt`
- `docs/CYVRA_MOBILE_DEEP_AUDIT_AND_NEXT_STEPS.txt`

They may be archived after inbound references are repaired.

---

# 19. Historical G0–G8 / resume / migration cluster

Classify as `HISTORICAL-SUPERSEDED`:

```text
docs/admin-mobile-section.md
docs/android-version-stack-review.md
docs/codespaces-g5.md
docs/codespaces-pages.md
docs/cross-repo-next-gates.txt
docs/cyvoriq-co-in-cutover.txt
docs/cyvoriq-migration-audit.txt
docs/dashboard-configure.md
docs/freeze-audit.md
docs/g0-g3.md
docs/g0-github-description.md
docs/g5-laptop-work.md
docs/g5-owned-samsung.md
docs/g7-freeze.md
docs/parked-next-slice.md
docs/pre-live-runbook.txt
docs/resume-after-break.md
docs/resume-android-freeze.md
docs/resume-g8-freeze.md
docs/resume-neon-migrate.md
docs/without-codespaces.txt
docs/www-mobile-button.md
```

These are archive candidates, not delete candidates.

---

# 20. Duplicate guideline decision

`GUIDELINE.md` and `docs/GUIDELINE.md` are not equivalent.

Decision:

- root `GUIDELINE.md` remains transitional governing authority;
- `docs/GUIDELINE.md` is `HISTORICAL-SUPERSEDED`;
- remove active inbound references to `docs/GUIDELINE.md`;
- archive the docs copy after reference repair;
- do not delete the root guideline until unique compliance/safety provisions have been merged.

---

# 21. Operational reference blockers

The following files cannot move until dependent scripts are updated:

```text
scripts/deploy-admin-cyvoriq.sh
  → docs/admin-cyvoriq-start.txt

scripts/deploy-www-cyvoriq.sh
  → docs/www-cyvoriq-start.txt

scripts/install.sh
  → docs/tooling.md
```

Therefore:

| Document | Current status |
|---|---|
| `docs/admin-cyvoriq-start.txt` | `ACTIVE-RUNBOOK-PENDING-REPLACEMENT` |
| `docs/www-cyvoriq-start.txt` | `ACTIVE-RUNBOOK-PENDING-REPLACEMENT` |
| `docs/tooling.md` | `ACTIVE-REFERENCE` |

P1.5B must repair these dependencies before P1.5C moves any affected file.

---

# 22. Requirement-preservation map

This section preserves the P1.4 decisions so that archival cannot silently remove important product intent.

## 22.1 Governance and compliance

Preserve:

- authorized-device-only processing;
- no lock/PIN/password/FRP bypass;
- no exploit/root/firmware-flash path to obtain unauthorized access;
- no fabricated evidence;
- capability-aware support claims;
- no universal Android/OEM claim;
- separate CYVRA Mobile and CYVRA Erase infrastructures;
- one selected processing target at a time with safe multi-device discovery;
- destructive behavior only after separate authorization/qualification.

Primary requirement family: `REQ-GOV-*`.

---

## 22.2 Architecture ownership

Preserve:

- Windows desktop is the customer product;
- production customer needs no Android Studio/Gradle/developer JDK;
- React = presentation;
- Rust/Tauri = Windows-native truth;
- Kotlin = Domain Engine;
- Android APK = optional supporting evidence;
- Cloud = account/entitlement/registry/audit control plane;
- local workstation = observational evidence truth;
- do not rewrite Kotlin merely to avoid packaging.

Primary requirement family: `REQ-ARC-*`.

---

## 22.3 Device and transport

Preserve:

- USB, WPD/MTP and ADB as independent state planes;
- WPD/MTP provides basic evidence even with debugging off;
- ADB states include unavailable/unauthorized/offline/ready;
- controlled Platform-Tools distribution;
- exact ADB version selected at release, not permanently hardcoded;
- `SessionDeviceRef` or equivalent multi-source correlation;
- no implicit first-device selection;
- WPD `GetDevices` topology-race hardening;
- raw PnP identity remains native/internal by default.

Primary requirement family: `REQ-DEV-*`.

---

## 22.4 Android and OEM

Preserve:

- current pinned Android toolchain until explicit upgrade;
- APK minSdk does not define Windows host service floor;
- least-privilege permissions;
- declare/detect/test are different facts;
- Android receiver authentication/replay hardening;
- generic provider for unknown OEM;
- OEM-specific adapter only after real-hardware evidence;
- broad Android/OEM matrix is a validation target, not a current promise.

Primary requirement families: `REQ-AND-*`, `REQ-OEM-*`.

---

## 22.5 Evidence and privacy

Preserve:

- independent collectors;
- per-field provenance/status/reason/timestamp;
- Evidence V2 sources:
  - `WINDOWS_USB`
  - `WINDOWS_WPD_MTP`
  - `ANDROID_ADB`
  - `ANDROID_COMPONENT`
  - `OPERATOR`
  - `SYSTEM`;
- V1 historical compatibility;
- no fabricated IMEI/serial;
- IMEI is not primary identity;
- no unrestricted `/data` design;
- WPD metadata-first/no default content stream;
- metadata does not prove app use;
- canonical digest and original collection time;
- same-ID/different-payload = integrity conflict;
- local artifact remains independently verifiable;
- no default cloud storage of private messages/photos/content.

Primary requirement family: `REQ-EVD-*`.

---

## 22.6 Licensing and commercial control

Preserve:

- device scan entitlement ≠ operator seats;
- immutable internal licence identity;
- entitlement revisions preserve history;
- payment confirmation ≠ entitlement authorization;
- plan/pricing policy is server-controlled;
- passive discovery never consumes a scan;
- explicit Device Verification starts the chargeable transaction;
- canonical Report 1 freeze finalizes consumption;
- device binding ≠ scan consumption;
- trial entitlement must be explicit;
- public licence/reference number is not a secret authenticator;
- server unavailable ≠ licence invalid;
- offline grace is configurable/cryptographically protected;
- Update ≠ Upgrade;
- payment secrets never live in desktop code;
- manual admin approval is an optional policy, not a universal requirement.

Primary requirement family: `REQ-LIC-*`.

---

## 22.7 Authentication and audit

Preserve:

- staff-session auth for normal admin work;
- infrastructure admin token only as controlled break-glass/service path;
- no staff membership enumeration;
- source/IP and identity OTP throttles;
- atomic one-time OTP consume;
- keyed OTP verification;
- HttpOnly/Secure production web session;
- exact production CORS allowlist;
- authenticated/scheduled internal maintenance;
- append-only audit events for commercial/destructive/report/admin transitions;
- evidence/report retention independent of account lifecycle;
- auth-artifact retention/cleanup policy.

Primary requirement families: `REQ-SEC-*`, `REQ-AUD-*`.

---

## 22.8 Reporting

Preserve:

- Report 1 = Device Verification report, never sanitization proof;
- Final Certificate only after authorized sanitization + post-verification;
- one canonical report manifest/digest;
- cloud verifies/stores canonical report rather than redefining it;
- PDF/JSON are representations, not alternate truths;
- limitations/coverage are explicit;
- SHA-256/tamper evidence does not require a signing private key on the workstation;
- old A/D/S terminology is not customer-facing mobile terminology.

Primary requirement family: `REQ-RPT-*`.

---

## 22.9 Sanitization

Preserve:

- diagnostics and sanitization remain separate;
- pre-destruction state is persisted;
- capability is not binary;
- verification is not binary;
- command success is not proof;
- factory reset ≠ NIST Purge by default;
- privileged Device Owner/OEM methods are conditional/future;
- historical ADB wipe commands are unqualified until hardware proof;
- post-reset verification must be multi-signal;
- two-step confirmation remains required;
- exact typed serial is used only when legitimately/reliably available;
- unqualified “Cryptographic Erase” / “Overwrite & Zeroize” choices stay out of production UI;
- destructive action requires stronger online/entitlement authority by default;
- certificate names actual method, authority, status, limitations and assurance;
- WPD deletion/shared-storage cleanup never proves whole-device sanitization.

Primary requirement family: `REQ-SAN-*`.

---

## 22.10 Deferred AI and grading module

This is a preserved product capability, not current-release proof.

Preserve:

- controlled physical image capture;
- AI-assisted visible-defect detection;
- image-quality gate before grading;
- AI identifies evidence, deterministic rules derive grade;
- human review handles exceptions;
- no mysterious single AI score without defined methodology;
- camera cannot claim what it cannot observe;
- CYVORIQ grade is versioned/proprietary, not misrepresented as BIS/government grade;
- every AI finding records view/source, confidence, model version, session/device reference and review outcome;
- safety suspicion can produce hold/manual review;
- country-specific presentation may vary without changing underlying evidence.

Primary requirement family: `REQ-AI-*`.

This deferred scope must remain discoverable even if the old AI master workflow is archived.

---

## 22.11 Release, installer, update

Preserve:

- Update and Upgrade remain separate;
- signed/authenticated update artifacts;
- staged/recoverable update process;
- customer installer packages Native Layer + Domain Engine runtime + required tools;
- release artifact is code-signed and hashed;
- private signing/update keys never live in source/customer workstation;
- old fixed product versions/filenames are historical;
- customer install guide is regenerated after clean-machine acceptance;
- Windows CI covers Rust/Tauri, desktop, Kotlin, Android/contracts and installer;
- protect `main` after CI stabilizes;
- real support claims require real hardware and clean-machine evidence;
- emulator is useful but not hardware proof.

Primary requirement families: `REQ-UPD-*`, `REQ-REL-*`.

---

# 23. High-risk contradiction resolutions

| Historical claim | Current decision |
|---|---|
| ADB is the primary physical connection truth | superseded: Windows USB/WPD are independent native truth |
| one device at a time means ignore additional devices | wrong: process one selected target, detect/disambiguate all candidates |
| typed exact hardware serial is always required for purge | preserve two-step safety, use reliable session/same-device identity; serial only when available |
| scan debit occurs vaguely at “certificate generation” | durable reserve → evidence → canonical Report 1 freeze → consume |
| factory reset = NIST purge | prohibited |
| setup wizard/no lock alone proves sanitization | insufficient |
| WPD deletion proves whole-device wipe | prohibited |
| cloud database alone defines device evidence truth | refined: local observation/digest + cloud registry/control |
| visible licence key is a secret | prohibited |
| device binding count = scan consumption count | prohibited |
| JavaScript-readable bearer token is normal production web auth | prohibited |
| any CYVORIQ subdomain may use credentialed API | replace with exact allowlist |
| Windows Server is currently supported | deferred |
| ADB `35.0.2` is permanent architecture | superseded exact pin |
| 24-hour offline grace is permanent law | configurable policy |
| Ed25519 is the only acceptable future updater algorithm | implementation-specific; verified signing is mandatory |
| `v3.2.2-release` manuals describe current release | historical only |
| AI/grading scope can be discarded | preserve as deferred module |

---

# 24. Current active-contract rewrite order

P1.5A proceeds in this order:

1. `docs/CYVRA_MOBILE_PROJECT_INDEX.md` — this file.
2. root `README.md`.
3. `docs/WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md`.
4. `docs/DEVICE_EVIDENCE_ARCHITECTURE.md`.
5. `docs/SANITIZATION_ARCHITECTURE.md`.
6. `docs/TEST_MATRIX.md`.
7. customer contracts:
   - desktop product spec,
   - diagnostic UX,
   - licence architecture,
   - report architecture,
   - purge UX,
   - test matrix,
   - update/upgrade architecture.
8. component READMEs:
   - desktop,
   - Android,
   - evidence package.
9. remaining active runbooks/reference docs where stale resume/domain language remains.

No historical file is moved before the replacement documents and their inbound references are ready.

---

# 25. Archive structure — planned, not yet created

The target is:

```text
docs/archive/
├── README.md
└── 2026-09-pre-final-baseline/
    ├── phase1-audit/
    ├── resume/
    ├── g0-g8/
    ├── migration/
    ├── old-freeze-guides/
    ├── old-manuals/
    └── old-plans/
```

`docs/archive/README.md` is a **planned path** until P1.5C. Its absence before that gate is expected and must not be treated as a broken current dependency.

Archive README must state that archived files are retained for engineering history/forensic traceability and are not current execution instructions.

---

# 26. Archive rules

When P1.5C begins:

1. use `git mv`;
2. never bulk delete the docs folder;
3. move one classification group at a time;
4. repair active references before each move;
5. run repository-wide reference validation after each group;
6. run `git diff --check`;
7. verify scripts still resolve runbooks;
8. do not mix unrelated application-code changes into the documentation migration;
9. preserve historically significant decisions unless a file is a proven delete candidate.

---

# 27. Deletion policy

Deletion requires all of:

```text
NO UNIQUE REQUIREMENT
+
NO ACTIVE REFERENCE
+
NO SCRIPT DEPENDENCY
+
NO FORENSIC VALUE
+
OWNER APPROVAL
```

Archive is preferred for historically significant material.

Examples that might later qualify for deletion:

- default framework/template README after replacement,
- exact duplicate,
- generated copy,
- empty obsolete placeholder.

No mass deletion is approved.

---

# 28. Current D2.3 engineering context

The documentation program must not erase or reinterpret the active product work.

Current D2.3 goal:

**Windows WPD/MTP Evidence Plane**

Current proven scope includes:

- WPD COM runtime,
- PortableDeviceManager creation,
- `RefreshDeviceList`,
- `GetDevices`,
- real Samsung WPD discovery,
- Tauri WPD command,
- read-only/privacy contract.

Immediate code hardening after Phase 1:

1. bounded retry around two-pass `GetDevices`,
2. raw identifier IPC/privacy decision,
3. deterministic WPD error codes/tests,
4. Rust regression,
5. real handset regression,
6. D2.3 checkpoint,
7. exact WPD read-only open API audit,
8. `GENERIC_READ` device open,
9. storage/root discovery,
10. metadata-only scanner.

No customer content stream or destructive action is introduced during this path.

---

# 29. Deferred product scope that must remain discoverable

The following are intentionally preserved but do not block the immediate D2.3 verification path unless their contracts are touched:

- AI physical inspection,
- deterministic grading,
- human-review workflow,
- country-specific grading presentation,
- Windows Server support,
- privileged enterprise/Device Owner/Knox sanitization,
- separate CYVRA Station,
- advanced payment/admin-approval policies,
- production updater experience beyond release requirements.

Deferred ≠ abandoned.
Deferred ≠ current release capability.

---

# 30. Current release support language

Until release validation exists, use:

> CYVRA Mobile is being engineered for Windows 10/11 64-bit workstations and broad Android device compatibility through capability-aware Windows USB, WPD/MTP, optional ADB, and optional Android-component evidence. Actual release support will be limited to combinations proven by the hardware and clean-machine acceptance matrices.

Do not use:

- “works with all Android phones,”
- “supports every OEM,”
- “all Android versions supported,”
- “secure erase guaranteed,”
- “NIST purge complete” without method-specific proof.

---

# 31. Change-control rule for this index

Update this file only when one of the following changes:

- governing document hierarchy,
- component ownership,
- active/historical classification,
- archive destination,
- major requirement preservation,
- current macro phase,
- current primary execution entrypoint.

Do not use this file as a daily development log.

Detailed implementation evidence belongs in:

- tests,
- PRs,
- component contracts,
- acceptance records,
- release records.

---

# 32. Current execution entrypoint

Current execution program:

> **P1.5 — Documentation Consolidation**

Immediate next gate after this Project Index replacement:

> **P1.5A.2 — Root `README.md` Rewrite**

Rules for the next gate:

- documentation only;
- no product-code edits;
- no archive moves;
- no deletions;
- no branch publish/merge;
- remove stale resume/migration navigation;
- point new engineers to this Project Index first;
- state current architecture and maturity honestly.

---

# 33. Final documentation model

Long-term:

```text
PRIMARY GOVERNANCE
  CYVRA_MOBILE_CANONICAL_ENGINEERING_GUIDELINE_2026-09-19.md
  CYVRA_MOBILE_FINAL_FORENSIC_SYSTEM_DESIGN_BASELINE_2026-09-19.md
  CYVRA_MOBILE_PROJECT_INDEX.md

ACTIVE COMPONENT CONTRACTS
  transport
  WPD
  evidence
  Android compatibility
  OEM
  licensing
  reports
  sanitization
  testing
  release/update

ACTIVE RUNBOOKS
  only current operational procedures

HISTORICAL ARCHIVE
  phase audits
  resume documents
  G0–G8 documents
  migration/cutover records
  old freeze guides
  obsolete manuals
  old implementation plans
```

The objective is a small authoritative surface without destroying engineering history.
