import { useCallback, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import cyvoriqLogo from "./assets/cyvoriq-solutions.png";

type HostInfoResult = {
  connected: boolean;
  protocolVersion: string;
  requestId: string;
  hostVersion: string;
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

type PreflightCheck = {
  checkName: string;
  pass: boolean;
  details: string;
  isOptional: boolean;
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

type StepKey = "connect" | "scan" | "inventory" | "sanitize" | "export";

/**
 * One entry per stage of the operator wizard.
 *
 * Everything here is static interface text: it names the stage, tells the
 * operator what to do, and labels the stage's single primary action. It never
 * describes a result - every value shown *inside* a stage still comes from a
 * Host response. No protocol command name appears in any of these strings;
 * those live in the Engineer diagnostics drawer under Help.
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
    key: "export",
    index: 5,
    label: "Download",
    heading: "Download the verified report",
    primary: "Download reports",
    purpose: "Save the finished report and its checksum file onto this laptop so you can hand them over.",
    now: "Download the reports and note the file locations the workstation gives you.",
    next: "The files stay with the scan on this laptop; nothing is uploaded anywhere.",
  },
];

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

function readChecks(source: Record<string, unknown> | null): PreflightCheck[] {
  const value = source?.checks;

  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => {
    const check = (typeof entry === "object" && entry !== null ? entry : {}) as Record<
      string,
      unknown
    >;

    return {
      checkName: readString(check, "checkName") ?? "(unnamed check)",
      pass: readBoolean(check, "pass") ?? false,
      details: readString(check, "details") ?? "",
      isOptional: readBoolean(check, "isOptional") ?? false,
    };
  });
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
 * version that used to sit under this band are engineer detail and now render
 * only in the Engineer diagnostics drawer.
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

/** Decoded response, field for field as the Host sent it - only whitespace differs. */
function RawResponse({ envelope }: { envelope: HostEnvelope | null }) {
  if (!envelope) {
    return null;
  }

  return (
    <details className="raw-response">
      <summary>Decoded response ({envelope.requestId})</summary>
      <pre>{JSON.stringify(envelope, null, 2)}</pre>
    </details>
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

type DeviceView = { text: string; ready: boolean };

/**
 * Turns the Host's connection enums into one plain sentence for the operator.
 *
 * The raw enums (NO_DEVICE, USB_DETECTED, ADB_DETECTED, ADB_UNAVAILABLE,
 * ADB_UNAUTHORIZED, ADB_OFFLINE, ADB_READY) and the Host's own diagnostic
 * strings never reach the operator view - they render verbatim in the
 * Engineer diagnostics drawer instead. Two rules here are deliberate and
 * must not be relaxed:
 *
 *   - `ready` is produced only when the Host itself reported readyToScan
 *     with an ADB_READY device present, so an unauthorized phone can never
 *     be shown as ready;
 *   - a phone that is plugged in but not yet authorised is never reported
 *     as absent.
 */
function deviceView(deviceState: DeviceStateResult | null, failed: boolean): DeviceView {
  if (!deviceState) {
    return {
      text: failed
        ? "Checking the phone failed - the workstation engine did not answer."
        : "Checking the phone connection...",
      ready: false,
    };
  }

  const ready =
    deviceState.readyToScan === true &&
    deviceState.adbState === "ADB_READY" &&
    deviceState.device !== null;

  if (ready) {
    const device = deviceState.device;
    const name = (device?.model ?? "").trim() || (device?.serial ?? "").trim();
    return { text: name ? `Phone ready: ${name}` : "Phone ready", ready: true };
  }

  if (deviceState.usbState === "USB_NOT_CONNECTED") {
    return {
      text: "No phone detected. Connect the phone to any USB port of this laptop with a data cable.",
      ready: false,
    };
  }

  if (deviceState.adbState === "ADB_OFFLINE") {
    return {
      text: "Phone is reconnecting. Check the USB cable, or unplug it and plug it back in.",
      ready: false,
    };
  }

  if (
    deviceState.adbState === "ADB_UNAVAILABLE" ||
    deviceState.adbState === "ADB_UNAUTHORIZED"
  ) {
    return {
      text: "Phone detected on USB. On the phone: enable USB debugging (Developer options) and tap ALLOW when asked to trust this computer.",
      ready: false,
    };
  }

  return {
    text: "Phone detected, but the workstation cannot read its state yet. Check the phone screen and try again.",
    ready: false,
  };
}

function App() {
  const [host, setHost] = useState<HostInfoResult | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);

  const [preflight, setPreflight] = useState<HostEnvelope | null>(null);
  const [deviceState, setDeviceState] = useState<DeviceStateResult | null>(null);
  const [deviceStateError, setDeviceStateError] = useState<string | null>(null);

  const [serial, setSerial] = useState("");
  const [serialFromHost, setSerialFromHost] = useState(false);
  const [operatorId, setOperatorId] = useState("");

  const [scan, setScan] = useState<HostEnvelope | null>(null);
  const [inventory, setInventory] = useState<HostEnvelope | null>(null);
  const [sanitize, setSanitize] = useState<Record<SanitizeStage, HostEnvelope | null>>(
    EMPTY_SANITIZE,
  );
  const [exported, setExported] = useState<HostEnvelope | null>(null);

  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /** Which stage of the wizard is on screen. Navigation only: it gates nothing. */
  const [activeStep, setActiveStep] = useState<StepKey>("connect");

  /**
   * Single entry point to the Rust bridge.
   *
   * An `Err` from the Rust command - the bridge being unable to reach the Host
   * at all - is caught here and reported as `bridgeError`, which is a different
   * situation from a Host `status: "ERROR"` and is rendered separately.
   */
  const send = useCallback(
    async (command: string, payload: Record<string, unknown> = {}): Promise<HostEnvelope | null> => {
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
      setDeviceState(next);
      adoptHostSerial(next.device?.serial ?? null);
      return next;
    } catch (error) {
      const message = String(error);
      setDeviceStateError(message);
      setBridgeError(`get_device_state: ${message}`);
      return null;
    }
  }, [adoptHostSerial]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
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
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshDeviceState, send]);

  const runScan = async () => {
    const payload: Record<string, unknown> = { serial: serial.trim() };

    if (operatorId.trim()) {
      payload.operatorId = operatorId.trim();
    }

    const envelope = await send("RUN_SCAN", payload);
    setScan(envelope);

    // A fresh scan invalidates every downstream artifact (the Host clears its
    // sanitization state too); the screen follows rather than showing stale data.
    setInventory(null);
    setSanitize(EMPTY_SANITIZE);
    setExported(null);
  };

  const loadInventory = async () => {
    setInventory(await send("GET_APPLICATION_INVENTORY", {}));
  };

  const runSanitize = async (stage: SanitizeStage) => {
    let payload: Record<string, unknown> = {};

    if (stage === "authorize") {
      payload = { acknowledged: true };
    }

    if (stage === "confirm") {
      const phrase = readString(payloadOf(sanitize.start), "step2PhraseRequired");

      if (!phrase) {
        setBridgeError("SANITIZE_CONFIRM: SANITIZE_START did not issue a confirmation phrase");
        return;
      }

      payload = { confirmationPhrase: phrase };
    }

    const envelope = await send(SANITIZE_COMMANDS[stage], payload);
    setSanitize((current) => ({ ...current, [stage]: envelope }));
  };

  const runExport = async () => {
    setExported(await send("EXPORT_REPORT", {}));
  };

  const hostConnected = host?.connected === true;
  const scanPayload = payloadOf(scan);
  const scanOk = scan?.status === "OK";

  const preflightPayload = payloadOf(preflight);
  const preflightChecks = readChecks(preflightPayload);
  const preflightReady = readBoolean(preflightPayload, "readyToScan");

  const inventoryPayload = payloadOf(inventory);
  const startPayload = payloadOf(sanitize.start);
  const authorizePayload = payloadOf(sanitize.authorize);
  const confirmPayload = payloadOf(sanitize.confirm);
  const executePayload = payloadOf(sanitize.execute);

  const executeStatus = readString(executePayload, "executionStatus");
  const blocked = executeStatus === "BLOCKED_NOT_IMPLEMENTED";

  const startOk = sanitize.start?.status === "OK";
  const authorizeOk = sanitize.authorize?.status === "OK";
  const confirmOk = sanitize.confirm?.status === "OK";
  const phrase = readString(startPayload, "step2PhraseRequired");

  const exportPayload = payloadOf(exported);
  const reportJsonPath = readString(exportPayload, "reportJsonPath");
  const reportMarkdownPath = readString(exportPayload, "reportMarkdownPath");
  const manifestPath = readString(exportPayload, "manifestPath");

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
    export: exported,
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

  /** Every exchange, for the Engineer diagnostics drawer under Help. */
  const exchanges: { label: string; envelope: HostEnvelope | null }[] = [
    { label: "Workstation check", envelope: preflight },
    { label: "Scan", envelope: scan },
    { label: "Applications", envelope: inventory },
    { label: "Purge guide - start", envelope: sanitize.start },
    { label: "Purge guide - acknowledge", envelope: sanitize.authorize },
    { label: "Purge guide - confirm", envelope: sanitize.confirm },
    { label: "Purge guide - execute", envelope: sanitize.execute },
    { label: "Download", envelope: exported },
  ];

  /**
   * Operator-facing phone connection line, and the phones that are actually
   * ready. Both derive from the Host's device state; nothing here is
   * computed locally or assumed.
   */
  const device = deviceView(deviceState, deviceStateError !== null);
  const readyDevices =
    device.ready && deviceState?.device ? [deviceState.device] : [];
  const readyCount = readyDevices.length;

  /**
   * One-line workstation check. The green check is shown only when the Host
   * both answered OK and reported readyToScan - anything else is a plain
   * starting or failed line, never a success.
   */
  const preflightTone: "ok" | "failed" | "pending" =
    preflight === null
      ? bridgeError !== null || hostError !== null
        ? "failed"
        : "pending"
      : preflight.status === "ERROR" || preflightReady !== true
        ? "failed"
        : "ok";

  const preflightLine =
    preflight === null
      ? preflightTone === "failed"
        ? "Workstation check failed - the workstation engine did not answer."
        : "Workstation check is still starting..."
      : preflight.status === "ERROR"
        ? "Workstation check failed - the workstation reported a problem."
        : preflightReady === true
          ? "Workstation ready - successfully installed."
          : "Workstation check did not pass - ask your engineer to review the diagnostics.";

  const activeMeta = STEPS.find((step) => step.key === activeStep) ?? STEPS[0];
  const activeLock = stepLock[activeStep];

  return (
    <main className="cyvra-app">
      <header className="brand-header">
        <div className="brand-lockup">
          <img className="brand-logo" src={cyvoriqLogo} alt="CYVORIQ Solutions" />
          <div className="brand-titles">
            <span className="brand-product">CYVRA MOBILE</span>
            <span className="brand-vendor">Desktop Workstation</span>
          </div>
        </div>

        <div className={`status-pill ${hostConnected ? "is-online" : "is-starting"}`}>
          <span className="status-dot" />
          {hostConnected ? "HOST CONNECTED" : "STARTING"}
        </div>
      </header>

      <div className="workspace">
        <p className="eyebrow">Connected device inspection &amp; purge</p>

        <p className="workflow-note">
          CYVRA MOBILE inspects the connected Android phone, produces verified device and application reports, and guides the hardware-gated purge - without copying personal content.
        </p>

        {bridgeError && (
          <div className="band band-bridge">
            <strong>BRIDGE FAILURE</strong>
            <span>
              The workstation hit a technical problem and could not finish. Open Help, then
              Engineer diagnostics, for the detail.
            </span>
          </div>
        )}

        <nav className="stepper" aria-label="Workflow stages">
          {STEPS.map((step) => {
            const state = nodeStates[step.key];
            const slug = stateSlug[state];
            const reason = stepLock[step.key];
            const isActive = step.key === activeStep;
            const spinning = stageInFlight(step.key);

            return (
              <button
                key={step.key}
                type="button"
                className={`step-node is-${slug}${isActive ? " is-active" : ""}`}
                aria-current={isActive ? "step" : undefined}
                onClick={() => setActiveStep(step.key)}
              >
                <span className="node-top">
                  {spinning ? (
                    <img className="node-spin" src={cyvoriqLogo} alt="" aria-hidden="true" />
                  ) : (
                    <span className="node-index">{step.index}</span>
                  )}
                  <span className="node-label">{step.label}</span>
                </span>
                <span className={`node-chip is-${slug}`}>{state}</span>
                {reason && <span className="node-reason">{reason}</span>}
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

            {/* Plain-language stage copy: static text, never a result. */}
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

            {/* ---- Step 1 ------------------------------------------------ */}
            {activeStep === "connect" && (
              <>
                <div className={`preflight-line is-${preflightTone}`}>
                  <span className="preflight-mark" aria-hidden="true" />
                  <strong>{preflightLine}</strong>
                </div>

                <Outcome envelope={preflight} />

                <div className="device-panel">
                  <div className="device-main">
                    <span className="card-label">Phone connection</span>
                    <strong className="device-text">{device.text}</strong>
                    {device.ready && (
                      <SerialProvenance id="device-provenance" fromHost value={device.text} />
                    )}
                    {!deviceState?.operatorActionRequired && (
                      <small>No operator action requested</small>
                    )}
                  </div>

                  <div
                    className={`ready-badge${readyCount > 0 ? " is-live" : ""}`}
                    title="Phones ready to scan right now"
                  >
                    <span className="ready-count">{readyCount}</span>
                    <span className="ready-cap">ready</span>
                  </div>
                </div>

                {deviceState?.operatorActionRequired && (
                  <Notice tone="action" label="Operator action">
                    {deviceState.operatorActionRequired}
                  </Notice>
                )}

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void refreshDeviceState()}
                >
                  {activeMeta.primary}
                </button>
              </>
            )}

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
                    <small>Omitted from the payload when blank - the Host applies its default.</small>
                  </label>
                </div>

                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!hostConnected || !serial.trim() || busy !== null}
                  title={lockScan ?? undefined}
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
                    onClick={() => void runSanitize("start")}
                  >
                    {busy === "SANITIZE_START" ? "Working..." : activeMeta.primary}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!startOk || authorizeOk || busy !== null}
                    title={lockAcknowledge ?? undefined}
                    onClick={() => void runSanitize("authorize")}
                  >
                    {busy === "SANITIZE_AUTHORIZE" ? "Working..." : "Acknowledge the warning"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!authorizeOk || !phrase || confirmOk || busy !== null}
                    title={lockConfirm ?? undefined}
                    onClick={() => void runSanitize("confirm")}
                  >
                    {busy === "SANITIZE_CONFIRM" ? "Working..." : "Confirm the purge"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={!confirmOk || busy !== null}
                    title={lockExecute ?? undefined}
                    onClick={() => void runSanitize("execute")}
                  >
                    {busy === "SANITIZE_EXECUTE" ? "Working..." : "Run the purge"}
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

            {/* ---- Step 5 ------------------------------------------------ */}
            {activeStep === "export" && (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!scanOk || busy !== null}
                  title={lockDownload ?? undefined}
                  onClick={() => void runExport()}
                >
                  {busy === "EXPORT_REPORT" ? "Writing..." : activeMeta.primary}
                </button>

                <Outcome envelope={exported} />

                {exported && (
                  <div className="kv-grid">
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
                    The workstation did not report any file locations on this response - check the
                    message above, or open Help and then Engineer diagnostics for the full response.
                  </p>
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
              <li>Work through the five steps above in order. A step unlocks only when the one before it has finished.</li>
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

            <details className="engineer">
              <summary>Engineer diagnostics</summary>
              <p className="hint">
                Raw protocol values. None of this is needed to operate the workstation.
              </p>

              <h3 className="subhead">Host engine and device state</h3>
              <table className="check-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Raw value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>hostConnected</td>
                    <td>{String(hostConnected)}</td>
                  </tr>
                  <tr>
                    <td>hostVersion</td>
                    <td>{host?.hostVersion ?? "-"}</td>
                  </tr>
                  <tr>
                    <td>hostProtocolVersion</td>
                    <td>{host?.protocolVersion ?? "-"}</td>
                  </tr>
                  <tr>
                    <td>hostRequestId</td>
                    <td>{host?.requestId ?? "-"}</td>
                  </tr>
                  <tr>
                    <td>hostError</td>
                    <td>{hostError ?? "-"}</td>
                  </tr>
                  <tr>
                    <td>deviceStateError</td>
                    <td>{deviceStateError ?? "-"}</td>
                  </tr>
                  <tr>
                    <td>bridgeError</td>
                    <td>{bridgeError ?? "-"}</td>
                  </tr>
                  <tr>
                    <td>connectionState</td>
                    <td>{deviceState?.connectionState ?? "-"}</td>
                  </tr>
                  <tr>
                    <td>usbState</td>
                    <td>{deviceState?.usbState ?? "-"}</td>
                  </tr>
                  <tr>
                    <td>adbState</td>
                    <td>{deviceState?.adbState ?? "-"}</td>
                  </tr>
                  <tr>
                    <td>adbAvailable</td>
                    <td>{deviceState ? String(deviceState.adbAvailable) : "-"}</td>
                  </tr>
                  <tr>
                    <td>readyToScan</td>
                    <td>{deviceState ? String(deviceState.readyToScan) : "-"}</td>
                  </tr>
                  <tr>
                    <td>statusMessage</td>
                    <td>{deviceState?.statusMessage ?? "-"}</td>
                  </tr>
                  <tr>
                    <td>operatorActionRequired</td>
                    <td>{deviceState?.operatorActionRequired ?? "-"}</td>
                  </tr>
                  <tr>
                    <td>device.serial</td>
                    <td>{deviceState?.device?.serial ?? "-"}</td>
                  </tr>
                  <tr>
                    <td>device.state</td>
                    <td>{deviceState?.device?.state ?? "-"}</td>
                  </tr>
                </tbody>
              </table>

              <h3 className="subhead">Workstation check</h3>
              {preflightChecks.length > 0 ? (
                <table className="check-table">
                  <thead>
                    <tr>
                      <th>Check</th>
                      <th>Result</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preflightChecks.map((check) => (
                      <tr key={check.checkName}>
                        <td>
                          {check.checkName}
                          {check.isOptional && <span className="tag">optional</span>}
                        </td>
                        <td>
                          <span className={`pill ${check.pass ? "pill-pass" : "pill-fail"}`}>
                            {check.pass ? "PASS" : "FAIL"}
                          </span>
                        </td>
                        <td>{check.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="hint">The workstation check has not returned any rows yet.</p>
              )}

              <h3 className="subhead">Protocol exchanges</h3>
              <table className="check-table">
                <thead>
                  <tr>
                    <th>Exchange</th>
                    <th>Status</th>
                    <th>Request ID</th>
                    <th>Protocol</th>
                    <th>Host</th>
                  </tr>
                </thead>
                <tbody>
                  {exchanges.map(({ label, envelope }) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td>{envelope ? envelope.status : "not requested"}</td>
                      <td>{envelope?.requestId ?? "-"}</td>
                      <td>{envelope ? `v${envelope.protocolVersion}` : "-"}</td>
                      <td>{envelope ? `v${envelope.hostVersion}` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 className="subhead">Decoded responses</h3>
              {exchanges.map(({ label, envelope }) =>
                envelope ? (
                  <div key={label} className="exchange">
                    <span className="card-label">{label}</span>
                    <RawResponse envelope={envelope} />
                  </div>
                ) : null,
              )}
            </details>
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
