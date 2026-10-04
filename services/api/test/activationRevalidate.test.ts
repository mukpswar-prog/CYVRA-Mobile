/**
 * Integration tests for `POST /v1/activation/revalidate`.
 *
 * Same shape as `activation.test.ts`: the real Hono route is driven end to end
 * against an in-memory stand-in for storage, the clock is injected, and nothing
 * reaches Postgres. What these pin is the *difference* between the two routes,
 * because revalidation is where the interesting decisions live:
 *
 *  1. **It authenticates on the device token**, which is how `revalidate`
 *     stops being an open question (`API_CONTRACT_ACTIVATION.md` §12 item 3).
 *  2. **The token is echoed, never rotated.** The desktop retries this call
 *     (`live_client.rs:321` passes `repeatable: true`), so a rotated token
 *     whose response was lost would make the very next retry - carrying the old
 *     token - be refused. Test "the token survives" exists so that a later
 *     "improvement" cannot reintroduce that lockout.
 *  3. **The licence's own validity window does not slide.** Grace, lease and
 *     `server_time` are anchored now; `validUntil` is not, because sliding it
 *     would buy an offline workstation up to `validitySeconds` of time the
 *     licence never covered.
 *
 * `GET` is not served here on purpose: the client POSTs (`live_client.rs:398`).
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
import { sha256Hex } from "../src/crypto.js";
import { SIGNATURE_ALGORITHM, type Now } from "../src/entitlementSigner.js";
import type { Env } from "../src/env.js";

/** A frozen clock: every time-anchored field in a success derives from this. */
const FIXED_NOW = new Date("2026-10-01T12:00:00.000Z");
const now: Now = () => new Date(FIXED_NOW);

const ISSUED_AT = new Date("2026-09-01T12:00:00.000Z");
const CREATED_AT = new Date("2026-09-01T11:00:00.000Z");

const VALIDITY_SECONDS = 365 * 24 * 60 * 60;
const GRACE_SECONDS = 86_400;

const EMAIL = "buyer@example.invalid";
const KEY = "CYVRA01092026SA3F1-1-5";
const FP_A = "fp-aaaa-workstation-one";
const FP_B = "fp-bbbb-workstation-two";

/** The token the workstation stored at activation and presents on every launch. */
const TOKEN = "dt-4b1f6f0e9c7a2d5e8b3f6a1c9d0e2f4a";

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

/** A row as it looks after a first activation: bound to `FP_A`, token on file. */
async function boundSerial(overrides: Partial<ActivationSerial> = {}): Promise<ActivationSerial> {
  return serial({
    hostFingerprint: FP_A,
    deviceTokenHash: await sha256Hex(TOKEN),
    firstActivatedAt: ISSUED_AT,
    ...overrides,
  });
}

class RevalidateRepo implements ActivationRepo {
  lookups = 0;
  claims = 0;
  claimFails = false;

  constructor(public row: ActivationSerial | null) {}

  /**
   * Throws rather than returning null: revalidation looks a licence up by its
   * token, and if this route ever reached for the key it would be authenticating
   * on something the caller did not have to prove possession of.
   */
  async findByKey(): Promise<ActivationSerial | null> {
    throw new Error("revalidate must never resolve a licence by its key");
  }

  async findByDeviceTokenHash(deviceTokenHash: string): Promise<ActivationSerial | null> {
    this.lookups += 1;
    return this.row && this.row.deviceTokenHash === deviceTokenHash ? this.row : null;
  }

  async claimBinding(params: ClaimParams): Promise<boolean> {
    if (this.claimFails) return false;
    const row = this.row;
    if (!row) return false;
    if (row.hostFingerprint !== null && row.hostFingerprint !== params.hostFingerprint) {
      return false;
    }
    this.claims += 1;
    this.row = {
      ...row,
      hostFingerprint: params.hostFingerprint,
      deviceTokenHash: params.deviceTokenHash,
    };
    return true;
  }
}

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

function env(privateKeyB64?: string): Env {
  return {
    ...(privateKeyB64 === undefined ? {} : { ENTITLEMENT_PRIVATE_KEY_B64: privateKeyB64 }),
    ENTITLEMENT_VALIDITY_SECONDS: String(VALIDITY_SECONDS),
    ENTITLEMENT_GRACE_SECONDS: String(GRACE_SECONDS),
  } as unknown as Env;
}

