# CYVRA Mobile — P1.4 Architecture & Requirement Extraction Inventory

**Date:** 2026-09-19
**Phase:** Phase 1 — CONSOLIDATE
**Gate:** P1.4 — Architecture & Requirement Extraction Inventory
**Status:** COMPLETE REQUIREMENT EXTRACTION BASELINE — NO ARCHIVAL OR DELETION AUTHORIZED BY THIS FILE
**Repository baseline studied:** `mukpswar-prog/CYVRA-Mobile` `main` @ `81309e28e32fa638fd7fcaa1bd0ab0a007888748`
**Local governing baseline:** Canonical Engineering Guideline + Final Forensic/System-Design Baseline + Project Index + P1.3 classification freeze
**Execution objective:** preserve every useful requirement while retiring stale execution authority.

---

## 0. Purpose

P1.4 answers one question:

> **If the older freeze guides, plans, manuals, and architecture documents are later archived, what requirements must survive?**

This inventory extracts those requirements, reconciles them against the current architecture, and assigns one of the approved classifications:

- `KEEP`
- `KEEP + MODIFY`
- `SUPERSEDED`
- `CONFLICT`
- `MISSING FROM NEW BASELINE`
- `DUPLICATE`
- `DEFERRED`

This document is an extraction/audit artifact. It is not a fourth permanent product-governance authority. P1.5 should absorb its accepted decisions into the active component contracts and `CYVRA_MOBILE_PROJECT_INDEX.md`.

---

## 1. Executive conclusion

The older documentation contains **substantial reusable product intent**. It should not be mass-deleted.

The majority of surviving requirements are compatible with the current final architecture, but several old assumptions must be corrected:

1. **ADB-first transport** is superseded by independent `WINDOWS_USB` + `WINDOWS_WPD_MTP` + optional `ANDROID_ADB`.
2. **One device at a time** remains a processing rule, but the workstation must safely detect/disambiguate multiple attached devices.
3. **Typed hardware serial as the purge barrier** is not universally reliable because legitimate serial access can be restricted; the safety requirement survives but the confirmation mechanism becomes same-device/session-bound.
4. **Scan consumption at a vague “certificate” event** is replaced by a durable verification transaction: explicit start/reservation → evidence → canonical Report 1 freeze → final consumption.
5. **Factory reset / ADB wipe commands** are not equivalent to NIST purge or verified cryptographic erase.
6. **Cloud/Neon as evidence system of record** is refined: cloud owns registry/control-plane truth; workstation owns observed-device evidence and canonical local digest.
7. **Workstation-held private report-signing keys** are rejected; canonical digest is mandatory, digital signing is a separate controlled key-management feature.
8. **Windows Server, exact ADB versions, exact prices/plans, exact offline grace duration, and old fixed release versions** are not current release commitments.
9. **AI physical inspection / deterministic grading / human review** contains real unique product requirements that are not sufficiently represented in the new primary baseline; they must be preserved as a deferred product module rather than lost.

No destructive feature becomes production-ready because an old manual says it exists.

---

## 2. Source legend

| Code | Source |
|---|---|
| ROOT | `GUIDELINE.md` |
| AF | `docs/ANDROID_COMPATIBILITY_FREEZE.md` |
| AFG | `docs/CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md` |
| TR | `docs/WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md` |
| EVD | `docs/DEVICE_EVIDENCE_ARCHITECTURE.md` |
| OEM | `docs/OEM_ADAPTER_ARCHITECTURE.md` |
| CW | `docs/CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md` |
| CD | `docs/CUSTOMER_DESKTOP_PRODUCT_SPEC.md` |
| DUX | `docs/CUSTOMER_DIAGNOSTIC_UX.md` |
| CTM | `docs/CUSTOMER_TEST_MATRIX.md` |
| UPG | `docs/CUSTOMER_UPDATE_UPGRADE_ARCHITECTURE.md` |
| AI | `docs/CYVRA_Mobile_Advanced_Customer_Application_AI_Grading_Licensing_Master_Workflow.md` |
| LIC | `docs/CUSTOMER_LICENSE_ARCHITECTURE.md` |
| RPT | `docs/CUSTOMER_REPORT_ARCHITECTURE.md` |
| GEN | `docs/CYVRA_MOBILE_GENERAL_APPLICATION_GUIDELINES.txt` |
| SAN | `docs/SANITIZATION_ARCHITECTURE.md` |
| PUX | `docs/CUSTOMER_PURGE_UX.md` |
| TM | `docs/TEST_MATRIX.md` |
| ADMIN | `docs/CYVRA_MOBILE_ADMINISTRATOR_MANUAL.txt` |
| USER | `docs/CYVRA_MOBILE_CUSTOMER_USER_MANUAL.txt` |
| INST | `docs/CYVRA_MOBILE_DOWNLOAD_AND_INSTALLATION_GUIDE.txt` |


## 3. Extraction summary

**Total normalized requirements:** 146

| Classification | Count |
|---|---:|
| `DEFERRED` | 4 |
| `KEEP` | 109 |
| `KEEP + MODIFY` | 26 |
| `MISSING FROM NEW BASELINE` | 3 |
| `SUPERSEDED` | 4 |

Interpretation:

- `KEEP` means the old requirement remains valid substantially as written.
- `KEEP + MODIFY` means its intent survives but the architecture/implementation wording changes.
- `MISSING FROM NEW BASELINE` means useful product intent would be lost if the old source were archived without recording it elsewhere.
- `SUPERSEDED` means the old statement must not remain active.
- `DEFERRED` means preserve it as future scope, not a current release promise.

## 4. Governance

