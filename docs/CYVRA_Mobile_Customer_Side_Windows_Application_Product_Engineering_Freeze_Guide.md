# CYVRA MOBILE
# Customer-Side Windows Application — Product, UX, Licensing, Update/Upgrade and Engineering Freeze Guide

**Document status:** FINAL CUSTOMER-SIDE ENGINEERING DESIGN / IMPLEMENTATION BASELINE  
**Product:** CYVRA Mobile — Android Device Diagnostics & Data Purge  
**Host:** Windows 10/11 laptop or desktop  
**Primary connection:** USB + controlled Android Platform-Tools / ADB  
**Primary operating model:** One Windows CYVRA application servicing Android devices one at a time  
**Relationship to architecture freeze:** This document extends the frozen Windows-hosted Android evidence/sanitization architecture; it does not replace it.

---

## 1. EXECUTIVE DECISION

CYVRA Mobile should be delivered to customers as a **professional Windows desktop application**.

The customer journey is:

```text
CYVRA Website
      |
      v
Purchase / entitlement
      |
      v
Protected application download
      |
      v
Windows installation
      |
      v
Customer signs in / activates license
      |
      v
CYVRA Mobile desktop application
      |
      v
Windows preflight
      |
      v
Connect ONE Android device by USB
      |
      v
Connection / authorization check
      |
      v
Advanced Diagnostic
      |
      v
Diagnostic result + evidence
      |
      +--------------------+
      |                    |
      v                    v
Next device          Data Purge
                           |
                           v
                 Capability assessment
                           |
                           v
                    Authorization
                           |
                           v
                      Purge/Reset
                           |
                           v
                  Reconnect / Verify
                           |
                           v
                      Final report
```

The customer should **not need Android Studio, Gradle, Java, Android SDK or command-line knowledge** to operate the production application.

The frozen architecture already establishes the Windows host as the operational authority, USB as the physical connection, ADB as the primary Android communication mechanism where permitted, and the Android APK as an optional supporting component. fileciteturn5file0L16-L32

---

# 2. IMPORTANT PRODUCT TERMINOLOGY DECISION

## 2.1 Do not mix "users" and "device scans"

The commercial product must distinguish:

### A. Device Scan Entitlement

How many Android devices the purchased license permits the customer to process.

Examples:

```text
3 devices
5 devices
7 devices
25 devices
```

### B. Operator/User Seats

How many people may use the CYVRA desktop application.

These are different commercial dimensions.

For the first customer release, if the business model is only based on device quantity, use:

> **Licensed Device Scans**

and do not call those scans "users."

If multi-operator licensing is introduced later, add:

> **Operator Seats**

as a separate entitlement.

### Recommended first-release model

```text
License
 ├── License ID
 ├── License Serial
 ├── Customer
 ├── Plan
 ├── Device Scan Entitlement
 ├── Scans Used
 ├── Scans Remaining
 ├── Valid From
 ├── Valid Until
 ├── Status
 └── Entitlement Revision
```

---

# 3. LICENSE UPGRADE MODEL

The customer's requested model is valid, but it should be implemented as an **entitlement revision**, not as a destructive replacement of the underlying license record.

Example:

```text
Original:
CYVRA-XXXX-001
Plan: 3 Device Scans
Used: 2
Remaining: 1
```

Customer upgrades:

```text
3 → 25 Device Scans
```

Server creates:

```text
Entitlement Revision 2
Plan: 25 Device Scans
```

The UI may display a new license serial if that is required commercially:

```text
Previous Serial:
CYVRA-XXXX-001
Status:
SUPERSEDED

Current Serial:
CYVRA-XXXX-002
Status:
ACTIVE
```

### Engineering recommendation

Keep an immutable internal:

```text
license_id
```

and maintain:

```text
license_revision
```

or an equivalent entitlement-version record.

Do **not** make the visible serial number the only database identity.

This gives CYVRA:

- complete upgrade history
- auditability
- rollback/reconciliation
- payment reconciliation
- support traceability
- protection against duplicate activation
- clean license replacement

---

# 4. CUSTOMER APPLICATION — VISUAL DIRECTION

The provided CYVRA Erase application is a good visual reference.

Reuse its strong visual language:

- dark navy left navigation
- CYVRA branding
- clear section hierarchy
- large task cards
- status indicators
- prominent action buttons
- restrained professional color use
- assessment/operation status at the top
- footer/status bar

However, CYVRA Mobile should become a **more information-dense professional service workstation** because technicians will repeatedly connect devices.

The frozen architecture describes the customer-facing Windows application as responsible for UI, USB detection, ADB lifecycle, identity, evidence orchestration, capability assessment, sanitization orchestration, reconnect handling, verification and reporting. fileciteturn5file0L287-L308

---

# 5. PROPOSED MAIN WINDOW

## Header

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ CYVRA MOBILE                         Customer: ABC Technologies    ● ACTIVE │
│ Android Diagnostics & Data Purge     License: 25 Device Scans              │
│                                      Scans: 8 / 25        [UPDATE] [UPGRADE]│
├───────────────┬────────────────────────────────────────────────────────────┤
│               │                                                            │
│ OVERVIEW      │                                                            │
│               │                                                            │
│ ADVANCED      │                    MAIN WORKSPACE                          │
│ DIAGNOSTIC    │                                                            │
│               │                                                            │
│ DATA PURGE    │                                                            │
│               │                                                            │
│ RESULTS &     │                                                            │
│ REPORTS       │                                                            │
│               │                                                            │
│ LICENSE &     │                                                            │
│ USAGE         │                                                            │
│               │                                                            │
│ HELP          │                                                            │
│               │                                                            │
│ SETTINGS      │                                                            │
│               │                                                            │
│ ───────────   │                                                            │
│ SCANS         │                                                            │
│ 8 / 25 USED   │                                                            │
│ 17 REMAINING  │                                                            │
│               │                                                            │
└───────────────┴────────────────────────────────────────────────────────────┘
```

---

# 6. HEADER — CUSTOMER IDENTITY

The top-right area should permanently show:

```text
Customer:
ABC Technologies Pvt Ltd

License:
CYVRA-MOB-XXXX-XXXX

Plan:
25 Device Scans

Usage:
8 / 25

Status:
ACTIVE
```

If the customer is an individual:

```text
Customer:
Ramesh Kumar

License:
CYVRA-MOB-XXXX-XXXX

