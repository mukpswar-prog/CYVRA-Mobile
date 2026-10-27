import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { ActivationScreen, type ActivationFields } from "./activation/ActivationScreen";
import cyvoriqLogo from "./assets/cyvoriq-solutions.png";
import { LedgerScreen } from "./ledger/LedgerScreen";
import type { LedgerReadResult } from "./ledger/parseLedger";
import { nextScanBinding } from "./scanBinding";

/**
 * Commit this bundle was built from, injected by `vite.config.ts`.
 *
 * CI sets `GITHUB_SHA`, so a shipped installer names a real commit; a local
 * build says `development` rather than pretending to be a revision.
 */
declare const __CYVRA_BUILD_COMMIT__: string;

const BUILD_COMMIT: string = __CYVRA_BUILD_COMMIT__;

/**
 * Number of fixed slots on the Connected Devices dashboard.
 *
 * A slot is a position on the board, not a phone: on a workstation with one
 * handset attached, 49 slots are empty and that is the normal case. This
 * number bounds what the dashboard can display. It is not a claim that 50
 * phones are present, and it is not the scan allowance - the Host reports
 * that separately as `scansRemaining`.
 */
const DEVICE_SLOT_CAPACITY = 50;

/** CYVRA.01 .. CYVRA.50 - a dashboard slot number, never a serial or a report ID. */
const slotLabelFor = (slotNumber: number): string =>
  `CYVRA.${slotNumber.toString().padStart(2, "0")}`;

type HostInfoResult = {
  connected: boolean;
  protocolVersion: string;
  requestId: string;
  hostVersion: string;
};

type ActivationStatusResult = {
  state: "activated" | "unactivated" | "rejected" | "error";
  termsVersion: string;
  message: string | null;
};

type HostError = {
  code: string;
  message: string;
};

/**
 * One line of exactly what the Kotlin Host writes on stdout.
 *
 * `status` and `error` are carried through untouched so a refusal
 * (`LICENSE_REQUIRED`, `SANITIZE_PHRASE_MISMATCH`) and the decision D-1
 * blocked outcome are rendered as the Host reported them rather than being
 * flattened into a generic failure. `payload` is typed `unknown` on purpose:
 * nothing is read from it until `payloadOf` has narrowed it to an object
 * coming off an `OK` envelope.
 */
type HostEnvelope = {
  protocolVersion: string;
  requestId: string;
  status: "OK" | "ERROR";
  hostVersion: string;
  payload: unknown;
  error: HostError | null;
};

type DeviceDescriptor = {
  serial: string;
  state: string;
  product?: string | null;
  model?: string | null;
  device?: string | null;
};

/** Result of the existing `get_device_state` command (unchanged P1 surface). */
type DeviceStateResult = {
  connectionState: string;
  usbState: string;
  adbState: string;
  adbAvailable: boolean;
  readyToScan: boolean;
  statusMessage: string;
  operatorActionRequired: string | null;
  device: DeviceDescriptor | null;
};

/**
 * One row of the Host's read-only `GET_CONNECTED_DEVICES` answer.
 *
 * Every field is optional on purpose. The Host only emits a value it actually
 * read: an unknown model or make is simply absent and the table renders the
 * literal "Not reported", never a guess. `imeiReason` replaces `imei` for
 * every row this build can answer, because an IMEI is not readable over the
 * phone connection and the workstation does not invent one.
 */
type ConnectedDevice = {
  transport?: string;
  serial: string;
  state: "detected" | "unauthorized" | "authorized" | "disconnected";
  model?: string;
  make?: string;
  imei?: string;
  imeiReason?: string;
  portOrLocation?: string;
};

/** The payload shape the Host returns for `GET_CONNECTED_DEVICES`. */
type ConnectedDevicesPayload = {
  adbAvailable?: boolean;
  devices?: ConnectedDevice[];
};

/** Lifecycle of one phone's row in the device table. Presentation only. */
type DeviceRowPhase = "idle" | "scanning" | "reporting" | "sanitize" | "exported";

type DeviceRowStatus = "Not started" | "In progress" | "Ok" | "Failed";

type DeviceRowState = {
  phase: DeviceRowPhase;
  status: DeviceRowStatus;
  reason: string;
  /** True only after `EXPORT_REPORT` returned OK for this serial. */
  exportedOk: boolean;
  /**
   * This phone's own six-stage bar.
   *
   * Written only where an operation already patches this row, so every entry
   * traces to a Host response that named this serial - never to a global
   * envelope belonging to whichever phone happened to be scanned last.
   * Optional so a row that has done nothing simply has no entries, which the
   * bar renders as `pending`.
   */
  stages?: Partial<Record<StageKey, StageRecord>>;
};

/**
 * The six stages of the workflow bar, in display order.
 *
 * These are presentation labels for the same six operations the wizard runs;
 * `StageKey` maps onto `StepKey` below by name, so no second set of stage
 * definitions is introduced.
 */
type StageKey = "connect" | "scan" | "applications" | "sanitize" | "verify" | "download";

/**
 * How one stage of one phone's workflow is doing.
 *
 *   PENDING       nothing has been attempted for this phone
 *   IN PROGRESS   an operation for this phone has genuinely started
 *   COMPLETED     the operation reported full success
 *   PARTIAL       the operation answered, but its own result says the outcome
 *                 was incomplete - never rendered as full success
 *   BLOCKED       the Host answered and governance refused it - never a success
 *   FAILED        the operation refused or the bridge failed
 */
type StageTone =
  | "pending"
  | "in-progress"
  | "completed"
  | "partial"
  | "blocked"
  | "failed";

type StageRecord = {
  tone: StageTone;
  /** Short operator-facing sentence. Carries the reason for anything not OK. */
  note: string;
  /** Local wall-clock time the operation reported, "HH:MM". */
  at?: string;
};

type SanitizeStage = "start" | "authorize" | "confirm" | "execute";

const SANITIZE_COMMANDS: Record<SanitizeStage, string> = {
  start: "SANITIZE_START",
  authorize: "SANITIZE_AUTHORIZE",
  confirm: "SANITIZE_CONFIRM",
  execute: "SANITIZE_EXECUTE",
};

const EMPTY_SANITIZE: Record<SanitizeStage, HostEnvelope | null> = {
  start: null,
  authorize: null,
  confirm: null,
  execute: null,
};

type DeviceSessionEnvelopes = {
  scan: HostEnvelope | null;
  inventory: HostEnvelope | null;
  checklistRecorded: HostEnvelope | null;
  checklistAnswers: Record<string, string>;
  sanitize: Record<SanitizeStage, HostEnvelope | null>;
  exported: HostEnvelope | null;
  finalised: HostEnvelope | null;
};

const EMPTY_DEVICE_ENVELOPES: DeviceSessionEnvelopes = {
  scan: null,
  inventory: null,
  checklistRecorded: null,
  checklistAnswers: {},
  sanitize: EMPTY_SANITIZE,
  exported: null,
  finalised: null,
};

type StepKey = "connect" | "scan" | "inventory" | "sanitize" | "checklist" | "export";

/**
 * One entry per stage of the operator wizard.
 *
 * Everything here is static interface text: it names the stage, tells the
 * operator what to do, and labels the stage's single primary action. It never
 * describes a result - every value shown *inside* a stage still comes from a
 * Host response. No protocol command name appears in any of these strings;
 * the interface never shows one at all.
 */
type StepMeta = {
  key: StepKey;
  index: number;
  label: string;
  heading: string;
  /** The single orange primary action for this stage. */
  primary: string;
  purpose: string;
  now: string;
  next: string;
};

const STEPS: StepMeta[] = [
  {
    key: "connect",
    index: 1,
    label: "Connect",
    heading: "Workstation and phone connection",
    primary: "Check connection",
    purpose:
      "Confirm this laptop is ready, and that the phone is plugged in and allowed to talk to it.",
    now: "Plug the phone into any USB port with a data cable, then unlock it and allow this computer when the phone asks.",
    next: "When the phone says it is ready you can scan it in the next step.",
  },
  {
    key: "scan",
    index: 2,
    label: "Scan",
    heading: "Scan the connected phone",
    primary: "Scan phone",
    purpose:
      "Read the phone's identity and the list of applications installed on it, without copying any personal content.",
    now: "Check which phone is shown below, add your operator ID if your site uses one, then start the scan.",
    next: "The scan produces the report that every later step reads from.",
  },
  {
    key: "inventory",
    index: 3,
    label: "Applications",
    heading: "Applications found on the phone",
    primary: "Load applications",
    purpose:
      "Show which applications are installed on the phone, and how trustworthy that list is.",
    now: "Load the list and read the completeness figures - a filtered list is not the same as a complete one.",
    next: "Once you are happy with the list you can download the report.",
  },
  {
    key: "sanitize",
    index: 4,
    label: "Sanitize",
    heading: "Hardware-gated purge guide",
    primary: "Start sanitize guide",
    purpose: "Walk you through the guarded steps that would erase the phone.",
    now: "Start the guide and work through each prompt in order - a step only unlocks once the one before it is done.",
    next: "The last step reports the workstation's decision. On this build the purge is deliberately blocked, and the screen says so.",
  },
  {
    key: "checklist",
    index: 5,
    label: "Verify",
    heading: "Technician verification",
    primary: "Record checklist",
    purpose:
      "Record what a person checked on the phone, which no software scan can see for itself.",
    now:
      "Read each check in turn and choose the outcome that matches what you found. The one P0 check is listed above the P1 checks because it needs specialist equipment.",
    next:
      "Once every check has an outcome you can record them. They are stored as a person's findings, never as a software observation.",
  },
  {
    key: "export",
    index: 6,
    label: "Download",
    heading: "Download the verified report",
    primary: "Download reports",
    purpose: "Save the finished report and its checksum file onto this laptop so you can hand them over.",
    now: "Download the reports and note the file locations the workstation gives you.",
    next: "The files stay with the scan on this laptop; nothing is uploaded anywhere.",
  },
];

/**
 * The six workflow segments, in display order.
 *
 * `key` is the same stage key the wizard uses, so a segment and the operation
 * that drives it can never drift apart. `hue` is presentation only - it gives
 * a segment its colour identity and never decides a state: the state comes
 * from the phone's own `stages` record and is always printed in words beside
 * the symbol, so colour is never the sole signal.
 *
 * `head` is the column header text only, and it is never the accessible name -
 * that stays `label` via `aria-label`, so the full unbroken word is always
 * available to a screen reader.
 *
 * A 52px column cannot hold "Applications" or "Download" on one line. Soft
 * hyphens (U+00AD) were tried first and are NOT honoured here: Chromium /
 * WebView2 declined to use them because the syllable before the break did not
 * fit the content box either, and it fell back to a character-boundary break
 * with no hyphen printed - "Applicatio/ns", which reads as a rendering fault.
 * `hyphens: auto` is also a no-op: that engine ships no hyphenation
 * dictionary, so the property does nothing regardless of the document
 * language.
 *
 * So the break is stated outright: a real hyphen followed by a newline, with
 * `white-space: pre-line` on the header. The hyphen is an ordinary character
 * and is always drawn, so the header reads as typeset ("Applica-" / "tions")
 * instead of accidentally split.
 */
const STAGE_SEGMENTS: { key: StageKey; label: string; hue: string; head: string }[] = [
  { key: "scan", label: "H/W SCN", hue: "orange", head: "H/W SCN" },
  { key: "applications", label: "App SCN", hue: "purple", head: "App SCN" },
  { key: "sanitize", label: "SAN", hue: "teal", head: "SAN" },
  { key: "verify", label: "VER", hue: "indigo", head: "VER" },
];

/** Plain-language state word shown inside a segment. */
const STAGE_TONE_TEXT: Record<StageTone, string> = {
  pending: "Pending",
  "in-progress": "In progress",
  completed: "Completed",
  partial: "Partial",
  blocked: "Blocked",
  failed: "Failed",
};

/** Symbol shown inside a segment. Paired with the word, never a replacement. */
const STAGE_TONE_GLYPH: Record<StageTone, string> = {
  pending: "○",
  "in-progress": "◔",
  completed: "✓",
  partial: "◑",
  blocked: "⊘",
  failed: "✕",
};

/** Class-name slug for a stage tone. */
const stageToneSlug: Record<StageTone, string> = {
  pending: "pending",
  "in-progress": "in-progress",
  completed: "completed",
  partial: "partial",
  blocked: "blocked",
  failed: "failed",
};

/** Class-name slug for a derived row status ("In progress" -> "in-progress"). */
const slugify = (value: string): string => value.toLowerCase().replace(/\s+/g, "-");

/**
 * Row state for a slot no phone has ever claimed.
 *
 * One shared object rather than a fresh literal per slot: 50 empty slots would
 * otherwise allocate 50 identical records on every render. Safe to share
 * because every write path replaces the row object instead of mutating it, and
 * `stages` is left absent so an empty slot reads as "nothing has happened here"
 * rather than borrowing any phone's result.
 */
const EMPTY_ROW_STATE: DeviceRowState = Object.freeze({
  phase: "idle",
  status: "Not started",
  reason: "",
  exportedOk: false,
} as const);

/**
 * Execution statuses that mean NO wipe took place.
 *
 * Every status the Host can answer when the purge did not run: the device has
 * no enrolled agent, its eligibility could not be read, or the trigger never
 * reached it. A stage carrying one of these is BLOCKED and is never rendered
 * as completed.
 *
 * `TRIGGERED_AGENT_BASED_REBOOT_PENDING` is deliberately NOT in this list: it
 * means a wipe was requested, and whether it completed is established only
 * later, by post-reset verification.
 *
 * Module scope because `runSanitize` records the sanitize stage against the
 * phone it was sent for, and that function is declared above the point where
 * the list used to live.
 */
const BLOCKED_EXECUTION_STATUSES = [
  "BLOCKED_NOT_ELIGIBLE",
  "BLOCKED_ELIGIBILITY_NOT_ESTABLISHED",
  "FAILED_TRIGGER_NOT_ISSUED",
  // Not a success and not a failure: the command went out and the device stopped
  // answering, which is what a wipe does as it starts. It must be shown as
  // unsettled, never as done and never as failed.
  "TRIGGER_OUTCOME_INDETERMINATE",
];

/**
 * Row label a phone is carried under in the monitoring dashboard.
 *
 * Precedence is chosen so that a row can never read as better than it is:
 *
 *   Disconnected  the phone is gone - stated first, before any colour is read
 *   Scanning      the scan itself is running right now
 *   In progress   some other stage is running right now
 *   Failed        a stage reported failure
 *   Blocked       a stage was refused (governance, or ALLOW not tapped)
 *   Partial       a stage answered with less than full coverage
 *   Completed     every one of the six stages genuinely completed
 *   Pending       otherwise - work remains
 *
 * The property that matters: `Completed` is reached ONLY when all six stages
 * read completed, so an overall status can never launder a blocked Sanitize or
 * a partial Applications answer into a green row. On a build where the purge is
 * held by decision D-1, Sanitize never reaches `completed`, which means no row
 * reports `Completed` - that is the truthful output, not a defect, and it is
 * reported as such rather than papered over.
 */
function overallFor(
  stages: { key: StageKey; tone: StageTone }[],
  disconnected: boolean,
): string {
  if (disconnected) {
    return "Disconnected";
  }

  const toneOf = (key: StageKey): StageTone =>
    stages.find((stage) => stage.key === key)?.tone ?? "pending";

  if (toneOf("scan") === "in-progress") {
    return "Scanning";
  }

  if (stages.some((stage) => stage.tone === "in-progress")) {
    return "In progress";
  }

  if (stages.some((stage) => stage.tone === "failed")) {
    return "Failed";
  }

  if (stages.some((stage) => stage.tone === "blocked")) {
    return "Blocked";
  }

  if (stages.some((stage) => stage.tone === "partial")) {
    return "Partial";
  }

  if (stages.every((stage) => stage.tone === "completed")) {
    return "Completed";
  }

  return "Pending";
}

/**
 * Stepper tone for a stage. Six words, each derived from a predicate the
 * buttons already use - a stage never invents a result of its own.
 *
 *   IN PROGRESS  a Host command for this stage is in flight
 *   FAILED       the stage's response was `status: "ERROR"`, the bridge failed
 *                while running it, or the workstation check did not pass
 *   COMPLETED    the stage's response was `status: "OK"` with a payload
 *   BLOCKED      the stage answered and decision D-1 blocked it - never a success
 *   NOT STARTED  the stage is locked; its gate reason is printed on the node
 *   READY        the stage is unlocked and has not been run
 */
