/**
 * W5 PHASE 1 - THE AUDIT ENGINE
 * =============================
 *
 * Four properties, each asserted rather than assumed:
 *
 *   1. ONE INSERTION PATH - `auditEvents` is referenced by exactly one file in
 *      `src/`. `writeAudit` is that file's only writer, so "we forgot the
 *      helper" cannot become a silent unaudited write.
 *   2. NOTHING GOES UNCLASSIFIED - every state-changing route is mapped or
 *      explicitly exempt, and a stale registry key throws. This is asserted
 *      twice: once against the real router, and once against deliberately
 *      broken inputs so we know the guard actually fires.
 *   3. THE ROW LIVES IN THE MUTATION'S TRANSACTION, carrying the true previous
 *      and new state as read and written - not a value the handler guessed.
 *   4. THE FRAME IS HONEST - the actor's IP comes from `CF-Connecting-IP`, and
 *      `X-Forwarded-For` (client-controlled when nothing overwrites it) does
 *      not reach the column.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { auditEvents } from "@cyvra/database/schema";
import { adminRoutes } from "../src/admin.ts";
import {
  AGGREGATE_ENTITY_ID,
  AUTH_ROUTES,
  CONDITIONAL_ROUTES,
  ENTITY_LICENCE,
  ROUTE,
  ROUTE_ACTION_MAP,
  actionFor,
  assertRouteAuditCoverage,
  auditEntry,
  writeAudit,
  type StaffAuditContext,
} from "../src/admin/audit.ts";
import {
  STAFF_TOKEN,
  licenceRow,
  mountAdmin,
  paidPayment,
  staffHarness,
} from "./helpers/adminHarness.ts";

const SRC = new URL("../src/", import.meta.url).pathname.replace(/^\//, "");
const SERIAL_ID = "11111111-1111-4111-8111-111111111111";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const frame: StaffAuditContext = {
  actorId: "33333333-3333-4333-8333-333333333333",
  actorRole: "LICENCE_ADMIN",
  actorEmail: "licadmin@cyvoriq.com",
  ipAddress: "203.0.113.9",
  route: `/admin/serials/${SERIAL_ID}/revoke`,
};

/* ---------------------------------------------------------------------- */

describe("one insertion path", () => {
  it("names exactly one file in src/ that touches auditEvents", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => /\bauditEvents\b/.test(readFileSync(file, "utf8")))
      .map((file) => file.replace(/\\/g, "/").split("/src/").pop());
    assert.deepEqual(offenders, ["admin/audit.ts"]);
  });

  it("reaches audit_events through writeAudit, and never a raw insert elsewhere", async () => {
    const auditSource = readFileSync(join(SRC, "admin", "audit.ts"), "utf8");
    assert.match(auditSource, /await tx\.insert\(auditEvents\)\.values\(\{/);
    // The handler module must not even import the table: it has no way to
    // write the trail except by asking the engine to.
    const handlers = readFileSync(join(SRC, "admin.ts"), "utf8");
    assert.doesNotMatch(handlers, /\bauditEvents\b/);
  });

  it("inserts into the handle it is given, and opens no transaction of its own", async () => {
    const calls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    // Note what is absent: no `transaction`, no `select`. If `writeAudit` ever
    // started one, this double would throw instead of recording.
    const tx = {
      insert(table: unknown) {
        return {
          values(values: Record<string, unknown>) {
            calls.push({ table, values });
            return Promise.resolve();
          },
        };
      },
    };

    await writeAudit(tx as never, {
      actorId: null,
      actorRole: "OPERATOR",
      action: "LICENCE_SUSPENDED",
      entityType: ENTITY_LICENCE,
      entityId: SERIAL_ID,
      previousState: { status: "ISSUED" },
      newState: { status: "SUSPENDED" },
      reason: "chargeback",
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].table, auditEvents);
    assert.deepEqual(calls[0].values.previousState, { status: "ISSUED" });
    assert.deepEqual(calls[0].values.newState, { status: "SUSPENDED" });
    assert.equal(calls[0].values.reason, "chargeback");
    assert.equal(calls[0].values.actorRole, "OPERATOR");
  });

  it("records NULL for a state the change did not have, rather than inventing one", async () => {
    const calls: Array<{ values: Record<string, unknown> }> = [];
    const tx = {
      insert() {
        return {
          values(values: Record<string, unknown>) {
            calls.push({ values });
            return Promise.resolve();
          },
        };
      },
    };
    await writeAudit(tx as never, {
      actorId: null,
      actorRole: "SUPER_ADMIN",
      action: "SERIAL_CREATED",
      entityType: ENTITY_LICENCE,
      entityId: SERIAL_ID,
    });
    assert.equal(calls[0].values.previousState, null);
    assert.equal(calls[0].values.newState, null);
    assert.equal(calls[0].values.ipAddress, null);
    assert.equal(calls[0].values.reason, null);
  });

  it("always carries a role, because the column refuses to be empty", async () => {
    const entry = auditEntry(frame, {
      action: "LICENCE_REVOKED",
      entityType: ENTITY_LICENCE,
      entityId: SERIAL_ID,
    });
    assert.equal(entry.actorRole, "LICENCE_ADMIN");
    assert.equal(entry.actorId, frame.actorId);
    assert.equal(entry.ipAddress, frame.ipAddress);
    assert.equal(typeof entry.actorRole, "string");
  });
});

