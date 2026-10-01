/**
 * Ed25519 signing for the entitlement payload the Kotlin Host verifies.
 *
 * This module is the server half of a contract that already exists on the
 * client. `SignedEntitlementProvider` (apps/host/.../license/SignedEntitlementProvider.kt)
 * decides what is acceptable; this file exists to produce bytes that satisfy
 * it, and the constants below are transcribed from that class rather than
 * invented here:
 *
 *   SCHEMA            = "cyvra.entitlement.v1"   (Kotlin L337)
 *   SIGNATURE_ALGORITHM = "Ed25519"              (Kotlin L338)
 *   signed bytes      = payloadText.toByteArray(UTF_8)   (Kotlin L228)
 *   signature decode  = Base64.getDecoder()              (Kotlin L225)
 *
 * Three properties are load-bearing and are pinned by tests:
 *
 *  1. The signature covers `payload` **as an opaque string**. We sign
 *     `JSON.stringify(...)` and store *that exact string* in the envelope.
 *     The envelope's own JSON escaping is irrelevant: the Kotlin side reads
 *     the unescaped string back out (`contentOrNull`) and hashes those bytes.
 *     Re-serializing on either side would be a second opinion about bytes.
 *
 *  2. The signature encoding is **standard Base64 with padding**, because
 *     `java.util.Base64.getDecoder()` is the standard alphabet, not base64url.
 *
 *  3. The private key never appears in this file, in a response, or in a log.
 *     It arrives from the environment per call and is imported non-extractable
 *     (`extractable = false`), so it cannot be read back out of the CryptoKey.
 *
 * FAIL-CLOSED: a missing, malformed or unusable key raises
 * [`SigningConfigError`] rather than emitting a signature that the Host would
 * reject later. A signature nobody can verify is worse than no signature,
 * because it looks like a working licence.
 *
 * NOTE ON KEY CUSTODY: the Host bundles a *public* key
 * (`SERVER_PUBLIC_KEY_B64`). Its private half is not in this repository - the
 * Kotlin doc comment states it lives with the CYVORIQ server. Until
 * `ENTITLEMENT_PRIVATE_KEY_B64` holds the matching private half, signing is
 * unavailable and callers must surface 503 instead of a bad signature.
 */

import type { Env } from "./env";

/** Envelope schema accepted by `SignedEntitlementProvider.SCHEMA`. */
export const ENTITLEMENT_SCHEMA = "cyvra.entitlement.v1";

/** Algorithm name in both Web Crypto and the Kotlin `Signature.getInstance`. */
export const SIGNATURE_ALGORITHM = "Ed25519";

/** Injected clock. Never call `new Date()` inside signing logic. */
export type Now = () => Date;

/** Raised when a signature cannot be produced. Callers map this to 503. */
export class SigningConfigError extends Error {
  override readonly name = "SigningConfigError";
}

/** The offline permission triple the Host requires. All three keys are mandatory. */
export interface OfflinePermissions {
  diagnostics: boolean;
  sanitizeExecute: boolean;
  upgrade: boolean;
}

/**
 * Policy inputs that are *decided by the server*, not derived from a row.
 *
 * ASSUMPTION: `mobile_serials` has no expiry column (see database/src/schema.ts
 * mobileSerials, 0000-0005), so a validity window cannot be read from the
 * database. `validitySeconds` is therefore an explicit, named policy rather
 * than a value smuggled in as if it were data. It must be confirmed before
 * production use - see the recon report.
 */
export interface EntitlementPolicy {
  validitySeconds: number;
  /** Offline grace the Host enforces. 0 is meaningless, not unlimited. */
  graceLimitSeconds: number;
  offline: OfflinePermissions;
}

/**
 * Overrides for *when a grant starts*.
 *
 * The default anchor is the serial's own `issuedAt`, which is correct for the
 * long-lived entitlement and wrong for an offline lease. A lease begins when
 * the machine activates: anchoring it to an issue date from months earlier
 * yields a `validUntil` already in the past, which Kotlin refuses outright
 * (`verify`, L130), so the workstation could never enter offline grace at all.
 */