Plan:
3 Device Scans
```

Do not display sensitive payment information.

Do not display the full internal entitlement token.

---

# 7. UPDATE AND UPGRADE BUTTONS

These are separate functions and must remain visually distinct.

## UPDATE

Purpose:

> Update the installed CYVRA Mobile software to the latest approved version.

Examples:

- bug fixes
- security fixes
- Android compatibility improvements
- new device support
- ADB/Platform-Tools improvements
- report improvements
- UI improvements
- diagnostic capability updates

Button:

```text
[ UPDATE ]
```

If already current:

```text
✓ CYVRA Mobile is up to date
Version 3.2.1
```

If an update exists:

```text
NEW VERSION AVAILABLE

CYVRA Mobile 3.3.0

Security improvements
New Android device compatibility
Diagnostic improvements

[ VIEW DETAILS ]
[ INSTALL UPDATE ]
```

---

# 8. UPDATE ENGINEERING REQUIREMENTS

The production update system must:

1. Check the current installed version.
2. Contact the CYVRA update service over HTTPS.
3. Authenticate the update metadata.
4. Verify package signature/integrity.
5. Download only the approved release.
6. Stage the update.
7. Close/restart the application safely.
8. Install the update.
9. Verify successful startup.
10. Roll back or provide recovery if installation fails.

Tauri's updater requires signed update artifacts and uses a public key in the application to validate updates; the private signing key must remain protected. citeturn0search11

### CYVRA rule

Never implement:

```text
download EXE
→ execute EXE
```

without cryptographic verification.

---

# 9. UPDATE CHANNELS

Support:

```text
STABLE
BETA
INTERNAL
```

Customer production installations should default to:

```text
STABLE
```

The customer may be offered an optional beta channel only if CYVRA explicitly enables it.

---

# 10. UPDATE COMPATIBILITY

The update service should return:

```json
{
  "currentVersion": "3.2.1",
  "latestVersion": "3.3.0",
  "minimumSupportedVersion": "3.0.0",
  "mandatory": false,
  "releaseChannel": "stable",
  "releaseNotesUrl": "...",
  "artifact": "...",
  "signature": "...",
  "sha256": "..."
}
```

The actual API contract should use the project's server conventions.

---

# 11. UPGRADE BUTTON

The second button is:

```text
[ UPGRADE ]
```

Purpose:

> Increase the customer's licensed device-processing entitlement.

Example:

```text
CURRENT PLAN

3 Device Scans
Used: 2
Remaining: 1

Upgrade to:

○ 5 Device Scans
○ 7 Device Scans
○ 25 Device Scans

[ CONTINUE TO UPGRADE ]
```

Clicking the button should open the official CYVRA website in the system browser or an approved authenticated web flow.

The desktop application should **not embed or reproduce the payment system** unless there is a specific product requirement to do so.

---

# 12. UPGRADE FLOW

Recommended:

```text
Customer clicks UPGRADE
        |
        v
CYVRA website
        |
        v
Customer authentication
        |
        v
Current entitlement displayed
        |
        v
Choose new entitlement
        |
        v
Payment
        |
        v
Server confirms payment
        |
        v
New entitlement revision issued
        |
        v
Current license becomes superseded
        |
        v
Application refreshes entitlement
        |
        v
New allowance appears
```

Example:

```text
Before:

3 Device Scans
Used 3
Remaining 0

After upgrade:

25 Device Scans
Used 3
Remaining 22
```

Do not reset usage to zero after an upgrade.

---

# 13. LICENSE SYNCHRONIZATION

The desktop application should periodically refresh entitlement state.

At minimum:

- application launch
- user manually clicks refresh
- before beginning a billable device operation
- after an upgrade
- after authentication recovery
- after a successful update

Suggested button:

```text
[ Refresh License ]
```

---

# 14. OFFLINE BEHAVIOR

This must be designed explicitly.

The application should distinguish:

```text
LICENSE_ACTIVE
LICENSE_EXPIRED
LICENSE_REVOKED
LICENSE_SUPERSEDED
LICENSE_UNKNOWN
LICENSE_SERVER_UNAVAILABLE
```

Do not automatically treat:

```text
server unavailable
```

as:

```text
license invalid
```

Instead display:

> License service temporarily unavailable. Your last verified entitlement was checked at 09:42 AM.

Whether diagnostic scans are permitted offline must be a commercial/security policy decision.

### Recommended model

Allow a short, signed offline grace period for already-activated customers, but require an online entitlement refresh before:

- consuming new entitlement where policy requires online confirmation
- performing destructive Data Purge
- changing license/device binding
- recovering from suspicious entitlement state

---

# 15. LEFT NAVIGATION — FINAL PROPOSAL

Use:

```text
OVERVIEW

ADVANCED DIAGNOSTIC

DATA PURGE

RESULTS & REPORTS

LICENSE & USAGE

HELP

SETTINGS
```

Below the navigation:

```text
────────────────────────

LICENSE USAGE

8 / 25 DEVICES USED

17 REMAINING

● License Active

────────────────────────
```

This is more professional than simply placing "Report" and a counter.

---

# 16. OVERVIEW SCREEN

Purpose:

> Give the technician an immediate understanding of the application, license and current device state.

Suggested content:

```text
WELCOME TO CYVRA MOBILE

Customer:
ABC Technologies Pvt Ltd

License:
25 Device Scans

Usage:
8 / 25

──────────────────────────────────

DEVICE CONNECTION

USB                 ● READY
ADB                 ● READY
AUTHORIZATION       ● READY
DEVICE               Samsung Galaxy A52
ANDROID              Android 13 / API 33

──────────────────────────────────

AVAILABLE OPERATIONS

┌──────────────────────┐
│ ADVANCED DIAGNOSTIC  │
│ Complete device      │
│ health assessment    │
│                      │
│ [ START ]            │
└──────────────────────┘

┌──────────────────────┐
│ DATA PURGE           │
│ Assess and securely  │
│ process device data  │
│                      │
│ [ START ]            │
└──────────────────────┘
```

The frozen transport architecture already defines distinct USB, ADB, authorization and device states. fileciteturn5file0L349-L365

---

# 17. DEVICE CONNECTION PANEL

Before either major operation:

```text
CYVRA DEVICE CONNECTION

USB
✓ Device detected

ADB
✓ ADB available

AUTHORIZATION
✓ Authorized

DEVICE
Samsung Galaxy A52

ANDROID
Android 13 / API 33

CONNECTION
READY

[ START ADVANCED DIAGNOSTIC ]
```

If authorization is missing:

```text
USB
✓ Device detected

ADB
✓ ADB available

