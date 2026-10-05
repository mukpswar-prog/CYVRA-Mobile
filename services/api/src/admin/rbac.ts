/**
 * W5 PHASE 1 - ROLE-BASED ACCESS CONTROL (design plan 41)
 * =======================================================
 *
 * Plan 19 states the rule this file exists to enforce:
 *
 *     "The browser should request an operation. The server must decide
 *      whether that operation is permitted."
 *     "Never trust: payment=true, role=admin, approved=true."
 *     "Server-side role validation."
 *
 * The previous implementation was a boolean - `requireAdmin` - which answered
 * "is this caller an operator, yes or no" and then let each route improvise.
 * Two routes re-implemented their own checks by comparing
 * `admin.email !== SUPER_ADMIN_EMAIL`, which meant the permission model lived
 * in three places and the matrix in plan 41 was encoded nowhere at all.
 *
 * HERE THERE IS ONE TABLE. `PERMISSION_MATRIX` below is a literal
 * transcription of plan 41, every route declares the permission it needs, and
 * `requireRole` / `requirePermission` are the only two ways past the gate.
 *
 * ---------------------------------------------------------------------------
 * §41, WITH THE `*` FOOTNOTE RESOLVED
 * ---------------------------------------------------------------------------
 * Plan 41 marks "Confirm payment" for operators with `*` and explains:
 *
 *     "Whether operators may confirm payment should be configurable by the
 *      Super Admin. For the safest initial deployment, payment confirmation
 *      can be restricted to Licence Admin and Super Admin."
 *
 * The operator of this repository ruled on the initial deployment:
 * **OPERATOR cannot confirm payment.** So `payment:confirm` is SUPER_ADMIN and
 * LICENCE_ADMIN only; the configurability is deferred to a later phase.
 *
 * `AUDITOR` appears on every *read* row and no *write* row, which is what
 * "AUDITOR: Read-only (denied all writes)" requires. The one place §41 is not
 * a plain yes/no is `View audit` for operators, marked `LIMITED` - see
 * `LIMITED_AUDIT_ROLES`.
 *
 * ---------------------------------------------------------------------------
 * THE SERVICE PRINCIPAL (E3)
 * ---------------------------------------------------------------------------
 * A verified `ADMIN_API_TOKEN` with no staff session behind it becomes
 * `ServicePrincipal`, which carries no role. Rather than inventing one, `can()`
 * answers from `SERVICE_READ_ONLY_PERMISSIONS`: list, read, export, audit.
 * Every write is denied, so a machine credential can never be the actor on an
 * `audit_events` row whose `actor_role` column is NOT NULL.
 */

import type { AdminContext } from "./principal";
import {
  authenticate,
  isAuthError,
  STAFF_ROLES,
  type AuthError,
  type Principal,
  type StaffPrincipal,
  type StaffRole,
} from "./principal";

export type { AdminContext, Principal, StaffPrincipal, StaffRole };
export { STAFF_ROLES };

/**
 * The permission vocabulary - one entry per §41 row.
 *
 * Written `resource:verb` so a reader can tell a read from a write at a glance
 * and so `SERVICE_READ_ONLY_PERMISSIONS` is a set membership test rather than
 * a naming convention.
 */
