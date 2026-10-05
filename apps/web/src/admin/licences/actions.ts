/**
 * §14's ROW ACTION MENU - TWELVE ACTIONS, DECIDED IN ONE PLACE.
 * =============================================================
 *
 * "Never show an action that cannot currently be performed unless it is
 * intentionally displayed as disabled with an explanation."  That is two
 * obligations, and most implementations only keep the first:
 *
 *   (a) disabled when it cannot be performed
 *   (b) with an explanation
 *
 * (b) is enforced by the type: `reason: string | null` with the invariant
 * `enabled === (reason === null)`, asserted for all twelve actions across all
 * ten licence states and all four roles in `actions.test.ts`. A decision
 * cannot come back disabled-and-silent, because the shape that would allow it
 * is not constructible from this module.
 *
 * WHY A MIRROR RATHER THAN "TRY IT AND SEE"
 * -----------------------------------------
 * Firing all twelve writes to discover which are legal would perform the ones
 * that are. The alternative - asking the server - is what the server already
 * does; this module exists only to *withhold an affordance*, and it is allowed
 * to be wrong only in the direction of showing something as disabled that the
 * server would in fact have accepted. It never grants: every dispatch still
 * lands on `requirePermission` and the state machine, in that order, server-side.
 *
 * ORDER OF GATES
 * --------------
 * Permission first, then state. Both are reasons a row menu entry is dead, but
 * they are different sentences: telling an AUDITOR "payment has not been
 * confirmed" about Confirm Payment implies that confirming it would then work,
 * which for an auditor it would not. Role is fixed for the session and state
 * changes by the minute, so the thing the reader cannot act on at all is named
 * first.
 */
import { can, explainRoleRefusal, type Permission, type StaffRole } from "../permissions";
import type { LicenceListItem } from "../types";

export const ROW_ACTION_IDS = [
  "view",
  "edit",
  "confirmPayment",
  "generateKey",
  "approveIssue",
  "resend",
  "viewActivation",
  "viewAudit",
  "suspend",
  "revoke",
  "requestRebind",
  "exportRecord",
] as const;

export type RowActionId = (typeof ROW_ACTION_IDS)[number];

export interface RowActionDecision {
  id: RowActionId;
  label: string;
  permission: Permission;
  /** True only when BOTH gates pass. */
  enabled: boolean;
  /** The sentence shown in the disabled entry's tooltip. Null iff `enabled`. */
  reason: string | null;
  /** §63's GREEN - about payment, not about enablement. */
  ready: boolean;
  /** Actions that must prompt for a §37 reason before dispatching. */
  needsReason: boolean;
  /** Styled destructive, and always confirmed before dispatch. */
  danger: boolean;
}

export interface RowActionContext {
  role: StaffRole | null;
  isSuperAdmin: boolean;
}

/**
 * The four fields a decision actually reads.
 *
 * Widened from `LicenceListItem` so the drawer can ask the same question about
 * a `LicenceRecord`, which carries the full key and therefore cannot *be* a
 * list item without also being able to leak into a table cell. Restricting the
 * parameter to the fields used is what keeps the two projections separate: a
 * drawer row can never satisfy `LicenceListItem` by accident, and this function
 * cannot reach for a field neither shape was asked about.
 */
export type ActionableLicence = Pick<
  LicenceListItem,
  "status" | "paymentStatus" | "hostBindingStatus" | "devicesBound"
>;

interface ActionSpec {
  label: string;
  permission: Permission;
  /**
   * Returns null when the state permits the action, or the exact sentence to
   * show when it does not. Evaluated ONLY after the permission gate passes, so
   * every branch here may assume the role holds the permission.
   */
  stateReason(row: ActionableLicence, ctx: RowActionContext): string | null;
  ready?(row: ActionableLicence, ctx: RowActionContext): boolean;
  needsReason?(row: ActionableLicence, ctx: RowActionContext): boolean;
  danger?: boolean;
}

/** Matches `FROZEN_AFTER_ISSUE` in the PATCH route. */
const FROZEN_AFTER_ISSUE = new Set([
  "ISSUED",
  "ACTIVE",
  "EXPIRED",
  "SUSPENDED",
  "REVOKED",
]);

/** Matches `RESENDABLE` in the resend route. */
const RESENDABLE = new Set(["ISSUED", "ACTIVE"]);

const SUSPENDABLE = new Set(["ISSUED", "ACTIVE"]);
const REVOCABLE = new Set(["ISSUED", "ACTIVE", "SUSPENDED"]);

/** Human labels, so a sentence reads like a sentence and not like a column. */
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PAYMENT_PENDING: "Payment pending",
  PAYMENT_CONFIRMED: "Payment confirmed",
  READY_TO_GENERATE: "Ready to issue",
  KEY_GENERATED: "Key generated",
  ISSUED: "Issued",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  SUSPENDED: "Suspended",
  REVOKED: "Revoked",
};

function label(status: string): string {
  return STATUS_LABEL[status] ?? status.replace(/_/g, " ").toLowerCase();
}

/** One sentence naming both what is wrong and what would make it right. */
function notIn(row: ActionableLicence, allowed: readonly string[]): string {
  const names = allowed.map(label).join(" or ");
  return `This licence is ${label(row.status)}; it can only be done while it is ${names}.`;
}

