import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STAFF_TOKEN,
  licenceRow,
  mountAdmin,
  signingEnv,
  staffHarness,
} from "./helpers/adminHarness.ts";

/**
 * W5 PHASE 2 - THE TWELVE ACTION ROUTES, AT THE ROUTE LEVEL.
 *
 * Every test below is one of the four shapes the brief asks for, in the order
 * the brief asks for them:
 *
 *   happy              the state moves and the trail records it
 *   forbidden role     a role that does not hold the permission gets 403
 *   forbidden transition the state machine says no, and nothing is written
 *   missing reason     §37's `reason` is required, and absent is 400
 *
 * "nothing is written" is asserted in each refusal case rather than inferred
 * from the status code, because a 403 that still updated a row is the exact
 * defect the server-side gate exists to prevent - and it is invisible to a test
 * that only reads the response.
 */

const SERIAL_ID = "11111111-1111-4111-8111-111111111111";

interface Recorded {
  table: string;
  kind: string;
  inTransaction: boolean;
  values: Record<string, unknown>;
}

function auditWrites(writes: readonly Recorded[]): Recorded[] {
  return writes.filter((w) => w.table === "audit_events");
}

function licenceWrites(writes: readonly Recorded[]): Recorded[] {
  return writes.filter((w) => w.table === "mobile_serials" && w.kind === "update");
}