AUTHORIZATION
! ACTION REQUIRED

Unlock the phone and approve:
"Allow USB debugging?"

[ RETRY ]
[ CONNECTION HELP ]
```

The frozen architecture specifically requires explicit states such as USB detected, ADB unavailable, unauthorized, offline and ready. fileciteturn5file0L349-L365

---

# 18. ADVANCED DIAGNOSTIC — PRIMARY WORKFLOW

This is the customer's non-destructive inspection workflow.

Recommended phases:

```text
1. Connection
2. Device identity
3. Android/software
4. Hardware
5. Storage
6. Memory
7. Battery
8. Security
9. Network
10. Applications
11. Capability assessment
12. Result generation
13. Report
```

The frozen architecture already defines independent evidence collectors for identity, software, hardware, storage, memory, battery, security, network, applications and capabilities. fileciteturn5file0L518-L537

---

# 19. DIAGNOSTIC UI

Use a professional progress layout:

```text
ADVANCED DIAGNOSTIC

Device:
Samsung Galaxy A52
Android 13

Progress
████████████████░░░░ 80%

✓ Device Identity
✓ Android Information
✓ Hardware
✓ Storage
✓ Memory
✓ Battery
✓ Security
● Network
○ Applications
○ Capability Assessment
```

If one collector fails:

```text
✓ Hardware
✓ Storage
⚠ Network
   Information restricted by device/OEM
✓ Battery
```

Never fail the entire diagnostic because one evidence collector fails.

The frozen architecture explicitly requires isolated collector failures and structured evidence statuses. fileciteturn5file0L541-L569

---

# 20. DIAGNOSTIC RESULT

After completion:

```text
DIAGNOSTIC COMPLETE

Device
Samsung Galaxy A52

Android
13 / API 33

Overall assessment
COMPLETED WITH LIMITATIONS

Evidence collected
94

Restricted fields
3

Unsupported fields
2

Warnings
1

[ VIEW RESULTS ]
[ DOWNLOAD REPORT ]
[ PROCESS ANOTHER DEVICE ]
```

Do not use a single artificial "100% healthy" score unless CYVRA has a clearly defined scoring methodology.

---

# 21. DEVICE IDENTITY

The report should show:

```text
Manufacturer
Samsung

Brand
Samsung

Model
Galaxy A52

Android Version
13

API Level
33

Build ID
...

Security Patch
...

CYVRA Session ID
...

IMEI
Restricted / unavailable
```

The architecture freeze explicitly prohibits fabricating IMEI/serial values and recommends source/status metadata for restricted identifiers. fileciteturn5file0L603-L635

Android itself restricts non-resettable identifiers such as IMEI and serial, particularly from Android 10 onward. citeturn1search3turn1search9

---

# 22. DATA PURGE — SEPARATE PRODUCT MODULE

Data Purge must never simply be:

```text
Diagnostic
+
DELETE
```

It must be a controlled lifecycle:

```text
DEVICE CONNECTION
        ↓
PRE-PURGE DIAGNOSTIC
        ↓
CAPABILITY ASSESSMENT
        ↓
AUTHORIZATION
        ↓
METHOD SELECTION
        ↓
PURGE / RESET
        ↓
DEVICE REBOOT
        ↓
RECONNECT
        ↓
POST-PURGE VERIFICATION
        ↓
FINAL REPORT
```

This directly follows the frozen sanitization architecture. fileciteturn5file0L766-L800

---

# 23. DATA PURGE LANDING SCREEN

Example:

```text
DATA PURGE

Before proceeding, CYVRA will assess:

✓ Device identity
✓ Android version
✓ Storage architecture
✓ Encryption state where legitimately available
✓ Management state
✓ Available sanitization capabilities

IMPORTANT

The available sanitization method depends on the
Android version, OEM, security configuration,
management state and exposed platform capabilities.

CYVRA will not claim a stronger sanitization result
than the device actually supports.

[ ASSESS DEVICE ]
```

---

# 24. PURGE CAPABILITY SCREEN

Example:

```text
SANITIZATION CAPABILITY

Factory Reset
✓ SUPPORTED

Device Owner Wipe
— NOT AVAILABLE

OEM Secure Erase
— NOT EXPOSED

Cryptographic Erase
? NOT DIRECTLY VERIFIED

Recommended Method
PLATFORM FACTORY RESET

Verification
REQUIRED

[ CONTINUE ]
```

The architecture freeze requires capability states such as supported, partial, unsupported, permission required, device owner required, OEM service required and unknown. fileciteturn5file0L824-L838

---

# 25. AUTHORIZATION SCREEN

Before destructive action:

```text
FINAL AUTHORIZATION

DEVICE
Samsung Galaxy A52

CUSTOMER
ABC Technologies Pvt Ltd

LICENSE
25 Device Scans

SANITIZATION METHOD
Platform Factory Reset

WARNING

This operation is destructive.

Data may become inaccessible after this
operation begins.

Confirm that the device is authorized for
sanitization.

☐ I confirm this device is authorized for purge.
☐ I understand the operation is destructive.

[ CANCEL ]
[ AUTHORIZE & PURGE ]
```

For higher-risk environments, add:

```text
Operator PIN / password
```

or server-side authorization.

---

# 26. PURGE EXECUTION SCREEN

Never show a fake progress percentage when actual progress cannot be measured.

Instead:

```text
DATA PURGE IN PROGRESS

Method:
Platform Factory Reset

Status:
RESET INITIATED

Device:
Samsung Galaxy A52

Please do not disconnect the USB cable.

Device is restarting...

● Waiting for device
● Reconnecting
○ Post-reset verification
```

---

# 27. POST-PURGE RECONNECTION

The Windows host must remain alive while the Android device restarts.

The frozen architecture specifically makes this a host-side responsibility. fileciteturn5file0L80-L100

Display:

```text
DEVICE RECONNECTING

USB
● Waiting

ADB
● Waiting

DEVICE
● Waiting

This can take several minutes.

Please keep the device connected.
```

---

# 28. VERIFICATION SCREEN

Example:

```text
POST-PURGE VERIFICATION

✓ Device re-detected
✓ Android system restarted
✓ Setup state detected
✓ Expected user-data state verified

Verification result:

VERIFIED

Limitations:
Physical storage-cell verification is not
claimed by this workflow.

