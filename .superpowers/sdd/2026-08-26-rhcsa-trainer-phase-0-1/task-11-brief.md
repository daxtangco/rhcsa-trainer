### Task 11: Validation harness

**Files:**
- Create: `src/engine/validate/harness.ts`
- Test: `test/validate/harness.test.ts`

**Interfaces:**
- Consumes: `TaskSpec` (T3), `LabTransport` (T2), `grade`/`GradeResult` (T8), `parseExpectations`/`expectedStatus` (T10), `statusById` (T5).
- Produces:
  - `type FixtureKind = 'none' | 'solution' | 'antisolution'`
  - `interface Fixture { kind: FixtureKind; name: string; script: string }`
  - `interface TaskScripts { setup: string; grade: string; fixtures: Fixture[] }`
  - `interface HarnessDeps { transport: LabTransport; reset: () => Promise<void>; reboot: () => Promise<void> }`
  - `interface FixtureResult { taskId: string; kind: FixtureKind; name: string; ok: boolean; failures: string[] }`
  - `function loadTaskScripts(task: TaskSpec, assertLib: string): Promise<TaskScripts>`
  - `function validateTask(task: TaskSpec, scripts: TaskScripts, deps: HarnessDeps): Promise<FixtureResult[]>`

**Design note.** I/O is separated from logic: `loadTaskScripts` touches the filesystem, `validateTask` is pure orchestration over already-loaded strings. That is what makes the whole assertion matrix testable against `FakeTransport` with no VM and no fixture files on disk.

**Design note: the `none` fixture.** The obvious rule — "nothing may pass before the student does anything" — is wrong. Real tasks carry *invariant* checkpoints (`home-mounted`, `var-from-lv`) whose whole job is to catch a destructive answer, and those pass at baseline by design. So `grade.sh` declares its own baseline with a `# baseline-fail:` header, using the identical grammar and phase syntax as an anti-solution's `# expect-fail:`, and the harness requires **exactly** those to fail. A task with no header fails validation: without a declaration there is nothing to prove the goal checkpoints are not passing for free.

- [ ] **Step 1: Write the failing test**

`test/validate/harness.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { validateTask, type TaskScripts } from '../../src/engine/validate/harness.ts'
import { FakeTransport } from '../../src/engine/vm/fake.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'

function task(over: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: 'storage/014-grow-var',
    title: 'Grow var',
    chapter: 15,
    scope: 'exam-objective',
    rhel: 9,
    objectives: ['storage.lvm.resize'],
    requiresConcepts: [],
    difficulty: 3,
    timeBudget: 480,
    weight: 'high',
    editions: ['r9'],
    rebootCheck: true,
    requiresDisks: 0,
    claims: [],
    transport: 'ssh',
    prompt: 'Grow var.',
    dir: '/nowhere',
    ...over,
  }
}

/**
 * A two-variable world: did the LV grow, and is there a persistence config?
 * The handler is a state machine, never a simulated Linux.
 */
function world() {
  const state = { grown: false, persisted: false, mounted: false, rebooted: false }

  const handler = (script: string) => {
    if (script.includes('SETUP')) {
      state.grown = false
      state.persisted = false
      state.mounted = true
      state.rebooted = false
      return { stdout: '', stderr: '', code: 0 }
    }
    // Non-exclusive, and deliberately so: the correct solution is the single
    // script 'GROW\nPERSIST\n', so an if/return chain would set `grown` and
    // return before it ever noticed the PERSIST line.
    if (script.includes('GROW')) {
      state.grown = true
      state.mounted = true
    }
    if (script.includes('PERSIST')) {
      state.persisted = true
    }
    if (script.includes('GROW') || script.includes('PERSIST')) {
      return { stdout: '', stderr: '', code: 0 }
    }
    if (script.includes('GRADE')) {
      const mounted = state.rebooted ? state.persisted : state.mounted
      const lines = [
        `{"id":"lv-var-size","desc":"var LV >= 6G","status":"${state.grown ? 'pass' : 'fail'}"}`,
        `{"id":"persist-config","desc":"mounts at boot","status":"${state.persisted ? 'pass' : 'fail'}"}`,
        `{"id":"var-from-lv","desc":"/var mounted","status":"${mounted ? 'pass' : 'fail'}"}`,
      ]
      return { stdout: lines.join('\n'), stderr: '', code: 0 }
    }
    return { stdout: '', stderr: '', code: 0 }
  }

  return { state, handler }
}

function deps(w: ReturnType<typeof world>) {
  const transport = new FakeTransport(w.handler)
  return {
    transport,
    reset: async () => {
      w.state.grown = false
      w.state.persisted = false
      w.state.mounted = false
      w.state.rebooted = false
    },
    reboot: async () => {
      w.state.rebooted = true
    },
  }
}

const CORRECT = 'GROW\nPERSIST\n'
const FORGOT_PERSIST = 'GROW\n'

/**
 * grade.sh declares its own baseline. In this world, before any work: the LV
 * has not grown and nothing is persisted, but /var IS still mounted — so
 * var-from-lv passes now and only fails after the reboot.
 */
const BASELINE = '# baseline-fail: lv-var-size, persist-config, var-from-lv@post\n'

function scripts(over: Partial<TaskScripts> = {}): TaskScripts {
  return {
    setup: 'SETUP',
    grade: `${BASELINE}GRADE`,
    fixtures: [
      { kind: 'none', name: 'no-action', script: '' },
      { kind: 'solution', name: '01-lvextend.sh', script: CORRECT },
      { kind: 'solution', name: '02-mount-unit.sh', script: CORRECT },
      {
        kind: 'antisolution',
        name: '01-forgot-persistence.sh',
        script: `# expect-fail: persist-config, var-from-lv@post\n${FORGOT_PERSIST}`,
      },
    ],
    ...over,
  }
}

