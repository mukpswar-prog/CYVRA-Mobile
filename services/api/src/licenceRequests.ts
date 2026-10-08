/**
 * `POST /v1/licence-requests` - WS-K3, spec 9 (customer information for a
 * licence request) and spec 10 (purchase record).
 *
 * ## Why this route exists
 *
 * The Workspace's purchase form has always validated, produced the spec 10
 * summary and then printed the truth about itself:
 *
 *     NOT SENT: no endpoint accepts a licence request yet.
 *
 * This is the endpoint. Once it is mounted, the form submits and the customer
 * gets `SUBMITTED` instead of a confession. `requested_at` is the column the
 * submission lands in, and it is what `GET /v1/me/entitlement` reports back so
 * a page reload still knows the request happened.
 *
 * ## What it deliberately does NOT write
 *
 * Only `requested_at` changes on the row. The body is validated and then
 * **not** persisted, and that is a decision rather than an omission:
 *
 *  1. **Plan.** `REGISTRATION_DEFAULT_SLAB` carries an explicit ruling in
 *     `registration.ts` that "a pending-payment row that claims 50 devices is a
 *     promise. The smallest issuable slab is the largest claim the record can
 *     honestly make while the payment is unconfirmed." Letting a POST set
 *     `device_max` would let an unpaid customer grant themselves 50 scans in
 *     one request, and `projectEntitlement` would immediately report it as
 *     their plan. Requesting a slab is what the form is for; being granted one
 *     is what the operator and the payment are for. The chosen slab is
 *     recorded in the audit event's `new_state` (spec 10's "Selected licence
 *     type") where it cannot be mistaken for an entitlement.
 *  2. **Profile.** The row's name/address/pincode are copied from `users` by
 *     the bridge, and the session is the live source for them. Writing the
 *     form's snapshot back would let a stale form overwrite a corrected
 *     profile, and spec 9 exists to *avoid* re-asking for account data, not to
 *     create a second copy of it.
 *  3. **Payment status.** Spec 3 step 3 - "recorded manually by the authorized
 *     business/admin" - and spec 11's "Payment Done alone should not be
 *     treated as an application entitlement". The field is never read from
 *     this body. There is no code path that could accept it (ruling R-K2).
 *
 * ## Session-forced email
 *
 * `parseRegistration({ ...body, email: user.email })` - the session email is
 * spread **after** the body, so a client-supplied `email` is always
 * overwritten. A customer cannot file a request against somebody else's
 * address, and there is exactly one place that decides whose request this is.
 *
 * ## Rate limiting (ruling R-K3)
 *
 * No rate limiter exists anywhere in this service - the only precedent is the
 * OTP attempt counter - so this route bounds its own writes against the
 * database rather than against process memory. Workers isolate state, so an
 * in-memory token bucket resets on every cold start and is bypassable by
 * simply waiting for one; the interval is therefore enforced from
 * `mobile_serials.requested_at`, which is cross-isolate, requires no new
 * table, and is already the value this route writes.
 *
 * A submission less than `REQUEST_MIN_INTERVAL_MS` after the previous one
 * answers `429` with `Retry-After`. It is not a transaction error: the
 * previous request *did* land, and the body carries `requestedAt` so a client
 * can recover by treating it as submitted rather than as a failure.
 *
 * ## Why this file does not touch `ROUTE_ACTION_MAP`
 *
 * `assertRouteAuditCoverage(adminRoutes.routes)` (admin.ts:4026) throws if a
 * map entry names a route that is not registered on `adminRoutes`. This route
 * is mounted on the `/v1` customer surface, so adding
 * `"POST /v1/licence-requests"` to that map would fail the module at load. The
 * route key below is declared locally for the same reason the shared constants
 * are: so the string the handler writes and the string in this file's docs
 * cannot drift.
 *
 * And the audit row goes through `writeAudit`, never a direct insert:
 * `test/audit.test.ts` asserts that exactly one file under `src/` may name the
 * audit table directly, so a raw insert here would fail the suite by design -
 * which is the property this module wants, not an obstacle to route around.
 */

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { mobileSerials } from "@cyvra/database/schema";
import type { Database } from "./db";
import type { Env } from "./env";
import { readSessionToken } from "./session";
import { lookupSessionUser } from "./user";
import {
  ensureSerialForUser,
  findSerialForCustomer,
  type BridgeContext,
} from "./bridge";
import { parseRegistration, REGISTRATION_DEFAULT_SLAB } from "./registration";
import { planCodeFor } from "./licenceKey";
import {
  ENTITY_LICENCE,
  auditEntry,
  selfServiceAuditContext,
  writeAudit,
  type AuditAction,
  type AuditExecutor,
  type StaffAuditContext,
} from "./admin/audit";

