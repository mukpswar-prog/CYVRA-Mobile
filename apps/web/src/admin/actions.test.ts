/**
 * §14'S ENABLEMENT MATRIX - ELEVEN ACTIONS x TEN STATES x FOUR ROLES.
 * ===================================================================
 *
 * The brief's rule: *impossible actions disabled, WITH explanation.* Both
 * halves are asserted here, and the second is asserted structurally rather
 * than by spot-checking a sentence, because the failure mode of a disabled
 * button with no reason is invisible in a screenshot review - it just looks
 * like a slightly dull menu.
 *
 * `enabled === (reason === null)` is therefore walked over all 440
 * combinations. That single invariant is what makes (b) unavoidable: a
 * decision cannot come back disabled-and-silent, because the only way to get
 * `enabled: false` is `reason: string`.
 *
 * The gate order - permission first, then state - is asserted directly: an
 * AUDITOR looking at Confirm Payment on a PAYMENT_PENDING row must be told
 * about the role, not about the payment. Role is fixed for the session and
 * state changes by the minute; naming the state would imply that confirming
 * the payment is what unlocks it, which for an auditor is false.
 */
import { describe, expect, it } from "vitest";
import {
  MENU_ACTION_IDS,
  ROW_ACTION_IDS,
  ZONE_ACTION_IDS,
  menuOnly,
  rowAction,
  rowActions,
  type ActionableLicence,
  type RowActionContext,
} from "./licences/actions";
import { PERMISSIONS, STAFF_ROLES, type Permission, type StaffRole } from "./permissions";
import type { LicenceStatus, PaymentStatus } from "./types";

const ALL_STATUSES: readonly LicenceStatus[] = [
  "DRAFT",
  "PAYMENT_PENDING",
  "PAYMENT_CONFIRMED",
  "READY_TO_GENERATE",
  "KEY_GENERATED",
  "ISSUED",
  "ACTIVE",
  "EXPIRED",
  "SUSPENDED",
  "REVOKED",
];

function row(overrides: Partial<ActionableLicence> = {}): ActionableLicence {
  return {
    status: "PAYMENT_PENDING",
    paymentStatus: "PENDING",
    hostBindingStatus: "NOT_BOUND",
    devicesBound: 0,
    ...overrides,
  };
}

function ctx(role: StaffRole | null): RowActionContext {
  return { role };
}

describe("the menu is the same shape on every row", () => {
  it("always returns all eleven actions, in ROW_ACTION_IDS order", () => {
    for (const status of ALL_STATUSES) {
      for (const role of STAFF_ROLES) {
        const decisions = rowActions(row({ status }), ctx(role));
        expect(decisions.map((decision) => decision.id)).toEqual([...ROW_ACTION_IDS]);
        expect(decisions).toHaveLength(11);
      }
    }
  });

  it("never hides an entry - impossible ones are present and disabled", () => {
    const decisions = rowActions(row({ status: "DRAFT" }), ctx("LICENCE_ADMIN"));
    const suspended = decisions.find((decision) => decision.id === "suspend");
    expect(suspended).toBeDefined();
    expect(suspended?.enabled).toBe(false);
    expect(suspended?.reason).toBeTruthy();
  });
});

describe("§28 splits the row into a nine-item menu and a visible zone", () => {
  it("keeps exactly §28's nine in the three-dot menu, in its order", () => {
    expect([...MENU_ACTION_IDS]).toEqual([
      "view",
      "edit",
      "confirmPayment",
      "resend",
      "viewActivation",
      "viewAudit",
      "suspend",
      "requestRebind",
      "exportRecord",
    ]);
    expect(MENU_ACTION_IDS).toHaveLength(9);
  });

  it("moves Issue and Revoke out of the menu", () => {
    expect(MENU_ACTION_IDS).not.toContain("approveIssue");
    expect(MENU_ACTION_IDS).not.toContain("revoke");
    // §7.2 retires Generate from the menu entirely - there is no longer a key
    // step for an operator to reach for.
    expect(ROW_ACTION_IDS).not.toContain("generateKey");
  });

  it("returns the nine as a subset of the same decision list, order preserved", () => {
    for (const status of ALL_STATUSES) {
      const all = rowActions(row({ status }), ctx("LICENCE_ADMIN"));
      const menu = menuOnly(all);
      expect(menu.map((d) => d.id)).toEqual([...MENU_ACTION_IDS]);
      // Filtering rather than re-deciding: each menu entry is the *same*
      // object the zone sees, so the two cannot disagree about enablement.
      for (const entry of menu) {
        expect(all).toContainEqual(entry);
      }
      // ...and the two left over are precisely the visible zone.
      expect(all.filter((d) => !menu.includes(d)).map((d) => d.id)).toEqual([
        ...ZONE_ACTION_IDS,
      ]);
      // Zone decisions are still reachable through `rowAction`, which the
      // drawer and the zone both read - they are absent from the *menu* only.
      expect(rowAction(row({ status }), ctx("LICENCE_ADMIN"), "approveIssue")).toBeDefined();
      expect(rowAction(row({ status }), ctx("LICENCE_ADMIN"), "revoke")).toBeDefined();
    }
  });
});

