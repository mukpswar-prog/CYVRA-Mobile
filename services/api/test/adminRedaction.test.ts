/**
 * The list endpoint must not leak the licence key.
 *
 * The bug this pins is subtle and worth stating plainly: `jsonSerial` returns
 * the full key under **two** names, `publicNumber` and `licenceKey`
 * (admin.ts L70-71), and the ops table renders the second. Removing only
 * `publicNumber` produces a response that looks redacted, passes a casual
 * review, and still hands over every key.
 *
 * `maskSerialKey` / `jsonSerialList` are exported solely so that contract can
 * be asserted here rather than assumed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { mobileSerials } from "@cyvra/database/schema";

import { CSV_COLUMNS, jsonSerialList, maskSerialKey, reportRows, toCsv } from "../src/admin.js";

type Row = typeof mobileSerials.$inferSelect;

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "30c5638d-e17d-43ee-9f0f-eddb4bba3696",
    publicNumber: "CYVRA01102026SA3F1-1-5",
    status: "ISSUED",
    customerEmail: "customer@example.invalid",
    userId: null,
    paymentNoted: "paid by transfer",
    issuedBy: "ceo@cyvoriq.com",
    issuedAt: new Date("2026-10-01T12:00:00.000Z"),
    revokedAt: null,
    createdAt: new Date("2026-10-01T11:00:00.000Z"),
    customerKind: "SINGLE",
    deviceMax: 5,
    brandScope: "SAMSUNG",
    customerFullName: "Test Customer",
    companyName: null,
    addressLine1: null,
    addressLine2: null,
    pincode: null,
    state: null,
    requestedAt: null,
    devicesBound: 2,
    emailedAt: null,
    emailMessageId: null,
    emailError: null,
    hostFingerprint: null,
    firstActivatedAt: null,
    deviceTokenHash: null,
    // W5 columns (migration 0007_w5_admin_control_plane). Omitting any of
    // these makes the fixture `Partial`-incomplete: every property then comes
    // only from `overrides`, so it widens to `T | undefined` and stops being a
    // faithful `mobile_serials` row.
    createdBy: "ceo@cyvoriq.com",
    generatedBy: "ceo@cyvoriq.com",
    approvedBy: "ceo@cyvoriq.com",
    hostBindingStatus: "NOT_BOUND",
    planCode: "CAP-5",
    validityStartsAt: null,
    validityEndsAt: null,
    updatedBy: null,
    rowVersion: 1,
    ...overrides,
  };
}

test("maskSerialKey hides the 13 characters that make a key unique", () => {
  const masked = maskSerialKey("CYVRA01102026SA3F1-1-5");
  assert.equal(masked, "CYVRA*************-1-5");
  assert.ok(!masked.includes("A3F1"), "uniqueness nibble is gone");
  assert.ok(!masked.includes("01102026"), "issue date is gone");
  assert.ok(masked.endsWith("-1-5"), "slab stays readable for the queue");
});

test("maskSerialKey fails safe on anything it does not recognise", () => {
  for (const odd of ["", "not-a-key", "CYVRA", "CYVRA11092026SA3F1-1-9"]) {
    const masked = maskSerialKey(odd);
    assert.ok(masked.startsWith("CYVRA"), `got: ${masked}`);
    assert.ok(!/SA3F1|[0-9]{8}/.test(masked), `leaked from ${odd}: ${masked}`);
  }
});

test("the list projection drops BOTH aliases of the full key", async () => {
  const source = row();
  // `public_number` is nullable from W5 so a DRAFT record can exist with no key
  // (decision A1). This fixture carries one, and asserting that it is absent
  // from the projection is meaningless otherwise - hence the explicit check
  // rather than a `?? ""`, which would make the leak assertion trivially true.
  const fullKey = source.publicNumber;
  assert.ok(fullKey !== null, "fixture must carry a key");
  const listed = (await jsonSerialList(source)) as Record<string, unknown>;

  assert.ok(
    !("publicNumber" in listed),
    "publicNumber must not be present in a list response",
  );
  assert.equal(listed.licenceKey, "CYVRA*************-1-5");

  const asJson = JSON.stringify(listed);
  assert.ok(!asJson.includes(fullKey), "full key leaked");
  assert.ok(!asJson.includes("A3F1"), "uniqueness nibble leaked");
  assert.ok(!asJson.includes("01102026"), "issue date leaked");
});

test("the list projection still carries what the queue needs to render", async () => {
  const listed = (await jsonSerialList(row())) as Record<string, unknown>;

  assert.equal(listed.serialId, "30c5638d-e17d-43ee-9f0f-eddb4bba3696");
  assert.equal(listed.status, "ISSUED");
  assert.equal(listed.slabLabel, "1-5");
  assert.equal(listed.customerEmail, "customer@example.invalid");
  assert.equal(listed.brandScope, "SAMSUNG");
  assert.equal(typeof listed.serialFp, "string");
  assert.match(String(listed.serialFp), /^[0-9a-f]{8}$/, "8-hex fingerprint");
  assert.equal(listed.publicNumberMasked, "CYVRA*************-1-5");
});

test("two keys of the same slab stay distinguishable by fingerprint", async () => {
  const a = (await jsonSerialList(row({ publicNumber: "CYVRA01102026SA3F1-1-5" }))) as Record<
    string,
    unknown
  >;
  const b = (await jsonSerialList(row({ publicNumber: "CYVRA01102026SB7E2-1-5" }))) as Record<
    string,
    unknown
  >;

  // The mask is identical by construction - so `serialFp` is what stops two
  // rows collapsing into one indistinguishable line in the queue.
  assert.equal(a.licenceKey, b.licenceKey);
  assert.notEqual(a.serialFp, b.serialFp);
});

// ---------------------------------------------------------------------------
// The report - a second bulk surface under the same auth
// ---------------------------------------------------------------------------

test("the report projection drops BOTH aliases of the full key", async () => {
  // This is the assertion that would have caught the original defect: the
  // report route mapped `reportRows -> jsonSerial` while `/serials` mapped
  // `jsonSerialList`. Same `requireAdmin`, same rows - and the CSV is the copy
  // that actually leaves the box as an attachment, so redacting only the queue
  // protected nothing that mattered.
  const source = row();
  const fullKey = source.publicNumber;
  assert.ok(fullKey !== null, "fixture must carry a key");
  const reported = await reportRows([source]);

  assert.equal(reported.length, 1);
  const line = reported[0] as unknown as Record<string, unknown>;

  assert.ok(
    !("publicNumber" in line),
    "publicNumber must not be present in a report row",
  );
  assert.equal(line.licenceKey, "CYVRA*************-1-5");

  const asJson = JSON.stringify(reported);
  assert.ok(!asJson.includes(fullKey), "full key leaked into the report");
  assert.ok(!asJson.includes("A3F1"), "uniqueness nibble leaked");
  assert.ok(!asJson.includes("01102026"), "issue date leaked");
});

test("the report keeps rows distinguishable once the key is masked", async () => {
  const reported = await reportRows([
    row({ publicNumber: "CYVRA01102026SA3F1-1-5" }),
    row({ publicNumber: "CYVRA01102026SB7E2-1-5" }),
  ]);

  const [a, b] = reported as unknown as Record<string, unknown>[];
  // Both mask to the same string, so without `serialFp` an export would compare
  // like with like and reconciliation would appear to succeed on wrong data.
  assert.equal(a!.licenceKey, b!.licenceKey, "the mask collapses both keys");
  assert.notEqual(a!.serialFp, b!.serialFp, "the fingerprint is what keeps them apart");
});

test("every CSV column resolves against a projected row, and carries no key", async () => {
  const reported = await reportRows([row()]);
  const line = reported[0]!;
  const csv = toCsv(reported);

  // `toCsv` fills each header from a key, so a header whose key no longer
  // matches a field renders as an EMPTY cell - which reads as "this customer
  // has no value" rather than "this column is broken". That failure mode is
  // silent. §56 made it easier to trip over, because a display header
  // ("Registered Email") and the key it reads (`customerEmail`) are now two
  // different strings: the check has to compare them, not assume they agree.
  const headers = csv.split("\n")[0]!.split(",");
  assert.equal(headers.length, CSV_COLUMNS.length, "one header cell per column");
  for (const { header, key } of CSV_COLUMNS) {
    assert.ok(headers.includes(header), `column "${header}" missing from the CSV header`);
    // The two columns `toCsv` computes rather than reads - §14's row number
    // and §4.2's commercial rule - are the only keys with no field behind them.
    assert.ok(
      key in line || key === "rowNo" || key === "hostWorkstationLimit",
      `column "${header}" resolves to nothing`,
    );
  }

  assert.ok(headers.includes("serialFp"), "fingerprint column keeps masked rows apart");
  assert.ok(!csv.includes("CYVRA01102026SA3F1"), "full key leaked into the CSV");
  assert.ok(csv.includes("CYVRA*************-1-5"), "the masked key should still render");
});