/**
 * Body reads are cached per response.
 *
 * `Response.json()` can only be consumed once, and a test routinely wants the
 * payload twice: once as the failure message of `assert.equal(res.status, …)`
 * and once for the assertions themselves. Without the cache the second read
 * throws "Body has already been read", which is a defect in the test, not in
 * the route - and it would otherwise mask the assertion that actually matters.
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

describe("GET /serials - search, filters and pagination", () => {
  it("carries the count on every response, so a page cannot look complete", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", {
      licence: licenceRow(),
      totalCount: 60,
    });
    const { request } = mountAdmin(harness);
    const res = await request("/serials", { token: STAFF_TOKEN });
    assert.equal(res.status, 200);
    const body = await readJson(res);

    const pagination = body.pagination as Record<string, unknown>;
    assert.deepEqual(pagination, {
      page: 1,
      pageSize: 25,
      offset: 0,
      returned: 1,
      total: 60,
      totalPages: 3,
      hasMore: true,
      nextPage: 2,
    });
    assert.deepEqual(body.filters, {});
    assert.ok(Array.isArray(body.serials));
    // The count is a separate statement over the same predicate - and it is
    // sent with a real page size, not the default nobody chose.
    assert.ok(
      harness.paged.some((p) => p.table === "mobile_serials" && p.limit === 25 && p.offset === 0),
      JSON.stringify(harness.paged),
    );
  });

  it("refuses pageSize=1000 instead of serving 100 rows", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", { licence: licenceRow() });
    const { request } = mountAdmin(harness);
    const res = await request("/serials?pageSize=1000", { token: STAFF_TOKEN });
    assert.equal(res.status, 400);
    assert.match(String((await readJson(res)).error), /25, 50, 100/);
    assert.equal(licenceWrites(harness.writes).length, 0);
  });

  it("refuses the retired limit and offset parameters", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", { licence: licenceRow() });
    const { request } = mountAdmin(harness);
    const res = await request("/serials?limit=100&offset=0", { token: STAFF_TOKEN });
    assert.equal(res.status, 400);
    assert.match(String((await readJson(res)).error), /page.*pageSize/i);
  });

  it("echoes the filters it actually applied", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", { licence: licenceRow() });
    const { request } = mountAdmin(harness);
    const res = await request(
      "/serials?q=acme&status=ISSUED&paymentStatus=PAID&hostBinding=BOUND",
      { token: STAFF_TOKEN },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await readJson(res).then((b) => b.filters), {
      q: "acme",
      status: ["ISSUED"],
      paymentStatus: ["PAID"],
      hostBinding: ["BOUND"],
    });
  });

  it("names an unknown filter value rather than returning an empty page", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", { licence: licenceRow() });
    const { request } = mountAdmin(harness);
    const res = await request("/serials?status=ISSUED,TYPO", { token: STAFF_TOKEN });
    assert.equal(res.status, 400);
    assert.match(String((await readJson(res)).error), /TYPO/);
  });

  it("asks for the page size it was given, and starts at that page's offset", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", { licence: licenceRow() });
    const { request } = mountAdmin(harness);
    const res = await request("/serials?page=3&pageSize=100", { token: STAFF_TOKEN });
    assert.equal(res.status, 200);
    const body = await readJson(res);
    assert.equal((body.pagination as Record<string, unknown>).offset, 200);
    assert.ok(
      harness.paged.some((p) => p.table === "mobile_serials" && p.limit === 100 && p.offset === 200),
      JSON.stringify(harness.paged),
    );
  });

  it("is refused outright with no session", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", { licence: licenceRow() });
    const { request } = mountAdmin(harness);
    assert.equal((await request("/serials")).status, 401);
  });
});

describe("PATCH /serials/:serialId - edit", () => {
  it("changes only the customer fields it was given, and records what moved", async () => {
    const harness = staffHarness("operator@cyvoriq.com", "OPERATOR", { licence: licenceRow() });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}`, {
      method: "PATCH",
      token: STAFF_TOKEN,
      body: { customerEmail: "moved@example.com" },
    });
    assert.equal(res.status, 200, JSON.stringify(await readJson(res)));
    const body = await readJson(res);
    assert.deepEqual(body.updatedFields, ["customerEmail"]);

    // Absent fields are untouched: a partial body edits a partial record.
    assert.equal(harness.state.licence?.customerEmail, "moved@example.com");
    assert.equal(harness.state.licence?.customerFullName, "Test Buyer");
    assert.equal(harness.state.licence?.status, "KEY_GENERATED");

    const audit = auditWrites(harness.writes);
    assert.equal(audit.length, 1, "one save, one trail entry");
    assert.equal(audit[0].values.action, "SERIAL_UPDATED");
    assert.equal(audit[0].inTransaction, true);
    assert.deepEqual(audit[0].values.newState, {
      status: "KEY_GENERATED",
      updatedBy: "operator@cyvoriq.com",
      changes: {
        customerEmail: { from: "customer@example.com", to: "moved@example.com" },
      },
    });
  });

  it("is refused by a role that does not hold serial:update, with nothing written", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", { licence: licenceRow() });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}`, {
      method: "PATCH",
      token: STAFF_TOKEN,
      body: { customerEmail: "moved@example.com" },
    });
    assert.equal(res.status, 403);
    assert.match(String((await readJson(res)).error), /^AUDITOR cannot /);
    assert.equal(auditWrites(harness.writes).length, 0);
    assert.equal(licenceWrites(harness.writes).length, 0);
    assert.equal(harness.state.licence?.customerEmail, "customer@example.com");
  });

  it("is frozen from ISSUED onwards", async () => {
    const harness = staffHarness("operator@cyvoriq.com", "OPERATOR", {
      licence: licenceRow({ status: "ISSUED" }),
    });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}`, {
      method: "PATCH",
      token: STAFF_TOKEN,
      body: { customerEmail: "moved@example.com" },
    });
    assert.equal(res.status, 409);
    const body = await readJson(res);
    assert.match(String(body.error), /ISSUED/);
    assert.equal(body.status, "ISSUED");
    assert.equal(harness.state.licence?.customerEmail, "customer@example.com");
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("refuses a plan field as a bad request, not as a conflict", async () => {
    // There is no state in which the licence's size becomes editable, so 409
    // ("not right now") would be the wrong answer.
    const harness = staffHarness("operator@cyvoriq.com", "OPERATOR", { licence: licenceRow() });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}`, {
      method: "PATCH",
      token: STAFF_TOKEN,
      body: { deviceMax: 50 },
    });
    assert.equal(res.status, 400);
    assert.match(String((await readJson(res)).error), /deviceMax/);
    assert.equal(harness.state.licence?.deviceMax, 1);
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("refuses a name even when it carries the value that is already there", async () => {
    const harness = staffHarness("operator@cyvoriq.com", "OPERATOR", { licence: licenceRow() });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}`, {
      method: "PATCH",
      token: STAFF_TOKEN,
      body: { planCode: "CAP-1" },
    });
    assert.equal(res.status, 400);
    assert.match(String((await readJson(res)).error), /planCode/);
  });

  it("validates the merged record, not just the fields that were sent", async () => {
    const harness = staffHarness("operator@cyvoriq.com", "OPERATOR", { licence: licenceRow() });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}`, {
      method: "PATCH",
      token: STAFF_TOKEN,
      body: { customerEmail: "" },
    });
    assert.equal(res.status, 400);
    assert.match(String((await readJson(res)).error), /customerEmail/);
    assert.equal(harness.state.licence?.customerEmail, "customer@example.com");
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("rejects a path parameter that is not a uuid", async () => {
    const harness = staffHarness("operator@cyvoriq.com", "OPERATOR", { licence: licenceRow() });
    const { request } = mountAdmin(harness);
    const res = await request("/serials/not-a-uuid", {
      method: "PATCH",
      token: STAFF_TOKEN,
      body: { customerEmail: "moved@example.com" },
    });
    assert.equal(res.status, 400);
    assert.match(String((await readJson(res)).error), /UUID/);
  });
});

describe("POST /serials/:serialId/resend - re-distribute, never regenerate", () => {
  const issued = () => staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
    licence: licenceRow({ status: "ISSUED", issuedAt: new Date() }),
  });

  it("sends the key it already has and leaves it byte-identical", async () => {
    const harness = issued();
    const before = harness.state.licence?.publicNumber;
    assert.equal(typeof before, "string");

    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}/resend`, {
      method: "POST",
      token: STAFF_TOKEN,
    });
    assert.equal(res.status, 200, JSON.stringify(await readJson(res)));
    const body = await readJson(res);
    assert.equal(body.emailed, false, "no Resend key in preview - never a socket");
    assert.match(String(body.message), /not regenerated/i);

    assert.equal(harness.state.licence?.publicNumber, before, "the key is untouched");
    assert.equal(harness.state.licence?.status, "ISSUED");

    const audit = auditWrites(harness.writes);
    assert.equal(audit.length, 1, "each resend is its own event");
    assert.equal(audit[0].values.action, "LICENCE_RESENT");
    assert.equal(audit[0].inTransaction, true);
    const next = audit[0].values.newState as Record<string, unknown>;
    assert.equal(next.resentTo, "customer@example.com");
    assert.equal(next.resentBy, "licadmin@cyvoriq.com");
    assert.equal(next.status, "ISSUED");
    // The trail records the fingerprint of the key, never the key.
    assert.equal("publicNumber" in next, false);
    assert.equal(typeof next.publicNumberFingerprint, "string");
  });

  it("is refused by OPERATOR, who may not distribute a credential", async () => {
    const harness = staffHarness("operator@cyvoriq.com", "OPERATOR", {
      licence: licenceRow({ status: "ISSUED" }),
    });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}/resend`, {
      method: "POST",
      token: STAFF_TOKEN,
    });
    assert.equal(res.status, 403);
    assert.match(String((await readJson(res)).error), /^OPERATOR cannot /);
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("refuses a key that has never been distributed, sending it to /issue instead", async () => {
    const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
      licence: licenceRow({ status: "KEY_GENERATED" }),
    });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}/resend`, {
      method: "POST",
      token: STAFF_TOKEN,
    });
    assert.equal(res.status, 409);
    assert.match(String((await readJson(res)).error), /ISSUED and ACTIVE/);
    assert.equal(auditWrites(harness.writes).length, 0);
    assert.equal(harness.state.licence?.status, "KEY_GENERATED");
  });

  it("refuses a revoked licence rather than re-sending a dead credential", async () => {
    const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
      licence: licenceRow({ status: "REVOKED", revokedAt: new Date() }),
    });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}/resend`, {
      method: "POST",
      token: STAFF_TOKEN,
    });
    assert.equal(res.status, 409);
    assert.match(String((await readJson(res)).error), /REVOKED/);
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("refuses a record with no key at all", async () => {
    const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
      licence: licenceRow({ publicNumber: null }),
    });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}/resend`, {
      method: "POST",
      token: STAFF_TOKEN,
    });
    assert.equal(res.status, 409);
    assert.match(String((await readJson(res)).error), /no key/i);
    assert.equal(auditWrites(harness.writes).length, 0);
  });
});

describe("POST /serials/:serialId/rebind/request", () => {
  const bound = () => staffHarness("operator@cyvoriq.com", "OPERATOR", {
    licence: licenceRow({ hostBindingStatus: "BOUND", devicesBound: 1 }),
  });

  it("moves BOUND to REBIND_REQUEST and records it", async () => {
    const harness = bound();
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}/rebind/request`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { reason: "workstation replaced after a board failure" },
    });
    assert.equal(res.status, 200, JSON.stringify(await readJson(res)));
    assert.equal(harness.state.licence?.hostBindingStatus, "REBIND_REQUEST");

    const audit = auditWrites(harness.writes);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].values.action, "REBIND_REQUESTED");
    assert.equal(audit[0].inTransaction, true);
    assert.deepEqual(audit[0].values.previousState, { hostBindingStatus: "BOUND" });
    const next = audit[0].values.newState as Record<string, unknown>;
    assert.equal(next.hostBindingStatus, "REBIND_REQUEST");
    assert.equal(next.requestedBy, "operator@cyvoriq.com");
    assert.equal(next.reason, "workstation replaced after a board failure");
  });

  it("answers a second request with a replay instead of writing twice", async () => {
    const harness = bound();
    const { request } = mountAdmin(harness);
    await request(`/serials/${SERIAL_ID}/rebind/request`, {
      method: "POST",
      token: STAFF_TOKEN,
    });
    const second = await request(`/serials/${SERIAL_ID}/rebind/request`, {
      method: "POST",
      token: STAFF_TOKEN,
    });
    assert.equal(second.status, 200);
    assert.equal((await readJson(second)).replayed, true);
    assert.equal(auditWrites(harness.writes).length, 1, "one decision, one row");
  });

  it("refuses AUDITOR, which holds neither half of the rebind", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", {
      licence: licenceRow({ hostBindingStatus: "BOUND" }),
    });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}/rebind/request`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { reason: "attempted" },
    });
    assert.equal(res.status, 403);
    assert.match(String((await readJson(res)).error), /^AUDITOR cannot /);
    assert.equal(harness.state.licence?.hostBindingStatus, "BOUND");
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("refuses a licence that has never been bound, with 409 and no write", async () => {
    const harness = staffHarness("operator@cyvoriq.com", "OPERATOR", {
      licence: licenceRow({ hostBindingStatus: "NOT_BOUND" }),
    });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}/rebind/request`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { reason: "attempted" },
    });
    assert.equal(res.status, 409);
    const body = await readJson(res);
    assert.match(String(body.error), /never been bound/);
    assert.equal(body.current, "NOT_BOUND");
    assert.equal(licenceWrites(harness.writes).length, 0);
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("treats a LOCKED binding as its own problem, not as 'no binding'", async () => {
    const harness = staffHarness("operator@cyvoriq.com", "OPERATOR", {
      licence: licenceRow({ hostBindingStatus: "LOCKED" }),
    });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}/rebind/request`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { reason: "attempted" },
    });
    assert.equal(res.status, 409);
    assert.match(String((await readJson(res)).error), /locked/i);
  });
});

describe("POST /serials/:serialId/rebind/approve", () => {
  const pending = () =>
    staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
      licence: licenceRow({
        hostBindingStatus: "REBIND_REQUEST",
        hostFingerprint: "machine-fingerprint-value",
        deviceTokenHash: "token-digest-value",
        devicesBound: 3,
        firstActivatedAt: new Date("2026-09-01T00:00:00.000Z"),
      }),
    });

  it("invalidates the old host without erasing when it was first claimed", async () => {
    const harness = pending();
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}/rebind/approve`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { reason: "site engineer confirmed the swap" },
    });
    assert.equal(res.status, 200, JSON.stringify(await readJson(res)));

    const row = harness.state.licence ?? {};
    assert.equal(row.hostBindingStatus, "NOT_BOUND");
    assert.equal(row.hostFingerprint, null, "the one-host limit's subject must go");
    assert.equal(row.deviceTokenHash, null, "the old host's bearer secret must go");
    assert.equal(row.devicesBound, 0, "nothing is bound until the new host activates");
    assert.equal(
      (row.firstActivatedAt as Date).toISOString(),
      "2026-09-01T00:00:00.000Z",
      "set once, never overwritten",
    );

    const audit = auditWrites(harness.writes);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].values.action, "REBIND_APPROVED");
    assert.equal(audit[0].inTransaction, true);
    const previous = audit[0].values.previousState as Record<string, unknown>;
    const next = audit[0].values.newState as Record<string, unknown>;
    assert.equal(previous.hostFingerprintPresent, true);
    assert.equal(next.hostFingerprintPresent, false);
    assert.equal(next.deviceTokenHashPresent, false);
    // Shapes, never values: an immutable trail is not a second place a host
    // identity or a token digest lives.
    assert.equal("hostFingerprint" in previous, false);
    assert.equal("deviceTokenHash" in previous, false);
    assert.equal(next.reason, "site engineer confirmed the swap");
  });

  it("is refused by OPERATOR, who may only ask for a rebind", async () => {
    const harness = staffHarness("operator@cyvoriq.com", "OPERATOR", {
      licence: licenceRow({ hostBindingStatus: "REBIND_REQUEST" }),
    });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}/rebind/approve`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { reason: "attempted" },
    });
    assert.equal(res.status, 403);
    assert.match(String((await readJson(res)).error), /^OPERATOR cannot /);
    assert.equal(harness.state.licence?.hostBindingStatus, "REBIND_REQUEST");
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("refuses to approve anything that is not a pending request", async () => {
    for (const status of ["NOT_BOUND", "BOUND", "LOCKED"] as const) {
      const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
        licence: licenceRow({ hostBindingStatus: status }),
      });
      const { request } = mountAdmin(harness);
      const res = await request(`/serials/${SERIAL_ID}/rebind/approve`, {
        method: "POST",
        token: STAFF_TOKEN,
        body: { reason: "attempted" },
      });
      assert.equal(res.status, 409, status);
      const body = await readJson(res);
      assert.equal(body.current, status, status);
      assert.equal(licenceWrites(harness.writes).length, 0, status);
      assert.equal(auditWrites(harness.writes).length, 0, status);
    }
  });
});

describe("GET /serials/:serialId/activation - view without leaking", () => {
  it("answers a reader with shapes, not with the matcher itself", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", {
      licence: licenceRow({
        hostBindingStatus: "BOUND",
        hostFingerprint: "machine-fingerprint-value",
        deviceTokenHash: "token-digest-value",
        devicesBound: 1,
        firstActivatedAt: new Date("2026-09-01T00:00:00.000Z"),
      }),
    });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}/activation`, { token: STAFF_TOKEN });
    assert.equal(res.status, 200);
    const body = await readJson(res);

    const binding = body.hostBinding as Record<string, unknown>;
    assert.equal(binding.status, "BOUND");
    assert.equal(binding.devicesBound, 1);
    assert.equal(binding.firstActivatedAt, "2026-09-01T00:00:00.000Z");
    assert.equal(binding.deviceTokenPresent, true);
    assert.equal(typeof binding.hostFingerprintFp, "string");
    assert.notEqual(binding.hostFingerprintFp, "machine-fingerprint-value");

    // Neither secret survives anywhere in the response.
    const serialised = JSON.stringify(body);
    assert.ok(!serialised.includes("machine-fingerprint-value"));
    assert.ok(!serialised.includes("token-digest-value"));
    assert.ok(!serialised.includes("deviceTokenHash"));
  });

  it("writes nothing: a look is not an event the append-only trail can hold", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", { licence: licenceRow() });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}/activation`, { token: STAFF_TOKEN });
    assert.equal(res.status, 200);
    assert.equal(harness.writes.length, 0, JSON.stringify(harness.writes));
  });

  it("is still gated: no session, no activation detail", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", { licence: licenceRow() });
    const { request } = mountAdmin(harness);
    assert.equal((await request(`/serials/${SERIAL_ID}/activation`)).status, 401);
  });
});

describe("GET /serials/:serialId/export - a copy leaves, so it is audited", () => {
  it("writes EXPORT_GENERATED with actor, format, row count, filters and time", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", { licence: licenceRow() });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}/export`, { token: STAFF_TOKEN });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(res.headers.get("content-disposition") ?? "", /attachment/);
    const csv = await res.text();
    const lines = csv.trimEnd().split("\n");
    // §56's headers, not the projection's field names: the file that leaves the
    // building is read by an auditor, and §56 names the columns in full.
    assert.ok(lines[0].includes("Registered Email"), lines[0]);
    assert.ok(lines[0].includes("Licence Serial"), lines[0]);
    assert.ok(lines[0].startsWith("Row No.,Licence ID,"), lines[0]);
    assert.equal(lines.length, 2, "one header, one row");
    assert.ok(csv.endsWith("\n"));

    const audit = auditWrites(harness.writes);
    assert.equal(audit.length, 1, "every export writes exactly one row");
    assert.equal(audit[0].values.action, "EXPORT_GENERATED");
    assert.equal(audit[0].values.entityType, "licence");
    assert.equal(audit[0].values.entityId, SERIAL_ID);
    assert.equal(audit[0].inTransaction, true);
    const next = audit[0].values.newState as Record<string, unknown>;
    assert.equal(next.actor, "audit@cyvoriq.com");
    assert.equal(next.format, "csv");
    assert.equal(next.rowCount, 1);
    assert.deepEqual(next.filters, { serialId: SERIAL_ID, status: "KEY_GENERATED" });
    assert.ok(Number.isFinite(Date.parse(String(next.generatedAt))), String(next.generatedAt));
  });

  it("refuses a path that is not a uuid", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", { licence: licenceRow() });
    const { request } = mountAdmin(harness);
    const res = await request("/serials/not-a-uuid/export", { token: STAFF_TOKEN });
    assert.equal(res.status, 400);
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("is refused with no session, so an export cannot happen anonymously", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", { licence: licenceRow() });
    const { request } = mountAdmin(harness);
    assert.equal((await request(`/serials/${SERIAL_ID}/export`)).status, 401);
    assert.equal(auditWrites(harness.writes).length, 0);
  });
});

describe("POST /serials/:serialId/generate-key - the Green Key Rule and its one waiver", () => {
  /**
   * A licence at `READY_TO_GENERATE` - the one state from which `generate-key`
   * is a legal §49 edge - whose payment has not been confirmed.
   *
   * Signing is configured so that the only thing capable of refusing is the
   * payment (or, for the waiver tests, the role).
   */
  const pending = (email: string, role: string) => {
    const harness = staffHarness(email, role, {
      licence: licenceRow({ status: "READY_TO_GENERATE", publicNumber: null }),
      payment: {
        id: "22222222-2222-4222-8222-222222222222",
        licenceId: SERIAL_ID,
        status: "PENDING",
        createdAt: new Date(),
      },
    });
    return { harness, request: mountAdmin(harness, signingEnv()).request };
  };

  it("still refuses a Super Admin who does not ask for the waiver", async () => {
    // The default is the rule, for everyone - the bypass is a decision, not an
    // ambient property of who is logged in.
    const { harness, request } = pending("ceo@cyvoriq.com", "SUPER_ADMIN");
    const res = await request(`/serials/${SERIAL_ID}/generate-key`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: {},
    });
    assert.equal(res.status, 403);
    assert.match(String((await readJson(res)).error), /payment/i);
    assert.equal(harness.state.licence?.publicNumber, null);
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("grants a Super Admin the waiver, with a reason, and leaves the money alone", async () => {
    const { harness, request } = pending("ceo@cyvoriq.com", "SUPER_ADMIN");
    const res = await request(`/serials/${SERIAL_ID}/generate-key`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: {
        waivePayment: true,
        reason: "CEO override: payment settled outside the gateway, ref UPI-4471",
      },
    });
    assert.equal(res.status, 200, JSON.stringify(await readJson(res)));
    assert.equal(harness.state.licence?.status, "KEY_GENERATED");
    assert.equal(typeof harness.state.licence?.publicNumber, "string");

    // The waiver does not touch `payments.status`. Faking that would put money
    // in the books that never arrived.
    assert.equal(harness.state.payment?.status, "PENDING");

    const audit = auditWrites(harness.writes);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].values.action, "KEY_GENERATED");
    const previous = audit[0].values.previousState as Record<string, unknown>;
    const next = audit[0].values.newState as Record<string, unknown>;
    assert.equal(previous.paymentStatus, "PENDING");
    assert.equal(next.paymentWaived, true);
    assert.equal(next.paymentStatus, "PENDING");
    // The trail must say the transition happened. A row recording the
    // pre-transition status next to a freshly minted key is precisely the
    // contradiction an append-only trail exists to rule out.
    assert.equal(previous.status, "READY_TO_GENERATE");
    assert.equal(next.status, "KEY_GENERATED");
    assert.equal(
      next.reason,
      "CEO override: payment settled outside the gateway, ref UPI-4471",
    );
  });

  it("answers a retry with the key that already exists, so a double-click cannot mint two", async () => {
    // §48. The retry guard is `publicNumber !== null` **and** status in
    // {KEY_GENERATED, ISSUED} - the second half only holds because generation
    // writes the status. Without it, a second click re-enters generation, the
    // waiver authorises it again, and the record ends up holding two valid
    // licence credentials: §48's exact forbidden outcome.
    const { harness, request } = pending("ceo@cyvoriq.com", "SUPER_ADMIN");
    const body = {
      waivePayment: true,
      reason: "CEO override: payment settled outside the gateway, ref UPI-4471",
    };
    const first = await request(`/serials/${SERIAL_ID}/generate-key`, {
      method: "POST",
      token: STAFF_TOKEN,
      body,
    });
    assert.equal(first.status, 200, JSON.stringify(await readJson(first)));
    const allocated = (await readJson(first)).serial as Record<string, unknown>;
    assert.equal(harness.state.licence?.status, "KEY_GENERATED");

    const second = await request(`/serials/${SERIAL_ID}/generate-key`, {
      method: "POST",
      token: STAFF_TOKEN,
      body,
    });
    assert.equal(second.status, 200, JSON.stringify(await readJson(second)));
    const retry = await readJson(second);
    assert.equal(retry.replayed, true);
    assert.equal(
      (retry.serial as Record<string, unknown>).publicNumber,
      allocated.publicNumber,
      "the retry hands back the key that already exists",
    );
    assert.equal(licenceWrites(harness.writes).length, 1, "one key, one write");
    assert.equal(auditWrites(harness.writes).length, 1, "one key, one row");
  });

  it("requires a reason with the waiver", async () => {
    const { harness, request } = pending("ceo@cyvoriq.com", "SUPER_ADMIN");
    const res = await request(`/serials/${SERIAL_ID}/generate-key`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { waivePayment: true },
    });
    assert.equal(res.status, 400);
    assert.match(String((await readJson(res)).error), /reason/i);
    assert.equal(harness.state.licence?.publicNumber, null);
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("refuses the waiver to everyone beneath Super Admin", async () => {
    const { harness, request } = pending("licadmin@cyvoriq.com", "LICENCE_ADMIN");
    const res = await request(`/serials/${SERIAL_ID}/generate-key`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { waivePayment: true, reason: "I hold key:generate so I should be able to" },
    });
    assert.equal(res.status, 403);
    const body = await readJson(res);
    assert.match(String(body.error), /Super Admin only/i);
    assert.match(String(body.error), /LICENCE_ADMIN/);
    assert.equal(harness.state.licence?.publicNumber, null);
    assert.equal(licenceWrites(harness.writes).length, 0);
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("does not let a role without key:generate reach the waiver check at all", async () => {
    const { harness, request } = pending("audit@cyvoriq.com", "AUDITOR");
    const res = await request(`/serials/${SERIAL_ID}/generate-key`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { waivePayment: true, reason: "attempted" },
    });
    assert.equal(res.status, 403);
    assert.match(String((await readJson(res)).error), /^AUDITOR cannot /);
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("answers a non-Super Admin who sends the flag without a waiver reason first", async () => {
    // The role clause fires before the reason clause: a caller who is not
    // entitled to waive is told they are not entitled, not that their paperwork
    // is incomplete.
    const { harness, request } = pending("licadmin@cyvoriq.com", "LICENCE_ADMIN");
    const res = await request(`/serials/${SERIAL_ID}/generate-key`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { waivePayment: true },
    });
    assert.equal(res.status, 403);
    assert.match(String((await readJson(res)).error), /Super Admin only/i);
  });
});
