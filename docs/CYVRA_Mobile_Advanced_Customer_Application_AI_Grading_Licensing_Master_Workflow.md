# CYVRA MOBILE

## Advanced Customer-Side Windows Application + AI Physical Inspection + Licensing, Payment, Upgrade & Update

### Layman Conclusion + Cursor Engineering Master Workflow

**Document status:** Product / UX / Engineering implementation baseline\
**Primary product:** CYVRA Mobile --- Android Device Diagnostics & Data
Purge\
**Host:** Windows 10/11 laptop or desktop\
**Operating model:** One Android device at a time\
**Primary transport:** USB + controlled Android Platform-Tools / ADB\
**Advanced feature:** AI-assisted physical inspection and CYVORIQ
Certified Grading\
**Commercial model:** Paid entitlement with online purchase, payment
confirmation, optional admin approval, entitlement revision, signed
software updates and customer-initiated upgrades

------------------------------------------------------------------------

# PART A --- SMALL CONCLUSION REPORT IN LAYMAN LANGUAGE

## 1. What are we actually building?

We are building a **professional Windows software used by a customer to
inspect Android phones one by one**.

The customer does not need Android Studio, Java, Gradle, Android SDK or
technical command-line knowledge.

The customer will:

1.  Buy CYVRA Mobile from the CYVORIQ website.
2.  Receive an approved license/entitlement.
3.  Download and install CYVRA Mobile on Windows.
4.  Sign in / activate the license.
5.  Connect one Android phone through USB.
6.  Run **Advanced Diagnostic**.
7.  Run the new **AI Physical Inspection** when the customer has the
    inspection station/camera setup.
8.  See the technical condition + physical condition together.
9.  Optionally run **Data Purge**.
10. Verify the result.
11. Download the final professional report.
12. Connect the next phone.

The existing architecture already defines Windows as the main
operational authority, USB as the physical connection and ADB as the
primary communication method where permitted.
fileciteturn7file0L12-L19

------------------------------------------------------------------------

## 2. The important new feature

The new feature is not just "take a photo of the phone."

It should become an **AI Physical Inspection Station inside CYVRA
Mobile**.

Think of it like this:

> The customer puts the phone in a fixed position → CYVRA tells the
> customer which side to show → the camera takes controlled pictures →
> AI finds visible damage → CYVRA combines those findings with software
> diagnostics → the system produces a professional condition grade.

The previous engineering research concluded that this is technically
feasible and commercially useful, but it should be built as a controlled
inspection station rather than simply a camera with a flash. The station
needs controlled positioning, lighting, image-quality checks, multiple
views, AI detection and a deterministic grading rules engine.

------------------------------------------------------------------------

## 3. What can the AI do?

### Very suitable for automation

The AI can detect or assist with:

-   cracked screen
-   cracked back glass
-   visible chips
-   scratches
-   dents that are visually/structurally observable
-   frame damage
-   discoloration
-   camera-cover visible damage
-   visible port/exterior damage
-   chassis deformation using multiple views and, later, depth/3D
-   dead/stuck pixels when CYVRA controls the screen test
-   burn-in/image retention with controlled display patterns
-   cosmetic condition

### AI can assist, but should not pretend to know everything

Examples:

-   battery swelling
-   USB connector condition
-   camera lens haze
-   screen uniformity
-   charging behavior
-   acoustic quality

These need additional controlled tests or human confirmation.

### AI must NOT claim to prove things that a camera cannot prove

Examples:

-   hidden internal battery damage
-   hidden motherboard damage
-   internal corrosion
-   connector contact integrity
-   RF/antenna health
-   water-resistance seal integrity
-   internal NAND/cell condition
-   anything hidden inside the phone

If the AI suspects a safety problem, the correct result is:

> **SAFETY HOLD --- Physical confirmation required**

It must not say:

> Battery is healthy.

------------------------------------------------------------------------

## 4. How grading should work

Do not create one mysterious "AI score".

Use four separate results:

### Safety

-   **S0 --- Safe to Process**
-   **S1 --- Safety Hold / Physical Confirmation Required**

### Cosmetic

-   **A --- Near New**
-   **B --- Light Wear**
-   **C --- Visible Wear**
-   **D --- Heavy-Service**

### Functional

-   **F0 --- Fully Verified**
-   **F1 --- Verified With Limitation**
-   **F2 --- Functional Defect**

### Overall CYVORIQ result

CYVORIQ can combine those into a clear final condition result.

Example:

> **CYVORIQ Certified Grade B**\
> Cosmetic: B --- Light Wear\
> Functional: F0 --- Fully Verified\
> Safety: S0 --- Safe to Process

This is much easier for a customer, buyer, refurbisher or auditor to
understand than a single AI percentage.

The research also found that there is not one universal national A/B/C
used-phone cosmetic grade in India. Therefore CYVORIQ should define and
version its own methodology rather than claiming that its grade is a
government/BIS grade. fileciteturn7file1L72-L81

------------------------------------------------------------------------

## 5. The biggest business advantage

Today, physical inspection depends heavily on a technician's eyes.

Different technicians can grade the same phone differently.

Our objective is **not to remove humans completely**.

Our objective is:

> **Move the human from being the primary judge to being an exception
> reviewer and safety checker.**

