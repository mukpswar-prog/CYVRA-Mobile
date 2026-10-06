/**
 * WORKSTREAM H1 - ATOMIC ISSUE (Path 6B), §42 CONCURRENCY, §43 IDEMPOTENCY,
 * AND THE SUPER ADMIN WAIVER AS REACHABLE FROM `/issue`
 * ==========================================================================
 *
 * §21 draws issuance as ONE ordered chain that ends in a single audit event:
 *
 *     validate -> payment PAID? -> plan valid? -> customer eligible?
 *       -> conflicting licence? -> call the licence engine
 *       -> signed credential -> ISSUED -> audit event
 *       -> customer communication queued
 *
 * §7.2 and RULE 7 put the whole of that behind one administrator action -
 * "Generate" is not the admin's primary action, and the admin never generates
 * key material. §83 freezes the workflow with no Generate step in it at all:
 * GREEN ISSUE LICENCE -> provisioned -> ISSUED.
 *
 * So `POST /issue` provisions and issues inside ONE transaction, and
 * `KEY_GENERATED` is an internal transient the transaction passes through
 * rather than a screen the operator stops at. Nothing was dropped to do this:
 * the enum keeps all ten values and `LICENCE_EDGES` keeps all thirteen edges.
 *
 * WHY issueIdempotency.test.ts CANNOT COVER THIS
 * ----------------------------------------------
 * That suite starts every fixture at `KEY_GENERATED` with `publicNumber`
 * already set - the state the *old* two-button flow used to produce. It can
 * therefore never reach STEP 1 of the new path. Every test below starts from
 * `READY_TO_GENERATE` with `publicNumber: null`, which is the state §83
 * actually leaves an operator looking at when the green button lights up.
 *
 * The `§47` / `§48` citations in that file come from a *different* document
 * (the activation contract) and state the same two properties from that
 * document's side; `§42` / `§43` below are the admin design freeze's own
 * concurrency and idempotency rules.
 *
 * ONE ENV PER TEST, NOT ONE PER REQUEST
 * -------------------------------------
 * `signingEnv()` generates a fresh Ed25519 keypair each time it is called.
 * Signing with a different key on every request would make two envelopes for
 * the same row differ for a reason that has nothing to do with idempotency, so
 * each test builds its env once and hands it to every request - which is also
 * what a deployment does, since its private key does not rotate per click.
 *
 * ON "TWO ADMINS SIMULTANEOUSLY"
 * ------------------------------
 * The suite is deliberately database-free (see helpers/adminHarness.ts), so
 * `.for("update")` is accepted and ignored by the double and two requests
 * cannot literally interleave. §42's *observable* contract - one succeeds, the
 * other is told the record was already processed, and the loser writes nothing
 * - is what is asserted here, which is also what a real second administrator
 * sees, because their `SELECT ... FOR UPDATE` makes them queue behind the
 * winner and re-read the committed row. What the harness cannot prove is the
 * lock itself; that belongs to a database-backed test, not to this suite.
 */

import assert from "node:assert/strict";
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

interface Recorded {
  readonly table: string;
  readonly kind: string;
  readonly inTransaction: boolean;
  readonly values: Record<string, unknown>;
}

function auditWrites(writes: readonly Recorded[]): Recorded[] {
  return writes.filter((w) => w.table === "audit_events");
}

/**
 * Every write to `mobile_serials`, including PHASE 4's email bookkeeping -
 * which is why the assertions below say which index is which rather than
 * counting "licence writes" and assuming the email is not one of them.
 */
function serialWrites(writes: readonly Recorded[]): Recorded[] {
  return writes.filter((w) => w.table === "mobile_serials" && w.kind === "update");
}

/** Body reads are cached: `Response.json()` can only be consumed once. */
const jsonCache = new WeakMap<Response, Promise<Record<string, unknown>>>();
async function readJson(res: Response): Promise<Record<string, unknown>> {
  let cached = jsonCache.get(res);
  if (!cached) {
    cached = res.json() as Promise<Record<string, unknown>>;
    jsonCache.set(res, cached);
  }
  return cached;
}

