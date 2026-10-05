/**
 * STATUS -> TONE -> LABEL. Pure, and separately testable for exactly one
 * reason: "status = text + colour, never colour alone" is a rule about *text*,
 * so the mapping that produces the text is worth asserting on its own rather
 * than through a rendered table.
 *
 * Every tone here is a class on `.badge` in `styles.css`, where each one pairs
 * a foreground and a background chosen together to clear 4.5:1. Nothing in this
 * file picks a colour; it names a *meaning*, and the stylesheet decides what
 * that meaning looks like. That indirection is deliberate - a new status added
 * to the schema cannot land as an unreadable tint, because the only thing it
 * can do here is fail to resolve.
 */

export type Tone = "green" | "amber" | "red" | "blue" | "violet" | "neutral";

export interface BadgeView {
  /** The word. Always rendered, even when the tone is `neutral`. */
  text: string;
  tone: Tone;
}

const UNSET: BadgeView = { text: "—", tone: "neutral" };

function resolve(value: string | null | undefined, table: Record<string, BadgeView>): BadgeView {
  if (!value) return UNSET;
  return table[value] ?? { text: value.replace(/_/g, " ").toLowerCase(), tone: "neutral" };
}

const LICENCE_STATUS: Record<string, BadgeView> = {
  DRAFT: { text: "Draft", tone: "neutral" },
  PAYMENT_PENDING: { text: "Payment pending", tone: "amber" },
  PAYMENT_CONFIRMED: { text: "Payment confirmed", tone: "blue" },
  READY_TO_GENERATE: { text: "Ready to issue", tone: "blue" },
  KEY_GENERATED: { text: "Key generated", tone: "blue" },
  ISSUED: { text: "Issued", tone: "violet" },
  ACTIVE: { text: "Active", tone: "green" },
  EXPIRED: { text: "Expired", tone: "neutral" },
  SUSPENDED: { text: "Suspended", tone: "amber" },
  REVOKED: { text: "Revoked", tone: "red" },
};

/**
 * Payment, where `null` gets its own row rather than falling into Pending.
 *
 * The server is emphatic about this distinction: `payments` is created PENDING
 * by `POST /serials`, so an absent row means the record was made outside this
 * API. Rendering "No record" as "Pending" would assert that money is owed on a
 * licence whose payment state nobody has ever written down.
 */
const PAYMENT_STATUS: Record<string, BadgeView> = {
  PENDING: { text: "Pending", tone: "amber" },
  PAID: { text: "Paid", tone: "green" },
  PARTIALLY_PAID: { text: "Partially paid", tone: "amber" },
  REFUNDED: { text: "Refunded", tone: "neutral" },
  CANCELLED: { text: "Cancelled", tone: "red" },
};

const PAYMENT_ABSENT: BadgeView = { text: "No record", tone: "neutral" };

const HOST_BINDING: Record<string, BadgeView> = {
  NOT_BOUND: { text: "Not bound", tone: "neutral" },
  BOUND: { text: "Bound", tone: "blue" },
  REBIND_REQUEST: { text: "Rebind requested", tone: "amber" },
  LOCKED: { text: "Locked", tone: "red" },
};

const STAFF_STATUS: Record<string, BadgeView> = {
  INVITED: { text: "Invited", tone: "neutral" },
  EMAIL_VERIFIED: { text: "Email verified", tone: "blue" },
  ACTIVE: { text: "Active", tone: "green" },
  SUSPENDED: { text: "Suspended", tone: "amber" },
  REVOKED: { text: "Revoked", tone: "red" },
};

const DELIVERY: Record<string, BadgeView> = {
  SENT: { text: "Sent", tone: "green" },
  FAILED: { text: "Failed", tone: "red" },
};

const CUSTOMER_KIND: Record<string, BadgeView> = {
  SINGLE: { text: "Single", tone: "neutral" },
  BULK: { text: "Bulk", tone: "violet" },
};

export const licenceStatusTone = (value: string): BadgeView => resolve(value, LICENCE_STATUS);
export const paymentTone = (value: string | null): BadgeView =>
  value === null ? PAYMENT_ABSENT : resolve(value, PAYMENT_STATUS);
export const hostBindingTone = (value: string): BadgeView => resolve(value, HOST_BINDING);
export const staffStatusTone = (value: string): BadgeView => resolve(value, STAFF_STATUS);
export const deliveryTone = (value: string): BadgeView => resolve(value, DELIVERY);
export const customerKindTone = (value: string): BadgeView => resolve(value, CUSTOMER_KIND);

/** Licence status shown when the delivery column has failed - never colour only. */
export function deliveryBadge(emailError: string | null, emailedAt: string | null): BadgeView {
  if (emailError) return DELIVERY.FAILED;
  if (emailedAt) return DELIVERY.SENT;
  return { text: "Not sent", tone: "neutral" };
}

/**
 * §63's rule, isolated: Generate Key is GREEN **iff payment is PAID**.
 *
 * Deliberately not a function of licence status. `READY_TO_GENERATE` does imply
 * PAID today - `confirm-payment` walks PAYMENT_PENDING -> PAYMENT_CONFIRMED ->
 * READY_TO_GENERATE in one transaction - but keying the colour off status
 * would encode an *implication* where the spec states a fact. If the state
 * machine ever gains a path that reaches READY_TO_GENERATE without money, the
 * colour follows the money, because that is what the operator is being told.
 *
 * The Super Admin waiver is why `null` and `PENDING` must both return false:
 * the waiver never writes `payments.status = 'PAID'`, so a waived Generate Key
 * is enabled without being green. Green is a statement about money, and the
 * waiver does not make any.
 */
export function generateKeyIsReady(paymentStatus: string | null): boolean {
  return paymentStatus === "PAID";
}

/** Expiry, for the registry's Expiry column and the Expiring Soon KPI. */
export function expiryTone(validityEndsAt: string | null, now = new Date()): BadgeView | null {
  if (!validityEndsAt) return null;
  const ends = new Date(validityEndsAt);
  if (Number.isNaN(ends.getTime())) return null;
  const days = (ends.getTime() - now.getTime()) / 86_400_000;
  if (days < 0) return { text: "Expired", tone: "neutral" };
  if (days <= 30) return { text: "Expiring soon", tone: "red" };
  if (days <= 90) return { text: "Expiring", tone: "amber" };
  return { text: "Valid", tone: "green" };
}
