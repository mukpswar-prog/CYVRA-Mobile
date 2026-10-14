# CYVRA Stage 5 — Purge Verification Contract

**Status:** DRAFT, awaiting ratification by the Chief Engineer under governed §29 of
`docs/CYVRA_GOVERNANCE_LEDGER.md`.
**Drafted:** 2026-10-14.
**Addresses:** weakness #3 of `docs/CYVRA_FACTORY_RESET_PROOF_2026-10-12.md` §5 —
*"Purge verified, verification not."* The erasure was confirmed. What it means to
**attest** that a purge happened was never defined. This document defines it.

---

## 1. Purpose

This contract sets the single standard by which this product is permitted to say a purge
happened. It exists so that no future build, report or operator can upgrade "we issued a
command" into "the data is gone".

Two rules govern everything below:

- **Nothing here may be claimed unless the evidence would survive independent
  re-execution.** A claim that cannot be re-run is labelled unproven.
- **Silence is permitted; softening is not.** Where a metric cannot be measured, the
  correct output is *not established*, never a reassuring substitute.

---

## 2. Definitions

| Term | Meaning here |
|---|---|
| **Purge** | The agent-based route: the CYVRA sanitization agent, enrolled as device owner, receiving `DevicePolicyManager.wipeData(0)`. Flag `0` means internal storage; removable media and bootloader state are untouched. |
| **Trigger** | The `am broadcast` that asks the agent to wipe. Delivering a trigger proves nothing about erasure. |
| **Attest** | To assert, on evidence this contract has defined and this product has actually read, that the post-purge state satisfies every criterion below. |
| **Not established** | The product could not read the fact. This is a statement about our knowledge, not about the device. |

**Purge on this build is agent-based.** A device without the enrolled CYVRA agent has no
purge method available and is refused rather than silently failed. The agent-less route
has never erased anything and is believed impossible on a locked bootloader with
`uid=2000`, no root and no device owner. That is a belief and is recorded as one.

---

## 3. The verification metrics

Eight readings, taken **before** the trigger and again **after** the device has rebooted.
Seven are the erasure table of the 12-Oct proof §3.1; the eighth is that proof's
independent confirmation.

They split into two tiers, and the split is the substance of this contract.

### Tier A — the product attests these itself

Every command sits inside `HostSecurityAuditEngine.ALLOWED_ADB_PREFIXES`, so the product
reads them without gaining any capability it does not already hold.

| # | Metric | Source command | Attested when |
|---|---|---|---|
| A1 | Total installed packages | `pm list packages` | Post-purge count is **lower** than pre-purge, and the fall is non-zero |
| A2 | Third-party packages | `pm list packages -3` | Post-purge count is **lower** than pre-purge |
| A3 | CYVRA packages present | counted from A1 | Post-purge count is **exactly 0** |
| A4 | CYVRA device-owner references | `dumpsys device_policy` | Post-purge contains **no** reference to `com.cyvra.sanitization` |
| A5 | Boot reason | `getprop ro.boot.bootreason` | Value contains **`factory_reset`** |

### Tier B — a technician attests these, because the product cannot read them

These three sources sit **outside** the supported command set. `content query` and
`dumpsys account` are not allowlisted, and that is deliberate: reading them would move
the product from counting user data to **ingesting user data**, and account identifiers
in particular are forbidden from appearing in any file or attestation by standing rule.

| # | Metric | Source | Attested when |
|---|---|---|---|
| B1 | Contact rows | Technician reading | Post-purge count is at or near the stock baseline the OS recreates |
| B2 | Media rows | Technician reading | Post-purge count is at or near the stock baseline |
| B3 | Accounts | Technician reading | Post-purge count is **exactly 0** |

The 12-Oct proof recorded the stock baseline as **1 contact row and 20 media rows**, both
recreated by the operating system on a fresh boot. They are not surviving user data, and
the contract does not require them to reach zero.

**This tier split is not a compromise dressed up as a design.** Tier B exists because
three of the eight readings genuinely cannot be taken through supported paths today. If
that is later changed, it changes by widening the allowlist deliberately, with the
user-data-ingestion risk stated and accepted — not quietly.

---

## 4. The verdict model

Four verdicts. Binary PASS/FAIL is forbidden, as it is everywhere else in this product.

| Verdict | Condition |
|---|---|
| `PURGE_ATTESTED_MACHINE` | Every Tier A criterion met. Tier B not taken. |
| `PURGE_ATTESTED_HYBRID` | Every Tier A criterion met **and** every Tier B criterion attested by a named technician. |
| `PURGE_NOT_ATTESTED` | Any Tier A criterion read and **failed**. |
| `PURGE_INDETERMINATE` | Any Tier A reading could not be taken at all. |

`PURGE_INDETERMINATE` must never be reported as `PURGE_NOT_ATTESTED`, nor vice versa. A
device that was not read is not a device that failed.

The trigger step is **not** a verdict under this contract. It is a statement that a
request was made, and it stands entirely outside these five.

