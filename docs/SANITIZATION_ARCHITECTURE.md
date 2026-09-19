# Sanitization Architecture

**Status:** ACTIVE CONTRACT — P1.5A.5 CONSOLIDATED
**Date:** 2026-09-19
**Product:** CYVRA Mobile
**Audited repository baseline:** `81309e28e32fa638fd7fcaa1bd0ab0a007888748`
**Primary code homes:** `apps/android/core`, `apps/host`, `apps/desktop/src-tauri`, `packages/evidence`, `services/api`
**Related contracts:**
- [`DEVICE_EVIDENCE_ARCHITECTURE.md`](./DEVICE_EVIDENCE_ARCHITECTURE.md)
- [`WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md`](./WINDOWS_ANDROID_TRANSPORT_ARCHITECTURE.md)
- [`CUSTOMER_PURGE_UX.md`](./CUSTOMER_PURGE_UX.md)
- [`CUSTOMER_REPORT_ARCHITECTURE.md`](./CUSTOMER_REPORT_ARCHITECTURE.md)

**External standards basis:** NIST SP 800-88 Rev. 2, *Guidelines for Media Sanitization*, September 2025. NIST Rev. 2 distinguishes **Clear**, **Purge**, and **Destroy**, and distinguishes sanitization **verification** from sanitization **validation**. Technology-specific technique qualification must use the applicable approved/vendor/industry method rather than a generic software claim.

---

# 0. Purpose

This document defines the safety, qualification, authorization, execution, verification, validation, and reporting architecture for CYVRA Mobile sanitization.

It replaces older assumptions that:

- a successful reset trigger proves sanitization,
- absence of a screen lock proves Android Setup Wizard/OOBE,
- a reconnect through ADB is required to verify reset,
- a generic ADB command can represent all sanitization methods,
- a factory reset can automatically be labelled NIST Purge,
- a dry-run success may advance toward certification,
- or a sanitization certificate can be generated from a single weak post-reset signal.

The overriding rule is:

> **CYVRA must never make a sanitization claim stronger than the qualified method, execution evidence, verification evidence, and validation decision support.**

---

# 1. Sanitization is a separate product boundary

Device verification and sanitization are separate workflows.

```text
DEVICE DISCOVERY
      ↓
DEVICE VERIFICATION
      ↓
REPORT 1 FROZEN
      ↓
SEPARATE SANITIZATION ELIGIBILITY
      ↓
SEPARATE AUTHORIZATION
      ↓
QUALIFIED METHOD EXECUTION
      ↓
REBOOT / DISCONNECT / RECONNECT
      ↓
SANITIZATION VERIFICATION
      ↓
SANITIZATION VALIDATION
      ↓
FINAL OUTCOME REPORT
```

A successful Device Verification does **not** authorize destructive action.

A valid licence scan does **not** automatically authorize destructive action.

ADB authorization does **not** authorize destructive action.

Physical USB/WPD visibility does **not** authorize destructive action.

---

# 2. Current standards terminology

CYVRA uses the following sanitization-method categories consistently.

## 2.1 Clear

`Clear` protects against simple, non-invasive recovery through the ordinary interface available to the user.

A manufacturer factory reset may potentially be part of a **Clear** technique when:

- it is appropriate for the specific device/media,
- the procedure is qualified,
- expected completion is verified,
- anomalies/errors are evaluated,
- and the resulting state is validated as adequate for the intended confidentiality risk.

Therefore:

```text
FACTORY RESET
    ≠ automatically CLEAR

FACTORY RESET
    ≠ PURGE
```

but a qualified manufacturer reset procedure may support a **Clear** outcome for a specific device context.

---

## 2.2 Purge

`Purge` provides stronger protection intended to make recovery infeasible using state-of-the-art laboratory techniques while allowing the media/device potentially to remain reusable.

A CYVRA operation may be called `Purge` only when the underlying technique is explicitly qualified for the target storage/device.

Potential purge techniques may include device/media-specific:

- dedicated sanitize commands,
- block erase,
- qualified overwrite techniques where applicable,
- cryptographic erase when prerequisites are satisfied,
- qualified OEM/vendor sanitization methods.

A generic factory reset or generic ADB trigger is not automatically Purge.

---

## 2.3 Destroy

`Destroy` renders the media unusable for future storage and is outside the current ordinary CYVRA Mobile software execution scope.

CYVRA may record an externally performed destruction process in a future workflow, but the Windows application must not imply it physically destroyed media when it did not.

---

# 3. Verification and validation are separate

CYVRA must distinguish:

```text
EXECUTION
    what command/procedure was attempted

VERIFICATION
    whether the technique appears to have completed as expected

VALIDATION
    whether the sanitization outcome is accepted as adequate
    for the target data/risk/policy
```

