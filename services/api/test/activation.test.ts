/**
 * Integration tests for `POST /v1/activation`.
 *
 * These drive the real Hono route end to end - request parsing, the status and
 * `code` mapping, the one-host claim, and Ed25519 signing - against an in-memory
 * stand-in for the two storage operations the route performs. Nothing here
 * reaches Postgres, and nothing calls `new Date()`: the clock is injected, so
 * every verdict is reproducible rather than dependent on when the suite runs.
 *
 * The signature is not checked against the signer that produced it. As in
 * `entitlementSigner.test.ts`, the four steps of Kotlin's
 * `SignedEntitlementProvider` are re-implemented verbatim and run against the
 * response, because a self-check would prove nothing about the client that
 * actually decides whether the workstation starts.
 *
 * The six verdict strings are the desktop's own `FailureKind::code()`
 * (api.rs:73-82). The client maps anything outside that set to
 * `NETWORK_ERROR` (live_client.rs:607-615), so a typo here would not fail
 * loudly - it would silently turn a precise refusal into "network error".
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ACTIVATION_CODES,
  buildActivationRoutes,
  type ActivationRepo,
  type ActivationSerial,
  type ClaimParams,
} from "../src/activation.js";
import { SIGNATURE_ALGORITHM, type Now } from "../src/entitlementSigner.js";
import type { Env } from "../src/env.js";

/** A frozen clock. The route's whole decision is computed against this. */
const FIXED_NOW = new Date("2026-10-01T12:00:00.000Z");
const now: Now = () => new Date(FIXED_NOW);

/** Issued a month before `FIXED_NOW`, still well inside a 365-day window. */
const ISSUED_AT = new Date("2026-09-01T12:00:00.000Z");
const CREATED_AT = new Date("2026-09-01T11:00:00.000Z");

const VALIDITY_SECONDS = 365 * 24 * 60 * 60;
const GRACE_SECONDS = 86_400;

const EMAIL = "buyer@example.invalid";
const KEY = "CYVRA01092026SA3F1-1-5";
const FP_A = "fp-aaaa-workstation-one";
const FP_B = "fp-bbbb-workstation-two";

