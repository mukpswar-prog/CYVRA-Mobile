# CYVRA Mobile

**CYVRA Mobile** is a Windows-hosted Android device verification, evidence, reporting, and controlled sanitization platform developed by **CYVORIQ Solutions Pvt. Ltd.**

The product is being engineered for **Windows 10/11 64-bit workstations** and broad Android compatibility through capability-aware Windows USB, WPD/MTP, optional ADB, and optional Android-component evidence.

Actual release support is limited to combinations that are proven by the hardware and clean-machine acceptance matrices. CYVRA Mobile does **not** claim universal Android/OEM compatibility.

---

## Start here

Before changing code, read:

1. [`GUIDELINE.md`](GUIDELINE.md) — transitional root compliance/safety charter
2. [`docs/CYVRA_MOBILE_CANONICAL_ENGINEERING_GUIDELINE_2026-09-19.md`](docs/CYVRA_MOBILE_CANONICAL_ENGINEERING_GUIDELINE_2026-09-19.md)
3. [`docs/CYVRA_MOBILE_FINAL_FORENSIC_SYSTEM_DESIGN_BASELINE_2026-09-19.md`](docs/CYVRA_MOBILE_FINAL_FORENSIC_SYSTEM_DESIGN_BASELINE_2026-09-19.md)
4. [`docs/CYVRA_MOBILE_PROJECT_INDEX.md`](docs/CYVRA_MOBILE_PROJECT_INDEX.md)
5. the active component contract relevant to the change

The Project Index is the repository navigation and documentation-control entry point.

Do not resume engineering from old `resume-*`, G0–G8, migration, cutover, old freeze-guide, or old manual files. Those documents are being consolidated as historical material.

---

## Product lifecycle

```text
DEVICE DISCOVERY / PREFLIGHT
        ↓
DEVICE VERIFICATION
        ↓
EVIDENCE COLLECTION
        ↓
REPORT 1
CYVRA Device Verification Report
        ↓
SEPARATE SANITIZATION AUTHORIZATION
        ↓
QUALIFIED SANITIZATION METHOD
        ↓
REBOOT / RECONNECT
        ↓
POST-SANITIZATION VERIFICATION
        ↓
FINAL SANITIZATION & VERIFICATION REPORT
```

A diagnostic or verification operation does **not** authorize sanitization.

Passive USB/WPD discovery does **not** consume a licensed device scan.

---

## Architecture

```text
CYVRA Desktop UI
React / TypeScript
presentation + operator interaction
        │
        ▼
CYVRA Native Layer
Rust / Tauri
Windows USB / PnP / WPD / native process lifecycle
        │
        ▼
CYVRA Domain Engine
Kotlin / JVM
Android semantics / capability policy
licensing / evidence interpretation
reports / sanitization orchestration
        │
        ├──────────────┐
        ▼              ▼
Optional ADB       Android Component
advanced Android   legitimate device-side
evidence           supporting evidence
```

Control plane:

```text
Cloudflare Worker
   ├─ customer authentication
   ├─ staff/admin authentication
   ├─ entitlement authority
   ├─ evidence/report registry
   ├─ audit
   └─ transactional email
        │
        ▼
      Neon
```

### Ownership rules

- **React** owns presentation and operator interaction.
- **Rust/Tauri** owns Windows-native physical-device truth.
- **Kotlin Domain Engine** owns Android/domain/business semantics.
- **Android APK** is a supporting component, not the workstation orchestrator.
- **Cloud services** own account, entitlement, registry, and audit state.
- **The workstation** owns observed-device evidence and its canonical local digest.

---

## Device transport model

CYVRA Mobile treats these as independent evidence/transport planes:

```text
WINDOWS_USB
WINDOWS_WPD_MTP
ANDROID_ADB
ANDROID_COMPONENT
```

Important invariants:

- physical USB presence does not imply ADB;
- WPD/MTP visibility does not imply full filesystem access;
- ADB visibility does not imply ADB authorization;
- MTP metadata does not prove an application was installed, running, or used;
- one selected device may be processed at a time, but all connected candidates must be detected and safely disambiguated;
- no destructive workflow may rely on implicit first-device selection.

The active WPD/MTP contract is:

[`docs/architecture/d2-3-wpd-mtp-evidence-contract.md`](docs/architecture/d2-3-wpd-mtp-evidence-contract.md)

---

## Evidence model

Evidence is capability-aware and provenance-aware.

Current and planned source vocabulary includes:

```text
WINDOWS_USB
WINDOWS_WPD_MTP
ANDROID_ADB
ANDROID_COMPONENT
OPERATOR
SYSTEM
```

Important evidence rules:

- unavailable data is never fabricated;
- collector failure must not crash the whole verification;
- important fields carry status, source, reason, and collection time;
- restricted identifiers such as IMEI/serial are reported only when legitimately available;
- raw evidence is canonicalized before digest calculation;
- same evidence ID with different canonical content is an integrity conflict;
- WPD scanning is metadata-first and must not open/copy/upload customer content by default.

---

## Sanitization boundary

Sanitization is a separate, higher-risk workflow.

CYVRA Mobile must not claim:

- that a factory-reset command alone proves sanitization;
- that factory reset automatically equals NIST Purge;
- that WPD file deletion proves whole-device sanitization;
- that an unqualified ADB wipe command is universally supported;
- that unsupported privileged/OEM methods are available.

A production sanitization method must have:

```text
capability assessment
authorization
same-device confirmation
method selection
pre-operation evidence persistence
execution evidence
reboot/reconnect handling
post-operation verification
limitations
assurance classification
final report
```

Unsupported or unproven methods remain unsupported.

---

## Repository layout

```text
CYVRA-Mobile/
├── apps/
│   ├── android/             Android supporting component + shared JVM core
│   ├── desktop/             React + Tauri Windows desktop application
│   ├── host/                Kotlin/JVM Domain Engine
│   └── web/                 public/customer/admin web surfaces
├── services/
│   └── api/                 Cloudflare Worker API
├── database/                Drizzle schema + migrations
├── packages/
│   └── evidence/            evidence/report contracts
├── scripts/                 development/deployment helpers
├── docs/                    governing docs, contracts, runbooks, research
└── .github/workflows/       CI/release automation
```

---

## Current maturity

CYVRA uses the following maturity vocabulary:

1. `MODELLED`
2. `UNIT-TESTED`
3. `PROTOCOL-EXPOSED`
4. `UI-INTEGRATED`
5. `HARDWARE-VALIDATED`
6. `RELEASE-VALIDATED`

Do not use compilation or unit tests alone as proof of product support.

At the current engineering baseline:

- Windows USB observation exists.
- WPD/MTP device enumeration has been proven on real Samsung hardware.
- WPD metadata/content-hierarchy scanning is still under implementation.
- Kotlin host/domain functionality is substantially modeled and unit-tested.
- the full customer lifecycle is not yet completely protocol-exposed/UI-integrated.
- production sanitization methods are not yet hardware-qualified.
- the Windows installer/release path is not yet release-validated.

See the Project Index and Final Forensic/System-Design Baseline for the current detailed status.

---

## Toolchain

### JavaScript / web / Worker

Repository pins:

```text
Node >= 24.21.0
npm  >= 12.0.2
pnpm 12.3.4
```

Install:

```bash
pnpm install
```

Common repository checks:

```bash
pnpm typecheck
pnpm build
pnpm test:evidence
pnpm test:api-origins
```

Local API/evidence/report checks:

```bash
pnpm test:local-auth
pnpm test:local-evidence
pnpm test:local-report
pnpm test:local-admin-serials
```

---

## Windows desktop

The Windows desktop application is under:

```text
apps/desktop/
```

Frontend checks:

```powershell
cd apps/desktop
pnpm build
pnpm validate:shell
```

Tauri development:

```powershell
cd apps/desktop
pnpm tauri dev
```

Rust/native checks:

```powershell
cd apps/desktop/src-tauri
cargo check
cargo test
```

Do not run broad crate-root format operations during a narrow native patch without first reviewing formatter scope.

---

## Kotlin Domain Engine and Android component

The shared Gradle build is under:

```text
apps/android/
```

Current accepted Android toolchain:

```text
Kotlin/KGP   2.3.21
AGP          8.13.2
Gradle       9.1.0
JDK          21
compileSdk   36
targetSdk    36
minSdk       26
```

