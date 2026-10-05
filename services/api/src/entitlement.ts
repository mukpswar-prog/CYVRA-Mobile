/**
 * `GET /v1/me/entitlement` - the customer's own licence, in customer language.
 *
 * ## Why this route exists
 *
 * The dashboard did not read the network at all. `CustomerDesktopShell.tsx`
 * seeded its licence from `useState`: a fabricated serial
 * (`CYVRA15092026SA3F1-1-25`), a fabricated plan (`25 Device Scans`) and a
 * fabricated status (`ACTIVE`) rendered for every account regardless of what
 * the database held. A customer with no licence was shown an active one.
 *
 * ## Why this supersedes `GET /license` rather than extending it
 *
 * `/license` (license.ts) fails in three ways this route deliberately does not
 * repeat:
 *
 *  1. **It fails open.** With no serial it returns `CYVRA-PREVIEW-TRIAL-1-3`,
 *     `status: "ACTIVE"`, `scansUsed: 0` - a licence that does not exist,
 *     presented as active. This route answers 404. "There is no record" and
 *     "there is an active record" are different answers and only one is true.
 *  2. **It returns the raw key.** `serialNumber: activeSerial.publicNumber` is
 *     the whole licence key, re-exported under a field name the redaction
 *     contract does not watch. `maskSerialKey` is the only form of a key that
 *     may leave the server outside `GET /admin/serials/:serialId`.
 *  3. **It speaks operator.** `status: ... === "ISSUED" ? "ACTIVE" : status`
 *     hands a customer the raw enum - `READY_TO_GENERATE`,
 *     `PAYMENT_PENDING` - which is the vocabulary of the ops queue, not of a
 *     person waiting for their licence.
 *
 * `/license` stays mounted until a hygiene commit retires it; nothing here
 * changes it.
 *
 * ## Scoping, and why it is by email
 *
 * `mobile_serials.user_id` is written by the registration bridge from the moment
 * a row is created, but rows an operator created before it existed still carry
 * NULL, so email remains the only join that works for *both* populations today.
 * Flipping this to `user_id` is a deliberate follow-up, not a requirement of the
 * bridge.
 *
 * The ownership check is repeated in the projection rather than trusted to the
 * query: a repository that hands back another customer's row must still produce
 * a 404. A mis-scoped read is the one defect that would be invisible to every
 * other test here, because a 200 with the wrong customer's plan on it looks
 * entirely healthy.
 *
 * ## 404, never 403
 *
 * 403 says "this exists and you may not have it", which confirms the row and
 * turns the endpoint into an oracle. 404 says nothing. The precedent is
 * reports.ts:148-149 and :206-207.
 *
 * ## Usage counters
 *
 * There is no scan ledger and no activations table on the server, so there is
 * nothing to count:
 *
 * * **activation** is a timestamp and a binding state, never a number -
 *   `POST /v1/activation` writes no audit row and no per-activation record, so
 *   a count would have to be invented;
 * * **scans** is gated behind the R-1 ruling and is therefore reported as
 *   `available-after-first-scan`. `devices_bound` is *not* used: nothing
 *   increments it, and the column comment in schema.ts records that it is read
 *   as `scansUsed` by the old `/license` route, so treating it as live would
 *   both show a permanent `0` and spend a customer's allowance on an
 *   activation.
 *
 * A failed read answers 503 with nothing but an `error` field, so no caller can
 * mistake an absent counter for a zero.
 */

import { Hono } from "hono";
import { mobileSerials, type LicenceStatus } from "@cyvra/database/schema";
import type { Database } from "./db";
import type { Env } from "./env";
import type { PaymentStatus } from "./admin/state-machine";
import { maskSerialKey } from "./admin";
import {
  ensureSerialForUser,
  findSerialForCustomer,
  type BridgeContext,
} from "./bridge";
import { isLicenceSlab, slabLabel } from "./licenceKey";
import { planNameFor } from "./entitlementSigner";
import { REGISTRATION_DEFAULT_SLAB } from "./registration";
import { readSessionToken } from "./session";
import { lookupSessionUser } from "./user";
import committedBuild from "../../../apps/web/public/build-manifest.json";

