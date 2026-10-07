# WS-K1 — Customer Dashboard Rectification Spec

**Surface:** `https://cyvoriq.co.in/dashboard`
**Status:** **SPEC ONLY — NO CODE.** Implementation begins only on explicit Chief Engineer approval.
**Date:** 07-Oct-2026
**Authority:** `docs/design-freeze/admin-panel-design-freeze.txt` @ `73d3f3a` — **Precedence Level 1**, per the N4 ruling recorded in `docs/CYVRA_MOBILE_PROJECT_INDEX.md` §2.1.
**Sequencing constraints honoured:** E8 / E9 / E12 (no new device-data endpoints), P6 (unsigned-artifact honesty), E14 (upgrade path undecided).

---

## 0. How to read this spec

Every defect below carries three things: the **evidence** (file:line in the deployed tree), the **Freeze or governing citation**, and the **required rectification**. Where a defect cannot be fixed without violating a sequencing constraint, that is stated as a *deferred* item rather than quietly skipped.

Maturity vocabulary follows `CYVRA_MOBILE_FINAL_FORENSIC_SYSTEM_DESIGN_BASELINE_2026-09-19.md` §0.2: nothing in this spec is claimed as `HARDWARE-VALIDATED`.

---

## 1. Post-deploy truth verification (07-Oct-2026)

### 1.1 Verified HONEST — already correct, do not disturb

| Surface | Source of truth | Evidence |
|---|---|---|
| Licence / plan / usage header | `GET /v1/me/entitlement` | Live shows `PLAN · 1 Device Scans`, `USAGE · Available after first scan` — the real `CAP-1` row, not the old fabricated `25 Device Scans` |
| Version badge | `GET /v1/me/entitlement` → `build` | Live shows `Build unavailable`; `/build-manifest.json` returns `"state": "unavailable"` (verified 07-Oct, HTTP 200) |
| Installer card | `build-manifest.json` | `CustomerDesktopShell.tsx:862-879` — *"No installer has been published for this product yet. It will appear here, with its SHA-256, the moment a release build exists."* |
| Session count | `api.reportSessions()` | `:954` `{props.sessions.length} recorded session(s)` — honest zero |
| Session rows | `api.reportSessions()` / `api.listReports()` | `:977-982` manufacturer, model, `processingSessionId`, `createdAt` all server-driven |
| Registration plan picker (WS-G) | `PLAN_SLABS` | `api.ts:84` `[1, 5, 10, 25, 50]` — matches §17 exactly |

### 1.2 Verified FABRICATED — client-side, no server or host call anywhere

The code says so itself: `CustomerDesktopShell.tsx:43` — *"C3 & C4: Live Connection & Diagnostic Simulation State"*.

| Fabricated output | Function | Lines |
|---|---|---|
| **A NIST SP 800-88 "verified" erasure with a hardcoded SHA-256** | `executePurgePipeline()` | `300-328` |
| **A sanitization certificate: `SUCCESS_VERIFIED` / `VERIFIED`** | `generateFinalSanitizationCertificate()` | `351-370` |
| Inspection grades S0 / B / F0 — *"All hardware query tests passed on live device"* | `executeDeterministicGrading()` | `450-478` |
| Random SHA-256 forced to `PASSED` | `captureCurrentView()` / `fakeSha` | `625-636` |
| Simulated live diagnostic | `runSimulatedLiveDiagnostic()` | `665` |
| Device connection status | `isUsbPlugged`, `isAdbAuthorized`, `simulatedDevice` | `44-50`, rendered `900-908`, `1030-1053` |

---

## 2. Defect register

### WS-K1-01 — **CRITICAL: fabricated erasure claim and sanitization certificate**

**Evidence.** `executePurgePipeline()` (`:300-328`) makes **no server or host call**. Three `setTimeout`s at 1 s, 2 s and 4.2 s then commit:

```
operationId:        "PURGE-OP-90412"
assuranceLevel:     "NIST_SP_800_88_REV2_CLEAR_PLATFORM_VERIFIED"
sha256Hash:         "c4f92d8e578a10b91e92da94017a421b9c7e0984a92e1059f03d162812ef6412"   // literal
setupWizardDetected / userAccountsRemoved / screenLockAbsent : true
step -> "VERIFIED"
```

