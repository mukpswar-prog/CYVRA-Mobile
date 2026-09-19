# CYVRA Mobile — Final Forensic & System-Design Audit Baseline

**Document date:** 2026-09-19
**Status:** FINAL FORENSIC / SYSTEM-DESIGN BASELINE — companion to the Canonical Engineering Guideline
**Repository:** `mukpswar-prog/CYVRA-Mobile`
**Audited remote baseline:** `main` at `81309e28e32fa638fd7fcaa1bd0ab0a007888748`
**Active local engineering branch at audit:** `d2-3-wpd-mtp-evidence-plane`
**Company:** CYVORIQ Solutions Pvt. Ltd.
**Product:** CYVRA Mobile
**Execution strategy:** **CONSOLIDATE → CORRECT → INTEGRATE → HARDWARE-PROVE → RELEASE-PROVE**

---

## 0. Authority, scope, and relationship to the canonical guide

This document is the final issue register, mitigation baseline, architecture-correction map, and macro execution plan produced from the 19 September 2026 forensic/system-design audit.

It is a **companion**, not a replacement, to:

- `docs/CYVRA_MOBILE_CANONICAL_ENGINEERING_GUIDELINE_2026-09-19.md`
- root `GUIDELINE.md` while the root compliance charter remains separately active.

The documents have different jobs:

| Document | Job |
|---|---|
| Canonical Engineering Guideline | Product objective, architectural invariants, maturity model, engineering process, detailed G0–G22 execution gates |
| Final Forensic & System-Design Audit Baseline | Current defects/risks, root causes, mitigation design, ordering constraints, macro Phase 1–5 plan |
| Project Index & Documentation Register | Navigation, ownership, active/superseded classification, archival policy |

### 0.1 Precedence rule

1. Compliance/safety prohibitions are never weakened by this document.
2. The Canonical Engineering Guideline defines the intended product and engineering rules.
3. This baseline **adds** defects, risks, and mandatory remediation gates discovered during deeper code/system review.
4. Where an old handoff, freeze, resume, dashboard, or implementation-plan file disagrees with either current document, the old file is historical.
5. Component contracts may remain active when they are narrower and do not conflict with these two governing documents.
6. A newer evidence-backed architecture decision may amend an older technical assumption, but the amendment must be recorded in both the project index and this baseline.

### 0.2 No “DONE” without maturity level

Use only:

1. `MODELLED`
2. `UNIT-TESTED`
3. `PROTOCOL-EXPOSED`
4. `UI-INTEGRATED`
5. `HARDWARE-VALIDATED`
6. `RELEASE-VALIDATED`

A class, test double, document, or passing unit test is not evidence of end-to-end product completion.

---

# 1. Executive engineering conclusion

CYVRA Mobile does **not** require a rewrite.

The forensic audit found a substantial and reusable engineering base:

- real Windows USB observation,
- real Windows WPD enumeration,
- a viable Rust/Tauri native layer,
- a substantial Kotlin/JVM domain engine,
- a supporting Android component,
- evidence schemas and report concepts,
- a Cloudflare/Neon/Resend control plane,
- licensing/admin foundations,
- and a clear product lifecycle separating verification from sanitization.

The project’s problem has changed.

Earlier the challenge was building capabilities.

The present challenge is:

> **make the existing capabilities agree on identity, evidence, state, authority, transaction boundaries, security, reporting, sanitization assurance, and release packaging.**

The program therefore moves through five macro phases:

```text
PHASE 1 — CONSOLIDATE
        ↓
PHASE 2 — CORRECT
        ↓
PHASE 3 — INTEGRATE
        ↓
PHASE 4 — HARDWARE-PROVE
        ↓
PHASE 5 — RELEASE-PROVE
```

No destructive customer-facing sanitization claim is allowed before Phase 4 acceptance.

---

# 2. Frozen target architecture

## 2.1 Product lifecycle

```text
DEVICE CONNECTION
    ↓
PHYSICAL DEVICE OBSERVATION
    ↓
NON-DESTRUCTIVE EVIDENCE PREFLIGHT
    ↓
DEVICE VERIFICATION
    ↓
REPORT 1 — CYVRA DEVICE VERIFICATION REPORT
    ↓
SEPARATE SANITIZATION AUTHORIZATION
    ↓
SUPPORTED / QUALIFIED SANITIZATION METHOD
    ↓
REBOOT / RECONNECT
    ↓
POST-SANITIZATION VERIFICATION
    ↓
FINAL SANITIZATION & VERIFICATION CERTIFICATE
```

## 2.2 Runtime responsibility split

Use explicit names from now on:

```text
CYVRA Desktop UI
React / TypeScript
presentation only
        │
        ▼
CYVRA Native Layer
Rust / Tauri
Windows USB / PnP / WPD / process lifecycle / local native truth
        │
        ▼
CYVRA Domain Engine
Kotlin / JVM
Android semantics / capability policy / workflow / licensing / reports / sanitization
        │
        ├───────────────┐
        ▼               ▼
ADB / Android      Android Component
optional advanced  optional device-side evidence
evidence
```

Separate control plane:

```text
Cloudflare Worker
    ├── customer auth
    ├── admin auth
    ├── entitlement authority
    ├── evidence sync
    ├── report registry
    ├── audit
    └── Resend
        │
        ▼
      Neon
```

### 2.3 Local/cloud source-of-truth rule

The workstation owns **observational truth**:

```text
device observation
→ local canonical evidence artifact
→ local digest
→ local Report 1 artifact
```

The cloud owns **control-plane and registry truth**:

```text
account
licence
entitlement transaction
cloud evidence registry
report registry
admin/audit
```

Cloud synchronization may validate, store, and register evidence. It must not silently redefine what the workstation observed.

---

# 3. Permanent product invariants

