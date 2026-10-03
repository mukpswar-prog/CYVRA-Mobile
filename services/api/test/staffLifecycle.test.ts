import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sha256Hex } from "../src/crypto.ts";
import {
  STAFF_TOKEN,
  mountAdmin,
  operatorRow,
  staffHarness,
  superAdminHarness,
} from "./helpers/adminHarness.ts";

/**
 * W5 PHASE 2 - THE STAFF LIFECYCLE (design plan §18).
 *
 *   invite     POST /staff                -> INVITED        by Super Admin
 *   verify     POST /auth/request+verify  -> EMAIL_VERIFIED  by the invitee
 *   approve    POST /staff/:id/approve    -> ACTIVE          by Super Admin
 *   suspend    POST /staff/:id/suspend    -> SUSPENDED       by Super Admin
 *   revoke     POST /staff/:id/revoke     -> REVOKED         by Super Admin
 *
 * Ruling R3 split nomination from activation, which means `POST /staff` can no
 * longer hand back a working session: an invitee has no session, cannot mint
 * one, and confers nothing on themselves. The tests below follow one address
 * through the whole chain, because the chain is the thing - a suite that
 * tested each step against a fresh fixture could not catch a step that only
 * works when it is first.
 *
 * Ruling R2 chose the existing `audit_action_enum` values over a migration, so
 * `verify` writes `STAFF_INVITED` and `approve` writes `STAFF_ROLE_CHANGED`.
 * What carries the transition is `previous_state` / `new_state`, and those are
 * asserted here rather than the action name, which by design says less.
 */

const CHALLENGE_ID = "55555555-5555-4555-8555-555555555555";
const ALICE_ID = "44444444-4444-4444-8444-444444444444";

interface Recorded {
  table: string;
  kind: string;
  inTransaction: boolean;
  values: Record<string, unknown>;
}

function auditWrites(writes: readonly Recorded[]): Recorded[] {
  return writes.filter((w) => w.table === "audit_events");
}

function operatorWrites(writes: readonly Recorded[]): Recorded[] {
  return writes.filter((w) => w.table === "staff_operators");
}

/**
 * Body reads are cached per response.
 *
 * `Response.json()` can only be consumed once, and these tests routinely want
 * the payload twice: once as the failure message of `assert.equal(res.status, …)`
 * and once for the assertions themselves. Without the cache the second read
 * throws "Body has already been read" - a defect in the test that would mask
 * the assertion that actually matters.
 */
const BODIES = new WeakMap<Response, Promise<Record<string, unknown>>>();

function readJson(res: Response): Promise<Record<string, unknown>> {
  let cached = BODIES.get(res);
  if (!cached) {
    cached = res.json() as Promise<Record<string, unknown>>;
    BODIES.set(res, cached);
  }
  return cached;
}

/** An un-consumed challenge for `email`, valid for another ten minutes. */
async function challengeFor(email: string, code = "123456") {
  return {
    id: CHALLENGE_ID,
    email,
    codeHash: await sha256Hex(code),
    attempts: 0,
    expiresAt: new Date(Date.now() + 600_000),
    consumedAt: null,
  };
}

