# CYVRA Mobile — P1.3 Documentation Classification & Archive Plan Freeze

**Date:** 2026-09-19  
**Phase:** Phase 1 — CONSOLIDATE  
**Gate:** P1.3 — Classification & Archive Plan Freeze  
**Status:** APPROVED CLASSIFICATION BASELINE — NO FILE MOVES/DELETIONS IN THIS GATE  
**Repository:** `mukpswar-prog/CYVRA-Mobile`  
**Audited remote baseline:** `main` @ `81309e28e32fa638fd7fcaa1bd0ab0a007888748`  
**Active local engineering branch:** `d2-3-wpd-mtp-evidence-plane`

---

## 0. Purpose

This document freezes the documentation classification model for CYVRA Mobile after completion of:

- P1.1 — Governance Baseline Insertion / normalization
- P1.2 — Documentation Dependency & Reference Audit

P1.3 does **not** move, delete, rename, stage, commit, publish, or archive files.

Its purpose is to decide, before any physical repository change:

1. which documents are authoritative,
2. which documents are active technical contracts,
3. which documents need rewriting,
4. which documents are historical and should be archived,
5. which files cannot yet be archived because code/scripts still reference them,
6. which files may eventually be deleted,
7. what archive structure will be created later,
8. what order the consolidation must follow.

---

# 1. Frozen documentation status vocabulary

Every documentation file must be assigned one of the following states.

## 1.1 ACTIVE-GOVERNING

Defines project-wide product, safety, architecture, execution, or governance authority.

## 1.2 ACTIVE-CONTRACT

Defines a narrow technical contract that remains binding.

Examples:

- Android compatibility/toolchain pins
- WPD evidence boundary
- sanitization assurance
- evidence schema
- transport ownership

## 1.3 ACTIVE-RUNBOOK

Current operational instructions that engineers actively use.

## 1.4 ACTIVE-REFERENCE

Current research, test matrix, tooling, or technical reference material.

## 1.5 REWRITE-ACTIVE

The subject remains active, but the document contains stale assumptions, old architecture, outdated maturity claims, or incomplete production design.

It must be rewritten before the old version is archived.

## 1.6 EXTRACT-THEN-ARCHIVE

Contains unique useful requirements, product decisions, or design material, but must not remain an execution authority.

Unique requirements must be absorbed into current governing/contract documents before archival.

## 1.7 HISTORICAL-SUPERSEDED

Useful engineering history, but no longer valid execution guidance.

Archive only after inbound references are repaired.

## 1.8 DELETE-CANDIDATE

May be physically deleted only after all of the following are proven:

- exact duplicate, generated artifact, obsolete template, or no unique engineering value;
- no inbound references;
- no unique requirement;
- owner approval.

P1.3 does not approve deletion of any current file.

---

# 2. Permanent primary documentation set

These files are the primary documentation authority going forward.

| Path | Classification | Decision |
|---|---|---|
| `GUIDELINE.md` | ACTIVE-GOVERNING — TRANSITIONAL | Keep until unique compliance/safety rules are fully absorbed into the canonical guide. |
| `docs/CYVRA_MOBILE_CANONICAL_ENGINEERING_GUIDELINE_2026-09-19.md` | ACTIVE-GOVERNING | Permanent primary guide. |
| `docs/CYVRA_MOBILE_FINAL_FORENSIC_SYSTEM_DESIGN_BASELINE_2026-09-19.md` | ACTIVE-GOVERNING | Permanent issue/mitigation baseline. |
| `docs/CYVRA_MOBILE_PROJECT_INDEX.md` | ACTIVE-GOVERNING | Permanent navigation and document-status map. |

## 2.1 Governing precedence

1. Compliance/safety prohibition
2. Canonical Engineering Guideline
3. Final Forensic/System-Design Baseline
4. Project Index
5. Active component contracts
6. Active runbooks/reference material
7. Historical archive

No historical file may override a governing or active contract.

---

# 3. Active component contracts

These documents remain technically important and must not be archived until rewritten or deliberately absorbed.