describe('validateTask', () => {
  it('passes a well-formed task with correct solutions and a declared anti-solution', async () => {
    const w = world()
    const results = await validateTask(task(), scripts(), deps(w))

    expect(results.map((r) => r.name)).toEqual([
      'no-action',
      '01-lvextend.sh',
      '02-mount-unit.sh',
      '01-forgot-persistence.sh',
    ])
    for (const r of results) {
      expect(r.failures, `${r.name}: ${r.failures.join('; ')}`).toEqual([])
      expect(r.ok).toBe(true)
    }
  })

  it('fails the no-action fixture when a goal checkpoint passes without work', async () => {
    const w = world()
    // A grader that reports a pass on an untouched system is the dangerous
    // direction of error, so the no-action fixture must catch it.
    const s = scripts({ grade: `${BASELINE}GRADE_ALWAYS_PASS` })
    const bad = deps(w)
    bad.transport = new FakeTransport((script) =>
      script.includes('GRADE')
        ? {
            stdout: [
              '{"id":"lv-var-size","desc":"x","status":"pass"}',
              '{"id":"persist-config","desc":"y","status":"fail"}',
              '{"id":"var-from-lv","desc":"z","status":"pass"}',
            ].join('\n'),
            stderr: '',
            code: 0,
          }
        : { stdout: '', stderr: '', code: 0 },
    )

    const results = await validateTask(task(), s, bad)
    const none = results.find((r) => r.kind === 'none')
    expect(none?.ok).toBe(false)
    expect(none?.failures.join('\n')).toMatch(/verdict A lv-var-size: expected fail, got pass/)
  })

  it('accepts an invariant checkpoint that passes at baseline', async () => {
    // var-from-lv is a "do not break this" check, not a goal. Requiring it to
    // fail before the student starts would make every honest task unvalidatable.
    // Asserted the distinguishing way, so this is not a restatement of the
    // headline test: name var-from-lv in the *pre-reboot* baseline and the
    // harness must object to that id and only that id — which is the same
    // statement as "var-from-lv passes in verdict A while lv-var-size fails
    // there, exactly as declared".
    const w = world()
    const s = scripts({
      grade: '# baseline-fail: lv-var-size, persist-config, var-from-lv\nGRADE',
    })
    const results = await validateTask(task(), s, deps(w))
    const none = results.find((r) => r.kind === 'none')
    const text = none?.failures.join('\n') ?? ''
    expect(text).toMatch(/verdict A var-from-lv: expected fail, got pass/)
    expect(text).not.toMatch(/lv-var-size/)
  })

  it('fails a task whose grade.sh declares no baseline', async () => {
    const w = world()
    const results = await validateTask(task(), scripts({ grade: 'GRADE' }), deps(w))
    const none = results.find((r) => r.kind === 'none')
    expect(none?.ok).toBe(false)
    expect(none?.failures.join('\n')).toMatch(/"# baseline-fail:" header/)
  })

  it('stops immediately when setup.sh fails, instead of grading the wrong machine', async () => {
    const w = world()
    const bad = deps(w)
    bad.transport = new FakeTransport((script) =>
      script.includes('SETUP')
        ? { stdout: '', stderr: '/home is not on the rhel-home LV', code: 1 }
        : { stdout: '', stderr: '', code: 0 },
    )

    const results = await validateTask(task(), scripts(), bad)
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures).toEqual([
      'setup.sh exited 1: /home is not on the rhel-home LV',
    ])
  })

  it('fails a baseline declaration naming a checkpoint the grader never emits', async () => {
    const w = world()
    const s = scripts({ grade: `# baseline-fail: lv-var-size, typo-id\nGRADE` })
    const results = await validateTask(task(), s, deps(w))
    const none = results.find((r) => r.kind === 'none')
    expect(none?.failures.join('\n')).toMatch(/baseline-fail names typo-id/)
  })

  it('fails a solution that does not pass every checkpoint, catching over-fitting', async () => {
    const w = world()
    const s = scripts()
    s.fixtures = [{ kind: 'solution', name: '03-partial.sh', script: FORGOT_PERSIST }]

    const results = await validateTask(task(), s, deps(w))
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures.join('\n')).toMatch(/persist-config: expected pass, got fail/)
  })

  it('fails an anti-solution whose declared checkpoint did not actually fail', async () => {
    const w = world()
    const s = scripts()
    s.fixtures = [
      {
        kind: 'antisolution',
        name: '02-wrong-declaration.sh',
        script: `# expect-fail: lv-var-size\n${CORRECT}`,
      },
    ]

    const results = await validateTask(task(), s, deps(w))
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures.join('\n')).toMatch(/lv-var-size: expected fail, got pass/)
  })

  it('fails an anti-solution that breaks a checkpoint it did not declare', async () => {
    // This is the assertion that proves the right check caught the error, not
    // merely that something failed.
    const w = world()
    const s = scripts()
    s.fixtures = [
      {
        kind: 'antisolution',
        name: '03-underdeclared.sh',
        script: '# expect-fail: persist-config\nGROW\n',
      },
    ]

    const results = await validateTask(task(), s, deps(w))
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures.join('\n')).toMatch(/var-from-lv: expected pass, got fail/)
  })

  it('requires at least two solutions and one anti-solution', async () => {
    const w = world()
    const s = scripts()
    s.fixtures = [{ kind: 'solution', name: '01.sh', script: CORRECT }]

    const results = await validateTask(task(), s, deps(w))
    const gate = results.find((r) => r.kind === 'none' && r.name === 'fixture-inventory')
    expect(gate?.ok).toBe(false)
    expect(gate?.failures.join('\n')).toMatch(/needs at least 2 solutions/)
    expect(gate?.failures.join('\n')).toMatch(/needs at least 1 anti-solution/)
  })

  it('rejects a post-phase declaration on a task that never reboots', async () => {
    const w = world()
    const s = scripts()
    s.fixtures = [
      {
        kind: 'antisolution',
        name: '04-post-without-reboot.sh',
        script: `# expect-fail: var-from-lv@post\n${FORGOT_PERSIST}`,
      },
    ]

    const results = await validateTask(task({ rebootCheck: false }), s, deps(w))
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures.join('\n')).toMatch(
      /declares @post but the task has reboot_check: false/,
    )
  })

  it('reports duplicate checkpoint ids emitted by the grader', async () => {
    const w = world()
    const bad = deps(w)
    bad.transport = new FakeTransport((script) =>
      script.includes('GRADE')
        ? {
            stdout: [
              '{"id":"dup","desc":"x","status":"pass"}',
              '{"id":"dup","desc":"y","status":"pass"}',
            ].join('\n'),
            stderr: '',
            code: 0,
          }
        : { stdout: '', stderr: '', code: 0 },
    )
    const s = scripts()
    s.fixtures = [{ kind: 'solution', name: '01.sh', script: CORRECT }]

    const results = await validateTask(task({ rebootCheck: false }), s, bad)
    expect(results[0]?.failures.join('\n')).toMatch(/grader emitted duplicate checkpoint ids: dup/)
  })

  it('resets before every fixture so fixtures cannot contaminate each other', async () => {
    const w = world()
    let resets = 0
    const d = deps(w)
    const innerReset = d.reset
    d.reset = async () => {
      resets++
      await innerReset()
    }

    await validateTask(task(), scripts(), d)
    // 4 fixtures, one reset each.
    expect(resets).toBe(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/validate/harness.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/validate/harness.ts'`.

- [ ] **Step 3: Write the implementation**

`src/engine/validate/harness.ts`:

```ts
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { TaskSpec } from '../content/task.ts'
import { grade } from '../grading/grader.ts'
import { duplicateIds, statusById, type Verdict } from '../grading/verdict.ts'
import type { LabTransport } from '../vm/transport.ts'
import { expectedStatus, parseExpectations, type ExpectedFailure } from './expectations.ts'

export type FixtureKind = 'none' | 'solution' | 'antisolution'

export interface Fixture {
  kind: FixtureKind
  name: string
  script: string
}

export interface TaskScripts {
  setup: string
  /** grade.sh with the assertion library already prepended. */
  grade: string
  fixtures: Fixture[]
}

export interface HarnessDeps {
  transport: LabTransport
  /** Revert to the clean snapshot. */
  reset: () => Promise<void>
  reboot: () => Promise<void>
}

export interface FixtureResult {
  taskId: string
  kind: FixtureKind
  name: string
  ok: boolean
  failures: string[]
}

const MIN_SOLUTIONS = 2
const MIN_ANTISOLUTIONS = 1

export async function loadTaskScripts(task: TaskSpec, assertLib: string): Promise<TaskScripts> {
  const setup = await readFile(join(task.dir, 'setup.sh'), 'utf8')
  const gradeBody = await readFile(join(task.dir, 'grade.sh'), 'utf8')

  const collect = async (sub: string, kind: FixtureKind): Promise<Fixture[]> => {
    const dir = join(task.dir, sub)
    const names = (await readdir(dir).catch(() => [])).filter((n) => n.endsWith('.sh')).sort()
    return Promise.all(
      names.map(async (name) => ({
        kind,
        name,
        script: await readFile(join(dir, name), 'utf8'),
      })),
    )
  }

  return {
    setup,
    grade: `${assertLib}\n${gradeBody}`,
    fixtures: [
      { kind: 'none', name: 'no-action', script: '' },
      ...(await collect('solutions', 'solution')),
      ...(await collect('antisolutions', 'antisolution')),
    ],
  }
}

function inventoryGate(task: TaskSpec, scripts: TaskScripts): FixtureResult {
  const failures: string[] = []
  const solutions = scripts.fixtures.filter((f) => f.kind === 'solution').length
  const antis = scripts.fixtures.filter((f) => f.kind === 'antisolution').length

  // Multiple independent solutions are what catch a grader over-fitted to one
  // author's habits; anti-solutions are what catch false positives.
  if (solutions < MIN_SOLUTIONS) {
    failures.push(`needs at least ${MIN_SOLUTIONS} solutions, found ${solutions}`)
  }
  if (antis < MIN_ANTISOLUTIONS) {
    failures.push(`needs at least ${MIN_ANTISOLUTIONS} anti-solution, found ${antis}`)
  }

  return {
    taskId: task.id,
    kind: 'none',
    name: 'fixture-inventory',
    ok: failures.length === 0,
    failures,
  }
}

function checkVerdict(
  verdict: Verdict,
  label: 'A' | 'B',
  expect: (id: string) => 'pass' | 'fail',
  failures: string[],
): void {
  if (verdict.checkpoints.length === 0) {
    failures.push(`verdict ${label}: grader emitted no checkpoints`)
  }
  for (const cp of verdict.checkpoints) {
    const want = expect(cp.id)
    const got = cp.status === 'pass' ? 'pass' : 'fail'
    if (got !== want) {
      const detail = cp.detail ? ` (${cp.detail})` : ''
      failures.push(`verdict ${label} ${cp.id}: expected ${want}, got ${cp.status}${detail}`)
    }
  }
}

async function runFixture(
  task: TaskSpec,
  scripts: TaskScripts,
  fixture: Fixture,
  deps: HarnessDeps,
): Promise<FixtureResult> {
  const failures: string[] = []

  let declared: ExpectedFailure[] = []
  if (fixture.kind === 'antisolution') {
    try {
      declared = parseExpectations(fixture.script, `${task.id}/antisolutions/${fixture.name}`)
    } catch (e) {
      return {
        taskId: task.id,
        kind: fixture.kind,
        name: fixture.name,
        ok: false,
        failures: [e instanceof Error ? e.message : String(e)],
      }
    }

    if (!task.rebootCheck && declared.some((d) => d.phase === 'post')) {
      const ids = declared
        .filter((d) => d.phase === 'post')
        .map((d) => d.id)
        .join(', ')
      if (ids !== '') {
        failures.push(
          `declares @post but the task has reboot_check: false, so verdict B never runs (${ids})`,
        )
      }
    }
  }

  await deps.reset()

  // A setup script that fails leaves the fixture measuring the wrong machine,
  // so every downstream failure would be a red herring. Stop here instead.
  const setupResult = await deps.transport.exec(scripts.setup)
  if (setupResult.code !== 0) {
    failures.push(`setup.sh exited ${setupResult.code}: ${setupResult.stderr.trim()}`)
    return { taskId: task.id, kind: fixture.kind, name: fixture.name, ok: false, failures }
  }

  if (fixture.script.trim() !== '') await deps.transport.exec(fixture.script)

  const result = await grade({
    task,
    transport: deps.transport,
    gradeScript: scripts.grade,
    reboot: deps.reboot,
  })

  if (result.rebootError !== undefined) {
    failures.push(`reboot failed: ${result.rebootError}`)
  }

  // Once, against verdict A only. Duplicate ids are a property of the grader,
  // not of a particular run, so checking inside checkVerdict would report the
  // same duplicate twice on any task with reboot_check: true.
  const dupes = duplicateIds(result.verdictA)
  if (dupes.length > 0) {
    failures.push(`grader emitted duplicate checkpoint ids: ${dupes.join(', ')}`)
  }

  if (fixture.kind === 'none') {
    // "Nothing may pass" is wrong for any task with an invariant checkpoint —
    // `home-mounted` is supposed to pass before the student touches anything.
    // So the task declares which checkpoints are the *goal*, and exactly those
    // must fail at baseline. Everything else must pass.
    // const, not let: TypeScript cannot narrow a `let` inside the closure below.
    const baseline = (() => {
      try {
        return parseExpectations(scripts.grade, `${task.id}/grade.sh`, 'baseline-fail')
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e))
        return undefined
      }
    })()

    if (baseline) {
      const emitted = new Set(result.verdictA.checkpoints.map((c) => c.id))
      for (const d of baseline) {
        if (!emitted.has(d.id)) {
          failures.push(`baseline-fail names ${d.id}, which the grader never emits`)
        }
      }
      const want = (label: 'A' | 'B') => (id: string) => expectedStatus(baseline, id, label)
      checkVerdict(result.verdictA, 'A', want('A'), failures)
      if (result.verdictB) checkVerdict(result.verdictB, 'B', want('B'), failures)
    }
  } else {
    const want = (label: 'A' | 'B') => (id: string) =>
      fixture.kind === 'solution' ? 'pass' : expectedStatus(declared, id, label)

    checkVerdict(result.verdictA, 'A', want('A'), failures)
    if (result.verdictB) checkVerdict(result.verdictB, 'B', want('B'), failures)
    else if (task.rebootCheck && result.rebootError === undefined) {
      // No verdict B on a reboot-checking task means verdict A had no passes at
      // all, which a solution must never produce.
      if (fixture.kind === 'solution') {
        failures.push('verdict B was skipped: no checkpoint passed before the reboot')
      }
    }
  }

  // Keep the pass/fail comparison honest about ids that vanished between runs.
  if (result.verdictB) {
    const a = statusById(result.verdictA)
    for (const cp of result.verdictB.checkpoints) {
      if (!a.has(cp.id)) failures.push(`${cp.id} appeared only after the reboot`)
    }
  }

  return { taskId: task.id, kind: fixture.kind, name: fixture.name, ok: failures.length === 0, failures }
}

export async function validateTask(
  task: TaskSpec,
  scripts: TaskScripts,
  deps: HarnessDeps,
): Promise<FixtureResult[]> {
  const results: FixtureResult[] = []

  const gate = inventoryGate(task, scripts)

  // The fixture results come first and the gate last. Ordering matters: every
  // test that indexes `results[0]` means "the first fixture", and pushing the
  // gate ahead of the loop would silently retarget those assertions at the
  // inventory check instead.
  for (const fixture of scripts.fixtures) {
    results.push(await runFixture(task, scripts, fixture, deps))
  }

  if (!gate.ok) results.push(gate)

  return results
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 13 new tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/validate/harness.ts test/validate/harness.test.ts && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(validate): add the fixture matrix harness

I/O is split from orchestration so the entire assertion matrix runs against
FakeTransport with no VM. Anti-solutions must fail exactly their declared
checkpoints and no others, which is what proves the right check caught the
error rather than merely that something failed."
```

---