describe("POST /staff - invitation, not activation", () => {
  const invite = (overrides: Record<string, unknown> = {}) =>
    superAdminHarness(overrides);

  it("creates the row at INVITED, chooses the role, and audits the invitation", async () => {
    const harness = invite();
    const { request } = mountAdmin(harness);
    const res = await request("/staff", {
      method: "POST",
      token: STAFF_TOKEN,
      body: { email: "alice@cyvoriq.com", role: "OPERATOR" },
    });
    assert.equal(res.status, 201, JSON.stringify(await readJson(res)));
    const body = await readJson(res);

    const operator = body.operator as Record<string, unknown>;
    assert.equal(operator.status, "INVITED", "nominating must not activate");
    assert.equal(operator.role, "OPERATOR");
    assert.equal(operator.nominatedBy, "ceo@cyvoriq.com");

    const invitation = body.invitation as Record<string, unknown>;
    assert.equal(typeof invitation.challengeId, "string");
    assert.ok(invitation.devCode, "preview returns the code so the invite can be completed");

    const audit = auditWrites(harness.writes);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].values.action, "STAFF_INVITED");
    assert.equal(audit[0].inTransaction, true);
    assert.deepEqual(audit[0].values.previousState, { status: null, role: null });
    assert.deepEqual(audit[0].values.newState, {
      status: "INVITED",
      role: "OPERATOR",
      nominatedBy: "ceo@cyvoriq.com",
    });

    // The OTP challenge is written, but it is not an auditable business event.
    assert.equal(
      harness.writes.filter((w) => w.table === "staff_otp_challenges").length,
      1,
    );
  });

  it("defaults the role to OPERATOR rather than to whatever the browser sent", async () => {
    const harness = invite();
    const { request } = mountAdmin(harness);
    const res = await request("/staff", {
      method: "POST",
      token: STAFF_TOKEN,
      body: { email: "alice@cyvoriq.com" },
    });
    assert.equal(res.status, 201);
    assert.equal(
      ((await readJson(res)).operator as Record<string, unknown>).role,
      "OPERATOR",
    );
  });

  it("rejects a role outside staff_role_enum, naming the four legal values", async () => {
    const harness = invite();
    const { request } = mountAdmin(harness);
    const res = await request("/staff", {
      method: "POST",
      token: STAFF_TOKEN,
      body: { email: "alice@cyvoriq.com", role: "WIZARD" },
    });
    assert.equal(res.status, 400);
    const error = String((await readJson(res)).error);
    assert.match(error, /WIZARD/);
    assert.match(error, /SUPER_ADMIN/);
    assert.match(error, /AUDITOR/);
    assert.equal(harness.state.operator, null, "nothing was written");
    assert.equal(harness.writes.length, 0);
  });

  it("refuses a non-@cyvoriq.com address and the super admin's own address", async () => {
    for (const email of ["alice@example.com", "ceo@cyvoriq.com"]) {
      const harness = invite();
      const { request } = mountAdmin(harness);
      const res = await request("/staff", {
        method: "POST",
        token: STAFF_TOKEN,
        body: { email },
      });
      assert.equal(res.status, 400, email);
      assert.equal(harness.writes.length, 0, email);
    }
  });

  it("refuses every role that does not hold staff:manage, writing nothing", async () => {
    // §41 grants "Manage staff" to SUPER_ADMIN alone. The `role` body field is
    // therefore reachable only from the one seat that hands roles out - which
    // is the whole justification for accepting it from a body at all.
    for (const [email, role] of [
      ["licadmin@cyvoriq.com", "LICENCE_ADMIN"],
      ["operator@cyvoriq.com", "OPERATOR"],
      ["audit@cyvoriq.com", "AUDITOR"],
    ] as const) {
      // `staffHarness` puts the session and the acting row on the same record,
      // which is how `lookupStaffSession` resolves a non-super-admin identity:
      // session email -> `staff_operators.email`. Permission is refused before
      // the target row is ever read.
      const harness = staffHarness(email, role);
      const { request } = mountAdmin(harness);
      const res = await request("/staff", {
        method: "POST",
        token: STAFF_TOKEN,
        body: { email: "newbie@cyvoriq.com", role: "SUPER_ADMIN" },
      });
      assert.equal(res.status, 403, role);
      assert.match(String((await readJson(res)).error), new RegExp(`^${role} cannot `));
      assert.equal(operatorWrites(harness.writes).length, 0, role);
      assert.equal(auditWrites(harness.writes).length, 0, role);
    }
  });

  it("replays an already-ACTIVE nomination instead of writing it twice", async () => {
    const harness = invite({ operator: operatorRow({ status: "ACTIVE" }) });
    const { request } = mountAdmin(harness);
    const res = await request("/staff", {
      method: "POST",
      token: STAFF_TOKEN,
      body: { email: "alice@cyvoriq.com", role: "OPERATOR" },
    });
    assert.equal(res.status, 200);
    assert.equal((await readJson(res)).replayed, true);
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("refuses SUSPENDED and REVOKED rather than laundering them into an invite", async () => {
    for (const status of ["SUSPENDED", "REVOKED"] as const) {
      const harness = invite({ operator: operatorRow({ status }) });
      const { request } = mountAdmin(harness);
      const res = await request("/staff", {
        method: "POST",
        token: STAFF_TOKEN,
        body: { email: "alice@cyvoriq.com" },
      });
      assert.equal(res.status, 409, status);
      const body = await readJson(res);
      assert.equal(body.status, status);
      assert.match(String(body.error), new RegExp(status === "SUSPENDED" ? /suspended/ : /revoked/));
      assert.equal(operatorWrites(harness.writes).length, 0, status);
      assert.equal(auditWrites(harness.writes).length, 0, status);
    }
  });

  it("refuses an EMAIL_VERIFIED row, whose next step is approval", async () => {
    const harness = invite({ operator: operatorRow({ status: "EMAIL_VERIFIED" }) });
    const { request } = mountAdmin(harness);
    const res = await request("/staff", {
      method: "POST",
      token: STAFF_TOKEN,
      body: { email: "alice@cyvoriq.com" },
    });
    assert.equal(res.status, 409);
    assert.match(String((await readJson(res)).error), /already verified/);
    assert.equal(operatorWrites(harness.writes).length, 0);
  });

  it("issues a fresh code for an outstanding invitation, changing no status", async () => {
    const harness = invite({ operator: operatorRow({ status: "INVITED" }) });
    const { request } = mountAdmin(harness);
    const res = await request("/staff", {
      method: "POST",
      token: STAFF_TOKEN,
      body: { email: "alice@cyvoriq.com", role: "OPERATOR" },
    });
    assert.equal(res.status, 200);
    const body = await readJson(res);
    assert.equal(body.replayed, false);
    assert.equal(typeof (body.invitation as Record<string, unknown>).challengeId, "string");
    // INVITED -> INVITED is not a transition, so there is nothing to audit; but
    // changing the role underneath a pending invitation would be one, and is
    // refused below.
    assert.equal(auditWrites(harness.writes).length, 0);
    assert.equal(operatorWrites(harness.writes).length, 0);
  });

  it("refuses to change the role of an invitation that is already out", async () => {
    const harness = invite({ operator: operatorRow({ status: "INVITED", role: "OPERATOR" }) });
    const { request } = mountAdmin(harness);
    const res = await request("/staff", {
      method: "POST",
      token: STAFF_TOKEN,
      body: { email: "alice@cyvoriq.com", role: "AUDITOR" },
    });
    assert.equal(res.status, 409);
    assert.match(String((await readJson(res)).error), /OPERATOR/);
    assert.equal(operatorWrites(harness.writes).length, 0);
  });
});

