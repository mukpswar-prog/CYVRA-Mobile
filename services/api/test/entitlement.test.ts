/**
 * Integration tests for `GET /v1/me/entitlement`.
 *
 * The real Hono route is driven end to end against an in-memory stand-in for
 * storage, and nothing reaches Postgres. What is pinned here is the difference
 * between this route and the one it supersedes, because those differences are
 * exactly the ones a later "simplification" would reintroduce:
 *
 *  1. **No fabricated licence.** `/license` answered a customer with no serial
 *     `CYVRA-PREVIEW-TRIAL-1-3` + `ACTIVE`. This route answers 404.
 *  2. **No key material.** `maskSerialKey` is the only form of a key that may
 *     leave the server outside `GET /admin/serials/:serialId`.
 *  3. **No operator vocabulary.** Every one of the ten licence states must
 *     produce a sentence that is not the enum itself.
 *  4. **404, not 403**, for another customer's serial - including when the
 *     repository itself is mis-scoped, which is the one failure no other test
 *     here could see.
 *  5. **A failed read is 503 with no counters at all**, so no caller can read
 *     an absent ledger as a zero, and the scan segment can never become a
 *     number while R-1 is unrated.
 *
 * `requireUser`'s own expiry/join logic is not re-tested here; it is shared
 * with `/reports` and `/evidence` and covered there. What *is* exercised is the
 * route's use of it: `readSessionToken` (Bearer and cookie) runs for real.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { licenceStatusEnum, type LicenceStatus } from "@cyvra/database/schema";
import {
  buildEntitlementRoutes,
  normalizeBuild,
  type BuildManifest,
  type EntitlementRepo,
  type EntitlementRow,
  type EntitlementUser,
} from "../src/entitlement.ts";
import { LICENCE_SLABS, planCodeFor } from "../src/licenceKey.ts";
import { maskSerialKey } from "../src/admin.ts";
import { SESSION_COOKIE } from "../src/session.ts";
import type { Env } from "../src/env.ts";

const ENV = {} as unknown as Env;
const PATH = "/me/entitlement";

const EMAIL = "buyer@example.invalid";
const OTHER_EMAIL = "someone-else@example.invalid";
const TOKEN = "sess-3f9c1a7e-entropy-free-for-tests";
const OTHER_TOKEN = "sess-other-customer";
const KEY = "CYVRA01092026SA3F1-1-25";
/** Pinned literally, so the assertion does not depend on `maskSerialKey` alone. */
const MASKED = "CYVRA*************-1-25";
const SERIAL_ID = "30c5638d-e17d-43ee-9f0f-eddb4bba3696";

/** Two distinct signed-in customers, so scoping has something to distinguish. */
const USER: EntitlementUser = { id: "u-1", email: EMAIL, companyName: "Example Ltd" };
/** Deliberately has no company name, so a missing one must survive as null. */
const OTHER_USER: EntitlementUser = { id: "u-2", email: OTHER_EMAIL, companyName: null };

const ISSUED_AT = new Date("2026-09-01T12:00:00.000Z");
const CREATED_AT = new Date("2026-09-01T11:00:00.000Z");
const ACTIVATED_AT = new Date("2026-09-02T08:30:00.000Z");
const VALIDITY_ENDS = new Date("2027-09-01T12:00:00.000Z");

