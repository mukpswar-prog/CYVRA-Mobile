import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { auditEvents, staffOperators } from "@cyvra/database/schema";

import {
  auditFiltersFor,
  parseAuditQuery,
  readAuditEvents,
  type AuditQuerySpec,
} from "../src/admin/audit.ts";
import {
  STAFF_TOKEN,
  mountAdmin,
  staffHarness,
  superAdminHarness,
} from "./helpers/adminHarness.ts";

/**
 * W5 PHASE 2b - READING THE AUDIT TRAIL.
 * ========================================
 *
 * `admin.ts` has never selected from `audit_events`, and `rbac.ts` said so
 * before this route existed: *"There is no audit-read route in Phase 1 - the
 * licence drawer's Audit Timeline is a later phase ... the route that
 * eventually serves it must consult this list rather than re-deciding what
 * LIMITED meant."* This file is that route's contract.
 *
 * Two sections, and they test different things on purpose.
 *
 * THE HTTP SURFACE asserts what an operator can *observe*: the status code,
 * the `scope` field that explains a short result set, and the refusal of a
 * malformed query. A trail that silently showed three rows would look like a
 * broken query rather than a policy, so `scope` is part of the contract and
 * not decoration.
 *
 * THE QUERY BUILDER asserts what an operator can *reach*. §41 marks "View
 * audit" for operators as LIMITED, and `LIMITED_AUDIT_ROLES` says that means
 * their own rows. That decision is made where the WHERE clause is built - not
 * in the handler - specifically so a second handler cannot forget it. The only
 * honest way to test it is therefore against the generated SQL: a test double
 * that *received* a where clause would pass whether that clause said
 * `actor_id = me` or said nothing at all. The rendered SQL is what Postgres
 * actually sees, and it is what the scoping is worth.
 */

const dialect = new PgDialect();

const SERIAL_ID = "11111111-1111-4111-8111-111111111111";
const OPERATOR_ID = "33333333-3333-4333-8333-333333333333";
const ACTOR_ID = "44444444-4444-4444-8444-444444444444";

/**
 * One audit row, plus the output of the LEFT JOIN on its own columns.
 *
 * `audit_events` has no `actor_email` column (schema.ts:613-640); one comment
 * in `admin.ts` claims it does and is wrong. The name is reachable only by
 * joining `staff_operators`, so the fixture carries the join's result rather
 * than a field the table does not have - the double does not perform joins, and
 * `staff_operators.id` is a primary key, so the join's only possible output is
 * this one nullable email.
 */
function auditRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    actorId: ACTOR_ID,
    actorRole: "LICENCE_ADMIN",
    actorEmail: "licadmin@cyvoriq.com",
    action: "LICENCE_REVOKED",
    entityType: "licence",
    entityId: SERIAL_ID,
    previousState: { status: "ISSUED" },
    newState: { status: "REVOKED" },
    ipAddress: "203.0.113.9",
    reason: "chargeback confirmed",
    createdAt: new Date("2026-10-02T12:00:00.000Z"),
    ...overrides,
  };
}

const BODIES = new WeakMap<Response, Promise<Record<string, unknown>>>();

function readJson(res: Response): Promise<Record<string, unknown>> {
  let cached = BODIES.get(res);
  if (!cached) {
    cached = res.json() as Promise<Record<string, unknown>>;
    BODIES.set(res, cached);
  }
  return cached;
}

function specOf(query: string): AuditQuerySpec {
  const result = parseAuditQuery(new URLSearchParams(query));
  if (!result.ok) throw new Error(`expected a spec, got: ${result.error}`);
  return result.spec;
}

function refusalFor(query: string): string {
  const result = parseAuditQuery(new URLSearchParams(query));
  if (result.ok) {
    throw new Error(`expected a refusal, got: ${JSON.stringify(result.spec)}`);
  }
  return result.error;
}

/* ---------------------------------------------------------------------- *
 * A recorder that captures the WHERE clause the builder was handed.
 *
 * Deliberately not the shared harness: `adminHarness` answers reads from one
 * row and deliberately does not apply predicates, so it can prove that a
 * response came back but never *why* it came back. Scoping is a "why".
 *
 * Answers the `staff_operators` probe from `knownActors` so that resolving an
 * `actor=<email>` filter reaches the trail, and returns no rows for the trail
 * itself - this double is for reading the predicate, not for asserting data.
 * ---------------------------------------------------------------------- */
interface Capture {
  table: unknown;
  where: unknown;
}

