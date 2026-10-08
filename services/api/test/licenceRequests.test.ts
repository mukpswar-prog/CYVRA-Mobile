/**
 * Integration tests for `POST /v1/licence-requests` (WS-K3, spec 9 / spec 10).
 *
 * The real Hono route is driven end to end against an in-memory repository, and
 * nothing reaches Postgres. What is pinned here is the difference between this
 * route and the honesty notice it replaces, because those differences are the
 * ones a later "simplification" would reintroduce:
 *
 *  1. **The session email wins.** A body naming another address is overwritten
 *     before any lookup, so a request can never be filed against somebody
 *     else's record.
 *  2. **Only `requested_at` is written.** The body is validated and then not
 *     persisted: no payment status, no row status, no capacity. An endpoint
 *     that accepted `status: "ISSUED"` from the customer would be spec 3 step
 *     3 running backwards.
 *  3. **The chosen slab is recorded where it cannot be spent.** It lands in the
 *     audit payload, never on `device_max`, so an unpaid customer cannot grant
 *     themselves 50 scans in one POST (`REGISTRATION_DEFAULT_SLAB`'s ruling).
 *  4. **404, not 403**, for another customer's row - including when the
 *     repository itself is mis-scoped.
 *  5. **The rate limit is real and readable**: 429 with `Retry-After`, and the
 *     original stamp echoed so a client can recover as "submitted" rather than
 *     surface a failure for a request that landed.
 *
 * ## Why every request carries a database that answers "no staff session"
 *
 * The frame that backs the audit row comes from `selfServiceAuditContext`, the
 * same helper the registration bridge uses. It probes for a *staff* session
 * before falling back to the request's client IP, and that probe needs a
 * database connection. A licence request comes from a customer, so the honest
 * answer to the probe is the one this double gives: there is no staff session
 * here. The alternative - a hand-built frame - would reimplement the helper and
 * quietly fork the one thing the audit trail must never do, which is decide a
 * frame's shape per route.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { Hono } from "hono";
import type { Database } from "../src/db.ts";
import type { Env } from "../src/env.ts";
import {
  LICENCE_REQUEST_ROUTE,
  REQUEST_MIN_INTERVAL_MS,
  buildLicenceRequestRoutes,
  withinMinInterval,
  type LicenceRequestRepo,
  type LicenceRequestRow,
  type LicenceRequestUser,
  type SubmitInput,
} from "../src/licenceRequests.ts";
import { SESSION_COOKIE } from "../src/session.ts";

const ENV = {} as unknown as Env;
const PATH = "/licence-requests";

const EMAIL = "requester@example.invalid";
const OTHER_EMAIL = "someone-else@example.invalid";
const TOKEN = "sess-licence-request-entropy-free-for-tests";
const SERIAL_ID = "8b1c6f42-1e6a-4a10-9d9a-2f0b6c5f7a31";

const USER: LicenceRequestUser = {
  id: "u-1",
  email: EMAIL,
  fullName: "Request Requester",
  companyName: "Example Ltd",
  addressLine1: "1 Test Road",
  addressLine2: null,
  pincode: "560001",
  state: "Karnataka",
};

const ISSUED_AT = new Date("2026-09-01T12:00:00.000Z");
const CREATED_AT = new Date("2026-09-01T11:00:00.000Z");

/** A faithful `mobile_serials` row: 36 columns, none invented. */
function serial(overrides: Partial<LicenceRequestRow["serial"]> = {}): LicenceRequestRow["serial"] {
  return {
    id: SERIAL_ID,
    publicNumber: null,
    status: "PAYMENT_PENDING",
    customerEmail: EMAIL,
    userId: null,
    paymentNoted: null,
    issuedBy: null,
    issuedAt: null,
    revokedAt: null,
    createdAt: CREATED_AT,
    customerKind: "SINGLE",
    deviceMax: 1,
    brandScope: "UNSPECIFIED",
    customerFullName: "Request Requester",
    companyName: "Example Ltd",
    addressLine1: "1 Test Road",
    addressLine2: null,
    pincode: "560001",
    state: "Karnataka",
    requestedAt: null,
    devicesBound: 0,
    emailedAt: null,
    emailMessageId: null,
    emailError: null,
    hostFingerprint: null,
    firstActivatedAt: null,
    deviceTokenHash: null,
    createdBy: null,
    generatedBy: null,
    approvedBy: null,
    hostBindingStatus: "NOT_BOUND",
    planCode: "CAP-1",
    validityStartsAt: null,
    validityEndsAt: null,
    updatedBy: null,
    rowVersion: 1,
    ...overrides,
  };
}

