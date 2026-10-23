# CYVRA Mobile — P2B Five-Gap Disposition Record (EW-15 / C-1)

**Date:** 23 October 2026
**Method:** Read-only source inspection plus the API test suite, executed at commit
`7c02787d45e5ec0a405dba2b8e0612afad8cf4c4` on
`docs/session-handoff-2026-10-20`. (That merge commit's tree is byte-identical to
`4e6838248748c470cce16cb12ccce3e10c1dcea2`; the merge introduced zero content changes.)
**Scope:** The five Phase-3-blocking gaps defined in `docs/P2B-SERVER-GAPS.md` (lines 19-38).
This record is the disposition table required by EW-15's acceptance criteria. It is
evidence, not a governance ruling, and it closes no decision.

## The question EW-15 posed

`docs/P2B-SERVER-GAPS.md` line 4 states `STATUS: APPLIED, NOT COMMITTED`, claiming four
`src/` files carry an uncommitted diff with 56 new tests. Conflict C-1 asked: **either the
diff was never applied, or it was applied and later superseded/renamed - nobody established
which.**

## Answer (provenance)

**The diff was applied AND committed.** Commit `6ff8065`
(`feat(api): W5 Phase 2b - close the five API gaps the admin console needs`, 3 October
2026 18:22:57 +0530) is an ancestor of both `origin/main` and the current branch
(`git merge-base --is-ancestor` true for both). The document's "APPLIED, NOT COMMITTED"
status line is therefore **stale as of 3 October 2026**. The P2B document itself is
retained unchanged as the historical record; this disposition supersedes only its status
line.

## Per-gap dispositions

| # | Gap (P2B lines) | Blocked deliverable | Disposition | Evidence (current source) |
|---|---|---|---|---|
| 1 | No route reads `audit_events` (L21-23) | Audit drawer/timeline/nav/View Audit | **PRESENT** | Audit read route lives in `services/api/src/admin/audit.ts` (one-file rule honoured: `auditEvents` import L53, insert L493, read-path param parsing L635-713, conditions e.g. L761); dedicated runtime test `services/api/test/auditRead.test.ts` exists |
| 2 | `paymentStatus` in no serial projection (L24-27) | Payment Status column, drawer Payment, GREEN-iff-PAID | **SUPERSEDED - gap closed by a different committed implementation** | The proposed symbol `paymentStatusesFor` appears ONLY inside the P2B document (L152, L241, L702, always commented-out) and in no source file. The committed implementation projects `paymentStatus` via `jsonSerial(row, paymentStatus)` (`services/api/src/admin.ts` L136, L165-183; comment explicitly cites A5 "Payment Status" column and the drawer Payment section; `null` means "no payment record exists", not "pending", L172) and filters server-side with a validated `paymentStatus=` token list (`services/api/src/admin/search.ts` L304-305, L330) via an EXISTS predicate deliberately chosen over a join (`search.ts` L374-386, L426) |
| 3 | `firstActivatedAt` / `validityEndsAt` in no list projection (L28-29) | Columns 15/16 Activation Date, Expiry/Renewal | **PRESENT** | `admin.ts` L194-196 projects `firstActivatedAt`, `validityStartsAt`, `validityEndsAt` (comment L185-193 cites "A5 columns 15 and 16" and states the NULL-honesty rule for pre-W5 rows); export headers L764-765 |
| 4 | `GET /serials` has no date filter (L30-31) | Dashboard KPI "Expiring Soon" from a server total | **PRESENT - purpose-built mechanism, not a raw date range** | `validityEndsWithinDays` expiry-window parameter (`search.ts` L319, L335, L429-455) with documented discipline: refuses to match long-expired rows, excludes NULL windows, index-backed on `idx_mobile_serials_validity_ends_at` (L440-449) |
| 5 | `emailError` not filterable (L32-33) | Needs-Action queue "Failed Delivery" | **PRESENT - token mechanism** | `delivery=SENT,FAILED` token list (`search.ts` L316-317, L334): `FAILED` = `email_error IS NOT NULL` (L468-469); `SENT` = `emailed_at IS NOT NULL AND email_error IS NULL` (L470-475); OR-semantics refusal documented (L457-466) |

Supporting invariant: "one payments row per licence" is pinned by migration
`0007_w5_admin_control_plane.sql` §6g (L311), the invariant the P2B document's verified
non-gaps section relies on.

## Runtime verification (this session)

- Command: `services\api> pnpm.cmd run -s test` (`tsx --test test/*.test.ts`, 26 test files)
- Result: **413 tests, 72 suites, 413 passed, 0 failed, exit 0** (duration ~202 s).

## What this record does NOT do

- It does not close C-1 as a governance matter beyond the engineering evidence above; the
  canonical plan's EW-15 entry is updated by an append-forward note pointing here, and any
  status transition follows the plan's retained closure format.
- It does not modify any production source, test, schema, workflow, or the P2B document.
- It makes no hardware, CI, release, or runtime-service claim beyond the local test suite.
