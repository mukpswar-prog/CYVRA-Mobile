# CYVRA Mobile — Canonical Engineering System Audit & Execution Guideline

**Document date:** 2026-09-19
**Status:** CANONICAL EXECUTION GUIDE once committed by the repository owner
**Repository:** `mukpswar-prog/CYVRA-Mobile`
**Audited remote baseline:** `main` at `81309e28e32fa638fd7fcaa1bd0ab0a007888748`
**Active local engineering branch:** `d2-3-wpd-mtp-evidence-plane`
**Current local branch upstream:** none / unpublished
**Current local D2.3 state:** clean controlled reconstruction passed; six intended changes remain uncommitted
**Company:** CYVORIQ Solutions Pvt. Ltd.
**Product:** CYVRA Mobile

---

## 0. Purpose and authority of this document

This document is the single execution map for CYVRA Mobile from 19 September 2026 forward. It consolidates the original product objective, the accepted Android compatibility freeze, the Windows/Tauri desktop architecture, the Host/Kotlin architecture, the Android supporting component, the cloud control plane, the Windows USB work, the approved WPD/MTP architectural correction, the current forensic repository state, and the remaining work required to reach a releasable Windows product.

It does **not** erase historical documentation. Historical documents remain useful as evidence of decisions and design intent. However, where an older document marks a phase as “DONE” merely because a model, class, test double, or engine exists, this document takes precedence for current execution status.

The root `GUIDELINE.md` remains the governing compliance and product-safety charter unless this document explicitly amends a technical assumption. In particular, the prohibitions on password/PIN bypass, FRP bypass, rooting/exploits as a normal flow, unauthorized private-content extraction, and fabricated evidence remain binding.

### 0.1 Required maturity vocabulary

From this point forward, no feature is called simply “done.” Every feature must be classified by the highest level it has actually reached:

1. **MODELLED** — data structures, interfaces, architecture, or service classes exist.
2. **UNIT-TESTED** — deterministic automated tests pass against the model/engine.
3. **PROTOCOL-EXPOSED** — reachable through the real Host/Tauri/API command boundary.
4. **UI-INTEGRATED** — invoked by the real customer-facing workflow.
5. **HARDWARE-VALIDATED** — proven on real supported hardware under defined conditions.
6. **RELEASE-VALIDATED** — proven from a signed/packaged release build on a clean supported machine.

A feature may not be promoted to a higher level by documentation wording alone.

---

# 1. Product objective — what CYVRA Mobile is actually supposed to become

The final product is a Windows-hosted Android evidence, verification, reporting, and controlled sanitization application.

The canonical customer lifecycle is:

```text
DEVICE CONNECTION
    ↓
PHYSICAL DEVICE OBSERVATION
    ↓
NON-DESTRUCTIVE EVIDENCE PREFLIGHT
    ↓
DEVICE VERIFICATION
    ↓
REPORT 1 — DEVICE VERIFICATION REPORT
    ↓
SEPARATE SANITIZATION AUTHORIZATION
    ↓
SUPPORTED SANITIZATION METHOD
    ↓
REBOOT / RECONNECT
    ↓
POST-SANITIZATION VERIFICATION
    ↓
FINAL SANITIZATION & VERIFICATION CERTIFICATE
```

The final deliverable is a Windows application/installer that can be downloaded from an approved distribution channel, installed on supported Windows systems, detect supported Android devices, collect honest evidence using available platform interfaces, generate a defensible report, require a separate explicit authorization before any destructive action, perform only a supported and validated sanitization method, and generate final evidence without making claims the product cannot prove.

### 1.1 Core product invariants

These are permanent unless explicitly changed by a future signed architecture decision:

- Physical USB presence is not the same thing as ADB availability.
- ADB availability is not the same thing as ADB authorization.
- MTP availability is not complete Android filesystem access.
- WPD/MTP shared-storage visibility is not proof of private-app storage visibility.
- A folder name is not proof an app is installed, running, used, or contains a specific private dataset.
- File deletion is not equivalent to certified whole-device sanitization.
- Device connection is not operator authorization.
- License preflight is not license consumption.
- Unavailable evidence is reported as unavailable, restricted, unsupported, or unverified — never invented.
- Sanitization and verification are separate operations.
- A certificate may claim only the assurance level supported by the executed method and the post-sanitization evidence.
- Local physical discovery/evidence must not fail merely because Cloudflare, Neon, Resend, DNS, or the public internet is unavailable.

---

# 2. Original architecture and the approved diversions

## 2.1 Original direction

The original CYVRA Mobile architecture established a Windows-hosted Android product with:

- a Windows host/orchestrator,
- controlled USB/ADB interaction,
- generic Android evidence collection,
- optional on-device Android component evidence,
- OEM-specific capability adapters where legitimately available,
- Report 1 before sanitization,
- separate sanitization authorization,
- post-reset verification,
- final report/certificate,
- licensing/control-plane services,
- and a future Windows customer installer.

The accepted Android freeze positioned `apps/host` as the Windows-side orchestrator and `apps/android` as a supporting Android component rather than the primary product.

## 2.2 Desktop/Tauri decision

The project then established a Tauri v2 Windows desktop shell using Rust for native desktop responsibilities and a Kotlin/JVM Host engine for Android/device/business semantics.

The intended separation was:

```text
React / TypeScript
    presentation only
        ↓
Tauri / Rust
    Windows-native lifecycle
    USB/PnP
    WPD/MTP
    process ownership
    packaging/security boundary
        ↓
Kotlin/JVM Host
    ADB transport
    Android semantics
    capability assessment
    evidence semantics
    licensing/business flow
    reports
    sanitization workflow
        ↓
Android device / optional APK
```

