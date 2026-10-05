/**
 * W5 PHASE 1 - ROLE-BASED ACCESS CONTROL
 * =======================================
 *
 * Two halves, deliberately separated:
 *
 *   1. THE MATRIX IS TRANSCRIBED HERE, independently of `PERMISSION_MATRIX`.
 *      If the expected value were read out of the module under test, the suite
 *      could only prove the file agreed with itself. This is the second copy,
 *      typed from design plan §41 by hand, and a disagreement is the point.
 *
 *   2. THE ROUTES ARE EXERCISED, not just `can()`. `can()` answering correctly
 *      proves nothing about whether a handler actually calls a gate - the
 *      defect Phase 1 exists to remove is precisely a route that had a check
 *      and did not use it, or used a check that let the browser decide.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LIMITED_AUDIT_ROLES,
  PERMISSIONS,
  PERMISSION_MATRIX,
  SERVICE_READ_ONLY_PERMISSIONS,
  STAFF_ROLES,
  can,
  permissionsFor,
  requirePermission,
  requireRole,
} from "../src/admin/rbac.ts";
import {
  STAFF_TOKEN,
  licenceRow,
  mountAdmin,
  signingEnv,
  staffHarness,
} from "./helpers/adminHarness.ts";

/**
 * Design plan §41, transcribed by hand.
 *
 * `payment:confirm` is `false` for OPERATOR: §41 marks that cell `*` and says
 * the footnote may go either way, and the operator of this repository ruled for
 * the "safest initial deployment" reading. The row below therefore records the
 * *ruling*, not the ambiguous footnote - which is why it is written out rather
 * than derived.
 *
 * `staff:manage` / `plan:manage` / `settings:manage` are SUPER_ADMIN alone:
 * §41 lists no second role on those three rows, so the `*` footnote about
 * delegation is not exercised here.
 */
const SECTION_41: Record<
  string,
  { SUPER_ADMIN: boolean; LICENCE_ADMIN: boolean; OPERATOR: boolean; AUDITOR: boolean }
> = {
  "serial:read": { SUPER_ADMIN: true, LICENCE_ADMIN: true, OPERATOR: true, AUDITOR: true },
  "serial:create": { SUPER_ADMIN: true, LICENCE_ADMIN: true, OPERATOR: true, AUDITOR: false },
  "serial:update": { SUPER_ADMIN: true, LICENCE_ADMIN: true, OPERATOR: true, AUDITOR: false },
  "payment:confirm": { SUPER_ADMIN: true, LICENCE_ADMIN: true, OPERATOR: false, AUDITOR: false },
  "key:generate": { SUPER_ADMIN: true, LICENCE_ADMIN: true, OPERATOR: false, AUDITOR: false },
  "licence:issue": { SUPER_ADMIN: true, LICENCE_ADMIN: true, OPERATOR: false, AUDITOR: false },
  "licence:suspend": { SUPER_ADMIN: true, LICENCE_ADMIN: true, OPERATOR: false, AUDITOR: false },
  "licence:revoke": { SUPER_ADMIN: true, LICENCE_ADMIN: true, OPERATOR: false, AUDITOR: false },
  "rebind:request": { SUPER_ADMIN: true, LICENCE_ADMIN: true, OPERATOR: true, AUDITOR: false },
  "rebind:approve": { SUPER_ADMIN: true, LICENCE_ADMIN: true, OPERATOR: false, AUDITOR: false },
  "report:export": { SUPER_ADMIN: true, LICENCE_ADMIN: true, OPERATOR: true, AUDITOR: true },
  "audit:read": { SUPER_ADMIN: true, LICENCE_ADMIN: true, OPERATOR: true, AUDITOR: true },
  "staff:manage": { SUPER_ADMIN: true, LICENCE_ADMIN: false, OPERATOR: false, AUDITOR: false },
  "plan:manage": { SUPER_ADMIN: true, LICENCE_ADMIN: false, OPERATOR: false, AUDITOR: false },
  "settings:manage": { SUPER_ADMIN: true, LICENCE_ADMIN: false, OPERATOR: false, AUDITOR: false },
};

const ROLE_KEYS = ["SUPER_ADMIN", "LICENCE_ADMIN", "OPERATOR", "AUDITOR"] as const;

/**
 * Every value `staff_role_enum` can hold.
 *
 * `SYSTEM` is in the enum and is not a §41 row - it has no permission cells
 * because it is not a person, it is the actor recorded when the software itself
 * performs an event (see `src/bridge.ts`). Keeping it out of `ROLE_KEYS` keeps
 * the §41 matrix test about §41; keeping it *in* this list keeps the enum test
 * about the enum. Both are true, and one list cannot say both.
 */