export interface PayloadAnchors {
  validFrom?: Date;
}

/** The subset of a `mobile_serials` row that the payload is built from. */
export interface SerialForSigning {
  id: string;
  publicNumber: string;
  status: string;
  customerEmail: string;
  customerFullName: string | null;
  companyName: string | null;
  deviceMax: number;
  devicesBound: number;
  issuedAt: Date | null;
  createdAt: Date;
}

/**
 * `LicenseEntitlementStatus` (CustomerDesktopModels.kt L9-16) is a closed set.
 * Anything unmapped becomes `UNKNOWN` rather than an invented `ACTIVE`: a
 * serial nobody has issued yet is not an entitlement.
 */
export function entitlementStatusFor(serialStatus: string): string {
  switch (serialStatus.toUpperCase()) {
    case "ISSUED":
      return "ACTIVE";
    case "REVOKED":
      return "REVOKED";
    default:
      return "UNKNOWN";
  }
}

/** Matches `license.ts`: `LIC-` plus the first 8 chars of the serial id. */
export function licenseIdFor(serialId: string): string {
  return `LIC-${serialId.slice(0, 8).toUpperCase()}`;
}

/** Matches `license.ts` wording, so web and entitlement agree on the plan name. */
export function planNameFor(deviceMax: number): string {
  return `${deviceMax} Device Scans`;
}

/**
 * Builds the payload **string** that gets signed.
 *
 * Every field below is read by `SignedEntitlementProvider.recordOf` /
 * `verify` and is mandatory there: a missing one makes the Host deny the
 * entitlement rather than default it. The invariants checked client-side
 * (L126-133, L249-253) are enforced here so a bad payload is caught on the
 * server instead of at a customer's workstation.
 */
export function buildEntitlementPayload(
  serial: SerialForSigning,
  policy: EntitlementPolicy,
  now: Now,
  anchors: PayloadAnchors = {},
): string {
  const serverTimeMs = now().getTime();
  const validFromMs = (anchors.validFrom ?? serial.issuedAt ?? serial.createdAt).getTime();
  const validUntilMs = validFromMs + policy.validitySeconds * 1000;

  const deviceScanEntitlement = serial.deviceMax;
  const scansUsed = Math.max(0, serial.devicesBound);
  const scansRemaining = Math.max(0, deviceScanEntitlement - scansUsed);

  // Kotlin L130 refuses a licence already expired when it was signed.
  if (validUntilMs < serverTimeMs) {
    throw new SigningConfigError(
      "entitlement validity window has already elapsed; refusing to sign an expired grant",
    );
  }
  if (policy.graceLimitSeconds < 0) {
    throw new SigningConfigError("graceLimitSeconds must not be negative");
  }

  const payload = {
    licenseId: licenseIdFor(serial.id),
    serialNumber: serial.publicNumber,
    customerEmail: serial.customerEmail,
    customerName: serial.customerFullName ?? undefined,
    companyName: serial.companyName ?? undefined,
    planName: planNameFor(serial.deviceMax),
    deviceScanEntitlement,
    scansUsed,
    scansRemaining,
    revision: 1,
    status: entitlementStatusFor(serial.status),
    validFrom: new Date(validFromMs).toISOString(),
    validUntil: new Date(validUntilMs).toISOString(),
    serverTime: new Date(serverTimeMs).toISOString(),
    graceLimitSeconds: policy.graceLimitSeconds,
    offline: {
      diagnostics: policy.offline.diagnostics,
      sanitizeExecute: policy.offline.sanitizeExecute,
      upgrade: policy.offline.upgrade,
    },
  };

  return JSON.stringify(payload);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw new SigningConfigError("signing key is not valid Base64");
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Signs `payload` and returns the Base64 signature.
 *
 * The private key is PKCS#8 DER, Base64, supplied per call and imported as
 * non-extractable. There is no module-level key, no cache and no fallback:
 * if this throws, nothing was signed.
 */
export async function signPayload(
  payload: string,
  privateKeyPkcs8B64: string,
): Promise<string> {
  const trimmed = privateKeyPkcs8B64.trim();
  if (!trimmed) {
    throw new SigningConfigError("ENTITLEMENT_PRIVATE_KEY_B64 is not configured");
  }

  const der = base64ToBytes(trimmed);

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: SIGNATURE_ALGORITHM },
      /* extractable = */ false,
      ["sign"],
    );
  } catch {
    // Covers a wrong key type, a truncated DER, or a runtime without Ed25519.
    throw new SigningConfigError(
      "signing key could not be imported (expected Ed25519 PKCS#8)",
    );
  }

  let signature: ArrayBuffer;
  try {
    signature = await crypto.subtle.sign(
      { name: SIGNATURE_ALGORITHM },
      key,
      new TextEncoder().encode(payload),
    );
  } catch {
    throw new SigningConfigError("Ed25519 signing failed");
  }

  return bytesToBase64(new Uint8Array(signature));
}