/** Records what it was asked for, so scoping can be asserted rather than assumed. */
class FakeRepo implements LicenceRequestRepo {
  readonly sessionCalls: string[] = [];
  readonly emailCalls: string[] = [];
  ensureCalls = 0;
  readonly submissions: SubmitInput[] = [];
  failSubmit = false;

  constructor(
    private readonly sessions: Record<string, LicenceRequestUser>,
    private readonly row: LicenceRequestRow | null,
    private readonly ensured: LicenceRequestRow | null = null,
  ) {}

  async findUserBySessionToken(token: string): Promise<LicenceRequestUser | null> {
    this.sessionCalls.push(token);
    return this.sessions[token] ?? null;
  }

  async findForEmail(email: string): Promise<LicenceRequestRow | null> {
    this.emailCalls.push(email);
    return this.row;
  }

  async ensureSerial(_c: unknown, user: LicenceRequestUser): Promise<LicenceRequestRow | null> {
    this.ensureCalls += 1;
    assert.equal(user.email, EMAIL, "the bridge must be seeded with the session's address");
    return this.ensured;
  }

  async submit(input: SubmitInput): Promise<void> {
    if (this.failSubmit) throw new Error("write path unreachable");
    this.submissions.push(input);
  }
}

function repoFor(
  serialRow: LicenceRequestRow["serial"] | null,
  sessions: Record<string, LicenceRequestUser> = { [TOKEN]: USER },
  ensured: LicenceRequestRow["serial"] | null = null,
): FakeRepo {
  return new FakeRepo(
    sessions,
    serialRow === null ? null : { serial: serialRow },
    ensured === null ? null : { serial: ensured },
  );
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function viaCookie(token: string): Record<string, string> {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

/**
 * A `select` chain that answers "no rows": `lookupStaffSession` never finds a
 * staff session behind a customer's request, so the frame falls back to the
 * request's own client IP.
 */
function dbWithNoStaffSession(): Database {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([]),
  };
  return { select: () => chain } as unknown as Database;
}

function post(
  repo: LicenceRequestRepo,
  body: unknown,
  headers: Record<string, string> = bearer(TOKEN),
): Promise<Response> {
  const app = new Hono<{ Bindings: Env; Variables: { db: Database } }>();
  app.use("*", async (c, next) => {
    c.set("db", dbWithNoStaffSession());
    await next();
  });
  app.route("/", buildLicenceRequestRoutes({ repo }));
  return app.request(
    PATH,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    ENV,
  );
}

/** The spec 10 summary the Workspace actually submits. */
const BODY = {
  fullName: "Request Requester",
  companyName: "Example Ltd",
  addressLine1: "1 Test Road",
  addressLine2: null,
  pincode: "560001",
  state: "Karnataka",
  plan: 25,
};

// ---------------------------------------------------------------------------
// Authentication: customer session only
// ---------------------------------------------------------------------------

test("no session is 401, and storage is never consulted to reach that answer", async () => {
  const repo = repoFor(serial());
  const res = await buildLicenceRequestRoutes({ repo }).request(PATH, { method: "POST" }, ENV);

  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "Sign in required." });
  assert.deepEqual(repo.sessionCalls, [], "an anonymous request must short-circuit first");
  assert.deepEqual(repo.submissions, [], "and must write nothing");
});

test("an unrecognised session token is 401, over the cookie the dashboard actually sends", async () => {
  const repo = repoFor(serial());
  const res = await post(repo, BODY, viaCookie("not-a-real-token"));

  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "Sign in required." });
  assert.deepEqual(repo.emailCalls, [], "no session must mean no licence read");
});

// ---------------------------------------------------------------------------
// Validation: what the endpoint refuses before it reads anything
// ---------------------------------------------------------------------------