function recorder(knownActors: { id: string; email: string }[] = []) {
  const captured: Capture[] = [];
  const db = {
    select() {
      let table: unknown;
      const builder: Record<string, unknown> = {
        from(target: unknown) {
          table = target;
          return builder;
        },
        leftJoin() {
          return builder;
        },
        where(next: unknown) {
          if (table === auditEvents) captured.push({ table, where: next });
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit() {
          return builder;
        },
        offset() {
          return builder;
        },
        then(onFulfilled: unknown, onRejected: unknown) {
          const rows = table === staffOperators ? knownActors : [];
          return Promise.resolve(rows).then(
            onFulfilled as (value: unknown[]) => unknown,
            onRejected as (error: unknown) => unknown,
          );
        },
      };
      return builder;
    },
  };
  return { db, captured };
}

function predicateOf(captured: readonly Capture[]): { sql: string; params: unknown[] } {
  const first = captured[0];
  assert.ok(first, "expected a query against the trail");
  assert.ok(
    first.where !== undefined,
    "the query was handed no predicate, so nothing is being scoped",
  );
  return dialect.sqlToQuery(first.where as SQL);
}

/* ====================================================================== */

describe("parseAuditQuery - refusal", () => {
  it("refuses an unknown action and names both the token and the vocabulary", () => {
    const error = refusalFor("action=TOOK_A_BRIBE");
    assert.match(error, /Unknown value for "action"/);
    assert.match(error, /TOOK_A_BRIBE/, "the offending token must be named");
    assert.match(error, /Allowed: .*LICENCE_REVOKED/, "and so must the vocabulary");
  });

  it("refuses a pageSize it cannot serve rather than clamping it", () => {
    // The Phase 2 defect in miniature: `pageSize=1000` used to answer 100 rows
    // with a 200, and the register simply looked complete.
    const error = refusalFor("pageSize=1000");
    assert.match(error, /"pageSize" must be one of 25, 50, 100/);
    assert.match(error, /got "1000"/);
  });

  it("refuses a range that ends before it begins", () => {
    const error = refusalFor("from=2026-10-05&to=2026-10-01");
    assert.match(error, /"from" must not be after "to"/);
  });

  it("refuses an unparseable boundary rather than ignoring it", () => {
    // Ignoring `from=lastweek` would answer the whole trail while the reader
    // believed they had asked for a slice of it.
    assert.match(refusalFor("from=lastweek"), /"from" must be an ISO date/);
    assert.match(refusalFor("to=tomorrow"), /"to" must be an ISO date/);
  });

  it("refuses an entityId that is not a UUID", () => {
    assert.match(refusalFor("entityId=not-a-uuid"), /entityId must be a UUID/);
  });

  it("refuses a page that is not a positive whole number", () => {
    assert.match(refusalFor("page=abc"), /"page" must be a positive whole number/);
    assert.match(refusalFor("page=0"), /"page" starts at 1/);
  });
});

describe("parseAuditQuery - acceptance", () => {
  it("answers page 1 of 25 with no filters at all", () => {
    const spec = specOf("");
    assert.equal(spec.page, 1);
    assert.equal(spec.pageSize, 25);
    assert.equal(spec.entityId, null);
    assert.equal(spec.entityType, null);
    assert.equal(spec.actorEmail, null);
    assert.equal(spec.from, null);
    assert.equal(spec.to, null);
    assert.deepEqual(spec.action, []);
  });

  it("canonicalises action tokens case-insensitively", () => {
    assert.deepEqual(specOf("action=key_generated,licence_revoked").action, [
      "KEY_GENERATED",
      "LICENCE_REVOKED",
    ]);
    // Repeating a token must not produce a duplicate predicate.
    assert.deepEqual(specOf("action=KEY_GENERATED&action=key_generated").action, [
      "KEY_GENERATED",
    ]);
  });

  it("reads a bare date as a whole UTC day, so a boundary does not move", () => {
    const spec = specOf("from=2026-10-01&to=2026-10-03");
    assert.equal(spec.from?.toISOString(), "2026-10-01T00:00:00.000Z");
    // Inclusive end: a date picker's `to` means the whole of that day, and
    // reading it as midnight would drop every event after 00:00 on it.
    assert.equal(spec.to?.toISOString(), "2026-10-03T23:59:59.999Z");
  });

  it("honours an explicit timestamp instead", () => {
    const spec = specOf("from=2026-10-01T09:30:00.000Z");
    assert.equal(spec.from?.toISOString(), "2026-10-01T09:30:00.000Z");
  });
});

describe("auditFiltersFor - the echo", () => {
  it("reports what was asked for, and nothing when nothing was", () => {
    assert.deepEqual(auditFiltersFor(specOf("")), {});
    assert.deepEqual(
      auditFiltersFor(specOf("entityId=11111111-1111-4111-8111-111111111111&entityType=licence")),
      { entityId: SERIAL_ID, entityType: "licence" },
    );
    assert.deepEqual(auditFiltersFor(specOf("action=KEY_GENERATED&actor=ceo@cyvoriq.com")), {
      action: ["KEY_GENERATED"],
      actor: "ceo@cyvoriq.com",
    });
  });

  it("omits an empty action list rather than reporting a filter that matched everything", () => {
    const echoed = auditFiltersFor(specOf("from=2026-10-01"));
    assert.equal("action" in echoed, false);
    assert.equal("entityId" in echoed, false);
    assert.equal("actor" in echoed, false);
  });
});

/* ====================================================================== *
 * The scoping. This is the section that cannot be done over HTTP.
 * ====================================================================== */

describe("readAuditEvents - §41 LIMITED", () => {
  it("restricts an operator's rows to their own staff id", async () => {
    const { db, captured } = recorder();
    await readAuditEvents(db, specOf(""), { limited: true, actorId: OPERATOR_ID });

    const { sql, params } = predicateOf(captured);
    assert.ok(
      sql.includes("actor_id"),
      `the trail must be scoped by actor, got: ${sql}`,
    );
    assert.ok(
      params.includes(OPERATOR_ID),
      `the bound value must be the caller's own id, got: ${JSON.stringify(params)}`,
    );
  });

  it("leaves an unlimited caller unscoped", async () => {
    const { db, captured } = recorder();
    await readAuditEvents(db, specOf(""), { limited: false, actorId: OPERATOR_ID });

    assert.equal(
      captured[0]?.where,
      undefined,
      "an AUDITOR's unrestricted query must carry no actor predicate at all",
    );
  });

  it("narrows a requested actor rather than replacing the restriction", async () => {
    // The dangerous shape: `?actor=somebody-else` arriving at a LIMITED seat.
    // Overriding would return their rows; the conditions must AND so that the
    // request can only ever narrow what the seat already may see.
    const { db, captured } = recorder([{ id: ACTOR_ID, email: "alice@cyvoriq.com" }]);
    await readAuditEvents(
      db,
      specOf("actor=alice@cyvoriq.com"),
      { limited: true, actorId: OPERATOR_ID },
    );

    const { sql, params } = predicateOf(captured);
    assert.ok(params.includes(OPERATOR_ID), "own id must remain bound");
    assert.ok(params.includes(ACTOR_ID), "the requested actor must also be bound");
    assert.equal(
      (sql.match(/actor_id/g) ?? []).length,
      2,
      `expected two AND-ed actor predicates, got: ${sql}`,
    );
  });

  it("answers an empty page - not every row - when the seat has no staff id", () => {
    // Fail closed. `actor_id` is NULL for a super admin before their first
    // nomination, and "the rows they produced themselves" has no answer
    // without an identity. Returning the full trail on a failed lookup would
    // turn a bookkeeping gap into an authorisation failure in the worst
    // direction.
    const { db, captured } = recorder();
    const result = readAuditEvents(db, specOf(""), { limited: true, actorId: null });

    return result.then((outcome) => {
      assert.equal(outcome.ok, true);
      if (outcome.ok) {
        assert.equal(outcome.events.length, 0);
        assert.equal(outcome.total, 0);
      }
      assert.equal(captured.length, 0, "and the trail must not be queried at all");
    });
  });

  it("refuses an actor address that names nobody, instead of returning nothing", () => {
    // Silently matching zero rows would render as "this person did nothing" -
    // a claim about a human being, invented by an empty result set.
    const { db, captured } = recorder([]);
    const result = readAuditEvents(
      db,
      specOf("actor=nobody@cyvoriq.com"),
      { limited: false, actorId: null },
    );

    return result.then((outcome) => {
      assert.equal(outcome.ok, false);
      if (!outcome.ok) {
        assert.match(outcome.error, /Unknown "actor": nobody@cyvoriq\.com/);
      }
      assert.equal(captured.length, 0, "and no trail query may have run");
    });
  });
});

describe("readAuditEvents - the filter reaching the predicate", () => {
  it("turns ?entityId into an entity predicate, for the drawer's timeline", async () => {
    const { db, captured } = recorder();
    await readAuditEvents(
      db,
      specOf(`entityId=${SERIAL_ID}`),
      { limited: false, actorId: null },
    );

    const { sql, params } = predicateOf(captured);
    assert.ok(sql.includes("entity_id"), `predicate did not reach the column: ${sql}`);
    assert.ok(params.includes(SERIAL_ID));
  });

  it("turns a date range into two createdAt bounds", async () => {
    const { db, captured } = recorder();
    await readAuditEvents(
      db,
      specOf("from=2026-10-01&to=2026-10-03"),
      { limited: false, actorId: null },
    );

    const { sql, params } = predicateOf(captured);
    assert.ok(sql.includes("created_at"), `predicate did not reach the column: ${sql}`);
    assert.ok(sql.includes(">=") && sql.includes("<="), `expected two bounds: ${sql}`);
    assert.equal(params.length, 2);
  });

  it("turns selected actions into one OR-ed set, not one predicate per action", async () => {
    // Chained `eq` would AND to nothing, which reads as "no activity".
    const { db, captured } = recorder();
    await readAuditEvents(
      db,
      specOf("action=LICENCE_REVOKED,LICENCE_SUSPENDED"),
      { limited: false, actorId: null },
    );

    const { sql, params } = predicateOf(captured);
    assert.ok(sql.includes("action"), `predicate did not reach the column: ${sql}`);
    assert.equal(params.length, 2, `both actions must be bound: ${JSON.stringify(params)}`);
  });
});

/* ====================================================================== *
 * The HTTP surface: what an operator can observe.
 * ====================================================================== */

describe("GET /admin/audit - access", () => {
  it("refuses an unauthenticated caller", async () => {
    const { request } = mountAdmin(staffHarness("audit@cyvoriq.com", "AUDITOR"));
    const res = await request("/audit", {});
    assert.equal(res.status, 401);
  });

  it("lets an AUDITOR read the whole trail and says so", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", {
      auditRows: [auditRow()],
    });
    const { request } = mountAdmin(harness);

    const res = await request("/audit", { token: STAFF_TOKEN });
    assert.equal(res.status, 200);
    const body = await readJson(res);

    assert.equal(body.scope, "all");
    assert.equal(body.scopeActorId, null);
    assert.equal(body.actor, "audit@cyvoriq.com");
    assert.deepEqual((body.events as unknown[]).length, 1);
  });

  it("scopes an OPERATOR to themselves, and reports the scope so the page can explain it", async () => {
    // Without `scope`, three rows look like a broken query rather than a
    // policy - and "where is the rest of my audit log?" becomes a support
    // ticket instead of an answer.
    const harness = staffHarness("op@cyvoriq.com", "OPERATOR", {
      auditRows: [auditRow()],
    });
    const { request } = mountAdmin(harness);

    const res = await request("/audit", { token: STAFF_TOKEN });
    assert.equal(res.status, 200);
    const body = await readJson(res);

    assert.equal(body.scope, "self");
    assert.equal(body.scopeActorId, OPERATOR_ID);
  });

  it("gives a Super Admin the whole trail", async () => {
    const { request } = mountAdmin(superAdminHarness({ auditRows: [auditRow()] }));

    const res = await request("/audit", { token: STAFF_TOKEN });
    assert.equal(res.status, 200);
    const body = await readJson(res);
    assert.equal(body.scope, "all");
  });

  it("lets a LICENCE_ADMIN through the gate", async () => {
    const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
      auditRows: [auditRow()],
    });
    const { request } = mountAdmin(harness);
    const res = await request("/audit", { token: STAFF_TOKEN });
    assert.equal(res.status, 200);
    assert.equal((await readJson(res)).scope, "all");
  });
});

