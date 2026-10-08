# CYVRA T&C, Ownership Attestation & First-Run Consent UI — DRAFT

| Field | Value |
|---|---|
| Status | **`DRAFT — NOT IN FORCE`. Legal review required.** Document only; no UI code changed. |
| Authority | `docs/CYVRA_CORE_ENGINE_JOURNEY_FINAL_V2_2026-10-08.txt` §6 (Level 1, §2.3 of the Project Index) |
| Applies to | Desktop app (`apps/desktop`) first-run flow and purge authorisation flow — **core application**, governed by §2.3 |
| Date | 08-Oct-2026 — TASK O |
| Blocking | Legal review owner for §6 is an open item in the governed document (§10) |
| UI authority note | The Design Freeze (`73d3f3a`) governs the admin panel and the Customer Workspace Spec governs `cyvoriq.co.in/dashboard`; this draft is neither surface, so it adopts their tone rules without restating them |

---

## 1. Status and what this file is

This is the drafting of the six §6 clauses plus the first-run consent copy that the desktop app will
present. **Nothing here is in force.** Each clause is marked `DRAFT` and each UI string is marked
`DRAFT`. Legal review is a precondition to any implementation, and the seat and governing-law
mechanics are still open.

Two hard rules apply while it stays a draft:

1. No UI may ship these strings before legal review is recorded as complete.
2. No clause may be weakened "to make the UI simpler" — if a string is too long, the string changes,
   not the clause.

## 2. Draft clauses

### 6.1 Ownership warranty — `DRAFT`

The customer warrants that they own, or are lawfully authorised to process, every device submitted
to CYVRA Mobile. The customer is **solely responsible** for verifying that devices are not stolen,
lost, encumbered, subject to a claim, or otherwise not theirs to process. CYVORIQ Solutions Pvt.
Ltd. relies on the recorded attestation and does not independently verify ownership.

*Plain language for the UI:* "You confirm you own this device or are authorised to work on it. You
are responsible for checking that. We record your confirmation; we do not check it for you."

### 6.2 Authorization record — `DRAFT`

Every purge requires an explicit in-app authorization event before execution. The event records the
operator, a UTC timestamp, the ownership category selected, and the hash of the attestation text
presented. The same event, with the same fields, is reproduced inside the resulting report.

*Plain language for the UI:* "Your authorization for this erase is recorded and appears in the
report."

### 6.3 Credentials — `DRAFT`

Lock-screen and FRP credentials are entered only by the owner or their authorised operator. CYVRA
never solicits, captures, stores, forwards or transmits plaintext credentials, and never offers to
obtain them on the customer's behalf.

*Plain language for the UI:* "If you know the screen-lock or Google account for this device, enter
it yourself. We never ask for it, keep it, or send it anywhere."

### 6.4 Limitation of assurance — `DRAFT`

Assurance covers only the evidence paths the application actually performs and records. There is no
NAND-level or chip-level warranty. Post-purge verification means the stated evidence only — the
report says what was observed, and says what was not observable, and does not convert one into the
other.

*Plain language for the UI:* "The report lists exactly what was checked and what could not be
checked. It does not claim more than the evidence shows."

### 6.5 Telemetry consent — `DRAFT`

Field telemetry is consented separately, with its scope, cadence, retention window and withdrawal
route stated before consent is given. Consent may be withdrawn at any time; withdrawal stops
further uplink and clears the pending queue, and does not affect the application's ability to
inspect, purge or report.

*Plain language for the UI:* "Optional sharing of engine and diagnostic activity. Choose what is
included and how often. Turn it off whenever you like."

### 6.6 Indemnity — `DRAFT`

The customer indemnifies CYVORIQ Solutions Pvt. Ltd. against claims arising from processing
unlawful, stolen, encumbered or otherwise unauthorised devices. Governed by the laws of India; the
seat is to be finalised by legal.

*Plain language for the UI:* "You are responsible for lawful devices. Indian law applies; the
details of where disputes are heard are being finalised."

---

## 3. First-run consent UI — screen copy (all `DRAFT`)

Copy is written for the desktop app. Button labels are verbs; body text is sentences; no claim
outruns its evidence.

### S1 — Welcome and terms

| Element | Copy |
|---|---|
| Heading | Welcome to CYVRA Mobile |
| Body | Before you start, two things: you confirm you are allowed to work on the devices you connect, and you agree to the terms below. |
| Link 1 | Read the terms |
| Link 2 | Read how we handle data |
| Checkbox (required) | I have read and agree to the terms, and I confirm I am authorised to work on the devices I connect. |
| Primary button | Continue |
| Secondary button | Exit |

### S2 — Ownership attestation (per device, before any purge)

| Element | Copy |
|---|---|
| Heading | Confirm you may work on this device |
| Body | Choose how you are authorised. Your answer is recorded and appears in the report. |
| Option A | I own this device |
| Option B | I am authorised by the owner |
| Option C | It is a company device under my administration |
| Option D | I am not sure — stop |
| Checkbox (required) | I confirm the statement above is true for this device, and I accept responsibility for checking it. |
| Primary button | Record and continue |
| Behaviour | Option D ends the flow without a purge and records `OWNERSHIP_NOT_CONFIRMED`. |

### S3 — Purge authorization (destructive action)