`generateFinalSanitizationCertificate()` (`:351-370`) then emits `certificateId: "CYVRA-CERT-2026-90412"`, `executionStatus: "SUCCESS_VERIFIED"`, `verificationStatus: "VERIFIED"`, `standardReference: "NIST SP 800-88 Rev. 2"`, `operatorId: "operator@cyvoriq.co.in"`, and the assertion *"NIST SP 800-88 Rev. 2 Clear level achieved via platform-mediated factory data wipe."*

**Contradicted by the real system.** `apps/host/.../sanitization/HostSanitizationProvider.kt:95` returns `executionStatus = "BLOCKED_NOT_IMPLEMENTED"` under signed decision **D-1 / OUTCOME B**. No destructive ADB command exists anywhere in the repository except inside a denylist.

**Citation.** Canonical Engineering Guideline §13 — *"No release may represent this as universally functioning."* Also §13.3: post-reset verification that infers OOBE from absence of a screen lock is **insufficient** — yet `screenLockAbsent: true` is precisely that inference, hardcoded.

**Required rectification.**
1. Delete `executePurgePipeline()` and `generateFinalSanitizationCertificate()` simulation bodies.
2. Render the **real** state: `BLOCKED_NOT_IMPLEMENTED`, surfaced honestly as *"Purging is not yet enabled for this build."*
3. **Never** render a certificate whose `executionStatus` is not sourced from the host engine.
4. Remove the hardcoded `PURGE-OP-*`, `CYVRA-CERT-*`, `sha256Hash` literals entirely — they must be unobtainable in source.
5. Keep the *UI affordance* (the two-step operator barrier, method selector, post-reset verification panel) — the interaction design is sound; only the fake data source is defective.

**No new endpoint required.** The honest state can be rendered without any device-data endpoint.

---

### WS-K1-02 — CRITICAL: fabricated device/connection status

**Evidence.** `:44-50` — `isUsbPlugged = true`, `isAdbAuthorized = true`, `simulatedDevice.model = "Moto G54 5G (Live Device)"`, rendered at `:900`, `:904`, `:908`, `:1030`, `:1037`, `:1041`, `:1045`.

**Citation.** Forensic Baseline §0.2 — *"A class, test double, document, or passing unit test is not evidence of end-to-end product completion."* A hardcoded device string presented as `Live Device` is stronger than that: it asserts a hardware state that was never observed.

**Required rectification.** Replace with a truthful static state: **no device is known to this page**. Copy must say so plainly (e.g. *"No device session yet — connect a phone to your Windows workstation and run a scan"*), and must not name a model, port, or ADB status.

**Deferred — do not build now.** Live values need a device-state source (E9 → E8 → E12). Out of scope for WS-K1 by explicit Chief Engineer constraint.

---

### WS-K1-03 — HIGH: date/time is not IST and not §19 format

**Evidence.**
- `:982` `{new Date(session.createdAt).toLocaleString()}` — **browser** locale and time zone
- `:2333` `{new Date(report.frozenAt).toLocaleString()}` — same defect
- `:232`, `:316`, `:317`, `:354`, `:361` — fabricated `new Date()` / `new Date(Date.now() - 15000)` timestamps feeding the fake certificates (cleansed by WS-K1-01)

The customer site **does not import** the IST formatter: `git grep 'format/datetime|formatDateTime|ADMIN_TIME_ZONE' -- apps/web/src/site` → **no hits**. The formatter exists only at `apps/web/src/admin/format/datetime.ts`.

**Citation.**
- **§58 DATE AND TIME** (`admin-panel-design-freeze.txt:1448-1463`): *"The Admin UI should display: IST (Asia/Kolkata)"* and — decisive for this surface — *"Date fields should be **consistent across dashboard, registry, drawer and reports**."* The word *dashboard* places this surface in scope.
- **§19 PAYMENT CONFIRMATION UX** (`:517-531`) supplies the exemplar: `05-Oct-2026 09:42 IST`.

A customer in another time zone currently sees a **different date** for the same session than the admin does. That is a §58 violation, not a cosmetic issue.

**Required rectification.**
1. Render every date on the customer surface as `05-Oct-2026` / `05-Oct-2026 09:42 IST`.
2. Zone strictly `Asia/Kolkata`.
3. **Reuse** the existing `formatDate` / `formatDateTime` — do **not** create a third copy. WS-H2 already recorded "two IST formatter modules" as a defect to be extracted to a shared package; this spec should be the trigger for that extraction rather than a third duplicate.