/**
 * What the release job writes into `apps/web/public/build-manifest.json`.
 *
 * `published` is only ever believed when both a version and a well-formed
 * digest are present. A manifest that claims publication but carries no digest
 * is treated as unpublished rather than rendered as a half-known build, because
 * "version 3.2.2, no checksum" is exactly the claim a customer cannot verify.
 */
export interface BuildManifest {
  state: "unavailable" | "published";
  version: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  url: string | null;
  releasedAt: string | null;
}

const UNAVAILABLE_BUILD: BuildManifest = {
  state: "unavailable",
  version: null,
  sha256: null,
  sizeBytes: null,
  url: null,
  releasedAt: null,
};

/**
 * Fails safe. Every field is validated independently, and publication requires
 * version + digest; anything else degrades to the whole `unavailable` record so
 * a malformed file can never surface a fabricated checksum.
 */
export function normalizeBuild(raw: unknown): BuildManifest {
  if (raw === null || typeof raw !== "object") return UNAVAILABLE_BUILD;
  const m = raw as Record<string, unknown>;

  const version =
    typeof m.version === "string" && m.version.trim() !== "" ? m.version.trim() : null;
  const sha256 =
    typeof m.sha256 === "string" && /^[0-9a-f]{64}$/i.test(m.sha256)
      ? m.sha256.toLowerCase()
      : null;
  if (m.state !== "published" || version === null || sha256 === null) {
    return UNAVAILABLE_BUILD;
  }

  const url = typeof m.url === "string" && /^https:\/\//.test(m.url) ? m.url : null;
  const sizeBytes =
    typeof m.sizeBytes === "number" && Number.isFinite(m.sizeBytes) && m.sizeBytes > 0
      ? Math.trunc(m.sizeBytes)
      : null;
  const releasedAt =
    typeof m.releasedAt === "string" && Number.isFinite(Date.parse(m.releasedAt))
      ? new Date(m.releasedAt).toISOString()
      : null;

  return { state: "published", version, sha256, sizeBytes, url, releasedAt };
}

/**
 * `licence_status_enum` -> one sentence a customer can act on.
 *
 * Typed `Record<LicenceStatus, string>` rather than a `switch` with a
 * `default`, so adding an eleventh state to the enum fails the typecheck here
 * instead of falling through to whatever the caller renders for `undefined`.
 * No value may be echoed as-is: the enum *is* the operator vocabulary.
 */
const LICENCE_SENTENCES: Record<LicenceStatus, string> = {
  DRAFT: "Being prepared",
  PAYMENT_PENDING: "Awaiting payment",
  PAYMENT_CONFIRMED: "Payment received",
  READY_TO_GENERATE: "Licence key being prepared",
  KEY_GENERATED: "Licence key ready",
  ISSUED: "Licence issued - check your email",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  SUSPENDED: "Suspended - contact support",
  REVOKED: "Revoked - contact support",
};

/** `payment_status_enum` -> one sentence. `null` payment is "unknown", not PENDING. */
const PAYMENT_SENTENCES: Record<PaymentStatus, string> = {
  PENDING: "Awaiting payment",
  PAID: "Paid",
  PARTIALLY_PAID: "Partially paid",
  REFUNDED: "Refunded",
  CANCELLED: "Cancelled",
};

/**
 * Scan debits stay gated behind the R-1 ruling, so the segment reports a state
 * rather than a quantity. It is a constant on purpose: while it is, no code
 * path can put a number there by accident, and a test asserting the exact
 * object fails the moment someone does.
 */
const SCANS_STATE = "available-after-first-scan";

/**
 * The signed-in customer, as the session reports them.
 *
 * The profile fields are not decoration: the ensure-on-session backfill copies
 * them onto the licence row it creates, and `lookupSessionUser` already reads
 * them. Projecting them away here and re-reading the row inside the bridge would
 * be a second trip to the database for data this query had in its hands.
 */
