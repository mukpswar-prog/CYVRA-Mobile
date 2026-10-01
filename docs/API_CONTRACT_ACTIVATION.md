# Activation / Licensing API Contract

**Extracted from code at commit HEAD — real endpoint wiring is a separate future task (W1.5).**

- HEAD at extraction: `973d486db45e1c385a279a9f9ca7b0aa356274b6` (`973d486 chore: remove vestigial .python-version pin`).
- Every claim below cites the file and line it came from. Line numbers refer to that commit.
- Nothing in this document is a design or a proposal. Where the code does not answer a question, it says so.

---

## 1. Status banner: the real endpoint is NOT wired

The production licence client is `PlaceholderLicenseApiClient`, and it can never say "yes":

- `apps/desktop/src-tauri/src/activation/client.rs:1-14` — "The production `LicenseApiClient` for this package: a seam with no wire… It has no URL, no TLS and no dependency it could reach out with; it fails closed on every call instead… Nothing in here can ever say 'yes', which is the whole point: an unwired endpoint must never be mistaken for an approving one."
- `client.rs:31-43` — `activate()` and `revalidate()` both return `ActivationOutcome::Refused(FailureKind::NetworkError)`; `reachability()` returns `Reachability::Unreachable`.
- `apps/desktop/src-tauri/src/activation/mod.rs:27-33` — "Real `cyvoriq.co.in` endpoint wiring is deliberately out of scope for this package. Until it lands, a shipped build has a client that answers `network error` to everything it is asked, so nothing can be activated by accident and nothing can be activated at all."
- `client.rs:3` — "Real endpoint wiring against `cyvoriq.co.in` is an explicit later task."
- The placeholder is the client actually instantiated by the shipped Tauri commands: `apps/desktop/src-tauri/src/activation/commands.rs:13`, `commands.rs:126`, `commands.rs:169`.
- Tests pin this: `client.rs:60-67` (`a_real_build_cannot_activate_anything_before_the_endpoint_is_wired`), `client.rs:69-76` (stored tokens cannot revalidate), `client.rs:78-84` (never claims reachable), `client.rs:102-117` (cannot leak a success it did not have).

**Consequence:** in a shippable build today, no workstation can activate, no stored token can revalidate, and with a stored token on file the only possible outcomes are an offline-grace entry or a `network error` refusal (see §8). Everything below describes the contract the code is *shaped* to, so the future wiring task (W1.5) has a target — not a contract any server currently serves.

---

## 2. Transport: what exists today vs what is required later

### What exists today: nothing

| Element | Present in code? | Evidence |
|---|---|---|
| URL | No | `client.rs:4-5` — "no URL"; `apps/desktop/src-tauri/src/activation/api.rs:5-6` — "nothing in this crate hardcodes a URL"; test `client.rs:119-131` fails if the client's `Debug` output ever grows `http`, `https`, `cyvoriq`, `Url` or `host`. |
| TLS | No | `client.rs:5` — "no TLS". |
| HTTP client dependency | No | `apps/desktop/src-tauri/Cargo.toml:18-47` lists only `serde_json`, `serde`, `log`, `tauri`, `tauri-plugin-log`, `sha2`, `chrono`, `proptest` (dev), and the Windows `windows` crate. No `reqwest`/`ureq`/`hyper` or any other HTTP crate. |
| Wire encoding | Not chosen | The trait is synchronous Rust (`api.rs:147-163`); no serialization format for transport exists anywhere. |
| Endpoint hostname in desktop code | Only in comments/tests | `client.rs:3` (doc comment), `client.rs:125` (test token list), `mod.rs:29` (doc comment). |

The trait is "a seam, not a concrete transport" (`api.rs:3-6`): every state-machine test runs against an in-process fake (`api.rs:3-5`, `fake` module wired at `mod.rs:38-40`), never against a network.

### What is required later (and is unspecified)

A real implementation must provide: a URL on `cyvoriq.co.in` (named as the future target in `client.rs:3` and `mod.rs:29`, but the path is **unknown — not specified in code**), a transport dependency, TLS, an encoding of `ActivationRequest`, a mapping from server answers to `ActivationOutcome`, and a definition of how `revalidate(device_token, device_fingerprint)` authenticates (**unknown — not specified in code**). See §12.

### Existing `cyvoriq.co.in` references in the repo — all placeholders or unrelated

