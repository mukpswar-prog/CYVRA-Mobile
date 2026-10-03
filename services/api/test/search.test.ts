import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  PAGE_SIZES,
  escapeLike,
  filtersFor,
  offsetOf,
  paginationFor,
  parseSerialQuery,
  serialQueryConditions,
  serialQueryWhere,
  type SerialQuerySpec,
} from "../src/admin/search.ts";

/**
 * PHASE 2 - SERVER-SIDE SEARCH (design plan §22).
 *
 * The contract this file is defending is one sentence from the brief: *the API
 * must make truncation impossible to ignore*. That is enforced in three places
 * and each gets its own tests below, because each of the three has historically
 * failed in its own way:
 *
 *   - the server used to CLAMP (`limit=1000` answered 100 with a 200);
 *   - the server used to DROP filters it could not parse, so a typo'd status
 *     looked exactly like "no results";
 *   - the response used to omit any field that happened to be zero.
 *
 * The last block renders the generated predicate through `PgDialect.sqlToQuery`
 * rather than asserting against a fake. That distinction matters: asserting
 * that the double received a `where` proves nothing about whether Drizzle
 * would emit a correlated `EXISTS` for the payment filter or a join that
 * doubles the count. The rendered SQL is what Postgres actually sees.
 */

const dialect = new PgDialect();

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

function render(spec: SerialQuerySpec): { sql: string; params: unknown[] } {
  const where = serialQueryWhere(spec);
  assert.ok(where, "a spec with at least one filter must produce a predicate");
  return dialect.sqlToQuery(where);
}

describe("parseSerialQuery - defaults", () => {
  it("answers page 1 of 25 for an empty query, with no filters at all", () => {
    const spec = specOf("");
    assert.equal(spec.page, 1);
    assert.equal(spec.pageSize, 25);
    assert.equal(spec.q, null);
    assert.deepEqual(spec.status, []);
    assert.deepEqual(spec.paymentStatus, []);
    assert.deepEqual(spec.planCode, []);
    assert.deepEqual(spec.customerKind, []);
    assert.deepEqual(spec.hostBinding, []);
  });

  it("accepts exactly the three named page sizes, and no others", () => {
    assert.deepEqual([...PAGE_SIZES], [25, 50, 100]);
    for (const size of PAGE_SIZES) {
      assert.equal(specOf(`pageSize=${size}`).pageSize, size);
    }
  });

  it("refuses pageSize=1000 rather than quietly serving 100", () => {
    const error = refusalFor("pageSize=1000");
    assert.match(error, /pageSize/);
    assert.match(error, /25, 50, 100/);
    assert.match(error, /1000/);
  });

  it("refuses a pageSize that is not one of the three instead of falling back", () => {
    assert.match(refusalFor("pageSize=abc"), /25, 50, 100/);
    assert.match(refusalFor("pageSize=30"), /25, 50, 100/);
    assert.match(refusalFor("pageSize=30"), /30/);
  });

  it('refuses the retired "limit" and "offset" parameters', () => {
    // Ignoring them would be the silent truncation one rename later: a client
    // still sending `limit=1000` would receive page 1 of 25 believing it asked
    // for more.
    assert.match(refusalFor("limit=1000"), /page.*pageSize/i);
    assert.match(refusalFor("offset=50"), /page.*pageSize/i);
  });

  it("refuses a page that is not a positive whole number", () => {
    assert.match(refusalFor("page=0"), /starts at 1/);
    assert.match(refusalFor("page=abc"), /whole number/);
    assert.match(refusalFor("page=-1"), /whole number/);
    assert.match(refusalFor("page=1.5"), /whole number/);
  });

  it("accepts a 200-character search and refuses a 201-character one", () => {
    const atLimit = "a".repeat(200);
    assert.equal(specOf(`q=${atLimit}`).q, atLimit);
    const error = refusalFor(`q=${"a".repeat(201)}`);
    assert.match(error, /200 characters/);
  });
});

