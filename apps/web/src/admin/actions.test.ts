/**
 * §14'S ENABLEMENT MATRIX - TWELVE ACTIONS x TEN STATES x FOUR ROLES.
 * ===================================================================
 *
 * The brief's rule: *impossible actions disabled, WITH explanation.* Both
 * halves are asserted here, and the second is asserted structurally rather
 * than by spot-checking a sentence, because the failure mode of a disabled
 * button with no reason is invisible in a screenshot review - it just looks
 * like a slightly dull menu.
 *
 * `enabled === (reason === null)` is therefore walked over all 480
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
  ROW_ACTION_IDS,
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

function ctx(role: StaffRole | null, isSuperAdmin = role === "SUPER_ADMIN"): RowActionContext {
  return { role, isSuperAdmin };
}

describe("the menu is the same shape on every row", () => {
  it("always returns all twelve actions, in ROW_ACTION_IDS order", () => {
    for (const status of ALL_STATUSES) {
      for (const role of STAFF_ROLES) {
        const decisions = rowActions(row({ status }), ctx(role));
        expect(decisions.map((decision) => decision.id)).toEqual([...ROW_ACTION_IDS]);
        expect(decisions).toHaveLength(12);
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

describe("disabled always comes with an explanation", () => {
  for (const status of ALL_STATUSES) {
    for (const role of [...STAFF_ROLES, null]) {
      for (const isSuperAdmin of [false, true]) {
        it(`${role ?? "no role"} / ${status} / super=${isSuperAdmin}`, () => {
          const decisions = rowActions(row({ status }), ctx(role, isSuperAdmin));
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
    expect(decisions.filter((decision) => decision.enabled).map((decision) => decision.id)).toEqual([
      "view",
      "resend",
      "viewActivation",
      "viewAudit",
      "suspend",
      "revoke",
      "requestRebind",
      "exportRecord",
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
      "revoke",
      "exportRecord",
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

  it("says the key does not exist yet rather than \"not allowed\" for issue", () => {
    const decision = rowAction(row({ status: "READY_TO_GENERATE" }), ctx("LICENCE_ADMIN"), "approveIssue");
    expect(decision.enabled).toBe(false);
    expect(decision.reason).toMatch(/generate it first/i);
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
      ctx(null, false),
    );
    expect(decisions.filter((decision) => decision.enabled).map((d) => d.id)).toEqual([]);
  });

  it("gives SUPER_ADMIN the waived Generate Key nobody else has", () => {
    const pending = row({ status: "PAYMENT_PENDING", paymentStatus: "PENDING" });
    expect(rowAction(pending, ctx("SUPER_ADMIN"), "generateKey").enabled).toBe(true);
    expect(rowAction(pending, ctx("LICENCE_ADMIN"), "generateKey").enabled).toBe(false);
    // The waiver is not available to a super-admin role without the flag.
    expect(rowAction(pending, ctx("SUPER_ADMIN", false), "generateKey").enabled).toBe(false);
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
        "generateKey",
      ).ready;
      expect({ paymentStatus, ready }).toEqual({ paymentStatus, ready: paymentStatus === "PAID" });
    }
  });

  it("is not green on a waived key, even though the action itself is available", () => {
    const decision = rowAction(
      row({ status: "PAYMENT_PENDING", paymentStatus: "PENDING" }),
      ctx("SUPER_ADMIN"),
      "generateKey",
    );
    expect(decision.enabled).toBe(true);
    expect(decision.ready).toBe(false);
    expect(decision.needsReason).toBe(true);
  });

  it("marks no other action green", () => {
    const decisions = rowActions(
      row({ status: "ISSUED", paymentStatus: "PAID" }),
      ctx("SUPER_ADMIN"),
    );
    expect(decisions.filter((decision) => decision.ready).map((d) => d.id)).toEqual(["generateKey"]);
  });
});

describe("the reason-prompting and destructive flags", () => {
  it("requires a §37 reason for suspend and revoke only", () => {
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

  it("exposes every permission it names as a real §41 permission", () => {
    for (const id of ROW_ACTION_IDS) {
      const decision = rowAction(row({ status: "DRAFT" }), ctx("SUPER_ADMIN"), id);
      expect(PERMISSIONS).toContain(decision.permission);
    }
  });
});
