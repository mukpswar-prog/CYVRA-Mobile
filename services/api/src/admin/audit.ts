/**
 * W5 PHASE 1 - THE AUDIT ENGINE
 * =============================
 *
 * Design plan 20: "The audit log should be immutable from the normal UI."
 * Frozen directive 6: IMMUTABILITY. Migration 0007 proved on live Neon that
 * `audit_events` refuses UPDATE, DELETE and TRUNCATE - the database will not be
 * talked out of a row that happened. What is left to guarantee is that every
 * row that *should* exist, does, and that it is written where it belongs.
 *
 * ---------------------------------------------------------------------------
 * ONE INSERTION PATH
 * ---------------------------------------------------------------------------
 * `writeAudit(tx, entry)` is the only function in this codebase that inserts
 * into `audit_events`. `test/audit.test.ts` reads `src/**` and fails if any
 * other file even references the table, so "we forgot to use the helper" cannot
 * become a silent unaudited write.
 *
 * ---------------------------------------------------------------------------
 * THE AUDIT ROW LIVES INSIDE THE MUTATION'S TRANSACTION
 * ---------------------------------------------------------------------------
 * This is the requirement that decides the whole shape of the module. Plan 20
 * and frozen directive 3 (ATOMIC I/O) both say an audit row and the change it
 * describes are one unit: either the licence moved *and* the trail recorded it,
 * or neither happened. So `writeAudit` takes the transaction handle, not the
 * database, and never opens one of its own:
 *
 *     await db.transaction(async (tx) => {
 *       const [updated] = await tx.update(mobileSerials)...;
 *       await writeAudit(tx, { ...previous/new state from `updated`... });
 *     });
 *
 * Consequence worth stating plainly: **the audit row cannot be written by
 * middleware.** Middleware runs outside the handler's transaction, and it has
 * no way to know `previous_state` / `new_state` before the mutation has run.
 * `auditMiddleware()` therefore captures the *frame* - actor, IP, route - and
 * the handler supplies the states, because only the handler has seen them.
 * Pretending otherwise would produce an audit trail whose states were guessed.
 *
 * ---------------------------------------------------------------------------
 * E3 - WHERE THE ACTOR COMES FROM
 * ---------------------------------------------------------------------------
 * `auditMiddleware()` obtains the actor from `authenticate()`, which resolves a
 * `staff_operators` row from a verified session token. `X-Admin-Email` is never
 * read (see `./principal`). This is the difference between a trail that names
 * whoever the caller typed and a trail that names whoever proved who they were.
 */

