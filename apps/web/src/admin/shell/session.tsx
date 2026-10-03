/**
 * WHO IS SIGNED IN, AND WHAT THAT MEANS FOR WHAT IS RENDERED.
 *
 * `GET /admin/me` answers `{email, role, superAdmin, superAdminEmail}` and
 * nothing else. It deliberately does not return a permission list: §41's table
 * is one table, it lives in `rbac.ts` on the server and in `permissions.ts`
 * here, and sending a computed list would mean the browser and the server could
 * drift while both believing they were right. The role is the fact; the
 * permissions are derived from a table that is checked against the server's by
 * `permissions.test.ts`.
 *
 * A `null` role is a real answer, not a loading state - it is what a service
 * principal gets, and it holds no permissions. The provider distinguishes the
 * three: `loading` (no answer yet), `error` (could not ask), `role: null`
 * (asked, and the answer is "none"). Collapsing the first two into the third
 * would render an empty navigation for a network blip and tell the operator
 * they have no access when they have not been told anything yet.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { writeStaffSession } from "../../api";
import { AdminHttpError, adminClient } from "../client";
import { can, type Permission, type StaffRole } from "../permissions";

export interface Session {
  email: string;
  role: StaffRole | null;
  isSuperAdmin: boolean;
  superAdminEmail: string;
}

export interface SessionState {
  status: "loading" | "ready" | "error";
  session: Session | null;
  error: string | null;
  /** Re-read `/me`. Used after sign-out and by the retry button. */
  reload: () => void;
  signOut: () => void;
}

export const SessionContext = createContext<SessionState | null>(null);

/**
 * The session, from context.
 *
 * Throws when there is none, because reaching this hook outside a provider is
 * a wiring bug rather than a state to render around - and rendering around it
 * is how a console ends up showing a blank page that looks like an empty
 * database.
 */
export function useSessionState(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSessionState must be used inside <SessionContext.Provider>");
  return value;
}

/** The signed-in session, or `null` while loading / on failure / signed out. */
export function useSession(): Session | null {
  return useSessionState().session;
}

export function usePermission(permission: Permission): boolean {
  return can(useSession()?.role ?? null, permission);
}

/**
 * Build the session state and fetch `/me`.
 *
 * Sign-out clears the stored token *before* the request is fired: the point of
 * signing out is that the next request carries no credential, and waiting for
 * a response to forget it would leave one more authenticated round trip in
 * the browser's history than the operator asked for.
 */
export function useSessionStateValue(): SessionState {
  const [status, setStatus] = useState<SessionState["status"]>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);

    adminClient
      .me()
      .then((me) => {
        if (cancelled) return;
        setSession({
          email: me.email,
          role: me.role,
          isSuperAdmin: me.superAdmin,
          superAdminEmail: me.superAdminEmail,
        });
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setSession(null);
        // 401 is an answer, not a failure: the operator is simply not signed
        // in, and saying so plainly is more useful than "something went wrong".
        const message =
          cause instanceof AdminHttpError && cause.status === 401
            ? "You are not signed in."
            : cause instanceof Error
              ? cause.message
              : "Could not reach the admin API.";
        setError(message);
        setStatus(cause instanceof AdminHttpError && cause.status === 401 ? "ready" : "error");
      });

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const signOut = useCallback(() => {
    writeStaffSession("");
    setSession(null);
    // Fire-and-forget: a failed logout request must not keep a cleared browser
    // looking signed in, and the token is already gone either way.
    void adminClient.logout().catch(() => undefined);
    setStatus("ready");
    setError(null);
  }, []);

  return { status, session, error, reload, signOut };
}

/* ------------------------------------------------------------------------ *
 * NAVIGATION
 * ------------------------------------------------------------------------ */

export type PageId = "dashboard" | "licences" | "staff" | "reports" | "audit";

export interface NavItem {
  readonly id: PageId;
  readonly label: string;
  readonly permission: Permission;
  readonly icon: string;
}

/**
 * The five nav items, each with the permission that *reveals* it.
 *
 * `staff` is `serial:read` rather than `staff:manage`, matching the server:
 * `GET /admin/staff` is gated on `serial:read` (admin.ts:879) because the
 * roster carries no secrets and §41 has no "View staff" row - only "Manage
 * staff". Gating the *page* on `staff:manage` would hide a screen the server
 * serves to four roles; the invite / approve / suspend / revoke controls
 * inside it are gated on `staff:manage` instead, which is where §41's
 * Super-Admin-only rule actually applies.
 */
export const NAV: readonly NavItem[] = Object.freeze([
  { id: "dashboard", label: "Dashboard", permission: "serial:read", icon: "▦" },
  { id: "licences", label: "Licences", permission: "serial:read", icon: "▤" },
  { id: "staff", label: "Staff", permission: "serial:read", icon: "◇" },
  { id: "reports", label: "Reports", permission: "report:export", icon: "⇩" },
  { id: "audit", label: "Audit", permission: "audit:read", icon: "≡" },
]);

/** Nav items this role may open, in display order. */
export function visibleNav(role: StaffRole | null): readonly NavItem[] {
  return NAV.filter((item) => can(role, item.permission));
}

export function Provider({ children }: { children: ReactNode }) {
  const value = useSessionStateValue();
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