That means:

**Old way**

`Technician looks → technician decides → technician writes grade`

**CYVRA way**

`CYVRA controls capture → AI detects → rules calculate grade → technician reviews exceptions → CYVORIQ certifies evidence`

This makes grading more repeatable and creates evidence for the
customer's report.

------------------------------------------------------------------------

# PART B --- THE COMPLETE PRODUCT IN SIMPLE LANGUAGE

## 6. The customer application should have two major jobs

### Job 1 --- Advanced Diagnostic

Find out what the Android device reports about:

-   identity
-   Android/software
-   hardware
-   storage
-   memory
-   battery
-   security
-   network
-   applications
-   capabilities
-   diagnostic results

The existing diagnostic baseline distinguishes software/controlled tests
from physical verification and follows the principle that missing or
restricted information is not automatically a failure.
fileciteturn7file5L557-L569

### Job 2 --- Data Purge

After diagnosis, the customer can choose to sanitize the device.

The process must be:

`Pre-scan → Capability → Authorization → Method → Purge/Reset → Reboot → Reconnect → Verify → Final Report`

This is already the frozen sanitization lifecycle.
fileciteturn8file4L748-L783

------------------------------------------------------------------------

# PART C --- THE ADVANCED CUSTOMER EXPERIENCE

## 7. Main application layout

Use the existing CYVRA Erase application as the visual inspiration.

The new CYVRA Mobile should look like a professional service
workstation:

### Top header

-   CYVRA Mobile logo
-   customer name
-   license status
-   current plan
-   scans used
-   scans remaining
-   current software version
-   `[ UPDATE ]`
-   `[ UPGRADE ]`

### Left navigation

1.  OVERVIEW
2.  ADVANCED DIAGNOSTIC
3.  AI PHYSICAL INSPECTION
4.  DATA PURGE
5.  RESULTS & REPORTS
6.  LICENSE & USAGE
7.  HELP
8.  SETTINGS

### Bottom-left license card

Example:

``` text
LICENSE USAGE

25 DEVICE SCANS
8 USED
17 REMAINING

● LICENSE ACTIVE
```

The existing customer-side baseline already separates device scan
entitlement from operator/user seats and recommends "Licensed Device
Scans" for the first release. fileciteturn8file0L90-L142

------------------------------------------------------------------------

# PART D --- COMMERCIAL / PAYMENT / LICENSE MODEL

## 8. Important: payment and license are different things

The customer pays money.

The payment system confirms the payment.

The CYVRA server decides what entitlement the customer receives.

The application receives the signed/authorized entitlement.

Do not make the Windows application itself the final authority.

### Simple flow

``` text
CUSTOMER
   |
   v
CYVORIQ WEBSITE
   |
   v
SELECT PLAN
   |
   v
PAY IN ADVANCE
   |
   v
PAYMENT PROVIDER
   |
   v
PAYMENT CONFIRMED
   |
   v
CYVRA SERVER
   |
   v
ADMIN APPROVAL (if required by business policy)
   |
   v
ENTITLEMENT CREATED / ACTIVATED
   |
   v
CUSTOMER APPLICATION REFRESHES
   |
   v
LICENSE ACTIVE
```

------------------------------------------------------------------------

## 9. Suggested first-release plans

The application should support configurable plans rather than
hard-coding prices.

Example:

``` text
1 Device Scan
3 Device Scans
5 Device Scans
7 Device Scans
25 Device Scans
```

The exact commercial pricing should come from the CYVRA server.

Do not put prices permanently into the desktop code.

------------------------------------------------------------------------

## 10. Admin approval model

The business can choose:

### Option A --- Automatic

Payment succeeds → entitlement automatically activates.

### Option B --- Payment + Admin Approval

Payment succeeds → order becomes:

``` text
PAYMENT_CONFIRMED
WAITING_ADMIN_APPROVAL
```

Admin reviews it.

Admin clicks:

``` text
APPROVE
```

Server creates/activates entitlement.

### Recommended for the early production phase

Use:

> **Payment confirmed → Admin approval → Entitlement activation**

This gives CYVORIQ control during the initial commercial rollout.

Later, trusted low-risk purchases can be automated if the business
wants.

------------------------------------------------------------------------

# PART E --- LICENSE UPGRADE

## 11. Upgrade is NOT the same as software Update

This distinction is extremely important.

### UPDATE

Changes the installed software.

Examples:

-   bug fix
-   security fix
-   new Android compatibility
-   new model support
-   diagnostic improvement
-   AI model improvement
-   report improvement

### UPGRADE

Changes what the customer is allowed to process.

Example:

``` text
3 scans
   ↓
25 scans
```

The previous engineering baseline explicitly requires Update and Upgrade
to remain separate. fileciteturn8file1L314-L361

------------------------------------------------------------------------

## 12. Correct upgrade flow

Customer sees:

``` text
CURRENT PLAN
3 Device Scans

Used: 2
Remaining: 1

UPGRADE

○ 5 Device Scans
○ 7 Device Scans
○ 25 Device Scans

[ CONTINUE ]
```

Then:

