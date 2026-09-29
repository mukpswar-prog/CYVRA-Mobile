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
 * Stepper navigation for the five protocol stages.
 *
 * `label` and `heading` are interface chrome - they name the stage, they do
 * not describe any result. Every value shown *inside* a stage still comes
 * from a Host response.
 */
const STEPS: { key: StepKey; index: number; label: string; heading: string }[] = [
  { key: "connect", index: 1, label: "Connect", heading: "Connect / Preflight" },
  { key: "scan", index: 2, label: "Scan", heading: "Run Scan" },
  { key: "inventory", index: 3, label: "Inventory", heading: "View Inventory" },
  { key: "sanitize", index: 4, label: "Sanitize", heading: "Sanitization Flow" },
  { key: "export", index: 5, label: "Export", heading: "Export" },
];

/** Chip shown on a stepper node. Priority: locked > active > complete > ready. */
type NodeTone = "locked" | "active" | "complete" | "ready";

/** Tone of the per-stage status chip in the card header. */
type StepTone = "ok" | "error" | "idle" | "blocked";

type StepStatus = { label: string; tone: StepTone };

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
        <small>
          Request {envelope.requestId} | protocol v{envelope.protocolVersion} | host v
          {envelope.hostVersion}
        </small>
      </div>
    );
  }

  return (
    <div className="band band-ok">
      <strong>OK</strong>
      <small>
        Request {envelope.requestId} | protocol v{envelope.protocolVersion} | host v
        {envelope.hostVersion}
      </small>
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
   * Stepper state. These are the same predicates the buttons already use to
   * disable themselves - they are read, not re-implemented, so the wizard can
   * never permit something the protocol layer refuses.
   */
  const stepStatus: Record<StepKey, StepStatus> = {
    connect: hostConnected
      ? { label: "CONNECTED", tone: "ok" }
      : hostError
        ? { label: "UNAVAILABLE", tone: "error" }
        : { label: "STARTING", tone: "idle" },
    scan: scanOk
      ? { label: "COMPLETED", tone: "ok" }
      : scan
        ? { label: "REFUSED", tone: "error" }
        : { label: "NOT RUN", tone: "idle" },
    inventory:
      inventory?.status === "OK"
        ? { label: "LOADED", tone: "ok" }
        : inventory
          ? { label: "REFUSED", tone: "error" }
          : { label: "NOT RUN", tone: "idle" },
    sanitize: blocked
      ? { label: "BLOCKED (D-1)", tone: "blocked" }
      : executePayload
        ? { label: "EXECUTED", tone: "ok" }
        : confirmOk
          ? { label: "CONFIRMED", tone: "ok" }
          : authorizeOk
            ? { label: "ACKNOWLEDGED", tone: "ok" }
            : startOk
              ? { label: "STARTED", tone: "ok" }
              : { label: "NOT RUN", tone: "idle" },
    export:
      exported?.status === "OK"
        ? { label: "WRITTEN", tone: "ok" }
        : exported
          ? { label: "REFUSED", tone: "error" }
          : { label: "NOT RUN", tone: "idle" },
  };

  const stepComplete: Record<StepKey, boolean> = {
    connect: hostConnected,
    scan: scanOk,
    inventory: inventory?.status === "OK",
    sanitize: confirmOk,
    export: exported?.status === "OK",
  };

  /**
   * Why a stage cannot run yet. The strings are the ones the screen already
   * showed next to the disabled button; they are surfaced on the stepper so a
   * locked stage always states its reason instead of silently staying dark.
   */
  const stepLock: Record<StepKey, string | null> = {
    connect: null,
    scan: hostConnected ? null : "The Host is not connected yet.",
    inventory: scanOk ? null : "Complete a scan first.",
    sanitize: scanOk ? null : "Complete a scan first.",
    export: scanOk ? null : "Complete a scan first.",
  };

  const nodeTone = (key: StepKey): NodeTone => {
    if (stepLock[key] !== null) {
      return "locked";
    }
    if (key === activeStep) {
      return "active";
    }
    if (stepComplete[key]) {
      return "complete";
    }
    return "ready";
  };

  const activeMeta = STEPS.find((step) => step.key === activeStep) ?? STEPS[0];
  const activeStatus = stepStatus[activeStep];
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
          Every value on this screen is returned by the Kotlin Host over the JSON-lines protocol.
          Nothing here is generated locally: if the Host refuses, blocks or reports no data, that
          is exactly what is shown.
        </p>

        {bridgeError && (
          <div className="band band-bridge">
            <strong>BRIDGE FAILURE</strong>
            <span>{bridgeError}</span>
          </div>
        )}

        <nav className="stepper" aria-label="Workflow stages">
          {STEPS.map((step) => {
            const tone = nodeTone(step.key);
            const reason = stepLock[step.key];
            const isActive = step.key === activeStep;
            const chipText =
              tone === "locked"
                ? "LOCKED"
                : tone === "active"
                  ? "ACTIVE"
                  : tone === "complete"
                    ? "COMPLETE"
                    : "READY";

            return (
              <button
                key={step.key}
                type="button"
                className={`step-node is-${tone}`}
                aria-current={isActive ? "step" : undefined}
                onClick={() => setActiveStep(step.key)}
              >
                <span className="node-top">
                  <span className="node-index">{step.index}</span>
                  <span className="node-label">{step.label}</span>
                </span>
                <span className={`node-chip is-${tone}`}>{chipText}</span>
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
            <span className={`step-state is-${activeStatus.tone}`}>{activeStatus.label}</span>
          </div>

          <div className="step-body">
            {activeLock && (
              <Notice tone="gate" label="Stage locked">
                {activeLock}
              </Notice>
            )}

            {/* ---- Step 1 ------------------------------------------------ */}
            {activeStep === "connect" && (
              <>
                <div className="kv-grid">
                  <div className="kv">
                    <span className="card-label">Host engine</span>
                    <strong>
                      {hostConnected ? (
                        <>Connected | V{host?.hostVersion}</>
                      ) : hostError ? (
                        "Connection failed"
                      ) : (
                        "Starting Host Engine"
                      )}
                    </strong>
                    {hostError && <small>{hostError}</small>}
                  </div>

                  <div className="kv">
                    <span className="card-label">Host preflight</span>
                    <strong>
                      {preflightReady === null
                        ? "Awaiting GET_PREFLIGHT"
                        : `readyToScan = ${String(preflightReady)}`}
                    </strong>
                    <small>GET_PREFLIGHT | {preflight?.requestId ?? "not requested"}</small>
                  </div>
                </div>

                {preflightChecks.length > 0 && (
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
                )}

                <Outcome envelope={preflight} />
                <RawResponse envelope={preflight} />

                <div className="kv-grid">
                  <div className="kv">
                    <span className="card-label">Device connection</span>
                    <strong>
                      <Value value={deviceState?.connectionState ?? null} fallback="Not evaluated" />
                    </strong>
                    <small>
                      {deviceState ? (
                        <>
                          USB {deviceState.usbState} | ADB {deviceState.adbState} | serial{" "}
                          {deviceState.device?.serial ?? "not reported"}
                        </>
                      ) : (
                        deviceStateError ?? "get_device_state not completed"
                      )}
                    </small>
                  </div>

                  <div className="kv">
                    <span className="card-label">Host status message</span>
                    <strong>
                      <Value value={deviceState?.statusMessage ?? null} fallback="-" />
                    </strong>
                    {!deviceState?.operatorActionRequired && (
                      <small>No operator action requested</small>
                    )}
                  </div>
                </div>

                {deviceState?.operatorActionRequired && (
                  <Notice tone="action" label="Operator action">
                    {deviceState.operatorActionRequired}
                  </Notice>
                )}

                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void refreshDeviceState()}
                >
                  Refresh device state
                </button>
              </>
            )}

            {/* ---- Step 2 ------------------------------------------------ */}
            {activeStep === "scan" && (
              <>
                <div className="field-row">
                  <label className="field">
                    <span>Target device serial</span>
                    <input
                      value={serial}
                      onChange={(event) => {
                        setSerial(event.target.value);
                        setSerialFromHost(false);
                      }}
                      placeholder="No serial reported by the Host"
                      aria-describedby="serial-provenance"
                    />
                    <small id="serial-provenance">
                      {serialFromHost
                        ? "Reported by the Host from the connected device"
                        : serial
                          ? "Entered by the operator"
                          : "The Host has not reported a device serial - connect and authorize a device, then refresh"}
                    </small>
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
                  onClick={() => void runScan()}
                >
                  {busy === "RUN_SCAN" ? "Scanning..." : "Run scan"}
                </button>

                {hostConnected && !serial.trim() && (
                  <p className="hint">
                    No serial available: the Host has not reported a device, and this UI will not
                    make one up.
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

                <RawResponse envelope={scan} />
              </>
            )}

            {/* ---- Step 3 ------------------------------------------------ */}
            {activeStep === "inventory" && (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!scanOk || busy !== null}
                  onClick={() => void loadInventory()}
                >
                  {busy === "GET_APPLICATION_INVENTORY" ? "Loading..." : "Load inventory"}
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

                <RawResponse envelope={inventory} />
              </>
            )}

            {/* ---- Step 4 ------------------------------------------------ */}
            {activeStep === "sanitize" && (
              <>
                <div className="action-row">
                  <button
                    type="button"
                    className="btn"
                    disabled={!scanOk || startOk || busy !== null}
                    onClick={() => void runSanitize("start")}
                  >
                    {busy === "SANITIZE_START" ? "..." : "SANITIZE_START"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!startOk || authorizeOk || busy !== null}
                    onClick={() => void runSanitize("authorize")}
                  >
                    {busy === "SANITIZE_AUTHORIZE" ? "..." : "SANITIZE_AUTHORIZE"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!authorizeOk || !phrase || confirmOk || busy !== null}
                    onClick={() => void runSanitize("confirm")}
                  >
                    {busy === "SANITIZE_CONFIRM" ? "..." : "SANITIZE_CONFIRM"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={!confirmOk || busy !== null}
                    onClick={() => void runSanitize("execute")}
                  >
                    {busy === "SANITIZE_EXECUTE" ? "..." : "SANITIZE_EXECUTE"}
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
                      <small>Supplied back to SANITIZE_CONFIRM verbatim - never typed here.</small>
                    </div>
                  </div>
                )}
                <RawResponse envelope={sanitize.start} />

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
                <RawResponse envelope={sanitize.authorize} />

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
                <RawResponse envelope={sanitize.confirm} />

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

                <RawResponse envelope={sanitize.execute} />

                {confirmOk && !executePayload && (
                  <p className="hint">
                    Ready to execute. SANITIZE_EXECUTE reports the Host&apos;s decision; this screen
                    will show whatever it returns.
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
                  onClick={() => void runExport()}
                >
                  {busy === "EXPORT_REPORT" ? "Writing..." : "Export report"}
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
                    The Host did not report any artifact paths on this response - check the refusal
                    above or the decoded response below.
                  </p>
                )}

                <RawResponse envelope={exported} />
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
