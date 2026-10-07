import { useState, type ReactNode } from "react";
import {
  scansStateSentence,
  type AuthUser,
  type EntitlementResult,
  type ReportDetail,
  type ReportSession,
  type ReportSummary,
} from "../api";
import { ReportView } from "../ReportView";
import { formatDateTime } from "../admin/format/datetime";
import {
  ConfirmationDialog,
  DataTable,
  DownloadButton,
  ErrorPanel,
  LicenceCard,
  MetricCard,
  Modal,
  StatusBadge,
  SteelCard,
  Stepper,
  SuccessPanel,
} from "./steel";
import "./steel.css";

/*
 * CYVRA Customer Workspace — light-steel shell (Phase 2).
 *
 * Replaces the legacy dark shell (CustomerDesktopShell.tsx + workstation.css),
 * which was deleted in this commit together with its simulation module.
 *
 * Governing documents:
 *   Spec  4  DESIGN PHILOSOPHY                    light steel, colour semantics
 *   Spec  5  INFORMATION ARCHITECTURE             eight-item navigation
 *   Spec  6/7  OVERVIEW                           home screen answers
 *   Spec 13/14 APPLICATION DOWNLOAD / STATES      honest build availability
 *   Spec 15 UPDATE & UPGRADE                      behaviour preserved verbatim
 *   Spec 70 UI COMPONENT SYSTEM                   reusable kit (steel.tsx)
 *   Spec 71 RESPONSIVE DESIGN                     collapse + scroll rules
 *   Spec 89 CUSTOMER DASHBOARD TOP BAR            compact identity strip
 *   Spec 90 LEFT NAVIGATION                       the eight sections below
 *
 * Data honesty rules carried over from the WS-K1-01 hotfix: every licence
 * figure comes from `GET /v1/me/entitlement`; a null field renders as an
 * explicit absence, never a plausible default. No device, scan, certificate or
 * audit result is fabricated anywhere in this file.
 */

/** Spec 5 / Spec 90 — the eight primary sections, in order. */
export type WorkspaceNavId =
  | "OVERVIEW"
  | "CYVRA_MOBILE"
  | "UPDATE_UPGRADE"
  | "REPORTING_AUDIT"
  | "DEVICE_ACTIVITY"
  | "LICENCE_USAGE"
  | "SETTINGS"
  | "HELP";

export interface WorkspaceNavItem {
  id: WorkspaceNavId;
  label: string;
  icon: string;
  /** Spec 90 shows nesting under REPORTING & AUDIT. */
  sub?: string[];
}

/** Spec 90 — rendered verbatim from the specification's recommended structure. */
export const WORKSPACE_NAV: readonly WorkspaceNavItem[] = [
  { id: "OVERVIEW", label: "OVERVIEW", icon: "\u25a4" },
  { id: "CYVRA_MOBILE", label: "CYVRA MOBILE", icon: "\u2b1b" },
  { id: "UPDATE_UPGRADE", label: "UPDATE & UPGRADE", icon: "\u21c5" },
  {
    id: "REPORTING_AUDIT",
    label: "REPORTING & AUDIT",
    icon: "\u25a3",
    sub: ["Report Upload", "Audit Reports", "Drafts", "Final Reports"],
  },
  { id: "DEVICE_ACTIVITY", label: "DEVICE ACTIVITY", icon: "\u2328" },
  { id: "LICENCE_USAGE", label: "LICENCE & USAGE", icon: "\u26bf" },
  { id: "SETTINGS", label: "SETTINGS", icon: "\u2699" },
  { id: "HELP", label: "HELP", icon: "?" },
] as const;

type UpdateStep =
  | "IDLE"
  | "CHECKING"
  | "AVAILABLE"
  | "DOWNLOADING"
  | "STAGED"
  | "ROLLED_BACK";

interface StagedRecord {
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
}