describe("disabled always comes with an explanation", () => {
  for (const status of ALL_STATUSES) {
    for (const role of [...STAFF_ROLES, null]) {
      it(`${role ?? "no role"} / ${status}`, () => {
        const decisions = rowActions(row({ status }), ctx(role));
        for (const decision of decisions) {
          expect(decision.enabled).toBe(decision.reason === null);
          if (!decision.enabled) {
            expect(decision.reason).toBeTruthy();
            expect(decision.reason!.trim().length).toBeGreaterThan(10);
          }
        }
      });
    }
  }
});

describe("LICENCE_ADMIN sees exactly what the state allows", () => {
  it("on an ISSUED, bound, activated licence", () => {
    const decisions = rowActions(
      row({
        status: "ISSUED",
        paymentStatus: "PAID",
        hostBindingStatus: "BOUND",
        devicesBound: 1,
      }),
      ctx("LICENCE_ADMIN"),
    );
    /*
     * Order is `ROW_ACTION_IDS`, which puts the zone's Issue and Revoke
     * *after* the nine menu ids - so Revoke follows Export Record rather than
     * sitting beside Suspend, because Revoke has moved out of the three-dot
     * menu into the visible end-of-row zone (§25/§28).
     */
    expect(decisions.filter((decision) => decision.enabled).map((decision) => decision.id)).toEqual([
      "view",
      "resend",
      "viewActivation",
      "viewAudit",
      "suspend",
      "requestRebind",
      "exportRecord",
      "revoke",
    ]);
  });

  it("on an ACTIVE, never-bound licence with no activation", () => {
    const decisions = rowActions(
      row({
        status: "ACTIVE",
        paymentStatus: "PAID",
        hostBindingStatus: "NOT_BOUND",
        devicesBound: 0,
      }),
      ctx("LICENCE_ADMIN"),
    );
    expect(decisions.filter((decision) => decision.enabled).map((decision) => decision.id)).toEqual([
      "view",
      "resend",
      "viewAudit",
      "suspend",
      "exportRecord",
      "revoke",
    ]);
    expect(rowAction(row({ status: "ACTIVE", hostBindingStatus: "NOT_BOUND", devicesBound: 0 }), ctx("LICENCE_ADMIN"), "requestRebind").reason).toMatch(
      /never been bound/,
    );
  });

  it("refuses rebind while the host is locked, and says why it must be unlocked", () => {
    const decision = rowAction(
      row({ status: "ACTIVE", hostBindingStatus: "LOCKED", devicesBound: 1 }),
      ctx("LICENCE_ADMIN"),
      "requestRebind",
    );
    expect(decision.enabled).toBe(false);
    expect(decision.reason).toMatch(/locked/i);
    expect(decision.reason).toMatch(/unlock/i);
  });

  it("names both the current state and the states that would allow it", () => {
    const decision = rowAction(row({ status: "DRAFT" }), ctx("LICENCE_ADMIN"), "suspend");
    expect(decision.enabled).toBe(false);
    expect(decision.reason).toContain("This licence is Draft");
    // `notIn` renders the allowed states as prose ("issued or active"), so the
    // assertion is on the sentence, not on the enum spelling.
    expect(decision.reason).toContain("issued or active");
  });

  /*
   * The sentence this test used to assert - "the licence key does not exist
   * yet; generate it first" - is the two-button flow, and Path 6B removed it.
   * A paid, ready row now issues in one action, and the refusal that replaces
   * the old one is about *money*, because §20's payment clause is the only
   * condition a frontend can see that the state machine does not already
   * guarantee.
   */
  it("issues a paid, ready row outright - no missing key to point at", () => {
    const paid = rowAction(
      row({ status: "READY_TO_GENERATE", paymentStatus: "PAID" }),
      ctx("LICENCE_ADMIN"),
      "approveIssue",
    );
    expect(paid.enabled).toBe(true);
    expect(paid.reason).toBeNull();
    expect(paid.ready).toBe(true);
  });

  it("keeps Issue Licence disabled when the payment is not PAID, and says so", () => {
    for (const paymentStatus of ["PENDING", "PARTIALLY_PAID", null] as const) {
      const decision = rowAction(
        row({ status: "READY_TO_GENERATE", paymentStatus }),
        ctx("LICENCE_ADMIN"),
        "approveIssue",
      );
      expect(decision.enabled).toBe(false);
      expect(decision.reason).toMatch(/payment/i);
      // §14: an explanation must explain *this* record's state, not recite a
      // rule the reader already knows.
      expect(decision.reason!.trim().length).toBeGreaterThan(10);
    }
  });
});