type Env = Record<string, string>;

/**
 * A licence at `READY_TO_GENERATE`, paid, with **no credential minted yet** -
 * exactly what `Confirm Payment` leaves behind (§83: Payment = PAID ->
 * Status = READY TO ISSUE -> GREEN ISSUE LICENCE).
 */
function readyHarness(email = "licadmin@cyvoriq.com", role = "LICENCE_ADMIN", unpaid = false) {
  return staffHarness(email, role, {
    licence: licenceRow({
      status: "READY_TO_GENERATE",
      publicNumber: null,
      generatedBy: null,
    }),
    payment: unpaid
      ? {
          id: "22222222-2222-4222-8222-222222222222",
          licenceId: SERIAL_ID,
          status: "PENDING",
          createdAt: new Date(),
        }
      : paidPayment(SERIAL_ID),
  });
}

async function issue(
  harness: ReturnType<typeof readyHarness>,
  env: Env,
  body?: Record<string, unknown>,
): Promise<Response> {
  const { request } = mountAdmin(harness, env);
  return request(`/serials/${SERIAL_ID}/issue`, {
    method: "POST",
    token: STAFF_TOKEN,
    ...(body === undefined ? {} : { body }),
  });
}

describe("Path 6B - one atomic issue (§21 / §7.2 / §83 / RULE 7)", () => {
  it("provisions and issues from READY_TO_GENERATE with no separate Generate Key step", async () => {
    const harness = readyHarness();
    const env = signingEnv();
    const res = await issue(harness, env);
    const body = await readJson(res);
    assert.equal(res.status, 200, JSON.stringify(body));

    assert.equal((body.serial as Record<string, unknown>).status, "ISSUED");
    assert.equal(body.replayed, false);
    assert.equal(typeof harness.state.licence?.publicNumber, "string");

    // provision -> issue -> audit -> email bookkeeping. The first two are the
    // edges the old flow split across two requests; Path 6B performs both
    // inside one transaction, and the trail goes in the same one.
    const writes = harness.writes;
    assert.equal(
      writes.length,
      4,
      JSON.stringify(writes.map((w) => `${w.table}:${w.kind}`)),
    );
    const serial = serialWrites(writes);
    assert.equal(serial.length, 3, "provision, issue, then the email result");
    const [provision, issued, mail] = serial;

    assert.equal(provision.inTransaction, true);
    assert.equal(provision.values.status, "KEY_GENERATED");
    assert.equal(typeof provision.values.publicNumber, "string");

    assert.equal(issued.inTransaction, true);
    assert.equal(issued.values.status, "ISSUED");
    assert.equal(issued.values.issuedBy, "licadmin@cyvoriq.com");

    const trail = auditWrites(writes);
    assert.equal(trail.length, 1);
    assert.equal(trail[0].inTransaction, true, "the trail commits with the issuance");

    // The email is outside. §21 says "customer communication *queued*", and
    // sending network I/O from inside a transaction that holds a row lock is
    // how a pool dies under load - a failure must be able to lose an email
    // (recorded, visible, repairable), never to send one for a licence that
    // was then rolled back.
    assert.equal(mail.inTransaction, false);
    assert.ok("emailError" in mail.values, "PHASE 4 recorded the attempt");

    assert.equal(harness.state.licence?.status, "ISSUED");
  });

  it("treats KEY_GENERATED as internal - written, then passed through, never left standing", async () => {
    const harness = readyHarness();
    await issue(harness, signingEnv());

    // The enum value is still real and still written (no migration, no value
    // dropped); it is the *stopping* at it that Path 6B removed.
    const serial = serialWrites(harness.writes);
    assert.equal(serial[0].values.status, "KEY_GENERATED");
    assert.equal(serial[1].values.status, "ISSUED");
    assert.equal(harness.state.licence?.status, "ISSUED");
    assert.notEqual(harness.state.licence?.status, "KEY_GENERATED");
  });

  it("writes one audit row whose previous state is the one the operator saw", async () => {
    const harness = readyHarness();
    await issue(harness, signingEnv());

    const audit = auditWrites(harness.writes);
    assert.equal(audit.length, 1, "§21 draws a single audit event");
    assert.equal(audit[0].values.action, "LICENCE_ISSUED");

    const previous = audit[0].values.previousState as Record<string, unknown>;
    const next = audit[0].values.newState as Record<string, unknown>;

    // Not the transient: an operator pressed the button on READY_TO_GENERATE,
    // so that is what the trail has to say moved.
    assert.equal(previous.status, "READY_TO_GENERATE");
    assert.equal(next.status, "ISSUED");
    // No waiver field at all: `/issue` has no waiver (WS-H1 sign-off item 2),
    // so the trail says nothing about a capability this route does not have,
    // rather than stamping `false` onto every row forever.
    assert.equal("paymentWaived" in next, false);
    assert.equal(next.paymentStatus, "PAID");

    // RULE 17 - the key allocation is in the record, because a credential
    // nobody can see having been minted is exactly the high-impact action the
    // rule exists for.
    assert.equal(typeof next.publicNumberFingerprint, "string");
    assert.equal(next.generatedBy, "licadmin@cyvoriq.com");
    // ...but only its fingerprint. An audit row is a record of what happened,
    // not a second place a licence credential lives.
    assert.equal(next.publicNumber, undefined);
    assert.equal(typeof (harness.state.licence as Record<string, unknown>).publicNumber, "string");
  });

  it("keeps a credential minted by the legacy route instead of allocating a second", async () => {
    // A row somebody already ran `generate-key` against: status KEY_GENERATED
    // *and* a key. STEP 1 must be skipped entirely - allocating here would be
    // §43's forbidden outcome, two valid credentials for one record.
    const harness = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
      licence: licenceRow({ status: "KEY_GENERATED" }),
      payment: paidPayment(SERIAL_ID),
    });
    const before = (harness.state.licence as Record<string, unknown>).publicNumber;

    const res = await issue(harness, signingEnv());
    assert.equal(res.status, 200, JSON.stringify(await readJson(res)));

    const serial = serialWrites(harness.writes);
    assert.equal(serial.length, 2, "only the ISSUED write and the email result");
    assert.equal(serial[0].values.status, "ISSUED");
    assert.equal(
      (harness.state.licence as Record<string, unknown>).publicNumber,
      before,
      "the existing key is untouched",
    );
    assert.equal(harness.state.licence?.status, "ISSUED");
    assert.equal(auditWrites(harness.writes).length, 1);
  });
});

