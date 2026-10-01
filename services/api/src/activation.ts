/**
 * `POST /v1/activation` - the desktop-facing activation route.
 *
 * This route did not exist before this change. `index.ts` mounted only
 * `/health`, `/auth/*`, `/me`, `/evidence`, `/reports`, `/license` and
 * `/admin`, so the desktop's `POST {base}/v1/activation` fell through to
 * Hono's default 404 - which `is_retryable` (live_client.rs:443) reads as a
 * considered, non-retryable answer and `decode` as `network error`. The
 * workstation could not activate at all; it just did not know why.
 *
 * It is deliberately **not** the admin `/issue` route. `/issue` is an operator
 * action gated by `requireAdmin` (staff cookie, or `ADMIN_API_TOKEN` +
 * `X-Admin-Email`) and it sends email; a workstation holds neither credential
 * and must never be given one. This route authenticates on the licence key
 * itself.
 *
 * ---
 * ## The wire contract, and where it comes from
 *
 * Nothing here is invented. The success and failure shapes are transcribed
 * from the desktop's own decoder:
 *
 *   success   `WireSuccess`   live_client.rs:492-502
 *   failure   `WireFailure`   live_client.rs:517-530
 *   verdict   `FailureKind::code()`  api.rs:73-82
 *
 * Two properties of that decoder drive the whole design:
 *
 * 1. **`409` is special-cased by status alone** (`live_client.rs:547`). It
 *    becomes `AlreadyBoundToAnotherComputer` even with an empty body, so we
 *    only have to send the status.
 * 2. **Every other status is decoded from the body's `code`, not the status.**
 *    An unrecognised code - or no code - is reported as `NETWORK_ERROR`, never
 *    as a verdict: `failure_from_code` returns `None` for anything outside the
 *    six (`live_client.rs:607-615`) and `decode` falls through to
 *    `NetworkError` (`live_client.rs:571-579`). So the status codes below are
 *    for humans, logs and retry policy; the `code` field is what the operator
 *    actually sees.
 *
 * ### The response body must contain `code`, never a bare `error` string
 *
 * `WireFailure.error` is typed as a *struct* holding a `code`. If this route
 * answered `{error: "..."}` the way the admin routes do, `serde` would fail to
 * deserialize `WireFailure`, `failure_from_body` would return `None`, and
 * every precise refusal the server sent would degrade to "network error" on
 * screen. The admin shape is actively wrong on this route.
 *
 * ## Anti-enumeration
 *
 * A key that does not exist, and a key that exists but was issued to a
 * different email, return the **byte-identical** response. Neither element of
 * the pair is ever confirmed on its own, so probing cannot establish that some
 * other customer's key exists.
 */

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { mobileSerials } from "@cyvra/database/schema";
import type { Database } from "./db";
import type { Env } from "./env";
import { generateSessionToken, sha256Hex, timingSafeEqualHex } from "./crypto";
import {
  SigningConfigError,
  readEntitlementPolicy,
  requireSigningKey,
  signEntitlement,
  type EntitlementPolicy,
  type Now,
} from "./entitlementSigner";

/**
 * The desktop's six verdict codes, transcribed from `FailureKind::code()`
 * (api.rs:73-82).
 *
 * The client matches case-insensitively against **this exact set** and maps
 * anything else to `NETWORK_ERROR` (`live_client.rs:607-615`). A typo here
 * would not fail loudly - it would silently downgrade a precise refusal into
 * "network error", so the exact strings are pinned by a test.
 */
export const ACTIVATION_CODES = [
  "INVALID_USER",
  "INVALID_LICENCE",
  "LICENCE_NOT_ACTIVE",
  "LICENCE_EXPIRED",
  "ALREADY_BOUND",
  "NETWORK_ERROR",
] as const;

export type ActivationCode = (typeof ACTIVATION_CODES)[number];

/** `BindingOutcome` (api.rs:101-105). Serde expects these spellings exactly. */
export type BindingOutcome = "FirstActivation" | "AuthorizedDeviceRevalidation";

export type ActivationSerial = typeof mobileSerials.$inferSelect;

/** How a caller binds the one host this licence is allowed. */
export interface ClaimParams {
  id: string;
  hostFingerprint: string;
  deviceTokenHash: string;
  now: Date;
}

/**
 * The two storage operations activation needs, and nothing else.
 *
 * Narrow on purpose: it is the seam that makes this route testable without a
 * live Postgres, and it keeps the route from reaching into the schema for
 * anything the decision does not actually depend on.
 */
export interface ActivationRepo {
  findByKey(publicNumber: string): Promise<ActivationSerial | null>;
  /**
   * Binds the host **only if** the licence is unbound or already bound to this
   * same fingerprint. Returns `false` when the guard lost the race.
   */
  claimBinding(params: ClaimParams): Promise<boolean>;
}