function serial(overrides: Partial<EntitlementRow["serial"]> = {}): EntitlementRow["serial"] {
  return {
    id: SERIAL_ID,
    publicNumber: KEY,
    status: "ACTIVE",
    customerEmail: EMAIL,
    userId: null,
    paymentNoted: "UPI",
    issuedBy: "ceo@cyvoriq.com",
    issuedAt: ISSUED_AT,
    revokedAt: null,
    createdAt: CREATED_AT,
    customerKind: "SINGLE",
    deviceMax: 25,
    brandScope: "UNSPECIFIED",
    customerFullName: "Test Customer",
    companyName: "Example Ltd",
    addressLine1: null,
    addressLine2: null,
    pincode: null,
    state: null,
    devicesBound: 0,
    emailedAt: null,
    emailMessageId: null,
    emailError: null,
    hostFingerprint: null,
    firstActivatedAt: null,
    deviceTokenHash: null,
    createdBy: "ceo@cyvoriq.com",
    generatedBy: "ceo@cyvoriq.com",
    approvedBy: "ceo@cyvoriq.com",
    hostBindingStatus: "NOT_BOUND",
    planCode: "CAP-25",
    validityStartsAt: null,
    validityEndsAt: null,
    updatedBy: null,
    rowVersion: 1,
    ...overrides,
  };
}

/** Records what it was asked for, so scoping can be asserted rather than assumed. */
class FakeRepo implements EntitlementRepo {
  sessionCalls: string[] = [];
  emailCalls: string[] = [];
  failSession = false;
  failEntitlement = false;

  constructor(
    private readonly sessions: Record<string, EntitlementUser>,
    private readonly row: EntitlementRow | null,
  ) {}

  async findUserBySessionToken(token: string): Promise<EntitlementUser | null> {
    this.sessionCalls.push(token);
    if (this.failSession) throw new Error("sessions table unreachable");
    return this.sessions[token] ?? null;
  }

  async findForEmail(email: string): Promise<EntitlementRow | null> {
    this.emailCalls.push(email);
    if (this.failEntitlement) throw new Error("ledger read failed");
    return this.row;
  }
}

function repoFor(
  row: EntitlementRow | null,
  sessions: Record<string, EntitlementUser> = { [TOKEN]: USER },
): FakeRepo {
  return new FakeRepo(sessions, row);
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function viaCookie(token: string): Record<string, string> {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

function get(
  repo: EntitlementRepo,
  headers: Record<string, string> = bearer(TOKEN),
  build?: unknown,
): Promise<Response> {
  return buildEntitlementRoutes({ repo, build }).request(PATH, { headers }, ENV);
}

// ---------------------------------------------------------------------------
// Authentication: customer session only
// ---------------------------------------------------------------------------

test("no session is 401, and storage is never consulted to reach that answer", async () => {
  const repo = repoFor({ serial: serial() });
  const res = await buildEntitlementRoutes({ repo }).request(PATH, {}, ENV);

  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "Sign in required." });
  assert.equal(
    repo.sessionCalls.length,
    0,
    "an anonymous request must short-circuit before any read",
  );
});

test("an unrecognised session token is 401, over the cookie the dashboard actually sends", async () => {
  const repo = repoFor({ serial: serial() });
  const res = await get(repo, viaCookie("not-a-real-token"));

  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "Sign in required." });
  assert.equal(repo.emailCalls.length, 0, "no session must mean no entitlement read");
});

test("an expired-or-bogus token resolves through the same path as a good one", async () => {
  const repo = repoFor({ serial: serial() }, { [OTHER_TOKEN]: OTHER_USER });
  const res = await get(repo, bearer(TOKEN));

  assert.equal(res.status, 401);
  assert.deepEqual(repo.sessionCalls, [TOKEN], "the presented token is what gets looked up");
});

// ---------------------------------------------------------------------------
// Scoping: another customer's serial is unreachable, and 404 rather than 403
// ---------------------------------------------------------------------------

test("the entitlement read is scoped to the session's own email", async () => {
  const repo = repoFor({ serial: serial() });
  const res = await get(repo);

  assert.equal(res.status, 200);
  assert.deepEqual(
    repo.emailCalls,
    [EMAIL],
    "only the authenticated customer's email may be used as the scope",
  );
});

