/**
 * PermissionGate - "render this only for a seat that holds the permission".
 * ==========================================================================
 *
 * What it is: a *presentation* gate. It decides whether a control exists in
 * the DOM.
 *
 * What it is not: an authorisation decision. Every action behind it still
 * lands on `requirePermission` in `rbac.ts`, and the server does not know this
 * component exists. That asymmetry is deliberate, and it is the safe direction:
 * a gate that wrongly *hides* something produces a slightly worse UI, while a
 * gate that wrongly *shows* something produces a 403 the operator did not
 * expect. The first is a bug; the second would have been a vulnerability if it
 * were the only check - which is exactly why it is not.
 *
 * `role` may be passed explicitly, which is what lets `permissions.test.ts`
 * walk all four roles x fifteen permissions without mounting a whole session
 * for each combination, and without a provider at all. When it is omitted the
 * gate reads the signed-in session; when *that* is absent it resolves to `null`,
 * which holds no permissions - so the gate fails closed rather than rendering
 * protected markup to a page nobody signed into.
 */
import { useContext, type ReactNode } from "react";
import { can, type Permission, type StaffRole } from "../permissions";
import { SessionContext } from "./session";

export interface PermissionGateProps {
  permission: Permission;
  children: ReactNode;
  /** What renders in the gate's absence - usually `null`, sometimes an explanation. */
  fallback?: ReactNode;
  /** Overrides the context session. `undefined` means "ask the context". */
  role?: StaffRole | null;
}

export function PermissionGate({
  permission,
  children,
  fallback = null,
  role,
}: PermissionGateProps) {
  const fromContext = useContext(SessionContext);
  const effective: StaffRole | null =
    role !== undefined ? role : (fromContext?.session?.role ?? null);
  return <>{can(effective, permission) ? children : fallback}</>;
}
