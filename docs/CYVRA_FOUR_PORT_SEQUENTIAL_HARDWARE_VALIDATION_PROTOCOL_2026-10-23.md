# CYVRA Mobile — Four-Port Sequential Hardware Validation Protocol

**Status: DRAFT — NOT AUTHORIZED FOR EXECUTION.**
Prepared 23-Oct-2026 as part of Phase 5 (WP-S1). **No hardware was connected,
scanned, sanitized or otherwise operated in Phase 5.** Execution requires a
separate, explicit instruction from the project owner that names this protocol.
Until that instruction exists, every step below is planning text only.

---

## 1. What this protocol can and cannot establish

**If executed and its evidence reviewed, this protocol supports exactly one
claim:** *four-port, single-device sequential hardware validation* — that one
physical Android phone was handled correctly across four physical USB port
positions, one at a time, in randomized order, with device identity, scan state
and report binding verified at each position.

It does **not** and cannot establish:

- concurrent operation of more than one device, at any port count;
- any device capacity above 1 (four ports, one phone, sequential);
- 100% validation of the application;
- sanitization/erasure execution (the destructive trigger stays hardware-gated
  under decision D-1 and is out of scope here);
- release readiness (the one-shot gate remains the release authority).

### The four distinct values (owner decision D7, Option C)

Record these as four separate numbers in every log and summary. They are never
merged and never substituted for one another:

| Value | Meaning | This session |
|---|---|---|
| Licensed device quota | what the licence key entitles | record from licence |
| Devices currently detected | what the Host inventory reports | record per run |
| Active processing sessions | device-scoped operations running now | 1 at a time |
| Highest experimentally validated capacity | proven by execution only | 1 until a wider test proves otherwise |

A licence slab of 1–50 is an entitlement, not a capacity measurement.

---

## 2. Prerequisites

| # | Prerequisite | Status |
|---|---|---|
| 1 | Separate explicit owner authorization naming this protocol | **OUTSTANDING — blocks execution** |
| 2 | One physical Android phone, USB debugging enabled and host-authorized | to be confirmed at session start |
| 3 | Expected device serial recorded in the session header **before the first run** | at session start |
| 4 | USB extender and four physical USB ports, each with a durable physical label (P1, P2, P3, P4) applied to the host chassis before randomization | at setup |
| 5 | Test environment unburdened by heavy parallel jobs (worker timeouts have been observed under load) | at session start |
| 6 | Per-run evidence capture ready: timestamped log, screenshots, export artifacts | at session start |

---

## 3. Randomized port order

1. After the four ports are physically labeled P1–P4, generate a random order
   of the four labels (for example a random shuffle from a recorded tool) and
   write it into the session header **with the generation timestamp** before
   any run begins.
2. The generated order is fixed once recorded. It is never redrawn, re-rolled
   or rearranged after results are known.
3. Each run sheet names its port label and position (1st/2nd/3rd/4th) up front;
   the executor follows the sheet, not preference.

---

## 4. Per-run procedure (repeat four times, one per port position)

For each run, record every line of Section 6's log template. "Expected" is what
must happen; any deviation without a clear, evidenced explanation fails the run.

1. **Connect** the phone (via the extender) to the run's port label.
   Record connect timestamp.
2. **Identity on detection.** When the Host inventory reports the device,
   record the detected serial. Expected: it equals the session's expected
   device serial. Identity check #1.
3. **Scan.** Execute the scan. Expected: success, with `sessionUuid`,
   `reportId` and the scanned serial captured from the responses.
4. **Identity on the scan result.** Verify the report header carries the
   expected serial (identity check #2 — the scan is bound to the phone that
   was physically attached, not to a previous run's session).
5. **Ownership negative check** (protocol-level; does not touch the phone):
   issue a device-scoped request naming a deliberately wrong serial. Expected:
   `SERIAL_MISMATCH` refusal with an empty payload.
6. **Absent-serial compatibility check** (the single-session UI path): issue
   the same device-scoped request with no serial. Expected: served from the
   active Host-side scan for this run.
7. **Evidence/report binding.** Export/review the report for this run.
   Expected: the export and every downstream panel reference this run's
   `reportId`/`sessionUuid` and this run's serial — never a previous run's.
8. **Disconnect.** Remove the phone. Record the disconnect timestamp and
   observe (do not presume) what the UI and Host present afterwards: the
   disconnected phone's scan must not be presented as a current target.
   Record the actual behaviour of both, including whether the Host retained or
   cleared scan state.
9. **Stale-session invalidation check.** After disconnect, confirm the UI's
   scan-target binding for the removed phone is invalidated (it must not be
   presented as current). If any component presents an ambiguous state —
   neither clearly bound nor clearly cleared — the run FAILS.
10. **Reconnect/recovery.** On the next run's port, reconnect and repeat from
    step 1. A subsequent valid scan must complete normally (recovery), and its
    session identifiers must differ from all previous runs.

**Ambiguity rule (mandatory):** any ambiguous device identity, any
cross-session evidence (a run presenting a previous run's `sessionUuid` or
`reportId` as its own), or any unexpected device binding **fails that run and
fails the session.** Ambiguity is never resolved in the test's favour.

---

## 5. Pass / fail criteria

| Level | Pass requires | Otherwise |
|---|---|---|
| Per run | Steps 1–10 all match their expected outcomes, with timestamps and identifiers recorded | run FAIL |
| Session | All four runs PASS | session FAIL |
| Claim | Only after the session passes **and** its evidence is reviewed | claim withheld |

A session that passes supports **only** the four-port single-device sequential
claim from Section 1. It never upgrades any of the four D7 values above 1
experimentally validated device.

---

## 6. Per-run log template

| Field | Run 1 | Run 2 | Run 3 | Run 4 |
|---|---|---|---|---|
| Port label (physical, pre-assigned) | | | | |
| Order position (from recorded randomization) | | | | |
| Connect timestamp | | | | |
| Detected serial (expected = session serial) | | | | |
| Identity check #1 result (detected) | | | | |
| Scan start / end timestamps | | | | |
| Scan result (success/failure) | | | | |
| `sessionUuid` / `reportId` captured | | | | |
| Identity check #2 result (scan binding) | | | | |
| Wrong-serial request → `SERIAL_MISMATCH`, empty payload | | | | |
| Absent-serial request → served from this run's scan | | | | |
| Evidence/export bound to this run's identifiers | | | | |
| Disconnect timestamp + observed UI/Host state | | | | |
| Stale-session invalidation observed | | | | |
| Recovery scan (next run) succeeded, new identifiers | | | | |
| Expected outcome | | | | |
| Observed outcome | | | | |
| Evidence references (log lines, screenshots, artifacts) | | | | |
| PASS / FAIL (per ambiguity rule) | | | | |

Session header (filled before run 1): date, executor, expected device serial,
port labels applied, randomization method + timestamp + generated order,
ambient conditions worth noting (OS build, Host build/commit, ADB availability).

---

## 7. Explicit non-claims

- Hardware sanitization is **not** exercised (D-1 gate; separately governed).
- No CI, packaging or release action is implied by executing this protocol.
- A passing session is a hardware milestone, **not** a product-readiness
  claim, **not** evidence of concurrent multi-device capability, and **not**
  100% validation.
- Genuine concurrent 1–50-device support remains a separate future engineering
  programme with its own validation ladder; nothing in this protocol advances
  that ladder.
