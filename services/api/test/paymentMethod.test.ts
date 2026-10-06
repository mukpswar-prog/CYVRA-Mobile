/**
 * WS-H2 PILLAR 2 - `payments.payment_method` AND THE CONFIRM GATE.
 * ================================================================
 *
 * Five properties, asserted rather than assumed:
 *
 *   1. THE VALUE SET IS EXACTLY SEVEN, verbatim, so `schema.ts` and this file
 *      cannot be edited apart without a failure - the mirror in
 *      `apps/web/src/admin/licences/paymentMethod.ts` is pinned by a
 *      companion test for the same reason.
 *
 *   2. A CONFIRMATION WITHOUT A METHOD IS REFUSED, and the sentence it is
 *      refused with names the real set. "Validate" is worth nothing if the
 *      caller cannot act on the answer.
 *
 *   3. NOTHING IS WRITTEN ON THAT REFUSAL - no `payments` row, no licence
 *      move, no audit row. A trail describing a confirmation that did not
 *      happen is worse than no trail, and §43's idempotency is only
 *      meaningful if a refusal is genuinely a no-op.
 *
 *   4. A VALID METHOD REACHES BOTH DESTINATIONS: the `payments` row (financial
 *      truth) and `newState.paymentMethod` on the audit row (the claim the
 *      trail makes about this click). Asserting only one would leave the other
 *      free to regress while the suite stayed green.
 *
 *   5. A REPLAY IS STILL A REPLAY. The gate sits *after* the idempotency
 *      check, so a retry of a completed confirmation answers 200 rather than
 *      400 - the whole reason the gate is an outcome of the transaction and
 *      not an early return at the top of the handler.
 *
 * The freeze anomaly (the Design Freeze never names this field or its values)
 * is recorded in migration 0009 and `database/src/schema.ts`, not repeated
 * here.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paymentMethodEnum } from "@cyvra/database/schema";
import { mountAdmin, licenceRow, staffHarness, STAFF_TOKEN } from "./helpers/adminHarness.ts";

const SERIAL_ID = "11111111-1111-4111-8111-111111111111";

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

function auditWrites(harness: { writes: Array<Record<string, unknown>> }) {
  return harness.writes.filter((write) => write.table === "audit_events");
}

/** A confirm-ready fixture: licence awaiting payment, no payment row yet. */
function pendingHarness() {
  return staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
    licence: licenceRow({ status: "PAYMENT_PENDING", publicNumber: null }),
    payment: null,
  });
}

describe("payment_method_enum", () => {
  it("holds exactly the seven methods the confirm dialog offers", () => {
    assert.deepEqual([...paymentMethodEnum.enumValues], [
      "UPI",
      "BANK_TRANSFER",
      "CARD",
      "NET_BANKING",
      "CASH",
      "CHEQUE",
      "OTHER",
    ]);
  });
});