function revalidate(
  repo: ActivationRepo,
  privateKeyB64: string | undefined,
  body: unknown,
): Promise<Response> {
  const routes = buildActivationRoutes({ repo, now });
  return routes.request(
    "/activation/revalidate",
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
    device_token: TOKEN,
    device_fingerprint: FP_A,
    ...overrides,
  };
}

/** Kotlin's four steps (SignedEntitlementProvider L94, L98-101, L225-229). */
async function kotlinVerifies(envelope: unknown, publicKey: CryptoKey): Promise<boolean> {
  const node = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>;
  if (node.schema !== "cyvra.entitlement.v1") return false;
  if (typeof node.payload !== "string") return false;
  if (typeof node.signature !== "string") return false;

  const signatureBytes = Uint8Array.from(atob(node.signature), (ch) => ch.charCodeAt(0));
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

function payloadOf(envelope: unknown): Record<string, unknown> {
  return JSON.parse((envelope as { payload: string }).payload) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// The happy path, and what it is allowed to refresh
// ---------------------------------------------------------------------------

test("a returning workstation is revalidated and handed a signature Kotlin accepts", async () => {
  const { privateKeyB64, publicKey } = await keypair();
  const repo = new RevalidateRepo(await boundSerial());

  const res = await revalidate(repo, privateKeyB64, request());
  assert.equal(res.status, 200, "a bound host presenting its own token must be let back in");

  const body = (await res.json()) as Record<string, any>;

  // WireSuccess (live_client.rs:492-502): exactly the fields the decoder reads.
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

  assert.equal(
    await kotlinVerifies(body.entitlement, publicKey),
    true,
    "SignedEntitlementProvider would deny this entitlement",
  );
  assert.equal(
    await kotlinVerifies(body.offline_lease, publicKey),
    true,
    "the restricted lease is what goes to entitlement.json on offline entry",
  );

  // state.rs:312-319 refuses anything whose binding is not this value, so an
  // omitted or wrong `binding` would turn a successful revalidation into
  // INVALID_LICENCE on screen.
  assert.equal(body.binding, "AuthorizedDeviceRevalidation");
  assert.equal(body.server_time, FIXED_NOW.toISOString());

  assert.equal(repo.lookups, 1, "exactly one token lookup");
  assert.equal(repo.claims, 1, "the one-host guard must be re-run, not skipped");
});

test("grace and the lease are anchored at this moment, which is the window being extended", async () => {
  const { privateKeyB64 } = await keypair();
  const repo = new RevalidateRepo(await boundSerial());

  const body = (await revalidate(repo, privateKeyB64, request()).then((r) => r.json())) as Record<
    string,
    any
  >;

  // The deadline `state.rs:338` compares against moves forward on every launch.
  assert.equal(
    body.grace_expires_at_unix,
    Math.floor((FIXED_NOW.getTime() + GRACE_SECONDS * 1000) / 1000),
    "a returning workstation must not fall out of grace because time passed",
  );

  // The lease begins now, never at the issue date - the same reason `/activation`
  // passes `validFrom: activatedAt`: anchoring a lease to a months-old issue
  // date yields a `validUntil` already past, and Kotlin refuses it (L130).
  const lease = payloadOf(body.offline_lease);
  assert.equal(lease.validFrom, FIXED_NOW.toISOString());
  assert.equal(
    lease.validUntil,
    new Date(FIXED_NOW.getTime() + GRACE_SECONDS * 1000).toISOString(),
  );
  assert.equal(lease.serverTime, FIXED_NOW.toISOString());
});

test("the licence's own validity window does NOT slide forward", async () => {
  const { privateKeyB64 } = await keypair();
  const repo = new RevalidateRepo(await boundSerial());

  const body = (await revalidate(repo, privateKeyB64, request()).then((r) => r.json())) as Record<
    string,
    any
  >;
  const entitlement = payloadOf(body.entitlement);

  // Anchored at the issue date, exactly as `/activation` anchors it. Sliding
  // this to `now` would mean the last revalidation before an expiry buys the
  // workstation a further `validitySeconds` of offline time the licence never
  // covered - a licence ending 2027-09-01 would still boot offline in 2028.
  assert.equal(entitlement.validFrom, ISSUED_AT.toISOString());
  assert.equal(
    entitlement.validUntil,
    new Date(ISSUED_AT.getTime() + VALIDITY_SECONDS * 1000).toISOString(),
  );
  assert.equal(entitlement.serverTime, FIXED_NOW.toISOString());
});

test("the device token survives a revalidation - it is echoed, never rotated", async () => {
  const { privateKeyB64 } = await keypair();
  const row = await boundSerial();
  const storedBefore = row.deviceTokenHash;
  const repo = new RevalidateRepo(row);

  const body = (await revalidate(repo, privateKeyB64, request()).then((r) => r.json())) as Record<
    string,
    any
  >;

  assert.equal(body.device_token, TOKEN, "the workstation keeps the token it already has");
  assert.equal(
    repo.row?.deviceTokenHash,
    storedBefore,
    "the stored hash must not change: the client retries with the old token",
  );
});

// ---------------------------------------------------------------------------
// Refusals. Status first (the desktop special-cases 409 by status alone),
// then `code`, which is what the operator actually sees.
// ---------------------------------------------------------------------------

test("a token the server has never issued is 404 INVALID_LICENCE", async () => {
  const { privateKeyB64 } = await keypair();
  const repo = new RevalidateRepo(await boundSerial());

  const res = await revalidate(repo, privateKeyB64, request({ device_token: "dt-not-a-real-one" }));
  assert.equal(res.status, 404);

  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.code, "INVALID_LICENCE");
  assert.ok(
    ACTIVATION_CODES.includes(body.code as (typeof ACTIVATION_CODES)[number]),
    "the client maps anything outside the six to NETWORK_ERROR",
  );
  assert.equal(repo.claims, 0, "an unknown token must not reach the binding guard");
});

test("a valid token presented by a different machine is 409 ALREADY_BOUND", async () => {
  const { privateKeyB64 } = await keypair();
  const repo = new RevalidateRepo(await boundSerial());

  const res = await revalidate(repo, privateKeyB64, request({ device_fingerprint: FP_B }));
  assert.equal(res.status, 409, "409 is read by status alone, before any body");

  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.code, "ALREADY_BOUND");
  assert.equal(repo.claims, 0, "the guard must not be re-run for the wrong machine");
});

