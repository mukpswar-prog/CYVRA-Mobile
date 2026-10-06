/**
 * Proves the server's signature is the one `SignedEntitlementProvider` accepts.
 *
 * The reference verifier lives in Kotlin, so these tests do not "trust" the
 * signer against itself. They re-implement the client's four steps verbatim
 * from that class and run them against freshly generated keys:
 *
 *   1. read `schema` and require it to equal `cyvra.entitlement.v1`   (L94)
 *   2. take `payload` and `signature` as strings                      (L98-101)
 *   3. Base64-decode the signature with the STANDARD alphabet         (L225)
 *   4. Ed25519-verify over `payload`'s UTF-8 bytes                     (L226-229)
 *
 * No key material appears in this file: every test generates its own throwaway
 * Ed25519 pair at runtime, which is why none of this can leak a real secret.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ENTITLEMENT_SCHEMA,
  SIGNATURE_ALGORITHM,
  SigningConfigError,
  buildEntitlementPayload,
  entitlementStatusFor,
  licenseIdFor,
  signEntitlement,
  signPayload,
  type SerialForSigning,
} from "../src/entitlementSigner.js";

/** Kotlin `LicenseEntitlementStatus` (CustomerDesktopModels.kt L9-16). */
const KOTLIN_STATUS_VALUES = new Set([
  "ACTIVE",
  "EXPIRED",
  "REVOKED",
  "SUPERSEDED",
  "UNKNOWN",
  "SERVER_UNAVAILABLE",
]);

/** A frozen clock. Nothing in these tests calls `new Date()`. */
const FIXED_NOW = new Date("2026-10-01T12:00:00.000Z");
const now = () => new Date(FIXED_NOW);

const POLICY = {
  validitySeconds: 365 * 24 * 60 * 60,
  graceLimitSeconds: 86_400,
  offline: { diagnostics: true, sanitizeExecute: false, upgrade: false },
};

function serial(overrides: Partial<SerialForSigning> = {}): SerialForSigning {
  return {
    id: "30c5638d-e17d-43ee-9f0f-eddb4bba3696",
    publicNumber: "CYVRA01102026SA3F1-1-5",
    status: "ISSUED",
    customerEmail: "customer@example.invalid",
    customerFullName: "Test Customer",
    companyName: "Example Ltd",
    deviceMax: 5,
    devicesBound: 2,
    issuedAt: new Date("2026-10-01T12:00:00.000Z"),
    createdAt: new Date("2026-10-01T11:00:00.000Z"),
    ...overrides,
  };
}

interface ThrownPair {
  privateKeyB64: string;
  publicKey: CryptoKey;
}

