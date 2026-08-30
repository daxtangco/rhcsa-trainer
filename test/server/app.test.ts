import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/server/app.ts'
import { SessionStore } from '../../src/server/session.ts'
import type { LabRuntime } from '../../src/server/lab.ts'
import type { Bank } from '../../src/engine/content/bank.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'
import type { ConceptSpec } from '../../src/engine/content/concept.ts'
import type { TaskScripts } from '../../src/engine/validate/harness.ts'
import { parseVerdict } from '../../src/engine/grading/verdict.ts'

const TASK = {
  id: 'storage/014-grow-home-lv',
  title: 'Grow /home to 12 GiB',
  chapter: 15,
  scope: 'exam-objective',
  rhel: 9,
  objectives: ['storage.lvm.resize'],
  requiresConcepts: ['storage.lvm-abstraction-stack'],
  difficulty: 3,
  timeBudget: 600,
  weight: 'high',
  editions: ['r9'],
  rebootCheck: true,
  requiresDisks: 0,
  claims: [],
  transport: 'ssh',
  prompt: 'Grow the home logical volume to 12 GiB.',
  dir: '/content/tasks/storage/014-grow-home-lv',
} satisfies TaskSpec

/**
 * A task that can only be driven from the VMware console. Its whole purpose is
 * to make `taskTransport` and `transport` disagree, which is the only way to
 * tell that the two fields mean different things.
 */
const TASK_VMRUN = {
  id: 'troubleshooting/028-restore-remote-access',
  title: 'Restore remote access',
  chapter: 28,
  scope: 'exam-objective',
  rhel: 9,
  objectives: ['storage.lvm.resize'],
  requiresConcepts: [],
  difficulty: 4,
  timeBudget: 900,
  weight: 'high',
  editions: ['r9'],
  rebootCheck: false,
  requiresDisks: 0,
  claims: [],
  transport: 'vmrun',
  prompt: 'sshd is down and the firewall is closed. Get remote access back.',
  dir: '/content/tasks/troubleshooting/028-restore-remote-access',
} satisfies TaskSpec

const CONCEPT = {
  id: 'storage.lvm-abstraction-stack',
  title: 'Physical volumes, volume groups, logical volumes',
  rhel: 9,
  objectives: ['storage.lvm.resize'],
  sources: ['r9:ch15'],
  prerequisites: [],
  body: 'LVM puts two layers between a disk and a filesystem.',
  path: '/content/concepts/storage/lvm-abstraction-stack.md',
} satisfies ConceptSpec

const SCRIPTS: TaskScripts = {
  setup: 'echo setup',
  grade: '# baseline-fail: lv-home-size\nck lv-home-size "d" $?\nck fs-home-size "e" $?\n',
  fixtures: [
    { kind: 'solution', name: '01.sh', script: 'sudo lvextend -L 12G /dev/rhel/home\n' },
  ],
}

