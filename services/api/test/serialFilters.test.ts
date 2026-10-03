import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  DELIVERY_STATUSES,
  filtersFor,
  parseSerialQuery,
  serialQueryConditions,
  serialQueryWhere,
  type SerialQuerySpec,
} from "../src/admin/search.ts";

/**
 * W5 PHASE 2b - THE TWO FILTERS THE DASHBOARD COULD NOT ASK FOR.
 * ===============================================================
 *
 * Design plan §65 asks for an "Expiring Soon" KPI and a "Failed Delivery" queue
 * item, and the Phase 3 brief requires BOTH to come from a server pagination
 * total rather than from the browser accumulating rows across pages. Without a
 * filter, the only way to produce either number is to fetch every page and
 * count client-side - which is exactly what the brief forbids, and which is
 * wrong the moment a page fails to load.
 *
 * The last block renders the generated predicate through `PgDialect.sqlToQuery`
 * rather than asserting against a double. The distinction matters: asserting
 * that a double *received* a where proves nothing about whether Drizzle would
 * emit two bounds or one, or whether `delivery=SENT,FAILED` would become a
 * contradiction. The rendered SQL is what Postgres actually sees.
 *
 * Three properties are defended here, one per section:
 *
 *   1. REFUSAL - a malformed window or an unknown delivery token is a 400 that
 *      says so, never 25 rows of everything. A filter silently ignored renders
 *      as "no deliveries failed", i.e. the opposite of the truth.
 *   2. TWO BOUNDS - `lte` alone would also match a licence that expired last
 *      year, putting long-dead records into an "Expiring Soon" card and
 *      inflating the number until it means nothing.
 *   3. OR, NOT AND - `delivery=SENT,FAILED` is a natural thing for a UI to
 *      emit, and AND-ing two mutually exclusive predicates matches no rows at
 *      all, with a 200 and a zero count.
 */

const dialect = new PgDialect();

/** One instant, so a horizon computed from it is reproducible. */
const NOW = new Date("2026-10-03T00:00:00.000Z");
/** NOW + 30 days. */
const HORIZON = new Date("2026-11-02T00:00:00.000Z");

function specOf(query: string): SerialQuerySpec {
  const result = parseSerialQuery(new URLSearchParams(query));
  if (!result.ok) throw new Error(`expected a spec, got: ${result.error}`);
  return result.spec;
}

function refusalFor(query: string): string {
  const result = parseSerialQuery(new URLSearchParams(query));
  if (result.ok) {
    throw new Error(`expected a refusal, got: ${JSON.stringify(result.spec)}`);
  }
  return result.error;
}

function render(spec: SerialQuerySpec, now?: Date): { sql: string; params: unknown[] } {
  const where = serialQueryWhere(spec, now);
  assert.ok(where, "a spec with at least one filter must produce a predicate");
  return dialect.sqlToQuery(where);
}

describe("parseSerialQuery - validityEndsWithinDays", () => {
  it("accepts a whole number of days and echoes nothing else", () => {
    const spec = specOf("validityEndsWithinDays=30");
    assert.equal(spec.validityEndsWithinDays, 30);
    // The other five filters must be untouched: a new parameter that quietly
    // added a second predicate would narrow every existing query.
    assert.deepEqual(spec.status, []);
    assert.deepEqual(spec.paymentStatus, []);
    assert.deepEqual(spec.delivery, []);
    assert.equal(spec.page, 1);
    assert.equal(spec.pageSize, 25);
  });

  it("is null when absent, so the parameter never narrows by default", () => {
    assert.equal(specOf("").validityEndsWithinDays, null);
    assert.equal(specOf("q=acme&status=ISSUED").validityEndsWithinDays, null);
  });

  it("refuses anything that is not a whole number of days", () => {
    // No blank entry: a present-but-empty value is treated as absent, which is
    // the convention `readPage` already applies to `page`. Differing from it
    // here would mean `?validityEndsWithinDays=` and `?page=` disagreed about
    // what "no value" means on the same request.
    for (const bad of ["0", "-1", "abc", "12.5", "30days", "+30"]) {
      const error = refusalFor(`validityEndsWithinDays=${encodeURIComponent(bad)}`);
      assert.match(
        error,
        /validityEndsWithinDays/,
        `expected ${JSON.stringify(bad)} to name the parameter, got: ${error}`,
      );
    }
  });

  it("refuses a window wider than the horizon the index can serve", () => {
    const error = refusalFor("validityEndsWithinDays=3651");
    assert.match(error, /between 1 and 3650/);
    // The value is named too: an error that only states a rule leaves the
    // caller guessing which of their inputs broke it.
    assert.match(error, /got "3651"/);
  });
});