These are not synonyms.

A command can execute successfully while validation fails.

A device can reboot successfully while verification is inconclusive.

Verification evidence can be technically sound while policy still requires external validation.

---

# 4. Permanent safety invariant

A destructive action may execute only when all required gates are true:

```text
TARGET CORRELATED
+
METHOD QUALIFIED
+
CAPABILITY CONFIRMED
+
PRE-OPERATION EVIDENCE FROZEN
+
ENTITLEMENT/POLICY AUTHORITY SATISFIED
+
TWO-STEP OPERATOR AUTHORIZATION SATISFIED
+
EXECUTION PLAN BOUND TO SAME TARGET
```

If any required gate is uncertain:

```text
STOP
```

not:

```text
BEST EFFORT EXECUTE
```

---

# 5. Software ownership

## 5.1 React Desktop UI

Owns:

- presentation of available sanitization options;
- warning language;
- target-device display;
- two-step operator confirmation;
- progress/status;
- reconnect guidance;
- limitations and outcome presentation.

React does not determine method eligibility or evidence truth.

---

## 5.2 Rust/Tauri Native Layer

Owns:

- physical Windows USB/PnP observation;
- WPD/MTP observation;
- reconnect topology;
- `SessionDeviceRef`/native correlation support;
- secure lifecycle of the Kotlin Domain Engine process;
- native transport facts used by the sanitization workflow.

Rust does not independently declare a Clear/Purge result merely because a device disappeared/reappeared.

---

## 5.3 Kotlin Domain Engine

Owns:

- method-capability policy;
- authorization state;
- sanitization workflow state;
- ADB/OEM/device-owner execution adapters;
- verification policy;
- validation inputs;
- final sanitization outcome semantics.

The Domain Engine must consume Windows-native observations rather than infer physical USB state from ADB.

---

## 5.4 Cloud control plane

May own production policy such as:

- entitlement state;
- customer/account authority;
- organization sanitization policy;
- destructive-operation authorization policy;
- audit registry;
- final report registry.

Cloud policy does not replace local same-device correlation.

---

# 6. Current implementation model

The current core model contains:

```text
SanitizationMethodType
AuthorizationRequirement
PreSanitizationRecord
SanitizationExecutionResult
SanitizationVerificationStatus
VerificationResult
SanitizationProvider
VerificationProvider
```

Current method enum:

```text
CLEAR_PLATFORM_RESET
CLEAR_DEVICE_OWNER_WIPE
PURGE_CRYPTOGRAPHIC_ERASE
PURGE_OEM_SECURE_ERASE
UNSUPPORTED_METHOD
```

This is a useful domain foundation.

It is **not** proof that all listed methods are currently executable or qualified.

---

# 7. Method availability is not enum availability

A method appearing in source code means only:

```text
MODELLED
```

It does not mean:

```text
HARDWARE-VALIDATED
```

or:

```text
RELEASE-VALIDATED
```

For each method, maintain a qualification record.

Conceptually:

```text
SanitizationMethodQualification
  methodId
  methodCategory
  technique
  targetDeviceScope
  storageScope
  authorityRequired
  toolOrApi
  toolVersion
  prerequisites
  knownExcludedAreas
  expectedSignals
  verificationProcedure
  validationPolicy
  hardwareTestEvidence
  qualificationVersion
  qualificationStatus
```

---

# 8. Required qualification states

Use explicit qualification maturity such as:

```text
UNQUALIFIED
MODELLED
SIMULATION_VALIDATED
HARDWARE_TESTED
QUALIFIED_CLEAR
QUALIFIED_PURGE
EXTERNAL_ONLY
UNSUPPORTED
SUSPENDED
```

Exact enum names are frozen at implementation time.

The critical requirement is that an unqualified method cannot become executable simply because the capability engine returned `isAvailable = true`.

---

# 9. Current high-risk code issue — generic fallback execution

The current `HostSanitizationProvider.execute()` effectively selects:

```text
CLEAR_PLATFORM_RESET
    → recovery --wipe_data

everything else
    → am broadcast -a android.intent.action.MASTER_CLEAR
```

This architecture is unsafe for production.

It means enum values representing:

- Device Owner wipe,
- cryptographic erase,
- OEM secure erase,
- unsupported method,

can fall into the same generic command path.

Target rule:

```text
switch(method):
  qualified method A → adapter A only
  qualified method B → adapter B only
  unsupported         → reject
  unqualified         → reject
  unknown             → reject
```

There must be **no destructive default branch**.

This is a Phase 2 correction blocker before any real destructive release.

---

# 10. Generic ADB reset commands are not universal sanitization methods

Historical code contains generic Android/ADB reset triggers.

They must be treated as:

