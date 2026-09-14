# CYVRA MOBILE
## Final Android Multi-OEM + Windows USB/ADB Architecture, Compatibility and Sanitization Freeze Guide

**Repo status (14 Sep 2026):** ACCEPTED as Android-product engineering law.  
**Does not unfreeze:** public `www.cyvoriq.co.in`, live Worker/API, OTP, `API_ENV`, CYVRA Station (`apps/station`), Knox, or Erase.  
**Implementation map:** [ANDROID_COMPATIBILITY_FREEZE.md](./ANDROID_COMPATIBILITY_FREEZE.md)  
**Start here:** [resume-android-freeze.md](./resume-android-freeze.md)

**Document status:** APPROVED FOR IMPLEMENTATION  
**Purpose:** Cursor implementation + GitHub engineering baseline  
**Product:** CYVRA Mobile Evidence / Android Device Evidence & Sanitization  
**Primary operating model:** Windows laptop/desktop + USB-connected Android device  
**Architecture decision:** Windows-hosted, Android-platform-first, OEM-capability-aware  
**Sanitization reference:** NIST SP 800-88 Rev. 2  
**Freeze principle:** Build a reliable generic core first; add OEM-specific capabilities only when verified on real hardware.

---

# 1. FINAL DECISION

CYVRA Mobile shall **not** be designed as a Samsung-first Android application.

It shall be designed as a:

> **Windows-hosted Android device evidence and sanitization platform.**

The Windows application is the primary operational/orchestration layer.

Android is the device being serviced.

USB is the physical connection.

ADB is the primary Android communication/diagnostic transport where the device and security state permit it.

The Android application is a **device-side supporting component**, not the sole CYVRA scanning engine.

The architecture must support multiple Android manufacturers without allowing OEM-specific code to contaminate the generic platform core.

---

# 2. FINAL ARCHITECTURE

```text
                         CYVRA WINDOWS
                              |
                    +---------+---------+
                    |                   |
                  Tauri UI          Host Core
                                        |
              +-------------------------+-------------------------+
              |                         |                         |
          USB / ADB                Evidence Engine         Sanitization Engine
          Transport                     |                         |
              |                         |                         |
              +-------------------------+-------------------------+
                                        |
                                Capability Engine
                                        |
                    +-------------------+-------------------+
                    |                   |                   |
              Generic Android      OEM Adapters       Android Component
                 Provider          (verified only)      (optional)
                    |                   |                   |
                    +-------------------+-------------------+
                                        |
                                  Android Device
                                        |
                              +---------+---------+
                              |                   |
                            Android OS         Storage
```

The architectural authority is the Windows host.

The Android component exists when device-side Android APIs or workflows provide information/capabilities that cannot reliably be obtained from the Windows/ADB layer.

---

# 3. WHY THIS ARCHITECTURE IS FROZEN

Android's ADB model is explicitly designed around a computer-side client communicating with an Android device through the `adbd` service. This makes the computer-side model appropriate for CYVRA's Windows service workflow.

ADB can expose system information and diagnostics through mechanisms such as `adb shell` and Android system services. Therefore CYVRA should use the host computer as the primary orchestration point rather than forcing all evidence collection into an APK.

This also solves a critical sanitization problem:

```text
Windows Host
    |
Pre-sanitization evidence
    |
Authorization
    |
Sanitization
    |
Android reboot/reset
    |
Android application may disappear
    |
Windows reconnects to device
    |
Post-sanitization verification
    |
Final report
```

The host therefore survives a device reset.

---

# 4. FINAL BUILD TOOLCHAIN

Freeze the Android component at:

| Component | Frozen value |
|---|---|
| Kotlin / KGP | **2.3.21** |
| Android Gradle Plugin | **8.13.2** |
| Gradle Wrapper | **9.1.0** |
| JDK | **21** |
| compileSdk | **36** |
| targetSdk | **36** |
| Android component minSdk | **26 initially** |

Kotlin's official compatibility matrix lists Kotlin 2.3.20–2.3.21 as fully compatible with Gradle 7.6.3–9.3.0 and AGP 8.2.2–9.0.0. This makes Kotlin 2.3.21 compatible with the existing AGP 8.13.2 / Gradle 9.1.0 baseline.

The current Kotlin 2.2.10 + AGP 8.13.2 combination must not be retained because Kotlin 2.2.0–2.2.10 is officially supported with AGP only through 8.10.0.

