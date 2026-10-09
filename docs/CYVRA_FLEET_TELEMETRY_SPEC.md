# CYVRA Fleet Telemetry Specification

| Field | Value |
|---|---|
| Status | `ACTIVE-CONTRACT` — specification only; **no Worker or API code in this task** |
| Authority | `docs/CYVRA_CORE_ENGINE_JOURNEY_FINAL_V2_2026-10-08.txt` §5.4, §5.5, §5.6 (Level 1, §2.3 of the Project Index) |
| Related | `docs/CYVRA_CAPABILITY_PATCH_SCHEMA.md` |
| Date | 08-Oct-2026 — TASK O |
| Kind | Documentation. Endpoint build, queue implementation and consent UI are later phases. |
| Boundary | Telemetry goes to the **core engine** in this repository, never to the Customer Workspace (Spec §81). |

---

## 1. Purpose and non-goals

**Purpose.** The field fleet tells the core engine what capability actually looked like on real
devices, so that the engine can improve signed capability patches. It carries engine and patch-set
state, capability challenge events, and host-side logs.

**Non-goals.** This specification does not: implement a Worker or API endpoint; add analytics or
advertising; correlate customers; train models on customer device evidence; or send anything to the
Customer Workspace. All of those are out of scope for TASK O and, in the case of the endpoint, for
this phase entirely.

## 2. Principles

1. **Consent first.** No uplink of any consent-gated section before a recorded consent event.
   Absent consent means *absent traffic*, not *empty traffic*.
2. **Minimum necessary.** Only the fields listed in §4 may leave the host. Everything else is
   dropped at serialisation time by allowlist (§5).
3. **No customer device evidence without explicit consent.** Evidence content — imagery, dumps,
   package inventories, identifiers, storage contents — is excluded by default and requires its own
   explicit, separately recorded consent. Default is off.
4. **Advisor-actor.** Telemetry informs the core engine; the customer engine keeps acting only on
   verified signed patches. Nothing received over telemetry changes actuation logic (§5.6).
5. **Fail private.** Serialisation errors, missing consent fields or an unusable redactor MUST
   result in the section being dropped, never in raw pass-through.
6. **Offline first.** A host with no network still completes its work; the queue is a convenience,
   never a precondition.

## 3. Channels

| Channel | Trigger | Contents |
|---|---|---|
| On-connect check-in | Engine start / host connect, when consented | Full envelope: engine, patch set, consent record |
| Periodic check-in | Timer, when consented | Full envelope; cadence per §7 |
| Challenge-event uplink | Verification failure, unknown key, precondition unmet, rollback | Event plus the context fields needed to diagnose it |
| Withdrawal notice | Consent withdrawn | Withdrawal record only; no payload sections |

All four are posted to the core-engine endpoint. They MUST NOT be posted to any customer-facing
surface or route.

## 4. Payload schema

### 4.1 Envelope

```json
{
  "schema_version": "1.0",
  "message_id": "MSG-EXAMPLE-0001",
  "sent_at": "2026-10-08T00:00:00Z",
  "channel": "PERIODIC",
  "consent": { },
  "engine": { },
  "patch_set": { },
  "capability_events": [ ],
  "host_logs": [ ],
  "dropped_sections": [ ]
}
```

`dropped_sections[]` names the sections withheld by redaction or consent — a *declared absence*,
which keeps an absent field distinguishable from an uncollected one (Spec §24).

### 4.2 `consent`

| Field | Type | Rule |
|---|---|---|
| `consent_id` | string | Stable id of the recorded consent event. |
| `scope[]` | string[] | Enumerated scopes actually granted: `ENGINE_STATE`, `CAPABILITY_EVENTS`, `HOST_LOGS`, `DEVICE_EVIDENCE` (default absent). |
| `granted_at` | string | RFC 3339 UTC. |
| `tcs_version` | string | Version of the T&C / consent text accepted. |
| `attestation_hash` | string | Hash of the attestation text accepted (governed doc §6.2). |
| `withdrawn_at` | string/null | Null while active; set on withdrawal. |
| `cadence` | object | `{on_connect: bool, periodic_minutes: int}` — the cadence the customer chose. |

### 4.3 `engine`

`engine_version`, `host_app_version`, `os_version`, `platform`, `build_id`, `install_ref`.