---

### WS-K1-04 — MEDIUM: installer card must stay honest until WS-I

**Evidence.** `:862-879` renders the honest empty state driven by `build-manifest.json` (`"state": "unavailable"`, verified live 07-Oct).

**Citation.** `docs/P6_INSTALLER_VALIDATION.md` artifact policy — *"everything produced by this repository is an **UNSIGNED ENGINEERING ARTIFACT**. There is no code-signing infrastructure. Do not present it as a signed or commercial release."* P6/P7 exit gates are **open, not met**.

**Required rectification.**
1. **Do not** add a download button, version number, or SHA-256 until `build-manifest.json` leaves `unavailable`.
2. When a manifest does appear, the card must carry the unsigned-artifact warning verbatim in substance: *unverified engineering build, not code-signed, not a commercial release*.
3. Keep the current copy — it is correct and must not be "improved" into implying a release exists.

---

### WS-K1-05 — MEDIUM: 25-device upgrade path not surfaced

**Evidence.**
- `api.ts:84` — `PLAN_SLABS = [1, 5, 10, 25, 50]`, an exact match for §17's five standard plans.
- The WS-G picker exists and works at registration: `WorkspaceApp.tsx:48` (`useState<PlanSlab>(PLAN_SLABS[0])`), the `<fieldset className="plan-picker">`, and `api.requestOtp({ ...form, plan })`.
- `CustomerDesktopShell.tsx:113` — *"No upgrade-flow state. The simulated Razorpay handoff that used to live [here]…"* — the upgrade affordance was removed with the old mock and never replaced.
- A signed-in customer has **no path to a higher slab**, and `POST /v1/licence-request` has never existed (**E14**, undecided).

**Citation.** **§17 LICENCE PLAN DISPLAY** (`:462-475`): the Admin Panel must show five standard plans — 1, 5, 10, **25**, 50 Mobile Devices — each representing *1 Windows host workstation + selected mobile-device processing capacity*, with *"Plan data should be configured server-side."*

**Required rectification.**
1. Surface the plan ladder — including **25 Mobile Devices** — to the signed-in customer, using the existing WS-G `PLAN_SLABS` source (single source of truth, server-configured).
2. Present it as an **informational + contact affordance**: state the current slab against the ladder, and offer the existing path to reach CYVORIQ. **No payment flow, no Razorpay, no price calculation, no invented endpoint.**
3. Display must be driven by `entitlement.plan.slab` — never a client-side constant.
4. Subject to **E14**: if the Chief Engineer rules that slabs are fixed at registration, this item becomes *"display only, with an explanatory note"* rather than an upgrade prompt. **Spec cannot proceed past design without that ruling.**

---

### WS-K1-06 — MEDIUM: stale labels and simulated grading copy

**Evidence.**
- `"Moto G54 5G (Live Device)"` — `:50`
- `"Connected (Port 1)"` / `"Authorized & Active"` — `:900`, `:904`
- `"All hardware query tests passed on live device"` — `:468`, inside `executeDeterministicGrading()`'s `setTimeout(..., 1200)` fabrication, alongside hardcoded physical findings (*"Flawless display glass"*, *"Back glass intact — pristine housing"*)
- `"ACTIVE SESSIONS & READY TO FREEZE"` — `:953`; the per-row `READY TO FREEZE` tag at `:987` is **server-driven** and is *not* a defect, since it refers to freezing an evidence report, not to purge.

**Citation.** Freeze §17 (plan display honesty), Forensic Baseline §0.2 (no DONE without maturity).

**Required rectification.** Delete every label that asserts an observation which was never made. In particular remove `executeDeterministicGrading()`, `runBodyAiInspection()`, `runControlledScreenTest()`, `runSimulatedLiveDiagnostic()` and `captureCurrentView()`'s `fakeSha`, replacing each with either real data or an honest "not yet available" state.

**Note.** The honest `0 recorded session(s)` pattern at `:954` is the correct model — follow it.

---

### WS-K1-07 — LOW: two IST formatter modules (pre-existing, triggered here)

**Evidence.** WS-H2 recorded this as an accepted deviation: an IST formatter in `apps/web/src/admin/format/datetime.ts` and a second in `services/api/src/format/datetime.ts`, plus `ADMIN_TIME_ZONE` duplicated once per runtime.

