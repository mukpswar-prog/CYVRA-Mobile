/**
 * The console's frame: sidebar, topbar, content well.
 *
 * Navigation is *revealed* by permission and never merely greyed out - an AUDITOR
 * should not see "Staff" sitting there looking broken. The active item is marked
 * with `aria-current="page"` rather than with a colour alone, so the reader's
 * position survives a monochrome screenshot.
 *
 * Sign-out lives in the sidebar foot next to the role and the address, because
 * those three answers belong together: *who* is signed in, *what* they can do,
 * and how to stop being them.
 */
import type { ReactNode } from "react";
import { Badge } from "../components/kit";
import { permissionsFor } from "../permissions";
import type { StaffRole } from "../types";
import { useSessionState, visibleNav, type PageId } from "./session";

const ROLE_LABEL: Record<StaffRole, string> = {
  SUPER_ADMIN: "Super Admin",
  LICENCE_ADMIN: "Licence Admin",
  OPERATOR: "Operator",
  AUDITOR: "Auditor",
};

const PAGE_TITLE: Record<PageId, string> = {
  dashboard: "Licence Operations",
  licences: "Licence Registry",
  staff: "Staff",
  reports: "Reports",
  audit: "Audit Trail",
};

export function Shell({
  page,
  onNavigate,
  children,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  children: ReactNode;
}) {
  const { session, signOut } = useSessionState();
  const role = session?.role ?? null;
  const items = visibleNav(role);

  return (
    <div className="admin-root">
      <div className="admin-shell">
        <aside className="admin-sidebar">
          <div className="admin-brand">
            <div className="admin-brand__mark">CYVRA MOBILE</div>
            <div className="admin-brand__sub">Licence Operations</div>
          </div>

          <nav className="admin-nav" aria-label="Admin sections">
            <div className="admin-nav__label">Console</div>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="admin-nav__item"
                aria-current={page === item.id ? "page" : undefined}
                onClick={() => onNavigate(item.id)}
              >
                <span className="admin-nav__icon" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </button>
            ))}
            {items.length === 0 ? (
              <p className="muted" style={{ padding: "8px 10px", fontSize: 12 }}>
                This session holds no permissions, so there is nothing to open.
              </p>
            ) : null}
          </nav>

          <div className="admin-sidebar__foot">
            <div className="admin-sidebar__role">
              {role ? ROLE_LABEL[role] : "No role"}
              {session?.isSuperAdmin ? " · signed in as Super Admin" : null}
            </div>
            <div className="admin-sidebar__email">{session?.email ?? "—"}</div>
            <button
              type="button"
              className="btn btn--sm btn--block"
              style={{ marginTop: 10 }}
              onClick={signOut}
            >
              Sign out
            </button>
          </div>
        </aside>

        <div className="admin-main">
          <header className="admin-topbar">
            <div>
              <h1 className="admin-topbar__title">{PAGE_TITLE[page]}</h1>
              <div className="admin-topbar__meta">
                {role ? (
                  <>
                    Signed in as {session?.email} · {ROLE_LABEL[role]}
                  </>
                ) : (
                  "No role is attached to this session."
                )}
              </div>
            </div>
            <div className="row row--wrap">
              {role ? (
                <span className="badge badge--neutral" title={capabilities(role)}>
                  {permissionsFor(role).length} permissions
                </span>
              ) : null}
              <Badge view={{ text: session?.isSuperAdmin ? "Super Admin seat" : "Staff seat", tone: "blue" }} />
            </div>
          </header>

          <main className="admin-content">{children}</main>
        </div>
      </div>
    </div>
  );
}

/** Hover text for the permission count - the count alone is not the answer. */
function capabilities(role: StaffRole): string {
  return permissionsFor(role).join(", ");
}