`install_ref` is a per-install transport reference that MAY be rotated. It MUST NOT be presented as,
derived from, or persisted alongside a device identity (governed doc §4).

### 4.4 `patch_set`

Mirrors the report fields of the patch schema: `patch_set_version`, `patch_set_hash`,
`patch_set_mode`, `applied_patch_count`, `trust_anchor_id`, `last_rollback_reason`.

### 4.5 `capability_events[]`

| Field | Type | Rule |
|---|---|---|
| `event_id` | string | Unique per host. |
| `plane` | enum | `USB_PNP` \| `WPD_MTP` \| `ADB` \| `COMPANION`. |
| `outcome` | enum | `SUCCESS` \| `FAILURE` \| `NOT_APPLICABLE` \| `NOT_OBSERVABLE` \| `RESTRICTED` \| `NOT_COLLECTED`. |
| `reason_code` | string | Engine reason code; never free text. |
| `android_version` | int | API level. |
| `oem_scope` | object | Manufacturer/model/skin, as recorded — no fabrication. |
| `duration_ms` | int | Wall time of the attempt. |
| `is_emulator` | bool | Emulators are labelled as emulators. |
| `patch_context` | string/null | `patch_set_version` in force during the event. |

The `outcome` vocabulary deliberately mirrors the evidence vocabulary: an event that could not be
observed is recorded as `NOT_OBSERVABLE`, never as `SUCCESS`.

### 4.6 `host_logs[]`

The Windows host's own log tail: `{ts, level, code, message}`. Size-capped (default 256 entries,
4 KiB per message). Message text passes through the same redactor as every other field.

### 4.7 Forbidden without separate explicit consent (`DEVICE_EVIDENCE`)

Photographic or screen-capture content, storage contents, `pm list packages` output, any
identifier (IMEI, serial, MAC, storage CID, advertising id), lock or FRP material, and any raw
`adb`/`dumpsys` dump beyond the aggregate event fields in §4.5. Probe fixtures produced by
`scripts/android-probe/` are local artifacts and MUST NOT be uplinked at all.

## 5. Redaction rules

1. **Allowlist serialisation.** A section is built by copying an explicit list of keys. An unknown
   key is dropped, not passed through. A denylist alone is not sufficient.
2. **Identifier scrub.** Before any string is written, shapes matching identifier patterns
   (15-digit IMEI with valid Luhn, MAC addresses, long alphanumeric serials, storage CID) are
   replaced with the *status token* for that field, not with a blank — so the record still says
   `NOT EXPOSED` / `RESTRICTED` / `NOT COLLECTED` rather than silently losing the fact (Spec §24).
3. **No identifiers in transport metadata.** Nothing identifying belongs in a URL, query string,
   filename or header.
4. **No evidence in logs.** Telemetry logs about telemetry are themselves redacted.
5. **Redactor failure is a drop.** If redaction cannot be completed for a section, the section is
   recorded in `dropped_sections[]` and the message is sent without it.

## 6. Consent record, grant and withdrawal

**Grant.** Consent is captured in the desktop app's first-run flow
(`docs/CYVRA_TC_OWNERSHIP_ATTESTATION_DRAFT.md`, screen S4), recorded with `consent_id`, scope,
cadence, retention, `tcs_version` and `attestation_hash`, and stored locally before any uplink.

**Scope.** The customer sees exactly what is in scope: engine state, capability events, host logs —
and, separately and default-off, device evidence. Scope is enumerated; there is no "and related
purposes" catch-all.

**Withdrawal.** Withdrawal is honoured within one cadence cycle:

1. stop all new uplink immediately;
2. purge queued items not yet sent;
3. send the withdrawal notice (§3) and nothing else;
4. mark local records `withdrawn_at` and stop extending retention;
5. request deletion of already-received data for the not-yet-expired retention window.

Withdrawal MUST NOT affect the engine's ability to inspect, purge or produce a report. It stops
sharing, not working.

**Retention.** Proposed defaults, pending approval: capability events and host logs 180 days,
consent records retained for the life of the installation plus 365 days (they are the proof that
consent existed). Any shorter or longer window is a governance decision, not an implementation
default.

## 7. Cadence configuration