Do **not** upgrade to AGP 9 as part of this migration.

AGP 9 introduces a different built-in Kotlin integration model. That is a separate migration and is unnecessary for the current CYVRA objective.

---

# 5. IMPORTANT DISTINCTION: minSdk IS NOT THE DEVICE-SERVICE FLOOR

`minSdk = 26` applies to the **CYVRA Android component**.

It must NOT automatically be interpreted as:

> CYVRA cannot service an Android 7 device.

The Windows host may be able to perform useful operations through USB/ADB even when the optional Android component cannot be installed.

Therefore CYVRA has two compatibility concepts:

## A. Android Component Compatibility

Which Android versions can run the CYVRA APK?

Initial baseline:

```text
Android 8.0 / API 26+
```

## B. CYVRA Device-Service Compatibility

Which Android devices can the Windows host successfully:

- detect
- connect
- identify
- inspect
- evidence
- assess
- sanitize
- verify

This must be established through the real-device compatibility matrix.

Do not infer one from the other.

---

# 6. ANDROID VERSION SUPPORT POLICY

The initial test target is:

```text
Android 8 / API 26
Android 9 / API 28
Android 10 / API 29
Android 11 / API 30
Android 12 / API 31
Android 12L / API 32
Android 13 / API 33
Android 14 / API 34
Android 15 / API 35
Android 16 / API 36
```

The project must not claim that every Android version/device is supported merely because the application compiles.

Compatibility is established through testing.

---

# 7. OEM SUPPORT POLICY

Primary OEM test families:

```text
Samsung
Xiaomi
Redmi
POCO
Motorola
OnePlus
OPPO
Realme
Vivo
Google Pixel
Nothing
Nokia/HMD
Other Android manufacturers
```

The generic Android provider must always remain available.

Unknown OEM:

```text
GenericAndroidProvider
```

must be selected instead of failing.

---

# 8. OEM ARCHITECTURE RULE

The core must never directly depend on:

```text
Samsung proprietary APIs
Knox APIs
MIUI APIs
Xiaomi proprietary APIs
Motorola proprietary APIs
OnePlus proprietary APIs
OPPO proprietary APIs
Realme proprietary APIs
Vivo proprietary APIs
```

unless the capability is deliberately introduced as an isolated adapter after verification.

Core interfaces should look conceptually like:

```kotlin
interface DeviceEvidenceProvider

interface DeviceCapabilityProvider

interface OemAdapter

interface SanitizationProvider

interface VerificationProvider
```

The exact package/module location must follow the existing repository architecture.

Do not create duplicate modules simply because this document shows conceptual names.

---

# 9. DO NOT CREATE EMPTY OEM CODE PREMATURELY

Do not create ten meaningless OEM implementations simply returning:

```text
UNSUPPORTED
```

Instead implement:

```text
GenericAndroidProvider
OemCapabilityResolver
```

first.

Create a real OEM adapter only when there is a verified OEM-specific capability or behavior that requires it.

This prevents architecture from becoming a collection of speculative OEM code.

---

# 10. WINDOWS HOST RESPONSIBILITIES

The Windows application is responsible for:

- application UI
- USB detection
- ADB discovery
- ADB lifecycle
- device authorization state
- device connection state
- device identity
- evidence orchestration
- capability assessment
- sanitization orchestration
- reboot/reconnect handling
- verification
- report generation
- audit trail
- server communication
- operator guidance

Production users must not need Android Studio to use CYVRA.

Production users must not need to install Gradle, Java or the Android SDK manually.

---

# 11. WINDOWS HOST BASELINE

Initial Windows target:

```text
Windows 10 64-bit
Windows 11 64-bit
```

The production installer should eventually bundle or control all required runtime components.

CYVRA should not depend on an arbitrary `adb.exe` found in the user's PATH.

---

# 12. ADB / PLATFORM-TOOLS POLICY

CYVRA should use a controlled, tested Android Platform-Tools distribution.

Do not assume the customer has Android Platform-Tools installed.

Do not depend on:

```text
PATH=some-user-installed-adb
```

unless explicitly supported as a diagnostic fallback.

The production product should use a known, versioned ADB binary tested by CYVRA.

Google's Platform-Tools distribution includes ADB and Fastboot and is intended for communication with Android devices.

---

# 13. USB IS NOT THE SAME AS ADB

The product must distinguish:

```text
USB_NOT_CONNECTED
USB_CONNECTED
ADB_UNAVAILABLE
ADB_UNAUTHORIZED
ADB_OFFLINE
ADB_READY
DEVICE_RECONNECTING
```

A Windows PC seeing a phone through USB/MTP does not automatically mean CYVRA has diagnostic access.

---

# 14. DEVICE CONNECTION STATE MACHINE

Recommended state flow:

```text
NO_DEVICE
    |
    v
USB_DETECTED
    |
    v
ADB_DETECTED
    |
    +----> ADB_UNAVAILABLE
    |
    v
ADB_UNAUTHORIZED
    |
    v
ADB_AUTHORIZED
    |
    v
ADB_READY
    |
    v
SCANNING
    |
    v
SCAN_COMPLETE
```

During operations:

```text
ADB_READY
    |
    v
OPERATION
    |
    +----> DEVICE_DISCONNECTED
    |
    v
DEVICE_RECONNECTING
    |
    v
ADB_READY
```

During sanitization:

```text
SANITIZATION_STARTED
    |
    v
DEVICE_REBOOT
    |
    v
DEVICE_RECONNECTING
    |
    v
POST_RESET_VERIFICATION
```

---

# 15. CUSTOMER CONNECTION DIAGNOSTIC

The Windows UI must clearly communicate:

```text
USB
ADB
AUTHORIZATION
DEVICE
ANDROID
CONNECTION
```

Example:

```text
CYVRA MOBILE EVIDENCE

USB CONNECTION
PASS — Device detected

ADB
PASS — ADB available

AUTHORIZATION
PASS — Computer authorized

DEVICE
Samsung Galaxy A52

ANDROID
Android 13 / API 33

CONNECTION
READY

[ START DEVICE SCAN ]
```

If unauthorized:

```text
USB CONNECTION
PASS

ADB
PASS

AUTHORIZATION
ACTION REQUIRED

Unlock the Android device and authorize this computer
when the Android security prompt appears.

[ RETRY ]
[ CONNECTION HELP ]
```

Never attempt to bypass Android security controls.

---

# 16. WINDOWS PREFLIGHT

Before scanning, perform:

```text
Windows version ........ PASS
64-bit architecture ... PASS
CYVRA runtime .......... PASS
ADB component .......... PASS
USB detection .......... PASS
Driver status .......... PASS / ATTENTION
Network ................ OPTIONAL
```

Then:

```text
READY TO SCAN
```

The exact driver-check mechanism must be determined during Windows implementation.

---

# 17. DEVICE EVIDENCE ARCHITECTURE

Evidence must be collected through independent collectors/providers.

Conceptual collectors:

```text
DeviceIdentityCollector
SoftwareCollector
HardwareCollector
StorageCollector
MemoryCollector
BatteryCollector
SecurityCollector
NetworkCollector
ApplicationCollector
CapabilityCollector
```

A failure in one collector must never crash the entire scan.

---

# 18. EVIDENCE RESULT MODEL

Use a structured result model.

Conceptually:

```kotlin
data class EvidenceResult<T>(
    val value: T?,
    val status: EvidenceStatus,
    val source: String,
    val reason: String?,
    val timestamp: Instant
)
```

Possible statuses:

```text
AVAILABLE
NOT_AVAILABLE
RESTRICTED
PERMISSION_REQUIRED
UNSUPPORTED_API
OEM_UNSUPPORTED
ERROR
```

The actual implementation must use the project's established serialization/time libraries and conventions.

---

# 19. SOURCE MUST BE RECORDED

Every important evidence field should identify its source.

Examples:

```text
ADB
ANDROID_PLATFORM
ANDROID_COMPONENT
OEM_ADAPTER
WINDOWS_USB
SERVER
```

Example:

```json
{
  "field": "batteryLevel",
  "value": 82,
  "source": "ANDROID_PLATFORM",
  "status": "AVAILABLE"
}
```

This improves auditability and debugging.

---

# 20. IDENTIFIER POLICY

Do not make IMEI the primary device identity.

Modern Android restricts access to persistent hardware identifiers such as IMEI and serial number for ordinary applications.

CYVRA must therefore use a hierarchy such as:

```text
Manufacturer
Brand
Model
Device
Product
Android version
API level
Build ID
Security patch
Android/platform identifier where permitted
CYVRA session UUID
```

Restricted identifiers:

```text
IMEI
Serial
other hardware identifiers
```

must be reported only when legitimately available.

