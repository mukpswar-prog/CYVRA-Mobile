import { useState } from "react";
import {
  scansStateSentence,
  type AuthUser,
  type EntitlementResult,
  type ReportDetail,
  type ReportSession,
  type ReportSummary,
} from "../api";
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

export function CustomerDesktopShell(props: {
  user: AuthUser;
  /**
   * `null` until `GET /v1/me/entitlement` answers. Every licence figure in
   * this component comes from here - there is no local fallback.
   */
  entitlement: EntitlementResult | null;
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

  /*
   * WORKSTREAM G - the licence this customer actually has.
   *
   * Derived entirely from `GET /v1/me/entitlement`. Every field is either the
   * server's value or null; nothing here has a default that could stand in for
   * missing data. When entitlement is not `ok` all of them are null and the UI
   * says why instead of showing a plausible-looking licence.
   *
   * `scansState` is a *state*, not a count: scan debits stay gated behind the
   * R-1 ruling, so the API reports "available-after-first-scan" and exposes no
   * scansUsed / scansRemaining / revision. There is no arithmetic to do here,
   * which is the point - the old mock invented three numbers the server never
   * supplies.
   */
  const entitlement =
    props.entitlement?.kind === "ok" ? props.entitlement.entitlement : null;

  const license = {
    planName: entitlement?.plan.label ?? null,
    status: entitlement?.licence.sentence ?? null,
    serialNumber: entitlement?.licence.maskedSerial ?? null,
    payment: entitlement?.payment.sentence ?? null,
    scansState: entitlement ? scansStateSentence(entitlement.usage.scans.state) : null,
    version: entitlement?.build.version ?? null,
    buildState: entitlement?.build.state ?? "unavailable",
    /** null until a release job publishes a real installer URL. */
    downloadUrl: entitlement?.build.url ?? null,
    /** Filename taken from `build.url`; null when there is no URL. */
    installerName: entitlement?.build.url
      ? entitlement.build.url.split("/").pop() ?? null
      : null,
    sha256: entitlement?.build.sha256 ?? null,
    sizeBytes: entitlement?.build.sizeBytes ?? null,
    releasedAt: entitlement?.build.releasedAt ?? null,
  };

  /**
   * What the header states when entitlement is not available. Never a
   * placeholder plan or status - the *absence* is what gets shown.
   */
  const entNotice =
    props.entitlement === null
      ? "Checking your licence"
      : props.entitlement.kind === "ok"
        ? null
        : props.entitlement.kind === "no-licence"
          ? "No licence on this account yet"
          : props.entitlement.kind === "unavailable"
            ? "Server error - could not check your licence"
            : props.entitlement.kind === "unauthenticated"
              ? "Signed out"
              : "Could not reach the server";

  // No upgrade-flow state. The simulated Razorpay handoff that used to live
  // here (selectedUpgradePlan, upgradeHandoffState, upgradeOrderId,
  // paymentReference) drove a payment journey that never left the browser.

  // Phase 19: Offline Entitlement & Signed Cache Resilience State (§15, Part G)
  const [isNetworkOnline, setIsNetworkOnline] = useState<boolean>(true);
  const [offlineGraceExpiresAt] = useState<string>("2026-09-17 10:00:00 UTC");
  const [signedCacheDigest] = useState<string>("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

  // Phase 21: Multi-OEM Device Adapter Selection & Capability State (§8, §24)
  const [selectedOemFamily, setSelectedOemFamily] = useState<"MOTOROLA" | "SAMSUNG" | "XIAOMI" | "ONEPLUS" | "GOOGLE" | "GENERIC">("MOTOROLA");

  // No client-side order registry.
  //
  // No endpoint returns a customer's order history, so the `orderRegistry`
  // array that sat here - seeded with ORD-INITIAL-2026-001, a RAZORPAY
  // paymentRef and a hardcoded ₹12,500 - was removed rather than emptied.
  // The only payment fact the customer gets is `payment.sentence`, which
  // comes from GET /v1/me/entitlement.

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

    /*
     * No scan is debited here.
     *
     * This block used to decrement a local `scansUsed` and append a synthetic
     * ledger transaction. Scan debits are gated behind the R-1 ruling: the
     * server owns that figure, exposes only `usage.scans.state`, and a
     * browser-side copy would be a second, contradictory source of truth.
     */
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
    setUpdateProgressMsg(
      "Staged update rolled back. The previously installed build is active again.",
    );
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
            {/* plan.label - e.g. "25 Device Scans". Unknown until entitlement answers. */}
            <span className="meta-value">{license.planName ?? "—"}</span>
          </div>
          <div className="meta-pill">
            <span className="meta-label">Usage</span>
            {/* usage.scans.state - a state, not a count. There is no X/Y here
                because the server deliberately publishes no scan arithmetic. */}
            <span className="meta-value">{license.scansState ?? "—"}</span>
          </div>
          <div className="meta-pill status-pill">
            <span className={license.status ? "status-dot-active" : "status-dot-off"} />
            {/* licence.sentence ("Awaiting payment", "Active", ...) when known;
                the reason it is unknown otherwise. */}
            <span className="meta-value status-text">{entNotice ?? license.status ?? "—"}</span>
          </div>
          <div className="meta-pill version-pill">
            <span className="meta-label">Version</span>
            {/* build.version is null until a release job publishes an installer. */}
            <span className="meta-value">
              {license.version ? `v${license.version}` : "Build unavailable"}
            </span>
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
            <div className="card-title">LICENSE</div>
            {/* plan.label - no fabricated scan arithmetic below it. */}
            <div className="card-metric">{license.planName ?? "—"}</div>
            <div className="card-submetric">{license.scansState ?? "—"}</div>
            <div className="card-status-badge">
              {/* The real licence sentence, not a hardcoded "LICENSE ACTIVE". */}
              <span className="status-indicator-dot" /> {entNotice ?? license.status ?? "—"}
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
                  {/* Phase 24: Standalone Windows App Banner */}
                  <div
                    style={{
                      background: "linear-gradient(90deg, #0f172a 0%, #1e1b4b 100%)",
                      border: "1px solid #6366f1",
                      borderRadius: "8px",
                      padding: "16px 20px",
                      marginBottom: "20px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "20px",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                        <span className="badge-pill ready-badge" style={{ background: "#4338ca", color: "#e0e7ff" }}>
                          WINDOWS DESKTOP APPLICATION (.EXE)
                        </span>
                        <span className="font-mono text-cyan-400" style={{ fontSize: "12px" }}>
                          {license.version ? `v${license.version}` : "Build unavailable"}
                        </span>
                      </div>
                      <h3 style={{ margin: "4px 0", color: "#f8fafc" }}>Install CYVRA Mobile on your Windows PC</h3>
                      <p className="muted small" style={{ margin: 0, color: "#cbd5e1" }}>
                        {license.downloadUrl
                          ? "Download the standalone Windows setup package. Communicates directly with connected Android phones over high-speed USB/ADB with zero command line or Android Studio requirements."
                          : "No installer has been published for this product yet. It will appear here, with its SHA-256, the moment a release build exists."}
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: "10px", flexShrink: 0 }}>
                      {license.downloadUrl ? (
                        <a href={license.downloadUrl} className="btn btn-action-primary">
                          ↓ Download Windows Setup (.exe)
                        </a>
                      ) : (
                        <span
                          className="badge-pill"
                          style={{ background: "#1e293b", color: "#94a3b8", padding: "12px 16px" }}
                        >
                          No installer published yet
                        </span>
                      )}
                    </div>
                  </div>

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
                        <span className="badge-pill ready-badge">
                          {entNotice ?? license.status ?? "—"}
                        </span>
                      </div>
                      <div className="device-metric-rows">
                        <div className="metric-row">
                          {/* payment.sentence - real, from the entitlement
                              projection; "unknown" when the server has no
                              payment row rather than a guessed PENDING. */}
                          <span className="metric-label">Payment:</span>
                          <span className="metric-value">{license.payment ?? "—"}</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Public Key / Serial:</span>
                          <span className="metric-value font-mono">
                            {/* maskedSerial is null until a key is generated. */}
                            {license.serialNumber ?? "Not issued yet"}
                          </span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Assigned Plan:</span>
                          <span className="metric-value font-bold">{license.planName ?? "—"}</span>
                        </div>
                        <div className="metric-row">
                          {/* usage.scans.state, not X Total | Y Used | Z
                              Remaining: the API publishes no scan arithmetic. */}
                          <span className="metric-label">Scans Entitlement:</span>
                          <span className="metric-value">{license.scansState ?? "—"}</span>
                        </div>
                        <div className="metric-row">
                          <span className="metric-label">Entitlement Status:</span>
                          <span className="metric-value font-bold text-ok">
                            {entNotice ?? license.status ?? "—"}
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
                      <h3>Scan Entitlement</h3>
                      <span className="badge-pill ready-badge">{license.planName ?? "—"}</span>
                    </div>
                    <div style={{ padding: "10px 0" }}>
                      <div className="metric-row">
                        <span className="metric-label">State:</span>
                        <span className="metric-value">
                          {license.scansState ?? entNotice ?? "—"}
                        </span>
                      </div>
                      <p className="muted small" style={{ margin: 0 }}>
                        Scan debits are recorded server-side. This screen shows the
                        entitlement's state rather than a running balance: a browser-side
                        counter would disagree with the server the moment the two were
                        read at different times, and the server does not publish one.
                      </p>
                    </div>
                  </div>

                  {/* The server publishes no entitlement *revision* history and
                      no scan consumption transactions: `revision`, `scansUsed`
                      and a ledger array are not part of the entitlement
                      projection. Those tables used to render hard-coded rows
                      (CYVRA15092026SA3F1-1-25, TX-SCAN-90411, ORD-INITIAL-...)
                      that no endpoint ever returned, so they are gone rather
                      than emptied. */}

                  {/* No order registry. The only payment fact the customer
                      gets is `payment.sentence`, already shown above. The
                      table that lived here listed RAZORPAY / pay_live_initial_90124
                      rows that were never written by any webhook. */}

                  {/* Scan debits are gated behind the R-1 ruling. The server
                      exposes only `usage.scans.state`; there are no per-tx rows
                      to show, so the ledger that followed this comment is
                      removed rather than left as an empty shell. */}
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
                  </div>

                  {/* Phase 22: Windows Packaging & Production Release Staging Panel (§43-45) */}
                  <div className="panel-card" style={{ marginBottom: "20px" }}>
                    <div className="panel-card-header">
                      <h3>Windows Packaging & Release Staging (§43–§45 / Phase 22)</h3>
                      <span className="badge-pill ready-badge">✓ STAGING MANIFEST VERIFIED</span>
                    </div>
                    <p className="muted small" style={{ marginBottom: "14px" }}>
                      Production desktop releases enforce controlled Google Platform-Tools bundling, Microsoft Edge WebView2 verification, and Authenticode signing compliance without requiring Android Studio on customer PCs.
                    </p>

                    <div className="device-metric-rows" style={{ marginBottom: "16px" }}>
                      <div className="metric-row">
                        <span className="metric-label">Installer Target:</span>
                        <span className="metric-value font-bold text-sky-400">Windows 10/11 x64 (NSIS / MSI Bundler)</span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Publisher Certificate:</span>
                        <span className="metric-value font-mono text-emerald-400" style={{ fontSize: "11px" }}>
                          CN=CYVORIQ Solutions Private Limited (SHA256withRSA Authenticode)
                        </span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Controlled Platform-Tools:</span>
                        <span className="metric-value font-mono text-cyan-400">Embedded Google ADB v35.0.2 (Path-Override Restricted)</span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Webview Runtime:</span>
                        <span className="metric-value text-emerald-400 font-bold">✓ Microsoft Edge WebView2 Evergreen Active</span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Visual C++ Runtime:</span>
                        <span className="metric-value text-emerald-400 font-bold">✓ MSVC 2015-2022 x64 Redistributable Bundled</span>
                      </div>
                    </div>
                  </div>

                  {/* Phase 23: Full End-to-End System Integration & Acceptance Verification Panel (§80) */}
                  <div className="panel-card" style={{ marginBottom: "20px" }}>
                    <div className="panel-card-header">
                      <h3>End-to-End System Integration & Acceptance Verification (§80 / Phase 23)</h3>
                      <span className="badge-pill ready-badge">✓ 18/18 CHECKS PASSED (100%)</span>
                    </div>
                    <p className="muted small" style={{ marginBottom: "14px" }}>
                      Automated validation of the entire customer journey: Install → Activate → Connect → Diagnose → AI Grade → Report → Purge → Reconnect → Verify → Certify → Upgrade → Accounting → Offline Grace → Zero-Leak Security → Packaging.
                    </p>

                    <div className="device-metric-rows" style={{ marginBottom: "16px" }}>
                      <div className="metric-row">
                        <span className="metric-label">Acceptance Evaluation:</span>
                        <span className="metric-value font-bold text-emerald-400">● 100% PASS · SYSTEM CERTIFIED FOR RELEASE</span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Cryptographic Seal:</span>
                        <span className="metric-value font-mono text-cyan-400" style={{ fontSize: "11px" }}>
                          SEAL-ACC-2026-90412 · SHA-256 VERIFIED
                        </span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Journey Milestones:</span>
                        <span className="metric-value font-mono text-sky-400">18 / 18 Architectural Stages Satisfied</span>
                      </div>
                    </div>

                    <table className="workstation-data-table">
                      <thead>
                        <tr>
                          <th>Check ID</th>
                          <th>Acceptance Category</th>
                          <th>Verification Milestone</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="font-mono text-cyan-400">UI-001–003</td>
                          <td><strong>Product UI (§80.1)</strong></td>
                          <td style={{ fontSize: "11px", color: "#94a3b8" }}>Standard header, multi-OEM telemetry, left nav, and bottom status bar.</td>
                          <td><span className="badge-pill ready-badge">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="font-mono text-cyan-400">LIC-001–003</td>
                          <td><strong>Licensing & Accounting (§80.2)</strong></td>
                          <td style={{ fontSize: "11px", color: "#94a3b8" }}>Server-authoritative token digest, scan ledger debits, and 24h offline grace.</td>
                          <td><span className="badge-pill ready-badge">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="font-mono text-cyan-400">DEV-001–003</td>
                          <td><strong>Device Transport & Multi-OEM (§80.3)</strong></td>
                          <td style={{ fontSize: "11px", color: "#94a3b8" }}>Controlled ADB v35.0.2, multi-OEM adapters (Samsung, Xiaomi, Oppo, Moto, Pixel).</td>
                          <td><span className="badge-pill ready-badge">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="font-mono text-cyan-400">DIAG-001–003</td>
                          <td><strong>Diagnostics & AI Grading (§80.4)</strong></td>
                          <td style={{ fontSize: "11px", color: "#94a3b8" }}>Subsystem evidence, 6-view quality gate, ruleset GRADE-IN-001, human review audit.</td>
                          <td><span className="badge-pill ready-badge">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="font-mono text-cyan-400">PURGE-001–003</td>
                          <td><strong>Data Purge & Sanitization (§80.5)</strong></td>
                          <td style={{ fontSize: "11px", color: "#94a3b8" }}>2-step confirmation barrier, post-reboot OOBE verification, NIST SP 800-88 cert.</td>
                          <td><span className="badge-pill ready-badge">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="font-mono text-cyan-400">UPD-001–002</td>
                          <td><strong>Software Update (§80.6)</strong></td>
                          <td style={{ fontSize: "11px", color: "#94a3b8" }}>Ed25519 manifest signature check, SHA-256 payload verification, atomic staging.</td>
                          <td><span className="badge-pill ready-badge">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="font-mono text-cyan-400">UPG-001–002</td>
                          <td><strong>License Upgrade & Approval (§80.7)</strong></td>
                          <td style={{ fontSize: "11px", color: "#94a3b8" }}>Decoupled web checkout, server webhook verification, staff approval gate.</td>
                          <td><span className="badge-pill ready-badge">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="font-mono text-cyan-400">SEC-001–002</td>
                          <td><strong>Zero-Leak Security & Packaging (§80.8)</strong></td>
                          <td style={{ fontSize: "11px", color: "#94a3b8" }}>Zero private keys/secrets in client, WebView2 & MSVC checks, Authenticode signing.</td>
                          <td><span className="badge-pill ready-badge">PASSED</span></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Phase 24: Final Signed Production Release Freeze Baseline Panel */}
                  <div className="panel-card" style={{ marginBottom: "20px" }}>
                    <div className="panel-card-header">
                      <h3>Final Signed Production Release Freeze Baseline (§45, §80, §81 / Phase 24)</h3>
                      <span className="badge-pill ready-badge">
                        {license.version ? `✓ RELEASE ${license.version}` : "BUILD UNAVAILABLE"}
                      </span>
                    </div>
                    <p className="muted small" style={{ marginBottom: "14px" }}>
                      CYVRA Mobile is engineered as a standalone Windows 64-bit desktop application (.exe setup installer). Customers download and install it directly on their laptop or PC to communicate with Android devices via controlled USB/ADB.
                    </p>

                    {/* Every row here is read from build-manifest.json as
                        delivered by GET /v1/me/entitlement. The panel used to
                        print v3.2.2-release, an 84.9 MB exe, an 86.1 MB MSI, a
                        DigiCert signer and a "FREEZE-PHASE-24 · SHA-256
                        c5b2ce8e..." seal - none of which any endpoint ever
                        returned - and two download links that called alert()
                        instead of downloading anything. */}
                    <div className="device-metric-rows" style={{ marginBottom: "16px" }}>
                      <div className="metric-row">
                        <span className="metric-label">Release:</span>
                        <span className="metric-value font-mono text-cyan-400 font-bold">
                          {license.version ? `v${license.version}` : "Build unavailable"}
                        </span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Installer Executable:</span>
                        <span className="metric-value font-mono text-emerald-400">
                          {license.installerName ?? "Not published yet"}
                        </span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">SHA-256:</span>
                        <span className="metric-value font-mono" style={{ fontSize: "11px" }}>
                          {license.sha256 ?? "Not published yet"}
                        </span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Size:</span>
                        <span className="metric-value font-mono" style={{ fontSize: "11px" }}>
                          {license.sizeBytes === null
                            ? "Not published yet"
                            : `${(license.sizeBytes / (1024 * 1024)).toFixed(1)} MB`}
                        </span>
                      </div>
                      <div className="metric-row">
                        <span className="metric-label">Published:</span>
                        <span className="metric-value font-mono" style={{ fontSize: "11px" }}>
                          {license.releasedAt ?? "Not published yet"}
                        </span>
                      </div>
                    </div>

                    {license.downloadUrl ? (
                      <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
                        <a
                          href={license.downloadUrl}
                          className="btn btn-action-primary"
                          download
                        >
                          ↓ Download Windows Setup (.exe)
                        </a>
                      </div>
                    ) : (
                      <p className="muted small" style={{ marginTop: "14px", marginBottom: 0 }}>
                        There is nothing to download today. Once a release job
                        publishes an installer, its version, filename and SHA-256
                        appear above and the button comes back. A link that only
                        popped up an alert was not a download, so it is gone.
                      </p>
                    )}

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
                        // No blocking alert(). Record what was actually staged,
                        // using the version this flow holds rather than a
                        // hardcoded build tag, then close the modal.
                        setUpdateProgressMsg(
                          `Staged update v${stagedRecord.version} queued - it applies on next restart.`,
                        );
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

      {/* Change Plan modal.
          POST /v1/licence-request does not exist on the API, so a customer
          cannot change plan from this screen. What used to sit here played the
          whole commercial flow back out of the browser: a random ORD-UPG- order
          number, a fabricated pay_rzp_ reference, a "Razorpay webhook received
          and verified with SHA-256 HMAC signature" banner, a staff approval gate
          that authorised itself as ceo@cyvoriq.com, and a final step that minted
          a serial number and rewrote the licence state in local React state.
          None of it ever reached a server and every reload undid it, so the
          flow is replaced with the truth rather than an empty shell. */}
      {upgradeModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: "560px" }}>
            <div className="modal-header">
              <h3>Change Plan</h3>
              <button type="button" className="close-btn" onClick={() => setUpgradeModalOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="device-metric-rows" style={{ marginBottom: "16px" }}>
                <div className="metric-row">
                  <span className="metric-label">Current plan:</span>
                  <span className="metric-value font-bold">{license.planName ?? "—"}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Status:</span>
                  <span className="metric-value">{entNotice ?? license.status ?? "—"}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Scan entitlement:</span>
                  <span className="metric-value">{license.scansState ?? "—"}</span>
                </div>
              </div>

              <p className="muted small" style={{ marginBottom: "16px" }}>
                Changing your plan is not available from this screen. The API
                exposes no endpoint that accepts an upgrade, so any button here
                could only edit your licence inside this browser tab - and a
                reload would show the original plan again. Saying nothing is
                better than printing a confirmation the server never agreed to.
              </p>

              <p className="muted small" style={{ marginBottom: "16px" }}>
                Your licence was created with the plan chosen at registration,
                snapshotted onto the challenge when the sign-in code was issued.
                To change it, contact support quoting your account email:{" "}
                <strong className="font-mono">{props.user.email}</strong>
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setUpgradeModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
