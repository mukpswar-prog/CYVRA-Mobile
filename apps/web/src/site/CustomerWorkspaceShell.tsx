import { useState, type FormEvent, type ReactNode } from "react";
import {
  api,
  PLAN_SLABS,
  scansStateSentence,
  type AuthUser,
  type EntitlementResult,
  type PlanSlab,
  type ReportDetail,
  type ReportSession,
  type ReportSummary,
} from "../api";
import { IN_STATES } from "../in-states";
import { ReportView } from "../ReportView";
import { formatDateTime } from "../admin/format/datetime";
import {
  ConfirmationDialog,
  DataTable,
  DownloadButton,
  ErrorPanel,
  Field,
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
 * Phase 2 replaced the legacy dark shell (CustomerDesktopShell.tsx +
 * workstation.css) together with its simulation module. Phase 3 builds the
 * Overview home, the Purchase area, the manual Payment state, the honest
 * Download card and the Licence & Usage page on top of it.
 *
 * Governing documents:
 *   Spec  4  DESIGN PHILOSOPHY                    light steel, colour semantics
 *   Spec  5  INFORMATION ARCHITECTURE             eight-item navigation
 *   Spec  6/7  OVERVIEW                           home screen answers + actions
 *   Spec  8/9/10  PURCHASE AREA / CUSTOMER INFO / PURCHASE RECORD
 *   Spec 11 PAYMENT STATUS                        manual, never a gateway
 *   Spec 12 LICENCE DELIVERY                      delivered to registered email
 *   Spec 13/14 APPLICATION DOWNLOAD / STATES      honest build availability
 *   Spec 15 UPDATE & UPGRADE                      flow kept, data made real
 *   Spec 70 UI COMPONENT SYSTEM                   reusable kit (steel.tsx)
 *   Spec 71 RESPONSIVE DESIGN                     collapse + scroll rules
 *   Spec 88 LICENCE & USAGE PAGE                  the field list below
 *   Spec 89 CUSTOMER DASHBOARD TOP BAR            compact identity strip
 *   Spec 90 LEFT NAVIGATION                       the eight sections below
 *   Spec 91 HOME SCREEN PRIORITY                  the order of the blocks
 *   Spec 92 WORLD-CLASS UX PRINCIPLE              the six questions answered
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

/* ------------------------------------------------------------------ *
 * Spec 6 + Spec 12 - how a licence status is *presented* to a customer.
 *
 * `GET /v1/me/entitlement` reports the raw status plus a server sentence.
 * Spec 6 asks the Overview for three customer-facing buckets instead -
 * "Green: Active / Orange: Awaiting / Red: Action Required" - and Spec 12
 * supplies the delivery wording. The map below is presentation only: it never
 * invents a status, and a status it does not recognise falls back to the
 * server's own sentence on a neutral tone, so a future status still renders
 * truthfully rather than silently becoming "Active".
 * ------------------------------------------------------------------ */

export type LicenceTone = "success" | "action" | "danger" | "neutral";

const LICENCE_HEADLINES: Record<string, string> = {
  DRAFT: "Being prepared",
  PAYMENT_PENDING: "Awaiting payment",
  PAYMENT_CONFIRMED: "Payment received",
  READY_TO_GENERATE: "Licence key being prepared",
  KEY_GENERATED: "Licence key ready",
  ISSUED: "Licence Issued",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  SUSPENDED: "Suspended",
  REVOKED: "Revoked",
};

/** Spec 6's "Orange: Awaiting" bucket. */
const AWAITING_LICENCE = new Set([
  "DRAFT",
  "PAYMENT_PENDING",
  "PAYMENT_CONFIRMED",
  "READY_TO_GENERATE",
  "KEY_GENERATED",
  "ISSUED",
]);

/** Spec 6's "Red: Action Required" bucket. */
const ATTENTION_LICENCE = new Set(["EXPIRED", "SUSPENDED", "REVOKED"]);

/**
 * Spec 12: an issued licence reaches the customer's registered email, so both
 * `ISSUED` and `ACTIVE` carry the delivery line. A draft or an awaiting-payment
 * row has nothing to have delivered yet, and says so by saying nothing.
 */
const DELIVERED_LICENCE = new Set(["ISSUED", "ACTIVE"]);

export interface LicenceView {
  /** Spec 6/12 headline - `null` only when no status has been reported. */
  headline: string | null;
  tone: LicenceTone;
  /** Spec 12 delivery line, or `null` when nothing has been issued. */
  delivery: string | null;
  /** Spec 6's "Awaiting" caption, so colour is never the only signal. */
  caption: string | null;
}

export function licencePresentation(status: string, sentence: string): LicenceView {
  const known = LICENCE_HEADLINES[status] !== undefined;
  return {
    // An unknown status keeps the server's wording rather than being mapped to
    // a bucket the server never claimed.
    headline: known ? LICENCE_HEADLINES[status] : sentence,
    tone: ATTENTION_LICENCE.has(status)
      ? "danger"
      : AWAITING_LICENCE.has(status)
        ? "action"
        : status === "ACTIVE"
          ? "success"
          : "neutral",
    delivery: DELIVERED_LICENCE.has(status) ? "Sent to registered email" : null,
    caption:
      status === "ISSUED"
        ? "Awaiting activation"
        : ATTENTION_LICENCE.has(status)
          ? "Action required"
          : null,
  };
}

/** Spec 9 - "Mandatory. Must be validated as an Indian PIN code." */
export const INDIAN_PIN = /^[1-9][0-9]{5}$/;

/**
 * Spec 15's update state machine, extended for WS-K1-09.
 *
 * `NO_UPDATE` and `CHECK_FAILED` are new, and they are the point of the fix:
 * before Phase 3 the "check" always answered AVAILABLE with an invented
 * package, because there was no branch capable of saying "there is nothing
 * here". The rest of the machine - check, download, staged, roll back - is
 * Spec 15's approved flow, fed from the real release manifest instead of from
 * literals.
 */
type UpdateStep =
  | "IDLE"
  | "CHECKING"
  | "AVAILABLE"
  | "NO_UPDATE"
  | "CHECK_FAILED"
  | "DOWNLOADING"
  | "STAGED"
  | "ROLLED_BACK";

/**
 * WS-K1-09 - every field below is read from `build-manifest.json` through
 * `GET /v1/me/entitlement`. There is deliberately no `signature`,
 * `signatureAlgorithm`, `stagedPath`, `rollbackPath` or release-notes slot:
 * the manifest publishes none of them, and rendering a plausible value in their
 * place is precisely the defect this phase removes.
 */
interface ReleaseRecord {
  version: string;
  sha256: string;
  sizeBytes: number | null;
  url: string;
  releasedAt: string | null;
  installerName: string;
}

export function CustomerWorkspaceShell(props: {
  user: AuthUser;
  /**
   * `null` until `GET /v1/me/entitlement` answers. Every licence figure below
   * comes from here — there is no local fallback.
   */
  entitlement: EntitlementResult | null;
  /**
   * Re-reads `GET /v1/me/entitlement` when the customer asks the update
   * manager to check for a release (WS-K1-09). Defaults to the real client
   * call, so the production shell performs a genuine request; tests inject a
   * stub so each honest branch can be driven without a server.
   */
  refreshEntitlement?: () => Promise<EntitlementResult>;
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

  /* ------------------------------------------------------------------ *
   * Spec 9/10/11 - the licence request.
   *
   * Fields are prefilled from the authenticated account because Spec 9 says
   * the design "should avoid repeatedly asking the customer for information
   * already available". Nothing here is transmitted: no endpoint accepts a
   * licence request yet, so submitting builds a clean status summary (Spec
   * 10) on this device and says plainly that it was not sent.
   * ------------------------------------------------------------------ */
  const [purchase, setPurchase] = useState(() => ({
    licenceSlab: PLAN_SLABS[0] as PlanSlab,
    companyName: props.user.companyName || props.user.fullName || "",
    addressLine1: props.user.addressLine1 || "",
    addressLine2: props.user.addressLine2 || "",
    pincode: props.user.pincode || "",
    stateName: props.user.state || "",
    // Spec 11's manual control. It is a declaration made on this page, not a
    // payment: there is no gateway, no provider and no token anywhere in the
    // product, and changing it changes nothing on the server.
    paymentDone: false,
  }));
  const [purchaseErrors, setPurchaseErrors] = useState<Record<string, string>>({});
  const [purchaseRecord, setPurchaseRecord] = useState<null | {
    licenceSlab: PlanSlab;
    companyName: string;
    address: string;
    pincode: string;
    stateName: string;
    paymentStatus: string;
    preparedAt: string;
  }>(null);
  const [copyNote, setCopyNote] = useState("");
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

  /**
   * Spec 6/12 presentation of the status the server actually reported. The
   * raw sentence is kept alongside it so an unrecognised status still shows
   * the server's own words instead of a bucket nobody claimed.
   */
  const licenceView = entitlement
    ? licencePresentation(entitlement.licence.status, entitlement.licence.sentence)
    : null;

  const license = {
    planName: entitlement?.plan.label ?? null,
    planCode: entitlement?.plan.code ?? null,
    slab: entitlement?.plan.slab ?? null,
    status: licenceView?.headline ?? null,
    tone: licenceView?.tone ?? "neutral",
    delivery: licenceView?.delivery ?? null,
    caption: licenceView?.caption ?? null,
    statusSentence: entitlement?.licence.sentence ?? null,
    serialNumber: entitlement?.licence.maskedSerial ?? null,
    payment: entitlement?.payment.sentence ?? null,
    paymentStatus: entitlement?.payment.status ?? null,
    scansState: entitlement
      ? scansStateSentence(entitlement.usage.scans.state)
      : null,
    customerEmail: entitlement?.customer.email ?? null,
    validityState: entitlement?.validity.state ?? "unknown",
    validityEndsAt: entitlement?.validity.endsAt ?? null,
    activatedAt: entitlement?.usage.activation.activatedAt ?? null,
    hostBinding: entitlement?.usage.activation.hostBinding ?? null,
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
  const [release, setRelease] = useState<ReleaseRecord | null>(null);

  /**
   * WS-K1-09 - the check is now a real request to the real endpoint.
   *
   * Before this phase the "check" was a `setTimeout` that answered AVAILABLE
   * with a hardcoded version, a hardcoded checksum, a hardcoded signature and
   * a hardcoded set of release notes. None of it came from a server, and no
   * server had published any of it. The branch below is the replacement: it
   * re-reads `GET /v1/me/entitlement` and reports exactly what the release
   * manifest says - including the case where it says nothing is published.
   */
  async function checkForSoftwareUpdates() {
    setUpdateStep("CHECKING");
    setUpdateProgressMsg("Re-reading the release manifest (GET /v1/me/entitlement)...");

    const result = await (props.refreshEntitlement ?? api.entitlement)();

    if (result.kind !== "ok") {
      setRelease(null);
      setUpdateStep("CHECK_FAILED");
      setUpdateProgressMsg(
        result.kind === "unauthenticated"
          ? "Your session ended before the check completed. Sign in again to check for updates."
          : `The release manifest could not be read: ${result.message}`,
      );
      return;
    }

    const build = result.entitlement.build;
    if (
      build.state === "published" &&
      build.url !== null &&
      build.version !== null &&
      build.sha256 !== null
    ) {
      setRelease({
        version: build.version,
        sha256: build.sha256,
        sizeBytes: build.sizeBytes,
        url: build.url,
        releasedAt: build.releasedAt,
        installerName: build.url.split("/").pop() || "cyvra-mobile.zip",
      });
      setUpdateStep("AVAILABLE");
      setUpdateProgressMsg("");
      return;
    }

    setRelease(null);
    setUpdateStep("NO_UPDATE");
    setUpdateProgressMsg(
      build.state === "published"
        ? `The release manifest is marked published but does not carry a download URL or a SHA-256, so no package can be offered. Reported state: "${build.state}".`
        : `The release manifest reports state "${build.state}", so no release has been published. There is nothing to download, verify or stage.`,
    );
  }

  /**
   * The one thing a browser can genuinely do with a published package: hand
   * its URL to the download manager. Verification of the bytes against the
   * published SHA-256 belongs to the CYVRA Mobile host that installs it, and
   * the panel below says so rather than claiming a signature was checked.
   */
  function downloadAndStageUpdate() {
    if (!release) return;
    setUpdateStep("DOWNLOADING");
    setUpdateProgressMsg("Passing the published package to your browser's download manager...");

    const anchor = document.createElement("a");
    anchor.href = release.url;
    anchor.download = release.installerName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setUpdateStep("STAGED");
    setUpdateProgressMsg("");
  }

  function rollbackUpdate() {
    setUpdateStep("ROLLED_BACK");
    setUpdateProgressMsg(
      "The downloaded package was discarded. Nothing on this workstation was changed: this Workspace never writes to the installed application.",
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

  /**
   * Spec 6's fifth question, Spec 91's fourth priority and Spec 92's
   * "WHAT NEEDS MY ATTENTION?" - answered from data the shell actually has,
   * with an explicit "nothing" branch so the screen can never be silent
   * about it.
   */
  function attentionItem(): { tone: "success" | "danger" | "action" | "neutral"; badge: string; text: string } {
    if (props.entitlement === null) {
      return {
        tone: "neutral",
        badge: "CHECKING",
        text: "Your licence is still being read from the server, so this cannot be confirmed yet.",
      };
    }
    if (props.entitlement.kind !== "ok") {
      return {
        tone: "danger",
        badge: "LICENCE",
        text: `${entNotice}. Nothing else on this page can be confirmed until the licence service answers again.`,
      };
    }
    if (license.tone === "danger") {
      return {
        tone: "danger",
        badge: "LICENCE",
        text: `${license.status}. Contact support quoting ${props.user.email}.`,
      };
    }
    if (!buildAvailable) {
      return {
        tone: "action",
        badge: "RELEASE",
        text: "No CYVRA Mobile build has been published yet, so the download below stays disabled.",
      };
    }
    return {
      tone: "success",
      badge: "NONE",
      text: "Nothing needs your attention in this Workspace.",
    };
  }

  function renderOverview() {
    const attention = attentionItem();

    return (
      <div className="ws-stack">
        <h1 className="ws-page-title">Overview</h1>
        <p className="ws-page-desc">
          Who you are, what licence you hold, whether the application is ready, what is happening
          with your devices, and what needs your attention.
        </p>

        {entNotice ? <StatusBadge tone="neutral">{entNotice}</StatusBadge> : null}

        {/*
         * Spec 6 - top summary area, in the specification's own label order.
         * Every value is read from `GET /v1/me/entitlement` or from the
         * session; nothing is defaulted into a plausible-looking figure.
         */}
        <div className="ws-grid">
          <MetricCard label="Customer" value={customerName} hint={props.user.email} />
          <MetricCard
            label="Licence"
            value={license.planName ?? "\u2014"}
            hint={license.planCode ?? "Plan not assigned"}
          />
          <MetricCard
            label="Licence status"
            value={entNotice ?? license.status ?? "\u2014"}
            hint={license.caption ?? license.statusSentence ?? "Not reported yet"}
            tone={entNotice ? undefined : license.tone}
          />
          <MetricCard
            label="Application"
            value={license.version ? `v${license.version}` : "Build unavailable"}
            hint={buildAvailable ? "Installer published" : "No installer published yet"}
            tone={buildAvailable ? "success" : undefined}
          />
          <MetricCard
            label="Device activity"
            value={String(props.sessions.length)}
            hint="sessions awaiting Report 1; scan totals are not published"
          />
          <MetricCard
            label="Reports"
            value={String(props.reports.length)}
            hint={`${props.sessions.length} awaiting Report 1. Failures are not reported.`}
          />
        </div>

        /*
         * Spec 91's first priority, spelled out. The strip above states the
         * status; this states what the customer actually holds, including
         * Spec 12's delivery line.
         */
        <SteelCard
          title="Your licence"
          badge={<StatusBadge tone={entNotice ? "neutral" : license.tone}>
            {entNotice ?? license.status ?? "\u2014"}
          </StatusBadge>}
          footer={
            <button
              type="button"
              className="ws-btn ws-btn--ghost"
              onClick={() => goTo("LICENCE_USAGE")}
            >
              Open Licence &amp; Usage
            </button>
          }
        >
          <LicenceCardLite
            rows={[
              { key: "Licence type", value: license.planName ?? "\u2014" },
              { key: "Status", value: license.status ?? entNotice ?? "\u2014" },
              { key: "Delivery", value: license.delivery ?? "Nothing issued yet" },
              { key: "Reference", value: license.serialNumber ?? "Not issued yet" },
              { key: "Payment", value: license.payment ?? "\u2014" },
            ]}
          />
        </SteelCard>

        <SteelCard
          title="What requires your attention"
          badge={<StatusBadge tone={attention.tone}>{attention.badge}</StatusBadge>}
        >
          <p className="ws-panel__text">{attention.text}</p>
        </SteelCard>

        {/* Spec 7 - primary actions, in the order the specification lists them. */}
        <SteelCard title="Primary actions">
          <div className="ws-actions">
            <button
              type="button"
              className="ws-btn ws-btn--ghost"
              onClick={() => goTo("CYVRA_MOBILE")}
            >
              Purchase CYVRA Mobile
            </button>
            {buildAvailable ? (
              <a
                className="ws-btn ws-btn--action"
                href={license.downloadUrl ?? undefined}
                download={license.installerName ?? undefined}
              >
                Download Application
              </a>
            ) : (
              <button type="button" className="ws-btn ws-btn--ghost" disabled>
                Download Application (no published build)
              </button>
            )}
            <button
              type="button"
              className="ws-btn ws-btn--ghost"
              onClick={() => goTo("REPORTING_AUDIT")}
            >
              Open Reporting &amp; Audit
            </button>
            <button
              type="button"
              className="ws-btn ws-btn--ghost"
              onClick={() => goTo("DEVICE_ACTIVITY")}
            >
              View Device Activity
            </button>
          </div>
        </SteelCard>

        {/* Spec 13/14 - availability follows release state, never wishful thinking. */}
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

          {/* Spec 91, priority 5 - Update / Upgrade sits below the activity above. */}
          <SteelCard
            title={"Update & Upgrade"}
            footer={
              <button
                type="button"
                className="ws-btn ws-btn--ghost"
                onClick={() => goTo("UPDATE_UPGRADE")}
              >
                Open Update &amp; Upgrade
              </button>
            }
          >
            <p className="ws-panel__text">
              Updates maintain the application; upgrades change the plan your licence covers.
            </p>
            <p className="ws-panel__text">
              Release state:{" "}
              {buildAvailable && license.version
                ? `v${license.version} published`
                : `no build published (${license.buildState})`}
              .
            </p>
          </SteelCard>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ *
   * Spec 8/9/10/11 - the licence request.
   *
   * No endpoint in `services/api` accepts a purchase or licence request, so
   * this form never claims to have sent one. It validates what Spec 9 makes
   * mandatory, then produces the clean status summary Spec 10 describes and
   * states plainly that nothing left the page.
   * ------------------------------------------------------------------ */

  /** Spec 8 - the option list is derived from the approved licence policy. */
  function licenceLabel(slab: PlanSlab): string {
    return `1 User / ${slab} ${slab === 1 ? "Device" : "Devices"}`;
  }

  function setPurchaseField<K extends keyof typeof purchase>(name: K, value: (typeof purchase)[K]) {
    setPurchase((current) => ({ ...current, [name]: value }));
  }

  function validatePurchase(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (purchase.companyName.trim().length < 2) {
      errors.companyName = "Enter the customer or company name the licence belongs to.";
    }
    if (purchase.addressLine1.trim().length < 3) {
      errors.addressLine1 = "Enter the registered or business address.";
    }
    // Spec 9: "PIN CODE - Mandatory. Must be validated as an Indian PIN code."
    if (!INDIAN_PIN.test(purchase.pincode)) {
      errors.pincode = "Enter a valid 6-digit Indian PIN code, beginning with 1-9.";
    }
    return errors;
  }

  function submitPurchase(event: FormEvent) {
    event.preventDefault();
    const errors = validatePurchase();
    setPurchaseErrors(errors);
    if (Object.keys(errors).length > 0) {
      setPurchaseRecord(null);
      return;
    }
    setCopyNote("");
    setPurchaseRecord({
      licenceSlab: purchase.licenceSlab,
      companyName: purchase.companyName.trim(),
      address: [purchase.addressLine1.trim(), purchase.addressLine2.trim()]
        .filter(Boolean)
        .join(", "),
      pincode: purchase.pincode,
      stateName: purchase.stateName,
      paymentStatus: purchase.paymentDone ? "Done" : "Not Done",
      preparedAt: new Date().toISOString(),
    });
  }

  /** The plain-text form of the Spec 10 status summary. */
  function purchaseSummaryText(record: NonNullable<typeof purchaseRecord>): string {
    return [
      "CYVRA MOBILE LICENCE REQUEST - prepared in the Customer Workspace",
      `Prepared: ${formatDateTime(record.preparedAt)}`,
      `Registered email: ${props.user.email}`,
      `Customer / company name: ${record.companyName}`,
      `Address: ${record.address}${record.stateName ? `, ${record.stateName}` : ""}`,
      `PIN code: ${record.pincode}`,
      `Licence type: ${licenceLabel(record.licenceSlab)}`,
      `Payment status: ${record.paymentStatus}`,
      `Licence status on record: ${license.status ?? entNotice ?? "\u2014"}`,
      `Licence reference: ${license.serialNumber ?? "Not issued yet"}`,
      `Download availability: ${buildAvailable ? "BUILD AVAILABLE" : "BUILD NOT AVAILABLE"}`,
      "",
      "NOT SENT: no endpoint accepts a licence request yet. Place it with the business.",
    ].join("\n");
  }

  async function copyPurchaseSummary() {
    if (!purchaseRecord) return;
    const text = purchaseSummaryText(purchaseRecord);
    if (!navigator.clipboard?.writeText) {
      setCopyNote("Copying is not available in this browser. Select the summary above to copy it.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyNote("Request summary copied to the clipboard.");
    } catch {
      setCopyNote("Copying was refused by the browser. Select the summary above to copy it.");
    }
  }

  function renderCyvraMobile() {
    return (
      <div className="ws-stack">
        <h1 className="ws-page-title">CYVRA Mobile</h1>
        <p className="ws-page-desc">
          Purchase, licence delivery and application download.
        </p>

        {/* Spec 8 - purchase area. */}
        <SteelCard
          title="PURCHASE CYVRA MOBILE"
          badge={<StatusBadge tone="neutral">LICENCE REQUEST</StatusBadge>}
        >
          <p className="ws-panel__text" style={{ marginBottom: 16 }}>
            Select the licence model required for your operation.
          </p>

          <form onSubmit={submitPurchase} noValidate>
            <div className="ws-grid">
              <Field
                htmlFor="purchase-licence-type"
                label="Licence Type"
                hint="Options come from the approved licence policy, not from this page."
              >
                <select
                  id="purchase-licence-type"
                  className="ws-input"
                  value={purchase.licenceSlab}
                  onChange={(e) =>
                    setPurchaseField("licenceSlab", Number(e.target.value) as PlanSlab)
                  }
                >
                  {PLAN_SLABS.map((slab) => (
                    <option key={slab} value={slab}>
                      {licenceLabel(slab)}
                    </option>
                  ))}
                </select>
              </Field>

              {/* Spec 9 - populated from the account, read-only by default. */}
              <Field
                htmlFor="purchase-email"
                label="Registered email"
                hint="Same as Registered Email - taken from your account."
              >
                <input
                  id="purchase-email"
                  className="ws-input"
                  type="email"
                  readOnly
                  value={props.user.email}
                />
              </Field>

              <Field
                htmlFor="purchase-company"
                label="Customer / company name *"
                error={purchaseErrors.companyName}
              >
                <input
                  id="purchase-company"
                  className="ws-input"
                  value={purchase.companyName}
                  aria-invalid={purchaseErrors.companyName ? true : undefined}
                  aria-describedby={
                    purchaseErrors.companyName ? "purchase-company-error" : undefined
                  }
                  onChange={(e) => setPurchaseField("companyName", e.target.value)}
                  required
                />
              </Field>

              <Field
                htmlFor="purchase-pin"
                label="PIN code *"
                hint="Mandatory. Validated as an Indian PIN code."
                error={purchaseErrors.pincode}
              >
                <input
                  id="purchase-pin"
                  className="ws-input"
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[1-9][0-9]{5}"
                  value={purchase.pincode}
                  aria-invalid={purchaseErrors.pincode ? true : undefined}
                  aria-describedby={purchaseErrors.pincode ? "purchase-pin-error" : undefined}
                  onChange={(e) =>
                    setPurchaseField("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  required
                />
              </Field>

              <Field
                htmlFor="purchase-address-1"
                label="Address line 1 *"
                error={purchaseErrors.addressLine1}
              >
                <input
                  id="purchase-address-1"
                  className="ws-input"
                  value={purchase.addressLine1}
                  aria-invalid={purchaseErrors.addressLine1 ? true : undefined}
                  aria-describedby={
                    purchaseErrors.addressLine1 ? "purchase-address-1-error" : undefined
                  }
                  onChange={(e) => setPurchaseField("addressLine1", e.target.value)}
                  required
                />
              </Field>

              <Field htmlFor="purchase-address-2" label="Address line 2">
                <input
                  id="purchase-address-2"
                  className="ws-input"
                  value={purchase.addressLine2}
                  onChange={(e) => setPurchaseField("addressLine2", e.target.value)}
                />
              </Field>

              <Field htmlFor="purchase-state" label="State">
                <select
                  id="purchase-state"
                  className="ws-input"
                  value={purchase.stateName}
                  onChange={(e) => setPurchaseField("stateName", e.target.value)}
                >
                  <option value="">Select state</option>
                  {IN_STATES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>

              {/* Spec 11 - manual. No gateway, no provider, no token. */}
              <Field
                htmlFor="purchase-payment"
                label="Payment status"
                hint="Manual. Recorded by the authorised business - this page takes no payment."
              >
                <select
                  id="purchase-payment"
                  className="ws-input"
                  value={purchase.paymentDone ? "Done" : "Not Done"}
                  onChange={(e) => setPurchaseField("paymentDone", e.target.value === "Done")}
                >
                  <option value="Not Done">Not Done</option>
                  <option value="Done">Done</option>
                </select>
              </Field>
            </div>

            {purchase.paymentDone ? (
              <div style={{ marginTop: 16 }}>
                <SuccessPanel title="Payment marked complete.">
                  This is your own manual declaration on this page. It is not a payment, it was
                  not sent anywhere, and on its own it authorises nothing.
                </SuccessPanel>
              </div>
            ) : null}

            <div className="ws-actions" style={{ marginTop: 16 }}>
              <button type="submit" className="ws-btn ws-btn--primary">
                Review licence request
              </button>
            </div>
          </form>
        </SteelCard>

        {/* Spec 11 - the rule that keeps "Done" from being mistaken for a licence. */}
        <SteelCard
          title="Payment is not an entitlement"
          badge={<StatusBadge tone="action">SPEC 11</StatusBadge>}
        >
          <p className="ws-panel__text">
            There is no payment gateway, no payment processing, no payment credentials and no
            payment-provider dependency anywhere in this product. A status of{" "}
            <strong>Payment Done</strong> is a manual note, and it does not, by itself, grant an
            application entitlement. The final operational authorization signal is{" "}
            <strong>VALID LICENCE ISSUED</strong>, reached only through the existing licensing
            and approval process.
          </p>
          <p className="ws-panel__text" style={{ marginTop: 10 }}>
            Payment status on record for this account:{" "}
            <strong>{license.payment ?? entNotice ?? "\u2014"}</strong>.
          </p>
        </SteelCard>

        {purchaseRecord ? (
          /*
           * Spec 10 - a clean status summary, not internal administrative
           * fields. Request ID and the server-side timestamps appear as
           * absences, because nothing has been recorded on any server.
           */
          <>
            <LicenceCard
              title="Purchase record"
              badge={<StatusBadge tone="neutral">STATUS SUMMARY</StatusBadge>}
              footer={
                <button
                  type="button"
                  className="ws-btn ws-btn--ghost"
                  onClick={copyPurchaseSummary}
                >
                  Copy request summary
                </button>
              }
              rows={[
                {
                  key: "Request ID",
                  value: "Not assigned - no endpoint receives this request",
                },
                { key: "Registered email", value: props.user.email },
                { key: "Customer / company name", value: purchaseRecord.companyName },
                {
                  key: "Address",
                  value: `${purchaseRecord.address}${
                    purchaseRecord.stateName ? `, ${purchaseRecord.stateName}` : ""
                  }`,
                },
                { key: "PIN code", value: purchaseRecord.pincode },
                { key: "Selected licence type", value: licenceLabel(purchaseRecord.licenceSlab) },
                { key: "Payment status", value: purchaseRecord.paymentStatus },
                {
                  key: "Request date/time",
                  value: `${formatDateTime(purchaseRecord.preparedAt)} (prepared on this device)`,
                },
                { key: "Licence status", value: license.status ?? entNotice ?? "\u2014" },
                {
                  key: "Licence issued date/time",
                  value: "Not reported by the licence service",
                },
                { key: "Licence reference", value: license.serialNumber ?? "Not issued yet" },
                {
                  key: "Application entitlement",
                  value: license.planName ?? entNotice ?? "\u2014",
                },
                {
                  key: "Download availability",
                  value: buildAvailable ? "BUILD AVAILABLE" : "BUILD NOT AVAILABLE",
                },
              ]}
            />
            <SteelCard
              title="This request was not sent"
              badge={<StatusBadge tone="neutral">NOT SENT</StatusBadge>}
            >
              <p className="ws-panel__text">
                No endpoint in the API accepts a licence request yet, so nothing above left this
                page and no record was created on the server. Place the request with the business,
                or copy the summary and send it to them.
              </p>
              {copyNote ? (
                <p className="ws-panel__text" style={{ marginTop: 10 }}>
                  {copyNote}
                </p>
              ) : null}
            </SteelCard>
          </>
        ) : null}

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
              // The manifest publishes a SHA-256 integrity value and no
              // signature, so the step is named for what can be verified.
              { id: "verify", label: "Verify integrity" },
              { id: "stage", label: "Stage" },
              { id: "restart", label: "Restart to apply" },
            ]}
            currentId={
              updateStep === "AVAILABLE"
                ? "verify"
                : updateStep === "DOWNLOADING"
                  ? "stage"
                  : updateStep === "STAGED"
                    ? "restart"
                    : "check"
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

  /**
   * Spec 88 - the prescribed field list, and nothing that would duplicate the
   * administrative licensing system. Where the entitlement projection carries
   * no value (issued date, usage consumed) the row states the absence rather
   * than borrowing a figure from somewhere it was not measured.
   */
  function renderLicenceUsage() {
    const usagePolicy =
      "This licence model does not publish a fixed usage limit. Scan entitlement is recorded " +
      "server-side and reported here as a state; the Workspace does not compute a balance.";

    return (
      <div className="ws-stack">
        <h1 className="ws-page-title">Licence &amp; usage</h1>
        <p className="ws-page-desc">
          The commercial facts of your account, exactly as the server reports them.
        </p>

        <div className="ws-grid">
          <LicenceCard
            title="Licence record"
            badge={
              <StatusBadge tone={entNotice ? "neutral" : license.tone}>
                {entNotice ?? license.status ?? "\u2014"}
              </StatusBadge>
            }
            rows={[
              { key: "Licence type", value: license.planName ?? "\u2014" },
              {
                key: "Licence status",
                value: license.status ?? entNotice ?? "\u2014",
              },
              {
                key: "Issued date",
                value: "Not reported by the licence service",
              },
              {
                key: "Expiry",
                value: license.validityEndsAt
                  ? formatDateTime(license.validityEndsAt)
                  : "Not set for this licence",
              },
              {
                key: "Device entitlement",
                value: license.slab
                  ? `${license.slab} ${license.slab === "1" ? "device" : "devices"}`
                  : (license.planName ?? "\u2014"),
              },
              { key: "Usage limit", value: usagePolicy },
              {
                key: "Usage consumed",
                value: "Not reported - scan debits are recorded server-side",
              },
              { key: "Remaining / available", value: license.scansState ?? "\u2014" },
              { key: "Registered email", value: license.customerEmail ?? props.user.email },
              { key: "Delivery", value: license.delivery ?? "Nothing issued yet" },
              {
                key: "Activation",
                value: license.activatedAt ? formatDateTime(license.activatedAt) : "Not activated yet",
              },
              { key: "Licence reference", value: license.serialNumber ?? "Not issued yet" },
              { key: "Payment", value: license.payment ?? "\u2014" },
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
              <StatusBadge tone={entNotice ? "neutral" : license.tone}>
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
              <StatusBadge tone={entNotice ? "neutral" : license.tone}>
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
          title="Software Update"
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
              Latest published build:{" "}
              <strong>{license.version ? `v${license.version}` : "none published"}</strong>
            </span>
            <StatusBadge tone={buildAvailable ? "action" : "neutral"}>
              {buildAvailable ? "RELEASE PUBLISHED" : "NO RELEASE PUBLISHED"}
            </StatusBadge>
          </div>

          {updateStep === "IDLE" ? (
            <div>
              <div className="ws-panel ws-panel--success" style={{ marginBottom: 14 }}>
                <p className="ws-panel__text" style={{ margin: 0 }}>
                  This screen reports what the release pipeline has published. It does not inspect
                  or modify the workstation.
                </p>
              </div>
              <p className="ws-panel__text" style={{ marginBottom: 18 }}>
                Updates maintain the application, its diagnostic collectors and Platform-Tools.
                They never modify your purchased scan entitlements, which are governed by
                upgrades.
              </p>
              <button
                type="button"
                className="ws-btn ws-btn--action"
                style={{ width: "100%" }}
                onClick={checkForSoftwareUpdates}
              >
                Check for updates (GET /v1/me/entitlement)
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

          {updateStep === "AVAILABLE" && release ? (
            <div>
              <div className="ws-panel ws-panel--action" style={{ marginBottom: 14 }}>
                <h4 className="ws-panel__title">
                  Published release available: v{release.version}
                </h4>
                <p className="ws-panel__text" style={{ margin: 0 }}>
                  Read from the release manifest at{" "}
                  <span className="ws-mono">build-manifest.json</span>.
                </p>
              </div>

              <LicenceCardLite
                rows={[
                  { key: "Version", value: `v${release.version}` },
                  {
                    key: "Release date",
                    value: release.releasedAt ? formatDateTime(release.releasedAt) : "\u2014",
                  },
                  { key: "Package", value: release.installerName },
                  { key: "File size", value: formatSize(release.sizeBytes) ?? "\u2014" },
                  {
                    key: "SHA-256",
                    value: (
                      <span className="ws-mono" style={{ wordBreak: "break-all" }}>
                        {release.sha256}
                      </span>
                    ),
                  },
                  {
                    key: "Manifest signature",
                    value: "Not published - the manifest carries an integrity value only",
                  },
                ]}
              />

              <p className="ws-panel__text" style={{ margin: "14px 0" }}>
                Verify the SHA-256 of what you download against the value above before you
                install it. The Workspace cannot sign, stage or write the package for you.
              </p>

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  className="ws-btn ws-btn--action"
                  style={{ flex: 1 }}
                  onClick={downloadAndStageUpdate}
                >
                  Download published package
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

          {/*
           * WS-K1-09 - the two branches the old implementation could not
           * reach, because its check always answered AVAILABLE with an
           * invented package.
           */}
          {updateStep === "NO_UPDATE" ? (
            <div>
              <div className="ws-panel" style={{ marginBottom: 14 }}>
                <h4 className="ws-panel__title">No release published</h4>
                <p className="ws-panel__text">{updateProgressMsg}</p>
              </div>
              <p className="ws-panel__text" style={{ marginBottom: 18 }}>
                This is a real answer from the release manifest, not a placeholder. The check
                will offer a package the moment a release job publishes one.
              </p>
              <button
                type="button"
                className="ws-btn ws-btn--ghost"
                style={{ width: "100%" }}
                onClick={() => setUpdateStep("IDLE")}
              >
                Return to update manager
              </button>
            </div>
          ) : null}

          {updateStep === "CHECK_FAILED" ? (
            <div>
              <ErrorPanel title="The release manifest could not be read">
                {updateProgressMsg}
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

          {updateStep === "STAGED" && release ? (
            <div>
              <SuccessPanel title="Package download started">
                Your browser is fetching the published package. Verify its SHA-256 against the
                value shown above before installing it. This Workspace does not write to the
                installed application; the CYVRA Mobile host verifies and applies the update, and
                keeps its own rollback copy.
              </SuccessPanel>

              <div style={{ margin: "14px 0" }}>
                <LicenceCardLite
                  rows={[
                    { key: "Target version", value: `v${release.version}` },
                    { key: "Package", value: release.installerName },
                    { key: "Published SHA-256", value: <span className="ws-mono" style={{ wordBreak: "break-all" }}>{release.sha256}</span> },
                    { key: "Applied by", value: "CYVRA Mobile host, on restart" },
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
                      `v${release.version} is in your downloads. Restart the workstation and the CYVRA Mobile host applies it.`,
                    );
                    setUpdateModalOpen(false);
                  }}
                >
                  Got it - apply on restart
                </button>
                <button type="button" className="ws-btn ws-btn--danger" onClick={rollbackUpdate}>
                  Discard downloaded package
                </button>
              </div>
            </div>
          ) : null}

          {updateStep === "ROLLED_BACK" ? (
            <div>
              <ErrorPanel title="Downloaded package discarded">
                {updateProgressMsg}
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