function bank(): Bank {
  const objective = { id: 'storage.lvm.resize', text: 'Extend existing logical volumes', chapters: [15] }
  return {
    root: '/content',
    objectives: {
      version: 'rhel9',
      source: 'test',
      objectives: [objective],
      byId: new Map([[objective.id, objective]]),
    },
    tasks: [TASK, TASK_VMRUN],
    concepts: [CONCEPT],
    // Type argument, not a cast: the two fixtures differ in `rebootCheck`, so
    // inference picks the first one's literal type and rejects the second.
    tasksById: new Map<string, TaskSpec>([
      [TASK.id, TASK],
      [TASK_VMRUN.id, TASK_VMRUN],
    ]),
    conceptsById: new Map([[CONCEPT.id, CONCEPT]]),
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Walk a decoded JSON body. `res.json()` resolves to `unknown`, not `any` —
 * correct, because nothing about a response body is known at compile time — so
 * these four helpers exist to read it without an `as` cast.
 *
 * A wrong *path* throws, naming the key and what was there instead; a missing
 * *leaf* returns undefined, because "this field is absent" is something several
 * tests assert (masking). The distinction matters: a renamed field must fail the
 * test that reads it, not quietly compare undefined to undefined.
 */
function at(root: unknown, ...path: Array<string | number>): unknown {
  let cur: unknown = root
  for (const key of path) {
    if (Array.isArray(cur) && typeof key === 'number') {
      const next: unknown = cur[key]
      cur = next
      continue
    }
    if (isRecord(cur) && typeof key === 'string') {
      if (!Object.hasOwn(cur, key)) return undefined
      cur = cur[key]
      continue
    }
    throw new Error(`cannot read ${JSON.stringify(key)} of ${JSON.stringify(cur)}`)
  }
  return cur
}

function items(root: unknown, ...path: Array<string | number>): unknown[] {
  const v = at(root, ...path)
  if (!Array.isArray(v)) {
    throw new Error(`expected an array at ${path.join('.')}, got ${JSON.stringify(v)}`)
  }
  return v
}

function str(root: unknown, ...path: Array<string | number>): string {
  const v = at(root, ...path)
  if (typeof v !== 'string') {
    throw new Error(`expected a string at ${path.join('.')}, got ${JSON.stringify(v)}`)
  }
  return v
}

function num(root: unknown, ...path: Array<string | number>): number {
  const v = at(root, ...path)
  if (typeof v !== 'number') {
    throw new Error(`expected a number at ${path.join('.')}, got ${JSON.stringify(v)}`)
  }
  return v
}

function runtime(over: Partial<LabRuntime> = {}) {
  const calls: string[] = []
  const rt: LabRuntime = {
    transportKind: 'ssh',
    reset: async () => {
      calls.push('reset')
    },
    exec: async (script) => {
      calls.push(`exec:${script.trim()}`)
      return { stdout: '', stderr: '', code: 0 }
    },
    gradeTask: async () => {
      calls.push('grade')
      return {
        verdictA: parseVerdict(
          [
            '{"id":"lv-home-size","desc":"d","status":"pass"}',
            '{"id":"fs-home-size","desc":"e","status":"fail"}',
          ].join('\n'),
        ),
        regressions: [],
        rebooted: false,
      }
    },
    ...over,
  }
  return { rt, calls }
}

function app(over: Partial<LabRuntime> = {}) {
  const { rt, calls } = runtime(over)
  let clock = 1000
  const sessions = new SessionStore()
  const a = createApp({
    bank: bank(),
    runtime: rt,
    sessions,
    assertLib: '',
    loadScripts: async () => SCRIPTS,
    now: () => (clock += 1000),
  })
  return { a, calls, sessions }
}

async function start(a: ReturnType<typeof app>['a'], mode: string, taskId: string = TASK.id) {
  const res = await a.request('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ taskId, mode }),
    headers: { 'content-type': 'application/json' },
  })
  return str(await res.json(), 'id')
}

describe('GET /api/tasks', () => {
  it('lists tasks without the prompt', async () => {
    const { a } = app()
    const res = await a.request('/api/tasks')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(items(body, 'tasks')).toHaveLength(2)
    expect(at(body, 'tasks', 0, 'id')).toBe('storage/014-grow-home-lv')
    // The list is for choosing; the prompt belongs to a session.
    expect(at(body, 'tasks', 0, 'prompt')).toBeUndefined()
  })
})

describe('GET /api/tasks/:area/:slug', () => {
  it('returns the detail for an id containing a slash', async () => {
    const { a } = app()
    const res = await a.request('/api/tasks/storage/014-grow-home-lv')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(at(body, 'title')).toBe('Grow /home to 12 GiB')
    expect(at(body, 'objectives', 0, 'text')).toBe('Extend existing logical volumes')
  })

  it('404s for an unknown task', async () => {
    const { a } = app()
    const res = await a.request('/api/tasks/storage/nope')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/sessions', () => {
  it('reverts the snapshot, runs setup, and returns a masked checkpoint total', async () => {
    const { a, calls } = app()
    const res = await a.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ taskId: TASK.id, mode: 'exam' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(at(body, 'id')).toBe('s1')
    expect(at(body, 'prompt')).toContain('Grow the home logical volume')
    expect(at(body, 'checkpointTotal')).toBe(2)
    expect(at(body, 'rung')).toBe(1)
    expect(at(body, 'maxRung')).toBe(2)
    expect(at(body, 'transport')).toBe('ssh')
    // Order matters: a setup that runs before the revert is undone by it.
    expect(calls).toEqual(['reset', 'exec:echo setup'])
  })

  it('reports the task transport and the server transport as separate fields', async () => {
    // These are different questions and were once the same field, which made
    // Task 24's "this task needs the VMware console" warning unreachable: it
    // compared a value to itself.
    const { a } = app()
    const res = await a.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ taskId: TASK_VMRUN.id, mode: 'practice' }),
      headers: { 'content-type': 'application/json' },
    })

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(at(body, 'taskTransport')).toBe('vmrun')
    expect(at(body, 'transport')).toBe('ssh')
  })

  it('rejects an unknown mode', async () => {
    const { a } = app()
    const res = await a.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ taskId: TASK.id, mode: 'sudden-death' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(400)
    expect(str(await res.json(), 'error')).toMatch(/mode/)
  })

  it('500s with the setup output when setup fails', async () => {
    // A failed setup produces a cascade of misleading checkpoint failures, so
    // it must never look like a successful start.
    const { a } = app({
      exec: async () => ({ stdout: '', stderr: 'no free extents', code: 1 }),
    })
    const res = await a.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ taskId: TASK.id, mode: 'practice' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(500)
    expect(str(await res.json(), 'error')).toMatch(/no free extents/)
  })
})

