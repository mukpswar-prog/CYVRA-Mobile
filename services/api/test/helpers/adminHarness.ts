/**
 * W5 PHASE 1 - TEST HARNESS FOR THE ADMIN CONTROL PLANE
 * ====================================================
 *
 * The API suite is pure: no Postgres, no Cloudflare, no network. That is a
 * deliberate constraint (the suite must run in CI without a database), and it
 * means the route-level tests need a stand-in for Drizzle.
 *
 * WHAT THIS DOUBLE IS, AND WHAT IT IS NOT
 * ---------------------------------------
 * It is a *recorded* fake, not a stubbed answer sheet. It answers reads from a
 * mutable `state` object and appends every write to `writes` with a flag
 * saying whether it happened inside `db.transaction`. State genuinely changes,
 * so a second request sees what the first one committed - which is exactly the
 * property the idempotency and replay tests are about. Nothing here specialises
 * on the request it is being asked; if it did, the tests would be asserting
 * the fake rather than the code.
 *
 * It is not a mock of behaviour: no call is intercepted, no return value is
 * pre-scripted per call site, and no assertion in this suite is satisfied by
 * the harness having done something instead of `admin.ts`.
 *
 * KEY ALLOCATION, SIGNING, EMAIL
 * ------------------------------
 * `licenceRow()` starts with `publicNumber` already set, because Phase 1 moved
 * allocation into `POST /serials/:id/generate-key` and `/issue` requires a key
 * to exist. Signing uses a freshly generated Ed25519 keypair held only in
 * memory for the duration of the test - never a fixture key, never a `.env`
 * value. Email is unconfigured by default, so `sendLicenceEmail` takes its
 * preview path and never opens a socket.
 */

import { generateKeyPairSync } from "node:crypto";
import { Hono } from "hono";
import {
  auditEvents,
  mobileSerials,
  payments,
  staffOtpChallenges,
  staffOperators,
  staffSessions,
} from "@cyvra/database/schema";
import { adminRoutes, SUPER_ADMIN_EMAIL } from "../../src/admin.ts";
import { sha256Hex } from "../../src/crypto.ts";
import { generateLicenceKey, planCodeFor } from "../../src/licenceKey.ts";

export type Row = Record<string, unknown>;

export interface RecordedWrite {
  readonly table: string;
  readonly kind: "insert" | "update";
  readonly inTransaction: boolean;
  readonly values: Row;
}

export interface Harness {
  readonly state: {
    session: { email: string; expiresAt: Date } | null;
    operator: { id: string; email: string; status: string; role: string } | null;
    licence: Row | null;
    payment: Row | null;
    /** The one `staff_otp_challenges` row; consumed and re-read across calls. */
    challenge: Row | null;
    /** Answer for `select({ total: count() })`; see `HarnessSpec.totalCount`. */
    totalCount: number | null;
  };
  readonly writes: RecordedWrite[];
  readonly reads: string[];
  /**
   * Every `.limit()` / `.offset()` pair the caller passed, in call order.
   *
   * The double does not slice rows - it holds one - so without this a handler
   * that dropped its `.limit(pageSize)` would look identical to one that sent
   * it. The last entry for a table is the complete one, because the routes
   * always chain `.limit().offset()`.
   */
  readonly paged: { table: string; limit: number | null; offset: number | null }[];
  readonly database: unknown;
}

export interface HarnessSpec {
  session?: { email: string; expiresAt: Date } | null;
  /**
   * The raw token that `session` belongs to. Without it the double would
   * authenticate *any* bearer string, which would make it a fixture that
   * proves nothing about `sha256Hex`-keyed lookups - and would let a test pass
   * while the real session lookup was broken.
   */
  sessionToken?: string;
  operator?: { id: string; email: string; status: string; role: string } | null;
  licence?: Row | null;
  payment?: Row | null;
  /** Pre-existing OTP challenge, so a test can skip the `/auth/request` leg. */
  challenge?: Row | null;
  /**
   * What `select({ total: count() })` reports for `mobile_serials`.
   *
   * Deliberately separate from `licence`, because the whole point of the
   * Phase 2 pagination contract is the case where the count is *larger* than
   * what one response carries. Left unset it answers honestly for the single
   * row the double holds, so an ordinary test does not have to think about it.
   */
  totalCount?: number;
}

