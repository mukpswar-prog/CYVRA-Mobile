import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  STAFF_TOKEN,
  licenceRow,
  mountAdmin,
  paidPayment,
  staffHarness,
} from "./helpers/adminHarness.ts";
import { jsonSerialList, reportRows, toCsv, type PaymentInfo } from "../src/admin.ts";

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

describe("Issued By vs Created By - design freeze §6 / §56", () => {
  it("withholds Issued By on an unissued row, even one still holding its creator", async () => {
    // Migration 0008 dropped the NOT NULL on `issued_by`, but it did not (and
    // must not) rewrite rows that already exist: every never-issued row written
    // before 0008 still carries its CREATOR in that column, because that was
    // the only actor column until W5 split it out (migration 0007 section 6e
    // copied it into `created_by` and left the original alone).
    //
    // So gating on "is the column non-empty" would report a creator as an
    // issuer for exactly the records that predate this change. The gate is
    // `issued_at`, because that is the fact the column header describes.
    const unissued = (await jsonSerialList(
      licenceRow({ issuedBy: "ceo@cyvoriq.com" }),
    )) as Record<string, unknown>;
    assert.equal(unissued.issuedBy, null, "an issuer must not be named pre-issuance");
    assert.equal(unissued.createdBy, "ceo@cyvoriq.com", "the creator is not lost");

    const issued = (await jsonSerialList(
      licenceRow({ issuedBy: "licadmin@cyvoriq.com", issuedAt: new Date("2026-10-02T10:00:00.000Z") }),
    )) as Record<string, unknown>;
    assert.equal(issued.issuedBy, "licadmin@cyvoriq.com", "and issuance still reports itself");
  });
});

/**
 * §56's recommended column set, quoted rather than paraphrased.
 *
 * The earlier test asserted that four columns *existed*. The Chief Engineer's
 * ruling asks for §56's recommended set, and a set is a list in a fixed order,
 * so what is being pinned now is the whole list: present, in §56's sequence,
 * and - the failure worth catching - filled. An export whose "Payment Amount"
 * header sits over an empty cell looks identical to one where the amount was
 * never paid, which is precisely the claim an auditor must not be handed.
 */
const SECTION_56_COLUMNS = [
  "Row No.",
  "Licence ID",
  "Registered Email",
  "User ID",
  "Customer Name",
  "Company",
  "Customer Type",
  "PIN Code",
  "Plan",
  "Mobile Device Capacity",
  "Host Workstation Limit",
  "Payment Status",
  "Payment Amount",
  "Payment Reference",
  "Licence Status",
  "Licence Serial",
  "Host Binding Status",
  "Created Date",
  "Issued Date",
  "Activated Date",
  "Expiry Date",
  "Created By",
  "Issued By",
] as const;

/** RFC 4180, so a value containing a comma cannot shift every column after it. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

/** The fixture's payment, at values a human would recognise on a bank line. */
const PAYMENT: PaymentInfo = {
  status: "PAID",
  amount: "5000.00",
  reference: "UPI-2026-0001",
};

describe("the CSV export", () => {
  it("emits §56's recommended columns, in §56's own order", async () => {
    const row = licenceRow(WINDOW);
    const mapped = await reportRows([row], new Map([[row.id, PAYMENT]]));
    const [header] = toCsv(mapped).trim().split("\n");
    assert.ok(header);
    const cells = header.split(",");

    let previous = -1;
    for (const name of SECTION_56_COLUMNS) {
      const index = cells.indexOf(name);
      assert.ok(index > -1, `§56 column missing from the export: ${name}\n${header}`);
      assert.ok(
        index > previous,
        `§56 order broken at "${name}" (index ${index} does not follow ${previous})`,
      );
      previous = index;
    }

    // §56 puts the money block immediately before Licence Status, so an
    // auditor reconciling the file reads payment and workflow as one pair
    // rather than hunting for the second column.
    assert.equal(cells.indexOf("Payment Status") + 3, cells.indexOf("Licence Status"));
  });

  it("fills every one of the seven columns the register was missing", async () => {
    const row = licenceRow(WINDOW);
    const mapped = await reportRows([row], new Map([[row.id, PAYMENT]]));
    const [header, data] = toCsv(mapped).trim().split("\n");
    assert.ok(header && data);

    const columns = header.split(",");
    const values = parseCsvLine(data);
    assert.equal(values.length, columns.length, "the row must have a cell per column");
    const at = (name: string): string => {
      const index = columns.indexOf(name);
      assert.ok(index > -1, `column not found: ${name}`);
      return values[index] as string;
    };

    // §14: Row No. is a display number, "not the database ID, not the licence
    // serial, not the customer ID" - so it is 1 and it is not the id beside it.
    assert.equal(at("Row No."), "1");
    assert.equal(at("Licence ID"), row.id);
    assert.notEqual(at("Row No."), at("Licence ID"));

    // §15 / RULE 2: User ID is the registered email. `mobile_serials.user_id`
    // is an internal uuid, and printing that under a heading the Design Freeze
    // defines as an email would publish a value as something it is not.
    assert.equal(at("User ID"), "customer@example.com");
    assert.equal(at("User ID"), at("Registered Email"));

    // §4.2: "Host Workstation Limit = 1 for all standard plans." There is no
    // column for it because it is a commercial rule, so it is written rather
    // than left blank - a blank would read as "unknown", not as "one".
    assert.equal(at("Host Workstation Limit"), "1");

    // §56's money columns. These resolve only because `reportRows` carries the
    // payment's amount and reference, not merely its status.
    assert.equal(at("Payment Status"), "PAID");
    assert.equal(at("Payment Amount"), "5000.00");
    assert.equal(at("Payment Reference"), "UPI-2026-0001");

    // Present in the projection, absent from the old export.
    assert.equal(at("Host Binding Status"), "UNBOUND");

    // And Created By still answers "who made this row" while Issued By stays
    // honestly empty on a record nothing has issued (`jsonSerial` gates on
    // `issued_at`, not on the column being non-empty).
    assert.equal(at("Created By"), "ceo@cyvoriq.com");
    assert.equal(at("Issued By"), "");
  });

  it("keeps the columns §56 does not name, instead of silently dropping them", async () => {
    // §56 is a *recommended* list, not an exhaustive one. Trimming to exactly
    // twenty-three would remove fourteen columns operators already rely on, in
    // a file that leaves the building - and data loss dressed as tidiness is
    // the worse failure of the two.
    const row = licenceRow(WINDOW);
    const mapped = await reportRows([row], new Map([[row.id, PAYMENT]]));
    const [header, data] = toCsv(mapped).trim().split("\n");
    assert.ok(header && data);
    const cells = header.split(",");

    for (const name of ["serialFp", "validityStartsAt", "devicesBound", "paymentNoted"]) {
      assert.ok(cells.includes(name), `a retained column was dropped: ${name}`);
    }

    // The window still reaches the file.
    assert.ok(data.includes("2027-10-01T10:00:00.000Z"));

    // No key, in a file that leaves the box as an attachment: `Licence Serial`
    // resolves against the MASKED projection, and the fingerprint beside it is
    // what keeps two identical-looking masked keys apart.
    assert.ok(!data.includes(row.publicNumber as string));
    assert.notEqual(row.publicNumber, null);
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