- `apps/desktop/src-tauri/src/activation/client.rs:3`, `mod.rs:29` — comments naming the future endpoint; not a URL.
- `apps/desktop/src-tauri/src/activation/client.rs:125` — a test asserting the placeholder contains *no* transport detail (`"cyvoriq"` is one of the forbidden tokens).
- `GUIDELINE.md:69` / `scripts/attach-api-cyvoriq.sh:3,61` — `api.cyvoriq.co.in` is the Mobile API hostname on Cloudflare Worker `cyvra-mobile-api`; `scripts/prove-live-api.sh:41-49` probes `https://api.cyvoriq.co.in/health`. This is the web/mobile API, not a desktop activation route.
- `apps/web/.env.example:5` — `VITE_API_URL=https://api.cyvoriq.co.in` (web frontend build-time variable).
- `apps/android/app/src/main/java/cyvra/mobile/MainActivity.kt:54` — a log line containing `POST https://api.cyvoriq.co.in/evidence/batches`.
- `services/api/src/license.ts:13-61` — the Worker's only entitlement-shaped route: `GET /`, session-authenticated via `requireUser` (`license.ts:14-15`), returning a record without `validUntil`, `serverTime`, `graceLimitSeconds` or `offline`. It does **not** accept `ActivationRequest` fields (email + licence key + fingerprint); it is not the activation endpoint.
- `services/api/src/admin.ts:149-164,626` — admin-side licence key generation and CSV reporting; server-internal, not a client route.

None of these is an activation endpoint. **No route anywhere in the repo accepts `ActivationRequest` or returns `ActivationSuccess`.**

---

## 3. Request shape: `ActivationRequest`

Defined at `apps/desktop/src-tauri/src/activation/api.rs:14-27`:

| Field | Type | Meaning (doc from `api.rs`) |
|---|---|---|
| `email` | `String` | "Registered User ID. The email the licence was issued to." (L17-18) |
| `licence_key` | `String` | "Licence key as the operator typed it." (L19-20) |
| `terms_version` | `String` | "Version of the Software Licence Terms the operator ticked acceptance for." (L21-22) |
| `app_version` | `String` | "Version of this application build." (L23-24) |
| `device_fingerprint` | `String` | "Digest of the workstation's hardware identity. Never a raw identifier." (L25-26) |

Notes pinned by code:

- **The request carries nothing that identifies a phone.** `api.rs:8-10` — "the workstation's own fingerprint proves which computer this is, and phone identifiers have no business in a licence call."
- **`device_fingerprint`** is computed inside `activation_request()` (`state.rs:195-214`), never supplied by the frontend, so "an activation cannot be sent without one" and "the only thing that ever leaves is the digest — never a raw machine GUID, SMBIOS serial or volume serial" (`state.rs:196-200`). It is a SHA-256 digest over exactly three components — Windows `MachineGuid`, SMBIOS Type 1 UUID, system-volume serial (`fingerprint.rs:1-27`, called at `state.rs:212`); the test fixture shows a 64-hex-char string (`state.rs:551-552`).
- **`terms_version`** is supplied by the binary, not the caller: `commands.rs:9-11` — "Neither command accepts a terms version from the caller… a modified frontend cannot tick a box and claim whichever document it likes"; constant `TERMS_VERSION = "V1.0-DRAFT"` (`commands.rs:19-24`), passed verbatim at `commands.rs:153-157`.
- **`app_version`** comes from the Tauri package info (`commands.rs:145`).
- If the fingerprint cannot be produced, no request is sent and the result is a local fault `FINGERPRINT_UNAVAILABLE`, never a verdict (`commands.rs:160-166`).

---

## 4. Response shape: `ActivationSuccess`

Defined at `apps/desktop/src-tauri/src/activation/api.rs:93-118`. Returned inside `ActivationOutcome::Success` (`api.rs:120-125`); the only alternative is `ActivationOutcome::Refused(FailureKind)`.

| Field | Type | Meaning (doc from `api.rs`) |
|---|---|---|
| `device_token` | `String` | "Opaque device token issued by the server. DPAPI-protected at rest." (L96-97) |
| `entitlement` | `SignedSnapshot` | "Full entitlement snapshot, exported for the Kotlin Host." (L98-99) |
| `offline_lease` | `SignedSnapshot` | "Restricted offline lease the server signed alongside the entitlement." (L100-101) |
| `server_time` | `String` | "Server's ISO-8601 clock at the moment of this answer. Kept for audit and for support." (L102-104) |
| `grace_expires_at_unix` | `u64` | "Absolute instant (Unix seconds) at which the offline grace window ends." (L105-106) |
| `binding` | `BindingOutcome` | `FirstActivation` or `AuthorizedDeviceRevalidation` (L87-91, L117). |

`SignedSnapshot` (`api.rs:71-80`) is `{ payload: String, signature: String }` — "the exact text that was signed, and its signature. Both halves are carried through untouched. The Rust layer never signs, never re-serializes and never validates the signature" (`api.rs:71-75`).

**`grace_expires_at_unix` semantics (exact):**