[ GENERATE FINAL REPORT ]
```

The product must not claim that a simple reconnection proves every physical storage cell is inaccessible. fileciteturn5file0L975-L990

---

# 29. IMPORTANT SANITIZATION LANGUAGE

Never automatically display:

> SECURE ERASE COMPLETE

just because a factory reset command succeeded.

Instead use language such as:

> **Platform factory reset completed; post-reset verification completed.**

or:

> **Sanitization method executed successfully. Verification status: VERIFIED.**

The final report must identify method, authority, execution status, verification status, limitations and assurance/claim level. fileciteturn5file0L864-L884

NIST SP 800-88 Rev. 2 is now the current NIST revision and emphasizes an organizational sanitization program, appropriate methods, validation/assurance and current standards/practice. citeturn0search1turn0search3

---

# 30. RESULTS & REPORTS

Rename the old simple "Report" concept to:

> **RESULTS & REPORTS**

because the customer needs both live results and historical reports.

Screen:

```text
RESULTS & REPORTS

Search device / session
[________________________]

Filters:
[ Diagnostic ] [ Purge ] [ Date ] [ Device ]

---------------------------------------------------------
Date        Device             Operation       Status
---------------------------------------------------------
15 Sep      Galaxy A52         Diagnostic      COMPLETE
15 Sep      Redmi Note 11      Purge           VERIFIED
14 Sep      Moto G54           Diagnostic      COMPLETE
---------------------------------------------------------

[ VIEW ]
[ DOWNLOAD PDF ]
[ DOWNLOAD JSON ]
```

---

# 31. USER-WISE REPORTING

The request for "user-wise reports" should be implemented as **operator-wise reports**.

Each session should contain:

```text
operator_id
operator_name
customer_id
license_id
device_session_id
operation_type
start_time
end_time
status
report_id
```

Then reports can be filtered by:

```text
Operator
Date
Device
Operation
License
Status
```

Example:

```text
Operator: Rajesh
September 2026

Diagnostics: 18
Purges: 11
Verified: 10
Failed: 1
```

If the commercial model has only one user per license, the operator field can still exist internally for future expansion.

---

# 32. LICENSE & USAGE SCREEN

Dedicated page:

```text
LICENSE & USAGE

Customer
ABC Technologies Pvt Ltd

License
CYVRA-MOB-XXXX-XXXX

Plan
25 Device Scans

Status
● ACTIVE

────────────────────────

DEVICE SCANS

Used
8

Remaining
17

Total
25

████████░░░░░░░░░░

────────────────────────

VALIDITY

Activated
01 Sep 2026

Valid Until
01 Sep 2027

────────────────────────

[ REFRESH LICENSE ]
[ UPGRADE LICENSE ]
[ VIEW PURCHASE DETAILS ]
```

---

# 33. LICENSE USAGE RULE

The server must be authoritative.

The desktop application may cache entitlement state, but it must never be the final authority for:

- remaining entitlement
- payment status
- revocation
- upgrade
- license supersession
- suspicious usage

The application should receive a signed/authenticated entitlement response.

---

# 34. WHEN SHOULD A DEVICE SCAN BE CONSUMED?

This needs an explicit commercial rule.

### Recommended:

Do not consume a device entitlement merely because:

```text
USB connected
```

or:

```text
ADB detected
```

or:

```text
user clicked Start
```

Consume entitlement only after the defined billable operation reaches its committed point.

For example:

```text
Device identified
+
diagnostic successfully initiated
+
minimum required evidence captured
=
scan committed
```

If the operation fails before the committed point:

```text
NO ENTITLEMENT CONSUMED
```

This prevents customer disputes caused by bad cables, unauthorized devices, unsupported OEMs or failed connections.

---

# 35. UNIQUE DEVICE POLICY

If the business plan means:

> "3 devices"

rather than:

> "3 scan attempts"

then the entitlement system should track device processing identity carefully.

Do not rely on IMEI alone.

Use a CYVRA service-session/device fingerprint composed of legitimately available fields, for example:

```text
manufacturer
brand
model
product
Android version
API level
build information
permitted Android identifier
CYVRA session identity
```

The server should determine whether the device has already consumed an entitlement according to the commercial policy.

Because Android restricts persistent hardware identifiers, this must be treated as a policy/identity problem rather than assuming IMEI is universally available. citeturn1search3turn1search5

---

# 36. CUSTOMER SUPPORT / HELP

Help should be contextual.

If ADB is unauthorized:

```text
Why is my phone not ready?

1. Unlock your phone.
2. Enable Developer Options.
3. Enable USB debugging.
4. Connect the USB cable.
5. Accept the authorization prompt.
6. Click Retry.

[ OPEN FULL GUIDE ]
```

If the driver appears problematic:

```text
USB DRIVER ATTENTION

Windows detected the device but CYVRA
cannot establish diagnostic communication.

[ RUN CONNECTION DIAGNOSTIC ]
[ OPEN SUPPORT GUIDE ]
```

Do not simply show:

> Error 0x00000005

without explanation.

---

# 37. SETTINGS

Recommended:

```text
GENERAL
 ├── Language
 ├── Theme
 └── Notifications

CONNECTION
 ├── ADB diagnostics
 ├── Connection timeout
 └── Device reconnect behavior

UPDATES
 ├── Update channel
 └── Automatic updates

REPORTS
 ├── Default report folder
 ├── PDF
 └── JSON

PRIVACY
 ├── Diagnostic data
 └── Local retention

ABOUT
 ├── Version
 ├── License
 ├── Terms
 └── Open-source notices
```

---

# 38. LOCAL DATA SECURITY

CYVRA will handle device evidence.

Therefore:

- encrypt sensitive local session data where appropriate
- minimize stored personal data
- provide configurable retention
- protect reports from accidental exposure
- never put credentials in logs
- do not store API keys in the desktop application
- do not expose server secrets in the client

Android's security guidance recommends minimizing permissions, limiting sensitive-data transmission and protecting keys/secrets. citeturn1search1

---

# 39. SERVER API MODEL

Recommended conceptual API boundaries:

```text
POST /desktop/auth/session
GET  /desktop/license
POST /desktop/license/refresh
GET  /desktop/update
POST /desktop/device/session
POST /desktop/device/diagnostic
POST /desktop/device/purge/authorize
POST /desktop/device/purge/result
POST /desktop/device/verification
POST /desktop/reports
GET  /desktop/reports
GET  /desktop/reports/{id}
```

Exact paths must follow the existing CYVRA backend conventions.

Do not invent duplicate backend systems if an existing CYVRA API already provides the required capability.

---

# 40. ENTITLEMENT RESPONSE

Conceptual:

```json
{
  "licenseId": "internal-license-id",
  "serial": "CYVRA-MOB-XXXX-002",
  "status": "ACTIVE",
  "customer": {
    "id": "customer-id",
    "name": "ABC Technologies Pvt Ltd"
  },
  "plan": {
    "name": "25 Device Scans",
    "deviceEntitlement": 25
  },
  "usage": {
    "used": 8,
    "remaining": 17
  },
  "revision": 2,
  "validUntil": "2027-09-01T00:00:00Z"
}
```

This is conceptual and must be adapted to the existing backend.

---

# 41. REPORT SCHEMA

Every diagnostic/purge session should have:

```text
Report ID
Session ID
Customer ID
License ID
License Revision
Operator ID
Application Version
ADB Version
Windows Version

