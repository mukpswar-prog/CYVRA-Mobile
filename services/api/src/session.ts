import type { Context } from "hono";
import { getCookie } from "hono/cookie";

export const SESSION_COOKIE = "cyvra_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Cookie flags depend on where the Worker is served:
 * - localhost: SameSite=Lax, Secure=false (wrangler dev)
 * - *.cyvra.co.in: first-party with the Pages host, SameSite=Lax, Secure
 * - workers.dev talking to pages.dev: cross-site, SameSite=None; Secure
 *   (Chrome still may partition third-party cookies; the API also accepts
 *   Authorization: Bearer for preview).
 */
export function sessionCookieOptions(c: Context) {
  const host = new URL(c.req.url).hostname;
  const local = host === "localhost" || host === "127.0.0.1";
  const firstParty = local || host.endsWith("cyvra.co.in");
  return {
    httpOnly: true,
    path: "/",
    sameSite: firstParty ? ("Lax" as const) : ("None" as const),
    secure: !local,
    maxAge: SESSION_TTL_MS / 1000,
  };
}

/** Prefer Authorization: Bearer (Pages preview), then the HttpOnly cookie. */
export function readSessionToken(c: Context): string | undefined {
  const header = c.req.header("Authorization");
  if (header && header.slice(0, 7).toLowerCase() === "bearer ") {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  return getCookie(c, SESSION_COOKIE);
}
