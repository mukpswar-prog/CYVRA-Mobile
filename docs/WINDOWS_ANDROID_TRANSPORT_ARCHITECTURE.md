# Windows / Android Transport Architecture

**Status:** ACTIVE CONTRACT — P1.5A.3 CONSOLIDATED
**Date:** 2026-09-19
**Product:** CYVRA Mobile
**Immediate release host:** Windows 10 / Windows 11, 64-bit
**Architecture owner:** CYVRA Native Layer + CYVRA Domain Engine
**Supersedes:** the earlier ADB-first transport interpretation in this file
**Related contract:** [`architecture/d2-3-wpd-mtp-evidence-contract.md`](./architecture/d2-3-wpd-mtp-evidence-contract.md)

---

## 0. Purpose

This document defines the transport and physical-device observation architecture for the CYVRA Mobile Windows workstation.

It answers:

- how Windows physical-device presence is observed,
- how WPD/MTP and ADB relate to that physical presence,
- which layer owns each observation,
- how multiple connected devices are handled safely,
- how the desktop Native Layer communicates with the Kotlin Domain Engine,
- what evidence may be collected without ADB,
- which transport states are authoritative,
- which states must never be inferred from another transport,
- and what must be proven before a transport capability can be called release-ready.

This contract replaces the earlier assumption that ADB is the primary or defining Android connection truth.

---

# 1. Final transport decision

CYVRA Mobile uses three independent workstation-side device planes:

```text
WINDOWS_USB
WINDOWS_WPD_MTP
ANDROID_ADB
```

A fourth optional device-side plane may contribute evidence:

```text
ANDROID_COMPONENT
```

The permanent architecture is:

```text
Windows physical observation
        │
        ├── WINDOWS_USB
        │       Windows SetupAPI / PnP truth
        │
        ├── WINDOWS_WPD_MTP
        │       Windows Portable Devices / MTP truth
        │
        └── ANDROID_ADB
                Android Debug Bridge truth
                only when available and authorized
```

These planes are related, but **none may be substituted for another**.

---

# 2. Ownership by software layer

## 2.1 CYVRA Desktop UI — React / TypeScript

The Desktop UI owns:

- operator presentation,
- device-selection presentation,
- connection-state presentation,
- explicit operator action,
- limitation/error presentation.

The Desktop UI does **not** own physical-device truth.

It must never infer:

- USB presence from ADB,
- MTP capability from a model name,
- ADB authorization from USB presence,
- same-device identity from display order,
- sanitization authority from device visibility.

---

## 2.2 CYVRA Native Layer — Rust / Tauri

The Native Layer owns Windows-native physical observations:

- Windows USB/PnP discovery,
- device-arrival/removal notifications,
- authoritative present-device reconciliation,
- WPD/MTP COM runtime,
- WPD device-manager discovery,
- future WPD read-only device/storage/object metadata access,
- process lifecycle for the Kotlin Domain Engine,
- translation of native observations into stable IPC contracts.

The Native Layer must not silently convert native observations into Android/business conclusions.

Examples:

```text
USB PnP instance present
    !=
Android device authorized

WPD/MTP device visible
    !=
complete filesystem available

MTP folder name observed
    !=
application installed/running/used
```

---

## 2.3 CYVRA Domain Engine — Kotlin / JVM

The Domain Engine owns:

- ADB semantics,
- Android capability interpretation,
- device-session policy,
- evidence interpretation,
- entitlement workflow,
- report semantics,
- sanitization policy/orchestration,
- OEM capability policy,
- Android-component semantics.

The Domain Engine consumes Native Layer observations.

It must not redefine physical USB truth using ADB device lists.

---

## 2.4 Android Component

The Android APK is an optional supporting evidence source.

It does not own:

- physical USB truth,
- WPD truth,
- workstation selection truth,
- customer entitlement authority,
- sanitization authorization.

If unavailable because of Android version, permission, installation state, or policy, CYVRA must report that limitation without marking the whole device unsupported.

---

# 3. Windows USB plane

## 3.1 Authority

`WINDOWS_USB` is the workstation's physical USB/PnP observation plane.

The current Native Layer uses Windows SetupAPI present-device enumeration.

Authoritative physical state must come from an actual enumeration snapshot, not from notification alone.

Permanent rule:

> **Notification is a trigger. Enumeration is truth.**

---

## 3.2 Current implementation baseline

The established Native Layer includes:

```text
apps/desktop/src-tauri/src/usb/
```

with separate responsibilities for:

- model,
- notification registration,
- present-device enumeration,
- observation/reconciliation,
- observer runtime,
- Tauri lifetime ownership.

The present-device enumerator:

- obtains the current Windows device-information set,
- enumerates present device instances,
- resolves Windows PnP device-instance IDs,
- filters USB instances,
- sorts results deterministically,
- de-duplicates identity case-insensitively,
- distinguishes present / not-present / observation-unknown.

This is stronger than deriving `usbConnected` from ADB.

---

## 3.3 USB observation states

The Native Layer requires at least:

```text
USB_PRESENT
USB_NOT_PRESENT
USB_OBSERVATION_UNKNOWN
```

`USB_OBSERVATION_UNKNOWN` must remain distinct from `USB_NOT_PRESENT`.

A Windows API failure must never be presented as proof that no device is attached.

---

## 3.4 USB identity

A Windows PnP device-instance identity is useful for native correlation.

It is not automatically a customer-facing identifier.

Rules:

- keep raw PnP identity native/internal by default;
- do not expose raw instance identifiers to the UI merely because they are available;
- prefer an opaque, session-scoped device reference across IPC;
- redact or minimize raw identifiers in routine logs;
- retain raw identity only where required for local correlation/debugging/audit policy.

---

# 4. WPD / MTP plane

## 4.1 Purpose

`WINDOWS_WPD_MTP` is a first-class CYVRA evidence plane.

It enables useful workstation evidence even when:

- USB debugging is disabled,
- ADB is unavailable,
- ADB is unauthorized,
- the Android APK is not installed.

A valid basic verification path can therefore exist as:

```text
WINDOWS_USB
      +
WINDOWS_WPD_MTP
      ↓
basic workstation evidence
```

ADB is enrichment, not a prerequisite for every verification.

---

## 4.2 Current maturity

At the current D2.3 baseline:

- COM MTA runtime foundation exists;
- Windows Portable Device Manager creation exists;
- `RefreshDeviceList` is used;
- WPD `GetDevices` two-pass enumeration exists;
- device IDs are validated as non-empty UTF-16 strings;
- WPD-managed allocations are freed correctly;
- optional friendly/manufacturer/description metadata is handled honestly;
- a real Samsung handset has been enumerated through WPD/MTP;
- a production Tauri WPD command has been exercised;
- no customer storage content has been opened, copied, modified, or uploaded.

This proves **WPD device discovery**, not the complete WPD metadata scanner.

---

## 4.3 WPD discovery rules

WPD discovery must:

1. initialize COM in a compatible apartment;
2. construct `IPortableDeviceManager`;
3. refresh device state when appropriate;
4. use the documented two-pass device enumeration pattern;
5. validate counts and bound allocations;
6. safely convert UTF-16 identifiers;
7. free Windows-owned allocations using the required allocator;
8. sort/deduplicate deterministically;
9. treat optional metadata as optional;
10. return structured failure instead of fabricating an empty-success result.

---

## 4.4 Two-pass topology race

Between:

```text
GetDevices(null, &count)
```

and:

```text
GetDevices(buffer, &count)
```

the Windows device topology can change.

Therefore production discovery must implement a bounded retry policy for the documented count/enumeration race.

Requirements:

- bounded attempts;
- deterministic terminal error code;
- no infinite retry;
- no partial fabricated success;
- unplug/replug regression coverage.

This hardening remains pending after the current D2.3 discovery proof.

---

## 4.5 WPD read-only open policy

When device-open work begins, CYVRA must audit the exact `windows-rs` signatures in the version pinned by the repository before writing code.

Default access requirement:

```text
WPD_CLIENT_DESIRED_ACCESS = GENERIC_READ
```

unless a separately approved feature requires stronger authority.

No write access is permitted merely for convenience.

---

## 4.6 WPD metadata-first privacy boundary

Default WPD verification is metadata-first.

Permitted future read-only categories include:

- device metadata,
- storage metadata,
- storage/root hierarchy metadata,
- object names,
- object format/type,
- extension,
- size,
- timestamps,
- aggregate counts,
- risk indicators derived from metadata,
- deterministic summary/digest,
- errors and limitations.

