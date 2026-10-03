/**
 * THE ADMIN CONSOLE'S ROOT - everything behind `admin.cyvoriq.co.in`.
 * ==================================================================
 *
 * MOUNT CONTRACT
 * --------------
 * `App.tsx:55` renders `<AdminApp />` whenever `isAdminHost()` is true and
 * nothing else. This component therefore owns the whole admin host: it is
 * responsible for the stylesheet, the session provider, sign-in, the shell and
 * the page switch, and it must render *something* legible in every state -
 * loading, unauthenticated, API unreachable, session without a role, and
 * normal. A blank screen here is a broken admin console, not an empty one.
 *
 * The page switch is local state rather than a URL, deliberately: this host
 * serves one `index.html` for every path (see `public/_redirects`), so a path
 * like `/admin/licences` would work only after a fresh load and then stop
 * matching on the next navigation. A page id in state is honest about that -
 * and the five sections are reachable from the sidebar, which is what the
 * brief asks for.
 *
 * WHY THE PERMISSIONS ARE *NOT* GATED HERE
 * ----------------------------------------
 * Navigation is revealed by `visibleNav(role)` inside `Shell`, and individual
 * controls are gated where they live - `PermissionGate` around the Staff page's
 * mutations, `rowActions` for every row menu, `staffActionReason` for the
 * roster's buttons. Wrapping whole pages here as well would add a second place
 * to keep in step with §41 for no additional safety: the server enforces
 * `requirePermission` on every route regardless of what this file renders.
 * The client's gates exist to stop offering actions that will be refused, not
 * to be the thing that stops them.
 */
import { useEffect, useState } from "react";
import "./styles.css";
import { Notice } from "./components/kit";
import { AuditPage } from "./pages/Audit";
import { DashboardPage } from "./pages/Dashboard";
import { LicencesPage } from "./pages/Licences";
import { ReportsPage } from "./pages/Reports";
import { SignInPage } from "./pages/SignIn";
import { StaffPage } from "./pages/Staff";
import { Shell } from "./shell/Shell";
import {
  Provider,
  useSessionState,
  visibleNav,
  type PageId,
} from "./shell/session";
import type { SerialQueryState } from "./client";
import type { StaffRole } from "./permissions";

function Console() {
  const { status, session, error, reload } = useSessionState();
  const [page, setPage] = useState<PageId>("dashboard");
  const [seed, setSeed] = useState<Partial<SerialQueryState> | undefined>(undefined);

  const role = session?.role ?? null;

  // If the session changes to a role that cannot see the current section,
  // land on the first section it can. Without this, signing in as a role
  // without `report:export` while sitting on Reports would render a page the
  // sidebar does not offer - a page that looks like a mistake rather than a
  // permission boundary.
  useEffect(() => {
    if (status !== "ready" || session === null) return;
    setPage((current) => (canOpen(current, role) ? current : firstOpenable(role)));
  }, [status, session, role]);

  if (status === "loading") {
    return (
      <div className="admin-root">
        <div style={{ maxWidth: 520, margin: "80px auto", padding: "0 20px" }}>
          <div className="card">
            <div className="card__body">
              <p className="card__title" style={{ marginBottom: 6 }}>
                Checking your session
              </p>
              <p className="card__hint" style={{ margin: 0 }}>
                Asking <code>GET /admin/me</code> who is signed in.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="admin-root">
        <div style={{ maxWidth: 520, margin: "80px auto", padding: "0 20px" }}>
          <div className="card">
            <div className="card__body">
              <Notice kind="error">{error ?? "Could not reach the admin API."}</Notice>
              <p className="card__hint">
                This is a transport or server failure, not a statement about your access -
                nothing has been checked yet.
              </p>
              <button type="button" className="btn btn--primary" onClick={reload}>
                Try again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // No session: either no token exists, or `/me` answered 401. Both mean the
  // same thing to an operator - sign in again - and both land here rather than
  // on an empty shell.
  if (session === null) {
    return <SignInPage onSignedIn={reload} />;
  }

  return (
    <Shell
      page={page}
      onNavigate={(next) => {
        setPage(next);
        if (next === "licences") setSeed(undefined);
      }}
    >
      {page === "dashboard" ? (
        <DashboardPage
          onGoToLicences={(patch) => {
            setSeed(patch);
            setPage("licences");
          }}
        />
      ) : null}
      {page === "licences" ? <LicencesPage initialQuery={seed} /> : null}
      {page === "staff" ? <StaffPage /> : null}
      {page === "reports" ? <ReportsPage /> : null}
      {page === "audit" ? <AuditPage /> : null}
    </Shell>
  );
}

/** The sections this role's nav actually shows. `null` role shows none. */
function visiblePages(role: StaffRole | null): readonly PageId[] {
  return visibleNav(role).map((item) => item.id);
}

function canOpen(page: PageId, role: StaffRole | null): boolean {
  return visiblePages(role).includes(page);
}

function firstOpenable(role: StaffRole | null): PageId {
  return visibleNav(role)[0]?.id ?? "dashboard";
}

export function AdminApp() {
  return (
    <Provider>
      <Console />
    </Provider>
  );
}