- Physical USB presence ≠ ADB availability.
- ADB availability ≠ ADB authorization.
- WPD/MTP visibility ≠ complete Android filesystem visibility.
- Folder presence ≠ installed/running/used application.
- Device connection ≠ operator authorization.
- Licence preflight ≠ licence consumption.
- Verification ≠ sanitization authorization.
- File deletion ≠ certified whole-device sanitization.
- Unavailable evidence is never fabricated.
- A report claim may be no stronger than its underlying evidence.
- Local physical discovery/evidence must not depend on internet availability.
- React must not become the device/business orchestrator.
- Rust owns Windows-native truth.
- Kotlin owns business/domain semantics.
- The Android APK is supporting evidence, not the primary workstation orchestrator.
- A cloud report must be traceable to the same canonical evidence identity used locally.
- Multi-device selection must be explicit; `firstOrNull()`-style implicit device selection is not acceptable for destructive or chargeable operations.

---

# 4. Current proven state

At the audited checkpoint:

- Windows USB notification/enumeration: `HARDWARE-VALIDATED`, with remaining stress/closure debt.
- WPD COM manager + `RefreshDeviceList` + `GetDevices`: `HARDWARE-VALIDATED`.
- Real Samsung handset WPD discovery: `HARDWARE-VALIDATED`.
- WPD Tauri command: `PROTOCOL-EXPOSED` and compiled.
- WPD device open/content/storage: not yet implemented.
- Desktop customer workflow: foundation only.
- Host Protocol V1: real but too narrow.
- Kotlin evidence/report/licensing/sanitization engines: substantial, largely `MODELLED` / `UNIT-TESTED`.
- Sanitization: not production-qualified.
- Cloud/API/admin: substantial source exists; live production state is not certified by this baseline.
- Installer/release/Windows CI: incomplete.
- Remote `main`: governance hardening still required.

---

# 5. Master issue register

Severity:

- **P0 / CRITICAL** — can cause wrong-device action, false evidence/certificate, entitlement loss, destructive misuse, or evidence loss. Must be resolved before destructive/release work.
- **P1 / HIGH** — production security/integrity/integration blocker.
- **P2 / MEDIUM** — maintainability, operational safety, or release-quality issue.
- **P3 / LOW** — cleanup that should not block safe development.

---

## FSB-001 — Documentation authority is fragmented

**Severity:** P1
**Area:** Governance / documentation
**Problem:** Historical handoffs, resume notes, G-phase files, domain-cutover instructions, freeze guides, customer product specs, and later desktop/WPD corrections coexist as if all are equally current. Some contain obsolete hosts or old phase status.

**Risk:**

- engineers can follow superseded deployment instructions,
- old “DONE” wording can overstate maturity,
- domain/configuration drift can reintroduce retired topology,
- future sessions can restart completed work or undo accepted architecture.

**Root cause:** Long-running iterative development without a formal active/superseded document registry.

**Mitigation:**

1. Keep three primary navigation/governance documents:
   - Canonical Engineering Guideline,
   - this Final Forensic/System-Design Baseline,
   - Project Index & Documentation Register.
2. Keep narrow active component contracts only when they remain technically binding.
3. Move superseded operational/handoff documents to `docs/archive/`.
4. Update all active references before archival.
5. Never delete historical files merely to reduce visual clutter before link/dependency review.

**Acceptance:**

- every active doc has status + owner + purpose,
- project index lists every active component contract,
- no active README points to a superseded resume file as the “start here” document,
- archive contains no file described as current.

---

## FSB-002 — “Host” ownership is ambiguous

**Severity:** P1
**Area:** Architecture
**Problem:** `apps/host` is historically called the Windows Host, while the Tauri/Rust layer now performs actual Windows-native USB/WPD/process work.

**Risk:** Logic can be placed in the wrong layer; duplicated state and device truth can emerge.

**Mitigation:**

Adopt explicit responsibility names:

- **Native Layer** = Rust/Tauri.
- **Domain Engine** = Kotlin/JVM.
- **Desktop UI** = React.
- **Android Component** = APK/core.
- **Control Plane** = Worker/Neon/Resend.

Update documentation and new protocol names accordingly. Do not perform a mass code rename unless it produces clear value; documentation/contract naming is sufficient first.

**Acceptance:** new code reviews can identify the owning layer for every new responsibility without ambiguity.

---

## FSB-003 — Physical USB state is incorrectly inferred from ADB in Host Protocol V1

**Severity:** P0
**Area:** Device state
**Problem:** current Kotlin device state derives physical connection from the discovered ADB device list.

**Why wrong:** real Samsung acceptance proved valid `USB_PRESENT + MTP_READY + ADB_UNAVAILABLE`.

**Mitigation:**

1. Rust produces authoritative Windows-native device snapshot.
2. Kotlin consumes snapshot as an input.
3. ADB contributes only ADB state.
4. Deprecate ADB-derived `usbConnected`.
5. Introduce protocol-versioned state rather than silently changing V1 semantics.

**Acceptance:** with USB/MTP present and ADB absent, CYVRA reports device physically present and does not say “waiting for connection.”

---

## FSB-004 — No safe multi-device correlation model

**Severity:** P0
**Area:** Device identity / destructive safety
**Problem:** some Host flows select the first ADB device.

**Risk:** wrong-device report, licence debit, or sanitization.

**Mitigation:** introduce `SessionDeviceRef` and a correlation record containing:

```text
SessionDeviceRef
  processingSessionId
  windowsUsbObservations[]
  wpdDeviceIdentity?
  adbTransportIdentity?
  androidComponentIdentity?
  correlationEvidence[]
  correlationConfidence
  operatorSelection?
```

Rules:

- never select a destructive target implicitly,
- require explicit disambiguation when >1 candidate,
- freeze correlation before chargeable verification,
- revalidate same-device identity before sanitization.

**Acceptance:** two connected devices cannot cause implicit selection.

---

## FSB-005 — WPD `GetDevices` two-pass topology race needs hardening

**Severity:** P1
**Area:** Native Windows / WPD
**Problem:** connected device count can change between count and enumeration calls.

**Mitigation:** bounded retry on documented buffer/count inconsistency, stable error code after retry exhaustion, guaranteed memory release on every path.

