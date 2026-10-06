/**
 * §28 / §66's ROW ACTION ZONE - ELEVEN ACTIONS, SPLIT TWO WAYS.
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
 * `enabled === (reason === null)`, asserted for all eleven actions across all
 * ten licence states and all four roles in `actions.test.ts`. A decision
 * cannot come back disabled-and-silent, because the shape that would allow it
 * is not constructible from this module.
 *
 * WHERE EACH GROUP LIVES
 * ----------------------
 * §28 draws the row with `[ ISSUE LICENCE ]  [ REVOKE ]` visible at the end of
 * it, and says the three-dot menu carries nine *secondary* entries. §7.2
 * removes "Generate" from both: Path 6B provisions inside `POST /issue`, so
 * there is no separate key step left for an operator to reach for.
 *
 *   MENU_ACTION_IDS  - the nine in the three-dot menu, in §28's order
 *   ZONE_ACTION_IDS  - the visible pair
 *
 * One `rowActions` call produces all eleven, so the menu, the zone and the
 * drawer read the same answers and cannot disagree about whether something is
 * enabled.
 *
 * WHY A MIRROR RATHER THAN "TRY IT AND SEE"
 * -----------------------------------------
 * Firing all eleven writes to discover which are legal would perform the ones
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

/**
 * §28's three-dot menu - exactly nine, in §28's own order.
 *
 * Issue and Revoke are absent on purpose: §25 and §66 put them at the end of
 * the row where they are visible without opening anything, which is the whole
 * point of §28's "visible end-of-row" instruction.
 */
export const MENU_ACTION_IDS = [
  "view",
  "edit",
  "confirmPayment",
  "resend",
  "viewActivation",
  "viewAudit",
  "suspend",
  "requestRebind",
  "exportRecord",
] as const;

/**
 * §25/§66/§82's visible end-of-row controls.
 *
 * Two, not one: §66's closing sentence is "The UI should not show an impossible
 * operation as enabled", so Revoke is drawn beside Issue on every issuable row
 * even where it has nothing to act on, and arrives disabled with its reason
 * rather than hidden.
 */
export const ZONE_ACTION_IDS = ["approveIssue", "revoke"] as const;

/**
 * All eleven: menu first, then the zone.
 *
 * Order matters - `rowActions` emits in this order, and RowMenu filters to
 * `MENU_ACTION_IDS` while preserving it, so §28's sequence survives the split.
 */
export const ROW_ACTION_IDS = [...MENU_ACTION_IDS, ...ZONE_ACTION_IDS] as const;

export type RowActionId = (typeof ROW_ACTION_IDS)[number];

export interface RowActionDecision {
  id: RowActionId;
  label: string;
  permission: Permission;
  /** True only when BOTH gates pass. */
  enabled: boolean;
  /** The sentence shown in the disabled entry's tooltip. Null iff `enabled`. */
  reason: string | null;
  /** §20's GREEN - about payment, not about enablement. */
  ready: boolean;
  /** Actions that must prompt for a reason before dispatching (§26, §53). */
  needsReason: boolean;
  /** Styled destructive, and always confirmed before dispatch. */
  danger: boolean;
}

export interface RowActionContext {
  role: StaffRole | null;
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

/**
 * The states from which `POST /issue` can start, and therefore the states in
 * which §66 draws a row as offering `[ ISSUE LICENCE ]`.
 *
 * `KEY_GENERATED` is included even though no screen ever stops there any more:
 * Path 6B provisions inside the transaction, but a row a previous version keyed
 * still has to be issuable, and the KEY_GENERATED -> ISSUED edge carries no
 * payment precondition of its own - by the time a row is in it, payment was
 * settled or the record would never have got there.
 */
const PRE_ISSUE = new Set(["DRAFT", "PAYMENT_PENDING", "PAYMENT_CONFIRMED", "READY_TO_GENERATE", "KEY_GENERATED"]);

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

  /*
   * §66's visible control, and §20's green.
   *
   * Path 6B collapsed "Generate Key" and "Approve & Issue" into this one
   * action: `POST /issue` provisions and issues inside a single transaction,
   * so there is no intermediate the operator has to step through and no
   * separate key button left to offer (§7.2: "Generate" is not the admin's
   * primary action; §68: the admin never generates key material).
   *
   * The primary stays **disabled** on an unpaid row rather than becoming an
   * alternate route around §20 - §66 is explicit that payment-pending shows
   * `[ ISSUE LICENCE ]` grey. There is no second entry beside it: an unpaid
   * row is disabled and says so, and the fix is Confirm Payment, not a
   * different flavour of Issue.
   */
  approveIssue: {
    label: "Issue Licence",
    permission: "licence:issue",
    stateReason: (row) => {
      // Path 6B provisions in the same transaction, so a legacy-keyed row has
      // nothing left to provision and the edge has no payment precondition of
      // its own - payment was settled before it got here.
      if (row.status === "KEY_GENERATED") return null;
      if (row.status === "READY_TO_GENERATE") {
        return row.paymentStatus === "PAID"
          ? null
          : "Payment is not recorded as PAID, so Issue Licence stays disabled.";
      }
      if (PRE_ISSUE.has(row.status)) {
        return `Payment has not been confirmed yet, so this licence is ${label(row.status)} and cannot be issued.`;
      }
      return notIn(row, ["Ready to issue"]);
    },
    /*
     * §20's GREEN is a statement about money, not about enablement - see
     * `tone.ts`. The renderer combines the two: green only when the action is
     * *both* enabled and `ready`.
     */
    ready: (row) => row.paymentStatus === "PAID",
    needsReason: () => false,
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
 * Decide all eleven actions for one row.
 *
 * The result is always exactly eleven entries in `ROW_ACTION_IDS` order - the
 * menu never grows a branch of its own, and a row never renders a different
 * number of entries depending on its state. Hiding the impossible ones would be
 * quieter and worse: an operator would have no way to learn that Suspend exists
 * before the licence reaches Issued.
 *
 * "Eleven" is the whole row, not the menu: §28 keeps the three-dot list at
 * nine and moves Issue and Revoke to the visible zone.
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

/**
 * Just the nine §28 puts in the three-dot menu, preserving order.
 *
 * Filtering rather than re-deciding: the zone and the menu are views over one
 * list, so a row cannot be issuable from the menu and refused at the end of the
 * same row. `RowMenu` applies this to the row's decisions; the drawer and the
 * zone take the full list.
 */
export function menuOnly(actions: readonly RowActionDecision[]): RowActionDecision[] {
  const menu = new Set<string>(MENU_ACTION_IDS);
  return actions.filter((action) => menu.has(action.id));
}