This was the correct general direction. The audit confirms, however, that this separation is not yet fully integrated end-to-end.

## 2.3 Real-hardware discovery that forced an approved correction

Real Samsung hardware testing showed a critical platform reality:

- Windows physically detected the handset.
- MTP/File Transfer was available.
- Windows could expose the handset through the portable-device stack.
- USB debugging could be enabled without the handset exposing an ADB USB function.
- Modern ADB on the workstation therefore had no USB transport to authorize.

This meant an ADB-first acceptance model would reject a physically connected, legitimately visible Android handset even though Windows had authentic device and shared-storage evidence available.

The approved correction was **not project drift**. It was an evidence-driven architecture correction:

> **ADB must no longer gate whether CYVRA can accept and perform a basic device-evidence scan.**

The revised model is:

```text
PHYSICAL USB
    +
WINDOWS WPD/MTP
    = BASIC AUTHENTIC WINDOWS EVIDENCE

PHYSICAL USB
    +
WINDOWS WPD/MTP
    +
AUTHORIZED ADB
    = ADVANCED ANDROID EVIDENCE
```

ADB remains valuable. It is simply no longer the only truth plane.

---

# 3. Canonical evidence-plane architecture

CYVRA Mobile must treat device evidence as multiple independently observable planes.

```text
                    ┌────────────────────┐
                    │ Physical Windows USB│
                    │ WINDOWS_USB         │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │ Windows WPD / MTP  │
                    │ WINDOWS_WPD_MTP    │
                    └─────────┬──────────┘
                              │
                              ├──────────────┐
                              │              │
                    ┌─────────▼──────────┐   │
                    │ Android ADB        │   │
                    │ ANDROID_ADB        │   │
                    └─────────┬──────────┘   │
                              │              │
                    ┌─────────▼──────────┐   │
                    │ Android Component  │   │
                    │ ANDROID_COMPONENT  │   │
                    └─────────┬──────────┘   │
                              │              │
                              └──────┬───────┘
                                     ▼
                          UNIFIED DEVICE EVIDENCE
                                     ↓
                              REPORT 1
```

Additional evidence sources are `OPERATOR` and `SYSTEM`.

### 3.1 Evidence-source rules

Every material report field must retain:

- source,
- timestamp,
- availability/status,
- value if observed,
- limitation/reason if unavailable,
- correlation identity sufficient to bind the evidence to the same physical device/session.

No layer may silently promote a lower-confidence observation into a stronger claim.

---

# 4. Audit evidence and confidence boundaries

This audit used four evidence classes:

### A. Remote source-code truth

The GitHub repository at commit `81309e28e32fa638fd7fcaa1bd0ab0a007888748` was inspected directly through the connected GitHub source.

### B. Local engineering-output truth

The current Windows worktree output was inspected from the supplied forensic logs. The latest controlled reconstruction proves the local D2.3 branch has exactly the intended six code/document changes and that `host_process.rs` is clean again.

### C. User-visible IDE/GitHub Desktop state

The supplied screenshots show the IDE opened against the `cyvra-mobile-implementation` worktree on `d2-3-wpd-mtp-evidence-plane` and GitHub Desktop showing six current changes with a “Publish branch” action.

### D. External authoritative references

Platform statements were checked against Microsoft Learn, Android Developers, NIST, Tauri v2 documentation, GitHub documentation, and Cloudflare documentation.

### 4.1 What was not directly re-verified in this audit

The public CYVRA/CYVORIQ web endpoints were not reachable through the web-research environment during this audit, so live production uptime, live Neon schema state, live Resend delivery, and live Cloudflare route bindings are **not re-certified here**. Repository source and deployment workflows were audited; live-service acceptance must be run separately.

---

# 5. Current repository truth

## 5.1 Remote baseline

Repository:

`mukpswar-prog/CYVRA-Mobile`

Remote `main` baseline audited:

`81309e28e32fa638fd7fcaa1bd0ab0a007888748`

Commit subject:

`fix(desktop): observe present Windows USB device instances`

### 5.1.1 Governance findings

At audit time:

- repository visibility is **public**,
- remote `main` has **no branch protection**,
- no required status checks are configured,
- connected audit access is read-only,
- the local D2.3 feature branch is not yet published remotely.

This is not automatically wrong, but it is inconsistent with a strict production engineering process. If the product is intended to remain proprietary, repository visibility must be deliberately reviewed. Independent of visibility, `main` protection and required checks are strongly recommended before release work.

GitHub documents that protected branches can require status checks to pass before merge. This should become part of the release process.

## 5.2 Current local D2.3 scope

The clean reconstruction established this intended local delta:

```text
M  apps/desktop/src-tauri/Cargo.toml
M  apps/desktop/src-tauri/src/commands.rs
M  apps/desktop/src-tauri/src/lib.rs
?? apps/desktop/src-tauri/src/wpd/discovery.rs
?? apps/desktop/src-tauri/src/wpd/mod.rs
?? docs/architecture/d2-3-wpd-mtp-evidence-contract.md
```

`host_process.rs` is clean again.

The latest local acceptance state is:

- byte-for-byte reconstruction verification: PASS,
- `git diff --check`: PASS,
- `cargo check --locked`: PASS,
- `cargo build --locked`: PASS,
- Rust regression: 21 passed, 0 failed, 1 intentionally ignored hardware test,
- real Samsung WPD regression: PASS,
- customer storage opened: NO,
- customer content read/copied/modified: NO.