const tableNames = new Map<unknown, string>([
  [staffSessions, "staff_sessions"],
  [staffOperators, "staff_operators"],
  [staffOtpChallenges, "staff_otp_challenges"],
  [mobileSerials, "mobile_serials"],
  [payments, "payments"],
  [auditEvents, "audit_events"],
]);

function nameOf(table: unknown): string {
  return tableNames.get(table) ?? "unknown";
}

/**
 * A Drizzle-shaped double that records writes and mutates shared state.
 *
 * The three chain shapes the admin routes use are covered:
 *
 *   select().from().where().for().limit()   -> Promise<rows>
 *   update().set().where().returning()      -> Promise<rows>
 *   insert().values()                       -> thenable
 *   db.transaction(cb)                      -> cb(innerHandle)
 *
 * Builders are thenable because `await db.update(...).set(...).where(...)`
 * with no `.returning()` is a real statement in PHASE 4 of `/issue`, and a
 * double that was only awaitable after `.returning()` would silently never run
 * the email bookkeeping the replay test depends on.
 */
export function fakeDb(spec: HarnessSpec = {}): Harness {
  const state: Harness["state"] = {
    session: spec.session ?? null,
    operator: spec.operator ?? null,
    licence: spec.licence ?? null,
    payment: spec.payment ?? null,
    challenge: spec.challenge ?? null,
    totalCount: spec.totalCount ?? null,
  };
  const writes: RecordedWrite[] = [];
  const reads: string[] = [];
  const paged: Harness["paged"] = [];

  /**
   * Is this projection a count rather than a column projection?
   *
   * `select({ total: count() })` is the pagination total;
   * `select({ id: mobileSerials.id })` is `uniqueLicenceKey` probing whether a
   * key is already taken. They differ in what was asked for, not in which
   * route asked, so the check is about the query's shape - if a Drizzle upgrade
   * changes it, the detection fails closed to "a column projection", the total
   * comes back 0, and a test asserting a non-zero total fails loudly instead of
   * quietly agreeing with a broken double.
   */
  const isCount = (fields: unknown): boolean =>
    fields !== undefined &&
    Object.values(fields as Record<string, unknown>).some(
      (value) =>
        (value as { constructor?: { name?: string } } | null)?.constructor
          ?.name === "SQL",
    );

  const rowsFor = (table: string, fields: unknown): Row[] => {
    switch (table) {
      case "staff_sessions":
        return state.session ? [state.session as Row] : [];
      case "staff_operators":
        return state.operator ? [state.operator as Row] : [];
      case "staff_otp_challenges":
        return state.challenge ? [state.challenge as Row] : [];
      case "payments":
        return state.payment ? [state.payment as Row] : [];
      case "mobile_serials":
        // A bare `select()` is a handler reading the whole row. A projection
        // (`select({ id: mobileSerials.id })`) is `uniqueLicenceKey` probing
        // whether a key is already taken, and the honest answer for a key that
        // has never been allocated is "no such row".
        if (fields === undefined) return state.licence ? [state.licence] : [];
        if (isCount(fields)) {
          return [
            {
              total:
                state.totalCount ?? (state.licence === null ? 0 : 1),
            } as Row,
          ];
        }
        return [];
      default:
        return [];
    }
  };

  const write = (
    inTransaction: boolean,
    kind: "insert" | "update",
    table: string,
    values: Row,
  ): void => {
    writes.push({ table, kind, inTransaction, values });
    if (table === "mobile_serials") {
      state.licence = { ...(state.licence ?? {}), ...values };
    } else if (table === "payments") {
      state.payment = { ...(state.payment ?? {}), ...values };
    } else if (table === "staff_operators") {
      // The staff lifecycle changes status on a row the double already holds,
      // so the next read in the same test - and `returning()` on this very
      // update - has to see it. Without this `POST /staff/:id/suspend` answered
      // 404 because its UPDATE returned no row.
      state.operator = { ...(state.operator ?? {}), ...values } as NonNullable<
        Harness["state"]["operator"]
      >;
    } else if (table === "staff_otp_challenges") {
      state.challenge = { ...(state.challenge ?? {}), ...values };
    }
  };

  /**
   * The bound value inside a Drizzle `eq(column, value)` condition.
   *
   * Drizzle builds `eq` as an `SQL` tree of chunks, and the value sits in a
   * `Param` node. Reading it here is what lets the `staff_sessions` lookup be
   * answered against the hash that was actually requested rather than against
   * "does a session exist at all" - the difference between a double that could
   * catch a broken `sha256Hex` and one that would authenticate any string.
   *
   * When no parameter can be found the filter declines to narrow anything, so
   * a Drizzle upgrade that changes this shape degrades to permissive instead of
   * failing the suite for a reason that has nothing to do with the code under
   * test.
   */
  const paramOf = (condition: unknown): unknown => {
    const chunks = (condition as { queryChunks?: unknown[] } | null | undefined)
      ?.queryChunks;
    if (!Array.isArray(chunks)) return undefined;
    for (const chunk of chunks) {
      const name = (chunk as { constructor?: { name?: string } } | null)
        ?.constructor?.name;
      if (name === "Param") return (chunk as { value?: unknown }).value;
    }
    return undefined;
  };

  let sessionHash: Promise<string | null> | undefined;
  const expectedSessionHash = (): Promise<string | null> => {
    if (!spec.sessionToken) return Promise.resolve(null);
    sessionHash ??= sha256Hex(spec.sessionToken);
    return sessionHash;
  };

  const filter = async (
    table: string,
    rows: Row[],
    condition: unknown,
  ): Promise<Row[]> => {
    if (rows.length === 0) return rows;
    if (table === "staff_sessions") {
      const expected = await expectedSessionHash();
      if (expected === null) return rows;
      const presented = paramOf(condition);
      if (presented === undefined) return rows;
      return presented === expected ? rows : [];
    }
    /*
     * `staff_operators` is narrowed by whatever scalar was bound.
     *
     * Every admin route that reads this table does it with `eq(email, ...)` or
     * `eq(id, ...)` - "does this nominee exist", "is this staffId real". The
     * double used to answer "yes" to any of them from the one row it holds,
     * which meant inviting `alice@cyvoriq.com` while the actor's own row was
     * loaded came back as "alice is already ACTIVE". A double that answers a
     * different question than the one asked cannot catch a lifecycle bug.
     *
     * No bound value -> no narrowing, so `GET /staff` still lists what it holds.
     */
    if (table === "staff_operators") {
      const key = paramOf(condition);
      if (key === undefined || key === null) return rows;
      return rows.filter((row) => row.email === key || row.id === key);
    }
    return rows;
  };

  const handle = (inTransaction: boolean): Record<string, unknown> => {
    const self: Record<string, unknown> = {};

    self.select = (fields?: unknown) => {
      let table = "";
      let rows: Row[] = [];
      let condition: unknown;
      let limitValue: number | null = null;
      let offsetValue: number | null = null;
      const b: Record<string, unknown> = {
        from(target: unknown) {
          table = nameOf(target);
          reads.push(table);
          rows = rowsFor(table, fields);
          return b;
        },
        where(next: unknown) {
          condition = next;
          return b;
        },
        orderBy() {
          return b;
        },
        offset(value?: number) {
          offsetValue = value ?? null;
          paged.push({ table, limit: limitValue, offset: offsetValue });
          return b;
        },
        for() {
          return b;
        },
        /*
         * Returns the builder, not a promise.
         *
         * Drizzle's `.limit()` is itself chainable, and `GET /serials` chains
         * `.limit().offset()` - so a double that resolved at `.limit()` made
         * that route throw `.offset is not a function` under test, i.e. the
         * listing route was never exercised by the suite. Resolution happens
         * at `then()`, which every `await` in the handlers already goes
         * through, so awaiting `.limit(1)` behaves exactly as it did.
         */
        limit(value?: number) {
          limitValue = value ?? null;
          paged.push({ table, limit: limitValue, offset: offsetValue });
          return b;
        },
        returning() {
          return filter(table, rows, condition);
        },
        then(onFulfilled: unknown, onRejected: unknown) {
          return filter(table, rows, condition).then(onFulfilled, onRejected);
        },
      };
      return b;
    };

    self.update = (target: unknown) => {
      const table = nameOf(target);
      let values: Row = {};
      let applied = false;
      const commit = (): Row[] => {
        if (!applied) {
          applied = true;
          write(inTransaction, "update", table, values);
        }
        if (table === "mobile_serials") return state.licence ? [state.licence] : [];
        if (table === "payments") return state.payment ? [state.payment] : [];
        if (table === "staff_operators") return state.operator ? [state.operator as Row] : [];
        if (table === "staff_otp_challenges") return state.challenge ? [state.challenge] : [];
        return [];
      };
      const b: Record<string, unknown> = {
        set(next: Row) {
          values = next;
          return b;
        },
        where() {
          return b;
        },
        returning() {
          return Promise.resolve(commit());
        },
        then(onFulfilled: unknown, onRejected: unknown) {
          return Promise.resolve(commit()).then(onFulfilled, onRejected);
        },
      };
      return b;
    };

    self.insert = (target: unknown) => {
      const table = nameOf(target);
      let values: Row = {};
      let applied = false;
      /*
       * Returns the row that was inserted.
       *
       * Only `POST /auth/request` reads it - `insert(staffOtpChallenges)
       * .values(...).returning({ id })` - and it needs the challenge id to hand
       * back to the caller. The handler supplies `id` explicitly rather than
       * leaning on a database default, so the double can answer honestly with
       * what it was given.
       */
      const commit = (): Row[] => {
        if (!applied) {
          applied = true;
          write(inTransaction, "insert", table, values);
        }
        return [{ ...values }];
      };
      const b: Record<string, unknown> = {
        values(next: Row) {
          values = next;
          return b;
        },
        onConflictDoUpdate() {
          return b;
        },
        returning() {
          return Promise.resolve(commit());
        },
        then(onFulfilled: unknown, onRejected: unknown) {
          return Promise.resolve(commit()).then(onFulfilled, onRejected);
        },
      };
      return b;
    };

    self.transaction = async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(handle(true));

    return self;
  };

  return { state, writes, reads, paged, database: handle(false) };
}

