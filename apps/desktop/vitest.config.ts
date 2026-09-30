import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Test runner for the desktop UI.
 *
 * Deliberately a *separate* config rather than a `test` block bolted onto
 * `vite.config.ts`: the production build config must stay loadable without any
 * test-only dependency, and `vite build` must never be able to pull the
 * `reactRefresh`/jsdom test environment into a shippable bundle.
 *
 * CSS is not computed here - assertions are about markup, gating and state, not
 * about pixel values, which the enterprise design pass already covers with its
 * own contrast and layout checks.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // `forks` is Vitest's default, but its worker fails to start on this
    // Windows + pnpm setup: the pool reports "Timeout waiting for worker to
    // respond" after 60s with no test file ever loaded. `threads` runs the
    // same single test file here without the extra process, and jsdom is
    // per-file either way.
    pool: 'threads',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
})