Never fabricate an identifier.

Never substitute:

```text
Android ID -> IMEI
App UUID -> Serial
MAC address -> IMEI
```

---

# 21. IDENTIFIER STATUS

Each identifier should carry:

```text
identifierType
value
source
scope
availability
reason
```

Example:

```json
{
  "identifierType": "IMEI",
  "value": null,
  "source": "ANDROID_PLATFORM",
  "availability": "RESTRICTED",
  "reason": "Platform access restriction"
}
```

This is a valid evidence result.

---

# 22. STORAGE POLICY

Do not design the scanner around unrestricted Android filesystem access.

Modern Android uses scoped storage and other restrictions.

Do not assume CYVRA can access arbitrary:

```text
/data
/Android/data
/Android/obb
```

directories.

Use supported Android APIs and ADB capabilities where legitimately available.

Do not request broad storage privileges merely for convenience.

---

# 23. TEMPORARY EVIDENCE STORAGE

Temporary application-side evidence should use supported app-private storage.

The Windows host should maintain the authoritative service-session evidence.

Final exported reports must use supported Windows file/output mechanisms.

---

# 24. PERMISSION POLICY

Permissions must be:

- minimal
- justified
- requested only when needed
- version-aware
- gracefully handled

If a permission is denied:

```text
DO NOT CRASH
DO NOT FABRICATE
DO NOT SILENTLY OMIT
```

Return:

```text
PERMISSION_REQUIRED
```

with an explanation.

---

# 25. API VERSION GUARDS

Every API introduced after the minimum supported Android API must be guarded appropriately.

Conceptually:

```kotlin
if (Build.VERSION.SDK_INT >= REQUIRED_API) {
    ...
} else {
    ...
}
```

Do not call newer APIs unconditionally on old Android versions.

---

# 26. NETWORK / WI-FI / BLUETOOTH

If CYVRA later collects Wi-Fi or Bluetooth information, use Android-version-specific permission and API handling.

Do not implement one universal permission path for every Android version.

Android 12+ introduced significant Bluetooth permission changes, and Android 13 introduced the `NEARBY_WIFI_DEVICES` permission for relevant Wi-Fi operations.

These capabilities must be isolated from the core evidence engine.

---

# 27. SANITIZATION ARCHITECTURE

Sanitization must be completely separate from scanning.

The lifecycle is:

```text
DEVICE CONNECT
      |
      v
PRE-SANITIZATION SCAN
      |
      v
CAPABILITY ASSESSMENT
      |
      v
USER / SERVER AUTHORIZATION
      |
      v
SANITIZATION METHOD SELECTION
      |
      v
SANITIZATION EXECUTION
      |
      v
REBOOT / RESET
      |
      v
DEVICE RECONNECTION
      |
      v
POST-SANITIZATION VERIFICATION
      |
      v
FINAL REPORT
```

---

# 28. SANITIZATION PROVIDER

Conceptual interface:

```kotlin
interface SanitizationProvider {
    fun assessCapability(): SanitizationCapability
    fun requestAuthorization(): AuthorizationRequirement
    fun execute(): SanitizationResult
    fun verify(): VerificationResult
}
```

Destructive APIs must never be called directly from the UI.

---

# 29. SANITIZATION CAPABILITY

Each device must first be assessed.

Possible capability statuses:

```text
SUPPORTED
PARTIAL
UNSUPPORTED
REQUIRES_PERMISSION
REQUIRES_DEVICE_OWNER
REQUIRES_OEM_SERVICE
UNKNOWN
```

Example:

```text
SANITIZATION CAPABILITY

Factory Reset
SUPPORTED

Device Owner Wipe
NOT AVAILABLE

OEM Secure Erase
NOT EXPOSED

Cryptographic Erase
NOT DIRECTLY AVAILABLE

Recommended Action
PLATFORM FACTORY RESET

Verification
REQUIRED
```

---

# 30. FACTORY RESET IS NOT A UNIVERSAL "SECURE ERASE" LABEL

CYVRA must not report:

```text
SECURE ERASE COMPLETE
```

merely because a factory reset command succeeded.

The report must identify:

```text
sanitization method
authority
execution status
verification status
limitations
assurance/claim level
```

The wording must be based on what was actually achieved and verified.

---

# 31. NIST SANITIZATION REFERENCE

Use:

**NIST SP 800-88 Rev. 2 — Guidelines for Media Sanitization**