const DATABASE_ROLE_KEYS = [...ROLE_KEYS, "SYSTEM"] as const;

function principal(role: string) {
  return { kind: "staff" as const, email: "x@cyvoriq.com", role, actorId: null };
}

describe("§41 permission matrix", () => {
  it("has exactly one permission per §41 row, and one row per permission", () => {
    assert.equal(PERMISSIONS.length, 15);
    assert.deepEqual([...PERMISSIONS].sort(), Object.keys(SECTION_41).sort());
    assert.equal(Object.keys(PERMISSION_MATRIX).length, 15);
  });

  it("lists every role the database can hold, so nothing is unnameable", () => {
    assert.deepEqual([...STAFF_ROLES].sort(), [...DATABASE_ROLE_KEYS].sort());
  });

  it("grants SYSTEM nothing - it is an audit actor, not an account", () => {
    assert.deepEqual([...permissionsFor("SYSTEM")], []);
    for (const permission of PERMISSIONS) {
      assert.equal(can(principal("SYSTEM"), permission), false, permission);
    }
  });

  it("answers all 60 cells the way §41 does", () => {
    let checked = 0;
    for (const permission of PERMISSIONS) {
      for (const role of ROLE_KEYS) {
        const expected = SECTION_41[permission][role];
        assert.equal(
          can(principal(role), permission),
          expected,
          `${role} / ${permission} should be ${expected}`,
        );
        checked++;
      }
    }
    assert.equal(checked, 60);
  });

  it("grants SUPER_ADMIN all fifteen - the row §41 marks in full", () => {
    assert.equal(permissionsFor("SUPER_ADMIN").length, 15);
    assert.deepEqual([...permissionsFor("SUPER_ADMIN")].sort(), [...PERMISSIONS].sort());
  });

  it("grants LICENCE_ADMIN twelve, losing only the three admin rows", () => {
    const granted = permissionsFor("LICENCE_ADMIN");
    assert.equal(granted.length, 12);
    for (const forbidden of ["staff:manage", "plan:manage", "settings:manage"]) {
      assert.equal(granted.includes(forbidden as never), false, forbidden);
    }
  });

  it("grants OPERATOR six, and none of them is a financial or issuance act", () => {
    const granted = permissionsFor("OPERATOR");
    assert.deepEqual([...granted].sort(), [
      "audit:read",
      "rebind:request",
      "report:export",
      "serial:create",
      "serial:read",
      "serial:update",
    ]);
  });

  it("grants AUDITOR exactly the three reads - no write at all", () => {
    assert.deepEqual([...permissionsFor("AUDITOR")].sort(), [
      "audit:read",
      "report:export",
      "serial:read",
    ]);
    for (const permission of PERMISSIONS) {
      if (SECTION_41[permission].AUDITOR) continue;
      assert.equal(can(principal("AUDITOR"), permission), false, permission);
    }
  });

  it("THE RULING: OPERATOR cannot confirm payment, issue, or key", () => {
    for (const forbidden of ["payment:confirm", "licence:issue", "key:generate"]) {
      assert.equal(can(principal("OPERATOR"), forbidden as never), false, forbidden);
    }
    assert.equal(can(principal("OPERATOR"), "payment:confirm"), false);
  });

  it("keeps §41's LIMITED audit cell declared, on operators alone", () => {
    assert.deepEqual([...LIMITED_AUDIT_ROLES], ["OPERATOR"]);
    // `audit:read` itself is granted to operators; "LIMITED" is a *scope*
    // restriction on which rows they see, not a denial of the permission.
    assert.equal(can(principal("OPERATOR"), "audit:read"), true);
  });

  it("restricts the service credential to reads, with no write among them", () => {
    assert.deepEqual([...SERVICE_READ_ONLY_PERMISSIONS].sort(), [
      "audit:read",
      "report:export",
      "serial:read",
    ]);
    const service = { kind: "service" as const, email: null, actorId: null };
    for (const permission of PERMISSIONS) {
      assert.equal(
        can(service, permission),
        SERVICE_READ_ONLY_PERMISSIONS.has(permission),
        permission,
      );
    }
  });
});

describe("gate construction fails loudly on a typo", () => {
  it("rejects an unknown permission before any request is made", () => {
    assert.throws(
      () => requirePermission("licence:issu" as never),
      /Unknown permission "licence:issu"/,
    );
    assert.throws(() => requirePermission(), /needs at least one permission/);
  });

  it("rejects an unknown or empty role set", () => {
    assert.throws(() => requireRole("ROOT" as never), /is not one of/);
    assert.throws(() => requireRole(), /at least one role/);
  });
});