Device:
  Manufacturer
  Brand
  Model
  Android Version
  API Level
  Build
  Security Patch
  Legitimately available identifiers

Operation:
  Diagnostic / Purge

Capability:
  Supported
  Restricted
  Unsupported
  Permission Required

Execution:
  Started
  Completed
  Failed

Verification:
  Verified
  Partially Verified
  Platform Reported Complete
  Requires External Verification
  Failed
  Unknown

Limitations
Evidence Sources
Timestamps
```

---

# 42. APPLICATION VERSION + REPORT VERSION

Every report should record:

```text
CYVRA Mobile Version
Evidence Schema Version
Report Schema Version
ADB Version
```

This is important because a report generated by version 3.1 should remain interpretable after version 4.0 changes the evidence engine.

---

# 43. WINDOWS INSTALLER

The customer should receive a signed production installer.

The installer should:

1. verify publisher
2. install CYVRA
3. install required runtime components
4. install controlled ADB/Platform-Tools
5. create shortcuts
6. register update mechanism
7. preserve license/session state safely
8. support uninstall
9. not require Android Studio

For Tauri on Windows, development/building uses Microsoft C++ Build Tools and WebView2; Windows 10 1803+ and later already include WebView2 in the normal Windows environment, though deployment requirements should still be tested. citeturn0search8

---

# 44. CONTROLLED PLATFORM-TOOLS

CYVRA should ship with or otherwise control the tested Platform-Tools version rather than depending on whatever `adb.exe` the customer happens to have in PATH.

Android's Platform-Tools package includes `adb` and `fastboot`, and current releases are designed to remain backward-compatible with older Android devices. The July 2026 release is 37.0.1. citeturn1search0

CYVRA should still pin and validate the exact version used in each production release.

---

# 45. WINDOWS CODE SIGNING

Production CYVRA installers and executable components should be digitally signed.

For direct website distribution, Microsoft currently recommends trusted signing approaches for public distribution; traditional OV certificates are an alternative where appropriate. New publishers should expect SmartScreen reputation to build over time. citeturn0search0turn0search5

The signing identity must remain consistent across releases.

Never place the private signing key in:

```text
GitHub
Cursor prompt
Grok prompt
desktop application
public repository
customer machine
```

---

# 46. UPDATE + LICENSE SECURITY BOUNDARY

These must be independent.

```text
UPDATE AUTHENTICATION
        ≠
LICENSE AUTHENTICATION
```

A valid update does not grant entitlement.

A valid license does not authorize an untrusted application binary.

Both must be validated.

---

# 47. MULTI-DEVICE OPERATION

The first production version should support:

> **one Android device at a time**

This simplifies:

- entitlement accounting
- operator workflow
- USB/ADB state
- evidence isolation
- reports
- purge safety
- troubleshooting

Later versions may support multiple simultaneous devices, but that should be a separate architecture gate.

---

# 48. DEVICE SESSION MODEL

Every connection creates:

```text
Device Session
```

Example:

```text
Session:
CYVRA-SESSION-20260915-000124

Connected:
09:12:14

Device:
Redmi Note 11

Operator:
Rajesh

Operation:
Advanced Diagnostic

License:
CYVRA-MOB-XXXX-002
```

This session ID follows the device through the entire operation.

---

# 49. CUSTOMER WORKFLOW — FINAL

### Step 1

Customer launches CYVRA Mobile.

### Step 2

Application checks:

```text
Application integrity
License
Update status
Windows readiness
ADB readiness
```

### Step 3

Customer sees:

```text
Welcome
ABC Technologies
25 Device Scans
8 Used / 17 Remaining
```

### Step 4

Customer connects Android device.

### Step 5

CYVRA performs:

```text
USB
ADB
Authorization
Device identity
Connection health
```

### Step 6

Customer selects:

```text
ADVANCED DIAGNOSTIC
```

or:

```text
DATA PURGE
```

### Step 7

Diagnostic:

```text
Collect
Assess
Report
```

### Step 8

If purge is required:

```text
Pre-scan
Capability
Authorization
Purge
Reboot
Reconnect
Verify
Final report
```

### Step 9

Customer downloads report.

### Step 10

Customer disconnects the device.

### Step 11

Customer connects the next device.

---

# 50. PRODUCTIVITY FEATURE — "NEXT DEVICE"

After a successful diagnostic/purge:

```text
OPERATION COMPLETE

Report:
CYVRA-REP-000124

[ DOWNLOAD REPORT ]

Ready for another device?

[ CONNECT NEXT DEVICE ]
```

This should be a major workflow feature because professional customers may process many phones sequentially.

---

# 51. CUSTOMER DASHBOARD METRICS

Overview should show:

```text
LICENSE

25 Total Devices
8 Processed
17 Remaining

TODAY

3 Diagnostics
2 Purges
2 Verified
0 Failed

THIS MONTH

18 Diagnostics
11 Purges
10 Verified
1 Failed
```

These are operational metrics, not health claims.

---

# 52. PROFESSIONAL IMPROVEMENTS RECOMMENDED

## 52.1 Connection Wizard

A guided wizard for first-time customers:

```text
1. Install
2. Sign in
3. Verify license
4. Connect phone
5. Enable USB debugging
6. Authorize
7. Scan
```

---

## 52.2 Device Compatibility Badge

Show:

```text
CYVRA COMPATIBILITY

A — Connect       ✓
B — Evidence      ✓
C — Extended      ✓
D — Purge Assess  ✓
E — Purge Execute —
F — Verification  —
```

This maps directly to the frozen capability-level architecture. fileciteturn5file0L1186-L1210

---

## 52.3 Capability-first UX

Do not show a generic:

> "Purge"

button when the device capability has not been assessed.

Instead:

```text
ASSESS PURGE CAPABILITY
        ↓
