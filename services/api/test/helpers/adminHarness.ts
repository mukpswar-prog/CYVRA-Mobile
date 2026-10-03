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
  staffOperators,
  staffSessions,
} from "@cyvra/database/schema";
import { adminRoutes } from "../../src/admin.ts";
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
  };
  readonly writes: RecordedWrite[];
  readonly reads: string[];
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
}

const tableNames = new Map<unknown, string>([
  [staffSessions, "staff_sessions"],
  [staffOperators, "staff_operators"],
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
  };
  const writes: RecordedWrite[] = [];
  const reads: string[] = [];

  const rowsFor = (table: string, fields: unknown): Row[] => {
    switch (table) {
      case "staff_sessions":
        return state.session ? [state.session as Row] : [];
      case "staff_operators":
        return state.operator ? [state.operator as Row] : [];
      case "payments":
        return state.payment ? [state.payment as Row] : [];
      case "mobile_serials":
        // A bare `select()` is a handler reading the whole row. A projection
        // (`select({ id: mobileSerials.id })`) is `uniqueLicenceKey` probing
        // whether a key is already taken, and the honest answer for a key that
        // has never been allocated is "no such row".
        if (fields === undefined) return state.licence ? [state.licence] : [];
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
    if (table !== "staff_sessions" || rows.length === 0) return rows;
    const expected = await expectedSessionHash();
    if (expected === null) return rows;
    const presented = paramOf(condition);
    if (presented === undefined) return rows;
    return presented === expected ? rows : [];
  };

  const handle = (inTransaction: boolean): Record<string, unknown> => {
    const self: Record<string, unknown> = {};

    self.select = (fields?: unknown) => {
      let table = "";
      let rows: Row[] = [];
      let condition: unknown;
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
        offset() {
          return b;
        },
        for() {
          return b;
        },
        limit() {
          return filter(table, rows, condition);
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
      const commit = (): Row[] => {
        if (!applied) {
          applied = true;
          write(inTransaction, "insert", table, values);
        }
        return [];
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

  return { state, writes, reads, database: handle(false) };
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