describe('POST /api/sessions/:id/hint', () => {
  it('walks up the ladder one rung at a time', async () => {
    const { a } = app()
    const id = await start(a, 'practice')

    const first = await (await a.request(`/api/sessions/${id}/hint`, { method: 'POST' })).json()
    expect(at(first, 'rung')).toBe(2)
    expect(at(first, 'content', 'kind')).toBe('nudge')

    const second = await (await a.request(`/api/sessions/${id}/hint`, { method: 'POST' })).json()
    expect(at(second, 'rung')).toBe(3)
    expect(at(second, 'content', 'body')).toContain('LVM puts two layers')
  })

  it('refuses to go past the mode cap', async () => {
    const { a } = app()
    const id = await start(a, 'exam')
    await a.request(`/api/sessions/${id}/hint`, { method: 'POST' })
    const res = await a.request(`/api/sessions/${id}/hint`, { method: 'POST' })
    expect(res.status).toBe(409)
    expect(str(await res.json(), 'error')).toMatch(/maximum in exam mode/)
  })

  it('gives guided mode everything at once', async () => {
    const { a } = app()
    const id = await start(a, 'guided')
    const res = await a.request(`/api/sessions/${id}/hint`, { method: 'POST' })
    const body = await res.json()
    expect(at(body, 'rung')).toBe(5)
    // Guided mode is full disclosure, so every rung comes back, not just the top.
    expect(items(body, 'all').map((r) => at(r, 'kind'))).toEqual([
      'prompt',
      'nudge',
      'concepts',
      'sketch',
      'solution',
    ])
  })
})

describe('POST /api/sessions/:id/reset', () => {
  it('reverts, re-runs setup, restarts the clock and keeps the rung', async () => {
    const { a, calls } = app()
    const id = await start(a, 'practice')
    await a.request(`/api/sessions/${id}/hint`, { method: 'POST' })
    const before = await (await a.request(`/api/sessions/${id}`)).json()

    const res = await a.request(`/api/sessions/${id}/reset`, { method: 'POST' })
    expect(res.status).toBe(200)
    const after = await res.json()

    expect(calls).toEqual(['reset', 'exec:echo setup', 'reset', 'exec:echo setup'])
    // The clock restarts and nothing else does. A reset that also rolled the
    // rung back would make hints refundable.
    expect(num(after, 'startedAt')).toBeGreaterThan(num(before, 'startedAt'))
    expect(at(after, 'rung')).toBe(2)
    expect(at(after, 'phase')).toBe('active')
  })

  it('404s for an unknown session', async () => {
    const { a } = app()
    const res = await a.request('/api/sessions/nope/reset', { method: 'POST' })
    expect(res.status).toBe(404)
  })
})

describe('grading and finishing', () => {
  it('masks which checkpoints failed in exam mode and unmasks them on finish', async () => {
    const { a } = app()
    const id = await start(a, 'exam')

    const graded = await (await a.request(`/api/sessions/${id}/grade`, { method: 'POST' })).json()
    expect(at(graded, 'passed')).toBe(1)
    expect(at(graded, 'total')).toBe(2)
    expect(at(graded, 'checkpoints')).toBeUndefined()
    expect(at(graded, 'phase')).toBe('active')

    const done = await (await a.request(`/api/sessions/${id}/finish`, { method: 'POST' })).json()
    expect(at(done, 'phase')).toBe('graded')
    expect(items(done, 'report', 'checkpoints').map((c) => at(c, 'id'))).toEqual([
      'lv-home-size',
      'fs-home-size',
    ])
    // rung 1, partial pass, no regression: deriveRating calls that 'hard'.
    expect(at(done, 'rating')).toBe('hard')
  })

  it('names the checkpoints immediately in practice mode', async () => {
    const { a } = app()
    const id = await start(a, 'practice')
    const graded = await (await a.request(`/api/sessions/${id}/grade`, { method: 'POST' })).json()
    expect(items(graded, 'checkpoints').map((c) => at(c, 'id'))).toEqual([
      'lv-home-size',
      'fs-home-size',
    ])
    // The truncation guard travels to the client, so Task 24 can render it.
    expect(at(graded, 'expectedTotal')).toBe(2)
    expect(at(graded, 'incomplete')).toBe(false)
  })

  it('409s on finish before anything was graded', async () => {
    const { a } = app()
    const id = await start(a, 'practice')
    const res = await a.request(`/api/sessions/${id}/finish`, { method: 'POST' })
    expect(res.status).toBe(409)
    expect(str(await res.json(), 'error')).toMatch(/nothing has been graded/)
  })
})

describe('GET /api/concepts/:id', () => {
  it('returns the card body', async () => {
    const { a } = app()
    const res = await a.request('/api/concepts/storage.lvm-abstraction-stack')
    expect(res.status).toBe(200)
    expect(str(await res.json(), 'body')).toContain('LVM puts two layers')
  })
})