test("a binding that changes during the request fails closed with 409", async () => {
  const { privateKeyB64 } = await keypair();
  const repo = new RevalidateRepo(await boundSerial());
  repo.claimFails = true;

  const res = await revalidate(repo, privateKeyB64, request());
  assert.equal(res.status, 409, "a stale read must not wave a rebound host through");
  assert.equal((await res.json() as Record<string, unknown>).code, "ALREADY_BOUND");
});

test("REVOKED is refused with LICENCE_NOT_ACTIVE and the word revoked", async () => {
  const { privateKeyB64 } = await keypair();
  const repo = new RevalidateRepo(
    await boundSerial({ status: "REVOKED", revokedAt: FIXED_NOW, hostBindingStatus: "REVOKED" }),
  );

  const res = await revalidate(repo, privateKeyB64, request());
  assert.equal(res.status, 403);

  const body = (await res.json()) as Record<string, any>;
  assert.equal(body.code, "LICENCE_NOT_ACTIVE");
  assert.match(body.message, /revoked/i);
});

test("SUSPENDED and EXPIRED are refused, but ISSUED and ACTIVE are let in", async () => {
  const { privateKeyB64 } = await keypair();

  for (const status of ["SUSPENDED", "EXPIRED"] as const) {
    const repo = new RevalidateRepo(await boundSerial({ status }));
    const res = await revalidate(repo, privateKeyB64, request());
    assert.equal(res.status, 403, `${status} must not revalidate`);
    assert.equal(
      (await res.json() as Record<string, unknown>).code,
      "LICENCE_NOT_ACTIVE",
    );
  }

  // `ISSUED` is what activation leaves behind; `ACTIVE` is the state the system
  // edge `ISSUED -> ACTIVE` and an admin `SUSPENDED -> ACTIVE` both produce.
  // Accepting only `ISSUED` would break every returning workstation the moment
  // that edge fires - the very defect D2 exists to remove.
  for (const status of ["ISSUED", "ACTIVE"] as const) {
    const repo = new RevalidateRepo(await boundSerial({ status }));
    const res = await revalidate(repo, privateKeyB64, request());
    assert.equal(res.status, 200, `${status} must revalidate`);
  }
});