describe("parseSerialQuery - delivery", () => {
  it("accepts the two documented states, singly or together", () => {
    assert.deepEqual(specOf("delivery=FAILED").delivery, ["FAILED"]);
    assert.deepEqual(specOf("delivery=SENT").delivery, ["SENT"]);
    assert.deepEqual(specOf("delivery=SENT,FAILED").delivery, ["SENT", "FAILED"]);
    assert.deepEqual(specOf("").delivery, []);
    assert.deepEqual(DELIVERY_STATUSES, ["SENT", "FAILED"]);
  });

  it("refuses an unknown token rather than dropping it", () => {
    // The defect this pins: a filter quietly discarded renders as "no delivery
    // problems", which is the exact opposite of the truth, on a 200 with a
    // zero count.
    const error = refusalFor("delivery=BOUNCED");
    assert.match(error, /Unknown value for "delivery"/);
    assert.match(error, /BOUNCED/, "the offending token must be named");
    assert.match(error, /Allowed: SENT, FAILED/, "and so must the vocabulary");
  });
});

describe("serialQueryConditions - the clock", () => {
  it("throws loudly when a window is asked for without a clock", () => {
    // A window with no `now` cannot be resolved. The two ways to handle that
    // are to throw or to emit nothing - and emitting nothing renders as an
    // empty "Expiring Soon" card, which is indistinguishable from "nothing
    // expires soon" and which an operator would reasonably believe.
    const spec = specOf("validityEndsWithinDays=30");
    assert.throws(
      () => serialQueryConditions(spec),
      /"now" is required when validityEndsWithinDays is set/,
    );
  });

  it("adds nothing at all when the filter is absent, even with a clock", () => {
    // `search.test.ts` pins `serialQueryConditions(specOf("")).length === 0`
    // and `filtersFor(specOf(""))` deep-equal to `{}`. The parameter is
    // optional precisely so those two keep passing untouched, and this is the
    // regression that would break them if a default crept in.
    //
    // Lengths rather than `deepEqual` for the positive case: a SQL predicate
    // object graph is large enough that diffing one against `[]` takes a
    // minute and produces no useful message.
    assert.equal(serialQueryConditions(specOf(""), NOW).length, 0);
    // `q=acme` still yields exactly its own search predicate and nothing more:
    // a clock must not conjure a second condition.
    assert.equal(serialQueryConditions(specOf("q=acme"), NOW).length, 1);
    assert.deepEqual(filtersFor(specOf("")), {});
    assert.deepEqual(filtersFor(specOf("q=acme&status=ISSUED")), {
      q: "acme",
      status: ["ISSUED"],
    });
  });
});

describe("the expiry window, as Postgres sees it", () => {
  it("is two bounds, so an already-expired licence cannot enter the KPI", () => {
    const { sql, params } = render(specOf("validityEndsWithinDays=30"), NOW);

    assert.ok(sql.includes("validity_ends_at"), `predicate did not reach the column: ${sql}`);
    assert.ok(sql.includes(">="), `missing lower bound: ${sql}`);
    assert.ok(sql.includes("<="), `missing upper bound: ${sql}`);
    assert.equal(
      params.length,
      2,
      `expected exactly two bound values, got ${JSON.stringify(params)}`,
    );
    // Drizzle serialises a Date on the way out of `sqlToQuery`, so the bound
    // values arrive as ISO-8601 strings rather than as Dates. Asserting the
    // type instead of the value would pass while the wrong instant was bound.
    assert.ok(
      params.includes(NOW.toISOString()),
      `the lower bound must be the injected clock, got: ${JSON.stringify(params)}`,
    );
    assert.ok(
      params.includes(HORIZON.toISOString()),
      `the upper bound must be the resolved horizon, got: ${JSON.stringify(params)}`,
    );
  });

  it("resolves the horizon from the injected clock, not from the wall clock", () => {
    // A test that let the route read `new Date()` would pass at 00:00 and fail
    // at 23:59, and would silently drift with every CI run. The clock is a
    // parameter so the arithmetic is a pure function of it.
    const later = new Date("2026-12-31T12:00:00.000Z");
    const { params } = render(specOf("validityEndsWithinDays=1"), later);
    assert.ok(
      params.includes(new Date("2027-01-01T12:00:00.000Z").toISOString()),
      `horizon did not follow the injected clock: ${JSON.stringify(params)}`,
    );
    assert.ok(
      !params.includes(HORIZON.toISOString()),
      "the horizon must not be a value the wall clock happened to produce",
    );
  });
});