| Setting | Proposed default | Notes |
|---|---|---|
| On-connect check-in | on when consented | Every engine start. |
| Periodic interval | 1440 minutes (24 h) | Configurable per deployment. |
| Jitter | ±15 % | Avoids fleet synchronisation. |
| Backoff on failure | exponential, cap 7 d | Never blocks local work. |
| `enabled` without consent | `false` | Fail private. |
| Quiet hours | honoured when configured | Events queue, they do not wake the host. |

Configuration lives on the host, is customer-visible, and may be set to *no periodic uplink* while
keeping on-connect, or to none at all.

## 8. Offline queue

| Rule | Requirement |
|---|---|
| Format | Append-only JSONL, one envelope per line, written locally. |
| Encryption | At rest using the OS keystore; the queue is not plaintext on disk. |
| Ordering | FIFO per host; `message_id` is monotonic so the receiver can deduplicate. |
| Capacity | Default 64 MiB or 5000 envelopes, whichever first. On overflow, drop oldest and record `queue_overflow` in the next envelope — never block inspection work. |
| Flush triggers | Consent grant, network available, backoff expiry. |
| Withdrawal | Purge immediately and irreversibly (§6). |
| Egress | Queue content is never written to a report, a log file, or a support bundle without a separate consent. |

## 9. Data classification

| Class | Examples | Rule |
|---|---|---|
| Allowed always | `engine_version`, `patch_set_version`, schema version, message ids | Send when consented at all |
| Consent-gated | capability events, host logs, cadence, OS/build info | Requires the matching scope |
| Separately consented, default off | any device evidence (§4.7) | Requires `DEVICE_EVIDENCE` scope |
| Never | lock/FRP credentials, plaintext secrets, customer evidence content, other customers' data, private key material | Not sent under any consent |

## 10. Shadow learning feed (§5.5)

Predictions the engine made, paired with the ground truth later observed, form the training signal.
They travel in the same envelope under `capability_events[]` with `outcome` reflecting the observed
truth.

Pairing records are labelled *unreviewed*. They **never** become a patch by themselves: promotion
requires a governed PR and Chief Engineer approval (`approved_by` in the patch schema). A bad
prediction therefore has no path into a customer engine except through human review.

## 11. Security and privacy scope

- Transport is TLS 1.3; payloads are plain JSON over TLS — no third-party analytics SDKs, no
  telemetry fan-out, no advertising identifiers.
- No cross-customer correlation: the core engine sees per-install references, never a customer-wide
  device graph.
- Host logs are redacted before serialisation (§5), so identifiers cannot leak through a log line.
- The probe fixtures under `apps/android/core/src/test/fixtures/` are local-only build inputs. They
  are explicitly out of the telemetry path.
- Failure modes are private: an unusable consent record, redactor or queue results in *less* data,
  never in raw data.

## 12. Open items

1. Endpoint build — later phase; **no Worker/API code in TASK O**.
2. Retention windows (§6) — pending approval.
3. Consent UI copy — drafted in `docs/CYVRA_TC_OWNERSHIP_ATTESTATION_DRAFT.md`, pending legal
   review.
4. Redactor pattern set — needs a review pass against the identifier vocabulary.
5. Correlation of events with `schema 0011` reports — later phase.

## 13. Conformance checklist

- [ ] No uplink of any section before a recorded consent event for that scope.
- [ ] `DEVICE_EVIDENCE` scope is absent by default and separately granted.
- [ ] Allowlist serialisation; unknown keys dropped; redactor failure drops the section.
- [ ] Identifier shapes replaced by status tokens (`NOT EXPOSED` / `RESTRICTED` /
      `NOT COLLECTED`), never fabricated (Spec §24).
- [ ] Nothing identifying in URLs, headers, filenames or query strings.
- [ ] Withdrawal stops uplink within one cycle and purges the queue.
- [ ] Queue is encrypted at rest, FIFO, size-capped, and never blocks inspection work.
- [ ] Telemetry targets the core engine only — never the Customer Workspace (Spec §81).
- [ ] No self-modification path: nothing received here alters actuation logic (§5.6).
- [ ] Shadow-learning records reach a patch only through a governed PR plus Chief Engineer approval.

---

*Documentation only. No Worker, API, endpoint, queue or consent-UI code was written or changed by
this file.*