| ID | Extracted requirement | Source | Classification | Final canonical decision | Current maturity/evidence | Target | Acceptance evidence |
|---|---|---|---|---|---|---|---|
| `REQ-GOV-001` | CYVRA Mobile remains a separate product/repository/control plane from CYVRA Erase. | ROOT | **KEEP** | Keep repository, Worker/API, database and admin/account boundaries separate from Erase. | IMPLEMENTED architecture; governance not release-validated | Canonical guide / Project Index | No CYVRA-Mobile code or mobile auth/evidence tables are added to Erase resources. |
| `REQ-GOV-002` | Only legitimate, authorized devices may be processed; no lock/PIN/password/FRP bypass, rooting/exploits, firmware flashing for access, or unauthorized private-content extraction. | ROOT, AFG, CD | **KEEP** | Permanent safety/compliance prohibition. | GOVERNING | Canonical guide | Automated policy/security tests and UI copy contain no bypass workflow. |
| `REQ-GOV-003` | USB connection, pairing, LAN membership, MTP visibility, or ADB visibility never equals device authorization. | ROOT, TR, SAN | **KEEP** | Preserve as a permanent invariant. | PARTIALLY IMPLEMENTED | Native/device state contracts | State model represents physical presence separately from authorization. |
| `REQ-GOV-004` | Unavailable / restricted / not-supported / permission-denied evidence must never be converted into FAIL or fabricated success. | ROOT, EVD, AFG | **KEEP** | Preserve honesty semantics across all evidence sources. | UNIT-TESTED in existing evidence core; broader integration pending | Evidence V2 / reports | Report faithfully carries status, source and reason without synthetic values. |
| `REQ-GOV-005` | Historical phase wording cannot prove product completion. | Old plans/manuals | **KEEP + MODIFY** | Use maturity levels MODELLED → RELEASE-VALIDATED; old DONE claims become historical only. | FROZEN by current governance | All active docs | No active document uses unqualified DONE for a feature. |
| `REQ-GOV-006` | Feature branches/PRs and logically reviewable changes are preferred; secrets/IDE artifacts/private keys must not be committed. | AFG, GEN | **KEEP** | Retain; later enforce through CI and branch protection. | PARTIAL | GitHub governance / CI | Protected main, required checks, secret scanning, reviewed PRs. |
| `REQ-GOV-007` | Repository visibility should be an explicit owner decision; security must not depend on repository secrecy. | ROOT, FSB | **KEEP + MODIFY** | Prefer private if proprietary, but design as if source can be inspected. | OPEN owner decision | Governance | Visibility decision recorded; secrets absent regardless of visibility. |
| `REQ-GOV-008` | Tablet is not a separate product; capability discovery, not form-factor label, determines supported tests. | ROOT | **KEEP** | Treat phone/tablet through a common capability model. | MODELLED | Capability engine | Tablet lacking telephony does not become device failure. |
| `REQ-GOV-009` | Do not claim universal Android/OEM compatibility. | CD, GEN, AFG | **KEEP** | Release copy must be capability-aware and limited to hardware-proven coverage. | GOVERNING | README / marketing / UI | No 'works on all Android devices' claim; release matrix names tested scope. |
| `REQ-GOV-010` | The permanent program sequence is verification/evidence first, destructive work only after separate authorization and qualification. | ROOT, SAN, PUX | **KEEP** | Keep Device Verification → Report 1 → separate sanitization authorization → post-verify → final certificate. | MODELLED; sanitization not qualified | Canonical lifecycle | Destructive command cannot be reached from passive discovery/Report 1 alone. |

## 5. Architecture

| ID | Extracted requirement | Source | Classification | Final canonical decision | Current maturity/evidence | Target | Acceptance evidence |
|---|---|---|---|---|---|---|---|
| `REQ-ARC-001` | Windows desktop application is the customer product; production operators must not need Android Studio, Gradle, SDK manager, command-line expertise, or a developer JDK. | CW, CD, INST | **KEEP** | Package all required runtime dependencies into the supported Windows release. | NOT RELEASE-VALIDATED | Desktop packaging | Clean Win10/11 machine installs/runs without development tools. |
| `REQ-ARC-002` | React is presentation; Windows-native truth belongs in Rust/Tauri; business/Android semantics belong in Kotlin Domain Engine. | GEN, current audit | **KEEP + MODIFY** | Replace historical 'apps/host is the Windows authority' wording with explicit Desktop UI / Native Layer / Domain Engine ownership. | PARTIALLY IMPLEMENTED | Architecture docs / Protocol V2 | New features have an unambiguous owner and no duplicate device truth. |
| `REQ-ARC-003` | Android APK is a supporting component, not the Windows orchestrator. | ROOT, AF, CD | **KEEP** | Retain optional/supporting device-side role. | IMPLEMENTED foundation | Android docs / bridge | Desktop flow can work without APK where platform evidence is sufficient. |
| `REQ-ARC-004` | CYVRA Station / Knox / enterprise privileged paths are not part of the current customer desktop scope unless separately approved. | ROOT, AFG | **KEEP** | Keep parked/deferred. | DEFERRED | Project Index deferred scope | No `apps/station` or Knox implementation appears without explicit architecture approval. |
| `REQ-ARC-005` | Cloud is a control plane; physical-device observation must remain local and work without cloud connectivity. | ROOT, GEN, FSB | **KEEP + MODIFY** | Neon/Worker own account, entitlement, registry and audit; workstation owns observational evidence/digest. | PARTIAL | Evidence sync architecture | Local USB/WPD/ADB evidence capture remains available during network loss where policy allows. |
| `REQ-ARC-006` | A web browser is not the physical device workstation. | INST, rectification history | **KEEP** | Keep browser for account/licence/admin/report registry; native desktop owns local USB/WPD/ADB. | IMPLEMENTED direction | README / web boundary | No browser UI claims local USB/ADB sanitization capability. |
| `REQ-ARC-007` | Do not rewrite the Kotlin Domain Engine merely to simplify packaging. | Current forensic baseline | **KEEP** | Package the Kotlin distribution/private runtime first; reconsider rewrite only with measured justification. | DECISION FROZEN | Release architecture | Installer starts Domain Engine without developer tooling. |
| `REQ-ARC-008` | Current product supports Windows 10/11 64-bit first. | CW, CD, TR, TM | **KEEP** | Win10/11 are immediate release targets. | TARGET; not clean-machine release-validated | Test/release matrix | Signed build passes clean Win10 and Win11 acceptance. |
| `REQ-ARC-009` | Windows Server support described in old installation material is not a current release promise. | INST | **SUPERSEDED** | Defer Windows Server 2019/2022 to a later explicitly qualified version. | DEFERRED | Project Index deferred scope | Current release docs do not list Windows Server as supported. |

## 6. Device & Transport

| ID | Extracted requirement | Source | Classification | Final canonical decision | Current maturity/evidence | Target | Acceptance evidence |
|---|---|---|---|---|---|---|---|
| `REQ-DEV-001` | USB and ADB are independent state planes. | TR, AFG, CTM | **KEEP** | Physical USB truth comes from Windows native observation; ADB contributes only Android transport state. | USB HARDWARE-VALIDATED; Kotlin still has ADB-derived debt | Native snapshot / Protocol V2 | USB+MTP present with ADB absent is reported correctly. |
| `REQ-DEV-002` | WPD/MTP is a first-class Windows evidence path even when ADB is unavailable. | Current D2.3 correction | **KEEP** | Preserve approved architecture correction. | WPD discovery HARDWARE-VALIDATED | WPD evidence contract / Evidence V2 | Real handset produces basic metadata evidence with debugging off. |
| `REQ-DEV-003` | ADB is optional advanced Android evidence; unauthorized/offline/unavailable are distinct states. | TR, AFG, DUX | **KEEP + MODIFY** | Replace old 'ADB primary transport' language with optional enrichment semantics. | UNIT-TESTED; real unauthorized matrix incomplete | Protocol V2 / UI | UI differentiates unavailable, unauthorized, offline and ready. |
| `REQ-DEV-004` | Use a controlled/versioned Android Platform-Tools distribution; PATH adb is diagnostic fallback only. | TR, GEN, CW, INST | **KEEP** | Keep principle; exact binary version is release-configurable and must be tested. | MODELLED/UNIT-TESTED locator | Packaging | Release bundle has known ADB version/hash and does not require PATH adb. |
| `REQ-DEV-005` | Exact historical ADB version `35.0.2` is not a permanent architectural requirement. | INST | **SUPERSEDED** | Select/pin a tested supported version during release qualification. | NOT FROZEN | Release tooling | Version is declared in release manifest and integration-tested. |
| `REQ-DEV-006` | One customer processing session may target one explicitly selected device at a time, but multiple physically attached devices must be detected and disambiguated safely. | CW, GEN, current forensic baseline | **KEEP + MODIFY** | Replace implicit first-device behavior with `SessionDeviceRef` correlation and ambiguity gate. | MISSING in production integration | Device correlation | Two connected devices cannot cause automatic chargeable/destructive selection. |
| `REQ-DEV-007` | Wrong-device prevention must bind processing session, Windows identity, WPD identity, ADB identity when available, and operator selection. | ROOT app↔station rule, current forensic baseline | **KEEP + MODIFY** | Implement session-scoped correlation object and revalidate before destructive action. | NOT IMPLEMENTED end-to-end | Correlation model / Protocol V2 | Same-device proof is recorded before verification and sanitization. |
| `REQ-DEV-008` | Do not auto-merge a reconnect if device identity is uncertain. | ROOT | **KEEP** | Require correlation confidence or operator confirmation. | MODELLED only | Reconnect logic | Ambiguous reconnect becomes review/blocked state. |
| `REQ-DEV-009` | WPD `GetDevices` must handle topology changes between count and enumeration calls. | Current D2.3 forensic audit | **KEEP** | Bounded retry; stable error after retry exhaustion. | PENDING D2.3 hardening | Rust WPD discovery | Race tests + unplug/replug regression pass. |
| `REQ-DEV-010` | Raw PnP/WPD identifiers should remain native/internal unless a concrete UI requirement needs them. | Current forensic audit | **KEEP** | Expose opaque/session-scoped frontend identifier and redact raw IDs from normal logs. | PENDING D2.3 decision | Tauri IPC privacy | UI performs device selection without raw PnP identity. |