export interface EntitlementUser {
  id: string;
  email: string;
  companyName: string | null;
  fullName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  pincode: string | null;
  state: string | null;
}

export interface EntitlementRow {
  serial: typeof mobileSerials.$inferSelect;
  paymentStatus: PaymentStatus | null;
}

/**
 * The two reads this route needs, and nothing else - the same seam
 * `ActivationRepo` provides for the desktop routes. Production resolves both
 * from the request's database connection; tests drive the real Hono route
 * against an in-memory stand-in, with no Postgres.
 */
export interface EntitlementRepo {
  /**
   * Resolve the **customer** session from the token the browser presented.
   * Production delegates to `lookupSessionUser`, the web track's own query, so
   * there is exactly one definition of what a valid customer session is.
   */
  findUserBySessionToken(token: string): Promise<EntitlementUser | null>;
  /**
   * The one serial this customer owns. Scoped by `customer_email` until the
   * bridge starts writing `user_id`.
   */
  findForEmail(email: string): Promise<EntitlementRow | null>;
}

function dbEntitlementRepo(db: Database): EntitlementRepo {
  return {
    async findUserBySessionToken(token) {
      const user = await lookupSessionUser(db, token);
      return user === null
        ? null
        : {
            id: user.id,
            email: user.email,
            companyName: user.companyName,
            fullName: user.fullName,
            addressLine1: user.addressLine1,
            addressLine2: user.addressLine2,
            pincode: user.pincode,
            state: user.state,
          };
    },
    async findForEmail(email) {
      return findSerialForCustomer(db, email);
    },
  };
}

export interface EntitlementDeps {
  repo?: EntitlementRepo;
  /** Defaults to the committed `apps/web/public/build-manifest.json`. */
  build?: unknown;
  /**
   * Ensure-on-session: create the customer's licence record when they are
   * signed in and do not have one.
   *
   * Optional, and deliberately absent from `buildEntitlementRoutes({ repo })`'s
   * default - a read-only route must stay read-only when a test drives it, and
   * the production wiring below is what opts into the write. The seam exists so
   * "no serial" can be repaired by the customer's next dashboard load rather
   * than being a permanent 404 for everyone who registered before the bridge.
   */
  ensureSerial?: (
    c: BridgeContext,
    user: EntitlementUser,
  ) => Promise<EntitlementRow | null>;
}

/**
 * The projection, kept separate from the handler so its shape is assertable
 * without a request.
 */
export function projectEntitlement(
  row: EntitlementRow,
  build: BuildManifest,
  user: EntitlementUser,
) {
  const serial = row.serial;
  const paymentStatus = row.paymentStatus;

  return {
    // Who is signed in. Read from the **session**, not from the serial:
    // `mobile_serials.company_name` is a copy taken when the licence was
    // issued, whereas the dashboard header is asking who is looking at it
    // right now. `email` is the User ID this product signs in with - the
    // dashboard's "REGISTERED USER ID (EMAIL)" - so it is reported under its
    // own name rather than as a login detail.
    customer: {
      companyName: user.companyName,
      email: user.email,
    },
    plan: {
      code: serial.planCode,
      slab: isLicenceSlab(serial.deviceMax) ? slabLabel(serial.deviceMax) : null,
      label: planNameFor(serial.deviceMax),
    },
    licence: {
      status: serial.status,
      sentence: LICENCE_SENTENCES[serial.status],
      // `public_number` is NULL on a DRAFT row; that stays null rather than
      // becoming a fabricated `CYVRA-***`, which reads as a real-but-unavailable
      // key. Same rule as `jsonSerialList`.
      maskedSerial: serial.publicNumber === null ? null : maskSerialKey(serial.publicNumber),
    },
    payment:
      paymentStatus === null
        ? { state: "unknown" as const, status: null, sentence: null }
        : {
            state: "known" as const,
            status: paymentStatus,
            sentence: PAYMENT_SENTENCES[paymentStatus],
          },
    validity:
      serial.validityEndsAt === null
        ? { state: "unknown" as const, startsAt: null, endsAt: null }
        : {
            state: "window" as const,
            startsAt:
              serial.validityStartsAt === null ? null : serial.validityStartsAt.toISOString(),
            endsAt: serial.validityEndsAt.toISOString(),
          },
    usage: {
      activation: {
        activatedAt: serial.firstActivatedAt === null ? null : serial.firstActivatedAt.toISOString(),
        hostBinding: serial.hostBindingStatus,
      },
      scans: { state: SCANS_STATE },
    },
    build,
  };
}