/* ---------------------------------------------------------------------- */

describe("route coverage", () => {
  it("classified every registered state-changing route (this ran at import)", () => {
    // Importing `admin.ts` already executed the assertion; re-running it here
    // makes the fact testable rather than merely "it did not throw earlier".
    assert.doesNotThrow(() => assertRouteAuditCoverage(adminRoutes.routes));
  });

  it("maps every write route to a real audit_action_enum value", async () => {
    const { auditActionEnum } = await import("@cyvra/database/schema");
    const known = new Set<string>(auditActionEnum.enumValues);
    for (const [route, action] of Object.entries(ROUTE_ACTION_MAP)) {
      assert.ok(known.has(action), `${route} -> unknown action ${action}`);
    }
  });

  it("registers every key it declares", () => {
    const registered = new Set(
      adminRoutes.routes
        .filter((r) => r.method !== "*" && r.path !== "*")
        .map((r) => `${r.method.toUpperCase()} ${r.path}`),
    );
    for (const key of [...Object.keys(ROUTE_ACTION_MAP), ...AUTH_ROUTES]) {
      assert.ok(registered.has(key), `registry names ${key}, but it is not registered`);
    }
  });

  it("declares exactly the three auth exemptions, each a session lifecycle route", () => {
    assert.deepEqual([...AUTH_ROUTES].sort(), [
      "POST /auth/logout",
      "POST /auth/request",
      "POST /auth/verify",
    ]);
  });

  it("marks only the CSV report as conditional", () => {
    assert.deepEqual([...CONDITIONAL_ROUTES], [ROUTE.exportLicences]);
  });

  it("throws at load for a state-changing route nobody classified", () => {
    assert.throws(
      () => assertRouteAuditCoverage([{ method: "POST", path: "/not-classified" }]),
      /no audit action for state-changing route POST \/not-classified/,
    );
    assert.throws(
      () => assertRouteAuditCoverage([{ method: "DELETE", path: "/thing" }]),
      /Map it to an audit_action_enum value/,
    );
  });

  it("ignores reads, which are correctly not audited", () => {
    // The real registry, plus an unclassified read: reads are out of scope for
    // check 1, and adding one cannot stale check 2 either.
    assert.doesNotThrow(() =>
      assertRouteAuditCoverage([
        ...adminRoutes.routes,
        { method: "GET", path: "/anything" },
        { method: "HEAD", path: "/anything" },
      ]),
    );
  });

  it("throws when a registry key names a route that no longer exists", () => {
    const withoutSuspend = adminRoutes.routes.filter(
      (r) => `${r.method} ${r.path}` !== `POST ${ROUTE.suspend.split(" ")[1]}`,
    );
    assert.throws(
      () => assertRouteAuditCoverage(withoutSuspend),
      /but no such route is registered/,
    );
  });

  it("throws when an auth exemption goes stale for the same reason", () => {
    const withoutVerify = adminRoutes.routes.filter(
      (r) => `${r.method} ${r.path}` !== ROUTE.authVerify,
    );
    assert.throws(
      () => assertRouteAuditCoverage(withoutVerify),
      /POST \/auth\/verify/,
    );
  });

  it("refuses to produce an action for a route it has not seen", () => {
    assert.throws(
      () => actionFor("POST /somewhere-new"),
      /has no audit action for "POST \/somewhere-new"/,
    );
  });

  it("gives each mapped route the action its handler writes", () => {
    assert.equal(actionFor(ROUTE.createSerial), "SERIAL_CREATED");
    assert.equal(actionFor(ROUTE.confirmPayment), "PAYMENT_CONFIRMED");
    assert.equal(actionFor(ROUTE.generateKey), "KEY_GENERATED");
    assert.equal(actionFor(ROUTE.issue), "LICENCE_ISSUED");
    assert.equal(actionFor(ROUTE.suspend), "LICENCE_SUSPENDED");
    assert.equal(actionFor(ROUTE.revoke), "LICENCE_REVOKED");
    assert.equal(actionFor(ROUTE.createStaff), "STAFF_INVITED");
    assert.equal(actionFor(ROUTE.revokeStaff), "STAFF_REVOKED");
    assert.equal(actionFor(ROUTE.exportLicences), "EXPORT_GENERATED");
  });

  it("uses the nil UUID only for aggregate events, never for a licence", () => {
    assert.equal(AGGREGATE_ENTITY_ID, "00000000-0000-0000-0000-000000000000");
    assert.notEqual(AGGREGATE_ENTITY_ID, ENTITY_LICENCE);
  });
});

