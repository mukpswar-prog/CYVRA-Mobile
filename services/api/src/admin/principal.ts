/**
 * W5 PHASE 1 - PRINCIPAL RESOLUTION (the E3 security fix)
 * =======================================================
 *
 * WHO IS ACTING, AND HOW WE KNOW
 * ------------------------------
 * There are exactly two credentials this API accepts, and they are not
 * equivalent:
 *
 *   1. A STAFF SESSION - an opaque token created by `POST /auth/verify` after
 *      an OTP round trip, stored hashed in `staff_sessions`, looked up by
 *      `sha256Hex(token)`, and joined to `staff_operators` for status and
 *      role. The database is the authority: the response tells us the email,
 *      the role and the staff id.
 *
 *   2. `ADMIN_API_TOKEN` - a deployment/automation bearer compared
 *      timing-safely against the environment. It authenticates a *client*, not
 *      a *person*. It carries no identity whatsoever.
 *
 * THE DEFECT BEING FIXED (E3)
 * ---------------------------
 * The previous `requireAdmin` fell back to:
 *
 *     const email = normalizeEmail(c.req.header("X-Admin-Email") ?? "");
 *
 * and then treated that browser-supplied string as the actor. Everything
 * downstream - `created_by`, `issued_by`, `nominated_by`, and now
 * `audit_events` - would record whatever name the caller cared to type. The
 * header is a free-text field on the request; it is no more evidence of
 * identity than a query parameter would be.
 *
 * THE RULING
 * ----------
 * "Actor identity must come from the verified session/token. The
 *  browser-supplied X-Admin-Email header must be ignored."
 *
 * Therefore:
 *
 *   - A valid staff session produces a staff principal. Its `email`, `role`
 *     and `actorId` come from the row, never from the request.
 *   - A valid `ADMIN_API_TOKEN` produces a SERVICE principal that is
 *     READ-ONLY. It may list, read and export; it may not write. Without a
 *     verified human identity there is nobody to name in `audit_events`, and
 *     `actor_role` is NOT NULL - so the honest answer is that this credential
 *     does not get to change state at all.
 *   - `X-Admin-Email` is not read anywhere in this file. It has no parameter,
 *     no branch, no fallback. The frontend still sends it (api.ts:234) and it
 *     is now inert.
 *
 * Nothing in `apps/web` is affected: the browser holds a staff session after
 * OTP sign-in (`writeStaffSession`), and `writeAdminToken` is defined but
 * never called from anywhere in the web app, so the admin-token path is
 * CI/automation only.
 *
 * NOTE ON `SUPER_ADMIN_EMAIL` / `isCyvoriqEmail`
 * ----------------------------------------------
 * These live here rather than in `../admin` because `../admin` imports this
 * module. Defining them on the other side would make the module graph a
 * cycle; `../admin` re-exports both so `staff.test.ts` keeps its import path.
 */

import { eq } from "drizzle-orm";
import type { Context } from "hono";
import {
  staffOperators,
  staffSessions,
  staffRoleEnum,
} from "@cyvra/database/schema";
import { sha256Hex, timingSafeEqualHex } from "../crypto";
import type { Database } from "../db";
import type { Env } from "../env";
import { readStaffToken } from "../session";

export const SUPER_ADMIN_EMAIL = "ceo@cyvoriq.com";

export function isCyvoriqEmail(email: string): boolean {
  return email.endsWith("@cyvoriq.com");
}

/** The four roles of design plan 41, derived from `staff_role_enum`. */
export type StaffRole = (typeof staffRoleEnum.enumValues)[number];

export const STAFF_ROLES: readonly StaffRole[] = Object.freeze([
  ...staffRoleEnum.enumValues,
]);

/**
 * An actor backed by a `staff_operators` row.
 *
 * `actorId` is `null` when the address has no row yet - the super admin
 * before first nomination, which `staff_operators` does not contain until
 * somebody nominates them. The actor is still named by `email`.
 */
export interface StaffPrincipal {
  readonly kind: "staff";
  readonly email: string;
  readonly role: StaffRole;
  readonly actorId: string | null;
}

/**
 * A verified machine credential. Deliberately carries no email and no role:
 * there is no person to attribute, and inventing one is the defect E3 exists
 * to remove.
 */
export interface ServicePrincipal {
  readonly kind: "service";
  readonly email: null;
  readonly actorId: null;
}

export type Principal = StaffPrincipal | ServicePrincipal;

/** Not a `Principal` - discriminated by `error` so `"error" in x` narrows. */
export interface AuthError {
  readonly error: string;
  readonly status: 401 | 403 | 503;
}

export type AuthResult = Principal | AuthError;

export function isAuthError(value: AuthResult): value is AuthError {
  return "error" in value;
}

/** Identity as the database reports it - never as the request claims it. */
export interface StaffIdentity {
  readonly email: string;
  readonly role: StaffRole;
  readonly actorId: string | null;
}

/**
 * Everything `resolvePrincipal` is allowed to look at.
 *
 * Note what is absent: there is no `emailHint`, no `header`, no `requestedBy`.
 * The E3 fix is structural - a browser-supplied name has nowhere to enter -
 * rather than a check that could be deleted by accident during a refactor.
 */