test("a body that fails validation is 400 with the field's own message, and writes nothing", async () => {
  const repo = repoFor(serial());
  const res = await post(repo, { ...BODY, pincode: "12" });

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "A 6-digit pincode is required." });
  assert.deepEqual(repo.emailCalls, [], "validation runs before storage is touched");
  assert.deepEqual(repo.submissions, []);
});

test("a slab outside the five issuable plans is refused with the list, not silently coerced", async () => {
  // 3 and 7 are LEGACY codes a new record may not be born on; 4 is unencodable.
  for (const plan of [3, 4, 7, 100]) {
    const repo = repoFor(serial());
    const res = await post(repo, { ...BODY, plan });

    assert.equal(res.status, 400, `plan ${plan} must not be accepted`);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /1, 5, 10, 25, 50/, "the refusal names the issuable slabs");
    assert.deepEqual(repo.submissions, []);
  }
});

test("a non-JSON body is 400 rather than a 500", async () => {
  const repo = repoFor(serial());
  const res = await post(repo, "not json {");

  assert.equal(res.status, 400);
  assert.deepEqual(repo.submissions, []);
});

// ---------------------------------------------------------------------------
// The session decides whose request this is
// ---------------------------------------------------------------------------

test("the session email overwrites a body that names another customer", async () => {
  const repo = repoFor(serial());
  const res = await post(repo, { ...BODY, email: "attacker@evil.invalid" });

  assert.equal(res.status, 200);
  assert.deepEqual(
    repo.emailCalls,
    [EMAIL],
    "only the authenticated address may scope the licence read",
  );
  assert.equal(repo.submissions[0]!.customerEmail, EMAIL);
});

test("another customer's row is 404, never 403 - even if the repository is mis-scoped", async () => {
  const repo = repoFor(serial({ customerEmail: OTHER_EMAIL }));
  const res = await post(repo, BODY);

  assert.equal(res.status, 404, "403 would confirm that the other customer's row exists");
  assert.deepEqual(await res.json(), { error: "Licence not found." });
  assert.deepEqual(repo.submissions, [], "a refusal must not write a request");
});

test("a customer with no row yet is created through the bridge, then stamped", async () => {
  const ensuredRow = serial({ id: "6e0d9a77-1b2f-4c31-8a4e-0d5f9b2c7e60" });
  const repo = repoFor(null, { [TOKEN]: USER }, ensuredRow);
  const res = await post(repo, BODY);

  assert.equal(res.status, 200);
  assert.equal(repo.ensureCalls, 1, "exactly one bridge call - the sanctioned insert path");
  assert.equal(repo.submissions.length, 1);
  assert.equal(
    repo.submissions[0]!.serialId,
    ensuredRow.id,
    "the stamp lands on the row the bridge just created",
  );
});

test("a bridge that declines to create a row is 503, never a request against nothing", async () => {
  const repo = repoFor(null, { [TOKEN]: USER }, null);
  const res = await post(repo, BODY);

  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "Licence request is unavailable." });
  assert.deepEqual(repo.submissions, []);
});

// ---------------------------------------------------------------------------
// What gets written: exactly `requested_at`, plus an audit row
// ---------------------------------------------------------------------------

test("a submission answers SUBMITTED with an ISO stamp that matches what was stored", async () => {
  const repo = repoFor(serial());
  const res = await post(repo, BODY);

  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["requestedAt", "status"]);
  assert.equal(body.status, "SUBMITTED");
  assert.match(String(body.requestedAt), /^\d{4}-\d{2}-\d{2}T.*Z$/, "ISO-8601, not a locale string");

  const submitted = repo.submissions[0]!;
  assert.equal(submitted.requestedAt.toISOString(), body.requestedAt);
  assert.equal(
    submitted.previousRequestedAt,
    null,
    "a first request has no previous request to report",
  );
});

test("the audit frame names SYSTEM with the customer's address, never a staff actor", async () => {
  const repo = repoFor(serial());
  await post(repo, BODY);

  const frame = repo.submissions[0]!.frame;
  assert.equal(frame.actorRole, "SYSTEM");
  assert.equal(frame.actorId, null, "no operator row stands behind a customer's own click");
  assert.equal(frame.actorEmail, EMAIL);
  assert.equal(frame.route, PATH, "the trail records where the action came from");
});

