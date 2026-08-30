import { describe, expect, it } from 'vitest'
import { validateBank } from '../../src/engine/validate/run.ts'
import type { TaskScripts } from '../../src/engine/validate/harness.ts'
import { FakeTransport } from '../../src/engine/vm/fake.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'

function task(id: string): TaskSpec {
  return {
    id,
    title: id,
    chapter: 15,
    scope: 'exam-objective',
    rhel: 9,
    objectives: ['storage.lvm.resize'],
    requiresConcepts: [],
    difficulty: 3,
    timeBudget: 600,
    weight: 'high',
    editions: ['r9'],
    rebootCheck: false,
    requiresDisks: 0,
    claims: [],
    transport: 'ssh',
    prompt: 'p',
    dir: `/content/${id}`,
  }
}

const PASSING: TaskScripts = {
  setup: 'SETUP',
  grade: '# baseline-fail: goal\nGRADE',
  fixtures: [
    { kind: 'none', name: 'no-action', script: '' },
    { kind: 'solution', name: '01.sh', script: 'DO' },
    { kind: 'solution', name: '02.sh', script: 'DO' },
    // A body is required: an empty script matches none of FakeTransport's
    // markers, so `done` would stay false and this fixture would validate
    // green while executing nothing. Use WRONG, not DO_WRONG or DONT: the
    // fake matches with `script.includes('DO')`, so any marker containing
    // the substring "DO" would set done = true and this fixture would fail
    // its own expect-fail declaration.
    { kind: 'antisolution', name: '01.sh', script: '# expect-fail: goal\nWRONG' },
  ],
}

function deps() {
  let done = false
  return {
    transport: new FakeTransport((script) => {
      if (script.includes('SETUP')) done = false
      else if (script.includes('DO')) done = true
      if (script.includes('GRADE')) {
        return {
          stdout: `{"id":"goal","desc":"g","status":"${done ? 'pass' : 'fail'}"}`,
          stderr: '',
          code: 0,
        }
      }
      return { stdout: '', stderr: '', code: 0 }
    }),
    reset: async () => {
      done = false
    },
    reboot: async () => {},
  }
}

describe('validateBank', () => {
  it('runs every fixture of every task and reports nothing failed', async () => {
    const seen: string[] = []
    const summary = await validateBank({
      tasks: [task('storage/014-a'), task('storage/015-b')],
      assertLib: '',
      deps: deps(),
      loadScripts: async () => PASSING,
      onTask: (id) => seen.push(id),
    })

    expect(seen).toEqual(['storage/014-a', 'storage/015-b'])
    expect(summary.results).toHaveLength(8)
    expect(summary.failed, JSON.stringify(summary.failed)).toEqual([])
  })

  it('reports an unloadable task as a failure instead of throwing', async () => {
    // One task with a missing grade.sh must not hide the state of the rest.
    const summary = await validateBank({
      tasks: [task('storage/014-a'), task('storage/015-b')],
      assertLib: '',
      deps: deps(),
      loadScripts: async (t) => {
        if (t.id === 'storage/014-a') throw new Error('ENOENT: grade.sh')
        return PASSING
      },
    })

    expect(summary.failed).toHaveLength(1)
    expect(summary.failed[0]?.name).toBe('load-scripts')
    expect(summary.failed[0]?.failures[0]).toMatch(/ENOENT: grade\.sh/)
    // The second task still ran.
    expect(summary.results.filter((r) => r.taskId === 'storage/015-b')).toHaveLength(4)
  })
})
