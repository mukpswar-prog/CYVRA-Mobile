/**
 * W5 PHASE 1 - THE LICENCE STATE MACHINE
 * ======================================
 *
 * Authoritative source: design plan 49 ("BACKEND STATE MACHINE"). Every edge
 * below is transcribed from that section, and **nothing else is legal** - the
 * backend rejects any transition that is not listed here, which is the whole
 * point of 49's closing line: "The backend must reject invalid transitions."
 *
 * The 10 states come straight from `licence_status_enum` (migration 0007, live
 * on Neon). `LicenceStatus` is derived from the pgEnum rather than redeclared,
 * so this file and the database cannot drift apart.
 *
 * ---------------------------------------------------------------------------
 * DECISION A2 - WHY `CANCELLED` IS ABSENT
 * ---------------------------------------------------------------------------
 * Design plan 49 lists 14 transitions, one of which is
 * `PAYMENT_PENDING -> CANCELLED`. That edge is **not implementable**: decision
 * A2 (approved, and asserted by migration 0007) places `CANCELLED` exclusively
 * in `payment_status_enum`, and `licence_status_enum` holds exactly 10 values
 * with no `CANCELLED`. Ruled by the operator of this repo:
 *
 *     Cancellation is expressed on the PAYMENT ONLY. The licence record stays
 *     PAYMENT_PENDING - nothing has been issued, so there is nothing to revoke.
 *
 * That keeps the licence map at 13 edges and invents no 14th transition the
 * plan never specified.
 *
 * ---------------------------------------------------------------------------
 * EDGE CLASS - `admin` vs `system`
 * ---------------------------------------------------------------------------
 * Two of the 13 edges cannot be driven by an administrator, and modelling them
 * as admin-reachable would be a lie about who can move a licence:
 *
 *   ISSUED  -> ACTIVE   activation by the host workstation (plan 7)
 *   ACTIVE  -> EXPIRED  the passage of time past `validity_ends_at` (plan 36)
 *
 * They are declared here so the map is complete and the 10x10 matrix is
 * exhaustive, but `transition()` refuses them whenever `actorKind` is
 * `"admin"` - which is the only value any admin route may ever pass.
 *
 * Neither is driven by any code path today. `POST /v1/activation` writes
 * `host_fingerprint` / `first_activated_at` and never touches `status`
 * (activation.ts), so `ACTIVE` is currently unreachable in production. Wiring
 * activation to flip the status belongs to a later phase; this file only
 * guarantees that an admin route cannot claim to have done it.
 *
 * ---------------------------------------------------------------------------
 * PRECONDITIONS ARE PART OF THE MAP, NOT OF THE ROUTE
 * ---------------------------------------------------------------------------
 * A transition is not merely "is (from, to) in the list" - 49's edges carry
 * conditions that the Green Key Rule (8) and the payment rule (A3) make
 * load-bearing. Evaluating them here means every caller gets the same answer,
 * and the exhaustive matrix test exercises them once rather than once per
 * route.
 */

import {
  licenceStatusEnum,
  paymentStatusEnum,
  type LicenceStatus,
} from "@cyvra/database/schema";

export type { LicenceStatus };

/**
 * `payments.status`. Derived from the pgEnum for the same reason
 * `LicenceStatus` is: one source, no drift.
 */
export type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number];

/**
 * Who is asking for the transition.
 *
 * `"admin"` is every HTTP route in this file's caller. `"system"` is reserved
 * for host activation and time-based expiry - the two edges above.
 */
export type TransitionActor = "admin" | "system";

export type TransitionClass = TransitionActor;

/**
 * One legal edge of the map.
 *
 * The `requires*` flags are booleans rather than free-form predicates so that
 * the exhaustive test can enumerate them mechanically and so that a reader can
 * see an edge's entire contract without executing anything.
 */