## 7. Android & OEM

| ID | Extracted requirement | Source | Classification | Final canonical decision | Current maturity/evidence | Target | Acceptance evidence |
|---|---|---|---|---|---|---|---|
| `REQ-AND-001` | Android supporting component build baseline: Kotlin 2.3.21, AGP 8.13.2, Gradle 9.1.0, JDK 21, compile/target 36, minSdk 26. | AF, AFG | **KEEP** | Retain current accepted toolchain pins until an explicit upgrade gate. | IMPLEMENTED baseline | Android compatibility contract | Core/app build/test on pinned toolchain. |
| `REQ-AND-002` | APK minSdk is not the Windows-host device-service floor. | AFG, TM, CD | **KEEP** | Host may observe/service devices independently of APK installability. | ARCHITECTURE FROZEN | Compatibility matrix | UI/report distinguishes APK unavailable from whole-device unsupported. |
| `REQ-AND-003` | Permissions are least-privilege, requested when needed with purpose; denial is a limitation, not failure. | ROOT, AFG, EVD | **KEEP** | Retain. | MODELLED/UNIT-TESTED; UI integration incomplete | Android component | Denied permission yields `PERMISSION_REQUIRED` with reason. |
| `REQ-AND-004` | Declare, detect and tested are different facts. | ROOT | **KEEP** | Capability metadata must not imply test success. | MODELLED | Capability/report schema | Pre-test UI says ready/available, not PASS. |
| `REQ-AND-005` | The exported Android evidence receiver requires authenticated/session-bound invocation and replay protection. | Current forensic baseline | **KEEP** | Add nonce/challenge, expiry, explicit component target, response binding. | PENDING | Android component security | Unauthorized/replayed broadcast is rejected. |
| `REQ-OEM-001` | Unknown OEM falls back to generic provider instead of failing. | OEM | **KEEP** | Retain generic-first design. | UNIT-TESTED | OEM capability resolver | Unknown OEM completes generic evidence path honestly. |
| `REQ-OEM-002` | Create OEM-specific adapters only after real-hardware evidence shows a need; do not create empty speculative stubs. | OEM, AFG | **KEEP** | Retain. | MODELLED/UNIT-TESTED interfaces | OEM adapter process | New adapter PR cites real device behavior and tests. |
| `REQ-OEM-003` | One Samsung device does not prove broad OEM support. | OEM, ROOT, TM | **KEEP** | Release compatibility claims follow physical matrix, not compile success. | HARDWARE proof narrow | Release test matrix | Each advertised OEM family has defined hardware evidence. |
| `REQ-OEM-004` | Historical Android 8–16 / broad OEM matrix is a validation target, not a current universal support promise. | TM, AFG | **KEEP + MODIFY** | Maintain as lab target; release claims only validated subset. | PARTIAL | Test matrix | Matrix clearly separates target/queued/proven/release-supported. |

## 8. Evidence

| ID | Extracted requirement | Source | Classification | Final canonical decision | Current maturity/evidence | Target | Acceptance evidence |
|---|---|---|---|---|---|---|---|
| `REQ-EVD-001` | Evidence collection uses independent collectors; failure in one collector must not abort the entire scan. | EVD, CW | **KEEP** | Retain. | UNIT-TESTED generic path | Unified Evidence V2 | Injected collector failure yields partial evidence/report with limitation. |
| `REQ-EVD-002` | Every material evidence field carries value/status/source/reason/timestamp. | EVD, ROOT | **KEEP** | Retain and expand across WPD, ADB, APK, operator/system sources. | PARTIAL | Evidence V2 | Schema requires provenance/status metadata. |
| `REQ-EVD-003` | Evidence source vocabulary must evolve from S1/S2 to Windows USB, WPD/MTP, ADB, Android Component, Operator and System without breaking V1 history. | EVD old mapping, current forensic baseline | **KEEP + MODIFY** | Introduce versioned Evidence V2 and compatibility mapping. | PENDING | packages/evidence / API | Historical V1 reports validate; new V2 records preserve source. |
| `REQ-EVD-004` | IMEI, hardware serial and other restricted identifiers are recorded only when legitimately available; never fabricate placeholders. | ROOT, EVD, AFG | **KEEP** | Retain. | UNIT-TESTED generic evidence | Evidence contracts | Unavailable restricted identifier is explicit, never zero/dummy. |
| `REQ-EVD-005` | Do not make IMEI the primary device identity. | AFG | **KEEP** | Use session/device correlation with allowed identifiers. | DECISION FROZEN | Correlation/evidence | Core workflow succeeds without IMEI. |
| `REQ-EVD-006` | Do not design around unrestricted Android `/data` or broad storage privileges. | ROOT, EVD, AFG | **KEEP** | Retain scoped-storage/least-privilege design. | PARTIAL | Android evidence | No unsupported private-filesystem crawling. |
| `REQ-EVD-007` | WPD default scan is metadata-first: enumerate objects/properties without opening/copying/uploading customer file content. | Current WPD contract / canonical | **KEEP** | Permanent privacy boundary for basic MTP evidence. | CONTRACT FROZEN; scanner not built | WPD scanner | Hardware test proves zero customer content streams opened. |
| `REQ-EVD-008` | Folder/file metadata does not prove an application was installed, running, or used. | Current WPD contract | **KEEP** | Report only observed metadata/risk indicator, not behavioral inference. | CONTRACT FROZEN | WPD evidence/report | Report language differentiates observation from inference. |
| `REQ-EVD-009` | Raw evidence is immutable; canonicalize before digesting; preserve collection time; sync must be idempotent. | ROOT | **KEEP** | Retain and extend to Evidence V2. | PARTIAL | Evidence package/API | Canonical replay produces same digest and collectedAt. |
| `REQ-EVD-010` | Same evidence ID with a different canonical payload is an integrity conflict, not an idempotent no-op. | Current forensic baseline | **KEEP** | Add digest comparison and `EVIDENCE_ID_CONFLICT`. | PENDING | API/database | Replay conflict test rejects changed payload. |
| `REQ-EVD-011` | Processing session ID, device lifecycle ID, evidence ID and report ID are distinct identities. | ROOT | **KEEP** | Retain. | IMPLEMENTED schema concept | Data model | No API/schema aliases these IDs. |
| `REQ-EVD-012` | Capability is not test result; pre-test UI must not display PASS. | ROOT | **KEEP** | Retain. | PARTIAL | UI/evidence | Capability-supported state uses READY/AVAILABLE until test evidence exists. |
| `REQ-EVD-013` | Local observational evidence and digest remain independently verifiable even if cloud sync is deferred. | ROOT offline-first, current forensic baseline | **KEEP + MODIFY** | Local canonical artifact first; cloud registry verifies/stores it. | PENDING full integration | Evidence sync | Offline verification completes locally and later sync preserves digest. |
| `REQ-EVD-014` | Raw customer photos/messages/private content are not stored in Neon by default. | ROOT | **KEEP** | Keep cloud evidence metadata/integrity refs unless a separately authorized artifact policy is introduced. | PARTIAL | Cloud evidence/privacy | Schema/API cannot silently ingest private content blobs. |

