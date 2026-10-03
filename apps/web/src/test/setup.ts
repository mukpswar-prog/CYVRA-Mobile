/**
 * Loads the `toBeInTheDocument` / `toBeDisabled` family for every test and
 * empties the document between them.
 *
 * Imported explicitly by the Vitest setup rather than added to `types` in
 * `tsconfig.json`, so the matchers are scoped to tests and a production source
 * file cannot accidentally rely on them.
 *
 * The cleanup is explicit because `globals` is off in `vitest.config.ts`:
 * Testing Library only registers its own `afterEach` when a global one exists,
 * and without it every test would query the previous test's markup and fail on
 * "found multiple elements" rather than on anything it meant to assert.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