export function buildEntitlementRoutes(
  deps: EntitlementDeps = {},
): Hono<{ Bindings: Env; Variables: { db: Database } }> {
  const routes = new Hono<{ Bindings: Env; Variables: { db: Database } }>();

  routes.get("/me/entitlement", async (c) => {
    // PHASE 1 - authentication, before the repository is even constructed, so
    // an anonymous request never causes a connection to be opened.
    const token = readSessionToken(c);
    if (!token) return c.json({ error: "Sign in required." }, 401);

    const repo = deps.repo ?? dbEntitlementRepo(c.get("db"));

    let user: EntitlementUser | null;
    try {
      user = await repo.findUserBySessionToken(token);
    } catch (error) {
      console.error(
        "[me/entitlement] session lookup failed:",
        error instanceof Error ? error.message : error,
      );
      return c.json({ error: "Entitlement is unavailable." }, 503);
    }
    if (user === null) return c.json({ error: "Sign in required." }, 401);

    let row: EntitlementRow | null;
    try {
      row = await repo.findForEmail(user.email);
    } catch (error) {
      console.error(
        "[me/entitlement] entitlement read failed:",
        error instanceof Error ? error.message : error,
      );
      return c.json({ error: "Entitlement is unavailable." }, 503);
    }

    // ENFORCE-ON-SESSION. A signed-in customer with no row is not a permanent
    // "Licence not found" - it is a record the bridge has not reached yet: an
    // account registered before this code existed, or a sign-in whose bridge
    // write failed and was logged rather than allowed to break the login. Either
    // way the next authenticated dashboard load is where it gets repaired.
    //
    // A failure here answers 503, not 404: we do not know that there is no
    // licence, only that we could not establish one. 404 would turn a transient
    // database error into a claim about the customer's record.
    if (row === null && deps.ensureSerial !== undefined) {
      try {
        row = await deps.ensureSerial(c, user);
      } catch (error) {
        console.error(
          "[me/entitlement] licence bridge failed:",
          error instanceof Error ? error.message : error,
        );
        return c.json({ error: "Entitlement is unavailable." }, 503);
      }
    }

    // Ownership is re-checked here rather than trusted to the query above. A
    // row belonging to somebody else is "not found" for this caller - not 403,
    // which would confirm the row exists.
    if (row === null || row.serial.customerEmail !== user.email) {
      return c.json({ error: "Licence not found." }, 404);
    }

    return c.json(
      projectEntitlement(row, normalizeBuild(deps.build ?? committedBuild), user),
    );
  });

  return routes;
}

/**
 * The production route.
 *
 * Both reads resolve per request from `c.get("db")`, and the ensure-on-session
 * backfill is wired here rather than in `buildEntitlementRoutes`'s default so
 * that a test which passes only `{ repo }` gets a route that reads and never
 * writes. Same reason `dbEntitlementRepo` exists as a per-request value: the
 * write has to be something this module opted into, not something every caller
 * inherits.
 */
export const entitlementRoutes = buildEntitlementRoutes({
  ensureSerial: async (c, user) =>
    ensureSerialForUser(c, {
      email: user.email,
      userId: user.id,
      fullName: user.fullName,
      companyName: user.companyName,
      addressLine1: user.addressLine1,
      addressLine2: user.addressLine2,
      pincode: user.pincode,
      state: user.state,
      // No plan picker exists, so a backfilled row takes the registration
      // default rather than a slab nobody chose.
      deviceMax: REGISTRATION_DEFAULT_SLAB,
    }),
});