``` text
CYVRA WEBSITE
      ↓
SELECT UPGRADE
      ↓
PAYMENT
      ↓
PAYMENT CONFIRMED
      ↓
ADMIN APPROVAL
      ↓
SERVER CREATES NEW ENTITLEMENT REVISION
      ↓
CUSTOMER APPLICATION REFRESH
      ↓
NEW LICENSE ACTIVE
```

------------------------------------------------------------------------

## 13. Never destroy the old license record

Example:

``` text
Internal license_id:
LIC-000001

Revision 1:
Serial CYVRA-XXXX-001
Plan 3 scans
Used 2
Remaining 1
Status SUPERSEDED

Revision 2:
Serial CYVRA-XXXX-002
Plan 25 scans
Used 2
Remaining 23
Status ACTIVE
```

The internal `license_id` stays stable.

The visible serial can change.

This preserves:

-   payment history
-   upgrade history
-   audit trail
-   support history
-   reconciliation
-   entitlement history
-   fraud protection

The existing customer-side design explicitly recommends an immutable
internal license identity plus entitlement revisions.
fileciteturn8file0L146-L213

------------------------------------------------------------------------

# PART F --- DEVICE SCAN ACCOUNTING

## 14. When should a scan be consumed?

Do NOT consume a scan merely because the phone was plugged in.

A scan should be consumed at a clearly defined business event.

Recommended:

> Consume one device entitlement when the customer commits the device to
> a billable diagnostic/inspection operation and the server has
> authorized that operation.

The exact transaction point must be implemented once and used
consistently.

### Example

``` text
USB connected
      ↓
Device detected
      ↓
Preview / preflight
      ↓
Customer clicks START
      ↓
Server entitlement check
      ↓
Scan committed
      ↓
Diagnostic begins
```

If a cable is connected and immediately disconnected before commitment,
the customer should not accidentally lose a scan.

------------------------------------------------------------------------

# PART G --- OFFLINE BEHAVIOR

## 15. Do not confuse server outage with invalid license

The application should distinguish:

``` text
LICENSE_ACTIVE
LICENSE_EXPIRED
LICENSE_REVOKED
LICENSE_SUPERSEDED
LICENSE_UNKNOWN
LICENSE_SERVER_UNAVAILABLE
```

If the server is unavailable, show:

> License service temporarily unavailable. Your last verified
> entitlement was checked recently.

Do not say:

> License invalid.

The existing baseline recommends a short signed offline grace period for
already activated customers, while requiring online entitlement refresh
for sensitive operations such as destructive purge and license changes.
fileciteturn8file2L477-L517

------------------------------------------------------------------------

# PART H --- UPDATE SYSTEM

## 16. Update must be secure

The application should:

1.  Check installed version.
2.  Contact CYVRA update service.
3.  Authenticate update metadata.
4.  Verify signature/integrity.
5.  Download only the approved package.
6.  Stage the update.
7.  Restart safely.
8.  Install.
9.  Verify startup.
10. Recover/rollback if installation fails.

Never implement:

``` text
download EXE
→ execute EXE
```

without cryptographic verification.

The existing design requires signed update artifacts and separation of
update authentication from license authentication.
fileciteturn8file1L365-L391

------------------------------------------------------------------------

# PART I --- AI PHYSICAL INSPECTION STATION

## 17. What equipment should be used?

Start simple but professional.

### V1 hardware

-   fixed high-quality RGB camera
-   stable phone fixture/cradle
-   fixed camera distance
-   diffuse light
-   controlled raking/grazing light
-   neutral background
-   calibration target
-   USB connection to Windows if required
-   optional external power

### Later versions

-   multiple cameras
-   depth/3D
-   cross-polarized lighting
-   automated turntable
-   thermal camera for selected safety/anomaly cases
-   controlled acoustic fixture

Do not make expensive hardware mandatory before proving the
computer-vision workflow.

------------------------------------------------------------------------

# 18. Capture sequence

CYVRA should guide the operator.

Example:

``` text
STEP 1 OF 6

FRONT VIEW

Place device in the holder.
Screen OFF.
Align the device with the guide.

[ CAPTURE ]
```

Then:

``` text
STEP 2 OF 6
BACK VIEW
```

Then:

``` text
STEP 3 OF 6
LEFT SIDE
```

Then:

``` text
STEP 4 OF 6
RIGHT SIDE
```

Then:

``` text
STEP 5 OF 6
TOP
```

Then:

``` text
STEP 6 OF 6
BOTTOM
```

Later add optional:

``` text
CORNER / OBLIQUE VIEW
```

------------------------------------------------------------------------

# 19. Image quality gate

Before AI grading, CYVRA must check:

-   correct framing
-   focus
-   blur
-   exposure
-   glare
-   reflection
-   obstruction
-   correct orientation
-   correct view
-   sufficient image resolution
-   correct distance
-   device completeness

If quality is bad:

``` text
IMAGE QUALITY NOT SUFFICIENT

Please recapture.

Reason:
Excessive glare on screen.
```

The AI should never confidently grade a bad image.

------------------------------------------------------------------------

# 20. AI processing pipeline

Use:

``` text
IMAGE
  ↓
IMAGE QUALITY CHECK
  ↓
DEVICE REGION DETECTION
  ↓
DEFECT DETECTION
  ↓
DEFECT LOCALIZATION
  ↓
DEFECT CLASSIFICATION
  ↓
CONFIDENCE
  ↓
RULES ENGINE
  ↓
COSMETIC RESULT
  ↓
HUMAN REVIEW IF REQUIRED
```