/**
 * An in-memory Ed25519 signing configuration.
 *
 * Generated per call so no test ever depends on a key that exists outside its
 * own process, and so a `.env` value can never be read (or printed) by a test.
 */
export function signingEnv(): Record<string, string> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const der = privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;
  const pub = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  return {
    ENTITLEMENT_PRIVATE_KEY_B64: der.toString("base64"),
    // Public half, so a test can verify the signature it is handed rather than
    // only comparing one opaque string to another.
    ENTITLEMENT_PUBLIC_KEY_B64: pub.toString("base64"),
    // Required rather than defaulted: `readEntitlementPolicy` refuses to
    // invent a validity window, and a test that silently accepted a default
    // would be testing the default instead of the policy.
    ENTITLEMENT_VALIDITY_SECONDS: "31536000",
    ENTITLEMENT_GRACE_SECONDS: "86400",
    API_ENV: "preview",
  };
}

/** A licence row in the state `POST /serials/:id/issue` requires. */
export function licenceRow(overrides: Row = {}): Row {
  const at = new Date("2026-10-01T10:00:00.000Z");
  return {
    id: "11111111-1111-4111-8111-111111111111",
    customerEmail: "customer@example.com",
    customerFullName: "Test Buyer",
    companyName: null,
    brandScope: "SAMSUNG",
    customerKind: "SINGLE",
    deviceMax: 1,
    planCode: planCodeFor(1),
    hostBindingStatus: "UNBOUND",
    status: "KEY_GENERATED",
    publicNumber: generateLicenceKey({ at, kind: "SINGLE", slabMax: 1 }),
    generatedBy: "auditor@cyvoriq.com",
    issuedBy: null,
    issuedAt: null,
    revokedAt: null,
    createdAt: at,
    emailedAt: null,
    emailMessageId: null,
    emailError: null,
    devicesBound: 0,
    paymentNoted: "UPI reference on file",
    userId: null,
    addressLine1: null,
    addressLine2: null,
    pincode: null,
    state: null,
    ...overrides,
  };
}