CAPABILITY RESULT
        ↓
AVAILABLE ACTION
```

---

## 52.4 Evidence Source Indicator

Advanced users should be able to expand a field:

```text
Battery:
82%

Source:
ANDROID_PLATFORM

Status:
AVAILABLE
```

This improves trust and auditability. The frozen architecture explicitly requires evidence source recording. fileciteturn5file0L573-L599

---

# 53. ERROR UX

Never expose raw errors as the primary customer message.

Bad:

```text
java.lang.SecurityException
adb exit code 1
```

Good:

```text
CYVRA could not access this device information.

Reason:
Android restricted this information on this device.

Impact:
The remaining diagnostic can continue.

[ CONTINUE ]
[ VIEW DETAILS ]
```

---

# 54. UNSUPPORTED DEVICE UX

Never say:

> Device not supported.

unless the entire workflow genuinely cannot operate.

Instead:

```text
DEVICE CAPABILITY

Connection              ✓
Basic Evidence          ✓
Extended Evidence       ⚠ Partial
Purge Assessment        ✓
Purge Execution         ✕
Verification            —

Reason:
OEM does not expose the required sanitization capability.

You may still generate the diagnostic report.
```

This follows the frozen rule that compatibility is capability-based, not a single boolean. fileciteturn5file0L1188-L1210

---

# 55. UPDATE NOTIFICATION UX

Do not interrupt a diagnostic/purge session.

If update exists:

```text
NEW UPDATE AVAILABLE

Version 3.3.0

[ INSTALL AFTER THIS SESSION ]
[ REMIND ME LATER ]
[ VIEW DETAILS ]
```

If a security-critical mandatory update exists:

```text
SECURITY UPDATE REQUIRED

This version can no longer securely connect
to the CYVRA service.

Please update before starting another session.
```

---

# 56. UPGRADE UX

The upgrade should preserve the customer's context.

Example:

```text
UPGRADE LICENSE

Current:
3 Device Scans

Used:
3

Choose new plan:

5 Device Scans
₹____

7 Device Scans
₹____

25 Device Scans
₹____

[ CONTINUE TO CYVRA WEBSITE ]
```

After payment:

```text
UPGRADE COMPLETE

Previous:
3 Device Scans
SUPERSEDED

Current:
25 Device Scans
ACTIVE

Usage:
3 / 25

Remaining:
22
```

---

# 57. NO MANUAL SERIAL RE-ENTRY IF AVOIDABLE

After successful website payment, the desktop app should refresh entitlement automatically.

Ideal:

```text
Payment completed
      ↓
Server entitlement updated
      ↓
Desktop receives/refreshes entitlement
      ↓
New plan displayed
```

If browser/app handoff cannot be implemented safely:

```text
[ REFRESH LICENSE ]
```

should retrieve the updated entitlement.

Do not make customers manually type a new serial unless necessary.

---

# 58. SECURITY MODEL

The desktop application should use:

```text
Customer authentication
        +
Device/session identity
        +
License entitlement
        +
Server authorization
        +
Signed application/update
```

The client must not be trusted as the ultimate entitlement authority.

---

# 59. CUSTOMER REPORT STORAGE

Recommended:

```text
Documents/
  CYVRA Mobile/
      Reports/
          2026/
              09/
                  15/
```

File naming:

```text
CYVRA_Mobile_Diagnostic_<SessionID>.pdf
CYVRA_Mobile_Purge_<SessionID>.pdf
CYVRA_Mobile_Evidence_<SessionID>.json
```

Allow customer-configurable report location.

---

# 60. AUDIT TRAIL

Record:

```text
application start
license check
device connected
authorization
diagnostic start
diagnostic completion
purge authorization
purge start
device disconnect
device reconnect
verification
report generation
license refresh
upgrade detection
software update
```

Avoid logging sensitive raw personal data unnecessarily.

---

# 61. IMPLEMENTATION ARCHITECTURE

Recommended Windows application layers:

```text
┌───────────────────────────────────────────────┐
│                 Tauri UI                      │
├───────────────────────────────────────────────┤
│             Application Services              │
├───────────────────────────────────────────────┤
│ License │ Update │ Session │ Report │ Support │
├───────────────────────────────────────────────┤
│          Device Orchestration Layer           │
├───────────────────────────────────────────────┤
│ USB / ADB │ Evidence │ Capability │ Purge     │
├───────────────────────────────────────────────┤
│              Device Providers                 │
│ Generic Android │ OEM Adapters │ APK          │
└───────────────────────────────────────────────┘
```

The frozen architecture already defines Tauri UI, host core, USB/ADB transport, evidence engine, sanitization engine and capability engine as the major Windows-side boundaries. fileciteturn5file0L38-L70

---

# 62. RECOMMENDED DOMAIN MODULES

Conceptually:

```text
license/
update/
customer/
session/
device/
transport/
adb/
evidence/
capability/
oem/
diagnostic/
sanitization/
verification/
report/
audit/
support/
```

Do not create duplicate modules if equivalent structures already exist in the repository.

---

# 63. STATE MACHINE — CUSTOMER APPLICATION

```text
STARTING
   |
   v
AUTHENTICATING
   |
   v
LICENSE_CHECK
   |
   v
READY
   |
   +---- UPDATE_AVAILABLE
   |
   +---- LICENSE_ACTION_REQUIRED
   |
   v
DEVICE_WAITING
   |
   v
DEVICE_CONNECTED
   |
   v
DEVICE_AUTHORIZED
   |
   v
DEVICE_READY
   |
   +---- DIAGNOSTIC
   |
   +---- PURGE_ASSESSMENT
   |
   +---- REPORTS
```

---

# 64. STATE MACHINE — LICENSE

```text
UNKNOWN
  |
  v
CHECKING
  |
  +---- ACTIVE
  |
  +---- EXPIRED
  |
  +---- REVOKED
  |
  +---- SUPERSEDED
  |
  +---- SERVER_UNAVAILABLE
```

---

# 65. STATE MACHINE — UPDATE

```text
CURRENT
  |
  v
UPDATE_CHECK
  |
  +---- CURRENT
  |
  +---- UPDATE_AVAILABLE
  |
  +---- MANDATORY_UPDATE
  |
  v
DOWNLOAD
  |
  v
VERIFY
  |
  v
STAGE
  |
  v
INSTALL
  |
  v
VERIFY_STARTUP
  |
  +---- SUCCESS
  |
  +---- ROLLBACK / RECOVERY