The AI should identify evidence.

The rules engine should decide the grade.

This makes the grading methodology auditable and versionable.

------------------------------------------------------------------------

# 21. AI evidence record

Every detected defect should retain:

``` text
Inspection ID
Session ID
Device ID / allowed identifier
View
Original image
Processed image/crop
Defect type
Location
Severity
Confidence
AI model version
Threshold version
Timestamp
Image hash
Reviewer result
```

This is important because CYVORIQ is not merely producing a number.

It is producing:

> **Evidence-backed device condition information.**

------------------------------------------------------------------------

# PART J --- CYVORIQ CERTIFIED GRADING

## 22. Proposed result

Example:

``` text
CYVORIQ CERTIFIED DEVICE
CONDITION & DIAGNOSTIC REPORT

Overall Grade:
B

Safety:
S0 — SAFE TO PROCESS

Cosmetic:
B — LIGHT WEAR

Functional:
F0 — FULLY VERIFIED

AI Inspection:
6 / 6 views accepted

Physical Findings:
• 2 light frame scratches
• no visible screen crack
• no visible back-glass crack
• no major dent detected

Diagnostic Findings:
• display functional
• cameras functional
• battery result available
• connectivity checks completed

Methodology:
CYVORIQ Mobile Physical Inspection Standard v1.0

AI Model:
CV-MOBILE-001

Rules Version:
GRADE-IN-001

Report ID:
CYVRA-REP-XXXX
```

------------------------------------------------------------------------

# 23. Country-specific grading

The core evidence should remain the same.

Only the presentation/mapping should change.

Example:

``` text
CORE RESULT
Cosmetic B

INDIA PROFILE
Good

ENTERPRISE PROFILE
Grade B

RESELLER PROFILE
Light Wear
```

Do not change the underlying evidence merely because the country
changes.

The country profile is a presentation/business mapping layer.

------------------------------------------------------------------------

# PART K --- COMPLETE CUSTOMER WORKFLOW

## 24. End-to-end workflow

``` text
CUSTOMER PURCHASES CYVRA
        ↓
PAYMENT
        ↓
PAYMENT CONFIRMED
        ↓
ADMIN APPROVAL (if enabled)
        ↓
ENTITLEMENT CREATED
        ↓
PROTECTED DOWNLOAD
        ↓
WINDOWS INSTALLATION
        ↓
LOGIN / ACTIVATION
        ↓
LICENSE VALIDATION
        ↓
CYVRA MOBILE HOME
        ↓
CONNECT ANDROID DEVICE
        ↓
USB CHECK
        ↓
ADB CHECK
        ↓
AUTHORIZATION CHECK
        ↓
DEVICE IDENTITY
        ↓
PRE-FLIGHT
        ↓
ADVANCED DIAGNOSTIC
        ↓
AI PHYSICAL INSPECTION
        ↓
COMBINED ASSESSMENT
        ↓
CYVORIQ CONDITION / DIAGNOSTIC RESULT
        ↓
OPTIONAL DATA PURGE
        ↓
PURGE AUTHORIZATION
        ↓
SANITIZATION
        ↓
REBOOT
        ↓
RECONNECT
        ↓
POST-PURGE VERIFICATION
        ↓
FINAL REPORT
        ↓
DOWNLOAD REPORT
        ↓
CONNECT NEXT DEVICE
```

The Windows application is intended to own UI, USB/ADB, identity,
evidence orchestration, sanitization orchestration, verification,
reporting, audit trail and server communication.
fileciteturn8file3L657-L680

------------------------------------------------------------------------

# PART L --- WHAT CURSOR SHOULD DO

## 25. Golden rule for Cursor

**Do not tell Cursor to immediately rewrite the whole application.**

This is a complex application.

Cursor must first:

1.  inspect the repository
2.  understand existing code
3.  identify what already works
4.  identify missing pieces
5.  map the existing architecture to this document
6.  create an implementation plan
7.  implement one phase at a time
8.  run tests/builds after each phase
9.  never silently change frozen architecture

------------------------------------------------------------------------

# 26. PHASE 0 --- REPOSITORY AUDIT

### Cursor instruction

Give Cursor this instruction first:

``` text
You are working on CYVRA Mobile, a professional Windows-hosted Android device diagnostics and data purge application.

Before changing any code, perform a complete read-only repository audit.

Do not modify files.
Do not commit.
Do not redesign the architecture.

Understand:
1. current repository structure
2. Windows/Tauri application structure
3. Android project
4. Rust host/core modules
5. frontend/UI
6. server/API integration
7. licensing implementation
8. reports
9. USB/ADB implementation
10. diagnostic implementation
11. sanitization implementation
12. tests
13. build configuration
14. update infrastructure
15. existing database/API contracts

Compare the repository against the CYVRA Mobile Customer-Side Windows Application + AI Physical Inspection master specification.

Return:
A. What already exists
B. What is partially implemented
C. What is missing
D. What is unsafe
E. What conflicts with the frozen architecture
F. Recommended implementation order
G. Files/modules that would need modification

Do not write code yet.
```

### Expected result

