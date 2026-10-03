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
import {
  auditActionEnum,
  auditEvents,
  staffRoleEnum,
} from "@cyvra/database/schema";
import type { Database } from "../db";
import type { Env } from "../env";
import { authenticate, isAuthError, type StaffRole } from "./principal";

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
