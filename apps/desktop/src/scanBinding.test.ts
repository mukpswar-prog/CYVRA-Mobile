import { describe, expect, it } from "vitest";

import { nextScanBinding } from "./scanBinding";

/**
 * Owner-approved D7/D2 scope: the UI's scan-target binding may never present
 * a stale target as current.
 *
 * The three mandated invalidation events are covered directly:
 *   - a failed scan clears the binding outright;
 *   - switching to a different phone invalidates the previous binding;
 *   - the bound phone leaving the detected inventory (disconnect/reconnect)
 *     invalidates the binding even when the selected phone did not change.
 *
 * The positive cases pin that a valid binding is NOT dropped by a routine
 * inventory refresh, so the invalidation cannot become background churn.
 */
describe("nextScanBinding", () => {
  const context = (activeSerial: string, connectedSerials: string[]) => ({
    activeSerial,
    connectedSerials,
  });

  it("clears the binding after a failed scan, regardless of any prior state", () => {
    expect(nextScanBinding("SERIAL-A", { kind: "scan-failed" })).toBeNull();
    expect(nextScanBinding(null, { kind: "scan-failed" })).toBeNull();
  });

  it("records the scanned phone as the binding after a successful scan", () => {
    expect(
      nextScanBinding("SERIAL-A", { kind: "scan-succeeded", scannedSerial: "SERIAL-B" }),
    ).toBe("SERIAL-B");
    // A blank scan serial cannot become a binding.
    expect(
      nextScanBinding(null, { kind: "scan-succeeded", scannedSerial: "   " }),
    ).toBeNull();
  });

  it("keeps a binding that still matches the active, connected phone", () => {
    expect(
      nextScanBinding("SERIAL-A", { kind: "context-changed" }, context("SERIAL-A", ["SERIAL-A"])),
    ).toBe("SERIAL-A");
  });

  it("invalidates the binding when the operator switches to a different phone", () => {
    expect(
      nextScanBinding(
        "SERIAL-A",
        { kind: "context-changed" },
        context("SERIAL-B", ["SERIAL-A", "SERIAL-B"]),
      ),
    ).toBeNull();
  });

  it("invalidates the binding when the bound phone is no longer connected", () => {
    // Disconnect (and a later reconnect as a fresh device event) must drop the
    // old binding: it cannot be presented as current for a phone that is gone.
    expect(
      nextScanBinding("SERIAL-A", { kind: "context-changed" }, context("SERIAL-A", [])),
    ).toBeNull();
  });

  it("invalidates a binding it cannot vouch for (no context supplied)", () => {
    expect(nextScanBinding("SERIAL-A", { kind: "context-changed" })).toBeNull();
  });

  it("is a no-op when there is no binding to re-validate", () => {
    expect(
      nextScanBinding(null, { kind: "context-changed" }, context("SERIAL-A", ["SERIAL-A"])),
    ).toBeNull();
    // Whitespace-only legacy state is treated as absent, never as a serial.
    expect(
      nextScanBinding("  ", { kind: "context-changed" }, context("", [""])),
    ).toBeNull();
  });

  it("tolerates surrounding whitespace so a trimmed serial still matches", () => {
    expect(
      nextScanBinding(
        " SERIAL-A ",
        { kind: "context-changed" },
        context("SERIAL-A ", ["SERIAL-A"]),
      ),
    ).toBe("SERIAL-A");
  });
});
