# WS-I — Release Pipeline Draft (E10)

| Field | Value |
|---|---|
| Status | `DRAFT` — authored under E10, **NOT executed against production** |
| Authored | 07-Oct-2026, TASK K PART 2 |
| Workflow | `.github/workflows/release-windows-installer.yml` |
| Trigger | `workflow_dispatch` **only** — never on push, schedule, or tag |
| Approvals used | A5 (spec ratification, PART 1) · WS-I drafting (E10) |
| Not used | no merge · no deploy · no Neon write · no Cloudflare mutation |

---

## 1. Why this document exists

The Windows installer **already builds successfully**. What has never existed is the job that
publishes it.

Evidence:

| Finding | Location |
|---|---|
| The build produces a ~115 MB artifact named `cyvra-mobile-windows-unsigned-engineering-artifact` containing `cyvra-mobile-desktop.exe`, `*.msi`, `*-setup.exe` | `.github/workflows/windows-engineering-build.yml:292-300` |
| The customer dashboard reads a build manifest at **build time** | `services/api/src/entitlement.ts:88` — `import committedBuild from "../../../apps/web/public/build-manifest.json"` |
| The manifest is normalised, never trusted | `services/api/src/entitlement.ts:121` `normalizeBuild()` |
| The manifest still says nothing exists | `apps/web/public/build-manifest.json` — `state: "unavailable"`, untouched since `c755ab4` (04-Oct-2026) |
| **No workflow, script, or package.json references `build-manifest`** | grepped all 4 workflows + `scripts/` + every `package.json` → zero hits |

The manifest's own `_readme` says it is *"Rewritten IN PLACE by the release job in the same commit
that uploads the assets."* **That release job was never written.** This draft is it.

This is why `cyvoriq.co.in/dashboard` renders `VERSION · Build unavailable` and
"No installer published yet". The system is currently behaving *correctly* — spec §14 says
*"Do not display Download as available when no authorized release exists."* The gap is the
pipeline, not a false statement.

---

## 2. Wire-value ruling — `state` (Chief Engineer, 07-Oct-2026)

TASK K originally specified `state="available"`. That value is **rejected by the API**.

`services/api/src/entitlement.ts:131`:

```ts
if (m.state !== "published" || version === null || sha256 === null) {
  return UNAVAILABLE_BUILD;
}
```

Writing `"available"` would make the whole pipeline run green while the dashboard *still* reads
"Build unavailable" — a silent failure. The Chief Engineer ratified the correction:

> **ON SCREEN** (spec §14, "BUILD AVAILABLE") **⇔ ON THE WIRE** `state = "published"`

The workflow's validate step proves this. Running the validator against a manifest with
`state: "available"` fails:

```
  FAIL  state === "published"
```

### The full `normalizeBuild()` contract

Any manifest this job writes must satisfy all of these, or the API degrades to `unavailable`:

| Field | Rule | Source |
|---|---|---|
| `state` | must be exactly `"published"` | `:131` |
| `version` | non-empty trimmed string | `:125-126` |
| `sha256` | `/^[0-9a-f]{64}$/i`, then lowercased | `:127-130` |
| `url` | `null`, **or** must start with `https://` | `:135` |
| `sizeBytes` | finite number `> 0`, truncated to integer | `:136-139` |
| `releasedAt` | parseable date, re-emitted as ISO 8601 | `:140-143` |

---

## 3. What the drafted workflow does

10 steps, one job, `ubuntu-latest`.

| # | Step | Implements |
|---|---|---|
| 1-2 | Checkout · set up Node 24 | — |
| 3 | **Resolve latest successful Windows Engineering Build** | find run id + artifact id; **fails if the artifact is missing or expired** |
| 4 | **Download artifact ZIP** | (a) via `GET …/artifacts/{id}/zip` |
| 5 | **Digest the ZIP (SHA-256 + size)** | (b) validates 64-hex + `size > 0` before proceeding |
| 6 | **PLACEHOLDER: upload to R2 / Workers Assets** | (c) **UNIMPLEMENTED — fails closed when `publish=true`** |
| 7 | **Update `build-manifest.json`** | (d) Node, preserves `_readme` + key order; workspace only |
| 8 | **Validate against `normalizeBuild()` contract** | gate — a manifest the API would reject fails the run |
| 9 | Show diff | transparency; prints `git diff` |
| 10 | Commit manifest update | gated on `publish == true` |