This is a safe point for audit and hardening, not yet the point to claim WPD storage evidence is implemented.

---

# 6. Monorepo system map

The audited repository contains these primary production areas:

```text
CYVRA-Mobile/
├── GUIDELINE.md
├── README.md
├── apps/
│   ├── android/
│   │   ├── app/                 optional/supporting Android APK
│   │   └── core/                shared Android/domain evidence models
│   ├── desktop/
│   │   ├── src/                 React desktop UI
│   │   └── src-tauri/           Rust/Tauri Windows-native shell
│   ├── host/                    Kotlin/JVM Host engine
│   └── web/                     public/customer/admin web surfaces
├── database/
│   ├── migrations/
│   └── src/                     Drizzle schema
├── packages/
│   └── evidence/                canonical/shared evidence contracts/catalog
├── services/
│   └── api/                     Cloudflare/API control plane
├── docs/
└── .github/workflows/
```

There is no committed `apps/station` in the audited baseline. Historical references to a Station product must not be interpreted as an active production module.

---

# 7. Desktop Windows audit

## 7.1 React UI

Current `apps/desktop/src/App.tsx` is a foundation UI, not the final product workflow.

It currently:

- invokes `get_host_info`,
- displays host connection state,
- shows a device card with “Waiting for connection,”
- does not yet drive:
  - physical USB state,
  - WPD state,
  - ADB state,
  - device verification,
  - licensing,
  - Report 1,
  - sanitization authorization,
  - sanitization execution,
  - post-reset verification,
  - final report.

**Maturity:** host-info UI = UI-INTEGRATED; device workflow = not yet UI-INTEGRATED.

## 7.2 Tauri/Rust native layer

The Rust layer currently owns:

- Tauri app lifecycle,
- Windows USB notification runtime,
- SetupAPI-based authoritative present-device enumeration,
- USB reconciliation,
- Host process bridge,
- current D2.3 WPD device-manager discovery/enumeration.

This is an appropriate location for Windows-native truth.

### 7.2.1 USB observer result

The USB observer has been proven on real hardware, including unplug/reconnect and USB-debugging-off independence.

Permanent rule:

> **Notification is only the trigger. Enumeration is the truth.**

Remaining USB debt:

- ADB-unauthorized acceptance could not be exercised because the test handset did not expose an ADB USB function.
- rapid reconnect/shutdown stress remains to be executed,
- final B3A closure audit remains to be executed.

Therefore USB is strong but not yet “release-validated.”

## 7.3 D2.3 WPD/MTP state

The current implementation has reached real WPD manager enumeration and real-hardware handset discovery.

Microsoft documents the key behaviors we have designed around:

- `IPortableDeviceManager::GetDevices` uses a two-pass count/buffer pattern.
- `S_FALSE` can occur if the caller’s array becomes too small.
- the device-manager list is not automatically refreshed; `RefreshDeviceList` is required.
- each returned PnP ID string is allocated by the API and must be freed with `CoTaskMemFree`.

Current D2.3 maturity:

| Capability | Maturity |
|---|---|
| COM apartment creation | HARDWARE-VALIDATED |
| Portable Device Manager creation | HARDWARE-VALIDATED |
| RefreshDeviceList | HARDWARE-VALIDATED |
| GetDevices enumeration | HARDWARE-VALIDATED |
| optional WPD display metadata | HARDWARE-VALIDATED |
| Tauri command boundary | PROTOCOL-EXPOSED and compiled |
| WPD device open | NOT STARTED |
| WPD content/root enumeration | NOT STARTED |
| storage discovery | NOT STARTED |
| recursive metadata inventory | NOT STARTED |
| WPD evidence model | NOT STARTED |
| unified report integration | NOT STARTED |

### 7.3.1 Mandatory D2.3 hardening before storage work

Before `IPortableDevice::Open`:

1. Add a bounded retry for the two-pass `GetDevices` topology race.
2. Decide whether raw PnP IDs should cross the Tauri IPC boundary. Default decision: **keep raw IDs internal to Rust/native correlation**, expose only a session-scoped opaque ID to the UI unless a concrete product requirement proves otherwise.
3. Confirm exact local `windows = 0.61.3` bindings for:
   - `PortableDeviceFTM` / portable-device coclass,
   - `IPortableDevice::Open`,
   - `IPortableDeviceValues`,
   - WPD client property keys,
   - `IPortableDevice::Content`,
   - `IPortableDeviceContent::EnumObjects`,
   - `IEnumPortableDeviceObjectIDs::Next`.
4. Open the handset with `WPD_CLIENT_DESIRED_ACCESS = GENERIC_READ` only.

Microsoft explicitly recommends `GENERIC_READ` when the application does not need write operations.

### 7.3.2 WPD privacy boundary

The first production scanner must be metadata-first.

Allowed by default:

- WPD device identity/name fields,
- storage functional object IDs,
- storage description/capacity/free-space/filesystem/serial if exposed,
- object ID / persistent ID,
- parent ID,
- object name,
- format/content type,
- extension,
- size,
- creation/modification timestamps,
- aggregate category counts,
- aggregate bytes,
- scan errors and limitations,
- deterministic inventory digest.

Not allowed by default:

- opening customer documents/photos/videos for content inspection,
- preview generation,
- copying customer content,
- uploading customer content,
- parsing private messages,
- claiming private Android data coverage,
- bypassing scoped storage or platform isolation.