test("a second customer's session asks for its own email, never the first's", async () => {
  const repo = repoFor({ serial: serial({ customerEmail: OTHER_EMAIL }) }, {
    [TOKEN]: USER,
    [OTHER_TOKEN]: OTHER_USER,
  });
  const res = await get(repo, bearer(OTHER_TOKEN));

  assert.equal(res.status, 200);
  assert.deepEqual(repo.emailCalls, [OTHER_EMAIL]);
});

test("a customer with no company name reports null, never an invented one", async () => {
  const repo = repoFor({ serial: serial({ customerEmail: OTHER_EMAIL }) }, {
    [OTHER_TOKEN]: OTHER_USER,
  });
  const res = await get(repo, bearer(OTHER_TOKEN));

  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, any>;
  assert.deepEqual(body.customer, { companyName: null, email: OTHER_EMAIL });
});

test("another customer's serial is 404, never 403 - even if the repository is mis-scoped", async () => {
  // A hostile/broken repo: it was asked for THIS customer and answered with a
  // row belonging to somebody else. The projection must refuse it, because a
  // 200 here would be a data leak and a 403 would confirm the row exists.
  const repo = repoFor({ serial: serial({ customerEmail: OTHER_EMAIL }) });
  const res = await get(repo);

  assert.equal(res.status, 404, "403 would confirm that the other customer's row exists");
  assert.deepEqual(await res.json(), { error: "Licence not found." });
});

test("a customer with no serial gets 404, not a preview licence", async () => {
  const repo = repoFor(null);
  const res = await get(repo);

  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "Licence not found." });
});

// ---------------------------------------------------------------------------
// The projection: no key, no operator vocabulary, no invented numbers
// ---------------------------------------------------------------------------

test("the success payload carries exactly the documented top-level shape", async () => {
  const repo = repoFor({ serial: serial(), paymentStatus: "PAID" });
  const res = await get(repo);

  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, any>;

  assert.deepEqual(
    Object.keys(body).sort(),
    ["build", "customer", "licence", "payment", "plan", "usage", "validity"],
  );
  assert.deepEqual(Object.keys(body.customer).sort(), ["companyName", "email"]);
  assert.equal(
    body.customer.companyName,
    "Example Ltd",
    "the dashboard header reads the signed-in account, not a copy on the serial",
  );
  assert.equal(body.customer.email, EMAIL, "the User ID this product signs in with");
  assert.deepEqual(Object.keys(body.plan).sort(), ["code", "label", "slab"]);
  assert.deepEqual(Object.keys(body.licence).sort(), ["maskedSerial", "sentence", "status"]);
  assert.deepEqual(Object.keys(body.usage).sort(), ["activation", "scans"]);
  assert.deepEqual(Object.keys(body.usage.activation).sort(), ["activatedAt", "hostBinding"]);

  assert.equal(body.plan.code, "CAP-25");
  assert.equal(body.plan.slab, "1-25");
  assert.equal(body.licence.status, "ACTIVE");
  assert.equal(body.licence.sentence, "Active");
  assert.equal(body.payment.state, "known");
  assert.equal(body.payment.sentence, "Paid");
});

test("no key material appears anywhere in the payload", async () => {
  const repo = repoFor({ serial: serial(), paymentStatus: "PAID" });
  const res = await get(repo);

  assert.equal(res.status, 200);
  const raw = JSON.stringify(await res.json());
  const body = JSON.parse(raw) as Record<string, any>;

  assert.equal(
    raw.includes(KEY),
    false,
    "the full licence key must never leave the server on this route",
  );
  assert.equal(raw.includes("A3F1"), false, "the uniqueness nibble is the whole key");
  assert.equal(body.licence.maskedSerial, MASKED);
  assert.equal(body.licence.maskedSerial, maskSerialKey(KEY));
});