**Acceptance:** deterministic tests for growth/shrink race plus real unplug/replug regression.

---

## FSB-006 — Raw PnP/WPD identifiers cross the desktop IPC boundary unnecessarily

**Severity:** P1
**Area:** Privacy / interface design
**Problem:** current WPD result exposes raw device identity to the frontend although UI does not need it.

**Mitigation:**

- keep raw identifiers in native correlation layer,
- expose opaque session-scoped identifier to React,
- redact device identifiers from normal logs/UI,
- allow privileged diagnostics export only when explicitly designed.

**Acceptance:** UI can perform all current tasks without receiving raw PnP identity.

---

## FSB-007 — WPD evidence plane is not yet implemented beyond discovery

**Severity:** P1
**Area:** Evidence
**Problem:** WPD device-manager discovery is proven, but no read-only `IPortableDevice::Open`, storage discovery, root/content metadata traversal, evidence model, or report fusion exists.

**Mitigation sequence:**

1. exact `windows = 0.61.3` binding audit,
2. `GENERIC_READ` open,
3. root/functional-object enumeration,
4. storage discovery,
5. bounded metadata-only recursion,
6. deterministic digest,
7. WPD evidence model,
8. unified evidence fusion.

**Privacy rule:** no customer content stream is opened by the default scanner.

---

## FSB-008 — Current evidence-source vocabulary is behind the real architecture

**Severity:** P1
**Area:** Evidence contract
**Problem:** existing cloud/evidence schema reflects S1/S2/S3 source names and current ingest accepts S1 application evidence only; desktop now needs Windows USB, WPD/MTP, ADB, Android component, operator, and system provenance.

**Mitigation:** create Evidence Contract V2. Do not mutate historical V1 semantics in place.

V2 sources:

```text
WINDOWS_USB
WINDOWS_WPD_MTP
ANDROID_ADB
ANDROID_COMPONENT
OPERATOR
SYSTEM
```

Maintain a compatibility mapping for historical records where appropriate.

**Acceptance:** old frozen V1 reports remain verifiable; new reports use V2 without pretending WPD is S1.

---

## FSB-009 — Evidence replay can hide payload conflicts

**Severity:** P0
**Area:** Evidence integrity
**Problem:** `onConflictDoNothing` provides idempotency but does not prove the replay payload is identical.

**Risk:** same evidence ID with a different payload can be silently ignored.

**Mitigation:**

- canonicalize every evidence record,
- compute/store digest,
- on replay compare digest,
- identical digest → `IDEMPOTENT_REPLAY`,
- different digest → `EVIDENCE_ID_CONFLICT`,
- log conflict event.

**Acceptance:** deliberate same-ID/different-payload test is rejected.

---

## FSB-010 — Account cascade deletion can destroy frozen evidence/report history

**Severity:** P0
**Area:** Database / retention
**Problem:** account/device/session relationships currently use cascades that can transitively remove evidence/reports.

**Risk:** a user-account lifecycle action can erase records that the product represents as frozen evidence.

**Mitigation:**

1. define legal/business retention policy,
2. separate account deactivation/anonymization from evidence retention,
3. prohibit silent cascade deletion of frozen reports,
4. add retention state and archival semantics,
5. add deletion workflow requiring explicit policy authorization and audit event.

**Acceptance:** deleting/deactivating a customer account cannot unintentionally delete a frozen report.

---

## FSB-011 — No canonical append-only audit ledger

**Severity:** P1
**Area:** Auditability
**Problem:** current rows show current state but do not form a complete immutable event history.

**Mitigation:** add `audit_events` or equivalent append-only ledger for:

- admin nominations/revocations,
- licence draft/issue/revoke,
- entitlement reserve/finalize/release,
- verification start/finalize,
- report freeze,
- sanitization plan/authorization/execution,
- final certificate,
- sensitive policy override,
- evidence replay conflict.

Event fields should include actor, action, object type/id, timestamp, request/session correlation, previous/new state when appropriate, and event digest.

**Acceptance:** every chargeable/destructive/final-report transition has a corresponding audit event.

---

## FSB-012 — Two Report 1 implementations are not yet canonicalized

**Severity:** P0
**Area:** Reporting / integrity
**Problem:** Kotlin `HostReportEngine` and cloud `/reports/freeze` represent different report-generation paths. Cloud manifest does not currently carry the same digest semantics.

**Mitigation:**

- define one canonical report manifest version,
- define canonical serialization,
- define digest algorithm and exact covered fields,
- local engine emits canonical manifest,
- cloud verifies/stores it rather than independently redefining observations,
- renderer/PDF consumes manifest,
- later final certificate references Report 1 digest.

**Acceptance:** the same evidence produces the same canonical report digest locally and after cloud re-verification.

---

## FSB-013 — Licence endpoint can create implicit preview entitlement

**Severity:** P1
**Area:** Commercial control
**Problem:** when no serial exists, current API can return an active preview trial entitlement.

**Risk:** preview behavior may accidentally become production commercial policy.

**Mitigation:**

- make trial entitlement an explicit policy record,
- gate by environment and account eligibility,
- never synthesize production entitlement merely because no licence row exists,
- audit trial grant.

**Acceptance:** production account without entitlement receives explicit `NO_ENTITLEMENT` unless policy has granted a trial.

---

## FSB-014 — Licence key format has only 16 bits of random uniqueness

**Severity:** P0 if used as a secret; P2 if display/reference only
**Area:** Licensing security
**Problem:** parseable key includes only four hex random digits.

**Decision:** treat it as a **public licence/reference number**, not a secret authenticator.

**Mitigation:**

- keep public display key if business wants it,
- activation uses high-entropy secret, signed entitlement, or authenticated account binding,
- never authorize a valuable operation solely from knowledge of the display key.

**Acceptance:** brute forcing a public serial cannot activate entitlement.

---

## FSB-015 — `devicesBound` conflates device binding and scan consumption

**Severity:** P0
**Area:** Entitlement accounting
**Problem:** cloud API derives scans used/remaining from `devicesBound`.

