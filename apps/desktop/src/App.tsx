import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import cyvoriqLogo from "./assets/cyvoriq-solutions.png";
import { LedgerScreen } from "./ledger/LedgerScreen";
import type { LedgerReadResult } from "./ledger/parseLedger";

/**
 * Commit this bundle was built from, injected by `vite.config.ts`.
 *
 * CI sets `GITHUB_SHA`, so a shipped installer names a real commit; a local
 * build says `development` rather than pretending to be a revision.
 */
declare const __CYVRA_BUILD_COMMIT__: string;

const BUILD_COMMIT: string = __CYVRA_BUILD_COMMIT__;

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

type DeviceView = { text: string; ready: boolean };

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
 * Turns the Host's connection enums into one plain sentence for the operator.
 *
 * The raw enums (NO_DEVICE, USB_DETECTED, ADB_DETECTED, ADB_UNAVAILABLE,
 * ADB_UNAUTHORIZED, ADB_OFFLINE, ADB_READY) and the Host's own diagnostic
 * strings never reach the operator view - no part of the interface renders
 * them. Two rules here are deliberate and
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

  /** Installer version of this build, read from Tauri for the footer line. */
  const [appVersion, setAppVersion] = useState<string | null>(null);

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

  /** Serial of the phone the Host last scanned; the export belongs to it. */
  const [lastScanSerial, setLastScanSerial] = useState<string | null>(null);

  /** Per-phone row state for the device table. Never read from the wire. */
  const [deviceRows, setDeviceRows] = useState<Record<string, DeviceRowState>>({});

  /** Read-only device inventory, refreshed on its own cadence. */
  const [connectedDevices, setConnectedDevices] = useState<ConnectedDevice[]>([]);
  const [adbAvailable, setAdbAvailable] = useState<boolean | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [devicesError, setDevicesError] = useState<string | null>(null);

  /** `GET_LICENSE_STATE` answer, needed before a row's Scan may arm (D-3). */
  const [licensePresent, setLicensePresent] = useState<boolean | null>(null);

  /** Which stage of the wizard is on screen. Navigation only: it gates nothing. */
  const [activeStep, setActiveStep] = useState<StepKey>("connect");

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
  const loadLicense = useCallback(async () => {
    try {
      const raw = await invoke<string>("send_host_command", {
        command: "GET_LICENSE_STATE",
        payload: "{}",
      });

      const envelope = JSON.parse(raw) as HostEnvelope;
      setLicensePresent(
        envelope.status === "OK" && readBoolean(payloadOf(envelope), "present") === true,
      );
    } catch {
      setLicensePresent(null);
    }
  }, []);

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

    const envelope = await send("RUN_SCAN", payload);
    setScan(envelope);

    if (envelope?.status === "OK") {
      setLastScanSerial(scanSerial);
      patchRow(scanSerial, {
        phase: "idle",
        status: "Ok",
        reason: "Scan finished for this phone. The report is ready to review.",
        exportedOk: false,
      });
    } else {
      patchRow(scanSerial, {
        phase: "idle",
        status: "Failed",
        reason: envelopeReason(envelope, ""),
      });
    }

    // A fresh scan invalidates every downstream artifact (the Host clears its
    // sanitization state too); the screen follows rather than showing stale data.
    setInventory(null);
    setSanitize(EMPTY_SANITIZE);
    setExported(null);
    void refreshDevices();
  };

  const loadInventory = async () => {
    const target = (lastScanSerial ?? serial).trim();

    patchRow(target, { phase: "reporting", status: "In progress", reason: "" });

    const envelope = await send("GET_APPLICATION_INVENTORY", {});
    setInventory(envelope);

    patchRow(target, {
      phase: "idle",
      status: envelope?.status === "OK" ? "Ok" : "Failed",
      reason: envelopeReason(envelope, "Application list read for this phone."),
    });
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

    const target = (lastScanSerial ?? serial).trim();

    patchRow(target, { phase: "sanitize", status: "In progress", reason: "" });

    const envelope = await send(SANITIZE_COMMANDS[stage], payload);
    setSanitize((current) => ({ ...current, [stage]: envelope }));

    const accepted = envelope?.status === "OK";

    patchRow(target, {
      // The guide stays the phone's live situation until a new scan replaces it.
      phase: accepted ? "sanitize" : "idle",
      status: accepted ? "Ok" : "Failed",
      reason: envelopeReason(envelope, "The purge guide recorded this step."),
    });
  };

  const runExport = async () => {
    const target = (lastScanSerial ?? serial).trim();

    patchRow(target, { phase: "reporting", status: "In progress", reason: "" });

    const envelope = await send("EXPORT_REPORT", {});
    setExported(envelope);

    if (envelope?.status === "OK") {
      patchRow(target, {
        phase: "exported",
        status: "Ok",
        reason: "Report downloaded for this phone.",
        exportedOk: true,
      });
    } else {
      patchRow(target, {
        phase: "idle",
        status: "Failed",
        reason: envelopeReason(envelope, ""),
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
          : "Workstation check did not pass - read the message below, then run the check again.";

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

    const unfinished = Object.entries(deviceRows).some(
      ([rowSerial, row]) => rowSerial !== device.serial && row.status === "In progress",
    );

    const scanLock =
      device.state === "disconnected"
        ? "This phone's connection dropped. Unplug the data cable and plug it back in."
        : device.state === "unauthorized"
          ? "This phone has not allowed this workstation to inspect it. On the phone, tap ALLOW when it asks to trust this computer."
          : device.state === "detected"
            ? "This phone is still being identified. Wait a moment, then try again."
            : licensePresent !== true
              ? "No licence is installed on this workstation, so a scan cannot start."
              : unfinished
                ? "Another phone's session is still running. Wait for it to finish first."
                : busy !== null
                  ? "The workstation is busy with the current step. Wait for it to finish."
                  : null;

    const reportReady =
      rowState.exportedOk && rowState.status === "Ok" && lastScanSerial === device.serial;

    return { device, number: index + 1, rowState, activeReason, scanLock, reportReady };
  });

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

            <div className="device-badges">
              <span
                className="count-badge"
                title="How many phones this workstation can see over USB/ADB."
              >
                <strong>{connectedPhoneCount}</strong>
                <span>Sensed</span>
              </span>
              <span
                className="count-badge is-authorized"
                title="How many of those phones have allowed this workstation to inspect them."
              >
                <strong>
                  {connectedDevices.filter((device) => device.state === "authorized").length}
                </strong>
                <span>Authorized</span>
              </span>
            </div>
          </div>

          <div className="grid-region" aria-live="polite">
            {devicesLoading && connectedDevices.length === 0 ? (
              <table className="data-grid is-loading">
                <caption className="visually-hidden">Loading connected phones</caption>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">IMEI no</th>
                    <th scope="col">Model/Make</th>
                    <th scope="col">Active</th>
                    <th scope="col" className="col-action">
                      Action (Live Situation)
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">Report</th>
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2].map((placeholder) => (
                    <tr key={placeholder} className="is-skeleton">
                      <td colSpan={7}>
                        <span className="skeleton-bar" aria-hidden="true" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
            ) : deviceRowsView.length === 0 ? (
              <div className="grid-empty">
                <p>No phone is connected to this workstation right now.</p>
                <ul className="list-plain">
                  <li>Connect the data cable to this laptop.</li>
                  <li>Enable USB debugging on the phone (Developer options).</li>
                  <li>Tap ALLOW on the phone when it asks to trust this computer.</li>
                </ul>
              </div>
            ) : (
              <table className="data-grid">
                <caption className="visually-hidden">
                  Connected phones, read from the inspection engine
                </caption>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">IMEI no</th>
                    <th scope="col">Model/Make</th>
                    <th scope="col">Active</th>
                    <th scope="col" className="col-action">
                      Action (Live Situation)
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">Report</th>
                  </tr>
                </thead>
                <tbody>
                  {deviceRowsView.map(
                    ({ device, number, rowState, activeReason, scanLock, reportReady }) => {
                      const situation =
                        rowState.phase === "scanning"
                          ? "Scanning"
                          : rowState.phase === "reporting"
                            ? "Reporting"
                            : rowState.phase === "sanitize"
                              ? "Sanitize guide"
                              : rowState.phase === "exported"
                                ? "Exported"
                                : "Idle";

                      const model = device.model?.trim();
                      const make = device.make?.trim();
                      const imei = device.imei?.trim();
                      const modelMake = [model, make].filter(Boolean).join(" / ");

                      return (
                        <tr
                          key={device.serial}
                          className={activeReason ? "is-inactive" : undefined}
                        >
                          <td className="col-index">{number}</td>
                          <td>
                            {imei ?? (
                              <span className="not-reported" title={device.imeiReason}>
                                Not reported
                              </span>
                            )}
                          </td>
                          <td>
                            {modelMake || (
                              <span className="not-reported">Not reported</span>
                            )}
                          </td>
                          <td>
                            {activeReason ? (
                              <>
                                <span className="yesno is-no">No</span>
                                <span className="cell-reason">{activeReason}</span>
                              </>
                            ) : (
                              <span className="yesno is-yes">Yes</span>
                            )}
                          </td>
                          <td className="col-action">
                            <span className="situation">{situation}</span>
                            {situation === "Idle" && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-compact"
                                disabled={scanLock !== null}
                                title={scanLock ?? `Scan ${device.serial}`}
                                aria-label={`Scan phone ${device.serial}`}
                                onClick={() => void runScan(device.serial)}
                              >
                                Scan
                              </button>
                            )}
                          </td>
                          <td>
                            <span className={`row-status is-${rowState.status.toLowerCase().replace(" ", "-")}`}>
                              {rowState.status}
                            </span>
                            {rowState.reason && (
                              <span className="cell-reason">{rowState.reason}</span>
                            )}
                          </td>
                          <td className="col-action">
                            <button
                              type="button"
                              className="btn btn-secondary btn-compact"
                              disabled={!reportReady}
                              title={
                                reportReady
                                  ? "Download this phone's report"
                                  : "A report is downloadable only after this phone's export finished successfully."
                              }
                              aria-label={`Download report for phone ${device.serial}`}
                              onClick={() => void runExport()}
                            >
                              Download
                            </button>
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            )}
          </div>
        </section>

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
                aria-label={`Step ${step.index}: ${step.label}`}
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
                  aria-label={activeMeta.primary}
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
                  aria-label={busy === "EXPORT_REPORT" ? "Writing..." : activeMeta.primary}
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
                    The workstation did not report any file locations on this response - read the
                    message above, then try the download again.
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