test("every licence state produces a sentence that is not the operator enum", async () => {
  const statuses = licenceStatusEnum.enumValues as readonly LicenceStatus[];
  assert.equal(statuses.length, 10, "the ten states are the contract; a change here is a decision");

  for (const status of statuses) {
    const repo = repoFor({ serial: serial({ status }), paymentStatus: null });
    const res = await get(repo);
    assert.equal(res.status, 200, `${status} must still render`);

    const body = (await res.json()) as Record<string, any>;
    assert.equal(body.licence.status, status);
    assert.equal(
      typeof body.licence.sentence,
      "string",
      `${status} must map to a sentence, never undefined`,
    );
    assert.notEqual(
      body.licence.sentence,
      status,
      `${status} leaked the raw enum to the customer`,
    );
    assert.ok(body.licence.sentence.length > 0, `${status} produced an empty sentence`);
  }
});

test("an absent payment row reads as unknown, never as PENDING", async () => {
  const repo = repoFor({ serial: serial(), paymentStatus: null });
  const res = await get(repo);

  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, any>;

  assert.deepEqual(body.payment, { state: "unknown", status: null, sentence: null });
});

test("a null validity window reads as unknown, never as an epoch or a zero", async () => {
  const repo = repoFor({ serial: serial(), paymentStatus: "PAID" });
  const res = await get(repo);

  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, any>;

  assert.deepEqual(body.validity, { state: "unknown", startsAt: null, endsAt: null });
  assert.equal(
    JSON.stringify(body.validity).includes("1970"),
    false,
    "a missing window must not become the epoch",
  );
});

test("a populated validity window is reported as the column states it", async () => {
  const repo = repoFor({
    serial: serial({ validityStartsAt: ISSUED_AT, validityEndsAt: VALIDITY_ENDS }),
    paymentStatus: "PAID",
  });
  const res = await get(repo);

  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, any>;

  assert.deepEqual(body.validity, {
    state: "window",
    startsAt: ISSUED_AT.toISOString(),
    endsAt: VALIDITY_ENDS.toISOString(),
  });
});

test("activation is a timestamp and a binding state, never a count", async () => {
  const repo = repoFor({
    serial: serial({
      firstActivatedAt: ACTIVATED_AT,
      hostBindingStatus: "BOUND",
      hostFingerprint: "fp",
    }),
    paymentStatus: "PAID",
  });
  const res = await get(repo);

  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, any>;

  assert.deepEqual(body.usage.activation, {
    activatedAt: ACTIVATED_AT.toISOString(),
    hostBinding: "BOUND",
  });
  assert.equal(
    "count" in body.usage.activation,
    false,
    "there is no activations table; a count would be invented",
  );
});

test("an unactivated licence reports null activation, not a zero", async () => {
  const repo = repoFor({ serial: serial(), paymentStatus: "PAID" });
  const res = await get(repo);

  const body = (await res.json()) as Record<string, any>;
  assert.deepEqual(body.usage.activation, { activatedAt: null, hostBinding: "NOT_BOUND" });
});

test("the scan segment is the R-1 gated state and can hold no number", async () => {
  const repo = repoFor({ serial: serial({ devicesBound: 0 }), paymentStatus: "PAID" });
  const res = await get(repo);

  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, any>;

  assert.deepEqual(
    body.usage.scans,
    { state: "available-after-first-scan" },
    "scan debits stay gated behind the R-1 ruling",
  );
  assert.deepEqual(
    Object.keys(body.usage.scans),
    ["state"],
    "no numeric field may exist here while the ledger is unrated",
  );
});

test("CAP-10 is never emitted, for any slab the key format can carry", async () => {
  assert.equal(
    (LICENCE_SLABS as readonly number[]).includes(10),
    false,
    "no key can encode a slab of 10, so no projection may claim one",
  );

  for (const slab of LICENCE_SLABS) {
    const repo = repoFor({
      serial: serial({ deviceMax: slab, planCode: planCodeFor(slab) }),
      paymentStatus: "PAID",
    });
    const res = await get(repo);
    assert.equal(res.status, 200);

    const body = (await res.json()) as Record<string, any>;
    assert.notEqual(body.plan.code, "CAP-10", `slab ${slab} claimed the unreachable plan code`);
    assert.equal(body.plan.slab, `1-${slab}`);
    assert.equal(body.plan.code, planCodeFor(slab));
  }
});

