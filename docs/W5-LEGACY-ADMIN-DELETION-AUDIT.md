# W5 — Legacy admin console deletion audit

> **Status:** audit only. Nothing was deleted, edited or committed.
> HEAD at time of audit: `0eea432` (*W5 Phase 3 — table-first admin console plus vitest/RTL harness*),
> branch `feature/p2-protocol-completion`, working tree clean.
>
> **Method:** read-only. Every claim below is backed by a grep, a line reference, or a live HTTP probe.
> No file in this repo was modified to produce this document.

---

## 1. What is live right now (evidence, not inference)

| Probe | Result |
| --- | --- |
| `admin.cyvoriq.co.in` | 200 → `/assets/index-CLI_zwkc.js`, `/assets/index-BhWSpSBp.css`, title *CYVRA Mobile \| Mobile Device Verification, Sanitization & Evidence*, Inter + Manrope |
| `www.cyvoriq.co.in` | **identical** asset hashes |
| `cyvoriq.co.in` (apex) | **identical** asset hashes |
| `cyvoriq-www.pages.dev` | **identical** asset hashes |
| `cyvoriq-admin.pages.dev` | **different** — `index-BRYtjAIM.js`, title *CYVRA Admin \| CYVORIQ SOLUTIONS PVT LTD*, Fraunces + IBM Plex |

The live bundle (380,906 bytes) contains:

- `"Ops sign in"` ✅
- `"Email sign-in code"` ✅
- `"Same layout family as Erase"` ✅
- `X-Admin-Email` ✅
- `cyvra_mobile_staff_session` ✅
- `Licence operations console` ❌ (Phase 3 marker, absent)
- `more pages remain` ❌ (Phase 3 pager marker, absent)
- baked API base: `https://api.cyvoriq.co.in` ✅

**Conclusion: the live site is a pre-Phase-3 build of `apps/web/src/site/AdminApp.tsx`.**

`cyvoriq-admin.pages.dev` is the foreign app described at `docs/resume-g8-freeze.md:134`:
*"Title `CYVRA Admin \| CYVORIQ SOLUTIONS PVT LTD`, Fraunces / IBM Plex. **Not this repo.** Do **not**
attach `admin.cyvoriq.co.in` to that project."* — still true today.

### There is no old backend

The old console calls the **same** `cyvra-mobile-api` Worker (`api.cyvoriq.co.in`) as the new one.
"The old service" is **one static Cloudflare Pages deployment of old code** — there is no separate
admin API, worker or database to retire.

---

## 2. DELETE — complete inventory

### Tier A — delete these files whole

| # | Path | Size | Evidence |
| --- | --- | --- | --- |
| A1 | `apps/web/src/site/AdminApp.tsx` | 856 lines | **Zero importers.** Grep for `AdminApp` across `*.{ts,tsx,js,jsx,json,jsonc,css,md,yml,yaml,html,mjs,cjs}` returns only its own `export function AdminApp()` at `:155`. `App.tsx:20` imports `./admin/AdminApp` — a different file. |
| A2 | `apps/web/src/site/admin.css` | all `.ops-*` rules | Imported by exactly one file: `site/AdminApp.tsx:8`. Every selector it defines (`.ops-login`, `.ops-login-brand`, `.ops-accent`, `.ops-shell`, `.ops-nav`, `.ops-main`, `.ops-grid`, `.ops-card`, `.ops-actions`, `.ops-table-wrap` …) has users only inside `site/AdminApp.tsx`. |

### Tier B — remove this block from `apps/web/src/api.ts`

**Edit the file — do not delete it.**

| Lines | Symbol | Evidence it dies |
| --- | --- | --- |
| 174 | `ADMIN_TOKEN_KEY` | only used by 178 / 186 (both below) |
| 175 | `ADMIN_EMAIL_KEY` | only used by 212 / 220 |
| 178–184 | `readAdminToken()` | sole caller is `adminRequest:230` |
| 186–193 | `writeAdminToken()` | **already dead today — no call site anywhere** |
| 212–218 | `readAdminEmail()` | sole caller is `adminRequest:231` |
| 220–226 | `writeAdminEmail()` | sole caller is `adminApi.verifyStaffCode:320` |
| 228–255 | `adminRequest()` | **the only place in the client that sends `X-Admin-Email`**; sole callers are `adminApi` |
| 257–283 | `interface MobileSerial` | only `api.ts` + `site/AdminApp.tsx` |
| 284–296 | `interface LicenceDraft` | only `api.ts` + `site/AdminApp.tsx` |
| 298–375 | `export const adminApi` | only imported by `site/AdminApp.tsx:3` |

**Rule of thumb:** delete `174–175, 178–193, 212–375`. **Keep `176` and `195–210`.**

#### Must KEEP inside `api.ts` — the traps

| Lines | Symbol | Why it stays |
| --- | --- | --- |
| 176 | `STAFF_SESSION_KEY` | session-storage key shared with the new console |
| 195–201 | `readStaffSession()` | `admin/client.ts:55` |
| 203–210 | `writeStaffSession()` | `admin/client.ts:256`, `admin/shell/session.tsx:126` |
| 75–172 | `export const api` + report interfaces | customer site (`App.tsx`, `WorkspaceApp`, `SignedInHome`, `ReportView`, `CustomerDesktopShell`) |
| 377–385 | `interface FreezeResult` | used at `api.ts:111` by the customer `api` |