describe("permission is decided before state", () => {
  it("tells an AUDITOR about the role, never about the payment", () => {
    const decision = rowAction(
      row({ status: "PAYMENT_PENDING", paymentStatus: "PENDING" }),
      ctx("AUDITOR"),
      "confirmPayment",
    );
    expect(decision.enabled).toBe(false);
    expect(decision.reason).toContain("auditor");
    expect(decision.reason).toContain("payment:confirm");
    expect(decision.reason).not.toMatch(/this licence is/i);
  });

  it("tells an OPERATOR about the role for Revoke, not about revocability", () => {
    const decision = rowAction(
      row({ status: "REVOKED", paymentStatus: "PAID" }),
      ctx("OPERATOR"),
      "revoke",
    );
    expect(decision.enabled).toBe(false);
    expect(decision.reason).toContain("licence:revoke");
    expect(decision.reason).not.toMatch(/this licence is/i);
  });

  it("holds every state-changing action for an AUDITOR", () => {
    const writable: readonly Permission[] = [
      "serial:update",
      "payment:confirm",
      "key:generate",
      "licence:issue",
      "licence:suspend",
      "licence:revoke",
      "rebind:request",
    ];
    const decisions = rowActions(
      row({
        status: "ISSUED",
        paymentStatus: "PAID",
        hostBindingStatus: "BOUND",
        devicesBound: 1,
      }),
      ctx("AUDITOR"),
    );
    for (const decision of decisions) {
      if (!writable.includes(decision.permission)) continue;
      expect(decision.enabled).toBe(false);
      expect(decision.reason).toContain(decision.permission);
    }
  });

  it("keeps everything closed for a session with no role", () => {
    const decisions = rowActions(
      row({ status: "ISSUED", paymentStatus: "PAID", hostBindingStatus: "BOUND", devicesBound: 1 }),
      ctx(null),
    );
    expect(decisions.filter((decision) => decision.enabled).map((d) => d.id)).toEqual([]);
  });

  it("gives nobody a way past an unconfirmed payment", () => {
    // The waiver that briefly existed was cut before commit (WS-H1 sign-off
    // item 2), so `licence:issue` now grants exactly one thing: the ordinary
    // §20 path, which the state machine still refuses on its own terms.
    const unpaid = row({ status: "PAYMENT_PENDING", paymentStatus: "PENDING" });
    for (const role of STAFF_ROLES) {
      expect(rowAction(unpaid, ctx(role), "approveIssue").enabled).toBe(false);
    }
    // Only once the *permission* gate passes is the payment clause what stands
    // in the way - the file's gate-order rule means a role that does not hold
    // `licence:issue` must be told about the seat instead.
    for (const role of ["SUPER_ADMIN", "LICENCE_ADMIN"] as const) {
      expect(rowAction(unpaid, ctx(role), "approveIssue").reason).toMatch(/payment/i);
    }
  });
});

describe("GREEN is PAID, never \"ready\"", () => {
  it("is green exactly when paymentStatus is PAID", () => {
    const statuses: readonly (PaymentStatus | null)[] = [
      "PAID",
      "PENDING",
      "PARTIALLY_PAID",
      "REFUNDED",
      "CANCELLED",
      null,
    ];
    for (const paymentStatus of statuses) {
      const ready = rowAction(
        row({ status: "READY_TO_GENERATE", paymentStatus }),
        ctx("LICENCE_ADMIN"),
        "approveIssue",
      ).ready;
      expect({ paymentStatus, ready }).toEqual({ paymentStatus, ready: paymentStatus === "PAID" });
    }
  });

  it("marks no other action green", () => {
    const decisions = rowActions(
      row({ status: "ISSUED", paymentStatus: "PAID" }),
      ctx("SUPER_ADMIN"),
    );
    // `approveIssue` is green on an ISSUED row because `ready` is a statement
    // about money alone - the renderer combines it with `enabled`, and on this
    // state the button is not offered at all (§66 swaps in [ VIEW ]).
    expect(decisions.filter((decision) => decision.ready).map((d) => d.id)).toEqual(["approveIssue"]);
  });
});

describe("the reason-prompting and destructive flags", () => {
  it("requires a reason for suspend and revoke", () => {
    const decisions = rowActions(row({ status: "ISSUED", paymentStatus: "PAID" }), ctx("SUPER_ADMIN"));
    expect(decisions.filter((decision) => decision.needsReason).map((d) => d.id)).toEqual([
      "suspend",
      "revoke",
    ]);
  });

  it("marks exactly suspend and revoke as destructive", () => {
    const decisions = rowActions(row({ status: "ISSUED", paymentStatus: "PAID" }), ctx("SUPER_ADMIN"));
    expect(decisions.filter((decision) => decision.danger).map((d) => d.id)).toEqual([
      "suspend",
      "revoke",
    ]);
  });

  it("exposes every permission it names as a real §49 permission", () => {
    for (const id of ROW_ACTION_IDS) {
      const decision = rowAction(row({ status: "DRAFT" }), ctx("SUPER_ADMIN"), id);
      expect(PERMISSIONS).toContain(decision.permission);
    }
  });
});