export interface PrincipalCredentials {
  readonly staffToken?: string | undefined;
  readonly bearerToken?: string | undefined;
  /** Whether `ADMIN_API_TOKEN` is set at all, so "unset" can be 503 not 401. */
  readonly adminApiConfigured: boolean;
}

export interface PrincipalDeps {
  /** `null` when the token names no live, ACTIVE staff session. */
  lookupStaffSession(token: string | undefined): Promise<StaffIdentity | null>;
  /** Timing-safe comparison against the configured admin token. */
  verifyAdminToken(token: string): Promise<boolean>;
}

/**
 * Decide who is acting.
 *
 * Order is significant. The staff session is tried first so that a caller
 * holding both credentials is attributed to the *person*, and so that the
 * machine credential can never shadow a real identity.
 */
export async function resolvePrincipal(
  creds: PrincipalCredentials,
  deps: PrincipalDeps,
): Promise<AuthResult> {
  const staff = await deps.lookupStaffSession(creds.staffToken);
  if (staff) {
    return { kind: "staff", email: staff.email, role: staff.role, actorId: staff.actorId };
  }

  const bearer = creds.bearerToken;
  if (!bearer) {
    return { error: "Admin token required.", status: 401 };
  }
  if (!creds.adminApiConfigured) {
    return { error: "ADMIN_API_TOKEN is not configured.", status: 503 };
  }
  if (!(await deps.verifyAdminToken(bearer))) {
    return { error: "Admin token required.", status: 401 };
  }

  // Verified as a machine credential -> read-only service principal.
  // `X-Admin-Email` is deliberately not consulted here (E3).
  return { kind: "service", email: null, actorId: null };
}

/**
 * The context shape every admin gate is typed against.
 *
 * Declared here rather than in `../admin` so that `./rbac` and `./audit` can
 * depend on this module without the graph becoming circular.
 */
export type AdminContext = Context<{ Bindings: Env; Variables: { db: Database } }>;

/**
 * One resolved principal per request.
 *
 * A `WeakMap` keyed on the Hono context rather than a `c.set()` variable: it
 * keeps `Variables` exactly as it was before Phase 1, which means `index.ts`,
 * the route types and every existing test keep compiling unchanged. The entry
 * dies with the context, so nothing can leak between requests.
 */
const PRINCIPAL_CACHE = new WeakMap<object, AuthResult>();

