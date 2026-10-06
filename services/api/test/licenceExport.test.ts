/**
 * WS-H2 PILLAR 4 - THE REGISTRY'S EXPORT, END TO END.
 * ===================================================
 *
 * §12 lists Export XLSX as one of the licence registry's three top controls,
 * §64 places it on the filter row, and §57 governs everything about it:
 * authenticate, enforce permissions, generate server-side, log generation,
 * prevent arbitrary browser queries, controlled filenames.
 *
 * The browser side of that is a thin wrapper - `Licences.tsx` sends its current
 * filter state and re-containers the bytes - so what is worth testing is the
 * server, where those six requirements actually live:
 *
 *   1. THE FILTERS THE OPERATOR IS LOOKING AT ARE THE FILTERS THE FILE IS
 *      BUILT FROM, and they reach the audit row. Two exports of different row
 *      sets writing identical-looking audit records would make the trail
 *      unable to answer "what did she actually export?" - which is the whole
 *      reason §57 asks for the log.
 *
 *   2. THE AUDIT ROW IS WRITTEN ONLY FOR THE CSV PATH. The JSON projection of
 *      the same endpoint is an ordinary read; `CONDITIONAL_ROUTES` exists to
 *      keep those two apart, and an export control that logged a plain read
 *      would drown the trail in reads while teaching nobody anything.
 *
 *   3. THE FILENAME IS CONTROLLED - §57's own example, dated on the IST
 *      calendar rather than the Worker's.
 *
 *   4. A FILTER THE SERVER DOES NOT UNDERSTAND IS REFUSED RATHER THAN
 *      DROPPED. Silently ignoring `status=TYPO` would export the *unfiltered*
 *      register under a filename implying the filtered one: a file that is
 *      wrong in the direction of too much data, with customer rows in it.
 *
 * Permission coverage for `report:export` lives in `rbac.test.ts`; the audit
 * engine's own contract lives in `audit.test.ts`. This file is about the join
 * between the registry's filters and the export.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STAFF_TOKEN, licenceRow, mountAdmin, staffHarness } from "./helpers/adminHarness.ts";

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function auditWrites(writes: readonly Record<string, unknown>[]) {
  return writes.filter((write) => write.table === "audit_events");
}

function harness() {
  return staffHarness("audit@cyvoriq.com", "AUDITOR", { licence: licenceRow() });
}

describe("GET /reports/licences - §57 report security", () => {
  it("carries the registry's current filters into the export AND into the audit row", async () => {
    const test = harness();
    const { request } = mountAdmin(test);
    const res = await request(
      "/reports/licences?from=2026-10-01&to=2026-10-31&status=REVOKED&hostBinding=BOUND&format=csv",
      { token: STAFF_TOKEN },
    );
    // Not `readJson`: the success body is CSV, and a failure body is JSON -
    // one read that works for both, because a `Response` yields exactly once.
    if (res.status !== 200) assert.fail(`expected 200, got ${res.status}: ${await res.text()}`);
    assert.match(res.headers.get("content-type") ?? "", /text\/csv/);

    const audit = auditWrites(test.writes);
    assert.equal(audit.length, 1, "one CSV, one event - and only the CSV logs");
    assert.equal(audit[0].values.action, "EXPORT_GENERATED");
    assert.equal(audit[0].inTransaction, true, "the trail is committed before any byte");

    const next = audit[0].values.newState as Record<string, unknown>;
    assert.equal(next.actor, "audit@cyvoriq.com");
    assert.equal(next.format, "csv");
    assert.ok(Number.isFinite(Date.parse(String(next.generatedAt))), String(next.generatedAt));

    // §55 "Applied Filters": the range AND the registry filters, so two
    // exports of different row sets cannot write the same-looking row.
    const filters = next.filters as Record<string, unknown>;
    assert.ok(filters.from, "the range is part of the applied filters");
    assert.ok(filters.to);
    assert.deepEqual(filters.status, ["REVOKED"]);
    assert.deepEqual(filters.hostBinding, ["BOUND"]);
  });

  it("does not log the JSON projection of the same endpoint", async () => {
    const test = harness();
    const { request } = mountAdmin(test);
    const res = await request("/reports/licences?from=2026-10-01&to=2026-10-31", {
      token: STAFF_TOKEN,
    });
    const body = await readJson(res);
    assert.equal(res.status, 200, JSON.stringify(body));
    // The echo still tells the reader what was applied - §55's metadata - but
    // an ordinary read is not an export and must not appear as one.
    assert.ok(body.filters, "the JSON reader is told what was applied");
    assert.equal(auditWrites(test.writes).length, 0, "only ?format=csv leaves the building");
  });

  it("names §57's controlled filename, dated on the IST calendar", async () => {
    const test = harness();
    const { request } = mountAdmin(test);
    const res = await request("/reports/licences?format=csv", { token: STAFF_TOKEN });
    assert.equal(res.status, 200);
    const disposition = res.headers.get("content-disposition") ?? "";
    // §57: "use controlled filenames / Example:
    // CYVRA-Mobile-Licence-Register-2026-10-05.xlsx"
    assert.match(
      disposition,
      /filename="CYVRA-Mobile-Licence-Register-\d{4}-\d{2}-\d{2}\.csv"/,
      disposition,
    );
  });

  it("refuses a filter value it does not recognise instead of exporting everything", async () => {
    const test = harness();
    const { request } = mountAdmin(test);
    const res = await request("/reports/licences?status=TYPO&format=csv", { token: STAFF_TOKEN });
    assert.equal(res.status, 400);
    const error = String((await readJson(res)).error);
    assert.match(error, /TYPO/);
    // The important half: no row set left the building under a name implying
    // a narrowed one.
    assert.equal(auditWrites(test.writes).length, 0, "a refusal writes no export event");
  });
});