---

# 8. Kotlin/JVM Host audit

## 8.1 Host role is correct but integration is incomplete

`apps/host` contains substantial domain engineering:

- ADB locator/client/inspector,
- connection state machine,
- preflight verifier,
- generic ADB evidence provider,
- Android component bridge,
- capability coordinator,
- workstation session orchestrator,
- license engines,
- report engine,
- sanitization provider/workflow,
- OEM adapter registry,
- grading/AI/review models,
- packaging/update/release models,
- extensive unit tests.

This is valuable code, but **presence of an engine is not equivalent to production integration**.

## 8.2 Host Protocol V1 is the actual bottleneck

The audited production Host protocol exposes only:

```text
GET_HOST_INFO
GET_PREFLIGHT
GET_DEVICE_STATE
```

It does **not** yet expose real commands for:

- device verification,
- WPD evidence ingestion,
- diagnostic execution,
- entitlement reservation,
- report generation,
- sanitization authorization,
- sanitization execution,
- reconnect verification,
- final certificate.

This is one of the most important distinctions in the entire audit.

Many C-phase classes marked as “done” in older handoff documents are better classified as **MODELLED** or **UNIT-TESTED**, not end-to-end completed.

## 8.3 Known Host device-state defect

`GET_DEVICE_STATE` currently derives:

```text
usbConnected = discoveredDevices.isNotEmpty()
```

from the ADB device list.

That contradicts the now-proven physical USB architecture.

This must be removed from the final system. Rust has authoritative Windows USB/WPD truth; the Host must not infer physical USB from ADB.

### 8.3.1 Target replacement

Do not make React the orchestrator.

Use an explicit native snapshot contract such as:

```text
WindowsNativeDeviceSnapshot
  sessionDeviceRef
  usb:
    state
    observations
  wpd:
    state
    deviceMetadata
    storageSummary
    limitations
  adb:
    state
    descriptor?
```

Rust should create the Windows-native portion. Kotlin should consume a normalized snapshot for business/evidence semantics.

A protocol evolution should be explicit. Do not silently overload `GET_DEVICE_STATE`.

Preferred design:

```text
Host Protocol V2
  GET_HOST_INFO
  GET_PREFLIGHT
  EVALUATE_DEVICE_SNAPSHOT
  START_DEVICE_VERIFICATION
  FINALIZE_DEVICE_VERIFICATION
  REQUEST_SANITIZATION_PLAN
  AUTHORIZE_SANITIZATION
  VERIFY_POST_SANITIZATION
```

The exact V2 schema must be frozen before implementation.

---

# 9. Android Studio / Android component audit

## 9.1 Toolchain freeze

Current accepted Android baseline:

- Kotlin/KGP: 2.3.21
- Android Gradle Plugin: 8.13.2
- Gradle: 9.1.0
- JDK: 21
- compileSdk: 36
- targetSdk: 36
- minSdk: 26
- app id: `co.in.cyvra.mobile`
- Kotlin package: `cyvra.mobile`

The Android project includes `:core`, `:host`, and conditionally `:app` when a usable Android SDK configuration is present.

## 9.2 Correct product role

The APK is a **supporting evidence component**, not the primary orchestrator.

This should remain frozen.

ADB itself is user-authorized on modern Android: Android documents that Android 4.2.2+ shows an RSA authorization dialog and ADB commands are blocked until the device is unlocked and the dialog is acknowledged. That is another reason CYVRA must keep ADB state separate from physical connection and MTP state.

## 9.3 Android component security finding

The current manifest declares `ComponentEvidenceReceiver` with:

```xml
android:exported="true"
```

and a custom broadcast action.

Android documentation states an exported receiver can receive broadcasts from outside the application.

The current receiver accepts session identifiers supplied through the broadcast and writes evidence output. This is non-destructive, but it expands the attack/spoofing surface and can allow unrelated apps to trigger the receiver.

Before production:

- define the real Host→APK invocation security model,
- determine whether a protected receiver, explicit component invocation, one-time nonce, signed challenge, or alternate IPC is appropriate,
- bind returned evidence to the workstation-created session,
- reject stale/replayed/malformed requests,
- do not rely on a public action string as authorization.

Do not simply flip `exported=false` without testing, because ADB shell invocation is external to the app and the transport design must still work.

## 9.4 Android storage truth

Android 11+ scoped storage materially limits access to other apps’ private/app-specific data. Android documentation specifically states that apps cannot access other apps’ data directories and have restricted access to app-specific external directories.

Therefore:

- WPD-visible shared-storage metadata is valid evidence of what Windows exposes.
- Android component evidence is valid evidence of what the component can legitimately access.
- neither is permission to claim full-device private-storage visibility.

---

# 10. Evidence-model audit

Current `GenericDeviceEvidence` has:

- identity,
- battery,
- storage,
- security,
- features.

The ADB provider already follows an important honesty rule: unavailable hardware serial/IMEI/SOH/Knox information is not fabricated.

However, WPD must **not** be forced awkwardly into the ADB-centric `GenericDeviceEvidence` structure.

Introduce dedicated structures:

```text
WpdDeviceEvidence
WpdStorageEvidence
WpdObjectEvidence
WpdExposureSummary
WpdRiskIndicator
WpdScanLimitations
```

Then fuse sources in:

```text
UnifiedDeviceEvidence
  windowsPhysicalEvidence
  mtpExposureEvidence
  adbDeviceEvidence?
  androidComponentEvidence?
  operatorEvidence?
  systemEvidence
  limitations
```

