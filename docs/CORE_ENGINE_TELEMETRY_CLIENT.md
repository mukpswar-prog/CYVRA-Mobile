# CORE ENGINE — TELEMETRY CLIENT

| Field | Value |
|---|---|
| Status | `DESIGN-DOC` — architecture only; **no Worker, endpoint or client code in this task** |
| Authority | `docs/CYVRA_CORE_ENGINE_JOURNEY_FINAL_V2_2026-10-08.txt` §5.4 (field uplink), §5.5 (promotion), §5.6 (telemetry never changes actuation), §7 (boundary) — Level 1 |
| Related | `docs/CYVRA_FLEET_TELEMETRY_SPEC.md` (`ACTIVE-CONTRACT`, TASK O — **the contract**), `docs/CORE_ENGINE_SIGNED_PATCH_VERIFIER.md` §6, Spec §24, §81 |
| Date | 09-Oct-2026 — TASK R (CORE-ENG-1) |
| Kind | Documentation. No endpoint, queue implementation or consent UI changed. |
| Mandate | M1–M4 in force; customer journey FROZEN; DOCS ONLY. |

---

## 1. Relationship to the contract

`CYVRA_FLEET_TELEMETRY_SPEC.md` is the **contract**: envelope schema, payload fields,
redaction rules, consent record, cadence defaults, offline queue, data classification.

This document is the **client-side design**: the engine's telemetry subsystem — how it
decides to send, what it is allowed to assemble, how consent gates each section, how
withdrawal and the offline queue behave, and the boundary it must never cross. Where both
speak, **the contract wins**.

## 2. Position in the architecture

```
customer engine ──(capability challenge events, engine state)──▶ TELEMETRY CLIENT
                                                                     │
                                                    consent-gated, allowlisted,
                                                    redacted, fail-private
                                                                     ▼
                                              CORE ENGINE (this repository, governed)
                                                                     │
                                                            never reaches ──▶
                                                        CUSTOMER WORKSPACE
```

**Direction is one-way.** Telemetry informs the core engine about fleet behaviour. The
customer engine's *only* input that changes how it acts is a **verified signed patch**
(governed §5.6). Nothing received over telemetry — no flag, no payload field, no "remote
config" — may alter actuation logic. A telemetry endpoint that could switch on a purge
path would invert the advisor-actor boundary and is prohibited.

**Boundary (governed §7 / Spec §81).** Telemetry goes to the core engine, never to the
Customer Workspace. The client has no Workspace URL, no Workspace credential, and no code
path that could target a customer-facing surface.

## 3. Triggers

| Trigger | When | Contents |
|---|---|---|
| **On-connect check-in** | Engine start / host connect, **when consented** | Full envelope: engine state, patch set, consent record |
| **Periodic check-in** | Timer, **when consented** | Full envelope; cadence per contract §7 |
| **Capability challenge event** | Verification failure, unknown key, precondition unmet, rollback | Event + diagnostic context (contract §4.5) |
| **Withdrawal notice** | Consent withdrawn | Withdrawal record only; no payload sections |

### 3.1 Cadence

Configurable per deployment; defaults from contract §7: on-connect on when consented;
periodic **1440 min (24 h)**; jitter **±15 %**; exponential backoff capped at **7 d**;
`enabled` defaults **false** without consent; quiet hours honoured (events queue, they
do not wake the host). The customer may set *no periodic uplink* while keeping
on-connect, or none at all.

Cadence is customer-visible configuration, not a server-controlled dial.

### 3.2 The silence rule

**Absent consent means absent traffic — not empty traffic.** A client without consent
sends *nothing*: no heartbeat, no empty envelope, no "this device exists" ping, no
metadata-only request. An unconsented client that keeps calling home is a defect even if
every payload section is empty.

## 4. Payload

### 4.1 What the client is allowed to assemble

| Section | Contents | Gate |
|---|---|---|
| `engine` | `engine_version`, `host_app_version`, `os_version`, `platform`, `build_id`, `install_ref` | Allowed always (when consented at all) |
| `patch_set` | `patch_set_version`, `patch_set_hash`, `patch_set_mode`, `applied_patch_count`, `trust_anchor_id`, `last_rollback_reason` | Allowed always |
| `consent` | `consent_id`, `scope[]`, `granted_at`, `tcs_version`, `attestation_hash`, `withdrawn_at`, `cadence` | The proof that consent existed |
| `capability_events[]` | `plane`, `outcome`, `reason_code`, `android_version`, `oem_scope`, `duration_ms`, `is_emulator`, `patch_context` | Requires matching scope |
| `host_logs[]` | `{ts, level, code, message}` — tail, 256 entries / 4 KiB per message | Requires matching scope |
| `dropped_sections[]` | Names the sections withheld — a **declared absence** | Always emitted when something was withheld |

### 4.2 No customer device evidence without explicit consent

This is the load-bearing privacy rule of the client.

**Default: off.** Device evidence is excluded from every message unless the consent
record carries the separate, explicitly granted `DEVICE_EVIDENCE` scope. Its absence is
the normal state, not a temporary one.

Excluded by default and never sent without that scope (contract §4.7):

- photographic or screen-capture content;
- storage contents;
- `pm list packages` output — the full app inventory is personal data;
- **any identifier**: IMEI, device serial, MAC, storage CID, advertising id;
- lock or FRP material;
- any raw `adb`/`dumpsys` dump beyond the aggregate event fields of contract §4.5;
- **probe fixtures** produced by `scripts/android-probe/` — local build artefacts,
  explicitly out of the telemetry path, never uplinked under any consent.

