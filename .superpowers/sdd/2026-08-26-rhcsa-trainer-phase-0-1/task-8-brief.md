### Task 8: Grading sequence with the reboot check

The highest-value output in the system (spec §5.4): the pass → fail transition that identifies a persistence failure.

**Files:**
- Create: `src/engine/grading/grader.ts`
- Test: `test/grading/grader.test.ts`

**Interfaces:**
- Consumes: `LabTransport` (T2), `TaskSpec` (T3), `parseVerdict`/`Verdict`/`Checkpoint`/`statusById` (T5).
- Produces:
  - `interface GradeOptions { task: TaskSpec; transport: LabTransport; gradeScript: string; reboot: () => Promise<void> }`
  - `interface GradeResult { verdictA: Verdict; verdictB?: Verdict; regressions: Checkpoint[]; rebooted: boolean; rebootError?: string }`
  - `function grade(opts: GradeOptions): Promise<GradeResult>`
  - `function finalVerdict(r: GradeResult): Verdict`

**Design note — why `reboot` is injected.** The grading sequence is pure orchestration logic and is the part most worth testing exhaustively. Passing the reboot as a function keeps it decoupled from `VmController` (T17), so every branch — including "the VM never came back" — is testable with no hypervisor.

- [ ] **Step 1: Write the failing test**

`test/grading/grader.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { finalVerdict, grade } from '../../src/engine/grading/grader.ts'
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
    prompt: 'Grow var to 6G.',
    dir: '/nowhere',
    ...over,
  }
}

const PASS_PASS = [
  '{"id":"lv-var-size","desc":"var LV >= 6G","status":"pass"}',
  '{"id":"var-from-lv","desc":"/var mounted from the LV","status":"pass"}',
].join('\n')

const PASS_FAIL = [
  '{"id":"lv-var-size","desc":"var LV >= 6G","status":"pass"}',
  '{"id":"var-from-lv","desc":"/var mounted from the LV","status":"fail","detail":"not mounted"}',
].join('\n')

describe('grade', () => {
  it('skips the reboot entirely when the task does not ask for one', async () => {
    const reboot = vi.fn(async () => {})
    const t = new FakeTransport(() => ({ stdout: PASS_PASS, stderr: '', code: 0 }))

    const r = await grade({
      task: task({ rebootCheck: false }),
      transport: t,
      gradeScript: 'grade',
      reboot,
    })

    expect(reboot).not.toHaveBeenCalled()
    expect(r.rebooted).toBe(false)
    expect(r.verdictB).toBeUndefined()
    expect(r.regressions).toEqual([])
    expect(t.calls).toHaveLength(1)
  })

  it('skips the reboot when nothing passed, because there is nothing to persist', async () => {
    const reboot = vi.fn(async () => {})
    const allFail = '{"id":"lv-var-size","desc":"var LV >= 6G","status":"fail"}'
    const t = new FakeTransport(() => ({ stdout: allFail, stderr: '', code: 0 }))

    const r = await grade({ task: task(), transport: t, gradeScript: 'grade', reboot })

    expect(reboot).not.toHaveBeenCalled()
    expect(r.verdictB).toBeUndefined()
  })

  it('reboots and grades again when reboot_check is set and something passed', async () => {
    const reboot = vi.fn(async () => {})
    let rebooted = false
    const t = new FakeTransport(() => ({
      stdout: rebooted ? PASS_FAIL : PASS_PASS,
      stderr: '',
      code: 0,
    }))
    reboot.mockImplementation(async () => {
      rebooted = true
    })

    const r = await grade({ task: task(), transport: t, gradeScript: 'grade', reboot })

    expect(reboot).toHaveBeenCalledTimes(1)
    expect(r.rebooted).toBe(true)
    expect(t.calls).toHaveLength(2)
    expect(r.verdictB?.checkpoints).toHaveLength(2)
  })

  it('names the pass-to-fail checkpoints as regressions', async () => {
    let rebooted = false
    const t = new FakeTransport(() => ({
      stdout: rebooted ? PASS_FAIL : PASS_PASS,
      stderr: '',
      code: 0,
    }))

    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {
        rebooted = true
      },
    })

    expect(r.regressions.map((c) => c.id)).toEqual(['var-from-lv'])
    expect(r.regressions[0]?.detail).toBe('not mounted')
  })

  it('does not count an already-failing checkpoint as a regression', async () => {
    const t = new FakeTransport(() => ({ stdout: PASS_FAIL, stderr: '', code: 0 }))
    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {},
    })
    expect(r.regressions).toEqual([])
  })

  it('records a reboot failure as a result rather than throwing', async () => {
    // The user broke boot. That is itself a finding, not a crash.
    const t = new FakeTransport(() => ({ stdout: PASS_PASS, stderr: '', code: 0 }))
    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {
        throw new Error('timed out waiting for SSH after 120s')
      },
    })

    expect(r.rebooted).toBe(false)
    expect(r.rebootError).toMatch(/timed out waiting for SSH/)
    expect(r.verdictB).toBeUndefined()
    expect(r.verdictA.checkpoints).toHaveLength(2)
  })

  it('ignores the grader exit code', async () => {
    // Spec section 6.5 rule 3: one failing check must not abort the rest, so a
    // non-zero exit is normal and must not be treated as an error.
    const t = new FakeTransport(() => ({ stdout: PASS_FAIL, stderr: 'lvs: warning', code: 1 }))
    const r = await grade({
      task: task({ rebootCheck: false }),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {},
    })
    expect(r.verdictA.checkpoints).toHaveLength(2)
  })
})

describe('finalVerdict', () => {
  it('returns verdict B when a reboot happened, because B is the real answer', async () => {
    let rebooted = false
    const t = new FakeTransport(() => ({
      stdout: rebooted ? PASS_FAIL : PASS_PASS,
      stderr: '',
      code: 0,
    }))
    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {
        rebooted = true
      },
    })
    expect(finalVerdict(r)).toBe(r.verdictB)
  })

  it('falls back to verdict A when no reboot happened', async () => {
    const t = new FakeTransport(() => ({ stdout: PASS_PASS, stderr: '', code: 0 }))
    const r = await grade({
      task: task({ rebootCheck: false }),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {},
    })
    expect(finalVerdict(r)).toBe(r.verdictA)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/grading/grader.test.ts`