| Path | Classification | Required action |
|---|---|---|
| `docs/architecture/d2-3-wpd-mtp-evidence-contract.md` | ACTIVE-CONTRACT | Keep as current WPD/MTP evidence-plane contract. |
| `docs/ANDROID_COMPATIBILITY_FREEZE.md` | ACTIVE-CONTRACT / REWRITE-ACTIVE | Preserve toolchain pins; remove old start/resume and maturity wording. |
| `docs/DEVICE_EVIDENCE_ARCHITECTURE.md` | REWRITE-ACTIVE | Upgrade from S1/S2 assumptions to Evidence V2 with Windows USB/WPD/ADB/APK provenance. |
| `docs/WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md` | REWRITE-ACTIVE | Rewrite around independent Windows USB, WPD/MTP, and optional ADB. |
| `docs/SANITIZATION_ARCHITECTURE.md` | REWRITE-ACTIVE | Align to method-specific assurance, qualification, limitations, and post-reset verification. |
| `docs/OEM_ADAPTER_ARCHITECTURE.md` | ACTIVE-CONTRACT / REVIEW | Retain if consistent with generic-core-first model. |
| `docs/TEST_MATRIX.md` | ACTIVE-REFERENCE / REWRITE-ACTIVE | Expand to WPD/ADB/multi-device/failure-state matrix. |

---

# 4. Customer/product architecture cluster

This cluster contains valuable product intent but predates the final forensic architecture and must be rewritten before archival.

| Path | Classification | Mitigation |
|---|---|---|
| `docs/CUSTOMER_DESKTOP_PRODUCT_SPEC.md` | REWRITE-ACTIVE | Update device-state model, WPD path, current maturity. |
| `docs/CUSTOMER_DIAGNOSTIC_UX.md` | REWRITE-ACTIVE | Use orthogonal USB/MTP/ADB states. |
| `docs/CUSTOMER_LICENSE_ARCHITECTURE.md` | REWRITE-ACTIVE | Replace binding-as-scan logic with durable entitlement transaction model. |
| `docs/CUSTOMER_PURGE_UX.md` | REWRITE-ACTIVE | Align to qualified sanitization methods and assurance levels. |
| `docs/CUSTOMER_REPORT_ARCHITECTURE.md` | REWRITE-ACTIVE | Converge Kotlin/cloud Report 1 into canonical manifest/digest. |
| `docs/CUSTOMER_TEST_MATRIX.md` | REWRITE-ACTIVE | Expand hardware/failure/recovery coverage. |
| `docs/CUSTOMER_UPDATE_UPGRADE_ARCHITECTURE.md` | ACTIVE-CONTRACT / REVIEW | Keep useful update concepts; reconcile with final installer/updater architecture. |

---

# 5. Large historical source documents containing unique requirements

These are **not safe for immediate archival** because they contain product requirements that may not yet be fully absorbed.

| Path | Classification | Decision |
|---|---|---|
| `docs/CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md` | EXTRACT-THEN-ARCHIVE | Extract unique Windows desktop product requirements. |
| `docs/CYVRA_Mobile_Advanced_Customer_Application_AI_Grading_Licensing_Master_Workflow.md` | EXTRACT-THEN-ARCHIVE | Extract unique UX/grading/licensing/admin workflow requirements. |
| `docs/CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md` | EXTRACT-THEN-ARCHIVE | Preserve Android pins/OEM policy; retire ADB-first architecture language. |
| `docs/CYVRA_MOBILE_GENERAL_APPLICATION_GUIDELINES.txt` | EXTRACT-THEN-ARCHIVE | Extract unique product/security rules. |

No physical move is allowed until P1.4 confirms their unique requirements have been accounted for.

---

# 6. Manuals that must be replaced

These documents describe a future/product-complete state that is not yet RELEASE-VALIDATED.

| Path | Classification | Decision |
|---|---|---|
| `docs/CYVRA_MOBILE_ADMINISTRATOR_MANUAL.txt` | REPLACE / ARCHIVE-OLD | Recreate from validated admin system later. |
| `docs/CYVRA_MOBILE_CUSTOMER_USER_MANUAL.txt` | REPLACE / ARCHIVE-OLD | Recreate after real desktop lifecycle is integrated. |
| `docs/CYVRA_MOBILE_DOWNLOAD_AND_INSTALLATION_GUIDE.txt` | REPLACE / ARCHIVE-OLD | Recreate only after installer/signing/clean-machine release validation. |

