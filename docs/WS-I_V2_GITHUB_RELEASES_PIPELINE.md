# WS-I v2 — Release Pipeline on GitHub Releases

| Field | Value |
|---|---|
| Status | `DRAFT` — authored under TASK L, **NOT executed**, nothing published |
| Authored | 08-Oct-2026, TASK L (RESUME protocol) |
| Branch | `feature/ws-i-v2-ws-k3` off `origin/main` @ `17a37b4` |
| Supersedes | the **storage layer only** of `docs/WS-I_RELEASE_PIPELINE_DRAFT.md` (E10): §3 step (c), §4 manual runbook, §7 items 1-3 |
| Does **not** supersede | the `state = "published"` wire ruling · the `normalizeBuild()` contract · the safety model · §6 verification method · §5 two-deploy warning (still true) |
| Approvals used | **R2 dropped, GitHub Releases chosen** — Chief Engineer, 07-Oct-2026 state save |
| Approvals **not** used | no commit · no merge · no deploy · no Neon write · no Cloudflare mutation · no release created |

---

## 1. What changed, and why

On 07-Oct-2026 the Chief Engineer ruled:

> **R2 plan we need to drop due to feasibility, we are researching on the alternative way.**

WS-I v1 was blocked on exactly one thing: **somewhere to put a 115 MB file.**

| v1 blocker (E10 §7) | Why it was fatal | v2 status |
|---|---|---|
| Configure R2 bucket + public/custom-domain URL | `CLOUDFLARE_API_TOKEN` **not set**, and must not be requested | **Removed** — no bucket, no domain, no DNS, no wrangler |
| Implement the step-6 upload placeholder | depended on the above | **Replaced** by a real upload (§5 below) |
| Decide the public host (`releases.cyvoriq.co.in`) | a product/DNS decision | **Removed** — host is `github.com` |

Nothing else in the v1 design changes. The manifest, the validator, the commit gate and the fail-closed ordering were already correct and are carried forward verbatim.

---

## 2. Why GitHub Releases is the right warehouse here

| Property | GitHub Releases | Cloudflare R2 (v1) |
|---|---|---|
| Credential required in CI | `github.token` — **automatic**, already declared as `permissions: contents: write` in the drafted workflow | `CLOUDFLARE_API_TOKEN` — **absent**, must not be requested |
| Max object size | **2 GiB** per asset (ZIP ≈ 115 MB) | 5 GB multipart — no advantage at this size |
| Public download without auth | yes, for a **public** repo (see precondition **P1**) | yes, once a public/custom domain exists |
| Retention | assets live **as long as the release** | bucket lifecycle policy to configure |
| Extra infrastructure | none | bucket + domain + DNS + wrangler + token |
| Cost | free within repo storage | egress + storage |

The deciding factor is not capability — R2 is perfectly capable — it is that **every R2 requirement is a thing we currently cannot do**, while every GitHub Releases requirement already exists.

### Feasibility evidence, 08-Oct-2026

| Check | Result |
|---|---|
| Repo visibility (unauthenticated `GET /repos/...`) | `private: false` — **public** |
| Unauthenticated API access | HTTP 200 |
| `permissions: contents: write` already in `release-windows-installer.yml` | yes — required for `gh release create` |
| Windows artifact size vs 2 GiB asset cap | ≈115 MB ≪ 2 GiB |
| Artifact source | `windows-engineering-build.yml:292-300`, `actions/upload-artifact@v6`, name `cyvra-mobile-windows-unsigned-engineering-artifact` |

### Two properties that matter more than they look

1. **Actions artifacts expire after 90 days; release assets do not.** v1's runbook had to tell an operator to "re-run the Windows Engineering Build" when an artifact expired. A release has no such clock, so a published version's URL stays valid.
2. **The release *is* the authorization event.** `state: "published"` in the manifest now means "a release object exists on the repository". There is one place to look, one place to delete, and no shadow copy in a bucket nobody has credentials for.

---

## 3. Non-negotiable invariants