Cursor should produce an audit.

Do not allow Cursor to start a giant rewrite before reviewing this
audit.

------------------------------------------------------------------------

# 27. PHASE 1 --- FREEZE THE APPLICATION ARCHITECTURE

After the audit, ask Cursor to create:

``` text
docs/CYVRA_MOBILE_IMPLEMENTATION_PLAN.md
```

It should define:

``` text
Desktop Shell
     |
     +-- Authentication
     +-- License
     +-- Update
     +-- Upgrade
     +-- Device Session
     +-- USB
     +-- ADB
     +-- Diagnostics
     +-- AI Inspection
     +-- Grading Rules
     +-- Purge
     +-- Verification
     +-- Reports
     +-- Audit
     +-- Server API
```

The implementation plan must identify dependencies.

------------------------------------------------------------------------

# 28. PHASE 2 --- CUSTOMER DESKTOP SHELL

Build the professional Windows shell first.

### Required screens

``` text
Overview
Advanced Diagnostic
AI Physical Inspection
Data Purge
Results & Reports
License & Usage
Help
Settings
```

### Header

Show:

``` text
Customer
License
Plan
Used
Remaining
Status
[UPDATE]
[UPGRADE]
```

### Important

Do not connect AI or purge logic directly into UI buttons.

The UI calls service interfaces.

------------------------------------------------------------------------

# 29. PHASE 3 --- LICENSE SERVICE

Create a dedicated license/entitlement service.

It should understand:

``` text
license_id
serial
customer
plan
device_scan_entitlement
scans_used
scans_remaining
valid_from
valid_until
status
revision
```

### Status enum

``` text
ACTIVE
EXPIRED
REVOKED
SUPERSEDED
UNKNOWN
SERVER_UNAVAILABLE
```

### Never

Do not trust a UI counter.

The server is authoritative.

------------------------------------------------------------------------

# 30. PHASE 4 --- PAYMENT / ORDER / ADMIN APPROVAL

This should primarily live on the CYVRA server, not inside the desktop
application's business logic.

Recommended server entities:

``` text
Customer
Order
Payment
PaymentEvent
Entitlement
EntitlementRevision
Approval
LicenseActivation
DeviceScanTransaction
```

### Order lifecycle

``` text
CREATED
PAYMENT_PENDING
PAYMENT_CONFIRMED
WAITING_ADMIN_APPROVAL
APPROVED
ENTITLEMENT_ISSUED
CANCELLED
REFUNDED
```

### Admin lifecycle

``` text
PENDING
APPROVED
REJECTED
```

### Critical rule

Payment confirmation must be verified server-side using the payment
provider's trusted mechanism.

Do not let the desktop application claim:

> Payment successful.

The server must decide.

------------------------------------------------------------------------

# 31. PHASE 5 --- UPGRADE

Build the Upgrade button only after the basic license flow works.

Customer:

``` text
UPGRADE
```

opens the official CYVRA web purchase/authenticated flow.

The desktop app should not duplicate the payment system unless there is
a deliberate product requirement.

The existing customer-side design recommends opening the official
website rather than embedding the payment system in the desktop app.
fileciteturn7file3L276-L308

After payment and approval:

``` text
revision 1 → SUPERSEDED
revision 2 → ACTIVE
```

The customer retains previous usage.

------------------------------------------------------------------------

# 32. PHASE 6 --- USB / ADB / DEVICE SESSION

Implement one device at a time.

The application must distinguish:

``` text
USB_NOT_CONNECTED
USB_CONNECTED
ADB_UNAVAILABLE
ADB_UNAUTHORIZED
ADB_OFFLINE
ADB_READY
DEVICE_RECONNECTING
```

USB connection does not automatically mean diagnostic access.
fileciteturn8file3L719-L733

Each device operation receives a unique:

``` text
session_id
```

Example:

``` text
CYVRA-SESSION-20260915-000124
```

This ID follows the device through diagnostics, inspection, purge and
report.

------------------------------------------------------------------------

# 33. PHASE 7 --- ADVANCED DIAGNOSTIC

Do not rewrite the existing diagnostic system unnecessarily.

First make the current deterministic diagnostic baseline stable.

Then expose it through a clean orchestration layer:

``` text
DiagnosticSession
    ↓
Collectors
    ↓
Evidence
    ↓
Capability Assessment
    ↓
Result
    ↓
Report
```

Maintain the existing rule:

> Missing/restricted data is not automatically a failure.

Never fabricate restricted identifiers.

------------------------------------------------------------------------

# 34. PHASE 8 --- AI PHYSICAL INSPECTION MVP

Do NOT begin with the complete AI system.

Build V0:

### V0

-   manual camera capture
-   six views
-   fixed capture instructions
-   image-quality validation
-   save original evidence
-   session association
-   inspection record
-   no automatic certification yet

The purpose is to prove the capture workflow.

------------------------------------------------------------------------

# 35. PHASE 9 --- AI SCREEN INSPECTION

Next build AI for:

-   screen crack
-   screen damage
-   visible scratches
-   dead/stuck pixel support through controlled display tests
-   burn-in support through controlled display tests

AI output:

``` text
DEFECT
LOCATION
SEVERITY
CONFIDENCE
```

Do not immediately assign the final grade.