describe("§42 - two administrators, one wins", () => {
  it("tells the second the record was already processed, and lets them write nothing", async () => {
    const env = signingEnv();
    const harness = readyHarness("alice@cyvoriq.com", "LICENCE_ADMIN");
    const first = await issue(harness, env);
    assert.equal(first.status, 200, JSON.stringify(await readJson(first)));
    const issuedBy = (harness.state.licence as Record<string, unknown>).issuedBy;
    assert.equal(issuedBy, "alice@cyvoriq.com");

    const writesAfterFirst = harness.writes.length;
    const auditAfterFirst = auditWrites(harness.writes).length;

    // §42's second administrator. Both addresses are `@cyvoriq.com`, so both
    // resolve to an ACTIVE operator; only the identity differs.
    (harness.state.session as { email: string } | null)!.email = "bob@cyvoriq.com";
    (harness.state.operator as { email: string } | null)!.email = "bob@cyvoriq.com";

    const second = await issue(harness, env);
    assert.equal(second.status, 200, JSON.stringify(await readJson(second)));
    const body = await readJson(second);

    assert.equal(body.replayed, true);
    // §42's exact sentence, verbatim.
    assert.equal(
      body.message,
      "This licence was already processed by another administrator. Refresh the record to view the latest status.",
    );

    // One operation succeeded. The loser changed nothing: no second state
    // change, no second trail row, and the winning actor still stands.
    assert.equal(harness.writes.length, writesAfterFirst, "the loser wrote nothing");
    assert.equal(auditWrites(harness.writes).length, auditAfterFirst);
    assert.equal((harness.state.licence as Record<string, unknown>).issuedBy, issuedBy);
    assert.equal((body.serial as Record<string, unknown>).issuedBy, issuedBy);
  });

  it("never sends the loser an email either", async () => {
    const env = signingEnv();
    const harness = readyHarness("alice@cyvoriq.com", "LICENCE_ADMIN");
    const first = await issue(harness, env);
    const firstBody = await readJson(first);
    const mailWrites = harness.writes.filter(
      (w) => w.table === "mobile_serials" && !w.inTransaction,
    );
    assert.equal(mailWrites.length, 1, "PHASE 4 ran once for the winner");

    (harness.state.session as { email: string } | null)!.email = "bob@cyvoriq.com";
    (harness.state.operator as { email: string } | null)!.email = "bob@cyvoriq.com";

    const second = await issue(harness, env);
    const secondBody = await readJson(second);
    assert.equal(secondBody.replayed, true);
    assert.equal(
      harness.writes.filter((w) => w.table === "mobile_serials" && !w.inTransaction).length,
      1,
      "the replay returns before PHASE 3",
    );
    assert.equal(secondBody.emailed, firstBody.emailed);
    assert.equal(secondBody.emailError, firstBody.emailError);
  });
});