import type { Context, MiddlewareHandler } from "hono";
import { and, count, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import {
  auditActionEnum,
  auditEvents,
  staffOperators,
  staffRoleEnum,
} from "@cyvra/database/schema";
import { isUuid } from "@cyvra/evidence";
import type { Database } from "../db";
import type { Env } from "../env";
import { authenticate, isAuthError, type StaffRole } from "./principal";
import { PAGE_SIZES, type PageSize } from "./search";

/** The `audit_action_enum` vocabulary, derived from the pgEnum. */
export type AuditAction = (typeof auditActionEnum.enumValues)[number];

export type { StaffRole };

/**
 * Any Drizzle handle that can insert - `Database` or the `tx` handed to
 * `db.transaction`. Typed structurally so a caller cannot pass the wrong thing
 * by accident, while still accepting a test double.
 */
export type AuditExecutor = Pick<Database, "insert">;

/** Entity types recorded in `audit_events.entity_type` (a free text column). */
export const ENTITY_LICENCE = "licence";
export const ENTITY_STAFF_OPERATOR = "staff_operator";
/**
 * Aggregate events. Plan 53 requires "Log report generation", but a report is
 * about many rows at once, so naming any one of them would falsely imply that
 * a single licence had been specially touched.
 */
export const ENTITY_LICENCE_EXPORT = "licence_export";

/**
 * The nil UUID (RFC 4122 §4.3) for `entity_id` on an aggregate event.
 *
 * `audit_events.entity_id` is `uuid NOT NULL`, so an event with no single
 * subject still has to name one. The alternatives were worse: pointing at an
 * arbitrary exported row would read as "this licence was exported" and let the
 * drawer show an export event in one customer's timeline. The nil UUID is the
 * standard token for "no particular entity", and combined with
 * `entity_type = 'licence_export'` it means exactly that - while still giving
 * every export a shared `entity_id`, so the export history groups together
 * under `idx_audit_events_entity`.
 */
export const AGGREGATE_ENTITY_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Route keys.
 *
 * A route's key is derived as `` `${method} ${path}` ``, matching what Hono
 * reports in `adminRoutes.routes`. Declaring them as constants and using the
 * *same* constant in the map and in the handler is what makes the handler's
 * action and the map's action impossible to disagree: there is one string, and
 * `assertRouteAuditCoverage` verifies that string names a route that exists.
 */
export const ROUTE = {
  authRequest: "POST /auth/request",
  authVerify: "POST /auth/verify",
  authLogout: "POST /auth/logout",
  createSerial: "POST /serials",
  updateSerial: "PATCH /serials/:serialId",
  confirmPayment: "POST /serials/:serialId/confirm-payment",
  generateKey: "POST /serials/:serialId/generate-key",
  issue: "POST /serials/:serialId/issue",
  resendLicence: "POST /serials/:serialId/resend",
  suspend: "POST /serials/:serialId/suspend",
  revoke: "POST /serials/:serialId/revoke",
  requestRebind: "POST /serials/:serialId/rebind/request",
  approveRebind: "POST /serials/:serialId/rebind/approve",
  exportSerial: "GET /serials/:serialId/export",
  createStaff: "POST /staff",
  approveStaff: "POST /staff/:staffId/approve",
  suspendStaff: "POST /staff/:staffId/suspend",
  revokeStaff: "POST /staff/:staffId/revoke",
  exportLicences: "GET /reports/licences",
} as const;

/**
 * Every state-changing admin route, mapped to the `audit_action_enum` value it
 * writes.
 *
 * Deliberately exhaustive rather than partial: a route that is absent here
 * cannot be registered without `assertRouteAuditCoverage` throwing during
 * module load, which turns "we forgot the audit log" from a production
 * discovery into a failed import.
 *
 * NOT HERE, ON PURPOSE - `GET /serials/:serialId` (view) and
 * `GET /serials/:serialId/activation` (view-activation). Both are two of §14's
 * twelve actions, and both are gated by `requirePermission`, but neither writes
 * anything: there is no `audit_action_enum` value for "somebody looked", and
 * inventing one would put a row in an append-only trail that asserts an event
 * which never happened. The third GET in that list,
 * `GET /serials/:serialId/export`, *is* mapped because taking a copy out of the
 * building is an event.
 */
export const ROUTE_ACTION_MAP: Readonly<Record<string, AuditAction>> =
  Object.freeze({
    [ROUTE.createSerial]: "SERIAL_CREATED",
    [ROUTE.updateSerial]: "SERIAL_UPDATED",
    [ROUTE.confirmPayment]: "PAYMENT_CONFIRMED",
    [ROUTE.generateKey]: "KEY_GENERATED",
    [ROUTE.issue]: "LICENCE_ISSUED",
    [ROUTE.resendLicence]: "LICENCE_RESENT",
    [ROUTE.suspend]: "LICENCE_SUSPENDED",
    [ROUTE.revoke]: "LICENCE_REVOKED",
    [ROUTE.requestRebind]: "REBIND_REQUESTED",
    [ROUTE.approveRebind]: "REBIND_APPROVED",
    // Host binding has its own lifecycle (plan 10/35), independent of
    // `licence_status`; the two rebind routes are audited on the enum that
    // exists for them rather than being forced onto a licence action.
    [ROUTE.createStaff]: "STAFF_INVITED",
    /*
     * `POST /auth/verify` writes `STAFF_INVITED` for the same invitation it
     * started: ruling R2 (see below) chose the reuse over a migration, so the
     * whole invitation lifecycle is one action and `previous_state` /
     * `new_state` carry the part the action name cannot.
     */
    [ROUTE.authVerify]: "STAFF_INVITED",
    [ROUTE.approveStaff]: "STAFF_ROLE_CHANGED",
    [ROUTE.suspendStaff]: "STAFF_SUSPENDED",
    [ROUTE.revokeStaff]: "STAFF_REVOKED",
    // Audited only when the caller actually takes a copy out of the building -
    // see `CONDITIONAL_ROUTES`. A JSON read of the same endpoint is not an
    // export and must not appear in the trail as one.
    [ROUTE.exportLicences]: "EXPORT_GENERATED",
    [ROUTE.exportSerial]: "EXPORT_GENERATED",
  });

/**
 * Routes whose audit write depends on the request rather than just its path.
 *
 * Only `GET /reports/licences`: `?format=csv` produces a file that leaves the
 * organisation and is audited; the default JSON projection is an ordinary read
 * and is not. The handler decides, using the action from the same map.
 */
export const CONDITIONAL_ROUTES: ReadonlySet<string> = new Set([
  ROUTE.exportLicences,
]);

/**
 * State-changing routes that are declared exempt, each for a stated reason.
 *
 * These are session lifecycle endpoints: they create and destroy *sessions*,
 * and plan 20's examples are all licence and payment events. They are listed
 * explicitly rather than excluded by a rule so that the exemption is visible
 * and reviewable - and so that adding a fourth auth endpoint still forces a
 * conscious decision here.
 *
 * `POST /auth/verify` appears in BOTH this set and `ROUTE_ACTION_MAP`, and the
 * two entries describe two different concerns rather than contradicting each
 * other:
 *
 *   - The **session** it mints is exempt. Signing in is not a business event,
 *     and one audit row per sign-in would bury the licence trail under traffic.
 *     That is what exempts it from check 1 above.
 *   - The **`INVITED -> EMAIL_VERIFIED` promotion** it performs on
 *     `staff_operators` is a business record changing state, and Phase 2
 *     requires every staff transition to be audited. It is mapped so that the
 *     handler's action comes from `actionFor()` like every other route's.
 *
 * Removing it from `AUTH_ROUTES` would make sign-in auditable and lose the
 * stated reason; removing it from the map would leave the promotion writing a
 * literal nobody chose. Both lists earn their keep.
 */
export const AUTH_ROUTES: ReadonlySet<string> = new Set([
  ROUTE.authRequest,
  ROUTE.authVerify,
  ROUTE.authLogout,
]);

/** The action a handler should write for its route. Throws if undeclared. */
export function actionFor(route: string): AuditAction {
  const action = ROUTE_ACTION_MAP[route];
  if (!action) {
    throw new Error(
      `ROUTE_ACTION_MAP has no audit action for "${route}". Declare one before registering the route.`,
    );
  }
  return action;
}

/** Minimal shape needed for coverage checking - avoids importing Hono internals. */
export interface RoutableRoute {
  readonly method: string;
  readonly path: string;
}

const AUDITED_METHODS: ReadonlySet<string> = new Set([
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

/**
 * Assert, at module load, that every route is classified.
 *
 * Runs once from `admin.ts` after all routes are registered. Two checks, and
 * they cut in both directions:
 *
 *   1. A POST/PUT/PATCH/DELETE route that is neither mapped nor an explicit
 *      auth exemption **throws**. This is the requirement that an unmapped
 *      route must fail at load rather than run unaudited.
 *   2. A map entry that names no registered route **throws**. Without it,
 *      renaming a route silently leaves its audit action pointing at nothing,
 *      and the next version quietly stops auditing a write that still exists.
 *
 * GET/HEAD/OPTIONS are skipped: reads do not write an audit row. The one read
 * that sometimes does is covered by check 2 through `CONDITIONAL_ROUTES`.
 */
export function assertRouteAuditCoverage(
  routes: readonly RoutableRoute[],
): void {
  const registered = new Set(
    routes
      // `adminRoutes.use("*", ...)` registers a catch-all middleware, and Hono
      // reports it as a route. It is not an endpoint: it has no method of its
      // own and no path to map. Filtering both keeps the assertion about real,
      // addressable handlers only.
      .filter((route) => route.method !== "*" && route.path !== "*")
      .map((route) => `${route.method.toUpperCase()} ${route.path}`),
  );

  for (const key of registered) {
    const method = key.slice(0, key.indexOf(" "));
    if (!AUDITED_METHODS.has(method)) continue;
    if (ROUTE_ACTION_MAP[key] !== undefined) continue;
    if (AUTH_ROUTES.has(key)) continue;
    throw new Error(
      `ROUTE_ACTION_MAP has no audit action for state-changing route ${key}. ` +
        `Map it to an audit_action_enum value, or list it in AUTH_ROUTES with a reason.`,
    );
  }

  for (const key of [...Object.keys(ROUTE_ACTION_MAP), ...AUTH_ROUTES]) {
    if (!registered.has(key)) {
      throw new Error(
        `Audit route registry names "${key}", but no such route is registered. ` +
          `The route was probably renamed or removed; a stale key here means a ` +
          `real route is going unaudited.`,
      );
    }
  }
}

/**
 * What the audit middleware can truthfully know before a mutation happens.
 *
 * `actorRole` is `null` for a service principal - it holds no role - which is
 * precisely why no state-changing route may ever be reachable without a staff
 * session: `audit_events.actor_role` is NOT NULL.
 */
export interface AuditContext {
  readonly actorId: string | null;
  readonly actorRole: StaffRole | null;
  readonly actorEmail: string | null;
  /** Cloudflare's `CF-Connecting-IP`, or `null` where the platform sets none. */
  readonly ipAddress: string | null;
  /** The concrete path, e.g. `/admin/serials/<uuid>/issue`. */
  readonly route: string;
}

/**
 * The client IP.
 *
 * `CF-Connecting-IP` only. `X-Forwarded-For` is deliberately ignored: it is
 * client-controlled when nothing in front of the request overwrites it, and
 * recording a spoofable address in a security trail is worse than recording
 * nothing. Cloudflare sets this header on every request to the Worker, and
 * where it is absent the column stays NULL - which the schema already documents
 * as the correct value for an actor-less action.
 */
function clientIp(c: Context): string | null {
  const ip = c.req.header("CF-Connecting-IP")?.trim();
  return ip ? ip : null;
}

const AUDIT_CONTEXT_CACHE = new WeakMap<object, AuditContext>();

/**
 * Capture the audit frame for this request: who is acting, from where, on what.
 *
 * Runs before every admin handler. It never blocks a request - an
 * unauthenticated caller simply gets no frame, because the route's own gate is
 * what returns the 401. That keeps `/auth/*` (which runs before any session
 * exists) working through the same middleware as everything else.
 *
 * Actor identity comes from `authenticate()`, i.e. the verified session, never
 * from `X-Admin-Email` - the E3 fix.
 */
export function auditMiddleware(): MiddlewareHandler<{
  Bindings: Env;
  Variables: { db: Database };
}> {
  return async (c, next) => {
    const principal = await authenticate(c);
    if (!isAuthError(principal)) {
      AUDIT_CONTEXT_CACHE.set(c, {
        actorId: principal.actorId,
        actorRole: principal.kind === "staff" ? principal.role : null,
        actorEmail: principal.email,
        ipAddress: clientIp(c),
        route: c.req.path,
      });
    }
    await next();
  };
}

/**
 * The audit frame, computing it on demand if the middleware did not run.
 *
 * The fallback exists so a handler is never dependent on middleware
 * registration order to be correct; both paths produce the same object.
 */
export async function auditContextFor(
  c: Context<{ Bindings: Env; Variables: { db: Database } }>,
): Promise<AuditContext | null> {
  const cached = AUDIT_CONTEXT_CACHE.get(c as unknown as object);
  if (cached) return cached;
  const principal = await authenticate(c);
  if (isAuthError(principal)) return null;
  return {
    actorId: principal.actorId,
    actorRole: principal.kind === "staff" ? principal.role : null,
    actorEmail: principal.email,
    ipAddress: clientIp(c),
    route: c.req.path,
  };
}

/**
 * A frame for an action taken **on one's own record, before a session exists**.
 *
 * `POST /auth/verify` promotes an invitee from `INVITED` to `EMAIL_VERIFIED`,
 * and Phase 2 requires every staff transition to be audited. But the route that
 * performs it is the sign-in route: at that moment `authenticate()` has no
 * session to name, so `requireAuditContext` would correctly answer 401 and the
 * promotion would be unrecordable.
 *
 * The identity passed in is read from `staff_operators` by `principal.ts`, not
 * from the request - the OTP proves control of the address, and the row is what
 * says who holds it. `actor_role` therefore still comes from the database,
 * which is the invariant `requireAuditContext` exists to protect; this helper
 * is the same invariant with a different source of the same fact rather than a
 * looser one. The request contributes only the client IP and the path.
 *
 * `auditEvents.actor_id` is nullable for exactly this case: a super admin
 * pre-nomination has no row to point at, and fabricating one to satisfy a
 * column would be the defect E3 removed.
 */
export async function selfServiceAuditContext(
  c: Context<{ Bindings: Env; Variables: { db: Database } }>,
  identity: {
    readonly actorId: string | null;
    readonly actorRole: StaffRole;
    readonly actorEmail: string;
  },
): Promise<StaffAuditContext> {
  const frame = await auditContextFor(c);
  return {
    actorId: identity.actorId,
    actorRole: identity.actorRole,
    actorEmail: identity.actorEmail,
    ipAddress: frame?.ipAddress ?? clientIp(c),
    route: c.req.path,
  };
}

/** A frame that can back an audit row: a person, with a role to record. */
export interface StaffAuditContext {
  readonly actorId: string | null;
  readonly actorRole: StaffRole;
  readonly actorEmail: string | null;
  readonly ipAddress: string | null;
  readonly route: string;
}

/**
 * Narrow to a frame carrying a role, or refuse.
 *
 * A handler that has already passed `requireStaffPermission` will always get
 * the context - so this reads as defensive. It is not: it is the last place
 * the invariant "`actor_role` is never fabricated" is enforced, and failing
 * closed with a 401 is the correct outcome if the gate and the middleware ever
 * disagree.
 */
export async function requireAuditContext(
  c: Context<{ Bindings: Env; Variables: { db: Database } }>,
): Promise<StaffAuditContext | { error: string; status: 401 }> {
  const frame = await auditContextFor(c);
  if (!frame || frame.actorRole === null || frame.actorEmail === null) {
    return {
      error: "An authenticated staff session is required to record this action.",
      status: 401,
    };
  }
  // A fresh object rather than `return frame`: narrowing `frame.actorRole`
  // changes the type of that expression, not the type of `AuditContext`, so
  // handing `frame` back would still claim `actorRole: StaffRole | null`.
  return {
    actorId: frame.actorId,
    actorRole: frame.actorRole,
    actorEmail: frame.actorEmail,
    ipAddress: frame.ipAddress,
    route: frame.route,
  };
}

export interface AuditEntry {
  /** `staff_operators.id`, or `null` for the super admin before nomination. */
  readonly actorId: string | null;
  readonly actorRole: StaffRole;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string;
  /** Snapshot taken *before* the mutation, from the row that was read. */
  readonly previousState?: Record<string, unknown> | null;
  /** Snapshot of the row as committed. */
  readonly newState?: Record<string, unknown> | null;
  readonly ipAddress?: string | null;
  /** Required by plan 37 for suspend/revoke; optional elsewhere. */
  readonly reason?: string | null;
}

/**
 * Insert one audit row **inside the caller's transaction**.
 *
 * The only function permitted to write `audit_events`. Passing `tx` rather
 * than `db` is the mechanism that makes the row and the mutation atomic: there
 * is no code path here that could commit one without the other, and no retry
 * that could record an event twice.
 *
 * Nothing is defaulted or invented. A missing previous state is NULL because
 * the change had no previous state, not because it was inconvenient to fetch.
 */
export async function writeAudit(
  tx: AuditExecutor,
  entry: AuditEntry,
): Promise<void> {
  await tx.insert(auditEvents).values({
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    previousState: entry.previousState ?? null,
    newState: entry.newState ?? null,
    ipAddress: entry.ipAddress ?? null,
    reason: entry.reason ?? null,
  });
}

/**
 * Build an entry from the captured frame, so a handler never re-derives who it
 * is acting as - that would be a second place to get identity wrong.
 */
export function auditEntry(
  frame: StaffAuditContext,
  input: Omit<
    AuditEntry,
    "actorId" | "actorRole" | "ipAddress"
  > & { readonly reason?: string | null },
): AuditEntry {
  return {
    actorId: frame.actorId,
    actorRole: frame.actorRole,
    ipAddress: frame.ipAddress,
    ...input,
  };
}

/** Re-exported so handlers need only one import for the whole engine. */
export { staffRoleEnum };

/* ========================================================================== *
 * W5 PHASE 2b - READING THE TRAIL (design plan 20)
 * ==========================================================================
 *
 * WHY THIS LIVES HERE AND NOWHERE ELSE
 * ------------------------------------
 * `audit.test.ts` asserts that exactly one file under `src/` contains the token
 * `auditEvents`, and that it is this one; a second assertion forbids `admin.ts`
 * from containing it at all, comment included. The rule exists so the trail has
 * a single insertion path - and it has the same effect on the read path: the
 * query against `audit_events` cannot be copy-pasted into a handler that
 * forgets the scoping below.
 *
 * WHY `LIMITED` IS APPLIED HERE
 * -----------------------------
 * §41 marks "View audit" for operators as LIMITED rather than yes or no, and
 * `LIMITED_AUDIT_ROLES` (../rbac) declares which roles that means. The list's
 * own comment asked that "the route that eventually serves it must consult this
 * list rather than re-deciding what LIMITED meant". This is that route's data
 * layer, and the scoping is a parameter here rather than a `if` in the handler
 * for one reason: a restriction expressed in a handler can be bypassed by
 * adding a second handler, whereas one expressed where the WHERE clause is
 * built applies to every caller of this function by construction.
 *
 * THE READING IS NEWEST-FIRST AND PAGED
 * -------------------------------------
 * `desc(created_at), desc(id)` - the same tie-break `GET /serials` uses. Two
 * events written in the same millisecond still have a total order, so a pager
 * cannot show one row twice or skip it between pages.
 *
 * ONE CONDITIONS ARRAY, USED TWICE
 * --------------------------------
 * Rows and `count()` take the same `where`. Building it twice by hand is how a
 * list and its total come to disagree, which would make `hasMore` a lie - the
 * promise `search.ts` makes for the registry, kept here for the trail.
 */

/** A parsed, validated `GET /admin/audit` query. Nothing here is unvalidated. */
export interface AuditQuerySpec {
  /** One licence's history - the drawer. `null` is the global trail. */
  readonly entityId: string | null;
  readonly entityType: string | null;
  readonly action: readonly AuditAction[];
  /** Resolved to a `staff_operators.id` inside the read, never here. */
  readonly actorEmail: string | null;
  readonly from: Date | null;
  readonly to: Date | null;
  readonly page: number;
  readonly pageSize: PageSize;
}

/**
 * Who the caller is allowed to see.
 *
 * `limited` comes from `LIMITED_AUDIT_ROLES` at the route; `actorId` is that
 * caller's own staff row. The pair is passed as one object so that "limited"
 * can never be set without an answer to "limited to whom".
 */
export interface AuditScope {
  readonly limited: boolean;
  readonly actorId: string | null;
}

/** One row of the trail, as the drawer and the activity page both render it. */
export interface AuditedEvent {
  readonly id: string;
  readonly actorId: string | null;
  readonly actorRole: StaffRole;
  /**
   * From `staff_operators`, LEFT JOINed - never from the request.
   *
   * `audit_events` has NO `actor_email` column (schema.ts:613-640), so a name
   * is only reachable by joining the staff row. `actor_id` is NULL for the
   * super admin before their first nomination, and for a service principal, so
   * this is genuinely `null` there. Rendering `null` as "pre-nomination" or
   * "service credential" is correct; rendering it as any address at all would
   * be attributing an action to somebody who may not have performed it.
   */
  readonly actorEmail: string | null;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string;
  readonly previousState: Record<string, unknown> | null;
  readonly newState: Record<string, unknown> | null;
  readonly ipAddress: string | null;
  readonly reason: string | null;
  readonly createdAt: string;
}

const AUDIT_ACTIONS: readonly string[] = auditActionEnum.enumValues;

/**
 * `from`/`to`, as UTC.
 *
 * A date picker sends `YYYY-MM-DD` and means the whole of that day, while a
 * machine client sends a full timestamp and means exactly what it says. Both
 * parse; anything else is refused. Reading a bare date as UTC midnight-to-
 * midnight rather than as the server's local day is what keeps an export's
 * range identical for an operator in IST and one in UTC - a day boundary that
 * moves under the reader is the same class of defect as a silently clamped
 * `pageSize`.
 */
function readBoundary(
  params: URLSearchParams,
  key: string,
  endOfDay: boolean,
): { ok: true; value: Date | null } | { ok: false; error: string } {
  const raw = (params.get(key) ?? "").trim();
  if (raw === "") return { ok: true, value: null };

  let value: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    value = new Date(endOfDay ? `${raw}T23:59:59.999Z` : `${raw}T00:00:00.000Z`);
  } else {
    value = new Date(raw);
  }
  if (Number.isNaN(value.getTime())) {
    return { ok: false, error: `"${key}" must be an ISO date or timestamp.` };
  }
  return { ok: true, value };
}

/**
 * Parse `GET /admin/audit`'s query, or refuse it with a sentence an operator
 * can act on.
 *
 * Same three guarantees as `parseSerialQuery`: `pageSize` is one of three named
 * sizes rather than a range to clamp, an unknown token names itself, and a
 * malformed range is a 400 rather than a page of everything.
 */
export function parseAuditQuery(
  params: URLSearchParams,
): { ok: true; spec: AuditQuerySpec } | { ok: false; error: string } {
  const entityIdRaw = (params.get("entityId") ?? "").trim();
  if (entityIdRaw !== "" && !isUuid(entityIdRaw)) {
    return { ok: false, error: "entityId must be a UUID." };
  }
  const entityTypeRaw = (params.get("entityType") ?? "").trim();

  const actorRaw = (params.get("actor") ?? "").trim().toLowerCase();

  const actionTokens = params.getAll("action");
  const actions: AuditAction[] = [];
  const unknownActions: string[] = [];
  for (const entry of actionTokens) {
    for (const part of entry.split(",")) {
      const token = part.trim().toUpperCase();
      if (!token) continue;
      const canonical = AUDIT_ACTIONS.find((value) => value === token);
      if (canonical === undefined) {
        unknownActions.push(part.trim());
        continue;
      }
      if (!actions.includes(canonical as AuditAction)) {
        actions.push(canonical as AuditAction);
      }
    }
  }
  if (unknownActions.length > 0) {
    return {
      ok: false,
      error:
        `Unknown value for "action": ${unknownActions.join(", ")}. ` +
        `Allowed: ${AUDIT_ACTIONS.join(", ")}.`,
    };
  }

  const from = readBoundary(params, "from", false);
  if (!from.ok) return { ok: false, error: from.error };
  const to = readBoundary(params, "to", true);
  if (!to.ok) return { ok: false, error: to.error };
  if (from.value !== null && to.value !== null && from.value > to.value) {
    return { ok: false, error: '"from" must not be after "to".' };
  }

  const pageRaw = (params.get("page") ?? "").trim();
  let page = 1;
  if (pageRaw !== "") {
    if (!/^\d+$/.test(pageRaw)) {
      return { ok: false, error: '"page" must be a positive whole number.' };
    }
    page = Number(pageRaw);
    if (page < 1) return { ok: false, error: '"page" starts at 1.' };
  }

  const sizeRaw = (params.get("pageSize") ?? "").trim();
  let pageSize: PageSize = 25;
  if (sizeRaw !== "") {
    const parsed = Number(sizeRaw);
    if (!PAGE_SIZES.includes(parsed as PageSize)) {
      return {
        ok: false,
        error: `"pageSize" must be one of ${PAGE_SIZES.join(", ")}; got "${sizeRaw}".`,
      };
    }
    pageSize = parsed as PageSize;
  }

  return {
    ok: true,
    spec: {
      entityId: entityIdRaw === "" ? null : entityIdRaw,
      entityType: entityTypeRaw === "" ? null : entityTypeRaw,
      action: actions,
      actorEmail: actorRaw === "" ? null : actorRaw,
      from: from.value,
      to: to.value,
      page,
      pageSize,
    },
  };
}

/**
 * The parsed query, echoed back to the client and recorded with the request.
 *
 * Omitted when absent rather than sent empty: `{action: []}` says the caller
 * filtered on action and matched everything, when the truth is that action was
 * never part of the question.
 */
export function auditFiltersFor(spec: AuditQuerySpec): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  if (spec.entityId !== null) filters.entityId = spec.entityId;
  if (spec.entityType !== null) filters.entityType = spec.entityType;
  if (spec.action.length > 0) filters.action = [...spec.action];
  if (spec.actorEmail !== null) filters.actor = spec.actorEmail;
  if (spec.from !== null) filters.from = spec.from.toISOString();
  if (spec.to !== null) filters.to = spec.to.toISOString();
  return filters;
}

function auditConditions(spec: AuditQuerySpec): SQL[] {
  const conditions: SQL[] = [];
  if (spec.entityId !== null) conditions.push(eq(auditEvents.entityId, spec.entityId));
  if (spec.entityType !== null) conditions.push(eq(auditEvents.entityType, spec.entityType));
  if (spec.action.length > 0) {
    // ONE condition for the whole selection, not a chain of `eq`, so the same
    // array can be handed to the count query unchanged. An OR built as
    // separate conditions and then `and`-ed would ask for rows that are both
    // `STAFF_INVITED` and `KEY_GENERATED` and match nothing.
    conditions.push(inArray(auditEvents.action, [...spec.action]));
  }
  if (spec.from !== null) conditions.push(gte(auditEvents.createdAt, spec.from));
  if (spec.to !== null) conditions.push(lte(auditEvents.createdAt, spec.to));
  return conditions;
}

export type AuditReadResult =
  | { readonly ok: true; readonly events: AuditedEvent[]; readonly total: number }
  | { readonly ok: false; readonly error: string };

/**
 * Read a page of the trail, scoped to what the caller may see.
 *
 * Fail-closed on `actor`: an operator whose own staff row cannot be found
 * returns zero rows rather than every row. Returning the full trail because
 * the scoping key was missing would turn a lookup failure into an
 * authorisation failure in the most damaging direction.
 */
export async function readAuditEvents(
  db: Pick<Database, "select">,
  spec: AuditQuerySpec,
  scope: AuditScope,
): Promise<AuditReadResult> {
  /*
   * §41 LIMITED, first and unconditional.
   *
   * Checked before anything else so that a caller with no staff row cannot
   * reach the unrestricted path by accident: "the rows they produced
   * themselves" has no answer without an identity, and the empty page is that
   * answer. Returning the full trail on a failed lookup would turn a
   * bookkeeping gap into an authorisation failure in the worst direction.
   *
   * Copied into a local rather than re-reading `scope.actorId` at each use so
   * that the narrowing from this check survives to the WHERE clause below - the
   * compiler cannot infer "limited implies identified" from a boolean flag,
   * and neither can a later reader.
   */
  let ownActorId: string | null = null;
  if (scope.limited) {
    if (scope.actorId === null) {
      return { ok: true, events: [], total: 0 };
    }
    ownActorId = scope.actorId;
  }

  const conditions = auditConditions(spec);

  /*
   * `actor=<email>` resolves here, against the database, never in the parser.
   *
   * The parser stays value-in/value-out with no Context, no database and no
   * clock - the same contract `parseSerialQuery` keeps. Resolving rather than
   * matching the email against a denormalised column also matters because
   * `audit_events` has no email column at all: the join key is `actor_id`.
   *
   * An address that names no staff row is refused. Silently matching nothing
   * would render as "this person did nothing", which is a claim about a human
   * being and is exactly the sort of negative the trail must not invent.
   */
  let requestedActorId: string | null = null;
  if (spec.actorEmail !== null) {
    const [row] = await db
      .select({ id: staffOperators.id })
      .from(staffOperators)
      .where(eq(staffOperators.email, spec.actorEmail))
      .limit(1);
    if (!row) {
      return { ok: false, error: `Unknown "actor": ${spec.actorEmail}.` };
    }
    requestedActorId = row.id;
  }

  /*
   * AND, not override.
   *
   * A requested actor narrows a LIMITED caller's view; it can never widen it,
   * because both conditions end up in the same array. Asking for somebody
   * else's rows while LIMITED therefore yields an empty page, which is the
   * correct reading of "show me theirs" from a seat that may only see its own.
   */
  if (ownActorId !== null) {
    conditions.push(eq(auditEvents.actorId, ownActorId));
  }
  if (requestedActorId !== null) {
    conditions.push(eq(auditEvents.actorId, requestedActorId));
  }

  return runAuditQuery(db, spec, conditions);
}

async function runAuditQuery(
  db: Pick<Database, "select">,
  spec: AuditQuerySpec,
  conditions: SQL[],
): Promise<AuditReadResult> {
  const where = conditions.length === 0 ? undefined : (and(...conditions) ?? undefined);
  const offset = (spec.page - 1) * spec.pageSize;

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: auditEvents.id,
        actorId: auditEvents.actorId,
        actorRole: auditEvents.actorRole,
        actorEmail: staffOperators.email,
        action: auditEvents.action,
        entityType: auditEvents.entityType,
        entityId: auditEvents.entityId,
        previousState: auditEvents.previousState,
        newState: auditEvents.newState,
        ipAddress: auditEvents.ipAddress,
        reason: auditEvents.reason,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      // `staff_operators.id` is a primary key, so this is at most one row per
      // audit row and cannot inflate the count - the same reasoning
      // `search.ts` gives for preferring `EXISTS` over a join on `payments`,
      // where the key was NOT unique.
      .leftJoin(staffOperators, eq(auditEvents.actorId, staffOperators.id))
      .where(where)
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(spec.pageSize)
      .offset(offset),
    db.select({ total: count() }).from(auditEvents).where(where),
  ]);

  return {
    ok: true,
    events: rows.map((row) => ({
      id: row.id,
      actorId: row.actorId,
      actorRole: row.actorRole,
      actorEmail: row.actorEmail,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      previousState: row.previousState,
      newState: row.newState,
      ipAddress: row.ipAddress,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    })),
    total: totalRows[0]?.total ?? 0,
  };
}