### Tier C — stale legacy admin CSS in the marketing sheet

`apps/web/src/site/marketing.css` ships in **every** bundle (imported unconditionally by
`main.tsx:5`) and still carries a dead admin block:

| Lines | Selector | Verdict |
| --- | --- | --- |
| 739–742 | `.admin-shell` | No customer-side user — but it **leaks into the new console** (see §3) |
| 744–751 | `.admin-bar` | zero `.tsx` users |
| 753–761 | `.admin-card` | zero `.tsx` users |
| 763–766 | `.admin-card .btn` | zero `.tsx` users |
| 768–772 | `.admin-actions` | zero `.tsx` users |

Grep for `admin-bar|admin-card|admin-actions` across all `.tsx` → **no matches.**

### Tier D — unrelated dead code found along the way (decide separately)

| Path | Size | Note |
| --- | --- | --- |
| `apps/web/src/SignedInHome.tsx` | 105 lines | No importers anywhere (grep `SignedInHome` → only its own `export`). **Pre-existing and unrelated to the admin console** — do not bundle it into this commit unless you want to. |

### Tier E — comments/docs to correct (not deletions)

- `database/src/schema.ts:396-98` — *"...would cascade into `apps/web/src/api.ts` and the AdminApp
  that W5 is about to demolish."* → after deletion W5 has demolished it; update the comment.
- `docs/resume-g8-freeze.md:133` — records the current live behaviour of `admin.cyvoriq.co.in`;
  becomes stale after redeploy. Historical record — your call.

---

## 3. A real defect this audit surfaced

`marketing.css:739` defines an **unscoped** rule:

```css
.admin-shell { min-height: 100%; background: var(--paper); }   /* --paper: #f5f6f7 (marketing.css:8) */
```

The new console renders `<div className="admin-root"><div className="admin-shell">`
(`admin/shell/Shell.tsx:48-49`). Its own rule (`admin/styles.css:116`) sets `display: grid`,
`grid-template-columns` and `min-height: 100vh` — but **never sets `background`**.

Cascade result:

| Element | Rule | Specificity | Background |
| --- | --- | --- | --- |
| `.admin-root` | `admin/styles.css:101` | `0,1,0` | `var(--page-bg)` = **`#f3f4f6`** (spec) |
| `.admin-shell` (child) | `marketing.css:739` | `0,1,0` | `var(--paper)` = **`#f5f6f7`** — paints over the parent |

So the new console's visible shell background is `#f5f6f7`, not the spec `#f3f4f6`. This is the
**same cascade class** as the blue-CTA bug already fixed by scoping admin CSS under `.admin-root`.

Deleting Tier C fixes it. *(Verified by reading the cascade, not by rendering — eyeball it after the change.)*

---

## 4. DO NOT DELETE — the traps

| Keep | Why |
| --- | --- |
| `apps/web/src/App.tsx:55` `if (isAdminHost()) return <AdminApp />` | **Mount contract** — admin hosts must keep routing to the shell |
| `apps/web/src/site/hosts.ts` | `isAdminHost()` / `isAccountsHost()` |
| all of `apps/web/src/admin/**` (46 files) | the Phase 3 console |
| `site/WorkspaceApp.tsx`, `Layout.tsx`, `Home.tsx`, `Pages.tsx`, `Header.tsx`, `Footer.tsx`, `Photo.tsx`, `router.tsx`, `CustomerDesktopShell.tsx`, `marketing.css`, `workstation.css` | customer/marketing site — unrelated |
| **every server route** | see §5 |
| `.github/workflows/deploy-admin-cyvoriq.yml`, `apps/web/wrangler.cyvoriq-admin.jsonc` | needed to ship the new console |
| `services/api/wrangler.jsonc`, the `cyvra-mobile-api` Worker | one API serves both consoles |
| `services/api/src/index.ts:49` `allowHeaders: [..., "X-Admin-Email"]` | the server never *reads* it (E3); harmless to leave. Optional tidy, not a deletion. |
| foreign `cyvoriq-admin.pages.dev` project | not this repo; docs explicitly forbid touching it |

---

## 5. Server side: zero routes die

All endpoints the deployed legacy console calls are also called by Phase 3's `admin/client.ts`:

| Legacy endpoint | Used by Phase 3? |
| --- | --- |
| `POST /admin/auth/request` | ✅ |
| `POST /admin/auth/verify` | ✅ |
| `POST /admin/auth/logout` | ✅ |
| `GET /admin/me` | ✅ |
| `GET /admin/staff` | ✅ |
| `POST /admin/staff` | ✅ |
| `POST /admin/staff/:staffId/revoke` | ✅ |
| `GET /admin/serials` | ✅ |
| `POST /admin/serials` | ✅ |
| `POST /admin/serials/:serialId/issue` | ✅ |
| `POST /admin/serials/:serialId/revoke` | ✅ |
| `GET /admin/reports/licences` | ✅ |

