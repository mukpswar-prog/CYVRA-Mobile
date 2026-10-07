import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Test runner for the admin console, and - since WS-K1-01 (07-Oct-2026) - for
 * the customer workstation surface too. `src/site` was added because the
 * compliance hotfix had to prove three things about `CustomerDesktopShell`
 * that a grep alone cannot: that no certificate can be produced while the
 * host engine is BLOCKED_NOT_IMPLEMENTED, that the purge surface says so in
 * words, and that its dates go through the section 58 IST formatter.
 *
 * Deliberately a *separate* config rather than a `test` block bolted onto
 * `vite.config.ts`, for the same reason the desktop bundle has one: the
 * production build config must stay loadable without any test-only dependency,
 * and `vite build` must never be able to pull jsdom into a shippable bundle.
 *
 * What is asserted here is gating, consumption of server pagination, and the
 * row-menu enablement matrix - all of which are pure functions of `(state,
 * role)` or of a response body. Pixel values are out of scope: this console's
 * contrast and layout are covered by the design tokens in `admin/styles.css`
 * and reviewed by eye, not asserted character by character.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // `forks` is Vitest's default, but its worker fails to start on this
    // Windows + pnpm setup: the pool reports "Timeout waiting for worker to
    // respond" with no test file ever loaded. `threads` runs the same files
    // without the extra process, and jsdom is per-file either way.
    pool: "threads",
    /*
     * Two ceilings, for one cause: this machine cannot start eight isolated
     * jsdom environments at once. Vitest reports ~4.5s of startup per worker,
     * and a test that begins while seven siblings are still booting starves
     * past the 5s default - which is how a two-line smoke test in
     * `harness.test.tsx` fails while 249 real assertions pass. The failure was
     * never in the code under test, so the fix is the concurrency limit and a
     * timeout that admits startup is not work, not a relaxed assertion.
     */
    maxWorkers: 2,
    testTimeout: 15_000,
    include: ["src/admin/**/*.test.{ts,tsx}", "src/site/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
});
