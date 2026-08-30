import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // Registers Vitest's global `afterEach`, which is the only thing that lets
    // @testing-library/react install its automatic DOM cleanup. Without it the
    // component tests of Task 24 accumulate mounted trees and `getByText`
    // starts throwing on duplicate matches. Set here, in Task 1, so the two
    // copies of this file cannot drift.
    globals: true,
    // .tsx joins the glob for the component tests.
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // A suite that needs a live hypervisor is named *.vm.test.ts and opts in
    // via RHCSA_VM=1, so the default `npm test` runs anywhere. The gate is on
    // the filename, not the directory: test/vm/ also holds unit tests that
    // drive vmrun and ssh through fakes, and those must always run. Both arms
    // restate node_modules and dist, because naming `exclude` at all replaces
    // Vitest's defaults rather than adding to them.
    exclude: process.env.RHCSA_VM === '1' ? ['**/node_modules/**', '**/dist/**'] : ['**/node_modules/**', '**/dist/**', 'test/**/*.vm.test.ts'],
    // No `environmentMatchGlobs`: it is deprecated in the installed vitest 3.2.7
    // and removed in 4.0, and package.json pins `^3.0.0`. The one file that
    // needs a DOM says so itself with a `// @vitest-environment jsdom` docblock,
    // which is version-proof and leaves test/web/api.test.ts in Node - where its
    // `Response` and `fetch` are Node 22's real ones rather than jsdom's.
    testTimeout: 10_000,
  },
})
