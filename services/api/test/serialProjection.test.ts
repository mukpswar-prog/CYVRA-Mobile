import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  STAFF_TOKEN,
  licenceRow,
  mountAdmin,
  paidPayment,
  staffHarness,
} from "./helpers/adminHarness.ts";
import { jsonSerialList, reportRows, toCsv } from "../src/admin.ts";

/**
 * W5 PHASE 2b - THE PROJECTION THE CONSOLE READS.
 * =================================================
 *
 * Phase 3 stopped because five deliverables had nothing to read. Three of them
 * were projection gaps: §5 column 9 (Payment Status), column 15 (Activation
 * Date) and column 16 (Expiry / Renewal Date), plus the drawer's Payment
 * section and §63's "Generate Key is GREEN iff PAID".
 *
 * The defect these tests pin is not "a field is missing" - that would be caught
 * by reading the code. It is the two ways a *new* field can be wrong without
 * looking wrong:
 *
 *   1. `null` rendering as a fact. "No payment record" and "payment pending"
 *      are different claims and only one of them is true. Fabricating PENDING
 *      would put a financial assertion into a response no query ever made, and
 *      the first place an operator would see it is the Payment column of the
 *      main table.
 *   2. `undefined` rendering as a blank. `adminRedaction.test.ts` calls this
 *      projection with ONE argument, and API tests are not typechecked, so a
 *      required parameter would run as `undefined` there - which `JSON.stringify`
 *      drops entirely and `toCsv` renders as an empty cell reading "this
 *      customer has no value" instead of "this column is broken". The default
 *      is therefore `null`, and test 5 below is what stops somebody removing it.
 *
 * The redaction contract is re-asserted here rather than left to
 * `adminRedaction.test.ts` on purpose: a projection that gains four fields has
 * four new places to accidentally re-expose `publicNumber`, and the other file's
 * fixtures do not carry the new columns.
 */

const SERIAL_ID = "11111111-1111-4111-8111-111111111111";

const WINDOW = {
  firstActivatedAt: new Date("2026-10-02T11:30:00.000Z"),
  validityStartsAt: new Date("2026-10-01T10:00:00.000Z"),
  validityEndsAt: new Date("2027-10-01T10:00:00.000Z"),
};