------------------------------------------------------------------------

# 36. PHASE 10 --- AI BODY INSPECTION

Add:

-   back glass
-   frame
-   side rails
-   top
-   bottom
-   port exterior
-   camera cover
-   chips
-   dents
-   scratches
-   discoloration

Use six/eight-view evidence.

------------------------------------------------------------------------

# 37. PHASE 11 --- GRADING RULES ENGINE

Only after AI evidence is stable should grading be implemented.

Example:

``` text
IF
screen_crack = severe
THEN
cosmetic_grade = D
```

Example:

``` text
IF
safety_hold = true
THEN
overall_result = HOLD
```

Rules must be versioned:

``` text
GRADE-IN-001
GRADE-IN-002
```

Never hide grading decisions inside an opaque model.

------------------------------------------------------------------------

# 38. PHASE 12 --- HUMAN REVIEW

Create a review screen.

Example:

``` text
AI REVIEW REQUIRED

Possible defect:
Back glass crack

Confidence:
82%

[ ACCEPT ]
[ REJECT ]
[ RECAPTURE ]
[ PHYSICAL VERIFICATION ]
```

Store the reviewer decision.

This creates a valuable training dataset for future model improvement.

------------------------------------------------------------------------

# 39. PHASE 13 --- CYVORIQ CERTIFICATION

Create the report only after:

-   diagnostic completed
-   physical inspection completed
-   required views captured
-   AI results available
-   exceptions resolved
-   safety state known
-   grading rules applied

Report should include:

``` text
Customer
Operator
License
Session
Device
Diagnostic result
Physical inspection result
AI evidence
Human review
Safety result
Cosmetic grade
Functional grade
Overall grade
Methodology version
AI model version
Rules version
Timestamp
Report hash / integrity information
```

------------------------------------------------------------------------

# 40. PHASE 14 --- DATA PURGE

Keep purge completely separate from diagnostic and AI logic.

Required flow:

``` text
Pre-scan
→ Capability
→ Authorization
→ Method
→ Purge
→ Reboot
→ Reconnect
→ Verify
→ Final report
```

Destructive operations must be controlled by the service layer, not
directly by UI event handlers.

Do not label a factory reset "secure erase" unless the actual method and
assurance support that claim.

------------------------------------------------------------------------

# 41. PHASE 15 --- FINAL REPORT

There should be a clear difference between:

### Diagnostic Report

What was found before purge.

### Physical Condition / Grading Report

What the device looked like and how it was graded.

### Sanitization / Final Report

What happened during purge and what was verified afterwards.

### Combined customer certificate

Where appropriate, CYVORIQ can combine these into:

> **CYVORIQ Certified Device Condition & Diagnostic Report**

------------------------------------------------------------------------

# PART M --- SERVER API DESIGN

## 42. Minimum API groups

Cursor should identify or implement equivalent APIs for:

### Authentication

``` text
POST /auth/login
POST /auth/refresh
POST /auth/logout
```

### Entitlement

``` text
GET /license
GET /license/status
POST /license/refresh
```

### Scan authorization

``` text
POST /scan-sessions/authorize
POST /scan-sessions/commit
POST /scan-sessions/complete
POST /scan-sessions/cancel
```

### Upgrade

``` text
POST /upgrade/request
GET /upgrade/status
```

### Update

``` text
GET /updates/latest
GET /updates/manifest
```

### Reports

``` text
POST /reports
GET /reports
GET /reports/{id}
```

### Inspection

``` text
POST /inspection/session
POST /inspection/capture
POST /inspection/result
POST /inspection/review
```

These are conceptual endpoints. Cursor must first inspect existing
server conventions and reuse them rather than blindly creating duplicate
APIs.

------------------------------------------------------------------------

# PART N --- SECURITY RULES

## 43. Absolute rules

Cursor must never:

-   put private signing keys in GitHub
-   put payment secrets in the desktop application
-   put admin credentials in the desktop application
-   trust client-side entitlement counters
-   fabricate IMEI/serial/MAC
-   bypass Android security
-   bypass ADB authorization
-   bypass FRP
-   bypass bootloader security
-   claim physical verification from software-only evidence
-   claim battery health from a photo
-   call factory reset universally "secure erase"
-   execute unsigned update packages
-   silently modify frozen architecture

Production installers and executable components should be digitally
signed, and signing private keys must remain outside the repository,
prompts and customer machines. fileciteturn7file4L330-L365

------------------------------------------------------------------------

# PART O --- DATABASE / AUDIT MODEL

## 44. Important records

At minimum, the backend should be able to trace:

``` text
Customer
    ↓
Order
    ↓
Payment
    ↓
Admin Approval
    ↓
Entitlement Revision
    ↓
Application Activation
    ↓
Device Scan Session
    ↓
Diagnostic
    ↓
Physical Inspection
    ↓
AI Findings
    ↓
Human Review
    ↓
Purge
    ↓
Verification
    ↓
Report
```

This is the complete business/audit chain.

------------------------------------------------------------------------

# PART P --- TESTING STRATEGY

## 45. Cursor must test in layers

### Unit tests

Test:

-   license status
-   entitlement math
-   upgrade revision
-   scan consumption
-   grading rules
-   safety rules
-   report generation

### Integration tests

Test:

-   login
-   license refresh
-   payment webhook handling
-   admin approval
-   upgrade
-   update manifest
-   report API
-   device session

### Hardware tests

Test:

-   USB connected
-   ADB authorized
-   ADB unauthorized
-   device disconnect
-   reconnect
-   reboot
-   different Android versions
-   multiple OEMs

### AI tests

Test:

-   good image
-   blurred image
-   glare
-   incorrect view
-   crack
-   scratch
-   dent
-   no defect
-   low confidence
-   conflicting views

### Security tests

Test:

-   expired license
-   revoked license
-   superseded license
-   fake entitlement
-   altered update
-   invalid signature
-   replayed authorization
-   duplicate scan commit
-   network outage
-   server outage

------------------------------------------------------------------------

# PART Q --- AI QUALITY RULES

## 46. The AI should be conservative

If confidence is high:

``` text
DEFECT DETECTED
```

If confidence is low:

``` text
REVIEW REQUIRED
```

If image quality is bad:

``` text
RECAPTURE REQUIRED
```

If a safety condition is suspected:

``` text
SAFETY HOLD
PHYSICAL CONFIRMATION REQUIRED
```

Never convert uncertainty into a confident grade.

------------------------------------------------------------------------

# PART R --- DEVELOPMENT ORDER

## 47. Recommended build order

Do it in this order:

``` text
1. Repository Audit
2. Architecture / Implementation Plan
3. Windows UI Shell
4. Authentication
5. License / Entitlement
6. Device Session
7. USB / ADB
8. Existing Diagnostic Stabilization
9. Report System
10. Update System
11. Website Upgrade Flow
12. Payment + Admin Approval
13. Scan Accounting
14. AI Inspection Capture V0
15. Image Quality Gate
16. AI Screen Inspection
17. AI Body Inspection
18. Grading Rules
19. Human Review
20. CYVORIQ Certified Report
21. Data Purge Integration
22. Post-Purge Verification
23. Security Hardening
24. Full Acceptance Testing
25. Signed Production Release
```

Do not reverse this order simply because AI is the most exciting
feature.

------------------------------------------------------------------------

# PART S --- CURSOR WORKING METHOD

## 48. One phase at a time

For every phase Cursor should use:

``` text
READ
→ PLAN
→ IMPLEMENT
→ TEST
→ REVIEW
→ VERIFY
```

Not:

``` text
READ
→ CHANGE 100 FILES
→ HOPE
```

------------------------------------------------------------------------

# 49. Cursor completion format

At the end of every phase, require Cursor to report:

``` text
PHASE:
STATUS:

FILES CHANGED:

FEATURES IMPLEMENTED:

TESTS RUN:

TEST RESULTS:

BUILD RESULT:

SECURITY NOTES:

KNOWN LIMITATIONS:

NEXT PHASE:

FILES NOT CHANGED:
```

------------------------------------------------------------------------

# 50. Git discipline

Before every major phase:

``` text
git status
git branch
git log -5
```

Then implement only the approved phase.

After implementation:

``` text
git diff
git status
tests
build
```

Do not commit:

``` text
.idea/
local.properties
secrets
API keys
private signing keys
payment secrets
customer credentials
```

------------------------------------------------------------------------

# PART T --- WHAT NOT TO DO

## 51. Do not build the AI feature as a separate unrelated application

Wrong:

``` text
CYVRA Mobile
       +
separate AI application
```

Correct:

``` text
CYVRA Mobile
       |
       +-- Advanced Diagnostic
       |
       +-- AI Physical Inspection
       |
       +-- Data Purge
       |
       +-- Reports
```

The AI inspection is an advanced feature **inside the main customer
application**.

------------------------------------------------------------------------

# 52. Do not make the AI mandatory for every customer

Some customers may not have the camera station.

Therefore:

``` text
Advanced Diagnostic
    ↓
AI Physical Inspection
    ↓
Available if station configured
```

The software should clearly show:

``` text
AI INSPECTION STATION
Not configured

[ SET UP STATION ]
```

or:

``` text
AI INSPECTION STATION
READY
```

------------------------------------------------------------------------

# 53. Do not let AI control destructive operations

AI can detect condition.

AI must not independently decide:

> erase this device.

Purge must require its own capability assessment and authorization flow.

------------------------------------------------------------------------

# PART U --- FINAL PRODUCT VISION

## 54. The finished customer experience

The customer opens CYVRA Mobile.

They see:

``` text
CYVRA MOBILE

ABC TECHNOLOGIES

25 DEVICE SCANS
8 USED
17 REMAINING

● LICENSE ACTIVE

[ UPDATE ] [ UPGRADE ]
```

They connect a phone.

CYVRA says:

``` text
DEVICE READY

Samsung Galaxy A52
Android 13
USB ✓
ADB ✓
AUTHORIZATION ✓
```

They click:

``` text
ADVANCED DIAGNOSTIC
```

CYVRA performs the technical inspection.

Then:

``` text
AI PHYSICAL INSPECTION

6 / 6 VIEWS

FRONT ✓
BACK ✓
LEFT ✓
RIGHT ✓
TOP ✓
BOTTOM ✓
```

AI reports:

``` text
2 LIGHT SCRATCHES
NO SCREEN CRACK
NO BACK GLASS CRACK
NO MAJOR DENT
```