Core + host tests on Windows:

```powershell
cd apps/android
.\gradlew.bat :core:test :host:test
```

If an Android SDK is configured:

```powershell
.\gradlew.bat :app:assembleDebug
```

`minSdk = 26` applies to the supporting APK component. It does not define the Windows workstation's entire device-service floor.

---

## Cloud/API/database development

The root workspace provides:

```bash
pnpm dev
pnpm dev:api
pnpm dev:web
pnpm db:generate
pnpm db:migrate
```

Production principles:

- browser code never receives raw Neon credentials;
- the Worker is the browser-facing database/control-plane boundary;
- secrets are never committed;
- transactional email is server-side only;
- customer and admin authorization is enforced server-side;
- mobile resources remain separate from CYVRA Erase infrastructure.

Operational details belong in the active deployment/runbook documents, not in this README.

---

## Licensing principles

CYVRA distinguishes:

```text
device scan entitlement
operator/user access
device binding
verification transaction
scan consumption
```

These are not interchangeable.

The intended chargeable workflow is:

```text
passive discovery
        ↓
free

operator starts Device Verification
        ↓
entitlement reservation

evidence + Report 1 generation
        ↓
canonical report freeze succeeds

final entitlement consumption
```

Crash/retry/replay behavior must not double-charge the customer.

A public licence/reference number is not treated as a secret authenticator.

---

## Reporting principles

The target architecture uses one canonical report manifest.

```text
canonical evidence
        ↓
canonical report manifest
        ↓
digest / integrity
        ├─ JSON representation
        ├─ PDF representation
        └─ cloud registry verification
```

Report 1 is the **CYVRA Device Verification Report**.

A sanitization/final certificate is generated only after an authorized sanitization workflow and appropriate post-operation verification.

---

## Security and privacy rules

CYVRA Mobile does not:

- bypass screen locks, PINs, passwords, patterns, FRP, bootloader security, or OEM security controls;
- treat USB/MTP/ADB visibility as authorization;
- silently fabricate restricted identifiers;
- crawl private Android data without legitimate capability/authority;
- store payment-provider secrets in the desktop client;
- embed administrative master credentials in customer software;
- place signing private keys in the repository or customer workstation.

The system should report limitations rather than manufacture success.

---

## Development workflow

For architecture-sensitive work:

```text
READ ACTUAL LOCAL API
        ↓
FREEZE SIGNATURES / CONTRACT
        ↓
DESIGN OWNERSHIP + MEMORY/STATE BOUNDARY
        ↓
WRITE MINIMUM CHANGE
        ↓
COMPILE
        ↓
UNIT TEST
        ↓
REAL HARDWARE WHEN REQUIRED
        ↓
REGRESSION
        ↓
REVIEW EXACT DIFF
        ↓
CHECKPOINT
```

Stop rather than guess when:

- an external/native API signature is uncertain;
- a capability depends on OEM or privileged authority;
- device identity is ambiguous;
- a destructive method cannot be safely verified;
- hardware behavior contradicts an assumed generic rule.

---

## Documentation model

Long-term documentation is organized as:

```text
PRIMARY GOVERNANCE
  Canonical Engineering Guideline
  Final Forensic/System-Design Baseline
  Project Index

ACTIVE COMPONENT CONTRACTS
  transport
  WPD/MTP
  evidence
  Android compatibility
  OEM
  licensing
  reports
  sanitization
  testing
  update/release

ACTIVE RUNBOOKS
  current operational procedures only

HISTORICAL ARCHIVE
  old resume documents
  G0–G8 records
  migration/cutover notes
  old freeze guides
  obsolete manuals
  old implementation plans
```

For the authoritative file-by-file classification, use:

[`docs/CYVRA_MOBILE_PROJECT_INDEX.md`](docs/CYVRA_MOBILE_PROJECT_INDEX.md)

---

## Company

**CYVORIQ Solutions Pvt. Ltd.**

CYVRA Mobile is part of the CYVRA product family.
CYVRA Mobile and CYVRA Erase remain separate engineering products and must not share repositories, databases, workers, admin authority, or evidence state accidentally.