1. **`state` is `"published"`** — `services/api/src/entitlement.ts:131` rejects any other value. On-screen `BUILD AVAILABLE` ⇔ on-wire `state: "published"`.
2. **Asset before manifest.** The manifest commit may only happen *after* the release asset exists **and** has been fetched successfully. A manifest pointing at a 404 is worse than `unavailable`, because `unavailable` is honest and a dead `BUILD AVAILABLE` is not.
3. **Never delete or replace the asset the current manifest references.** Deleting it silently converts a published build into a broken download. Rotation rule: keep the release referenced by `manifest` plus the previous one; delete only older ones.
4. **The repository must remain public** while the manifest URL points at a `github.com` asset. A private repo makes every asset require a token, and the customer has none. (If the repo is ever made private, §7 Option B must be adopted first.)
5. **Publishing must not overwrite an existing tag.** Re-running with `publish=true` on a version that already exists **fails the run** rather than silently swapping bytes under a version a customer may already have verified.
6. **No `CLOUDFLARE_API_TOKEN`, no Neon, no bucket.** This pipeline touches GitHub and the repository only.

---

## 4. The pipeline

```
Windows Engineering Build (workflow_dispatch, windows-latest)
        │  artifact: cyvra-mobile-windows-unsigned-engineering-artifact (~115 MB)
        ▼
WS-I v2 release job (workflow_dispatch, ubuntu-latest)
  1. resolve latest SUCCESSFUL build run + non-expired artifact      [carried from v1]
  2. download the exact artifact ZIP                                  [carried from v1]
  3. sha256 + sizeBytes, validated against normalizeBuild()           [carried from v1]
  4. ── if publish=false ── stop here: dry run, nothing leaves runner  [carried from v1]
  5. gh release create <tag> --prerelease --notes <digest block>       [NEW - replaces R2]
     gh release upload <tag> cyvra-mobile-windows-<version>.zip
  6. verify: HEAD/GET the final asset URL returns 200 + Content-Length [NEW - fails closed]
  7. write build-manifest.json (state, version, sha256, sizeBytes,
     url, releasedAt) — _readme preserved verbatim                     [carried from v1]
  8. validate the produced manifest against normalizeBuild() 6 checks  [carried from v1]
  9. commit + push the manifest only, and only when publish=true       [carried from v1]
```

Steps 1-4 and 7-9 are the v1 workflow unchanged. Only the storage step and its verification are new.

---

## 5. Draft delta to `.github/workflows/release-windows-installer.yml`

Step (c) — currently a placeholder that hard-fails with
`::error::PLACEHOLDER NOT IMPLEMENTED` — becomes:

```yaml
      # (c) Publish the ZIP as a GitHub Release asset — the warehouse in WS-I v2.
      #
      # Replaces the v1 R2 / Workers Assets placeholder (R2 dropped for
      # feasibility, Chief Engineer 07-Oct-2026). Fails CLOSED in both
      # directions: a tag that already exists aborts before any asset is
      # written, and a URL that cannot be fetched aborts before the manifest
      # is touched — so a manifest can never describe a build that is not
      # actually downloadable.
      - name: Publish GitHub Release asset
        id: upload
        env:
          GH_TOKEN: ${{ github.token }}
          PUBLISH: ${{ inputs.publish }}
          VERSION: ${{ inputs.release_version }}
        run: |
          set -euo pipefail

          # Normalise under `set -u`: an absent input must reach the friendly
          # ::error:: below, not die on an "unbound variable" traceback.
          # Fail-safe direction - an unset PUBLISH dry-runs, it never publishes.
          PUBLISH="${PUBLISH:-false}"
          VERSION="${VERSION:-}"

          if [ "${PUBLISH}" != "true" ]; then
            echo "::notice::DRY RUN - no release, no asset, nothing leaves this runner."
            echo "url=" >> "${GITHUB_OUTPUT}"
            exit 0
          fi
          if [ -z "${VERSION}" ]; then
            echo "::error::release_version is required when publish=true."
            exit 1
          fi
          case "${VERSION}" in
            v*) ;;
            *) echo "::error::release_version must look like v0.1.0 (it becomes the git tag)."; exit 1 ;;
          esac

          ASSET="cyvra-mobile-windows-${VERSION}.zip"

          if gh release view "${VERSION}" >/dev/null 2>&1; then
            echo "::error::Release '${VERSION}' already exists. Refusing to overwrite a published artifact - publish a new version instead (invariant 5, docs/WS-I_V2_GITHUB_RELEASES_PIPELINE.md)."
            exit 1
          fi

          # --prerelease: the artifact is UNSIGNED (windows-engineering-build.yml
          # header: "Do not present this artifact as a signed or commercial
          # release"). See ruling R-I1.
          gh release create "${VERSION}" \
            --prerelease \
            --title "CYVRA Mobile ${VERSION} (unsigned engineering build)" \
            --notes "$(printf '%s\n\n- SHA-256: `%s`\n- Size: %s bytes\n- Source workflow: Windows Engineering Build %s' \
              "Unsigned engineering artifact. Verify the SHA-256 against build-manifest.json before installing." \
              "${SHA256}" "${SIZE_BYTES}" "${RUN_ID}")" \
            "cyvra-mobile-windows-release.zip#${ASSET}"

          URL="https://github.com/${GITHUB_REPOSITORY}/releases/download/${VERSION}/${ASSET}"

          # INVARIANT 2 — the asset must actually be fetchable before any
          # manifest is written. -L follows github.com -> objects.githubusercontent.com.
          HTTP="$(curl -sIL -o /dev/null -w '%{http_code}' "${URL}")"
          if [ "${HTTP}" != "200" ]; then
            echo "::error::Release asset not fetchable (HTTP ${HTTP}) at ${URL}. Aborting before the manifest is touched."
            exit 1
          fi
          REMOTE_BYTES="$(curl -sIL "${URL}" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}' | tail -1)"
          if [ -n "${REMOTE_BYTES}" ] && [ "${REMOTE_BYTES}" != "${SIZE_BYTES}" ]; then
            echo "::error::Uploaded size ${REMOTE_BYTES} != digested size ${SIZE_BYTES}. Aborting."
            exit 1
          fi

          echo "url=${URL}" >> "${GITHUB_OUTPUT}"
          echo "Published ${URL}"
```