describe("GET /admin/audit - refusals", () => {
  it("400s an unknown action instead of returning every event", async () => {
    const { request } = mountAdmin(staffHarness("audit@cyvoriq.com", "AUDITOR"));
    const res = await request("/audit?action=TOOK_A_BRIBE", { token: STAFF_TOKEN });
    assert.equal(res.status, 400);
    assert.match(String((await readJson(res)).error), /Unknown value for "action"/);
  });

  it("400s pageSize=1000 rather than clamping it", async () => {
    const { request } = mountAdmin(staffHarness("audit@cyvoriq.com", "AUDITOR"));
    const res = await request("/audit?pageSize=1000", { token: STAFF_TOKEN });
    assert.equal(res.status, 400);
    assert.match(String((await readJson(res)).error), /must be one of 25, 50, 100/);
  });

  it("400s a range that ends before it begins", async () => {
    const { request } = mountAdmin(staffHarness("audit@cyvoriq.com", "AUDITOR"));
    const res = await request(
      "/audit?from=2026-10-05&to=2026-10-01",
      { token: STAFF_TOKEN },
    );
    assert.equal(res.status, 400);
    assert.match(String((await readJson(res)).error), /must not be after/);
  });

  it("400s an entityId that is not a UUID", async () => {
    const { request } = mountAdmin(staffHarness("audit@cyvoriq.com", "AUDITOR"));
    const res = await request("/audit?entityId=nope", { token: STAFF_TOKEN });
    assert.equal(res.status, 400);
    assert.match(String((await readJson(res)).error), /must be a UUID/);
  });
});

