import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Hono } from "hono";
import { auditEvents, mobileSerials, payments } from "@cyvra/database/schema";

import type { Database } from "../src/db.ts";
import type { Env } from "../src/env.ts";
import {
  REGISTRATION_ACTOR,
  bridgeDraftError,
  ensureSerialForUser,
  type BridgeResult,
  type SerialSeed,
} from "../src/bridge.ts";
import {
  REGISTRATION_DEFAULT_SLAB,
  parsePlan,
  parseRegistration,
} from "../src/registration.ts";
import { parseSerialQuery, serialQueryWhere } from "../src/admin/search.ts";
import {
  STAFF_TOKEN,
  mountAdmin,
  staffHarness,
} from "./helpers/adminHarness.ts";

/**
 * WORKSTREAM A - THE LICENCE-CREATION BRIDGE, PROVEN.
 * ===================================================
 *
 * Six claims, one each:
 *
 *   1. verify creates exactly one `PAYMENT_PENDING` row;
 *   2. a replay writes nothing at all - not a row, not a payment, not a trail;
 *   3. the audit row is written on the mutation's transaction, and after it;
 *   4. the actor is `SYSTEM` with no staff row behind it - never a fabricated
 *      operator, never a role invented at insert time;
 *   5. a plan outside the slabs is refused before an OTP is issued;
 *   6. the row the bridge wrote is visible to the admin console with **zero**
 *      admin-side changes - the registry list and its Payment pending filter
 *      both already select on `licence_status`, which is the state the bridge
 *      writes.
 *
 * Claim 4 is the one that could not be left to inspection: `audit_events`'s
 * `actor_role` is NOT NULL, so "record the event honestly" and "do not blame a
 * person who was not involved" are only simultaneously satisfiable if the
 * vocabulary has a value for the second case. That value is `SYSTEM`.
 *
 * ## Why the fake database ignores `where`
 *
 * `findSerialForCustomer` filters on `customer_email`, and a Drizzle `SQL`
 * object cannot be evaluated without a server. Each store below therefore holds
 * exactly one customer's row, so returning the whole table and taking the first
 * is the same answer the query would give. The comment on `selectBuilder` is
 * what stops a future test quietly putting two customers in one store and
 * asserting scoping that the double never performed.
 */

const ENV = {} as unknown as Env;
const EMAIL = "bridge-buyer@example.invalid";
const USER_ID = "7f5b1e42-9c3d-4a71-9e6b-2f0a6c8d4e11";

const SEED: SerialSeed = {
  email: EMAIL,
  userId: USER_ID,
  fullName: "Bridge Buyer",
  companyName: "Bridge Labs",
  addressLine1: "1 Test Road",
  addressLine2: null,
  pincode: "560001",
  state: "Karnataka",
  deviceMax: 1,
};

type Write = {
  readonly table: unknown;
  readonly values: Record<string, unknown>;
  readonly inTransaction: boolean;
};

/**
 * The four chain shapes the bridge reaches for, plus `transaction`.
 *
 * `then` rather than `await` on the builder: Drizzle's builders are thenable,
 * and a double that only resolved after `.returning()` would silently skip the
 * statements that do not ask for one - which is how a test can agree with a
 * broken implementation.
 */
class FakeBridgeDb {
  readonly serials: Record<string, unknown>[] = [];
  readonly paymentRows: Record<string, unknown>[] = [];
  readonly auditRows: Record<string, unknown>[] = [];
  readonly writes: Write[] = [];
  private inTransaction = false;

  private rowsFor(table: unknown): Record<string, unknown>[] {
    if (table === mobileSerials) return this.serials;
    if (table === payments) return this.paymentRows;
    if (table === auditEvents) return this.auditRows;
    throw new Error("the bridge touched a table this double does not model");
  }