type NodeState = "IN PROGRESS" | "FAILED" | "COMPLETED" | "BLOCKED" | "NOT STARTED" | "READY";

/** Class-name slug for each stepper state. */
const stateSlug: Record<NodeState, string> = {
  "IN PROGRESS": "progress",
  FAILED: "failed",
  COMPLETED: "completed",
  BLOCKED: "blocked",
  "NOT STARTED": "not-started",
  READY: "ready",
};

/** Commands whose flight or failure belongs to each stage. */
const STAGE_COMMANDS: Record<StepKey, string[]> = {
  connect: ["GET_PREFLIGHT", "get_host_info", "get_device_state"],
  scan: ["RUN_SCAN"],
  inventory: ["GET_APPLICATION_INVENTORY"],
  sanitize: [
    "SANITIZE_START",
    "SANITIZE_AUTHORIZE",
    "SANITIZE_CONFIRM",
    "SANITIZE_EXECUTE",
  ],
  checklist: ["GET_CHECKLIST", "RECORD_CHECKLIST"],
  export: ["EXPORT_REPORT"],
};

/**
 * Maps the command token a bridge failure was reported against back to the
 * stage that owns it, so only the stage that actually failed turns red.
 */
const BRIDGE_FAILURE_STAGE: Record<string, StepKey> = {
  get_host_info: "connect",
  get_device_state: "connect",
  GET_PREFLIGHT: "connect",
  GET_LICENSE_STATE: "connect",
  RUN_SCAN: "scan",
  GET_APPLICATION_INVENTORY: "inventory",
  SANITIZE_START: "sanitize",
  SANITIZE_AUTHORIZE: "sanitize",
  SANITIZE_CONFIRM: "sanitize",
  SANITIZE_EXECUTE: "sanitize",
  GET_CHECKLIST: "checklist",
  RECORD_CHECKLIST: "checklist",
  EXPORT_REPORT: "export",
};

/** Plain-language reason a button is disabled. Mirrors each `disabled` exactly. */
const WAITING_REASON = "Waiting for the workstation to finish what it is doing.";

/**
 * Returns the payload only for an `OK` envelope.
 *
 * Every field this UI renders is read through here, which is what keeps the
 * screen honest: a refused or failed request has no payload to display, so
 * there is nowhere for a stale or invented value to come from.
 */
function payloadOf(envelope: HostEnvelope | null): Record<string, unknown> | null {
  if (!envelope || envelope.status !== "OK") {
    return null;
  }

  const { payload } = envelope;

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }

  return payload as Record<string, unknown>;
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === "string" ? value : null;
}

function readBoolean(source: Record<string, unknown> | null, key: string): boolean | null {
  const value = source?.[key];
  return typeof value === "boolean" ? value : null;
}

function readCount(source: Record<string, unknown> | null, key: string): number | null {
  const value = source?.[key];
  return typeof value === "number" ? value : null;
}