- **Server-decided:** `api.rs:107-109` — "The server decides this, not the workstation: a local clock never extends it, only a fresh server answer can."
- The signed offline lease carries the same instant for the Kotlin Host, "and if they ever disagree, the Host's copy is the one that governs" (`api.rs:109-112`).
- **`0` means "already past / refuse", never "unlimited":** `api.rs:113-116` — "`0` is deliberately meaningless rather than 'no limit': it decodes to 1970, which is already past, so a missing deadline refuses instead of granting forever." Pinned by test `state.rs:1210-1229` (`a_missing_grace_deadline_is_a_refusal_not_an_open_window` → `OfflineGraceExpired`).

**`BindingOutcome`** (`api.rs:82-91`): two variants, `FirstActivation` and `AuthorizedDeviceRevalidation`, with two distinct audit events — "a revalidation must never be able to masquerade as a first binding, and a first binding must never be recorded as if the computer were already known" (`api.rs:84-86`).

---

## 5. Verdicts: `FailureKind` — exactly six

`api.rs:29-43`: "The six things that can be wrong, and nothing else… Transport errors, HTTP status codes, JSON decode failures and storage errors are collapsed into `FailureKind::NetworkError` rather than being passed through, so an internal detail can never reach the screen."

**Verified against the code: `as_str()` has exactly six branches** (`api.rs:47-56`), and the test `the_operator_facing_vocabulary_is_exactly_six_strings` (`api.rs:169-193`) asserts the literal list *and* `HashSet` length 6. The six strings, verbatim:

| Variant (`api.rs:36-43`) | `as_str()` — operator-facing string (`api.rs:47-56`) | `code()` — audit/test code (`api.rs:59-68`) |
|---|---|---|
| `InvalidUser` | `invalid user` | `INVALID_USER` |
| `InvalidLicence` | `invalid licence` | `INVALID_LICENCE` |
| `LicenceNotActive` | `licence not active` | `LICENCE_NOT_ACTIVE` |
| `LicenceExpired` | `licence expired` | `LICENCE_EXPIRED` |
| `AlreadyBoundToAnotherComputer` | `already bound to another computer` | `ALREADY_BOUND` |
| `NetworkError` | `network error` | `NETWORK_ERROR` |

- `code()` is "Stable code used for audit lines and tests. Never shown to an operator." (`api.rs:58`), and test `api.rs:195-213` enforces that `code()` is non-empty, never equals `as_str()`, and is `[A-Z_]`-only.
- The audit line stores `code`, never the wording: `state.rs:106-109`, enforced by test `state.rs:831-837`.
- The screen gets `as_str()` and only for `Launch::Refused`: `commands.rs:69-84`.
- There is no seventh sentence: `state.rs:28-30` and `state.rs:61-64` ("only `Launch::Refused` ever carries text").

---

## 6. Reachability vs outcome: why they are two types

- `ActivationOutcome` (`api.rs:120-125`) = `Success(ActivationSuccess) | Refused(FailureKind)` — "What a call to `LicenseApiClient` came back with."
- `Reachability` (`api.rs:127-140`) = `Reachable` (the `#[default]`) | `Unreachable` — "Whether the licensing service could be reached at all for this launch."

Doc on why they are separate (`api.rs:127-132`): "Distinct from `ActivationOutcome` on purpose: an answer from the server is information, a silence is not. Conflating them would let 'the cable is out' look like a licence verdict, or worse, let a licence verdict look like an excuse to fall back on a cached one."

`reachability()` has exactly one permitted use (`api.rs:154-162`): deciding what a *never-activated* workstation sees while offline — "the activation screen, or the network-error notice. It must never soften or override a verdict the server actually returned, and it must never be consulted to decide whether a stored token is still good: that is what `revalidate` is for."

That single use appears once in the state machine: `state.rs:281-284` (`never_activated`, no stored activation, `Unreachable` → `Refused(NetworkError)`). Everywhere else, stored-token decisions go through `revalidate` (`state.rs:306`).

The trait must be total (`api.rs:142-146`): an unreachable transport answers `Refused(NetworkError)` rather than an error type the caller could leak to the UI.

---

## 7. State machine

Entry points (`state.rs`):

- `launch(home, api, now_unix)` — `state.rs:220-234`. "The only path that decides entry. It never writes an activation… and it never deletes one" (`state.rs:222-223`). Reads the store: `Ok(None)` → `never_activated` (`state.rs:230`), `Ok(Some)` → `revalidate_path` (`state.rs:231`), `Err` → `local_fault` with a `STORE_*` code (`state.rs:232`, codes at `state.rs:524-533`).
- `activate(home, api, request, now_unix)` — `state.rs:236-270`. Form submitted; `api.activate` → `refused` on `Refused`, `commit` on `Success` with the audit event chosen by `success.binding` (`state.rs:251-269`).
- Empty `<cyvra.home>` short-circuits both to `no_home()` — `Launch::LocalFault` with `AuditError::HomeUnavailable` and **no audit line written** (`state.rs:225-227`, `state.rs:247-249`, `state.rs:430-444`).