/** A `payments` row that satisfies the Green Key Rule. */
export function paidPayment(licenceId: string): Row {
  const at = new Date("2026-10-01T10:05:00.000Z");
  return {
    id: "22222222-2222-4222-8222-222222222222",
    licenceId,
    status: "PAID",
    amount: "5000.00",
    currency: "INR",
    reference: "UPI-2026-10-01",
    confirmedBy: "ceo@cyvoriq.com",
    confirmedAt: at,
    notes: null,
  };
}

export function mountAdmin(harness: Harness, env: Record<string, string> = {}) {
  const app = new Hono() as unknown as {
    use: (path: string, mw: unknown) => void;
    route: (path: string, sub: unknown) => void;
    request: (
      input: string,
      init?: RequestInit,
      bindings?: unknown,
    ) => Promise<Response>;
  };
  // `adminRoutes` calls `c.get("db")`; `index.ts` sets it from Hyperdrive, and
  // here it is the recorder. The env is passed per-request through Hono's
  // third `app.request` argument rather than a global, so one mounted app can
  // serve both "signing configured" and "signing missing" cases.
  app.use("*", async (c: { set: (k: string, v: unknown) => void; next: () => Promise<void> }, next: () => Promise<void>) => {
    c.set("db", harness.database);
    await next();
  });
  app.route("/admin", adminRoutes);
  return {
    app,
    env,
    request: (
      path: string,
      init: {
        method?: string;
        token?: string;
        spoofEmail?: string;
        ip?: string;
        body?: unknown;
        env?: Record<string, string>;
      } = {},
    ) => {
      const headers: Record<string, string> = {};
      if (init.token) headers["Authorization"] = `Bearer ${init.token}`;
      // Deliberately accepted here so tests can prove it is inert (E3).
      if (init.spoofEmail) headers["X-Admin-Email"] = init.spoofEmail;
      if (init.ip) headers["CF-Connecting-IP"] = init.ip;
      if (init.body !== undefined) headers["Content-Type"] = "application/json";
      return app.request(
        `/admin${path}`,
        {
          method: init.method ?? "GET",
          headers,
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        },
        { ...env, ...(init.env ?? {}) },
      );
    },
  };
}