## 9. UX

| ID | Extracted requirement | Source | Classification | Final canonical decision | Current maturity/evidence | Target | Acceptance evidence |
|---|---|---|---|---|---|---|---|
| `REQ-UX-001` | Desktop must show physical USB, MTP/WPD and ADB states independently. | DUX old USB/ADB + current correction | **KEEP + MODIFY** | Add MTP/WPD state to connection panel and remove ADB-as-connection prerequisite. | UI NOT YET INTEGRATED | Desktop UI | Real MTP-only handset shows connected/basic evidence available. |
| `REQ-UX-002` | Diagnostic workflow is non-destructive and can complete with partial evidence/limitations. | CW, EVD | **KEEP** | Retain. | DOMAIN UNIT-TESTED; UI incomplete | Desktop/Domain Engine | Report 1 can be produced without every optional collector. |
| `REQ-UX-003` | Customer UI should be professional, information-dense and repeatable for technicians without exposing secrets/payment data/internal tokens. | CW | **KEEP** | Preserve intent; exact visual composition remains design-level. | DESIGN/MODELLED | Desktop UI | Usability review; no sensitive token/card display. |
| `REQ-UX-004` | Do not present a mysterious single health/AI percentage without a defined methodology. | CW, AI | **KEEP** | Use evidence-backed dimensions and versioned rules. | AI not integrated | Grading/report UI | Any grade references methodology/ruleset version and evidence. |
| `REQ-UX-005` | Report/diagnostic UI must show unsupported/restricted evidence rather than silently omit it. | CW, EVD | **KEEP** | Retain. | PARTIAL | Desktop/report | Limitation counters/details visible. |
| `REQ-UX-006` | Exact old four-region/navigation layout is a design reference, not immutable architecture. | DUX, CW | **DEFERRED** | Preserve information architecture goals; allow UI refinement during real integration. | DESIGN ONLY | Desktop UX | Final UI satisfies workflow/usability acceptance rather than pixel-copying old mockup. |

## 10. Licensing

| ID | Extracted requirement | Source | Classification | Final canonical decision | Current maturity/evidence | Target | Acceptance evidence |
|---|---|---|---|---|---|---|---|
| `REQ-LIC-001` | Device scan entitlement is distinct from operator/user seats. | CW, LIC, AI | **KEEP** | Retain terminology `Licensed Device Scans` for device quantity. | MODELLED | Entitlement model/UI | Schema/API/UI do not call scans users. |
| `REQ-LIC-002` | Visible licence/serial is not the immutable database identity. | CW, LIC, AI | **KEEP** | Use immutable `license_id` and revision/history model. | PARTIAL current cloud schema | Database/API | Serial rotation/upgrade preserves internal identity/history. |
| `REQ-LIC-003` | Licence upgrades create new entitlement revisions and preserve history; usage is not reset to zero. | CW, LIC, AI | **KEEP** | Retain. | MODELLED/partial cloud | Entitlement tables | Upgrade test preserves used count/history. |
| `REQ-LIC-004` | Payment confirmation and entitlement authorization are separate; desktop is never the final commercial authority. | AI, GEN | **KEEP** | Server/control plane owns entitlement authority. | PARTIAL | API/admin | Desktop cannot increase entitlement locally. |
| `REQ-LIC-005` | Commercial plans/prices are server-configurable, not permanently hard-coded in desktop. | AI, CW | **KEEP** | Retain; historical exact plan/pricing examples are non-binding. | PARTIAL | API/UI | Plan catalog is server-driven/configurable. |
| `REQ-LIC-006` | Passive connection, USB/WPD discovery and preflight never consume a scan. | AI, current forensic baseline | **KEEP** | Permanent commercial invariant. | DOMAIN intent exists; durable integration missing | Verification transaction | Connect/disconnect cycles produce zero consumption. |
| `REQ-LIC-007` | Explicit operator start of Device Verification begins the chargeable transaction; final debit occurs only after canonical Report 1 successfully freezes. | AI old trigger, LIC old trigger, current forensic baseline | **KEEP + MODIFY** | Use durable RESERVE → evidence → report freeze → CONSUME state machine; avoid old ambiguous 'final certificate' debit. | PENDING | API/DB/Domain Engine | Crash/retry cannot double-charge; failed report releases/expires reservation by policy. |
| `REQ-LIC-008` | Device binding and scan consumption are different domain concepts. | Current forensic baseline | **KEEP** | Separate tables/state. | PENDING | Database/API | Binding a device does not decrement entitlement. |
| `REQ-LIC-009` | Trial entitlement must be explicit policy, not synthesized automatically when no licence exists. | Current forensic baseline | **KEEP** | Environment/account policy controls trials; audit grants. | PENDING | API/admin | Production no-entitlement user gets explicit NO_ENTITLEMENT absent policy grant. |
| `REQ-LIC-010` | Public licence number is not a secret authenticator. | Current forensic baseline vs old parseable key | **KEEP + MODIFY** | Keep human-readable reference if desired; activation requires high-entropy/authenticated mechanism. | PENDING | Licence/auth design | Brute-forcing public serial cannot activate entitlement. |
| `REQ-LIC-011` | Network/server unavailable is distinct from invalid/revoked/expired licence. | CW, AI, GEN | **KEEP** | Retain explicit states. | MODELLED | Desktop/domain | Network loss never displays 'invalid licence' unless cryptographic/auth state proves invalid. |
| `REQ-LIC-012` | Offline grace is policy-controlled and cryptographically protected; exact 24-hour duration is not frozen. | CW, GEN, USER | **KEEP + MODIFY** | Define duration/configuration later; destructive operations require stronger online policy unless explicitly qualified. | MODELLED | Entitlement policy | Grace expiry/revocation tests; duration server-configurable. |
| `REQ-LIC-013` | Update and Upgrade are separate concepts: software maintenance vs commercial entitlement expansion. | CW, UPG, AI | **KEEP** | Retain. | MODELLED | Desktop UX | Buttons/actions invoke distinct services and states. |
| `REQ-LIC-014` | Desktop must not handle raw payment-card/UPI/payment-provider secrets. | CW, UPG, GEN | **KEEP** | External authenticated web/payment flow; secrets server-side only. | ARCHITECTURE | Web/API | Secret scan + code review prove no payment secret in client. |
| `REQ-LIC-015` | Optional manual admin approval after payment is a business-policy feature, not an unconditional architectural requirement. | AI, ADMIN | **DEFERRED** | Preserve capability but make workflow configurable by product policy. | PARTIAL admin source | Admin/control plane | Policy can enable/disable approval without desktop code change. |

