import { describe, expect, it, vi } from 'vitest'
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

/**
 * The same grader with one unterminated heredoc after the first `ck`, which is
 * how the deflation was measured on the real 019 grader. The lexer stops there
 * and counts 1; the `# baseline-fail:` header still names both ids, so the second
 * witness is what notices. Written as a heredoc fail-open rather than as a
 * hand-set total so the real counter is what produces the wrong number.
 */
const DEFLATED = '# baseline-fail: lv-home-size, fs-home-size\nck lv-home-size "d" $?\ncat <<NOPE\nck fs-home-size "e" $?\n'

/** The undeflated control: one checkpoint, declared, and the two witnesses agree. */
const HONEST_ONE = '# baseline-fail: lv-home-size\nck lv-home-size "d" $?\n'

/** A run in which the only checkpoint that arrived passed. */
const ONE_PASS: Partial<LabRuntime> = {
  gradeTask: async () => ({
    verdictA: parseVerdict('{"id":"lv-home-size","desc":"d","status":"pass"}'),
    regressions: [],
    rebooted: false,
  }),
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
 * A missing key at **any** depth returns `undefined`; a type mismatch throws,
 * naming the key and what was there instead. Measured, not assumed: a typo in an
 * intermediate key returns `undefined` and abandons the rest of the path, so
 * `at(...)` alone cannot prove a field is absent rather than mistyped. Use
 * `expectMissing` for that, and `items`/`str`/`num` everywhere else - they throw
 * on the wrong runtime type, which is what gives the other assertions teeth.
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

/**
 * Assert a field is absent *from a container that exists*. `at()` returns
 * `undefined` for a missing key at any depth, so `expect(at(x, 'a', 'b'))
 * .toBeUndefined()` also passes when `a` was renamed - it would report masking
 * that is no longer happening. This checks the parent first.
 */
function expectMissing(root: unknown, ...path: Array<string | number>): void {
  const key = path.at(-1)
  if (key === undefined) throw new Error('expectMissing needs at least one key')
  const parentPath = path.slice(0, -1)
  const parent = at(root, ...parentPath)
  if (!isRecord(parent)) {
    throw new Error(
      `expected a record at ${parentPath.join('.') || '<root>'}, got ${JSON.stringify(parent)}`,
    )
  }
  expect(Object.keys(parent)).not.toContain(String(key))
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

function app(over: Partial<LabRuntime> = {}, now?: () => number, scripts: TaskScripts = SCRIPTS) {
  const { rt, calls } = runtime(over)
  let clock = 1000
  const sessions = new SessionStore()
  const a = createApp({
    bank: bank(),
    runtime: rt,
    sessions,
    assertLib: '',
    loadScripts: async () => scripts,
    now: now ?? (() => (clock += 1000)),
  })
  return { a, calls, sessions }
}

/**
 * A clock that hands out named instants, so a derived rating can be *measured*
 * rather than reasoned about. Holds the last instant once the list runs out, so a
 * route that stops calling `now()` cannot make a test fail for the wrong reason.
 */
function clockOf(ticks: number[]): () => number {
  let i = 0
  return () => {
    const t = ticks[Math.min(i, ticks.length - 1)]
    i += 1
    return t ?? 0
  }
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
    expectMissing(body, 'tasks', 0, 'prompt')
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

  it('blames the body, not the task, when the body is not a JSON object', async () => {
    // Every one of these used to answer `unknown task: undefined`, which sends
    // the reader looking for a task id they never sent.
    const { a } = app()
    const headers = { 'content-type': 'application/json' }
    for (const body of ['not json', '[]', 'null', '"hello"']) {
      const res = await a.request('/api/sessions', { method: 'POST', body, headers })
      expect(res.status).toBe(400)
      expect(str(await res.json(), 'error')).toMatch(/body must be a JSON object/)
    }
    const empty = await a.request('/api/sessions', { method: 'POST', headers })
    expect(empty.status).toBe(400)
    expect(str(await empty.json(), 'error')).toMatch(/body must be a JSON object/)

    // An object that names no task is a different problem, and says so.
    const noTask = await a.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ mode: 'exam' }),
      headers,
    })
    expect(noTask.status).toBe(400)
    expect(str(await noTask.json(), 'error')).toMatch(/taskId/)

    // A task id that is a string but not in the bank still reports the id.
    const unknown = await a.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ taskId: 'storage/nope', mode: 'exam' }),
      headers,
    })
    expect(unknown.status).toBe(400)
    expect(str(await unknown.json(), 'error')).toMatch(/unknown task: storage\/nope/)
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

  it('refuses to open a session whose grade script counts no checkpoints at all', async () => {
    // At zero, every guard in `reportFor` is a comparison against zero:
    // `incomplete` is `size < 0`, false for every possible run, so a grader whose
    // whole body was swallowed reports a pass over an untouched machine. Nothing
    // downstream can withhold its way out of that, and refusing here is safe in
    // the way refusing at grade time would not be - no work exists yet.
    const { a } = app({}, undefined, { ...SCRIPTS, grade: 'echo no checkpoints here\n' })
    const res = await a.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ taskId: TASK.id, mode: 'practice' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(500)
    const error = str(await res.json(), 'error')
    expect(error).toContain(TASK.id)
    expect(error).toMatch(/lint:content/)
  })

  it('still opens a session when the count is merely disputed, because withholding is enough', async () => {
    // The one refusal in this fix is zero. A deflated count still opens: the
    // verdict and the rating are withheld later, which costs the student nothing,
    // while refusing costs them the practice.
    const { a } = app({}, undefined, { ...SCRIPTS, grade: DEFLATED })
    const res = await a.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ taskId: TASK.id, mode: 'practice' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(201)
    // And the deflated number is what it reports, because that is what it has.
    expect(at(await res.json(), 'checkpointTotal')).toBe(1)
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
    expectMissing(graded, 'checkpoints')
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

  it('refuses to grade or finish a session that is already finished', async () => {
    // The measured laundering sequence, in exam mode: grade, finish early to
    // learn *which* checkpoints failed, fix exactly those, grade again, finish
    // again - and collect `rating: 'easy'` for an attempt that used the key the
    // first finish handed over. Finishing is what unmasks, so it has to be
    // terminal and it has to happen once.
    const { a } = app()
    const id = await start(a, 'exam')

    await a.request(`/api/sessions/${id}/grade`, { method: 'POST' })
    const first = await a.request(`/api/sessions/${id}/finish`, { method: 'POST' })
    expect(first.status).toBe(200)
    const done = await first.json()
    const endedAt = num(done, 'endedAt')
    expect(at(done, 'rating')).toBe('hard')

    const regrade = await a.request(`/api/sessions/${id}/grade`, { method: 'POST' })
    expect(regrade.status).toBe(409)
    expect(str(await regrade.json(), 'error')).toMatch(/finished/)

    const refinish = await a.request(`/api/sessions/${id}/finish`, { method: 'POST' })
    expect(refinish.status).toBe(409)
    const refused = await refinish.json()
    expect(str(refused, 'error')).toMatch(/already finished/)
    // No second rating was derived, not even a null one.
    expectMissing(refused, 'rating')

    // And the attempt that was recorded is the one that happened.
    const after = await (await a.request(`/api/sessions/${id}`)).json()
    expect(num(after, 'endedAt')).toBe(endedAt)
    expect(at(after, 'phase')).toBe('graded')
  })

  it('lets no session route other than grade and finish emit a checkpoint id in exam mode', async () => {
    // F3 made finishing terminal, but nothing holds the property F3 exists to
    // protect on the routes F3 did not gate. Measured: adding one field to
    // `view()` - `result: s.result`, the obvious edit when Task 24 needs one more
    // value on the Lab screen - publishes the whole unmasked checkpoint list
    // through GET /api/sessions/:id and /reset, in exam mode, before any finish,
    // and the app suite stayed at 18 passed. The exam answer key would ship to
    // the browser with a green build.
    //
    // Read off the route table rather than a hand-written list, so a session
    // route added later is covered the day it is added.
    const { a } = app()
    const id = await start(a, 'exam')
    await a.request(`/api/sessions/${id}/grade`, { method: 'POST' })

    const routes = a.routes.filter(
      (r) => r.path.startsWith('/api/sessions/:id') && !/\/(grade|finish)$/.test(r.path),
    )
    // If the filter ever matches nothing, this test passes while checking
    // nothing at all.
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'GET /api/sessions/:id',
      'POST /api/sessions/:id/hint',
      'POST /api/sessions/:id/reset',
    ])

    for (const r of routes) {
      const res = await a.request(r.path.replace(':id', id), { method: r.method })
      expect(res.status).toBeLessThan(400)
      // The serialised body, not a parsed field: a leak through a nested or
      // renamed key is still a leak.
      const body = await res.text()
      for (const key of ['lv-home-size', 'fs-home-size']) {
        expect(body).not.toContain(key)
      }
    }
  })

  it('refuses to reset a finished session but keeps answering hints in practice mode', async () => {
    // Two halves of the same question, answered differently on purpose.
    //
    // `/reset` is incoherent after a finish: `restart` moves `startedAt` past the
    // `endedAt` that is already recorded, so anything reading `endedAt -
    // startedAt` as time spent gets a negative number - and /reset's own comment
    // already argues that a reset must not make the report describe an attempt
    // that did not happen.
    //
    // `/hint` is not, and stays open: the rating is a local derived once at
    // finish and never persisted, /finish is already 409 on a second call, and the
    // mode caps hold exam at rung 2 and drill at 3 - so nothing stored can be
    // contradicted and no graded mode can reach solution content afterwards. In
    // practice mode, reading rung 5 right after the attempt is scored is what the
    // app is for.
    const { a } = app()
    const id = await start(a, 'practice')
    await a.request(`/api/sessions/${id}/grade`, { method: 'POST' })
    const done = await (await a.request(`/api/sessions/${id}/finish`, { method: 'POST' })).json()
    const startedAt = num(done, 'startedAt')

    const reset = await a.request(`/api/sessions/${id}/reset`, { method: 'POST' })
    expect(reset.status).toBe(409)
    expect(str(await reset.json(), 'error')).toMatch(/finished/)

    // The clock the rating was derived from is untouched, which is the point.
    const after = await (await a.request(`/api/sessions/${id}`)).json()
    expect(num(after, 'startedAt')).toBe(startedAt)
    expect(num(after, 'endedAt')).toBeGreaterThan(startedAt)

    const hint = await a.request(`/api/sessions/${id}/hint`, { method: 'POST' })
    expect(hint.status).toBe(200)
    expect(at(await hint.json(), 'rung')).toBe(2)
  })

  it('does not let a reset between grade and finish launder the rating', async () => {
    // Measured before the fix, exam mode, fully passing verdict, 600 s budget:
    //
    //   grade -> finish            startedAt 0        endedAt 1200000  rating 'good'
    //   grade -> reset -> finish   startedAt 1200000  endedAt 1200500  rating 'easy'
    //
    // `restart` moves `startedAt` to the reset, while `s.result` used to survive
    // the VM revert - so /finish derived a rating from a verdict measured on a
    // machine that has since been wiped and re-setup'd, over a clock saying the
    // attempt took no time. A 20-minute solve on a 10-minute task came out as a
    // cold, inside-budget one. /reset's own comment already states the principle
    // ("a reset must not make the report describe an attempt that did not
    // happen"); its guard just keys on the post-finish window, and this one is
    // post-grade, pre-finish.
    const passing: Partial<LabRuntime> = {
      gradeTask: async () => ({
        verdictA: parseVerdict(
          [
            '{"id":"lv-home-size","desc":"d","status":"pass"}',
            '{"id":"fs-home-size","desc":"e","status":"pass"}',
          ].join('\n'),
        ),
        regressions: [],
        rebooted: false,
      }),
    }

    // The honest baseline: the same verdict over the same 20 minutes, no reset.
    const plain = app(passing, clockOf([0, 1_200_000]))
    const pid = await start(plain.a, 'exam')
    await plain.a.request(`/api/sessions/${pid}/grade`, { method: 'POST' })
    const straight = await (
      await plain.a.request(`/api/sessions/${pid}/finish`, { method: 'POST' })
    ).json()
    expect(at(straight, 'report', 'allPassed')).toBe(true)
    expect(at(straight, 'rating')).toBe('good')

    // The same attempt with a reset wedged in. A reverted machine has no valid
    // verdict, so the only honest answer is the 409 /finish already has - not a
    // rating, and certainly not 'easy'.
    const { a } = app(passing, clockOf([0, 1_200_000, 1_200_500]))
    const id = await start(a, 'exam')
    await a.request(`/api/sessions/${id}/grade`, { method: 'POST' })
    expect((await a.request(`/api/sessions/${id}/reset`, { method: 'POST' })).status).toBe(200)

    const laundered = await a.request(`/api/sessions/${id}/finish`, { method: 'POST' })
    expect(laundered.status).toBe(409)
    const refused = await laundered.json()
    expect(str(refused, 'error')).toMatch(/nothing has been graded/)
    expectMissing(refused, 'rating')

    // And reset-to-retry still works, which a 409 on /reset-after-grade would
    // not: grading the reverted machine produces a verdict that describes it, and
    // the rating is then derived from the post-reset clock, which is the attempt
    // that actually happened.
    expect((await a.request(`/api/sessions/${id}/grade`, { method: 'POST' })).status).toBe(200)
    const retried = await a.request(`/api/sessions/${id}/finish`, { method: 'POST' })
    expect(retried.status).toBe(200)
    const scored = await retried.json()
    expect(num(scored, 'startedAt')).toBe(1_200_000)
    expect(at(scored, 'rating')).toBe('easy')
  })

  it('withholds the rating on a deflated count while still letting the session close', async () => {
    // The whole of F1 and F2 end to end, with a control beside it so the test
    // cannot pass by withholding everything.
    //
    // The honest arm: one declared checkpoint, one arrival, it passed, rung 1, 20
    // minutes against a 10-minute budget - deriveRating calls that 'good'.
    const honest = app(ONE_PASS, clockOf([0, 1_200_000]), { ...SCRIPTS, grade: HONEST_ONE })
    const hid = await start(honest.a, 'exam')
    await honest.a.request(`/api/sessions/${hid}/grade`, { method: 'POST' })
    const scored = await (
      await honest.a.request(`/api/sessions/${hid}/finish`, { method: 'POST' })
    ).json()
    expect(at(scored, 'report', 'countDisputed')).toBe(false)
    expect(at(scored, 'rating')).toBe('good')

    // The deflated arm: identical run, identical arrivals, and the count is wrong.
    // Every pre-existing signal reads clean - `incomplete` is false because 1 is
    // not less than 1, nothing over-arrived, and `allPassed` is true - which is
    // exactly why the rating used to be written anyway.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { a } = app(ONE_PASS, clockOf([0, 1_200_000]), { ...SCRIPTS, grade: DEFLATED })
      const id = await start(a, 'exam')
      const graded = await (await a.request(`/api/sessions/${id}/grade`, { method: 'POST' })).json()
      expect(at(graded, 'incomplete')).toBe(false)
      expect(num(graded, 'total')).toBe(num(graded, 'expectedTotal'))
      expect(at(graded, 'allPassed')).toBe(true)
      // The disagreement reaches the client as a field. A console.warn reaches
      // neither the client nor the rating path, which is half of why this got out.
      expect(at(graded, 'countDisputed')).toBe(true)

      const res = await a.request(`/api/sessions/${id}/finish`, { method: 'POST' })
      // Never withhold the exit: the attempt is over and the session is closable.
      expect(res.status).toBe(200)
      const done = await res.json()
      expect(at(done, 'phase')).toBe('graded')
      expect(at(done, 'report', 'countDisputed')).toBe(true)
      // Withheld, not failed. `null` is the shape guided mode already produces.
      expect(at(done, 'rating')).toBeNull()
      // Revealed on finish, because the grader's author is who can act on it.
      expect(items(done, 'report', 'disputedIds')).toEqual(['fs-home-size'])
    } finally {
      warn.mockRestore()
    }
  })

  it('masks the disputed ids while the attempt is still running in exam mode', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { a } = app(ONE_PASS, undefined, { ...SCRIPTS, grade: DEFLATED })
      const id = await start(a, 'exam')
      const graded = await a.request(`/api/sessions/${id}/grade`, { method: 'POST' })
      const body = await graded.json()
      expect(at(body, 'countDisputed')).toBe(true)
      expectMissing(body, 'disputedIds')
      // The serialised body, not a parsed field: a leaked id is a leaked id.
      expect(JSON.stringify(body)).not.toContain('fs-home-size')
    } finally {
      warn.mockRestore()
    }
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