Every source retains provenance.

---

# 11. Licensing audit

The Kotlin `HostLicenseService` has useful domain semantics:

- immutable-ish license record handling,
- scan transaction commit,
- final debit after successful report generation,
- offline/server-unavailable state modeling.

The workstation orchestrator currently follows the desired order:

```text
commit entitlement transaction
    ↓
collect evidence
    ↓
generate report
    ↓
finalize debit
```

But the current Kotlin service is largely an in-memory/domain implementation. Production completeness still requires:

- API-backed entitlement authority,
- durable transaction IDs,
- replay/idempotency protection,
- offline policy,
- crash recovery,
- reservation expiry,
- exact definition of when entitlement becomes non-refundable/consumed,
- admin issuance/revocation integration,
- audit trail,
- real end-to-end tests with Neon/API.

Canonical rule:

> Plugging a device in, USB/WPD preflight, or passive device discovery must never consume a scan.

The transaction begins only when the operator explicitly starts **Device Verification**.

---

# 12. Report audit

`HostReportEngine` supports:

- Report 1 generation,
- final sanitization certificate models,
- JSON/Markdown,
- SHA-256 digest.

This is a strong foundation, but the report path is not production complete because:

- WPD evidence is not yet included,
- Host Protocol does not expose the full flow,
- React does not execute the flow,
- local report semantics and cloud `/reports/freeze` semantics are not yet reconciled,
- sanitization verification confidence is not yet strong enough for a final certificate.

Before release, freeze one canonical report manifest and digest process so that local evidence, cloud persistence, export, and future verification all agree about the exact bytes/fields being hashed.

---

# 13. Sanitization audit — highest-risk remaining domain

The current sanitization code is **not production-ready**.

## 13.1 What exists

There is a real stateful model:

- capability assessment,
- two-step operator confirmation,
- method selection,
- dry-run execution,
- reconnect state,
- verification model,
- final certificate generation.

That is valuable and should be preserved.

## 13.2 What is not proven

The destructive implementation currently attempts ordinary ADB-shell commands such as:

```text
recovery --wipe_data
am broadcast -a android.intent.action.MASTER_CLEAR
```

These are not universally available to an ordinary ADB shell on stock Android, and they have not been physically qualified as a supported production sanitization method across the intended support matrix.

No release may represent this as universally functioning.

## 13.3 Current post-reset verification is too weak

The present verification logic can infer setup-wizard/OOBE from absence of a screen lock and can treat that as evidence of user-data inaccessibility.

That is insufficient for a high-assurance sanitization certificate.

Before any real destructive test:

- define per-method sanitization assurance,
- define prerequisites/privilege requirements,
- bind the sanitization operation to the same device,
- record platform reset acknowledgement/result,
- detect reconnect independently,
- verify appropriate post-reset state using multiple signals,
- classify inaccessible/unavailable evidence honestly,
- require external/operator verification where platform APIs cannot prove a claim,
- do not claim physical NAND erasure from ordinary software observations.

NIST SP 800-88 Rev.2, published September 2025, emphasizes an organizational sanitization program, applicable methods/controls, and sanitization validation. CYVRA should use NIST terminology carefully and avoid turning a generic Android factory reset into a stronger claim than the evidence supports.

---

# 14. Cloud/API/database/admin audit

The repository contains:

- Cloudflare Worker/API code,
- web/customer/admin UI code,
- Drizzle database schema and migrations,
- mobile license serial records,
- staff/admin records and sessions,
- evidence/report persistence code,
- Cloudflare deployment workflows.

This is a substantial control-plane foundation.

However, the local Windows scan must remain operationally independent from cloud availability for physical discovery and local evidence collection.

Recommended split:

```text
LOCAL TRUST PATH
USB/WPD/ADB/APK → evidence → local report artifact

CONTROL PLANE
auth/licensing → account/admin → cloud report registry → notifications → updates
```

Cloud synchronization happens after or around the locally generated evidence transaction; it must not redefine observations already captured from the handset.

### 14.1 Live-service audit status

Live production endpoints were not successfully queried from the audit environment. Therefore cloud source is audited, but live uptime/configuration is **not certified by this document**.

Run a separate cloud acceptance suite before release:

- API health,
- DB connectivity,
- schema/migration version,
- customer auth,
- staff/admin auth,
- license issuance,
- license activation/validation,
- reserve/finalize/refund semantics,
- evidence ingest,
- report freeze,
- Resend delivery,
- rate limiting,
- CORS/origin policy,
- audit logging.

---

# 15. CI, repository governance, and release audit

## 15.1 Current weakness

The audited `.github/workflows` directory primarily contains web/API deployment workflows. A full Windows desktop build/test/release workflow is not present in the audited remote baseline.

Remote `main` is not protected.

This is unacceptable for the final release stage.

## 15.2 Required CI before release

Required PR checks should include at minimum:

```text
Windows / Rust
  cargo check --locked
  cargo test --locked
  release build

Desktop / React
  pnpm install --frozen-lockfile
  desktop TypeScript build
  lint
  targeted shell validation after existing validator debt is corrected

Kotlin Host/Core
  :core:test
  :host:test
  installDist / packaging smoke

Android
  assembleDebug or defined production-support build where SDK is available
  unit tests
  manifest/security checks

Contracts
  evidence schema validation
  report manifest validation
  API type checks

Security
  dependency audit
  secret scanning
```

Then protect `main` and require the accepted checks before merge.

## 15.3 Installer/release requirements