test("the chosen slab is recorded in the audit payload, never as row capacity", async () => {
  const repo = repoFor(serial({ deviceMax: 1 }));
  const res = await post(repo, { ...BODY, plan: 50 });

  assert.equal(res.status, 200);
  const submitted = repo.submissions[0]!;
  assert.equal(submitted.requestedPlanCode, "CAP-50", "spec 10's Selected licence type");
  assert.equal(submitted.requestedDeviceMax, 50);
  assert.equal(
    "deviceMax" in submitted,
    false,
    "the row's capacity is not a field this route may set",
  );
});

test("payment and status fields in the body are never readable, let alone writable", async () => {
  const repo = repoFor(serial());
  const res = await post(repo, {
    ...BODY,
    paymentStatus: "PAID",
    status: "ISSUED",
    planCode: "CAP-50",
    issuedAt: new Date().toISOString(),
  });

  assert.equal(res.status, 200, "unknown fields are ignored rather than echoed as an error");
  const submitted = repo.submissions[0]!;
  for (const forbidden of ["paymentStatus", "status", "planCode", "issuedAt"]) {
    assert.equal(
      forbidden in submitted,
      false,
      `spec 3 step 3: ${forbidden} is recorded by the business, not typed by the customer`,
    );
  }
});

test("a failed write is 503 with no success payload", async () => {
  const repo = repoFor(serial());
  repo.failSubmit = true;
  const res = await post(repo, BODY);

  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "Licence request is unavailable." });
});

// ---------------------------------------------------------------------------
// Rate limiting (ruling R-K3)
// ---------------------------------------------------------------------------

test("a second request inside the window is 429 with Retry-After and the original stamp", async () => {
  const recent = new Date(Date.now() - 5_000);
  const repo = repoFor(serial({ requestedAt: recent }));
  const res = await post(repo, BODY);

  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), String(REQUEST_MIN_INTERVAL_MS / 1000));
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.requestedAt, recent.toISOString(), "the client is told what already landed");
  assert.match(String(body.error), /already submitted/i);
  assert.deepEqual(repo.submissions, [], "the limit must bind the write, not just the answer");
});

test("a request once the window has passed is accepted", async () => {
  const old = new Date(Date.now() - REQUEST_MIN_INTERVAL_MS - 1_000);
  const repo = repoFor(serial({ requestedAt: old }));
  const res = await post(repo, BODY);

  assert.equal(res.status, 200);
  assert.equal(repo.submissions.length, 1);
  assert.equal(
    repo.submissions[0]!.previousRequestedAt!.toISOString(),
    old.toISOString(),
    "the previous stamp still reaches the audit row as `previous`",
  );
});

test("withinMinInterval: never-requested is always allowed, and the boundary is exclusive", () => {
  const now = new Date("2026-10-08T12:00:00.000Z");

  assert.equal(withinMinInterval(null, now), false, "NULL means never asked, not 'just asked'");

  const justUnder = new Date(now.getTime() - REQUEST_MIN_INTERVAL_MS + 1);
  assert.equal(withinMinInterval(justUnder, now), true, "one millisecond short is still in-window");

  const exactly = new Date(now.getTime() - REQUEST_MIN_INTERVAL_MS);
  assert.equal(
    withinMinInterval(exactly, now),
    false,
    "at the boundary the window has closed, so the next request is accepted",
  );

  const future = new Date(now.getTime() + 60_000);
  assert.equal(withinMinInterval(future, now), true, "a clock skew cannot widen the window");
});

// ---------------------------------------------------------------------------
// The route key, declared once
// ---------------------------------------------------------------------------

test("the documented route key matches the path the handler serves", async () => {
  const repo = repoFor(serial());
  const routes = buildLicenceRequestRoutes({ repo });
  const paths = routes.routes.map((r) => `${r.method} ${r.path}`);

  assert.ok(paths.includes("POST /licence-requests"), `saw ${paths.join(", ")}`);
  assert.equal(LICENCE_REQUEST_ROUTE, "POST /v1/licence-requests");
});
