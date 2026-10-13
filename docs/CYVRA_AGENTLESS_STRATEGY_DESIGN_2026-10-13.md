# CYVRA — Agent-Less Attempt Strategy and Fallback Design

**Date:** 13-Oct-2026
**Authority:** Chief Engineer instruction, 13-Oct-2026 — *"try agent-less 5 times for all
activity, on failure fall back to agent-based, operation must always complete, user must
never face not-scanning/not-purging, only captured in log."*
**Status:** DRAFT for Chief Engineer ratification. **Not implemented.**
**Governing holds:** H3 (no capability claimed without evidence) · H6 (destruction gated on
live entitlement) · **H8 (agent-less research must not make itself look better)**

---

## 0. Provenance rule applied to this document

Every statement below carries one of four labels. Nothing is stated without one.

| Label | Meaning |
|---|---|
| **MEASURED** | We ran it on bench device D-P5 and recorded the output. Re-executable. |
| **SOURCE-CITED** | Stated in a supplied or committed document, **not** re-executed by us. |
| **BELIEF** | Our inference. Unproven. Labelled so it can be challenged. |
| **UNAVAILABLE** | Could not be researched. No guess substituted. |

**Global technology research: UNAVAILABLE.** Web search returned zero results on both
attempts made 13-Oct-2026. Per the standing rule, guesses are **not** substituted for
research that cannot be performed. This design is therefore built from two supplied
documents plus our own bench measurements, and is explicitly a *design*, not a survey.

---

## 1. Definition — what "agent-less" means here

**Agent-less = nothing belonging to CYVRA is installed on the device.**

This distinction decides the whole design, so it is stated precisely:

- **The Android Debug Bridge is not an agent.** It ships with the device's own OS. Running
  `adb shell <cmd>` installs nothing of ours.
- **Therefore an ADB-based route satisfies "zero-install of CYVRA software."** MEASURED —
  our Q1 probe set already ran this way.
- **But it does not satisfy "zero-setup on the device."** ADB requires *USB debugging* to be
  enabled and the host's RSA key to be authorised by a person on the device. SOURCE-CITED
  (supplied research, §"RSA key auth"); consistent with our own `CON-002`/`CON-003`, which
  model reachability and authorisation as two distinct preconditions.

**The product must therefore say which of the two it means, in those words.** Claiming
"zero-install" is supportable. Claiming "nothing to do on the device" is not, unless the
authorisation step is disclosed.

---

## 2. Assessment of the two supplied research documents

Both were read in full. Claims were tested against our own measurements rather than
accepted.

### 2.1 `advanced_usb_protocols_adb_security.txt` (SOURCE-CITED)

| Claim in the document | Our position | Label |
|---|---|---|
| Host can execute commands through an active ADB channel | **Agrees** — this is what Q1 measured | MEASURED |
| `pm uninstall -k --user 0 <pkg>` silently removes apps | **Partly.** We measured that all five removal attempts **refuse** for a device-owner app (`DELETE_FAILED_DEVICE_POLICY_MANAGER`). The document does not disclose that carve-out. | MEASURED |
| `rm -rf /sdcard/DCIM` deletes user media | **Plausible, not yet run by us.** Agent-less tier candidate — must be measured before it is claimed. | BELIEF |
| `fastboot wipe userdata` formats userdata | **True only with an unlocked bootloader.** D-P5's bootloader is **locked** — MEASURED. Route closed on our bench device. | MEASURED |
| Shell runs as UID 2000 on production devices | **Agrees exactly** with our measured `uid=2000(shell)` | MEASURED |
| Shell has "elevated permissions … access app data" | **Overstated as written.** Shell cannot read another app's private `/data/data` on a production, SELinux-Enforcing device. D-P5 is MEASURED as Enforcing. | MEASURED |
| MTP can delete files, but cannot execute, uninstall or change system settings | **Agrees** with our understanding; consistent with the document's own limits | SOURCE-CITED |
| RNDIS/NCM gives network only, cannot delete apps | **Agrees** | SOURCE-CITED |

### 2.2 `gemini-code-1791862904656.txt` (SOURCE-CITED)

| Claim in the document | Our position | Label |
|---|---|---|
| ADB is the primary off-network time channel | **Plausible.** We have not measured time injection. | BELIEF |
| Agent *"pushes a small companion agent application"* | **This is not agent-less.** By our own §1 definition, pushing an APK is exactly the agent-based route. The document describes our *fallback*, not our *primary*. | — |
| Shell has *"system-level permissions to overwrite the Android RTC"* | **Doubtful and likely overstated.** Setting system time on a production device is a privileged permission, not a shell capability. **Not measured by us.** | BELIEF |
| RNDIS → NTP → SNTP client can correct time | **Plausible**, unmeasured | BELIEF |
| MTP `DateTime` (0xD411) can set the device clock | The document **hedges this itself**: *"modern consumer Android versions often restrict MTP from changing the core OS system clock."* Treat as unreliable. | SOURCE-CITED |

**Net:** four claims corroborate our measurements, four are plausible-but-unmeasured, three
are overstated or self-contradicted. **Nothing in either document contradicts a measurement
we took on D-P5.**

---

## 3. What the research actually changes

### 3.1 The reframe — agent-less is wider than we credited

Previously recorded position (belief, 12-Oct): *"no known Android mechanism erases user data
agent-lessly."*