export const STAFF_TOKEN = "test-staff-token";

/** Convenience: a harness with an ACTIVE operator holding a live session. */
export function staffHarness(
  email: string,
  role: string,
  overrides: HarnessSpec = {},
): Harness {
  return fakeDb({
    session: { email, expiresAt: new Date(Date.now() + 60_000) },
    sessionToken: STAFF_TOKEN,
    operator: { id: "33333333-3333-4333-8333-333333333333", email, status: "ACTIVE", role },
    ...overrides,
  });
}

/** A `staff_operators` row with an explicit lifecycle status. */
export function operatorRow(overrides: Row = {}): Row {
  const at = new Date("2026-10-01T09:00:00.000Z");
  return {
    id: "44444444-4444-4444-8444-444444444444",
    email: "alice@cyvoriq.com",
    status: "INVITED",
    role: "OPERATOR",
    nominatedBy: "ceo@cyvoriq.com",
    nominatedAt: at,
    emailVerifiedAt: null,
    suspendedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

/**
 * A Super Admin session acting on somebody else's staff row.
 *
 * `staffHarness` puts the session identity and the managed row on the same
 * single record, which is right for "does my own permission allow this" and
 * wrong for the lifecycle routes, where the Super Admin invites, approves,
 * suspends or revokes *another* address. The Super Admin needs no row of their
 * own (`lookupStaffSession` resolves the address), so `operator` defaults to
 * null and is set to the target instead.
 */
export function superAdminHarness(overrides: HarnessSpec = {}): Harness {
  return fakeDb({
    session: { email: SUPER_ADMIN_EMAIL, expiresAt: new Date(Date.now() + 60_000) },
    sessionToken: STAFF_TOKEN,
    operator: null,
    ...overrides,
  });
}