describe("delivery, as Postgres sees it", () => {
  it("FAILED selects rows whose email_error is present", () => {
    const { sql } = render(specOf("delivery=FAILED"));
    assert.ok(sql.includes("email_error"), `predicate did not reach the column: ${sql}`);
    assert.ok(sql.includes("is not null"), `expected IS NOT NULL: ${sql}`);
    assert.equal(
      (sql.match(/email_error/g) ?? []).length,
      1,
      "one predicate, not a compound that could contradict itself",
    );
  });

  it("SENT means emailed AND not errored", () => {
    const { sql } = render(specOf("delivery=SENT"));
    assert.ok(sql.includes("emailed_at"), `missing the timestamp half: ${sql}`);
    assert.ok(sql.includes("email_error"), `missing the error half: ${sql}`);
    assert.ok(sql.includes("is null"), `expected IS NULL: ${sql}`);
    // Both halves must be present and AND-ed: `emailed_at IS NOT NULL` alone
    // would include a licence that was sent once, failed, and is sitting in
    // the failed queue.
    assert.ok(sql.includes("and"), `expected both halves AND-ed: ${sql}`);
  });

  it("SENT,FAILED does not become a contradiction that matches nothing", () => {
    // `delivery=SENT,FAILED` is what a UI emits for "show me everything whose
    // delivery I should look at". AND-ing the two predicates yields
    // `email_error IS NULL AND email_error IS NOT NULL`, which matches no rows
    // - answered with a 200 and a zero count, i.e. presented as "no delivery
    // problems". One predicate must win.
    const { sql } = render(specOf("delivery=SENT,FAILED"));
    assert.equal(
      (sql.match(/email_error/g) ?? []).length,
      1,
      `expected one delivery predicate, got: ${sql}`,
    );
    assert.ok(sql.includes("is not null"), `FAILED must be the surviving half: ${sql}`);
    assert.ok(
      !sql.includes("is null"),
      `SENT's half must be gone, otherwise the two contradict: ${sql}`,
    );
  });

  it("does not add a delivery predicate when the filter is absent", () => {
    const { sql } = render(specOf("status=ISSUED"));
    assert.ok(!sql.includes("email_error"), `unexpected delivery filter: ${sql}`);
    assert.ok(!sql.includes("emailed_at"), `unexpected delivery filter: ${sql}`);
  });
});

describe("filtersFor - the echo", () => {
  it("reports each new filter only when it was actually asked for", () => {
    assert.deepEqual(filtersFor(specOf("delivery=FAILED")), { delivery: ["FAILED"] });
    assert.deepEqual(filtersFor(specOf("validityEndsWithinDays=30")), {
      validityEndsWithinDays: 30,
    });
    assert.deepEqual(filtersFor(specOf("delivery=SENT&validityEndsWithinDays=7")), {
      delivery: ["SENT"],
      validityEndsWithinDays: 7,
    });
  });

  it("omits them entirely rather than sending null, which reads as a filter that failed", () => {
    // `{validityEndsWithinDays: null}` says "expiry was asked about and got no
    // answer". Omitting it says expiry was never part of the question. The
    // existing five filters already omit; these two must match.
    const echoed = filtersFor(specOf("status=ACTIVE"));
    assert.equal("validityEndsWithinDays" in echoed, false);
    assert.equal("delivery" in echoed, false);
  });
});