## 11. Security & Admin

| ID | Extracted requirement | Source | Classification | Final canonical decision | Current maturity/evidence | Target | Acceptance evidence |
|---|---|---|---|---|---|---|---|
| `REQ-SEC-001` | Normal admin operations use staff identity/session authentication; infrastructure admin tokens are break-glass/service-only. | Current forensic baseline vs ADMIN | **KEEP + MODIFY** | Current staff OTP/session model is normal path; remove browser dependence on long-lived admin token. | PARTIAL | Admin API/UI | Admin UI never stores infrastructure master token. |
| `REQ-SEC-002` | Admin/member existence should not be externally enumerable. | Current forensic baseline | **KEEP** | Return generic OTP/request responses; log internal reason. | PENDING hardening | Admin auth | Known/unknown operator requests are externally indistinguishable. |
| `REQ-SEC-003` | OTP issuance needs durable source/IP and identity throttles. | Current forensic baseline | **KEEP** | Implement rate limits similar to hardened admin patterns. | PENDING | API/DB | Burst abuse tests are throttled. |
| `REQ-SEC-004` | OTP challenge consumption must be atomic and replay-safe. | Current forensic baseline | **KEEP** | Conditional consume in transaction; exactly one success. | PENDING | API/DB | Concurrent correct verifies yield one session. |
| `REQ-SEC-005` | Low-entropy OTP verification material should use keyed/HMAC protection rather than bare database-computable hash. | Current forensic baseline | **KEEP** | Bind challenge ID + OTP to server secret. | PENDING | Auth crypto | DB compromise alone cannot validate OTP guesses. |
| `REQ-SEC-006` | Production browser session secrets should be HttpOnly/Secure and not readable from JavaScript. | Current forensic baseline | **KEEP** | Remove production `sessionStorage` bearer dependency; desktop auth gets separate token design. | PENDING | Web/API auth | Browser JS cannot read customer session secret. |
| `REQ-SEC-007` | CORS must use exact environment-specific origins, not wildcard trust of all CYVORIQ subdomains. | Current forensic baseline | **KEEP** | Narrow production origin allowlist. | PENDING | API | Unknown subdomain origin denied. |
| `REQ-SEC-008` | Internal maintenance mutations such as prune must not be anonymously callable. | Current forensic baseline | **KEEP** | Scheduled Worker or service-authenticated route. | PENDING | API operations | Anonymous internal maintenance request rejected. |
| `REQ-AUD-001` | Chargeable, destructive, report-freeze and admin transitions require an append-only audit event. | ROOT logical schema, ADMIN, current forensic baseline | **KEEP** | Add canonical audit ledger. | PENDING | Database/API | Each state-changing action has immutable correlated audit event. |
| `REQ-AUD-002` | Account lifecycle must not accidentally cascade-delete frozen evidence/reports. | Current forensic baseline | **KEEP** | Separate account deactivation/anonymization from evidence retention. | PENDING | Database retention | Account deletion test preserves retained report/evidence per policy. |
| `REQ-AUD-003` | OTP/session PII and expired auth artifacts need an explicit retention/cleanup policy. | Current forensic baseline | **KEEP** | Minimize challenge PII and schedule cleanup. | PENDING | Privacy/runbook | Expired rows removed by documented policy. |
| `REQ-AUD-004` | Payment/admin audit details such as approval actor, order state and entitlement revision history should be retained when those commercial workflows are enabled. | ADMIN, AI | **KEEP + MODIFY** | Preserve auditable event semantics without freezing old JWT/role/payment-provider specifics. | PARTIAL | Audit/admin domain | Enabled order/approval workflow is reconstructible from event log. |

## 12. Reporting

| ID | Extracted requirement | Source | Classification | Final canonical decision | Current maturity/evidence | Target | Acceptance evidence |
|---|---|---|---|---|---|---|---|
| `REQ-RPT-001` | Report 1 official purpose is pre-sanitization Device Verification; it must not imply sanitization. | ROOT, RPT | **KEEP** | Standardize as `CYVRA Device Verification Report`. | DOMAIN UNIT-TESTED; UI/cloud convergence incomplete | Report V2 | Report 1 contains no wipe-success claim. |
| `REQ-RPT-002` | Final report/certificate is emitted only after an authorized sanitization operation and post-sanitization verification. | ROOT, RPT, SAN | **KEEP** | Standardize final name in canonical report contract. | MODELLED/UNIT-TESTED only | Report V2 / sanitization | Certificate generation is unreachable without verified workflow state. |
| `REQ-RPT-003` | One canonical report manifest/digest must be shared by local engine and cloud registry. | RPT old local + current forensic baseline | **KEEP + MODIFY** | Eliminate competing Kotlin/cloud definitions; cloud verifies/stores canonical manifest. | PENDING | Report V2 | Local and cloud compute/verify identical canonical digest. |
| `REQ-RPT-004` | Digest is over canonical representation/immutable evidence, not pretty-printed JSON. | ROOT, GEN | **KEEP** | Retain. | PARTIAL | Evidence/report package | Formatting changes do not change digest. |
| `REQ-RPT-005` | PDF/JSON exports are presentation/interop forms of the canonical report, not separate sources of truth. | RPT | **KEEP + MODIFY** | Canonical manifest first; renderers consume it. | PENDING | Report/rendering | PDF and JSON reference same report ID/digest. |
| `REQ-RPT-006` | Report coverage/limitations must be explicit; use COMPLETE/LIMITED/PARTIAL or a versioned equivalent rather than inferred success. | ROOT | **KEEP** | Retain. | PARTIAL | Report schema | Missing optional evidence changes coverage/limitations, not fabricated results. |
| `REQ-RPT-007` | Workstation private signing keys are not required merely to have tamper-evident SHA-256 reports. | GEN | **KEEP + MODIFY** | Digest is mandatory; digital signing is a separate release/key-management feature. No private key on customer workstation. | PENDING final signing design | Report/security | Tamper detection works without embedding signing private key. |
| `REQ-RPT-008` | Old Report A/D/S naming is not customer-facing mobile terminology. | ROOT | **KEEP** | Use Report 1 + Final Sanitization & Verification Certificate. | DECISION FROZEN | UI/docs | No active mobile UI uses A/D/S labels. |

## 13. Sanitization