```text
UNQUALIFIED IMPLEMENTATION EXPERIMENT
```

until proven per supported device/method.

Do not assume:

- command exists;
- shell has authority;
- command means the same thing across Android/OEM builds;
- returned exit code means wipe completed;
- reboot means data sanitization completed;
- reset protects all storage areas;
- reset satisfies Purge.

Production execution must be backed by device/method qualification.

---

# 11. Method-specific adapters

Production architecture should use explicit method adapters.

Conceptually:

```text
SanitizationMethodAdapter
  assess()
  prepare()
  execute()
  inspectCompletion()
  describeLimitations()
```

Examples:

```text
PlatformFactoryResetAdapter
DeviceOwnerWipeAdapter
OemQualifiedSanitizeAdapter
CryptographicEraseAdapter
ExternalVerificationAdapter
```

Only implemented + qualified adapters are eligible.

No adapter may masquerade as another method.

---

# 12. Platform factory reset

A platform/manufacturer reset is treated as a candidate **Clear** technique, not as Purge.

Before CYVRA can issue a Clear assurance for a given device family/procedure, qualification should determine:

- what reset interface is actually used;
- what user-addressable storage is addressed;
- whether adopted/removable storage is included;
- whether work profiles/secondary users are addressed;
- whether eSIM/removable media are in scope;
- whether the operation reports errors;
- what reboot/OOBE outcome is expected;
- which areas are excluded;
- which Android/OEM/software versions were tested.

Until qualified:

```text
METHOD = Platform Factory Reset
ASSURANCE = PLATFORM_RESET_ATTEMPTED / EXTERNAL_REVIEW_REQUIRED
```

not:

```text
NIST CLEAR VERIFIED
```

---

# 13. Device Owner / enterprise wipe

`DevicePolicyManager`-style wipe requires legitimate management authority.

It is not an ordinary customer-device privilege.

Requirements:

- confirm the app/device management state;
- confirm scope: device vs profile;
- record active authority;
- record API/method used;
- record flags/options;
- qualify behavior by Android/OEM/version;
- distinguish enterprise policy wipe from general sanitization assurance.

If CYVRA is not the legitimate Device Owner/Profile Owner or otherwise authorized:

```text
UNSUPPORTED / REQUIRES_DEVICE_OWNER
```

No bypass is permitted.

---

# 14. OEM secure erase / sanitize

OEM-specific erase is permitted only through a verified adapter.

Requirements:

- documented or contractually authorized OEM interface;
- exact supported device/model/software range;
- authority prerequisites;
- return/completion semantics;
- known storage coverage;
- error/anomaly behavior;
- hardware validation;
- regression matrix;
- clear assurance category.

Brand-name detection alone is never enough.

---

# 15. Cryptographic erase

Cryptographic erase is a Purge candidate only when prerequisites are established.

At minimum the qualification must establish:

- target data is encrypted by the cryptographic mechanism in scope;
- the relevant data-encryption keys are known;
- key hierarchy/wrapping is understood sufficiently;
- no unprotected target copies remain in scope;
- key sanitization/destruction is performed using an appropriate qualified mechanism;
- external/escrow/recovery key implications are understood;
- completion can be verified;
- the procedure is acceptable under the applicable sanitization standard/policy.

Therefore:

```text
device uses encryption
    ≠
CYVRA can claim Cryptographic Erase
```

No generic key-deletion claim is allowed without proof.

---

# 16. Removable and secondary storage

A sanitization operation must define its target storage scope.

Examples:

```text
internal flash
removable microSD
adopted storage
external USB storage
eSIM data where applicable
secondary users/profiles
work profile
```

A device reset that does not address removable media must not produce a whole-device statement that implies the removable media was sanitized.

The report must state exclusions.

---

# 17. Same-device identity is mandatory

The destructive workflow must bind to:

```text
sessionDeviceRef
```

or an equivalent trusted session target.

The same selected target must be proven across:

```text
pre-scan
authorization
execution
disconnect
reboot
reconnect
verification
validation
report
```

IMEI is not required.

Hardware serial is not required if unavailable/restricted.

---

# 18. Current high-risk code issue — reconnect serial ignored

The current workflow method accepts:

```text
reconnectedSerial
```

but does not use it to establish identity.

That means the current unit-tested workflow does not prove that the post-reset evidence belongs to the same physical target.

Production correction:

```text
reconnect candidate
      ↓
Windows USB identity
+ WPD identity
+ ADB identity where available
+ pre-operation correlation
      ↓
SessionDeviceRef match / confidence
      ↓
continue OR require operator resolution
```

If same-device identity is ambiguous:

```text
DO NOT CERTIFY
```

---

# 19. Multi-device safety

When multiple plausible devices are connected:

- enumerate all;
- do not use first-device semantics;
- lock destructive plan to one selected `SessionDeviceRef`;
- show enough non-sensitive identifying information for operator confirmation;
- reject destructive execution if target ambiguity appears after authorization;
- reject automatic reconnect binding when multiple candidates satisfy weak criteria.

---

# 20. Two-step operator authorization

Two-step confirmation remains mandatory.

Minimum:

### Step 1 — destructive-action acknowledgement

Operator explicitly acknowledges:

- all user data in scope may become inaccessible;
- operation may reboot/disconnect the device;
- device selection must be correct;
- action cannot be undone through CYVRA.

### Step 2 — target-bound confirmation

Operator confirms a phrase or challenge bound to:

```text
operationId
+
sessionDeviceRef / safe device descriptor
```

A phrase bound only to operation ID is weaker than a target-bound barrier.

---

# 21. Hardware serial confirmation is optional

Do not require exact hardware serial when:

- it is legitimately unavailable;
- Android restricts access;
- WPD/USB correlation is stronger for the session.

If reliable serial is legitimately available, it may be included in the confirmation UI.

Safety comes from same-device correlation and explicit target confirmation, not from inventing or bypassing serial access.

---

# 22. Server/entitlement authorization

Operator confirmation and server/commercial authority are separate.

A production destructive workflow may require:

```text
operator authorization
+
active customer/account entitlement
+
organization destructive-action policy
+
server authorization token/challenge
```

The exact commercial policy is frozen in the licence contract.

No customer desktop may embed a master/bypass credential.

---

# 23. Pre-sanitization evidence freeze

Before execution, persist an immutable pre-sanitization record.

Minimum target data:

```text
operationId
processingSessionId
sessionDeviceRef
deviceLifecycleId where assigned
pre-operation evidence manifest/digest
device identity facts actually available
transport state
storage scope
method
technique
qualification version
tool/adapter version
authority
operator
authorization timestamps
policy decision
expected disconnect/reboot
known limitations/exclusions
```

The record must survive application/device reboot/disconnect.

---

# 24. Dry-run / simulation

Simulation is valuable but must be impossible to confuse with actual sanitization.

Required state separation:

```text
SIMULATED
    !=
EXECUTED

SIMULATION_SUCCESS
    !=
SANITIZATION_SUCCESS

SIMULATION
    !=
CERTIFICATION_READY
```

Current code returns `isSuccess = true` for dry run and advances the workflow.

That behavior must be corrected before production destructive work.

Simulation should end in a state such as:

```text
SIMULATION_COMPLETE
```

with no path to sanitization certification.

---

# 25. Execution state model

Do not represent execution as a single Boolean.

Target states should distinguish at least:

```text
NOT_STARTED
SIMULATED
AUTHORIZATION_REJECTED
PREPARING
TRIGGER_SENT
TOOL_RUNNING
REBOOT_EXPECTED
TOOL_REPORTED_COMPLETE
FAILED
UNKNOWN
```

The exact enum is frozen during implementation.

`TOOL_REPORTED_COMPLETE` is still not a validation decision.

---

# 26. Raw tool response

Raw command/tool output may be preserved as diagnostic evidence when safe.

Do not:

- expose secrets;
- store uncontrolled private content;
- make raw stdout the only structured evidence;
- infer successful sanitization solely from exit code/stdout.

Record stable fields:

```text
tool
toolVersion
method
startedAt
completedAt
exit/completion status
error code
anomalies
safe raw reference/detail
```

---

# 27. Reboot and disconnect are expected workflow events

A successful destructive technique may cause:

```text
USB removal
WPD removal
ADB disconnect
device reboot
transport re-enumeration
```

These events must not automatically mark the operation failed.

The application must persist state before execution and resume into:

```text
AWAITING_RECONNECT
```

when reboot/disconnect is expected.

---

# 28. Post-reset ADB cannot be mandatory

After factory reset, ADB may be:

- disabled,
- unavailable,
- unauthorized,
- not configured.

Therefore:

> **Post-sanitization verification must not require ADB to become authorized again.**

Windows USB and WPD/MTP can provide legitimate post-reset signals without USB debugging.

Operator observation may also be required.

---

# 29. Verification signal model

Post-sanitization verification is multi-signal.

Potential signals:

```text
WINDOWS_USB
  device disconnect/reconnect
  physical presence

WINDOWS_WPD_MTP
  device/storage reappearance
  storage/object metadata consistent with reset where valid

ANDROID_ADB
  optional state/properties when legitimately available

ANDROID_COMPONENT
  generally unavailable after reset unless reinstalled/provisioned

OPERATOR
  setup/OOBE observation where required

SYSTEM/METHOD ADAPTER
  tool completion status
  errors/anomalies
  method-specific proof
```