test("an ACTIVE serial produces an entitlement that says ACTIVE, never UNKNOWN", async () => {
  const { privateKeyB64 } = await keypair();
  const repo = new RevalidateRepo(await boundSerial({ status: "ACTIVE" }));

  const body = (await revalidate(repo, privateKeyB64, request()).then((r) => r.json())) as Record<
    string,
    any
  >;

  // HostLicenseService.kt:115 `check`s status == ACTIVE and
  // HostUpgradeAccountingEngine.kt:145 does the same. `UNKNOWN` parses fine in
  // Kotlin and then fails both checks, so a returning workstation would be
  // handed a verifiable record its own Host refuses to boot on.
  assert.equal(payloadOf(body.entitlement).status, "ACTIVE");
});

// ---------------------------------------------------------------------------
// Expiry - one definition, shared with `/activation`
// ---------------------------------------------------------------------------

test("a licence past its policy window is 410 LICENCE_EXPIRED", async () => {
  const { privateKeyB64 } = await keypair();
  const longAgo = new Date("2024-01-01T12:00:00.000Z");
  const repo = new RevalidateRepo(await boundSerial({ issuedAt: longAgo, createdAt: longAgo }));

  const res = await revalidate(repo, privateKeyB64, request());
  assert.equal(res.status, 410, "the desktop maps 410 + code to `licence expired`");

  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.code, "LICENCE_EXPIRED");
  assert.equal(repo.claims, 0, "an expired licence must not re-run the binding guard");
});

test("a validity_ends_at stamp in the past refuses even though the policy window is open", async () => {
  const { privateKeyB64 } = await keypair();
  // Issued a month ago, so `issuedAt + validity` is still ten months away, but
  // the column says the licence ended on 2026-09-15. The column wins because
  // `validityEnd` takes the earlier of the two - which is the whole reason the
  // shared helper exists: `/activation` used to read only the policy window and
  // would have let this licence straight through.
  const repo = new RevalidateRepo(
    await boundSerial({ validityEndsAt: new Date("2026-09-15T12:00:00.000Z") }),
  );

  const res = await revalidate(repo, privateKeyB64, request());
  assert.equal(res.status, 410);
  assert.equal((await res.json() as Record<string, unknown>).code, "LICENCE_EXPIRED");
});

test("a validity_ends_at stamp still in the future does not refuse", async () => {
  const { privateKeyB64 } = await keypair();
  const repo = new RevalidateRepo(
    await boundSerial({ validityEndsAt: new Date("2026-12-31T12:00:00.000Z") }),
  );

  const res = await revalidate(repo, privateKeyB64, request());
  assert.equal(res.status, 200, "an open stamp must not become a refusal");
});

// ---------------------------------------------------------------------------
// Configuration and malformed input
// ---------------------------------------------------------------------------

test("a missing signing key is 503 before anything is read", async () => {
  const repo = new RevalidateRepo(await boundSerial());

  const res = await revalidate(repo, undefined, request());
  assert.equal(res.status, 503, "a server fault, so the desktop retries");
  assert.equal(repo.lookups, 0, "no row should be touched when the answer cannot be signed");
  assert.equal(repo.claims, 0);

  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.code, undefined, "503 carries no verdict code");
});

test("a body missing either field is 400 with no code", async () => {
  const { privateKeyB64 } = await keypair();

  for (const body of [
    request({ device_token: "" }),
    request({ device_fingerprint: "" }),
    request({ device_token: null }),
  ]) {
    const repo = new RevalidateRepo(await boundSerial());
    const res = await revalidate(repo, privateKeyB64, body);
    assert.equal(res.status, 400);
    const parsed = (await res.json()) as Record<string, unknown>;
    assert.equal(parsed.code, undefined, "none of the six verdicts means 'field absent'");
    assert.equal(repo.lookups, 0, "a malformed body must never become a query");
  }
});

test("a non-JSON body is 400 and never reaches storage", async () => {
  const { privateKeyB64 } = await keypair();
  const routes = buildActivationRoutes({
    repo: new RevalidateRepo(await boundSerial()),
    now,
  });

  const res = await routes.request(
    "/activation/revalidate",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "not json" },
    env(privateKeyB64),
  );

  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as Record<string, unknown>).code, undefined);
});