function serial(overrides: Partial<ActivationSerial> = {}): ActivationSerial {
  return {
    id: "30c5638d-e17d-43ee-9f0f-eddb4bba3696",
    publicNumber: KEY,
    status: "ISSUED",
    customerEmail: EMAIL,
    userId: null,
    paymentNoted: "UPI",
    issuedBy: "ceo@cyvoriq.com",
    issuedAt: ISSUED_AT,
    revokedAt: null,
    createdAt: CREATED_AT,
    customerKind: "SINGLE",
    deviceMax: 5,
    brandScope: "UNSPECIFIED",
    customerFullName: "Test Customer",
    companyName: "Example Ltd",
    addressLine1: null,
    addressLine2: null,
    pincode: null,
    state: null,
    devicesBound: 2,
    emailedAt: null,
    emailMessageId: null,
    emailError: null,
    hostFingerprint: null,
    firstActivatedAt: null,
    deviceTokenHash: null,
    // W5 columns (migration 0007_w5_admin_control_plane).
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

/**
 * In-memory stand-in for `dbRepo`.
 *
 * It reproduces the database-side guard rather than a read-then-write, so the
 * tests exercise the same decision the real route makes under concurrency:
 * `host_fingerprint IS NULL OR host_fingerprint = <this fingerprint>`, and
 * `first_activated_at` left alone when it is already set.
 */
class FakeRepo implements ActivationRepo {
  claims = 0;
  constructor(private row: ActivationSerial | null) {}

  async findByKey(publicNumber: string): Promise<ActivationSerial | null> {
    return this.row && this.row.publicNumber === publicNumber ? this.row : null;
  }

  async findByDeviceTokenHash(deviceTokenHash: string): Promise<ActivationSerial | null> {
    return this.row && this.row.deviceTokenHash === deviceTokenHash ? this.row : null;
  }

  async claimBinding(params: ClaimParams): Promise<boolean> {
    const row = this.row;
    if (!row) return false;
    const bound = row.hostFingerprint;
    if (bound !== null && bound !== params.hostFingerprint) return false;

    this.claims += 1;
    this.row = {
      ...row,
      hostFingerprint: params.hostFingerprint,
      deviceTokenHash: params.deviceTokenHash,
      firstActivatedAt: row.firstActivatedAt ?? params.now,
    };
    return true;
  }
}

/**
 * A repo that always loses the race - every claim reports failure while the
 * read side looked clean. This is the window between PHASE 4 and PHASE 5.
 */
class LoserRepo implements ActivationRepo {
  constructor(private row: ActivationSerial) {}
  async findByKey(): Promise<ActivationSerial | null> {
    return this.row;
  }
  async findByDeviceTokenHash(): Promise<ActivationSerial | null> {
    return null;
  }
  async claimBinding(): Promise<boolean> {
    return false;
  }
}

/** Generated per test: no key material exists anywhere in this file. */
async function keypair(): Promise<{ privateKeyB64: string; publicKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey(
    { name: SIGNATURE_ALGORITHM },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  let binary = "";
  for (const byte of new Uint8Array(pkcs8)) binary += String.fromCharCode(byte);
  return { privateKeyB64: btoa(binary), publicKey: pair.publicKey };
}

function env(privateKeyB64: string): Env {
  return {
    ENTITLEMENT_PRIVATE_KEY_B64: privateKeyB64,
    ENTITLEMENT_VALIDITY_SECONDS: String(VALIDITY_SECONDS),
    ENTITLEMENT_GRACE_SECONDS: String(GRACE_SECONDS),
  } as unknown as Env;
}

function post(
  repo: ActivationRepo,
  privateKeyB64: string,
  body: unknown,
): Promise<Response> {
  const routes = buildActivationRoutes({ repo, now });
  return routes.request(
    "/activation",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env(privateKeyB64),
  );
}

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: EMAIL,
    licence_key: KEY,
    device_fingerprint: FP_A,
    terms_version: "terms-2026-01",
    app_version: "1.4.0",
    ...overrides,
  };
}

/** Kotlin's four steps (SignedEntitlementProvider L94, L98-101, L225-229). */
async function kotlinVerifies(
  envelope: unknown,
  publicKey: CryptoKey,
): Promise<boolean> {
  const node = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>;
  if (node.schema !== "cyvra.entitlement.v1") return false;
  if (typeof node.payload !== "string") return false;
  if (typeof node.signature !== "string") return false;

  const signatureBytes = Uint8Array.from(atob(node.signature), (ch) =>
    ch.charCodeAt(0),
  );
  try {
    return await crypto.subtle.verify(
      { name: SIGNATURE_ALGORITHM },
      publicKey,
      signatureBytes,
      new TextEncoder().encode(node.payload),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The two the brief names explicitly
// ---------------------------------------------------------------------------

test("a valid activation returns a signature Kotlin would accept", async () => {
  const { privateKeyB64, publicKey } = await keypair();
  const repo = new FakeRepo(serial());

  const res = await post(repo, privateKeyB64, request());
  assert.equal(res.status, 200, "a clean first activation must succeed");

  const body = (await res.json()) as Record<string, any>;

  assert.equal(
    await kotlinVerifies(body.entitlement, publicKey),
    true,
    "SignedEntitlementProvider would deny this entitlement",
  );
  assert.equal(
    await kotlinVerifies(body.offline_lease, publicKey),
    true,
    "the lease is exported to entitlement.json on offline grace - it must verify too",
  );

  // WireSuccess (live_client.rs:492-502) - nothing the decoder is missing.
  assert.deepEqual(
    Object.keys(body).sort(),
    [
      "binding",
      "device_token",
      "entitlement",
      "grace_expires_at_unix",
      "offline_lease",
      "server_time",
    ].sort(),
  );
  assert.equal(body.binding, "FirstActivation");
  assert.equal(typeof body.device_token, "string");
  assert.ok(body.device_token.length > 0);
  assert.equal(body.server_time, FIXED_NOW.toISOString());

  // grace_expires_at_unix: the deadline state.rs:338 compares against.
  assert.equal(
    body.grace_expires_at_unix,
    Math.floor((FIXED_NOW.getTime() + GRACE_SECONDS * 1000) / 1000),
  );

  // The binding is actually recorded, and the plaintext token is not stored.
  assert.equal(repo.claims, 1);
  assert.equal(repoRow(repo)?.hostFingerprint, FP_A);
  assert.ok(repoRow(repo)?.firstActivatedAt instanceof Date);
  assert.notEqual(repoRow(repo)?.deviceTokenHash, body.device_token);
});

test("an already-bound fingerprint is refused with 409 ALREADY_BOUND", async () => {
  const { privateKeyB64 } = await keypair();
  const repo = new FakeRepo(serial({ hostFingerprint: FP_A }));

  const res = await post(repo, privateKeyB64, request({ device_fingerprint: FP_B }));
  assert.equal(res.status, 409, "the desktop special-cases 409 by status alone");

  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.code, "ALREADY_BOUND");
  // The desktop maps this to FailureKind::AlreadyBoundToAnotherComputer.
  assert.equal(repo.claims, 0, "a refused host must never write a binding");
  assert.equal(repoRow(repo)?.deviceTokenHash, null);
});

// ---------------------------------------------------------------------------
// The rest of the status / code matrix
// ---------------------------------------------------------------------------

test("the same machine reactivating succeeds rather than being told it is 'another computer'", async () => {
  const { privateKeyB64, publicKey } = await keypair();
  const firstBoundAt = new Date("2026-09-15T09:30:00.000Z");
  const repo = new FakeRepo(
    serial({ hostFingerprint: FP_A, firstActivatedAt: firstBoundAt }),
  );
  const tokenBefore = repoRow(repo)?.deviceTokenHash ?? null;

  const res = await post(repo, privateKeyB64, request({ device_fingerprint: FP_A }));
  assert.equal(res.status, 200);

  const body = (await res.json()) as Record<string, any>;
  assert.equal(body.binding, "AuthorizedDeviceRevalidation");
  assert.equal(await kotlinVerifies(body.entitlement, publicKey), true);

  // The original stamp is historical fact and must not be rewritten; the
  // token is rotated. `AlreadyBoundToAnotherComputer` would be a lie here -
  // it is this very computer.
  assert.equal(repoRow(repo)?.firstActivatedAt, firstBoundAt);
  assert.notEqual(repoRow(repo)?.deviceTokenHash, tokenBefore);
  assert.notEqual(repoRow(repo)?.deviceTokenHash, body.device_token);
});

test("an unknown key and someone else's key are byte-identical refusals", async () => {
  const { privateKeyB64 } = await keypair();

  const unknown = await post(
    new FakeRepo(serial()),
    privateKeyB64,
    request({ licence_key: "CYVRA01092026ZZZZZ-9-9" }),
  );
  const mismatch = await post(
    new FakeRepo(serial()),
    privateKeyB64,
    request({ email: "stranger@example.invalid" }),
  );

  assert.equal(unknown.status, 404);
  assert.equal(mismatch.status, 404);
  assert.equal(
    await unknown.text(),
    await mismatch.text(),
    "confirming a key exists but belongs to someone else would be an enumeration oracle",
  );

  const body = JSON.parse(await (await post(
    new FakeRepo(serial()),
    privateKeyB64,
    request({ licence_key: "CYVRA01092026ZZZZZ-9-9" }),
  )).text()) as Record<string, unknown>;
  assert.equal(body.code, "INVALID_LICENCE");
});

test("a revoked licence is 403 LICENCE_NOT_ACTIVE, not 404", async () => {
  const { privateKeyB64 } = await keypair();
  const res = await post(
    new FakeRepo(serial({ status: "REVOKED" })),
    privateKeyB64,
    request(),
  );

  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as any).code, "LICENCE_NOT_ACTIVE");
});

test("a licence that was never issued is 403 LICENCE_NOT_ACTIVE", async () => {
  const { privateKeyB64 } = await keypair();
  const res = await post(
    new FakeRepo(serial({ status: "PAYMENT_PENDING" })),
    privateKeyB64,
    request(),
  );

  // The brief names a `READY_TO_GENERATE` state. The union in admin.ts is
  // PENDING | ISSUED | REVOKED - this schema has never had such a state, so
  // there is nothing to accept for it. PENDING is the nearest real case and it
  // is refused rather than silently activated.
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as any).code, "LICENCE_NOT_ACTIVE");
});