function dbRepo(db: Database): ActivationRepo {
  return {
    async findByKey(publicNumber) {
      const [row] = await db
        .select()
        .from(mobileSerials)
        .where(eq(mobileSerials.publicNumber, publicNumber))
        .limit(1);
      return row ?? null;
    },
    async claimBinding({ id, hostFingerprint, deviceTokenHash, now }) {
      // The WHERE clause is the one-host limit, enforced by the database rather
      // than by a read-then-write in application code. Two concurrent requests
      // with different fingerprints cannot both satisfy it: the first UPDATE
      // flips `host_fingerprint` out of NULL and the second matches neither
      // `IS NULL` nor `= its own fingerprint`, so it returns zero rows.
      const rows = await db
        .update(mobileSerials)
        .set({
          hostFingerprint,
          deviceTokenHash,
          // coalesce(): a re-activation must not overwrite the original stamp.
          firstActivatedAt: sql`coalesce(${mobileSerials.firstActivatedAt}, ${now})`,
        })
        .where(
          and(
            eq(mobileSerials.id, id),
            or(
              isNull(mobileSerials.hostFingerprint),
              eq(mobileSerials.hostFingerprint, hostFingerprint),
            ),
          ),
        )
        .returning({ id: mobileSerials.id });
      return rows.length > 0;
    },
  };
}

/**
 * Test seams. Production uses neither: the repo resolves from the request's
 * database connection and the clock is the composition root's own `new Date()`,
 * so that all *decision* logic stays clock-injected and deterministic under
 * test (frozen directive 5).
 */