Result type `Launch` (`state.rs:61-83`): `NeedsActivation` | `LocalFault` | `Refused { failure }` | `Enter { offline }`.

### Transition table (with the audit event emitted at each)

Audit trail: JSON lines appended to `<cyvra.home>/logs/activation-audit.jsonl` (`state.rs:57-59`, `state.rs:153-180`), each line `{at_unix, event, code?}` (`state.rs:101-110`); `event` serializes `SCREAMING_SNAKE_CASE` (`state.rs:114-115`). `code` is present **iff** the line is a refusal or a local fault (`state.rs:1012-1023`, test `state.rs:1023-1116`).

| # | From | Condition | To (`Launch`) | Audit event (as written) | `code` | Writes `<cyvra.home>/entitlement.json`? |
|---|---|---|---|---|---|---|
| 1 | `launch` / `activate` | `<cyvra.home>` empty | `LocalFault` | *(none written — audit itself fails)* `state.rs:438-444` | — | No |
| 2 | `launch` | store read `Err` | `LocalFault` | `LOCAL_FAULT` (`state.rs:232`, `state.rs:452-462`) | `STORE_*` (`state.rs:524-533`) | No |
| 3 | `launch` → `never_activated` | no store, `reachability == Unreachable` | `Refused { network error }` | `ACTIVATION_REFUSED` (`state.rs:282-284`, `state.rs:418-428`) | `NETWORK_ERROR` | No |
| 4 | `launch` → `never_activated` | no store, `Reachable` | `NeedsActivation` | `ACTIVATION_SCREEN_SHOWN` (`state.rs:285-294`) | *(absent)* | No |
| 5a | `launch` → `revalidate_path` | `revalidate` → `Refused(NetworkError)` | falls through to §8 (`state.rs:307-308`) | *(see 7/8 below)* | | *(see 7/8)* |
| 5b | `launch` → `revalidate_path` | `revalidate` → `Refused(other)` | `Refused { that verdict }` | `ACTIVATION_REFUSED` (`state.rs:309-310`) | that verdict's code | No — store untouched (`state.rs:872-894`) |
| 5c | `launch` → `revalidate_path` | `Success` but `binding != AuthorizedDeviceRevalidation` | `Refused { invalid licence }` | `ACTIVATION_REFUSED` (`state.rs:312-319`) | `INVALID_LICENCE` | No — "nothing is overwritten on a suspicious reply" (`state.rs:315-316`, test `state.rs:897-917`) |
| 5d | `launch` → `revalidate_path` | `Success` + `AuthorizedDeviceRevalidation` | `Enter { offline: false }` | `AUTHORIZED_DEVICE_REVALIDATION` (`state.rs:320-327`) | *(absent)* | **Yes — full entitlement** (`commit`, `state.rs:389-391`) + store written (`state.rs:399-401`) |
| 6 | `offline_path` | `now_unix > stored.grace_expires_at_unix` | `Refused { network error }` | `OFFLINE_GRACE_EXPIRED` (`state.rs:343-353`) | `NETWORK_ERROR` | No — the existing file is left alone (test `state.rs:960-980`) |
| 7 | `offline_path` | inside grace, export OK | `Enter { offline: true }` | `OFFLINE_GRACE_ENTRY` (`state.rs:365-373`) | *(absent)* | **Yes — restricted offline lease** (`state.rs:361-363`) |
| 7f | `offline_path` | inside grace, export fails | `LocalFault` | `LOCAL_FAULT` (`state.rs:361-363` → `state.rs:452-462`) | `ENTITLEMENT_EXPORT_FAILED` | No |
| 8a | `activate` | `api.activate` → `Refused` | `Refused { verdict }` | `ACTIVATION_REFUSED` (`state.rs:252`) | verdict's code | No — "a refusal must not persist an activation" / "must not hand the Host an entitlement" (tests `state.rs:842-869`) |
| 8b | `activate` | `Success`, `binding == FirstActivation` | `Enter { offline: false }` | `FIRST_ACTIVATION` (`state.rs:254-267`) | *(absent)* | **Yes — full entitlement** + store written (`commit`, `state.rs:381-411`) |
| 8c | `activate` | `Success`, `binding == AuthorizedDeviceRevalidation` | `Enter { offline: false }` | `AUTHORIZED_DEVICE_REVALIDATION` (same path) | *(absent)* | **Yes — full entitlement** + store written |
| 9 | `commit` | entitlement export fails | `LocalFault` | `LOCAL_FAULT` (`state.rs:389-391`) | `ENTITLEMENT_EXPORT_FAILED` | No |
| 10 | `commit` | store write fails | `LocalFault` | `LOCAL_FAULT` (`state.rs:399-401`) | `STORE_*` | Entitlement already exported (export happens first, `state.rs:378-380`) |