NIST published Rev. 2 as the current revision in September 2025, superseding Rev. 1.

Rev. 2 shifts emphasis toward an organizational sanitization program, appropriate methods, validation and assurance, and aligns techniques with current standards and practice.

CYVRA documentation should therefore avoid simplistic claims such as:

```text
"One overwrite = secure erase"
```

or:

```text
"Factory reset = NIST purge"
```

unless the specific method and assurance are actually justified.

---

# 32. DEVICE OWNER / MANAGED DEVICE

Android DevicePolicyManager provides management capabilities for device/profile owners, including device wipe functionality.

These are not ordinary application privileges.

Therefore CYVRA must explicitly distinguish:

```text
Standard Android device
Device Owner
Profile Owner
Managed enterprise device
```

Do not assume device-owner capabilities on ordinary customer devices.

Enterprise/managed-device mode should be treated as a separate future capability unless already approved in the project scope.

---

# 33. FLASH STORAGE / CRYPTOGRAPHIC ERASE

Do not implement a naive file overwrite strategy and call it secure sanitization.

Modern phones use flash storage, wear leveling, encryption and vendor storage implementations.

Where cryptographic erase or another higher-assurance method is claimed, the actual platform/OEM/storage conditions must support the claim and the verification evidence must be retained.

---

# 34. PRE-SANITIZATION EVIDENCE

Before any destructive operation, create an immutable service record containing at least:

```text
session ID
timestamp
manufacturer
brand
model
device
Android version
API level
security patch
storage information
battery information
management state
available identifiers
capability assessment
selected sanitization method
operator/session identity
authorization state
application/software versions
```

This becomes the authoritative pre-sanitization evidence set.

---

# 35. POST-SANITIZATION VERIFICATION

The Windows host must survive the Android reset.

Verification should include whatever is appropriate and technically defensible, for example:

```text
device re-detection
post-reset state
Android setup state
expected user-data state
selected platform/OEM confirmation
sanitization execution record
```

Do not claim that a simple reconnection proves every physical storage cell is inaccessible.

Use precise verification language.

---

# 36. VERIFICATION STATES

Use explicit states such as:

```text
VERIFIED
PARTIALLY_VERIFIED
PLATFORM_REPORTED_COMPLETE
REQUIRES_EXTERNAL_VERIFICATION
FAILED
UNKNOWN
```

Do not use only:

```text
PASS / FAIL
```

for sanitization.

---

# 37. NO FABRICATED DATA RULE

This is mandatory.

If unavailable:

```text
value = null
status = unavailable/restricted
reason = documented
```

Never generate placeholder hardware identifiers.

Never invent:

```text
000000000000000
UNKNOWN123
```

as if they were device values.

---

# 38. DISCONNECTION HANDLING

A USB device may disconnect during:

- scanning
- reboot
- factory reset
- driver reset
- cable movement

CYVRA must not crash.

It should record:

```text
DEVICE_DISCONNECTED
```

and attempt a controlled reconnect where safe.

For destructive operations, the operation state must be persisted before the device disappears.

---

# 39. REBOOT / RESET HANDLING

The Windows host must persist:

```text
operation ID
device identity evidence
sanitization method
start timestamp
authorization
expected reboot
```

before initiating a destructive operation.

After reconnect:

```text
operation ID
device re-identification
post-reset state
verification
```

must be associated with the same service session.

---

# 40. G5 REVISED DEFINITION

G5 should no longer be interpreted as "Samsung APK only."

Recommended G5 stages:

### G5-A — Windows transport

```text
Windows
+
USB
+
ADB
+
Samsung
```

### G5-B — Generic evidence

```text
Windows
+
ADB
+
generic Android evidence
```

### G5-C — Additional OEM

```text
Windows
+
ADB
+
non-Samsung Android
```

### G5-D — Legacy/current validation

```text
older Android
+
current Android
```

Sanitization execution remains non-destructive until the transport/evidence architecture has passed its validation gates.

---

# 41. TEST MATRIX

Minimum Android OS validation:

```text
Android 8
Android 9
Android 10
Android 11
Android 12
Android 12L
Android 13
Android 14
Android 15
Android 16
```

Minimum OEM validation:

```text
Samsung
Xiaomi/Redmi/POCO
Motorola
OnePlus
OPPO/Realme
Vivo
Google Pixel
Nothing
Other/unknown OEM
```

Windows validation:

```text
Windows 10 64-bit
Windows 11 64-bit
```

