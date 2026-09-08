import type { Hyperdrive } from "@cloudflare/workers-types";

export interface Env {
  HYPERDRIVE: Hyperdrive;
  APP_ORIGIN: string;
  API_ENV: "development" | "production" | string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  SESSION_SECRET?: string;
}