```

---

# 66. TESTING REQUIREMENTS

Customer-side validation must cover:

### Windows

```text
Windows 10 64-bit
Windows 11 64-bit
```

### Android

```text
Android 8
9
10
11
12
12L
13
14
15
16
```

### OEM

```text
Samsung
Xiaomi / Redmi / POCO
Motorola
OnePlus
OPPO / Realme
Vivo
Pixel
Nothing
Unknown OEM
```

This matches the frozen compatibility baseline. fileciteturn5file0L1148-L1174

---

# 67. TEST CASES — LICENSE

Minimum:

```text
TC-LIC-001 Active license
TC-LIC-002 Expired license
TC-LIC-003 Revoked license
TC-LIC-004 Superseded license
TC-LIC-005 Upgrade
TC-LIC-006 Refresh after upgrade
TC-LIC-007 Server unavailable
TC-LIC-008 Offline grace
TC-LIC-009 Entitlement exhausted
TC-LIC-010 Duplicate device/session attempt
```

---

# 68. TEST CASES — UPDATE

```text
TC-UPD-001 Current version
TC-UPD-002 Optional update
TC-UPD-003 Mandatory update
TC-UPD-004 Invalid signature
TC-UPD-005 Corrupted download
TC-UPD-006 Interrupted download
TC-UPD-007 Failed installation
TC-UPD-008 Successful update
TC-UPD-009 Rollback/recovery
TC-UPD-010 Update during active session
```

---

# 69. TEST CASES — DEVICE

```text
TC-DEV-001 USB detection
TC-DEV-002 ADB detection
TC-DEV-003 Unauthorized
TC-DEV-004 Offline
TC-DEV-005 Disconnect during scan
TC-DEV-006 Reconnect
TC-DEV-007 Multiple devices connected
TC-DEV-008 Unsupported OEM
TC-DEV-009 Legacy Android
TC-DEV-010 Current Android
```

---

# 70. TEST CASES — PURGE

```text
TC-PUR-001 Capability assessment
TC-PUR-002 Authorization required
TC-PUR-003 Unsupported purge
TC-PUR-004 Purge execution
TC-PUR-005 Expected reboot
TC-PUR-006 Reconnect
TC-PUR-007 Post-reset verification
TC-PUR-008 Verification limitation
TC-PUR-009 Interrupted operation
TC-PUR-010 Final report
```

---

# 71. FIRST CUSTOMER RELEASE — RECOMMENDED SCOPE

Do not try to build everything simultaneously.

### Release 1

```text
✓ Customer authentication
✓ License display
✓ Usage display
✓ Windows preflight
✓ USB detection
✓ ADB detection
✓ Authorization handling
✓ Device identity
✓ Advanced Diagnostic
✓ Results
✓ PDF/JSON report
✓ Update check
✓ Upgrade website handoff
✓ License refresh
```

### Release 1 Data Purge

Initially:

```text
✓ Capability assessment
✓ Authorization architecture
✓ Non-destructive validation
✓ Platform reset workflow only where approved
✓ Reconnect
✓ Verification
✓ Reporting
```

Destructive capabilities beyond the approved platform workflow should remain gated until individually verified.

---

# 72. DO NOT BUILD YET

Do not initially implement:

```text
Universal secure erase
OEM proprietary wipe APIs
FRP bypass
Screen-lock bypass
Bootloader bypass
Unauthorized ADB access
IMEI harvesting as a universal requirement
Raw flash rewriting
Speculative OEM APIs
Multi-device simultaneous processing
```

These conflict with the architecture/security boundary or require separate validation.

The frozen architecture explicitly forbids bypassing ADB authorization, FRP, bootloader security, OEM security controls, permission controls and device-owner requirements. fileciteturn5file0L1636-L1650

---

# 73. CUSTOMER-SIDE UI FREEZE

The first production UI structure should be frozen as:

```text
HEADER
 ├── CYVRA Mobile
 ├── Customer
 ├── License
 ├── Usage
 ├── UPDATE
 └── UPGRADE

LEFT NAV
 ├── Overview
 ├── Advanced Diagnostic
 ├── Data Purge
 ├── Results & Reports
 ├── License & Usage
 ├── Help
 └── Settings

MAIN WORKSPACE
 └── Context-dependent workflow

BOTTOM STATUS BAR
 ├── Connection
 ├── License
 └── Application status
```

---

# 74. GITHUB DOCUMENTATION TO ADD

Create/update:

```text
docs/CUSTOMER_DESKTOP_PRODUCT_SPEC.md
docs/CUSTOMER_LICENSE_ARCHITECTURE.md
docs/CUSTOMER_UPDATE_UPGRADE_ARCHITECTURE.md
docs/CUSTOMER_DIAGNOSTIC_UX.md
docs/CUSTOMER_PURGE_UX.md
docs/CUSTOMER_REPORT_ARCHITECTURE.md
docs/CUSTOMER_TEST_MATRIX.md
```

Do not duplicate the existing Android compatibility freeze unnecessarily. Cross-reference it.

The existing freeze already requires documentation for Windows transport, evidence, sanitization, OEM adapters and testing. fileciteturn5file0L1472-L1485

---

# 75. CURSOR IMPLEMENTATION ORDER

Cursor should NOT redesign the entire product in one operation.

Recommended:

## C0 — Repository audit

Read-only.

Confirm:

- existing Tauri shell
- existing Windows host
- current navigation
- existing report structures
- existing API
- existing license/entitlement structures
- existing Android modules

No code changes.

---

## C1 — Customer shell

Implement:

```text
Header
Left navigation
Footer/status bar
Customer/license display
Update button
Upgrade button
```

No diagnostic logic yet.

---

## C2 — License service

Implement:

```text
license fetch
license refresh
usage
status
upgrade detection
```

---

## C3 — Device connection

Implement:

```text
USB
ADB
authorization
offline
disconnect
reconnect
device session
```

---

## C4 — Advanced Diagnostic

Connect existing evidence engine to the customer UI.

---

## C5 — Results & Reports

Implement:

```text
history
search
filters
view
PDF
JSON
operator filter
```

---

## C6 — Update

Implement:

```text
check
download
signature verification
install
restart
recovery
```

---

## C7 — Upgrade

Implement:

```text
website handoff
return to application
license refresh
new entitlement display
```

---

## C8 — Data Purge

Implement only after diagnostic/transport validation.

---

## C9 — Verification

Implement:

```text
reconnect
post-reset state
verification
final report
```

---

## C10 — Customer acceptance

Test the complete journey:

```text
Install
→ Activate
→ Connect
→ Diagnose
→ Report
→ Purge
→ Reconnect
→ Verify
→ Report
→ Upgrade
→ Refresh
→ Update
```

---

# 76. GITHUB COMMIT STRATEGY

Recommended logical commits:

```text
feat: establish customer desktop shell