describe("GET /admin/audit - the pager", () => {
  it("carries every metadata key even when the trail is empty", async () => {
    // The Phase 2 promise, restated for a second endpoint: no response may omit
    // a count because the count is zero, or an absent block reads as "there is
    // no paging here" rather than "there is nothing to page".
    const { request } = mountAdmin(staffHarness("audit@cyvoriq.com", "AUDITOR"));
    const res = await request("/audit", { token: STAFF_TOKEN });
    assert.equal(res.status, 200);
    const body = await readJson(res);

    const pagination = body.pagination as Record<string, unknown>;
    for (const key of [
      "page",
      "pageSize",
      "offset",
      "returned",
      "total",
      "totalPages",
      "hasMore",
      "nextPage",
    ]) {
      assert.ok(key in pagination, `pagination is missing ${key}`);
    }
    assert.equal(pagination.returned, 0);
    assert.equal(pagination.total, 0);
    assert.equal(pagination.hasMore, false);
    assert.deepEqual(body.events, []);
    assert.deepEqual(body.filters, {});
  });

  it("echoes a filter that was applied, so the reader knows what they are looking at", async () => {
    const { request } = mountAdmin(staffHarness("audit@cyvoriq.com", "AUDITOR"));
    const res = await request(
      `/audit?entityId=${SERIAL_ID}&action=LICENCE_REVOKED`,
      { token: STAFF_TOKEN },
    );
    assert.equal(res.status, 200);
    assert.deepEqual((await readJson(res)).filters, {
      entityId: SERIAL_ID,
      action: ["LICENCE_REVOKED"],
    });
  });
});