| ID | Extracted requirement | Source | Classification | Final canonical decision | Current maturity/evidence | Target | Acceptance evidence |
|---|---|---|---|---|---|---|---|
| `REQ-SAN-001` | Diagnostics and sanitization are separate modules/stages; a diagnostic scan never authorizes destruction. | SAN, PUX, ROOT | **KEEP** | Permanent invariant. | MODELLED | Workflow engine/UI | Separate explicit authorization transition required. |
| `REQ-SAN-002` | Before destruction persist operation/session ID, device identity evidence, method, start time, authorization and expected reboot. | SAN | **KEEP** | Retain and bind to same-device correlation. | MODELLED partially | Sanitization transaction | Crash/restart preserves pre-operation record. |
| `REQ-SAN-003` | Sanitization capability must express SUPPORTED/PARTIAL/UNSUPPORTED/permission/device-owner/OEM/unknown states, not simple PASS/FAIL. | SAN | **KEEP** | Retain. | MODELLED | Capability model | Unsupported method is not offered. |
| `REQ-SAN-004` | Verification states must distinguish verified, partial, platform-reported, external verification required, failed and unknown. | SAN, PUX | **KEEP** | Retain and strengthen. | MODELLED | Verification/report | Final claim exactly matches verification state. |
| `REQ-SAN-005` | A command returning success is not proof of sanitization. | SAN, GEN | **KEEP** | Require independent reconnect/post-reset evidence. | MODELLED; current verifier too weak | Verifier | Command success alone cannot produce final certificate. |
| `REQ-SAN-006` | Factory reset must never automatically be described as NIST Purge or cryptographic erase. | SAN, PUX | **KEEP** | Method-specific language and assurance only. | GOVERNING | Report/UX | Certificate names actual method and limitations. |
| `REQ-SAN-007` | Ordinary customer devices must not be assumed to have Device Owner/OEM privileged wipe capability. | SAN | **KEEP** | Privileged methods remain future/conditional. | DEFERRED | Capability engine | UI hides unavailable privileged methods. |
| `REQ-SAN-008` | Historical ADB commands (`recovery --wipe_data`, `MASTER_CLEAR`) are not production-qualified universal methods. | Current forensic baseline | **KEEP** | Treat as unqualified implementation experiments until method matrix proves support. | NOT HARDWARE-QUALIFIED | Sanitization provider | No release exposes a method without hardware acceptance. |
| `REQ-SAN-009` | Post-reset verification must be multi-signal; absence of screen lock/setup-wizard inference alone is insufficient. | Current forensic baseline vs old PUX/USER | **KEEP + MODIFY** | Define method-specific verification evidence and uncertainty states. | PENDING | Verification provider | Test shows ambiguous reset becomes external/partial, not VERIFIED. |
| `REQ-SAN-010` | Two-step destructive confirmation is required, but exact typed hardware serial is not universally valid because serial may be restricted. | GEN, PUX, USER | **KEEP + MODIFY** | Use explicit checklist + strong same-device confirmation using a legitimate displayed/session identity; typed serial only when reliably available. | PENDING UX | Purge UI | Destructive button stays disabled until two independent confirmation conditions pass. |
| `REQ-SAN-011` | Old manual choices such as 'Cryptographic Erase' or 'Overwrite & Zeroize' are not release methods until hardware/platform-specific proof exists. | USER | **SUPERSEDED** | Remove from active customer docs; add only after method qualification. | UNSUPPORTED | Sanitization catalogue | Unqualified methods absent from production UI. |
| `REQ-SAN-012` | Destructive sanitization should require stronger online/entitlement authorization than passive/non-destructive diagnostics unless a later offline policy is explicitly qualified. | CW, GEN, USER | **KEEP** | Keep online authority as default production policy. | MODELLED only | Entitlement/sanitization | Offline destructive attempt is blocked with clear reason. |
| `REQ-SAN-013` | Final certificate must name method, authority, execution status, verification status, limitations and assurance level. | SAN | **KEEP** | Retain. | MODELLED | Report V2 | Schema requires these fields. |
| `REQ-SAN-014` | Whole-device sanitization claims must not be derived from WPD file deletion or shared-storage comparison. | Current canonical/WPD contract | **KEEP** | WPD post-state is supplementary evidence only. | CONTRACT FROZEN | Sanitization/report | Certificate never equates MTP deletion with whole-device sanitization. |

## 14. AI & Grading

| ID | Extracted requirement | Source | Classification | Final canonical decision | Current maturity/evidence | Target | Acceptance evidence |
|---|---|---|---|---|---|---|---|
| `REQ-AI-001` | Controlled physical image capture + AI-assisted visible-defect detection is a preserved future CYVRA capability. | AI | **MISSING FROM NEW BASELINE** | Preserve as deferred product module; do not let it disappear during documentation archival. | MODELLED source/classes; not integrated | Project Index deferred scope / future contract | Future roadmap records module without claiming current release capability. |
| `REQ-AI-002` | AI must not claim properties a camera cannot prove (internal connector integrity, water seal, etc.). | AI | **KEEP** | Permanent evidence-honesty rule for future AI module. | MODELLED | Future AI contract | AI output schema limits claim classes. |
| `REQ-AI-003` | Low-quality/uncontrolled images must fail an image-quality gate before grading. | AI | **MISSING FROM NEW BASELINE** | Preserve for future AI module. | NOT INTEGRATED | Future AI contract | Bad-image tests yield recapture/review, not confident grade. |
| `REQ-AI-004` | AI identifies evidence; a versioned deterministic rules engine decides grade; human review handles exceptions. | AI | **KEEP + MODIFY** | Preserve separation of detection, rules and review. | UNIT-TESTED domain models; not UI-integrated | AI/grading contract | Grade is reproducible from evidence + ruleset version. |
| `REQ-AI-005` | Do not use a mysterious single AI percentage as the condition grade. | AI, CW | **KEEP** | Use dimensions/ruleset and transparent rationale. | DESIGN | Grading/report | Grade output references evidence dimensions and ruleset. |
| `REQ-AI-006` | CYVORIQ grading methodology is proprietary/versioned and must not be misrepresented as a government/BIS grade. | AI | **KEEP** | Preserve legal/marketing honesty. | DESIGN | Grading docs | Customer report names CYVORIQ methodology/version. |
| `REQ-AI-007` | Every AI finding retains source image/view, confidence, model version, session/device reference and review outcome. | AI | **MISSING FROM NEW BASELINE** | Preserve as future evidence schema requirement. | NOT INTEGRATED | Future AI evidence schema | Finding is auditable/reproducible. |
| `REQ-AI-008` | Country-specific grade presentation may vary, but underlying evidence must not change. | AI | **DEFERRED** | Preserve only as future presentation policy. | NOT IMPLEMENTED | Future grading policy | Country mapping changes labels, not evidence digest. |
| `REQ-AI-009` | Safety suspicion should produce a hold/manual confirmation state, not an automated certainty claim. | AI | **KEEP** | Preserve. | MODELLED | Future AI/workflow | Safety-risk test routes to review/hold. |
| `REQ-AI-010` | Human review actions must be auditable with actor/time/reason and must not silently overwrite source evidence. | AI, USER | **KEEP** | Preserve and integrate with audit ledger if module is enabled. | MODELLED | Audit/AI | Review creates separate immutable decision record. |

## 15. Release

