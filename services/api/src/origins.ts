/**
 * Browser origins allowed to call this Worker with credentials.
 *
 * Preview hosts for Pages project `cyvra-mobile` are allowlisted so G3 can
 * land on a *.pages.dev URL before the custom domain mobile.cyvra.co.in exists.
 */

const LOCAL_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

export interface OriginEnv {
  APP_ORIGIN?: string;
  ALLOWED_ORIGINS?: string;
}

export function isAllowedOrigin(
  origin: string | undefined,
  env: OriginEnv,
): boolean {
  if (!origin) return false;
  if (origin === env.APP_ORIGIN) return true;
  if (LOCAL_ORIGINS.includes(origin)) return true;

  const extra = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (extra.includes(origin)) return true;

  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    if (url.hostname === "mobile.cyvra.co.in") return true;
    if (url.hostname === "cyvra-mobile.pages.dev") return true;
    if (url.hostname.endsWith(".cyvra-mobile.pages.dev")) return true;
  } catch {
    return false;
  }
  return false;
}
