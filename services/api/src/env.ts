import type { Hyperdrive } from "@cloudflare/workers-types";

export interface Env {
  HYPERDRIVE: Hyperdrive;
  APP_ORIGIN: string;
  API_ENV: "development" | "preview" | "production" | string;
  /** Comma-separated extra CORS origins (optional). */
  ALLOWED_ORIGINS?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  SESSION_SECRET?: string;
  /** Ops only. Never a customer session. Never commit the value. */
  ADMIN_API_TOKEN?: string;
  /**
   * Ed25519 private half matching the Host's bundled `SERVER_PUBLIC_KEY_B64`.
   * PKCS#8 DER, Base64. Never log it, never echo it, never commit it. Absent
   * means entitlement signing is unavailable and `/issue` fails closed (503).
   */
  ENTITLEMENT_PRIVATE_KEY_B64?: string;
  /** Seconds an issued entitlement stays valid. See `EntitlementPolicy`. */
  ENTITLEMENT_VALIDITY_SECONDS?: string;
  /** Offline grace the Host enforces. Default 86400 (24h), per frozen policy. */
  ENTITLEMENT_GRACE_SECONDS?: string;
}