These files must not be used to prove that a feature currently exists.

---

# 7. Historical implementation/audit plans

These are no longer current execution authority.

| Path | Classification | Reason |
|---|---|---|
| `docs/CYVRA_MOBILE_IMPLEMENTATION_PLAN.md` | HISTORICAL-SUPERSEDED | Old phase law and old device-selection assumptions. |
| `docs/CYVRA_MOBILE_RECTIFICATION_PLAN.txt` | HISTORICAL-SUPERSEDED | Superseded by final architecture baseline. |
| `docs/CYVRA_MOBILE_DEEP_AUDIT_AND_NEXT_STEPS.txt` | HISTORICAL-SUPERSEDED | Contains old “all phases complete” maturity claims. |

Archive after references are removed.

---

# 8. Historical G0–G8 / resume / migration cluster

The following are classified **HISTORICAL-SUPERSEDED** and should be moved together later into the historical archive.

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

## 8.1 Why they are archived rather than deleted

They preserve evidence of:

- earlier Cloudflare/Neon/Resend setup,
- old domain migration decisions,
- G0–G8 execution,
- Android freeze evolution,
- Samsung hardware steps,
- why certain architectural diversions were approved.

They must no longer be “start here” documents.

---

# 9. Root `README.md`

**Classification:** REPLACE

The current README is a stale dependency hub linking directly into historical G0–G8/resume/migration documents.

## Required replacement purpose

New root README should contain only:

1. CYVRA Mobile one-paragraph description
2. current architecture summary
3. current supported engineering status
4. repository layout summary
5. basic build/test entrypoints
6. mandatory link to:
   `docs/CYVRA_MOBILE_PROJECT_INDEX.md`

It must not contain “resume here” history.

---

# 10. `docs/GUIDELINE.md`

**Classification:** HISTORICAL-SUPERSEDED / BLOCKED FROM ARCHIVE UNTIL REFERENCES REMOVED

P1.2 proved that:

- root `GUIDELINE.md`
- `docs/GUIDELINE.md`

are not identical.

The root file contains later domain/website direction.

Therefore:

- root `GUIDELINE.md` remains transitional authority;
- `docs/GUIDELINE.md` must not be treated as governing;
- inbound references to `docs/GUIDELINE.md` must be removed first;
- then move it to archive, not delete.

---

# 11. Active test/research/reference documents

| Path | Classification | Action |
|---|---|---|
| `docs/testing/README.md` | ACTIVE-REFERENCE / REWRITE | Keep; simplify around current test architecture. |
| `docs/testing/pool.md` | ACTIVE-REFERENCE / REWRITE | Preserve historical test evidence; update statuses. |
| `docs/research/samsung-s1-sources.md` | ACTIVE-REFERENCE | Keep as source research; mark S1 terms historical where needed. |
| `docs/tooling.md` | ACTIVE-REFERENCE | Keep; script dependency exists. |
| `docs/neon-cloudflare.md` | ACTIVE-REFERENCE / REVIEW | Keep conceptual infrastructure guidance, verify live topology later. |
| `docs/resend-mobile-otp.md` | ACTIVE-RUNBOOK / REWRITE | Keep setup knowledge; align to new OTP security design. |
| `docs/android-studio-laptop.md` | ACTIVE-RUNBOOK / REWRITE | Keep Android Studio/toolchain guidance; remove obsolete resume chain. |
| `docs/admin-scope-freeze.md` | ACTIVE-REFERENCE / REVIEW | Preserve current admin-domain policy until replaced. |
| `docs/token-inventory.txt` | ACTIVE-RUNBOOK / SECURITY REVIEW | Keep only if no secrets; align to final secret-management process. |

---

# 12. README files in subprojects

## `apps/android/README.md`

**Classification:** REWRITE-ACTIVE

Retain:

- Android component role
- build/test instructions
- supporting-component boundary

Remove:

- old G5 resume instructions
- stale phase status.

## `apps/desktop/README.md`

**Classification:** REPLACE

