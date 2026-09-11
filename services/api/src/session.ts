import type { Context } from "hono";
import { getCookie } from "hono/cookie";

export const SESSION_COOKIE = "cyvra_session";
export const STAFF_COOKIE = "cyvra_staff";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const STAFF_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Cookie flags depend on where the Worker is served:
 * - localhost: SameSite=Lax, Secure=false (wrangler dev)
 * - *.cyvoriq.co.in (and leftover *.cyvra.co.in): same-site with Pages, Lax
 * - workers.dev talking to pages.dev: cross-site, SameSite=None; Secure
 *   (Chrome still may partition third-party cookies; the API also accepts
 *   Authorization: Bearer for preview).
 */
export function isFirstPartyApiHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  return (
    hostname === "cyvoriq.co.in" ||
    hostname.endsWith(".cyvoriq.co.in") ||
    hostname === "cyvra.co.in" ||
    hostname.endsWith(".cyvra.co.in")
  );
}

export function sessionCookieOptions(c: Context) {
  const host = new URL(c.req.url).hostname;
  const local = host === "localhost" || host === "127.0.0.1";
  const firstParty = isFirstPartyApiHost(host);
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

export function staffCookieOptions(c: Context) {
  const host = new URL(c.req.url).hostname;
  const local = host === "localhost" || host === "127.0.0.1";
  const firstParty = isFirstPartyApiHost(host);
  return {
    httpOnly: true,
    path: "/",
    sameSite: firstParty ? ("Lax" as const) : ("None" as const),
    secure: !local,
    maxAge: STAFF_TTL_MS / 1000,
  };
}

export function readStaffToken(c: Context): string | undefined {
  const header = c.req.header("Authorization");
  if (header && header.slice(0, 7).toLowerCase() === "bearer ") {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  return getCookie(c, STAFF_COOKIE);
}