/* ---------------------------------------------------------------------- */

async function readJson(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

function auditWrites(harness: { writes: Array<Record<string, unknown>> }) {
  return harness.writes.filter((w) => w.table === "audit_events");
}

describe("the audit row sits inside the mutation's transaction", () => {
  it("confirms payment: two §49 edges, one row, money written first", async () => {
    const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
      licence: licenceRow({ status: "PAYMENT_PENDING", publicNumber: null }),
      payment: null,
    });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}/confirm-payment`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { amount: 5000, reference: "UPI-1", paymentMethod: "UPI" },
      ip: "198.51.100.7",
    });
    assert.equal(res.status, 200, JSON.stringify(await readJson(res)));

    // Financial truth first: `payments.status` is written before the licence
    // is allowed to move (decision A3).
    const paymentIndex = harness.writes.findIndex((w) => w.table === "payments");
    const licenceIndex = harness.writes.findIndex(
      (w) => w.table === "mobile_serials" && w.kind === "update",
    );
    assert.ok(paymentIndex >= 0 && licenceIndex >= 0);
    assert.ok(paymentIndex < licenceIndex, "money before workflow");
    assert.equal(harness.state.payment?.status, "PAID");
    assert.equal(harness.state.licence?.status, "READY_TO_GENERATE");

    const audit = auditWrites(harness);
    assert.equal(audit.length, 1, "one click, one event - not two");
    const row = audit[0] as { inTransaction: boolean; values: Record<string, unknown> };
    assert.equal(row.inTransaction, true);
    assert.equal(row.values.action, "PAYMENT_CONFIRMED");
    assert.equal(row.values.actorEmail, undefined);
    assert.deepEqual(row.values.previousState, {
      status: "PAYMENT_PENDING",
      paymentStatus: null,
      // NULL is the truth for every pre-0009 row - migration 0009 backfills
      // nothing, because nobody ever captured a method for those payments.
      paymentMethod: null,
    });
    assert.deepEqual(row.values.newState, {
      status: "READY_TO_GENERATE",
      paymentStatus: "PAID",
      // The method the operator chose, on the row of the event that recorded
      // it - not read back from `payments` afterwards.
      paymentMethod: "UPI",
      confirmedBy: "licadmin@cyvoriq.com",
    });
    assert.equal(row.values.ipAddress, "198.51.100.7");
  });

  it("revoke: records §37's reason, the true previous state, and nothing on replay", async () => {
    const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
      licence: licenceRow({ status: "ISSUED" }),
    });
    const { request } = mountAdmin(harness);

    const first = await request(`/serials/${SERIAL_ID}/revoke`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { reason: "chargeback reported by the issuer" },
    });
    assert.equal(first.status, 200, JSON.stringify(await readJson(first)));
    assert.equal(harness.state.licence?.status, "REVOKED");

    const audit = auditWrites(harness);
    assert.equal(audit.length, 1);
    const row = audit[0] as { inTransaction: boolean; values: Record<string, unknown> };
    assert.equal(row.inTransaction, true);
    assert.equal(row.values.action, "LICENCE_REVOKED");
    assert.equal(row.values.entityId, SERIAL_ID);
    assert.equal(row.values.reason, "chargeback reported by the issuer");
    assert.deepEqual(row.values.previousState, { status: "ISSUED", revokedAt: null });
    assert.deepEqual(row.values.newState, {
      status: "REVOKED",
      revokedAt: harness.state.licence?.revokedAt instanceof Date
        ? (harness.state.licence.revokedAt as Date).toISOString()
        : harness.state.licence?.revokedAt,
      updatedBy: "licadmin@cyvoriq.com",
    });

    const before = harness.writes.length;
    const second = await request(`/serials/${SERIAL_ID}/revoke`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { reason: "clicked twice" },
    });
    assert.equal(second.status, 200);
    const body = await readJson(second);
    assert.equal(body.replayed, true);
    assert.match(String(body.message), /already processed/);
    assert.equal(harness.writes.length, before, "a replay writes nothing at all");
    assert.equal(auditWrites(harness).length, 1, "and no second audit row");
  });

  it("refuses revoke without a §37 reason, and writes nothing while refusing", async () => {
    const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
      licence: licenceRow({ status: "ISSUED" }),
    });
    const { request } = mountAdmin(harness);
    for (const body of [undefined, {}, { reason: "" }, { reason: "   " }]) {
      const res = await request(`/serials/${SERIAL_ID}/revoke`, {
        method: "POST",
        token: STAFF_TOKEN,
        body,
      });
      assert.equal(res.status, 400, JSON.stringify(body));
      const payload = await readJson(res);
      assert.match(String(payload.error), /reason/i);
    }
    assert.equal(harness.writes.length, 0);
    assert.equal(harness.state.licence?.status, "ISSUED");
  });

  it("does not audit a refusal: a forbidden transition leaves no trail", async () => {
    const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
      licence: licenceRow({ status: "DRAFT" }),
    });
    const { request } = mountAdmin(harness);
    const res = await request(`/serials/${SERIAL_ID}/revoke`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { reason: "not allowed from DRAFT" },
    });
    assert.equal(res.status, 409);
    assert.equal(harness.writes.length, 0);
    assert.equal(auditWrites(harness).length, 0);
  });
});

describe("the captured frame", () => {
  it("takes the IP from CF-Connecting-IP and ignores X-Forwarded-For", async () => {
    const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
      licence: licenceRow({ status: "READY_TO_GENERATE", publicNumber: null }),
      payment: paidPayment(SERIAL_ID),
    });
    const { app, env } = mountAdmin(harness);
    const res = await app.request(
      `/admin/serials/${SERIAL_ID}/generate-key`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STAFF_TOKEN}`,
          "X-Forwarded-For": "10.0.0.1, 10.0.0.2",
          "CF-Connecting-IP": "203.0.113.9",
        },
      },
      env,
    );
    assert.equal(res.status, 200, JSON.stringify(await readJson(res)));
    const audit = auditWrites(harness);
    assert.equal(audit.length, 1);
    assert.equal(
      (audit[0] as { values: Record<string, unknown> }).values.ipAddress,
      "203.0.113.9",
    );
  });

  it("leaves the IP NULL when the platform sets none, rather than guessing", async () => {
    const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
      licence: licenceRow({ status: "READY_TO_GENERATE", publicNumber: null }),
      payment: paidPayment(SERIAL_ID),
    });
    const { app, env } = mountAdmin(harness);
    const res = await app.request(
      `/admin/serials/${SERIAL_ID}/generate-key`,
      { method: "POST", headers: { Authorization: `Bearer ${STAFF_TOKEN}` } },
      env,
    );
    assert.equal(res.status, 200);
    const audit = auditWrites(harness);
    assert.equal((audit[0] as { values: Record<string, unknown> }).values.ipAddress, null);
  });
});