export const PERMISSIONS = [
  "serial:read",
  "serial:create",
  "serial:update",
  "payment:confirm",
  "key:generate",
  "licence:issue",
  "licence:suspend",
  "licence:revoke",
  "rebind:request",
  "rebind:approve",
  "report:export",
  "audit:read",
  "staff:manage",
  "plan:manage",
  "settings:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * §41 as data.
 *
 * `SUPER_ADMIN` holds every permission - §41 gives it all fifteen rows - which
 * is why the three administrative rows (`staff:manage`, `plan:manage`,
 * `settings:manage`) list it alone.
 */
export const PERMISSION_MATRIX: Readonly<
  Record<Permission, readonly StaffRole[]>
> = Object.freeze({
  "serial:read": ["SUPER_ADMIN", "LICENCE_ADMIN", "OPERATOR", "AUDITOR"],
  "serial:create": ["SUPER_ADMIN", "LICENCE_ADMIN", "OPERATOR"],
  // "Edit customer" - §41 reads exactly the same as create.
  "serial:update": ["SUPER_ADMIN", "LICENCE_ADMIN", "OPERATOR"],
  // §41 footnote resolved to its "safest initial deployment" reading.
  "payment:confirm": ["SUPER_ADMIN", "LICENCE_ADMIN"],
  "key:generate": ["SUPER_ADMIN", "LICENCE_ADMIN"],
  "licence:issue": ["SUPER_ADMIN", "LICENCE_ADMIN"],
  "licence:suspend": ["SUPER_ADMIN", "LICENCE_ADMIN"],
  "licence:revoke": ["SUPER_ADMIN", "LICENCE_ADMIN"],
  // §41 gives operators "Request Rebind" but not "Rebind approval".
  "rebind:request": ["SUPER_ADMIN", "LICENCE_ADMIN", "OPERATOR"],
  "rebind:approve": ["SUPER_ADMIN", "LICENCE_ADMIN"],
  "report:export": ["SUPER_ADMIN", "LICENCE_ADMIN", "OPERATOR", "AUDITOR"],
  "audit:read": ["SUPER_ADMIN", "LICENCE_ADMIN", "OPERATOR", "AUDITOR"],
  "staff:manage": ["SUPER_ADMIN"],
  "plan:manage": ["SUPER_ADMIN"],
  "settings:manage": ["SUPER_ADMIN"],
});

/**
 * §41 marks `View audit` for operators as `LIMITED`, not yes or no.
 *
 * "Limited" means an operator may read the audit trail but only the rows they
 * produced themselves. There is no audit-read route in Phase 1 - the licence
 * drawer's Audit Timeline is a later phase - so this is declared and tested
 * here, and the route that eventually serves it must consult this list rather
 * than re-deciding what LIMITED meant.
 */
export const LIMITED_AUDIT_ROLES: readonly StaffRole[] = Object.freeze([
  "OPERATOR",
]);

/**
 * Everything the read-only service credential may do.
 *
 * Matches the ruling on the `ADMIN_API_TOKEN` path: automation keeps list /
 * read / export / audit and loses every state change. Nothing in this set is a
 * write.
 */
export const SERVICE_READ_ONLY_PERMISSIONS: ReadonlySet<Permission> =
  new Set<Permission>(["serial:read", "report:export", "audit:read"]);

/** Does this principal hold this permission? */
export function can(principal: Principal, permission: Permission): boolean {
  if (principal.kind === "service") {
    return SERVICE_READ_ONLY_PERMISSIONS.has(permission);
  }
  return PERMISSION_MATRIX[permission].includes(principal.role);
}

/** Every permission a role holds. Used by `/me` and by the matrix test. */
export function permissionsFor(role: StaffRole): readonly Permission[] {
  return PERMISSIONS.filter((permission) =>
    PERMISSION_MATRIX[permission].includes(role),
  );
}

function denied(subject: string, permission: Permission): AuthError {
  return {
    error: `${subject} cannot ${permission.replace(":", " ")}.`,
    status: 403,
  };
}

/**
 * Gate: authenticated, any principal, no capability required.
 *
 * For `GET /me` and anything else whose only question is "are you signed in,
 * and as whom". It deliberately grants nothing - a route that reaches past
 * this gate for a read must also state the permission it needs.
 */
export function requireAuthenticated(): (
  c: AdminContext,
) => Promise<Principal | AuthError> {
  return async (c) => authenticate(c);
}

/**
 * Gate: authenticated as one of `roles`.
 *
 * The direct replacement for the boolean `requireAdmin`. A route that used to
 * say `if (admin.email !== SUPER_ADMIN_EMAIL)` now says
 * `requireRole("SUPER_ADMIN")`, and the answer comes from `staff_operators.role`
 * as read from the database rather than from a header or an email comparison.
 *
 * A service principal holds no role, so it can never satisfy `requireRole`.
 * Routes that automation legitimately needs should use `requirePermission`
 * with a read permission instead.
 */
export function requireRole(
  ...roles: readonly StaffRole[]
): (c: AdminContext) => Promise<Principal | AuthError> {
  assertRoles(roles);
  return async (c) => {
    const principal = await authenticate(c);
    if (isAuthError(principal)) return principal;
    if (principal.kind === "service") {
      return {
        error: "This action requires a staff session; the admin token cannot assume a role.",
        status: 403,
      };
    }
    if (!roles.includes(principal.role)) {
      return {
        error: `This action requires ${roles.join(" or ")}; your role is ${principal.role}.`,
        status: 403,
      };
    }
    return principal;
  };
}

/**
 * Gate: authenticated and holding **every** listed permission.
 *
 * Routes state the capability rather than the job title, so a route needing
 * `licence:issue` keeps working if §41 ever grants that permission to a fifth
 * role - with no edit to the route itself.
 */
export function requirePermission(
  ...permissions: readonly Permission[]
): (c: AdminContext) => Promise<Principal | AuthError> {
  assertPermissions(permissions);
  return async (c) => {
    const principal = await authenticate(c);
    if (isAuthError(principal)) return principal;
    for (const permission of permissions) {
      if (!can(principal, permission)) return denied(principal.kind, permission);
    }
    return principal;
  };
}

/**
 * Gate: authenticated as a **person** holding every listed permission.
 *
 * Every state-changing route uses this rather than `requirePermission`, for
 * two reasons that are the same reason: `audit_events.actor_role` is NOT NULL
 * and a service principal has no role to put in it; and the actor columns a
 * handler writes here - `created_by`, `issued_by`, `nominated_by` - must name
 * the person who acted, not an API token. Returning `StaffPrincipal` proves
 * that at compile time, so a handler assigns `admin.email` with no cast and no
 * non-null assertion.
 */
export function requireStaffPermission(
  ...permissions: readonly Permission[]
): (c: AdminContext) => Promise<StaffPrincipal | AuthError> {
  assertPermissions(permissions);
  return async (c) => {
    const principal = await authenticate(c);
    if (isAuthError(principal)) return principal;
    if (principal.kind === "service") {
      return {
        error: "State changes require a staff session; this admin token is read-only.",
        status: 403,
      };
    }
    for (const permission of permissions) {
      if (!can(principal, permission)) return denied(principal.role, permission);
    }
    return principal;
  };
}

/**
 * May this principal waive payment and generate a key for an unpaid licence?
 *
 * §8's Green Key Rule has exactly one exception, ruled by the operator of this
 * repo: the Super Admin may issue to any customer "bypassing payment done or
 * not", and - the half that actually constrains the code - *everybody below
 * them is an admin user but not a super admin user*, so nobody else may.
 *
 * Deliberately a role check rather than a `Permission`:
 *
 *   - `PERMISSION_MATRIX` is a transcription of §41 and §41 has no "waive
 *     payment" row. Inventing one would put a capability in the matrix that
 *     the plan never granted, which is the same species of error as the
 *     `*` footnote we already ruled against.
 *   - The waiver is not an ordinary capability to be distributed. It is a
 *     named exception to a financial control, so it belongs to one seat and
 *     should still belong to that seat if §41 is ever re-cut.
 *
 * A service principal holds no role and therefore cannot waive. This answers
 * "may they ask", never "may they ask silently": the route additionally
 * requires an explicit `waivePayment: true` in the body, so the Green Key Rule
 * remains the default answer even for the Super Admin.
 */
export function mayWaivePayment(principal: Principal): boolean {
  return principal.kind === "staff" && principal.role === "SUPER_ADMIN";
}

/** Guards against a typo quietly creating a role nothing can hold. */
function assertRoles(roles: readonly StaffRole[]): void {
  if (roles.length === 0) {
    throw new Error("requireRole() needs at least one role.");
  }
  for (const role of roles) {
    if (!STAFF_ROLES.includes(role)) {
      throw new Error(
        `requireRole(): "${role}" is not one of ${STAFF_ROLES.join(", ")}.`,
      );
    }
  }
}

/**
 * Guards against a typo quietly creating a permission nothing can hold - a
 * route gated on `"licence:issu"` would otherwise deny everybody, including
 * SUPER_ADMIN, and look like a §41 decision rather than a misspelling.
 */
function assertPermissions(permissions: readonly Permission[]): void {
  if (permissions.length === 0) {
    throw new Error("A permission gate needs at least one permission.");
  }
  for (const permission of permissions) {
    if (!PERMISSIONS.includes(permission)) {
      throw new Error(
        `Unknown permission "${permission}". Known: ${PERMISSIONS.join(", ")}.`,
      );
    }
  }
}