Three other edits, all mechanical:

| Where | Change |
|---|---|
| `inputs.release_url` | **delete** — the URL is derived, never typed. A hand-typed URL is a hand-typed lie. |
| `inputs.publish` description | drop "Set true only after R2/Workers Assets is configured" → "true = create a GitHub Release and commit the manifest" |
| file header comment block | status paragraph: R2 dropped, warehouse = GitHub Releases, doc pointer → this file |

`permissions: contents: write` and `actions: read` were already correct for both the artifact download and `gh release create`. Nothing else in the 258-line workflow moves.

---

## 6. Ruling R-I1 — what we are actually handing a customer

The artifact carries an explicit warning in its own workflow header
(`windows-engineering-build.yml:19-21`):

> *UNSIGNED ENGINEERING ARTIFACT — this repository has no code-signing … Do not present this artifact as a signed or commercial release.*

Publishing it makes a publicly downloadable `.exe`/`.msi`. Spec §102 requires the
"CYVRA Mobile ZIP download" in V1, and §103 does **not** exclude it — so the
download ships — but three mitigations should be decided as a set:

| # | Mitigation | Needs |
|---|---|---|
| 1 | `--prerelease` on the release (drafted above) — keeps it out of the "Latest release" slot | none |
| 2 | Download card states the package is unsigned (§13 supporting info: version, release date, package type, size, SHA-256) | a UI line — **follow-up, not in TASK L** |
| 3 | The SHA-256 in the manifest is what makes the bytes verifiable | already in the design |

**Recommendation:** ship 1 now, schedule 2 with the download-card work, and treat code signing as a WS-I v3 item.

---

## 7. The one problem GitHub Releases does **not** solve

`entitlement.ts:88` **statically imports** the manifest, so `state` is *compiled
into the API Worker bundle*. Editing the file does nothing until the Worker is
rebuilt — and, as the v1 draft's §5 recorded, **neither deploy runs on push**:

| Surface | How it updates | Evidence (08-Oct-2026) |
|---|---|---|
| Site (`cyvoriq.co.in`) | Cloudflare Pages **Git Integration auto-deploys on push to `main`** | `Deploy cyvoriq-www Pages` last ran **#9 on 05-Oct** @ `447799c`, yet Phase 2 (07-Oct 20:15) and Phase 3 (07-Oct 22:35) are both live — the workflow did not do that |
| API (`api.cyvoriq.co.in`) | **`workflow_dispatch` only** — `.github/workflows/deploy-mobile-api-preview.yml:9-10` | last run **#13 on 07-Oct** @ `17c06a2`; secret `CLOUDFLARE_API_TOKEN` therefore **exists in the repo** (that run succeeded) |

**Consequence:** after the release job pushes the manifest, the site flips to
`BUILD AVAILABLE` while the API keeps serving the old bundled value until someone
dispatches *Deploy mobile API preview*. Two sources of truth disagreeing is
precisely the class of defect this project has been removing.

### Option A — keep the build-time import (recommended for v2)
Explicit runbook: release job commits manifest → **dispatch the API deploy** → verify both endpoints. Cheap, zero code change, but it is a human step that will eventually be skipped.