Default WPD verification must not automatically:

- open customer file content streams,
- copy customer files,
- upload customer files,
- generate content previews,
- parse private media/messages/documents,
- extract private app databases,
- bypass Android storage/security controls.

A content-bearing operation requires a separate explicit product/privacy contract.

---

# 5. ADB plane

## 5.1 Role

`ANDROID_ADB` is optional advanced Android evidence.

ADB is valuable when the device and Android security state permit it.

ADB is not:

- physical USB truth,
- customer authorization,
- ownership proof,
- MTP proof,
- whole-device sanitization proof.

---

## 5.2 Controlled Platform-Tools

Production CYVRA must use a controlled and tested Platform-Tools distribution.

Rules:

- do not depend on an arbitrary `adb.exe` on the customer's `PATH`;
- a PATH copy may be used as a diagnostic/development fallback only;
- the exact production ADB version is selected and qualified during release;
- old documentation naming a fixed version is historical, not permanent architecture.

---

## 5.3 ADB states

The Domain Engine must preserve distinct states such as:

```text
ADB_UNAVAILABLE
ADB_UNAUTHORIZED
ADB_OFFLINE
ADB_READY
```

`ADB_UNAUTHORIZED` means:

> user authorization is required

It does not mean:

> device failed

CYVRA must never bypass the Android RSA authorization prompt.

---

## 5.4 ADB safety

Before a destructive feature is hardware-qualified, ADB should remain read-only/allowlisted for verification.

Prohibited as generic operator capability:

- arbitrary shell,
- technician-entered commands,
- lock/FRP bypass,
- root/exploit path,
- bootloader unlock,
- firmware flash to gain access,
- destructive command chosen merely because ADB is present.

Any command registry must be versioned, parameterized, allowlisted, session-bound, and auditable.

---

# 6. Android Component plane

The optional supporting component may supply Android-side evidence that Windows cannot legitimately obtain.

Transport/security requirements include:

- explicit component targeting;
- session binding;
- challenge/nonce;
- expiry;
- replay protection;
- response binding to the current processing session/device;
- no assumption that mere APK presence equals trust.

An exported receiver must be hardened rather than blindly disabled if host-to-device integration legitimately requires it.

---

# 7. Independent state model

The product must model independent transport dimensions rather than compress them into one `connected` boolean.

A normalized snapshot should conceptually contain:

```text
WindowsNativeDeviceSnapshot
  sessionDeviceRef
  usb
  wpd
  adb
  androidComponent
  observedAt
  limitations
```

Illustrative states:

```text
USB:
  PRESENT
  NOT_PRESENT
  UNKNOWN

WPD:
  AVAILABLE
  NOT_AVAILABLE
  OBSERVATION_UNKNOWN

ADB:
  UNAVAILABLE
  UNAUTHORIZED
  OFFLINE
  READY

ANDROID_COMPONENT:
  NOT_APPLICABLE
  UNAVAILABLE
  AVAILABLE
  RESTRICTED
```

The exact wire schema belongs to Protocol V2 and must be frozen separately.

---

# 8. Multi-device safety

## 8.1 Processing rule

CYVRA may process one selected device/session at a time.

This does **not** mean:

```text
devices.firstOrNull()
```

is an acceptable production selection policy.

---

## 8.2 Discovery rule

The workstation must safely detect all candidate physical devices.

If more than one plausible target exists:

- do not silently select the first;
- present the ambiguity;
- correlate available native/Android identities;
- require explicit selection where automatic correlation is insufficient;
- bind the selected target to the processing session.

---

## 8.3 SessionDeviceRef

The target architecture should use a session-scoped opaque reference such as:

```text
SessionDeviceRef
```

or equivalent.

It should correlate, where available:

- Windows PnP/USB identity,
- WPD device identity,
- ADB serial/transport identity,
- Android-component instance/session identity,
- operator-confirmed device card.

The reference must not require IMEI.

---

## 8.4 Reconnect

After disconnect/reboot:

- re-enumerate;
- re-correlate;
- do not auto-merge when identity confidence is insufficient;
- require operator confirmation if necessary.

This is mandatory before chargeable or destructive continuation.

---

# 9. Desktop ↔ Domain Engine boundary