describe("the whole chain: invite, verify, approve", () => {
  it("walks one address from INVITED to ACTIVE with a row at every step", async () => {
    const harness = superAdminHarness();
    const { request } = mountAdmin(harness);

    // 1. INVITE - Super Admin, and the row cannot do anything yet.
    const invited = await request("/staff", {
      method: "POST",
      token: STAFF_TOKEN,
      body: { email: "alice@cyvoriq.com", role: "OPERATOR" },
    });
    assert.equal(invited.status, 201);
    const inviteBody = await readJson(invited);
    assert.equal((inviteBody.operator as Record<string, unknown>).status, "INVITED");
    const code = String(
      (inviteBody.invitation as Record<string, unknown>).devCode,
    );
    assert.match(code, /^\d{6}$/);

    // 2. The invitee asks for the code themselves - the old ACTIVE-only gate
    //    refused this by construction, which would have deadlocked the chain.
    const requested = await request("/auth/request", {
      method: "POST",
      body: { email: "alice@cyvoriq.com" },
    });
    assert.equal(requested.status, 200, JSON.stringify(await readJson(requested)));
    const requestBody = await readJson(requested);
    assert.equal(requestBody.status, "INVITED");
    const challengeId = String(requestBody.challengeId);

    // 3. VERIFY - promoted, audited, and deliberately given no session.
    const verified = await request("/auth/verify", {
      method: "POST",
      body: { challengeId, code: String(requestBody.devCode ?? code) },
    });
    assert.equal(verified.status, 200, JSON.stringify(await readJson(verified)));
    const verifyBody = await readJson(verified);
    assert.equal(verifyBody.token, null, "verification is not sign-in");
    assert.equal(verifyBody.sessionMinted, false);
    assert.equal(harness.state.operator?.status, "EMAIL_VERIFIED");
    assert.equal(harness.state.operator?.emailVerifiedAt != null, true);

    const verifyAudit = auditWrites(harness.writes);
    // Two rows by now: the invitation, then this promotion. The chain is the
    // point, and a chain counted against a fresh fixture could not see a step
    // that only works when it is first.
    assert.equal(verifyAudit.length, 2, "one invite plus one promotion");
    const promotion = verifyAudit[1];
    assert.equal(promotion.values.action, "STAFF_INVITED");
    assert.equal(promotion.inTransaction, true);
    // `audit_events` carries `actor_id` and `actor_role` - it has no email
    // column, and deliberately so: the row points at the `staff_operators`
    // record whose own `email` names the person, so the immutable trail has
    // exactly one place a human identity lives instead of a denormalised copy
    // that can drift away from the row it came from. What the frame proves is
    // that the identity came from the database, and these two columns are where
    // that shows.
    assert.equal(promotion.values.actorId, harness.state.operator?.id);
    assert.equal(promotion.values.actorRole, "OPERATOR");
    assert.deepEqual(promotion.values.previousState, {
      status: "INVITED",
      emailVerifiedAt: null,
    });
    assert.equal(
      (promotion.values.newState as Record<string, unknown>).status,
      "EMAIL_VERIFIED",
    );

    // 4. APPROVE - the only way to ACTIVE.
    const approved = await request(`/staff/${harness.state.operator?.id}/approve`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: {},
    });
    assert.equal(approved.status, 200, JSON.stringify(await readJson(approved)));
    assert.equal((await readJson(approved)).replayed, false);
    assert.equal(harness.state.operator?.status, "ACTIVE");

    const allAudit = auditWrites(harness.writes);
    assert.equal(allAudit.length, 3, "invite, verify and approve - three decisions");
    const approval = allAudit[2];
    assert.equal(approval.values.action, "STAFF_ROLE_CHANGED");
    assert.deepEqual(approval.values.previousState, {
      status: "EMAIL_VERIFIED",
      role: "OPERATOR",
    });
    assert.deepEqual(approval.values.newState, {
      status: "ACTIVE",
      role: "OPERATOR",
      approvedBy: "ceo@cyvoriq.com",
    });
  });
});

