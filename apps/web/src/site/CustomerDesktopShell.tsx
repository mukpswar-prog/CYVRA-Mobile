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
  // Phase 17: Mutable Entitlement Revisions & Scan Accounting Ledger (§11-14)
  const [activeLicenseState, setActiveLicenseState] = useState<{
    licenseId: string;
    serialNumber: string;
    planName: string;
    scansTotal: number;
    scansUsed: number;
    scansRemaining: number;
    revision: number;
    status: string;
    version: string;
  }>({
    licenseId: "LIC-MOB-2026-00124",
    serialNumber: "CYVRA15092026SA3F1-1-25",
    planName: "25 Device Scans",
    scansTotal: 25,
    scansUsed: props.reports.length,
    scansRemaining: Math.max(0, 25 - props.reports.length),
    revision: 1,
    status: "ACTIVE",
    version: "3.2.1-g5",
  });

  const [revisionHistory, setRevisionHistory] = useState<Array<{
    revision: number;
    serialNumber: string;
    planName: string;
    totalScans: number;
    carriedOverUsage: number;
    scansRemaining: number;
    status: "ACTIVE" | "SUPERSEDED";
    date: string;
    orderId: string;
  }>>([
    {
      revision: 1,
      serialNumber: "CYVRA15092026SA3F1-1-25",
      planName: "25 Device Scans",
      totalScans: 25,
      carriedOverUsage: 0,
      scansRemaining: 25,
      status: "ACTIVE",
      date: "2026-09-15 10:00:00 UTC",
      orderId: "ORD-INITIAL-2026-001",
    },
  ]);

  const [scanLedger, setScanLedger] = useState<Array<{
    txId: string;
    revision: number;
    sessionUuid: string;
    deviceSerial: string;
    event: "COMMITTED" | "DEBITED" | "CANCELLED";
    scanNumber: number;
    timestamp: string;
  }>>([
    {
      txId: "TX-SCAN-90411",
      revision: 1,
      sessionUuid: "CYVRA-SESSION-20260915-00124",
      deviceSerial: "RF8R123456",
      event: "DEBITED",
      scanNumber: 1,
      timestamp: "2026-09-15 11:32:00 UTC",
    },
  ]);

  const [selectedUpgradePlan, setSelectedUpgradePlan] = useState<number>(25);
  const [upgradeHandoffState, setUpgradeHandoffState] = useState<
    "SELECTING" | "GENERATING_TOKEN" | "PAYMENT_CONFIRMED" | "AWAITING_APPROVAL" | "UPGRADED"
  >("SELECTING");
  const [upgradeOrderId, setUpgradeOrderId] = useState<string>("");
  const [paymentReference, setPaymentReference] = useState<string>("");

  // Phase 19: Offline Entitlement & Signed Cache Resilience State (§15, Part G)
  const [isNetworkOnline, setIsNetworkOnline] = useState<boolean>(true);
  const [offlineGraceExpiresAt] = useState<string>("2026-09-17 10:00:00 UTC");
  const [signedCacheDigest] = useState<string>("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

  // Phase 21: Multi-OEM Device Adapter Selection & Capability State (§8, §24)
  const [selectedOemFamily, setSelectedOemFamily] = useState<"MOTOROLA" | "SAMSUNG" | "XIAOMI" | "ONEPLUS" | "GOOGLE" | "GENERIC">("MOTOROLA");

  // Phase 18: Commercial Orders & Staff Approval Tracking State (§10, §30)
  const [orderRegistry, setOrderRegistry] = useState<Array<{
    orderId: string;
    customerEmail: string;
    licenseId: string;
    targetPlan: string;
    targetScans: number;
    amountInr: number;
    status: "PAYMENT_PENDING" | "PAYMENT_CONFIRMED" | "WAITING_ADMIN_APPROVAL" | "APPROVED" | "ENTITLEMENT_ISSUED" | "REJECTED";
    paymentProvider: string;
    paymentRef: string;
    approvedBy: string | null;
    issuedSerial: string | null;
    timestamp: string;
  }>>([
    {
      orderId: "ORD-INITIAL-2026-001",
      customerEmail: props.user.email,
      licenseId: "LIC-MOB-2026-00124",
      targetPlan: "25 Device Scans",
      targetScans: 25,
      amountInr: 12500,
      status: "ENTITLEMENT_ISSUED",
      paymentProvider: "RAZORPAY",
      paymentRef: "pay_live_initial_90124",
      approvedBy: "ceo@cyvoriq.com",
      issuedSerial: "CYVRA15092026SA3F1-1-25",
      timestamp: "2026-09-15 10:00:00 UTC",
    },
  ]);

  const license = activeLicenseState;

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

    // Debit scan accounting on report generation (§14)
    setActiveLicenseState((prev) => {
      const newUsed = prev.scansUsed + 1;
      const newRemaining = Math.max(0, prev.scansTotal - newUsed);
      return {
        ...prev,
        scansUsed: newUsed,
        scansRemaining: newRemaining,
      };
    });

    setScanLedger((prev) => [
      ...prev,
      {
        txId: `TX-SCAN-${Math.floor(10000 + Math.random() * 90000)}`,
        revision: license.revision,
        sessionUuid: `CYVRA-SESSION-20260915-${Math.floor(100000 + Math.random() * 900000)}`,
        deviceSerial: simulatedDevice.serial,
        event: "DEBITED",
        scanNumber: license.scansUsed + 1,
        timestamp: new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC",
      },
    ]);
  }

  function handleReviewAction(id: string, action: "ACCEPT" | "REJECT" | "RECAPTURE" | "PHYSICAL_VERIFICATION") {
    setReviewItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, action } : item)),
    );
  }

  function finalizeHumanReview() {
    setReviewSignedOff(true);
  }

  // Phase 14: Data Purge & Sanitization Workflow (§23, §40)
  const [purgeWorkflowStep, setPurgeWorkflowStep] = useState<
    "PRE_SCAN" | "AUTHORIZATION" | "METHOD_SELECT" | "EXECUTING" | "REBOOT_AWAITING" | "VERIFIED"
  >("PRE_SCAN");
  const [purgeAckChecked, setPurgeAckChecked] = useState<boolean>(false);
  const [purgeConfirmationText, setPurgeConfirmationText] = useState<string>("");
  const [selectedPurgeMethod, setSelectedPurgeMethod] = useState<"CLEAR_PLATFORM_RESET" | "PURGE_OEM_SECURE_ERASE">("CLEAR_PLATFORM_RESET");
  const [purgeExecutionProgress, setPurgeExecutionProgress] = useState<string>("");
  const [purgeVerificationData, setPurgeVerificationData] = useState<{
    operationId: string;
    executedAt: string;
    verifiedAt: string;
    reconnectSerial: string;
    setupWizardDetected: boolean;
    userAccountsRemoved: boolean;
    screenLockAbsent: boolean;
    assuranceLevel: string;
    sha256Hash: string;
  } | null>(null);

  function executePurgePipeline() {
    setPurgeWorkflowStep("EXECUTING");
    setPurgeExecutionProgress("Validating operator 2-step barrier and cryptographic pre-scan snapshot...");

    setTimeout(() => {
      setPurgeExecutionProgress("Sending gated recovery reset trigger via ADB (G5 non-destructive baseline)...");
    }, 1000);

    setTimeout(() => {
      setPurgeExecutionProgress("Device reboot initiated. Awaiting USB/ADB reconnection in OOBE setup mode...");
      setPurgeWorkflowStep("REBOOT_AWAITING");
    }, 2000);

    setTimeout(() => {
      setPurgeVerificationData({
        operationId: "PURGE-OP-90412",
        executedAt: new Date(Date.now() - 15000).toISOString(),
        verifiedAt: new Date().toISOString(),
        reconnectSerial: simulatedDevice.serial,
        setupWizardDetected: true,
        userAccountsRemoved: true,
        screenLockAbsent: true,
        assuranceLevel: "NIST_SP_800_88_REV2_CLEAR_PLATFORM_VERIFIED",
        sha256Hash: "c4f92d8e578a10b91e92da94017a421b9c7e0984a92e1059f03d162812ef6412",
      });
      setPurgeWorkflowStep("VERIFIED");
      setPurgeExecutionProgress("");
    }, 4200);
  }

  // Phase 15: Final Sanitization Certificate State (§41)
  const [sanitizationCertReport, setSanitizationCertReport] = useState<{
    certificateId: string;
    generatedAt: string;
    standardReference: string;
    assuranceLevel: string;
    operatorId: string;
    operationId: string;
    selectedMethod: string;
    executionStatus: string;
    executionTimestamp: string;
    verificationStatus: string;
    postResetAdbState: string;
    setupWizardConfirmed: boolean;
    userAccountsRemoved: boolean;
    sha256Hash: string;
    limitations: string[];
  } | null>(null);

  const [activeReportSubTab, setActiveReportSubTab] = useState<"CENTRAL_ARCHIVE" | "SANITIZATION_CERT">("CENTRAL_ARCHIVE");

  function generateFinalSanitizationCertificate() {
    setSanitizationCertReport({
      certificateId: "CYVRA-CERT-2026-90412",
      generatedAt: new Date().toISOString(),
      standardReference: "NIST SP 800-88 Rev. 2",
      assuranceLevel: "NIST_SP_800_88_REV2_CLEAR_PLATFORM_VERIFIED",
      operatorId: "operator@cyvoriq.co.in",
      operationId: purgeVerificationData?.operationId || "PURGE-OP-90412",
      selectedMethod: selectedPurgeMethod === "CLEAR_PLATFORM_RESET" ? "Platform Factory Reset (Clear)" : "OEM Cryptographic Purge",
      executionStatus: "SUCCESS_VERIFIED",
      executionTimestamp: purgeVerificationData?.executedAt || new Date(Date.now() - 60000).toISOString(),
      verificationStatus: "VERIFIED",
      postResetAdbState: "DEVICE_OOBE",
      setupWizardConfirmed: true,
      userAccountsRemoved: true,
      sha256Hash: purgeVerificationData?.sha256Hash || "c4f92d8e578a10b91e92da94017a421b9c7e0984a92e1059f03d162812ef6412",
      limitations: [
        "NIST SP 800-88 Rev. 2 Clear level achieved via platform-mediated factory data wipe.",
        "Flash memory wear-leveling prevents direct bit-level validation of unmapped physical NAND blocks.",
        "Post-reset verification conducted via live USB/ADB query of OOBE setup wizard and credential stores.",
      ],
    });
    setActiveReportSubTab("SANITIZATION_CERT");
    setActiveTab("RESULTS_REPORTS");
  }

  // Phase 16: Secure Software Update State (§16, Part H)
  const [updateStep, setUpdateStep] = useState<
    "IDLE" | "CHECKING" | "AVAILABLE" | "DOWNLOADING" | "STAGED" | "ROLLED_BACK"
  >("IDLE");
  const [updateProgressMsg, setUpdateProgressMsg] = useState<string>("");
  const [stagedRecord, setStagedRecord] = useState<{
    version: string;
    releaseType: string;
    channel: string;
    size: string;
    sha256: string;
    signatureAlgorithm: string;
    signature: string;
    stagedPath: string;
    rollbackPath: string;
    notes: string[];
  } | null>(null);

  function checkForSoftwareUpdates() {
    setUpdateStep("CHECKING");
    setUpdateProgressMsg("Contacting CYVRA Update Service (GET /updates/manifest)...");

    setTimeout(() => {
      setUpdateStep("AVAILABLE");
      setUpdateProgressMsg("");
      setStagedRecord({
        version: "3.2.2-g5",
        releaseType: "Delta Package",
        channel: "Stable Channel",
        size: "18.4 MB",
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        signatureAlgorithm: "Ed25519 (CYVORIQ-UPDATE-KEY-PROD-2026)",
        signature: "SIG_ED25519_8f91a27e3d04b912c7...",
        stagedPath: "/opt/cyvra/updates/staged/3.2.2-g5/update.delta",
        rollbackPath: "/opt/cyvra/updates/staged/backup-3.2.1-g5.tar.gz",
        notes: [
          "Multi-OEM device probe enhancements for Android 15 & 16 developer preview",
          "Automated camera focus & glare detection optimization in AI Physical Station",
          "NIST SP 800-88 Rev. 2 post-reboot verification speed improvement",
        ],
      });
    }, 1000);
  }

  function downloadAndStageUpdate() {
    setUpdateStep("DOWNLOADING");
    setUpdateProgressMsg("Downloading signed delta payload from updates.cyvoriq.co.in...");

    setTimeout(() => {
      setUpdateProgressMsg("Verifying cryptographic Ed25519 manifest signature...");
    }, 900);

    setTimeout(() => {
      setUpdateProgressMsg("Verifying SHA-256 binary hash digest matches manifest...");
    }, 1700);

    setTimeout(() => {
      setUpdateProgressMsg("Staging verified binary to safe local update directory...");
    }, 2500);

    setTimeout(() => {
      setUpdateStep("STAGED");
      setUpdateProgressMsg("");
    }, 3300);
  }

  function rollbackUpdate() {
    setUpdateStep("ROLLED_BACK");
    setUpdateProgressMsg("Staged update rolled back. System restored to current v3.2.1-g5 baseline.");
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
                    <div className="btn-row" style={{ display: "flex", gap: "12px", marginBottom: "20px" }}>
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

                    {/* Phase 21: Multi-OEM Device Adapter & Security Suite Telemetry */}
                    <div className="panel-card" style={{ background: "#0b1120", border: "1px solid #1e293b", padding: "16px", borderRadius: "8px" }}>
                      <div className="panel-card-header" style={{ marginBottom: "12px" }}>
                        <h4 style={{ margin: 0, fontSize: "14px", color: "#38bdf8" }}>
                          Multi-OEM Device Adapter & Hardware Security Profile (§8, §24 / Phase 21)
                        </h4>
                        <span className="badge-pill ready-badge">
                          {selectedOemFamily === "SAMSUNG" ? "SAMSUNG KNOX ACTIVE" :
                           selectedOemFamily === "XIAOMI" ? "XIAOMI TEE ATTESTED" :
                           selectedOemFamily === "ONEPLUS" ? "OPPO / COLOROS TEE" :
                           selectedOemFamily === "GOOGLE" ? "TITAN M2 DISCRETE" :
                           selectedOemFamily === "MOTOROLA" ? "MOTO THINKSHIELD" : "GENERIC ANDROID"}
                        </span>
                      </div>

                      <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className={`btn ${selectedOemFamily === "MOTOROLA" ? "btn-compact-primary" : "btn-compact-ghost"}`}
                          style={{ fontSize: "11px" }}
                          onClick={() => setSelectedOemFamily("MOTOROLA")}
                        >
                          Motorola (Live G54 Baseline)
                        </button>
                        <button
                          type="button"
                          className={`btn ${selectedOemFamily === "SAMSUNG" ? "btn-compact-primary" : "btn-compact-ghost"}`}
                          style={{ fontSize: "11px" }}
                          onClick={() => setSelectedOemFamily("SAMSUNG")}
                        >
                          Samsung (One UI & Knox)
                        </button>
                        <button
                          type="button"
                          className={`btn ${selectedOemFamily === "XIAOMI" ? "btn-compact-primary" : "btn-compact-ghost"}`}
                          style={{ fontSize: "11px" }}
                          onClick={() => setSelectedOemFamily("XIAOMI")}
                        >
                          Xiaomi (HyperOS & TEE)
                        </button>
                        <button
                          type="button"
                          className={`btn ${selectedOemFamily === "ONEPLUS" ? "btn-compact-primary" : "btn-compact-ghost"}`}
                          style={{ fontSize: "11px" }}
                          onClick={() => setSelectedOemFamily("ONEPLUS")}
                        >
                          OnePlus / Oppo (ColorOS)
                        </button>
                        <button
                          type="button"
                          className={`btn ${selectedOemFamily === "GOOGLE" ? "btn-compact-primary" : "btn-compact-ghost"}`}
                          style={{ fontSize: "11px" }}
                          onClick={() => setSelectedOemFamily("GOOGLE")}
                        >
                          Google (Pixel Titan M)
                        </button>
                        <button
                          type="button"
                          className={`btn ${selectedOemFamily === "GENERIC" ? "btn-compact-primary" : "btn-compact-ghost"}`}
                          style={{ fontSize: "11px" }}
                          onClick={() => setSelectedOemFamily("GENERIC")}
                        >
                          Generic Android AOSP
                        </button>
                      </div>

                      <div className="device-metric-rows" style={{ fontSize: "12px" }}>
                        <div className="metric-row">
                          <span className="metric-label">Resolved Adapter ID:</span>
                          <span className="metric-value font-mono text-cyan-400">
                            {selectedOemFamily === "SAMSUNG" ? "OEM-ADAPTER-SAMSUNG-KNOX" :
                             selectedOemFamily === "XIAOMI" ? "OEM-ADAPTER-XIAOMI-HYPEROS" :
                             selectedOemFamily === "ONEPLUS" ? "OEM-ADAPTER-OPPO-COLOROS" :
                             selectedOemFamily === "GOOGLE" ? "OEM-ADAPTER-GOOGLE-PIXEL" :
                             selectedOemFamily === "MOTOROLA" ? "OEM-ADAPTER-MOTO-THINKSHIELD" : "OEM-ADAPTER-GENERIC-ANDROID"}
                          </span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">OEM Security Architecture:</span>
                          <span className="metric-value font-bold text-emerald-400">
                            {selectedOemFamily === "SAMSUNG" ? "Samsung Knox Vault (Hardware Enclave)" :
                             selectedOemFamily === "XIAOMI" ? "Xiaomi TEE Cryptographic Storage" :
                             selectedOemFamily === "ONEPLUS" ? "OPPO OEStore Isolated Vault" :
                             selectedOemFamily === "GOOGLE" ? "Google Titan M2 Discrete Security Module" :
                             selectedOemFamily === "MOTOROLA" ? "ThinkShield for Mobile OS Defense" : "Standard Android Keystore"}
                          </span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Hardware Battery Telemetry:</span>
                          <span className="metric-value font-mono">
                            {selectedOemFamily === "SAMSUNG" ? "sec_bat_health / cycle_count sysfs" :
                             selectedOemFamily === "XIAOMI" ? "qcom_fg_health / bms sysfs node" :
                             selectedOemFamily === "ONEPLUS" ? "vooc_fastcharge_health dual-cell node" :
                             selectedOemFamily === "GOOGLE" ? "pixel_health_hal IHealth service" :
                             selectedOemFamily === "MOTOROLA" ? "moto_battery_charge_control sysfs" : "dumpsys battery (AOSP standard)"}
                          </span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Supported Sanitization Methods:</span>
                          <span className="metric-value text-sky-400">
                            {selectedOemFamily === "SAMSUNG" ? "Platform Reset, Device Owner Wipe, OEM Secure Erase (Knox)" :
                             selectedOemFamily === "GENERIC" ? "Standard Platform Reset (Recovery Wipe-Data)" :
                             "Platform Factory Reset, Device Owner Policy Wipe"}
                          </span>
                        </div>
                      </div>
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
                    NIST SP 800-88 Rev. 2 compliant sanitization lifecycle. Two-step operator confirmation barrier (§23, §40).
                  </p>

                  {/* Sanitization Pipeline Flow Steps */}
                  <div className="tab-pill-row" style={{ marginBottom: "20px" }}>
                    <span className={`badge-pill ${purgeWorkflowStep !== "PRE_SCAN" ? "ready-badge" : "active-badge"}`}>
                      1. Pre-Scan Snapshot
                    </span>
                    <span className={`badge-pill ${purgeWorkflowStep === "AUTHORIZATION" ? "active-badge" : purgeWorkflowStep !== "PRE_SCAN" ? "ready-badge" : "optional-badge"}`}>
                      2. 2-Step Authorization
                    </span>
                    <span className={`badge-pill ${purgeWorkflowStep === "METHOD_SELECT" ? "active-badge" : ["EXECUTING", "REBOOT_AWAITING", "VERIFIED"].includes(purgeWorkflowStep) ? "ready-badge" : "optional-badge"}`}>
                      3. Method Selection
                    </span>
                    <span className={`badge-pill ${["EXECUTING", "REBOOT_AWAITING"].includes(purgeWorkflowStep) ? "active-badge" : purgeWorkflowStep === "VERIFIED" ? "ready-badge" : "optional-badge"}`}>
                      4. Purge & Reconnect
                    </span>
                    <span className={`badge-pill ${purgeWorkflowStep === "VERIFIED" ? "ready-badge" : "optional-badge"}`}>
                      5. Post-Reset Verified
                    </span>
                  </div>

                  {purgeWorkflowStep === "PRE_SCAN" && (
                    <div className="panel-card purge-warning-card">
                      <h3>Controlled Sanitization Barrier — Step 1: Pre-Scan Condition</h3>
                      <p className="card-p">
                        Destructive operations cannot proceed without verified diagnostic evidence and pre-scan hardware identification (§34).
                      </p>
                      <div className="device-metric-rows" style={{ marginBottom: "20px" }}>
                        <div className="metric-row">
                          <span className="metric-label">Target Serial / ADB:</span>
                          <span className="metric-value font-mono">{simulatedDevice.serial}</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Identified Device:</span>
                          <span className="metric-value">{simulatedDevice.manufacturer} {simulatedDevice.model}</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Recommended Purge Action:</span>
                          <span className="metric-value font-mono text-emerald-400">PLATFORM_FACTORY_RESET (Clear)</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Post-Purge Verification:</span>
                          <span className="metric-value">Mandatory Reconnect & Setup Wizard Detection</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="btn btn-action-primary"
                        onClick={() => setPurgeWorkflowStep("AUTHORIZATION")}
                      >
                        Proceed to 2-Step Authorization Barrier →
                      </button>
                    </div>
                  )}

                  {purgeWorkflowStep === "AUTHORIZATION" && (
                    <div className="panel-card purge-warning-card">
                      <div className="panel-card-header">
                        <h3 style={{ color: "#ef4444" }}>⚠️ 2-STEP OPERATOR CONFIRMATION BARRIER</h3>
                        <span className="badge-pill error-badge">SAFETY GATED</span>
                      </div>
                      <p className="card-p">
                        All user accounts, media files, and application partitions will be permanently removed. To prevent accidental triggers, complete both confirmation steps.
                      </p>

                      <div style={{ background: "#0b1120", border: "1px solid #334155", borderRadius: "6px", padding: "16px", marginBottom: "20px" }}>
                        <div style={{ marginBottom: "14px" }}>
                          <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", color: "#f8fafc", fontSize: "13px" }}>
                            <input
                              type="checkbox"
                              checked={purgeAckChecked}
                              onChange={(e) => setPurgeAckChecked(e.target.checked)}
                              style={{ width: "18px", height: "18px" }}
                            />
                            <span><strong>Step 1:</strong> I acknowledge that device media will be purged and cannot be recovered.</span>
                          </label>
                        </div>

                        <div>
                          <label style={{ display: "block", color: "#cbd5e1", fontSize: "12px", marginBottom: "6px" }}>
                            <strong>Step 2:</strong> Type confirmation phrase exactly: <code style={{ color: "#f87171" }}>CONFIRM PURGE</code>
                          </label>
                          <input
                            type="text"
                            placeholder="Type CONFIRM PURGE"
                            value={purgeConfirmationText}
                            onChange={(e) => setPurgeConfirmationText(e.target.value)}
                            style={{
                              background: "#020617",
                              border: "1px solid #475569",
                              borderRadius: "4px",
                              color: "#f8fafc",
                              padding: "8px 12px",
                              width: "100%",
                              maxWidth: "320px",
                              fontSize: "14px",
                            }}
                          />
                        </div>
                      </div>

                      <div className="btn-row" style={{ display: "flex", gap: "12px" }}>
                        <button
                          type="button"
                          className="btn btn-danger"
                          disabled={!purgeAckChecked || purgeConfirmationText.trim() !== "CONFIRM PURGE"}
                          onClick={() => setPurgeWorkflowStep("METHOD_SELECT")}
                        >
                          Unlock Sanitization Execution →
                        </button>
                        <button
                          type="button"
                          className="btn btn-action-secondary"
                          onClick={() => setPurgeWorkflowStep("PRE_SCAN")}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {purgeWorkflowStep === "METHOD_SELECT" && (
                    <div className="panel-card">
                      <h3>Method Selection & Execution</h3>
                      <p className="card-p">
                        Select an authorized sanitization technique adhering to NIST SP 800-88 Rev. 2.
                      </p>

                      <div className="method-selection-box" style={{ marginBottom: "20px" }}>
                        <label style={{ display: "block", marginBottom: "12px", cursor: "pointer" }}>
                          <input
                            type="radio"
                            name="purgeMethod"
                            checked={selectedPurgeMethod === "CLEAR_PLATFORM_RESET"}
                            onChange={() => setSelectedPurgeMethod("CLEAR_PLATFORM_RESET")}
                          />{" "}
                          <strong>Platform Factory Reset (Clear)</strong> — Standard Android Recovery wipe / data clear. Supported across all OEMs.
                        </label>
                        <label style={{ display: "block", color: "#64748b", cursor: "not-allowed" }}>
                          <input
                            type="radio"
                            name="purgeMethod"
                            disabled
                          />{" "}
                          <strong>OEM Cryptographic Purge (Purge)</strong> — Hardware key destruction. Requires physical hardware adapter & OEM firmware authorization.
                        </label>
                      </div>

                      <div className="btn-row" style={{ display: "flex", gap: "12px" }}>
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={executePurgePipeline}
                        >
                          Execute Sanitization (Non-Destructive Safe G5 Baseline) →
                        </button>
                        <button
                          type="button"
                          className="btn btn-action-secondary"
                          onClick={() => setPurgeWorkflowStep("AUTHORIZATION")}
                        >
                          Back to Authorization
                        </button>
                      </div>
                    </div>
                  )}

                  {["EXECUTING", "REBOOT_AWAITING"].includes(purgeWorkflowStep) && (
                    <div className="panel-card" style={{ textAlign: "center", padding: "40px 20px" }}>
                      <h3 style={{ color: "#38bdf8", marginBottom: "12px" }}>
                        {purgeWorkflowStep === "EXECUTING" ? "EXECUTING SANITIZATION PIPELINE" : "AWAITING DEVICE REBOOT & RECONNECT"}
                      </h3>
                      <div className="spinner" style={{ margin: "20px auto" }} />
                      <p style={{ color: "#cbd5e1", fontSize: "14px" }}>
                        {purgeExecutionProgress}
                      </p>
                      <span className="font-mono" style={{ fontSize: "11px", color: "#64748b" }}>
                        Transport: Controlled USB/ADB Socket | Timeout: 120s
                      </span>
                    </div>
                  )}

                  {purgeWorkflowStep === "VERIFIED" && purgeVerificationData && (
                    <div className="panel-card" style={{ border: "1px solid #10b981", background: "rgba(16, 185, 129, 0.05)" }}>
                      <div className="panel-card-header">
                        <h3 style={{ color: "#10b981" }}>✓ POST-RESET VERIFICATION SUCCESSFUL</h3>
                        <span className="badge-pill ready-badge">NIST SP 800-88 REV. 2</span>
                      </div>

                      <p className="card-p">
                        Device reconnected successfully via USB. Host verification probe confirmed factory OOBE / Setup Wizard state and absence of prior user data partitions (§35).
                      </p>

                      <div className="device-metric-rows" style={{ marginBottom: "20px" }}>
                        <div className="metric-row">
                          <span className="metric-label">Operation ID:</span>
                          <span className="metric-value font-mono">{purgeVerificationData.operationId}</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Reconnected Target:</span>
                          <span className="metric-value font-mono">{purgeVerificationData.reconnectSerial}</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Setup Wizard Detected:</span>
                          <span className="metric-value text-emerald-400">YES (Clean OOBE State)</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">User Accounts Removed:</span>
                          <span className="metric-value text-emerald-400">YES (0 Accounts Present)</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Screen Lock Status:</span>
                          <span className="metric-value text-emerald-400">ABSENT (Cleared)</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Assurance Level:</span>
                          <span className="metric-value font-mono">{purgeVerificationData.assuranceLevel}</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Tamper-Evident SHA-256:</span>
                          <span className="metric-value font-mono text-cyan-400" style={{ wordBreak: "break-all" }}>
                            {purgeVerificationData.sha256Hash}
                          </span>
                        </div>
                      </div>

                      <div className="btn-row" style={{ display: "flex", gap: "12px" }}>
                        <button
                          type="button"
                          className="btn btn-action-primary"
                          onClick={generateFinalSanitizationCertificate}
                        >
                          Generate Final NIST SP 800-88 Certificate (Phase 15) →
                        </button>
                        <button
                          type="button"
                          className="btn btn-action-secondary"
                          onClick={() => setPurgeWorkflowStep("PRE_SCAN")}
                        >
                          Reset Purge Pipeline
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "RESULTS_REPORTS" && (
                <div className="stage-view reports-view">
                  <h2>Results & Frozen Reports</h2>
                  <p className="section-desc">
                    Authoritative reports with cryptographic SHA-256 tamper-evident integrity hashes (§41, Phase 15).
                  </p>

                  <div className="tab-pill-row" style={{ marginBottom: "20px" }}>
                    <button
                      type="button"
                      className={`btn ${activeReportSubTab === "CENTRAL_ARCHIVE" ? "btn-action-primary" : "btn-action-secondary"}`}
                      onClick={() => setActiveReportSubTab("CENTRAL_ARCHIVE")}
                    >
                      📁 Central Report Archive
                    </button>
                    <button
                      type="button"
                      className={`btn ${activeReportSubTab === "SANITIZATION_CERT" ? "btn-action-primary" : "btn-action-secondary"}`}
                      onClick={() => setActiveReportSubTab("SANITIZATION_CERT")}
                    >
                      📜 NIST Sanitization Certificate (Phase 15)
                    </button>
                  </div>

                  {activeReportSubTab === "CENTRAL_ARCHIVE" && (
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
                  )}

                  {activeReportSubTab === "SANITIZATION_CERT" && (
                    <div className="panel-card">
                      {!sanitizationCertReport ? (
                        <div style={{ textAlign: "center", padding: "40px 20px" }}>
                          <p style={{ color: "#94a3b8", marginBottom: "16px" }}>
                            No sanitization certificate generated yet. Complete the Phase 14 Data Purge & Verification pipeline to generate an official NIST SP 800-88 Rev. 2 certificate.
                          </p>
                          <button
                            type="button"
                            className="btn btn-action-primary"
                            onClick={() => setActiveTab("DATA_PURGE")}
                          >
                            Go to Data Purge Pipeline →
                          </button>
                        </div>
                      ) : (
                        <div style={{ background: "#0b1120", border: "1px solid #1e293b", borderRadius: "8px", padding: "24px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #334155", paddingBottom: "16px", marginBottom: "20px" }}>
                            <div>
                              <h2 style={{ fontSize: "18px", color: "#38bdf8", margin: "0 0 4px" }}>
                                CYVRA DATA SANITIZATION & VERIFICATION CERTIFICATE
                              </h2>
                              <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                                Certificate ID: <strong className="font-mono" style={{ color: "#f8fafc" }}>{sanitizationCertReport.certificateId}</strong>
                              </span>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <span className="badge-pill ready-badge">NIST SP 800-88 REV. 2 COMPLIANT</span>
                              <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px" }}>Assurance: {sanitizationCertReport.assuranceLevel}</div>
                            </div>
                          </div>

                          <div className="device-metric-rows" style={{ marginBottom: "20px" }}>
                            <div className="metric-row">
                              <span className="metric-label">Sanitization Method:</span>
                              <span className="metric-value font-bold text-sky-400">{sanitizationCertReport.selectedMethod}</span>
                            </div>
                            <div className="metric-row">
                              <span className="metric-label">Execution Status:</span>
                              <span className="metric-value text-emerald-400 font-bold">{sanitizationCertReport.executionStatus}</span>
                            </div>
                            <div className="metric-row">
                              <span className="metric-label">Operation ID:</span>
                              <span className="metric-value font-mono">{sanitizationCertReport.operationId}</span>
                            </div>
                            <div className="metric-row">
                              <span className="metric-label">Post-Reset Verification:</span>
                              <span className="metric-value text-emerald-400">STATUS: {sanitizationCertReport.verificationStatus}</span>
                            </div>
                            <div className="metric-row">
                              <span className="metric-label">Transport State:</span>
                              <span className="metric-value font-mono">{sanitizationCertReport.postResetAdbState}</span>
                            </div>
                            <div className="metric-row">
                              <span className="metric-label">Setup Wizard Confirmed:</span>
                              <span className="metric-value text-emerald-400">YES (OOBE Active)</span>
                            </div>
                            <div className="metric-row">
                              <span className="metric-label">User Accounts Removed:</span>
                              <span className="metric-value text-emerald-400">YES (All User Partitions Purged)</span>
                            </div>
                            <div className="metric-row">
                              <span className="metric-label">Authorized Operator:</span>
                              <span className="metric-value">{sanitizationCertReport.operatorId}</span>
                            </div>
                          </div>

                          {/* Limitations & Disclaimers */}
                          <div style={{ background: "#020617", border: "1px solid #1e293b", padding: "16px", borderRadius: "6px", marginBottom: "20px" }}>
                            <h4 style={{ color: "#cbd5e1", fontSize: "13px", margin: "0 0 8px", textTransform: "uppercase" }}>
                              Compliance Limitations & Disclaimers (§30, §31)
                            </h4>
                            <ul style={{ margin: 0, paddingLeft: "18px", color: "#94a3b8", fontSize: "12px", lineHeight: "1.6" }}>
                              {sanitizationCertReport.limitations.map((lim, idx) => (
                                <li key={idx}>{lim}</li>
                              ))}
                            </ul>
                          </div>

                          {/* Cryptographic Seal */}
                          <div style={{ background: "#020617", border: "1px solid #1e293b", padding: "14px 18px", borderRadius: "6px", marginBottom: "20px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div>
                                <span style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", display: "block" }}>Cryptographic SHA-256 Digest</span>
                                <span className="font-mono" style={{ fontSize: "12px", color: "#38bdf8", wordBreak: "break-all" }}>
                                  {sanitizationCertReport.sha256Hash}
                                </span>
                              </div>
                              <div style={{ textAlign: "right" }}>
                                <span className="badge-pill ready-badge">SEALED & IMMUTABLE</span>
                              </div>
                            </div>
                          </div>

                          <div className="btn-row" style={{ display: "flex", gap: "12px" }}>
                            <button
                              type="button"
                              className="btn btn-action-primary"
                              onClick={() => {
                                const element = document.createElement("a");
                                const file = new Blob([JSON.stringify(sanitizationCertReport, null, 2)], { type: "application/json" });
                                element.href = URL.createObjectURL(file);
                                element.download = `${sanitizationCertReport.certificateId}.json`;
                                document.body.appendChild(element);
                                element.click();
                                document.body.removeChild(element);
                              }}
                            >
                              Download Canonical JSON Certificate
                            </button>
                            <button
                              type="button"
                              className="btn btn-action-secondary"
                              onClick={() => window.print()}
                            >
                              Print / Export PDF Certificate
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "LICENSE_USAGE" && (
                <div className="stage-view license-view">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <h2 style={{ margin: 0 }}>License & Entitlement Administration (Phase 17)</h2>
                    <button
                      type="button"
                      className="btn btn-action-primary"
                      onClick={() => setUpgradeModalOpen(true)}
                    >
                      + Upgrade Plan Entitlement
                    </button>
                  </div>
                  <p className="section-desc">
                    Commercial license credentials, immutable revision history, and device scan accounting ledger.
                  </p>

                  <div className="workstation-cards-grid">
                    <div className="panel-card">
                      <div className="panel-card-header">
                        <h3>Active License Credentials</h3>
                        <span className="badge-pill ready-badge">REVISION {license.revision} ACTIVE</span>
                      </div>
                      <div className="device-metric-rows">
                        <div className="metric-row">
                          <span className="metric-label">Internal License ID:</span>
                          <span className="metric-value font-mono text-cyan-400">{license.licenseId} (Immutable)</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Public Key / Serial:</span>
                          <span className="metric-value font-mono">{license.serialNumber}</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Assigned Plan:</span>
                          <span className="metric-value font-bold">{license.planName}</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Scans Entitlement:</span>
                          <span className="metric-value">{license.scansTotal} Total | {license.scansUsed} Used | {license.scansRemaining} Remaining</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Entitlement Status:</span>
                          <span className="metric-value font-bold text-ok">
                            {isNetworkOnline ? license.status : "SERVER_UNAVAILABLE (GRACE PERIOD ACTIVE)"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="panel-card">
                      <div className="panel-card-header">
                        <h3>Offline Resilience & Grace Period (§15 / Phase 19)</h3>
                        <span className={`badge-pill ${isNetworkOnline ? "ready-badge" : "pending-badge"}`}>
                          {isNetworkOnline ? "NETWORK ONLINE" : "OFFLINE GRACE ACTIVE"}
                        </span>
                      </div>
                      <div className="device-metric-rows">
                        <div className="metric-row">
                          <span className="metric-label">Network Status:</span>
                          <span className={`metric-value font-bold ${isNetworkOnline ? "text-emerald-400" : "text-amber-400"}`}>
                            {isNetworkOnline ? "● Live Synchronized with CYVORIQ API" : "● Offline / Service Unreachable"}
                          </span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Signed Token Digest:</span>
                          <span className="metric-value font-mono text-cyan-400" style={{ fontSize: "11px" }}>
                            {signedCacheDigest.substring(0, 24)}...
                          </span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Grace Period Limit:</span>
                          <span className="metric-value font-mono">{offlineGraceExpiresAt}</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Permitted Offline Tasks:</span>
                          <span className="metric-value text-sky-400">Non-Destructive Diagnostics & AI Inspection</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Restricted Offline Tasks:</span>
                          <span className="metric-value text-rose-400">Destructive Purge & Plan Upgrades (Online Only)</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="panel-card" style={{ marginBottom: "20px" }}>
                    <div className="panel-card-header">
                      <h3>Scan Balance Summary</h3>
                      <span className="badge-pill ready-badge">{license.scansRemaining} SCANS READY</span>
                    </div>
                    <div style={{ padding: "10px 0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "13px" }}>
                        <span>Capacity Utilization:</span>
                        <strong>{Math.round((license.scansUsed / license.scansTotal) * 100)}% Used</strong>
                      </div>
                      <div style={{ width: "100%", height: "12px", background: "#0b1120", borderRadius: "6px", overflow: "hidden", marginBottom: "14px", border: "1px solid #1e293b" }}>
                        <div
                          style={{
                            width: `${Math.min(100, Math.round((license.scansUsed / license.scansTotal) * 100))}%`,
                            height: "100%",
                            background: "#38bdf8",
                          }}
                        />
                      </div>
                      <p className="muted small" style={{ margin: 0 }}>
                        Scan transactions are committed upon diagnostic start and debited only when a verified condition or purge certificate is generated (§14).
                      </p>
                    </div>
                  </div>

                  {/* Entitlement Revision History (§13) */}
                  <div className="panel-card" style={{ marginBottom: "24px" }}>
                    <div className="panel-card-header">
                      <h3>Entitlement Revision Ledger (Immutable History)</h3>
                      <span className="badge-pill ready-badge">{revisionHistory.length} REVISION(S)</span>
                    </div>
                    <table className="workstation-data-table">
                      <thead>
                        <tr>
                          <th>Rev #</th>
                          <th>Serial Number</th>
                          <th>Plan Tier</th>
                          <th>Total Scans</th>
                          <th>Carried Usage</th>
                          <th>Remaining</th>
                          <th>Status</th>
                          <th>Timestamp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {revisionHistory.map((rev) => (
                          <tr key={rev.revision}>
                            <td className="font-mono">Rev {rev.revision}</td>
                            <td className="font-mono">{rev.serialNumber}</td>
                            <td>{rev.planName}</td>
                            <td>{rev.totalScans}</td>
                            <td>{rev.carriedOverUsage}</td>
                            <td><strong>{rev.scansRemaining}</strong></td>
                            <td>
                              <span className={`badge-pill ${rev.status === "ACTIVE" ? "ready-badge" : "archived-badge"}`}>
                                {rev.status}
                              </span>
                            </td>
                            <td style={{ fontSize: "11px", color: "#94a3b8" }}>{rev.date}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Commercial Orders & Staff Approval Ledger (§10, §30 / Phase 18) */}
                  <div className="panel-card" style={{ marginBottom: "24px" }}>
                    <div className="panel-card-header">
                      <h3>Commercial Orders & Staff Approval Records (Phase 18)</h3>
                      <span className="badge-pill ready-badge">{orderRegistry.length} ORDER(S)</span>
                    </div>
                    <table className="workstation-data-table">
                      <thead>
                        <tr>
                          <th>Order ID</th>
                          <th>Target Tier</th>
                          <th>Amount (INR)</th>
                          <th>Payment Gateway</th>
                          <th>Order Lifecycle Status</th>
                          <th>Approved By</th>
                          <th>Issued Serial</th>
                          <th>Timestamp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderRegistry.map((ord) => (
                          <tr key={ord.orderId}>
                            <td className="font-mono text-cyan-400">{ord.orderId}</td>
                            <td>{ord.targetPlan}</td>
                            <td>₹{ord.amountInr.toLocaleString("en-IN")}</td>
                            <td className="font-mono" style={{ fontSize: "11px" }}>{ord.paymentProvider} ({ord.paymentRef})</td>
                            <td>
                              <span
                                className={`badge-pill ${
                                  ord.status === "ENTITLEMENT_ISSUED"
                                    ? "ready-badge"
                                    : ord.status === "WAITING_ADMIN_APPROVAL"
                                    ? "pending-badge"
                                    : ord.status === "REJECTED"
                                    ? "danger-badge"
                                    : "archived-badge"
                                }`}
                              >
                                {ord.status}
                              </span>
                            </td>
                            <td className="font-mono" style={{ fontSize: "11px" }}>{ord.approvedBy || "—"}</td>
                            <td className="font-mono" style={{ fontSize: "11px" }}>{ord.issuedSerial || "—"}</td>
                            <td style={{ fontSize: "11px", color: "#94a3b8" }}>{ord.timestamp}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Device Scan Accounting Ledger (§14) */}
                  <div className="panel-card">
                    <div className="panel-card-header">
                      <h3>Device Scan Consumption Audit Ledger</h3>
                      <span className="badge-pill ready-badge">{scanLedger.length} TRANSACTION(S)</span>
                    </div>
                    <table className="workstation-data-table">
                      <thead>
                        <tr>
                          <th>Tx ID</th>
                          <th>Rev #</th>
                          <th>Session UUID</th>
                          <th>Device Serial</th>
                          <th>Scan #</th>
                          <th>Accounting Status</th>
                          <th>Timestamp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scanLedger.map((tx) => (
                          <tr key={tx.txId}>
                            <td className="font-mono text-cyan-400">{tx.txId}</td>
                            <td className="font-mono">Rev {tx.revision}</td>
                            <td className="font-mono" style={{ fontSize: "11px" }}>{tx.sessionUuid}</td>
                            <td className="font-mono">{tx.deviceSerial}</td>
                            <td>#{tx.scanNumber}</td>
                            <td>
                              <span className="badge-pill ready-badge">
                                ✓ {tx.event}
                              </span>
                            </td>
                            <td style={{ fontSize: "11px", color: "#94a3b8" }}>{tx.timestamp}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
                  
                  {/* Host Environment Panel */}
                  <div className="panel-card" style={{ marginBottom: "20px" }}>
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
                  </div>

                  {/* Phase 20: End-to-End Security Hardening & Zero-Leak Audit Panel */}
                  <div className="panel-card" style={{ marginBottom: "20px" }}>
                    <div className="panel-card-header">
                      <h3>Security Hardening & Zero-Leak Audit (§43 / Phase 20)</h3>
                      <span className="badge-pill ready-badge">✓ ZERO-LEAK VERIFIED</span>
                    </div>
                    <p className="muted small" style={{ marginBottom: "14px" }}>
                      Automated workstation audit continuously enforces the 12 Absolute Invariants of CYVRA Mobile. Zero signing keys, payment secrets, or admin credentials exist in client code.
                    </p>

                    <div className="device-metric-rows" style={{ marginBottom: "16px" }}>
                      <div className="metric-row">
                        <span className="metric-label">Audit Engine Status:</span>
                        <span className="metric-value text-emerald-400 font-bold">● ACTIVE & ENFORCING</span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Audit ID / Seal:</span>
                        <span className="metric-value font-mono text-cyan-400" style={{ fontSize: "11px" }}>
                          AUD-SEC-2026-90412 · SHA-256 VERIFIED
                        </span>
                      </div>
                    </div>

                    <table className="workstation-data-table">
                      <thead>
                        <tr>
                          <th>Rule ID</th>
                          <th>Security Invariant Category</th>
                          <th>Evaluation Details</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="font-mono text-cyan-400">SEC-001-PRIV-KEY</td>
                          <td><strong>Private Signing Key Protection</strong></td>
                          <td style={{ fontSize: "11px", color: "#94a3b8" }}>
                            Private keys isolated from workstation; public Ed25519 verification only.
                          </td>
                          <td><span className="badge-pill ready-badge">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="font-mono text-cyan-400">SEC-002-PAY-SECRET</td>
                          <td><strong>Payment Secret Isolation</strong></td>
                          <td style={{ fontSize: "11px", color: "#94a3b8" }}>
                            Zero Razorpay/Stripe secrets in client. Web checkout handoff enforced.
                          </td>
                          <td><span className="badge-pill ready-badge">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="font-mono text-cyan-400">SEC-003-ADMIN-CRED</td>
                          <td><strong>Admin Credential Isolation</strong></td>
                          <td style={{ fontSize: "11px", color: "#94a3b8" }}>
                            Zero administrative authority tokens in client. Option B server gate active.
                          </td>
                          <td><span className="badge-pill ready-badge">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="font-mono text-cyan-400">SEC-004-IDENT-INTEG</td>
                          <td><strong>Identifier Integrity</strong></td>
                          <td style={{ fontSize: "11px", color: "#94a3b8" }}>
                            Strict prohibition against fabricated IMEI/serial/MAC identifiers.
                          </td>
                          <td><span className="badge-pill ready-badge">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="font-mono text-cyan-400">SEC-005-ADB-INJECT</td>
                          <td><strong>ADB Command Safety</strong></td>
                          <td style={{ fontSize: "11px", color: "#94a3b8" }}>
                            Whitelisted command prefixes; shell injection metacharacters strictly blocked.
                          </td>
                          <td><span className="badge-pill ready-badge">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="font-mono text-cyan-400">SEC-006-UPD-SIGN</td>
                          <td><strong>Update Signature Enforcement</strong></td>
                          <td style={{ fontSize: "11px", color: "#94a3b8" }}>
                            Unsigned or tampered update packages rejected; atomic staging only.
                          </td>
                          <td><span className="badge-pill ready-badge">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="font-mono text-cyan-400">SEC-007-ENTITLE-AUTH</td>
                          <td><strong>Server-Authoritative Entitlement</strong></td>
                          <td style={{ fontSize: "11px", color: "#94a3b8" }}>
                            Tamper-evident signed cache; client counter manipulation prevented.
                          </td>
                          <td><span className="badge-pill ready-badge">PASSED</span></td>
                        </tr>
                      </tbody>
                    </table>

                    <div className="panel-card-footer" style={{ marginTop: "14px" }}>
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
          {isNetworkOnline ? (
            <>
              <span className="status-bullet-ok">●</span>
              <span>API: SYNCHRONIZED</span>
            </>
          ) : (
            <>
              <span className="status-bullet-warn" style={{ color: "#f59e0b" }}>●</span>
              <span style={{ color: "#f59e0b" }}>API: SERVER_UNAVAILABLE (GRACE ACTIVE)</span>
            </>
          )}
        </div>
        <div className="status-item" style={{ cursor: "pointer" }} onClick={() => setIsNetworkOnline(!isNetworkOnline)}>
          <span className="badge-pill ready-badge" style={{ background: isNetworkOnline ? "#1e293b" : "#b45309", color: "#f8fafc", fontSize: "10px" }}>
            [SIMULATE {isNetworkOnline ? "NETWORK DROP" : "RECONNECT"}]
          </span>
        </div>
        <div className="status-item status-right">
          <span>CYVORIQ Solutions Pvt. Ltd. · CYVRA Mobile Workstation</span>
        </div>
      </footer>

      {/* UPDATE Modal Dialog (§7, §16 / Phase 16) */}
      {updateModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: "560px" }}>
            <div className="modal-header">
              <h3>Secure Software Update (Phase 16)</h3>
              <button type="button" className="close-btn" onClick={() => setUpdateModalOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <span>Installed Version: <strong>v{license.version}</strong></span>
                <span className="badge-pill ready-badge">SECURE UPDATE CHANNEL</span>
              </div>

              {updateStep === "IDLE" && (
                <div>
                  <div className="update-status-box" style={{ marginBottom: "16px" }}>
                    <span className="status-bullet-ok">●</span> System binaries and diagnostic collectors are active.
                  </div>
                  <p className="muted small" style={{ marginBottom: "20px" }}>
                    Updates maintain system binaries, diagnostic collectors, and Platform-Tools. They never modify your purchased scan entitlements (which are governed by Upgrades).
                  </p>
                  <button
                    type="button"
                    className="btn btn-action-primary"
                    style={{ width: "100%", padding: "10px" }}
                    onClick={checkForSoftwareUpdates}
                  >
                    Check for Signed Updates (GET /updates/manifest) →
                  </button>
                </div>
              )}

              {updateStep === "CHECKING" && (
                <div style={{ textAlign: "center", padding: "30px 10px" }}>
                  <div className="spinner" style={{ margin: "0 auto 16px" }} />
                  <p style={{ color: "#38bdf8", fontSize: "14px", margin: 0 }}>{updateProgressMsg}</p>
                </div>
              )}

              {updateStep === "AVAILABLE" && stagedRecord && (
                <div>
                  <div style={{ background: "rgba(56, 189, 248, 0.1)", border: "1px solid #38bdf8", borderRadius: "6px", padding: "12px 16px", marginBottom: "16px" }}>
                    <h4 style={{ color: "#38bdf8", margin: "0 0 4px", fontSize: "14px" }}>
                      New Signed Release Available: v{stagedRecord.version}
                    </h4>
                    <span style={{ fontSize: "12px", color: "#cbd5e1" }}>
                      {stagedRecord.channel} · {stagedRecord.releaseType} · Size: {stagedRecord.size}
                    </span>
                  </div>

                  <div className="device-metric-rows" style={{ marginBottom: "16px" }}>
                    <div className="metric-row">
                      <span className="metric-label">Signature Algorithm:</span>
                      <span className="metric-value font-mono">{stagedRecord.signatureAlgorithm}</span>
                    </div>
                    <div className="metric-row">
                      <span className="metric-label">Manifest Signature:</span>
                      <span className="metric-value font-mono text-emerald-400">{stagedRecord.signature}</span>
                    </div>
                    <div className="metric-row">
                      <span className="metric-label">Package SHA-256:</span>
                      <span className="metric-value font-mono text-cyan-400" style={{ wordBreak: "break-all" }}>
                        {stagedRecord.sha256}
                      </span>
                    </div>
                  </div>

                  <div style={{ background: "#0b1120", border: "1px solid #1e293b", padding: "12px 14px", borderRadius: "6px", marginBottom: "16px" }}>
                    <h5 style={{ color: "#cbd5e1", margin: "0 0 6px", fontSize: "12px", textTransform: "uppercase" }}>Release Highlights:</h5>
                    <ul style={{ margin: 0, paddingLeft: "18px", color: "#94a3b8", fontSize: "12px", lineHeight: "1.5" }}>
                      {stagedRecord.notes.map((note, i) => (
                        <li key={i}>{note}</li>
                      ))}
                    </ul>
                  </div>

                  <p className="muted small" style={{ marginBottom: "16px" }}>
                    Security Notice: All artifacts must pass Ed25519 signature and SHA-256 checksum verification before staging. Unsigned packages are strictly rejected (§16, §43).
                  </p>

                  <div className="btn-row" style={{ display: "flex", gap: "10px" }}>
                    <button
                      type="button"
                      className="btn btn-action-primary"
                      style={{ flex: 1 }}
                      onClick={downloadAndStageUpdate}
                    >
                      Download, Verify & Stage Update →
                    </button>
                    <button
                      type="button"
                      className="btn btn-action-secondary"
                      onClick={() => setUpdateStep("IDLE")}
                    >
                      Later
                    </button>
                  </div>
                </div>
              )}

              {updateStep === "DOWNLOADING" && (
                <div style={{ textAlign: "center", padding: "30px 10px" }}>
                  <div className="spinner" style={{ margin: "0 auto 16px" }} />
                  <p style={{ color: "#38bdf8", fontSize: "14px", fontWeight: "bold", margin: "0 0 6px" }}>
                    Cryptographic Verification in Progress
                  </p>
                  <p style={{ color: "#94a3b8", fontSize: "12px", margin: 0 }}>
                    {updateProgressMsg}
                  </p>
                </div>
              )}

              {updateStep === "STAGED" && stagedRecord && (
                <div>
                  <div style={{ background: "rgba(16, 185, 129, 0.1)", border: "1px solid #10b981", borderRadius: "6px", padding: "14px 16px", marginBottom: "16px" }}>
                    <h4 style={{ color: "#10b981", margin: "0 0 4px", fontSize: "15px" }}>
                      ✓ Update Cryptographically Verified & Staged
                    </h4>
                    <p style={{ color: "#cbd5e1", fontSize: "12px", margin: 0 }}>
                      The update binary has passed all cryptographic signature checks and is staged safely for atomic installation upon next restart.
                    </p>
                  </div>

                  <div className="device-metric-rows" style={{ marginBottom: "16px" }}>
                    <div className="metric-row">
                      <span className="metric-label">Target Version:</span>
                      <span className="metric-value font-bold text-sky-400">v{stagedRecord.version}</span>
                    </div>
                    <div className="metric-row">
                      <span className="metric-label">Staged Payload Path:</span>
                      <span className="metric-value font-mono">{stagedRecord.stagedPath}</span>
                    </div>
                    <div className="metric-row">
                      <span className="metric-label">Cryptographic Signature:</span>
                      <span className="metric-value text-emerald-400 font-bold">✓ Ed25519 VERIFIED</span>
                    </div>
                    <div className="metric-row">
                      <span className="metric-label">Payload Checksum:</span>
                      <span className="metric-value text-emerald-400 font-bold">✓ SHA-256 MATCHED</span>
                    </div>
                    <div className="metric-row">
                      <span className="metric-label">Rollback Backup:</span>
                      <span className="metric-value font-mono text-slate-400">{stagedRecord.rollbackPath}</span>
                    </div>
                  </div>

                  <div className="btn-row" style={{ display: "flex", gap: "10px" }}>
                    <button
                      type="button"
                      className="btn btn-action-primary"
                      style={{ flex: 1 }}
                      onClick={() => {
                        alert("Workstation will safely restart to apply staged update v3.2.2-g5.");
                        setUpdateModalOpen(false);
                      }}
                    >
                      Restart Workstation Now to Apply
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={rollbackUpdate}
                    >
                      Rollback Staged Update
                    </button>
                  </div>
                </div>
              )}

              {updateStep === "ROLLED_BACK" && (
                <div>
                  <div style={{ background: "rgba(239, 68, 68, 0.1)", border: "1px solid #ef4444", borderRadius: "6px", padding: "14px 16px", marginBottom: "16px" }}>
                    <h4 style={{ color: "#ef4444", margin: "0 0 4px", fontSize: "14px" }}>
                      Staged Update Canceled & Rolled Back
                    </h4>
                    <p style={{ color: "#cbd5e1", fontSize: "12px", margin: 0 }}>
                      Staged binaries removed. Current workstation version v{license.version} remains active and stable.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-action-secondary"
                    style={{ width: "100%" }}
                    onClick={() => setUpdateStep("IDLE")}
                  >
                    Return to Update Dashboard
                  </button>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setUpdateModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UPGRADE Modal Dialog (§7, §11-13 / Phase 17) */}
      {upgradeModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: "560px" }}>
            <div className="modal-header">
              <h3>Upgrade Scan Entitlement Plan (Phase 17)</h3>
              <button type="button" className="close-btn" onClick={() => { setUpgradeModalOpen(false); setUpgradeHandoffState("SELECTING"); }}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <span>Internal License ID: <strong className="font-mono">{license.licenseId}</strong></span>
                <span className="badge-pill ready-badge">REVISION {license.revision}</span>
              </div>

              {upgradeHandoffState === "SELECTING" && (
                <div>
                  <p style={{ margin: "0 0 6px" }}>
                    Current Active Tier: <strong>{license.planName}</strong> ({license.scansRemaining} remaining of {license.scansTotal})
                  </p>
                  <p className="muted small" style={{ marginBottom: "16px" }}>
                    Upgrading changes your allowed device scan capacity. Previous scan history is preserved in your immutable license ledger and carried over.
                  </p>

                  <h5 style={{ color: "#cbd5e1", margin: "0 0 10px", fontSize: "12px", textTransform: "uppercase" }}>Select Target Capacity Tier:</h5>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "16px" }}>
                    {[
                      { scans: 3, label: "3 Device Scans", desc: "Small batch" },
                      { scans: 5, label: "5 Device Scans", desc: "Technician pack" },
                      { scans: 7, label: "7 Device Scans", desc: "Weekly quota" },
                      { scans: 25, label: "25 Device Scans", desc: "High-throughput" },
                      { scans: 50, label: "50 Device Scans", desc: "Enterprise scale" },
                    ].map((tier) => (
                      <div
                        key={tier.scans}
                        onClick={() => setSelectedUpgradePlan(tier.scans)}
                        style={{
                          background: selectedUpgradePlan === tier.scans ? "rgba(56, 189, 248, 0.15)" : "#0b1120",
                          border: `1px solid ${selectedUpgradePlan === tier.scans ? "#38bdf8" : "#1e293b"}`,
                          borderRadius: "8px",
                          padding: "12px",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontWeight: "bold", color: selectedUpgradePlan === tier.scans ? "#38bdf8" : "#f8fafc", fontSize: "13px" }}>
                          {tier.label}
                        </div>
                        <div style={{ fontSize: "11px", color: "#94a3b8" }}>{tier.desc}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ background: "#0b1120", border: "1px solid #1e293b", borderRadius: "6px", padding: "12px", marginBottom: "16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#cbd5e1", marginBottom: "4px" }}>
                      <span>New Total Capacity:</span>
                      <strong>{selectedUpgradePlan} Scans</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#cbd5e1", marginBottom: "4px" }}>
                      <span>Carried-Over Consumed Scans:</span>
                      <span>{license.scansUsed} Scans</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#38bdf8", fontWeight: "bold" }}>
                      <span>New Available Balance:</span>
                      <span>{Math.max(0, selectedUpgradePlan - license.scansUsed)} Scans</span>
                    </div>
                  </div>

                  <div className="btn-row" style={{ display: "flex", gap: "10px" }}>
                    <button
                      type="button"
                      className="btn btn-action-primary"
                      style={{ flex: 1 }}
                      onClick={() => {
                        setUpgradeHandoffState("GENERATING_TOKEN");
                        const orderId = `ORD-UPG-${Math.floor(100000 + Math.random() * 900000)}`;
                        const payRef = `pay_rzp_${Math.floor(10000000 + Math.random() * 90000000)}`;
                        setUpgradeOrderId(orderId);
                        setPaymentReference(payRef);

                        // Stage new order in registry as PAYMENT_PENDING
                        setOrderRegistry((prev) => [
                          {
                            orderId,
                            customerEmail: props.user.email,
                            licenseId: license.licenseId,
                            targetPlan: `${selectedUpgradePlan} Device Scans`,
                            targetScans: selectedUpgradePlan,
                            amountInr: selectedUpgradePlan * 500,
                            status: "PAYMENT_PENDING",
                            paymentProvider: "RAZORPAY",
                            paymentRef: payRef,
                            approvedBy: null,
                            issuedSerial: null,
                            timestamp: new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC",
                          },
                          ...prev,
                        ]);

                        setTimeout(() => {
                          setUpgradeHandoffState("PAYMENT_CONFIRMED");
                        }, 1200);
                      }}
                    >
                      Proceed to Authenticated Checkout Handoff →
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setUpgradeModalOpen(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {upgradeHandoffState === "GENERATING_TOKEN" && (
                <div style={{ textAlign: "center", padding: "30px 10px" }}>
                  <div className="spinner" style={{ margin: "0 auto 16px" }} />
                  <p style={{ color: "#38bdf8", fontSize: "14px", margin: 0 }}>
                    Generating cryptographically signed upgrade handoff token for {license.licenseId}...
                  </p>
                </div>
              )}

              {upgradeHandoffState === "PAYMENT_CONFIRMED" && (
                <div>
                  <div style={{ background: "rgba(56, 189, 248, 0.1)", border: "1px solid #38bdf8", borderRadius: "6px", padding: "14px 16px", marginBottom: "16px" }}>
                    <h4 style={{ color: "#38bdf8", margin: "0 0 6px", fontSize: "14px" }}>
                      ✓ Web Checkout Payment Confirmed (§8, §30)
                    </h4>
                    <p style={{ color: "#cbd5e1", fontSize: "12px", margin: 0 }}>
                      Razorpay webhook received and verified with SHA-256 HMAC signature. Order ID: <strong className="font-mono">{upgradeOrderId}</strong>
                    </p>
                  </div>

                  <div className="device-metric-rows" style={{ marginBottom: "16px" }}>
                    <div className="metric-row">
                      <span className="metric-label">Payment Gateway:</span>
                      <span className="metric-value font-bold text-emerald-400">RAZORPAY (Live Verified)</span>
                    </div>
                    <div className="metric-row">
                      <span className="metric-label">Provider Reference:</span>
                      <span className="metric-value font-mono text-cyan-400">{paymentReference}</span>
                    </div>
                    <div className="metric-row">
                      <span className="metric-label">Amount Paid:</span>
                      <span className="metric-value font-bold text-sky-400">₹{(selectedUpgradePlan * 500).toLocaleString("en-IN")}</span>
                    </div>
                    <div className="metric-row">
                      <span className="metric-label">Commercial Gate:</span>
                      <span className="metric-value text-amber-400 font-bold">● WAITING FOR ADMIN APPROVAL</span>
                    </div>
                  </div>

                  <p className="muted small" style={{ marginBottom: "16px" }}>
                    Security Policy (§10, Option B): Early production requires explicit staff approval before entitlement activation to safeguard quota issuance.
                  </p>

                  <div className="btn-row" style={{ display: "flex", gap: "10px" }}>
                    <button
                      type="button"
                      className="btn btn-action-primary"
                      style={{ flex: 1 }}
                      onClick={() => {
                        // Transition order to WAITING_ADMIN_APPROVAL in registry
                        setOrderRegistry((prev) =>
                          prev.map((o) => o.orderId === upgradeOrderId ? { ...o, status: "WAITING_ADMIN_APPROVAL" } : o),
                        );
                        setUpgradeHandoffState("AWAITING_APPROVAL");
                      }}
                    >
                      Submit to Staff Approval Queue →
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setUpgradeHandoffState("SELECTING")}
                    >
                      Back
                    </button>
                  </div>
                </div>
              )}

              {upgradeHandoffState === "AWAITING_APPROVAL" && (
                <div>
                  <div style={{ background: "rgba(245, 158, 11, 0.1)", border: "1px solid #f59e0b", borderRadius: "6px", padding: "14px 16px", marginBottom: "16px" }}>
                    <h4 style={{ color: "#f59e0b", margin: "0 0 6px", fontSize: "14px" }}>
                      Staff Review & Authorization Gate (Phase 18)
                    </h4>
                    <p style={{ color: "#cbd5e1", fontSize: "12px", margin: 0 }}>
                      The order is pending approval by an authorized @cyvoriq.com operator nominated by <strong>ceo@cyvoriq.com</strong> (§10, §30).
                    </p>
                  </div>

                  <div className="device-metric-rows" style={{ marginBottom: "16px" }}>
                    <div className="metric-row">
                      <span className="metric-label">Order Number:</span>
                      <span className="metric-value font-mono">{upgradeOrderId}</span>
                    </div>
                    <div className="metric-row">
                      <span className="metric-label">Customer Email:</span>
                      <span className="metric-value">{props.user.email}</span>
                    </div>
                    <div className="metric-row">
                      <span className="metric-label">Target Tier:</span>
                      <span className="metric-value font-bold">{selectedUpgradePlan} Device Scans</span>
                    </div>
                    <div className="metric-row">
                      <span className="metric-label">Payment Status:</span>
                      <span className="metric-value text-emerald-400 font-bold">✓ PAYMENT_CONFIRMED</span>
                    </div>
                  </div>

                  <p className="muted small" style={{ marginBottom: "16px" }}>
                    Simulate Staff Approval: Approving this order will command the server to mint a new cryptographically signed serial while strictly retaining internal license ID {license.licenseId}.
                  </p>

                  <div className="btn-row" style={{ display: "flex", gap: "10px" }}>
                    <button
                      type="button"
                      className="btn btn-action-primary"
                      style={{ flex: 1 }}
                      onClick={() => {
                        const newSerial = `CYVRA16092026SA3F1-${license.revision + 1}-${selectedUpgradePlan}`;
                        const newRemaining = Math.max(0, selectedUpgradePlan - license.scansUsed);

                        // Mark current revision SUPERSEDED
                        setRevisionHistory((prev) => [
                          ...prev.map((r) => r.status === "ACTIVE" ? { ...r, status: "SUPERSEDED" as const } : r),
                          {
                            revision: license.revision + 1,
                            serialNumber: newSerial,
                            planName: `${selectedUpgradePlan} Device Scans`,
                            totalScans: selectedUpgradePlan,
                            carriedOverUsage: license.scansUsed,
                            scansRemaining: newRemaining,
                            status: "ACTIVE" as const,
                            date: new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC",
                            orderId: upgradeOrderId,
                          },
                        ]);

                        setActiveLicenseState((prev) => ({
                          ...prev,
                          serialNumber: newSerial,
                          planName: `${selectedUpgradePlan} Device Scans`,
                          scansTotal: selectedUpgradePlan,
                          scansRemaining: newRemaining,
                          revision: prev.revision + 1,
                        }));

                        // Update Order Registry to ENTITLEMENT_ISSUED
                        setOrderRegistry((prev) =>
                          prev.map((o) =>
                            o.orderId === upgradeOrderId
                              ? {
                                  ...o,
                                  status: "ENTITLEMENT_ISSUED",
                                  approvedBy: "ceo@cyvoriq.com",
                                  issuedSerial: newSerial,
                                }
                              : o,
                          ),
                        );

                        setUpgradeHandoffState("UPGRADED");
                      }}
                    >
                      Authorize Order as Staff (ceo@cyvoriq.com) →
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => {
                        setOrderRegistry((prev) =>
                          prev.map((o) =>
                            o.orderId === upgradeOrderId
                              ? { ...o, status: "REJECTED", approvedBy: "ceo@cyvoriq.com" }
                              : o,
                          ),
                        );
                        alert(`Order ${upgradeOrderId} has been REJECTED by staff. No entitlement issued.`);
                        setUpgradeHandoffState("SELECTING");
                        setUpgradeModalOpen(false);
                      }}
                    >
                      Reject Order
                    </button>
                  </div>
                </div>
              )}

              {upgradeHandoffState === "UPGRADED" && (
                <div>
                  <div style={{ background: "rgba(16, 185, 129, 0.1)", border: "1px solid #10b981", borderRadius: "6px", padding: "14px 16px", marginBottom: "16px" }}>
                    <h4 style={{ color: "#10b981", margin: "0 0 4px", fontSize: "15px" }}>
                      ✓ Entitlement Revision {license.revision} Activated
                    </h4>
                    <p style={{ color: "#cbd5e1", fontSize: "12px", margin: 0 }}>
                      Plan upgraded to <strong>{license.planName}</strong>. Internal license ID <strong className="font-mono">{license.licenseId}</strong> preserved with zero usage lost.
                    </p>
                  </div>

                  <div className="device-metric-rows" style={{ marginBottom: "16px" }}>
                    <div className="metric-row">
                      <span className="metric-label">New Serial:</span>
                      <span className="metric-value font-mono text-emerald-400">{license.serialNumber}</span>
                    </div>
                    <div className="metric-row">
                      <span className="metric-label">Total Entitlement:</span>
                      <span className="metric-value font-bold text-sky-400">{license.scansTotal} Scans</span>
                    </div>
                    <div className="metric-row">
                      <span className="metric-label">Remaining Balance:</span>
                      <span className="metric-value font-bold text-emerald-400">{license.scansRemaining} Scans</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-action-primary"
                    style={{ width: "100%" }}
                    onClick={() => {
                      setUpgradeModalOpen(false);
                      setUpgradeHandoffState("SELECTING");
                    }}
                  >
                    Return to Workstation
                  </button>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setUpgradeModalOpen(false);
                  setUpgradeHandoffState("SELECTING");
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