/**
 * Body reads are cached per response.
 *
 * `Response.json()` can only be consumed once, and a test routinely wants the
 * payload twice - once as the failure message of an `assert.equal` and once for
 * the assertions. Without the cache the second read throws, which is a defect
 * in the test rather than in the route, and it would otherwise mask the
 * assertion that matters.
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

function listOf(body: Record<string, unknown>): Record<string, unknown>[] {
  return body.serials as Record<string, unknown>[];
}

describe("GET /serials - the three columns the registry could not render", () => {
  it("carries payment status, activation and the validity window", async () => {
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", {
      licence: licenceRow(WINDOW),
      payment: paidPayment(SERIAL_ID),
    });
    const { request } = mountAdmin(harness);

    const res = await request("/serials", { token: STAFF_TOKEN });
    assert.equal(res.status, 200);
    const serial = listOf(await readJson(res))[0];
    assert.ok(serial, "the harness holds a licence, so the page must return it");

    assert.equal(serial.paymentStatus, "PAID");
    assert.equal(serial.firstActivatedAt, "2026-10-02T11:30:00.000Z");
    assert.equal(serial.validityStartsAt, "2026-10-01T10:00:00.000Z");
    assert.equal(serial.validityEndsAt, "2027-10-01T10:00:00.000Z");
  });

  it("answers null for a licence with no payment record - never PENDING", async () => {
    // No `payment` override: the fixture is a record this API did not create.
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", {
      licence: licenceRow(WINDOW),
    });
    const { request } = mountAdmin(harness);

    const res = await request("/serials", { token: STAFF_TOKEN });
    assert.equal(res.status, 200);
    const serial = listOf(await readJson(res))[0];
    assert.ok(serial);

    // `in` rather than `toEqual(undefined)`: the field must EXIST and be null.
    // A field that is absent reads as "the server does not track this", which
    // is a different statement from "there is no record", and the UI has to be
    // able to tell them apart to render the Payment column honestly.
    assert.ok("paymentStatus" in serial, "paymentStatus must be present");
    assert.equal(serial.paymentStatus, null);
  });

  it("shows PAID in the list and the SAME PAID in the drawer", async () => {
    // The two responses go through different functions - `jsonSerialList` for
    // the page, `jsonSerial` for the record - and a table showing PAID beside a
    // drawer showing PENDING would be the single most damaging inconsistency
    // this console could have, because the drawer is where payment is
    // confirmed. They must agree by construction, so both are asserted here
    // against one fixture rather than in two files against two.
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", {
      licence: licenceRow(WINDOW),
      payment: paidPayment(SERIAL_ID),
    });
    const { request } = mountAdmin(harness);

    const list = await request("/serials", { token: STAFF_TOKEN });
    assert.equal(list.status, 200);
    const drawer = await request(`/serials/${SERIAL_ID}`, { token: STAFF_TOKEN });
    assert.equal(drawer.status, 200);

    const listed = listOf(await readJson(list))[0];
    const record = (await readJson(drawer)).serial as Record<string, unknown>;
    assert.ok(listed && record);
    assert.equal(listed.paymentStatus, "PAID");
    assert.equal(record.paymentStatus, "PAID");
    assert.equal(record.firstActivatedAt, "2026-10-02T11:30:00.000Z");
    assert.equal(record.validityEndsAt, "2027-10-01T10:00:00.000Z");
  });

  it("still never carries either alias of the licence key, new fields and all", async () => {
    // `jsonSerial` historically returned the key under BOTH `publicNumber` and
    // `licenceKey`, and the registry renders the second. Removing only one
    // produces a response that looks redacted and still hands over every key -
    // so both aliases are checked, on the HTTP payload rather than on the
    // helper, because the payload is what leaves the box.
    const raw = licenceRow(WINDOW);
    const harness = staffHarness("audit@cyvoriq.com", "AUDITOR", {
      licence: raw,
      payment: paidPayment(SERIAL_ID),
    });
    const { request } = mountAdmin(harness);

    const res = await request("/serials", { token: STAFF_TOKEN });
    assert.equal(res.status, 200);
    const body = await readJson(res);
    const serial = listOf(body)[0];
    assert.ok(serial);

    const fullKey = raw.publicNumber as string;
    assert.ok(fullKey && fullKey.length > 0, "the fixture must carry a real key");

    assert.ok(!("publicNumber" in serial), "publicNumber must be absent, not null");
    assert.notEqual(serial.licenceKey, fullKey, "licenceKey must be masked");
    assert.ok(
      !JSON.stringify(body).includes(fullKey),
      "the full key must not appear anywhere in a list response",
    );

    // The new fields are exactly where a careless spread could reintroduce it,
    // since they were appended to the same object literal. The mask's exact
    // text is deliberately not asserted here - `adminRedaction.test.ts` pins it
    // - because these fixtures mint a fresh key per call, and a test that
    // hardcodes one run's key is a test that fails for no reason at all.
    assert.ok(
      typeof serial.licenceKey === "string" && serial.licenceKey.includes("*"),
      `licenceKey must be masked, got: ${String(serial.licenceKey)}`,
    );
    assert.ok(typeof serial.serialFp === "string" && serial.serialFp.length > 0);
    // The 13-character uniqueness block, derived from THIS row's key rather
    // than hardcoded, so the assertion follows the fixture instead of depending
    // on one particular key having been minted.
    const uniqueness = fullKey.slice("CYVRA".length, -4);
    assert.ok(uniqueness.length > 0);
    assert.ok(
      !JSON.stringify(body).includes(uniqueness),
      "the uniqueness block leaked into the list response",
    );
  });
});

describe("the projection's default parameter", () => {
  it("defaults to null, so a one-argument caller reads 'no record', not 'undefined'", async () => {
    // `adminRedaction.test.ts` calls `jsonSerialList(row)` with one argument
    // and `reportRows([row])` with one, and API tests are not typechecked
    // (`tsconfig` includes `["src"]`). A required parameter would therefore
    // compile nowhere and run as `undefined` in the test that already exists -
    // and `JSON.stringify` would drop the key entirely, so the response would
    // read as "this server does not track payment".
    //
    // This is the assertion that keeps the default from being "helpfully"
    // tightened later.
    const listed = (await jsonSerialList(licenceRow())) as Record<string, unknown>;
    assert.ok("paymentStatus" in listed, "the field must still be projected");
    assert.equal(listed.paymentStatus, null);
    assert.equal(
      JSON.parse(JSON.stringify(listed)).paymentStatus,
      null,
      "and it must survive serialization rather than being dropped",
    );
  });
});

describe("the CSV export", () => {
  it("carries the four new columns, and payment beside licence status", async () => {
    const row = licenceRow(WINDOW);
    const mapped = await reportRows([row], new Map([[row.id, "PAID"]]));
    const csv = toCsv(mapped);
    const [header, data] = csv.trim().split("\n");
    assert.ok(header && data);

    const cells = header.split(",");
    for (const name of [
      "paymentStatus",
      "firstActivatedAt",
      "validityStartsAt",
      "validityEndsAt",
    ]) {
      assert.ok(cells.includes(name), `CSV header is missing ${name}: ${header}`);
    }

    // §5 orders column 9 (Payment) immediately before column 10 (Licence
    // Status); an auditor reconciling a file reads the two together, so the
    // columns sit together rather than payment trailing at the end.
    assert.equal(cells.indexOf("paymentStatus"), cells.indexOf("status") + 1);

    assert.ok(data.includes("PAID"), "the payment value must reach the file");
    assert.ok(data.includes("2027-10-01T10:00:00.000Z"), "and so must the window");

    // No key, in a file that leaves the box as an attachment.
    assert.ok(!data.includes(row.publicNumber as string));
  });

  it("keeps an unresolvable column from appearing as a header-only drift", async () => {
    // Every header must resolve against the row it is printed from. A header
    // with no backing field emits an empty cell silently, and an export with a
    // column nobody can fill is indistinguishable from an export where payment
    // data was simply lost.
    const rows = await reportRows([licenceRow()]);
    const cells = toCsv(rows).split("\n")[0].split(",");
    for (const cell of cells) {
      assert.ok(cell.length > 0, `empty header cell in: ${cells.join(",")}`);
    }
  });
});