**Mitigation:** split domain concepts:

```text
licence
licence_revision
device_binding
verification_transaction
entitlement_reservation
entitlement_consumption
entitlement_release/refund
```

**Acceptance:** binding a device does not automatically consume a scan, and a consumed verification is independently auditable.

---

## FSB-016 — Durable verification transaction is missing

**Severity:** P0
**Area:** Licensing / crash consistency
**Problem:** Kotlin has useful transaction semantics but the production authority is not durably integrated with API/Neon.

**Required state machine:**

```text
CREATED
→ RESERVED
→ EVIDENCE_CAPTURED
→ REPORT_FROZEN
→ CONSUMED
```

Failure states:

```text
EXPIRED
RELEASED
FAILED
MANUAL_REVIEW
```

Rules:

- passive connection never reserves,
- explicit Device Verification starts transaction,
- replay/idempotency key required,
- crash recovery required,
- final debit only after successful canonical Report 1 freeze,
- policy must define irrecoverable point.

**Acceptance:** retry/crash/network-loss tests cannot double-charge or create an unreported consumed scan.

---

## FSB-017 — Browser bearer session is exposed to JavaScript

**Severity:** P1
**Area:** Authentication
**Problem:** API returns the bearer token and web stores it in `sessionStorage`.

**Mitigation:**

- production same-site web uses HttpOnly Secure cookie,
- browser bearer fallback only for controlled preview/development if needed,
- desktop authentication uses a separate explicitly designed token flow,
- CSP/XSS hardening remains required.

**Acceptance:** production web JavaScript cannot read the customer session secret.

---

## FSB-018 — CORS trust is too broad

**Severity:** P1
**Area:** Web/API security
**Problem:** current policy allows any HTTPS subdomain of `cyvoriq.co.in`, plus legacy origins.

**Mitigation:**

- exact origin allowlist by environment,
- production customer: `www.cyvoriq.co.in`,
- production admin: `admin.cyvoriq.co.in`,
- accounts only if/when active,
- preview origins separately enumerated,
- remove legacy Erase origins once migration acceptance is complete.

**Acceptance:** arbitrary future/forgotten subdomain is denied.

---

## FSB-019 — `/internal/prune` is publicly callable

**Severity:** P1
**Area:** API boundary
**Problem:** mutation endpoint described as internal has no dedicated authentication.

**Mitigation:** move to scheduled Worker/cron or service-authenticated maintenance path.

**Acceptance:** public anonymous request cannot invoke internal maintenance mutation.

---

## FSB-020 — OTP request creation lacks durable rate limiting

**Severity:** P1
**Area:** Authentication / abuse
**Problem:** per-challenge attempt count exists, but request creation requires source/identity throttling.

**Mitigation:**

- durable source/IP scope,
- durable identity/email scope,
- generic external response,
- Resend failure-aware behavior,
- abuse metrics,
- cleanup/expiry.

**Acceptance:** burst tests cannot create unlimited OTPs.

---

## FSB-021 — OTP verification consume operation is race-prone

**Severity:** P1
**Area:** Authentication concurrency
**Problem:** challenge is selected and later marked consumed, allowing concurrent correct requests to race.

**Mitigation:** atomic conditional consume (`consumed_at IS NULL`, not expired, attempts within limit) inside transaction; only returning row may create session.

**Acceptance:** two concurrent correct verifies produce exactly one successful consume/session transaction.

---

## FSB-022 — OTP hashes are offline brute-forceable after DB compromise

**Severity:** P1
**Area:** Authentication cryptography
**Problem:** six-digit OTP space is small; bare SHA-256 can be enumerated offline.

**Mitigation:** keyed HMAC/pepper derived from a server secret, bound to challenge ID + OTP; secret never stored in DB.

**Acceptance:** database contents alone are insufficient to validate candidate OTPs.

---

## FSB-023 — `SESSION_SECRET` configuration is not meaningfully bound into current auth crypto

**Severity:** P2
**Area:** Configuration drift
**Problem:** deployment/configuration references a session secret but current opaque session-token hashing path does not use it.

**Mitigation:** either:
- use it deliberately for keyed constructs with rotation strategy, or
- remove misleading unused configuration.

Do not add cryptography merely to “use” a variable; define purpose first.

---

## FSB-024 — Admin has two overlapping authentication mechanisms

**Severity:** P1
**Area:** Admin security
**Problem:** staff OTP sessions coexist with `ADMIN_API_TOKEN + X-Admin-Email` fallback; browser client still contains legacy admin-token handling.

**Mitigation:**

- staff OTP/session = normal operations,
- infrastructure token = break-glass/service-only,
- break-glass path must be disabled from normal browser bundle,
- separate audit events for break-glass use,
- explicit rotation/storage procedure.

**Acceptance:** admin UI does not require or store the infrastructure admin token.

---

## FSB-025 — Admin OTP request reveals operator membership

**Severity:** P2
**Area:** Identity privacy
**Problem:** external errors distinguish unknown/not-nominated staff identities.

**Mitigation:** generic response externally; detailed reason only in server audit log.

---

## FSB-026 — OTP/session PII retention is undefined

**Severity:** P1
**Area:** Privacy / operations
**Problem:** OTP challenge rows contain registration PII; consumed challenges and expired sessions may persist.

**Mitigation:**

- retention schedule,
- scheduled cleanup,
- minimize fields copied into challenge rows,
- retain only what is required to complete registration,
- audit cleanup without storing OTP content.

**Acceptance:** expired auth artifacts are removed according to documented policy.

---

## FSB-027 — Public/admin/accounts web surfaces share one application bundle

**Severity:** P2
**Area:** Web architecture
**Problem:** hostname selects UI within the same React build.

**Risk:** deployment coupling and unnecessary admin client code in public bundle.

**Mitigation:** initially acceptable while authorization remains server-side; before release strongly prefer:
- separate entrypoints/builds, or
- `apps/public-web`, `apps/admin-web`, `apps/accounts-web`,
with shared components in packages.

Do not block WPD work solely for this refactor.

