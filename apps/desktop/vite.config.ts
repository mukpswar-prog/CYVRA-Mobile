import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vite'

/**
 * The commit this bundle was built from, printed in the footer as
 * `v<version> - build <commit> - protocol v1 - (C) CYVORIQ Solutions`.
 *
 * Resolution order:
 *
 *   1. `GITHUB_SHA` - set by GitHub Actions, so every CI-built installer names
 *      the exact revision it was produced from.
 *   2. `git rev-parse HEAD` - a build from a working checkout.
 *   3. the literal `development` - `vite serve` only.
 *
 * Step 3 is gated on the build *command*, not on a mode string, so
 * `vite build --mode development` still cannot reach it: a bundle produced by
 * `vite build` that cannot name its own commit throws instead of being
 * written. The dev server is the only thing that may ever say "development",
 * and it never produces a shippable artifact - so no shipped installer can
 * self-label as development.
 *
 * The value is fixed at build time and read once by App.tsx; the running app
 * never computes or overwrites it.
 */
function buildCommit(command: 'build' | 'serve'): string {
  const fromCi = (process.env.GITHUB_SHA ?? '').trim()

  if (fromCi) {
    return fromCi
  }

  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim()

    if (head) {
      return head
    }
  } catch {
    // git is not on PATH (for example a source tarball); fall through.
  }

  if (command === 'build') {
    throw new Error(
      'Refusing to emit a production bundle without a commit: ' +
        'set GITHUB_SHA, or build from a git checkout.',
    )
  }

  return 'development'
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  define: {
    __CYVRA_BUILD_COMMIT__: JSON.stringify(buildCommit(command)),
  },
  server: {
    watch: {
      // The Rust build tree lives under this project's root, and vite would
      // otherwise crawl all of it. That is not a small directory, and the cost
      // was concrete: the dev server blocked its event loop for minutes while
      // scanning (HTTP requests hung, so the webview never loaded), and a
      // locked `target/debug/deps/*.dll` being rewritten by cargo crashed the
      // watcher outright with `EBUSY`, taking `tauri dev` down with it.
      ignored: ['**/src-tauri/target/**', '**/src-tauri/.resources/**'],
    },
  },
}))