| ID | Extracted requirement | Source | Classification | Final canonical decision | Current maturity/evidence | Target | Acceptance evidence |
|---|---|---|---|---|---|---|---|
| `REQ-UPD-001` | Software UPDATE and entitlement UPGRADE are separate services and UI actions. | CW, UPG, AI | **KEEP** | Retain. | MODELLED | Desktop UI/services | No shared state machine or ambiguous action. |
| `REQ-UPD-002` | Production updates must use HTTPS, authenticated metadata, signed artifacts, integrity verification and staged installation. | CW, AI, GEN | **KEEP** | Retain; exact signature algorithm follows approved updater implementation. | MODELLED | Updater/release | Tampered/unsigned update is rejected. |
| `REQ-UPD-003` | Exact historical Ed25519/delta-package wording is implementation-specific, not frozen architecture. | GEN, USER | **KEEP + MODIFY** | Require cryptographic signature/integrity; use supported Tauri/platform mechanism and key-management design. | PENDING | Updater contract | Release manifest records algorithm/key ID/version. |
| `REQ-UPD-004` | Update failure should be recoverable/rollback-safe. | AI, USER | **KEEP** | Retain as release requirement. | MODELLED | Updater | Interrupted/tampered update leaves working prior version. |
| `REQ-REL-001` | Customer installer bundles/controls Kotlin Domain Engine runtime and required native/device tooling. | CW, INST, current forensic baseline | **KEEP + MODIFY** | Package Tauri + Kotlin Host distribution + private runtime/tools; no dev environment dependency. | PENDING | Windows packaging | Clean machine acceptance passes. |
| `REQ-REL-002` | Release artifacts must be code-signed and accompanied by cryptographic hashes/manifest. | INST, ADMIN | **KEEP** | Retain. | NOT RELEASE-VALIDATED | CI/release | Installer signature validates; published hash matches artifact. |
| `REQ-REL-003` | Private code-signing/update keys must not live in source, developer laptops, or customer workstations. | GEN, ADMIN | **KEEP** | Use protected CI/signing service/HSM or equivalent controlled store. | PENDING | Release security | Secret scan + signing process review pass. |
| `REQ-REL-004` | Old fixed product version `v3.2.2-release` and exact installer filenames are historical examples, not current release truth. | ADMIN, USER, INST | **SUPERSEDED** | Generate docs from actual release version later. | NOT APPLICABLE | Future manuals | No active docs claim an unreleased fixed version. |
| `REQ-REL-005` | Root/customer installation manuals must be generated/re-written only after signed clean-machine acceptance. | INST, current P1.3 | **KEEP** | Archive old manual; produce release-derived guide later. | BLOCKED | Docs/release | Manual commands/paths match actual installer artifact. |
| `REQ-REL-006` | Windows CI must cover Rust/Tauri, desktop TypeScript, Kotlin core/host, Android where available, contracts and installer build. | Current forensic baseline | **KEEP** | Mandatory before release. | PENDING | GitHub Actions | Required checks green on protected main. |
| `REQ-REL-007` | Protect `main` and require PR/checks after CI stabilizes. | AFG, current forensic baseline | **KEEP** | Retain. | PENDING | GitHub governance | Direct push blocked except documented break-glass. |
| `REQ-REL-008` | Exact old WebView2/VC++/driver assumptions must be verified against the real installer rather than copied into active docs. | INST | **DEFERRED** | Determine from actual Tauri/runtime packaging and hardware support. | PENDING | Packaging/runbook | Clean-machine test records real prerequisites. |
| `REQ-REL-009` | Production support claims require real hardware/clean-machine evidence, not emulator or compilation alone. | TM, CTM, AFG | **KEEP** | Retain. | PARTIAL | Acceptance matrix | Each advertised capability points to hardware/release evidence. |
| `REQ-REL-010` | Emulators are useful for UI/API/storage/failure tests but do not prove USB drivers, OEM firmware, identifiers, factory reset or sanitization. | TM | **KEEP** | Retain. | TEST POLICY | Test matrix | Hardware-only rows cannot be closed by emulator evidence. |

## 16. Cloud & Data

| ID | Extracted requirement | Source | Classification | Final canonical decision | Current maturity/evidence | Target | Acceptance evidence |
|---|---|---|---|---|---|---|---|
| `REQ-CLD-001` | Worker/API is the only browser-facing path to Neon; raw database credentials are never exposed to Pages/browser. | ROOT | **KEEP** | Retain. | IMPLEMENTED architecture | API/deployment | No public frontend environment contains DB URL. |
| `REQ-CLD-002` | Resend is transactional and invoked server-side only; production From domain must be verified. | ROOT | **KEEP** | Retain. | PARTIAL | Email/auth runbook | Browser contains no Resend API key; send domain verified. |
| `REQ-CLD-003` | Do not reuse Erase Worker/admin/database resources for Mobile. | ROOT | **KEEP** | Retain. | IMPLEMENTED architecture | Infrastructure | Resource inventory confirms separate mobile resources. |
| `REQ-CLD-004` | Current production origin/domain instructions must come from active config/runbooks, not archived migration guides. | Current P1.2/P1.3 | **KEEP** | Archive old topology after references repaired. | P1.3 FROZEN | Project Index/runbooks | Active docs contain no obsolete start-here domain path. |
| `REQ-DB-001` | Frozen evidence/report retention is independent from customer-account deletion lifecycle. | Current forensic baseline | **KEEP** | Remove unsafe cascade semantics and define retention/anonymization policy. | PENDING | Database | Retention migration test proves report preservation. |
| `REQ-DB-002` | Evidence/report/audit schema must support durable transaction IDs and replay/idempotency semantics. | ROOT, current forensic baseline | **KEEP** | Add verification transaction + audit ledger + digest conflict handling. | PENDING | Database/API | Retry/replay tests preserve one logical transaction. |
| `REQ-DB-003` | Historical exact table lists are design inputs, not permission to create unused speculative tables. | ROOT | **KEEP + MODIFY** | Schema grows only for implemented contracts/migrations. | ONGOING | Database governance | Each migration maps to accepted requirement. |
| `REQ-DB-004` | Cloud evidence/report records verify and register canonical local artifacts rather than independently redefining device observations. | Current forensic baseline | **KEEP** | Retain. | PENDING integration | Cloud evidence/report registry | Cloud and local report digest agree. |

## 17. Testing & Process

| ID | Extracted requirement | Source | Classification | Final canonical decision | Current maturity/evidence | Target | Acceptance evidence |
|---|---|---|---|---|---|---|---|
| `REQ-TST-001` | Do not claim support from compilation/unit tests alone. | TM, canonical maturity model | **KEEP** | Use six-level maturity vocabulary. | FROZEN | All docs/CI | Support matrix records highest proven level. |
| `REQ-TST-002` | Real-device matrix must include MTP-only, ADB unauthorized, ADB authorized/offline, disconnect/reconnect and multi-device ambiguity. | CTM, current forensic baseline | **KEEP + MODIFY** | Expand old USB/ADB matrix with WPD and correlation states. | PENDING full matrix | Hardware acceptance | Each state has captured real-hardware evidence. |
| `REQ-TST-003` | WPD hardware acceptance must include disconnect/topology-race behavior and metadata-only privacy proof. | Current D2.3 | **KEEP** | Add to test matrix. | PARTIAL | Rust/WPD tests | Unplug/replug and scanner privacy gates pass. |
| `REQ-TST-004` | Sanitization hardware testing uses owned/authorized devices and disposable data; unsupported method stays unsupported. | ROOT/SAN/current baseline | **KEEP** | Retain. | PENDING | Hardware lab | Method matrix includes prerequisites and evidence. |
| `REQ-TST-005` | Before broad changes: audit actual API/signatures, make minimal change, compile, unit test, real hardware test, regression, diff review, checkpoint. | Current canonical process | **KEEP** | Retain zero-guess workflow. | FROZEN | Engineering process | Every gate records exact evidence. |
| `REQ-TST-006` | Narrow patches must avoid formatter contamination of unrelated modules. | Current formatter incident | **KEEP** | Leaf formatting/shadow proof; `git diff --check`; exact diff review. | PROCESS FROZEN | Tooling/runbook | No unrelated file changes in narrow patch. |
| `REQ-TST-007` | Stop rather than guess when API, OEM privilege, destructive verification or platform behavior is uncertain. | AFG | **KEEP** | Retain. | PROCESS FROZEN | Engineering process | Unknown requirement becomes explicit STOP/BLOCKED. |