Ordering inside `commit`: **export first, then persist** — "the store only ever records an activation we managed to hand to the Host, so a transient export failure costs one retry instead of leaving a token on file that points at nothing" (`state.rs:376-380`).

### Revision-ledger side effects (same `record()` call, `state.rs:470-508`)

| Audit event | Ledger event appended |
|---|---|
| `FIRST_ACTIVATION` | `Activation` (live, `offline=false`) |
| `AUTHORIZED_DEVICE_REVALIDATION` | `Revalidation` |
| `OFFLINE_GRACE_ENTRY` | `GraceEntered`, `offline=true` |
| `OFFLINE_GRACE_EXPIRED` | `GraceExpired`, `offline=true` |
| `ACTIVATION_REFUSED`, `ACTIVATION_SCREEN_SHOWN`, `LOCAL_FAULT` | none — "the ledger records acts, not refusals" (`state.rs:504-506`, `state.rs:763-768`) |

---

## 8. Offline grace semantics

Sequence when a stored token exists and the server cannot be reached:

1. `revalidate` answers `Refused(NetworkError)` — "A transport failure, not a verdict. Fall through to grace." (`state.rs:307-308`).
2. `offline_path` (`state.rs:332-374`):
   - **Outside grace** (`now_unix > stored.grace_expires_at_unix`, `state.rs:338`): refusal — event `OFFLINE_GRACE_EXPIRED`, `code = NETWORK_ERROR`, `Launch::Refused { FailureKind::NetworkError }` (`state.rs:343-353`). The operator sees `network error`, because "that is what is true - the licence has not expired, the connection has" (`state.rs:334-336`). "Passing out of it is a refusal, not a downgrade to 'diagnostics only'" (`state.rs:42-45`). Boundary: entering *at* the deadline is still inside; one second past is refused (test `state.rs:940-957`).
   - **Inside grace**: export the **restricted offline lease** (`stored.offline_lease`, not the full entitlement) to `<cyvra.home>/entitlement.json` (`state.rs:356-363`); if that export fails, the result is `LocalFault`/`ENTITLEMENT_EXPORT_FAILED` — "entering here would be handing the Host permissions the server did not grant for an offline session. Refuse to enter instead" (`state.rs:358-362`). On success: event `OFFLINE_GRACE_ENTRY`, `Launch::Enter { offline: true }` (`state.rs:365-373`), which the UI uses "to label cached data as cached" (`state.rs:79-82`).
3. Lease swap proven by test `state.rs:924-937`: offline entry writes the restricted lease and "the full entitlement must never go out offline"; online commit writes the full entitlement and not the lease (`state.rs:616-633`).

Other grace facts pinned by code:

- Grace is "the server's to grant" — nothing local extends it (`state.rs:42-46`; `api.rs:107-109`).
- A refusal never clears or downgrades the store/entitlement (`state.rs:872-894`, `state.rs:960-980`).
- Never-activated + offline = `network error` refusal, not grace (there is nothing on file to grant grace from) (`state.rs:281-284`, test `state.rs:983-995`).
- `grace_expires_at_unix == 0` behaves as already-past → `OFFLINE_GRACE_EXPIRED` (`state.rs:1210-1229`).

---

## 9. Store format

`apps/desktop/src-tauri/src/activation/store.rs`:

| Aspect | Value | Evidence |
|---|---|---|
| Schema constant | `cyvra.activation.v1` — "Bump only for a deliberate format change. An unknown schema fails closed." | `store.rs:18-19`; mismatch → `StoreError::Corrupt` (`store.rs:126-128`) |
| File name | `activation.dat` at `<cyvra.home>/activation.dat` | `store.rs:20`, `store.rs:95-97` |
| Protection | Windows DPAPI `CryptProtectData`, bound to the activating Windows user; "Copying `activation.dat` to another machine or another account yields nothing usable" | `store.rs:1-7`, `store.rs:151-195`; user-scope test `store.rs:422-444` |
| Plaintext on disk | Never — JSON is serialized, then protected | `store.rs:3-4`, `store.rs:140-141`; test `store.rs:352-376` |
| Write atomicity | temp file `activation.dat.tmp` + rename | `store.rs:133-149` |
| Reset / delete / clear | Deliberately none anywhere in the crate | `store.rs:9-12`, structural test `store.rs:446-459` |
| Missing file | `Ok(None)` = never activated | `store.rs:99-104,114` |
| Empty / unparseable / wrong schema | `Err(Corrupt)` — never first launch | `store.rs:118-128`, tests `store.rs:384-389`, `state.rs:1151-1176` |
| Non-Windows builds | `protect`/`unprotect` always fail | `store.rs:260-268` |