Tauri supports Windows MSI and NSIS `-setup.exe` installers. The final CYVRA release gate must choose the approved format and validate it on a clean Windows 10/11 machine.

Before customer release:

- build release artifact on Windows CI,
- bundle all required local runtime dependencies intentionally,
- decide how the Kotlin Host is packaged,
- remove assumptions that a developer JDK/Gradle workspace exists,
- code-sign the Windows executable/installer,
- store signing keys in an approved secure system,
- validate SmartScreen behavior,
- produce SHA-256 checksums,
- create immutable GitHub release artifacts,
- add update signing only after update policy is frozen.

Tauri’s updater requires signed update artifacts and the update signature cannot be disabled.

---

# 16. Sidecar/Host packaging decision that still needs closure

The current Rust Host bridge launches Java based on a development build/install layout.

That is acceptable for engineering, not for a standalone customer installer.

Tauri supports bundling external binaries through `bundle.externalBin`, but the Kotlin Host is currently JVM code. Before release choose one explicit strategy:

### Option A — package a private Java runtime + Host distribution

Pros:
- minimal Host rewrite,
- preserves Kotlin engineering.

Cons:
- larger installer,
- more packaging complexity,
- Java runtime lifecycle/patching responsibility.

### Option B — compile/package Host into a native executable

Pros:
- cleaner customer dependency model.

Cons:
- significant toolchain and compatibility work.

### Option C — progressively migrate Host functions into Rust

Pros:
- single native process long term.

Cons:
- higher rewrite risk; conflicts with the accepted incremental-migration principle if attempted wholesale.

**Canonical recommendation:** keep Kotlin Host for now, prove the product workflow first, then solve customer packaging as a controlled release-engineering gate. Do not rewrite the Host simply to avoid packaging work.

---

# 17. Documentation audit

## 17.1 Root README

The root README contains valuable history but is now partially stale:

- it is still ADB-centric in some device-proof language,
- it does not fully explain WPD/MTP as a first-class evidence plane,
- it does not clearly present `apps/desktop` as the current customer application shell.

Update it after the canonical guide is committed.

## 17.2 `apps/desktop/README.md`

This is still largely the default React/Vite template.

Replace it with real CYVRA desktop engineering documentation before release.

## 17.3 Historical “DONE” labels

Some handoff/freeze documents describe C0–C24 as done.

The code audit shows a more nuanced truth:

- many models/engines exist,
- many have unit tests,
- only a small subset is connected through the real desktop protocol/UI,
- destructive sanitization is not hardware-qualified,
- release packaging is incomplete.

This canonical guide replaces those blanket status labels with the six-level maturity system defined in section 0.1.

---

# 18. Current system maturity matrix

| Domain | Current highest proven maturity | Release gap |
|---|---|---|
| Root product/compliance architecture | MODELLED / accepted | consolidate docs |
| Windows USB notification + enumeration | HARDWARE-VALIDATED | stress/final closure |
| WPD device-manager enumeration | HARDWARE-VALIDATED | open/content/storage not done |
| Tauri WPD command | PROTOCOL-EXPOSED | UI/privacy hardening |
| React desktop device workflow | foundation only | full lifecycle |
| Host Protocol V1 | PROTOCOL-EXPOSED | too small; no verification/report/sanitize flow |
| ADB generic evidence | UNIT-TESTED / prior hardware-dependent | integrate optional advanced path |
| Android support APK | implemented support component | security + real integration acceptance |
| Unified evidence | MODELLED concept only | implement |
| License domain engine | UNIT-TESTED | durable API integration |
| Report 1 engine | UNIT-TESTED | WPD fusion + protocol/UI + artifact acceptance |
| Sanitization workflow | UNIT-TESTED model/dry run | real supported method qualification |
| Post-reset verification | MODELLED / UNIT-TESTED | redesign stronger evidence |
| Final certificate | MODELLED / UNIT-TESTED | depends on sanitization validation |
| Web/API/admin | substantial source present | full current live acceptance |
| Installer | Tauri bundling configured | Host packaging/signing/clean-machine test |
| Windows CI/release | incomplete | required |
| Git governance | weak | protect main + checks |

---

# 19. Priority risk/debt register

## P0 — must resolve before deeper destructive/release work

1. **Canonical current-state documentation**
   - Commit this guide after owner review.
2. **D2.3 current change set**
   - harden before checkpoint.
3. **Raw PnP ID exposure**
   - keep internal unless UI genuinely needs it.
4. **WPD topology race**
   - bounded retry for count/enumeration race.
5. **Host physical-state defect**
   - remove ADB-derived `usbConnected`.
6. **Unified device correlation**
   - avoid `firstOrNull()` semantics in multi-device conditions.
7. **Sanitization assurance**
   - no production destructive execution until method-specific qualification.
8. **Post-reset verification**
   - remove weak “no lock == OOBE == cleared” assumption.

## P1 — required for product workflow

9. WPD read-only device open.
10. storage functional-object discovery.
11. bounded recursive metadata inventory.
12. WPD evidence models and deterministic digest.
13. Host Protocol V2 / equivalent frozen contract.
14. licensing transaction integration.
15. Report 1 end-to-end.
16. desktop workflow/UI integration.
17. Android receiver invocation security.
18. real ADB-ready handset acceptance in addition to MTP-only handset.

## P2 — release engineering

19. Kotlin Host customer packaging.
20. Windows CI.
21. branch protection.
22. signed installer.
23. clean-machine Win10/Win11 acceptance.
24. updater policy/signing.
25. cloud/admin end-to-end acceptance.