/** The four fields the task's contract requires, all non-optional. */
export interface SignedEnvelope {
  schema: string;
  issuedAt: string;
  payload: string;
  signature: string;
}

/**
 * Builds and signs in one step so a caller cannot forget to sign, and cannot
 * sign something other than the payload it returns.
 */
export async function signEntitlement(
  serial: SerialForSigning,
  policy: EntitlementPolicy,
  privateKeyPkcs8B64: string,
  now: Now,
  anchors: PayloadAnchors = {},
): Promise<SignedEnvelope> {
  const issuedAt = now();
  const payload = buildEntitlementPayload(serial, policy, now, anchors);
  const signature = await signPayload(payload, privateKeyPkcs8B64);

  return {
    schema: ENTITLEMENT_SCHEMA,
    issuedAt: issuedAt.toISOString(),
    payload,
    signature,
  };
}

/**
 * Validates the signing configuration without needing a row.
 *
 * Exported so `/issue` and `/v1/activation` share one definition: two copies of
 * "is signing configured?" is two chances to let one path ship a response the
 * other would have refused.
 */
export function requireSigningKey(env: Env): string {
  const privateKey = (env.ENTITLEMENT_PRIVATE_KEY_B64 ?? "").trim();
  if (!privateKey) {
    throw new SigningConfigError("ENTITLEMENT_PRIVATE_KEY_B64 is not configured");
  }
  return privateKey;
}

/**
 * Reads the signing policy from the environment.
 *
 * `ENTITLEMENT_VALIDITY_SECONDS` is deliberately **required** rather than
 * defaulted. `mobile_serials` has no expiry column, so any validity window is
 * a business decision, and silently picking 365 days would fabricate a term
 * nobody agreed to. Configuring it is the act of agreeing to it.
 *
 * The grace default (86400) and the offline triple are grounded in frozen
 * policy: `graceLimitSeconds: 86400` and `SANITIZE_EXECUTE` refused offline
 * (`SANITIZE_LOCKED_OFFLINE`).
 */
export function readEntitlementPolicy(env: Env): EntitlementPolicy {
  const validityRaw = Number((env.ENTITLEMENT_VALIDITY_SECONDS ?? "").trim());
  if (!Number.isFinite(validityRaw) || validityRaw <= 0) {
    throw new SigningConfigError(
      "ENTITLEMENT_VALIDITY_SECONDS is not configured (no expiry column exists; the window must be stated, not assumed)",
    );
  }

  const graceRaw = Number((env.ENTITLEMENT_GRACE_SECONDS ?? "").trim());
  const graceLimitSeconds = Number.isFinite(graceRaw) && graceRaw >= 0
    ? Math.trunc(graceRaw)
    : 86_400;

  return {
    validitySeconds: Math.trunc(validityRaw),
    graceLimitSeconds,
    offline: {
      diagnostics: true,
      sanitizeExecute: false,
      upgrade: false,
    },
  };
}
