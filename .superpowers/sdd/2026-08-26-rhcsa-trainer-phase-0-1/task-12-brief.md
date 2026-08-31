### Task 12: CLI with the `coverage` command

**Files:**
- Create: `src/cli/index.ts`
- Test: `test/cli/coverage.test.ts`

**Interfaces:**
- Consumes: `loadBank`/`checkCoverage` (T7), `ContentError` (T2).
- Produces:
  - `interface CliIo { out: (line: string) => void; err: (line: string) => void }`
  - `function run(argv: string[], io: CliIo): Promise<number>` — resolves to the process exit code

**Scope note.** Only `coverage` lands here, because it is the one command that needs no VM. `rhcsa validate` is added in Task 21, once `chooseTransport` and `VmController` exist to wire it to.

- [ ] **Step 1: Write the failing test**

`test/cli/coverage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { run } from '../../src/cli/index.ts'

const BANK = new URL('../fixtures/bank', import.meta.url).pathname

function capture() {
  const out: string[] = []
  const err: string[] = []
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err }
}

describe('rhcsa coverage', () => {
  it('reports counts and exits 0 when every reference resolves', async () => {
    const c = capture()
    const code = await run(['coverage', '--content', BANK], c.io)

    expect(code).toBe(0)
    const text = c.out.join('\n')
    expect(text).toMatch(/tasks: 2/)
    expect(text).toMatch(/concepts: 2/)
    expect(text).toMatch(/objectives: 3/)
    expect(text).toMatch(/uncovered objectives: 1/)
    expect(text).toMatch(/autofs\.maps\.configure/)
    expect(text).toMatch(/untaught concepts: 1/)
    expect(text).toMatch(/storage\.orphan-concept/)
  })

  it('exits 1 under --strict while coverage gaps remain', async () => {
    // Gaps are expected during Phase 1, so they only become failures on demand.
    const c = capture()
    const code = await run(['coverage', '--content', BANK, '--strict'], c.io)
    expect(code).toBe(1)
    expect(c.err.join('\n')).toMatch(/1 uncovered objective/)
  })

  it('reports a ContentError legibly and exits 1', async () => {
    const c = capture()
    const code = await run(
      ['coverage', '--content', new URL('../fixtures/bank-dupe', import.meta.url).pathname],
      c.io,
    )
    expect(code).toBe(1)
    expect(c.err.join('\n')).toMatch(/duplicate task id/)
  })

  it('exits 2 with usage on an unknown command', async () => {
    const c = capture()
    expect(await run(['frobnicate'], c.io)).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage: rhcsa/)
  })

  it('exits 2 with usage when no command is given', async () => {
    const c = capture()
    expect(await run([], c.io)).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage: rhcsa/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/cli/coverage.test.ts`
Expected: FAIL — `Cannot find module '../../src/cli/index.ts'`.

- [ ] **Step 3: Write the implementation**

`src/cli/index.ts`:

```ts
import { checkCoverage, loadBank } from '../engine/content/bank.ts'
import { ContentError } from '../engine/content/errors.ts'

export interface CliIo {
  out: (line: string) => void
  err: (line: string) => void
}

const USAGE = `usage: rhcsa <command> [options]

commands:
  coverage    report content coverage gaps

options:
  --content <dir>   content root (default: ./content)
  --strict          exit non-zero while coverage gaps remain`

function flag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`)
}

function option(argv: string[], name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  return argv[i + 1] ?? fallback
}

async function coverage(argv: string[], io: CliIo): Promise<number> {
  const root = option(argv, 'content', 'content')
  const strict = flag(argv, 'strict')

  let bank
  try {
    bank = await loadBank(root)
  } catch (e) {
    if (e instanceof ContentError) {
      io.err(e.message)
      return 1
    }
    throw e
  }

  const report = checkCoverage(bank)

  io.out(`content root: ${bank.root}`)
  io.out(`tasks: ${bank.tasks.length}`)
  io.out(`concepts: ${bank.concepts.length}`)
  io.out(`objectives: ${bank.objectives.objectives.length}`)
  io.out(`uncovered objectives: ${report.uncoveredObjectives.length}`)
  for (const id of report.uncoveredObjectives) io.out(`  - ${id}`)
  io.out(`untaught concepts: ${report.untaughtConcepts.length}`)
  for (const id of report.untaughtConcepts) io.out(`  - ${id}`)

  if (report.problems.length > 0) {
    for (const p of report.problems) io.err(`problem: ${p}`)
    return 1
  }

  if (strict) {
    const gaps = report.uncoveredObjectives.length + report.untaughtConcepts.length
    if (gaps > 0) {
      io.err(
        `${report.uncoveredObjectives.length} uncovered objective(s), ` +
          `${report.untaughtConcepts.length} untaught concept(s)`,
      )
      return 1
    }
  }

  return 0
}

export async function run(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv

  switch (command) {
    case 'coverage':
      return await coverage(rest, io)
    default:
      io.err(USAGE)
      return 2
  }
}

// Only run when invoked directly, so importing this module in tests is inert.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  const code = await run(process.argv.slice(2), {
    out: (l) => process.stdout.write(`${l}\n`),
    err: (l) => process.stderr.write(`${l}\n`),
  })
  process.exit(code)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 5 new tests PASS; typecheck clean.

- [ ] **Step 5: Verify the CLI works when invoked for real**

Run:
```bash
cd /home/daxtangco/rhcsa-trainer
node src/cli/index.ts coverage --content test/fixtures/bank; echo "exit=$?"
node src/cli/index.ts; echo "exit=$?"
```
Expected: first prints the report and `exit=0`; second prints usage to stderr and `exit=2`.

- [ ] **Step 6: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/cli test/cli && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(cli): add rhcsa coverage

run() returns an exit code instead of calling process.exit so it is testable.
Coverage gaps only fail under --strict, since they are the normal state until
the bank is complete."
```

---