/** The route key, declared once and used by the handler and by docs. */
export const LICENCE_REQUEST_ROUTE = "POST /v1/licence-requests";

/** The audit action this route writes (migration 0010 adds the enum value). */
export const LICENCE_REQUESTED: AuditAction = "LICENCE_REQUESTED";

/**
 * Minimum gap between two accepted submissions from the same customer.
 *
 * Chosen to be short enough that a customer who mistypes their PIN and
 * resubmits is never blocked for long, and long enough that a loop cannot
 * grow `audit_events` faster than a person can act. It is a constant rather
 * than configuration because there is no configuration surface for it yet;
 * widening it should be a ruling, not a tweak found in a diff.
 */
export const REQUEST_MIN_INTERVAL_MS = 60_000;

/** The session user, at the fields this route reads. */
export interface LicenceRequestUser {
  id: string;
  email: string;
  fullName: string | null;
  companyName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  pincode: string | null;
  state: string | null;
}

/** One serial row, as the route sees it. */
export interface LicenceRequestRow {
  serial: typeof mobileSerials.$inferSelect;
}

/** What the handler needs from storage, so a test can drive the real route. */
export interface LicenceRequestRepo {
  findUserBySessionToken(token: string): Promise<LicenceRequestUser | null>;
  findForEmail(email: string): Promise<LicenceRequestRow | null>;
  /**
   * The registration bridge, for a customer whose row does not exist yet.
   * Ruling R-K4: reuse it rather than adding a second insert path.
   */
  ensureSerial(c: BridgeContext, user: LicenceRequestUser): Promise<LicenceRequestRow | null>;
  /**
   * Stamp `requested_at` and write the audit row **in one transaction** - the
   * same atomicity rule `writeAudit` states: there is no path here that could
   * commit one without the other.
   */
  submit(input: SubmitInput): Promise<void>;
}

/** Everything `submit` needs, resolved by the handler from what it already read. */
export interface SubmitInput {
  readonly serialId: string;
  readonly previousRequestedAt: Date | null;
  readonly requestedAt: Date;
  readonly requestedPlanCode: string;
  readonly requestedDeviceMax: number;
  readonly customerEmail: string;
  readonly frame: StaffAuditContext;
}

/**
 * Is this submission inside the rate-limit window?
 *
 * Pure, so the rule is assertable without a request or a database. `null`
 * means the customer has never submitted, and is always allowed.
 */
export function withinMinInterval(
  previousRequestedAt: Date | null,
  now: Date,
  minIntervalMs: number = REQUEST_MIN_INTERVAL_MS,
): boolean {
  if (previousRequestedAt === null) return false;
  return now.getTime() - previousRequestedAt.getTime() < minIntervalMs;
}

/**
 * Production storage. Constructed per request, the same way `dbEntitlementRepo`
 * is, so the write is something this module opted into.
 */
export function dbLicenceRequestRepo(db: Database): LicenceRequestRepo {
  return {
    async findUserBySessionToken(token) {
      const user = await lookupSessionUser(db, token);
      return user === null
        ? null
        : {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            companyName: user.companyName,
            addressLine1: user.addressLine1,
            addressLine2: user.addressLine2,
            pincode: user.pincode,
            state: user.state,
          };
    },

    findForEmail: (email) => findSerialForCustomer(db, email),

    ensureSerial: (c, user) =>
      ensureSerialForUser(c, {
        email: user.email,
        userId: user.id,
        fullName: user.fullName,
        companyName: user.companyName,
        addressLine1: user.addressLine1,
        addressLine2: user.addressLine2,
        pincode: user.pincode,
        state: user.state,
        // The registration default, never the posted slab: see the module
        // header, point 1. A row created by this route must make the same
        // claim a row created by the bridge makes.
        deviceMax: REGISTRATION_DEFAULT_SLAB,
      }),

    async submit({ serialId, previousRequestedAt, requestedAt, requestedPlanCode, requestedDeviceMax, customerEmail, frame }) {
      await db.transaction(async (tx) => {
        await tx
          .update(mobileSerials)
          .set({ requestedAt })
          .where(eq(mobileSerials.id, serialId));

        await writeAudit(tx as AuditExecutor, {
          ...auditEntry(frame, {
            action: LICENCE_REQUESTED,
            entityType: ENTITY_LICENCE,
            entityId: serialId,
            // The "before" is the previous request time, which is exactly what
            // this mutation changes. `null` on a first request, because a row
            // that was never requested has no previous request.
            previousState: previousRequestedAt === null
              ? null
              : { requestedAt: previousRequestedAt.toISOString() },
            newState: {
              requestedAt: requestedAt.toISOString(),
              // Spec 10's "Selected licence type", recorded where it cannot be
              // read back as an entitlement.
              requestedPlanCode,
              requestedDeviceMax,
              // `actor_email` is not a column, so the address rides here -
              // the same choice `writeBridgeAudit` makes.
              customerEmail,
              source: "workspace",
            },
          }),
        });
      });
    },
  };
}

