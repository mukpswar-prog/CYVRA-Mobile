# Customer Dashboard — Deep Forensic Audit

**Date:** 2026-10-05
**Status:** DIAGNOSTIC — read before writing any more customer-facing code
**Scope:** Why `cyvoriq.co.in/dashboard` still shows the pre-plan UI while `admin.cyvoriq.co.in` is current.
**Method:** Static analysis of the worktree, `git` history across all refs, and read-only inspection of the deployed production bundles.

---

## 1. Verdict

The customer dashboard is not stale by accident. **It was never wired.** No commit has ever connected it to a real API, and no commit has touched the customer website surface in the last ten days while 60 commits landed elsewhere.

This is not a build, cache, or deployment failure. Redeploying would change nothing: the shipped bundle contains the mock data because the source does.

The single most important finding:

> **The server-side plan plumbing is already finished and waiting.** `POST /auth/request` accepts a plan, validates it, snapshots it onto the OTP challenge, and the registration bridge writes it to the licence. The client simply never sends the field.
> `apps/web/src/api.ts:54-62` — `RegistrationInput` has no `plan`.

So the missing plan picker requires **zero server work**. That was not known until now; the previous workstream assumed a new `POST /v1/licence-request` route was required.

---

## 2. Proof — the dashboard you are looking at is fake

The header in the screenshot ("PLAN · 25 Device Scans", "0 / 25 (25 left)", "ACTIVE", "v3.2.1-g5") comes from a literal object, not the network.

`apps/web/src/site/CustomerDesktopShell.tsx:71-81`

```ts
const [license, setLicense] = useState<{ ... }>({
  licenseId:     "LIC-MOB-2026-00124",   // invented
  serialNumber:  "CYVRA15092026SA3F1-1-25", // invented
  planName:      "25 Device Scans",      // invented
  scansTotal:    25,                     // invented
  scansUsed:     props.reports.length,   // ← the only real number
  scansRemaining: Math.max(0, 25 - props.reports.length),
  revision:      1,
  status:        "ACTIVE",               // the real row is PAYMENT_PENDING
  version:       "3.2.1-g5",
});
```

Everything else in that header is likewise literal: `model: "Moto G54 5G (Live Device)"` (line 49), `targetPlan: "25 Device Scans"` (line 161), `approvedBy: "ceo@cyvoriq.com"` (line 167), `STANDBY / READY` (line 937), `v3.2.2-release` (line 906).

### Deployed-bundle verification (read-only GET, 2026-10-05)

Both `https://cyvoriq.co.in/dashboard` and `https://admin.cyvoriq.co.in/` serve `assets/index-3ri1dpNg.js` (448,163 bytes).

| Probe | Result |
|---|---|
| `"25 Device Scans"` present in shipped JS | **YES — 4 matches** |
| `me/entitlement` present in shipped JS | **NO** |
| `"Ready to issue"` (label polish) present | **NO** |
| `GET https://api.cyvoriq.co.in/v1/me/entitlement` | `401 {"error":"Sign in required."}` — mounted and working |
| `GET https://cyvoriq.co.in/build-manifest.json` | `"state": "unavailable"` |

Production is therefore serving mock data, and the one endpoint built to replace it has **no consumer anywhere in the shipped bundle**.

### The two surfaces disagree about the same customer

| | Admin console (real) | Customer dashboard (mock) |
|---|---|---|
| Plan | `CAP-1 / 1-1` | `25 Device Scans` |
| Status | `PAYMENT PENDING 1` | `ACTIVE` |
| Scans | n/a | `0 / 25 (25 left)` |
| Version | — | `v3.2.1-g5` |

Same signed-in customer, two irreconcilable truths. This is the defect the user is seeing.

---

## 3. Root causes — six, in causal order

### RC-1 · The client has no way to ask for entitlement
`apps/web/src/api.ts` exposes, for the customer surface: `health`, `requestOtp`, `verifyOtp`, `me`, `logout`, `reportSessions`, `listReports`, `getReport`, `freezeReport`, `getLicense`.

There is **no `entitlement()` method**. The only occurrence of the word in `api.ts` is a dead type field, `deviceScanEntitlement: number` (line 123).

`GET /v1/me/entitlement` exists, is production-wired with ensure-on-session backfill (`services/api/src/entitlement.ts:419-433`), and has **never been called by any web code**.

### RC-2 · The dashboard never fetches it anyway
`apps/web/src/site/WorkspaceApp.tsx:63` fetches only:

```ts
Promise.all([api.reportSessions(), api.listReports()])
```

Evidence sessions and reports — which is why "ACTIVE SESSIONS & READY TO FREEZE · 0 recorded session(s)" is the one panel that is honest. Licence/plan/usage is never requested.

### RC-3 · The registration form has no plan field
`apps/web/src/api.ts:54-62`

```ts
export interface RegistrationInput {
  fullName; companyName; addressLine1; addressLine2; pincode; state; email;
}   // ← no plan
```

`WorkspaceApp`'s register form (lines 204-298) has no plan picker either.