/** Generates a throwaway pair. The private half is exported only for this test. */
async function keypair(): Promise<ThrownPair> {
  const pair = (await crypto.subtle.generateKey(
    { name: SIGNATURE_ALGORITHM },
    /* extractable = */ true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  return {
    privateKeyB64: toBase64(new Uint8Array(pkcs8)),
    publicKey: pair.publicKey,
  };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The Kotlin verifier, step for step.
 *
 * `payloadText` is read out of the parsed JSON exactly as `contentOrNull`
 * does, which is the point: what gets hashed is the *unescaped* string, so
 * the envelope's own escaping must not change a single byte.
 */
async function kotlinVerifies(
  envelope: unknown,
  publicKey: CryptoKey,
): Promise<boolean> {
  const node = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>;

  if (node.schema !== ENTITLEMENT_SCHEMA) return false;
  if (typeof node.payload !== "string") return false;
  if (typeof node.signature !== "string") return false;

  // java.util.Base64.getDecoder() - standard alphabet, not base64url.
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
    // Kotlin returns false on any defect rather than throwing (L230-233).
    return false;
  }
}

test("the signed envelope carries exactly the four contract fields", async () => {
  const { privateKeyB64 } = await keypair();
  const envelope = await signEntitlement(serial(), POLICY, privateKeyB64, now);

  assert.equal(envelope.schema, "cyvra.entitlement.v1");
  assert.equal(envelope.issuedAt, FIXED_NOW.toISOString());
  assert.equal(typeof envelope.payload, "string");
  assert.equal(typeof envelope.signature, "string");
  assert.deepEqual(
    Object.keys(envelope).sort(),
    ["issuedAt", "payload", "schema", "signature"],
    "no extra keys, none missing",
  );
});

test("the Kotlin verifier accepts our signature", async () => {
  const { privateKeyB64, publicKey } = await keypair();
  const envelope = await signEntitlement(serial(), POLICY, privateKeyB64, now);

  assert.equal(
    await kotlinVerifies(envelope, publicKey),
    true,
    "SignedEntitlementProvider would deny this entitlement",
  );
});

test("the signature is standard Base64, never base64url", async () => {
  const { privateKeyB64 } = await keypair();
  const envelope = await signEntitlement(serial(), POLICY, privateKeyB64, now);

  // base64url substitutes '-' and '_'; java's decoder rejects those.
  assert.match(envelope.signature, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.ok(!envelope.signature.includes("-"));
  assert.ok(!envelope.signature.includes("_"));
  assert.ok(
    envelope.signature.length % 4 === 0,
    "standard Base64 is padded to a multiple of 4",
  );
});

test("payload survives the JSON round trip byte for byte", async () => {
  const { privateKeyB64, publicKey } = await keypair();
  const envelope = await signEntitlement(serial(), POLICY, privateKeyB64, now);

  // The payload contains quotes and a '@'; escaping is where this would break.
  const reparsed = JSON.parse(JSON.stringify(envelope)) as { payload: string };
  assert.equal(reparsed.payload, envelope.payload);
  assert.equal(await kotlinVerifies(reparsed, publicKey), true);
});

test("payload satisfies every field the Kotlin parser makes mandatory", async () => {
  const { privateKeyB64 } = await keypair();
  const envelope = await signEntitlement(serial(), POLICY, privateKeyB64, now);
  const payload = JSON.parse(envelope.payload) as Record<string, unknown>;

  // recordOf (L236-271) - a missing one means a denied entitlement.
  for (const key of [
    "licenseId",
    "serialNumber",
    "customerEmail",
    "planName",
    "status",
    "deviceScanEntitlement",
    "scansUsed",
    "scansRemaining",
    "validUntil",
    "serverTime",
    "graceLimitSeconds",
    "offline",
  ]) {
    assert.ok(key in payload, `payload must carry ${key}`);
  }

  assert.ok(KOTLIN_STATUS_VALUES.has(String(payload.status)), "status enum");
  assert.equal(payload.serialNumber, "CYVRA01102026SA3F1-1-5");
  assert.equal(payload.licenseId, "LIC-30C5638D");
  assert.equal(payload.planName, "5 Device Scans");
  assert.equal(payload.deviceScanEntitlement, 5);
  assert.equal(payload.scansUsed, 2);
  assert.equal(payload.scansRemaining, 3);

  // L249-253 range checks.
  assert.ok(Number(payload.scansRemaining) <= Number(payload.deviceScanEntitlement));
  assert.ok(Number(payload.graceLimitSeconds) >= 0);

  // L130: a grant already expired when signed is not a licence.
  assert.ok(
    Date.parse(String(payload.validUntil)) >= Date.parse(String(payload.serverTime)),
  );

  // offlinePermissionsOf (L273-283): all three booleans are mandatory.
  const offline = payload.offline as Record<string, unknown>;
  assert.equal(offline.diagnostics, true);
  assert.equal(offline.sanitizeExecute, false, "destructive work stays off offline");
  assert.equal(offline.upgrade, false);
});

test("signing is deterministic: the same row yields the same signature", async () => {
  const { privateKeyB64 } = await keypair();
  const row = serial();

  const first = await signEntitlement(row, POLICY, privateKeyB64, now);
  const second = await signEntitlement(row, POLICY, privateKeyB64, now);

  // This is what makes a replayed /issue idempotent rather than merely valid.
  assert.equal(first.payload, second.payload);
  assert.equal(first.signature, second.signature);
});

test("an altered payload fails verification", async () => {
  const { privateKeyB64, publicKey } = await keypair();
  const envelope = await signEntitlement(serial(), POLICY, privateKeyB64, now);

  const tampered = JSON.parse(envelope.payload) as Record<string, unknown>;
  tampered.scansRemaining = 999; // mint an entitlement nobody paid for
  const forged = { ...envelope, payload: JSON.stringify(tampered) };

  assert.equal(await kotlinVerifies(forged, publicKey), false);
});

test("a signature from a different key is refused", async () => {
  const victim = await keypair();
  const attacker = await keypair();

  const envelope = await signEntitlement(serial(), POLICY, attacker.privateKeyB64, now);

  assert.equal(await kotlinVerifies(envelope, victim.publicKey), false);
});

test("a wrong schema is refused before the signature is even read", async () => {
  const { privateKeyB64, publicKey } = await keypair();
  const envelope = await signEntitlement(serial(), POLICY, privateKeyB64, now);

  assert.equal(
    await kotlinVerifies({ ...envelope, schema: "cyvra.entitlement.v999" }, publicKey),
    false,
  );
});

test("an absent key fails closed instead of emitting junk", async () => {
  await assert.rejects(
    () => signPayload("{}", ""),
    (error: unknown) => error instanceof SigningConfigError,
  );
  await assert.rejects(
    () => signEntitlement(serial(), POLICY, "   ", now),
    (error: unknown) => error instanceof SigningConfigError,
  );
});

test("a malformed key fails closed instead of throwing something opaque", async () => {
  await assert.rejects(
    () => signPayload("{}", "not-base64-!!!"),
    (error: unknown) => error instanceof SigningConfigError,
  );
  // Valid Base64 that is not a PKCS#8 Ed25519 key.
  await assert.rejects(
    () => signPayload("{}", Buffer.from("definitely not a key").toString("base64")),
    (error: unknown) => error instanceof SigningConfigError,
  );
});

test("a validity window that has already elapsed is refused, not backdated", async () => {
  // Grant signed a year ago, checked now: validUntil has passed.
  const stale = serial({
    issuedAt: new Date("2025-01-01T00:00:00.000Z"),
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
  });
  assert.throws(
    () => buildEntitlementPayload(stale, POLICY, now),
    (error: unknown) => error instanceof SigningConfigError,
  );
});

test("an unmapped serial status degrades to UNKNOWN, never to ACTIVE", () => {
  assert.equal(entitlementStatusFor("ISSUED"), "ACTIVE");
  assert.equal(entitlementStatusFor("REVOKED"), "REVOKED");
  assert.equal(entitlementStatusFor("PENDING"), "UNKNOWN");
  assert.equal(entitlementStatusFor(""), "UNKNOWN");
  assert.equal(entitlementStatusFor("something-novel"), "UNKNOWN");
});

test("scans remaining never goes negative and never exceeds the entitlement", () => {
  const over = serial({ deviceMax: 3, devicesBound: 7 });
  const payload = JSON.parse(buildEntitlementPayload(over, POLICY, now)) as {
    deviceScanEntitlement: number;
    scansUsed: number;
    scansRemaining: number;
  };
  assert.equal(payload.deviceScanEntitlement, 3);
  assert.equal(payload.scansRemaining, 0, "clamped, not negative");
  assert.ok(payload.scansRemaining <= payload.deviceScanEntitlement);
});

test("licence ids follow the existing license.ts convention", () => {
  assert.equal(licenseIdFor("30c5638d-e17d-43ee-9f0f-eddb4bba3696"), "LIC-30C5638D");
});