feat: add customer license and usage display

feat: add device connection state workflow

feat: integrate advanced diagnostic workflow

feat: add results and report history

feat: add signed application update workflow

feat: add license upgrade handoff and refresh

feat: establish purge customer workflow

feat: add post-purge verification

test: add customer workflow coverage

docs: freeze customer desktop product architecture
```

Do not make one enormous "customer features" commit.

---

# 77. FINAL PRODUCT POSITIONING

The application should be presented to customers as:

> **CYVRA Mobile — Professional Android Device Diagnostics & Data Purge**

Supporting message:

> Connect an Android device to your Windows laptop or desktop, assess its hardware and software condition, generate an evidence-backed diagnostic report, and — where the device and authorization allow — perform a controlled data-purge workflow with post-operation verification.

Avoid:

> Works on every Android phone.

Use:

> Designed for broad Android OEM and version compatibility, with capability-aware handling for differences between devices.

This is consistent with the existing architecture's prohibition on claiming universal Android compatibility. fileciteturn5file0L1601-L1613

---

# 78. FINAL ENGINEERING PRINCIPLE

The customer should experience CYVRA as:

```text
SIMPLE
        ↓
CONNECT PHONE
        ↓
CYVRA UNDERSTANDS DEVICE
        ↓
DIAGNOSE
        ↓
REPORT
        ↓
OPTIONALLY PURGE
        ↓
VERIFY
        ↓
REPORT
        ↓
CONNECT NEXT PHONE
```

Behind that simple experience, the engineering system remains:

```text
Windows Host
+
Controlled ADB
+
Generic Android Evidence
+
Capability Engine
+
OEM Adapter Boundary
+
Optional Android Component
+
Sanitization Provider
+
Verification
+
Entitlement Service
+
Update Service
+
Audit Trail
+
Report Engine
```

That separation is critical.

---

# 79. FINAL FREEZE DECISION

### Freeze the following customer-side architecture:

```text
ONE WINDOWS APPLICATION

Customer / License
        |
        +---- Update
        |
        +---- Upgrade
        |
        v
Device Connection
        |
        +---- USB
        +---- ADB
        +---- Authorization
        |
        v
Device Session
        |
        +---- Advanced Diagnostic
        |
        +---- Data Purge
        |
        v
Results / Verification
        |
        v
Reports
```

### The customer application is NOT:

```text
an Android APK pretending to be a Windows diagnostic tool
```

It is:

> **A Windows-hosted Android device-service application with controlled USB/ADB communication and capability-aware Android/OEM integration.**

This is the correct continuation of the existing CYVRA architecture freeze. fileciteturn5file0L18-L30

---

# 80. FINAL ACCEPTANCE CHECKLIST

## Product UI

- [ ] CYVRA branding
- [ ] Customer name
- [ ] License serial
- [ ] Plan
- [ ] Device scan usage
- [ ] Remaining entitlement
- [ ] Update button
- [ ] Upgrade button
- [ ] Overview
- [ ] Advanced Diagnostic
- [ ] Data Purge
- [ ] Results & Reports
- [ ] License & Usage
- [ ] Help
- [ ] Settings

## Licensing

- [ ] Server-authoritative entitlement
- [ ] License revision
- [ ] Upgrade history
- [ ] Superseded license handling
- [ ] Usage accounting
- [ ] No accidental consumption
- [ ] Revocation
- [ ] Expiration
- [ ] Offline policy
- [ ] Refresh after upgrade

## Device

- [ ] USB detection
- [ ] ADB detection
- [ ] Authorization
- [ ] Offline state
- [ ] Disconnect
- [ ] Reconnect
- [ ] Device session
- [ ] Multi-OEM capability model

## Diagnostic

- [ ] Device identity
- [ ] Software
- [ ] Hardware
- [ ] Storage
- [ ] Memory
- [ ] Battery
- [ ] Security
- [ ] Network
- [ ] Applications
- [ ] Capability assessment
- [ ] Evidence source
- [ ] No fabricated values

## Data Purge

- [ ] Pre-purge evidence
- [ ] Capability assessment
- [ ] Authorization
- [ ] Method selection
- [ ] Execution
- [ ] Reboot
- [ ] Reconnect
- [ ] Verification
- [ ] Limitations
- [ ] Final report

## Update

- [ ] Version check
- [ ] Signed update
- [ ] Integrity verification
- [ ] Staged install
- [ ] Restart
- [ ] Recovery
- [ ] Stable channel
- [ ] Mandatory-update handling

## Upgrade

- [ ] Website handoff
- [ ] Payment outside desktop core
- [ ] Server entitlement revision
- [ ] New serial if commercially required
- [ ] Old serial superseded
- [ ] Usage preserved
- [ ] Automatic refresh
- [ ] Audit history

## Reports

- [ ] Diagnostic report
- [ ] Purge report
- [ ] PDF
- [ ] JSON
- [ ] Operator
- [ ] Customer
- [ ] License
- [ ] Session
- [ ] Application version
- [ ] Evidence source
- [ ] Verification status
- [ ] Limitations

## Security

- [ ] Signed Windows application
- [ ] Signed update artifacts
- [ ] Protected signing key
- [ ] HTTPS
- [ ] No API secrets in client
- [ ] No credentials in logs
- [ ] No security bypass
- [ ] No fabricated evidence

---

# 81. FINAL FREEZE STATEMENT

**This document is the customer-side product and engineering baseline for CYVRA Mobile.**

It extends the existing architecture freeze rather than replacing it.

The permanent product rule is:

> **Make the customer workflow simple, but make the evidence, licensing, device communication, sanitization, verification and audit architecture rigorous.**

The customer should see:

> **Connect → Diagnose → Report → Purge → Verify → Report**

while CYVRA internally guarantees:

> **Authenticated entitlement → controlled device session → capability-aware evidence → authorized operation → verified result → auditable report.**

**Implementation status:** APPROVED FOR CUSTOMER-SIDE DESIGN AND CONTROLLED IMPLEMENTATION.

**Do not merge customer-side architecture into `main` until the defined implementation gates, tests, code review and GitHub freeze process have passed.**