test("a licence past its validity window is 410 LICENCE_EXPIRED", async () => {
  const { privateKeyB64 } = await keypair();
  const res = await post(
    new FakeRepo(serial({ issuedAt: new Date("2025-01-01T00:00:00.000Z") })),
    privateKeyB64,
    request(),
  );

  assert.equal(res.status, 410);
  assert.equal(((await res.json()) as any).code, "LICENCE_EXPIRED");
});

test("an unrecognised key returns no verdict, never an invented one", async () => {
  const { privateKeyB64 } = await keypair();
  const res = await post(
    new FakeRepo(serial()),
    privateKeyB64,
    request({ device_fingerprint: "" }),
  );

  assert.equal(res.status, 400);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.code, undefined, "no code means the desktop reports network error");
  assert.equal(body.error, undefined, "a bare `error` string would break WireFailure");
});

test("missing signing configuration fails closed with 503 and no verdict", async () => {
  const routes = buildActivationRoutes({ repo: new FakeRepo(serial()), now });
  const res = await routes.request(
    "/activation",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request()),
    },
    { ENTITLEMENT_VALIDITY_SECONDS: String(VALIDITY_SECONDS) } as unknown as Env,
  );

  assert.equal(res.status, 503, "503 is retryable; a 200 would not be");
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.code, undefined, "a server fault must not read as a licence verdict");
});