---

# 20. Canonical execution process

Every engineering gate must follow:

```text
1. READ CURRENT STATE
2. VERIFY BRANCH + HEAD + DIRTY SCOPE
3. CHECK EXACT PLATFORM/API SIGNATURES
4. DEFINE OWNERSHIP / FAILURE SEMANTICS
5. MAKE THE SMALLEST CHANGE
6. TARGETED FORMAT ONLY
7. COMPILE
8. UNIT TEST
9. REAL-HARDWARE TEST WHEN APPLICABLE
10. REGRESSION
11. REVIEW EXACT DIFF
12. CHECK ENCODING / NO UNRELATED CHURN
13. RECORD PASS/BLOCKED/STOP
14. COMMIT ONLY AFTER GATE ACCEPTANCE
```

### 20.1 Formatting rule

Never run crate-root `rustfmt` casually as part of a narrow repair.

The September 19 forensic incident proved that formatting `lib.rs` reformatted unrelated child modules.

Use one of:

- leaf-file formatting,
- `cargo fmt --check` only after repository-wide formatting policy is deliberately frozen,
- controlled reconstruction for tiny root-module edits.

Never allow formatter churn to become part of a security/device patch unintentionally.

### 20.2 PowerShell rule

For native commands:

- stdout/stderr alone do not define success,
- use process exit code,
- avoid interpreting command output as a Boolean where the command signals through `$LASTEXITCODE`,
- use `Set-StrictMode -Version Latest` in safety scripts,
- explicitly assign every verification variable,
- use `git --no-pager` for scripted diffs.

---

# 21. Immediate next action plan

## Gate G0 — Commit this canonical guide locally

**Goal:** make the project’s current truth visible in the repository before further engineering.

Action:

1. Add this document to:
   `docs/CYVRA_MOBILE_CANONICAL_ENGINEERING_GUIDELINE_2026-09-19.md`
2. Do not change application code in the same operation.
3. Confirm GitHub Desktop shows the existing six D2.3 changes plus this guide.
4. Review the guide diff.
5. Do not publish/merge until the owner explicitly approves the document.

Expected state after adding guide:

```text
M  apps/desktop/src-tauri/Cargo.toml
M  apps/desktop/src-tauri/src/commands.rs
M  apps/desktop/src-tauri/src/lib.rs
?? apps/desktop/src-tauri/src/wpd/discovery.rs
?? apps/desktop/src-tauri/src/wpd/mod.rs
?? docs/architecture/d2-3-wpd-mtp-evidence-contract.md
?? docs/CYVRA_MOBILE_CANONICAL_ENGINEERING_GUIDELINE_2026-09-19.md
```

## Gate G1 — D2.3 final pre-checkpoint hardening

Implement only:

1. bounded `GetDevices` retry,
2. WPD IPC privacy decision,
3. deterministic error codes/tests,
4. full Rust regression,
5. real handset regression.

No storage open yet.

## Gate G2 — D2.3 checkpoint commit

Once G1 passes:

- commit D2.3 architecture + manager enumeration + Tauri boundary + canonical guide,
- publish feature branch,
- open PR,
- do not merge until review and CI policy decision.

## Gate G3 — WPD read-only API audit

Read exact local `windows 0.61.3` generated bindings for:

- `PortableDeviceFTM` / coclass,
- `PortableDeviceValues`,
- `IPortableDeviceValues::SetUnsignedIntegerValue`,
- `WPD_CLIENT_NAME`,
- `WPD_CLIENT_DESIRED_ACCESS`,
- `GENERIC_READ`,
- `IPortableDevice::Open`,
- `IPortableDevice::Content`,
- `IPortableDeviceContent::EnumObjects`,
- `IEnumPortableDeviceObjectIDs::Next`.

No repository modification in this gate.

## Gate G4 — Read-only handset open

Acceptance:

- real Samsung opens through WPD,
- `GENERIC_READ` explicitly requested,
- no write capability requested,
- no customer content read,
- reconnect/failure errors stable.

## Gate G5 — Root and storage discovery

Enumerate only root/functional objects first.

Prove the object corresponding to handset/shared storage exists.

Do not recursively scan files yet.

## Gate G6 — WPD storage metadata scanner

Implement bounded recursive metadata enumeration with:

- object count/depth/time bounds,
- cancellation,
- stable ordering,
- deterministic digest,
- per-object error isolation,
- no content streams opened.

## Gate G7 — Unified evidence schema

Add WPD evidence structures and source provenance.

Do not remove honest ADB evidence models.

## Gate G8 — Device correlation and state model

Create one session-scoped device identity that correlates:

- Windows USB,
- WPD,
- optional ADB,
- optional Android component.

Support more than one connected device safely.

## Gate G9 — Host Protocol V2 contract

Freeze schema before implementation.

V2 must carry native evidence into Host business semantics without making React the orchestrator.

## Gate G10 — Device Verification transaction

Real end-to-end path:

```text
operator starts verification
→ validate/reserve entitlement
→ snapshot physical/WPD evidence
→ add ADB/component evidence when available
→ classify capabilities
→ generate Report 1
→ persist/freeze report
→ finalize debit
```

Test failure/retry/crash/idempotency.

## Gate G11 — Desktop customer workflow

Replace placeholder “Waiting for connection” UI with orthogonal states:

```text
USB_PRESENT / USB_ABSENT
MTP_UNAVAILABLE / MTP_READY / MTP_SCANNING / MTP_EVIDENCE_READY
ADB_UNAVAILABLE / ADB_UNAUTHORIZED / ADB_OFFLINE / ADB_READY
```