Server side, `services/api/src/registration.ts:71-74`:

```ts
if (raw === undefined || raw === null || raw === "") {
  return { ok: true, value: REGISTRATION_DEFAULT_SLAB };   // = 1
}
```

**Consequence: every real registration silently creates a slab-1 licence.** The admin registry confirms it — the one live row is `CAP-1 / 1-1`.

### RC-4 · The plan picker needs no server work (previously unknown)
The full chain already exists and is committed:

1. `registration.ts:97` — `const plan = parsePlan(body.plan ?? body.deviceMax);`
2. `index.ts:86` — `parseRegistration(body)` runs on `POST /auth/request`
3. `index.ts:105` — `deviceMax: profile.deviceMax` is snapshotted onto `email_otp_challenges`
   *comment:* "a plan cannot be changed between asking for a code and entering it"
4. `index.ts:245` — `/auth/verify` passes `challenge.deviceMax ?? REGISTRATION_DEFAULT_SLAB` to the bridge
5. `bridge.ts` writes it to `mobile_serials.device_max`
6. Valid slabs: `1, 5, 10, 25, 50` (`ISSUABLE_SLABS`), rejected with a clean 400 otherwise

**Only the client is missing.** Adding `plan` to `RegistrationInput` plus five radio buttons closes RC-3 with no migration, no route, no state-machine change.

The server even says so — `entitlement.ts:430-432`:

```ts
// No plan picker exists, so a backfilled row takes the registration
// default rather than a slab nobody chose.
deviceMax: REGISTRATION_DEFAULT_SLAB,
```

### RC-5 · `CustomerDesktopShell` is a 3,449-line simulation
Last touched **2026-09-16** (`73aab2c`, "Phase 24 Final Signed Production Release Freeze"). It simulates Phases 13, 17, 19, 21, 22, 39 and 41 as local `useState`: offline entitlement, signed cache, upgrade orders, immutable revision ledger, scan accounting ledger, body inspection, condition reports.

It also still ships a defect already filed in `docs/archive/2026-09-pre-final-baseline/CYVRA_MOBILE_RECTIFICATION_PLAN.txt:13`:

`CustomerDesktopShell.tsx:919`
```ts
alert("Production Installer Download Triggered:\nCYVRA-Mobile-Setup-v3.2.2-x64.exe\n\n...")
```

The download button shows an alert instead of downloading an executable — the exact symptom the rectification plan recorded, still live.

### RC-6 · There is no installer, so the version badge cannot be real
`/build-manifest.json` is `"state": "unavailable"` — never released. Its own `_readme` states it is "the single source of truth for the version and SHA-256 the customer dashboard shows … read by `GET /v1/me/entitlement`". Until the release job runs, RC-1's wiring would still have no version to display.

---

## 4. Where the effort actually went

**237 commits** since 2026-09-08.

Commits touching each surface, whole history:

| Surface | Commits |
|---|---:|
| `apps/web/src/site` (customer site) | 27 |
| `services/api` | 26 |
| `apps/web/src/site/CustomerDesktopShell.tsx` | 19 |
| `database/` | 13 |
| `apps/web/src/api.ts` | 10 |
| `apps/web/src/site/WorkspaceApp.tsx` | 5 |
| `apps/web/src/admin` | 5 |

**Commits since 2026-09-25 (10 days, 60 commits total):**

| Area | Commits |
|---|---:|
| `apps/desktop` | **26** |
| `services/api` | 11 |
| `apps/web/src/admin` | 5 |
| `database` | 4 |
| **`apps/web/src/site`** | **0** |

Last-touch dates:

- `CustomerDesktopShell.tsx` — **2026-09-16** (19 days ago)
- `WorkspaceApp.tsx` — **2026-09-15** (20 days ago)

**Zero commits to the customer website in ten days.** The effort was not wasted — it went to the desktop app and the API — but none of it reached the customer web surface.

---

## 5. What has been achieved, against plan

### Done and verified