The current Rust/Tauri desktop launches and communicates with the Kotlin Host/Domain Engine through a structured request/response protocol.

Protocol V1 currently exposes only a small fraction of the domain functionality.

The transport consolidation target is Protocol V2 or equivalent commands capable of evaluating a normalized native snapshot rather than asking Kotlin to infer Windows truth.

Candidate domain operations include:

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

These names are architectural candidates until the Protocol V2 schema is separately frozen.

Rules:

- Rust supplies native observation facts;
- Kotlin evaluates domain semantics;
- React consumes presentation-safe results;
- no layer should independently reconstruct another layer's truth.

---

# 10. Error semantics

Transport errors must be stable enough for:

- automated tests,
- Domain Engine policy,
- UI presentation,
- support diagnostics.

Errors should distinguish categories such as:

```text
USB_OBSERVATION_FAILED
WPD_COM_INITIALIZATION_FAILED
WPD_MANAGER_CREATE_FAILED
WPD_REFRESH_FAILED
WPD_ENUMERATION_FAILED
WPD_TOPOLOGY_CHANGED
WPD_INVALID_DEVICE_ID
ADB_UNAVAILABLE
ADB_UNAUTHORIZED
ADB_OFFLINE
DEVICE_SELECTION_AMBIGUOUS
DEVICE_CORRELATION_FAILED
HOST_PROTOCOL_ERROR
```

Exact code strings are frozen at implementation contract level.

Do not leak raw Windows error text directly as the only customer-facing semantics.

Preserve lower-level diagnostic context for logs/support where safe.

---

# 11. Evidence source vocabulary

Transport provenance must map into Evidence V2.

Required sources:

```text
WINDOWS_USB
WINDOWS_WPD_MTP
ANDROID_ADB
ANDROID_COMPONENT
OPERATOR
SYSTEM
```

Historical Evidence V1/S1/S2 records remain valid history.

New implementation must not shoehorn WPD evidence into an ADB source merely to fit the older schema.

---

# 12. Preflight and charge boundary

The following are passive/free operations:

- workstation preflight,
- Windows USB discovery,
- WPD/MTP discovery,
- basic device-card construction,
- licence-state display,
- capability estimation that does not perform a chargeable verification.

They must not consume a licensed device scan.

Chargeable flow begins only at an explicit Device Verification transaction boundary defined by the licence contract.

---

# 13. Sanitization boundary

Transport visibility never authorizes sanitization.

Examples:

```text
USB_PRESENT
    !=
SANITIZATION_AUTHORIZED

WPD_AVAILABLE
    !=
SANITIZATION_AUTHORIZED

ADB_READY
    !=
SANITIZATION_AUTHORIZED
```

Before a destructive method may execute:

1. target correlation must be valid;
2. entitlement/policy requirements must pass;
3. method capability must be qualified;
4. operator authorization must be explicit;
5. pre-operation identity/evidence must be persisted;
6. expected disconnect/reboot behavior must be known.

WPD post-state may contribute supplementary post-sanitization evidence, but WPD alone does not certify whole-device sanitization.

---

# 14. Logging and privacy

Logs are diagnostic evidence, not a license to expose device identifiers.

Rules:

- avoid customer file names/content in routine logs unless explicitly required by a metadata contract;
- prefer opaque/session refs at higher layers;
- do not log access tokens, licence secrets, OTPs, private file content, or customer credentials;
- raw PnP/WPD identifiers may be retained in lower-level diagnostic logs only according to the final privacy/support policy;
- production logging must support redaction and bounded retention.

---

# 15. Cloud independence

Local transport discovery does not require cloud connectivity.

The Native Layer must be able to:

- observe USB,
- enumerate WPD,
- evaluate ADB availability,
- maintain local session identity,

without Neon/Cloudflare being reachable.

Cloud services may be required later for:

- authenticated customer session,
- entitlement reservation/consumption,
- registry sync,
- admin policy,
- destructive-operation policy.

A cloud outage must not be misreported as physical device absence.

---

# 16. Windows baseline

Immediate release qualification targets:

```text
Windows 10 64-bit
Windows 11 64-bit
```

Windows Server support is deferred until separately qualified.

Emulator/CI success does not prove:

- Windows USB drivers,
- PnP enumeration,
- WPD/MTP behavior,
- physical ADB authorization,
- OEM USB behavior,
- reconnect behavior,
- sanitization verification.