| Element | Copy |
|---|---|
| Heading | This erase cannot be undone |
| Body | Erasing removes the device's user data and reboots it to the setup screen. A technician must reconnect afterwards to collect the evidence. |
| Body 2 | This report will state what was checked and what could not be checked. It will not claim more than the evidence shows. |
| Input | Authorisation reference (optional) |
| Warning | Do not continue unless S2 was recorded for this device. |
| Primary button (hold-to-confirm) | Hold to erase device data |
| Secondary button | Cancel |
| Note | Hold-to-confirm is required: this action must not be reachable by a single stray click. |

### S4 — Telemetry consent (optional, off by default)

| Element | Copy |
|---|---|
| Heading | Help improve device capability data |
| Body | Optional. Share engine version, patch-set version, diagnostic outcomes and host logs with the CYVRA core engine so capability guidance improves for your device model. |
| Scope rows | Engine and patch-set state — included / Diagnostic outcomes and host logs — included / Device evidence such as images or device details — excluded |
| Cadence row | Check-in frequency: On connect only / Daily / Weekly |
| Retention line | Shared data is kept for 180 days, then deleted. |
| Consent line | You can turn this off at any time; turning it off stops sharing and clears anything waiting to be sent. |
| Checkbox (default unchecked) | I agree to share the items I have left included. |
| Primary button | Save choices |
| Secondary button | Share nothing |

### S5 — Lock and FRP credential notice

| Element | Copy |
|---|---|
| Heading | If the device asks for a lock or account |
| Body | Enter these only if you are the owner or you are authorised by the owner. CYVRA never asks for, keeps or sends these credentials. |
| Notice | If you do not have them, stop here. CYVRA does not bypass these checks. |
| Primary button | I understand |

### S6 — Report limitation notice

| Element | Copy |
|---|---|
| Heading | What this report means |
| Body | It records the evidence the application collected on this run, including anything it could not observe. Software evidence and physical checks are labelled separately. |
| Body 2 | Some conditions can only be judged by a person looking at the device. Where that applies, the report says so instead of giving a result. |
| Primary button | Close |

---

## 4. Authorization event record (§6.2)

Produced by S2/S3 and reproduced verbatim in the report:

| Field | Type | Rule |
|---|---|---|
| `operator_id` | string | Local operator reference; MUST NOT be derived from a device identifier. |
| `timestamp_utc` | string | RFC 3339 UTC, single clock source. |
| `ownership_category` | enum | `OWNED` \| `AUTHORISED_BY_OWNER` \| `CORPORATE` \| `NOT_CONFIRMED`. |
| `attestation_text_hash` | string | Hash of the exact S2 text presented — proves *which* wording was accepted. |
| `consent_id` | string/null | Links the telemetry consent if one exists. |
| `device_token` | string | Same-device confirmation key only (governed doc §4); never an identifier claim. |
| `report_id` | string | The report that reproduces this event. |

`NOT_CONFIRMED` MUST terminate the flow before any purge step is reachable.

## 5. Prohibited claims in this UI

The draft must not contain — and the shipped UI must not contain — any of the following:

| Prohibited | Why |
|---|---|
| An absolute statement that all data is gone | Spec §29: no claim beyond available evidence; no NAND-level warranty |
| A statement that the device is now in perfect condition | Spec §25/§82: physical conditions need physical verification |
| Any wording implying third-party certification of a device or report | Statutory boundary; no standards body is being invoked here |
| A software result presented as a physical inspection | Spec §25: software evidence, functional test and physical verification are distinct |
| "Not tested" rendered as a failure, or "not observable" rendered as a pass | Spec §82 — no false automation |
| An identifier that was not actually read | Spec §24 / §103 — never fabricate |
| A feature that does not yet work, shown as working | Spec §103 |

Where a value is unavailable, the UI shows the status token for it — `NOT EXPOSED`, `RESTRICTED`,
`NOT COLLECTED` — and keeps the field, rather than deleting it and losing the fact.

## 6. Legal review checklist (blocking)

- [ ] Ownership warranty wording reviewed against Indian law and consumer-protection position.
- [ ] Indemnity scope and the seat of dispute resolution finalised (§6.6).
- [ ] Telemetry retention window confirmed or amended (currently proposed at 180 days).
- [ ] Credential clause reviewed against data-protection obligations.
- [ ] Limitation-of-assurance clause reviewed for enforceability.
- [ ] Cross-border transfer position for fleet telemetry confirmed.
- [ ] Consent text versioning strategy agreed (`tcs_version` + `attestation_hash`).
- [ ] Named legal review owner assigned (governed document §10 open item).

## 7. Conformance checklist

- [ ] Every clause and string in this file is marked `DRAFT`.
- [ ] No UI ships before the §6 checklist is complete.
- [ ] S2 is mandatory and `NOT_CONFIRMED` terminates before purge.
- [ ] S3 uses hold-to-confirm; the destructive action is not single-click reachable.
- [ ] S4 defaults to off and states scope, cadence, retention and withdrawal.
- [ ] S5 states that CYVRA neither asks for nor keeps credentials and does not bypass these checks.
- [ ] No prohibited claim from §5 appears anywhere in the copy.
- [ ] The authorization event (§4) is reproducible in the report.
- [ ] Copy stays within the honesty rules of the governed document §3 and §6.

---

*Documentation only. No desktop UI, service or schema was changed by this file. Legal review pending.*
