import "./App.css";
import cyvoriqLogo from "./assets/cyvoriq-solutions.png";

function App() {
  return (
    <main className="cyvra-app">
      <section className="cyvra-shell">
        <header className="cyvra-header">
          <div className="cyvra-brand-group">
            <img
              className="cyvoriq-logo"
              src={cyvoriqLogo}
              alt="CYVORIQ Solutions"
            />
            <div>
              <div className="cyvra-brand">CYVRA MOBILE</div>
              <div className="cyvra-product">Desktop Workstation</div>
            </div>
          </div>

          <div className="cyvra-status">
            <span className="status-dot" />
            READY
          </div>
        </header>

        <section className="cyvra-content">
          <p className="eyebrow">
            CYVRA Mobile Desktop Foundation
          </p>

          <div className="status-grid">
            <article className="status-card">
              <span className="card-label">Host Engine</span>
              <strong>Not connected</strong>
            </article>

            <article className="status-card">
              <span className="card-label">Device</span>
              <strong>Waiting for connection</strong>
            </article>
          </div>

          <p className="lifecycle-message">
            Evidence-led device lifecycle
          </p>
        </section>
      </section>
    </main>
  );
}

export default App;