describe("GET /admin/audit - the actor, since the table has no email column", () => {
  it("names the actor from the join, and leaves an unidentified one null", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", {
      auditRows: [
        auditRow(),
        auditRow({
          id: "66666666-6666-4666-8666-666666666666",
          actorId: null,
          actorRole: "SUPER_ADMIN",
          actorEmail: null,
          createdAt: new Date("2026-10-01T08:00:00.000Z"),
          action: "EXPORT_GENERATED",
        }),
      ],
    });
    const { request } = mountAdmin(harness);

    const res = await request("/audit", { token: STAFF_TOKEN });
    assert.equal(res.status, 200);
    const events = (await readJson(res)).events as Record<string, unknown>[];

    assert.equal(events.length, 2);
    assert.equal(events[0]?.actorEmail, "licadmin@cyvoriq.com");
    assert.equal(events[0]?.actorRole, "LICENCE_ADMIN");
    assert.equal(events[0]?.createdAt, "2026-10-02T12:00:00.000Z");

    // `actor_id` is NULL for a super admin before their first nomination, and
    // for a service credential. The name is genuinely unavailable - rendering
    // an address here would attribute an action to somebody who may not have
    // performed it. `actorRole` is what identifies those rows.
    assert.equal(events[1]?.actorId, null);
    assert.equal(events[1]?.actorEmail, null);
    assert.equal(events[1]?.actorRole, "SUPER_ADMIN");
  });

  it("returns the state snapshots that make a timeline readable", async () => {
    const { request } = mountAdmin(staffHarness("audit@cyvoriq.com", "AUDITOR", {
      auditRows: [auditRow()],
    }));

    const res = await request("/audit", { token: STAFF_TOKEN });
    assert.equal(res.status, 200);
    const [event] = (await readJson(res)).events as Record<string, unknown>[];

    assert.deepEqual(event?.previousState, { status: "ISSUED" });
    assert.deepEqual(event?.newState, { status: "REVOKED" });
    assert.equal(event?.reason, "chargeback confirmed");
    assert.equal(event?.entityType, "licence");
    assert.equal(event?.entityId, SERIAL_ID);
    assert.equal(event?.ipAddress, "203.0.113.9");
  });
});