describe("parseSerialQuery - filters are validated, never dropped", () => {
  it("reads a comma-delimited status list, case-insensitively", () => {
    assert.deepEqual(specOf("status=issued,ACTIVE").status, ["ISSUED", "ACTIVE"]);
  });

  it("merges repeated parameters and de-duplicates them", () => {
    const spec = specOf("status=ISSUED&status=ACTIVE&status=ISSUED");
    assert.deepEqual(spec.status, ["ISSUED", "ACTIVE"]);
  });

  it("names the offending token and the allowed set on a typo", () => {
    const error = refusalFor("status=ISSUED,TYPO");
    assert.match(error, /status/);
    assert.match(error, /TYPO/);
    assert.match(error, /ISSUED/);
    assert.match(error, /REVOKED/);
    // The exact shape a UI turns into a "did you mean" hint.
    assert.ok(error.startsWith('Unknown value for "status":'), error);
  });

  it("skips empty segments a UI naturally emits", () => {
    assert.deepEqual(specOf("status=ISSUED,,ACTIVE,").status, ["ISSUED", "ACTIVE"]);
  });

  it("validates every filter against its own enum", () => {
    assert.deepEqual(specOf("paymentStatus=PAID").paymentStatus, ["PAID"]);
    assert.deepEqual(specOf("planCode=CAP-1&planCode=CAP-50").planCode, [
      "CAP-1",
      "CAP-50",
    ]);
    assert.deepEqual(specOf("customerKind=bulk").customerKind, ["BULK"]);
    assert.deepEqual(specOf("hostBinding=REBIND_REQUEST").hostBinding, [
      "REBIND_REQUEST",
    ]);

    assert.match(refusalFor("paymentStatus=SETTLED"), /paymentStatus/);
    assert.match(refusalFor("planCode=FREE"), /planCode/);
    assert.match(refusalFor("customerKind=ENTERPRISE"), /customerKind/);
    assert.match(refusalFor("hostBinding=REBOOTING"), /hostBinding/);
  });

  it("keeps a search term verbatim apart from trimming", () => {
    assert.equal(specOf("q=%20%20acme%20%20").q, "acme");
    assert.equal(specOf("q=").q, null);
  });
});

describe("escapeLike - Postgres pattern syntax is neutralised", () => {
  it("escapes %, _ and \\", () => {
    assert.equal(escapeLike("100% Retail"), "100\\% Retail");
    assert.equal(escapeLike("a_b"), "a\\_b");
    assert.equal(escapeLike("back\\slash"), "back\\\\slash");
  });

  it("escapes the backslash first, so nothing is escaped twice", () => {
    // If `\` were replaced after `%`, the `%` below would already carry a
    // backslash of its own and be escaped a second time: `\%` -> `\\%`.
    assert.equal(escapeLike("\\%"), "\\\\\\%");
    assert.equal(escapeLike("%\\%"), "\\%\\\\\\%");
  });

  it("leaves an ordinary name alone", () => {
    assert.equal(escapeLike("acme retail pvt ltd"), "acme retail pvt ltd");
  });
});

describe("paginationFor - the answer always carries the count", () => {
  const base = specOf("page=1&pageSize=25");

  it("reports hasMore while rows remain beyond this response", () => {
    const page = paginationFor(base, 25, 60);
    assert.equal(page.total, 60);
    assert.equal(page.returned, 25);
    assert.equal(page.totalPages, 3);
    assert.equal(page.hasMore, true);
    assert.equal(page.nextPage, 2);
    assert.equal(page.offset, 0);
  });

  it("reports the last page as final rather than inviting another fetch", () => {
    const last = paginationFor({ ...base, page: 3 }, 10, 60);
    assert.equal(last.hasMore, false);
    assert.equal(last.nextPage, null);
    assert.equal(last.offset, 50);
    assert.equal(last.totalPages, 3);
  });

  it("answers 0 pages and no next page when nothing matches", () => {
    const none = paginationFor(base, 0, 0);
    assert.equal(none.total, 0);
    assert.equal(none.totalPages, 0);
    assert.equal(none.hasMore, false);
    assert.equal(none.nextPage, null);
  });

  it("carries every field on every response, including the zero ones", () => {
    // The omission case is the dangerous one: a `total` that disappears when
    // it is 0 reads as "no more data" rather than as "an error returned
    // nothing", and the two are not the same sentence.
    const page = paginationFor(base, 0, 0);
    assert.deepEqual(Object.keys(page).sort(), [
      "hasMore",
      "nextPage",
      "offset",
      "page",
      "pageSize",
      "returned",
      "total",
      "totalPages",
    ]);
  });

  it("derives the offset from page and size rather than storing it", () => {
    assert.equal(offsetOf(base), 0);
    assert.equal(offsetOf({ ...base, page: 2 }), 25);
    assert.equal(offsetOf({ ...base, page: 4, pageSize: 100 }), 300);
  });

  it("never reports hasMore when returned already accounts for every row", () => {
    // The off-by-one that makes a scroll bar twitch forever.
    assert.equal(paginationFor(base, 30, 30).hasMore, false);
    assert.equal(paginationFor(base, 31, 30).hasMore, false);
  });
});

