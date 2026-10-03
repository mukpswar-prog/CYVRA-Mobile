/**
 * §41 PERMISSION MIRROR - THE CLIENT'S HALF OF ONE TABLE.
 * =======================================================
 *
 * The server owns this table. `services/api/src/admin/rbac.ts` transcribes
 * §41, `requirePermission` consults it on every route, and nothing below can
 * grant anything: a request the server refuses is refused whether the browser
 * predicted it or not.
 *
 * So why mirror it at all? Because §14 says *"Never show an action that cannot
 * currently be performed unless it is intentionally displayed as disabled with
 * an explanation."* That promise cannot be kept from the server's answers
 * alone - the console would have to fire all twelve writes on every row to
 * learn which ones are legal, and it would have learned by doing them.
 *
 * The mirror therefore only ever *removes* affordance. It is transcribed here
 * rather than inferred (no "roles that look administrative") so that a reviewer
 * can diff this against `rbac.ts` line by line. `permissions.test.ts` does
 * exactly that against a literal copy of §41's grid.
 */

export const STAFF_ROLES = [
  "SUPER_ADMIN",
  "LICENCE_ADMIN",
  "OPERATOR",
  "AUDITOR",
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

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
 * §41, transcribed.
 *
 * Column order is Super Admin / Licence Admin / Operator / Auditor. One footnote
 * is resolved: §41 marks operator Confirm Payment `YES*` and then says the
 * safest initial deployment restricts it to Licence Admin and Super Admin -
 * which is how `rbac.ts` read it too, so a server 403 and a disabled menu item
 * always agree.
 */
export const PERMISSION_MATRIX: Readonly<Record<Permission, readonly StaffRole[]>> =
  Object.freeze({
    "serial:read": ["SUPER_ADMIN", "LICENCE_ADMIN", "OPERATOR", "AUDITOR"],
    "serial:create": ["SUPER_ADMIN", "LICENCE_ADMIN", "OPERATOR"],
    "serial:update": ["SUPER_ADMIN", "LICENCE_ADMIN", "OPERATOR"],
    "payment:confirm": ["SUPER_ADMIN", "LICENCE_ADMIN"],
    "key:generate": ["SUPER_ADMIN", "LICENCE_ADMIN"],
    "licence:issue": ["SUPER_ADMIN", "LICENCE_ADMIN"],
    "licence:suspend": ["SUPER_ADMIN", "LICENCE_ADMIN"],
    "licence:revoke": ["SUPER_ADMIN", "LICENCE_ADMIN"],
    "rebind:request": ["SUPER_ADMIN", "LICENCE_ADMIN", "OPERATOR"],
    "rebind:approve": ["SUPER_ADMIN", "LICENCE_ADMIN"],
    "report:export": ["SUPER_ADMIN", "LICENCE_ADMIN", "OPERATOR", "AUDITOR"],
    "audit:read": ["SUPER_ADMIN", "LICENCE_ADMIN", "OPERATOR", "AUDITOR"],
    "staff:manage": ["SUPER_ADMIN"],
    "plan:manage": ["SUPER_ADMIN"],
    "settings:manage": ["SUPER_ADMIN"],
  } as Record<Permission, readonly StaffRole[]>);

/**
 * §41 marks operator "View audit" LIMITED, never yes or no.
 *
 * The server resolves it as "rows you produced yourself" inside
 * `readAuditEvents`, and answers the page with `scope: "self"` so the UI can
 * *say* that rather than leaving an operator to wonder where the rest of the
 * trail went. This constant exists only to decide whether the console needs to
 * render that sentence - it does not decide which rows come back.
 */
export const LIMITED_AUDIT_ROLES: readonly StaffRole[] = Object.freeze(["OPERATOR"]);

/** Does `role` hold `permission`? `null` (no session, service principal) holds nothing. */
export function can(role: StaffRole | null, permission: Permission): boolean {
  if (role === null) return false;
  return PERMISSION_MATRIX[permission].includes(role);
}

/** Every permission a role holds. Used to render the role's capability list. */
export function permissionsFor(role: StaffRole | null): readonly Permission[] {
  if (role === null) return [];
  return PERMISSIONS.filter((permission) => PERMISSION_MATRIX[permission].includes(role));
}

/**
 * A human sentence for a refused permission.
 *
 * "You do not have permission" tells an operator nothing they can act on. This
 * names the role they are actually signed in as and the capability they lack,
 * which is what makes a disabled row-menu entry an explanation rather than a
 * dead end.
 */
export function explainRoleRefusal(role: StaffRole | null, permission: Permission): string {
  if (role === null) {
    return `Your session has no role, so it holds no permissions - "${permission}" included.`;
  }
  const holders = PERMISSION_MATRIX[permission].join(", ");
  return `Your role (${role.replace("_", " ").toLowerCase()}) does not hold "${permission}". Held by: ${holders}.`;
}