describe("§43 - a retry after the connection dropped returns the existing result", () => {
  it("hands back the identical envelope and performs no work at all", async () => {
    const env = signingEnv();
    const harness = readyHarness();
    const first = await issue(harness, env);
    const firstBody = await readJson(first);
    assert.equal(first.status, 200);
    const writesAfterFirst = harness.writes.length;

    // The browser lost its connection after the server committed. The user
    // clicks again - from §43's point of view indistinguishable from §42's
    // second administrator, and the server says the same thing to both.
    const retry = await issue(harness, env);
    const retryBody = await readJson(retry);
    assert.equal(retry.status, 200);
    assert.equal(retryBody.replayed, true);

    assert.equal(harness.writes.length, writesAfterFirst, "a retry writes nothing");
    assert.equal(auditWrites(harness.writes).length, 1, "one issuance, one row");

    // One credential, handed out again - never a second one minted.
    assert.equal(retryBody.signature, firstBody.signature);
    assert.equal(retryBody.payload, firstBody.payload);
    assert.equal(retryBody.issuedAt, firstBody.issuedAt);
    assert.equal(retryBody.schema, firstBody.schema);
    assert.deepEqual(retryBody.serial, firstBody.serial);
    assert.equal(
      (retryBody.serial as Record<string, unknown>).publicNumber,
      (firstBody.serial as Record<string, unknown>).publicNumber,
    );
  });
});

describe("§20 - the backend validates the green button's conditions itself", () => {
  it("refuses an unpaid record no matter what the frontend showed", async () => {
    // The frontend button is a usability feature; §20 says the browser cannot
    // be trusted to authorize issuance. `payments.status` PENDING is what
    // "payment is PAID" failing looks like from here.
    const harness = readyHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", true);
    const res = await issue(harness, signingEnv());
    assert.equal(res.status, 403);
    assert.match(String((await readJson(res)).error), /payment/i);
    assert.equal(harness.writes.length, 0, "refused before the transaction wrote");
    assert.equal(auditWrites(harness.writes).length, 0);
  });

  it("404s an unknown serial and 409s a revoked one, with no writes either way", async () => {
    const env = signingEnv();
    const missing = staffHarness("licadmin@cyvoriq.com", "LICENCE_ADMIN", {
      licence: null,
      payment: null,
    });
    const { request } = mountAdmin(missing, env);
    const gone = await request("/serials/99999999-9999-4999-8999-999999999999/issue", {
      method: "POST",
      token: STAFF_TOKEN,
    });
    assert.equal(gone.status, 404);
    assert.equal(missing.writes.length, 0);

    const revoked = readyHarness();
    (revoked.state.licence as Record<string, unknown>).status = "REVOKED";
    const res = await issue(revoked, env);
    assert.equal(res.status, 409);
    assert.equal((await readJson(res)).error, "Revoked serials cannot be issued.");
    assert.equal(revoked.writes.length, 0);
  });
});