/* -------------------------------------------------------------------------
 * ROUTE LEVEL
 * ---------------------------------------------------------------------- */

const SERIAL_ID = "11111111-1111-4111-8111-111111111111";

function harnessFor(email: string, role: string) {
  return staffHarness(email, role, { licence: licenceRow({ status: "KEY_GENERATED" }) });
}

async function readJson(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

describe("route gates - the matrix is actually consulted", () => {
  it("refuses an unauthenticated caller with 401, not 403", async () => {
    const { request } = mountAdmin(harnessFor("ops@cyvoriq.com", "OPERATOR"));
    const res = await request(`/serials/${SERIAL_ID}/issue`, { method: "POST" });
    assert.equal(res.status, 401);
    const body = await readJson(res);
    assert.match(String(body.error), /required|Admin token/i);
  });

  it("OPERATOR is refused on issue, payment confirmation and revoke", async () => {
    const { request } = mountAdmin(harnessFor("ops@cyvoriq.com", "OPERATOR"));

    const issue = await request(`/serials/${SERIAL_ID}/issue`, { method: "POST", token: STAFF_TOKEN });
    assert.equal(issue.status, 403);
    assert.equal((await readJson(issue)).error, "OPERATOR cannot licence issue.");

    const confirm = await request(`/serials/${SERIAL_ID}/confirm-payment`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: {},
    });
    assert.equal(confirm.status, 403);
    assert.equal((await readJson(confirm)).error, "OPERATOR cannot payment confirm.");

    const revoke = await request(`/serials/${SERIAL_ID}/revoke`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { reason: "attempted" },
    });
    assert.equal(revoke.status, 403);
    assert.equal((await readJson(revoke)).error, "OPERATOR cannot licence revoke.");
  });

  it("AUDITOR is refused on every write, naming the role it really holds", async () => {
    const { request } = mountAdmin(harnessFor("audit@cyvoriq.com", "AUDITOR"));
    for (const [path, body] of [
      [`/serials/${SERIAL_ID}/issue`, undefined],
      [`/serials/${SERIAL_ID}/generate-key`, undefined],
      [`/serials/${SERIAL_ID}/confirm-payment`, {}],
      [`/serials/${SERIAL_ID}/revoke`, { reason: "attempted" }],
      [`/serials/${SERIAL_ID}/suspend`, { reason: "attempted" }],
      ["/serials", {}],
      ["/staff", { email: "new@cyvoriq.com" }],
    ] as const) {
      const res = await request(path, { method: "POST", token: STAFF_TOKEN, body });
      assert.equal(res.status, 403, `${path} must be refused for AUDITOR`);
      const payload = await readJson(res);
      assert.match(String(payload.error), /^AUDITOR cannot /, path);
    }
  });

  it("allows AUDITOR the reads it does hold", async () => {
    const { request } = mountAdmin(harnessFor("audit@cyvoriq.com", "AUDITOR"));
    const res = await request("/me", { token: STAFF_TOKEN });
    assert.equal(res.status, 200);
    const body = await readJson(res);
    assert.equal(body.email, "audit@cyvoriq.com");
    assert.equal(body.role, "AUDITOR");
  });

  it("names the role from the row, so a licence admin can still be told no by staff:manage", async () => {
    const { request } = mountAdmin(harnessFor("licadmin@cyvoriq.com", "LICENCE_ADMIN"));
    const res = await request("/staff", { method: "POST", token: STAFF_TOKEN, body: {} });
    assert.equal(res.status, 403);
    assert.equal((await readJson(res)).error, "LICENCE_ADMIN cannot staff manage.");
  });

  it("treats a revoked operator as unauthenticated, even holding a live token", async () => {
    const harness = staffHarness("gone@cyvoriq.com", "LICENCE_ADMIN");
    (harness.state.operator as { status: string }).status = "REVOKED";
    // `ADMIN_API_TOKEN` is configured so the fall-through after the session
    // lookup fails is the ordinary "that bearer is not the admin token" 401,
    // rather than the "no admin token is configured" 503. Either way the point
    // is the same and this pins it precisely: the row exists, the session
    // exists, and the request still carries no identity.
    const { request } = mountAdmin(harness, { ADMIN_API_TOKEN: "automation-secret" });
    const res = await request("/me", { token: STAFF_TOKEN });
    assert.equal(res.status, 401);
    assert.equal((await readJson(res)).email, undefined);
  });

  it("treats an expired session as unauthenticated", async () => {
    const harness = staffHarness("ops@cyvoriq.com", "OPERATOR");
    harness.state.session!.expiresAt = new Date(Date.now() - 1);
    const { request } = mountAdmin(harness, { ADMIN_API_TOKEN: "automation-secret" });
    const res = await request("/me", { token: STAFF_TOKEN });
    assert.equal(res.status, 401);
    assert.equal((await readJson(res)).email, undefined);
  });
});