| Item | Evidence |
|---|---|
| Licence state machine, audit engine, RBAC, E3 identity fix | `2287b9c` W5 Phase 1 |
| Server-side search, 12 action routes, staff lifecycle, payment waiver | `a1132c4` W5 Phase 2 |
| Five API gaps closed for the admin console | `6ff8065` W5 Phase 2b |
| Table-first admin console + vitest/RTL harness | `0eea432` W5 Phase 3 |
| KPI counts at `pageSize=25`, matching server contract | `211f920` |
| `GET /v1/me/entitlement` + build projection | `c755ab4` |
| `POST /v1/activation/revalidate` (D2) + production base URL | `8810dc4` |
| WS-A registration bridge; Call A (`issued_by` nullable); Call B (Plan 10) | `8f83f86` |
| Drawer aligned to Design Freeze §29/§85 | `75f83fa` (merged, PR #44) |
| Design Freeze label polish §7.3/§54/§8 | `2f6f36a` — **pushed to branch, NOT merged** |
| Migration 0008 applied to Neon by hand (schema-before-code preserved) | user, Oct 5 12:05 |
| Desktop: W1 activation, W2 ledger, P5 protocol UI | 26 commits in 10 days |
| Gates green | typecheck 0 · test 0 (374/277/71/26) · wrangler dry-run 0 |

### Not started

| Item | State |
|---|---|
| Customer dashboard wired to entitlement | **0 commits ever** |
| Plan picker for the customer | **absent client and server-side UI** |
| Installer publishing + build manifest | `"state": "unavailable"` |
| Dashboard live figures (`Moto G54`, `CYVRA15092026SA3F1`, `LIC-MOB-2026-00124`, `pay_live_initial_90124`) | all still mock; must go to `0` |
| Label polish deployment | branch only, awaiting merge |

**Answer to "are we wasting our time?":** No. The backend half of the plan is real, tested and live. But roughly the entire *customer-visible* half has not been started, and for ten days all throughput went to the desktop app. The frustration is correctly aimed — the admin is finished, the customer surface is untouched.

---

## 6. What is needed — ordered, with cost

### A. Plan picker at registration — **no server changes required**
1. Add `plan?: number` to `RegistrationInput` (`apps/web/src/api.ts:54-62`).
2. Add a radio group `1 / 5 / 10 / 25 / 50` to the `WorkspaceApp` register form (~line 204).
3. Send it in the `requestOtp` body — `api.ts:83-86` already `JSON.stringify`s the profile.
4. Test: assert `email_otp_challenges.device_max` receives the chosen value, and a `plan: 100` returns the existing 400 sentence.

*Closes RC-3, RC-4. No migration, no route, no state-machine change.*

### B. Wire the dashboard to `GET /v1/me/entitlement`
1. Add `entitlement: () => request<Entitlement>("/v1/me/entitlement")` to `api.ts`.
2. Call it from `WorkspaceApp` alongside `reportSessions`/`listReports` (line 63).
3. Pass the result into `CustomerDesktopShell` as a prop.
4. Delete the hardcoded `license` `useState` (`CustomerDesktopShell.tsx:71-81`) and read the prop.
5. Handle the documented 404 (`"Licence not found."`) as its own state, and 503 (`"Entitlement is unavailable."`) as another — **never** fall back to mock values.
6. Re-probe production: `Moto G54`, `CYVRA15092026SA3F1`, `LIC-MOB-2026-00124`, `pay_live_initial_90124` must all resolve to `0`/absent.

*Closes RC-1, RC-2. Server already live (verified 401 today).*

### C. Retro/upgrade path — **genuine gap, STOP before building**
A signed-in customer who wants to *change* slab has no committed route. `POST /v1/licence-request` has never existed (proven four ways: 40 registrations, `git log --all -S` empty, no ref, no untracked copy).

Note the retro case does **not** need it: the bridge runs on every sign-in (`index.ts:224`) and again on every entitlement read (`entitlement.ts:382`). Records self-heal. What is missing is *slab selection after registration* — i.e. upgrades.

**Decision required before any code:** does the customer pick a slab only once at registration (A covers it), or can they upgrade later (needs a designed route + payment story)?

### D. Installer release job
`windows-engineering-build.yml` is still `permissions: contents: read`, triggers only on `phase2-correct`/`feature/p2-protocol-completion`, uploads nothing, has no SHA-256. Needs `contents: write`, trigger on `main`, `Get-FileHash` → `SHA256SUMS.txt`, upload `.exe`/`.msi`/sums, re-download and re-verify. This also unblocks the dashboard version badge (RC-6).

### E. Ship what is already finished
Merge the label-polish commit `2f6f36a` (branch-only) and redeploy Pages so `Ready to issue`, `Staff & Roles`, `Audit Log` reach production.

### F. Retire the simulation
Once A+B land, the invented Phase 17/19/21 panels (upgrade orders, revision ledger, offline entitlement) either bind to real endpoints or come out. Keeping them means shipping a UI that contradicts the database. Also remove the `alert()` at line 919 (RC-5).

---

## 7. The failure mode to avoid repeating

Every prior workstream was gated on *server* correctness — routes, migrations, state machine, tests — and all of those gates passed. Nothing ever gated on **"does the customer see real data?"**.

The admin got that gate implicitly because its KPI counts were tested against server pagination. The customer dashboard has no test, no fetch, and no gate, so it silently stayed at its September-15 prototype while the system beneath it was rebuilt.

**Recommendation:** add one end-to-end assertion — signed-in customer loads `/dashboard`, the plan shown equals `mobile_serials.device_max` for that email. One test would have caught this on 2026-09-17 instead of 2026-10-05.

---

## 8. Current coordinates

```
worktree   .worktrees\cyvra-mobile-implementation
branch     feature/p2-protocol-completion
HEAD       2f6f36a   (label polish — pushed, not merged)
origin/main 0e23876  (PR #44 = drawer polish)
live bundle assets/index-3ri1dpNg.js   (both www and admin host)
live API   https://api.cyvoriq.co.in   /v1/me/entitlement → 401 (healthy)
```
