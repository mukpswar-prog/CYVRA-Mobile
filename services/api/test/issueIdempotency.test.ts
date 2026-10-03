/**
 * W5 PHASE 1 - ISSUE IS IDEMPOTENT (plan §48) AND LOSES NOTHING (plan §47)
 * ========================================================================
 *
 *     §48: "Repeated network requests must not accidentally create multiple
 *           valid licence credentials... especially if the browser loses
 *           connection after the server completes an operation."
 *
 * WHAT IS ACTUALLY BEING PROVEN
 * -----------------------------
 * The replay branch runs before `transition()`, before the UPDATE and before
 * `writeAudit`, and PHASE 3 (the email) sits *after* the branch entirely. So a
 * retried request must show **zero writes** - and zero writes is also proof
 * that no email went out, because PHASE 4 records the send result in
 * `emailedAt` / `emailError` unconditionally the moment PHASE 3 returns. If
 * `sendLicenceEmail` had been called there would be a fourth write. The premise
 * is asserted first, so the conclusion is not resting on an assumption about
 * code that has not been shown to behave.
 *
 * The envelope is compared field by field rather than "is truthy": §48's real
 * worry is a second *credential*, so the signature is verified against the
 * public half of the key generated for this test and then shown to be
 * byte-identical across replays.
 */

import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { describe, it } from "node:test";
import {
  STAFF_TOKEN,
  licenceRow,
  mountAdmin,
  paidPayment,
  signingEnv,
  staffHarness,
} from "./helpers/adminHarness.ts";

const SERIAL_ID = "11111111-1111-4111-8111-111111111111";

function issueHarness(status: string, overrides: Record<string, unknown> = {}) {
  return staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
    licence: licenceRow({ status, ...overrides }),
    payment: paidPayment(SERIAL_ID),
  });
}

async function issue(harness: ReturnType<typeof issueHarness>, env: Record<string, string>) {
  const { request } = mountAdmin(harness, env);
  return request(`/serials/${SERIAL_ID}/issue`, {
    method: "POST",
    token: STAFF_TOKEN,
  });
}