---

# 42. COMPATIBILITY LEVELS

Do not use one binary "compatible" flag.

Use capability levels:

```text
A — Launch / Connect
B — Generic Evidence
C — Extended Evidence
D — Sanitization Capability Assessment
E — Sanitization Execution
F — Verification
```

A device can be:

```text
A PASS
B PASS
C PARTIAL
D PASS
E UNSUPPORTED
F NOT_APPLICABLE
```

This is more truthful than:

```text
DEVICE = FAILED
```

---

# 43. EMULATOR POLICY

Emulators are useful for:

- UI
- lifecycle
- permission handling
- API behavior
- storage behavior
- report generation
- failure handling

Emulators cannot replace physical-device testing for:

- OEM firmware
- physical storage
- USB drivers
- real ADB behavior
- hardware identifiers
- OEM-specific behavior
- factory-reset behavior
- sanitization verification

Therefore:

```text
Laptop/emulator = development
Physical device = compatibility validation
```

---

# 44. FIRST PHYSICAL DEVICE LAB

Initial representative device set:

```text
1 Samsung
1 Xiaomi/Redmi/POCO
1 Motorola
1 OnePlus
1 OPPO/Realme/Vivo
1 Google Pixel
```

Across multiple Android generations.

Do not attempt to claim universal OEM support after testing one Samsung phone.

---

# 45. CURSOR EXECUTION ORDER — FINAL

Cursor must execute exactly in this broad order.

## A0 — Architecture confirmation

Before modifying code:

Confirm:

```text
Windows = primary host/orchestrator
Android = target device
USB = physical transport
ADB = primary Android communication mechanism
Android APK = supporting device-side component
```

No code changes in A0.

---

## A1 — Toolchain only

Change:

```text
Kotlin 2.2.10
→ Kotlin 2.3.21
```

Keep:

```text
AGP 8.13.2
Gradle 9.1.0
JDK 21
```

Do not change minSdk in this commit.

Run:

```bash
./gradlew --stop
./gradlew --version
./gradlew :core:test
```

Then:

```bash
./gradlew :app:assembleDebug
```

if the Android SDK is available.

---

## A2 — Android SDK baseline

Set/verify:

```text
compileSdk = 36
targetSdk = 36
minSdk = 26
```

Document explicitly:

> minSdk 26 is the initial CYVRA Android-component floor, not the Windows-host device-service floor.

Run:

```bash
./gradlew :core:test
./gradlew :app:assembleDebug
./gradlew lint
```

---

## A3 — Windows USB/ADB transport

Implement:

```text
USB detection
ADB discovery
ADB version
device listing
authorization state
offline state
disconnect
reconnect
timeouts
connection health
```

No sanitization execution.

---

## A4 — Generic evidence engine

Implement the platform-independent evidence interfaces.

Evidence must work without requiring an OEM-specific implementation.

---

## A5 — Capability engine

Determine:

```text
what this device supports
what it does not support
what requires permission
what requires device owner
what requires OEM support
```

---

## A6 — Android component integration

Use the Android APK only where Android-side APIs or workflows add required information/capability.

Record evidence source.

---

## A7 — OEM adapters

Implement only verified OEM-specific functionality.

Start with the first physical device(s).

Do not create speculative OEM APIs.

---

## A8 — Sanitization architecture

Implement:

```text
assess
authorize
select
execute
reboot
reconnect
verify
report
```

G5 remains non-destructive until transport/evidence validation is complete.

---

## A9 — Report engine

Generate:

```text
Pre-sanitization evidence
Capability assessment
Sanitization record
Verification record
Limitations
Final report
```

---

## A10 — Test matrix

Validate:

```text
Windows 10
Windows 11

Android 8–16

Samsung
Xiaomi/Redmi/POCO
Motorola
OnePlus
OPPO/Realme
Vivo
Pixel
Nothing
Unknown OEM
```

---

## A11 — Documentation

Create/update:

```text
docs/ANDROID_COMPATIBILITY_FREEZE.md
docs/WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md
docs/DEVICE_EVIDENCE_ARCHITECTURE.md
docs/SANITIZATION_ARCHITECTURE.md
docs/OEM_ADAPTER_ARCHITECTURE.md
docs/TEST_MATRIX.md
```

Follow existing repository naming conventions if equivalent documents already exist.

---

## A12 — Verification

Run the complete approved test set.

Do not declare completion based only on APK compilation.