### 4.1 The trigger outcome is tri-state, not a success flag

Amended 2026-10-14, hours after ratification, because the first execution of this
contract found the defect this section now records. Recording the amendment is the
point: a contract that quietly rewrites itself after a bad run is worth nothing.

Issuing `wipeData` tears the ADB connection down as the wipe starts. The trigger
therefore cannot be graded by its exit code:

| Trigger outcome | Meaning |
|---|---|
| `DELIVERED` | The broadcast was accepted by the device. Still not erasure. |
| `NOT_ISSUED` | The device could not be addressed at all; nothing was sent. |
| `INDETERMINATE` | The command was issued and the device stopped answering. |

`INDETERMINATE` must never be reported as a failure, and must never be reported as a
success. It is settled only by the post-reboot reading.

**Observed on 14-Oct:** the trigger returned **exit 224** with the device already
absent from `adb devices`. Under the original single boolean this was recorded as
"could not be issued" — that is, the run's most important outcome was recorded
backwards. The provider now reports it as `INDETERMINATE`, and there is a regression
test pinning that exact shape.

### 4.2 Precondition for the after-reading: the operator must be at the device

A factory reset disables USB debugging and leaves the device in the setup wizard.
Observed 14-Oct: the device was absent from `adb devices` for at least ten minutes
after the trigger and did not return on its own.

Consequence, stated before the next run rather than discovered during it: **no Tier A
after-reading can be taken automatically.** Every verdict in §4 therefore waits on a
human step — completing setup and re-enabling USB debugging at the handset. Until that
happens the correct verdict is `PURGE_INDETERMINATE`, and a run left there must be
reported as inconclusive rather than as a purge that did not work.

**Connection loss at the restart is WORK DONE for the machine phase** — Chief Engineer,
14-Oct. Wiping is the last process the machine performs; the human verification process
follows, then AI report generation and grading. This is a workflow hand-off signal and
nothing more: it ends the machine phase and starts the human phase. **It is not an
attestation and not a verdict**, and it never by itself entitles the product to say a
purge was verified. Were "we lost the connection" permitted to read as "the purge is
verified", the product would be claiming from silence — the precise thing this contract
exists to prevent. Read alongside the tier split, the two fit rather than compete: Tier A
is what the machine read before the drop, Tier B is what the human verifies after, and
machine plus human is `PURGE_ATTESTED_HYBRID` — the natural end state of the real
workflow, not an extra ask.

---

## 5. What this contract deliberately does not establish

Stated plainly, per hold H8:

1. **It does not establish agent-less purging.** Every verdict here presupposes the
   enrolled agent. Nothing in this contract may be cited as evidence for the agent-less
   route.
2. **It does not establish cross-device support.** The 12-Oct ground truth is one device:
   Android 11, one OEM, one model. Applying these thresholds to another OEM is a
   separate, not-yet-run measurement.
3. **It does not establish secure erasure at the NAND level.** Flash wear-leveling means
   physical cell verification requires chip desoldering. That remains PUR-007 and is a
   technician attestation, never software evidence.
4. **It does not survive device loss.** A device that is lost between the trigger and the
   post-reboot reading yields `PURGE_INDETERMINATE`, and that is the correct answer.
5. **It does not interpret A1 or A2 as proof of user-data removal by themselves.** A
   package count falling is consistent with a reset; it is the conjunction with A5 that
   carries the weight.

---

## 6. Provenance

| Element | Source |
|---|---|
| The seven erasure metrics and their 12-Oct before/after values | `docs/CYVRA_FACTORY_RESET_PROOF_2026-10-12.md` §3.1 |
| The independent confirmation and pinned boot time | same document, §3.2 (`ro.boot.bootreason = reboot,factory_reset`, boot pinned 11:41:24) |
| The stock contact/media baseline (1 and 20) | same document, §3.1 footnote |
| The exact trigger command | same document, §2 |
| The Tier A command set | `HostSecurityAuditEngine.ALLOWED_ADB_PREFIXES`, as extended on 14-Oct |
| The pre-flight that gates the trigger | `HostDestructiveWipeProvider`, commit `1617f1e` |
| Residual package counting already running on hardware | `docs/evidence/pur006-product-path-2026-10-14.log` (333 / 4 / 0) |

**Unproven, labelled as such:** that these thresholds hold on any device other than the
one bench handset. No measurement exists.

---

## 7. Ratification

Ratifying this contract makes the four verdicts in §4 the only forms in which this
product may report a purge outcome. It does not by itself authorise running a purge.

- [x] **Ratified — Chief Engineer, 2026-10-14.** Word given in session: *"Approved
  Three actions … Ratify the contract … And approved start -Step 5 process."*
  Ratification and the separate commissioning to run a purge were given together;
  they are recorded separately here because they are different grants.
- [ ] Ratified with amendments noted here: _______________________________
- [ ] Not ratified — reason: ____________________________________________