describe("POST /auth/request - the OTP gate asks the lifecycle, not the matrix", () => {
  it("lets an INVITED address request the code that proves it owns the address", async () => {
    const harness = superAdminHarness({ operator: operatorRow({ status: "INVITED" }) });
    const { request } = mountAdmin(harness);
    const res = await request("/auth/request", {
      method: "POST",
      body: { email: "alice@cyvoriq.com" },
    });
    assert.equal(res.status, 200, JSON.stringify(await readJson(res)));
    const body = await readJson(res);
    assert.equal(body.status, "INVITED");
    assert.equal(body.delivery, "dev-log");
    assert.ok(body.devCode);
  });

  it("tells a suspended account it is suspended, not that nobody invited it", async () => {
    const harness = superAdminHarness({ operator: operatorRow({ status: "SUSPENDED" }) });
    const { request } = mountAdmin(harness);
    const res = await request("/auth/request", {
      method: "POST",
      body: { email: "alice@cyvoriq.com" },
    });
    assert.equal(res.status, 403);
    assert.match(String((await readJson(res)).error), /suspended/i);
    assert.equal(harness.writes.length, 0, "a refused request issues no code");
  });

  it("tells a revoked account it is revoked, permanently", async () => {
    const harness = superAdminHarness({ operator: operatorRow({ status: "REVOKED" }) });
    const { request } = mountAdmin(harness);
    const res = await request("/auth/request", {
      method: "POST",
      body: { email: "alice@cyvoriq.com" },
    });
    assert.equal(res.status, 403);
    assert.match(String((await readJson(res)).error), /revoked/i);
    assert.equal(harness.writes.length, 0);
  });

  it("refuses an address nobody nominated, and one outside @cyvoriq.com", async () => {
    const harness = superAdminHarness();
    const { request } = mountAdmin(harness);
    const unknown = await request("/auth/request", {
      method: "POST",
      body: { email: "stranger@cyvoriq.com" },
    });
    assert.equal(unknown.status, 403);
    assert.match(String((await readJson(unknown)).error), /not nominated/i);

    const outsider = await request("/auth/request", {
      method: "POST",
      body: { email: "stranger@example.com" },
    });
    assert.equal(outsider.status, 403);
    assert.match(String((await readJson(outsider)).error), /@cyvoriq\.com/);
    assert.equal(harness.writes.length, 0);
  });
});

