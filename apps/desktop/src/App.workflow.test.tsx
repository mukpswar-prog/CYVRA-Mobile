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
  }, 20_000);
});