---

## A13 — GitHub freeze

Use controlled commits.

Recommended logical commits:

```text
build: align Kotlin with AGP 8.13.2

build: establish Android SDK compatibility baseline

feat: establish Windows Android transport architecture

feat: establish generic device evidence architecture

feat: establish capability and sanitization abstractions

test: add compatibility coverage

docs: freeze Android compatibility and transport architecture
```

The exact commit sequence may be combined where repository history or review policy requires it, but changes must remain logically reviewable.

---

# 46. BRANCH POLICY

Before changes:

```bash
git status
git branch --show-current
```

Working tree must be clean.

Preferred branch:

```text
feature/android-multioem-compatibility
```

or another approved feature branch.

Do not modify `main` directly.

Do not commit:

```text
.idea/
local.properties
.gradle/
build/
secrets
API keys
certificates/private keys
```

---

# 47. GITHUB FREEZE DOCUMENT

Create:

```text
docs/ANDROID_COMPATIBILITY_FREEZE.md
```

It must record:

```text
Freeze date
Kotlin
AGP
Gradle
JDK
compileSdk
targetSdk
Android component minSdk
Windows host versions
USB architecture
ADB architecture
Android component role
OEM architecture
Identifier policy
Storage policy
Permission policy
Sanitization policy
Verification policy
Known limitations
Test matrix
```

Also create/update:

```text
docs/WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md
```

This is mandatory because USB/ADB is now a core product architecture concern.

---

# 48. README PRODUCT POSITIONING

The README must not state:

```text
Works on all Android devices
```

Use wording equivalent to:

> CYVRA Mobile is a Windows-hosted Android device evidence and sanitization platform designed around Android platform capabilities, controlled USB/ADB communication and OEM-specific capability adapters. Actual device capabilities vary by Android version, OEM firmware, permissions, management state and exposed platform interfaces.

---

# 49. STOP CONDITIONS

Cursor must stop and report rather than guess if:

1. Kotlin/AGP compatibility fails.
2. A dependency forces a higher minSdk.
3. A required API is unavailable on an intended Android version.
4. A device cannot be identified reliably.
5. A USB/ADB issue appears to be a Windows driver problem.
6. An OEM-specific API requires privileged access.
7. A sanitization capability requires Device Owner.
8. A destructive operation cannot be safely verified.
9. A change would modify frozen website/API infrastructure.
10. A change would affect Station/Knox scope without approval.
11. A proposed implementation would bypass Android security controls.
12. A field cannot be obtained legitimately.
13. A sanitization claim cannot be supported by evidence.
14. A physical-device result contradicts the assumed generic behavior.

---

# 50. SECURITY BOUNDARY

CYVRA must never attempt to bypass:

```text
screen lock
ADB authorization
FRP
bootloader security
OEM security controls
device-owner requirements
Android permission controls
```

These are security boundaries.

If CYVRA cannot legitimately obtain a capability, report the limitation.

---

# 51. NO FALSE SUCCESS

CYVRA's core quality principle is:

> **Accurate limitation is better than false success.**

Examples:

```text
IMEI unavailable
```

is valid.

```text
OEM secure erase unavailable
```

is valid.

```text
Factory reset completed; post-reset verification required
```

is valid.

```text
Device disconnected during operation
```

is valid.

False evidence is unacceptable.

---

# 52. FINAL ACCEPTANCE CHECKLIST

## Build

```text
[ ] Kotlin 2.3.21
[ ] AGP 8.13.2
[ ] Gradle 9.1.0
[ ] JDK 21
[ ] compileSdk 36
[ ] targetSdk 36
[ ] Android component minSdk 26
[ ] No BaseVariant error
[ ] :core:test passes
[ ] :app:assembleDebug passes
[ ] lint passes or exceptions documented
```

## Windows host

```text
[ ] Windows 10 test
[ ] Windows 11 test
[ ] CYVRA-managed ADB
[ ] USB detection
[ ] ADB detection
[ ] authorization handling
[ ] offline handling
[ ] disconnect handling
[ ] reconnect handling
```

## Android

```text
[ ] Android 8
[ ] Android 9
[ ] Android 10
[ ] Android 11
[ ] Android 12
[ ] Android 12L
[ ] Android 13
[ ] Android 14
[ ] Android 15
[ ] Android 16
```

## OEM