export interface LicenceEdge {
  readonly from: LicenceStatus;
  readonly to: LicenceStatus;
  /** `system` edges are unreachable from every admin route. */
  readonly cls: TransitionClass;
  /**
   * Requires `payments.status === 'PAID'`.
   *
   * Edge `PAYMENT_PENDING -> PAYMENT_CONFIRMED`: decision A3 forbids ever
   * writing `PAYMENT_CONFIRMED` except as a transactional consequence of a
   * PAID payment row, so the payment must already be PAID by the time this
   * edge is evaluated.
   *
   * Edge `READY_TO_GENERATE -> KEY_GENERATED`: the Green Key Rule (8) - "IF
   * Payment Status = PAID ... THEN Generate Key button = GREEN".
   */
  readonly requiresPaidPayment: boolean;
  /** Requires `public_number !== null` - a key must already exist. */
  readonly requiresKey: boolean;
  /** Requires a non-empty `reason` (plan 37: suspend/revoke need a reason). */
  readonly requiresReason: boolean;
}

/**
 * THE MAP. 13 edges, transcribed from design plan 49.
 *
 * Read-only and frozen: this is a lookup table, and a caller mutating it would
 * silently redefine what the backend considers legal.
 */
export const LICENCE_EDGES: readonly LicenceEdge[] = Object.freeze([
  Object.freeze({
    from: "DRAFT",
    to: "PAYMENT_PENDING",
    cls: "admin",
    requiresPaidPayment: false,
    requiresKey: false,
    requiresReason: false,
  }),
  Object.freeze({
    from: "PAYMENT_PENDING",
    to: "PAYMENT_CONFIRMED",
    cls: "admin",
    requiresPaidPayment: true,
    requiresKey: false,
    requiresReason: false,
  }),
  Object.freeze({
    from: "PAYMENT_CONFIRMED",
    to: "READY_TO_GENERATE",
    cls: "admin",
    requiresPaidPayment: true,
    requiresKey: false,
    requiresReason: false,
  }),
  Object.freeze({
    from: "READY_TO_GENERATE",
    to: "KEY_GENERATED",
    cls: "admin",
    requiresPaidPayment: true,
    requiresKey: false,
    requiresReason: false,
  }),
  Object.freeze({
    from: "KEY_GENERATED",
    to: "ISSUED",
    cls: "admin",
    requiresPaidPayment: false,
    requiresKey: true,
    requiresReason: false,
  }),
  // --- system: the host workstation activates the licence (plan 7) ---------
  Object.freeze({
    from: "ISSUED",
    to: "ACTIVE",
    cls: "system",
    requiresPaidPayment: false,
    requiresKey: false,
    requiresReason: false,
  }),
  Object.freeze({
    from: "ISSUED",
    to: "SUSPENDED",
    cls: "admin",
    requiresPaidPayment: false,
    requiresKey: false,
    requiresReason: true,
  }),
  Object.freeze({
    from: "ISSUED",
    to: "REVOKED",
    cls: "admin",
    requiresPaidPayment: false,
    requiresKey: false,
    requiresReason: true,
  }),
  Object.freeze({
    from: "ACTIVE",
    to: "SUSPENDED",
    cls: "admin",
    requiresPaidPayment: false,
    requiresKey: false,
    requiresReason: true,
  }),
  // --- system: `validity_ends_at` has passed (plan 36) --------------------
  Object.freeze({
    from: "ACTIVE",
    to: "EXPIRED",
    cls: "system",
    requiresPaidPayment: false,
    requiresKey: false,
    requiresReason: false,
  }),
  Object.freeze({
    from: "ACTIVE",
    to: "REVOKED",
    cls: "admin",
    requiresPaidPayment: false,
    requiresKey: false,
    requiresReason: true,
  }),
  Object.freeze({
    from: "SUSPENDED",
    to: "ACTIVE",
    cls: "admin",
    requiresPaidPayment: false,
    requiresKey: false,
    requiresReason: false,
  }),
  Object.freeze({
    from: "SUSPENDED",
    to: "REVOKED",
    cls: "admin",
    requiresPaidPayment: false,
    requiresKey: false,
    requiresReason: true,
  }),
] as LicenceEdge[]);