**No server file, route or migration is a deletion candidate.** The cleanup is entirely
client-side plus one redeploy.

`adminRoutes` defines 25 routes; none becomes unreachable.

---

## 6. "Where to delete the old service" — the open blocker

Deleting code changes nothing until a build is deployed to **whichever Pages project owns the
domain.** That cannot be determined from this machine:

- `~/.wrangler` does not exist
- `CLOUDFLARE_API_TOKEN` is not in the environment
- `wrangler` is not on PATH
- all Cloudflare credentials live in GitHub (`secrets.CLOUDFLARE_API_TOKEN`, see
  `.github/workflows/deploy-admin-cyvoriq.yml`)

### Suspicious evidence

Live `admin.cyvoriq.co.in` has the **byte-identical** asset hash as `cyvoriq-www.pages.dev`,
while the admin-named project serves a foreign app. That is consistent with
**`admin.cyvoriq.co.in` being a custom domain attached to the `cyvoriq-www` project** — in which
case running `deploy-admin-cyvoriq.yml` (which deploys project `cyvoriq-admin`) would change
**nothing** and the old console would stay up. That would explain "old one is still active".

### Second smell

`deploy-admin-cyvoriq.yml` runs:

```bash
pnpm exec wrangler pages project create cyvoriq-admin --production-branch=main || true
pnpm exec wrangler pages deploy ../../apps/web/dist --project-name=cyvoriq-admin --commit-dirty=true
```

The `|| true` **swallows a name collision** — if a project named `cyvoriq-admin` already exists
(ours or the foreign one), `create` fails silently and the deploy target is whatever that
pre-existing project is.

### Resolve before doing anything (read-only, needs your token)

```bash
npx wrangler pages project list
npx wrangler pages deployment list --project-name=cyvoriq-www
npx wrangler pages deployment list --project-name=cyvoriq-admin
```

…or in the Cloudflare dashboard: **Workers & Pages → `cyvoriq-www` → Custom domains** and
**`cyvoriq-admin` → Custom domains** — see which one lists `admin.cyvoriq.co.in`.

### Then the sequence

1. Delete Tier A–C.
2. `pnpm.cmd -r typecheck` → exit 0; `pnpm.cmd -r test` → exit 0.
3. You review and commit.
4. Run the `Deploy cyvoriq-admin Pages` workflow **on `feature/p2-protocol-completion`** —
   `workflow_dispatch` checks out whatever ref you pick, so dispatching from `main` would deploy
   the old code again.
5. Confirm the domain is attached to the project that was just deployed.

---

## 7. Unexplained anomaly

The screenshot showed **`POST /admin/staff/invite`**. That path does not exist in this codebase:

- repo-wide grep for `staff/invite` across `*.{ts,tsx,js,jsx,json,css,md,yml,yaml}` → **no matches**
- `git log -S "staff/invite" --all` → **empty** (all local branches including `origin/*`)
- not present in the other two local clones on this machine
- not present in the live bundle — the `/admin/*` literals extracted from `index-CLI_zwkc.js` are
  the 9 listed in §5
- its error format `Request failed (500) (POST /admin/staff/invite)` also differs: this bundle emits
  `Request failed (500)` with **no** method/path suffix
- the API has no such route (`adminRoutes` defines 25 routes; `/staff/invite` is not one — it would
  have returned 404, not 500)

**Action:** confirm which tab/URL produced that screenshot. It may be a third console not yet
accounted for.

---

## 8. Verification gates (after deletion, before commit)

```bash
# 1. dead-symbol greps — every one must return 0 hits
#    site/AdminApp | site/admin.css | adminApi | MobileSerial |
#    LicenceDraft | readAdminToken | readAdminEmail | admin-bar | admin-actions

# 2. gates
pnpm.cmd -r typecheck     # expect exit 0
pnpm.cmd -r test          # expect exit 0 — web 9 files / 270 tests
```

The 9 Phase 3 test files grep clean for
`adminApi|site/AdminApp|admin.css|MobileSerial|LicenceDraft` — **no test edits are required.**

Dev gotchas carried over: use `pnpm.cmd` never bare `pnpm`; PowerShell has no `&&`; redirect
output to a file and grep for `ELIFECYCLE` / `ERR_PNPM` / `Done`.

---

## 9. Summary

**Delete**

- `apps/web/src/site/AdminApp.tsx` (856 lines)
- `apps/web/src/site/admin.css`
- `apps/web/src/api.ts` lines `174–175`, `178–193`, `212–375`
- `apps/web/src/site/marketing.css` lines `739–772`
- *(optional, unrelated)* `apps/web/src/SignedInHome.tsx`

**Correct:** `database/src/schema.ts:396-98` comment.

**Do not delete:** the mount contract at `App.tsx:55`, `site/hosts.ts`, any of `src/admin/**`,
any server route, the deploy workflow, `wrangler.cyvoriq-admin.jsonc`, the foreign
`cyvoriq-admin.pages.dev` project.

**Blocker:** confirm which Pages project owns `admin.cyvoriq.co.in` — otherwise the redeploy will
not replace the old console.
