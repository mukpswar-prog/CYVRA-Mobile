import { useState } from "react";
import type { AuthUser, ReportDetail, ReportSession, ReportSummary } from "../api";
import { ReportView } from "../ReportView";
import "./workstation.css";

export type WorkstationNavTab =
  | "OVERVIEW"
  | "ADVANCED_DIAGNOSTIC"
  | "AI_PHYSICAL_INSPECTION"
  | "DATA_PURGE"
  | "RESULTS_REPORTS"
  | "LICENSE_USAGE"
  | "HELP"
  | "SETTINGS";

export interface LicenseSnapshot {
  licenseId: string;
  serialNumber: string;
  planName: string;
  scansTotal: number;
  scansUsed: number;
  scansRemaining: number;
  status: "ACTIVE" | "EXPIRED" | "REVOKED" | "SUPERSEDED" | "SERVER_UNAVAILABLE";
  version: string;
}

export function CustomerDesktopShell(props: {
  user: AuthUser;
  sessions: ReportSession[];
  reports: ReportSummary[];
  reportDetail: ReportDetail | null;
  busy: boolean;
  onFreezeSession: (processingSessionId: string) => void;
  onOpenReport: (reportId: string) => void;
  onCloseReport: () => void;
  onLogout: () => void;
}) {
  const [activeTab, setActiveTab] = useState<WorkstationNavTab>("OVERVIEW");
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);

  // Default initial license state following §2.1 & §6-7
  const license: LicenseSnapshot = {
    licenseId: "LIC-MOB-2026-00124",
    serialNumber: "CYVRA15092026SA3F1-1-25",
    planName: "25 Device Scans",
    scansTotal: 25,
    scansUsed: props.reports.length,
    scansRemaining: Math.max(0, 25 - props.reports.length),
    status: "ACTIVE",
    version: "3.2.1-g5",
  };

  return (
    <div className="cyvra-workstation-shell">
      {/* Top Header (§6, §7) */}
      <header className="workstation-top-header">
        <div className="header-brand-block">
          <img src="/brand/cyvoriq-logo.png" alt="CYVRA Mobile" className="workstation-logo" />
          <div className="brand-titles">
            <span className="brand-main">CYVRA MOBILE</span>
            <span className="brand-sub">Android Diagnostics & Data Purge</span>
          </div>
        </div>

        <div className="header-entitlement-block">
          <div className="meta-pill">
            <span className="meta-label">Customer</span>
            <span className="meta-value">{props.user.companyName || props.user.fullName || props.user.email}</span>
          </div>
          <div className="meta-pill">
            <span className="meta-label">Plan</span>
            <span className="meta-value">{license.planName}</span>
          </div>
          <div className="meta-pill">
            <span className="meta-label">Usage</span>
            <span className="meta-value">
              <strong>{license.scansUsed}</strong> / {license.scansTotal} ({license.scansRemaining} left)
            </span>
          </div>
          <div className="meta-pill status-pill">
            <span className="status-dot-active" />
            <span className="meta-value status-text">{license.status}</span>
          </div>
          <div className="meta-pill version-pill">
            <span className="meta-label">Version</span>
            <span className="meta-value">v{license.version}</span>
          </div>

          <div className="header-action-buttons">
            <button
              type="button"
              className="btn btn-header-update"
              onClick={() => setUpdateModalOpen(true)}
              title="Check for software updates"
            >
              UPDATE
            </button>
            <button
              type="button"
              className="btn btn-header-upgrade"
              onClick={() => setUpgradeModalOpen(true)}
              title="Expand scan entitlement plan"
            >
              UPGRADE
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="workstation-body">
        {/* Left Navigation (§15) */}
        <aside className="workstation-left-nav">
          <div className="nav-items-group">
            <button
              type="button"
              className={`nav-btn ${activeTab === "OVERVIEW" ? "is-active" : ""}`}
              onClick={() => setActiveTab("OVERVIEW")}
            >
              <span className="nav-icon">📊</span> OVERVIEW
            </button>
            <button
              type="button"
              className={`nav-btn ${activeTab === "ADVANCED_DIAGNOSTIC" ? "is-active" : ""}`}
              onClick={() => setActiveTab("ADVANCED_DIAGNOSTIC")}
            >
              <span className="nav-icon">🔍</span> ADVANCED DIAGNOSTIC
            </button>
            <button
              type="button"
              className={`nav-btn ${activeTab === "AI_PHYSICAL_INSPECTION" ? "is-active" : ""}`}
              onClick={() => setActiveTab("AI_PHYSICAL_INSPECTION")}
            >
              <span className="nav-icon">📷</span> AI PHYSICAL INSPECTION
            </button>
            <button
              type="button"
              className={`nav-btn ${activeTab === "DATA_PURGE" ? "is-active" : ""}`}
              onClick={() => setActiveTab("DATA_PURGE")}
            >
              <span className="nav-icon">🛡️</span> DATA PURGE
            </button>
            <button
              type="button"
              className={`nav-btn ${activeTab === "RESULTS_REPORTS" ? "is-active" : ""}`}
              onClick={() => setActiveTab("RESULTS_REPORTS")}
            >
              <span className="nav-icon">📄</span> RESULTS & REPORTS
            </button>
            <button
              type="button"
              className={`nav-btn ${activeTab === "LICENSE_USAGE" ? "is-active" : ""}`}
              onClick={() => setActiveTab("LICENSE_USAGE")}
            >
              <span className="nav-icon">🔑</span> LICENSE & USAGE
            </button>
            <button
              type="button"
              className={`nav-btn ${activeTab === "HELP" ? "is-active" : ""}`}
              onClick={() => setActiveTab("HELP")}
            >
              <span className="nav-icon">❓</span> HELP
            </button>
            <button
              type="button"
              className={`nav-btn ${activeTab === "SETTINGS" ? "is-active" : ""}`}
              onClick={() => setActiveTab("SETTINGS")}
            >
              <span className="nav-icon">⚙️</span> SETTINGS
            </button>
          </div>

          {/* Bottom Left License Usage Card (§15) */}
          <div className="nav-bottom-license-card">
            <div className="card-title">LICENSE USAGE</div>
            <div className="card-metric">{license.scansTotal} DEVICE SCANS</div>
            <div className="card-submetric">{license.scansUsed} USED</div>
            <div className="card-submetric-highlight">{license.scansRemaining} REMAINING</div>
            <div className="card-status-badge">
              <span className="status-indicator-dot" /> ● LICENSE ACTIVE
            </div>
          </div>
        </aside>

        {/* Center Main Stage Content */}
        <main className="workstation-main-stage">
          {props.reportDetail ? (
            <ReportView report={props.reportDetail} onBack={props.onCloseReport} />
          ) : (
            <>
              {activeTab === "OVERVIEW" && (
                <div className="stage-view overview-view">
                  <h2>Device Intake & Operations Overview</h2>
                  <p className="section-desc">
                    Welcome to CYVRA Mobile workstation. Connect one Android device at a time via USB.
                  </p>

                  <div className="workstation-cards-grid">
                    {/* Device Status Card */}
                    <div className="panel-card device-connection-panel">
                      <div className="panel-card-header">
                        <h3>DEVICE CONNECTION STATUS</h3>
                        <span className="badge-pill ready-badge">STANDBY / READY</span>
                      </div>
                      <div className="device-metric-rows">
                        <div className="metric-row">
                          <span className="metric-label">USB Port:</span>
                          <span className="metric-value">Connected (Ready for scan)</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">ADB Transport:</span>
                          <span className="metric-value">Active (Controlled Platform-Tools)</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Device Authorization:</span>
                          <span className="metric-value">Awaiting Handshake</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Operating Model:</span>
                          <span className="metric-value font-mono">1 Device at a time</span>
                        </div>
                      </div>
                      <div className="panel-card-footer">
                        <button
                          type="button"
                          className="btn btn-action-primary"
                          onClick={() => setActiveTab("ADVANCED_DIAGNOSTIC")}
                        >
                          Launch Advanced Diagnostic →
                        </button>
                      </div>
                    </div>

                    {/* AI Station Status Card */}
                    <div className="panel-card ai-station-panel">
                      <div className="panel-card-header">
                        <h3>AI PHYSICAL INSPECTION STATION</h3>
                        <span className="badge-pill optional-badge">OPTIONAL</span>
                      </div>
                      <p className="card-p">
                        Controlled 6-view physical inspection for screen cracks, back glass, frame wear, and cosmetic grading.
                      </p>
                      <div className="station-setup-indicator">
                        <span className="status-dot-off" /> Station Setup: Not configured (Optional)
                      </div>
                      <div className="panel-card-footer">
                        <button
                          type="button"
                          className="btn btn-action-secondary"
                          onClick={() => setActiveTab("AI_PHYSICAL_INSPECTION")}
                        >
                          Configure Inspection Station
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Recent Sessions List */}
                  <div className="panel-card recent-sessions-panel">
                    <div className="panel-card-header">
                      <h3>ACTIVE SESSIONS & READY TO FREEZE</h3>
                      <span className="metric-caption">{props.sessions.length} recorded session(s)</span>
                    </div>
                    {props.sessions.length === 0 ? (
                      <p className="muted-empty-state">
                        No processing sessions recorded. Connect an Android phone via USB and start a diagnostic scan.
                      </p>
                    ) : (
                      <div className="table-responsive">
                        <table className="workstation-table">
                          <thead>
                            <tr>
                              <th>DEVICE</th>
                              <th>SESSION ID</th>
                              <th>TIMESTAMP</th>
                              <th>STATUS</th>
                              <th>ACTION</th>
                            </tr>
                          </thead>
                          <tbody>
                            {props.sessions.map((session) => {
                              const frozen = props.reports.find(
                                (r) => r.processingSessionId === session.processingSessionId,
                              );
                              const label = [session.manufacturer, session.model].filter(Boolean).join(" ");
                              return (
                                <tr key={session.processingSessionId}>
                                  <td><strong>{label || "Android Device"}</strong></td>
                                  <td className="font-mono">{session.processingSessionId.slice(0, 18)}...</td>
                                  <td>{new Date(session.createdAt).toLocaleString()}</td>
                                  <td>
                                    {frozen ? (
                                      <span className="tag-complete">FROZEN ({frozen.publicNumber})</span>
                                    ) : (
                                      <span className="tag-ready">READY TO FREEZE</span>
                                    )}
                                  </td>
                                  <td>
                                    {frozen ? (
                                      <button
                                        type="button"
                                        className="btn btn-compact-ghost"
                                        onClick={() => props.onOpenReport(frozen.reportId)}
                                      >
                                        View Report
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        className="btn btn-compact-primary"
                                        disabled={props.busy}
                                        onClick={() => props.onFreezeSession(session.processingSessionId)}
                                      >
                                        {props.busy ? "Freezing..." : "Freeze Report 1"}
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "ADVANCED_DIAGNOSTIC" && (
                <div className="stage-view diagnostic-view">
                  <h2>Advanced Diagnostic</h2>
                  <p className="section-desc">
                    Comprehensive non-destructive technical evaluation covering Identity, Battery, Storage, and Security.
                  </p>
                  <div className="panel-card diagnostic-action-card">
                    <h3>Ready to Inspect Connected Android Device</h3>
                    <p className="card-p">
                      The diagnostic engine queries real-time device parameters via controlled ADB and optional device-side component.
                      Restricted identifiers (IMEI, MAC) are handled honestly with limitation declarations.
                    </p>
                    <div className="btn-row">
                      <button type="button" className="btn btn-action-primary" disabled={props.busy}>
                        {props.busy ? "Executing Diagnostics..." : "Start Diagnostic Scan (1 Scan)"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-action-secondary"
                        onClick={() => setActiveTab("RESULTS_REPORTS")}
                      >
                        View Existing Reports
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "AI_PHYSICAL_INSPECTION" && (
                <div className="stage-view ai-inspection-view">
                  <h2>AI Physical Inspection Station</h2>
                  <p className="section-desc">
                    Computer-vision assisted physical inspection adhering to CYVORIQ Mobile Physical Inspection Standard v1.0.
                  </p>
                  <div className="panel-card">
                    <h3>Inspection Sequence (6 Standard Views)</h3>
                    <div className="views-grid">
                      <div className="view-step-box">1. FRONT VIEW</div>
                      <div className="view-step-box">2. BACK VIEW</div>
                      <div className="view-step-box">3. LEFT SIDE</div>
                      <div className="view-step-box">4. RIGHT SIDE</div>
                      <div className="view-step-box">5. TOP</div>
                      <div className="view-step-box">6. BOTTOM</div>
                    </div>
                    <div className="quality-gate-notice">
                      <strong>Image Quality Gate:</strong> Validates focus, blur, glare, exposure, and correct orientation before AI processing.
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "DATA_PURGE" && (
                <div className="stage-view purge-view">
                  <h2>Data Purge & Sanitization</h2>
                  <p className="section-desc">
                    NIST SP 800-88 Rev. 2 compliant sanitization lifecycle. Two-step operator confirmation required.
                  </p>
                  <div className="panel-card purge-warning-card">
                    <h3>Controlled Sanitization Pipeline</h3>
                    <p className="card-p">
                      <strong>Flow:</strong> Pre-scan → Capability Assessment → Two-Step Authorization → Method Selection → Purge → Reboot → Reconnect → Verification → Certificate.
                    </p>
                    <div className="method-selection-box">
                      <label>
                        <input type="radio" name="method" defaultChecked /> Standard Platform Factory Reset (Clear)
                      </label>
                      <label>
                        <input type="radio" name="method" disabled /> OEM-Verified Cryptographic Purge (Requires hardware adapter)
                      </label>
                    </div>
                    <button type="button" className="btn btn-danger" disabled>
                      Requires Diagnostic Pre-scan First
                    </button>
                  </div>
                </div>
              )}

              {activeTab === "RESULTS_REPORTS" && (
                <div className="stage-view reports-view">
                  <h2>Results & Frozen Reports</h2>
                  <p className="section-desc">
                    Authoritative reports with cryptographic SHA-256 tamper-evident integrity hashes.
                  </p>
                  <div className="panel-card">
                    {props.reports.length === 0 ? (
                      <p className="muted-empty-state">No frozen reports generated yet.</p>
                    ) : (
                      <table className="workstation-table">
                        <thead>
                          <tr>
                            <th>REPORT ID</th>
                            <th>COVERAGE</th>
                            <th>FROZEN TIMESTAMP</th>
                            <th>ACTION</th>
                          </tr>
                        </thead>
                        <tbody>
                          {props.reports.map((report) => (
                            <tr key={report.reportId}>
                              <td className="font-mono"><strong>{report.publicNumber}</strong></td>
                              <td><span className="tag-coverage">{report.coverage}</span></td>
                              <td>{new Date(report.frozenAt).toLocaleString()}</td>
                              <td>
                                <button
                                  type="button"
                                  className="btn btn-compact-primary"
                                  onClick={() => props.onOpenReport(report.reportId)}
                                >
                                  Open Report
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "LICENSE_USAGE" && (
                <div className="stage-view license-view">
                  <h2>License & Entitlement Administration</h2>
                  <p className="section-desc">
                    Commercial license credentials and scan accounting.
                  </p>
                  <div className="panel-card">
                    <div className="device-metric-rows">
                      <div className="metric-row">
                        <span className="metric-label">Internal License ID:</span>
                        <span className="metric-value font-mono">{license.licenseId} (Immutable)</span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Public Key / Serial:</span>
                        <span className="metric-value font-mono">{license.serialNumber}</span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Assigned Plan:</span>
                        <span className="metric-value">{license.planName}</span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Scans Entitlement:</span>
                        <span className="metric-value">{license.scansTotal} Total | {license.scansUsed} Used | {license.scansRemaining} Remaining</span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Entitlement Status:</span>
                        <span className="metric-value font-bold text-ok">{license.status}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "HELP" && (
                <div className="stage-view help-view">
                  <h2>Workstation Help & Operator Guidance</h2>
                  <div className="panel-card">
                    <h3>Connecting an Android Device</h3>
                    <ol className="help-steps-list">
                      <li>Ensure a high-quality data-capable USB cable is connected directly to the PC.</li>
                      <li>Enable <strong>Developer Options</strong> on the Android phone (tap Build Number 7 times).</li>
                      <li>Enable <strong>USB Debugging</strong> in Developer Options.</li>
                      <li>When prompted on the phone, select <strong>Always allow from this computer</strong> and tap OK.</li>
                    </ol>
                  </div>
                </div>
              )}

              {activeTab === "SETTINGS" && (
                <div className="stage-view settings-view">
                  <h2>Workstation Configuration & Settings</h2>
                  <div className="panel-card">
                    <h3>Host Environment</h3>
                    <div className="device-metric-rows">
                      <div className="metric-row">
                        <span className="metric-label">Operating System:</span>
                        <span className="metric-value">Windows 10/11 x64 Architecture</span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Platform Tools:</span>
                        <span className="metric-value">Embedded Google ADB v35.0.2</span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Active Operator:</span>
                        <span className="metric-value">{props.user.email}</span>
                      </div>
                    </div>
                    <div className="panel-card-footer">
                      <button type="button" className="btn btn-compact-ghost" onClick={props.onLogout}>
                        Sign Out of Workstation
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Bottom Status Bar (§2.1, §15) */}
      <footer className="workstation-status-bar">
        <div className="status-item">
          <span className="status-bullet-ok">●</span>
          <span>USB: CONNECTED</span>
        </div>
        <div className="status-item">
          <span className="status-bullet-ok">●</span>
          <span>ADB: AUTHORIZED (Port 5037)</span>
        </div>
        <div className="status-item">
          <span className="status-bullet-ok">●</span>
          <span>API: SYNCHRONIZED</span>
        </div>
        <div className="status-item status-right">
          <span>CYVORIQ Solutions Pvt. Ltd. · CYVRA Mobile Workstation</span>
        </div>
      </footer>

      {/* UPDATE Modal Dialog (§7, §16) */}
      {updateModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-header">
              <h3>Software Update</h3>
              <button type="button" className="close-btn" onClick={() => setUpdateModalOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <p>Current version: <strong>v{license.version}</strong></p>
              <div className="update-status-box">
                <span className="status-bullet-ok">●</span> CYVRA Mobile is up to date.
              </div>
              <p className="muted small">
                Updates maintain system binaries, diagnostic collectors, and Platform-Tools. They never modify your purchased scan entitlements.
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-primary" onClick={() => setUpdateModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UPGRADE Modal Dialog (§7, §11-13) */}
      {upgradeModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-header">
              <h3>Upgrade Scan Entitlement Plan</h3>
              <button type="button" className="close-btn" onClick={() => setUpgradeModalOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <p>Current Plan: <strong>{license.planName}</strong></p>
              <p className="muted small">
                Upgrading changes your allowed device scan capacity. Existing scans and usage history are preserved in your immutable license ledger.
              </p>
              <div className="plan-options-list">
                <div className="plan-option-pill">3 Device Scans</div>
                <div className="plan-option-pill">5 Device Scans</div>
                <div className="plan-option-pill">7 Device Scans</div>
                <div className="plan-option-pill is-current">25 Device Scans (Current)</div>
              </div>
              <p className="muted small">
                To complete an upgrade, you will be directed to the official authenticated CYVORIQ checkout portal.
              </p>
            </div>
            <div className="modal-footer">
              <a
                href="https://www.cyvoriq.co.in/contact"
                target="_blank"
                rel="noreferrer"
                className="btn btn-primary"
                onClick={() => setUpgradeModalOpen(false)}
              >
                Proceed to Secure Checkout →
              </a>
              <button type="button" className="btn btn-ghost" onClick={() => setUpgradeModalOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
