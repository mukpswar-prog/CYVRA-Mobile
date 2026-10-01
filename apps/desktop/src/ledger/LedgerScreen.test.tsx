import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { LedgerScreen } from "./LedgerScreen";

type Props = ComponentProps<typeof LedgerScreen>;

const ZERO = "0".repeat(64);

function entry(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    schema: "cyvra.ledger.v1",
    seq: 1,
    at: "2026-09-30T10:00:00Z",
    event: "ACTIVATION",
    offline: false,
    subject: null,
    prev: ZERO,
    hash: "a".repeat(64),
    ...overrides,
  });
}

function mount(overrides: Partial<Props> = {}) {
  const onRefresh = vi.fn();
  render(
    <LedgerScreen
      loading={false}
      error={null}
      raw={null}
      verified={null}
      decodedCount={0}
      onRefresh={onRefresh}
      {...overrides}
    />,
  );
  return { onRefresh };
}

function rows(): HTMLElement[] {
  const table = screen.getByRole("table");
  return within(table).getAllByRole("row").slice(1);
}

describe("LedgerScreen", () => {
  describe("when there is no ledger yet", () => {
    it("says so without calling it damaged", () => {
      mount();

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Transaction Ledger");
      expect(screen.getByText("NO LEDGER YET")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("does not claim an empty file is a missing one while the read is in flight", () => {
      mount({ loading: true });

      expect(screen.queryByText("NO LEDGER YET")).not.toBeInTheDocument();
    });
  });

  describe("the rows it renders", () => {
    const raw = [
      entry({
        seq: 1,
        event: "ACTIVATION",
        subject: null,
        prev: ZERO,
        hash: "a".repeat(64),
      }),
      entry({
        seq: 2,
        event: "GRACE_ENTERED",
        offline: true,
        subject: null,
        prev: "a".repeat(64),
        hash: "b".repeat(64),
      }),
      entry({
        seq: 3,
        event: "SCAN_COMMITTED",
        subject: "CYVRA-SESSION-ABC",
        prev: "b".repeat(64),
        hash: "c".repeat(64),
      }),
      entry({
        seq: 4,
        event: "SCAN_DEBITED",
        subject: "CYVRA-CERT-1",
        prev: "c".repeat(64),
        hash: "d".repeat(64),
      }),
    ].join("\n");

    it("parses the file itself rather than trusting a decoded struct", () => {
      mount({ raw, decodedCount: 4, verified: true });

      expect(rows()).toHaveLength(4);
    });

    it("renders each event under the words the workstation uses", () => {
      mount({ raw });

      const table = screen.getByRole("table");
      expect(within(table).getByText("First device binding")).toBeInTheDocument();
      expect(within(table).getByText("Offline grace entered")).toBeInTheDocument();
      expect(within(table).getByText("Scan reserved")).toBeInTheDocument();
      expect(within(table).getByText("Scan spent on a certificate")).toBeInTheDocument();
    });

    it("labels live and offline provenance separately, in words as well as colour", () => {
      mount({ raw });

      const table = screen.getByRole("table");
      expect(within(table).getAllByText("LIVE")).toHaveLength(3);
      expect(within(table).getAllByText("OFFLINE")).toHaveLength(1);
    });

    it("never restates a timestamp in any other form", () => {
      // The file holds UTC. Rendering it any other way would be the view
      // inventing a claim about when something happened.
      mount({ raw });

      const table = screen.getByRole("table");
      expect(within(table).getAllByText("2026-09-30T10:00:00Z")).toHaveLength(4);
      expect(within(table).queryByText(/Sep/)).not.toBeInTheDocument();
    });

    it("names the subject a transaction was about, and says when there is none", () => {
      mount({ raw });

      const table = screen.getByRole("table");
      expect(within(table).getByText("CYVRA-SESSION-ABC")).toBeInTheDocument();
      expect(within(table).getAllByText("Not applicable")).toHaveLength(2);
    });

    it("shows both links for every entry so the chain can be followed by eye", () => {
      mount({ raw });

      const table = screen.getByRole("table");
      expect(within(table).getAllByText("prev")).toHaveLength(4);
      expect(within(table).getAllByText("hash")).toHaveLength(4);
    });
  });

  describe("the chain verdict", () => {
    it("reports an intact chain as intact", () => {
      mount({ raw: entry(), verified: true, decodedCount: 1 });

      expect(screen.getByTestId("chain-ok")).toHaveTextContent("CHAIN INTACT");
      expect(screen.getByTestId("chain-ok")).toHaveTextContent("1 entry");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("reports a broken chain loudly and claims nothing was repaired", () => {
      mount({ raw: entry(), verified: false, decodedCount: 1 });

      const alert = screen.getByTestId("chain-broken");
      expect(alert).toHaveTextContent("CHAIN DOES NOT CHECK OUT");
      expect(alert).toHaveTextContent("Nothing has been repaired or rewritten");
      expect(alert).toHaveAttribute("role", "alert");
    });

    it("shows no verdict when there is no ledger to verify", () => {
      mount({ raw: null, verified: null });

      expect(screen.queryByTestId("chain-ok")).not.toBeInTheDocument();
      expect(screen.queryByTestId("chain-broken")).not.toBeInTheDocument();
    });
  });

  describe("when the file does not read back", () => {
    it("names the line and the reason without discarding the rest", () => {
      const raw = [entry({ seq: 1 }), "{ not json", entry({ seq: 3 })].join("\n");
      mount({ raw });

      const problems = screen.getByTestId("chain-problems");
      expect(problems).toHaveTextContent("Line 2: not valid JSON");
      expect(rows()).toHaveLength(2);
    });

    it("reports structural faults it can see without re-hashing anything", () => {
      const raw = [
        entry({ seq: 1, hash: "a".repeat(64) }),
        entry({ seq: 3, prev: ZERO, hash: "b".repeat(64) }),
      ].join("\n");
      mount({ raw });

      const problems = screen.getByTestId("chain-problems");
      expect(problems).toHaveTextContent("entry 3 appears where entry 2 should be");
      expect(problems).toHaveTextContent("entry 3 does not link back to entry 1");
    });

    it("puts the disagreement between the two readers on screen rather than picking one", () => {
      mount({ raw: entry(), verified: true, decodedCount: 7 });

      const alert = screen.getByTestId("reader-disagreement");
      expect(alert).toHaveTextContent("The bridge decoded 7 entries");
      expect(alert).toHaveTextContent("this view parsed 1 entry");
    });

    it("says nothing when both readers agree", () => {
      mount({ raw: entry(), verified: true, decodedCount: 1 });

      expect(screen.queryByTestId("reader-disagreement")).not.toBeInTheDocument();
    });

    it("surfaces a bridge failure as itself", () => {
      mount({ error: "ledger_read: the file could not be opened" });

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("LEDGER COULD NOT BE READ");
      expect(alert).toHaveTextContent("the file could not be opened");
    });
  });

  describe("re-reading", () => {
    it("asks for the ledger again", () => {
      const { onRefresh } = mount();

      fireEvent.click(screen.getByRole("button", { name: "Re-read the transaction ledger" }));

      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it("does not offer a second read while the first is still running", () => {
      mount({ loading: true });

      expect(
        screen.getByRole("button", { name: "Re-read the transaction ledger" }),
      ).toBeDisabled();
    });
  });

  describe("what the view claims it is showing", () => {
    const body = () => document.body.textContent ?? "";

    it("names the file it reads", () => {
      mount({ raw: entry() });

      expect(body()).toContain("<cyvra.home>/logs/ledger.jsonl");
    });

    it("states plainly that the two checks are different checks", () => {
      mount({ raw: entry(), verified: true, decodedCount: 1 });

      expect(body()).toContain("SHA-256 recomputed entry by entry");
      expect(body()).toContain("it checks structure - sequence and links - not bytes");
    });

    it("states that reserving is not spending", () => {
      mount({ raw: entry() });

      expect(body()).toContain("Scan reserved");
      expect(body()).toContain("spends nothing");
    });

    it("says a ledger that no longer checks out is left alone", () => {
      mount({ raw: entry(), verified: false });

      expect(body()).toContain(
        "Nothing on this screen repairs, reorders or rewrites the file.",
      );
    });
  });
});
