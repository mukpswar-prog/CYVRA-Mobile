import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/**
 * Harness smoke test. Proves jsdom, React 19, Testing Library and the
 * jest-dom matchers are all wired before anything real is written against
 * them - a failing gate here is a config problem, and diagnosing it from
 * inside a page test would waste the page test's failure as a signal.
 */
describe("admin test harness", () => {
  it("renders and matches", () => {
    render(<button disabled>Generate Key</button>);
    expect(screen.getByRole("button", { name: "Generate Key" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate Key" })).toBeDisabled();
  });
});