No single signal is automatically decisive for every method/device.

---

# 30. Current high-risk code issue — lock absence ≠ Setup Wizard

Current `HostVerificationProvider` effectively treats:

```text
screenLockPresent == false
```

as:

```text
setupWizardDetected == true
userDataInaccessible == true
```

That inference is too weak.

Absence of a lock-screen indicator does not prove:

- device is at OOBE/setup;
- prior accounts were removed;
- target data is inaccessible;
- the reset completed;
- Clear/Purge requirements were satisfied.

Production verification must use explicit independent signals.

---

# 31. Current high-risk code issue — false NIST assurance

Current verifier can emit:

```text
NIST_SP_800_88_REV2_CLEAR_PLATFORM_VERIFIED
```

based largely on weak post-reset evidence.

That assurance label must not be production-reachable until:

- the technique is qualified for the target device/storage;
- execution completion is verified;
- anomalies are evaluated;
- validation policy accepts the result.

Until then use neutral language such as:

```text
PLATFORM_RESET_TRIGGERED
PLATFORM_RESET_OUTCOME_OBSERVED
VERIFICATION_INCONCLUSIVE
EXTERNAL_VALIDATION_REQUIRED
```

---

# 32. Verification vs validation state model

The current `SanitizationVerificationStatus` is useful but mixes several concepts.

Target architecture separates:

## Verification

```text
NOT_PERFORMED
IN_PROGRESS
EXPECTED_COMPLETION_OBSERVED
PARTIAL_EVIDENCE
ANOMALY_DETECTED
INCONCLUSIVE
FAILED
```

## Validation

```text
NOT_EVALUATED
ACCEPTED
REJECTED
EXTERNAL_REVIEW_REQUIRED
```

An organization may require human/policy validation even when automated verification is strong.

---

# 33. Validation decision

Validation considers:

```text
method qualification
target data sensitivity/policy
execution completion
verification evidence
errors/anomalies
known excluded storage areas
same-device confidence
tool/adapter health
required human review
```

Result:

```text
ACCEPTED
```

or:

```text
REJECTED / EXTERNAL_REVIEW_REQUIRED
```

If rejected, the workflow may require:

- repeat sanitization,
- stronger method,
- external tool,
- physical destruction,
- manual investigation.

---

# 34. Tool health and anomalies

Verification must not look only for success.

Record:

- error codes;
- tool health;
- device health;
- unexpected disconnect timing;
- reset command rejection;
- storage anomalies;
- re-enumeration anomalies;
- inconsistent identity;
- unexpected remaining data/metadata signals where valid;
- unsupported/unknown areas.

An anomaly can force validation rejection even when the command returned success.

---

# 35. Full content sampling is not the default

CYVRA must not read customer file content merely to prove sanitization.

Post-operation verification should rely on:

- tool completion evidence;
- device state;
- storage metadata/state where appropriate;
- method-specific verification;
- organization policy.

Content inspection requires separate legal/privacy authorization and is not the normal CYVRA verification path.

---

# 36. WPD role after sanitization

WPD/MTP can provide useful post-operation evidence.

Examples:

- device reappears;
- expected storage roots exist;
- object hierarchy/state is consistent with the qualified reset procedure;
- prior user-visible metadata is no longer observed, where that check is appropriate.

But:

```text
WPD looks empty
    ≠
whole-device Purge proven
```

WPD cannot verify hidden/non-user-addressable storage areas by itself.

---

# 37. Report taxonomy

CYVRA should distinguish final document types by outcome.

## 37.1 Successful accepted sanitization

May produce:

> **CYVRA Data Sanitization & Verification Certificate**

only when validation is `ACCEPTED` under a qualified method/policy.

---

## 37.2 Attempted but not accepted

Produce a non-certificate outcome record such as:

> **CYVRA Sanitization Attempt & Verification Report**

for:

```text
verification inconclusive
validation rejected
external verification required
method unsupported
execution anomaly
```

Do not issue a successful-looking certificate merely because an operation was attempted.

---

# 38. Certificate minimum content

A successful certificate should identify:

```text
certificate/report ID
organization/customer
device/session reference
available device identifiers
target storage scope
sanitization category
sanitization technique
method qualification/version
tool/adapter and version
operator
authorization
execution time
verification method
verification outcome
validation decision
validator/reviewer where required
limitations/exclusions
final disposition if recorded
canonical evidence/report digest
```

This aligns the product with an auditable sanitization program rather than a single reset button.

---

# 39. NIST reference in report

Do not place a NIST reference in a way that implies:

- NIST certified CYVRA;
- NIST certified a specific Android reset;
- the device achieved Purge merely because Rev. 2 is cited.