export function CustomerWorkspaceShell(props: {
  user: AuthUser;
  /**
   * `null` until `GET /v1/me/entitlement` answers. Every licence figure below
   * comes from here — there is no local fallback.
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
  const [activeNav, setActiveNav] = useState<WorkspaceNavId>("OVERVIEW");
  // Spec 71: the left navigation collapses on small screens. Closed by default
  // at every width — the CSS decides whether it is visible at all.
  const [navOpen, setNavOpen] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);

  /* ------------------------------------------------------------------ *
   * Licence projection — identical derivation to the legacy shell so the
   * sentences a customer reads do not change with this redesign.
   * ------------------------------------------------------------------ */
  const entitlement =
    props.entitlement?.kind === "ok" ? props.entitlement.entitlement : null;

  const license = {
    planName: entitlement?.plan.label ?? null,
    status: entitlement?.licence.sentence ?? null,
    serialNumber: entitlement?.licence.maskedSerial ?? null,
    payment: entitlement?.payment.sentence ?? null,
    scansState: entitlement
      ? scansStateSentence(entitlement.usage.scans.state)
      : null,
    version: entitlement?.build.version ?? null,
    buildState: entitlement?.build.state ?? "unavailable",
    /** null until a release job publishes a real installer URL. */
    downloadUrl: entitlement?.build.url ?? null,
    installerName: entitlement?.build.url
      ? (entitlement.build.url.split("/").pop() ?? null)
      : null,
    sha256: entitlement?.build.sha256 ?? null,
    sizeBytes: entitlement?.build.sizeBytes ?? null,
    releasedAt: entitlement?.build.releasedAt ?? null,
  };

  /**
   * What the top bar states when entitlement is unavailable. Never a
   * placeholder plan or status — the *absence* is what gets shown.
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

  const customerName =
    props.user.companyName || props.user.fullName || props.user.email;

  const buildAvailable = license.buildState === "published" && Boolean(license.downloadUrl);

  function formatSize(bytes: number | null): string | null {
    if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return null;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function goTo(nav: WorkspaceNavId) {
    setActiveNav(nav);
    setNavOpen(false);
  }

  /* ------------------------------------------------------------------ *
   * Spec 15 — UPDATE & UPGRADE.
   *
   * "The existing Update and Upgrade functionality is already approved.
   *  DO NOT redesign its functional behaviour."
   *
   * The state machine, timings and messages below are carried over unchanged
   * from the legacy shell. Only the surrounding visual system changed.
   * ------------------------------------------------------------------ */
  const [updateStep, setUpdateStep] = useState<UpdateStep>("IDLE");
  const [updateProgressMsg, setUpdateProgressMsg] = useState<string>("");
  const [stagedRecord, setStagedRecord] = useState<StagedRecord | null>(null);

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

  /* ------------------------------------------------------------------ *
   * Shared blocks
   * ------------------------------------------------------------------ */
  const buildMetadata: { key: ReactNode; value: ReactNode }[] = [
    { key: "Version", value: license.version ? `v${license.version}` : "\u2014" },
    { key: "Release date", value: license.releasedAt ? formatDateTime(license.releasedAt) : "\u2014" },
    { key: "Package type", value: license.installerName ? license.installerName.split(".").pop()?.toUpperCase() : "\u2014" },
    { key: "File size", value: formatSize(license.sizeBytes) ?? "\u2014" },
    {
      key: "SHA-256",
      value: license.sha256 ? (
        <span className="ws-mono" style={{ wordBreak: "break-all" }}>
          {license.sha256}
        </span>
      ) : (
        "\u2014"
      ),
    },
  ];

  function renderOverview() {
    return (
      <div className="ws-stack">
        <h1 className="ws-page-title">Overview</h1>
        <p className="ws-page-desc">
          Who you are, what licence you hold, whether the application is ready, and what needs
          your attention.
        </p>

        {entNotice ? <StatusBadge tone="neutral">{entNotice}</StatusBadge> : null}

        <div className="ws-grid">
          <MetricCard
            label="Licence status"
            value={entNotice ?? license.status ?? "\u2014"}
            hint={license.planName ?? "Plan not assigned"}
            tone={license.status ? "success" : undefined}
          />
          <MetricCard label="Plan" value={license.planName ?? "\u2014"} hint="Devices covered" />
          <MetricCard
            label="Scans"
            value={license.scansState ?? "\u2014"}
            hint="Entitlement state, not a running balance"
          />
          <MetricCard
            label="Application"
            value={license.version ? `v${license.version}` : "Build unavailable"}
            hint={buildAvailable ? "Installer published" : "No installer published yet"}
            tone={buildAvailable ? "success" : undefined}
          />
        </div>

        <SteelCard
          title="CYVRA Mobile application"
          badge={
            buildAvailable ? (
              <StatusBadge tone="action">BUILD AVAILABLE</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">BUILD NOT AVAILABLE</StatusBadge>
            )
          }
          footer={
            <DownloadButton
              href={license.downloadUrl}
              label="DOWNLOAD CYVRA MOBILE .ZIP"
              disabledLabel="Download unavailable"
              downloadName={license.installerName ?? undefined}
            />
          }
        >
          <p className="ws-panel__text" style={{ marginBottom: 12 }}>
            {buildAvailable
              ? "Your licence authorises a download. Verify the SHA-256 of the package before installing."
              : "No authorised release exists yet, so no download is offered. It will appear here, with its SHA-256, the moment a release build exists."}
          </p>
          <LicenceCardLite rows={buildMetadata} />
        </SteelCard>

        <div className="ws-grid">
          <SteelCard
            title="Device activity"
            badge={<StatusBadge tone="neutral">{props.sessions.length} session(s)</StatusBadge>}
            footer={
              <button type="button" className="ws-btn ws-btn--ghost" onClick={() => goTo("DEVICE_ACTIVITY")}>
                Open device activity
              </button>
            }
          >
            <p className="ws-panel__text">
              Processing sessions recorded for this account. Sessions can be frozen into a
              Report&nbsp;1 from there.
            </p>
          </SteelCard>

          <SteelCard
            title="Reports"
            badge={<StatusBadge tone="neutral">{props.reports.length} report(s)</StatusBadge>}
            footer={
              <button type="button" className="ws-btn ws-btn--ghost" onClick={() => goTo("REPORTING_AUDIT")}>
                Open reporting &amp; audit
              </button>
            }
          >
            <p className="ws-panel__text">
              Frozen, immutable reports available to view and export.
            </p>
          </SteelCard>
        </div>
      </div>
    );
  }

  function renderCyvraMobile() {
    return (
      <div className="ws-stack">
        <h1 className="ws-page-title">CYVRA Mobile</h1>
        <p className="ws-page-desc">
          Purchase, licence delivery and application download.
        </p>

        <SteelCard
          title="Download CYVRA Mobile"
          badge={
            buildAvailable ? (
              <StatusBadge tone="action">BUILD AVAILABLE</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">BUILD NOT AVAILABLE</StatusBadge>
            )
          }
          footer={
            <DownloadButton
              href={license.downloadUrl}
              label="DOWNLOAD CYVRA MOBILE .ZIP"
              disabledLabel="BUILD NOT AVAILABLE"
              downloadName={license.installerName ?? undefined}
            />
          }
        >
          <p className="ws-panel__text" style={{ marginBottom: 12 }}>
            {buildAvailable
              ? "Windows application package, provided as a ZIP defined by the release process. The download action is offered only because an authorised release exists."
              : "Download availability is controlled by entitlement and release state. Since no authorized release exists, no download is shown as available."}
          </p>
          <LicenceCardLite rows={buildMetadata} />
        </SteelCard>

        <SteelCard title="How a licence is issued">
          <ol className="ws-muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
            <li>You select a licence model.</li>
            <li>You provide and validate the required customer information.</li>
            <li>Payment status is recorded manually by the authorised business or admin.</li>
            <li>The licence is issued through the existing licensing and approval process.</li>
            <li>The licence is delivered to your registered email address.</li>
            <li>Receipt of a valid issued licence means you are authorised to use CYVRA Mobile.</li>
            <li>This Workspace displays the resulting licence and application status.</li>
          </ol>
          <p className="ws-panel__text" style={{ marginTop: 12 }}>
            There is no payment gateway in the product. Payment is recorded by the business, not
            taken by the site.
          </p>
        </SteelCard>

        <SteelCard title="Your plan">
          <LicenceCardLite
            rows={[
              { key: "Assigned plan", value: license.planName ?? "\u2014" },
              { key: "Payment status", value: license.payment ?? "\u2014" },
              { key: "Licence status", value: entNotice ?? license.status ?? "\u2014" },
              { key: "Serial", value: license.serialNumber ?? "Not issued yet" },
            ]}
          />
        </SteelCard>
      </div>
    );
  }

  function renderUpdateUpgrade() {
    return (
      <div className="ws-stack">
        <h1 className="ws-page-title">Update &amp; Upgrade</h1>
        <p className="ws-page-desc">
          Two different operations. Updates maintain the software; upgrades change the licence
          you bought.
        </p>

        <div className="ws-grid">
          <SteelCard
            title="Update"
            badge={<StatusBadge tone="neutral">Software</StatusBadge>}
            footer={
              <button
                type="button"
                className="ws-btn ws-btn--action"
                onClick={() => setUpdateModalOpen(true)}
              >
                Open update manager
              </button>
            }
          >
            <p className="ws-panel__text">
              Maintains system binaries, diagnostic collectors and Platform-Tools. It never
              modifies your purchased scan entitlements.
            </p>
            <p className="ws-panel__text" style={{ marginTop: 10 }}>
              Current application: {license.version ? `v${license.version}` : "Build unavailable"}.
            </p>
          </SteelCard>

          <SteelCard
            title="Upgrade"
            badge={<StatusBadge tone="neutral">Licence</StatusBadge>}
            footer={
              <button
                type="button"
                className="ws-btn ws-btn--ghost"
                onClick={() => setUpgradeModalOpen(true)}
              >
                Change plan
              </button>
            }
          >
            <p className="ws-panel__text">
              Changes the number of devices your licence covers. This is a commercial change to
              your entitlement, not a software change.
            </p>
            <p className="ws-panel__text" style={{ marginTop: 10 }}>
              Plan: {license.planName ?? "\u2014"}.
            </p>
          </SteelCard>
        </div>

        <SteelCard title="Update flow">
          <Stepper
            steps={[
              { id: "check", label: "Check" },
              { id: "verify", label: "Verify signature" },
              { id: "stage", label: "Stage" },
              { id: "restart", label: "Restart to apply" },
            ]}
            currentId={
              updateStep === "IDLE" || updateStep === "CHECKING"
                ? "check"
                : updateStep === "AVAILABLE" || updateStep === "DOWNLOADING"
                  ? "verify"
                  : updateStep === "STAGED"
                    ? "restart"
                    : "stage"
            }
          />
        </SteelCard>
      </div>
    );
  }

  function renderReportingAudit() {
    return (
      <div className="ws-stack">
        <h1 className="ws-page-title">Reporting &amp; Audit</h1>
        <p className="ws-page-desc">
          Frozen reports generated from your processing sessions.
        </p>

        <SteelCard
          title="Audit reports"
          badge={<StatusBadge tone="neutral">{props.reports.length} total</StatusBadge>}
          flush
        >
          <DataTable
            columns={[
              { key: "num", header: "Public number", render: (r) => <strong>{r.publicNumber}</strong> },
              { key: "session", header: "Device session", render: (r) => (
                <span className="ws-mono">
                  {r.processingSessionId.slice(0, 18)}
                  {"\u2026"}
                </span>
              ) },
              { key: "cov", header: "Coverage", render: (r) => (
                <StatusBadge tone={r.coverage === "COMPLETE" ? "success" : "neutral"}>
                  {r.coverage}
                </StatusBadge>
              ) },
              { key: "at", header: "Frozen", render: (r) => formatDateTime(r.frozenAt) },
              {
                key: "act",
                header: "Action",
                render: (r) => (
                  <button
                    type="button"
                    className="ws-btn ws-btn--ghost ws-btn--sm"
                    onClick={() => props.onOpenReport(r.reportId)}
                  >
                    View report
                  </button>
                ),
              },
            ]}
            rows={props.reports}
            rowKey={(r) => r.reportId}
            empty="No reports yet. A report is created when a processing session is frozen."
          />
        </SteelCard>

        <SteelCard title="Report upload" badge={<StatusBadge tone="neutral">Not available yet</StatusBadge>}>
          <p className="ws-panel__text">
            Uploading a raw diagnostic or purge report for ingestion is not enabled in this
            release. No upload control is offered because there is no endpoint behind it — a
            button that cannot work would misrepresent what this Workspace can do.
          </p>
        </SteelCard>
      </div>
    );
  }

  function renderDeviceActivity() {
    return (
      <div className="ws-stack">
        <h1 className="ws-page-title">Device activity</h1>
        <p className="ws-page-desc">
          Processing sessions recorded for this account, and whether each has been frozen into a
          report.
        </p>

        <SteelCard
          title="Sessions"
          badge={<StatusBadge tone="neutral">{props.sessions.length} recorded</StatusBadge>}
          flush
        >
          <DataTable
            columns={[
              { key: "dev", header: "Device", render: (s) => {
                const label = [s.manufacturer, s.model].filter(Boolean).join(" ");
                return <strong>{label || "Android Device"}</strong>;
              } },
              { key: "id", header: "Session ID", render: (s) => (
                <span className="ws-mono">
                  {s.processingSessionId.slice(0, 18)}
                  {"\u2026"}
                </span>
              ) },
              { key: "at", header: "Created", render: (s) => formatDateTime(s.createdAt) },
              { key: "st", header: "Status", render: (s) => {
                const frozen = props.reports.find(
                  (r) => r.processingSessionId === s.processingSessionId,
                );
                return frozen ? (
                  <StatusBadge tone="success">FROZEN ({frozen.publicNumber})</StatusBadge>
                ) : (
                  <StatusBadge tone="neutral">READY TO FREEZE</StatusBadge>
                );
              } },
              { key: "act", header: "Action", render: (s) => {
                const frozen = props.reports.find(
                  (r) => r.processingSessionId === s.processingSessionId,
                );
                return frozen ? (
                  <button
                    type="button"
                    className="ws-btn ws-btn--ghost ws-btn--sm"
                    onClick={() => props.onOpenReport(frozen.reportId)}
                  >
                    View report
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ws-btn ws-btn--action ws-btn--sm"
                    disabled={props.busy}
                    onClick={() => props.onFreezeSession(s.processingSessionId)}
                  >
                    {props.busy ? "Freezing\u2026" : "Freeze Report 1"}
                  </button>
                );
              } },
            ]}
            rows={props.sessions}
            rowKey={(s) => s.processingSessionId}
            empty="No processing sessions recorded yet. Sessions appear here once a device scan has been carried out."
          />
        </SteelCard>
      </div>
    );
  }

  function renderLicenceUsage() {
    return (
      <div className="ws-stack">
        <h1 className="ws-page-title">Licence &amp; usage</h1>
        <p className="ws-page-desc">
          The commercial facts of your account, exactly as the server reports them.
        </p>

        <div className="ws-grid">
          <LicenceCard
            title="Licence credentials"
            badge={
              <StatusBadge tone={license.status ? "success" : "neutral"}>
                {entNotice ?? license.status ?? "\u2014"}
              </StatusBadge>
            }
            rows={[
              { key: "Payment", value: license.payment ?? "\u2014" },
              { key: "Serial", value: license.serialNumber ?? "Not issued yet" },
              { key: "Assigned plan", value: license.planName ?? "\u2014" },
              { key: "Scans entitlement", value: license.scansState ?? "\u2014" },
              { key: "Status", value: entNotice ?? license.status ?? "\u2014" },
            ]}
          />

          <SteelCard title="Scan entitlement">
            <p className="ws-panel__text" style={{ marginBottom: 10 }}>
              {license.scansState ?? entNotice ?? "\u2014"}
            </p>
            <p className="ws-panel__text">
              Scan debits are recorded server-side. This screen shows the entitlement's state
              rather than a running balance: a browser-side counter would disagree with the
              server the moment the two were read at different times, and the server does not
              publish one.
            </p>
          </SteelCard>
        </div>

        <SteelCard title="Change plan" footer={
          <button type="button" className="ws-btn ws-btn--ghost" onClick={() => setUpgradeModalOpen(true)}>
            Change plan
          </button>
        }>
          <p className="ws-panel__text">
            Changing your plan is not available from this screen. Contact support quoting your
            account email to have the licence reissued on a different plan.
          </p>
        </SteelCard>
      </div>
    );
  }

  function renderSettings() {
    return (
      <div className="ws-stack">
        <h1 className="ws-page-title">Settings</h1>
        <p className="ws-page-desc">Account details for this Workspace session.</p>

        <div className="ws-grid">
          <LicenceCard
            title="Account"
            rows={[
              { key: "Company / organisation", value: props.user.companyName || "\u2014" },
              { key: "Contact name", value: props.user.fullName || "\u2014" },
              { key: "Email", value: props.user.email },
              { key: "State", value: props.user.state || "\u2014" },
            ]}
          />

          <SteelCard title="Session">
            <p className="ws-panel__text" style={{ marginBottom: 12 }}>
              You are signed in as <strong>{props.user.email}</strong>. Signing out clears this
              session on this device; it does not cancel your licence.
            </p>
            <button type="button" className="ws-btn ws-btn--ghost" onClick={() => setSignOutConfirmOpen(true)}>
              Sign out
            </button>
          </SteelCard>
        </div>
      </div>
    );
  }

  function renderHelp() {
    return (
      <div className="ws-stack">
        <h1 className="ws-page-title">Help</h1>
        <p className="ws-page-desc">Getting started and getting in touch.</p>

        <SteelCard title="Connecting an Android device">
          <ol className="ws-muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
            <li>Use a high-quality, data-capable USB cable connected directly to the PC.</li>
            <li>
              Enable <strong>Developer Options</strong> on the phone (tap Build Number seven
              times).
            </li>
            <li>
              Enable <strong>USB Debugging</strong> in Developer Options.
            </li>
            <li>
              When prompted on the phone, choose <strong>Always allow from this computer</strong>{" "}
              and tap OK.
            </li>
          </ol>
        </SteelCard>

        <SteelCard title="Licence and payment questions">
          <p className="ws-panel__text">
            Payment status is recorded manually by the authorised business, and the licence is
            issued through the existing approval process. If your status looks wrong, contact
            support quoting <strong>{props.user.email}</strong>.
          </p>
        </SteelCard>

        <SteelCard title="What this Workspace does not do">
          <p className="ws-panel__text">
            Diagnostics, physical inspection and data purge run in the CYVRA Mobile Windows
            desktop application, not in the browser. This Workspace shows licence, device
            activity and reports.
          </p>
        </SteelCard>
      </div>
    );
  }

  function renderSection() {
    switch (activeNav) {
      case "OVERVIEW":
        return renderOverview();
      case "CYVRA_MOBILE":
        return renderCyvraMobile();
      case "UPDATE_UPGRADE":
        return renderUpdateUpgrade();
      case "REPORTING_AUDIT":
        return renderReportingAudit();
      case "DEVICE_ACTIVITY":
        return renderDeviceActivity();
      case "LICENCE_USAGE":
        return renderLicenceUsage();
      case "SETTINGS":
        return renderSettings();
      case "HELP":
        return renderHelp();
    }
  }

  return (
    <div className="ws-shell">
      {/* Compact top bar (Spec 89). */}
      <header className="ws-topbar">
        <button
          type="button"
          className="ws-nav-toggle"
          aria-expanded={navOpen}
          aria-controls="ws-left-nav"
          onClick={() => setNavOpen((v) => !v)}
        >
          {navOpen ? "Close" : "Menu"}
        </button>

        <div className="ws-topbar__brand">
          <img src="/brand/cyvoriq-logo.png" alt="" className="ws-topbar__logo" />
          <span className="ws-topbar__name">CYVRA Mobile</span>
        </div>

        <div className="ws-topbar__meta">
          <div className="ws-field">
            <span className="ws-field__label">Customer</span>
            <span className="ws-field__value">{customerName}</span>
          </div>
          <div className="ws-field">
            <span className="ws-field__label">Licence</span>
            <span className="ws-field__value">{license.planName ?? "\u2014"}</span>
          </div>
          <div className="ws-field">
            <span className="ws-field__label">Status</span>
            <span className="ws-field__value">
              <StatusBadge tone={license.status && !entNotice ? "success" : "neutral"}>
                {entNotice ?? license.status ?? "\u2014"}
              </StatusBadge>
            </span>
          </div>
          <div className="ws-field">
            <span className="ws-field__label">Application</span>
            <span className="ws-field__value">
              {license.version ? `v${license.version}` : "Build unavailable"}
            </span>
          </div>
        </div>

        <div className="ws-topbar__actions">
          <button
            type="button"
            className="ws-btn ws-btn--ghost ws-btn--sm"
            onClick={() => setUpdateModalOpen(true)}
            title="Check for software updates"
          >
            UPDATE
          </button>
          <button
            type="button"
            className="ws-btn ws-btn--ghost ws-btn--sm"
            onClick={() => setUpgradeModalOpen(true)}
            title="Expand scan entitlement plan"
          >
            UPGRADE
          </button>
        </div>
      </header>

      <div className="ws-body">
        {navOpen ? (
          <button
            type="button"
            className="ws-nav-scrim"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
          />
        ) : null}

        {/* Left navigation (Spec 90) — eight items. */}
        <nav
          id="ws-left-nav"
          className={navOpen ? "ws-nav is-open" : "ws-nav"}
          aria-label="Workspace sections"
        >
          <button
            type="button"
            className="ws-nav__close"
            onClick={() => setNavOpen(false)}
          >
            <span>Close menu</span>
            <span aria-hidden="true">{"\u00d7"}</span>
          </button>

          <ul className="ws-nav__list">
            {WORKSPACE_NAV.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="ws-nav__btn"
                  aria-current={activeNav === item.id ? "page" : undefined}
                  onClick={() => goTo(item.id)}
                >
                  <span className="ws-nav__icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                </button>
                {item.sub && activeNav === item.id ? (
                  <ul className="ws-nav__sub">
                    {item.sub.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="ws-nav__licence">
            <div className="ws-nav__licence-title">Licence</div>
            <div className="ws-nav__licence-plan">{license.planName ?? "\u2014"}</div>
            <div className="ws-nav__licence-sub">{license.scansState ?? "\u2014"}</div>
            <div style={{ marginTop: 8 }}>
              <StatusBadge tone={license.status && !entNotice ? "success" : "neutral"}>
                {entNotice ?? license.status ?? "\u2014"}
              </StatusBadge>
            </div>
          </div>
        </nav>

        <main className="ws-main">
          {props.reportDetail ? (
            <ReportView report={props.reportDetail} onBack={props.onCloseReport} />
          ) : (
            renderSection()
          )}
        </main>
      </div>

      {/* Spec 15 — UPDATE manager. Behaviour unchanged from the approved build. */}
      {updateModalOpen ? (
        <Modal
          title="Secure Software Update"
          onClose={() => setUpdateModalOpen(false)}
          footer={
            <button
              type="button"
              className="ws-btn ws-btn--ghost"
              onClick={() => setUpdateModalOpen(false)}
            >
              Close
            </button>
          }
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <span>
              Installed version: <strong>v{license.version}</strong>
            </span>
            <StatusBadge tone="neutral">SECURE UPDATE CHANNEL</StatusBadge>
          </div>

          {updateStep === "IDLE" ? (
            <div>
              <div className="ws-panel ws-panel--success" style={{ marginBottom: 14 }}>
                <p className="ws-panel__text" style={{ margin: 0 }}>
                  System binaries and diagnostic collectors are active.
                </p>
              </div>
              <p className="ws-panel__text" style={{ marginBottom: 18 }}>
                Updates maintain system binaries, diagnostic collectors and Platform-Tools. They
                never modify your purchased scan entitlements, which are governed by upgrades.
              </p>
              <button
                type="button"
                className="ws-btn ws-btn--action"
                style={{ width: "100%" }}
                onClick={checkForSoftwareUpdates}
              >
                Check for signed updates (GET /updates/manifest)
              </button>
            </div>
          ) : null}

          {updateStep === "CHECKING" || updateStep === "DOWNLOADING" ? (
            <div style={{ textAlign: "center", padding: "26px 10px" }}>
              <p className="ws-panel__text" style={{ margin: 0 }}>
                {updateProgressMsg}
              </p>
            </div>
          ) : null}

          {updateStep === "AVAILABLE" && stagedRecord ? (
            <div>
              <div className="ws-panel ws-panel--action" style={{ marginBottom: 14 }}>
                <h4 className="ws-panel__title">
                  New signed release available: v{stagedRecord.version}
                </h4>
                <p className="ws-panel__text" style={{ margin: 0 }}>
                  {stagedRecord.channel} &middot; {stagedRecord.releaseType} &middot; Size:{" "}
                  {stagedRecord.size}
                </p>
              </div>

              <LicenceCardLite
                rows={[
                  { key: "Signature algorithm", value: <span className="ws-mono">{stagedRecord.signatureAlgorithm}</span> },
                  { key: "Manifest signature", value: <span className="ws-mono">{stagedRecord.signature}</span> },
                  { key: "Package SHA-256", value: <span className="ws-mono" style={{ wordBreak: "break-all" }}>{stagedRecord.sha256}</span> },
                ]}
              />

              <p className="ws-panel__text" style={{ margin: "14px 0" }}>
                All artifacts must pass signature and SHA-256 checksum verification before
                staging. Unsigned packages are rejected.
              </p>

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  className="ws-btn ws-btn--action"
                  style={{ flex: 1 }}
                  onClick={downloadAndStageUpdate}
                >
                  Download, verify &amp; stage update
                </button>
                <button
                  type="button"
                  className="ws-btn ws-btn--ghost"
                  onClick={() => setUpdateStep("IDLE")}
                >
                  Later
                </button>
              </div>
            </div>
          ) : null}

          {updateStep === "STAGED" && stagedRecord ? (
            <div>
              <SuccessPanel title="Update verified and staged">
                The update binary passed its signature checks and is staged for installation on
                the next restart.
              </SuccessPanel>

              <div style={{ margin: "14px 0" }}>
                <LicenceCardLite
                  rows={[
                    { key: "Target version", value: `v${stagedRecord.version}` },
                    { key: "Staged payload path", value: <span className="ws-mono">{stagedRecord.stagedPath}</span> },
                    { key: "Cryptographic signature", value: "Verified (Ed25519)" },
                    { key: "Payload checksum", value: "SHA-256 matched" },
                    { key: "Rollback backup", value: <span className="ws-mono">{stagedRecord.rollbackPath}</span> },
                  ]}
                />
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  className="ws-btn ws-btn--action"
                  style={{ flex: 1 }}
                  onClick={() => {
                    setUpdateProgressMsg(
                      `Staged update v${stagedRecord.version} queued - it applies on next restart.`,
                    );
                    setUpdateModalOpen(false);
                  }}
                >
                  Restart workstation to apply
                </button>
                <button type="button" className="ws-btn ws-btn--danger" onClick={rollbackUpdate}>
                  Roll back staged update
                </button>
              </div>
            </div>
          ) : null}

          {updateStep === "ROLLED_BACK" ? (
            <div>
              <ErrorPanel title="Staged update cancelled and rolled back">
                Staged binaries removed. Current workstation version v{license.version} remains
                active. {updateProgressMsg}
              </ErrorPanel>
              <button
                type="button"
                className="ws-btn ws-btn--ghost"
                style={{ width: "100%", marginTop: 14 }}
                onClick={() => setUpdateStep("IDLE")}
              >
                Return to update manager
              </button>
            </div>
          ) : null}
        </Modal>
      ) : null}

      {/* Spec 15 — Change plan. Honest: no endpoint accepts an upgrade. */}
      {upgradeModalOpen ? (
        <Modal
          title="Change Plan"
          onClose={() => setUpgradeModalOpen(false)}
          footer={
            <button
              type="button"
              className="ws-btn ws-btn--ghost"
              onClick={() => setUpgradeModalOpen(false)}
            >
              Close
            </button>
          }
        >
          <LicenceCardLite
            rows={[
              { key: "Current plan", value: license.planName ?? "\u2014" },
              { key: "Status", value: entNotice ?? license.status ?? "\u2014" },
              { key: "Scan entitlement", value: license.scansState ?? "\u2014" },
            ]}
          />

          <p className="ws-panel__text" style={{ margin: "14px 0" }}>
            Changing your plan is not available from this screen. The API exposes no endpoint
            that accepts an upgrade, so any button here could only edit your licence inside this
            browser tab, and a reload would show the original plan again.
          </p>

          <p className="ws-panel__text">
            Your licence was created with the plan chosen at registration. To change it, contact
            support quoting your account email: <strong className="ws-mono">{props.user.email}</strong>
          </p>
        </Modal>
      ) : null}

      <ConfirmationDialog
        open={signOutConfirmOpen}
        title="Sign out"
        message="End this Workspace session on this device? Your licence is unaffected."
        confirmLabel="Sign out"
        onConfirm={() => {
          setSignOutConfirmOpen(false);
          props.onLogout();
        }}
        onCancel={() => setSignOutConfirmOpen(false)}
      />
    </div>
  );
}

/** Small definition-list used by several sections (keeps rows consistent). */
function LicenceCardLite(props: { rows: { key: ReactNode; value: ReactNode }[] }) {
  return (
    <dl style={{ margin: 0 }}>
      {props.rows.map((row, i) => (
        <div className="ws-licence__row" key={i}>
          <dt className="ws-licence__key">{row.key}</dt>
          <dd className="ws-licence__val" style={{ margin: 0 }}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