# 18. High-risk contradiction resolutions

| Old requirement / claim | Resolution |
|---|---|
| ADB is the primary Android communication mechanism and physical USB is inferred through ADB | **Corrected.** Windows USB and WPD/MTP are independent native truth planes; ADB is optional Android enrichment. |
| Process one device at a time | **Retained with correction.** One selected target may be processed at a time, but multiple attached devices must be detected and disambiguated before chargeable/destructive operations. |
| Manually type exact device serial before purge | **Safety intent retained, exact mechanism modified.** Use explicit two-step confirmation plus reliable session/same-device identity; typed serial only when legitimately available. |
| Scan is consumed when “certificate” is generated | **Replaced by durable transaction semantics.** Passive discovery is free; explicit verification starts reservation; consumption finalizes after canonical Report 1 succeeds. |
| Factory reset / ADB reset can be presented as NIST purge / cryptographic erase | **Rejected.** Only method-specific, hardware-qualified assurance may be claimed. |
| Setup wizard/no lock alone proves sanitization | **Rejected.** Multi-signal method-specific verification is required. |
| WPD file deletion/shared-storage cleanup proves whole-device sanitization | **Rejected.** WPD post-state is supplementary only. |
| Cloud database is the sole evidence truth | **Refined.** Workstation owns observation + canonical local digest; cloud owns account/entitlement/registry/audit and verifies stored artifacts. |
| Visible licence key can act as secret | **Rejected.** Public licence number may remain human-readable; activation authority needs authenticated/high-entropy proof. |
| Device binding count equals scan consumption count | **Rejected.** Binding and consumption are separate domain events. |
| Browser stores production bearer token in JavaScript-accessible storage | **Rejected for production web.** Use HttpOnly/Secure session cookie; desktop gets a separate auth contract. |
| All CYVORIQ subdomains are trusted API origins | **Rejected.** Use exact environment-specific origin allowlists. |
| Root and `docs/GUIDELINE.md` are equivalent | **Rejected.** They diverge; root remains transitional authority and docs copy is historical once references are repaired. |
| Windows Server 2019/2022 is currently supported | **Deferred.** Win10/11 are immediate release targets. |
| `adb.exe` v35.0.2 is permanently required | **Superseded exact pin.** Controlled tested Platform-Tools remains required; actual release version is qualified later. |
| 24-hour offline grace is permanent product law | **Deferred policy detail.** Grace must be cryptographically protected and configurable. |
| Ed25519 is the only acceptable updater/report signature algorithm | **Implementation-specific.** Strong signature verification is required; use the approved release/updater mechanism and key-management design. |
| `v3.2.2-release` customer manuals describe current release | **Historical only.** New manuals are generated after signed clean-machine acceptance. |
| AI physical inspection/grading can be discarded because it is not in the immediate release path | **Rejected.** Preserve as deferred product module with its evidence-honesty requirements. |

---

# 19. Requirements that must be added to the active baseline/index during P1.5

The following requirements are especially important because they are either newly refined by the forensic audit or uniquely preserved from older source documents:

1. `REQ-AI-001`, `REQ-AI-003`, `REQ-AI-007` — preserve AI physical-inspection roadmap, image-quality gate, and AI evidence record.
2. `REQ-DEV-006`, `REQ-DEV-007` — safe multi-device discovery and `SessionDeviceRef` correlation.
3. `REQ-EVD-010` — same-ID/different-payload evidence integrity conflict.
4. `REQ-LIC-007`, `REQ-LIC-008`, `REQ-LIC-010` — durable verification transaction, separate binding/consumption, public licence number vs activation authority.
5. `REQ-RPT-003`, `REQ-RPT-007` — canonical report manifest across local/cloud; digest vs signing-key separation.
6. `REQ-SAN-009`, `REQ-SAN-010` — stronger post-reset verification and serial-independent two-step safety barrier.
7. `REQ-SEC-002` through `REQ-SEC-008` — authentication hardening from the final forensic review.
8. `REQ-AUD-001` through `REQ-AUD-004` — append-only audit, retention, auth-artifact cleanup, commercial event history.
9. `REQ-REL-001` through `REQ-REL-010` — release packaging, CI, signing, clean-machine evidence and removal of obsolete fixed-version claims.

---

# 20. Source-document disposition after extraction

P1.4 extracts the material requirements but **does not authorize file movement yet**.

| Source group | P1.4 conclusion | P1.5 action |
|---|---|---|
| Root `GUIDELINE.md` | Contains unique safety/compliance + infrastructure rules | Keep transitional; merge unique safety rules before retiring |
| Android Final Freeze Guide | Useful compatibility/OEM/security requirements; ADB-first wording stale | Rewrite active contracts, then archive guide |
| Customer Windows Freeze Guide | Large source of UX/licensing/update/report requirements | Rewrite active customer contracts, then archive guide |
| Advanced AI/Grading/Licensing Workflow | Unique AI/grading/human-review requirements | Add deferred AI scope/contract, then archive source |
| General Application Guidelines | Useful security/offline/release invariants mixed with stale implementation claims | Absorb valid invariants, then archive |
| Customer/Admin/Install manuals | Future-state manuals contain unsafe premature claims and fixed versions | Archive old manuals; regenerate after release validation |
| Device/Transport/Sanitization/OEM/Test architecture files | Subjects remain active | Rewrite in place rather than archive immediately |
| G0–G8/resume/migration files | Historical only | Archive after inbound references are repaired |

---

# 21. P1.4 acceptance criteria

P1.4 is complete when:

- [x] High-value old documents have been mined for surviving requirements.
- [x] Requirements are normalized into stable IDs.
- [x] Each requirement has a keep/modify/supersede/defer classification.
- [x] ADB-first, one-device, serial-confirmation, scan-debit, sanitization and evidence-authority conflicts are resolved.
- [x] Unique AI/grading requirements are preserved rather than lost.
- [x] Release/manual claims that exceed proven maturity are identified as historical.
- [x] No file was archived/deleted as part of extraction.
- [x] P1.5 has an explicit set of active documents to rewrite and historical files to archive.

---

# 22. P1.4 decision

**Requirement extraction:** COMPLETE
**Architecture reconciliation:** COMPLETE
**Unique requirement preservation:** COMPLETE
**Mass deletion authorization:** NONE
**Archive movement authorization:** NOT YET — P1.5 only
**Product-code modification:** NONE

Next gate:

> **P1.5 — Documentation Consolidation**

P1.5 should:
1. rewrite root `README.md`,
2. update `CYVRA_MOBILE_PROJECT_INDEX.md` with the accepted classifications/requirements,
3. rewrite active transport/evidence/sanitization/customer contracts around the final architecture,
4. create `docs/archive/README.md`,
5. repair script/doc inbound references,
6. move superseded documents with `git mv`,
7. run repository-wide broken-reference and diff-hygiene checks,
8. make no unrelated product-code changes.