/** An `Authorization` bearer, whether it is a staff token or the admin token. */
function bearerToken(c: Context): string | undefined {
  const header = c.req.header("Authorization");
  if (header && header.slice(0, 7).toLowerCase() === "bearer ") {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  return undefined;
}

/**
 * Look up a staff session: token hash -> `staff_sessions` -> `staff_operators`.
 *
 * Two facts are enforced server-side and cannot be asserted by the browser
 * (plan 19: "Never trust ... role=admin ... coming directly from the browser"):
 * the session must not be expired, and the operator must still be ACTIVE.
 *
 * Returns `null` without touching the database when there is no token, which
 * is what keeps the admin-token path from paying for a query it will not use.
 */
export async function lookupStaffSession(
  db: Database,
  token: string | undefined,
): Promise<StaffIdentity | null> {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const [session] = await db
    .select()
    .from(staffSessions)
    .where(eq(staffSessions.tokenHash, tokenHash))
    .limit(1);
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;

  const [operator] = await db
    .select({
      email: staffOperators.email,
      status: staffOperators.status,
      role: staffOperators.role,
      id: staffOperators.id,
    })
    .from(staffOperators)
    .where(eq(staffOperators.email, session.email))
    .limit(1);

  /*
   * THE SUPER ADMIN IS NOT A ROW.
   *
   * `isApprovedOperator` has always authorised ceo@cyvoriq.com without any
   * `staff_operators` row, because the address is nominated by nobody and can
   * therefore not be revoked by anybody (plan 16). Requiring a row here would
   * silently lock the deployment owner out of their own control plane the
   * moment nobody had nominated them.
   *
   * Their role is likewise a property of the address rather than of the
   * `role` column: plan 41 gives SUPER_ADMIN all fifteen permissions, and a
   * column that defaults to OPERATOR must not be the thing that decides
   * whether the owner can still manage staff. If a row does exist, its id is
   * still used so the audit trail points at a real `staff_operators` row.
   *
   * Every other address is exactly what the row says - ACTIVE or nothing.
   */
  const email = session.email.trim().toLowerCase();
  if (email === SUPER_ADMIN_EMAIL) {
    return { email, role: "SUPER_ADMIN", actorId: operator?.id ?? null };
  }
  if (!isCyvoriqEmail(email)) return null;
  if (!operator || operator.status !== "ACTIVE") return null;

  return { email: operator.email, role: operator.role, actorId: operator.id };
}

/**
 * Is this address allowed to sign in / act at all?
 *
 * Used by `POST /auth/logout`'s siblings only in the sense of answering "is
 * this person an operator at all". It is **not** the OTP gate any more - see
 * `staffLifecycleStatus` for that, and the note on why the two differ.
 */
export async function isApprovedOperator(
  db: Database,
  email: string,
): Promise<boolean> {
  if (email === SUPER_ADMIN_EMAIL) return true;
  if (!isCyvoriqEmail(email)) return false;
  const [row] = await db
    .select({ status: staffOperators.status })
    .from(staffOperators)
    .where(eq(staffOperators.email, email))
    .limit(1);
  return row?.status === "ACTIVE";
}

/**
 * The lifecycle status of an address, before any session exists.
 *
 * WHY THIS EXISTS ALONGSIDE `isApprovedOperator`
 * ----------------------------------------------
 * Phase 1 used `isApprovedOperator` as the OTP gate, and it answered
 * `true` only for `ACTIVE`. That was correct while creating a staff row and
 * letting it in were the same moment. Phase 2 splits them: `POST /staff` now
 * creates the row at `INVITED`, the invitee verifies their own email
 * (`EMAIL_VERIFIED`), and only a Super Admin's approval makes them `ACTIVE`.
 *
 * Under the old gate an invitee could never have requested a code - the very
 * step that proves they own the address was refused because they had not yet
 * proven they own the address. So the OTP routes ask this instead, which
 * answers for all six statuses rather than for one:
 *
 *   INVITED        -> may request and verify; must NOT be given a session;
 *   EMAIL_VERIFIED -> may request and verify again; no session;
 *   ACTIVE         -> may request, verify and receive a session;
 *   SUSPENDED      -> may do nothing. Explicitly, not by omission;
 *   REVOKED        -> may do nothing.
 *
 * Five statuses, because `staff_status_enum` has five - note that `DRAFT` is a
 * *licence* state (ruling R1) and has no counterpart here, so there is no
 * sixth branch waiting to be forgotten.
 *
 * The refusal is carried as a `reason` rather than as `false`, because the
 * two failures deserve different sentences: "your account is suspended" tells
 * the operator to go and find the Super Admin, whereas "not nominated" tells
 * them they never had an account. Blurring them is how a suspended employee
 * spends an afternoon believing they were never invited.
 */
export interface StaffLifecycle {
  readonly allowed: boolean;
  /** The database's status, or `null` for the super admin (who has no row). */
  readonly status: string | null;
  /** Operator-facing refusal. `null` when `allowed`. */
  readonly reason: string | null;
}

export async function staffLifecycleStatus(
  db: Database,
  email: string,
): Promise<StaffLifecycle> {
  if (!isCyvoriqEmail(email)) {
    return {
      allowed: false,
      status: null,
      reason: "Only @cyvoriq.com emails can sign in to ops.",
    };
  }
  // Address-derived, never row-derived: the owner is nominated by nobody and
  // therefore revocable by nobody (plan 16), so there is no status to read.
  if (email === SUPER_ADMIN_EMAIL) {
    return { allowed: true, status: null, reason: null };
  }
  const [row] = await db
    .select({ status: staffOperators.status })
    .from(staffOperators)
    .where(eq(staffOperators.email, email))
    .limit(1);

  if (!row) {
    return {
      allowed: false,
      status: null,
      reason: "This email is not nominated by ceo@cyvoriq.com.",
    };
  }
  if (row.status === "SUSPENDED" || row.status === "REVOKED") {
    return {
      allowed: false,
      status: row.status,
      reason:
        row.status === "SUSPENDED"
          ? "This account is suspended. Ask ceo@cyvoriq.com to reactivate it."
          : "This account has been revoked and cannot sign in again.",
    };
  }
  // INVITED / EMAIL_VERIFIED / ACTIVE / DRAFT: the address is in good
  // standing, and whether a *session* follows is decided later by
  // `lookupStaffSession`, which still requires ACTIVE.
  return { allowed: true, status: row.status, reason: null };
}

/**
 * Resolve, and remember the answer for the rest of the request.
 *
 * Both outcomes are cached - including failures - so that a gate and the audit
 * middleware together cost exactly one session lookup instead of two.
 */
export async function authenticate(c: AdminContext): Promise<AuthResult> {
  const key = c as unknown as object;
  const cached = PRINCIPAL_CACHE.get(key);
  if (cached !== undefined) return cached;

  const configured = (c.env.ADMIN_API_TOKEN ?? "").trim();
  const result = await resolvePrincipal(
    {
      // `readStaffToken` prefers the bearer, so a caller presenting the admin
      // token there is first tried as a staff token, fails the session lookup,
      // and is then retried below as the admin token - the same order the old
      // `requireAdmin` used.
      staffToken: readStaffToken(c),
      bearerToken: bearerToken(c),
      adminApiConfigured: configured.length > 0,
    },
    {
      lookupStaffSession: (token) => lookupStaffSession(c.get("db"), token),
      verifyAdminToken: async (token) => {
        const [expected, got] = await Promise.all([
          sha256Hex(configured),
          sha256Hex(token),
        ]);
        return timingSafeEqualHex(expected, got);
      },
    },
  );

  PRINCIPAL_CACHE.set(key, result);
  return result;
}
