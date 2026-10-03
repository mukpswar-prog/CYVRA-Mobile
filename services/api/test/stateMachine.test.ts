import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { licenceStatusEnum } from "@cyvra/database/schema";
import {
  ADMIN_EDGES,
  LICENCE_EDGES,
  LICENCE_STATES,
  SYSTEM_EDGES,
  allowedTargets,
  edgeFor,
  failureHttpStatus,
  failureMessage,
  transition,
  type LicenceStatus,
  type TransitionContext,
} from "../src/admin/state-machine.ts";

/**
 * DESIGN PLAN §49, TRANSCRIBED HERE BY HAND.
 *
 * Deliberately re-typed from the document rather than imported from the module
 * under test. If the expected value came from `LICENCE_EDGES` the suite could
 * only ever prove the file agreed with itself, and a mis-transcription in
 * `state-machine.ts` would be *confirmed* rather than caught. This is the
 * second, independent copy, and a disagreement between the two is the whole
 * point of having both.
 *
 *   §49 lists 14 transitions. `PAYMENT_PENDING -> CANCELLED` is absent here
 *   because decision A2 places `CANCELLED` exclusively in `payment_status_enum`
 *   and the operator ruled: cancellation is expressed on the payment only; the
 *   licence stays `PAYMENT_PENDING`. That leaves 13 edges and invents no 14th.
 */
const PLAN_49: ReadonlyArray<readonly [LicenceStatus, LicenceStatus, "admin" | "system"]> = [
  ["DRAFT", "PAYMENT_PENDING", "admin"],
  ["PAYMENT_PENDING", "PAYMENT_CONFIRMED", "admin"],
  ["PAYMENT_CONFIRMED", "READY_TO_GENERATE", "admin"],
  ["READY_TO_GENERATE", "KEY_GENERATED", "admin"],
  ["KEY_GENERATED", "ISSUED", "admin"],
  // The host workstation activates on first use (plan §7); no admin route may claim it.
  ["ISSUED", "ACTIVE", "system"],
  ["ISSUED", "SUSPENDED", "admin"],
  ["ISSUED", "REVOKED", "admin"],
  ["ACTIVE", "SUSPENDED", "admin"],
  // The passage of time past `validity_ends_at` (plan §36).
  ["ACTIVE", "EXPIRED", "system"],
  ["ACTIVE", "REVOKED", "admin"],
  ["SUSPENDED", "ACTIVE", "admin"],
  ["SUSPENDED", "REVOKED", "admin"],
];

/**
 * A context in which *every* precondition is satisfied, so that the matrix
 * measures the map and nothing else. If a legal edge were refused here the
 * cause would be a precondition, and preconditions get their own tests below.
 */
const SATISFIED: TransitionContext = {
  actorKind: "admin",
  paymentStatus: "PAID",
  keyPresent: true,
  reason: "exhaustive matrix",
};

describe("§49 licence state machine - the map itself", () => {
  it("holds exactly the 10 states of licence_status_enum", () => {
    assert.equal(LICENCE_STATES.length, 10);
    assert.deepEqual(
      [...LICENCE_STATES].sort(),
      [...licenceStatusEnum.enumValues].sort(),
    );
  });

  it("declares exactly the 13 §49 edges - no missing edge, no invented one", () => {
    assert.equal(LICENCE_EDGES.length, 13);
    const got = LICENCE_EDGES.map((e) => `${e.from}->${e.to}:${e.cls}`).sort();
    const want = PLAN_49.map(([f, t, c]) => `${f}->${t}:${c}`).sort();
    assert.deepEqual(got, want);
  });

  it("never mentions CANCELLED (decision A2: it lives on payments only)", () => {
    for (const edge of LICENCE_EDGES) {
      assert.notEqual(edge.from, "CANCELLED");
      assert.notEqual(edge.to, "CANCELLED");
    }
    assert.equal(
      (LICENCE_STATES as readonly string[]).includes("CANCELLED"),
      false,
    );
  });

  it("flags exactly the two system-only edges, both unreachable from admin", () => {
    assert.equal(SYSTEM_EDGES.length, 2);
    assert.deepEqual(
      SYSTEM_EDGES.map((e) => `${e.from}->${e.to}`).sort(),
      ["ACTIVE->EXPIRED", "ISSUED->ACTIVE"],
    );
    assert.equal(ADMIN_EDGES.length, 11);
    for (const edge of SYSTEM_EDGES) assert.equal(edge.cls, "system");
  });

  it("gives every state except the two terminal ones an outgoing edge", () => {
    const terminal = LICENCE_STATES.filter(
      (state) => allowedTargets(state, "system").length === 0,
    );
    assert.deepEqual([...terminal].sort(), ["EXPIRED", "REVOKED"]);
  });

  it("looks up a single edge, and returns undefined for anything absent", () => {
    assert.equal(edgeFor("DRAFT", "PAYMENT_PENDING")?.cls, "admin");
    assert.equal(edgeFor("DRAFT", "ISSUED"), undefined);
    assert.equal(edgeFor("REVOKED", "REVOKED"), undefined);
  });
});