export interface ActivationDeps {
  repo?: ActivationRepo;
  now?: Now;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Constant-time-ish equality of two arbitrary strings.
 *
 * Both are hashed first, so `timingSafeEqualHex` always compares two 64-char
 * digests and its length check can never short-circuit into a timing oracle
 * over the raw value.
 */
async function sameValue(a: string, b: string): Promise<boolean> {
  return timingSafeEqualHex(await sha256Hex(a), await sha256Hex(b));
}

export function buildActivationRoutes(
  deps: ActivationDeps = {},
): Hono<{ Bindings: Env; Variables: { db: Database } }> {
  const routes = new Hono<{ Bindings: Env; Variables: { db: Database } }>();

  routes.post("/activation", async (c) => {
    // PHASE 0 - configuration, before any read or write.
    //
    // The contract mandates `entitlement` and `offline_lease` on every success,
    // and neither exists without a private key. Discovering that after the
    // database has been mutated would leave a host bound with no signature to
    // show for it. Failing here leaves every path untouched; a retry works the
    // moment ops fixes the configuration.
    let privateKey: string;
    let policy: EntitlementPolicy;
    try {
      privateKey = requireSigningKey(c.env);
      policy = readEntitlementPolicy(c.env);
    } catch (error) {
      // 503 carries no `code`, so the desktop reports `network error` and -
      // correctly - retries, because this is a server fault, not a verdict.
      if (error instanceof SigningConfigError) {
        return c.json({ message: error.message }, 503);
      }
      throw error;
    }

    const now = deps.now ?? (() => new Date());
    const repo = deps.repo ?? dbRepo(c.get("db"));

    try {
      // PHASE 1 - parse. Every input is read as a string or treated as absent;
      // a JSON body of the wrong shape cannot reach the database.
      const raw = await c.req.json().catch(() => null);
      if (!raw || typeof raw !== "object") {
        return c.json({ message: "A JSON body is required." }, 400);
      }
      const body = raw as Record<string, unknown>;

      const email = asString(body.email).trim().toLowerCase();
      const licenceKey = asString(body.licence_key).trim().toUpperCase();
      const fingerprint = asString(body.device_fingerprint).trim();

      if (!email) {
        return c.json({ code: "INVALID_USER", message: "An email address is required." }, 400);
      }
      if (!licenceKey) {
        return c.json({ code: "INVALID_LICENCE", message: "A licence key is required." }, 400);
      }
      if (!fingerprint) {
        // No verdict exists for "you did not send a fingerprint". Returning no
        // `code` makes the desktop fall through to its documented bucket for
        // untranslatable answers rather than inventing an accusation against
        // the licence. This branch is unreachable from our own client, which
        // always sends the field.
        return c.json({ message: "A device fingerprint is required." }, 400);
      }

      // PHASE 2 - locate the licence.
      const serial = await repo.findByKey(licenceKey);
      // Unknown key. Identical response to the email mismatch below.
      if (!serial) {
        return c.json({ code: "INVALID_LICENCE", message: "No such licence key." }, 404);
      }
      if (!(await sameValue(serial.customerEmail.trim().toLowerCase(), email))) {
        // Deliberately byte-identical to "key not found": confirming that a key
        // exists but belongs to someone else would be an enumeration oracle.
        return c.json({ code: "INVALID_LICENCE", message: "No such licence key." }, 404);
      }

      // PHASE 3 - state checks. The union is PENDING | ISSUED | REVOKED
      // (admin.ts `SerialStatus`); only ISSUED may activate. Note that the
      // brief's "READY_TO_GENERATE" is not a state this schema has ever had,
      // so there is nothing to accept for it.
      if (serial.status !== "ISSUED") {
        const message =
          serial.status === "REVOKED"
            ? "This licence has been revoked."
            : "This licence has not been issued yet.";
        return c.json({ code: "LICENCE_NOT_ACTIVE", message }, 403);
      }

      // Expiry. `mobile_serials` has no expiry column, so the window comes from
      // the same policy that governs signing - one source, no drift.
      //
      // Deliberately NOT extended by grace. `graceLimitSeconds` covers an
      // *already-held* grant continuing to work offline; `buildEntitlementPayload`
      // refuses to sign a payload whose `validUntil` is already past
      // (Kotlin L130), so activating inside grace would bind a host and then
      // 503 on the signature. Refusing here keeps every success verifiable.
      const validFromMs = (serial.issuedAt ?? serial.createdAt).getTime();
      const validUntilMs = validFromMs + policy.validitySeconds * 1000;
      const activatedAt = now();
      if (activatedAt.getTime() > validUntilMs) {
        return c.json(
          {
            code: "LICENCE_EXPIRED",
            message: "This licence is past its validity window.",
          },
          410,
        );
      }

      // PHASE 4 - the one-host limit, read side.
      let binding: BindingOutcome;
      if (serial.hostFingerprint === null) {
        binding = "FirstActivation";
      } else if (await sameValue(serial.hostFingerprint, fingerprint)) {
        // The *same* computer coming back - a reinstall, a re-image, a new
        // token. Reporting `ALREADY_BOUND` here would tell the operator their
        // machine belongs to "another computer", which is false, and the
        // desktop's wording is `FailureKind::AlreadyBoundToAnotherComputer`.
        // Re-binding the host that already holds the licence is idempotent.
        binding = "AuthorizedDeviceRevalidation";
      } else {
        return c.json({ code: "ALREADY_BOUND" }, 409);
      }

      // PHASE 5 - claim, then sign.
      //
      // Order matters. Claiming first means a signature is never handed to a
      // host that then loses the race. Signing first would do exactly that:
      // the loser would hold a valid, verifiable signature for a binding the
      // server refused. Claiming first can fail closed instead - the host ends
      // up bound with no response, and retrying takes the revalidation branch
      // above and succeeds. That is recoverable; the other order is not.
      const deviceToken = generateSessionToken();
      const claimed = await repo.claimBinding({
        id: serial.id,
        hostFingerprint: fingerprint,
        deviceTokenHash: await sha256Hex(deviceToken),
        now: activatedAt,
      });
      if (!claimed) {
        // Lost a race we could not see in PHASE 4 - someone else bound it
        // between our read and our write.
        return c.json({ code: "ALREADY_BOUND" }, 409);
      }

      // The lease is anchored at *this moment*, not at the serial's issue date.
      // See `PayloadAnchors`: anchoring a lease to an issue date from months
      // earlier would put `validUntil` in the past and make offline grace
      // impossible to enter.
      const leasePolicy: EntitlementPolicy = {
        ...policy,
        validitySeconds: policy.graceLimitSeconds,
      };
      const clock: Now = () => activatedAt;

      const entitlement = await signEntitlement(serial, policy, privateKey, clock);
      const offlineLease = await signEntitlement(
        serial,
        leasePolicy,
        privateKey,
        clock,
        { validFrom: activatedAt },
      );

      const graceSeconds = policy.graceLimitSeconds;
      return c.json({
        device_token: deviceToken,
        entitlement,
        offline_lease: offlineLease,
        server_time: activatedAt.toISOString(),
        grace_expires_at_unix:
          Math.floor((activatedAt.getTime() + graceSeconds * 1000) / 1000),
        binding,
      });
    } catch (error) {
      // Anything unexpected is a server fault. No `code` is emitted, so the
      // desktop reports `network error` - which is true: the licence was never
      // judged, the server failed. 500 is retryable (`live_client.rs:443`).
      if (error instanceof SigningConfigError) {
        return c.json({ message: error.message }, 503);
      }
      console.error("[activation] unexpected failure:", error instanceof Error ? error.message : error);
      return c.json({ message: "Activation could not be completed." }, 500);
    }
  });

  return routes;
}

/** The production route. The repo resolves per request from `c.get("db")`. */
export const activationRoutes = buildActivationRoutes();
