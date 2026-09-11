import { useEffect } from "react";
import { OpsTest } from "../OpsTest";

/**
 * Ops host only (admin.cyvoriq.co.in). Token is typed in the browser.
 * Never put ADMIN_API_TOKEN on Pages or in Git.
 */
export function AdminApp() {
  useEffect(() => {
    document.title = "CYVRA Mobile ops | Serials";
  }, []);

  return (
    <div className="admin-shell">
      <header className="admin-bar">
        <img
          src="/brand/cyvoriq-logo.png"
          alt="CYVORIQ Solutions"
          className="site-logo"
        />
        <div>
          <strong>CYVRA Mobile ops</strong>
          <p className="muted small">
            admin.cyvoriq.co.in · serials only · not Erase admin
          </p>
        </div>
      </header>
      <main className="app-wrap">
        <section className="admin-card">
          <OpsTest />
        </section>
      </main>
    </div>
  );
}