/**
 * THE EXHAUSTIVE 10x10 MATRIX.
 *
 * 100 (from, to) pairs, asserted twice - once as an administrator and once as
 * the system - because the difference between those two answers *is* the
 * system-only rule, and a suite that checked only one would pass even if the
 * flag had been dropped entirely.
 *
 *   as admin:  11 legal edges accepted, 89 refused (2 system-only, 10
 *              self-loops, 77 pairs with no edge at all)
 *   as system: 13 legal edges accepted, 87 refused (10 self-loops, 77
 *              pairs with no edge at all)
 */
describe("§49 exhaustive 10x10 transition matrix", () => {
  const legal = new Map(
    PLAN_49.map(([from, to, cls]) => [`${from}->${to}`, cls]),
  );

  it("answers all 100 cells as an administrator", () => {
    let accepted = 0;
    let systemOnly = 0;
    let selfLoop = 0;
    let unknown = 0;

    for (const from of LICENCE_STATES) {
      for (const to of LICENCE_STATES) {
        const cell = `${from}->${to}`;
        const result = transition(from, to, SATISFIED);

        if (legal.get(cell) === "admin") {
          assert.equal(result.ok, true, `${cell} must be accepted for an admin`);
          accepted++;
          continue;
        }

        assert.equal(result.ok, false, `${cell} must be refused for an admin`);
        if (result.ok) continue;
        assert.equal(result.error.kind, "ForbiddenTransition");
        if (result.error.kind !== "ForbiddenTransition") continue;

        if (from === to) {
          assert.equal(result.error.reason, "self-transition", cell);
          selfLoop++;
        } else if (legal.get(cell) === "system") {
          assert.equal(result.error.reason, "system-only", cell);
          systemOnly++;
        } else {
          assert.equal(result.error.reason, "unknown-edge", cell);
          unknown++;
        }
        // Every refusal names what *would* have worked.
        assert.deepEqual(
          [...result.error.allowed].sort(),
          [...allowedTargets(from, "admin")].sort(),
          cell,
        );
      }
    }

    assert.equal(accepted, 11);
    assert.equal(systemOnly, 2);
    assert.equal(selfLoop, 10);
    assert.equal(unknown, 77);
    assert.equal(accepted + systemOnly + selfLoop + unknown, 100);
  });

  it("answers all 100 cells as the system, unlocking only the 2 system edges", () => {
    let accepted = 0;
    let selfLoop = 0;
    let unknown = 0;

    for (const from of LICENCE_STATES) {
      for (const to of LICENCE_STATES) {
        const cell = `${from}->${to}`;
        const result = transition(from, to, { ...SATISFIED, actorKind: "system" });

        if (legal.has(cell)) {
          assert.equal(result.ok, true, `${cell} must be accepted for the system`);
          accepted++;
          continue;
        }

        assert.equal(result.ok, false, `${cell} must be refused for the system`);
        if (result.ok) continue;
        assert.equal(result.error.kind, "ForbiddenTransition");
        if (result.error.kind !== "ForbiddenTransition") continue;
        if (from === to) {
          assert.equal(result.error.reason, "self-transition", cell);
          selfLoop++;
        } else {
          assert.equal(result.error.reason, "unknown-edge", cell);
          unknown++;
        }
        // The system is never told an edge is system-only: it is the system.
        assert.notEqual(result.error.reason, "system-only");
      }
    }

    assert.equal(accepted, 13);
    assert.equal(selfLoop, 10);
    assert.equal(unknown, 77);
    assert.equal(accepted + selfLoop + unknown, 100);
  });

  it("refuses every one of the 10 self-loops, whatever the context", () => {
    for (const state of LICENCE_STATES) {
      for (const actorKind of ["admin", "system"] as const) {
        const result = transition(state, state, { ...SATISFIED, actorKind });
        assert.equal(result.ok, false, `${state}->${state}`);
        if (result.ok) continue;
        assert.equal(result.error.kind, "ForbiddenTransition");
        if (result.error.kind !== "ForbiddenTransition") continue;
        assert.equal(result.error.reason, "self-transition");
      }
    }
  });
});