```text
[ ] Samsung
[ ] Xiaomi/Redmi/POCO
[ ] Motorola
[ ] OnePlus
[ ] OPPO/Realme
[ ] Vivo
[ ] Pixel
[ ] Nothing
[ ] Unknown OEM
```

## Evidence

```text
[ ] Generic evidence provider
[ ] identifier restrictions
[ ] permission handling
[ ] storage restrictions
[ ] version guards
[ ] no fabricated values
[ ] source recorded
[ ] failures isolated
```

## Sanitization

```text
[ ] capability assessment
[ ] authorization
[ ] method selection
[ ] non-destructive validation
[ ] destructive workflow isolated
[ ] reboot handling
[ ] reconnect handling
[ ] post-reset verification
[ ] limitation reporting
[ ] NIST SP 800-88 Rev. 2 terminology reviewed
```

## GitHub

```text
[ ] feature branch
[ ] controlled commits
[ ] no secrets
[ ] no local IDE files
[ ] documentation updated
[ ] freeze document committed
[ ] CI/build verification completed
[ ] PR reviewed
[ ] only then merge to main
```

---

# 53. FINAL FREEZING POINT

Once the following are approved and verified, freeze the architecture:

```text
WINDOWS HOST
        +
USB/ADB TRANSPORT
        +
GENERIC ANDROID EVIDENCE
        +
CAPABILITY ENGINE
        +
OEM ADAPTER BOUNDARY
        +
ANDROID DEVICE COMPONENT
        +
SANITIZATION ABSTRACTION
        +
POST-RESET VERIFICATION
        +
REPORT SCHEMA
```

At that point, the **architecture is frozen**.

OEM-specific implementations may continue to grow behind the interfaces.

Android-version-specific improvements may continue behind the compatibility layer.

But the core architecture must not be repeatedly redesigned for every new phone.

---

# 54. FINAL PRODUCT PRINCIPLE

The permanent CYVRA engineering rule is:

> **One Windows CYVRA application. One generic Android platform core. Controlled USB/ADB transport. Optional Android device-side capabilities. OEM-specific extensions only behind capability interfaces. No fabricated evidence. No universal sanitization claims. Every destructive operation must be authorized, recorded and followed by an appropriate verification process.**

This is the final architectural baseline for the next implementation phase.

---

# 55. RESEARCH BASIS / OFFICIAL REFERENCES

1. **Kotlin Gradle compatibility**
   - Kotlin official Gradle compatibility matrix confirms KGP 2.3.20–2.3.21 supports Gradle 7.6.3–9.3.0 and AGP 8.2.2–9.0.0.
   - Kotlin 2.2.0–2.2.10 only supports AGP through 8.10.0.
   - Source: Kotlin Documentation, "Configure a Gradle project".

2. **Android device communication**
   - Android's official ADB documentation establishes the computer-side ADB client/server model and USB debugging/authorization workflow.
   - Source: Android Developers, "Android Debug Bridge (adb)".

3. **Android diagnostics**
   - Android's `dumpsys` documentation establishes command-line access to Android system-service diagnostic information through ADB.
   - Source: Android Developers, "dumpsys".

4. **Platform Tools**
   - Android Platform-Tools provides ADB/Fastboot and is the appropriate foundation for controlled Windows-side Android communication.
   - Source: Android Developers, "SDK Platform Tools release notes".

5. **Managed-device capabilities**
   - Android DevicePolicyManager and Android Enterprise documentation establish that device-owner/profile-owner capabilities are privileged management capabilities and include device wipe functionality.
   - Source: Android Developers, DevicePolicyManager / Device administration overview.

6. **Sanitization**
   - NIST SP 800-88 Rev. 2 is the current NIST media-sanitization publication, published September 26, 2025, superseding Rev. 1.
   - Source: NIST CSRC, "Guidelines for Media Sanitization, Rev. 2".

---

# 56. FREEZE STATUS

**Recommended status: APPROVED FOR IMPLEMENTATION — ARCHITECTURE FROZEN AFTER A0 CONFIRMATION**

Do not call the product "production compatible with all Android devices" at this stage.

The next objective is:

```text
A0 CONFIRMATION
      ↓
A1 TOOLCHAIN
      ↓
A2 ANDROID BASELINE
      ↓
A3 WINDOWS USB/ADB
      ↓
A4 GENERIC EVIDENCE
      ↓
PHYSICAL DEVICE VALIDATION
```

Only after those gates pass should sanitization execution become the next engineering gate.