**Required rectification.** WS-K1-03 must not add a third. Extract to a shared package as part of this work, or import the existing module. Verify with a sweep equivalent to WS-H2's: exactly **one** `ADMIN_TIME_ZONE` per runtime.

---

## 3. Explicit non-goals

| Not in WS-K1 | Why |
|---|---|
| New device-data endpoints | **E8/E9/E12 sequencing.** Wiring panels before a real session exists means inventing an endpoint for data nobody produces |
| Live device/connection panels | Depends on the above; deferred |
| Installer release, SHA-256, version badge | **WS-I / E10**; requires CI `contents: write` + `main` trigger + P6 clean-VM validation |
| Payment, checkout, Razorpay | E14 undecided; `POST /v1/licence-request` does not exist |
| Any claim that purge works | **D-1 = OUTCOME B.** Interlock opens only on hardware validation (E3 → G14) |
| Any change to `admin.cyvoriq.co.in` | WS-H2 closed; separate authority |

---

## 4. Phasing

**Phase 1 — Stop the false claims (code, no infrastructure).**
WS-K1-01, WS-K1-02, WS-K1-06. Highest severity; every one is a client-side deletion or honest replacement. No endpoint, no DB, no deploy dependency.

**Phase 2 — Date/time conformance.**
WS-K1-03 + WS-K1-07. Extract-or-reuse the formatter, fix `:982` and `:2333`.

**Phase 3 — Honesty surfaces.**
WS-K1-04 (installer copy guard) and WS-K1-05 (plan ladder), the latter **blocked on E14**.

---

## 5. Acceptance gates

1. `pnpm.cmd -r typecheck` → exit 0.
2. `pnpm.cmd -r test` → exit 0, no regression against the 07-Oct baseline (web 261, api 395, desktop 71, evidence 26).
3. **New tests required:**
   - No rendered element on `/dashboard` derives from `simulatedDevice`, `isUsbPlugged`, `isAdbAuthorized`, `fakeSha`, `PURGE-OP-`, or `CYVRA-CERT-`.
   - Every date rendered by the customer surface matches `^\d{2}-[A-Z][a-z]{2}-\d{4}( \d{2}:\d{2} IST)?$`.
   - §19 exemplar asserted verbatim: `05-Oct-2026 09:42 IST`.
   - Zone asserted as `Asia/Kolkata`.
   - The strings `NIST_SP_800_88_REV2_CLEAR_PLATFORM_VERIFIED` and `SUCCESS_VERIFIED` **do not occur** in `apps/web/src/site/**`.
   - Plan ladder sourced from `PLAN_SLABS`, and 25 is present.
   - Installer card renders no download affordance while `build.state === "unavailable"`.
4. **Sweep:** `git grep -i "Asia/Kolkata" -- apps/web services/api` shows one constant per runtime; `git grep -n "toLocaleString" -- apps/web/src/site` → **no hits**.
5. `npx.cmd wrangler deploy --dry-run` → exit 0.
6. **Post-deploy:** re-run §1.1 and confirm every row still honest, and §1.2 is empty.

---

## 6. Decisions required before code

| # | Decision | Blocks |
|---|---|---|
| **E15** | Lift or waive the P1.5 documentation freeze | **All product code in Phases 1–3** |
| **E14** | Slab chosen once at registration, or upgradable later? | WS-K1-05 wording and whether it is a prompt or a display |
| **—** | Approve Phase 1 (delete fabricated purge/grading/device data) | First code change |

**Sequencing opinion:** Phase 1 is the only part of WS-K1 that is unblocked by neither hardware nor a new endpoint, and it removes a *false erasure claim from a customer-facing production page*. Subject to E15, it is the highest-value, lowest-risk first move available.

---

## 7. Traceability

| Constraint | Where honoured |
|---|---|
| Design Freeze = Precedence Level 1 (N4) | §1, §2 citations; `PROJECT_INDEX.md` §2.1 |
| No new device-data endpoints (E8/E9/E12) | §3 non-goals; WS-K1-01/02 "no endpoint required" |
| Honest installer-card state until WS-I | WS-K1-04 |
| Surface 25-device path via WS-G plan picker | WS-K1-05 |
| IST per §58 | WS-K1-03, gates 3/4 |
| Date style per §19 | WS-K1-03, gate 3 |
| Unsigned-artifact warning per P6 | WS-K1-04 |
| Purge not representable as working (D-1, Canonical §13) | WS-K1-01, §3 |