describe("POST /auth/verify - promotion, session, and what each refuses", () => {
  it("gives an ACTIVE operator a session without writing a business event", async () => {
    const harness = superAdminHarness({ operator: operatorRow({ status: "ACTIVE" }) });
    harness.state.challenge = await challengeFor("alice@cyvoriq.com");
    const { request } = mountAdmin(harness);
    const res = await request("/auth/verify", {
      method: "POST",
      body: { challengeId: CHALLENGE_ID, code: "123456" },
    });
    assert.equal(res.status, 200);
    const body = await readJson(res);
    assert.equal(body.sessionMinted, true);
    assert.equal(typeof body.token, "string");
    assert.equal(body.token !== null, true);
    // Signing in is not a business event: one row per sign-in would bury the
    // trail. The transition it *would* have recorded did not happen.
    assert.equal(auditWrites(harness.writes).length, 0);
    assert.equal(operatorWrites(harness.writes).length, 0);
  });

  it("refuses a suspended address before any challenge is consumed", async () => {
    const harness = superAdminHarness({ operator: operatorRow({ status: "SUSPENDED" }) });
    harness.state.challenge = await challengeFor("alice@cyvoriq.com");
    const { request } = mountAdmin(harness);
    const res = await request("/auth/verify", {
      method: "POST",
      body: { challengeId: CHALLENGE_ID, code: "123456" },
    });
    assert.equal(res.status, 403);
    assert.match(String((await readJson(res)).error), /suspended/i);
    assert.equal(harness.writes.length, 0, "the code is not even consumed");
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("counts a wrong code and refuses it, writing no session", async () => {
    const harness = superAdminHarness({ operator: operatorRow({ status: "ACTIVE" }) });
    harness.state.challenge = await challengeFor("alice@cyvoriq.com");
    const { request } = mountAdmin(harness);
    const res = await request("/auth/verify", {
      method: "POST",
      body: { challengeId: CHALLENGE_ID, code: "999999" },
    });
    assert.equal(res.status, 401);
    assert.equal(harness.state.challenge?.attempts, 1);
    assert.equal(harness.writes.filter((w) => w.table === "staff_sessions").length, 0);
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("refuses a code that has already been used", async () => {
    const harness = superAdminHarness({ operator: operatorRow({ status: "ACTIVE" }) });
    harness.state.challenge = await challengeFor("alice@cyvoriq.com");
    harness.state.challenge.consumedAt = new Date();
    const { request } = mountAdmin(harness);
    const res = await request("/auth/verify", {
      method: "POST",
      body: { challengeId: CHALLENGE_ID, code: "123456" },
    });
    assert.equal(res.status, 401);
    assert.equal(harness.writes.filter((w) => w.table === "staff_sessions").length, 0);
  });

  it("rejects a malformed payload before touching the database", async () => {
    const harness = superAdminHarness({ operator: operatorRow({ status: "ACTIVE" }) });
    const { request } = mountAdmin(harness);
    const res = await request("/auth/verify", {
      method: "POST",
      body: { challengeId: "nope", code: "12" },
    });
    assert.equal(res.status, 400);
    assert.equal(harness.writes.length, 0);
    assert.equal(harness.reads.length, 0);
  });
});

describe("POST /staff/:staffId/approve", () => {
  it("is refused from INVITED: verification is a gate, not a formality", async () => {
    const harness = superAdminHarness({ operator: operatorRow({ status: "INVITED" }) });
    const { request } = mountAdmin(harness);
    const res = await request(`/staff/${ALICE_ID}/approve`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: {},
    });
    assert.equal(res.status, 409);
    assert.match(String((await readJson(res)).error), /has not verified/);
    assert.equal(harness.state.operator?.status, "INVITED");
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("reactivates a suspended account, since suspension is the temporary state", async () => {
    const harness = superAdminHarness({ operator: operatorRow({ status: "SUSPENDED" }) });
    const { request } = mountAdmin(harness);
    const res = await request(`/staff/${ALICE_ID}/approve`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: {},
    });
    assert.equal(res.status, 200, JSON.stringify(await readJson(res)));
    assert.equal(harness.state.operator?.status, "ACTIVE");
    const audit = auditWrites(harness.writes);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].values.action, "STAFF_ROLE_CHANGED");
    assert.equal(
      (audit[0].values.previousState as Record<string, unknown>).status,
      "SUSPENDED",
    );
  });

  it("answers a second approval with a replay and no second row", async () => {
    const harness = superAdminHarness({ operator: operatorRow({ status: "ACTIVE" }) });
    const { request } = mountAdmin(harness);
    const res = await request(`/staff/${ALICE_ID}/approve`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: {},
    });
    assert.equal(res.status, 200);
    assert.equal((await readJson(res)).replayed, true);
    assert.equal(operatorWrites(harness.writes).length, 0);
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("keeps revocation permanent", async () => {
    const harness = superAdminHarness({ operator: operatorRow({ status: "REVOKED" }) });
    const { request } = mountAdmin(harness);
    const res = await request(`/staff/${ALICE_ID}/approve`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: {},
    });
    assert.equal(res.status, 409);
    assert.match(String((await readJson(res)).error), /cannot be re-approved/);
    assert.equal(operatorWrites(harness.writes).length, 0);
  });

  it("refuses a role without staff:manage, writing nothing", async () => {
    for (const [email, role] of [
      ["licadmin@cyvoriq.com", "LICENCE_ADMIN"],
      ["audit@cyvoriq.com", "AUDITOR"],
    ] as const) {
      const harness = staffHarness(email, role);
      const { request } = mountAdmin(harness);
      const res = await request(`/staff/${ALICE_ID}/approve`, {
        method: "POST",
        token: STAFF_TOKEN,
        body: {},
      });
      assert.equal(res.status, 403, role);
      assert.match(String((await readJson(res)).error), new RegExp(`^${role} cannot `));
      assert.equal(operatorWrites(harness.writes).length, 0, role);
      assert.equal(auditWrites(harness.writes).length, 0, role);
    }
  });

  it("rejects a staffId that is not a uuid", async () => {
    const harness = superAdminHarness({ operator: operatorRow({ status: "EMAIL_VERIFIED" }) });
    const { request } = mountAdmin(harness);
    const res = await request("/staff/not-a-uuid/approve", {
      method: "POST",
      token: STAFF_TOKEN,
      body: {},
    });
    assert.equal(res.status, 400);
    assert.equal(harness.writes.length, 0);
  });
});

describe("POST /staff/:staffId/suspend", () => {
  it("suspends an ACTIVE account with a reason in the trail", async () => {
    const harness = superAdminHarness({ operator: operatorRow({ status: "ACTIVE" }) });
    const { request } = mountAdmin(harness);
    const res = await request(`/staff/${ALICE_ID}/suspend`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { reason: "on unpaid leave until further notice" },
    });
    assert.equal(res.status, 200, JSON.stringify(await readJson(res)));
    assert.equal(harness.state.operator?.status, "SUSPENDED");

    const audit = auditWrites(harness.writes);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].values.action, "STAFF_SUSPENDED");
    assert.equal(audit[0].inTransaction, true);
    assert.equal(audit[0].values.reason, "on unpaid leave until further notice");
    assert.equal(
      (audit[0].values.previousState as Record<string, unknown>).status,
      "ACTIVE",
    );
    assert.equal(
      (audit[0].values.newState as Record<string, unknown>).suspendedBy,
      "ceo@cyvoriq.com",
    );
  });

  it("is 400 without a reason - the question the roster will be asked", async () => {
    for (const body of [{}, { reason: "" }, { reason: "   " }]) {
      const harness = superAdminHarness({ operator: operatorRow({ status: "ACTIVE" }) });
      const { request } = mountAdmin(harness);
      const res = await request(`/staff/${ALICE_ID}/suspend`, {
        method: "POST",
        token: STAFF_TOKEN,
        body,
      });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.match(String((await readJson(res)).error), /reason/i);
      assert.equal(harness.state.operator?.status, "ACTIVE");
      assert.equal(harness.writes.length, 0, JSON.stringify(body));
    }
  });

  it("answers a second suspension with a replay and no second row", async () => {
    const harness = superAdminHarness({ operator: operatorRow({ status: "SUSPENDED" }) });
    const { request } = mountAdmin(harness);
    const res = await request(`/staff/${ALICE_ID}/suspend`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { reason: "again" },
    });
    assert.equal(res.status, 200);
    assert.equal((await readJson(res)).replayed, true);
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("refuses to suspend a revoked account", async () => {
    const harness = superAdminHarness({ operator: operatorRow({ status: "REVOKED" }) });
    const { request } = mountAdmin(harness);
    const res = await request(`/staff/${ALICE_ID}/suspend`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { reason: "too late" },
    });
    assert.equal(res.status, 409);
    assert.match(String((await readJson(res)).error), /revoked/i);
    assert.equal(operatorWrites(harness.writes).length, 0);
  });

  it("refuses a role without staff:manage, writing nothing", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR");
    const { request } = mountAdmin(harness);
    const res = await request(`/staff/${ALICE_ID}/suspend`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { reason: "attempted" },
    });
    assert.equal(res.status, 403);
    assert.match(String((await readJson(res)).error), /^AUDITOR cannot /);
    assert.equal(harness.state.operator?.status, "ACTIVE");
    assert.equal(harness.writes.length, 0);
  });
});

