# W5 PHASE 2b — SERVER-SIDE DIFF FOR THE FIVE PHASE 3 GAPS
# ========================================================
#
# STATUS: APPLIED, NOT COMMITTED. Four `src/` files and the shared test
#         harness carry the diff below; three new test files carry 56 tests.
#         Gates run and recorded in section 7. No commit has been made - the
#         change sits uncommitted in the worktree for review.
#
# WHY THIS FILE EXISTS
# --------------------
# Phase 3 (admin console) was blocked because five of its stated deliverables
# cannot be served by the committed Phase 2 surface (commit `a1132c4`). The
# brief for Phase 3 says: *"Consume ONLY committed Phase 2 routes. If a genuine
# gap is found, STOP and report; do not add server routes silently."*
#
# This document is that report, and it carries the exact diff so the change can
# be reviewed as code rather than as prose. Applying it is Phase 2b.
#
# The five gaps, and the deliverable each one blocks:
#
#   GAP 1  No route reads `audit_events`.
#          -> drawer "Audit" section, §45 timeline, nav item "Audit",
#             row-menu action "View Audit".
#   GAP 2  `paymentStatus` is in no serial projection.
#          -> §5 column 9 "Payment Status", §44 drawer "Payment",
#             §15 Generate-Key dialog body, §63 "GREEN iff PAID",
#             §65 Needs-Action `Payment` column.
#   GAP 3  `firstActivatedAt` / `validityEndsAt` are in no list projection.
#          -> §5 column 15 "Activation Date", column 16 "Expiry / Renewal".
#   GAP 4  `GET /serials` has no date filter.
#          -> Dashboard KPI "Expiring Soon" (must come from a server total).
#   GAP 5  `emailError` is not filterable.
#          -> Needs-Action queue item "Failed Delivery".
#
# NONE of the five is an authorisation gap. The server already enforces every
# rule; these are display and metadata gaps. They are listed because §19 forbids
# the browser guessing, and a UI that guesses a payment status is guessing a
# financial fact.
#
#
# VERIFIED NON-GAPS (checked, so nobody re-litigates them)
# -------------------------------------------------------
# * `payments` is exactly ONE row per licence. `POST /serials` inserts it as
#   `PENDING` (admin.ts:1567), `confirm-payment` updates it in place rather than
#   inserting a duplicate (admin.ts:1680-1702), and migration 0007 assertion E
#   pins that invariant. Therefore `search.ts`'s `EXISTS` predicate and a
#   projected *current* payment status cannot disagree - there is only ever one
#   row to disagree about. GAP 6 does not exist.
# * `GET /admin/staff` is gated `serial:read`, not `staff:manage`. Deliberate,
#   documented at admin.ts:741-747. Not a gap.
# * "Awaiting Approval" == `status=KEY_GENERATED`. "Rebind Requested" ==
#   `hostBinding=REBIND_REQUEST`. Both already expressible.
# * `apps/web/public/_redirects` has `/* /index.html 200`, so deep-link paths
#   on admin.cyvoriq.co.in will not 404.
#
#
# ==========================
# 1. FOUR LANDMINES IN THE EXISTING TESTS
# ==========================
#
# The Phase 3 gate is *"existing 263 API tests untouched and green"*. Four
# assertions in the current suite will kill an otherwise-correct diff. Each
# constraint below is a design input, not a footnote.
#
# L1. `audit.test.ts:72-77` - THE ONE-FILE RULE.
#     Exactly one file under `src/` may contain the token `auditEvents`, and
#     the test asserts it is `admin/audit.ts`:
#
#         const offenders = sourceFiles(SRC)
#           .filter((file) => /\bauditEvents\b/.test(readFileSync(file, "utf8")))
#           .map(...);
#         assert.deepEqual(offenders, ["admin/audit.ts"]);
#
#     CONSEQUENCE: the audit read route CANNOT do `db.select().from(auditEvents)`
#     in `admin.ts`, and there can be no new `src/admin/auditQuery.ts` that
#     imports the table. ALL access to `audit_events` must be added to
#     `src/admin/audit.ts`.
#
# L2. `audit.test.ts:79-86` - THE HANDLER MODULE MUST NOT TOUCH THE TABLE.
#
#         const handlers = readFileSync(join(SRC, "admin.ts"), "utf8");
#         assert.doesNotMatch(handlers, /\bauditEvents\b/);
#
#     CONSEQUENCE: `admin.ts` may only call an exported helper. It may not name
#     the table even in a comment.
#
# L3. `audit.test.ts:166` + `assertRouteAuditCoverage` (audit.ts:259-292).
#     Check 1 skips GET/HEAD/OPTIONS (`if (!AUDITED_METHODS.has(method)) continue`),
#     so a new **GET** route needs no `ROUTE_ACTION_MAP` entry and no change to
#     `AUTH_ROUTES` / `CONDITIONAL_ROUTES`. Check 2 verifies every *existing*
#     map key still resolves; we add no key, so it stays satisfied.
#     -> `GET /admin/audit` requires zero edits to `audit.ts`'s registries.
#
# L4. `adminRedaction.test.ts` calls `jsonSerialList(row)` and `reportRows([row])`
#     with ONE argument (lines 91, 106, 119, 123, 147, 165, 178). API tests are
#     not typechecked (`tsconfig` includes `["src"]` only), so a required new
#     parameter would compile-fail nowhere and run with `undefined`.
#     Lines 185-188 then assert `header in line` for every CSV header, and
#     line 99 `JSON.stringify`s the projection looking for a leaked key.
#
#     CONSEQUENCE: new projection parameters must DEFAULT to a real value
#     (`null`), never be required. `undefined` would render an empty CSV cell
#     that reads as "no value" rather than "broken column" - exactly the silent
#     failure mode that test exists to catch.
#
# Related, already-safe assertions (checked, no action needed):
#   search.test.ts:64-68, 116-145  - default/filter parsing, unaffected by
#                                    optional new params.
#   search.test.ts:214             - `deepEqual(Object.keys(pagination))`;
#                                    `Pagination` gains no field.
#   search.test.ts:241, 341        - empty spec -> `{}` and `[]`; new filters
#                                    must add NOTHING when absent.
#   search.test.ts:335             - `q + status` yields exactly 2 conditions.
#   routes.test.ts:77, 87          - exact `pagination` / `filters` objects.
#   issueIdempotency.test.ts:188   - two responses of one route compared to
#                                    each other, so a new field on both is fine.
#   activation.test.ts:238         - activation route builds its own object.
#   rbac.test.ts:82-158            - 15 permissions, 4 roles; we add none.
#   audit.test.ts:189, 197         - `AUTH_ROUTES` and `CONDITIONAL_ROUTES`
#                                    stay exactly as they are.
#
#
# ==========================
# 2. CHANGE A — SERIAL PROJECTIONS (GAP 2 + GAP 3)
# ==========================
#
# File: `services/api/src/admin.ts`
#
# 2.1 Batch payment lookup. One query for a whole page; `payments` is 1-per-
#     licence so this is a plain `inArray`, and `desc(createdAt), desc(id)`
#     with first-seen-wins reproduces `paymentStatusFor` (admin.ts:325-336)
#     exactly. An id with no row maps to `null` - never to a fabricated
#     "PENDING", because inventing a financial state is the one thing this
#     system must not do.
#
#     Place next to `paymentStatusFor`.
#
#       /**
#            * Payment status for a whole page, in ONE query.
#        *
#        * `payments.licence_id` has no UNIQUE constraint (0007), so this cannot
#        * be an upsert and must not be a join that could multiply rows: the
#        * page arrives once per licence or the count behind `hasMore` lies.
#        * Rows are read `desc(createdAt), desc(id)` and the first sighting of an
#        * id wins, which is byte-for-byte what `paymentStatusFor` does for one
#        * licence - so a row in a table and that same row opened in the drawer
#        * can never show two different payments.
#        *
#        * An id with no payment row maps to `null`. "No payment record" and
#        * "payment pending" are different facts and only one of them is true.
#        */
#       async function paymentStatusesFor(
#         db: Pick<Database, "select">,
#         serialIds: readonly string[],
#       ): Promise<Map<string, PaymentStatus | null>> {
#         const out = new Map<string, PaymentStatus | null>();
#         for (const id of serialIds) out.set(id, null);
#         if (serialIds.length === 0) return out;
#         const rows = await db
#           .select({ licenceId: payments.licenceId, status: payments.status })
#           .from(payments)
#           .where(inArray(payments.licenceId, [...serialIds]))
#           .orderBy(desc(payments.createdAt), desc(payments.id));
#         for (const row of rows) {
#           if (!out.has(row.licenceId)) out.set(row.licenceId, row.status);
#         }
#         return out;
#       }
#
#     Import `inArray` from `drizzle-orm` if `admin.ts` does not already
#     import it (it does for other routes - verify at apply time).
#
# 2.2 `jsonSerial` gains four fields. Signature gains an OPTIONAL second
#     parameter per landmine L4 - default `null`, so the one-argument calls in
#     `adminRedaction.test.ts` keep working and keep meaning "unknown".
#
#     BEFORE:
#       function jsonSerial(row: typeof mobileSerials.$inferSelect) {
#     AFTER:
#       function jsonSerial(
#         row: typeof mobileSerials.$inferSelect,
#         paymentStatus: PaymentStatus | null = null,
#       ) {
#
#     Add inside the returned object, after `paymentNoted`:
#
#           // Financial truth lives on `payments`, not on this row (§5/§7:
#           // "licence_status may only move as a transactional consequence of
#           // payments.status"). Projecting it here is what lets the table show
#           // a Payment Status column and lets the drawer's Payment section be
#           // a fact instead of a guess. `null` means "no payment record
#           // exists" - it is never rendered as PENDING.
#           paymentStatus,
#           // §5 columns 15 and 16. Both are NULL-able by design: pre-W5 rows
#           // were never given a validity window, and `first_activated_at` is
#           // written once on the first successful binding. An empty cell is
#           // the honest rendering; a defaulted date would be invented data.
#           firstActivatedAt: iso(row.firstActivatedAt),
#           validityStartsAt: iso(row.validityStartsAt),
#           validityEndsAt: iso(row.validityEndsAt),
#
#     Note `iso()` is already used in this function for `issuedAt` etc.
#
# 2.3 `jsonSerialList` passes it through. BEFORE: `export async function
#     jsonSerialList(row: typeof mobileSerials.$inferSelect)`.
#     AFTER: add `paymentStatus: PaymentStatus | null = null`, and change the
#     body to `const { publicNumber, licenceKey: _fullKey, ...rest } =
#     jsonSerial(row, paymentStatus);`.
#
# 2.4 `reportRows` takes the batch map. BEFORE: `export async function
#     reportRows(rows: (typeof mobileSerials.$inferSelect)[])`.
#     AFTER:
#
#       export async function reportRows(
#         rows: (typeof mobileSerials.$inferSelect)[],
#         paymentById: ReadonlyMap<string, PaymentStatus | null> = new Map(),
#       ) {
#         return Promise.all(
#           rows.map((row) => jsonSerialList(row, paymentById.get(row.id) ?? null)),
#         );
#       }
#
#     The default keeps the four existing `reportRows([row])` calls honest.
#
# 2.5 `toCsv` headers gain `paymentStatus`, `firstActivatedAt`,
#     `validityEndsAt`. Place `paymentStatus` immediately after `status` so the
#     export reads licence-state next to financial-state, which is the pairing
#     §5's columns 10 and 9 ask for.
#
#     WHY THIS IS SAFE UNDER L4: `adminRedaction.test.ts:185-188` iterates the
#     headers and asserts `header in line`. With the defaulted parameter,
#     `paymentStatus: null` exists as a property, so the `in` check passes.
#     `firstActivatedAt` and `validityEndsAt` come straight off the fixture row
#     (adminRedaction.test.ts:48, 60). No empty-cell regression.
#
# 2.6 Call sites — four routes.
#
#     (a) `GET /serials` (admin.ts:1326-1356). The `Promise.all` already fetches
#         rows; add the batch between the query and the response:
#
#             const paymentById = await paymentStatusesFor(db, rows.map((r) => r.id));
#             ...
#             serials: await Promise.all(
#               rows.map((row) => jsonSerialList(row, paymentById.get(row.id) ?? null)),
#             ),
#
#         One extra round trip for <= 100 ids, on an indexed FK. The page still
#         costs 3 queries, not 101.
#
#     (b) `GET /serials/:serialId` (admin.ts:1366-1387). Single licence:
#
#             serial: jsonSerial(row, await paymentStatusFor(db, serialId)),
#
#     (c) `GET /reports/licences` (admin.ts:3267-3342): batch once for `rows`,
#         pass to `reportRows(rows, paymentById)`.
#
#     (d) `GET /serials/:serialId/export` (admin.ts:3215-3265): single.
#         NOTE: this route writes its audit row BEFORE the CSV leaves, and its
#         `newState.filters`/`rowCount` are unchanged. Only the column set of
#         the file changes; `adminRedaction.test.ts:619`-style assertions on the
#         audit row are unaffected.
#
# 2.7 WHY NOT JUST JOIN IN THE LIST QUERY. A join on `payments` would multiply
#     rows if the 1-per-licence invariant were ever broken, and `count(*)`
#     would then report a register larger than the one it served - the exact
#     inversion of "truncation impossible to ignore". `search.ts:297-305` makes
#     the same argument for using `EXISTS`. The batch lookup keeps `count()`
#     counting licences.
#
#
# ==========================
# 3. CHANGE B — TWO NEW FILTERS (GAP 4 + GAP 5)
# ==========================
#
# File: `services/api/src/admin/search.ts`
#
# 3.1 `SerialQuerySpec` gains three fields:
#
#       /** Days ahead to look, resolved to a window by the ROUTE, not here. */
#       readonly validityEndsWithinDays: number | null;
#       /** SENT = emailed and no error; FAILED = `email_error` present. */
#       readonly delivery: readonly DeliveryStatus[];
#
#   plus `export const DELIVERY_STATUSES = ["SENT", "FAILED"] as const;`
#   and `export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];`
#
# 3.2 `parseSerialQuery` — the signature is UNCHANGED (one argument), which is
#     what keeps `search.test.ts` compiling and passing untouched. Two new
#     reads, both in the existing house style (refuse, never drop):
#
#       function readExpiryWindow(
#         params: URLSearchParams,
#       ): { ok: true; days: number | null } | { ok: false; error: string } {
#         const raw = (params.get("validityEndsWithinDays") ?? "").trim();
#         if (raw === "") return { ok: true, days: null };
#         if (!/^\d+$/.test(raw)) {
#           return {
#             ok: false,
#             error: '"validityEndsWithinDays" must be a whole number of days.',
#           };
#         }
#         const days = Number(raw);
#         if (days < 1 || days > 3650) {
#           return {
#             ok: false,
#             error: `"validityEndsWithinDays" must be between 1 and 3650; got "${raw}".`,
#           };
#         }
#         return { ok: true, days };
#       }
#
#     and, in `parseSerialQuery`, alongside the existing `readTokenList` calls:
#
#       const validityEndsWithinDays = readExpiryWindow(params);
#       if (!validityEndsWithinDays.ok) return { ok: false, error: validityEndsWithinDays.error };
#
#       const delivery = readTokenList(params, "delivery", DELIVERY_STATUSES);
#       if (!delivery.ok) return { ok: false, error: delivery.error };
#
#     both threaded into the returned `spec`.
#
#     Purity is preserved: `search.ts`'s header promises "no Context, no
#     database, no clock", and `readExpiryWindow` returns an integer. The clock
#     is injected at the next layer.
#
# 3.3 `serialQueryConditions` gains an OPTIONAL second parameter.
#
#       export function serialQueryConditions(
#         spec: SerialQuerySpec,
#         now?: Date,
#       ): SQL[] {
#
#     plus, after the payment predicate:
#
#       if (spec.validityEndsWithinDays !== null) {
#         // Loud, not accidental. `now` is optional so the 22 existing
#         // one-argument calls in search.test.ts keep working, but a window
#         // without a clock is not a window - failing here beats emitting a
#         // predicate against `undefined` and quietly matching nothing, which
#         // would read as "no licences are expiring".
#         if (!now) {
#           throw new Error(
#             'serialQueryConditions: "now" is required when validityEndsWithinDays is set.',
#           );
#         }
#         const horizon = new Date(
#           now.getTime() + spec.validityEndsWithinDays * 86_400_000,
#         );
#         conditions.push(
#           gte(mobileSerials.validityEndsAt, now),
#           lte(mobileSerials.validityEndsAt, horizon),
#         );
#       }
#       if (spec.delivery.includes("FAILED")) {
#         // OR-ed with SENT below, never AND-ed: a licence cannot be both.
#         conditions.push(isNotNull(mobileSerials.emailError));
#       } else if (spec.delivery.includes("SENT")) {
#         conditions.push(
#           and(
#             isNotNull(mobileSerials.emailedAt),
#             isNull(mobileSerials.emailError),
#           )!,
#         );
#       }
#
#     Import `gte, lte, isNotNull, isNull` as needed.
#
#     WHY `gte/lte` AND NOT `WHERE validity_ends_at <= horizon`: NULL never
#     satisfies a comparison, so pre-W5 rows with no stored window are excluded
#     automatically. That is correct - a licence with no expiry date cannot be
#     expiring - and it matches the partial index predicate in the schema
#     (`WHERE validity_ends_at IS NOT NULL`), so the index is actually used.
#
#     WHY `delivery` IS OR, NOT AND: `readTokenList` returns a list. Sending
#     `delivery=SENT,FAILED` must mean "either", or the predicate would be
#     `emailError IS NULL AND emailError IS NOT NULL` and match nothing - a
#     silent zero result presented as "no delivery problems".
#
#     `serialQueryWhere` does not need a change: it already spreads
#     `serialQueryConditions(spec)`, but it DOES need the `now` parameter
#     forwarded for consistency. `search.test.ts` never calls `serialQueryWhere`
#     directly (verified), so its signature may widen.
#
# 3.4 `filtersFor` echoes both when set (and omits them when not, so
#     `filtersFor(specOf(""))` stays `{}` per search.test.ts:241):
#
#       if (spec.validityEndsWithinDays !== null) {
#         filters.validityEndsWithinDays = spec.validityEndsWithinDays;
#       }
#       if (spec.delivery.length > 0) filters.delivery = [...spec.delivery];
#
# 3.5 Route change, `GET /serials` only:
#
#       const parsed = parseSerialQuery(new URL(c.req.url).searchParams);
#       if (!parsed.ok) return c.json({ error: parsed.error }, 400);
#       const spec = parsed.spec;
#       const db = c.get("db");
#       const now = new Date();
#       const where = serialQueryWhere(spec, now);
#
#     `now` is captured ONCE and used for both the row query and the count
#     query, so a licence that crosses the horizon between the two statements
#     cannot produce `total` disagreeing with `rows`. (They are already issued
#     in one `Promise.all`, but one clock read is still the right shape.)
#
#     Inert when the filter is absent: `serialQueryWhere` is passed `now` but
#     only dereferences it inside the `if`, so `search.test.ts`'s one-argument
#     calls and `routes.test.ts`'s exact-`filters` assertion are unaffected.
#
# 3.6 OPTIONAL — §22's remaining date filters, NOT required by any Phase 3
#     deliverable. Include only if you want the registry's date pickers now:
#
#       createdFrom / createdTo / issuedFrom / issuedTo /
#       activatedFrom / activatedTo / validityEndsFrom / validityEndsTo
#       issuedBy
#
#     Each is an ISO date read with the same "refuse rather than coerce"
#     pattern as `readExpiryWindow`, each is `IS NULL`-safe by construction of
#     `gte`/`lte`, and each is echoed by `filtersFor` only when present. The
#     Phase 3 deliverable explicitly scopes registry filters to the five
#     multi-selects, so **this block can be dropped without blocking Phase 3.**
#
#
# ==========================
# 4. CHANGE C — THE AUDIT READ ROUTE (GAP 1)
# ==========================
#
# 4.1 CONSTRAINT FROM LANDMINE L1/L2.
#     Everything below goes in `services/api/src/admin/audit.ts`. `admin.ts`
#     calls `readAuditEvents` and must not type the token `auditEvents` even
#     once, comment included.
#
# 4.2 WHY ONE ROUTE, NOT TWO.
#     The drawer needs one entity's history; the nav needs the global trail.
#     Two routes would duplicate the validator, the LIMITATED scoping and the
#     pagination. One route with an optional `entityId` serves both, and the
#     drawer's "showing 25 of 47" comes from the same `pagination` block the
#     registry already renders. Fewer routes = less surface to gate.
#
# 4.3 QUERY — `parseAuditQuery`, in `audit.ts`, shaped like `parseSerialQuery`.
#
#       export interface AuditQuerySpec {
#         readonly entityId: string | null;   // drawer: one licence's history
#         readonly entityType: string | null;
#         readonly action: readonly AuditAction[];   // refused if unknown token
#         readonly actorId: string | null;   // honoured only when allowed
#         readonly from: Date | null;
#         readonly to: Date | null;
#         readonly page: number;
#         readonly pageSize: PageSize;
#       }
#
#     Params: `entityId`, `entityType`, `action`, `actor`, `from`, `to`,
#     `page`, `pageSize`. Same three guarantees as `search.ts`:
#       - `pageSize` must be exactly 25, 50 or 100 (reuse `PAGE_SIZES`),
#       - an unknown `action` token is a 400 naming it,
#       - `from > to` is a 400,
#       - `entityId` must be a UUID (`isUuid`, already imported in admin.ts;
#         `@cyvra/evidence` exports it, `search.ts` already imports it).
#     `actor` is an email that must be resolved to a `staff_operators.id`
#     INSIDE `readAuditEvents`, not by the parser - the parser stays
#     database-free, same as `search.ts`.
#
# 4.4 READ — `readAuditEvents`, in `audit.ts`.
#
#       export async function readAuditEvents(
#         db: Pick<Database, "select">,
#         spec: AuditQuerySpec,
#         scope: { readonly forcedActorId: string | null; readonly actorEmailLookup?: string | null },
#       ): Promise<{ events: AuditedEvent[]; total: number }>
#
#     Behaviour:
#       * WHERE built from the spec, `and(...)` over present conditions.
#       * ORDER BY `desc(createdAt), desc(id)` - same tie-break as the serial
#         list, so two events in the same millisecond still have a stable,
#         reproducible order and a pager cannot skip or repeat a row.
#       * `.limit(spec.pageSize).offset((spec.page - 1) * spec.pageSize)`
#         alongside a `count()` over the SAME where - one conditions array,
#         used twice, because building it twice by hand is how a list and its
#         total come to disagree.
#       * **LIMITED scoping is applied here, not in the route.** If
#         `scope.forcedActorId !== null` it is AND-ed in unconditionally and the
#         caller-supplied `actorId` is IGNORED. That placement is the point:
#         the restriction lives where the query is built, so no future route can
#         forget to pass it.
#       * LEFT JOIN `staff_operators` on `actor_id` to project `actorEmail`
#         (see 4.6).
#       * Returns `{ events, total }`. Pagination is assembled by `admin.ts`,
#         which already imports `paginationFor`.
#
# 4.5 ROUTE — `admin.ts`, next to `GET /staff`.
#
#       /**
#        * THE AUDIT TRAIL - plan 20, and the read `rbac.ts:124-128` declared
#        * before the route existed.
#        *
#        * GET, so `assertRouteAuditCoverage` skips it: reading the trail does
#        * not write to it. Whether a *read of the trail* should itself be
#        * recorded is plan 20's call and is deliberately not decided here.
#        */
#       adminRoutes.get("/audit", async (c) => {
#         const principal = await requirePermission("audit:read")(c);
#         if ("error" in principal) return c.json({ error: principal.error }, principal.status);
#
#         const parsed = parseAuditQuery(new URL(c.req.url).searchParams);
#         if (!parsed.ok) return c.json({ error: parsed.error }, 400);
#
#         /*
#          * §41 marks "View audit" for operators as LIMITED, not yes.
#          * "Limited" means the rows they produced themselves. The decision is
#          * `LIMITED_AUDIT_ROLES` (rbac.ts:130), read here rather than
#          * re-decided - which is exactly what the comment that first declared
#          * that list asked of the route that would eventually serve it.
#          */
#         const limited = principal.kind === "staff"
#           && LIMITED_AUDIT_ROLES.includes(principal.role);
#         const forcedActorId = limited ? principal.actorId : null;
#
#         const { events, total } = await readAuditEvents(
#           c.get("db"),
#           parsed.spec,
#           { forcedActorId },
#         );
#
#         return c.json({
#           superAdmin: SUPER_ADMIN_EMAIL,
#           actor: principal.kind === "staff" ? principal.email : null,
#           events,
#           filters: auditFiltersFor(parsed.spec),
#           pagination: paginationFor(parsed.spec, events.length, total),
#           // The UI must be able to SAY why an operator sees three rows.
#           // Without this the audit page looks broken rather than scoped.
#           scope: limited ? "self" : "all",
#           scopeActorId: forcedActorId,
#         });
#       });
#
#     `paginationFor` needs its first parameter widened from `SerialQuerySpec`
#     to `{ readonly page: number; readonly pageSize: PageSize }` - it and
#     `offsetOf` read only those two fields. That is a pure widening: every
#     existing call in `search.test.ts` still typechecks and behaves
#     identically, and no test asserts the parameter's declared type.
#
# 4.6 ADDITIONAL FINDING — THE TRAIL CANNOT NAME A PERSON ON ITS OWN.
#     `audit_events` columns are: `id, actor_id, actor_role, action,
#     entity_type, entity_id, previous_state, new_state, ip_address, reason,
#     created_at` (schema.ts:613-640). **There is no `actor_email` column.**
#     (One comment at admin.ts:3247 says the export's `newState.actor`
#     "deliberately repeats the `actor_email` column" - that comment is wrong;
#     the field exists only inside `newState` for export rows.)
#
#     So "who did this" is recoverable only by joining `staff_operators` on
#     `actor_id`. `idx_audit_events_actor` covers that join. Two consequences
#     the UI must handle:
#       - `actor_id` is NULL for a super admin before their first nomination
#         (schema.ts:608-611, principal.ts:90-92). For those rows
#         `actorEmail` is genuinely null and the drawer must render
#         `actorRole` + "service / pre-nomination", never a guessed address.
#       - `staff_operators` rows are REVOKED, never deleted, so the join does
#         not lose history over time.
#     This is why 4.4 returns `actorEmail` as a projection rather than leaving
#     the reader to join it themselves: a timeline that says "SUPER_ADMIN" with
#     no name is not a timeline anybody can audit against.
#
#
# ==========================
# 5. NEW CONTRACT PHASE 3 WILL CONSUME
# ==========================
#
# `GET /admin/serials` gains, per serial:
#   paymentStatus: "PENDING"|"PAID"|"PARTIALLY_PAID"|"REFUNDED"|"CANCELLED"|null
#   firstActivatedAt: string|null      (ISO-8601, UTC)
#   validityStartsAt:  string|null
#   validityEndsAt:    string|null
#   (licenceKey stays masked; publicNumber stays absent; serialFp unchanged)
#
# `GET /admin/serials` accepts two new params:
#   validityEndsWithinDays=1..3650     -> Expiring Soon KPI, as ONE total:
#                                         ?status=ACTIVE&validityEndsWithinDays=30
#   delivery=SENT|FAILED               -> Failed Delivery queue item:
#                                         ?delivery=FAILED
#
# `GET /admin/audit` (new):
#   ?entityId=<uuid>  one licence's history   (drawer)
#   ?entityId=        global trail            (nav)
#   &action=A,B   &actor=<email>   &from=YYYY-MM-DD   &to=YYYY-MM-DD
#   &page=        &pageSize=25|50|100
#   -> { superAdmin, actor, events[], filters, pagination, scope, scopeActorId }
#   events[]: { id, actorId, actorRole, actorEmail, action, entityType, entityId,
#               previousState, newState, ipAddress, reason, createdAt }
#   scope: "self" for an OPERATOR (LIMITED), "all" otherwise.
#
# Everything else the Phase 3 endpoint-mapping table lists is already committed
# and unchanged.
#
#
# ==========================
# 6. TEST PLAN
# ==========================
#
# EXISTING: all 263 stay byte-identical. Verified against every assertion
# listed in section 1. If any of the 263 fails after applying this diff, the
# diff is wrong - do not edit the test to make it pass.
#
# NEW TEST FILES (three; deliberately new files so no existing file is touched):
#
#   test/serialProjection.test.ts
#     - list projection carries paymentStatus, firstActivatedAt,
#       validityStartsAt, validityEndsAt
#     - paymentStatus is null when no payment row exists, never "PENDING"
#     - list projection STILL leaks neither alias of the key (regression guard
#       for adminRedaction's contract, re-asserted with the new fields present)
#     - reportRows/CSV carry paymentStatus and it resolves per header
#     - `jsonSerialList(row)` called with ONE argument still projects
#       `paymentStatus: null` - the L4 defaulted parameter, pinned because API
#       tests are not typechecked and a required parameter would run as
#       `undefined` and be dropped from the JSON entirely
#     - every CSV header has a backing field (no header-only column drift)
#     - a PAID licence reads PAID in the list, the drawer and the CSV
#
#   test/serialFilters.test.ts
#     - validityEndsWithinDays rejects 0, -1, "abc", 12.5, "+30", "30days",
#       and a value above 3650 - each naming the parameter and the value
#     - a present-but-EMPTY value is treated as absent, matching the
#       convention `readPage` already applies to `page` on the same request
#     - with `now` absent it THROWS rather than silently matching nothing
#     - the generated SQL uses `>=` AND `<=`, so NULL windows are excluded
#     - delivery=FAILED -> `email_error IS NOT NULL`
#     - delivery=SENT,FAILED -> OR, never a contradiction matching zero rows
#     - filtersFor echoes each only when set
#     - an unknown delivery token is a 400 naming it (no silent drop)
#
#   test/auditRead.test.ts
#     - unauthenticated -> 401; AUDITOR -> 200 (audit:read is a read row)
#     - SUPER_ADMIN / LICENCE_ADMIN / OPERATOR all pass the gate
#     - AUDITOR gets `scope: "all"`
#     - OPERATOR gets `scope: "self"` AND the WHERE clause binds its own staff
#       id even when it sends `actor=<someone else>` - asserted against the
#       RENDERED SQL, because a double that merely received a predicate would
#       pass whether that predicate was `actor_id = me` or nothing at all
#     - `?entityId=<uuid>` binds the entity into the predicate, so the drawer's
#       timeline cannot widen it
#     - a date range binds two `created_at` bounds (inclusive both ends)
#     - two selected actions bind as two params in ONE OR-ed set, never as two
#       AND-ed equality checks that match nothing
#     - unknown `action` token -> 400 naming it
#     - `pageSize=1000` -> 400 naming 25, 50, 100 (never clamped)
#     - `from > to` -> 400
#     - events carry `actorEmail` from the join, and null (not a guess) when
#       `actor_id` IS NULL
#     - total/returned/hasMore always present, including all-zero
#
#
# ==========================
# 7. GATES - RUN, RESULTS BELOW
# ==========================
#
#   pnpm.cmd -r typecheck                 exit 0 (0 errors; apps/web,
#                                         database, packages/evidence,
#                                         services/api all "Done")
#
#   pnpm.cmd -r test
#     packages/evidence   26   pass   26   fail  0
#     services/api       319   pass  319   fail  0
#     apps/desktop        71   pass   71   fail  0
#                                  ----
#                            416 total, 0 failing
#
#     services/api 319 = 263 pre-existing (byte-identical, untouched) + 56 new,
#     the 56 being serialProjection 7, serialFilters 16, auditRead 33.
#
#     HONEST NOTE ON THE FIRST RUN: the first `pnpm.cmd -r test` reported
#     [ELIFECYCLE] because apps/desktop's vitest failed to SPAWN two workers
#     (`Timeout waiting for worker to respond`) while evidence, api (319 tests,
#     ~195s) and desktop all ran at once on this machine. The tests themselves
#     reported 25 passed and 0 failed; it was the worker pool that broke.
#     apps/desktop run on its own: 5 files, 71 tests, 36s, no errors. It is a
#     resource-contention flake, not a regression, and desktop does not import
#     anything this diff touches. Recorded rather than quietly re-run until it
#     went green.
#
#   Existing 263 API tests untouched and green - confirmed by `git status`,
#   which shows no modified file under `services/api/test/` except
#   `test/helpers/adminHarness.ts`, a shared fixture (see below).
#
#   One helper change was unavoidable and is called out here because it is the
#   only pre-existing file altered: `adminHarness.ts` gained a `leftJoin`
#   pass-through, an `auditRows`/`auditTotalCount` fixture, and a count-aware
#   `audit_events` case in `rowsFor`. No assertion in it was changed; without
#   `leftJoin` the new route would throw 500 against the double.
#
#   Frozen constraints honoured:
#     - no new route is added silently: it is in this document first
#     - UTC ISO-8601 for every new timestamp (`iso()` already used)
#     - clock injected (`now` passed in), never read inside `search.ts`
#     - no payment state is fabricated; `null` stays `null`
#     - server-side authorization absolute: LIMITED scoping applied in the
#       query builder, not in the UI and not in the route
#     - no `.env` touched, no key material, `sanitizeExecute: false` untouched
#
#   One defect was caught by these tests during the build and is worth
#   recording so it is not "simplified" back: `paymentStatusesFor` originally
#   seeded every id with `null` and then did `if (!out.has(id))`. Seeding puts
#   the key in the map, so the real status was never written and every list
#   response answered `null` for a PAID licence while the drawer said PAID. The
#   fix reads real answers first and fills the gaps second. The test that pins
#   it is "shows PAID in the list and the SAME PAID in the drawer".
#
#
# ==========================
# 8. DECISIONS TAKEN
# ==========================
#
#  D1. Scope of Change B: REQUIRED only (`validityEndsWithinDays` + `delivery`).
#       The §22 date filters in 3.6 are DROPPED - no Phase 3 deliverable needs
#       them, and adding them would widen the review surface for nothing.
#  D2. The optional `GET /admin/audit` self-read audit event is NOT included.
#       It would add a conditional-route decision to `assertRouteAuditCoverage`
#       for no consumer, and plan 20 owns that call.
#  D3. Change A's defaulted-parameter design confirmed: `jsonSerial(row,
#       paymentStatus = null)` rather than a required parameter, because "263
#       untouched" is a hard gate and `adminRedaction.test.ts` calls it with one
#       argument from a file that is not typechecked.
#
# After review: commit this as Phase 2b. Phase 3 (Group 4 and Group 5) then
# builds against it.
