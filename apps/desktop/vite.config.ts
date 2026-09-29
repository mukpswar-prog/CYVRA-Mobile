import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Build provenance for the footer line: the CI commit when CI built it,
  // "development" otherwise. Injected at build time so the app never has to
  // guess - or invent - the commit it was produced from.
  define: {
    __CYVRA_BUILD_COMMIT__: JSON.stringify(
      process.env.GITHUB_SHA ?? process.env.GIT_COMMIT ?? 'development',
    ),
  },
})
