import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { invokeMock, getVersionMock } = vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__CYVRA_BUILD_COMMIT__ = "70afcf7";
  return {
    invokeMock: vi.fn(),
    getVersionMock: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: getVersionMock }));

import App from "./App";

function hostEnvelope(
  command: string,
  status: "OK" | "ERROR",
  payload: Record<string, unknown> = {},
  errorMessage?: string,
): string {
  return JSON.stringify({
    protocolVersion: 1,
    requestId: `req-${command}`,
    command,
    status,
    payload,
    error: status === "ERROR" ? { code: "REFUSED", message: errorMessage ?? "Refused" } : null,
  });
}

describe("App desktop scan-to-seal workflow", () => {
  it("describes the six-stage workflow and actual step unlock rules in Help", async () => {
    getVersionMock.mockResolvedValue("1.1.0");
    invokeMock.mockImplementation(async (cmd: string, args?: { command?: string }) => {
      if (cmd === "get_host_info") {
        return {
          workstationName: "CYVRA-WS",
          version: "1.1.0",
          connected: true,
          protocolVersion: 1,
          jarPath: "host.jar",
        };
      }
      if (cmd === "get_device_state") {
        return { device: { serial: "RF8R123456" }, raw: "{}" };
      }
      if (cmd === "send_host_command") {
        const hostCmd = args?.command ?? "";
        if (hostCmd === "GET_PREFLIGHT") {
          return hostEnvelope("GET_PREFLIGHT", "OK", { readyToScan: true });
        }
        if (hostCmd === "GET_CONNECTED_DEVICES") {
          return hostEnvelope("GET_CONNECTED_DEVICES", "OK", {
            adbAvailable: true,
            devices: [
              {
                serial: "RF8R123456",
                adbState: "device",
                connectionStatus: "READY_TO_SCAN",
                model: "SM-A525F",
              },
            ],
          });
        }
        if (hostCmd === "GET_LICENSE_STATE") {
          return hostEnvelope("GET_LICENSE_STATE", "OK", { present: true });
        }
      }
      return "{}";
    });

    render(<App />);

    expect(
      await screen.findByText(
        /The workflow has six stages: Step 1 \(Connect\) is tracked live per slot/i,
      ),
    ).toBeInTheDocument();
  }, 20_000);

  it("exposes Operator ID on Step 6 (Download) to unblock FINALISE_REPORT and clears sealed state on a new scan", async () => {
    let scanShouldSucceed = true;
    getVersionMock.mockResolvedValue("1.1.0");
    invokeMock.mockImplementation(
      async (cmd: string, args?: { command?: string; payload?: string }) => {
        if (cmd === "get_host_info") {
          return {
            workstationName: "CYVRA-WS",
            version: "1.1.0",
            connected: true,
            protocolVersion: 1,
            jarPath: "host.jar",
          };
        }
        if (cmd === "get_device_state") {
          return { device: { serial: "RF8R123456" }, raw: "{}" };
        }
        if (cmd === "send_host_command") {
          const hostCmd = args?.command ?? "";
          if (hostCmd === "GET_PREFLIGHT") {
            return hostEnvelope("GET_PREFLIGHT", "OK", { readyToScan: true });
          }
          if (hostCmd === "GET_CONNECTED_DEVICES") {
            return hostEnvelope("GET_CONNECTED_DEVICES", "OK", {
              adbAvailable: true,
              devices: [
                {
                  serial: "RF8R123456",
                  adbState: "device",
                  connectionStatus: "READY_TO_SCAN",
                  model: "SM-A525F",
                },
              ],
            });
          }
          if (hostCmd === "GET_LICENSE_STATE") {
            return hostEnvelope("GET_LICENSE_STATE", "OK", { present: true });
          }
          if (hostCmd === "RUN_SCAN") {
            if (scanShouldSucceed) {
              return hostEnvelope("RUN_SCAN", "OK", {
                sessionUuid: "11111111-2222-4333-8444-555555555555",
                enumerationCompleteness: "COMPLETE",
              });
            }
            return hostEnvelope("RUN_SCAN", "ERROR", {}, "Device disconnected mid-scan");
          }
          if (hostCmd === "FINALISE_REPORT") {
            const parsed = JSON.parse(args?.payload ?? "{}") as { operatorId?: string };
            return hostEnvelope("FINALISE_REPORT", "OK", {
              operatorId: parsed.operatorId,
              sealDigest: "sha256-deadbeefcafe",
              reportJsonPath: "C:\\cyvra\\reports\\final-report.json",
              zipPath: "C:\\cyvra\\reports\\final-report.zip",
            });
          }
        }
        return "{}";
      },
    );

    render(<App />);

    // Wait for host connection and serial adoption so "Scan phone" is enabled
    const runScanBtn = await screen.findByText("Scan phone");
    await waitFor(() => expect(runScanBtn).not.toBeDisabled());

    // Run initial scan without entering Operator ID in Step 2
    fireEvent.click(runScanBtn);

    // Wait for scan completion and navigate to Step 6 (Download)
    await screen.findByText("11111111-2222-4333-8444-555555555555");
    const downloadStepTab = screen
      .getByText("Download", { selector: ".stage-tab-label" })
      .closest("button")!;
    fireEvent.click(downloadStepTab);

    // On Step 6, "Finalise and seal the report" is disabled while Operator ID is blank,
    // and the Operator ID input is present directly on Step 6.
    const finaliseBtn = screen.getByText("Finalise and seal the report");
    expect(finaliseBtn).toBeDisabled();

    const step6OperatorInput = screen.getByPlaceholderText(
      "Name or ID of the authorising operator",
    );
    fireEvent.change(step6OperatorInput, { target: { value: "tech.operator@cyvoriq.com" } });
    expect(finaliseBtn).not.toBeDisabled();

    // Seal the report
    fireEvent.click(finaliseBtn);

    expect(await screen.findByText("sha256-deadbeefcafe")).toBeInTheDocument();

    // Now return to Step 2 (Scan) and run a subsequent scan that fails:
    // the previous scan's sealed report digest must be cleared immediately.
    scanShouldSucceed = false;
    const scanStepTab = screen
      .getByText("Scan", { selector: ".stage-tab-label" })
      .closest("button")!;
    fireEvent.click(scanStepTab);

    const runScanAgainBtn = screen.getByText("Scan phone");
    fireEvent.click(runScanAgainBtn);

    expect(await screen.findByText(/Device disconnected mid-scan/i)).toBeInTheDocument();

    expect(screen.queryByText("sha256-deadbeefcafe")).not.toBeInTheDocument();
  }, 45_000);

  it("renders concise H/W SCN, App SCN, SAN, VER headers, separate per-device Download Report buttons, and independent multi-device controls", async () => {
    const sentCommands: Array<{ command: string; payload: Record<string, unknown> }> = [];

    getVersionMock.mockResolvedValue("0.1.0");
    invokeMock.mockImplementation(
      async (cmd: string, args?: { command?: string; payload?: string }) => {
        if (cmd === "get_host_info") {
          return {
            connected: true,
            protocolVersion: "1.0",
            requestId: "init-1",
            hostVersion: "0.1.0",
          };
        }
        if (cmd === "get_device_state") {
          return {
            connectionState: "READY",
            usbState: "CONNECTED",
            adbState: "AUTHORIZED",
            adbAvailable: true,
            readyToScan: true,
            statusMessage: "Ready",
            operatorActionRequired: null,
            device: { serial: "RF8R123456", state: "device", model: "Pixel_7" },
          };
        }
        if (cmd === "send_host_command") {
          const hostCmd = args?.command ?? "";
          const parsedPayload = JSON.parse(args?.payload ?? "{}") as Record<string, unknown>;
          sentCommands.push({ command: hostCmd, payload: parsedPayload });

          if (hostCmd === "GET_PREFLIGHT") {
            return hostEnvelope("GET_PREFLIGHT", "OK", { readyToScan: true });
          }
          if (hostCmd === "GET_CONNECTED_DEVICES") {
            return hostEnvelope("GET_CONNECTED_DEVICES", "OK", {
              adbAvailable: true,
              devices: [
                { serial: "RF8R123456", state: "authorized", model: "Pixel 7", make: "Google" },
                { serial: "RF8R999888", state: "authorized", model: "Galaxy S23", make: "Samsung" },
              ],
            });
          }
          if (hostCmd === "GET_LICENSE_STATE") {
            return hostEnvelope("GET_LICENSE_STATE", "OK", {
              present: true,
              status: "VALID",
              scansRemaining: 48,
            });
          }
          if (hostCmd === "RUN_SCAN") {
            const serial = String(parsedPayload.serial ?? "RF8R123456");
            return hostEnvelope("RUN_SCAN", "OK", {
              sessionUuid:
                serial === "RF8R123456"
                  ? "11111111-2222-4333-8444-555555555555"
                  : "99999999-2222-4333-8444-555555555555",
              serial,
              enumerationCompleteness: "COMPLETE",
              packageCount: serial === "RF8R123456" ? 12 : 24,
            });
          }
          if (hostCmd === "GET_APPLICATION_INVENTORY") {
            const serial = String(parsedPayload.serial ?? "RF8R123456");
            return hostEnvelope("GET_APPLICATION_INVENTORY", "OK", {
              sessionUuid:
                serial === "RF8R123456"
                  ? "11111111-2222-4333-8444-555555555555"
                  : "99999999-2222-4333-8444-555555555555",
              enumerationCompleteness: "COMPLETE",
              packageCount: serial === "RF8R123456" ? 12 : 24,
              packages: [],
            });
          }
          if (hostCmd === "EXPORT_REPORT") {
            const serial = String(parsedPayload.serial ?? "RF8R123456");
            return hostEnvelope("EXPORT_REPORT", "OK", {
              reportJsonPath: `C:\\cyvra\\reports\\${serial}\\report.json`,
              reportMarkdownPath: `C:\\cyvra\\reports\\${serial}\\report.md`,
              manifestPath: `C:\\cyvra\\reports\\${serial}\\manifest.json`,
            });
          }
        }
        return "{}";
      },
    );

    render(<App />);

    // Verify exact concise column headers and absence of Model / Make and Down-load columns
    expect((await screen.findAllByText("H/W SCN")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("App SCN").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("SAN").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("VER").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Report").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Model / Make")).not.toBeInTheDocument();
    expect(screen.queryByText(/Down-\s*load/i)).not.toBeInTheDocument();

    // Initially, both CYVRA.01 and CYVRA.02 have their own Download Report button disabled
    const slot1DownloadBtn = await screen.findByLabelText(
      "Download Report for CYVRA.01",
      {},
      { timeout: 10_000 },
    );
    const slot2DownloadBtn = await screen.findByLabelText(
      "Download Report for CYVRA.02",
      {},
      { timeout: 10_000 },
    );
    expect(slot1DownloadBtn).toBeDisabled();
    expect(slot2DownloadBtn).toBeDisabled();

    // Trigger H/W SCN directly from CYVRA.01 row
    const slot1HwScanBtn = screen.getByLabelText(/CYVRA\.01 H\/W SCN:/i);
    await waitFor(() => expect(slot1HwScanBtn).not.toBeDisabled(), { timeout: 10_000 });
    fireEvent.click(slot1HwScanBtn);

    // CYVRA.01 Download Report becomes enabled while CYVRA.02 remains disabled
    await waitFor(() => expect(slot1DownloadBtn).not.toBeDisabled(), { timeout: 10_000 });
    expect(slot2DownloadBtn).toBeDisabled();

    // Trigger H/W SCN directly from CYVRA.02 row
    const slot2HwScanBtn = screen.getByLabelText(/CYVRA\.02 H\/W SCN:/i);
    fireEvent.click(slot2HwScanBtn);

    // Both CYVRA.01 and CYVRA.02 now have independent Download Report buttons enabled
    await waitFor(() => expect(slot2DownloadBtn).not.toBeDisabled(), { timeout: 10_000 });
    expect(slot1DownloadBtn).not.toBeDisabled();

    // Download Report for CYVRA.01 specifically passes serial RF8R123456
    fireEvent.click(slot1DownloadBtn);
    await waitFor(
      () =>
        expect(
          sentCommands.some(
            (entry) => entry.command === "EXPORT_REPORT" && entry.payload.serial === "RF8R123456",
          ),
        ).toBe(true),
      { timeout: 10_000 },
    );

    // Open User ID & Licence Key dialog from header pill
    const licenseBtn = screen.getByLabelText("Open User ID and Licence Key activation dialog");
    fireEvent.click(licenseBtn);
    expect(await screen.findByText(/Workstation User ID & Serial Key/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Registered User ID (email)")).toBeInTheDocument();
    expect(screen.getByLabelText("Licence Key")).toBeInTheDocument();
  }, 45_000);

  it("supports simultaneous in-flight scans across devices and gates SANITIZE_CONFIRM on both H/W SCN and App SCN", async () => {
    const sentCommands: Array<{ command: string; payload: Record<string, unknown> }> = [];
    const scan1Deferred: { resolve?: (val: string) => void } = {};

    getVersionMock.mockResolvedValue("0.1.0");
    invokeMock.mockImplementation(
      async (cmd: string, args?: { command?: string; payload?: string }) => {
        if (cmd === "get_host_info") {
          return {
            connected: true,
            protocolVersion: "1.0",
            requestId: "init-1",
            hostVersion: "0.1.0",
          };
        }
        if (cmd === "get_device_state") {
          return {
            connectionState: "READY",
            usbState: "CONNECTED",
            adbState: "AUTHORIZED",
            adbAvailable: true,
            readyToScan: true,
            statusMessage: "Ready",
            operatorActionRequired: null,
            device: { serial: "RF8R123456", state: "device", model: "Pixel_7" },
          };
        }
        if (cmd === "send_host_command") {
          const hostCmd = args?.command ?? "";
          const parsedPayload = JSON.parse(args?.payload ?? "{}") as Record<string, unknown>;
          sentCommands.push({ command: hostCmd, payload: parsedPayload });

          if (hostCmd === "GET_PREFLIGHT") {
            return hostEnvelope("GET_PREFLIGHT", "OK", { readyToScan: true });
          }
          if (hostCmd === "GET_CONNECTED_DEVICES") {
            return hostEnvelope("GET_CONNECTED_DEVICES", "OK", {
              adbAvailable: true,
              devices: [
                { serial: "RF8R123456", state: "authorized", model: "Pixel 7", make: "Google" },
                { serial: "RF8R999888", state: "authorized", model: "Galaxy S23", make: "Samsung" },
              ],
            });
          }
          if (hostCmd === "GET_LICENSE_STATE") {
            return hostEnvelope("GET_LICENSE_STATE", "OK", {
              present: true,
              status: "VALID",
              scansRemaining: 10,
            });
          }
          if (hostCmd === "RUN_SCAN") {
            const serial = String(parsedPayload.serial ?? "");
            if (serial === "RF8R123456") {
              // Hold Device 1 scan in-flight so Device 2 can be launched concurrently
              return await new Promise<string>((resolve) => {
                scan1Deferred.resolve = resolve;
              });
            }
            return hostEnvelope("RUN_SCAN", "OK", {
              sessionUuid: "99999999-2222-4333-8444-555555555555",
              serial,
              enumerationCompleteness: "COMPLETE",
              packageCount: 24,
              hwReportGenerated: true,
              pdfPath: "C:\\Users\\User\\Downloads\\CYVRA\\CYVRA_001_RF8R999888-99999999_HW_SCAN_20261024-210000.pdf",
            });
          }
          if (hostCmd === "GET_APPLICATION_INVENTORY") {
            const serial = String(parsedPayload.serial ?? "");
            return hostEnvelope("GET_APPLICATION_INVENTORY", "OK", {
              sessionUuid:
                serial === "RF8R123456"
                  ? "11111111-2222-4333-8444-555555555555"
                  : "99999999-2222-4333-8444-555555555555",
              enumerationCompleteness: "COMPLETE",
              packageCount: 24,
              packages: [],
              appReportGenerated: true,
              pdfPath: "C:\\Users\\User\\Downloads\\CYVRA\\CYVRA_002_RF8R999888-99999999_APP_SCAN_20261024-210001.pdf",
            });
          }
          if (hostCmd === "SANITIZE_START") {
            const serial = String(parsedPayload.serial ?? "");
            return hostEnvelope("SANITIZE_START", "OK", {
              serial,
              step2PhraseRequired: `SANITIZE ${serial}`,
            });
          }
          if (hostCmd === "SANITIZE_AUTHORIZE") {
            const serial = String(parsedPayload.serial ?? "");
            return hostEnvelope("SANITIZE_AUTHORIZE", "OK", {
              serial,
              workflowMode: "CONSOLIDATED_SANITIZE_AUTHORIZE",
              executionStatus: "EXECUTION_SUCCEEDED",
              verificationCompleted: true,
              sanitizationAuditReportGenerated: true,
              sessionDisconnected: true,
              pdfPath: `C:\\Users\\User\\Downloads\\CYVRA\\CYVRA_003_${serial}-99999999_SANITIZATION_AUDIT_20261024-210002.pdf`,
            });
          }
        }
        return "{}";
      },
    );

    render(<App />);

    await screen.findByText(/LICENCE: ACTIVE/i, {}, { timeout: 10_000 });
    const slot2SanConfirmBtn = await screen.findByLabelText("SANITIZE_CONFIRM for CYVRA.02", {}, { timeout: 10_000 });
    const slot1HwBtn = screen.getByLabelText(/CYVRA\.01 H\/W SCN:/i);
    const slot2HwBtn = screen.getByLabelText(/CYVRA\.02 H\/W SCN:/i);

    await waitFor(() => expect(slot1HwBtn).not.toBeDisabled(), { timeout: 10_000 });
    expect(slot2SanConfirmBtn).toBeDisabled();

    // 1. Start H/W SCN on CYVRA.01 (remains in flight)
    fireEvent.click(slot1HwBtn);
    await waitFor(() => expect(scan1Deferred.resolve).toBeDefined(), { timeout: 10_000 });

    // 2. While CYVRA.01 is scanning in flight, CYVRA.02 H/W SCN must NOT be disabled!
    expect(slot2HwBtn).not.toBeDisabled();
    fireEvent.click(slot2HwBtn);

    // CYVRA.02 completes out-of-order while CYVRA.01 is still in flight
    const slot2DownloadBtn = screen.getByLabelText("Download Report for CYVRA.02");
    await waitFor(() => expect(slot2DownloadBtn).not.toBeDisabled(), { timeout: 10_000 });

    // SANITIZE_CONFIRM for CYVRA.02 is still disabled until App SCN also completes
    expect(slot2SanConfirmBtn).toBeDisabled();

    // 3. Run App SCN on CYVRA.02
    const slot2AppBtn = screen.getByLabelText(/CYVRA\.02 App SCN:/i);
    fireEvent.click(slot2AppBtn);

    // Once both H/W SCN and App SCN have completed for CYVRA.02, SANITIZE_CONFIRM for CYVRA.02 becomes enabled
    await waitFor(() => expect(slot2SanConfirmBtn).not.toBeDisabled(), { timeout: 10_000 });

    // 4. Click SANITIZE_CONFIRM for CYVRA.02 and verify consolidated SANITIZE_AUTHORIZE is sent for RF8R999888
    fireEvent.click(slot2SanConfirmBtn);
    await waitFor(
      () =>
        expect(
          sentCommands.some(
            (c) =>
              c.command === "SANITIZE_AUTHORIZE" &&
              c.payload.serial === "RF8R999888" &&
              c.payload.consolidated === true &&
              c.payload.confirmationPhrase === "SANITIZE RF8R999888",
          ),
        ).toBe(true),
      { timeout: 10_000 },
    );

    // 5. Resolve CYVRA.01's in-flight scan and verify it completes cleanly
    scan1Deferred.resolve?.(
      hostEnvelope("RUN_SCAN", "OK", {
        sessionUuid: "11111111-2222-4333-8444-555555555555",
        serial: "RF8R123456",
        enumerationCompleteness: "COMPLETE",
        packageCount: 12,
        hwReportGenerated: true,
      }),
    );
    const slot1DownloadBtn = screen.getByLabelText("Download Report for CYVRA.01");
    await waitFor(() => expect(slot1DownloadBtn).not.toBeDisabled(), { timeout: 10_000 });
  }, 45_000);
});