Expected: FAIL — `Cannot find module '../../src/engine/grading/grader.ts'`.

- [ ] **Step 3: Write the implementation**

`src/engine/grading/grader.ts`:

```ts
import type { TaskSpec } from '../content/task.ts'
import type { LabTransport } from '../vm/transport.ts'
import { parseVerdict, statusById, type Checkpoint, type Verdict } from './verdict.ts'

export interface GradeOptions {
  task: TaskSpec
  transport: LabTransport
  /** Full text of grade.sh, with the assertion library prepended. */
  gradeScript: string
  /** Reboots the guest and resolves once it is reachable again. */
  reboot: () => Promise<void>
}

export interface GradeResult {
  /** "Works now". */
  verdictA: Verdict
  /** "Survives reboot". Absent when no reboot was performed. */
  verdictB?: Verdict
  /** Checkpoints that passed in A and failed in B: persistence failures. */
  regressions: Checkpoint[]
  rebooted: boolean
  /** Set when the VM did not come back. The user broke boot. */
  rebootError?: string
}

/** The verdict that actually counts: B when there was a reboot, else A. */
export function finalVerdict(r: GradeResult): Verdict {
  return r.verdictB ?? r.verdictA
}

export async function grade(opts: GradeOptions): Promise<GradeResult> {
  const { task, transport, gradeScript, reboot } = opts

  // Exit code is deliberately ignored (spec section 6.5 rule 3).
  const runA = await transport.exec(gradeScript)
  const verdictA = parseVerdict(runA.stdout)

  const anythingPassed = verdictA.checkpoints.some((cp) => cp.status === 'pass')

  // No point rebooting to test persistence of work that was never done.
  if (!task.rebootCheck || !anythingPassed) {
    return { verdictA, regressions: [], rebooted: false }
  }

  try {
    await reboot()
  } catch (e) {
    return {
      verdictA,
      regressions: [],
      rebooted: false,
      rebootError: e instanceof Error ? e.message : String(e),
    }
  }

  const runB = await transport.exec(gradeScript)
  const verdictB = parseVerdict(runB.stdout)

  const before = statusById(verdictA)
  const regressions = verdictB.checkpoints.filter(
    (cp) => cp.status === 'fail' && before.get(cp.id) === 'pass',
  )

  return { verdictA, verdictB, regressions, rebooted: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 9 new tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/grading/grader.ts test/grading/grader.test.ts && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(grading): add the verdict A/B sequence and regression detection

Injecting reboot as a function keeps every branch testable without a
hypervisor, including the case where the VM never returns - which is a result
about the user's work, not an exception."
```

---