`StoredActivation` fields (`store.rs:27-40`):

| Field | Type | Note |
|---|---|---|
| `schema` | `String` | Always `"cyvra.activation.v1"` (`store.rs:50`) |
| `device_token` | `String` | From `ActivationSuccess.device_token` |
| `entitlement` | `SignedSnapshot` | Full snapshot |
| `offline_lease` | `SignedSnapshot` | Restricted lease |
| `server_time` | `String` | Server ISO-8601 from the success |
| `grace_expires_at_unix` | `u64` | "Absolute Unix seconds at which offline grace ends. Server-decided." (`store.rs:34-35`) |
| `binding` | `BindingOutcome` | |
| `email` | `String` | Stored so revalidation needs no typed input (`store.rs:24-26`) |
| `device_fingerprint` | `String` | Ditto |
| `stored_at` | `String` | ISO-8601 UTC from `iso8601(now_unix)` (`state.rs:393-398`, `state.rs:540-544`) |

Built only by `StoredActivation::from_success` (`store.rs:42-62`); `StoreError` variants map to audit codes `STORE_HOME_UNAVAILABLE`, `STORE_UNREADABLE`, `STORE_CORRUPT`, `STORE_PROTECT_FAILED`, `STORE_UNPROTECT_FAILED`, `STORE_SERIALIZE_FAILED` (`state.rs:524-533`).

---

## 10. Entitlement envelope handed to the Kotlin Host

Written by `apps/desktop/src-tauri/src/activation/entitlement.rs` to `<cyvra.home>/entitlement.json` (`entitlement.rs:24,126-128`); read by `apps/host/src/main/kotlin/cyvra/mobile/host/license/SignedEntitlementProvider.kt`.

### Envelope shape (`entitlement.rs:76-88`)

| Key | Type | Notes |
|---|---|---|
| `schema` | string | `"cyvra.entitlement.v1"` (`entitlement.rs:23`; Kotlin constant at `SignedEntitlementProvider.kt:337`) |
| `issuedAt` | string | The snapshot's `server_time` passed as `issued_at` (`state.rs:389`, `state.rs:361`) |
| `payload` | **string** | "The exact bytes the server signed, carried through untouched" (`entitlement.rs:81`) |
| `signature` | string | Server signature over the payload |
| `debits` | array (optional) | "Omitted entirely when nothing has been spent" (`entitlement.rs:84-87`) |

- **`payload` is a string, not a nested object**: "the string is the exact UTF-8 the server signed, so the Host can verify it byte for byte without either side needing a canonical-JSON scheme… any edit fails verification" (`entitlement.rs:9-15`). Kotlin doc says the same (`SignedEntitlementProvider.kt:43-49`).
- **Ed25519 over the payload's exact UTF-8 bytes, on the Kotlin side**: `Signature.getInstance("Ed25519")`, `verifier.update(payloadText.toByteArray(StandardCharsets.UTF_8))` (`SignedEntitlementProvider.kt:224-234`, `:338`), against `SERVER_PUBLIC_KEY_B64` = `MCowBQYDK2VwAyEAnfVRu1V0YzDkz9zC1lymY5Tz6TvOE9Lnizs89cbv6Tc=` (SPKI/DER, `SignedEntitlementProvider.kt:351-352`). "No private key for it exists in this repository… The private half lives with the CYVORIQ server. Replaced together with the real activation endpoint when the cloud control plane is wired in." (`SignedEntitlementProvider.kt:340-350`). The Rust layer never signs (`api.rs:73-75`, `entitlement.rs:3-7`).
- Export refuses an empty `payload` or `signature` (`Unverifiable`) rather than writing a document the Host is guaranteed to reject (`entitlement.rs:149-151`). Atomic write via `.json.tmp` + rename (`entitlement.rs:312-323`).

### `debits`: unsigned sibling journal that can only reduce

- It sits **beside** `payload`, never inside it: "`payload` is byte-exact server-signed text - editing it would break Ed25519 verification… so local consumption is recorded as a sibling field that the signature does not cover and does not need to: it can only ever *reduce* what the server granted, never widen it." (`entitlement.rs:26-32`; Kotlin restates it at `SignedEntitlementProvider.kt:150-155`).
- Entry shape `Debit { seq: u64, at: String (UTC ISO-8601), subject: String (certificate id, idempotency key), prev: String, hash: String }` (`entitlement.rs:33-42`); `hash` is SHA-256 over `{seq, at, subject, prev}` (`entitlement.rs:54-74`); first `prev` is `ledger::GENESIS` = 64 zero hex chars (`ledger.rs:46`), the same value Kotlin hardcodes as `GENESIS` (`SignedEntitlementProvider.kt:370-371`).
- Idempotent by `subject`: replaying the same certificate returns the existing entry (`entitlement.rs:186-218`).
- Journal survives a re-export under the **same** `signature`, and is reset on a **new** signature ("a new statement whose counts the server issued knowing everything it knows", `entitlement.rs:153-173`).
- Kotlin applies it **after** the signature check and only subtracts: `remaining = scansRemaining - certificates.size` clamped at ≥ 0, `scansUsed = deviceScanEntitlement - remaining`, so `used + remaining == entitlement` always (`SignedEntitlementProvider.kt:114-120`, `:211-222`).
- Journal integrity checked structurally (dense `seq` from 1, unbroken `prev`, one entry per certificate); a malformed journal is **denied, not skipped**; hashes are deliberately not re-hashed (`SignedEntitlementProvider.kt:157-173`, `:187-209`).