Permitted conceptually:

```text
Sanitization program / terminology aligned to NIST SP 800-88 Rev. 2
```

Method outcome must separately state:

```text
Clear / Purge / external / unclassified
```

only when qualification and validation support it.

---

# 40. Current report-engine issue

Current `HostReportEngine.generateSanitizationCertificate()`:

- always constructs a Sanitization Certificate object;
- includes `NIST SP 800-88 Rev. 2`;
- copies the verifier's assurance string;
- derives post-reset transport wording from a Boolean;
- can therefore amplify a weak verification result into a stronger-looking final document.

Target correction:

```text
validation decision
      ↓
if ACCEPTED
    create successful certificate
else
    create attempt/verification report
```

Report generation must never upgrade assurance.

---

# 41. Canonical report integrity

The final sanitization report must follow the canonical report architecture.

Use:

```text
canonical manifest
      ↓
SHA-256 digest
      ↓
JSON / PDF / web renderings
```

The digest provides integrity evidence.

A digital signature, if later added, is a separate controlled signing feature.

Do not require a long-lived private signing key on every customer workstation merely to compute SHA-256.

---

# 42. Final report evidence binding

The final sanitization manifest must bind:

```text
Report 1 / pre-sanitization manifest
operationId
sessionDeviceRef
authorization record
method qualification
execution evidence
reconnect evidence
verification evidence
validation decision
limitations
```

Later sanitization must not rewrite Report 1.

---

# 43. Licence accounting boundary

Sanitization authorization is not the same as Device Verification scan consumption.

Preserve the previously frozen transaction principle:

```text
Device Verification starts/reserves
      ↓
Report 1 freeze
      ↓
scan consumption finalizes
```

A sanitization workflow may have its own entitlement/policy check.

Do not double-consume the original verification merely because sanitization follows.

---

# 44. Offline behavior

Passive/local sanitization capability assessment may occur offline.

Actual destructive execution should default to stronger authority.

If product policy permits offline destructive action in the future, it requires:

- cryptographically protected offline authorization;
- expiry;
- operation/session binding;
- anti-replay;
- audit reconciliation.

Do not invent a permanent fixed offline-grace duration in architecture.

---

# 45. Failure recovery

Every destructive method must define interruption behavior.

Examples:

```text
desktop process exits
Windows restarts
USB cable removed
device loses power
device never reconnects
tool returns error
device reappears as different transport
multiple devices appear
```

The application must resume from persisted operation state without guessing success.

If completion cannot be established:

```text
VERIFICATION_INCONCLUSIVE
/
EXTERNAL_REVIEW_REQUIRED
```

---

# 46. Idempotency and destructive replay

Destructive commands must not be blindly replayed after timeout.

Each operation has a unique:

```text
operationId
```

Execution state must distinguish:

```text
never sent
sent / outcome unknown
completed
failed
```

If outcome is unknown after disconnect:

> verify/reconcile before deciding whether retry is safe.

Automatic retry of a destructive command is prohibited unless the method-specific adapter explicitly proves idempotent safe retry behavior.

---

# 47. Audit events

Append-only audit should cover:

```text
sanitization workflow created
target selected
method assessed
method selected
authorization step 1
authorization step 2
server/policy authorization
pre-record frozen
execution started
tool status
device disconnected
device reconnected
same-device correlation
verification signals
verification result
validation decision
report/certificate frozen
manual override/review
```

A later correction appends an event; it does not erase the prior event.

---

# 48. Manual override

Manual review may resolve an inconclusive automated result.

It must never silently convert an unsupported method into qualified Purge.

Manual review records:

```text
reviewer
time
evidence reviewed
decision
reason
policy authority
```

A manual exception does not rewrite machine evidence.

---

# 49. Capability engine corrections

Current `DeviceCapabilityAssessment` can mark a capability `SUPPORTED`/`isAvailable`.

Sanitization execution needs stronger data.

Target method eligibility must incorporate:

```text
capability availability
+
authority availability
+
method qualification
+
target device/software scope
+
storage scope
+
current transport prerequisites
+
policy eligibility
```

`isAvailable = true` alone must not enable a destructive button.

---

# 50. Method selection corrections

Current workflow allows `selectMethod()` after operator barrier passage.

Production selection must reject any method that is not:

- present in the assessed eligible-method set;
- qualified for this target;
- allowed by policy;
- supported by the chosen adapter.

UI choice cannot override method eligibility.

---

# 51. Authorization order

The safer production order is:

```text
1. select/correlate target
2. assess qualified methods
3. select allowed method
4. show exact method + effect + limitations
5. freeze pre-operation evidence
6. obtain server/policy authority if required
7. operator acknowledgement
8. target-bound final confirmation
9. immediate re-check of target identity/state
10. execute
```

