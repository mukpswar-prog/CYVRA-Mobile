/**
 * Scan-target binding rules for the workstation UI.
 *
 * A scan binding (`lastScanSerial`) records which phone the Host last scanned
 * successfully. It is presentation state only — the Host never trusts it and
 * enforces its own ownership rules on the wire. Its job here is to stop a
 * stale pointer from being presented as current after:
 *
 *   - a failed scan (the Host clears its own scan state on failure too, so the
 *     UI must not go on claiming a binding the Host no longer has);
 *   - the operator switching to a different phone;
 *   - the bound phone disappearing from the detected inventory (disconnect,
 *     reconnect, or transport re-enumeration invalidates the old binding).
 *
 * The rules live in this pure module so they are unit-testable without
 * rendering the full application. Owner-approved scope: D7 (single active
 * device) and D2 (deterministic refusal / stale-state invalidation).
 */

export type ScanBindingEvent =
  /** A RUN_SCAN answered OK: the binding becomes the scanned phone. */
  | { kind: "scan-succeeded"; scannedSerial: string }
  /** A RUN_SCAN failed or was refused: the binding is cleared outright. */
  | { kind: "scan-failed" }
  /**
   * The surrounding device context changed (selected phone or detected
   * inventory): the existing binding is re-validated or dropped.
   */
  | { kind: "context-changed" };

export interface ScanBindingContext {
  /** The phone the rest of the wizard currently talks about. */
  activeSerial: string;
  /** Serials the Host currently reports as connected. */
  connectedSerials: readonly string[];
}

/**
 * Returns the binding that should replace `current` for the given event, or
 * `null` when no trustworthy binding remains.
 *
 * Conservative by construction: any context it cannot vouch for drops the
 * binding rather than keeping a pointer that may name the wrong phone.
 */
export function nextScanBinding(
  current: string | null,
  event: ScanBindingEvent,
  context?: ScanBindingContext,
): string | null {
  switch (event.kind) {
    case "scan-failed":
      return null;
    case "scan-succeeded":
      return event.scannedSerial.trim() || null;
    case "context-changed": {
      const bound = current === null || current.trim() === "" ? null : current.trim();
      if (bound === null) return null;
      if (!context) return null;
      if (bound !== context.activeSerial.trim()) return null;
      if (!context.connectedSerials.includes(bound)) return null;
      return bound;
    }
  }
}
