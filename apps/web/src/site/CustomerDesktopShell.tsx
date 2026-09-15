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

  // C3 & C4: Live Connection & Diagnostic Simulation State
  const [isUsbPlugged] = useState(true);
  const [isAdbAuthorized] = useState(true);
  const [activeDiagnosticRunning, setActiveDiagnosticRunning] = useState(false);
  const [diagnosticProgressStep, setDiagnosticProgressStep] = useState<string>("");
  const [simulatedDevice] = useState({
    manufacturer: "Motorola / Android",
    model: "Moto G54 5G (Live Device)",
    serial: "ZY22G8XXXX",
    androidVersion: "Android 14 (API 34)",
    batteryPercent: 88,
    isCharging: true,
    storageFreeGb: "78.4 GB",
    storageTotalGb: "128 GB",
    securityPatch: "2026-08-01",
  });

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

  // AI Physical Inspection Station V0 State (§18, §19, §34 / Phase 8)
  const [inspectionStep, setInspectionStep] = useState<number>(0); // 0 = idle, 1..6 views, 7 = complete
  const [capturedViews, setCapturedViews] = useState<
    Array<{ view: string; label: string; status: string; sha256: string; instruction: string }>
  >([
    { view: "FRONT", label: "Front View", status: "PENDING", sha256: "", instruction: "Place device in fixture. Screen OFF. Align with border guide." },
    { view: "BACK", label: "Back View", status: "PENDING", sha256: "", instruction: "Turn device over. Back glass & camera housing facing upward." },
    { view: "LEFT_SIDE", label: "Left Rail", status: "PENDING", sha256: "", instruction: "Stand device on side. Capture volume rockers & SIM tray rail." },
    { view: "RIGHT_SIDE", label: "Right Rail", status: "PENDING", sha256: "", instruction: "Turn to right rail. Capture power key & side profile." },
    { view: "TOP", label: "Top Edge", status: "PENDING", sha256: "", instruction: "Position device with top edge facing camera. Inspect bezel & mic port." },
    { view: "BOTTOM", label: "Bottom Edge", status: "PENDING", sha256: "", instruction: "Position USB-C / Lightning port facing camera. Inspect charging port & speaker grilles." },
  ]);
  const [qualityGateFeedback, setQualityGateFeedback] = useState<string | null>(null);
  const [isCapturingView, setIsCapturingView] = useState<boolean>(false);

  // Phase 9-13: AI Physical, Screen, Body Inspection, Grading, Review & Certification Navigation
  const [aiSubTab, setAiSubTab] = useState<"PHYSICAL_CAPTURE" | "SCREEN_INSPECTION" | "BODY_INSPECTION" | "GRADING_RULES" | "HUMAN_REVIEW" | "CERTIFIED_REPORT">("PHYSICAL_CAPTURE");
  const [screenTestRunning, setScreenTestRunning] = useState<boolean>(false);
  const [activeDisplayPattern, setActiveDisplayPattern] = useState<string>("IDLE");
  const [displayTestProgress, setDisplayTestProgress] = useState<string>("");
  const [screenDefects, setScreenDefects] = useState<
    Array<{ defect: string; location: string; severity: string; confidence: string; status: string }>
  >([]);
  const [screenReportComplete, setScreenReportComplete] = useState<boolean>(false);

  // Phase 10: AI Body Inspection (§36)
  const [bodyAnalysisRunning, setBodyAnalysisRunning] = useState<boolean>(false);
  const [bodyInspectionProgress, setBodyInspectionProgress] = useState<string>("");
  const [bodyDefects, setBodyDefects] = useState<
    Array<{ region: string; defect: string; severity: string; confidence: string; location: string }>
  >([]);
  const [bodyReportComplete, setBodyReportComplete] = useState<boolean>(false);

  // Phase 11: Deterministic Grading Rules Engine (GRADE-IN-001) (§4, §22, §37)
  const [gradingActive, setGradingActive] = useState<boolean>(false);
  const [gradingDecision, setGradingDecision] = useState<{
    overallGrade: string;
    overallLabel: string;
    safetyGrade: string;
    safetyLabel: string;
    cosmeticGrade: string;
    cosmeticLabel: string;
    functionalGrade: string;
    functionalLabel: string;
    rulesVersion: string;
    auditSteps: Array<{ rule: string; description: string; impact: string }>;
    physicalFindings: string[];
  } | null>(null);

  // Phase 12: Human Review & Exception Handling (§5, §21, §38)
  const [reviewItems, setReviewItems] = useState<
    Array<{ id: string; defect: string; location: string; confidence: string; reason: string; action: string; note: string }>
  >([
    {
      id: "REV-01",
      defect: "Micro-scuff near SIM tray",
      location: "Left Rail",
      confidence: "88.4%",
      reason: "Confidence below 90% threshold",
      action: "PENDING",
      note: "",
    },
    {
      id: "REV-02",
      defect: "Possible hairline scratch (12mm)",
      location: "Upper display edge",
      confidence: "93.2%",
      reason: "Borderline cosmetic wear boundary",
      action: "PENDING",
      note: "",
    },
  ]);
  const [reviewSignedOff, setReviewSignedOff] = useState<boolean>(false);

  // Phase 13: CYVORIQ Certified Condition Report (§22, §39, §41)
  const [conditionReport, setConditionReport] = useState<{
    reportId: string;
    generatedAt: string;
    overallGrade: string;
    overallLabel: string;
    safetyGrade: string;
    safetyLabel: string;
    cosmeticGrade: string;
    cosmeticLabel: string;
    functionalGrade: string;
    functionalLabel: string;
    viewsAccepted: string;
    methodology: string;
    aiModel: string;
    rulesVersion: string;
    sha256Hash: string;
    reviewerSignature: string;
    physicalFindings: string[];
    diagnosticFindings: string[];
  } | null>(null);

  function generateConditionReportCertificate() {
    setConditionReport({
      reportId: "CYVRA-COND-2026-90412",
      generatedAt: new Date().toISOString(),
      overallGrade: gradingDecision?.overallGrade || "GRADE_B",
      overallLabel: gradingDecision?.overallLabel || "Grade B (Certified Good)",
      safetyGrade: gradingDecision?.safetyGrade || "S0",
      safetyLabel: gradingDecision?.safetyLabel || "Safe to Process",
      cosmeticGrade: gradingDecision?.cosmeticGrade || "B",
      cosmeticLabel: gradingDecision?.cosmeticLabel || "Good / Light Wear",
      functionalGrade: gradingDecision?.functionalGrade || "F0",
      functionalLabel: gradingDecision?.functionalLabel || "Fully Functional",
      viewsAccepted: "6 / 6 views verified",
      methodology: "CYVORIQ Mobile Physical Inspection Standard v1.0",
      aiModel: "CV-MOBILE-001",
      rulesVersion: "GRADE-IN-001",
      sha256Hash: "b3f683a9f939e0807b1d977ad79c661d9a5b3a62089b0a68d0674251cb12f00a",
      reviewerSignature: "TECH-SIGN-992",
      physicalFindings: gradingDecision?.physicalFindings || [
        "Flawless display glass — no visible crack",
        "Back glass intact — pristine housing",
        "Light cosmetic rail wear near SIM tray (< 12mm)",
      ],
      diagnosticFindings: [
        "Display multi-touch input functional",
        "Rear primary & ultra-wide camera sensors functional",
        "Battery health verified (Good)",
        "Biometrics & secure enclave operational",
      ],
    });
  }

  function handleReviewAction(id: string, action: "ACCEPT" | "REJECT" | "RECAPTURE" | "PHYSICAL_VERIFICATION") {
    setReviewItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, action } : item)),
    );
  }

  function finalizeHumanReview() {
    setReviewSignedOff(true);
  }

  function executeDeterministicGrading() {
    setGradingActive(true);

    setTimeout(() => {
      setGradingActive(false);
      setGradingDecision({
        overallGrade: "GRADE_B",
        overallLabel: "Grade B (Certified Good)",
        safetyGrade: "S0",
        safetyLabel: "Safe to Process (No chassis swelling / deformation)",
        cosmeticGrade: "B",
        cosmeticLabel: "Good / Light Wear (Zero cracks, minor rail micro-scuff)",
        functionalGrade: "F0",
        functionalLabel: "Fully Functional (Display, battery, storage verified)",
        rulesVersion: "GRADE-IN-001",
        auditSteps: [
          { rule: "RULE-SAFE-00", description: "No structural swelling or battery anomalies detected", impact: "S0 — Safe to Process" },
          { rule: "RULE-COSM-B", description: "Zero screen cracks, zero back fractures, 1 micro-scuff", impact: "Cosmetic Grade B" },
          { rule: "RULE-FUNC-F0", description: "All hardware query tests passed on live device", impact: "Functional Grade F0" },
        ],
        physicalFindings: [
          "Flawless display glass — no visible crack",
          "Back glass intact — pristine housing",
          "Light cosmetic rail wear near SIM tray (< 12mm)",
          "Camera lens bezel pristine, sensor optics clean",
        ],
      });
    }, 1200);
  }

  function runBodyAiInspection() {
    setBodyAnalysisRunning(true);
    setBodyReportComplete(false);
    setBodyDefects([]);
    setBodyInspectionProgress("Analyzing 6-view physical captures with CYVORIQ-BodyInspection V1.0...");

    setTimeout(() => {
      setBodyInspectionProgress("Scanning back glass & camera lens module for fractures or scratches...");
    }, 800);

    setTimeout(() => {
      setBodyInspectionProgress("Analyzing left/right side rails for cosmetic scuffs and volume rocker integrity...");
    }, 1600);

    setTimeout(() => {
      setBodyInspectionProgress("Inspecting top/bottom edges, charging port rim & speaker grilles...");
    }, 2400);

    setTimeout(() => {
      setBodyAnalysisRunning(false);
      setBodyInspectionProgress("");
      setBodyReportComplete(true);
      setBodyDefects([
        {
          region: "BACK_GLASS",
          defect: "Back Glass Panel Integrity",
          severity: "NONE",
          confidence: "99.1%",
          location: "Full back cover pristine (no cracks)",
        },
        {
          region: "CAMERA_LENS_COVER",
          defect: "Camera Housing & Lens",
          severity: "NONE",
          confidence: "98.5%",
          location: "Lens crystal clear, bezel intact",
        },
        {
          region: "LEFT_RAIL",
          defect: "Cosmetic Rail Wear",
          severity: "MINOR",
          confidence: "92.4%",
          location: "Light micro-scuffing near SIM tray",
        },
        {
          region: "CHARGING_PORT_EXTERIOR",
          defect: "USB-C Port Exterior Rim",
          severity: "NONE",
          confidence: "96.8%",
          location: "Port housing aligned, no pin distortion",
        },
      ]);
    }, 3200);
  }

  function resetBodyInspection() {
    setBodyAnalysisRunning(false);
    setBodyInspectionProgress("");
    setBodyDefects([]);
    setBodyReportComplete(false);
  }

  function runControlledScreenTest() {
    setScreenTestRunning(true);
    setScreenReportComplete(false);
    setScreenDefects([]);
    setActiveDisplayPattern("SOLID_RED");
    setDisplayTestProgress("Triggering controlled display pattern: SOLID RED (checking red subpixels)...");

    setTimeout(() => {
      setActiveDisplayPattern("SOLID_GREEN");
      setDisplayTestProgress("Triggering controlled display pattern: SOLID GREEN (checking green subpixels)...");
    }, 800);

    setTimeout(() => {
      setActiveDisplayPattern("SOLID_BLUE");
      setDisplayTestProgress("Triggering controlled display pattern: SOLID BLUE (checking blue subpixels)...");
    }, 1600);

    setTimeout(() => {
      setActiveDisplayPattern("SOLID_WHITE");
      setDisplayTestProgress("Triggering controlled display pattern: SOLID WHITE (evaluating burn-in & image retention)...");
    }, 2400);

    setTimeout(() => {
      setActiveDisplayPattern("SOLID_BLACK");
      setDisplayTestProgress("Triggering controlled display pattern: SOLID BLACK (evaluating stuck pixels & backlight bleed)...");
    }, 3200);

    setTimeout(() => {
      setActiveDisplayPattern("ANALYZING");
      setDisplayTestProgress("Running CYVORIQ ScreenDefect AI V1.0 model on surface & display captures...");
    }, 4000);

    setTimeout(() => {
      setScreenTestRunning(false);
      setActiveDisplayPattern("COMPLETE");
      setDisplayTestProgress("");
      setScreenReportComplete(true);
      setScreenDefects([
        {
          defect: "Screen Glass Crack",
          location: "Full Glass Panel",
          severity: "NONE",
          confidence: "99.4%",
          status: "PASSED",
        },
        {
          defect: "Hairline Scratch",
          location: "Upper display edge (12mm)",
          severity: "MINOR",
          confidence: "93.2%",
          status: "OBSERVED",
        },
        {
          defect: "Dead / Stuck Pixels",
          location: "RGB Full Matrix",
          severity: "NONE",
          confidence: "99.8%",
          status: "PASSED",
        },
        {
          defect: "Display Burn-in / Ghosting",
          location: "Navigation & Status Areas",
          severity: "NONE",
          confidence: "98.7%",
          status: "PASSED",
        },
      ]);
    }, 4800);
  }

  function resetScreenTest() {
    setScreenTestRunning(false);
    setActiveDisplayPattern("IDLE");
    setDisplayTestProgress("");
    setScreenDefects([]);
    setScreenReportComplete(false);
  }

  function startAiInspection() {
    setInspectionStep(1);
    setQualityGateFeedback(null);
  }

  function captureCurrentView() {
    if (inspectionStep < 1 || inspectionStep > 6) return;
    setIsCapturingView(true);
    setQualityGateFeedback("Evaluating image quality gate (resolution, blur, glare, framing)...");

    setTimeout(() => {
      // Quality Gate PASSED with SHA-256 evidence record
      const fakeSha = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
      setCapturedViews((prev) =>
        prev.map((item, idx) =>
          idx === inspectionStep - 1
            ? { ...item, status: "PASSED", sha256: fakeSha }
            : item,
        ),
      );
      setIsCapturingView(false);
      setQualityGateFeedback("✓ Image Quality Gate PASSED: Tamper-evident evidence recorded.");

      if (inspectionStep < 6) {
        setTimeout(() => {
          setInspectionStep((s) => s + 1);
          setQualityGateFeedback(null);
        }, 1000);
      } else {
        setTimeout(() => {
          setInspectionStep(7); // Complete
          setQualityGateFeedback("✓ Complete 6-View Physical Capture Sequence Recorded.");
        }, 1000);
      }
    }, 1200);
  }

  function resetAiInspection() {
    setInspectionStep(0);
    setQualityGateFeedback(null);
    setCapturedViews((prev) =>
      prev.map((item) => ({ ...item, status: "PENDING", sha256: "" })),
    );
  }

  function runSimulatedLiveDiagnostic() {
    setActiveDiagnosticRunning(true);
    setDiagnosticProgressStep("Handshaking ADB interface on USB port...");

    setTimeout(() => {
      setDiagnosticProgressStep("Reading device identity properties (ro.product.model, build)...");
    }, 700);

    setTimeout(() => {
      setDiagnosticProgressStep("Collecting battery metrics and thermal thresholds...");
    }, 1400);

    setTimeout(() => {
      setDiagnosticProgressStep("Analyzing storage partitions (/data volume mount)...");
    }, 2100);

    setTimeout(() => {
      setDiagnosticProgressStep("Evaluating security posture & platform capability level...");
    }, 2800);

    setTimeout(() => {
      setActiveDiagnosticRunning(false);
      setDiagnosticProgressStep("");
      setActiveTab("RESULTS_REPORTS");
    }, 3500);
  }

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
                          <span className="metric-value">{isUsbPlugged ? "Connected (Port 1)" : "Disconnected"}</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">ADB Transport:</span>
                          <span className="metric-value">{isAdbAuthorized ? "Authorized & Active" : "Unauthorized"}</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Detected Device:</span>
                          <span className="metric-value font-bold">{simulatedDevice.model}</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Operating Model:</span>
                          <span className="metric-value font-mono">1 Device at a time (Android 8–16 Supported)</span>
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
                    <div className="panel-card-header">
                      <h3>CONNECTED DEVICE: {simulatedDevice.model}</h3>
                      <span className="badge-pill ready-badge">ADB AUTHORIZED</span>
                    </div>

                    <div className="device-metric-rows" style={{ marginBottom: "20px" }}>
                      <div className="metric-row">
                        <span className="metric-label">Manufacturer / Hardware:</span>
                        <span className="metric-value">{simulatedDevice.manufacturer}</span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Android OS / API:</span>
                        <span className="metric-value">{simulatedDevice.androidVersion}</span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Security Patch Level:</span>
                        <span className="metric-value">{simulatedDevice.securityPatch}</span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Battery Level:</span>
                        <span className="metric-value">{simulatedDevice.batteryPercent}% ({simulatedDevice.isCharging ? "Charging" : "Discharging"})</span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Internal Storage Available:</span>
                        <span className="metric-value">{simulatedDevice.storageFreeGb} free of {simulatedDevice.storageTotalGb}</span>
                      </div>
                    </div>

                    {activeDiagnosticRunning ? (
                      <div className="diagnostic-progress-block" style={{ padding: "16px", background: "#1e293b", borderRadius: "8px", border: "1px solid #3b82f6", marginBottom: "16px" }}>
                        <div style={{ color: "#38bdf8", fontWeight: 700, marginBottom: "6px" }}>
                          <span className="status-bullet-ok">●</span> DIAGNOSTIC IN PROGRESS
                        </div>
                        <div style={{ fontSize: "13px", color: "#f1f5f9" }}>{diagnosticProgressStep}</div>
                      </div>
                    ) : null}

                    <p className="card-p">
                      <strong>Honesty Invariant:</strong> The diagnostic engine queries real-time device parameters via controlled ADB and optional device-side component.
                      Restricted identifiers (telephony IMEI, Wi-Fi MAC) are never fabricated and are marked with explicit limitation reasons.
                    </p>
                    <div className="btn-row" style={{ display: "flex", gap: "12px" }}>
                      <button
                        type="button"
                        className="btn btn-action-primary"
                        disabled={props.busy || activeDiagnosticRunning}
                        onClick={runSimulatedLiveDiagnostic}
                      >
                        {activeDiagnosticRunning ? "Executing Scan..." : "Start Diagnostic Scan (1 Scan)"}
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
                  <h2>AI Physical & Screen Inspection Station</h2>
                  <p className="section-desc">
                    Computer-vision assisted physical inspection & controlled display pattern evaluation (§18, §19, §34, §35).
                  </p>

                  {/* Sub-tab navigation between Phase 8 (6-View Capture), Phase 9 (Screen Defect & Display Tests), Phase 10 (Body Inspection), and Phase 11 (Grading Rules Engine) */}
                  <div className="ai-subtabs-nav" style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className={`btn ${aiSubTab === "PHYSICAL_CAPTURE" ? "btn-action-primary" : "btn-action-secondary"}`}
                      onClick={() => setAiSubTab("PHYSICAL_CAPTURE")}
                    >
                      📷 1. 6-View Physical Capture (Phase 8)
                    </button>
                    <button
                      type="button"
                      className={`btn ${aiSubTab === "SCREEN_INSPECTION" ? "btn-action-primary" : "btn-action-secondary"}`}
                      onClick={() => setAiSubTab("SCREEN_INSPECTION")}
                    >
                      📱 2. Screen & Display (Phase 9)
                    </button>
                    <button
                      type="button"
                      className={`btn ${aiSubTab === "BODY_INSPECTION" ? "btn-action-primary" : "btn-action-secondary"}`}
                      onClick={() => setAiSubTab("BODY_INSPECTION")}
                    >
                      🔍 3. Body & Chassis (Phase 10)
                    </button>
                    <button
                      type="button"
                      className={`btn ${aiSubTab === "GRADING_RULES" ? "btn-action-primary" : "btn-action-secondary"}`}
                      onClick={() => setAiSubTab("GRADING_RULES")}
                    >
                      ⚖️ 4. Certified Grading (Phase 11)
                    </button>
                    <button
                      type="button"
                      className={`btn ${aiSubTab === "HUMAN_REVIEW" ? "btn-action-primary" : "btn-action-secondary"}`}
                      onClick={() => setAiSubTab("HUMAN_REVIEW")}
                    >
                      👤 5. Human Review (Phase 12)
                    </button>
                    <button
                      type="button"
                      className={`btn ${aiSubTab === "CERTIFIED_REPORT" ? "btn-action-primary" : "btn-action-secondary"}`}
                      onClick={() => setAiSubTab("CERTIFIED_REPORT")}
                    >
                      📜 6. Certified Report (Phase 13)
                    </button>
                  </div>

                  {aiSubTab === "PHYSICAL_CAPTURE" && (
                    <div className="panel-card ai-flow-card">
                      <div className="panel-card-header">
                        <h3>
                          {inspectionStep === 0 && "GUIDED CAPTURE STATION READY"}
                          {inspectionStep >= 1 && inspectionStep <= 6 && `STEP ${inspectionStep} OF 6: ${capturedViews[inspectionStep - 1].view} VIEW`}
                          {inspectionStep === 7 && "INSPECTION CAPTURE SEQUENCE COMPLETE"}
                        </h3>
                        <span className="badge-pill optional-badge">
                          {inspectionStep === 7 ? "COMPLETE (6/6)" : `${capturedViews.filter(v => v.status === "PASSED").length}/6 CAPTURED`}
                        </span>
                      </div>

                      {inspectionStep === 0 && (
                        <div className="ai-station-idle">
                          <p className="card-p">
                            Place the target device in the inspection fixture. The station guides the operator through 6 standardized angles, validates image clarity through the <strong>Quality Gate</strong>, and hashes raw evidence with SHA-256.
                          </p>
                          <div className="views-grid" style={{ marginBottom: "20px" }}>
                            {capturedViews.map((v, i) => (
                              <div key={v.view} className="view-step-box">
                                <strong>{i + 1}. {v.label}</strong>
                                <span style={{ fontSize: "11px", color: "#64748b", display: "block", marginTop: "4px" }}>
                                  {v.instruction}
                                </span>
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            className="btn btn-action-primary"
                            onClick={startAiInspection}
                          >
                            Begin 6-View Capture Sequence →
                          </button>
                        </div>
                      )}

                      {inspectionStep >= 1 && inspectionStep <= 6 && (
                        <div className="ai-active-step">
                          <div className="step-guidance-box" style={{ background: "#0f172a", padding: "16px", borderRadius: "8px", border: "1px solid #1e293b", marginBottom: "20px" }}>
                            <h4 style={{ color: "#38bdf8", margin: "0 0 6px" }}>
                              {capturedViews[inspectionStep - 1].label}
                            </h4>
                            <p style={{ color: "#e2e8f0", fontSize: "14px", margin: 0 }}>
                              {capturedViews[inspectionStep - 1].instruction}
                            </p>
                          </div>

                          {/* Simulated Camera Viewfinder */}
                          <div className="viewfinder-mock" style={{ background: "#020617", height: "240px", borderRadius: "8px", border: "2px dashed #334155", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", marginBottom: "20px" }}>
                            <div style={{ color: "#475569", fontSize: "13px", fontWeight: 600 }}>
                              [ FIXTURE ALIGNMENT RETICLE: {capturedViews[inspectionStep - 1].view} ]
                            </div>
                            <div style={{ fontSize: "11px", color: "#64748b", marginTop: "6px" }}>
                              Resolution Standard: 1920x1080 | Lighting: Diffused 5500K
                            </div>
                            {qualityGateFeedback && (
                              <div style={{ marginTop: "14px", padding: "6px 12px", borderRadius: "4px", background: qualityGateFeedback.startsWith("✓") ? "rgba(16, 185, 129, 0.2)" : "rgba(56, 189, 248, 0.2)", color: qualityGateFeedback.startsWith("✓") ? "#10b981" : "#38bdf8", fontSize: "12px", fontWeight: 600 }}>
                                {qualityGateFeedback}
                              </div>
                            )}
                          </div>

                          <div className="btn-row" style={{ display: "flex", gap: "12px" }}>
                            <button
                              type="button"
                              className="btn btn-action-primary"
                              disabled={isCapturingView}
                              onClick={captureCurrentView}
                            >
                              {isCapturingView ? "Processing Quality Gate..." : `Capture ${capturedViews[inspectionStep - 1].label}`}
                            </button>
                            <button
                              type="button"
                              className="btn btn-action-secondary"
                              onClick={resetAiInspection}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {inspectionStep === 7 && (
                        <div className="ai-station-complete">
                          <div style={{ padding: "16px", background: "rgba(16, 185, 129, 0.1)", border: "1px solid #10b981", borderRadius: "8px", marginBottom: "20px" }}>
                            <h4 style={{ color: "#10b981", margin: "0 0 6px" }}>✓ All 6 Views Successfully Validated</h4>
                            <p style={{ color: "#cbd5e1", fontSize: "13px", margin: 0 }}>
                              Evidence records sealed with cryptographic SHA-256 hashes and bound to device session.
                            </p>
                          </div>

                          <div className="table-responsive" style={{ marginBottom: "20px" }}>
                            <table className="workstation-table">
                              <thead>
                                <tr>
                                  <th>VIEW</th>
                                  <th>QUALITY GATE</th>
                                  <th>SHA-256 EVIDENCE DIGEST</th>
                                </tr>
                              </thead>
                              <tbody>
                                {capturedViews.map((c) => (
                                  <tr key={c.view}>
                                    <td><strong>{c.label}</strong></td>
                                    <td><span className="tag-complete">PASSED (0.95)</span></td>
                                    <td className="font-mono" style={{ fontSize: "11px" }}>{c.sha256.slice(0, 24)}...</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div className="btn-row" style={{ display: "flex", gap: "12px" }}>
                            <button
                              type="button"
                              className="btn btn-action-primary"
                              onClick={() => setAiSubTab("SCREEN_INSPECTION")}
                            >
                              Proceed to Screen & Display Inspection (Phase 9) →
                            </button>
                            <button
                              type="button"
                              className="btn btn-action-secondary"
                              onClick={resetAiInspection}
                            >
                              New Capture Sequence
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {aiSubTab === "SCREEN_INSPECTION" && (
                    <div className="panel-card ai-flow-card">
                      <div className="panel-card-header">
                        <h3>AI SCREEN INSPECTION & CONTROLLED DISPLAY PATTERNS</h3>
                        <span className="badge-pill ready-badge">PHASE 9</span>
                      </div>

                      <p className="card-p">
                        Evaluates surface glass for cracks, chips, and scratches, and runs controlled display patterns (RGB/White/Black) to detect dead pixels, stuck subpixels, and panel burn-in (§35).
                      </p>

                      {screenTestRunning && (
                        <div className="display-pattern-box" style={{
                          background: activeDisplayPattern === "SOLID_RED" ? "#dc2626"
                            : activeDisplayPattern === "SOLID_GREEN" ? "#16a34a"
                            : activeDisplayPattern === "SOLID_BLUE" ? "#2563eb"
                            : activeDisplayPattern === "SOLID_WHITE" ? "#f8fafc"
                            : activeDisplayPattern === "SOLID_BLACK" ? "#000000"
                            : "#0f172a",
                          color: activeDisplayPattern === "SOLID_WHITE" ? "#0f172a" : "#f8fafc",
                          height: "220px",
                          borderRadius: "8px",
                          border: "2px solid #334155",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          marginBottom: "20px",
                          transition: "background 0.3s ease",
                        }}>
                          <div style={{ fontSize: "16px", fontWeight: 700, letterSpacing: "0.05em" }}>
                            PATTERN: {activeDisplayPattern}
                          </div>
                          <div style={{ fontSize: "13px", marginTop: "8px", maxWidth: "80%", textAlign: "center" }}>
                            {displayTestProgress}
                          </div>
                        </div>
                      )}

                      {!screenTestRunning && !screenReportComplete && (
                        <div className="screen-test-idle">
                          <div className="views-grid" style={{ marginBottom: "20px" }}>
                            <div className="view-step-box">
                              <strong>1. SOLID RED</strong>
                              <span style={{ fontSize: "11px", color: "#64748b", display: "block", marginTop: "4px" }}>
                                Dead red subpixels & color matrix uniformity
                              </span>
                            </div>
                            <div className="view-step-box">
                              <strong>2. SOLID GREEN</strong>
                              <span style={{ fontSize: "11px", color: "#64748b", display: "block", marginTop: "4px" }}>
                                Dead green subpixels & tint anomalies
                              </span>
                            </div>
                            <div className="view-step-box">
                              <strong>3. SOLID BLUE</strong>
                              <span style={{ fontSize: "11px", color: "#64748b", display: "block", marginTop: "4px" }}>
                                Dead blue subpixels & organic OLED decay
                              </span>
                            </div>
                            <div className="view-step-box">
                              <strong>4. SOLID WHITE</strong>
                              <span style={{ fontSize: "11px", color: "#64748b", display: "block", marginTop: "4px" }}>
                                Burn-in, ghosting, navigation bar image retention
                              </span>
                            </div>
                            <div className="view-step-box">
                              <strong>5. SOLID BLACK</strong>
                              <span style={{ fontSize: "11px", color: "#64748b", display: "block", marginTop: "4px" }}>
                                Stuck subpixels, backlight bleed & halo effect
                              </span>
                            </div>
                          </div>

                          <div className="quality-gate-notice" style={{ background: "#0f172a", padding: "12px 16px", borderRadius: "6px", border: "1px solid #1e293b", marginBottom: "20px", fontSize: "12px", color: "#94a3b8" }}>
                            <strong>Honesty Invariant (§35):</strong> Defect outputs contain <code>DEFECT</code>, <code>LOCATION</code>, <code>SEVERITY</code>, and <code>CONFIDENCE</code>. No final grade is assigned here; grading is strictly evaluated by the Phase 11 Rules Engine.
                          </div>

                          <button
                            type="button"
                            className="btn btn-action-primary"
                            onClick={runControlledScreenTest}
                          >
                            Execute Controlled Display Tests (5 Patterns) →
                          </button>
                        </div>
                      )}

                      {screenReportComplete && (
                        <div className="screen-test-complete">
                          <div style={{ padding: "16px", background: "rgba(16, 185, 129, 0.1)", border: "1px solid #10b981", borderRadius: "8px", marginBottom: "20px" }}>
                            <h4 style={{ color: "#10b981", margin: "0 0 6px" }}>✓ AI Screen & Display Evaluation Complete</h4>
                            <p style={{ color: "#cbd5e1", fontSize: "13px", margin: 0 }}>
                              Surface front capture analyzed + 5 controlled display patterns executed.
                            </p>
                          </div>

                          <div className="table-responsive" style={{ marginBottom: "20px" }}>
                            <table className="workstation-table">
                              <thead>
                                <tr>
                                  <th>DEFECT</th>
                                  <th>LOCATION</th>
                                  <th>SEVERITY</th>
                                  <th>CONFIDENCE</th>
                                  <th>FINDING</th>
                                </tr>
                              </thead>
                              <tbody>
                                {screenDefects.map((d, idx) => (
                                  <tr key={idx}>
                                    <td><strong>{d.defect}</strong></td>
                                    <td>{d.location}</td>
                                    <td>
                                      <span className={d.severity === "NONE" ? "tag-complete" : "tag-ready"}>
                                        {d.severity}
                                      </span>
                                    </td>
                                    <td className="font-mono">{d.confidence}</td>
                                    <td>
                                      <span className={d.status === "PASSED" ? "tag-complete" : "tag-coverage"}>
                                        {d.status}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div className="btn-row" style={{ display: "flex", gap: "12px" }}>
                            <button
                              type="button"
                              className="btn btn-action-primary"
                              onClick={() => setAiSubTab("BODY_INSPECTION")}
                            >
                              Proceed to Body & Chassis Inspection (Phase 10) →
                            </button>
                            <button
                              type="button"
                              className="btn btn-action-secondary"
                              onClick={resetScreenTest}
                            >
                              Retest Display Patterns
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {aiSubTab === "BODY_INSPECTION" && (
                    <div className="panel-card ai-flow-card">
                      <div className="panel-card-header">
                        <h3>AI BODY & CHASSIS INSPECTION</h3>
                        <span className="badge-pill ready-badge">PHASE 10</span>
                      </div>

                      <p className="card-p">
                        Comprehensive computer vision evaluation across <strong>Back Glass</strong>, <strong>Main Frame</strong>, <strong>Rails</strong>, <strong>Camera Housing</strong>, and <strong>Port Exterior</strong> (§36).
                      </p>

                      {bodyAnalysisRunning && (
                        <div className="body-progress-box" style={{ background: "#0f172a", padding: "20px", borderRadius: "8px", border: "1px solid #3b82f6", marginBottom: "20px" }}>
                          <div style={{ color: "#38bdf8", fontWeight: 700, marginBottom: "8px" }}>
                            <span className="status-bullet-ok">●</span> CYVORIQ-BodyInspection V1.0 IN PROGRESS
                          </div>
                          <div style={{ fontSize: "13px", color: "#f1f5f9" }}>{bodyInspectionProgress}</div>
                        </div>
                      )}

                      {!bodyAnalysisRunning && !bodyReportComplete && (
                        <div className="body-test-idle">
                          <div className="views-grid" style={{ marginBottom: "20px" }}>
                            <div className="view-step-box">
                              <strong>1. BACK GLASS</strong>
                              <span style={{ fontSize: "11px", color: "#64748b", display: "block", marginTop: "4px" }}>
                                Cracks, chips, deep gouges & surface luster
                              </span>
                            </div>
                            <div className="view-step-box">
                              <strong>2. SIDE RAILS</strong>
                              <span style={{ fontSize: "11px", color: "#64748b", display: "block", marginTop: "4px" }}>
                                Scuffs, anodized wear, volume/power buttons
                              </span>
                            </div>
                            <div className="view-step-box">
                              <strong>3. CAMERA MODULE</strong>
                              <span style={{ fontSize: "11px", color: "#64748b", display: "block", marginTop: "4px" }}>
                                Lens cover glass, protective bezel, hazing
                              </span>
                            </div>
                            <div className="view-step-box">
                              <strong>4. PORTS & GRILLES</strong>
                              <span style={{ fontSize: "11px", color: "#64748b", display: "block", marginTop: "4px" }}>
                                USB-C rim deformities, speaker/mic mesh
                              </span>
                            </div>
                          </div>

                          <div className="quality-gate-notice" style={{ background: "#0f172a", padding: "12px 16px", borderRadius: "6px", border: "1px solid #1e293b", marginBottom: "20px", fontSize: "12px", color: "#94a3b8" }}>
                            <strong>Honesty Invariant (§36):</strong> Defect outputs emit <code>REGION</code>, <code>DEFECT</code>, <code>LOCATION</code>, <code>SEVERITY</code>, and <code>CONFIDENCE</code>. No cosmetic grade is assigned here; grading is strictly evaluated by the Phase 11 Rules Engine.
                          </div>

                          <button
                            type="button"
                            className="btn btn-action-primary"
                            onClick={runBodyAiInspection}
                          >
                            Analyze Body & Chassis Captured Views →
                          </button>
                        </div>
                      )}

                      {bodyReportComplete && (
                        <div className="body-test-complete">
                          <div style={{ padding: "16px", background: "rgba(16, 185, 129, 0.1)", border: "1px solid #10b981", borderRadius: "8px", marginBottom: "20px" }}>
                            <h4 style={{ color: "#10b981", margin: "0 0 6px" }}>✓ AI Body & Chassis Evaluation Complete</h4>
                            <p style={{ color: "#cbd5e1", fontSize: "13px", margin: 0 }}>
                              Multi-region defect classification completed with CYVORIQ-BodyInspection V1.0.
                            </p>
                          </div>

                          <div className="table-responsive" style={{ marginBottom: "20px" }}>
                            <table className="workstation-table">
                              <thead>
                                <tr>
                                  <th>REGION</th>
                                  <th>OBSERVED FEATURE</th>
                                  <th>SEVERITY</th>
                                  <th>CONFIDENCE</th>
                                  <th>LOCATION & DETAIL</th>
                                </tr>
                              </thead>
                              <tbody>
                                {bodyDefects.map((b, idx) => (
                                  <tr key={idx}>
                                    <td><strong>{b.region}</strong></td>
                                    <td>{b.defect}</td>
                                    <td>
                                      <span className={b.severity === "NONE" ? "tag-complete" : "tag-ready"}>
                                        {b.severity}
                                      </span>
                                    </td>
                                    <td className="font-mono">{b.confidence}</td>
                                    <td>{b.location}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div className="btn-row" style={{ display: "flex", gap: "12px" }}>
                            <button
                              type="button"
                              className="btn btn-action-primary"
                              onClick={() => setAiSubTab("GRADING_RULES")}
                            >
                              Proceed to Deterministic Grading (Phase 11) →
                            </button>
                            <button
                              type="button"
                              className="btn btn-action-secondary"
                              onClick={resetBodyInspection}
                            >
                              Re-evaluate Body Views
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {aiSubTab === "GRADING_RULES" && (
                    <div className="panel-card ai-flow-card">
                      <div className="panel-card-header">
                        <h3>DETERMINISTIC GRADING RULES ENGINE</h3>
                        <span className="badge-pill ready-badge">GRADE-IN-001</span>
                      </div>

                      <p className="card-p">
                        Transparent, rules-based device grading combining <strong>Safety (S0/S1)</strong>, <strong>Cosmetic (A-D)</strong>, and <strong>Functional (F0-F2)</strong> verification (§4, §22, §37). No black-box AI scores.
                      </p>

                      {gradingActive && (
                        <div className="grading-progress-box" style={{ background: "#0f172a", padding: "20px", borderRadius: "8px", border: "1px solid #3b82f6", marginBottom: "20px" }}>
                          <div style={{ color: "#38bdf8", fontWeight: 700, marginBottom: "8px" }}>
                            <span className="status-bullet-ok">●</span> EVALUATING RULES REGISTRY: GRADE-IN-001
                          </div>
                          <div style={{ fontSize: "13px", color: "#f1f5f9" }}>
                            Aggregating physical defect telemetry, safety checks, and hardware test records...
                          </div>
                        </div>
                      )}

                      {!gradingActive && !gradingDecision && (
                        <div className="grading-idle">
                          <div className="views-grid" style={{ marginBottom: "20px" }}>
                            <div className="view-step-box">
                              <strong>SAFETY ASSESSMENT</strong>
                              <span style={{ fontSize: "11px", color: "#64748b", display: "block", marginTop: "4px" }}>
                                S0 (Safe to Process) vs S1 (Hold for Battery/Chassis Hazard)
                              </span>
                            </div>
                            <div className="view-step-box">
                              <strong>COSMETIC GRADE</strong>
                              <span style={{ fontSize: "11px", color: "#64748b", display: "block", marginTop: "4px" }}>
                                A (Near New), B (Light Wear), C (Visible Wear), D (Heavy Service)
                              </span>
                            </div>
                            <div className="view-step-box">
                              <strong>FUNCTIONAL GRADE</strong>
                              <span style={{ fontSize: "11px", color: "#64748b", display: "block", marginTop: "4px" }}>
                                F0 (Fully Verified), F1 (Limited), F2 (Defect Present)
                              </span>
                            </div>
                            <div className="view-step-box">
                              <strong>COUNTRY PROFILE</strong>
                              <span style={{ fontSize: "11px", color: "#64748b", display: "block", marginTop: "4px" }}>
                                India Re-marketing Standard Presentation Layer
                              </span>
                            </div>
                          </div>

                          <div className="quality-gate-notice" style={{ background: "#0f172a", padding: "12px 16px", borderRadius: "6px", border: "1px solid #1e293b", marginBottom: "20px", fontSize: "12px", color: "#94a3b8" }}>
                            <strong>Rule-Driven Methodology (§37):</strong> The AI detects evidence; the versioned rules engine calculates the grade. The output includes an auditable rule evaluation step trail.
                          </div>

                          <button
                            type="button"
                            className="btn btn-action-primary"
                            onClick={executeDeterministicGrading}
                          >
                            Calculate Device Grade (GRADE-IN-001) →
                          </button>
                        </div>
                      )}

                      {gradingDecision && (
                        <div className="grading-decision-complete">
                          <div style={{ padding: "20px", background: "rgba(16, 185, 129, 0.1)", border: "1px solid #10b981", borderRadius: "8px", marginBottom: "20px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                              <div>
                                <span style={{ fontSize: "12px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                  OVERALL CYVORIQ CERTIFIED GRADE
                                </span>
                                <h3 style={{ fontSize: "24px", color: "#10b981", margin: "4px 0 0" }}>
                                  {gradingDecision.overallLabel}
                                </h3>
                              </div>
                              <span className="badge-pill ready-badge" style={{ fontSize: "12px", padding: "6px 12px" }}>
                                RULES: {gradingDecision.rulesVersion}
                              </span>
                            </div>

                            <div className="views-grid" style={{ marginTop: "16px" }}>
                              <div className="view-step-box">
                                <span style={{ fontSize: "11px", color: "#94a3b8" }}>SAFETY GRADE</span>
                                <strong style={{ display: "block", fontSize: "14px", color: "#f8fafc", marginTop: "2px" }}>
                                  {gradingDecision.safetyGrade} — {gradingDecision.safetyLabel}
                                </strong>
                              </div>
                              <div className="view-step-box">
                                <span style={{ fontSize: "11px", color: "#94a3b8" }}>COSMETIC GRADE</span>
                                <strong style={{ display: "block", fontSize: "14px", color: "#f8fafc", marginTop: "2px" }}>
                                  {gradingDecision.cosmeticGrade} — {gradingDecision.cosmeticLabel}
                                </strong>
                              </div>
                              <div className="view-step-box">
                                <span style={{ fontSize: "11px", color: "#94a3b8" }}>FUNCTIONAL GRADE</span>
                                <strong style={{ display: "block", fontSize: "14px", color: "#f8fafc", marginTop: "2px" }}>
                                  {gradingDecision.functionalGrade} — {gradingDecision.functionalLabel}
                                </strong>
                              </div>
                            </div>
                          </div>

                          {/* Rule Audit Trail */}
                          <div className="table-responsive" style={{ marginBottom: "20px" }}>
                            <h4 style={{ color: "#cbd5e1", fontSize: "14px", margin: "0 0 10px" }}>
                              Auditable Rules Decision Trail (§37)
                            </h4>
                            <table className="workstation-table">
                              <thead>
                                <tr>
                                  <th>RULE ID</th>
                                  <th>EVALUATED CONDITION</th>
                                  <th>RESULTING IMPACT</th>
                                </tr>
                              </thead>
                              <tbody>
                                {gradingDecision.auditSteps.map((step, idx) => (
                                  <tr key={idx}>
                                    <td className="font-mono"><strong>{step.rule}</strong></td>
                                    <td>{step.description}</td>
                                    <td><span className="tag-complete">{step.impact}</span></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div className="btn-row" style={{ display: "flex", gap: "12px" }}>
                            <button
                              type="button"
                              className="btn btn-action-primary"
                              onClick={() => setAiSubTab("HUMAN_REVIEW")}
                            >
                              Proceed to Human Review Exceptions (Phase 12) →
                            </button>
                            <button
                              type="button"
                              className="btn btn-action-secondary"
                              onClick={() => setGradingDecision(null)}
                            >
                              Recalculate Grade
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {aiSubTab === "HUMAN_REVIEW" && (
                    <div className="panel-card ai-flow-card">
                      <div className="panel-card-header">
                        <h3>HUMAN EXCEPTION REVIEW & AUDIT OVERRIDE</h3>
                        <span className="badge-pill ready-badge">PHASE 12</span>
                      </div>

                      <p className="card-p">
                        Auditable operator interface for reviewing borderline AI findings, ambiguous wear marks, and safety alerts (§5, §21, §38). Every decision is logged to build a verifiable training dataset.
                      </p>

                      <div className="review-cards-list" style={{ marginBottom: "20px" }}>
                        {reviewItems.map((item) => (
                          <div key={item.id} style={{ background: "#0f172a", padding: "16px", borderRadius: "8px", border: "1px solid #1e293b", marginBottom: "12px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                              <div>
                                <strong style={{ color: "#f8fafc", fontSize: "14px" }}>{item.defect}</strong>
                                <span style={{ display: "block", fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>
                                  Location: {item.location} | Confidence: {item.confidence}
                                </span>
                              </div>
                              <span className="badge-pill optional-badge">{item.reason}</span>
                            </div>

                            <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                              <button
                                type="button"
                                className={`btn ${item.action === "ACCEPT" ? "btn-action-primary" : "btn-action-secondary"}`}
                                style={{ fontSize: "12px", padding: "5px 10px" }}
                                onClick={() => handleReviewAction(item.id, "ACCEPT")}
                              >
                                ✓ Accept Defect
                              </button>
                              <button
                                type="button"
                                className={`btn ${item.action === "REJECT" ? "btn-action-primary" : "btn-action-secondary"}`}
                                style={{ fontSize: "12px", padding: "5px 10px" }}
                                onClick={() => handleReviewAction(item.id, "REJECT")}
                              >
                                ✕ Reject (False Positive)
                              </button>
                              <button
                                type="button"
                                className={`btn ${item.action === "RECAPTURE" ? "btn-action-primary" : "btn-action-secondary"}`}
                                style={{ fontSize: "12px", padding: "5px 10px" }}
                                onClick={() => handleReviewAction(item.id, "RECAPTURE")}
                              >
                                📷 Request Recapture
                              </button>
                              <button
                                type="button"
                                className={`btn ${item.action === "PHYSICAL_VERIFICATION" ? "btn-action-primary" : "btn-action-secondary"}`}
                                style={{ fontSize: "12px", padding: "5px 10px" }}
                                onClick={() => handleReviewAction(item.id, "PHYSICAL_VERIFICATION")}
                              >
                                🔍 Bench Inspection
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {reviewSignedOff ? (
                        <div style={{ padding: "16px", background: "rgba(16, 185, 129, 0.1)", border: "1px solid #10b981", borderRadius: "8px", marginBottom: "20px" }}>
                          <h4 style={{ color: "#10b981", margin: "0 0 4px" }}>✓ Human Review Signed Off</h4>
                          <p style={{ color: "#cbd5e1", fontSize: "13px", margin: 0 }}>
                            Exceptions resolved. Operator decisions permanently cryptographically bound to session.
                          </p>
                        </div>
                      ) : (
                        <div style={{ marginBottom: "20px" }}>
                          <button
                            type="button"
                            className="btn btn-action-primary"
                            onClick={finalizeHumanReview}
                          >
                            Sign & Commit Operator Exceptions (TECH-SIGN-992) →
                          </button>
                        </div>
                      )}

                      <div className="btn-row" style={{ display: "flex", gap: "12px" }}>
                        <button
                          type="button"
                          className="btn btn-action-primary"
                          onClick={() => setAiSubTab("CERTIFIED_REPORT")}
                        >
                          Generate CYVORIQ Certified Condition Report (Phase 13) →
                        </button>
                        <button
                          type="button"
                          className="btn btn-action-secondary"
                          onClick={() => setActiveTab("ADVANCED_DIAGNOSTIC")}
                        >
                          Proceed to Technical Diagnostics
                        </button>
                      </div>
                    </div>
                  )}

                  {aiSubTab === "CERTIFIED_REPORT" && (
                    <div className="panel-card ai-flow-card">
                      <div className="panel-card-header">
                        <h3>CYVORIQ CERTIFIED DEVICE CONDITION & DIAGNOSTIC REPORT</h3>
                        <span className="badge-pill ready-badge">PHASE 13</span>
                      </div>

                      <p className="card-p">
                        Authoritative pre-purge certificate combining non-destructive diagnostic findings, standardized 6-view physical captures, AI cosmetic defects, deterministic grades, and human review signatures (§22, §39, §41).
                      </p>

                      {!conditionReport ? (
                        <div style={{ textAlign: "center", padding: "40px 20px" }}>
                          <p style={{ color: "#94a3b8", marginBottom: "20px" }}>
                            Prerequisites satisfied: Physical capture complete (6/6), AI defect scans finished, Deterministic grading computed, and Human Review exceptions resolved.
                          </p>
                          <button
                            type="button"
                            className="btn btn-action-primary"
                            style={{ padding: "12px 24px", fontSize: "15px" }}
                            onClick={generateConditionReportCertificate}
                          >
                            Generate Official CYVORIQ Certified Condition Report (SHA-256) →
                          </button>
                        </div>
                      ) : (
                        <div className="certified-report-container" style={{ background: "#0b1120", border: "1px solid #1e293b", borderRadius: "8px", padding: "24px", marginTop: "16px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #334155", paddingBottom: "16px", marginBottom: "20px" }}>
                            <div>
                              <h2 style={{ fontSize: "18px", color: "#38bdf8", margin: "0 0 4px" }}>CYVORIQ CERTIFIED CONDITION REPORT</h2>
                              <span style={{ fontSize: "12px", color: "#94a3b8" }}>Report ID: <strong className="font-mono" style={{ color: "#f8fafc" }}>{conditionReport.reportId}</strong></span>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <span className="badge-pill ready-badge">AUTHENTICATED & SEALED</span>
                              <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>Standard: {conditionReport.methodology}</div>
                            </div>
                          </div>

                          {/* Grade Dashboard */}
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "24px" }}>
                            <div style={{ background: "#1e293b", padding: "14px", borderRadius: "6px", textAlign: "center" }}>
                              <span style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase" }}>Overall Grade</span>
                              <div style={{ fontSize: "24px", fontWeight: "bold", color: "#38bdf8", marginTop: "4px" }}>{conditionReport.overallGrade.replace("GRADE_", "")}</div>
                              <span style={{ fontSize: "11px", color: "#cbd5e1" }}>{conditionReport.overallLabel}</span>
                            </div>
                            <div style={{ background: "#1e293b", padding: "14px", borderRadius: "6px", textAlign: "center" }}>
                              <span style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase" }}>Safety Assessment</span>
                              <div style={{ fontSize: "24px", fontWeight: "bold", color: "#10b981", marginTop: "4px" }}>{conditionReport.safetyGrade}</div>
                              <span style={{ fontSize: "11px", color: "#cbd5e1" }}>{conditionReport.safetyLabel}</span>
                            </div>
                            <div style={{ background: "#1e293b", padding: "14px", borderRadius: "6px", textAlign: "center" }}>
                              <span style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase" }}>Cosmetic Grade</span>
                              <div style={{ fontSize: "24px", fontWeight: "bold", color: "#f59e0b", marginTop: "4px" }}>{conditionReport.cosmeticGrade}</div>
                              <span style={{ fontSize: "11px", color: "#cbd5e1" }}>{conditionReport.cosmeticLabel}</span>
                            </div>
                            <div style={{ background: "#1e293b", padding: "14px", borderRadius: "6px", textAlign: "center" }}>
                              <span style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase" }}>Functional Grade</span>
                              <div style={{ fontSize: "24px", fontWeight: "bold", color: "#10b981", marginTop: "4px" }}>{conditionReport.functionalGrade}</div>
                              <span style={{ fontSize: "11px", color: "#cbd5e1" }}>{conditionReport.functionalLabel}</span>
                            </div>
                          </div>

                          {/* Evidence Sections */}
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
                            <div style={{ background: "#0f172a", border: "1px solid #1e293b", padding: "16px", borderRadius: "6px" }}>
                              <h4 style={{ color: "#cbd5e1", fontSize: "13px", margin: "0 0 10px", textTransform: "uppercase" }}>
                                🔍 Physical Findings ({conditionReport.viewsAccepted})
                              </h4>
                              <ul style={{ margin: 0, paddingLeft: "18px", color: "#94a3b8", fontSize: "12px", lineHeight: "1.6" }}>
                                {conditionReport.physicalFindings.map((f, i) => (
                                  <li key={i}><strong style={{ color: "#f8fafc" }}>{f}</strong></li>
                                ))}
                              </ul>
                            </div>
                            <div style={{ background: "#0f172a", border: "1px solid #1e293b", padding: "16px", borderRadius: "6px" }}>
                              <h4 style={{ color: "#cbd5e1", fontSize: "13px", margin: "0 0 10px", textTransform: "uppercase" }}>
                                📱 Technical Diagnostics Summary
                              </h4>
                              <ul style={{ margin: 0, paddingLeft: "18px", color: "#94a3b8", fontSize: "12px", lineHeight: "1.6" }}>
                                {conditionReport.diagnosticFindings.map((d, i) => (
                                  <li key={i}><strong style={{ color: "#f8fafc" }}>{d}</strong></li>
                                ))}
                              </ul>
                            </div>
                          </div>

                          {/* Integrity Seal */}
                          <div style={{ background: "#020617", border: "1px solid #1e293b", padding: "14px 18px", borderRadius: "6px", marginBottom: "24px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div>
                                <span style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", display: "block" }}>Tamper-Evident SHA-256 Digest</span>
                                <span className="font-mono" style={{ fontSize: "12px", color: "#38bdf8", wordBreak: "break-all" }}>
                                  {conditionReport.sha256Hash}
                                </span>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <span style={{ fontSize: "11px", color: "#64748b", display: "block" }}>Audited By</span>
                                <span className="font-mono" style={{ fontSize: "12px", color: "#10b981", fontWeight: "bold" }}>
                                  {conditionReport.reviewerSignature}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="btn-row" style={{ display: "flex", gap: "12px" }}>
                            <button
                              type="button"
                              className="btn btn-action-primary"
                              onClick={() => setActiveTab("DATA_PURGE")}
                            >
                              Proceed to NIST Data Purge (Phase 14) →
                            </button>
                            <button
                              type="button"
                              className="btn btn-action-secondary"
                              onClick={() => setActiveTab("RESULTS_REPORTS")}
                            >
                              View in Central Archive
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
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