If device topology changes between confirmation and execution:

```text
authorization becomes stale
```

and must be repeated/revalidated.

---

# 52. UI language

Use:

```text
Platform Factory Reset
Qualified Clear
Qualified Purge
Cryptographic Erase — only when qualified
OEM Sanitization — only when qualified
External Verification Required
Sanitization Not Supported
```

Avoid generic UI buttons such as:

```text
SECURE ERASE
MILITARY GRADE WIPE
NIST WIPE
100% UNRECOVERABLE
GUARANTEED PURGE
```

unless the underlying qualified evidence specifically supports the claim.

---

# 53. Method qualification matrix

For each supported device/method release, record at least:

```text
OEM
model/family
Android build/version range
storage technology/scope
method category
technique
authority
tool/API
tool/API version
expected duration
expected disconnect/reboot
completion signal
known error signals
areas addressed
known excluded areas
verification procedure
validation rule
hardware test result
last qualification date
qualification owner
```

---

# 54. Minimum hardware acceptance scenarios

For every sanitization method promoted beyond simulation:

```text
A. authorized normal execution
B. unauthorized attempt
C. wrong-device/identity ambiguity
D. multiple devices connected
E. cable disconnect before trigger
F. disconnect immediately after trigger
G. desktop process termination after trigger
H. device reboot/reconnect
I. ADB unavailable after reset
J. WPD/USB-only post-state
K. tool reports error
L. tool reports success but expected state absent
M. expected state present but anomaly recorded
N. removable storage present
O. secondary/work profile where supported
P. repeated operation/replay attempt
Q. unsupported OEM/device
R. external verification required
```

No production method skips failure-path hardware testing.

---

# 55. Clean-machine acceptance

Before release:

- install signed customer package on clean Windows 10;
- install on clean Windows 11;
- verify required runtimes/tools are bundled or correctly installed;
- verify no Android Studio requirement;
- verify no developer JDK requirement for customer use;
- verify USB/WPD behavior;
- verify method-specific prerequisites;
- verify recovery after reboot;
- verify final report;
- verify uninstall/update boundaries.

---

# 56. Current maturity assessment

At the current repository baseline:

| Capability | Maturity |
|---|---|
| Sanitization data models | `UNIT-TESTED` |
| Two-step confirmation model | `UNIT-TESTED` |
| Dry-run workflow | `UNIT-TESTED` |
| Generic ADB destructive triggers | implemented in code but **UNQUALIFIED** |
| Same-device reconnect proof | **NOT IMPLEMENTED END-TO-END** |
| Multi-signal post-reset verification | **NOT IMPLEMENTED** |
| NIST Clear validation by qualified device procedure | **NOT HARDWARE-VALIDATED** |
| NIST Purge method | **NOT QUALIFIED** |
| Cryptographic erase | `MODELLED`, not qualified |
| OEM secure erase | `MODELLED`, not qualified |
| Device Owner wipe | conditional/future |
| Production successful sanitization certificate | **NOT RELEASE-VALIDATED** |

This table governs wording until new evidence is produced.

---

# 57. Required Phase 2 corrections

Before destructive execution can be promoted:

1. remove destructive fallback branch in `HostSanitizationProvider.execute()`;
2. make unsupported/unqualified method default to rejection;
3. separate simulation from real execution state;
4. prevent simulation from entering certification path;
5. introduce method qualification registry/contract;
6. bind target to `SessionDeviceRef`;
7. make reconnect identity evidence real and mandatory;
8. stop treating `!screenLockPresent` as Setup Wizard proof;
9. stop treating lock absence as proof that user data is inaccessible;
10. replace single-signal verification with method-specific multi-signal verification;
11. separate verification from validation;
12. prevent NIST/Clear assurance labels before accepted validation;
13. gate method selection by qualified eligible methods;
14. harden destructive-operation idempotency/retry;
15. bind final report to canonical evidence/report digests;
16. separate successful certificate from unsuccessful attempt report.

---

# 58. Required Phase 3 integration

After correction:

```text
Rust/Tauri device snapshot
      ↓
Protocol V2
      ↓
Kotlin sanitization eligibility
      ↓
React target/method UX
      ↓
server entitlement/policy authority
      ↓
target-bound authorization
      ↓
method adapter
      ↓
native reconnect observations
      ↓
verification
      ↓
validation
      ↓
canonical final report
```

No layer duplicates the other's truth.

---

# 59. Hardware-proof gate

A method is not `HARDWARE-VALIDATED` until:

- execution tested on real supported target hardware;
- failure paths tested;
- reconnect tested;
- same-device correlation tested;
- expected storage scope documented;
- verification procedure tested;
- anomalies tested;
- report limitations validated.

