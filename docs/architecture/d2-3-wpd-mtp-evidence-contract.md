# CYVRA Mobile D2.3 — Windows WPD/MTP Evidence Plane Contract

Status: FROZEN FOR IMPLEMENTATION
Base checkpoint: 81309e28e32fa638fd7fcaa1bd0ab0a007888748

## 1. Purpose

CYVRA Mobile shall treat Windows Portable Devices / Media Transfer Protocol
(WPD/MTP) as an independent, read-only evidence source for Android shared
storage.

ADB is not required for the workstation to accept a physically connected
device when Windows exposes that device through WPD/MTP.

## 2. Core Connection Model

Physical USB presence and Android ADB state are independent.

A device session may therefore exist with:

- physical USB available
- MTP/WPD available
- ADB unavailable

or with:

- physical USB available
- MTP/WPD available
- ADB authorized

The application must not collapse these states into one boolean.

## 3. Evidence Sources

CYVRA evidence shall preserve source attribution.

Primary source labels:

- WINDOWS_USB
- WINDOWS_WPD_MTP
- ANDROID_ADB
- ANDROID_COMPONENT
- OPERATOR
- SYSTEM

Evidence from one source must not be represented as evidence obtained from
another source.

## 4. WPD/MTP Evidence Scope

The WPD/MTP collector may collect metadata exposed by Windows for accessible
portable-device objects.

Permitted evidence includes, when available:

- portable-device identity
- friendly name
- manufacturer
- model
- device serial exposed by WPD
- storage identity
- storage description
- total storage capacity
- available/free storage
- filesystem/storage metadata
- storage serial when exposed
- visible folder hierarchy
- visible object hierarchy
- object identifiers
- persistent object identifiers when exposed
- parent object relationship
- object/file name
- original file name
- object type/content type
- object format
- file extension
- object/file size
- creation timestamp
- modification timestamp
- visible file count
- visible folder count
- visible byte total
- media counts
- document counts
- archive/backup counts
- APK/package-file artifact counts
- certificate/key-file artifact indicators
- application-associated shared-storage artifact indicators
- metadata-derived risk indicators
- collector limitations
- enumeration errors
- scan start/end timestamps
- deterministic inventory digest

## 5. Privacy Contract

Standard WPD/MTP scanning is metadata-first and read-only.

The standard scan MUST NOT automatically:

- open customer documents
- copy customer documents
- upload customer documents
- preview photographs or videos
- parse document body content
- inspect message content
- extract private app databases
- bypass Android application isolation
- infer private data that was not observable

Filename and path metadata may be used for bounded risk classification.

The report must distinguish:

- metadata observed
- content not inspected
- content not copied
- private Android storage not covered by MTP

## 6. Application Artifact Semantics

A visible folder or object associated with an application is evidence only of
a shared-storage artifact.

Example:

WhatsApp Business folder present

means:

WHATSAPP_BUSINESS_SHARED_STORAGE_ARTIFACT = PRESENT

It MUST NOT be interpreted as:

- application currently installed
- application currently running
- user actively uses the application
- private application database inspected

Installed-package and runtime-process evidence belong to the Android/ADB
evidence plane.

## 7. Sanitization Boundary

WPD/MTP object deletion is NOT the CYVRA whole-device sanitization mechanism.

The WPD/MTP plane is used for:

- pre-sanitization exposure discovery
- Report 1 evidence
- data-risk classification
- post-sanitization comparison
- independent verification evidence

Supported platform/OEM sanitization remains a separately authorized workflow.

## 8. License Boundary

Automatic physical USB and WPD/MTP preflight does not consume a customer scan
entitlement.

A scan entitlement may only be committed when the operator/customer explicitly
starts Device Verification.

Final debit occurs only according to the existing transaction rules after the
verification report is successfully produced.

## 9. Evidence Coverage

The workstation must support partial evidence coverage.

Examples:

USB = AVAILABLE
MTP = AVAILABLE
ADB = UNAVAILABLE

shall produce a valid partial-evidence state rather than "no device".

Private application storage that is not visible through MTP must be reported as
not covered, not as clean or absent.

## 10. Post-Sanitization Verification

The WPD/MTP collector may compare pre- and post-sanitization metadata
inventories.

It may establish facts such as:

- prior visible object identifiers no longer observed
- prior visible paths no longer observed
- previous inventory digest no longer matches
- previous visible storage artifacts absent

WPD/MTP evidence alone MUST NOT certify complete media sanitization.

## 11. Native Ownership

Rust/Tauri owns Windows-native WPD/MTP access.

The native layer is responsible for:

- WPD device discovery
- WPD session lifecycle
- storage enumeration
- object enumeration
- property retrieval
- native errors
- safe resource ownership

The native layer does NOT decide business risk or sanitization assurance.

## 12. Domain Ownership

Kotlin Host/Core owns:

- evidence normalization
- risk-category classification
- application-artifact semantics
- evidence fusion
- coverage calculation
- report composition
- licensing interaction
- sanitization policy

React owns presentation only.

## 13. Cloud Boundary

Device enumeration and local evidence collection must not require:

- Cloudflare availability
- Neon availability
- Resend availability
- internet availability

Cloud synchronization, persistence, administration and messaging occur outside
the critical local hardware-evidence path.

## 14. Initial D2.3 Acceptance Requirements

D2.3 is not accepted until all of the following are demonstrated:

1. Real Windows WPD device discovery.
2. Real Samsung handset discovery.
3. Read-only storage enumeration.
4. Recursive metadata enumeration.
5. No customer content opened or copied.
6. Stable object/error handling.
7. Deterministic metadata summary.
8. MTP evidence remains independent from ADB.
9. Existing USB observer remains regression-free.
10. Evidence contract can be consumed by the Host/report layer.

## 15. Frozen Invariants

Notification is only a trigger. Enumeration is the truth.

Physical USB presence is not ADB authorization.

MTP accessibility is not complete Android filesystem accessibility.

Folder presence is not proof of application installation or execution.

File deletion is not certified whole-device sanitization.

Unavailable evidence must never be fabricated.