Capability telemetry is therefore **aggregate and shaped**: *an attempt on plane A for
API level N produced outcome O in D ms*, not *here is what the dumpsys returned*. The
fleet learns that a class of device behaves a certain way; it never receives that
customer's device contents.

**Capability ≠ evidence content.** Challenge events describe engine behaviour and
outcome enums — they are not a covert channel for evidence, because the redactor is an
allowlist (contract §5): only listed keys are copied, and an unknown key is dropped, not
passed through.

### 4.3 Fail private

Serialisation errors, a missing consent field, or an unusable redactor MUST result in the
section being **dropped** — recorded in `dropped_sections[]` — never in raw pass-through.
Identifier shapes are replaced with their §24 status token, not a blank, so the record
still says `NOT COLLECTED` rather than silently losing the fact. Logs about telemetry are
themselves redacted.

Failure modes produce *less* data, never more.

## 5. Consent: record, grant, withdrawal

### 5.1 Record

Consent is captured in the desktop first-run flow (screen S4 of
`docs/CYVRA_TC_OWNERSHIP_ATTESTATION_DRAFT.md`) and recorded with `consent_id`, granted
`scope[]`, cadence, retention, `tcs_version` and `attestation_hash`, and stored **locally
before any uplink**. Scope is enumerated — there is no "and related purposes" catch-all.

The consent record is retained for the life of the installation plus 365 days, because it
is the proof that consent existed.

### 5.2 Grant

Grant opens exactly the sections named in `scope[]` and no others. Each section is gated
independently: `ENGINE_STATE` granted but `HOST_LOGS` absent means host logs never
serialise — they are not sent "empty", they are never built.

### 5.3 Withdrawal — honoured within one cadence cycle

1. Stop all new uplink **immediately**.
2. Purge queued items not yet sent.
3. Send the withdrawal notice and **nothing else**.
4. Mark local records `withdrawn_at`; stop extending retention.
5. Request deletion of already-received data within the not-yet-expired retention window.

**Withdrawal stops sharing, not working.** It MUST NOT affect the engine's ability to
inspect, purge or produce a report. A customer who withdraws telemetry keeps a fully
functional product; only the uplink goes quiet.

## 6. Offline queue

| Rule | Behaviour |
|---|---|
| Format | Append-only JSONL, one envelope per line, local. |
| Encryption | At rest via OS keystore — not plaintext on disk. |
| Ordering | FIFO per host; `message_id` monotonic so the receiver can deduplicate. |
| Capacity | 64 MiB or 5000 envelopes, whichever first. On overflow, drop **oldest** and record `queue_overflow` in the next envelope. |
| Flush triggers | Consent grant, network available, backoff expiry. |
| Never | Block inspection work. Device work must not wait on connectivity. |
| Withdrawal | Purge immediately and irreversibly. |
| Egress | Queue content never reaches a report, a log file or a support bundle without separate consent. |

The queue is a convenience, never a precondition: a host with no network completes its
work normally.

## 7. Privacy scope

| Class | Examples | Rule |
|---|---|---|
| Allowed always | `engine_version`, `patch_set_version`, schema version, message ids | Send when consented at all |
| Consent-gated | capability events, host logs, cadence, OS/build info | Requires matching scope |
| Separately consented, default off | any device evidence (§4.2) | Requires `DEVICE_EVIDENCE` |
| **Never** | lock/FRP credentials, plaintext secrets, customer evidence content, other customers' data, private key material | Not sent under **any** consent |

Additional bounds: TLS 1.3, plain JSON over TLS, **no third-party analytics SDKs, no
telemetry fan-out, no advertising identifiers**; no cross-customer correlation — the core
engine sees per-install references, never a customer-wide device graph; `install_ref` is
a transport reference that MAY be rotated and MUST NOT be presented as, derived from, or
persisted alongside a device identity (governed §4).

**The boundary restated:** telemetry → core engine, **never** Workspace (governed §7,
Spec §81).

## 8. Relationship to patches (governed §5.5)

Capability challenge events are the raw signal for shadow learning: predictions logged
against later ground truth, travelling under `capability_events[]` with `outcome`
reflecting observed truth.

Pairing records are labelled **unreviewed** and **never become a patch by themselves**.
Promotion requires a governed PR and Chief Engineer approval (`approved_by` in the patch
schema). A bad prediction therefore has no path into a customer engine except through
human review — the telemetry channel carries *observations*, and only the signed-patch
channel carries *instructions*, and they are separated on purpose.

## 9. Invariants

1. Absent consent ⇒ absent traffic.
2. Device evidence is default-off and separately consented.
3. Redaction is allowlist-based; a failed redaction is a drop.
4. Telemetry never changes actuation logic (§5.6).
5. Telemetry never reaches the Customer Workspace (§7).
6. Withdrawal stops sharing, not working, within one cadence cycle.
7. The queue never blocks device work.
8. Never-sent data is never sent under any consent level.

## 10. Open items

1. Endpoint build — later phase; no Worker or API code in this task.
2. Retention windows (proposed: events/logs 180 days) — a governance decision, not an
   implementation default.
3. Legal review owner for the consent/attestation text (governed §6, listed in §10).
4. Consent UI copy and the withdrawal surface in the desktop app.
5. `install_ref` rotation policy.

---

*Documentation only. No endpoint, queue, consent UI or payload field was changed by this
file.*