Current generic React/Vite template must be replaced by CYVRA desktop documentation.

New content:

- React/Tauri boundary
- Rust Native Layer responsibility
- Kotlin Domain Engine bridge
- Windows build prerequisites
- WPD/USB safety rules
- packaging notes
- test commands.

## `packages/evidence/README.md`

**Classification:** REWRITE-ACTIVE

Must distinguish:

- historical Evidence V1
- planned Evidence V2
- compatibility expectations
- report digest/canonicalization path.

---

# 13. Operational runbooks blocked from archival

P1.2 found direct script dependencies.

## 13.1 `docs/admin-cyvoriq-start.txt`

Current dependency:

```text
scripts/deploy-admin-cyvoriq.sh
→ docs/admin-cyvoriq-start.txt
```

**Classification:** ACTIVE-RUNBOOK-PENDING-REPLACEMENT

Do not move until the script is updated.

## 13.2 `docs/www-cyvoriq-start.txt`

Current dependency:

```text
scripts/deploy-www-cyvoriq.sh
→ docs/www-cyvoriq-start.txt
```

**Classification:** ACTIVE-RUNBOOK-PENDING-REPLACEMENT

Do not move until script is updated.

## 13.3 `docs/tooling.md`

Current dependency:

```text
scripts/install.sh
→ docs/tooling.md
```

**Classification:** ACTIVE-REFERENCE

Keep.

---

# 14. Archive structure — approved future target

P1.3 approves the following future structure.

```text
docs/
├── CYVRA_MOBILE_CANONICAL_ENGINEERING_GUIDELINE_2026-09-19.md
├── CYVRA_MOBILE_FINAL_FORENSIC_SYSTEM_DESIGN_BASELINE_2026-09-19.md
├── CYVRA_MOBILE_PROJECT_INDEX.md
│
├── architecture/
│   ├── d2-3-wpd-mtp-evidence-contract.md
│   └── future active contracts
│
├── testing/
│   └── active test documentation
│
├── research/
│   └── active technical research
│
└── archive/
    ├── README.md
    └── 2026-09-pre-final-baseline/
        ├── resume/
        ├── g0-g8/
        ├── migration/
        ├── old-freeze-guides/
        ├── old-manuals/
        └── old-plans/
```

No directory is created in P1.3.

---

# 15. Archive README — approved future content

When `docs/archive/README.md` is created later, it should state:

```text
# CYVRA Mobile Historical Documentation

Files under this directory are retained for engineering history,
forensic traceability, and decision provenance.

They are NOT current execution instructions.

Current authority:
1. ../CYVRA_MOBILE_CANONICAL_ENGINEERING_GUIDELINE_2026-09-19.md
2. ../CYVRA_MOBILE_FINAL_FORENSIC_SYSTEM_DESIGN_BASELINE_2026-09-19.md
3. ../CYVRA_MOBILE_PROJECT_INDEX.md

Do not use archived resume, freeze, migration, or implementation-plan
documents to determine current project status.
```

The absence of this file during P1.2 was expected because the archive directory does not yet exist.

---

# 16. Physical file-move rules for P1.5

When archival begins later:

1. use `git mv`,
2. never copy + delete manually,
3. move one classification group at a time,
4. update active inbound links first,
5. run repository reference scan after each group,
6. run `git diff --check`,
7. verify no source/script path broke,
8. do not mix application-code changes with bulk documentation migration.

---

# 17. Deletion policy — frozen

P1.3 approves **zero immediate deletions**.

A file can later become DELETE-CANDIDATE only when:

```text
NO UNIQUE REQUIREMENT
+
NO ACTIVE REFERENCE
+
NO FORENSIC VALUE
+
NO SCRIPT DEPENDENCY
+
OWNER APPROVAL
```

Examples that may eventually qualify:

- generic scaffolding/template README after replacement,
- exact duplicate documentation,
- generated copies,
- empty obsolete placeholders.

Important historical decisions should normally be archived rather than deleted.

---

# 18. Contradiction resolution policy

When two documents disagree:

## Rule A — safety wins

A stronger safety/privacy limitation remains in force unless explicitly amended.

## Rule B — newer evidence-backed architecture wins over older implementation assumption