test("losing the claim race is 409, not a signature for a binding we do not hold", async () => {
  const { privateKeyB64 } = await keypair();
  const res = await post(new LoserRepo(serial()), privateKeyB64, request());

  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as any).code, "ALREADY_BOUND");
});

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

test("exactly six codes, spelled exactly as FailureKind::code() spells them", () => {
  assert.deepEqual([...ACTIVATION_CODES], [
    "INVALID_USER",
    "INVALID_LICENCE",
    "LICENCE_NOT_ACTIVE",
    "LICENCE_EXPIRED",
    "ALREADY_BOUND",
    "NETWORK_ERROR",
  ]);
  assert.equal(new Set(ACTIVATION_CODES).size, 6, "a seventh string is forbidden");
});

test("every refusal the route can send carries one of the six codes", async () => {
  const { privateKeyB64 } = await keypair();
  const allowed = new Set<string>(ACTIVATION_CODES as unknown as string[]);

  // Each row pairs the request with the repo whose *stored* row drives it:
  // `status` is a property of the licence, never of the request.
  const cases: Array<{ body: Record<string, unknown>; repo: ActivationRepo }> = [
    { body: request({ email: "" }), repo: new FakeRepo(serial()) },
    { body: request({ licence_key: "" }), repo: new FakeRepo(serial()) },
    {
      body: request({ licence_key: "CYVRA01092026ZZZZZ-9-9" }),
      repo: new FakeRepo(serial()),
    },
    {
      body: request({ email: "stranger@example.invalid" }),
      repo: new FakeRepo(serial()),
    },
    { body: request(), repo: new FakeRepo(serial({ status: "REVOKED" })) },
    { body: request(), repo: new FakeRepo(serial({ status: "PAYMENT_PENDING" })) },
    {
      body: request({ device_fingerprint: FP_B }),
      repo: new FakeRepo(serial({ hostFingerprint: FP_A })),
    },
  ];

  for (const [index, { body, repo }] of cases.entries()) {
    const res = await post(repo, privateKeyB64, body);
    assert.ok(res.status >= 400, `case ${index} must be a refusal`);
    const parsed = (await res.json()) as Record<string, unknown>;
    if (res.status === 400 && parsed.code === undefined) continue; // documented hole
    assert.ok(
      allowed.has(String(parsed.code)),
      `case ${index} sent "${String(parsed.code)}", which the desktop cannot decode`,
    );
  }
});