---

## 11. Kotlin verification rules

All from `apps/host/src/main/kotlin/cyvra/mobile/host/license/SignedEntitlementProvider.kt`. `load()` "never throws" — every defect degrades to a denied result (`SignedEntitlementProvider.kt:37-41`).

### Envelope-level checks (`verify`, lines 90-145)

1. Envelope parses as a JSON object — else `INVALID` (L91-92).
2. `schema == "cyvra.entitlement.v1"` — else `INVALID` (L94-95).
3. `payload` and `signature` are present as string primitives — else `INVALID` (L98-101).
4. Ed25519 signature verifies over the payload's UTF-8 bytes against the bundled key — else `SIGNATURE_INVALID`; "Any defect here - unknown algorithm, unusable key, malformed Base64 - is a failed verification, never a passed one" (L103-105, L224-234).
5. `payload` parses as a JSON object — else `INVALID` (L107-108).

### REQUIRED payload fields

| Field | Type | Where enforced | Missing / malformed |
|---|---|---|---|
| `licenseId` | non-blank string | `recordOf` L237 | `INVALID` |
| `serialNumber` | non-blank string | L238 | `INVALID` |
| `customerEmail` | non-blank string | L239 | `INVALID` |
| `planName` | non-blank string | L240 | `INVALID` |
| `status` | string matching a `LicenseEntitlementStatus` enum name | L241-243 | `INVALID` |
| `deviceScanEntitlement` | int | L245 | `INVALID` |
| `scansUsed` | int | L246 | `INVALID` |
| `scansRemaining` | int | L247 | `INVALID` |
| `validUntil` | ISO-8601 instant | L122-123 | `INVALID` |
| `serverTime` | ISO-8601 instant | L124-125 | `INVALID` |
| `graceLimitSeconds` | long ≥ 0 | L126-128 | `INVALID` (negative also `INVALID`, L128) |
| `offline.diagnostics` | boolean | `offlinePermissionsOf` L273-283 | `INVALID` |
| `offline.sanitizeExecute` | boolean | L273-283 | `INVALID` |
| `offline.upgrade` | boolean | L273-283 | `INVALID` |

**Optional** (a missing one does not deny): `customerName` (L259), `companyName` (L260), `revision` (defaults to `1`, L265), `validFrom` (L267). Unknown keys are ignored — "A future optional field must not deny a paying customer" (`ignoreUnknownKeys = true`, L63-66).

**A missing (or malformed) required field degrades to `LicenseFileReason.INVALID`** — every `?: return denied(LicenseFileReason.INVALID, …)` above — with the denied record: `status = UNKNOWN`, zero entitlement, `OfflinePermissions.NONE`, `graceLimitSeconds = 0` (L309-333). Precise exceptions (all still denials): bad signature → `SIGNATURE_INVALID` (L104), missing home → `HOME_PROPERTY_MISSING` (L69-70), missing/unreadable file → `FILE_MISSING`/`UNREADABLE` (L76-85), time failures → `EXPIRED` (L130, L134).

### Invariants checked

- `deviceScanEntitlement >= 0`, `scansUsed >= 0`, `scansRemaining >= 0`, and `scansRemaining <= deviceScanEntitlement` (L249-253).
- `graceLimitSeconds >= 0` (L128).
- `validUntil >= serverTime` — "A licence already expired when the server signed it is not a licence" (L129-130).
- `now <= validUntil + graceLimitSeconds` — "the licence is inside `validUntil` plus the grace limit the server itself put in the snapshot" (L34-35, L132-135).
- Journal-derived balance: `scansRemaining` clamped at 0 and `scansUsed` derived so `used + remaining == entitlement` (L211-221).
- Journal structure: dense `seq` from 1, `prev` chain from `GENESIS`, non-blank `at`/`hash`/`subject`, no duplicate `subject` (L187-209).
- The workstation's journal is applied only after the signature is proved, and only reduces (L114-120).

---

## 12. Open questions / unknowns the code cannot answer

None of the following is specified anywhere in the code. Each is **unknown — not specified in code**, and all belong to the future wiring task (W1.5):