/** The 10 states, as an immutable list. Derived from the pgEnum. */
export const LICENCE_STATES: readonly LicenceStatus[] = Object.freeze([
  ...licenceStatusEnum.enumValues,
]);

/** The two edges no admin route may ever take. */
export const SYSTEM_EDGES: readonly LicenceEdge[] = Object.freeze(
  LICENCE_EDGES.filter((edge) => edge.cls === "system"),
);

/** The eleven edges an admin route may take. */
export const ADMIN_EDGES: readonly LicenceEdge[] = Object.freeze(
  LICENCE_EDGES.filter((edge) => edge.cls === "admin"),
);

/** `EXPIRED` and `REVOKED` have no outgoing edges; everything else has >= 1. */
const EDGES_BY_FROM = new Map<LicenceStatus, readonly LicenceEdge[]>(
  LICENCE_STATES.map((state) => [
    state,
    Object.freeze(LICENCE_EDGES.filter((edge) => edge.from === state)),
  ]),
);

/**
 * The snapshot of the world an edge's preconditions are checked against.
 *
 * Deliberately a plain value rather than a database handle: `transition()` must
 * be pure so that the exhaustive matrix test can drive all 100 (from, to)
 * pairs without a live Postgres.
 */
export interface TransitionContext {
  readonly actorKind: TransitionActor;
  /** `null`/`undefined` when no payment row is visible - treated as not PAID. */
  readonly paymentStatus?: PaymentStatus | null;
  /** Whether `public_number` currently holds a key. */
  readonly keyPresent?: boolean;
  readonly reason?: string | null;
}

/**
 * Why a transition was refused.
 *
 * `ForbiddenTransition` is the structural failure (the map says no);
 * the remaining variants are precondition failures (the map says yes, but the
 * world is not ready).
 */
export interface ForbiddenTransition {
  readonly kind: "ForbiddenTransition";
  readonly from: LicenceStatus;
  readonly to: LicenceStatus;
  /** States reachable from `from` under `ctx.actorKind` - what the caller may try instead. */
  readonly allowed: readonly LicenceStatus[];
  /**
   * `unknown-edge` - (from, to) is not in the map at all.
   * `self-transition` - a licence does not transition onto itself.
   * `system-only` - legal, but reserved for the system; an admin cannot take it.
   */
  readonly reason: "unknown-edge" | "self-transition" | "system-only";
}

export interface PaymentNotPaid {
  readonly kind: "PaymentNotPaid";
  readonly from: LicenceStatus;
  readonly to: LicenceStatus;
  /** The payment status actually observed; `null` when no payment row exists. */
  readonly actual: PaymentStatus | null;
}

export interface KeyMissing {
  readonly kind: "KeyMissing";
  readonly from: LicenceStatus;
  readonly to: LicenceStatus;
}

export interface ReasonRequired {
  readonly kind: "ReasonRequired";
  readonly from: LicenceStatus;
  readonly to: LicenceStatus;
}

export type TransitionError =
  | ForbiddenTransition
  | PaymentNotPaid
  | KeyMissing
  | ReasonRequired;

/**
 * The typed Result the phase brief asks for: success, or a refusal that always
 * says *why* and *what would have been legal*.
 */
export type TransitionResult =
  | { readonly ok: true; readonly edge: LicenceEdge }
  | { readonly ok: false; readonly error: TransitionError };

/** The single edge leading from `from` to `to`, if the map has one. */
export function edgeFor(
  from: LicenceStatus,
  to: LicenceStatus,
): LicenceEdge | undefined {
  return LICENCE_EDGES.find((edge) => edge.from === from && edge.to === to);
}

/**
 * States `from` may move to.
 *
 * With `actorKind: "admin"` the two system edges are excluded, so this is
 * exactly the set an admin route is allowed to target - which is what the
 * refusal message hands back to the caller.
 */
export function allowedTargets(
  from: LicenceStatus,
  actorKind: TransitionActor = "admin",
): readonly LicenceStatus[] {
  return Object.freeze(
    (EDGES_BY_FROM.get(from) ?? [])
      .filter((edge) => actorKind === "system" || edge.cls !== "system")
      .map((edge) => edge.to),
  );
}