test("the offline lease is time-boxed to activation, not to the issue date", async () => {
  const { privateKeyB64, publicKey } = await keypair();
  const res = await post(new FakeRepo(serial()), privateKeyB64, request());
  const body = (await res.json()) as Record<string, any>;

  const lease = JSON.parse(body.offline_lease.payload) as Record<string, any>;
  const entitlement = JSON.parse(body.entitlement.payload) as Record<string, any>;

  // Anchored at the serial's issue date, the lease would expire
  // 2026-09-02 - a month before this activation - and Kotlin (L130) would
  // refuse the entitlement, so the workstation could never enter offline grace.
  assert.equal(lease.serverTime, FIXED_NOW.toISOString());
  assert.ok(
    Date.parse(lease.validUntil) > Date.parse(lease.serverTime),
    "a lease already expired when signed is not a lease",
  );
  assert.equal(
    Date.parse(lease.validUntil),
    FIXED_NOW.getTime() + GRACE_SECONDS * 1000,
    "the lease lasts exactly one grace window from activation",
  );
  // The full entitlement keeps the longer window, anchored where it always was.
  assert.ok(
    Date.parse(entitlement.validUntil) > Date.parse(lease.validUntil),
  );
  assert.equal(await kotlinVerifies(body.offline_lease, publicKey), true);
});

test("SANITIZE_EXECUTE stays refused in both snapshots", async () => {
  const { privateKeyB64 } = await keypair();
  const res = await post(new FakeRepo(serial()), privateKeyB64, request());
  const body = (await res.json()) as Record<string, any>;

  for (const name of ["entitlement", "offline_lease"] as const) {
    const payload = JSON.parse(body[name].payload) as Record<string, any>;
    assert.equal(payload.offline.sanitizeExecute, false, name);
    assert.equal(payload.offline.diagnostics, true, name);
    assert.equal(payload.offline.upgrade, false, name);
  }
});

test("the licence key is normalised as the operator typed it", async () => {
  const { privateKeyB64 } = await keypair();
  const res = await post(
    new FakeRepo(serial()),
    privateKeyB64,
    request({ licence_key: `  ${KEY.toLowerCase()}  ` }),
  );

  // ActivationRequest.licence_key is "as the operator typed it" (api.rs:19).
  assert.equal(res.status, 200, "lowercase and stray spaces must still activate");
});

test("a claim is never written when configuration is missing", async () => {
  const repo = new FakeRepo(serial());
  const routes = buildActivationRoutes({ repo, now });
  await routes.request(
    "/activation",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request()),
    },
    { ENTITLEMENT_VALIDITY_SECONDS: "" } as unknown as Env,
  );

  assert.equal(repo.claims, 0, "PHASE 0 runs before anything is mutated");
  assert.equal(repoRow(repo)?.hostFingerprint, null);
});

/** The repo's private row, reachable only for assertions about what was stored. */
function repoRow(repo: ActivationRepo): ActivationSerial | null {
  const holder = repo as unknown as { row?: ActivationSerial | null };
  return holder.row ?? null;
}
