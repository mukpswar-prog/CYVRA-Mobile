import { OpsTest } from "../OpsTest";

/**
 * Real ops host UI. Token is typed in the browser (sessionStorage).
 * Never put ADMIN_API_TOKEN on Pages or in Git.
 */
export function AdminApp() {
  return (
    <div className="site admin-shell">
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
        <section className="card app-card admin-card">
          <OpsTest />
        </section>
      </main>
    </div>
  );
}