### Safety model

1. `workflow_dispatch` only.
2. `publish` defaults to **`false`** → pure dry run: nothing uploaded, nothing committed.
3. The R2 step **hard-fails** if `publish=true` before it is wired, and it runs *before* the commit
   step — so a manifest can never be committed describing an upload that did not happen. This
   preserves the invariant promised by `_readme`.
4. Step 8 rejects any manifest the API would silently downgrade.

### Inputs

| Input | Default | Meaning |
|---|---|---|
| `release_version` | `""` | e.g. `v0.1.0`. Required when `publish=true`. |
| `release_url` | `""` | Public `https://` URL the ZIP is served from. |
| `publish` | `false` | **Draft safety.** `false` = dry run. |

---

## 4. Manual runbook — until R2 / Workers Assets is configured

> **Hosting constraint (read first):** the installer ZIP is ~115 MB. Cloudflare **Pages** rejects
> files over **25 MiB**, and Workers static assets are similarly bounded. A 115 MB object must go
> to **R2** (5 GB multipart, no per-object problem) served through a custom domain or R2 public
> bucket URL. Do not try to ship this through Pages.

### 4.1 Where to get the artifact

**UI:** GitHub → **Actions** → **Windows Engineering Build** → latest **green** run →
*Artifacts* → `cyvra-mobile-windows-unsigned-engineering-artifact` → **Download artifact**.

**CLI:**

```bash
gh auth login

# 1. latest successful run of the build workflow
gh api "repos/mukpswar-prog/CYVRA-Mobile/actions/workflows/windows-engineering-build.yml/runs?status=success&per_page=1" \
  --jq '.workflow_runs[0].id'

# 2. artifact id on that run (must not be expired)
gh api "repos/mukpswar-prog/CYVRA-Mobile/actions/runs/<RUN_ID>/artifacts" \
  --jq '.artifacts[] | select(.name=="cyvra-mobile-windows-unsigned-engineering-artifact") | .id'

# 3. download the exact ZIP bytes
gh api "repos/mukpswar-prog/CYVRA-Mobile/actions/artifacts/<ARTIFACT_ID>/zip" \
  -o cyvra-mobile-windows-release.zip
```

> ⏳ **Artifacts expire** — GitHub retains them up to 90 days (repo-configurable under
> *Settings → Actions → Artifact and log retention*). If expired, re-dispatch the build first.
>
> 🔃 **Build freshness:** the last run was **#45 @ `2797615`** (06-Oct-2026), which predates
> `main @ 17c06a2`. Dispatch a fresh build against current `main` before publishing.

### 4.2 Digest the ZIP

PowerShell:

```powershell
(Get-FileHash .\cyvra-mobile-windows-release.zip -Algorithm SHA256).Hash.ToLower()
(Get-Item   .\cyvra-mobile-windows-release.zip).Length
```

bash:

```bash
sha256sum cyvra-mobile-windows-release.zip   # keep the value LOWERCASE
stat -c%s cyvra-mobile-windows-release.zip
```

### 4.3 Upload — placeholder (not yet configured)

Requires `CLOUDFLARE_ACCOUNT_ID` and an R2 bucket with a public/custom-domain URL.

```bash
export CLOUDFLARE_ACCOUNT_ID=<account id>

npx wrangler r2 object put "releases/cyvra-mobile-windows-v0.1.0.zip" \
  --file cyvra-mobile-windows-release.zip \
  --remote
```

Then confirm the object is publicly reachable over **https**:

```bash
curl -fsSI "https://releases.cyvoriq.co.in/cyvra-mobile-windows-v0.1.0.zip"
```

**Blocked on `CLOUDFLARE_API_TOKEN`** — not present in this environment (same blocker as
TASK A / J6). Nothing above has been executed.

### 4.4 Commit the manifest update

Edit `apps/web/public/build-manifest.json` — **keep `_readme` exactly as-is**:

```json
{
  "_readme": "<unchanged>",
  "state": "published",
  "version": "v0.1.0",
  "sha256": "<64 lowercase hex from 4.2>",
  "sizeBytes": 123456789,
  "url": "https://releases.cyvoriq.co.in/cyvra-mobile-windows-v0.1.0.zip",
  "releasedAt": "2026-10-07T12:00:00.000Z"
}
```

Validate **before** committing:

```bash
node -e "
const m = require('./apps/web/public/build-manifest.json');
const ok = m.state==='published'
  && typeof m.version==='string' && m.version.trim()!==''
  && /^[0-9a-f]{64}\$/i.test(m.sha256||'')
  && (m.url===null || /^https:\/\//.test(m.url))
  && typeof m.sizeBytes==='number' && m.sizeBytes>0
  && Number.isFinite(Date.parse(m.releasedAt));
console.log(ok ? 'normalizeBuild() gate PASS' : 'normalizeBuild() gate FAIL');
process.exit(ok?0:1);"
```

```bash
git add apps/web/public/build-manifest.json
git commit -m "release: publish v0.1.0 installer manifest (WS-I)"
git push
```

---

## 5. ⚠️ Two deploys are required — not one

This is the step most likely to be missed.

`entitlement.ts:88` **statically imports** the manifest, so the value is **compiled into the API
Worker bundle**. Editing the file and pushing does **nothing** until the Worker is rebuilt. And
both deploy workflows are `workflow_dispatch` only — nothing runs on push to `main`.

```bash
# 1. rebuild the API so GET /v1/me/entitlement serves the new manifest
gh workflow run "Deploy mobile API preview"

# 2. rebuild the site so /build-manifest.json served to the browser matches
gh workflow run "Deploy cyvoriq-www Pages"
```

Verify:

```bash
curl -s https://api.cyvoriq.co.in/v1/me/entitlement -H "Authorization: Bearer <token>"
curl -s https://cyvoriq.co.in/build-manifest.json
```

The dashboard then flips from `Build unavailable` to `BUILD AVAILABLE` with an orange
`[ DOWNLOAD CYVRA MOBILE .ZIP ]` per spec §13.

---

## 6. Verification performed on this draft

| Gate | Result |
|---|---|
| YAML parses (`yaml.safe_load`) | **PASS** — trigger `workflow_dispatch` only, 3 inputs, 1 job, 10 steps |
| `bash -n` on every shell step | **PASS** — 6 checked, 0 failed |
| `node --check` on both heredocs | **PASS** — 2 checked, 0 failed |
| Functional: manifest written from a real `build-manifest.json` | **PASS** — `_readme` preserved verbatim, key order unchanged |
| Functional: validator accepts a correctly-formed manifest | **PASS** — 6/6 checks |
| Negative: `state: "available"` | **PASS (rejected, exit 1)** — proves the §2 ruling was necessary |
| Negative: `sha256` length 63 | **PASS (rejected)** |
| Negative: uppercase `sha256` | **PASS (accepted)** — mirrors `normalizeBuild`'s `/i` flag |
| Negative: `http://` url | **PASS (rejected)** |
| Negative: `publish=true` with empty version | **PASS (rejected)** |
| `build-manifest.json` on this branch | **unchanged** — still `state: "unavailable"` |
| Production | **not touched** — no merge, no deploy, no Cloudflare call, no Neon write |

---

## 7. Still required before this can publish

| # | Item | Blocker |
|---|---|---|
| 1 | Configure R2 bucket + public/custom-domain URL | `CLOUDFLARE_API_TOKEN` **not set** |
| 2 | Implement the step-6 placeholder upload | depends on (1) |
| 3 | Decide the public host, e.g. `releases.cyvoriq.co.in` | Chief Engineer |
| 4 | Re-dispatch Windows Engineering Build against current `main` | manual dispatch |
| 5 | Artifact retention if builds are kept long | repo Settings → Actions |

---

## 8. Traceability

- **Master plan:** `docs/WS-K_MASTER_PLAN.txt` §3 (phases), §6 (gates), §9 (report protocol).
- **E10** — WS-I release pipeline drafting, approved 07-Oct-2026.
- **A5** — Customer Workspace spec ratification (PART 1 of TASK K, commit `e54a7d1`).
- **Spec §13/§14** — `docs/CYVRA_CUSTOMER_WORKSPACE_WORLD_CLASS_ARCHITECTURE_2026-10-07.txt`
  lines 355-397: `DOWNLOAD CYVRA MOBILE`, supporting info (version, release date, package type,
  file size, SHA-256), and download states.
- **Not superseded:** Design Freeze `docs/design-freeze/admin-panel-design-freeze.txt` @ `73d3f3a`
  remains LAW for the admin panel; this document concerns the customer surface only.