  private selectBuilder() {
    const store = this;
    let table: unknown;
    const builder: {
      from: (t: unknown) => typeof builder;
      where: () => typeof builder;
      orderBy: () => typeof builder;
      limit: () => typeof builder;
      then: (
        onFulfilled?: (rows: Record<string, unknown>[]) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise<unknown>;
    } = {
      from(t) {
        table = t;
        return builder;
      },
      where() {
        return builder;
      },
      orderBy() {
        return builder;
      },
      limit() {
        return builder;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve([...store.rowsFor(table)]).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  select() {
    return this.selectBuilder();
  }

  insert(table: unknown) {
    const store = this;
    return {
      values(values: Record<string, unknown>) {
        store.writes.push({ table, values, inTransaction: store.inTransaction });
        store.rowsFor(table).push(values);
        return Promise.resolve([]);
      },
    };
  }

  async transaction<T>(cb: (tx: FakeBridgeDb) => Promise<T>): Promise<T> {
    this.inTransaction = true;
    try {
      return await cb(this);
    } finally {
      this.inTransaction = false;
    }
  }

  get database(): Database {
    return this as unknown as Database;
  }

  writesOf(table: unknown): Write[] {
    return this.writes.filter((write) => write.table === table);
  }
}

/** Drive the shared function through a real Hono context, as both callers do. */
async function create(
  db: FakeBridgeDb,
  seed: SerialSeed = SEED,
): Promise<BridgeResult> {
  const app = new Hono<{ Bindings: Env; Variables: { db: Database } }>();
  app.use("*", async (c, next) => {
    c.set("db", db.database);
    await next();
  });

  // The raw result, not the JSON round trip: `jsonSerial` needs `createdAt` and
  // friends to still be `Date`, and handing the registry a row whose timestamps
  // had become strings would fail in the projection rather than in the bridge -
  // which is a confusing place for a bridge test to break.
  let returned: BridgeResult | undefined;
  app.post("/probe", async (c) => {
    returned = await ensureSerialForUser(c, seed);
    return c.json({ ok: true });
  });

  const res = await app.request(
    "/probe",
    {
      method: "POST",
      headers: { "CF-Connecting-IP": "198.51.100.7" },
    },
    ENV,
  );
  // Not `assert.equal(res.status, 200, \`...${await res.text()}\`)`: a template
  // literal is evaluated on success too, so the failure message would be built
  // for every passing call - and this file's first run proved `res` is a
  // `Response` only because the handler returned `c.json(...)` rather than the
  // bare result object.
  if (res.status !== 200) {
    assert.fail(`bridge probe failed (${res.status}): ${await res.text()}`);
  }
  assert.ok(returned, "the bridge returned a result");
  return returned;
}

function auditWrite(db: FakeBridgeDb): Write {
  const write = db.writesOf(auditEvents)[0];
  assert.ok(write, "the creation wrote an audit row");
  return write;
}

describe("WORKSTREAM A - the licence-creation bridge", () => {
  it("creates exactly one PAYMENT_PENDING row for a verified user", async () => {
    const db = new FakeBridgeDb();

    const created = await create(db);

    assert.equal(created.created, true);
    assert.equal(created.serial.status, "PAYMENT_PENDING");
    assert.equal(created.serial.customerEmail, EMAIL);
    // Requirement 5: `user_id` is written from birth, not left NULL until a
    // follow-up remembers to backfill it.
    assert.equal(created.serial.userId, USER_ID);
    // company / name / address copied from the `users` row.
    assert.equal(created.serial.companyName, "Bridge Labs");
    assert.equal(created.serial.customerFullName, "Bridge Buyer");
    assert.equal(created.serial.addressLine1, "1 Test Road");
    assert.equal(created.serial.pincode, "560001");
    // `issued_by` is NULL from birth: migration 0008 dropped the NOT NULL that
    // forced a create to name an issuer before anything had been issued, so
    // there is no placeholder for the projection to withhold. `created_by` is
    // where the actor lands instead.
    assert.equal(created.serial.issuedBy, null);
    assert.equal(created.serial.createdBy, REGISTRATION_ACTOR);
    assert.equal(created.paymentStatus, "PENDING");

    assert.equal(db.serials.length, 1, "one row, not two");
    assert.equal(db.paymentRows.length, 1, "one payment row, so the record can be paid");
    assert.equal(db.auditRows.length, 1, "one trail entry, not one per caller");
  });

  it("replays write nothing at all", async () => {
    const db = new FakeBridgeDb();

    const first = await create(db);
    const writesAfterFirst = db.writes.length;

    const replay = await create(db);

    assert.equal(replay.created, false, "the second call reports that it created nothing");
    assert.equal(replay.serial.id, first.serial.id, "and hands back the row it found");
    assert.equal(
      db.writes.length,
      writesAfterFirst,
      "a replay writes nothing at all - no licence, no payment, no trail",
    );
    assert.equal(db.serials.length, 1);
  });

  it("writes the audit row on the mutation's transaction, after the mutation", async () => {
    const db = new FakeBridgeDb();
    await create(db);

    const licence = db.writesOf(mobileSerials)[0];
    const money = db.writesOf(payments)[0];
    const trail = auditWrite(db);

    assert.equal(licence.inTransaction, true, "the licence row is written in the transaction");
    assert.equal(money.inTransaction, true, "so is the payment row");
    assert.equal(trail.inTransaction, true, "and so is the trail - one unit, or none of it");

    const order = db.writes.map((write) => write.table);
    const licenceAt = order.indexOf(mobileSerials);
    const moneyAt = order.indexOf(payments);
    const trailAt = order.indexOf(auditEvents);
    assert.ok(licenceAt < moneyAt, "licence before money");
    assert.ok(moneyAt < trailAt, "money before trail: if the trail cannot be written, neither can the licence");
  });

  it("names SYSTEM as the actor, with no staff row behind it", async () => {
    const db = new FakeBridgeDb();
    await create(db);

    const trail = auditWrite(db).values;

    assert.equal(trail.actorRole, "SYSTEM");
    assert.equal(trail.actorId, null, "there is no staff_operators row to point at");
    assert.equal(trail.action, "SERIAL_CREATED", "the same event POST /serials records");
    assert.equal(trail.entityType, "licence");
    assert.equal(trail.previousState, null, "a creation has no before");
    assert.deepEqual(trail.newState, {
      status: "PAYMENT_PENDING",
      planCode: "CAP-1",
      deviceMax: 1,
      publicNumber: null,
      customerEmail: EMAIL,
      source: "registration",
    });
    // The customer's address lives in `new_state` because `actor_email` is not a
    // column; the request's IP still lands in `ip_address`.
    assert.equal(trail.ipAddress, "198.51.100.7");
  });

  it("accepts the standard plans a new record may be born on, and refuses the rest", () => {
    const base: Record<string, unknown> = {
      email: EMAIL,
      fullName: "Bridge Buyer",
      pincode: "560001",
      addressLine1: "1 Test Road",
    };

    // Design-freeze RULE 4 fixes the standard plans at 1, 5, 10, 25, 50, and
    // `ISSUABLE_SLABS` is exactly that set: slab 10 joined `LICENCE_SLABS` and
    // `LICENCE_KEY_RE` together, so all five are accepted.
    for (const slab of [1, 5, 10, 25, 50]) {
      const accepted = parseRegistration({ ...base, plan: slab });
      assert.equal(accepted.ok, true, `slab ${slab} must be accepted`);
      if (accepted.ok) assert.equal(accepted.value.deviceMax, slab);
      // The string form, because that is what a form field submits.
      const submitted = parseRegistration({ ...base, plan: String(slab) });
      assert.equal(submitted.ok, true, `slab "${slab}" must be accepted as text`);
    }

    for (const bad of [0, 2, 4, 6, 100, -1, "abc", "free", "1-5"]) {
      const refused = parseRegistration({ ...base, plan: bad });
      assert.equal(refused.ok, false, `plan ${JSON.stringify(bad)} must be refused`);
      if (!refused.ok) assert.match(refused.error, /device count/);
    }

    // The two refusals that are a decision rather than a typo: 3 and 7 are
    // LEGACY plan codes no new record may be born on. They are refused before
    // the OTP is sent, so no customer ever holds a challenge for a plan the
    // product does not sell - while an *operator* re-opening an old record can
    // still use them, because `licenceDraftError` validates against
    // `LICENCE_SLABS` rather than `ISSUABLE_SLABS`.
    for (const legacy of [3, 7]) {
      const refused = parsePlan(legacy);
      assert.equal(
        refused.ok,
        false,
        `plan ${legacy} must be refused: reachable by backfill, never issuable to a new record`,
      );
    }
  });

  it("defaults rather than refuses when the form offered no plan", () => {
    const base: Record<string, unknown> = {
      email: EMAIL,
      fullName: "Bridge Buyer",
      pincode: "560001",
      addressLine1: "1 Test Road",
    };
    for (const body of [base, { ...base, plan: null }, { ...base, plan: "" }]) {
      const parsed = parseRegistration(body);
      assert.equal(parsed.ok, true);
      if (parsed.ok) {
        assert.equal(parsed.value.deviceMax, REGISTRATION_DEFAULT_SLAB);
      }
    }
    assert.equal(REGISTRATION_DEFAULT_SLAB, 1);
    assert.equal(
      bridgeDraftError({ ...SEED, deviceMax: 4 }),
      "deviceMax slab must be 1, 5, 10, 25 or 50 (1-1 / 1-5 / 1-10 / 1-25 / 1-50).",
      "the bridge refuses a slab a new record may not be born on",
    );
    // RULE 4's fifth standard plan passes the write-time gate as well as it
    // passes `parsePlan` - the two are one predicate, not two lists.
    assert.equal(
      bridgeDraftError({ ...SEED, deviceMax: 10 }),
      null,
      "and accepts the 10-device plan",
    );
    // Two more that the key format CAN encode and a registration still may not
    // produce - the LEGACY pair. `licenceDraftError` keeps accepting them for
    // an operator reopening an old record; the bridge never creates one.
    assert.match(
      bridgeDraftError({ ...SEED, deviceMax: 3 }) ?? "",
      /deviceMax slab/,
      "slab 3 is LEGACY and refused for a new record",
    );
    assert.match(
      bridgeDraftError({ ...SEED, deviceMax: 7 }) ?? "",
      /deviceMax slab/,
      "slab 7 is LEGACY and refused for a new record",
    );
    assert.equal(bridgeDraftError(SEED), null, "and accepts a real one");
  });

  it("surfaces in the admin registry and its Payment pending filter, with no admin-side change", async () => {
    const db = new FakeBridgeDb();
    const created = await create(db);

    // (a) THE REGISTRY LIST. `GET /admin/serials` selects from
    // `mobile_serials` with no WHERE unless the caller supplies filters, and
    // projects through `jsonSerialList`. Nothing on that path keys off
    // `created_by`, `issued_by` or `user_id` to decide *membership*, so the row
    // cannot be filtered out for being a bridge row.
    const harness = staffHarness("operator@cyvoriq.com", "OPERATOR", {
      licence: created.serial,
    });
    const { request } = mountAdmin(harness);
    const res = await request("/serials", { token: STAFF_TOKEN });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { serials: Record<string, unknown>[] };
    const listed = body.serials[0];
    assert.ok(listed, "the bridge row is in the list the console renders");
    assert.equal(listed.status, "PAYMENT_PENDING");
    assert.equal(listed.customerEmail, EMAIL);

    // (b) WHO CREATED IT, AND WHO DID NOT ISSUE IT. Design freeze §6, §56 and
    // acceptance criterion 17: "Issued By" answers *who issued the licence*.
    // Migration 0008 made `issued_by` nullable so no create has to name an
    // issuer before one exists, and the projection still gates the field on
    // `issued_at` - which is what keeps a pre-0008 never-issued row (those hold
    // their creator in that column) from reporting an issuer as well. The
    // creator is readable in `createdBy`, which §56 lists as its own export
    // column beside Issued By. No admin console file was touched.
    assert.equal(
      listed.issuedBy,
      null,
      "no issuer is named for a licence nobody has issued",
    );
    assert.equal(listed.createdBy, REGISTRATION_ACTOR, "the creator is still visible");
    assert.equal(
      created.serial.issuedBy,
      null,
      "and the column underneath is NULL too - there was never a placeholder",
    );

    // (c) THE PAYMENT PENDING QUICK-FILTER. The KPI strip, the toolbar chip and
    // the Needs Action queue all emit the same canonical query string; it is
    // parsed into an `IN` over `licence_status`, and the row's status is exactly
    // the token that clause matches. `serialQueryWhere` proving it reaches SQL
    // is what distinguishes "the filter parsed" from "the filter was dropped",
    // which is the failure that would make the chip silently show everything.
    const parsed = parseSerialQuery(new URLSearchParams("status=PAYMENT_PENDING"));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.spec.status, ["PAYMENT_PENDING"]);
    assert.equal(
      created.serial.status,
      "PAYMENT_PENDING",
      "the row's state is the token the filter matches on",
    );
    assert.ok(
      serialQueryWhere(parsed.spec),
      "the filter becomes a WHERE clause rather than being dropped",
    );
  });
});