describe("the admin token is read-only", () => {
  const env = { ADMIN_API_TOKEN: "automation-secret" };

  it("reaches reads, and reports no person behind the credential", async () => {
    const { request } = mountAdmin(harnessFor("ops@cyvoriq.com", "OPERATOR"), env);
    const res = await request("/me", { token: "automation-secret" });
    assert.equal(res.status, 200);
    const body = await readJson(res);
    assert.equal(body.email, null);
    assert.equal(body.role, null);
    assert.equal(body.superAdmin, false);
  });

  it("is refused every state change, including ones a SUPER_ADMIN may perform", async () => {
    const { request } = mountAdmin(harnessFor("ceo@cyvoriq.com", "SUPER_ADMIN"), env);
    for (const path of [
      `/serials/${SERIAL_ID}/issue`,
      `/serials/${SERIAL_ID}/generate-key`,
      `/serials/${SERIAL_ID}/confirm-payment`,
      `/serials/${SERIAL_ID}/revoke`,
      `/serials/${SERIAL_ID}/suspend`,
      "/serials",
      "/staff",
    ]) {
      const res = await request(path, { method: "POST", token: "automation-secret", body: {} });
      assert.equal(res.status, 403, path);
      assert.match(String((await readJson(res)).error), /staff session|read-only/i, path);
    }
  });

  it("cannot assume a role through requireRole", async () => {
    const { request } = mountAdmin(harnessFor("ceo@cyvoriq.com", "SUPER_ADMIN"), env);
    const res = await request("/staff", { method: "POST", token: "automation-secret", body: {} });
    assert.equal(res.status, 403);
    assert.match(String((await readJson(res)).error), /staff session/);
  });

  it("is rejected outright when the bearer does not match", async () => {
    const { request } = mountAdmin(harnessFor("ceo@cyvoriq.com", "SUPER_ADMIN"), env);
    const res = await request("/me", { token: "wrong" });
    assert.equal(res.status, 401);
  });

  it("answers 503 rather than 401 when the token is not configured at all", async () => {
    const { request } = mountAdmin(harnessFor("ceo@cyvoriq.com", "SUPER_ADMIN"));
    const res = await request("/me", { token: "anything" });
    assert.equal(res.status, 503);
    assert.match(String((await readJson(res)).error), /not configured/);
  });
});

/**
 * The Green Key Rule, stated as a status code.
 *
 * §8 renders it as a button colour. A colour is a claim the browser makes
 * about itself, so this asserts the server's answer to the same question - and
 * it does so with a *staff session that is allowed to generate keys*, so the
 * only thing that can be refusing is the payment.
 */
describe("Green Key Rule - 403 when the payment is not PAID", () => {
  for (const status of ["PENDING", "PARTIALLY_PAID", "REFUNDED", "CANCELLED"]) {
    it(`refuses generate-key while payments.status = ${status}`, async () => {
      const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
        licence: licenceRow({ status: "READY_TO_GENERATE" }),
        payment: {
          id: "22222222-2222-4222-8222-222222222222",
          licenceId: SERIAL_ID,
          status,
          amount: null,
          currency: "INR",
          reference: null,
          confirmedBy: null,
          confirmedAt: null,
          notes: null,
        },
      });
      const { request } = mountAdmin(harness, signingEnv());
      const res = await request(`/serials/${SERIAL_ID}/generate-key`, {
        method: "POST",
        token: STAFF_TOKEN,
      });
      assert.equal(res.status, 403, `payment=${status}`);
      const body = await readJson(res);
      assert.match(String(body.error), /payment|PAID/i);
      // Refused, so nothing was allocated and no audit row was written.
      assert.equal(harness.writes.length, 0);
    });
  }

  it("refuses generate-key when the licence has no payments row at all", async () => {
    const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
      licence: licenceRow({ status: "READY_TO_GENERATE" }),
      payment: null,
    });
    const { request } = mountAdmin(harness, signingEnv());
    const res = await request(`/serials/${SERIAL_ID}/generate-key`, {
      method: "POST",
      token: STAFF_TOKEN,
    });
    assert.equal(res.status, 403);
    assert.equal(harness.writes.length, 0);
  });
});
