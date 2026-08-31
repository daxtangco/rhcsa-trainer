### Task 1: Project scaffold that typechecks and runs a test

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Modify: `.gitignore`
- Test: `test/scaffold.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `npm test` and `npm run typecheck` commands every later task uses; the ESM + erasable-syntax constraints all later code obeys.

- [ ] **Step 1: Write the failing test**

`test/scaffold.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

describe('scaffold', () => {
  it('runs TypeScript under vitest with strict types', () => {
    const n: number = 41
    expect(n + 1).toBe(42)
  })

  it('targets Node 22 or newer', () => {
    const major = Number(process.versions.node.split('.')[0])
    expect(major).toBeGreaterThanOrEqual(22)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx --no vitest run`
Expected: FAIL — the command exits non-zero because vitest is not installed locally yet. `--no` is what keeps it a red probe: without it `npx` would offer to fetch vitest from the registry and the step could pass by accident. This confirms there is no toolchain yet.

- [ ] **Step 3: Write the scaffold**

`package.json`:

```json
{
  "name": "rhcsa-trainer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.18.0" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "rhcsa": "node src/cli/index.ts"
  },
  "dependencies": {
    "gray-matter": "^4.0.3",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22.10.0",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  }
}
```

`engines.node` is `>=22.18.0`, not the installed 22.23.2: 22.18.0 is where `--experimental-strip-types` became the default, which is the real floor. Do not raise it to match the Global Constraint.

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": false,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "test", "scripts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Registers Vitest's global `afterEach`, which is the only thing that lets
    // @testing-library/react install its automatic DOM cleanup. Without it the
    // component tests of Task 24 accumulate mounted trees and `getByText`
    // starts throwing on duplicate matches. Set here, in Task 1, so the two
    // copies of this file cannot drift.
    globals: true,
    include: ['test/**/*.test.ts'],
    // A suite that needs a live hypervisor is named *.vm.test.ts and opts in
    // via RHCSA_VM=1, so the default `npm test` runs anywhere. The gate is on
    // the filename, not the directory: test/vm/ also holds unit tests that
    // drive vmrun and ssh through fakes, and those must always run. Both arms
    // restate node_modules and dist, because naming `exclude` at all replaces
    // Vitest's defaults rather than adding to them.
    exclude: process.env.RHCSA_VM === '1' ? ['**/node_modules/**', '**/dist/**'] : ['**/node_modules/**', '**/dist/**', 'test/**/*.vm.test.ts'],
    testTimeout: 10_000,
  },
})
```

Append to `.gitignore`:

```
corpus/
coverage/
```

- [ ] **Step 4: Install and run the tests**

Run: `cd /home/daxtangco/rhcsa-trainer && npm install && npm test && npm run typecheck`
Expected: 2 tests PASS; `tsc --noEmit` exits 0 with no output.

- [ ] **Step 5: Verify the erasable-syntax guard actually fires**

This proves the Global Constraint is enforced by the compiler rather than by discipline.

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
mkdir -p src
printf 'export enum Bad { A }\n' > src/_guard.ts
npm run typecheck; echo "exit=$?"
rm src/_guard.ts
rmdir src 2>/dev/null || true
```
Expected: typecheck FAILS citing `erasableSyntaxOnly` on the `enum`, then `exit=2`. If it exits 0, the TypeScript version is too old — raise it to `^5.8.0` and repeat.

- [ ] **Step 6: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore test/scaffold.test.ts && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "chore: scaffold Node 22 + TypeScript + vitest, no build step

Type stripping runs .ts directly, so erasableSyntaxOnly is enabled to make
the no-enum/no-parameter-property constraint a compiler error rather than a
runtime surprise. VM-dependent suites are excluded unless RHCSA_VM=1 so the
default test run needs no hypervisor."
```

---

