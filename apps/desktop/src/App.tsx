import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import cyvoriqLogo from "./assets/cyvoriq-solutions.png";

type HostInfoResult = {
  connected: boolean;
  protocolVersion: string;
  requestId: string;
  hostVersion: string;
};

function App() {
  const [host, setHost] = useState<HostInfoResult | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void invoke<HostInfoResult>("get_host_info")
      .then((result) => {
        if (!cancelled) {
          setHost(result);
          setHostError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setHost(null);
          setHostError(String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const hostConnected = host?.connected === true;

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
            {hostConnected ? "HOST CONNECTED" : "STARTING"}
          </div>
        </header>

        <section className="cyvra-content">
          <p className="eyebrow">
            CYVRA Mobile Desktop Foundation
          </p>

          <div className="status-grid">
            <article className="status-card">
              <span className="card-label">Host Engine</span>
              <strong>
                {hostConnected
                  ? `Connected · V${host?.hostVersion}`
                  : hostError
                    ? "Connection failed"
                    : "Starting Host Engine"}
              </strong>
              {hostError && (
                <small>{hostError}</small>
              )}
            </article>

            <article className="status-card">
              <span className="card-label">Device</span>
              <strong>Waiting for connection</strong>
            </article>
          </div>

          {hostConnected && (
            <p className="lifecycle-message">
              Host Protocol V{host?.protocolVersion} established
            </p>
          )}

          {!hostConnected && !hostError && (
            <p className="lifecycle-message">
              Establishing secure workstation communication
            </p>
          )}
        </section>
      </section>
    </main>
  );
}

export default App;