The grading engine produces:

``` text
COSMETIC: B
FUNCTIONAL: F0
SAFETY: S0

CYVORIQ CERTIFIED GRADE B
```

If purge is required:

``` text
DATA PURGE

CAPABILITY: SUPPORTED
AUTHORIZATION: REQUIRED

[ START PURGE ]
```

Afterwards:

``` text
PURGE COMPLETE
RECONNECTED
POST-PURGE VERIFICATION COMPLETE
```

Finally:

``` text
CYVORIQ CERTIFIED
DEVICE CONDITION & DIAGNOSTIC REPORT

[ DOWNLOAD REPORT ]
[ CONNECT NEXT DEVICE ]
```

------------------------------------------------------------------------

# PART V --- THE MOST IMPORTANT ENGINEERING PRINCIPLE

## 55. Evidence first. Grade second. Certification last.

The architecture should always follow:

``` text
DEVICE
   ↓
CONNECTION EVIDENCE
   ↓
DIAGNOSTIC EVIDENCE
   ↓
PHYSICAL IMAGE EVIDENCE
   ↓
AI FINDINGS
   ↓
HUMAN REVIEW / EXCEPTION HANDLING
   ↓
GRADING RULES
   ↓
SAFETY DECISION
   ↓
CYVORIQ CERTIFIED RESULT
   ↓
OPTIONAL SANITIZATION
   ↓
POST-SANITIZATION VERIFICATION
   ↓
FINAL REPORT
```

This prevents the product from becoming an unreliable "AI score
generator".

It becomes an **evidence-led professional device lifecycle tool**.

------------------------------------------------------------------------

# PART W --- FINAL INSTRUCTION TO CURSOR

Use the following as the master instruction when starting
implementation:

``` text
CYVRA MOBILE — MASTER ENGINEERING INSTRUCTION

Build CYVRA Mobile as a professional Windows-hosted Android device diagnostics, AI physical inspection, grading, data purge and evidence/reporting application.

The Windows application is the operational authority.

The application must support:
- customer authentication
- license entitlement
- device scan accounting
- payment-backed entitlement
- optional mandatory admin approval
- entitlement revisions for upgrades
- secure signed software updates
- separate Update and Upgrade workflows
- USB/ADB device connection
- one Android device at a time
- Advanced Diagnostic
- AI Physical Inspection
- deterministic grading rules
- human exception review
- CYVORIQ Certified Device Condition & Diagnostic Report
- Data Purge
- post-purge verification
- audit trail

AI physical inspection is an advanced feature INSIDE CYVRA Mobile, not a separate product.

Do not fabricate restricted identifiers.
Do not bypass Android security.
Do not claim physical conditions that cannot be proven.
Do not claim battery health from a photograph.
Do not claim universal secure erase from factory reset.
Do not allow AI to directly trigger destructive operations.

Payment and admin approval are server-authoritative.
The desktop application must not contain payment secrets or admin credentials.
The server is authoritative for entitlement.
Visible license serials may change after upgrade, but the immutable internal license_id and revision history must remain.

UPDATE changes software.
UPGRADE changes entitlement.
Keep them completely separate.

Before writing code:
1. audit the repository
2. identify current architecture
3. identify existing functionality
4. identify gaps
5. produce an implementation plan
6. wait for approval before major implementation

Implement in small verified phases.

For each phase:
READ → PLAN → IMPLEMENT → TEST → REVIEW → VERIFY.

Do not perform a whole-project rewrite.

Preserve the frozen Windows-hosted Android architecture and existing working functionality unless a documented architectural change is explicitly approved.
```

------------------------------------------------------------------------

# PART X --- FINAL CONCLUSION

## 56. In one sentence

**CYVRA Mobile should become a professional Windows workstation that
combines Android technical diagnostics, controlled AI physical
inspection, evidence-backed grading, secure data purge, licensing and
commercial entitlement management into one customer application.**

The AI inspection is the major advanced differentiator.

The commercial licensing system makes it a real product.

The evidence/audit model makes the result professionally defensible.

The human-review model keeps the system safe and realistic.

The correct development strategy is **not to build everything at once**.

Build the stable customer application first, integrate licensing and
commercial control, stabilize diagnostics and reporting, then add the AI
inspection station in controlled stages.

That gives CYVORIQ a smooth path from:

**working application → commercial application → advanced AI inspection
→ CYVORIQ Certified Grading → production platform.**

------------------------------------------------------------------------

## SOURCE / BASELINE NOTE

This document is derived from the existing CYVRA Mobile customer-side
Windows product baseline and the AI physical inspection / certified
grading engineering research already prepared for the project.

The existing product baseline establishes the Windows 10/11 desktop
model, USB/ADB operation, one-device-at-a-time workflow, customer
licensing, Update/Upgrade separation, entitlement revision model,
offline behavior, diagnostics, purge and reporting architecture.
fileciteturn8file0L12-L20

The AI research establishes the feasibility of controlled
computer-vision inspection, the need for a calibrated inspection
station, strong automation for visible defects, human/specialist
handling for hidden/internal conditions, and the proposed separation of
safety, cosmetic, functional and overall grades.
fileciteturn7file1L69-L82