---

## FSB-028 — Android exported receiver lacks a strong workstation-authentication contract

**Severity:** P1
**Area:** Android component security
**Problem:** exported receiver can be invoked externally and consumes caller-supplied session/device identifiers.

**Mitigation:**

- explicit component targeting,
- workstation-generated nonce/challenge,
- expiry,
- session binding,
- HMAC/signature or another verifiable authorization mechanism,
- replay rejection,
- evidence response bound to request.

Do not simply set `exported=false` without verifying the intended ADB invocation path.

---

## FSB-029 — Host Protocol V1 is too narrow for the actual product

**Severity:** P1
**Area:** Integration
**Problem:** real protocol exposes only basic host/preflight/device-state operations while large portions of Domain Engine are unreachable by the desktop product.

**Mitigation:** freeze Host Protocol V2 before implementing broad UI integration.

Candidate operations:

```text
GET_HOST_INFO
GET_PREFLIGHT
EVALUATE_DEVICE_SNAPSHOT
START_DEVICE_VERIFICATION
FINALIZE_DEVICE_VERIFICATION
REQUEST_SANITIZATION_PLAN
AUTHORIZE_SANITIZATION
VERIFY_POST_SANITIZATION
```

Exact schema must include request IDs, protocol version, session/device refs, typed error codes, cancellation semantics, and backward compatibility.

---

## FSB-030 — Desktop UI is not yet the real customer workflow

**Severity:** P1
**Area:** Product integration
**Problem:** current desktop surface is a shell/foundation; it does not execute the complete verification/licence/report/sanitization lifecycle.

**Mitigation:** integrate only after native state, evidence V2, correlation, and Protocol V2 contracts are frozen. React displays state and requests actions; it does not own device/business truth.

---

## FSB-031 — Sanitization methods are not hardware-qualified

**Severity:** P0
**Area:** Destructive operations
**Problem:** existing ADB shell commands are modeled but not proven as generally executable on supported stock devices.

**Mitigation:**

For every method define:

- capability prerequisite,
- authority prerequisite,
- supported OS/OEM/management state,
- exact execution mechanism,
- acknowledgement signal,
- reboot expectations,
- known failure modes,
- required post-reset evidence,
- assurance class.

Unsupported combinations must not be offered.

---

## FSB-032 — Post-sanitization verification is too weak for a strong certificate

**Severity:** P0
**Area:** Certification
**Problem:** absence of screen lock / inferred setup wizard is not sufficient proof of sanitization.

**Mitigation:** multi-signal method-specific verification; distinguish:

```text
RESET_OBSERVED
USER_DATA_INACCESSIBLE
SANITIZATION_METHOD_CONFIRMED
EXTERNAL_VERIFICATION_REQUIRED
UNVERIFIED
```

Final certificate language must match the exact assurance obtained.

---

## FSB-033 — Installer does not yet package the Kotlin Domain Engine/runtime for a customer machine

**Severity:** P1
**Area:** Release engineering
**Problem:** engineering flow can rely on Java/Gradle/repo layout; final user must not.

**Mitigation recommendation:** retain Kotlin Domain Engine and package:
- Host distribution,
- private supported Java runtime,
- controlled platform-tools where required,
- Tauri installer.

Do not perform a risky rewrite to Rust merely to simplify packaging.

---

## FSB-034 — Windows CI/release pipeline is incomplete

**Severity:** P1
**Area:** CI
**Mitigation:** mandatory Windows PR/release workflow covering Rust/Tauri, desktop TS, Kotlin Host/Core, Android where SDK available, evidence/report contracts, installer build, artifact hashes, and security checks.

---

## FSB-035 — `main` governance is below production standard

**Severity:** P1
**Area:** Git governance
**Problem:** audited remote `main` is not protected by required checks.

**Mitigation:** after CI is stable:
- protect `main`,
- require PR,
- require agreed status checks,
- disable direct pushes except explicitly authorized break-glass,
- require review for security/destructive changes.

---

## FSB-036 — Repository visibility is public despite proprietary implementation detail

**Severity:** P2 / business decision
**Area:** Governance
**Mitigation:** explicit owner decision. Security must never rely on privacy, but private visibility is recommended if implementation is proprietary.

---

## FSB-037 — Historical domain/configuration instructions remain mixed

**Severity:** P1
**Area:** Operations
**Problem:** documents still reference earlier `mobile.cyvra.co.in`, `api-mobile.cyvra.co.in`, preview Worker paths, old G7/G8 ordering, or older Pages topology.

**Mitigation:** active project index identifies current targets; old migration/runbook files move to archive with a large `SUPERSEDED` banner or directory-level archive notice.

---

## FSB-038 — Root `README.md` and desktop README are not authoritative current product docs

**Severity:** P2
**Area:** Developer onboarding
**Mitigation:** rewrite after Phase 1 documentation consolidation; README should point to Project Index first and summarize only current architecture.

---

## FSB-039 — Formatter/tooling can contaminate narrow patches

**Severity:** P1
**Area:** Engineering process
**Evidence:** September 19 crate-root rustfmt incident.

**Mitigation:**

- no casual root-module formatting in narrow gates,
- use leaf formatting,
- `git diff --check`,
- exact diff review,
- strict PowerShell variables,
- no-pager scripted diffs,
- byte/hash reconstruction when provenance is uncertain.

---

## FSB-040 — Live cloud state is not part of the current certified baseline

**Severity:** P2
**Area:** Operations/acceptance
**Problem:** repository source exists, but live Cloudflare/Neon/Resend configuration was not re-certified by the final system audit.

**Mitigation:** run dedicated production-like control-plane acceptance during Phase 4/5.

---

# 6. Master mitigation architecture

The issue register is not a list of independent patches. Several fixes depend on others.

The required dependency order is:

```text
DOCUMENT / CONTRACT AUTHORITY
        ↓
DEVICE STATE + CORRELATION
        ↓
WPD READ-ONLY EVIDENCE
        ↓
EVIDENCE V2 + IMMUTABILITY
        ↓
PROTOCOL V2
        ↓
ENTITLEMENT TRANSACTION
        ↓
CANONICAL REPORT
        ↓
DESKTOP WORKFLOW
        ↓
ANDROID COMPONENT HARDENING
        ↓
SANITIZATION QUALIFICATION
        ↓
PACKAGING / CI / SIGNING
```

Authentication/database corrections can proceed in parallel only when they do not touch the same contracts being frozen.

---

# 7. PHASE 1 — CONSOLIDATE

**Purpose:** create one trustworthy map of the system before further broad coding.

## Phase 1.1 — Documentation freeze

Create/retain:

1. `docs/CYVRA_MOBILE_CANONICAL_ENGINEERING_GUIDELINE_2026-09-19.md`
2. `docs/CYVRA_MOBILE_FINAL_FORENSIC_SYSTEM_DESIGN_BASELINE_2026-09-19.md`
3. `docs/CYVRA_MOBILE_PROJECT_INDEX.md`

Keep root `GUIDELINE.md` active until compliance content is deliberately merged.

## Phase 1.2 — Documentation classification

Classify each existing doc:

- `ACTIVE-GOVERNING`
- `ACTIVE-CONTRACT`
- `ACTIVE-RUNBOOK`
- `HISTORICAL-SUPERSEDED`
- `REPLACE`
- `DELETE-CANDIDATE`

Do not delete in this phase.

## Phase 1.3 — Architecture ownership freeze

Freeze the responsibility table:

| Layer | Owns |
|---|---|
| React desktop | presentation, operator interaction |
| Rust/Tauri | Windows-native device truth, USB, WPD, process/lifecycle |
| Kotlin Domain Engine | business semantics, Android semantics, workflow, report/sanitization policy |
| Android Component | legitimate device-side evidence |
| Worker/Neon | identity, entitlement authority, registry, audit, sync |
| Resend | transactional communication only |

## Phase 1.4 — Contract inventory

Inventory and version:

- USB native model,
- WPD model,
- Evidence V1,
- planned Evidence V2,
- Host Protocol V1,
- planned Host Protocol V2,
- Report Manifest V1,
- planned canonical Report Manifest V2,
- entitlement transaction contract,
- sanitization assurance contract.

## Phase 1 exit gate

PASS only when:

- project index is committed,
- no engineer needs a historical resume file to know where to start,
- each active contract has owner/version/status,
- old documents are classified,
- current six D2.3 files remain understood and uncontaminated.

---

# 8. PHASE 2 — CORRECT

**Purpose:** remove architectural/security/data-integrity defects before broad integration.

## Phase 2.1 — D2.3 WPD pre-checkpoint hardening

Resolve:

- FSB-005 topology race,
- FSB-006 raw identifier exposure,
- deterministic WPD error codes,
- full Rust regression,
- real Samsung regression.

Then create D2.3 checkpoint commit.

## Phase 2.2 — Correct device state semantics

Resolve FSB-003.

Output:

```text
WindowsNativeDeviceSnapshot
  sessionDeviceRef
  usb
  wpd
  adbTransportObservation?
  timestamps
  limitations
```

No ADB-derived physical USB boolean.

## Phase 2.3 — Correct device correlation

Resolve FSB-004.

Add explicit same-device correlation and multi-device ambiguity handling before any chargeable/destructive flow.

## Phase 2.4 — Evidence integrity correction

Resolve FSB-008/009:

- Evidence V2,
- canonical evidence serialization,
- digests,
- replay conflict semantics.

## Phase 2.5 — Database retention and audit

Resolve FSB-010/011/026:

- retention policy,
- remove unsafe evidence/report cascades,
- append-only audit events,
- auth-artifact cleanup policy.

Migration must be rehearsed on a non-production Neon branch first.

## Phase 2.6 — Licensing/security model correction

Resolve FSB-013/014/015/016:

- public licence number vs activation credential,
- explicit trial policy,
- device binding separate from scan consumption,
- durable verification transaction state machine.

## Phase 2.7 — Auth/API hardening

Resolve FSB-017 through FSB-025:

- production HttpOnly cookie,
- exact CORS,
- secure internal maintenance,
- source/identity OTP rate limits,
- atomic OTP consume,
- keyed OTP verification,
- clarify/remove unused secret,
- staff-session admin path,
- break-glass token isolation,
- identity-enumeration protection.

## Phase 2.8 — Android receiver security contract

Resolve FSB-028 at design/contract level before product integration.

## Phase 2.9 — Report canonicalization contract

Resolve FSB-012 at contract level.

Do not yet rebuild every renderer. Freeze canonical manifest/digest first.

## Phase 2.10 — Sanitization assurance contract

Resolve FSB-031/032 at specification level.

No destructive execution yet.

## Phase 2 exit gate

PASS only when:

- physical state no longer depends on ADB,
- multi-device target ambiguity cannot silently proceed,
- WPD manager path is hardened,
- evidence replay conflicts are detectable,
- evidence/report retention cannot be accidentally cascaded away,
- production entitlement model is transactional,
- browser/admin auth design is hardened,
- Report 1 canonical contract is frozen,
- sanitization claims have explicit assurance vocabulary.

---

# 9. PHASE 3 — INTEGRATE

**Purpose:** connect the corrected components into the real customer workflow.

## Phase 3.1 — WPD read-only API audit

Inspect exact local `windows 0.61.3` generated signatures before coding.

## Phase 3.2 — WPD read-only device open

Use explicit `GENERIC_READ`.

No customer content stream.

## Phase 3.3 — WPD root/storage discovery

Enumerate functional/storage objects only.

## Phase 3.4 — Metadata-only shared-storage scanner

Requirements:

- bounded recursion,
- object/depth/time bounds,
- cancellation,
- deterministic ordering,
- per-object errors,
- no file-body reads,
- no previews,
- no copies/uploads,
- deterministic inventory digest.

## Phase 3.5 — Unified Evidence V2 implementation

Fuse:

```text
WINDOWS_USB
WINDOWS_WPD_MTP
ANDROID_ADB?
ANDROID_COMPONENT?
OPERATOR?
SYSTEM
```

without losing source provenance.

## Phase 3.6 — Protocol V2 implementation

Rust/native snapshot → Kotlin Domain Engine.

Do not make React the business orchestrator.

## Phase 3.7 — Verification transaction integration

End-to-end:

```text
operator clicks Device Verification
→ cloud/local entitlement authority validates
→ transaction RESERVED
→ device identity frozen
→ evidence snapshot
→ optional ADB/APK enrichment
→ capability evaluation
→ canonical Report 1
→ report persisted/verified
→ transaction CONSUMED
```

## Phase 3.8 — Desktop UI integration

Display independent states:

```text
USB_ABSENT / USB_PRESENT
MTP_UNAVAILABLE / MTP_READY / MTP_SCANNING / MTP_EVIDENCE_READY
ADB_UNAVAILABLE / ADB_UNAUTHORIZED / ADB_OFFLINE / ADB_READY
```

The UI must explain limitations rather than invent failure.

## Phase 3.9 — Android component integration

Implement authenticated request binding and evidence response correlation.

## Phase 3.10 — Cloud evidence/report synchronization

Cloud verifies canonical digests and stores registry records.

It does not regenerate different observations from the workstation.

## Phase 3 exit gate

PASS only when a non-destructive Device Verification can run from the real desktop UI to real Report 1 with:

- MTP-only handset,
- optional ADB enrichment,
- durable entitlement transaction,
- canonical evidence/report digest,
- cloud sync,
- no customer file-body reads.

---

# 10. PHASE 4 — HARDWARE-PROVE

**Purpose:** prove the integrated product on real devices and real failure modes.

## Phase 4.1 — Windows USB stress closure

- rapid reconnect,
- staged child-interface arrival,
- shutdown during event,
- repeated reconnect cycles,
- multi-device connection.

## Phase 4.2 — WPD hardware matrix

At minimum:

- current Samsung A10s MTP case,
- another Samsung family/model,
- at least one non-Samsung Android device before general multi-OEM claim,
- locked/unlocked states where appropriate,
- MTP disabled,
- MTP enabled,
- cable failure,
- disconnect during enumeration.

## Phase 4.3 — ADB state matrix

Real hardware:

- no ADB USB function,
- ADB unauthorized,
- ADB authorized,
- ADB offline,
- device disconnect during command.

No test should fake a platform state and call it hardware acceptance.

## Phase 4.4 — Android component matrix

- supported Android versions,
- receiver challenge/replay tests,
- denied permissions,
- feature absent,
- scoped-storage limitations.

## Phase 4.5 — Entitlement failure matrix

- offline before reservation,
- network loss after reservation,
- crash before evidence,
- crash after evidence,
- report failure,
- retry,
- duplicate request,
- revoke during session,
- expired reservation.

No double debit.

## Phase 4.6 — Report integrity matrix

- local digest,
- cloud verification,
- re-download,
- manifest re-open,
- tamper test,
- V1 historical compatibility if retained.

## Phase 4.7 — Sanitization qualification

Use only owned/approved test devices and disposable test data.

Per method:

1. prerequisite proof,
2. explicit authorization,
3. execution proof,
4. reboot/reconnect,
5. multi-signal post-reset verification,
6. assurance classification,
7. final certificate wording review.

Unproven method = `UNSUPPORTED`.

## Phase 4.8 — Control-plane acceptance

Test non-production environment:

- auth,
- OTP,
- admin,
- entitlement,
- evidence sync,
- reports,
- audit,
- Resend,
- CORS,
- rate limits,
- Neon migration state.

## Phase 4 exit gate

PASS only when the integrated product has real hardware evidence for every capability it intends to advertise at release.

---

# 11. PHASE 5 — RELEASE-PROVE

**Purpose:** turn the hardware-proven engineering build into a defensible customer release.

## Phase 5.1 — Customer packaging

Bundle:

- Tauri desktop application,
- Kotlin Domain Engine distribution,
- private Java runtime if retained,
- controlled ADB/platform-tools where legitimately required,
- configuration defaults.

No Android Studio, Gradle, source tree, or developer JDK requirement on customer machine.

## Phase 5.2 — Windows CI

Required checks:

```text
Rust/Tauri
  cargo check --locked
  cargo test --locked
  release build

Desktop
  frozen package install
  TypeScript build
  lint / validation

Kotlin
  :core:test
  :host:test
  packaging smoke

Android
  unit tests
  assembly/security checks where SDK runner exists

Contracts
  evidence schemas
  report schemas
  compatibility tests

Security
  dependency audit
  secret scan
```

## Phase 5.3 — Git governance

- protect `main`,
- required PR,
- required checks,
- review policy,
- release-tag policy,
- break-glass procedure.

## Phase 5.4 — Signed installer/release candidate

- choose MSI/NSIS release format,
- code-sign,
- SHA-256 checksums,
- immutable release artifact,
- signed update design if updater enabled.

## Phase 5.5 — Clean-machine acceptance

Windows 10 and Windows 11 machines with no development environment:

- install,
- first launch,
- Host starts,
- USB,
- WPD,
- ADB optional path,
- Device Verification,
- entitlement,
- Report 1,
- cloud sync,
- controlled sanitization where approved,
- final certificate,
- update,
- uninstall.

## Phase 5.6 — Security/release review

Review:

- auth secrets,
- logs/redaction,
- public repository decision,
- signing-key storage,
- updater trust,
- installer privileges,
- PII retention,
- evidence retention,
- legal/customer copy,
- sanitization claims.

## Phase 5.7 — Production release

Only when every mandatory release criterion is evidenced.

---

# 12. Phase-to-existing-Gate mapping

The detailed G0–G22 sequence in the Canonical Engineering Guideline remains useful as micro-gates. This baseline groups and augments it:

| Macro phase | Canonical gates / additions |
|---|---|
| Phase 1 Consolidate | G0 plus documentation/index/contract inventory |
| Phase 2 Correct | G1–G2 plus new security, retention, entitlement, report-contract remediation |
| Phase 3 Integrate | G3–G13, with Evidence V2 and Protocol V2 |
| Phase 4 Hardware-Prove | G14–G16 plus expanded device/failure matrix and controlled G21 preparation |
| Phase 5 Release-Prove | G17–G22, CI/governance/signing/clean-machine release |

If a newly discovered P0 issue conflicts with a later gate, the P0 issue is resolved first.

---

# 13. Documentation retirement plan

## 13.1 Do not delete all old documents now

A mass deletion is **not approved**.

Reasons:

- historical files contain decision evidence,
- some are referenced by code/README/other docs,
- some contain component-specific requirements not yet fully absorbed,
- the Canonical Engineering Guideline explicitly preserves historical documentation,
- deleting now would make later forensic review harder.

## 13.2 Preferred approach: archive first

Create:

```text
docs/archive/
  README.md
  2026-09-pre-final-baseline/
```

Use `git mv`, not copy/delete, so repository history remains clear.

Historical files may be archived after:

1. content classification,
2. unique requirements extracted,
3. active references updated,
4. no code/tests rely on paths,
5. owner review.

## 13.3 Active documentation set after consolidation

Primary governance/navigation:

1. `GUIDELINE.md` — compliance charter until merged.
2. `docs/CYVRA_MOBILE_CANONICAL_ENGINEERING_GUIDELINE_2026-09-19.md`
3. `docs/CYVRA_MOBILE_FINAL_FORENSIC_SYSTEM_DESIGN_BASELINE_2026-09-19.md`
4. `docs/CYVRA_MOBILE_PROJECT_INDEX.md`

Active component contracts may remain, for example:

- D2.3 WPD/MTP evidence contract,
- accepted Android compatibility freeze until its technical pins are absorbed,
- evidence schema documentation,
- sanitization assurance contract once rewritten,
- test matrix,
- tooling/version contract.

Everything else should be either rewritten, archived, or explicitly marked historical.

## 13.4 Can we eventually have only three primary documents?

Yes — **three primary documents** are desirable:

- Canonical Engineering Guideline,
- Final Forensic/System-Design Baseline,
- Project Index.

But component contracts and generated API/schema docs may still exist beneath them.

If the root compliance `GUIDELINE.md` is to be removed, its unique safety/compliance provisions must first be merged into the Canonical Engineering Guideline and all references updated. Until then it stays.

---

# 14. Non-contradiction verification against the Canonical Engineering Guideline

This baseline intentionally agrees with the canonical document on:

| Topic | Alignment |
|---|---|
| Product objective | Windows-hosted Android verification/report/sanitization |
| Lifecycle | Verification → Report 1 → separate sanitization auth → post-verify → final certificate |
| USB/ADB | independent states |
| WPD/MTP | first-class basic Windows evidence |
| WPD privacy | metadata-first, no default content read/copy |
| Rust role | Windows-native truth |
| Kotlin role | domain/business/Android semantics |
| React role | presentation |
| Android APK | supporting component |
| Cloud | control plane, not physical-device truth |
| Licensing | preflight does not consume entitlement |
| Sanitization | no unqualified claims |
| Maturity vocabulary | MODELLED through RELEASE-VALIDATED |
| Engineering process | audit → small change → test → hardware → diff → checkpoint |
| D2.3 next step | harden, checkpoint, then explicit read-only WPD open |
| Release | signed, CI-backed, clean-machine validated |

### 14.1 Additions, not contradictions

This deeper baseline adds:

- evidence-retention/cascade risk,
- evidence replay digest conflict handling,
- append-only audit ledger,
- licence-number entropy distinction,
- entitlement transaction data model,
- browser bearer-token hardening,
- exact CORS policy,
- OTP request throttling,
- atomic OTP consume,
- keyed OTP validation,
- admin auth separation,
- OTP/session PII retention,
- public/admin bundle separation recommendation,
- report-engine canonicalization,
- stronger device correlation,
- explicit local-vs-cloud source-of-truth wording.

These are refinements discovered by deeper implementation audit and do not change the product objective.

---

# 15. Program management board

Use this table as the master status board.

| Phase | Status at baseline | Entry condition | Exit condition |
|---|---|---|---|
| Phase 1 — Consolidate | READY | forensic baseline accepted | docs/contracts/index authoritative |
| Phase 2 — Correct | BLOCKED on Phase 1 | Phase 1 PASS | P0/P1 foundational defects corrected |
| Phase 3 — Integrate | BLOCKED | Phase 2 PASS | real end-to-end non-destructive verification works |
| Phase 4 — Hardware-Prove | BLOCKED | Phase 3 PASS | advertised features proven on real matrix |
| Phase 5 — Release-Prove | BLOCKED | Phase 4 PASS | signed clean-machine release passes |

Do not advance a phase because of schedule pressure. Advance on evidence.

---

# 16. Immediate action after this baseline is accepted

1. Add the three primary documents to the active local D2.3 worktree.
2. Verify exact Git status and hashes.
3. Do **not** delete/archive old documentation in the same commit.
4. Commit documentation baseline separately or as an explicitly reviewed documentation checkpoint.
5. Start Phase 1 document classification.
6. Then execute Phase 2 D2.3 hardening first:
   - WPD bounded retry,
   - raw identifier IPC decision,
   - deterministic errors/tests.
7. Checkpoint D2.3.
8. Continue to exact read-only WPD API audit.

---

# 17. Final program decision

The project will proceed by:

> **CONSOLIDATE → CORRECT → INTEGRATE → HARDWARE-PROVE → RELEASE-PROVE**

The program will not restart the architecture, will not hide unavailable evidence, will not make ADB the physical-device truth, will not expose destructive functionality merely because code exists, and will not call a feature production-ready until its required maturity evidence exists.

The objective is not maximum code volume.

The objective is a Windows product whose device identity, evidence, report, entitlement, sanitization, and release claims are internally consistent and externally defensible.
