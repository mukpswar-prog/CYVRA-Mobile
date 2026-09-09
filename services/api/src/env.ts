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
}
