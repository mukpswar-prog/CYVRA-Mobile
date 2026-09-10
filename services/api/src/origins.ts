/**
 * Browser origins allowed to call this Worker with credentials.
 *
 * Product family: *.cyvoriq.co.in (www / admin / accounts / apex).
 * Preview until cutover: mobile.cyvra.co.in and Pages cyvra-mobile.
 * Erase admin/accounts stay allowlisted until Phase 5 of
 * docs/cyvoriq-migration-audit.txt, then they must be removed.
 * Erase www / api.cyvra.co.in are never allowed.
 */

const LOCAL_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const PAGES_PROJECTS = [
  "cyvra-mobile",
  "cyvoriq-www",
  "cyvoriq-admin",
  "cyvoriq-accounts",
] as const;

export interface OriginEnv {
  APP_ORIGIN?: string;
  ALLOWED_ORIGINS?: string;
}

export function isHostOrSubdomain(hostname: string, apex: string): boolean {
  return hostname === apex || hostname.endsWith(`.${apex}`);
}

export function isPagesPreviewHost(hostname: string, project: string): boolean {
  return (
    hostname === `${project}.pages.dev` ||
    hostname.endsWith(`.${project}.pages.dev`)
  );
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
    const host = url.hostname;
    if (isHostOrSubdomain(host, "cyvoriq.co.in")) return true;
    if (host === "mobile.cyvra.co.in") return true;
    if (host === "admin.cyvra.co.in") return true;
    if (host === "accounts.cyvra.co.in") return true;
    for (const project of PAGES_PROJECTS) {
      if (isPagesPreviewHost(host, project)) return true;
    }
  } catch {
    return false;
  }
  return false;
}