---

# 17. Current implementation maturity

Use the repository maturity vocabulary.

| Capability | Current maturity |
|---|---|
| Kotlin ADB client/state/domain abstractions | `UNIT-TESTED` |
| Controlled ADB locator policy | `UNIT-TESTED` |
| Windows SetupAPI USB observation | `HARDWARE-VALIDATED` for current tested environment |
| USB runtime/notification/reconciliation | implemented; release validation pending |
| WPD COM + manager + device enumeration | `HARDWARE-VALIDATED` on current Samsung test handset |
| Production Tauri WPD discovery command | functionally/hardware exercised |
| WPD read-only device open | not yet implemented |
| WPD storage/root discovery | not yet implemented |
| WPD recursive metadata scanner | not yet implemented |
| Multi-device correlation | architecture required; not end-to-end implemented |
| Protocol V2 normalized snapshot | not yet frozen/implemented |
| Clean-machine Windows installer | not `RELEASE-VALIDATED` |

Do not convert these statements into broader OEM/version support claims.

---

# 18. Immediate D2.3 hardening sequence

Before expanding WPD into content hierarchy:

1. add bounded retry for two-pass `GetDevices` topology race;
2. freeze raw identifier IPC/privacy policy;
3. freeze deterministic WPD error codes;
4. add focused unit/error-path tests;
5. run Rust regression;
6. run real handset regression;
7. checkpoint the discovery layer;
8. audit exact WPD device-open bindings;
9. open read-only with `GENERIC_READ`;
10. discover storages/root objects;
11. implement metadata-only traversal;
12. prove no content stream was opened/copied.

No bulk architecture rewrite is required.

---

# 19. Hardware acceptance matrix for transport

At minimum, transport acceptance must cover:

```text
A. no handset attached
B. USB handset present, MTP unavailable
C. USB + MTP present, ADB unavailable
D. USB + MTP present, ADB unauthorized
E. USB + MTP present, ADB ready
F. ADB offline
G. unplug during observation
H. reconnect same device
I. topology change during WPD two-pass enumeration
J. multiple plausible devices attached
K. unsupported/unknown OEM generic path
L. WPD metadata scan proving no customer content stream was opened
```

For each row record:

- Windows version,
- device/OEM/model,
- Android version where relevant,
- observed transport states,
- expected result,
- actual result,
- maturity achieved,
- limitations.

---

# 20. Stop conditions

Stop and report instead of guessing if:

1. the exact Windows/windows-rs API signature is uncertain;
2. Windows returns ambiguous identity;
3. WPD topology changes beyond bounded retry;
4. a proposed WPD property would require content access;
5. multiple devices cannot be safely correlated;
6. an ADB command needs privilege outside the approved allowlist;
7. a driver/OEM issue is being mistaken for application logic;
8. the Domain Engine would have to infer physical USB truth from ADB;
9. a destructive continuation cannot prove it is acting on the selected target;
10. a hardware result contradicts the generic model.

---

# 21. Superseded statements from the earlier version of this document

The following older statements must no longer direct implementation:

### Superseded

> ADB is the primary Android communication transport.

Replacement:

> ADB is an optional advanced Android evidence transport. Windows USB and WPD/MTP are independent native evidence planes.

### Superseded

> `apps/host` is the Windows architectural authority.

Replacement:

> Rust/Tauri owns Windows-native truth. Kotlin `apps/host` is the Domain Engine for Android/business semantics.

### Superseded

> A3 is complete proof of Windows transport because host ADB tests pass.

Replacement:

> Transport maturity is capability-specific. Native USB and WPD require Windows/hardware proof independent of Kotlin ADB tests.

### Superseded

> USB/MTP only should be represented merely as an ADB-disabled state.

Replacement:

> USB and WPD/MTP have their own explicit observations; ADB state is separate.

---

# 22. Final transport principle

The permanent CYVRA Mobile transport principle is:

> **Observe Windows physical reality natively. Treat WPD/MTP as a first-class read-only evidence plane. Use ADB only when legitimately available and authorized. Keep transport states independent. Bind one explicitly selected physical device to one processing session. Never infer authority, identity, or sanitization success from connection alone.**

This is the active transport architecture for subsequent CYVRA Mobile implementation.