function readList(source: Record<string, unknown> | null, key: string): string[] {
  const value = source?.[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Reads an array of JSON objects, e.g. the Host's `checks` catalogue.
 *
 * Returns nothing at all rather than a partial list: a malformed entry would drop a
 * check, and a checklist that silently loses rows is indistinguishable from one that
 * was never issued. Whatever is not an object is discarded whole.
 */
function readObjectList(
  source: Record<string, unknown> | null,
  key: string,
): Record<string, unknown>[] {
  const value = source?.[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
}

/** Reads a nested JSON object, e.g. the Host's `progress` block. */
function readObject(
  source: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  const value = source?.[key];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

/**
 * One plain sentence describing an answer, for the device table's Status cell.
 *
 * A refusal keeps the Host's own message - that is the only honest account of
 * what happened - and a bridge failure says so, because "the engine did not
 * answer" is a different fact from "the engine refused".
 */
function envelopeReason(envelope: HostEnvelope | null, okFallback: string): string {
  if (envelope === null) {
    return "The workstation engine did not answer. Nothing was changed on the phone.";
  }

  if (envelope.status === "ERROR") {
    return envelope.error?.message ?? "The workstation refused this step without a reason.";
  }

  return okFallback;
}

/**
 * Describes an application inventory from the payload alone.
 *
 * A-10: this row previously used a fixed optimistic sentence whenever the envelope status
 * was "OK", so a payload whose enumeration was `UNAVAILABLE`, which had timed out, and
 * which carried zero applications still rendered as a successful read. The inventory card
 * below already reported the truth; this row must never contradict it.
 *
 * `limitations` always carries two baseline scope caveats (user scope, application labels),
 * so their mere presence is not a failure signal - `enumerationCompleteness` is.
 */
function inventoryOutcomeText(envelope: HostEnvelope | null): string {
  const payload = payloadOf(envelope);
  const completeness = readString(payload, "enumerationCompleteness");
  const total = readCount(payload, "totalApplications");

  if (completeness === null || completeness === "UNAVAILABLE") {
    const detail = readList(payload, "limitations").find((line) => line.includes("UNAVAILABLE"));
    return detail ? `Application list not read: ${detail}` : "Application list not read.";
  }

  if (total === null) {
    return `The phone did not report a total (enumeration is ${completeness}).`;
  }

  const noun = total === 1 ? "application" : "applications";

  return completeness === "COMPLETE"
    ? `Application list read for this phone: ${total} ${noun} (default user scope; private app data uninspected).`
    : `Application list read for this phone: ${total} ${noun} (enumeration is ${completeness}).`;
}

/** Renders a placeholder when the Host never reported a value for this key. */
function Value({ value, fallback = "-" }: { value: string | null; fallback?: string }) {
  return <>{value === null || value === "" ? fallback : value}</>;
}

function ListBlock({ values, empty }: { values: string[]; empty: string }) {
  if (values.length === 0) {
    return <p className="hint">{empty}</p>;
  }

  return (
    <ul className="list-plain">
      {values.map((entry) => (
        <li key={entry}>{entry}</li>
      ))}
    </ul>
  );
}

/**
 * Renders an exchange according to its real outcome.
 *
 * Three situations, kept distinct on screen: nothing was requested, the Host
 * refused, or the Host answered. A refusal is never styled as a crash;
 * bridge-level failures are reported separately in the page banner because
 * they mean the Host was never reached at all.
 */
/**
 * Renders an exchange according to its real outcome.
 *
 * Three situations, kept distinct on screen: nothing was requested, the Host
 * refused, or the Host answered. A refusal is never styled as a crash;
 * bridge-level failures are reported separately in the page banner because
 * they mean the Host was never reached at all.
 *
 * The refusal code and message stay here because they are the only honest
 * description of what went wrong. The request id, protocol version and Host
 * version are engineer detail: they are never rendered for the operator, and
 * the engine's own stderr is on disk in the support log instead.
 */
function Outcome({ envelope }: { envelope: HostEnvelope | null }) {
  if (!envelope) {
    return <div className="band band-idle">Not requested yet</div>;
  }

  if (envelope.status === "ERROR") {
    return (
      <div className="band band-error">
        <strong>HOST REFUSED | {envelope.error?.code ?? "UNKNOWN_ERROR"}</strong>
        <span>
          {envelope.error?.message ?? "The Host returned ERROR without a structured error."}
        </span>
      </div>
    );
  }

  return (
    <div className="band band-ok">
      <strong>OK</strong>
    </div>
  );
}

/**
 * An operator-facing callout.
 *
 * Two uses: a stage that cannot run yet - its gating reason is printed here
 * instead of being hidden behind a disabled control - and an action the Host
 * explicitly asked the operator to perform on the device. The component only
 * changes presentation; the text is whatever the caller already had.
 */
function Notice({
  tone,
  label,
  children,
}: {
  tone: "gate" | "action";
  label: string;
  children: ReactNode;
}) {
  return (
    <aside className={`notice notice-${tone}`}>
      <span className="notice-label">{label}</span>
      <span className="notice-text">{children}</span>
    </aside>
  );
}

/**
 * Provenance for a serial shown on screen.
 *
 * The three sentences the serial field already used, now shared by the device
 * panel and the scan form so a serial is never presented without saying where
 * it came from. Only the element id differs between the two call sites.
 */
function SerialProvenance({
  id,
  fromHost,
  value,
}: {
  id: string;
  fromHost: boolean;
  value: string;
}) {
  return (
    <small id={id}>
      {fromHost
        ? "Reported by the Host from the connected device"
        : value
          ? "Entered by the operator"
          : "The Host has not reported a device serial - connect and authorize a device, then refresh"}
    </small>
  );
}

/**
 * Which of the workstation's two top-level views is on screen.
 *
 * Navigation only, exactly like [StepKey]: it decides what is rendered and
 * nothing else. Neither view is gated on the other - an operator may open the
 * ledger mid-scan and come back to find the scan exactly where it was, because
 * the ledger is a reader and reading it does not touch anything.
 */
type ScreenKey = "workflow" | "ledger";

/**
 * The old `deviceView()` sentence-builder lived here and turned the Host's
 * connection enums into one plain sentence for the removed connection panel.
 * It is gone with that panel - nothing on this view renders it any more.
 *
 * The rules it enforced were never cosmetic and are carried forward untouched
 * in the gates themselves: `readyToScan` plus `ADB_READY` plus a real device
 * is still the only combination `preflightReady` accepts, and an unauthorized
 * phone is still never treated as connected.
 */

function App() {
  const [host, setHost] = useState<HostInfoResult | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);

  /** Installer version of this build, read from Tauri for the footer line. */
  const [appVersion, setAppVersion] = useState<string | null>(null);

  const [preflight, setPreflight] = useState<HostEnvelope | null>(null);
  /**
   * The Host's device-state reply.
   *
   * The payload itself is no longer stored: it was only ever read by the
   * removed connection panel. What still matters from this query is carried
   * by the other two stores - `deviceStateError` drives the connect-stage
   * failure, and `adoptHostSerial` takes the serial that the whole rest of
   * the workflow is keyed by - so the command still runs exactly as before.
   */
  const [deviceStateError, setDeviceStateError] = useState<string | null>(null);

  const [serial, setSerial] = useState("");
  const [serialFromHost, setSerialFromHost] = useState(false);
  const [operatorId, setOperatorId] = useState("");

  const [scan, setScan] = useState<HostEnvelope | null>(null);
  const [inventory, setInventory] = useState<HostEnvelope | null>(null);
  /** GET_CHECKLIST: the 14 ratified checks as the Host serves them. */
  const [checklist, setChecklist] = useState<HostEnvelope | null>(null);
  /** RECORD_CHECKLIST: the Host's answer once a technician's findings were recorded. */
  const [checklistRecorded, setChecklistRecorded] = useState<HostEnvelope | null>(null);
  /**
   * The technician's in-progress choices, keyed by check id and held on this
   * screen only. Nothing here reaches the Host until Record is pressed, and an
   * unanswered check is simply absent rather than defaulted to a pass.
   */
  const [checklistAnswers, setChecklistAnswers] = useState<Record<string, string>>({});
  const [sanitize, setSanitize] = useState<Record<SanitizeStage, HostEnvelope | null>>(
    EMPTY_SANITIZE,
  );
  const [exported, setExported] = useState<HostEnvelope | null>(null);
  /** FINALISE_REPORT: the sealed, operator-authorised final controlled report. */
  const [finalised, setFinalised] = useState<HostEnvelope | null>(null);

  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [busyBySerial, setBusyBySerial] = useState<Record<string, string | null>>({});

  /** Serial of the phone the Host last scanned; the export belongs to it. */
  const [lastScanSerial, setLastScanSerial] = useState<string | null>(null);

  /** Per-phone row state for the device table. Never read from the wire. */
  const [deviceRows, setDeviceRows] = useState<Record<string, DeviceRowState>>({});

  /** Read-only device inventory, refreshed on its own cadence. */
  const [connectedDevices, setConnectedDevices] = useState<ConnectedDevice[]>([]);
  const [adbAvailable, setAdbAvailable] = useState<boolean | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState<string | null>(null);

  /**
   * Wall-clock label of the last inventory refresh the Host actually answered.
   *
   * Set only when `GET_CONNECTED_DEVICES` returned `OK`, so the timestamp is a
   * real response time rather than a render time - and it stays where it was
   * when a later refresh is refused, because a failed poll must not present
   * itself as a successful one.
   */
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);

  /** Dashboard toolbar. Both filters operate on the real inventory only. */
  const [slotQuery, setSlotQuery] = useState("");
  const [slotStatusFilter, setSlotStatusFilter] = useState<string>("all");

  /**
   * Stable CYVRA slot assignment: serial -> slot number.
   *
   * A serial is given the lowest slot number that is not yet taken, and it
   * keeps that number for the life of this window. That means:
   *  - unplugging and replugging a phone returns it to its own slot, so a
   *    report can never be handed back against the wrong handset;
   *  - two phones are never given the same slot;
   *  - a slot is released only when this component unmounts, never because a
   *    phone dropped off the bus.
   *
   * Deliberately NOT derived from the order devices appear in an enumeration
   * result, and not persisted: persistence across a restart belongs with the
   * per-device report store, not with the dashboard.
   */
  const [slotOfSerial, setSlotOfSerial] = useState<Record<string, number>>({});

  /** Per-device session envelopes keyed by serial so multi-device workflows never overwrite each other. */
  const [deviceEnvelopes, setDeviceEnvelopes] = useState<Record<string, DeviceSessionEnvelopes>>(
    {},
  );
  const deviceEnvelopesRef = useRef<Record<string, DeviceSessionEnvelopes>>({});
  deviceEnvelopesRef.current = deviceEnvelopes;

  /**
   * A scan binding may only outlive the phone it was taken on (owner-approved
   * D7/D2). When the operator switches phones, or the bound phone leaves the
   * detected inventory (disconnect, reconnect, transport re-enumeration), the
   * binding is dropped so a stale target is never presented as current. This
   * is presentation hygiene only: on the wire the Host still enforces the
   * authoritative serial-when-present rule whatever this state says.
   */
  useEffect(() => {
    const trimmed = serial.trim();
    const activeDevice = connectedDevices.find((device) => device.serial === trimmed);
    if (trimmed && (!activeDevice || activeDevice.state === "disconnected")) {
      setLastScanSerial(null);
      setScan(null);
      setInventory(null);
      setSanitize(EMPTY_SANITIZE);
      setChecklistRecorded(null);
      setExported(null);
      setFinalised(null);
      return;
    }
    if (
      trimmed &&
      activeDevice &&
      activeDevice.state !== "disconnected" &&
      deviceEnvelopesRef.current[trimmed]?.scan?.status === "OK"
    ) {
      setLastScanSerial(trimmed);
      return;
    }
    setLastScanSerial((bound) =>
      nextScanBinding(
        bound,
        { kind: "context-changed" },
        {
          activeSerial: serial,
          connectedSerials: connectedDevices.map((device) => device.serial),
        },
      ),
    );
  }, [serial, connectedDevices]);

  useEffect(() => {
    setSlotOfSerial((previous) => {
      const taken = new Set(Object.values(previous));
      const next: Record<string, number> = { ...previous };
      let changed = false;

      for (const device of connectedDevices) {
        if (next[device.serial] !== undefined) continue;
        let slot = 1;
        while (slot <= DEVICE_SLOT_CAPACITY && taken.has(slot)) slot += 1;
        // Capacity exhausted: leave the phone unslotted and say so, rather
        // than inventing an identifier for it.
        if (slot > DEVICE_SLOT_CAPACITY) break;
        next[device.serial] = slot;
        taken.add(slot);
        changed = true;
      }

      return changed ? next : previous;
    });
  }, [connectedDevices]);

  /** `GET_LICENSE_STATE` answer, needed before a row's Scan may arm (D-3). */
  const [licensePresent, setLicensePresent] = useState<boolean | null>(null);
  const [licenseStatus, setLicenseStatus] = useState<string | null>(null);
  const [licenseScansRemaining, setLicenseScansRemaining] = useState<number | null>(null);
  const [showActivationModal, setShowActivationModal] = useState(false);
  const [activationBusy, setActivationBusy] = useState(false);
  const [activationMessage, setActivationMessage] = useState<string | null>(null);
  const [reportsDirectory, setReportsDirectory] = useState<string>("");
  const [openFolderError, setOpenFolderError] = useState<string | null>(null);

  /**
   * Which stage of the wizard is on screen. Navigation only: it gates nothing.
   *
   * Opens on Scan because the connection step is no longer a wizard panel: the
   * 50-slot dashboard above carries every phone's connection state, so a
   * separate "Workstation and phone connection" panel would show the same
   * fact twice. The underlying checks still run - GET_PREFLIGHT and
   * GET_DEVICE_STATE are still issued on mount, and they still feed the stage
   * gates below - only the display is gone.
   */
  const [activeStep, setActiveStep] = useState<StepKey>("scan");

  /** Which top-level view is on screen. Navigation only, like `activeStep`. */
  const [screen, setScreen] = useState<ScreenKey>("workflow");

  /** The ledger file as the bridge last read it. */
  const [ledger, setLedger] = useState<LedgerReadResult | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  /**
   * Re-reads `logs/ledger.jsonl`.
   *
   * Deliberately does **not** go through `send`: the ledger is not a Host
   * command and asking the Host about it would both blur the line between the
   * two and fail whenever no Host is attached - a workstation must be able to
   * show its own history with the inspection engine stopped.
   */
  const refreshLedger = useCallback(async () => {
    setLedgerLoading(true);
    setLedgerError(null);

    try {
      setLedger(await invoke<LedgerReadResult>("ledger_read"));
    } catch (error) {
      setLedger(null);
      setLedgerError(String(error));
    } finally {
      setLedgerLoading(false);
    }
  }, []);

  /**
   * Switches view, reading the ledger on the way in.
   *
   * Deliberately driven from the click rather than from an effect: arriving at
   * the ledger is something the operator *does*, and doing it where they do it
   * starts no work before they have asked for any - and starts it exactly once,
   * instead of once per mount and once per dependency change.
   */
  const openScreen = useCallback(
    (next: ScreenKey) => {
      setScreen(next);
      if (next === "ledger") void refreshLedger();
    },
    [refreshLedger],
  );

  /**
   * Single entry point to the Rust bridge.
   *
   * An `Err` from the Rust command - the bridge being unable to reach the Host
   * at all - is caught here and reported as `bridgeError`, which is a different
   * situation from a Host `status: "ERROR"` and is rendered separately.
   */
  const send = useCallback(
    async (command: string, payload: Record<string, unknown> = {}): Promise<HostEnvelope | null> => {
      const targetSerial =
        typeof payload.serial === "string" && payload.serial.trim().length > 0
          ? payload.serial.trim()
          : null;

      if (targetSerial) {
        setBusyBySerial((current) => ({ ...current, [targetSerial]: command }));
      }
      setBusy(command);
      setBridgeError(null);

      try {
        const raw = await invoke<string>("send_host_command", {
          command,
          payload: JSON.stringify(payload),
        });

        return JSON.parse(raw) as HostEnvelope;
      } catch (error) {
        setBridgeError(`${command}: ${String(error)}`);
        return null;
      } finally {
        if (targetSerial) {
          setBusyBySerial((current) => {
            const next = { ...current };
            delete next[targetSerial];
            return next;
          });
        }
        setBusy(null);
      }
    },
    [],
  );

  /** Adopts a serial the Host reported, so Step 2 never has to invent one. */
  const adoptHostSerial = useCallback((nextSerial: string | null) => {
    if (nextSerial) {
      setSerial(nextSerial);
      setSerialFromHost(true);
    } else {
      // Nothing reported: leave whatever the operator typed alone, but stop
      // presenting it as though the Host had vouched for it.
      setSerialFromHost(false);
    }
  }, []);

  const refreshDeviceState = useCallback(async (): Promise<DeviceStateResult | null> => {
    setDeviceStateError(null);

    try {
      const next = await invoke<DeviceStateResult>("get_device_state");
      adoptHostSerial(next.device?.serial ?? null);
      return next;
    } catch (error) {
      const message = String(error);
      setDeviceStateError(message);
      setBridgeError(`get_device_state: ${message}`);
      return null;
    }
  }, [adoptHostSerial]);

  /**
   * Reads the connected-phone inventory without taking the global `busy` flag.
   *
   * The device table refreshes on its own cadence; if it went through `send`
   * every poll would blink every button on the page to disabled. A refusal is
   * stored in `devicesError`, which the table renders as its own red band with
   * a Retry: a failed listing is never presented as "no phones connected".
   */
  const refreshDevices = useCallback(
    async (showSkeleton = false): Promise<ConnectedDevice[] | null> => {
      if (showSkeleton) {
        setDevicesLoading(true);
      }

      try {
        const raw = await invoke<string>("send_host_command", {
          command: "GET_CONNECTED_DEVICES",
          payload: "{}",
        });

        const envelope = JSON.parse(raw) as HostEnvelope;

        if (envelope.status !== "OK") {
          setDevicesError(
            envelope.error?.message ??
              "The workstation engine could not list the connected phones.",
            );
          return null;
        }

        const payload = (envelope.payload ?? {}) as ConnectedDevicesPayload;
        const rows = Array.isArray(payload.devices) ? payload.devices : [];

        setDevicesError(null);
        setAdbAvailable(payload.adbAvailable === true);
        setConnectedDevices(rows);
        // Recorded only here, on the OK path: a refused listing leaves the
        // previous stamp alone so the screen never shows a fresh-looking time
        // on top of stale data.
        setLastRefreshAt(clockNow());

        return rows;
      } catch (error) {
        setDevicesError(String(error));
        return null;
      } finally {
        setDevicesLoading(false);
      }
    },
    [],
  );

  /**
   * Licence presence, asked once at start-up. `null` means "not known yet" and
   * fails closed: a row's Scan stays locked until the Host has actually said
   * the licence is present.
   */

  useEffect(() => {
    invoke<string>("get_reports_folder_path")
      .then((path) => {
        if (path) setReportsDirectory(path);
      })
      .catch(() => {});
  }, []);

  const handleOpenReportsFolder = useCallback(async () => {
    try {
      setOpenFolderError(null);
      const resolved = await invoke<string>("open_reports_folder", {
        folderPath: reportsDirectory ? reportsDirectory : null,
      });
      if (resolved) {
        setReportsDirectory(resolved);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setOpenFolderError(message);
    }
  }, [reportsDirectory]);

  const loadLicense = useCallback(async () => {
    try {
      const raw = await invoke<string>("send_host_command", {
        command: "GET_LICENSE_STATE",
        payload: "{}",
      });

      const envelope = JSON.parse(raw) as HostEnvelope;
      const payload = payloadOf(envelope);
      const isPresent = envelope.status === "OK" && readBoolean(payload, "present") === true;
      setLicensePresent(isPresent);
      setLicenseStatus(readString(payload, "status"));
      setLicenseScansRemaining(readCount(payload, "scansRemaining"));
      if (envelope.status === "OK" && !isPresent) {
        setShowActivationModal(true);
      }
    } catch {
      setLicensePresent(null);
      setLicenseStatus(null);
      setLicenseScansRemaining(null);
    }
  }, []);

  const submitWorkstationActivation = useCallback(
    async (fields: ActivationFields) => {
      setActivationBusy(true);
      setActivationMessage(null);
      try {
        const result = await invoke<ActivationStatusResult>("activation_submit", { fields });
        if (result.state === "activated") {
          setShowActivationModal(false);
          setActivationMessage(null);
          void loadLicense();
        } else {
          setActivationMessage(
            result.message ??
              "This workstation declined those details. Check the User ID and Serial Key and try again.",
          );
        }
      } catch (error) {
        setActivationMessage(String(error));
      } finally {
        setActivationBusy(false);
      }
    },
    [loadLicense],
  );

  const patchDeviceEnvelope = useCallback(
    (rowSerial: string, patch: Partial<DeviceSessionEnvelopes>) => {
      if (!rowSerial) {
        return;
      }
      setDeviceEnvelopes((current) => {
        const existing: DeviceSessionEnvelopes = current[rowSerial] ?? EMPTY_DEVICE_ENVELOPES;
        return {
          ...current,
          [rowSerial]: { ...existing, ...patch },
        };
      });
    },
    [],
  );

  const selectDeviceForStage = useCallback(
    (targetSerial: string, nextStep: StepKey) => {
      const trimmed = targetSerial.trim();
      if (!trimmed) {
        return;
      }
      setSerial(trimmed);
      setSerialFromHost(true);
      setActiveStep(nextStep);
      const saved = deviceEnvelopes[trimmed];
      if (saved) {
        setScan(saved.scan);
        setInventory(saved.inventory);
        setChecklistRecorded(saved.checklistRecorded);
        setChecklistAnswers(saved.checklistAnswers);
        setSanitize(saved.sanitize);
        setExported(saved.exported);
        setFinalised(saved.finalised);
        if (saved.scan?.status === "OK") {
          setLastScanSerial(trimmed);
        }
      }
    },
    [deviceEnvelopes],
  );

  /** Merges a patch into one phone's row, keeping every other field intact. */
  const patchRow = useCallback((rowSerial: string, patch: Partial<DeviceRowState>) => {
    if (!rowSerial) {
      return;
    }

    setDeviceRows((current) => {
      const existing: DeviceRowState = current[rowSerial] ?? {
        phase: "idle",
        status: "Not started",
        reason: "",
        exportedOk: false,
      };

      return { ...current, [rowSerial]: { ...existing, ...patch } };
    });
  }, []);

  /**
   * Records ONE stage result for ONE phone.
   *
   * Deliberately separate from `patchRow`: a stage entry is merged one key at
   * a time, so Applications being recorded can never overwrite Scan's own
   * outcome on the same row. That is what lets a phone show Scan = Completed
   * and Applications = In Progress at the same instant, and what stops one
   * phone's operation from touching another phone's bar - every call names
   * the serial the command was actually sent for.
   */
  const patchStage = useCallback(
    (rowSerial: string, key: StageKey, record: StageRecord) => {
      if (!rowSerial) {
        return;
      }

      setDeviceRows((current) => {
        const existing: DeviceRowState = current[rowSerial] ?? {
          phase: "idle",
          status: "Not started",
          reason: "",
          exportedOk: false,
        };

        return {
          ...current,
          [rowSerial]: {
            ...existing,
            stages: { ...existing.stages, [key]: record },
          },
        };
      });
    },
    [],
  );

  /** Local wall-clock "HH:MM" for the moment a Host response arrived. */
  const clockNow = (): string =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Footer provenance: the packaged version of this build.
      try {
        const version = await getVersion();

        if (!cancelled) {
          setAppVersion(version);
        }
      } catch {
        if (!cancelled) {
          setAppVersion(null);
        }
      }

      // Existing P1 command, kept for backward compatibility.
      try {
        const info = await invoke<HostInfoResult>("get_host_info");

        if (!cancelled) {
          setHost(info);
          setHostError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setHost(null);
          setHostError(String(error));
        }
      }

      if (!cancelled) {
        const envelope = await send("GET_PREFLIGHT", {});

        if (!cancelled) {
          setPreflight(envelope);
        }
      }

      if (!cancelled) {
        await refreshDeviceState();
      }

      if (!cancelled) {
        void refreshDevices(true);
      }

      if (!cancelled) {
        void loadLicense();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadLicense, refreshDeviceState, refreshDevices, send]);

  /**
   * The device table is the centerpiece of the workstation, so it keeps itself
   * current: every five seconds, without operator input and without claiming
   * progress. Nothing here synthesises a row - an empty answer means the Host
   * really did report zero phones.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshDevices();
    }, 5_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshDevices]);

  /**
   * Runs the scan for one phone.
   *
   * `targetSerial` is how the device table's per-row Scan reaches this
   * function: pressing a row makes that phone the one the rest of the wizard
   * talks about, so no later step can act on a phone the operator did not pick.
   */
  const runScan = async (targetSerial?: string) => {
    const scanSerial = (targetSerial ?? serial).trim();
    const payload: Record<string, unknown> = { serial: scanSerial };

    if (operatorId.trim()) {
      payload.operatorId = operatorId.trim();
    }

    if (targetSerial) {
      setSerial(scanSerial);
      setSerialFromHost(true);
    }

    patchRow(scanSerial, { phase: "scanning", status: "In progress", reason: "" });
    patchStage(scanSerial, "scan", {
      tone: "in-progress",
      note: "The inspection engine is reading this phone.",
      at: clockNow(),
    });

    const envelope = await send("RUN_SCAN", payload);
    setScan(envelope);
    patchDeviceEnvelope(scanSerial, {
      scan: envelope,
      inventory: null,
      checklistRecorded: null,
      checklistAnswers: {},
      sanitize: EMPTY_SANITIZE,
      exported: null,
      finalised: null,
    });

    if (envelope?.status === "OK") {
      setLastScanSerial(
        nextScanBinding(lastScanSerial, { kind: "scan-succeeded", scannedSerial: scanSerial }),
      );
      patchRow(scanSerial, {
        phase: "idle",
        status: "Ok",
        reason: "Scan finished for this phone. The report is ready to review.",
        exportedOk: false,
      });

      // A fresh scan invalidates this phone's downstream stages, so they go
      // back to pending rather than carrying the previous scan's result.
      const completeness = readString(payloadOf(envelope), "enumerationCompleteness");
      patchStage(scanSerial, "scan", {
        tone: completeness !== null && completeness !== "COMPLETE" ? "partial" : "completed",
        note:
          completeness === null
            ? "Scan finished. The engine did not report an enumeration completeness value."
            : completeness === "COMPLETE"
              ? "Scan finished. Enumeration was complete."
              : `Scan finished, but enumeration is ${completeness}.`,
        at: clockNow(),
      });
      patchStage(scanSerial, "applications", {
        tone: "pending",
        note: "Not loaded for this phone yet.",
      });
      patchStage(scanSerial, "sanitize", {
        tone: "pending",
        note: "Not attempted for this phone.",
      });
      patchStage(scanSerial, "verify", {
        tone: "pending",
        note: "No checks recorded for this phone yet.",
      });
      patchStage(scanSerial, "download", {
        tone: "pending",
        note: "This phone's report has not been written yet.",
      });
    } else {
      // The Host clears its own scan state when a scan fails, so no binding
      // may survive here either: a failed scan must not leave the UI
      // presenting a stale target as current (owner-approved D7/D2).
      setLastScanSerial(nextScanBinding(lastScanSerial, { kind: "scan-failed" }));
      patchRow(scanSerial, {
        phase: "idle",
        status: "Failed",
        reason: envelopeReason(envelope, ""),
      });
      patchStage(scanSerial, "scan", {
        tone: "failed",
        note: envelopeReason(envelope, "The engine refused the scan for this phone."),
        at: clockNow(),
      });
    }

    // A fresh scan invalidates every downstream artifact (the Host clears its
    // sanitization state too); the screen follows rather than showing stale data.
    setInventory(null);
    setSanitize(EMPTY_SANITIZE);
    setExported(null);
    setFinalised(null);
    setChecklistRecorded(null);
    void refreshDevices();
    void loadLicense();
  };

  const loadInventory = async (targetSerial?: string) => {
    const target = (targetSerial ?? lastScanSerial ?? serial).trim();
    if (targetSerial) {
      setSerial(target);
      setSerialFromHost(true);
    }

    patchRow(target, { phase: "reporting", status: "In progress", reason: "" });
    patchStage(target, "applications", {
      tone: "in-progress",
      note: "Reading this phone's application inventory.",
      at: clockNow(),
    });

    const envelope = await send(
      "GET_APPLICATION_INVENTORY",
      target ? { serial: target } : {},
    );
    setInventory(envelope);
    patchDeviceEnvelope(target, { inventory: envelope });

    patchRow(target, {
      phase: "idle",
      status: envelope?.status === "OK" ? "Ok" : "Failed",
      reason: envelopeReason(envelope, inventoryOutcomeText(envelope)),
    });

    // The engine's own enumeration completeness decides the stage - an answer
    // that says UNAVAILABLE or PARTIAL is never recorded as full success.
    const completeness = readString(payloadOf(envelope), "enumerationCompleteness");
    const failed = envelope?.status !== "OK";

    patchStage(target, "applications", failed
      ? {
          tone: "failed",
          note: envelopeReason(envelope, "The engine refused the application list for this phone."),
          at: clockNow(),
        }
      : {
          tone:
            completeness !== null && completeness !== "COMPLETE" ? "partial" : "completed",
          note: inventoryOutcomeText(envelope),
          at: clockNow(),
        });
  };

  const runSanitize = async (stage: SanitizeStage, targetSerial?: string) => {
    const target = (targetSerial ?? lastScanSerial ?? serial).trim();
    if (targetSerial) {
      setSerial(target);
      setSerialFromHost(true);
    }
    const currentSanitize = (target && deviceEnvelopes[target]?.sanitize) || sanitize;
    let payload: Record<string, unknown> = target ? { serial: target } : {};

    if (stage === "authorize") {
      payload = { ...payload, acknowledged: true };
    }

    if (stage === "confirm") {
      const phrase = readString(payloadOf(currentSanitize.start), "step2PhraseRequired");

      if (!phrase) {
        setBridgeError("SANITIZE_CONFIRM: SANITIZE_START did not issue a confirmation phrase");
        return;
      }

      payload = { ...payload, confirmationPhrase: phrase };
    }

    patchRow(target, { phase: "sanitize", status: "In progress", reason: "" });
    patchStage(target, "sanitize", {
      tone: "in-progress",
      note: "The workstation is working through the purge guide for this phone.",
      at: clockNow(),
    });

    const envelope = await send(SANITIZE_COMMANDS[stage], payload);
    const nextSanitize = { ...currentSanitize, [stage]: envelope };
    setSanitize(nextSanitize);
    patchDeviceEnvelope(target, { sanitize: nextSanitize });

    const accepted = envelope?.status === "OK";

    patchRow(target, {
      // The guide stays the phone's live situation until a new scan replaces it.
      phase: accepted ? "sanitize" : "idle",
      status: accepted ? "Ok" : "Failed",
      reason: envelopeReason(envelope, "The purge guide recorded this step."),
    });

    // Governance, not the operator, decides this stage's colour. An execution
    // whose status means "no wipe took place" is BLOCKED and is recorded as
    // blocked against this phone - never completed, whatever the guide did.
    const outcomeStatus =
      stage === "execute" ? readString(payloadOf(envelope), "executionStatus") : null;
    const governanceBlocked =
      outcomeStatus !== null && BLOCKED_EXECUTION_STATUSES.includes(outcomeStatus);

    if (governanceBlocked) {
      patchStage(target, "sanitize", {
        tone: "blocked",
        note:
          outcomeStatus === "TRIGGER_OUTCOME_INDETERMINATE"
            ? "No wipe is confirmed for this phone. The outcome is unsettled and is not reported as done."
            : "Blocked: this build does not perform the purge, so no sanitization has occurred.",
        at: clockNow(),
      });
    } else if (stage === "execute" && accepted) {
      patchStage(target, "sanitize", {
        tone: "partial",
        note:
          "The trigger was issued for this phone. Completion is established only by post-reset verification, not by this step.",
        at: clockNow(),
      });
    } else if (accepted) {
      // A guide step was recorded. That is progress through the guide and
      // nothing more - it is never a sanitization of the phone.
      patchStage(target, "sanitize", {
        tone: "in-progress",
        note: "A purge-guide step was recorded for this phone. Nothing has been erased.",
        at: clockNow(),
      });
    } else {
      patchStage(target, "sanitize", {
        tone: "failed",
        note: envelopeReason(envelope, "The workstation refused this purge-guide step."),
        at: clockNow(),
      });
    }
  };

  /**
   * Per-device deliberate sanitization approval (`SANITIZE_CONFIRM` button).
   *
   * Requires both H/W SCN and App SCN reports to be completed for [targetSerial]
   * and executes the consolidated `SANITIZE_START` -> `SANITIZE_AUTHORIZE` workflow
   * (including internal post-wipe verification, Sanitization Audit Report PDF in
   * `Downloads/CYVRA/`, and device session disconnect).
   */
  const runConsolidatedSanitizeConfirm = async (targetSerial?: string) => {
    const target = (targetSerial ?? lastScanSerial ?? serial).trim();
    if (!target) {
      return;
    }
    if (targetSerial) {
      setSerial(target);
      setSerialFromHost(true);
    }

    patchRow(target, { phase: "sanitize", status: "In progress", reason: "" });
    patchStage(target, "sanitize", {
      tone: "in-progress",
      note: "Authorizing and verifying consolidated sanitization for this phone.",
      at: clockNow(),
    });

    const currentSanitize = deviceEnvelopes[target]?.sanitize ?? sanitize;
    let startEnv = currentSanitize.start;
    if (!startEnv || startEnv.status !== "OK") {
      startEnv = await send("SANITIZE_START", {
        serial: target,
        ...(operatorId.trim() ? { operatorId: operatorId.trim() } : {}),
      });
    }

    const startPhrase = readString(payloadOf(startEnv), "step2PhraseRequired");
    if (!startEnv || startEnv.status !== "OK" || !startPhrase) {
      const nextSanitize = { ...currentSanitize, start: startEnv };
      setSanitize(nextSanitize);
      patchDeviceEnvelope(target, { sanitize: nextSanitize });
      patchRow(target, {
        phase: "idle",
        status: "Failed",
        reason: envelopeReason(startEnv, "Sanitization eligibility gate refused."),
      });
      patchStage(target, "sanitize", {
        tone: "failed",
        note: envelopeReason(startEnv, "Sanitization eligibility gate refused for this phone."),
        at: clockNow(),
      });
      return;
    }

    const authorizeEnv = await send("SANITIZE_AUTHORIZE", {
      serial: target,
      acknowledged: true,
      confirmationPhrase: startPhrase,
      consolidated: true,
      ...(operatorId.trim() ? { operatorId: operatorId.trim() } : {}),
    });

    const nextSanitize: Record<SanitizeStage, HostEnvelope | null> = {
      start: startEnv,
      authorize: authorizeEnv,
      confirm: authorizeEnv,
      execute: authorizeEnv,
    };
    setSanitize(nextSanitize);
    patchDeviceEnvelope(target, { sanitize: nextSanitize });

    const accepted = authorizeEnv?.status === "OK";
    const outcomeStatus = readString(payloadOf(authorizeEnv), "executionStatus");
    const pdfPath = readString(payloadOf(authorizeEnv), "pdfPath");
    const governanceBlocked =
      outcomeStatus !== null && BLOCKED_EXECUTION_STATUSES.includes(outcomeStatus);

    patchRow(target, {
      phase: accepted ? "sanitize" : "idle",
      status: accepted ? "Ok" : "Failed",
      reason: pdfPath
        ? `Sanitization audit report written to ${pdfPath}`
        : envelopeReason(authorizeEnv, "Consolidated sanitization finished."),
      exportedOk: Boolean(pdfPath),
    });

    if (!accepted) {
      patchStage(target, "sanitize", {
        tone: "failed",
        note: envelopeReason(authorizeEnv, "Consolidated sanitization was refused for this phone."),
        at: clockNow(),
      });
    } else if (governanceBlocked) {
      patchStage(target, "sanitize", {
        tone: "blocked",
        note:
          outcomeStatus === "TRIGGER_OUTCOME_INDETERMINATE"
            ? "No wipe is confirmed for this phone. Outcome unsettled."
            : "Blocked: hardware-gated sanitization recorded audit certificate.",
        at: clockNow(),
      });
    } else {
      patchStage(target, "sanitize", {
        tone: "completed",
        note: "Consolidated sanitization and post-wipe verification completed.",
        at: clockNow(),
      });
    }
    void loadLicense();
  };

  const runExport = async (targetSerial?: string) => {
    const target = (targetSerial ?? lastScanSerial ?? serial).trim();
    if (targetSerial) {
      setSerial(target);
      setSerialFromHost(true);
    }

    patchRow(target, { phase: "reporting", status: "In progress", reason: "" });
    patchStage(target, "download", {
      tone: "in-progress",
      note: "Writing this phone's report to disk.",
      at: clockNow(),
    });

    const envelope = await send("EXPORT_REPORT", target ? { serial: target } : {});
    setExported(envelope);
    patchDeviceEnvelope(target, { exported: envelope });

    if (envelope?.status === "OK") {
      patchRow(target, {
        phase: "exported",
        status: "Ok",
        reason: "Report downloaded for this phone.",
        exportedOk: true,
      });
      patchStage(target, "download", {
        tone: "completed",
        note: "This phone's report was written and is ready to download.",
        at: clockNow(),
      });
    } else {
      patchRow(target, {
        phase: "idle",
        status: "Failed",
        reason: envelopeReason(envelope, ""),
      });
      patchStage(target, "download", {
        tone: "failed",
        note: envelopeReason(envelope, "The workstation could not write this phone's report."),
        at: clockNow(),
      });
    }
  };

  /**
   * GET_CHECKLIST. Works before a scan exists, so this is the one stage that
   * never locks; the catalogue is the Host's to serve and this screen only
   * displays it.
   */
  const loadChecklist = async (targetSerial?: string) => {
    const envelope = await send(
      "GET_CHECKLIST",
      targetSerial ? { serial: targetSerial.trim() } : {},
    );
    setChecklist(envelope);
  };

  /**
   * RECORD_CHECKLIST. Sends the technician's choices as they were made.
   *
   * An unanswered check is omitted rather than defaulted: the Host owns the
   * rule that every check must be answered, and a refusal for a missing one is
   * shown as-is. This screen never fills a gap with a pass, because a checklist
   * that looks complete when nobody finished it is the one failure the protocol
   * was built to prevent.
   */
  const recordChecklist = async (targetSerial?: string) => {
    const target = (targetSerial ?? lastScanSerial ?? serial).trim();
    const payload = payloadOf(checklist);
    const results = readObjectList(payload, "checks")
      .map((check) => {
        const id = readString(check, "id");
        const outcome = id === null ? undefined : checklistAnswers[id];
        return id === null || outcome === undefined ? null : { id, outcome };
      })
      .filter((row): row is { id: string; outcome: string } => row !== null);

    patchStage(target, "verify", {
      tone: "in-progress",
      note: "Recording this phone's technician checks.",
      at: clockNow(),
    });

    const envelope = await send(
      "RECORD_CHECKLIST",
      target ? { serial: target, results } : { results },
    );
    setChecklistRecorded(envelope);
    patchDeviceEnvelope(target, { checklistRecorded: envelope, checklistAnswers });

    // The Host's own progress block is the source of truth after a recording,
    // so re-read the catalogue too: it carries the same progress for display.
    if (envelope?.status === "OK") {
      setChecklist(await send("GET_CHECKLIST", target ? { serial: target } : {}));
      patchStage(target, "verify", {
        tone: "completed",
        note: "The technician's checks were recorded for this phone.",
        at: clockNow(),
      });
    } else {
      patchStage(target, "verify", {
        tone: "failed",
        note: envelopeReason(envelope, "The workstation did not record this phone's checks."),
        at: clockNow(),
      });
    }
  };

  /**
   * Runs the ratified V3 §7 finalisation chain - normalise, operator authorisation,
   * seal, final controlled report - entirely on the Host.
   *
   * The operator id is whatever this screen already holds. Finalisation refuses a blank
   * one rather than sealing a report no person signed, so the refusal is shown as-is.
   */
  const runFinalise = async (targetSerial?: string) => {
    const target = (targetSerial ?? lastScanSerial ?? serial).trim();

    patchRow(target, { phase: "reporting", status: "In progress", reason: "" });
    patchStage(target, "download", {
      tone: "in-progress",
      note: "Finalising this phone's report.",
      at: clockNow(),
    });

    const envelope = await send("FINALISE_REPORT", {
      operatorId: operatorId.trim(),
      ...(target ? { serial: target } : {}),
    });
    setFinalised(envelope);
    patchDeviceEnvelope(target, { finalised: envelope });

    if (envelope?.status === "OK") {
      patchRow(target, {
        phase: "exported",
        status: "Ok",
        reason: "Report finalised, operator-authorised and sealed.",
        exportedOk: true,
      });
      patchStage(target, "download", {
        tone: "completed",
        note: "This phone's report was finalised, operator-authorised and sealed.",
        at: clockNow(),
      });
    } else {
      patchRow(target, {
        phase: "idle",
        status: "Failed",
        reason: envelopeReason(envelope, ""),
      });
      patchStage(target, "download", {
        tone: "failed",
        note: envelopeReason(envelope, "The workstation did not finalise this phone's report."),
        at: clockNow(),
      });
    }
  };

  const hostConnected = host?.connected === true;
  const scanPayload = payloadOf(scan);
  const scanOk = scan?.status === "OK";

  const preflightPayload = payloadOf(preflight);
  const preflightReady = readBoolean(preflightPayload, "readyToScan");

  const inventoryPayload = payloadOf(inventory);
  const startPayload = payloadOf(sanitize.start);
  const authorizePayload = payloadOf(sanitize.authorize);
  const confirmPayload = payloadOf(sanitize.confirm);
  const executePayload = payloadOf(sanitize.execute);

  const executeStatus = readString(executePayload, "executionStatus");
  // `readString` returns null when the field is absent, and an absent status is not a
  // blocked outcome - it is no outcome at all. The guard makes that explicit instead of
  // leaning on the implicit null → false coercion, which is what kept this line a type
  // error while every gate reported green: desktop has no `typecheck` task, so `pnpm -r
  // typecheck` skipped it entirely.
  const blocked =
    executeStatus !== null && BLOCKED_EXECUTION_STATUSES.includes(executeStatus);

  const startOk = sanitize.start?.status === "OK";
  const authorizeOk = sanitize.authorize?.status === "OK";
  const confirmOk = sanitize.confirm?.status === "OK";
  const phrase = readString(startPayload, "step2PhraseRequired");

  const exportPayload = payloadOf(exported);
  const reportJsonPath = readString(exportPayload, "reportJsonPath");
  const reportMarkdownPath = readString(exportPayload, "reportMarkdownPath");
  const manifestPath = readString(exportPayload, "manifestPath");
  const pdfPath = readString(exportPayload, "pdfPath");
  const hwPdfPath = readString(exportPayload, "hwPdfPath");
  const appPdfPath = readString(exportPayload, "appPdfPath");

  const finalPayload = payloadOf(finalised);
  const sealDigest = readString(finalPayload, "sealDigest");
  const finalReportPath = readString(finalPayload, "reportJsonPath");
  const finalZipPath = readString(finalPayload, "zipPath");

  /*
   * Stage state. Every value below is read from the predicates the buttons
   * already use to disable themselves - they are not re-implemented here, so
   * the stepper can never show a stage as further along than the protocol
   * layer actually allows.
   */
  const stepLock: Record<StepKey, string | null> = {
    connect: null,
    scan: hostConnected ? null : "The Host is not connected yet.",
    inventory: scanOk ? null : "Complete a scan first.",
    sanitize: scanOk ? null : "Complete a scan first.",
    // Never locked: GET_CHECKLIST answers before a scan exists, so the catalogue
    // can be read at any point. Recording is what needs a scan, and the Record
    // button carries that gate rather than the whole step being closed.
    checklist: null,
    export: scanOk ? null : "Complete a scan first.",
  };

  /** True while a Host command belonging to this stage is in flight. */
  const stageInFlight = (key: StepKey): boolean =>
    busy !== null && STAGE_COMMANDS[key].includes(busy);

  /** The furthest exchange this stage has completed. */
  const stageEnvelope: Record<StepKey, HostEnvelope | null> = {
    connect: preflight,
    scan,
    inventory,
    sanitize: sanitize.execute ?? sanitize.confirm ?? sanitize.authorize ?? sanitize.start,
    // The recorded answer is the furthest point this stage reaches: loading the
    // catalogue is preparation, not the stage's own result.
    checklist: checklistRecorded ?? checklist,
    export: finalised ?? exported,
  };

  const stageRefused = (key: StepKey): boolean => stageEnvelope[key]?.status === "ERROR";

  /** The stage's own response answered `status: "OK"` and carried a payload. */
  const stageAnsweredOk = (key: StepKey): boolean => {
    const envelope = stageEnvelope[key];
    return envelope?.status === "OK" && payloadOf(envelope) !== null;
  };

  /**
   * A bridge failure belongs to one stage only - the one whose command the
   * failure was reported against - so a single broken exchange never paints
   * the whole wizard red.
   */
  const bridgeToken: string | null =
    bridgeError === null ? null : bridgeError.split(":")[0];
  const bridgeFromError: StepKey | null =
    bridgeToken !== null && bridgeToken in BRIDGE_FAILURE_STAGE
      ? BRIDGE_FAILURE_STAGE[bridgeToken]
      : null;
  const bridgeFailedStage: StepKey | null =
    bridgeFromError ?? (hostError !== null || deviceStateError !== null ? "connect" : null);

  /**
   * The workstation check passed only when it answered OK *and* reported
   * readyToScan. An OK answer carrying readyToScan=false is a check that did
   * not pass, and must never be painted as complete.
   */
  const connectPassed = preflight?.status === "OK" && preflightReady === true;
  const connectDidNotPass = preflight?.status === "OK" && preflightReady !== true;

  const sanitizeStarted =
    startOk || authorizeOk || confirmOk || sanitize.execute !== null;
  const sanitizeTerminal = sanitize.execute !== null;

  /*
   * Technician checklist. The catalogue is read from GET_CHECKLIST; progress
   * and completion are read from the Host's own `progress` block on the
   * recorded answer. This screen never computes completion itself - if the
   * Host reports fourteen of fourteen, that is what is shown, and if it does
   * not, the count shown is the one the Host gave.
   */
  const checklistCatalogue = readObjectList(payloadOf(checklist), "checks");
  const checklistProgress = readObject(payloadOf(checklistRecorded), "progress");
  const checklistOutcomes = readList(payloadOf(checklist), "outcomes");
  const checklistClaim = readString(payloadOf(checklist), "claim");
  const checklistAttestationKind = readString(payloadOf(checklist), "attestationKind");
  const checklistAnswered = readCount(checklistProgress, "answeredCount") ?? 0;
  const checklistExpected = readCount(checklistProgress, "expectedCount") ?? 0;
  const checklistComplete = readBoolean(checklistProgress, "complete") === true;

  /** Every check has a choice; the Record button needs this and a completed scan. */
  const checklistAllAnswered =
    checklistCatalogue.length > 0 &&
    checklistCatalogue.every((check) => {
      const id = readString(check, "id");
      return id !== null && checklistAnswers[id] !== undefined;
    });

  const nodeStates: Record<StepKey, NodeState> = {
    connect:
      stageInFlight("connect")
        ? "IN PROGRESS"
        : bridgeFailedStage === "connect" || stageRefused("connect") || connectDidNotPass
          ? "FAILED"
          : connectPassed
            ? "COMPLETED"
            : "READY",
    scan: stageInFlight("scan")
      ? "IN PROGRESS"
      : bridgeFailedStage === "scan" || stageRefused("scan")
        ? "FAILED"
        : stageAnsweredOk("scan")
          ? "COMPLETED"
          : stepLock.scan !== null
            ? "NOT STARTED"
            : "READY",
    inventory: stageInFlight("inventory")
      ? "IN PROGRESS"
      : bridgeFailedStage === "inventory" || stageRefused("inventory")
        ? "FAILED"
        : stageAnsweredOk("inventory")
          ? "COMPLETED"
          : stepLock.inventory !== null
            ? "NOT STARTED"
            : "READY",
    sanitize: stageInFlight("sanitize")
      ? "IN PROGRESS"
      : bridgeFailedStage === "sanitize" || stageRefused("sanitize")
        ? "FAILED"
        : blocked
          ? "BLOCKED"
          : sanitizeTerminal && stageAnsweredOk("sanitize")
            ? "COMPLETED"
            : sanitizeStarted
              ? "IN PROGRESS"
              : stepLock.sanitize !== null
                ? "NOT STARTED"
                : "READY",
    // The catalogue loading is not the stage's own result, so this stage does
    // not use stageAnsweredOk - that would paint it complete the moment the
    // list was read. It completes only when the Host reports every check
    // answered.
    checklist: stageInFlight("checklist")
      ? "IN PROGRESS"
      : bridgeFailedStage === "checklist" || stageRefused("checklist")
        ? "FAILED"
        : checklistComplete
          ? "COMPLETED"
          : checklistAnswered > 0
            ? "IN PROGRESS"
            : "READY",
    export: stageInFlight("export")
      ? "IN PROGRESS"
      : bridgeFailedStage === "export" || stageRefused("export")
        ? "FAILED"
        : stageAnsweredOk("export")
          ? "COMPLETED"
          : stepLock.export !== null
            ? "NOT STARTED"
            : "READY",
  };

  /**
   * Plain-language reason each button is disabled. Written to mirror the
   * button's own `disabled` expression exactly, so the tooltip can never
   * claim a button is locked for a different reason than it is.
   */
  const lockWhenBusy = busy !== null ? WAITING_REASON : null;
  const lockScan =
    lockWhenBusy ??
    (!hostConnected
      ? "The workstation engine is not connected yet - start at step 1."
      : !serial.trim()
        ? "No phone is reported yet - connect the phone, then check the connection."
        : null);
  const lockLoad =
    lockWhenBusy ??
    (!scanOk ? "Scan the phone first - the applications are collected by the scan." : null);
  const lockDownload =
    lockWhenBusy ??
    (!scanOk ? "Scan the phone first - the report is produced by the scan." : null);
  const lockGuide =
    lockWhenBusy ??
    (!scanOk
      ? "Scan the phone first - only a finished scan can be purged."
      : startOk
        ? "The purge guide has already been started for this scan."
        : null);
  const lockAcknowledge =
    lockWhenBusy ??
    (!startOk
      ? "Start the purge guide first."
      : authorizeOk
        ? "You have already acknowledged the warning."
        : null);
  const lockConfirm =
    lockWhenBusy ??
    (!authorizeOk
      ? "Acknowledge the warning first."
      : !phrase
        ? "The workstation has not issued a confirmation phrase yet."
        : confirmOk
          ? "You have already confirmed the purge."
          : null);
  const lockExecute =
    lockWhenBusy ?? (!confirmOk ? "Confirm the purge first." : null);

  /**
   * The workstation check (`preflight`) is NOT turned into operator copy
   * here any more. It was only ever rendered by the removed connection panel;
   * the envelope itself is still consumed below by `connectPassed`,
   * `stepLock` and `stageEnvelope`, so the gate is intact and unchanged.
   */

  const activeMeta = STEPS.find((step) => step.key === activeStep) ?? STEPS[0];
  const activeLock = stepLock[activeStep];

  /**
   * Header pill 1 - the inspection engine that runs on this PC. The three
   * states are exhaustive: answered and connected, not answered yet, or an
   * answer that never arrived.
   */
  const engineState: "online" | "starting" | "offline" = hostConnected
    ? "online"
    : host === null && hostError !== null
      ? "offline"
      : "starting";

  const engineLabel =
    engineState === "online"
      ? "ENGINE ONLINE"
      : engineState === "starting"
        ? "ENGINE STARTING"
        : "ENGINE OFFLINE";

  /**
   * Header pill 2 - phones, and only phones.
   *
   * Counted from the Host's device inventory alone: a phone whose ADB session
   * dropped (`disconnected`) is not counted as connected, and the number is
   * never merged with the engine state, because the engine being up says
   * nothing about whether a phone is plugged in.
   */
  const connectedPhoneCount = connectedDevices.filter(
    (device) => device.state !== "disconnected",
  ).length;

  const phonePill =
    connectedPhoneCount > 0 ? `PHONE: ${connectedPhoneCount} CONNECTED` : "PHONE: NONE";

  /**
   * Rows of the device table: Host inventory plus this view's own per-phone
   * session state.
   *
   * Order, serial, model, make and IMEI come from the Host. The Action, Status
   * and Report cells are tracked locally, and only from responses this window
   * actually received - no cell is ever optimistic. The row's Scan is armed by
   * rule D-3: authorized AND licence present AND no other phone's session
   * unfinished; when it is not armed the reason is printed on the button
   * instead of the button silently doing nothing.
   */
  const deviceRowsView = connectedDevices.slice(0, 50).map((device, index) => {
    const rowState: DeviceRowState = deviceRows[device.serial] ?? {
      phase: "idle",
      status: "Not started",
      reason: "",
      exportedOk: false,
    };

    const activeReason =
      device.state === "authorized"
        ? null
        : device.state === "disconnected"
          ? "Connection dropped - check the data cable."
          : device.state === "unauthorized"
            ? "Not allowed yet - tap ALLOW on the phone."
            : "Still being identified by the workstation.";

    const deviceBusy = busyBySerial[device.serial] ?? null;
    const activeConcurrentScans = Object.values(busyBySerial).filter(
      (cmd) => cmd === "RUN_SCAN",
    ).length;
    const maxConcurrentAllowed = Math.min(50, licenseScansRemaining ?? 50);
    const concurrencyReached =
      activeConcurrentScans >= maxConcurrentAllowed && deviceBusy !== "RUN_SCAN";

    const scanLock =
      device.state === "disconnected"
        ? "This phone's connection dropped. Unplug the data cable and plug it back in."
        : device.state === "unauthorized"
          ? "This phone has not allowed this workstation to inspect it. On the phone, tap ALLOW when it asks to trust this computer."
          : device.state === "detected"
            ? "This phone is still being identified. Wait a moment, then try again."
            : licensePresent !== true
              ? "No licence is installed on this workstation, so a scan cannot start."
              : deviceBusy !== null
                ? `This phone is busy (${deviceBusy}). Wait for it to finish.`
                : concurrencyReached
                  ? `Licence concurrency limit reached (${maxConcurrentAllowed} concurrent scan(s) active).`
                  : null;

    const recorded = rowState.stages ?? {};
    const scanCompleted =
      recorded.scan?.tone === "completed" ||
      recorded.scan?.tone === "partial" ||
      deviceEnvelopes[device.serial]?.scan?.status === "OK";

    const appScanCompleted =
      recorded.applications?.tone === "completed" ||
      recorded.applications?.tone === "partial" ||
      deviceEnvelopes[device.serial]?.inventory?.status === "OK";

    const sanitizeReady = scanCompleted && appScanCompleted;

    const reportReady =
      scanCompleted ||
      (rowState.exportedOk && rowState.status === "Ok");

    const slotNumber = slotOfSerial[device.serial];

    return {
      device,
      number: index + 1,
      rowState,
      activeReason,
      scanLock,
      scanCompleted,
      appScanCompleted,
      sanitizeReady,
      deviceBusy,
      reportReady,
      slotLabel: slotNumber === undefined ? null : slotLabelFor(slotNumber),
    };
  });

  /**
   * The Connected Devices dashboard: always exactly 50 slots, always drawn.
   *
   * A slot is `occupied` when the Host currently reports a phone at that
   * slot number, `disconnected` when the slot's phone dropped off the bus,
   * and `empty` when nothing has ever claimed it. No slot is ever drawn as
   * occupied on the strength of a guess, a count, or a previous session: the
   * only input is the Host's own device inventory.
   */
  /**
   * The 50-slot view: one row per CYVRA slot, in slot order.
   *
   * Empty slots are included deliberately rather than filtered out - the
   * operator must see the whole rack, including the holes in it, and a slot
   * only ever shows a phone the Host actually reported at that number.
   */
  const deviceSlotsView = Array.from({ length: DEVICE_SLOT_CAPACITY }, (_, index) => {
    const slotNumber = index + 1;
    const label = slotLabelFor(slotNumber);

    const serial = Object.keys(slotOfSerial).find(
      (candidate) => slotOfSerial[candidate] === slotNumber,
    );

    // ---- Empty slot: no phone has ever claimed this number. ---------------
    // Every stage is pending and the row says Empty. Nothing here is invented.
    if (serial === undefined) {
      const emptyStages = STAGE_SEGMENTS.map((segment) => ({
        key: segment.key,
        tone: "pending" as StageTone,
        note: "No phone is in this slot.",
      }));

      return {
        slotNumber,
        label,
        serial: null,
        tone: "empty" as const,
        device: null,
        modelMake: "",
        stages: emptyStages,
        downloadTone: "pending" as StageTone,
        downloadNote: "No phone is in this slot.",
        scanCompleted: false,
        reportExported: false,
        overall: "Empty" as const,
        overallNote: "This slot holds no device.",
        rowState: EMPTY_ROW_STATE,
      };
    }

    const device = connectedDevices.find((candidate) => candidate.serial === serial) ?? null;
    const rowState: DeviceRowState = deviceRows[serial] ?? EMPTY_ROW_STATE;
    const recorded = rowState.stages ?? {};
    const disconnected = device === null || device.state === "disconnected";

    // ---- Connect is read live from this phone's own inventory entry. -------
    // Deliberately carries no timestamp: this window never receives when the
    // connection was confirmed, so none is shown rather than a guessed one.
    const connectStage: StageRecord = disconnected
      ? { tone: "failed", note: "Connection dropped - check the data cable." }
      : device.state === "authorized"
        ? { tone: "completed", note: "The engine has confirmed this phone." }
        : device.state === "detected"
          ? { tone: "in-progress", note: "The engine is identifying this phone." }
          : {
              tone: "blocked",
              note: "This phone has not allowed the workstation. Tap ALLOW on the phone.",
            };

    const stages = STAGE_SEGMENTS.map((segment) =>
      segment.key === "connect"
        ? { key: segment.key, ...connectStage }
        : {
            key: segment.key,
            tone: (recorded[segment.key]?.tone ?? "pending") as StageTone,
            note: recorded[segment.key]?.note ?? "Not started for this phone.",
            ...(recorded[segment.key]?.at ? { at: recorded[segment.key]?.at } : {}),
          },
    );

    const downloadTone = (recorded.download?.tone ?? "pending") as StageTone;
    const downloadNote =
      recorded.download?.note ?? "This phone's report has not been downloaded yet.";
    const scanCompleted =
      recorded.scan?.tone === "completed" ||
      recorded.scan?.tone === "partial" ||
      deviceEnvelopes[serial]?.scan?.status === "OK";
    const reportExported = rowState.exportedOk || downloadTone === "completed";

    const allStagesForOverall: { key: StageKey; tone: StageTone }[] = [
      { key: "connect", tone: connectStage.tone },
      ...stages,
      { key: "download", tone: downloadTone },
    ];

    const model = device?.model?.trim();
    const make = device?.make?.trim();

    return {
      slotNumber,
      label,
      serial,
      tone: disconnected ? ("disconnected" as const) : ("connected" as const),
      device,
      modelMake: [model, make].filter(Boolean).join(" / "),
      stages,
      downloadTone,
      downloadNote,
      scanCompleted,
      reportExported,
      overall: overallFor(allStagesForOverall, disconnected),
      overallNote: "",
      rowState,
    };
  });

  const connectedSlotCount = deviceSlotsView.filter((slot) => slot.tone === "connected").length;
  const disconnectedSlotCount = deviceSlotsView.filter(
    (slot) => slot.tone === "disconnected",
  ).length;
  const emptySlotCount = deviceSlotsView.filter((slot) => slot.tone === "empty").length;

  /** Devices whose scan is running right now. Read from their own stage record. */
  const scanningSlotCount = deviceSlotsView.filter(
    (slot) => slot.overall === "Scanning" || slot.overall === "In progress",
  ).length;

  /** Devices whose six stages have all genuinely completed. Never inferred. */
  const completedSlotCount = deviceSlotsView.filter(
    (slot) => slot.overall === "Completed",
  ).length;

  /** Devices with refused work. Governance blocks and untapped ALLOW both count. */
  const blockedSlotCount = deviceSlotsView.filter((slot) => slot.overall === "Blocked").length;

  /** Devices where work remains - anything not settled and not disconnected. */
  const pendingSlotCount = deviceSlotsView.filter(
    (slot) => slot.overall === "Pending" || slot.overall === "Partial",
  ).length;

  /**
   * Toolbar filter, applied to the real inventory only.
   *
   * An empty query shows all 50 slots - filtering narrows the view, it never
   * decides which slots exist. Match is on the stable CYVRA ID or the model /
   * make the Host actually reported, never on a serial or any other value the
   * privacy rules keep off the screen.
   */
  const queryLower = slotQuery.trim().toLowerCase();
  const filteredSlots = deviceSlotsView.filter((slot) => {
    if (slotStatusFilter !== "all" && slot.overall !== slotStatusFilter) {
      return false;
    }
    if (queryLower === "") {
      return true;
    }
    return (
      slot.label.toLowerCase().includes(queryLower) ||
      slot.modelMake.toLowerCase().includes(queryLower)
    );
  });

  /**
   * Serial -> the live controls that phone's row may offer (its scan lock and
   * whether its report is genuinely ready to download). Read from the same
   * per-device view the old table used, so a menu button can never offer an
   * action the row itself would have refused.
   */
  const controlsBySerial = new Map(deviceRowsView.map((row) => [row.device.serial, row]));

  /** Row the operator has opened in place. Opening a row changes no screen. */
  const [expandedSlot, setExpandedSlot] = useState<number | null>(null);

  const handleSlotStageAction = (
    targetSerial: string,
    stageKey: StageKey,
    scanLock: string | null,
    scanCompleted: boolean,
  ) => {
    const isDeviceBusy = Boolean(busyBySerial[targetSerial]);
    if (stageKey === "scan") {
      selectDeviceForStage(targetSerial, "scan");
      if (scanLock === null && !isDeviceBusy) {
        void runScan(targetSerial);
      }
      return;
    }
    if (stageKey === "applications") {
      selectDeviceForStage(targetSerial, "inventory");
      if (scanCompleted && !isDeviceBusy) {
        void loadInventory(targetSerial);
      }
      return;
    }
    if (stageKey === "sanitize") {
      selectDeviceForStage(targetSerial, "sanitize");
      const devSanitize = deviceEnvelopes[targetSerial]?.sanitize;
      if (scanCompleted && !isDeviceBusy && !devSanitize?.start) {
        void runSanitize("start", targetSerial);
      }
      return;
    }
    if (stageKey === "verify") {
      selectDeviceForStage(targetSerial, "checklist");
      if (!isDeviceBusy) {
        void loadChecklist(targetSerial);
      }
    }
  };

  /**
   * One monitoring table: 25 compact rows, four operational stage controls + separate Report column per row.
   *
   * Rendering is a plain function rather than a component so it cannot acquire
   * its own state - the two tables are views over the single 50-slot list, and
   * a shared render guarantees their columns stay identical.
   */
  const renderSlotTable = (slots: typeof filteredSlots, heading: string) => (
    <table className="monitor-grid">
      <caption className="visually-hidden">{heading}</caption>
      <thead>
        <tr>
          <th scope="col" className="col-slot">
            #
          </th>
          <th scope="col" className="col-pop">
            <span className="visually-hidden">Slot populated</span>
          </th>
          <th scope="col" className="col-id">
            CYVRA ID
          </th>
          {STAGE_SEGMENTS.map((segment) => (
            <th
              key={segment.key}
              scope="col"
              className={`col-stage hue-${segment.hue}`}
              aria-label={segment.label}
            >
              {segment.head}
            </th>
          ))}
          <th scope="col" className="col-report">
            Report
          </th>
          <th scope="col" className="col-overall">
            Status
          </th>
          <th scope="col" className="col-actions">
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {slots.map((slot) => {
          const controls = slot.serial === null ? undefined : controlsBySerial.get(slot.serial);
          const isExpanded = expandedSlot === slot.slotNumber;
          const scanLock = controls?.scanLock ?? null;
          const reportReady = controls?.reportReady ?? false;
          const activeReason = controls?.activeReason ?? null;

          return (
            <Fragment key={slot.label}>
              <tr
                className={`monitor-row is-${slot.tone}${isExpanded ? " is-open" : ""}`}
                aria-expanded={isExpanded}
                onClick={() => setExpandedSlot(isExpanded ? null : slot.slotNumber)}
              >
                <td className="col-slot">{String(slot.slotNumber).padStart(2, "0")}</td>
                <td className="col-pop">
                  <span
                    className={`pop-dot is-${slot.tone}`}
                    aria-label={
                      slot.tone === "connected"
                        ? "Slot populated"
                        : slot.tone === "disconnected"
                          ? "Device disconnected"
                          : "Slot empty"
                    }
                    role="img"
                  />
                </td>
                <td className="col-id">
                  <strong>{slot.label}</strong>
                </td>

                {STAGE_SEGMENTS.map((segment) => {
                  const stage = slot.stages.find((entry) => entry.key === segment.key);
                  const tone = stage?.tone ?? "pending";
                  const text = STAGE_TONE_TEXT[tone];
                  const note = stage?.note ?? "Not started for this phone.";
                  const label = `${slot.label} ${segment.label}: ${text}. ${note}`;
                  const spinning = tone === "in-progress";

                  return (
                    <td key={segment.key} className={`col-stage hue-${segment.hue}`}>
                      {slot.serial !== null ? (
                        <button
                          type="button"
                          className={`stage-seg stage-btn is-${stageToneSlug[tone]}`}
                          title={label}
                          aria-label={label}
                          disabled={Boolean(slot.serial && busyBySerial[slot.serial])}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleSlotStageAction(
                              slot.serial,
                              segment.key,
                              scanLock,
                              slot.scanCompleted,
                            );
                          }}
                        >
                          <span
                            className={`stage-glyph${spinning ? " is-spinning" : ""}`}
                            aria-hidden="true"
                          >
                            {STAGE_TONE_GLYPH[tone]}
                          </span>
                          <span className="stage-word">{text}</span>
                        </button>
                      ) : (
                        <span
                          className={`stage-seg is-${stageToneSlug[tone]}`}
                          title={label}
                          aria-label={label}
                          role="img"
                        >
                          <span
                            className={`stage-glyph${spinning ? " is-spinning" : ""}`}
                            aria-hidden="true"
                          >
                            {STAGE_TONE_GLYPH[tone]}
                          </span>
                          <span className="stage-word">{text}</span>
                        </span>
                      )}
                    </td>
                  );
                })}

                <td className="col-report">
                  {slot.serial !== null ? (
                    <button
                      type="button"
                      className={`btn-report is-${stageToneSlug[slot.downloadTone]}${
                        slot.scanCompleted && !slot.rowState.exportedOk ? " state-orange is-ready" : ""
                      }${slot.rowState.exportedOk ? " state-green is-completed" : ""}`}
                      disabled={!slot.scanCompleted || Boolean(slot.serial && busyBySerial[slot.serial])}
                      title={
                        !slot.scanCompleted
                          ? `Complete H/W SCN for ${slot.label} before downloading its report.`
                          : slot.downloadNote
                      }
                      aria-label={`Download Report for ${slot.label}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectDeviceForStage(slot.serial, "export");
                        void runExport(slot.serial);
                      }}
                    >
                      {slot.downloadTone === "in-progress"
                        ? "Preparing…"
                        : slot.reportExported
                          ? "✓ Download Report"
                          : slot.downloadTone === "failed"
                            ? "Retry Download"
                            : slot.scanCompleted
                              ? "Download Report"
                              : "Not available"}
                    </button>
                  ) : (
                    <span className="report-cell-empty" aria-label={`${slot.label} Report: Not available`}>
                      —
                    </span>
                  )}
                </td>

                <td className="col-overall">
                  <span className={`overall-chip is-${slugify(slot.overall)}`}>
                    {slot.overall}
                  </span>
                </td>
                <td className="col-actions">
                  {slot.serial !== null && (
                    <button
                      type="button"
                      className="btn btn-danger btn-compact"
                      disabled={!controls?.sanitizeReady || Boolean(controls?.deviceBusy)}
                      title={
                        controls?.sanitizeReady
                          ? `Approve and execute sanitization for ${slot.label}`
                          : `Complete both H/W SCN and App SCN for ${slot.label} before SANITIZE_CONFIRM.`
                      }
                      aria-label={`SANITIZE_CONFIRM for ${slot.label}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectDeviceForStage(slot.serial, "sanitize");
                        void runConsolidatedSanitizeConfirm(slot.serial);
                      }}
                    >
                      SANITIZE_CONFIRM
                    </button>
                  )}
                  <button
                    type="button"
                    className="row-more"
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? "Hide" : "Show"} details and actions for ${slot.label}`}
                    title={isExpanded ? "Hide details" : "Show details and actions"}
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpandedSlot(isExpanded ? null : slot.slotNumber);
                    }}
                  >
                    {isExpanded ? "−" : "⋯"}
                  </button>
                </td>
              </tr>

              {isExpanded && (
                <tr className="monitor-detail">
                  <td colSpan={10}>
                    <div className="detail-inner">
                      <dl className="detail-facts">
                        <div>
                          <dt>Slot</dt>
                          <dd>{slot.label}</dd>
                        </div>
                        <div>
                          <dt>Connection</dt>
                          <dd>{activeReason ?? "Ready to inspect"}</dd>
                        </div>
                        <div>
                          <dt>Last result</dt>
                          <dd>{slot.rowState.reason || slot.rowState.status}</dd>
                        </div>
                      </dl>

                      <ul className="detail-stages">
                        {slot.stages.map((stage) => (
                          <li key={stage.key} className={`is-${stageToneSlug[stage.tone]}`}>
                            <span className="detail-glyph" aria-hidden="true">
                              {STAGE_TONE_GLYPH[stage.tone]}
                            </span>
                            <strong>
                              {
                                STAGE_SEGMENTS.find((segment) => segment.key === stage.key)
                                  ?.label
                              }
                            </strong>
                            <span>{STAGE_TONE_TEXT[stage.tone]}</span>
                            <span className="detail-note">{stage.note}</span>
                          </li>
                        ))}
                      </ul>

                      {slot.serial !== null && (
                        <div className="detail-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-compact"
                            disabled={scanLock !== null}
                            title={scanLock ?? `Run H/W SCN for ${slot.label}`}
                            aria-label={`Scan phone at ${slot.label}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              selectDeviceForStage(slot.serial, "scan");
                              void runScan(slot.serial);
                            }}
                          >
                            H/W SCN
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-compact"
                            disabled={!slot.scanCompleted || Boolean(controls?.deviceBusy)}
                            title={`Run App SCN for ${slot.label}`}
                            aria-label={`Load applications for ${slot.label}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              selectDeviceForStage(slot.serial, "inventory");
                              void loadInventory(slot.serial);
                            }}
                          >
                            App SCN
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-compact"
                            disabled={!controls?.sanitizeReady || Boolean(controls?.deviceBusy)}
                            title={
                              controls?.sanitizeReady
                                ? `Approve and execute sanitization for ${slot.label}`
                                : `Complete both H/W SCN and App SCN for ${slot.label} before SANITIZE_CONFIRM.`
                            }
                            aria-label={`Confirm sanitization in detail view for ${slot.label}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              selectDeviceForStage(slot.serial, "sanitize");
                              void runConsolidatedSanitizeConfirm(slot.serial);
                            }}
                          >
                            SANITIZE_CONFIRM
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-compact"
                            disabled={Boolean(controls?.deviceBusy)}
                            title={`Open Verification checklist for ${slot.label}`}
                            aria-label={`Verify phone at ${slot.label}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleSlotStageAction(slot.serial, "verify", scanLock, slot.scanCompleted);
                            }}
                          >
                            VER
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-compact"
                            disabled={!reportReady}
                            title={
                              reportReady
                                ? `Download the report for ${slot.label}`
                                : `A report is downloadable for ${slot.label} only after its scan finished successfully.`
                            }
                            aria-label={`Download report for ${slot.label}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              selectDeviceForStage(slot.serial, "export");
                              void runExport(slot.serial);
                            }}
                          >
                            Download Report
                          </button>
                          <span className="detail-activity">{slot.rowState.status}</span>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <main className="cyvra-app">
      <header className="brand-header">
        <div className="brand-lockup">
          <img className="brand-logo" src={cyvoriqLogo} alt="CYVORIQ Solutions" />
          <div className="brand-titles">
            <span className="brand-product">CYVRA MOBILE</span>
            <span className="brand-vendor">by CYVORIQ Solutions</span>
          </div>
        </div>

        <div className="header-pills">
          <button
            type="button"
            className={`status-pill is-interactive ${
              licensePresent === true ? "is-online" : "is-idle"
            }`}
            aria-label="Open User ID and Licence Key activation dialog"
            title={
              licensePresent === true
                ? `Active licence (${licenseStatus ?? "VALID"}). Click to view or update User ID and Serial Key.`
                : "Enter Registered User ID and Serial Key to activate this workstation."
            }
            onClick={() => {
              setActivationMessage(null);
              setShowActivationModal(true);
            }}
          >
            <span className="status-dot" aria-hidden="true" />
            {licensePresent === true
              ? `LICENCE: ACTIVE${
                  licenseScansRemaining !== null ? ` (${licenseScansRemaining})` : ""
                }`
              : "USER ID / LICENCE KEY"}
          </button>

          <span
            className={`status-pill is-${engineState}`}
            title="The inspection engine is running on this PC. Phone connection is shown in the device table."
          >
            <span className="status-dot" aria-hidden="true" />
            {engineLabel}
          </span>

          <span
            className={`status-pill ${connectedPhoneCount > 0 ? "is-online" : "is-idle"}`}
            aria-live="polite"
            title="How many phones this workstation currently sees over USB/ADB."
          >
            <span className="status-dot" aria-hidden="true" />
            {phonePill}
          </span>
        </div>
      </header>

      {showActivationModal && (
        <div
          className="activation-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Workstation User ID and Licence Key activation"
        >
          <div className="activation-modal-card">
            <div className="activation-modal-bar">
              <span>Workstation User ID &amp; Serial Key</span>
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                aria-label="Close activation dialog"
                onClick={() => setShowActivationModal(false)}
              >
                Close
              </button>
            </div>
            <ActivationScreen
              termsVersion="2026-04-12"
              busy={activationBusy}
              message={activationMessage}
              onSubmit={(fields) => void submitWorkstationActivation(fields)}
            />
          </div>
        </div>
      )}

      {/* The workstation's two top-level views. Its own bar rather than a
          button in the brand header: that header carries status, and status is
          not navigation. */}
      <nav className="screen-nav" aria-label="Workstation views">
        <div className="screen-nav-inner">
          <button
            type="button"
            className={`screen-nav-btn${screen === "workflow" ? " is-active" : ""}`}
            aria-current={screen === "workflow" ? "page" : undefined}
            onClick={() => openScreen("workflow")}
          >
            Inspection
          </button>
          <button
            type="button"
            className={`screen-nav-btn${screen === "ledger" ? " is-active" : ""}`}
            aria-current={screen === "ledger" ? "page" : undefined}
            onClick={() => openScreen("ledger")}
          >
            Transaction Ledger
          </button>
        </div>
      </nav>

      {screen === "ledger" ? (
        <LedgerScreen
          loading={ledgerLoading}
          error={ledgerError}
          raw={ledger?.raw ?? null}
          verified={ledger?.verified ?? null}
          decodedCount={ledger?.entries.length ?? 0}
          onRefresh={() => void refreshLedger()}
        />
      ) : (
      <div className="workspace">
        <h1 className="page-title">Connected device inspection &amp; purge</h1>

        <p className="workflow-note">
          CYVRA MOBILE inspects the connected Android phone, produces verified device and application reports, and guides the hardware-gated purge - without copying personal content.
        </p>

        {bridgeError && (
          <div className="band band-bridge">
            <strong>BRIDGE FAILURE</strong>
            <span>
              The workstation hit a technical problem and could not finish. Nothing was changed
              on the phone. If it keeps happening, send the newest file from the logs folder
              beside this workstation&apos;s reports (see docs/SUPPORT_LOGS.md) to your engineer.
            </span>
          </div>
        )}

        {/* ---- Connected-device table: the workstation's centerpiece ----- */}
        <section className="device-grid" aria-labelledby="device-grid-title">
          <div className="device-grid-head">
            <div className="device-grid-titles">
              <h2 id="device-grid-title" className="section-label">
                Connected phones
              </h2>
              <p className="hint">
                Everything below is what the inspection engine actually reports. A value the
                engine could not read is shown as &quot;Not reported&quot;.
              </p>
            </div>
          </div>

          {/* ---- A. Connected Devices summary: every figure computed ----- */}
          {/* One region, not two. The two phone counters used to sit in the
              header as 64px circles while the eight metrics sat below as
              rectangles, so the row read as a header afterthought rather than
              a summary. They are the same kind of fact - a count of what the
              Host currently reports - so they are now the same shape, on the
              same baseline, in the same centred row, with the same type. */}
          <div className="summary-strip" aria-live="polite">
            <span
              className="summary-tile is-sensed"
              title="How many phones this workstation can see over USB/ADB."
            >
              <strong>{connectedPhoneCount}</strong>
              <span>Sensed</span>
            </span>
            <span
              className="summary-tile is-authorized"
              title="How many of those phones have allowed this workstation to inspect them."
            >
              <strong>
                {connectedDevices.filter((device) => device.state === "authorized").length}
              </strong>
              <span>Authorized</span>
            </span>

            <span className="summary-sep" aria-hidden="true" />

            <span className="summary-tile is-total">
              <strong>{DEVICE_SLOT_CAPACITY}</strong>
              <span>Total Slots</span>
            </span>
            <span className="summary-tile is-connected">
              <strong>{connectedSlotCount}</strong>
              <span>Connected</span>
            </span>
            <span className="summary-tile is-empty">
              <strong>{emptySlotCount}</strong>
              <span>Empty Slots</span>
            </span>
            <span className="summary-tile is-disconnected">
              <strong>{disconnectedSlotCount}</strong>
              <span>Disconnected</span>
            </span>
            <span className="summary-tile is-scanning">
              <strong>{scanningSlotCount}</strong>
              <span>Scanning</span>
            </span>
            <span className="summary-tile is-completed">
              <strong>{completedSlotCount}</strong>
              <span>Completed</span>
            </span>
            <span className="summary-tile is-pending">
              <strong>{pendingSlotCount}</strong>
              <span>Pending</span>
            </span>
            <span className="summary-tile is-blocked">
              <strong>{blockedSlotCount}</strong>
              <span>Blocked</span>
            </span>
          </div>

          {/* ---- C. Dashboard toolbar ---------------------------------- */}
          <div className="dash-toolbar">
            <label className="toolbar-field">
              <span className="toolbar-label">Search</span>
              <input
                type="search"
                className="toolbar-input"
                placeholder="CYVRA ID or model"
                value={slotQuery}
                onChange={(event) => setSlotQuery(event.target.value)}
                aria-label="Search by CYVRA device ID or model"
              />
            </label>

            <label className="toolbar-field">
              <span className="toolbar-label">Status</span>
              <select
                className="toolbar-select"
                value={slotStatusFilter}
                onChange={(event) => setSlotStatusFilter(event.target.value)}
                aria-label="Filter slots by overall status"
              >
                <option value="all">All statuses</option>
                <option value="Completed">Completed</option>
                <option value="Scanning">Scanning</option>
                <option value="In progress">In progress</option>
                <option value="Pending">Pending</option>
                <option value="Partial">Partial</option>
                <option value="Blocked">Blocked</option>
                <option value="Failed">Failed</option>
                <option value="Disconnected">Disconnected</option>
                <option value="Empty">Empty</option>
              </select>
            </label>

            <button
              type="button"
              className="btn btn-secondary btn-compact"
              disabled={devicesLoading}
              aria-label="Refresh connected devices"
              title={
                devicesLoading
                  ? "The workstation is listing phones."
                  : "Ask the inspection engine for the current phone list and re-check the connection."
              }
              onClick={() => {
                // The removed "Check connection" button owned GET_DEVICE_STATE.
                // Its check is preserved here rather than dropped: Refresh now
                // re-issues both queries, so the workstation check and the
                // phone list are re-run from the one control this view keeps.
                void refreshDeviceState();
                void refreshDevices(true);
              }}
            >
              {devicesLoading ? "Refreshing…" : "Refresh"}
            </button>

            {(slotQuery !== "" || slotStatusFilter !== "all") && (
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                aria-label="Clear search and status filter"
                onClick={() => {
                  setSlotQuery("");
                  setSlotStatusFilter("all");
                }}
              >
                Clear
              </button>
            )}

            <span className="toolbar-spacer" />

            <span className="toolbar-updated">
              Last updated:{" "}
              <strong>{lastRefreshAt ?? "not yet refreshed"}</strong>
            </span>
          </div>

          <div className="grid-region" aria-live="polite">
            {devicesLoading && connectedDevices.length === 0 ? (
              <div className="monitor-split is-loading">
                {[0, 1].map((placeholder) => (
                  <div key={placeholder} className="monitor-panel">
                    <table className="monitor-grid is-loading">
                      <caption className="visually-hidden">Loading connected phones</caption>
                      <thead>
                        <tr>
                          <th scope="col">#</th>
                          <th scope="col" className="col-pop">
                            <span className="visually-hidden">Slot populated</span>
                          </th>
                          <th scope="col" className="col-id">
                            CYVRA ID
                          </th>
                          {STAGE_SEGMENTS.map((segment) => (
                            <th
                              key={segment.key}
                              scope="col"
                              className={`col-stage hue-${segment.hue}`}
                              aria-label={segment.label}
                            >
                              {segment.head}
                            </th>
                          ))}
                          <th scope="col" className="col-report">
                            Report
                          </th>
                          <th scope="col" className="col-overall">
                            Status
                          </th>
                          <th scope="col" className="col-actions">
                            <span className="visually-hidden">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {[0, 1, 2].map((placeholder) => (
                          <tr key={placeholder} className="is-skeleton">
                            <td colSpan={10}>
                              <span className="skeleton-bar" aria-hidden="true" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ) : devicesError !== null ? (
              <div className="band band-error">
                <strong>COULD NOT LIST PHONES</strong>
                <span>{devicesError}</span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  aria-label="Retry listing connected phones"
                  onClick={() => void refreshDevices(true)}
                >
                  Retry
                </button>
              </div>
            ) : adbAvailable === false ? (
              <div className="band band-note">
                <strong>PHONE LIST UNAVAILABLE</strong>
                <span>
                  The inspection engine cannot list phones right now. Check that the workstation
                  is fully installed, then try again.
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  aria-label="Retry listing connected phones"
                  onClick={() => void refreshDevices(true)}
                >
                  Retry
                </button>
              </div>
            ) : filteredSlots.length === 0 ? (
              <div className="grid-empty">
                <p>
                  {deviceSlotsView.length === connectedSlotCount && connectedSlotCount === 0
                    ? "No phone is connected to this workstation right now."
                    : "No slot matches the current search or status filter."}
                </p>
                {connectedSlotCount === 0 ? (
                  <ul className="list-plain">
                    <li>Connect the data cable to this laptop.</li>
                    <li>Enable USB debugging on the phone (Developer options).</li>
                    <li>Tap ALLOW on the phone when it asks to trust this computer.</li>
                  </ul>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    aria-label="Clear search and status filter"
                    onClick={() => {
                      setSlotQuery("");
                      setSlotStatusFilter("all");
                    }}
                  >
                    Clear filter
                  </button>
                )}
              </div>
            ) : (
              <div className="monitor-split">
                <div className="monitor-panel">
                  {renderSlotTable(
                    filteredSlots.filter((slot) => slot.slotNumber <= 25),
                    "Device slots 1 to 25",
                  )}
                </div>
                <div className="monitor-panel">
                  {renderSlotTable(
                    filteredSlots.filter((slot) => slot.slotNumber > 25),
                    "Device slots 26 to 50",
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ---- D. Legend: every symbol explained in words -------------- */}
          <footer className="monitor-legend">
            <span className="legend-title">Workflow states</span>
            {(
              [
                ["pending", "Pending"],
                ["in-progress", "In progress"],
                ["completed", "Completed"],
                ["partial", "Partial"],
                ["blocked", "Blocked"],
                ["failed", "Failed"],
              ] as const
            ).map(([tone, word]) => (
              <span key={tone} className={`legend-item is-${tone}`}>
                <span className="stage-glyph" aria-hidden="true">
                  {STAGE_TONE_GLYPH[tone]}
                </span>
                <span>{word}</span>
              </span>
            ))}

            <span className="legend-divider" aria-hidden="true" />

            <span className="legend-item">
              <span className="pop-dot is-connected" aria-hidden="true" />
              <span>Slot populated</span>
            </span>
            <span className="legend-item">
              <span className="pop-dot is-empty" aria-hidden="true" />
              <span>Slot empty</span>
            </span>
            <span className="legend-item">
              <span className="pop-dot is-disconnected" aria-hidden="true" />
              <span>Disconnected</span>
            </span>

            <span className="legend-divider" aria-hidden="true" />

            <span className="legend-stages">
              Connect <span className="hue-swatch hue-blue" aria-hidden="true" /> · Scan{" "}
              <span className="hue-swatch hue-orange" aria-hidden="true" /> · Applications{" "}
              <span className="hue-swatch hue-purple" aria-hidden="true" /> · Sanitize{" "}
              <span className="hue-swatch hue-teal" aria-hidden="true" /> · Verify{" "}
              <span className="hue-swatch hue-indigo" aria-hidden="true" /> · Download{" "}
              <span className="hue-swatch hue-green" aria-hidden="true" />
            </span>

            <span className="toolbar-spacer" />
            <span className="legend-updated">
              Last inventory refresh: <strong>{lastRefreshAt ?? "not yet refreshed"}</strong>
            </span>
          </footer>
        </section>

        {/* Workflow navigation: a compact tab strip over the five operation
            panels the wizard still owns. The connection stage is deliberately
            absent - its state is carried per-device by the 50-slot dashboard
            above, and a sixth tab repeating it would show the same fact twice.
            The stage numbering is left untouched: this is still a six-stage
            workflow and an operator reading "Step 2 of 6" is reading the truth. */}
        <nav className="stage-tabs" aria-label="Workflow stages">
          {STEPS.filter((step) => step.key !== "connect").map((step) => {
            const state = nodeStates[step.key];
            const slug = stateSlug[state];
            const reason = stepLock[step.key];
            const isActive = step.key === activeStep;
            const spinning = stageInFlight(step.key);

            return (
              <button
                key={step.key}
                type="button"
                className={`stage-tab is-${slug}${isActive ? " is-active" : ""}`}
                aria-current={isActive ? "step" : undefined}
                aria-label={
                  reason
                    ? `Step ${step.index}: ${step.label}. ${state}. ${reason}`
                    : `Step ${step.index}: ${step.label}. ${state}`
                }
                title={reason ?? `${step.label}: ${state}`}
                onClick={() => setActiveStep(step.key)}
              >
                <span className="stage-tab-index" aria-hidden="true">
                  {spinning ? (
                    <img className="node-spin" src={cyvoriqLogo} alt="" />
                  ) : (
                    step.index
                  )}
                </span>
                <span className="stage-tab-label">{step.label}</span>
                <span className={`stage-tab-state is-${slug}`}>{state}</span>
              </button>
            );
          })}
        </nav>

        <section className="wizard-card">
          <div className="step-head">
            <span className="step-index">{activeMeta.index}</span>
            <div className="step-titles">
              <h2>{activeMeta.heading}</h2>
              <span className="step-kicker">
                Step {activeMeta.index} of {STEPS.length}
              </span>
            </div>
            <span className={`step-state is-${stateSlug[nodeStates[activeStep]]}`}>
              {nodeStates[activeStep]}
            </span>
          </div>

          <div className="step-body">
            {activeLock && (
              <Notice tone="gate" label="Stage locked">
                {activeLock}
              </Notice>
            )}

            {/* Plain-language stage copy: static text, never a result.
                Hidden on the Scan step: that step is a single action and the
                three explanation cards pushed the actual control off-screen. */}
            {activeStep !== "scan" && (
              <div className="step-copy">
                <div className="copy-block">
                  <h3>Purpose</h3>
                  <p>{activeMeta.purpose}</p>
                </div>
                <div className="copy-block">
                  <h3>What to do now</h3>
                  <p>{activeMeta.now}</p>
                </div>
                <div className="copy-block">
                  <h3>What happens next</h3>
                  <p>{activeMeta.next}</p>
                </div>
              </div>
            )}

            {/* Step 1 - the "Workstation and phone connection" panel - is
                deliberately not rendered. Its checks are untouched: GET_PREFLIGHT
                and GET_DEVICE_STATE still run on mount, they still feed
                `connectPassed`, `stepLock` and the stage gates below, and the
                toolbar Refresh still re-issues GET_DEVICE_STATE. What is gone is
                only the second copy of that fact on screen - every phone's
                connection state is already carried per-row by the dashboard. */}

            {/* ---- Step 2 ------------------------------------------------ */}
            {activeStep === "scan" && (
              <>
                <div className="field-row">
                  <label className="field">
                    <span>Phone to scan</span>
                    <input
                      value={serial}
                      onChange={(event) => {
                        setSerial(event.target.value);
                        setSerialFromHost(false);
                      }}
                      placeholder="No phone reported yet"
                      aria-describedby="serial-provenance"
                    />
                    <SerialProvenance
                      id="serial-provenance"
                      fromHost={serialFromHost}
                      value={serial}
                    />
                  </label>

                  <label className="field">
                    <span>Operator ID (optional)</span>
                    <input
                      value={operatorId}
                      onChange={(event) => setOperatorId(event.target.value)}
                      placeholder="Sent only when filled in"
                    />
                    <small>
                      Optional for the initial scan (the Host applies its default when blank); required in Step 6 to finalise and seal the report.
                    </small>
                  </label>
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!hostConnected || !serial.trim() || busy !== null}
                  title={lockScan ?? undefined}
                  aria-label={busy === "RUN_SCAN" ? "Scanning..." : activeMeta.primary}
                  onClick={() => void runScan()}
                >
                  {busy === "RUN_SCAN" ? "Scanning..." : activeMeta.primary}
                </button>

                {hostConnected && !serial.trim() && (
                  <p className="hint">
                    No phone is reported yet - connect the phone, then check the connection.
                    This screen will not invent a serial.
                  </p>
                )}

                <Outcome envelope={scan} />

                {scanPayload && (
                  <div className="kv-grid">
                    <div className="kv">
                      <span className="card-label">Report ID</span>
                      <strong>
                        <Value value={readString(scanPayload, "reportId")} />
                      </strong>
                    </div>
                    <div className="kv">
                      <span className="card-label">Session</span>
                      <strong>
                        <Value value={readString(scanPayload, "sessionUuid")} />
                      </strong>
                    </div>
                    <div className="kv">
                      <span className="card-label">Scans remaining</span>
                      <strong>
                        <Value value={String(readCount(scanPayload, "scansRemaining") ?? "")} />
                      </strong>
                    </div>
                    <div className="kv">
                      <span className="card-label">Inventory</span>
                      <strong>
                        {readBoolean(scanPayload, "inventoryAvailable")
                          ? "Available"
                          : "Not available"}{" "}
                        | <Value value={readString(scanPayload, "enumerationCompleteness")} />
                      </strong>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ---- Step 3 ------------------------------------------------ */}
            {activeStep === "inventory" && (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!scanOk || busy !== null}
                  title={lockLoad ?? undefined}
                  aria-label={
                    busy === "GET_APPLICATION_INVENTORY"
                      ? "Loading..."
                      : activeMeta.primary
                  }
                  onClick={() => void loadInventory()}
                >
                  {busy === "GET_APPLICATION_INVENTORY" ? "Loading..." : activeMeta.primary}
                </button>

                <Outcome envelope={inventory} />

                {inventoryPayload && (
                  <>
                    <div className="kv-grid">
                      <div className="kv">
                        <span className="card-label">Total applications</span>
                        <strong>
                          <Value
                            value={String(readCount(inventoryPayload, "totalApplications") ?? "")}
                          />
                        </strong>
                      </div>
                      <div className="kv">
                        <span className="card-label">Enumeration completeness</span>
                        <strong>
                          <Value value={readString(inventoryPayload, "enumerationCompleteness")} />
                        </strong>
                      </div>
                      <div className="kv">
                        <span className="card-label">S1 evidence</span>
                        <strong>
                          {readBoolean(inventoryPayload, "s1EvidencePresent")
                            ? "Present"
                            : "Absent"}{" "}
                          |{" "}
                          <Value value={readString(inventoryPayload, "s1EnumerationCompleteness")} />
                        </strong>
                      </div>
                      <div className="kv">
                        <span className="card-label">S2 evidence</span>
                        <strong>
                          {readBoolean(inventoryPayload, "s2EvidencePresent")
                            ? "Present"
                            : "Absent"}{" "}
                          |{" "}
                          <Value value={readString(inventoryPayload, "s2EnumerationCompleteness")} />
                        </strong>
                      </div>
                    </div>

                    <h3 className="subhead">Classification</h3>
                    <div className="count-grid">
                      {(
                        [
                          ["preinstalledSystemCount", "Preinstalled system"],
                          ["updatedSystemCount", "Updated system"],
                          ["userThirdPartyCount", "User third-party"],
                          ["unknownClassificationCount", "Unknown classification"],
                          ["enabledCount", "Enabled"],
                          ["disabledCount", "Disabled"],
                          ["defaultEnabledCount", "Default enabled"],
                          ["unknownEnabledStateCount", "Unknown enabled state"],
                        ] as const
                      ).map(([key, label]) => (
                        <div className="count" key={key}>
                          <span>{label}</span>
                          <strong>{readCount(inventoryPayload, key) ?? 0}</strong>
                        </div>
                      ))}
                    </div>

                    <h3 className="subhead">Provenance &amp; reconciliation</h3>
                    <div className="count-grid">
                      {(
                        [
                          ["s1OnlyCount", "S1 only"],
                          ["s2OnlyCount", "S2 only"],
                          ["bothCount", "In both"],
                          ["s1ProvenanceCount", "S1 provenance"],
                          ["s2ProvenanceCount", "S2 provenance"],
                          ["conflictCount", "Conflicts"],
                        ] as const
                      ).map(([key, label]) => (
                        <div className="count" key={key}>
                          <span>{label}</span>
                          <strong>{readCount(inventoryPayload, key) ?? 0}</strong>
                        </div>
                      ))}
                    </div>

                    <h3 className="subhead">
                      Conflict notes ({readList(inventoryPayload, "conflicts").length})
                    </h3>
                    <ListBlock
                      values={readList(inventoryPayload, "conflicts")}
                      empty="No conflicts reported."
                    />

                    <h3 className="subhead">Limitations</h3>
                    <ListBlock
                      values={readList(inventoryPayload, "limitations")}
                      empty="No limitations reported."
                    />

                    <div className="band band-note">
                      <strong>RAW UID WITHHELD</strong>
                      <span>
                        {readBoolean(inventoryPayload, "rawUidWithheld")
                          ? "The Host withholds raw application UIDs from this report by design. Only platform flags are used for classification."
                          : "The Host did not report rawUidWithheld on this response."}
                      </span>
                    </div>
                  </>
                )}
              </>
            )}

            {/* ---- Step 4 ------------------------------------------------ */}
            {activeStep === "sanitize" && (
              <>
                <div className="action-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!scanOk || startOk || busy !== null}
                    title={lockGuide ?? undefined}
                    aria-label={
                      busy === "SANITIZE_START" ? "Working..." : activeMeta.primary
                    }
                    onClick={() => void runSanitize("start")}
                  >
                    {busy === "SANITIZE_START" ? "Working..." : activeMeta.primary}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!startOk || authorizeOk || busy !== null}
                    title={lockAcknowledge ?? undefined}
                    aria-label={
                      busy === "SANITIZE_AUTHORIZE" ? "Working..." : "Acknowledge the warning"
                    }
                    onClick={() => void runSanitize("authorize")}
                  >
                    {busy === "SANITIZE_AUTHORIZE" ? "Working..." : "Acknowledge the warning"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!authorizeOk || !phrase || confirmOk || busy !== null}
                    title={lockConfirm ?? undefined}
                    aria-label={
                      busy === "SANITIZE_CONFIRM" ? "Working..." : "Confirm the purge"
                    }
                    onClick={() => void runSanitize("confirm")}
                  >
                    {busy === "SANITIZE_CONFIRM" ? "Working..." : "Confirm the purge"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={!confirmOk || busy !== null}
                    title={lockExecute ?? undefined}
                    aria-label={busy === "SANITIZE_EXECUTE" ? "Working..." : "Run the purge"}
                    onClick={() => void runSanitize("execute")}
                  >
                    {busy === "SANITIZE_EXECUTE" ? "Working..." : "Run the purge"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={!(scanOk && inventory?.status === "OK") || busy !== null}
                    title={
                      scanOk && inventory?.status === "OK"
                        ? "Confirm and execute consolidated sanitization (SANITIZE_AUTHORIZE)"
                        : "Complete both H/W SCN and App SCN for this phone before SANITIZE_CONFIRM."
                    }
                    aria-label="SANITIZE_CONFIRM"
                    onClick={() => void runConsolidatedSanitizeConfirm()}
                  >
                    SANITIZE_CONFIRM
                  </button>
                </div>

                <Outcome envelope={sanitize.start} />
                {startPayload && (
                  <div className="kv-grid">
                    <div className="kv">
                      <span className="card-label">Eligible</span>
                      <strong>{String(readBoolean(startPayload, "eligible") ?? false)}</strong>
                    </div>
                    <div className="kv">
                      <span className="card-label">Operation</span>
                      <strong>
                        <Value value={readString(startPayload, "operationId")} />
                      </strong>
                    </div>
                    <div className="kv">
                      <span className="card-label">Current step</span>
                      <strong>
                        <Value value={readString(startPayload, "currentStep")} />
                      </strong>
                    </div>
                    <div className="kv">
                      <span className="card-label">Confirmation phrase</span>
                      <strong>
                        <Value value={phrase} fallback="Not issued" />
                      </strong>
                      <small>
                        Supplied back to the workstation verbatim - never typed here.
                      </small>
                    </div>
                  </div>
                )}

                <Outcome envelope={sanitize.authorize} />
                {authorizePayload && (
                  <div className="kv-grid">
                    <div className="kv">
                      <span className="card-label">Recorded step</span>
                      <strong>
                        <Value value={readString(authorizePayload, "step")} />
                      </strong>
                    </div>
                    <div className="kv">
                      <span className="card-label">Acknowledged</span>
                      <strong>
                        {String(readBoolean(authorizePayload, "acknowledged") ?? false)}
                      </strong>
                    </div>
                  </div>
                )}

                <Outcome envelope={sanitize.confirm} />
                {confirmPayload && (
                  <div className="kv-grid">
                    <div className="kv">
                      <span className="card-label">Recorded step</span>
                      <strong>
                        <Value value={readString(confirmPayload, "step")} />
                      </strong>
                    </div>
                    <div className="kv">
                      <span className="card-label">Phrase accepted</span>
                      <strong>
                        {String(readBoolean(confirmPayload, "phraseAccepted") ?? false)}
                      </strong>
                    </div>
                  </div>
                )}

                <Outcome envelope={sanitize.execute} />

                {blocked && executePayload && (
                  <div className="band band-blocked">
                    <strong>PURGE BLOCKED | DECISION D-1, OUTCOME B</strong>
                    <span>
                      The destructive trigger is hardware-gated and stays unarmed until it has been
                      validated on the physical device. This is the expected, frozen outcome - not
                      an application crash and not a successful sanitization.
                    </span>
                    <dl className="blocked-facts">
                      <dt>executionStatus</dt>
                      <dd>{executeStatus}</dd>
                      <dt>lifecycleOutcome</dt>
                      <dd>
                        <Value value={readString(executePayload, "lifecycleOutcome")} />
                      </dd>
                      <dt>verificationStatus</dt>
                      <dd>
                        <Value value={readString(executePayload, "verificationStatus")} />
                      </dd>
                      <dt>successClaimed</dt>
                      <dd>{String(readBoolean(executePayload, "successClaimed") ?? false)}</dd>
                      <dt>executionSuccess</dt>
                      <dd>{String(readBoolean(executePayload, "executionSuccess") ?? false)}</dd>
                      <dt>decision</dt>
                      <dd>
                        <Value value={readString(executePayload, "decision")} />
                      </dd>
                    </dl>

                    <h4>Why it blocked</h4>
                    <ListBlock
                      values={readList(executePayload, "blockReasons")}
                      empty="The Host did not list any block reasons."
                    />
                  </div>
                )}

                {executePayload && !blocked && (
                  <div className="kv-grid">
                    <div className="kv">
                      <span className="card-label">Execution status</span>
                      <strong>
                        <Value value={executeStatus} />
                      </strong>
                    </div>
                    <div className="kv">
                      <span className="card-label">Lifecycle outcome</span>
                      <strong>
                        <Value value={readString(executePayload, "lifecycleOutcome")} />
                      </strong>
                    </div>
                    <div className="kv">
                      <span className="card-label">Success claimed</span>
                      <strong>{String(readBoolean(executePayload, "successClaimed") ?? false)}</strong>
                    </div>
                  </div>
                )}

                {confirmOk && !executePayload && (
                  <p className="hint">
                    Ready to run the purge. The workstation reports its own decision, and this
                    screen shows whatever it returns - it never claims success on its own.
                  </p>
                )}
              </>
            )}

            {/* ---- Step 5: technician verification -------------------- */}
            {activeStep === "checklist" && (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy !== null}
                  aria-label={busy === "GET_CHECKLIST" ? "Loading..." : "Load checklist"}
                  onClick={() => void loadChecklist()}
                >
                  {busy === "GET_CHECKLIST" ? "Loading..." : "Load checklist"}
                </button>

                <Outcome envelope={checklist} />

                {checklistAttestationKind && (
                  <Notice tone="action" label={checklistAttestationKind}>
                    {checklistClaim}
                  </Notice>
                )}

                {checklistCatalogue.length > 0 && (
                  <>
                    <div className="kv-grid">
                      <div className="kv">
                        <span className="card-label">Answered</span>
                        <strong>
                          {checklistAnswered} of {checklistExpected}
                        </strong>
                      </div>
                      <div className="kv">
                        <span className="card-label">Status</span>
                        <strong>{checklistComplete ? "Complete" : "Incomplete"}</strong>
                      </div>
                    </div>

                    {checklistCatalogue.map((check) => {
                      const id = readString(check, "id") ?? "";
                      const outcome = checklistAnswers[id];
                      return (
                        <div className="check-row" key={id}>
                          <div className="check-main">
                            <span className="card-label">
                              {readString(check, "priority")} &middot;{" "}
                              {readString(check, "domain")}
                            </span>
                            <strong className="device-text">{readString(check, "item")}</strong>
                            {readString(check, "whyNotAutomatable") && (
                              <small>{readString(check, "whyNotAutomatable")}</small>
                            )}
                          </div>
                          <select
                            className="check-select"
                            aria-label={`Outcome for ${id}`}
                            value={outcome ?? ""}
                            disabled={busy !== null}
                            onChange={(event) =>
                              setChecklistAnswers((current) => ({
                                ...current,
                                [id]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Not chosen</option>
                            {checklistOutcomes.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}

                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!scanOk || !checklistAllAnswered || busy !== null}
                      title={
                        !scanOk
                          ? "Complete a scan first."
                          : !checklistAllAnswered
                            ? "Every check needs an outcome before this can be recorded."
                            : undefined
                      }
                      aria-label={busy === "RECORD_CHECKLIST" ? "Recording..." : "Record checklist"}
                      onClick={() => void recordChecklist()}
                    >
                      {busy === "RECORD_CHECKLIST" ? "Recording..." : activeMeta.primary}
                    </button>

                    <Outcome envelope={checklistRecorded} />
                  </>
                )}
              </>
            )}

            {/* ---- Step 6 ------------------------------------------------ */}
            {activeStep === "export" && (
              <>
                <div className="report-actions-row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!scanOk || busy !== null}
                    title={lockDownload ?? undefined}
                    aria-label={busy === "EXPORT_REPORT" ? "Writing..." : activeMeta.primary}
                    onClick={() => void runExport()}
                  >
                    {busy === "EXPORT_REPORT" ? "Writing..." : activeMeta.primary}
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary btn-open-folder"
                    title="Open the reports directory on this computer where PDF reports and data files are saved"
                    aria-label="Open Reports Folder"
                    onClick={() => void handleOpenReportsFolder()}
                  >
                    Open Reports Folder
                  </button>
                </div>

                <div className="reports-folder-path-box">
                  <span className="card-label">Reports Output Directory</span>
                  <code className="path">{reportsDirectory || "%USERPROFILE%\\Downloads\\CYVRA"}</code>
                </div>

                {openFolderError && (
                  <p className="field-error" role="alert">
                    Could not open reports directory: {openFolderError}
                  </p>
                )}

                <Outcome envelope={exported} />

                {exported && (
                  <div className="kv-grid">
                    {(pdfPath || hwPdfPath || appPdfPath) && (
                      <div className="kv">
                        <span className="card-label">pdfReportPath</span>
                        <strong className="path">
                          <Value value={pdfPath ?? hwPdfPath ?? appPdfPath} fallback="Not returned" />
                        </strong>
                      </div>
                    )}
                    <div className="kv">
                      <span className="card-label">reportJsonPath</span>
                      <strong className="path">
                        <Value value={reportJsonPath} fallback="Not returned" />
                      </strong>
                    </div>
                    <div className="kv">
                      <span className="card-label">reportMarkdownPath</span>
                      <strong className="path">
                        <Value value={reportMarkdownPath} fallback="Not returned" />
                      </strong>
                    </div>
                    <div className="kv">
                      <span className="card-label">manifestPath</span>
                      <strong className="path">
                        <Value value={manifestPath} fallback="Not returned" />
                      </strong>
                    </div>
                  </div>
                )}

                {exported && !reportJsonPath && (
                  <p className="hint">
                    The workstation did not report any file locations on this response - read the
                    message above, then try the download again.
                  </p>
                )}

                {/*
                  Finalisation. The download above writes the scan report; the final
                  controlled report only exists once it has been normalised, authorised
                  by a named operator and sealed - which is this control.
                */}
                <div className="field-row">
                  <label className="field">
                    <span>Operator ID (required to finalise and seal)</span>
                    <input
                      value={operatorId}
                      onChange={(event) => setOperatorId(event.target.value)}
                      placeholder="Name or ID of the authorising operator"
                    />
                    <small>
                      Required by FINALISE_REPORT before the workstation will normalise, sign and seal the final report.
                    </small>
                  </label>
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!scanOk || busy !== null || operatorId.trim() === ""}
                  title={
                    operatorId.trim() === ""
                      ? "Name the operator authorising this report before it can be sealed."
                      : lockDownload ?? undefined
                  }
                  aria-label={
                    busy === "FINALISE_REPORT" ? "Sealing..." : "Finalise and seal the report"
                  }
                  onClick={() => void runFinalise()}
                >
                  {busy === "FINALISE_REPORT" ? "Sealing..." : "Finalise and seal the report"}
                </button>

                <Outcome envelope={finalised} />

                {finalised?.status === "OK" && (
                  <div className="kv-grid">
                    <div className="kv">
                      <span className="card-label">seal digest (SHA-256)</span>
                      <strong className="path">
                        <Value value={sealDigest} fallback="Not returned" />
                      </strong>
                    </div>
                    <div className="kv">
                      <span className="card-label">final report path</span>
                      <strong className="path">
                        <Value value={finalReportPath} fallback="Not returned" />
                      </strong>
                    </div>
                    <div className="kv">
                      <span className="card-label">archive path</span>
                      <strong className="path">
                        <Value value={finalZipPath} fallback="Not returned" />
                      </strong>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <section className="help-card" aria-label="Help">
          <div className="help-head">
            <h2>Help</h2>
          </div>

          <div className="help-body">
            <ul className="help-list">
              <li>
                The workflow has six stages: Step 1 (Connect) is tracked live per slot in the
                Connected Phones table above; Step 2 (Scan) requires a connected Host and phone
                serial; Steps 3 (Applications), 4 (Sanitize) and 6 (Download) unlock once a scan
                succeeds; and Step 5 (Verify) is always open to review the 14 checks (recording
                requires a completed scan).
              </li>
              <li>Only the connected phone is inspected. This laptop is never scanned and never wiped.</li>
              <li>
                Nothing personal is copied off the phone - the workstation reads the device details
                and the list of installed applications, and nothing else.
              </li>
              <li>
                The purge stays hardware-gated under decision D-1 until it has been validated on a
                physical device, so this build reports the purge as blocked on purpose.
              </li>
              <li>
                If a button will not run, hover it to see why. The reason on the button is the same
                rule the workstation is enforcing.
              </li>
            </ul>
          </div>
        </section>
      </div>
      )}

      {/* One line, one purpose: which build is this workstation running. */}
      <footer className="app-footer">
        <span>
          v{appVersion ?? "unknown"} - build {BUILD_COMMIT} - protocol v
          {host?.protocolVersion ?? "1"} - (C) CYVORIQ Solutions
        </span>
      </footer>
    </main>
  );
}

export default App;