**Corrected by this research, and by our own measurements read together:**

Agent-less over ADB *can* — as a **BELIEF pending our own measurement**:

1. **Delete user files** under `/sdcard` / `/storage/emulated/0` (SOURCE-CITED, unmeasured by us)
2. **Uninstall unprotected user apps** via `pm uninstall --user 0` (SOURCE-CITED; our MEASURED
   refusal applies specifically to *device-owner* apps, not to ordinary ones)

Agent-less **cannot** on D-P5 — MEASURED, not belief:

3. Remove a device owner — **five methods tried, all refused**
4. Perform a certified factory reset — **only Device Owner `wipeData(0)` achieved it**
5. Format userdata via fastboot — **bootloader locked**

### 3.2 The honest weaker statement (H8 — required wording)

**Agent-less is weaker than agent-based for the certified erase, and this research does not
change that.** What it changes is *scope*: agent-less can plausibly cover more of the data
surface than we had credited — user media and ordinary apps — while still being unable to
produce an attested, verifiable purge on a locked, non-owner device.

This is stated plainly rather than softened: **on our measured device class, agent-less
purge cannot substitute for the agent-based factory reset.** The fallback is not a
convenience; it is the only route that completes the certified operation.

---

## 4. The attempt ladder — design

### 4.1 Principle

The operation **always completes.** Agent-less is attempted up to five times; on exhaustion
or on any unrecoverable condition the product **falls back to agent-based** and finishes.
The user never meets a dead end on scanning or purging. **Every attempt and its outcome is
written to the log** — the user is not shown a failure loop.

### 4.2 Scan — five agent-less attempts

Attempts vary the *method*, not just the retry count, because OEM and Android version
variance is the dominant failure cause.

| # | Route | Basis |
|---|---|---|
| 1 | Primary ADB probe set (the Q1-proven commands) | **MEASURED** obtainable on D-P5 |
| 2 | Alternate command family for the same field (`getprop` ⇄ `dumpsys` ⇄ `/proc` ⇄ `/sys`) | BELIEF — plausible OEM variance |
| 3 | `settings` / `service call` fallbacks where shell-permitted | BELIEF — unmeasured |
| 4 | Reduced probe set: drop fields that failed, continue with the rest | Derived from our `NOT_AVAILABLE` + `ERROR` honesty states |
| 5 | Minimal identity-only set (manufacturer, model, Android version, build) | MEASURED — the smallest Q1-proven core |

**Acceptance:** attempt succeeds if it returns a superset of the minimal identity set.
Partial success is a success, reported field-by-field — never an all-or-nothing failure.

**On all five failing:** fall back to agent-based scan and complete.

### 4.3 Purge — five agent-less attempts, then fallback

| # | Route | Expected result on D-P5 |
|---|---|---|
| 1 | Agent-less user-file removal (`/sdcard` paths) | **BELIEF — not yet measured** |
| 2 | Agent-less uninstall of unprotected third-party apps | **BELIEF — not yet measured** |
| 3 | Alternate command family for 1 and 2 | BELIEF |
| 4 | Platform reset command attempted without device-owner status | **Expected REFUSAL — MEASURED pattern** |
| 5 | Re-check for newly granted authorisation, retry 1 | BELIEF |

**On exhaustion:** **fall back to agent-based** → install agent → establish Device Owner →
`wipeData(0)` → verify. **MEASURED working end-to-end on 12-Oct** (packages 363→333,
third-party 40→4, DO refs 4→0, accounts 1→0, `ro.boot.bootreason=reboot,factory_reset`).

**Critical honesty:** tiers 1–3 of this ladder can only ever be a **partial** removal —
files and ordinary apps. **They cannot produce the certified purge.** Only the fallback
tier can, and it is gated by H6 on a live entitlement.

### 4.4 Logging requirements

- One log line **per attempt**: route used, outcome, elapsed, failure reason.
- Final line records **which tier completed the operation**.
- Log is the *only* place attempt failures are surfaced for the agent-less tiers —
  per the Chief Engineer's instruction, the user is not shown a failure loop.
- **No account names, Gmail addresses, phone numbers or device serial may appear in any log
  line.**

---

## 5. What must be measured before any of this is claimed

Nothing in §4.2 routes 2–5, nor §4.3 routes 1–3, has been executed on hardware by us.

| # | Measurement | Status |
|---|---|---|
| M-a | `rm`-style removal of user media via ADB shell as UID 2000 | **NOT MEASURED** |
| M-b | `pm uninstall --user 0` on a non-device-owner third-party app | **NOT MEASURED** (only the refusal case is measured) |
| M-c | `settings` / `service call` fallback availability on Android 10–14 | **NOT MEASURED** |
| M-d | Whether shell can set the RTC on a production device | **NOT MEASURED** — supplied claim is doubtful |
| M-e | Behaviour of the fallback ladder across **five different model/version pairs** | **NOT MEASURED** — Stage 6 / cross-OEM scope |

Until M-a and M-b are run, §4.3 tiers 1–3 are a **design, not a capability**, and the
product must not say otherwise (H3).

---

## 6. Decision needed

This design is DRAFT. It is not ratified, not implemented, and no code reflects it.

**For the Chief Engineer:** ratify or amend §4 (the ladder) and §5 (the measurement list).
Ratification authorises *measurement* of M-a and M-b on bench device D-P5 — it does not by
itself authorise any claim of capability.