describe("filtersFor - echoes what was actually asked", () => {
  it("is an empty object when no filter was applied", () => {
    assert.deepEqual(filtersFor(specOf("")), {});
  });

  it("omits filters that were never part of the question", () => {
    // `{status: []}` would read as "filtered on status, matched everything".
    const filters = filtersFor(specOf("q=acme"));
    assert.deepEqual(filters, { q: "acme" });
    assert.ok(!("status" in filters));
  });

  it("includes every filter that was applied", () => {
    const filters = filtersFor(
      specOf("q=acme&status=ISSUED&paymentStatus=PAID&hostBinding=BOUND"),
    );
    assert.deepEqual(filters, {
      q: "acme",
      status: ["ISSUED"],
      paymentStatus: ["PAID"],
      hostBinding: ["BOUND"],
    });
  });
});

describe("the generated predicate, as Postgres sees it", () => {
  it("OR-s the five search columns across one escaped pattern", () => {
    const { sql, params } = render(specOf("q=acme"));
    for (const column of [
      "customer_email",
      "customer_full_name",
      "company_name",
      "public_number",
    ]) {
      assert.ok(
        sql.includes(`"mobile_serials"."${column}" ilike`),
        `missing ${column} in ${sql}`,
      );
    }
    assert.equal(sql.split("ilike").length - 1, 5, "exactly five LIKE branches");
    assert.deepEqual(params, Array(5).fill("%acme%"));
  });

  it("casts the uuid column to text, since uuid ILIKE does not exist", () => {
    const { sql } = render(specOf("q=abc"));
    assert.ok(sql.includes('"mobile_serials"."id"::text ilike'), sql);
  });

  it("passes LIKE metacharacters through escaped, not as wildcards", () => {
    const { params } = render(specOf(`q=${encodeURIComponent("100% Retail")}`));
    // A customer literally named "100% Retail" would otherwise match every row
    // in the register - a correctness bug, not hardening.
    assert.deepEqual(params, Array(5).fill("%100\\% Retail%"));
  });

  it("adds an exact primary-key branch when the term is a whole uuid", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    const { sql, params } = render(specOf(`q=${uuid}`));
    // Pasting a full licence id is the one case where the PK index is worth
    // having; `%<uuid>%` alone would range-scan.
    assert.ok(sql.includes(`"mobile_serials"."id" = `), sql);
    assert.ok(params.includes(uuid), "the bare uuid must be a bound value");
    assert.equal(sql.split("ilike").length - 1, 5, "the text branch survives too");
  });

  it("compiles every filter to an IN over its own column", () => {
    const { sql, params } = render(
      specOf("status=ISSUED&status=ACTIVE&planCode=CAP-1&customerKind=BULK&hostBinding=BOUND"),
    );
    for (const column of [
      "licence_status",
      "plan_code",
      "customer_kind",
      "host_binding_status",
    ]) {
      assert.ok(sql.includes(`"mobile_serials"."${column}" in (`), column);
    }
    assert.deepEqual(params, ["ISSUED", "ACTIVE", "CAP-1", "BULK", "BOUND"]);
  });

  it("uses a correlated EXISTS for payment, never a join", () => {
    const { sql } = render(specOf("paymentStatus=PAID"));
    assert.ok(sql.includes("exists ("), sql);
    assert.ok(sql.includes("select 1 from payments"), sql);
    assert.ok(sql.includes("payments.licence_id = \"mobile_serials\".\"id\""), sql);
    // A JOIN would multiply `count(*)` by the number of payment rows a licence
    // has - `payments.licence_id` is indexed but not UNIQUE - and a total that
    // is larger than reality is the same defect as truncation.
    assert.ok(!/\bjoin\b/i.test(sql), `no JOIN expected: ${sql}`);
    assert.ok(!/select\s+\*/i.test(sql.replace(/select 1/, "")), "no row fan-out");
  });

  it("AND-s the search term with the filters rather than OR-ing them", () => {
    const { sql } = render(specOf("q=acme&status=ISSUED"));
    assert.ok(sql.includes('"mobile_serials"."licence_status" in'), sql);
    assert.ok(sql.includes("customer_email"), sql);
    assert.equal(serialQueryConditions(specOf("q=acme&status=ISSUED")).length, 2);
  });

  it("produces no predicate at all when nothing was asked", () => {
    const spec = specOf("");
    assert.equal(serialQueryWhere(spec), undefined);
    assert.deepEqual(serialQueryConditions(spec), []);
  });

  it("builds one condition list the row query and the count query can share", () => {
    // Two hand-built lists is how a page of 25 and a total of 0 come to
    // describe different questions - and `hasMore` stops being a fact.
    const spec = specOf("q=acme&status=ISSUED&paymentStatus=PAID");
    const conditions = serialQueryConditions(spec);
    assert.equal(conditions.length, 3);
    assert.equal(serialQueryConditions(spec).length, conditions.length);
  });
});