One successful reset on one handset is not a universal Android qualification.

---

# 60. Release-proof gate

A method is not `RELEASE-VALIDATED` until:

- supported hardware matrix is frozen;
- installer/runtime is clean-machine proven;
- operator UX is integrated;
- policy/entitlement is integrated;
- audit is integrated;
- report/certificate is integrated;
- code signing/release artifacts are controlled;
- support documentation states exact scope/limitations.

---

# 61. External verification path

When CYVRA cannot validly verify or validate the sanitization outcome:

```text
REQUIRES_EXTERNAL_VERIFICATION
```

is a correct result.

The product should explain:

- what CYVRA observed;
- what remains unknown;
- why the automated outcome is insufficient;
- what category of external process is required.

Do not disguise external-required status as product failure.

---

# 62. Unsupported method path

When no qualified method exists:

```text
SANITIZATION_UNSUPPORTED
```

CYVRA may still provide:

- Device Verification Report;
- capability evidence;
- limitations;
- recommended organizational disposition.

It must not offer a generic reset button as a substitute for unsupported sanitization.

---

# 63. Data minimization during verification

Sanitization verification should avoid accessing customer content.

Where metadata checks are required:

- collect only the minimum fields needed;
- do not open files by default;
- do not upload content;
- do not reconstruct private information;
- record the verification method.

This remains consistent with the WPD metadata-first boundary.

---

# 64. Error semantics

Use stable sanitization error categories.

Examples:

```text
SAN_TARGET_AMBIGUOUS
SAN_TARGET_CHANGED
SAN_METHOD_UNQUALIFIED
SAN_METHOD_UNSUPPORTED
SAN_AUTH_REQUIRED
SAN_AUTH_STALE
SAN_POLICY_DENIED
SAN_PRE_RECORD_MISSING
SAN_EXECUTION_FAILED
SAN_EXECUTION_OUTCOME_UNKNOWN
SAN_RECONNECT_TIMEOUT
SAN_RECONNECT_IDENTITY_MISMATCH
SAN_VERIFICATION_INCONCLUSIVE
SAN_VALIDATION_REJECTED
SAN_EXTERNAL_VERIFICATION_REQUIRED
```

Exact codes are frozen at implementation.

---

# 65. Security prohibitions

CYVRA sanitization must not use:

- password/PIN/pattern bypass;
- FRP bypass;
- exploit/root to gain unauthorized authority;
- bootloader unlock merely to obtain wipe capability;
- arbitrary technician shell;
- unauthorized firmware flashing;
- undocumented destructive tricks presented as qualified methods.

If required authority is unavailable:

```text
UNSUPPORTED / EXTERNAL PROCESS REQUIRED
```

---

# 66. Reporting language examples

## Acceptable before qualification

```text
Platform Factory Reset triggered.
Device reboot observed.
Post-reset state evidence collected.
Sanitization validation requires external review.
```

## Acceptable after qualified Clear validation

```text
Sanitization method: Clear
Technique: [qualified technique]
Validation: Accepted
Limitations: [...]
```

## Not acceptable without proof

```text
NIST Purge Complete
Cryptographic Erase Complete
All data permanently unrecoverable
100% secure erase
```

---

# 67. Current documentation corrections implied by this contract

Later P1.5 rewrites must update:

```text
CUSTOMER_PURGE_UX.md
CUSTOMER_REPORT_ARCHITECTURE.md
CUSTOMER_TEST_MATRIX.md
CUSTOMER_DESKTOP_PRODUCT_SPEC.md
```

because those files still use language that can imply:

- an ADB reset trigger is a valid generic production method;
- OOBE alone is final verification;
- a final purge certificate naturally follows reset;
- current report code is already an authoritative release implementation.

Do not archive those documents before their active replacements are complete.

---

# 68. NIST SP 800-88 Rev. 2 alignment note

The current CYVRA architecture adopts these Rev. 2 principles:

- distinguish Clear, Purge, Destroy;
- qualify the technique appropriate to the media/device;
- establish trust in the implementation/tool;
- verify that the sanitization technique completed as expected;
- evaluate errors/anomalies;
- validate whether the outcome is acceptable;
- record method/technique/tool/version/verification/validation details.

CYVRA does not claim NIST endorsement or certification.

---

# 69. Final sanitization principle

The permanent CYVRA Mobile sanitization principle is:

> **A destructive command is not a sanitization result. A reboot is not verification. Verification is not validation. A certificate is issued only when the selected method was qualified for the target, execution evidence is coherent, the same physical device is correlated, verification is sufficient, and validation accepts the outcome. When those conditions are not met, CYVRA reports the limitation instead of inventing assurance.**

This is the active sanitization architecture for subsequent CYVRA Mobile implementation.