Never tell the user “waiting for connection” when Windows already sees the handset through WPD.

## Gate G12 — Android component hardening

Freeze secure Host→APK invocation and evidence binding.

Run real device acceptance.

## Gate G13 — Report 1 release acceptance

Validate:

- evidence provenance,
- limitations,
- deterministic manifest,
- digest,
- export,
- cloud persistence,
- reopen/reverify.

## Gate G14 — Sanitization method qualification

For each supported method:

- supported device/OS/management prerequisites,
- authorization,
- execution mechanism,
- expected reset behavior,
- failure modes,
- post-reset evidence,
- assurance classification.

Anything not proven becomes `UNSUPPORTED` or `REQUIRES_EXTERNAL_VERIFICATION`.

## Gate G15 — Final certificate

Only after G14 hardware acceptance.

## Gate G16 — Admin/licensing/cloud acceptance

End-to-end production-like test using non-production test accounts/data.

## Gate G17 — Windows packaging

Package the Kotlin Host/runtime correctly with Tauri.

No customer machine may require Android Studio, Gradle, repository source, or a developer-installed JDK unless deliberately documented as a prerequisite — the preferred production design is to bundle required runtime dependencies.

## Gate G18 — CI and branch protection

Add Windows/desktop/Host/Android checks and protect `main`.

## Gate G19 — Signed release candidate

Build signed installer, hash it, and publish as a release candidate.

## Gate G20 — clean-machine acceptance

Windows 10 and Windows 11:

- install,
- launch,
- host starts,
- USB works,
- MTP works,
- optional ADB works,
- verification works,
- license works,
- Report 1 works,
- update/uninstall works,
- no development environment required.

## Gate G21 — controlled sanitization release acceptance

Only approved test devices/data.

## Gate G22 — Production release

Release only after all mandatory gates are evidenced.

---

# 22. Definition of the final CYVRA Mobile release

A product release is acceptable only when all of the following are true:

- installer is reproducible and signed,
- supported Windows versions are explicit,
- supported Android capability tiers are explicit,
- physical USB works without ADB,
- WPD/MTP basic scan works without ADB,
- ADB adds advanced evidence only when available/authorized,
- evidence is provenance-labeled,
- customer content is not silently opened/copied,
- licensing is transactional and durable,
- Report 1 is generated and verifiable,
- sanitization is separately authorized,
- only validated methods are offered,
- post-reset verification is evidence-based,
- final certificate language matches actual assurance,
- release artifact passes clean-machine testing,
- CI and branch protection are active,
- admin/cloud services pass production acceptance,
- no unreviewed formatter or unrelated churn exists in the release commit.

---

# 23. External authoritative references used for this audit

## Windows Portable Devices

Microsoft — `IPortableDeviceManager::GetDevices`
https://learn.microsoft.com/en-us/windows/win32/api/portabledeviceapi/nf-portabledeviceapi-iportabledevicemanager-getdevices

Microsoft — `IPortableDevice::Open`
https://learn.microsoft.com/en-us/windows/win32/api/portabledeviceapi/nf-portabledeviceapi-iportabledevice-open

Microsoft — Enumerating Content
https://learn.microsoft.com/en-us/windows/win32/wpd_sdk/enumerating-content

Microsoft — `IPortableDeviceContent::EnumObjects`
https://learn.microsoft.com/en-us/windows/win32/api/portabledeviceapi/nf-portabledeviceapi-iportabledevicecontent-enumobjects

## Android

Android Developers — Run apps on a hardware device / ADB RSA authorization
https://developer.android.com/studio/run/device

Android Developers — Android 11 scoped storage changes
https://developer.android.com/about/versions/11/privacy/storage

Android Developers — `<receiver>` / exported receiver behavior
https://developer.android.com/guide/topics/manifest/receiver-element

## Sanitization

NIST SP 800-88 Rev.2 — Guidelines for Media Sanitization
https://csrc.nist.gov/pubs/sp/800/88/r2/final

## Tauri

Tauri v2 — Embedding external binaries / sidecars
https://v2.tauri.app/develop/sidecar/

Tauri v2 — Windows installer
https://v2.tauri.app/distribute/windows-installer/

Tauri v2 — Windows code signing
https://v2.tauri.app/distribute/sign/windows/

Tauri v2 — Updater
https://v2.tauri.app/plugin/updater/

Tauri v2 — GitHub pipelines
https://v2.tauri.app/distribute/pipelines/github/

## GitHub

GitHub — protected branches / required status checks
https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches

## Cloudflare

Cloudflare Hyperdrive — connection pooling
https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/

---

# 24. Final engineering decision

CYVRA Mobile is **not stuck** and does not require an architectural restart.

The audit shows:

- the Windows USB foundation is real,
- WPD/MTP is the correct additional Windows evidence plane,
- the Samsung hardware path is proven through WPD manager enumeration,
- the Kotlin Host contains substantial reusable business/evidence engineering,
- the Android component should remain supporting,
- the cloud control plane is a separate concern from local device evidence,
- the largest remaining problem is not missing code volume but **integration maturity, evidence correlation, sanitization qualification, and release governance**.

The project should therefore continue by **consolidating**, not rewriting.

The immediate engineering rule after this document is committed is:

> Harden D2.3, freeze a checkpoint, then open the handset through WPD in explicit read-only mode and build the metadata evidence plane before touching customer content or destructive behavior.

This is the shortest safe route to the final Windows product.