Example:

```text
OLD:
USB connected = ADB device exists

NEW:
WINDOWS_USB and WINDOWS_WPD_MTP are independent truth planes;
ANDROID_ADB is optional enrichment
```

The old document becomes historical or is rewritten.

## Rule C — implementation status never overrides actual test maturity

A historical file saying “DONE” does not promote a feature beyond the highest proven maturity level.

## Rule D — archive does not erase history

Old decision history is retained but cannot direct new implementation.

---

# 19. Specific contradiction decisions frozen in P1.3

## 19.1 ADB-first vs WPD/MTP

Decision:

```text
WINDOWS_USB
+
WINDOWS_WPD_MTP
=
valid basic workstation evidence

ANDROID_ADB
=
optional advanced Android evidence
```

WPD correction wins.

## 19.2 One-device workflow vs multi-device physical environment

Decision:

- CYVRA may process one explicitly selected target at a time.
- CYVRA must safely detect and disambiguate multiple connected devices.
- implicit first-device selection is prohibited for chargeable or destructive operations.

## 19.3 “All phases complete”

Decision:

Use only:

```text
MODELLED
UNIT-TESTED
PROTOCOL-EXPOSED
UI-INTEGRATED
HARDWARE-VALIDATED
RELEASE-VALIDATED
```

Old completion claims are historical.

## 19.4 Old domain topology

Historical migration URLs remain in archive only.

Current topology must be represented by current configuration/runbooks, not migration history.

---

# 20. P1.4 requirement-extraction targets

Before archival, P1.4 must inspect and extract unique requirements from these high-value documents:

```text
GUIDELINE.md
docs/ANDROID_COMPATIBILITY_FREEZE.md
docs/CYVRA_Mobile_Final_Android_MultiOEM_Windows_USB_ADB_Freeze_Guide.md
docs/CYVRA_Mobile_Customer_Side_Windows_Application_Product_Engineering_Freeze_Guide.md
docs/CYVRA_Mobile_Advanced_Customer_Application_AI_Grading_Licensing_Master_Workflow.md
docs/CYVRA_MOBILE_GENERAL_APPLICATION_GUIDELINES.txt
docs/CUSTOMER_DESKTOP_PRODUCT_SPEC.md
docs/CUSTOMER_DIAGNOSTIC_UX.md
docs/CUSTOMER_LICENSE_ARCHITECTURE.md
docs/CUSTOMER_PURGE_UX.md
docs/CUSTOMER_REPORT_ARCHITECTURE.md
docs/CUSTOMER_TEST_MATRIX.md
docs/CUSTOMER_UPDATE_UPGRADE_ARCHITECTURE.md
docs/DEVICE_EVIDENCE_ARCHITECTURE.md
docs/SANITIZATION_ARCHITECTURE.md
docs/WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md
docs/OEM_ADAPTER_ARCHITECTURE.md
docs/TEST_MATRIX.md
```

The goal is not to preserve old wording.

The goal is to ensure no useful requirement disappears.

---

# 21. P1.3 acceptance checklist

P1.3 is PASS when all are true:

- [x] status vocabulary frozen,
- [x] primary governing set identified,
- [x] active component contracts identified,
- [x] rewrite-active documents identified,
- [x] historical archive candidates identified,
- [x] script-blocked runbooks identified,
- [x] root/document guideline divergence accounted for,
- [x] no mass deletion approved,
- [x] archive structure defined,
- [x] contradiction-resolution rules frozen,
- [x] P1.4 requirement-extraction targets defined,
- [x] no repository file moved/deleted by this gate.

---

# 22. P1.3 decision

**Classification model:** FROZEN  
**Archive candidate set:** FROZEN  
**Immediate deletion authorization:** NONE  
**Immediate archive move authorization:** NONE  
**Rewrite targets:** FROZEN  
**Script dependency blockers:** FROZEN  
**Contradiction rules:** FROZEN  

Next gate:

> **P1.4 — Architecture & Requirement Extraction Inventory**

P1.4 will extract the surviving product, security, evidence, device, licensing, reporting, sanitization, release, and UX requirements from the high-value old documents before any archival operation occurs.