export interface LicenceRequestDeps {
  repo?: LicenceRequestRepo;
}

export function buildLicenceRequestRoutes(
  deps: LicenceRequestDeps = {},
): Hono<{ Bindings: Env; Variables: { db: Database } }> {
  const routes = new Hono<{ Bindings: Env; Variables: { db: Database } }>();

  routes.post("/licence-requests", async (c) => {
    // Authentication first, before a connection is opened - the same ordering
    // `GET /v1/me/entitlement` uses.
    const token = readSessionToken(c);
    if (!token) return c.json({ error: "Sign in required." }, 401);

    const repo = deps.repo ?? dbLicenceRequestRepo(c.get("db"));

    let user: LicenceRequestUser | null;
    try {
      user = await repo.findUserBySessionToken(token);
    } catch (error) {
      console.error(
        "[licence-requests] session lookup failed:",
        error instanceof Error ? error.message : error,
      );
      return c.json({ error: "Licence request is unavailable." }, 503);
    }
    if (user === null) return c.json({ error: "Sign in required." }, 401);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    // The session email wins: spread order is the whole security property.
    const parsed = parseRegistration({ ...body, email: user.email });
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    let row: LicenceRequestRow | null;
    try {
      row = await repo.findForEmail(user.email);
      if (row === null) {
        row = await repo.ensureSerial(c, user);
        // The bridge declined rather than threw: there is still no record to
        // file a request against, and that is an unavailability, not a missing
        // record. Reporting 404 here would tell a customer their licence does
        // not exist when the truth is that we could not create one.
        if (row === null) {
          return c.json({ error: "Licence request is unavailable." }, 503);
        }
      }
    } catch (error) {
      console.error(
        "[licence-requests] licence lookup failed:",
        error instanceof Error ? error.message : error,
      );
      return c.json({ error: "Licence request is unavailable." }, 503);
    }

    // Ownership re-checked rather than trusted to the query, exactly as the
    // entitlement route does. Another customer's row is "not found" here, and
    // 404 rather than 403 so the answer is not an oracle.
    if (row === null || row.serial.customerEmail !== user.email) {
      return c.json({ error: "Licence not found." }, 404);
    }

    const now = new Date();
    const previousRequestedAt = row.serial.requestedAt;

    if (withinMinInterval(previousRequestedAt, now)) {
      c.header("Retry-After", String(Math.ceil(REQUEST_MIN_INTERVAL_MS / 1000)));
      return c.json(
        {
          error: "A licence request was already submitted moments ago.",
          retryAfterSeconds: Math.ceil(REQUEST_MIN_INTERVAL_MS / 1000),
          // Present so a client can recover by treating this as submitted
          // instead of surfacing a red failure for a request that landed.
          requestedAt: previousRequestedAt?.toISOString() ?? null,
        },
        429,
      );
    }

    try {
      const frame = await selfServiceAuditContext(c, {
        actorId: null,
        actorRole: "SYSTEM",
        actorEmail: user.email,
      });
      await repo.submit({
        serialId: row.serial.id,
        previousRequestedAt,
        requestedAt: now,
        requestedPlanCode: planCodeFor(parsed.value.deviceMax),
        requestedDeviceMax: parsed.value.deviceMax,
        customerEmail: user.email,
        frame,
      });
    } catch (error) {
      console.error(
        "[licence-requests] submit failed:",
        error instanceof Error ? error.message : error,
      );
      return c.json({ error: "Licence request is unavailable." }, 503);
    }

    return c.json({
      status: "SUBMITTED",
      requestedAt: now.toISOString(),
    });
  });

  return routes;
}

/**
 * The production route. The repository resolves per request from `c.get("db")`
 * so a test that passes `{ repo }` gets a route that never opens a connection.
 */
export const licenceRequestRoutes = buildLicenceRequestRoutes();