// ---------------------------------------------------------------------------
// A failed read is 503 with no counters, so it cannot read as zero
// ---------------------------------------------------------------------------

test("a failed entitlement read is 503 carrying nothing but the error", async () => {
  const repo = repoFor({ serial: serial(), paymentStatus: "PAID" });
  repo.failEntitlement = true;
  const res = await get(repo);

  assert.equal(res.status, 503);
  const body = (await res.json()) as Record<string, unknown>;

  assert.deepEqual(
    Object.keys(body),
    ["error"],
    "no counter may be present, or an absent ledger reads as a zero",
  );
  assert.equal(JSON.stringify(body).includes("scans"), false);
  assert.equal(JSON.stringify(body).includes(":0"), false);
});

test("a failed session lookup is 503 rather than a confident 401", async () => {
  const repo = repoFor({ serial: serial() });
  repo.failSession = true;
  const res = await get(repo);

  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "Entitlement is unavailable." });
});

// ---------------------------------------------------------------------------
// The build manifest
// ---------------------------------------------------------------------------

test("the committed manifest is read when none is injected, and states a valid state", async () => {
  const repo = repoFor({ serial: serial(), paymentStatus: "PAID" });
  const res = await get(repo);

  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, any>;
  assert.ok(
    body.build.state === "unavailable" || body.build.state === "published",
    "the committed manifest must resolve to one of the two declared states",
  );
});

test("a manifest claiming publication without a digest is refused as a whole", async () => {
  const repo = repoFor({ serial: serial(), paymentStatus: "PAID" });
  const res = await get(repo, bearer(TOKEN), {
    state: "published",
    version: "3.2.2",
    sha256: null,
  });

  const body = (await res.json()) as Record<string, any>;
  assert.deepEqual(body.build, {
    state: "unavailable",
    version: null,
    sha256: null,
    sizeBytes: null,
    url: null,
    releasedAt: null,
  });
});

test("a malformed digest never surfaces as a published checksum", async () => {
  const repo = repoFor({ serial: serial(), paymentStatus: "PAID" });
  const res = await get(repo, bearer(TOKEN), {
    state: "published",
    version: "3.2.2",
    sha256: "not-a-sha256",
    url: "https://example.invalid/x",
  });

  const body = (await res.json()) as Record<string, any>;
  assert.equal(body.build.state, "unavailable");
  assert.equal(body.build.sha256, null, "a fabricated checksum is worse than none");
  assert.equal(body.build.url, null, "a download that cannot be verified is not offered");
});

test("a complete manifest is passed through with a normalised digest", async () => {
  const sha = "A".repeat(64);
  const repo = repoFor({ serial: serial(), paymentStatus: "PAID" });
  const res = await get(repo, bearer(TOKEN), {
    state: "published",
    version: "3.2.2",
    sha256: sha,
    sizeBytes: 89_000_000.7,
    url: "https://example.invalid/setup.exe",
    releasedAt: "2026-10-01T00:00:00.000Z",
  });

  const body = (await res.json()) as Record<string, any>;
  assert.deepEqual(body.build, {
    state: "published",
    version: "3.2.2",
    sha256: sha.toLowerCase(),
    sizeBytes: 89_000_000,
    url: "https://example.invalid/setup.exe",
    releasedAt: "2026-10-01T00:00:00.000Z",
  });
});

test("normalizeBuild fails safe on anything that is not an object", () => {
  const cases: unknown[] = [null, undefined, "published", 42, [], { state: "draft" }];
  for (const raw of cases) {
    const built: BuildManifest = normalizeBuild(raw);
    assert.equal(built.state, "unavailable");
    assert.equal(built.sha256, null);
  }
});