const SPECS: Record<RowActionId, ActionSpec> = {
  view: {
    label: "View",
    permission: "serial:read",
    stateReason: () => null,
  },

  edit: {
    label: "Edit",
    permission: "serial:update",
    stateReason: (row) =>
      FROZEN_AFTER_ISSUE.has(row.status)
        ? `Customer details are frozen once a licence reaches ${label(row.status)}.`
        : null,
  },

  confirmPayment: {
    label: "Confirm Payment",
    permission: "payment:confirm",
    stateReason: (row) => {
      if (row.status !== "PAYMENT_PENDING") return notIn(row, ["Payment pending"]);
      return null;
    },
  },

  generateKey: {
    label: "Generate Key",
    permission: "key:generate",
    stateReason: (row, ctx) => {
      // §49's waived edge: PAYMENT_PENDING -> KEY_GENERATED, Super Admin alone.
      if (ctx.isSuperAdmin && row.status === "PAYMENT_PENDING") return null;
      if (row.status !== "READY_TO_GENERATE") return notIn(row, ["Ready to issue"]);
      return null;
    },
    // §63: GREEN iff PAID, and never green on a waiver - see `tone.ts`.
    ready: (row) => row.paymentStatus === "PAID",
    needsReason: (row, ctx) => ctx.isSuperAdmin && row.status === "PAYMENT_PENDING",
  },

  approveIssue: {
    label: "Approve & Issue",
    permission: "licence:issue",
    stateReason: (row) => {
      if (row.status === "KEY_GENERATED") return null;
      if (row.status === "DRAFT" || row.status === "PAYMENT_PENDING") {
        return `The licence key does not exist yet; generate it first. This record is ${label(row.status)}.`;
      }
      if (row.status === "PAYMENT_CONFIRMED" || row.status === "READY_TO_GENERATE") {
        return `The licence key does not exist yet; generate it first.`;
      }
      return notIn(row, ["Key generated"]);
    },
  },

  resend: {
    label: "Resend Licence",
    permission: "licence:issue",
    stateReason: (row) => (RESENDABLE.has(row.status) ? null : notIn(row, ["Issued", "Active"])),
  },

  viewActivation: {
    label: "View Activation",
    permission: "serial:read",
    stateReason: (row) =>
      row.devicesBound > 0
        ? null
        : "This licence has never been activated, so there is no activation record to show.",
  },

  viewAudit: {
    label: "View Audit",
    permission: "audit:read",
    stateReason: () => null,
  },

  suspend: {
    label: "Suspend",
    permission: "licence:suspend",
    stateReason: (row) => (SUSPENDABLE.has(row.status) ? null : notIn(row, ["Issued", "Active"])),
    needsReason: () => true,
    danger: true,
  },

  revoke: {
    label: "Revoke",
    permission: "licence:revoke",
    stateReason: (row) =>
      REVOCABLE.has(row.status) ? null : notIn(row, ["Issued", "Active", "Suspended"]),
    needsReason: () => true,
    danger: true,
  },

  requestRebind: {
    label: "Request Rebind",
    permission: "rebind:request",
    stateReason: (row) => {
      // Mirror `transitionHostBinding`'s refusals, including the LOCKED branch
      // it checks *after* the table - "no binding" and "locked" send the
      // operator to different places, so the two must not share a sentence.
      if (row.hostBindingStatus === "BOUND") return null;
      if (row.hostBindingStatus === "REBIND_REQUEST") return null;
      if (row.hostBindingStatus === "LOCKED") {
        return "This licence's host binding is locked. Unlock it before requesting a rebind.";
      }
      return "This licence has never been bound to a host, so there is nothing to rebind.";
    },
    needsReason: () => false,
  },

  exportRecord: {
    label: "Export Record",
    permission: "report:export",
    stateReason: () => null,
  },
};

/**
 * Decide all twelve actions for one row.
 *
 * The result is always exactly twelve entries in `ROW_ACTION_IDS` order - the
 * menu never grows a branch of its own, and a row never renders a different
 * number of items depending on its state. Hiding the impossible ones would be
 * quieter and worse: an operator would have no way to learn that Suspend exists
 * before the licence reaches Issued.
 */
export function rowActions(row: ActionableLicence, ctx: RowActionContext): RowActionDecision[] {
  return ROW_ACTION_IDS.map((id) => {
    const spec = SPECS[id];
    const roleRefusal = can(ctx.role, spec.permission)
      ? null
      : explainRoleRefusal(ctx.role, spec.permission);
    const stateRefusal = roleRefusal === null ? spec.stateReason(row, ctx) : null;
    const reason = roleRefusal ?? stateRefusal;

    return {
      id,
      label: spec.label,
      permission: spec.permission,
      enabled: reason === null,
      reason,
      ready: spec.ready?.(row, ctx) ?? false,
      needsReason: spec.needsReason?.(row, ctx) ?? false,
      danger: spec.danger ?? false,
    };
  });
}

/** One action by id. For the drawer, which renders the same decisions. */
export function rowAction(
  row: ActionableLicence,
  ctx: RowActionContext,
  id: RowActionId,
): RowActionDecision {
  const found = rowActions(row, ctx).find((action) => action.id === id);
  if (!found) throw new Error(`unknown row action: ${id}`);
  return found;
}
