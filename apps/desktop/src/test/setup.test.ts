import { describe, expect, it } from 'vitest'

/**
 * Harness check.
 *
 * Proves the runner is a real DOM (not the default node environment) and that
 * the `@testing-library/jest-dom` matchers are loaded for every test file by
 * `src/test/setup.ts`. Without this, a broken setup file would surface as a
 * mysterious `expect(...).toBeInTheDocument is not a function` inside the first
 * feature test rather than as a named failure of the harness itself.
 *
 * The activation screen's own terms-gating and disabled-state tests live next
 * to it once the screen exists.
 */
describe('desktop test harness', () => {
  it('runs in a document with the jest-dom matchers available', () => {
    const node = document.createElement('button')
    node.disabled = true
    document.body.append(node)

    expect(node).toBeInTheDocument()
    expect(node).toBeDisabled()

    node.remove()
  })
})