1. **Endpoint URL.** Only the hostname family `cyvoriq.co.in` is named, in comments (`client.rs:3`, `mod.rs:29`). No path, no method, no environment split (prod vs staging) exists. The repo's `api.cyvoriq.co.in` is the web/mobile API hostname (`GUIDELINE.md:69`) with routes like `/health`, `/admin/serials`, `/evidence/batches` — none of them an activation route (§2).
2. **Wire format.** Whether `ActivationRequest`/`ActivationSuccess` are JSON, how fields are named on the wire (the Rust structs derive `Serialize` with default snake_case names, `api.rs:15-16,94-95`, but no encoding decision is recorded), and how `ActivationOutcome` maps to HTTP statuses or payload error codes — all unknown.
3. **Authentication.** `ActivationRequest` carries no token, session or signature beyond the licence key and fingerprint (`api.rs:14-27`); how `revalidate(device_token, device_fingerprint)` is authenticated (`api.rs:152`), whether the device token is a bearer credential, and what prevents replay — unknown.
4. **Server-side verdict mapping.** Which concrete condition produces `InvalidUser` vs `InvalidLicence` vs `LicenceNotActive` vs `LicenceExpired` vs `AlreadyBoundToAnotherComputer` on the server is not derivable from this repo — the client only defines the six receiving strings (`api.rs:45-68`).
5. **Grace policy.** How the server chooses `grace_expires_at_unix` (tests use 24 h, `state.rs:549`, but that is a fixture), and how the offline lease conveys the same instant to the Kotlin Host — `api.rs:109-111` says the lease "carries the same instant", yet the Kotlin provider reads a **relative** `graceLimitSeconds` from the payload (`SignedEntitlementProvider.kt:126-128`) and has no absolute-deadline field; the lease payload's actual shape is never defined in code. (See also ambiguities below.)
6. **Key management.** Where the Ed25519 private key lives ("with the CYVORIQ server", `SignedEntitlementProvider.kt:346`), key rotation, and when `SERVER_PUBLIC_KEY_B64` gets replaced — "Replaced together with the real activation endpoint" (`SignedEntitlementProvider.kt:348-350`), i.e. not yet.
7. **Network behaviour.** Timeouts, retries, rate limits, offline-detection details, certificate pinning, and whether `revalidate` runs on every launch against the network — none specified; the trait is synchronous with no timeout parameter (`api.rs:147-163`).
8. **`server_time` format enforcement.** Documented as ISO-8601 (`api.rs:102-104`) but carried as an opaque `String`; no parsing or validation exists on the Rust side (`api.rs:104`). Format unknown.
9. **Terms of service of the call.** Whether the server may push entitlement updates (new `entitlement` snapshot on revalidate), and how plan changes arrive — the export path supports re-export (`entitlement.rs:130-133`), but the trigger beyond activation/revalidation is not specified.

### Ambiguities / contradictions noticed while extracting

- **Task label "W1.5"**: no occurrence of `W1.5` exists anywhere in the repository (grep returns nothing); the label comes from the task instruction, not from repo docs. The document keeps it as requested but it is external to the code.
- **Two different grace representations**: the Rust side stores an absolute `grace_expires_at_unix` (`api.rs:116`) and `api.rs:109-111` claims the signed lease carries "the same instant" for the Host; the Kotlin Host validates against a relative `graceLimitSeconds` inside the entitlement payload (`SignedEntitlementProvider.kt:126-135`) and never reads an absolute instant. Whether the lease payload embeds an absolute deadline is not defined in code — the only lease fixtures in tests are opaque strings (e.g. `state.rs:556`, `entitlement.rs:593`).
- **`AlreadyBoundToAnotherComputer` → `ALREADY_BOUND`**: `code()` is not a mechanical transform of the variant name (`api.rs:65`) — a deliberate shortening; readers diffing names against codes should not expect a pattern.
- **"Missing field → INVALID" has exceptions**: expiry-related checks return `LicenseFileReason.EXPIRED`, and signature failure returns `SIGNATURE_INVALID`, not `INVALID` (`SignedEntitlementProvider.kt:104,130,134`). All are denials; only payload/envelope field defects are strictly `INVALID`.
- **`Reachability` default is `Reachable`** (`api.rs:136-138`) while the production client always reports `Unreachable` (`client.rs:40-42`): intentional — the default exists so an unscripted fake behaves like a healthy real server (`api.rs:135-137`), but it means `Default` is never representative of the shipped client.
- **Grace boundary wording**: `grace_expires_at_unix` is documented as the instant "at which the offline grace window ends" (`api.rs:105`), but the check `now_unix > stored.grace_expires_at_unix` (`state.rs:338`) admits entry *at* that exact second (test `state.rs:946-947`). The deadline second itself is inside the window.