async function readJson(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

function auditWrites(harness: { writes: Array<Record<string, unknown>> }) {
  return harness.writes.filter((w) => w.table === "audit_events");
}

describe("first issue", () => {
  it("commits the transition, the audit row and the email bookkeeping as one story", async () => {
    const harness = issueHarness("KEY_GENERATED");
    const env = signingEnv();
    const res = await issue(harness, env);
    const body = await readJson(res);
    assert.equal(res.status, 200, JSON.stringify(body));

    assert.equal((body.serial as Record<string, unknown>).status, "ISSUED");
    assert.equal(body.replayed, false);

    // The shape plan §25 of the activation contract requires.
    for (const key of ["schema", "issuedAt", "payload", "signature"]) {
      assert.ok(key in body, `envelope must carry ${key}`);
    }

    // Writes, in order: mutate, trail, then the email result. The first two
    // share a transaction; the third is deliberately outside it.
    assert.equal(harness.writes.length, 3, JSON.stringify(harness.writes.map((w) => w.table)));
    const [mutate, trail, mail] = harness.writes;
    assert.equal(mutate.table, "mobile_serials");
    assert.equal(mutate.inTransaction, true);
    assert.equal(trail.table, "audit_events");
    assert.equal(trail.inTransaction, true);
    assert.equal(mail.table, "mobile_serials");
    assert.equal(mail.inTransaction, false);
    // PHASE 4 always writes, which is what makes "no writes on replay"
    // equivalent to "no email on replay".
    assert.ok("emailError" in mail.values);
    assert.ok("emailedAt" in mail.values);

    assert.equal(harness.state.licence?.status, "ISSUED");
    assert.equal(harness.state.licence?.issuedBy, "licadmin@cyvoriq.com");
  });

  it("records previous_state = KEY_GENERATED and new_state = ISSUED", async () => {
    const harness = issueHarness("KEY_GENERATED");
    const res = await issue(harness, signingEnv());
    assert.equal(res.status, 200);

    const audit = auditWrites(harness);
    assert.equal(audit.length, 1);
    const row = audit[0] as { inTransaction: boolean; values: Record<string, unknown> };
    assert.equal(row.inTransaction, true);
    assert.equal(row.values.action, "LICENCE_ISSUED");
    assert.equal(row.values.entityType, "licence");
    assert.equal(row.values.entityId, SERIAL_ID);
    assert.equal(row.values.actorRole, "LICENCE_ADMIN");
    assert.equal(row.values.actorId, "33333333-3333-4333-8333-333333333333");

    const previous = row.values.previousState as Record<string, unknown>;
    const next = row.values.newState as Record<string, unknown>;
    assert.equal(previous.status, "KEY_GENERATED");
    assert.equal(previous.issuedAt, null);
    assert.equal(next.status, "ISSUED");
    assert.equal(next.issuedBy, "licadmin@cyvoriq.com");
    assert.equal(typeof next.issuedAt, "string");
    // The trail never carries the key itself.
    assert.equal(JSON.stringify(row.values).includes(String(
      (harness.state.licence as Record<string, unknown>).publicNumber,
    )), false);
  });

  it("produces a signature that actually verifies against the keypair", async () => {
    const harness = issueHarness("KEY_GENERATED");
    const env = signingEnv();
    const res = await issue(harness, env);
    const body = await readJson(res);
    const publicKey = createPublicKey({
      key: Buffer.from(env.ENTITLEMENT_PUBLIC_KEY_B64, "base64"),
      format: "der",
      type: "spki",
    });
    assert.equal(
      verify(
        null,
        Buffer.from(String(body.payload), "utf8"),
        publicKey,
        Buffer.from(String(body.signature), "base64"),
      ),
      true,
    );
    const payload = JSON.parse(String(body.payload)) as Record<string, unknown>;
    assert.equal(payload.serialNumber, (harness.state.licence as Record<string, unknown>).publicNumber);
    // §25 of the activation contract: the host reads `status`, and an ISSUED
    // serial entitles an ACTIVE host.
    assert.equal(payload.status, "ACTIVE");
  });
});

describe("repeated issue is idempotent (§48)", () => {
  it("returns 200 with the same envelope, and writes nothing at all", async () => {
    const harness = issueHarness("KEY_GENERATED");
    const env = signingEnv();

    const first = await issue(harness, env);
    assert.equal(first.status, 200);
    const firstBody = await readJson(first);
    const writesAfterFirst = harness.writes.length;
    const auditAfterFirst = auditWrites(harness).length;
    assert.equal(writesAfterFirst, 3);

    for (let attempt = 2; attempt <= 4; attempt += 1) {
      const replay = await issue(harness, env);
      assert.equal(replay.status, 200, `attempt ${attempt}`);
      const body = await readJson(replay);

      assert.equal(body.replayed, true, `attempt ${attempt}`);
      assert.match(String(body.message), /already processed/, `attempt ${attempt}`);
      assert.equal(
        harness.writes.length,
        writesAfterFirst,
        `attempt ${attempt} must not write anything`,
      );
      assert.equal(
        auditWrites(harness).length,
        auditAfterFirst,
        `attempt ${attempt} must not add an audit row`,
      );

      // §48's actual concern: one credential, handed out again.
      assert.equal(body.signature, firstBody.signature, `attempt ${attempt}`);
      assert.equal(body.payload, firstBody.payload, `attempt ${attempt}`);
      assert.equal(body.issuedAt, firstBody.issuedAt, `attempt ${attempt}`);
      assert.equal(body.schema, firstBody.schema);
      assert.deepEqual(body.serial, firstBody.serial);
    }
  });

  it("never sends a second email - the replay returns before PHASE 3", async () => {
    const harness = issueHarness("KEY_GENERATED");
    const env = signingEnv();

    const first = await issue(harness, env);
    const firstBody = await readJson(first);
    // No RESEND key is configured, so the send was attempted and declined.
    // `emailError` being non-null proves PHASE 3 ran and PHASE 4 recorded it.
    assert.equal(firstBody.emailed, false);
    assert.ok(firstBody.emailError);
    const mailWrite = harness.writes.find(
      (w) => w.table === "mobile_serials" && !w.inTransaction,
    ) as { values: Record<string, unknown> } | undefined;
    assert.ok(mailWrite, "PHASE 4 must have recorded the attempt");
    assert.equal(mailWrite.values.emailError, firstBody.emailError);

    const before = harness.writes.length;
    const replay = await issue(harness, env);
    const replayBody = await readJson(replay);
    assert.equal(replayBody.replayed, true);

    // Zero writes, and PHASE 4 is what any call to `sendLicenceEmail` would
    // have produced - so PHASE 3 was not reached.
    assert.equal(harness.writes.length, before);
    assert.equal(replayBody.emailError, firstBody.emailError);
    assert.equal(replayBody.emailed, firstBody.emailed);
  });

  it("stops replaying once the licence has moved past ISSUED", async () => {
    const harness = issueHarness("KEY_GENERATED");
    const env = signingEnv();
    assert.equal((await issue(harness, env)).status, 200);
    const writes = harness.writes.length;

    // Simulate first activation (the system edge ISSUED -> ACTIVE). The
    // replay guard keys on `status === "ISSUED"`, so from here the request is
    // no longer a retry of anything - re-issuing an active licence is a
    // different, and wrong, request. §47 wants it refused, not re-signed: an
    // extra credential for a live licence is exactly what §48 exists to
    // prevent.
    const licence = harness.state.licence as Record<string, unknown>;
    licence.status = "ACTIVE";

    const replay = await issue(harness, env);
    assert.equal(replay.status, 409);
    const body = await readJson(replay);
    assert.match(String(body.error), /cannot move to ISSUED/);
    assert.equal(harness.writes.length, writes, "and it still wrote nothing");
    assert.equal(auditWrites(harness).length, 1);
  });
});

describe("refusals before any write (§47)", () => {
  it("refuses a record that never reached KEY_GENERATED", async () => {
    for (const status of ["DRAFT", "PAYMENT_PENDING", "PAYMENT_CONFIRMED", "READY_TO_GENERATE"]) {
      const harness = issueHarness(status);
      const res = await issue(harness, signingEnv());
      assert.equal(res.status, 409, status);
      const body = await readJson(res);
      assert.match(String(body.error), /cannot move to ISSUED/);
      assert.equal(harness.writes.length, 0, status);
      assert.equal(auditWrites(harness).length, 0, status);
    }
  });

  it("refuses a revoked licence with a plain sentence, not a state-machine dump", async () => {
    const harness = issueHarness("REVOKED");
    const res = await issue(harness, signingEnv());
    assert.equal(res.status, 409);
    assert.equal((await readJson(res)).error, "Revoked serials cannot be issued.");
    assert.equal(harness.writes.length, 0);
  });

  it("404s a serial that does not exist, before opening a transaction", async () => {
    const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
      licence: null,
      payment: null,
    });
    const { request } = mountAdmin(harness, signingEnv());
    const res = await request("/serials/99999999-9999-4999-8999-999999999999/issue", {
      method: "POST",
      token: STAFF_TOKEN,
    });
    assert.equal(res.status, 404);
    assert.equal(harness.writes.length, 0);
  });

  it("fails fast with 503 when signing is not configured, leaving the row untouched", async () => {
    const harness = issueHarness("KEY_GENERATED");
    const { request } = mountAdmin(harness, { API_ENV: "preview" });
    const res = await request(`/serials/${SERIAL_ID}/issue`, {
      method: "POST",
      token: STAFF_TOKEN,
    });
    assert.equal(res.status, 503);
    assert.match(String((await readJson(res)).error), /ENTITLEMENT_PRIVATE_KEY_B64/);
    assert.equal(harness.writes.length, 0);
    assert.equal(harness.state.licence?.status, "KEY_GENERATED");
  });
});