describe("POST /serials/:id/confirm-payment - the payment method gate", () => {
  it("is 400 without a method, naming the set, and writes nothing", async () => {
    const harness = pendingHarness();
    const { request } = mountAdmin(harness);

    const res = await request(`/serials/${SERIAL_ID}/confirm-payment`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { amount: 5000, reference: "UPI-1" },
    });
    // Read once: a `Response` body can only be consumed a single time, and the
    // status message below wants the same payload the assertions read.
    const payload = await readJson(res);
    assert.equal(res.status, 400, JSON.stringify(payload));

    const error = String(payload.error);
    assert.match(error, /paymentMethod is required/i);
    // Every value the enum admits, so the operator can fix the call from the
    // error alone rather than reading source.
    for (const method of paymentMethodEnum.enumValues) assert.ok(error.includes(method), method);

    // Nothing happened. Not one write of any table.
    assert.deepEqual(harness.writes, [], "a refusal must be a no-op");
    assert.ok(
      harness.state.payment == null,
      "no payment row was created - the gate sits before the insert",
    );
    assert.equal(harness.state.licence?.status, "PAYMENT_PENDING", "licence did not move");
  });

  it("is 400 for a method outside the enum, and echoes back what it saw", async () => {
    const harness = pendingHarness();
    const { request } = mountAdmin(harness);

    const res = await request(`/serials/${SERIAL_ID}/confirm-payment`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { paymentMethod: "BITCOIN" },
    });
    assert.equal(res.status, 400);
    const error = String((await readJson(res)).error);
    assert.match(error, /Unknown paymentMethod "BITCOIN"/);
    assert.deepEqual(harness.writes, []);
  });

  it("accepts a known method, writing it to payments AND to the audit row", async () => {
    const harness = pendingHarness();
    const { request } = mountAdmin(harness);

    const res = await request(`/serials/${SERIAL_ID}/confirm-payment`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { amount: 5000, reference: "UPI-1", paymentMethod: "UPI" },
    });
    assert.equal(res.status, 200, JSON.stringify(await readJson(res)));

    // Financial truth.
    assert.equal(harness.state.payment?.status, "PAID");
    assert.equal(harness.state.payment?.paymentMethod, "UPI");
    assert.equal(harness.state.licence?.status, "READY_TO_GENERATE");

    // The claim the trail makes about this click - recorded as the value the
    // operator chose, not read back out of `payments` afterwards.
    const audit = auditWrites(harness);
    assert.equal(audit.length, 1, "one click, one event");
    const row = audit[0] as { values: Record<string, unknown> };
    assert.equal(row.values.action, "PAYMENT_CONFIRMED");
    assert.deepEqual(row.values.previousState, {
      status: "PAYMENT_PENDING",
      paymentStatus: null,
      paymentMethod: null,
    });
    assert.deepEqual(row.values.newState, {
      status: "READY_TO_GENERATE",
      paymentStatus: "PAID",
      paymentMethod: "UPI",
      confirmedBy: "licadmin@cyvoriq.com",
    });
  });

  it("still replays a completed confirmation instead of re-asking for the method", async () => {
    const harness = pendingHarness();
    const { request } = mountAdmin(harness);
    const body = { amount: 5000, paymentMethod: "CARD" };

    const first = await request(`/serials/${SERIAL_ID}/confirm-payment`, {
      method: "POST",
      token: STAFF_TOKEN,
      body,
    });
    assert.equal(first.status, 200, JSON.stringify(await readJson(first)));
    const writesAfterFirst = harness.writes.length;

    // Same request, resent. The licence is now past confirmation, so §48's
    // idempotent answer wins over the method gate - which is only true
    // because the gate is checked *after* the replay test.
    const second = await request(`/serials/${SERIAL_ID}/confirm-payment`, {
      method: "POST",
      token: STAFF_TOKEN,
      body,
    });
    const secondBody = await readJson(second);
    assert.equal(second.status, 200, JSON.stringify(secondBody));
    assert.equal(secondBody.replayed, true);
    assert.equal(harness.writes.length, writesAfterFirst, "a replay writes nothing");
    assert.equal(auditWrites(harness).length, 1, "and adds no second event");
  });

  it("replays even when the retry omits the method it never needed to re-prove", async () => {
    const harness = pendingHarness();
    const { request } = mountAdmin(harness);

    await request(`/serials/${SERIAL_ID}/confirm-payment`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: { paymentMethod: "CASH" },
    });
    assert.equal(harness.state.licence?.status, "READY_TO_GENERATE");

    // A bare retry: no amount, no method. Answering 400 here would mean an
    // idempotent operation is only idempotent when the caller remembers every
    // field - which is not idempotency, it is luck.
    const retry = await request(`/serials/${SERIAL_ID}/confirm-payment`, {
      method: "POST",
      token: STAFF_TOKEN,
      body: {},
    });
    const retryBody = await readJson(retry);
    assert.equal(retry.status, 200, JSON.stringify(retryBody));
    assert.equal(retryBody.replayed, true);
    assert.equal(auditWrites(harness).length, 1);
  });
});
