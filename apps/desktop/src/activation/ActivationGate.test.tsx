import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

/** The verdict `activation::commands::ActivationDecision` carries when let in. */
const ENTER = {
  state: "enter",
  offline: true,
  message: null,
  termsVersion: "V1.0-DRAFT",
};

/**
 * Reloads the gate so its module-level launch state starts clean.
 *
 * The decision is cached per module on purpose, so without this each test
 * would inherit the previous one's answer and assert about a launch it never
 * made.
 */
async function loadGate() {
  vi.resetModules();
  return (await import("./ActivationGate")).ActivationGate;
}

function launchCalls(): unknown[][] {
  return invokeMock.mock.calls.filter(([command]) => command === "activation_launch");
}

function mount(ActivationGate: Awaited<ReturnType<typeof loadGate>>) {
  render(
    <StrictMode>
      <ActivationGate>
        <div data-testid="workspace" />
      </ActivationGate>
    </StrictMode>,
  );
}

describe("ActivationGate", () => {
  describe("the launch sequence", () => {
    it("asks Rust to launch exactly once, even when StrictMode mounts twice", async () => {
      // StrictMode mounts, tears down and re-runs effects in development. Each
      // run dispatched its own `activation_launch`, and every launch appends a
      // `GRACE_ENTERED` ledger entry - so one launch was recorded as two
      // entries stamped in the same second, which is an idempotency violation
      // of the append-only chain rather than a cosmetic duplicate.
      invokeMock.mockResolvedValue(ENTER);
      const ActivationGate = await loadGate();

      mount(ActivationGate);

      await waitFor(() => expect(screen.getByTestId("workspace")).toBeInTheDocument());

      expect(launchCalls()).toHaveLength(1);
    });

    it("still lets the workspace through when the launch says enter", async () => {
      invokeMock.mockResolvedValue(ENTER);
      const ActivationGate = await loadGate();

      mount(ActivationGate);

      await waitFor(() => expect(screen.getByTestId("workspace")).toBeInTheDocument());
      expect(launchCalls()[0]?.[0]).toBe("activation_launch");
    });

    it("holds the workspace back while Rust is still deciding", async () => {
      invokeMock.mockImplementation(() => new Promise(() => {}));
      const ActivationGate = await loadGate();

      mount(ActivationGate);

      expect(screen.queryByTestId("workspace")).not.toBeInTheDocument();
      expect(launchCalls()).toHaveLength(1);
    });
  });
});