describe("§49 preconditions", () => {
  it("applies the Green Key Rule: KEY_GENERATED needs PAID, else 403", () => {
    for (const bad of ["PENDING", "PARTIALLY_PAID", "REFUNDED", "CANCELLED"] as const) {
      const result = transition("READY_TO_GENERATE", "KEY_GENERATED", {
        ...SATISFIED,
        paymentStatus: bad,
      });
      assert.equal(result.ok, false, `payment=${bad}`);
      if (result.ok) continue;
      assert.equal(result.error.kind, "PaymentNotPaid");
      if (result.error.kind !== "PaymentNotPaid") continue;
      assert.equal(result.error.actual, bad);
      // Contractual: 403, not 409 - see `failureHttpStatus`.
      assert.equal(failureHttpStatus(result.error), 403);
    }
  });

  it("treats a missing payment row as not-PAID, not as permission granted", () => {
    for (const paymentStatus of [null, undefined]) {
      const result = transition("READY_TO_GENERATE", "KEY_GENERATED", {
        ...SATISFIED,
        paymentStatus,
      });
      assert.equal(result.ok, false);
      if (result.ok) continue;
      assert.equal(result.error.kind, "PaymentNotPaid");
      if (result.error.kind !== "PaymentNotPaid") continue;
      assert.equal(result.error.actual, null);
    }
  });

  it("requires PAID for the whole payment stretch (A3)", () => {
    for (const [from, to] of [
      ["PAYMENT_PENDING", "PAYMENT_CONFIRMED"],
      ["PAYMENT_CONFIRMED", "READY_TO_GENERATE"],
      ["READY_TO_GENERATE", "KEY_GENERATED"],
    ] as const) {
      const result = transition(from, to, { ...SATISFIED, paymentStatus: "PENDING" });
      assert.equal(result.ok, false, `${from}->${to}`);
      if (result.ok) continue;
      assert.equal(result.error.kind, "PaymentNotPaid");
    }
  });

  it("cannot be bought: a PAID payment never makes a forbidden edge legal", () => {
    assert.equal(transition("DRAFT", "ISSUED", SATISFIED).ok, false);
    assert.equal(transition("REVOKED", "ACTIVE", SATISFIED).ok, false);
    assert.equal(transition("PAYMENT_PENDING", "KEY_GENERATED", SATISFIED).ok, false);
    // Even the destination being reachable in general is not enough.
    assert.equal(transition("DRAFT", "PAYMENT_CONFIRMED", SATISFIED).ok, false);
  });

  it("requires a key for KEY_GENERATED -> ISSUED, and refuses loudly without one", () => {
    const result = transition("KEY_GENERATED", "ISSUED", {
      ...SATISFIED,
      keyPresent: false,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.kind, "KeyMissing");
    // A record that reached KEY_GENERATED with no key is an invariant break the
    // operator cannot fix by clicking again -> 503, not a retryable 409.
    assert.equal(failureHttpStatus(result.error), 503);
    assert.equal(
      transition("KEY_GENERATED", "ISSUED", { ...SATISFIED, keyPresent: true }).ok,
      true,
    );
  });

  it("requires a §37 reason for suspend and revoke, and only those", () => {
    const requiresReason = PLAN_49.filter(
      ([, to]) => to === "REVOKED" || to === "SUSPENDED",
    );
    for (const [from, to, cls] of requiresReason) {
      for (const reason of ["", "   ", null, undefined]) {
        const result = transition(from, to, { ...SATISFIED, actorKind: cls, reason });
        assert.equal(result.ok, false, `${from}->${to} reason=${String(reason)}`);
        if (result.ok) continue;
        assert.equal(result.error.kind, "ReasonRequired");
        if (result.error.kind !== "ReasonRequired") continue;
        assert.equal(failureHttpStatus(result.error), 400);
      }
      assert.equal(
        transition(from, to, { ...SATISFIED, actorKind: cls, reason: "unpaid invoice" }).ok,
        true,
        `${from}->${to} with a reason must pass`,
      );
    }

    /*
     * Every other edge must ignore the reason entirely. Each edge is evaluated
     * as the actor class that owns it: a system edge tested with an admin
     * actor would refuse with `system-only`, which says nothing about whether a
     * reason is required - and mistaking one for the other is how a precondition
     * gets quietly deleted.
     */
    const ignoresReason = PLAN_49.filter(
      ([, to]) => to !== "REVOKED" && to !== "SUSPENDED",
    );
    for (const [from, to, cls] of ignoresReason) {
      const result = transition(from, to, { ...SATISFIED, actorKind: cls, reason: null });
      assert.equal(result.ok, true, `${from}->${to} must not need a reason`);
    }
  });

  it("keeps SUSPENDED -> ACTIVE legal, so a stop can be lifted", () => {
    assert.equal(transition("SUSPENDED", "ACTIVE", { ...SATISFIED, reason: null }).ok, true);
  });
});

describe("refusal status codes", () => {
  it("maps each failure kind to the status the contract specifies", () => {
    const payment = transition("READY_TO_GENERATE", "KEY_GENERATED", {
      ...SATISFIED,
      paymentStatus: "PENDING",
    });
    assert.equal(payment.ok, false);
    if (!payment.ok) assert.equal(failureHttpStatus(payment.error), 403);

    const system = transition("ISSUED", "ACTIVE", SATISFIED);
    assert.equal(system.ok, false);
    if (!system.ok) assert.equal(failureHttpStatus(system.error), 403);

    const missing = transition("KEY_GENERATED", "ISSUED", {
      ...SATISFIED,
      keyPresent: false,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(failureHttpStatus(missing.error), 503);

    const reason = transition("ACTIVE", "REVOKED", { ...SATISFIED, reason: "" });
    assert.equal(reason.ok, false);
    if (!reason.ok) assert.equal(failureHttpStatus(reason.error), 400);

    const unknown = transition("DRAFT", "ISSUED", SATISFIED);
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(failureHttpStatus(unknown.error), 409);
  });

  it("produces an operator-facing sentence for every failure kind", () => {
    const cases = [
      transition("READY_TO_GENERATE", "KEY_GENERATED", { ...SATISFIED, paymentStatus: "PENDING" }),
      transition("ISSUED", "ACTIVE", SATISFIED),
      transition("KEY_GENERATED", "ISSUED", { ...SATISFIED, keyPresent: false }),
      transition("ACTIVE", "REVOKED", { ...SATISFIED, reason: "" }),
      transition("DRAFT", "ISSUED", SATISFIED),
      transition("REVOKED", "REVOKED", SATISFIED),
    ];
    for (const result of cases) {
      assert.equal(result.ok, false);
      if (result.ok) continue;
      const message = failureMessage(result.error);
      assert.ok(message.length > 0);
      assert.ok(!message.includes("undefined"));
      // The message is built only from states and statuses, never a credential.
      assert.ok(!/CYVRA[A-Z0-9]/.test(message), message);
    }
  });

  it("names the reachable states when an edge simply does not exist", () => {
    const result = transition("ISSUED", "KEY_GENERATED", SATISFIED);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const message = failureMessage(result.error);
    assert.match(message, /ISSUED/);
    assert.match(message, /KEY_GENERATED/);
    assert.match(message, /ACTIVE|SUSPENDED|REVOKED/);
  });
});