describe("POST /staff/:staffId/revoke", () => {
  it("revokes with a reason, which is now required", async () => {
    const harness = superAdminHarness({ operator: operatorRow({ status: "ACTIVE" }) });
    const { request } = mountAdmin(harness);
    const res = await request(`/staff/${ALICE_ID}/revoke`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { reason: "left the company on 2026-10-03" },
    });
    assert.equal(res.status, 200, JSON.stringify(await readJson(res)));
    assert.equal(harness.state.operator?.status, "REVOKED");

    const audit = auditWrites(harness.writes);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].values.action, "STAFF_REVOKED");
    assert.equal(audit[0].inTransaction, true);
    assert.equal(audit[0].values.reason, "left the company on 2026-10-03");
    assert.equal(
      (audit[0].values.previousState as Record<string, unknown>).status,
      "ACTIVE",
    );
  });

  it("is 400 without a reason: a permanent act with no stated cause", async () => {
    const harness = superAdminHarness({ operator: operatorRow({ status: "ACTIVE" }) });
    const { request } = mountAdmin(harness);
    const res = await request(`/staff/${ALICE_ID}/revoke`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: {},
    });
    assert.equal(res.status, 400);
    assert.match(String((await readJson(res)).error), /reason/i);
    assert.equal(harness.state.operator?.status, "ACTIVE");
    assert.equal(harness.writes.length, 0);
  });

  it("answers a repeat with the original row rather than a second revocation", async () => {
    const harness = superAdminHarness({
      operator: operatorRow({ status: "REVOKED", revokedAt: new Date() }),
    });
    const { request } = mountAdmin(harness);
    const res = await request(`/staff/${ALICE_ID}/revoke`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { reason: "left the company on 2026-10-03" },
    });
    assert.equal(res.status, 200);
    assert.equal((await readJson(res)).replayed, true);
    assert.equal(operatorWrites(harness.writes).length, 0);
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("refuses a role without staff:manage, writing nothing", async () => {
    const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN");
    const { request } = mountAdmin(harness);
    const res = await request(`/staff/${ALICE_ID}/revoke`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { reason: "attempted" },
    });
    assert.equal(res.status, 403);
    assert.match(String((await readJson(res)).error), /^LICENCE_ADMIN cannot /);
    assert.equal(harness.writes.length, 0);
  });
});