### Option B — read the manifest at runtime (recommended follow-up)
`entitlement.ts` fetches `https://cyvoriq.co.in/build-manifest.json` at request time with a short cache, failing closed to `UNAVAILABLE_BUILD` on any error, non-200 or malformed body.

* **Pro:** one source of truth, one deploy, no bundling drift, the "two deploys" trap disappears permanently.
* **Con:** a new runtime dependency (Pages availability) and a new failure mode — mitigated because the existing `normalizeBuild()` gate already fails closed, and a cache means Pages downtime degrades to the last known state rather than to `unavailable`.
* **Verdict:** better architecture, but it is a **code change** and therefore needs its own approval. Ship A to unblock the download; schedule B.

---

## 8. Preconditions before the first publish

| # | Precondition | How it is proven | State |
|---|---|---|---|
| P1 | Public repo ⇒ asset downloads with **no** auth | `curl -sIL https://github.com/…/releases/download/<tag>/<asset>` with no token | ⬜ not yet provable — no release exists |
| P2 | Fresh artifact from current `main` | dispatch Windows Engineering Build (#46) | ⬜ **no run #46 exists**; latest is #45 @ `2797615` (06-Oct) |
| P3 | Secret `CLOUDFLARE_API_TOKEN` still present for the API deploy | dispatch *Deploy mobile API preview* | ⚠️ present as of 07-Oct (run #13 succeeded); re-verify |
| P4 | First version number agreed (e.g. `v0.1.0`) | Chief Engineer | ⬜ |
| P5 | R-I1 unsigned-build mitigations accepted | Chief Engineer | ⬜ |
| P6 | Option A vs Option B for the API rebuild | Chief Engineer | ⬜ |
| P7 | Repository stays public | repo Settings | ✅ public today |

---

## 9. Verification performed on this draft

| Gate | Result |
|---|---|
| YAML block parses (PyYAML 6.0.3) | **PASS** — root `list`, 1 step, keys `name/id/env/run` |
| `bash -n` on the 55-line `run` block (Git bash) | **PASS** — exit 0 |
| T1 `publish=false` (the default safety path) | **PASS** — exit 0, `url=` written, nothing leaves the runner |
| T2 `publish=true`, version empty | **PASS** — exit 1, `::error::release_version is required when publish=true.` |
| T2b `publish=true`, version variable **absent** | **PASS** — exit 1, same message (the `${VERSION:-}` normalisation) |
| T3 `publish=true`, version `0.1.0` (no `v`) | **PASS** — exit 1, tag-format error |
| T4 `publish=true`, version `v0.1.0`, upload step reached | **PASS (fails closed)** — exit 127 at `gh release create`; the run stopped at the upload and **never reached the URL check or the manifest write** |
| Ordering invariant | **PASS** — asset publish → fetch-verify → manifest → commit |
| Standing §6 gates on this branch | typecheck **0** · tests **794 passed / 0 fail** · `wrangler deploy --dry-run` **0** (751.47 KiB) · §6 forensic greps **0 hits / 16 tokens** · responsive proofs **N/A** — no file under `apps/web` changed, so the `688db80` proof (320/768/1024/1440/3840, 0 overflow) still covers this tree |
| `build-manifest.json` on this branch | **unchanged** — still `state: "unavailable"` |
| Workflows modified by this draft | **none** — this is a design document |
| Production / Neon / Cloudflare | **untouched** |

Note on T4: `gh` is not installed on this machine, so the upload step cannot be
executed end-to-end here. What the test proves is the *ordering* — a failure in
the upload step aborts before the manifest is touched, which is invariant 2.
The real upload runs only on `ubuntu-latest`, and only with `publish=true`.

---

## 10. Traceability

- **Master plan:** `docs/WS-K_MASTER_PLAN.txt` §6 (gates), §9 (report protocol); Phase 4+ unaffected.
- **TASK L** — WS-I v2 drafting, RESUME 08-Oct-2026.
- **Supersedes:** `docs/WS-I_RELEASE_PIPELINE_DRAFT.md` §3(c), §4, §7 items 1-3 (E10, `fc1b56a`).
- **Chief Engineer rulings:** R2 dropped / alternative researching (07-Oct-2026); `state = "published"` (07-Oct-2026, TASK K).
- **Spec:** §13 download card, §14 download states, §55 download design, §102 V1 scope ("CYVRA Mobile ZIP download"), §103 out-of-scope (does not exclude it).
- **Not superseded:** Design Freeze `docs/design-freeze/admin-panel-design-freeze.txt` @ `73d3f3a` remains LAW for the admin panel.