/**
 * Evaluate a transition.
 *
 * Pure and total: every one of the 10x10 (from, to) pairs returns a
 * `TransitionResult`, never throws, and never touches the database. Callers
 * decide the HTTP status from `failureHttpStatus` below.
 *
 * Order matters and is deliberate - structural refusals are reported before
 * precondition refusals, because telling an operator "payment is not PAID"
 * when the edge does not exist in the first place would send them chasing a
 * condition that was never going to help.
 */
export function transition(
  from: LicenceStatus,
  to: LicenceStatus,
  ctx: TransitionContext,
): TransitionResult {
  const allowed = allowedTargets(from, ctx.actorKind);

  if (from === to) {
    return {
      ok: false,
      error: {
        kind: "ForbiddenTransition",
        from,
        to,
        allowed,
        reason: "self-transition",
      },
    };
  }

  const edge = edgeFor(from, to);
  if (!edge) {
    return {
      ok: false,
      error: {
        kind: "ForbiddenTransition",
        from,
        to,
        allowed,
        reason: "unknown-edge",
      },
    };
  }

  if (edge.cls === "system" && ctx.actorKind === "admin") {
    return {
      ok: false,
      error: {
        kind: "ForbiddenTransition",
        from,
        to,
        allowed,
        reason: "system-only",
      },
    };
  }

  if (edge.requiresPaidPayment && ctx.paymentStatus !== "PAID") {
    return {
      ok: false,
      error: {
        kind: "PaymentNotPaid",
        from,
        to,
        actual: ctx.paymentStatus ?? null,
      },
    };
  }

  if (edge.requiresKey && ctx.keyPresent !== true) {
    return { ok: false, error: { kind: "KeyMissing", from, to } };
  }

  if (edge.requiresReason && (ctx.reason ?? "").trim() === "") {
    return { ok: false, error: { kind: "ReasonRequired", from, to } };
  }

  return { ok: true, edge };
}

/**
 * HTTP status for a refusal.
 *
 * Two of these are contractual rather than conventional:
 *
 * - `PaymentNotPaid` is **403**, not 409. The phase brief specifies that the
 *   generate-key route returns 403 when `payments.status !== 'PAID'`, and the
 *   Green Key Rule is an *authorization* statement about what a given payment
 *   state permits, not a disagreement about the resource's current state.
 * - `system-only` is **403** for the same reason: the transition exists, the
 *   administrator simply is not the party allowed to make it.
 *
 * `unknown-edge` / `self-transition` are 409: the record's state and the
 * request disagree, and re-fetching is the remedy (plan 47's "This licence was
 * already processed by another administrator").
 */
export function failureHttpStatus(error: TransitionError): 400 | 403 | 409 | 503 {
  switch (error.kind) {
    case "PaymentNotPaid":
      return 403;
    case "ReasonRequired":
      return 400;
    case "KeyMissing":
      // A record that reached KEY_GENERATED without a key is an invariant
      // violation, not something an operator can fix by clicking again.
      return 503;
    case "ForbiddenTransition":
      return error.reason === "system-only" ? 403 : 409;
  }
}

/** Operator-facing sentence for a refusal. Never includes a key. */
export function failureMessage(error: TransitionError): string {
  switch (error.kind) {
    case "PaymentNotPaid":
      return "Payment must be confirmed as PAID before this step.";
    case "ReasonRequired":
      return "A reason is required for this action.";
    case "KeyMissing":
      return "Licence has no key; generate one before issuing.";
    case "ForbiddenTransition":
      switch (error.reason) {
        case "system-only":
          return "This transition is performed by the system, not by an administrator.";
        case "self-transition":
          return "The licence is already in this state.";
        case "unknown-edge": {
          const allowed = error.allowed;
          return allowed.length === 0
            ? `A licence in ${error.from} cannot move to ${error.to}.`
            : `A licence in ${error.from} cannot move to ${error.to}. Allowed: ${allowed.join(", ")}.`;
        }
      }
  }
}
