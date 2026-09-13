import { describe, expect, it } from 'vitest'
import type { Bank } from '../../src/engine/content/bank.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'
import { ContentError } from '../../src/engine/content/errors.ts'
import { parseVerdict, type Verdict } from '../../src/engine/grading/verdict.ts'
import { MEMORY_DB, openHistoryDb } from '../../src/engine/store/schema.ts'
import { VmStateStore } from '../../src/engine/store/vm-state.ts'
import type { Fixture, TaskScripts } from '../../src/engine/validate/harness.ts'
import { createApp } from '../../src/server/app.ts'
import type { LabRuntime } from '../../src/server/lab.ts'
import { SessionStore } from '../../src/server/session.ts'

/**
 * The three demonstration routes (spec section 7.2), against a fake runtime.
 *
 * **No guest is touched here and none can be.** What is asserted is the *protocol*:
 * which requests are refused and with which code, that a demo becomes a pollable
 * resource rather than a held-open connection, that one guest means one demo, and that
 * a finished demo leaves `vm_state` unknown so the next `/grade` is refused. Whether a
 * real reboot really flips a real checkpoint is `npm run validate`'s measurement, and
 * it is not made here.
 *
 * The runtime is gated deliberately: `reset` blocks on a promise the test resolves, so
 * the `running` phase — which on a real guest lasts about a minute and is the entire
 * reason for the 202 — is observable in a millisecond.
 */

const TASK = {
  id: 'storage/014-grow-home-lv',
  title: 'Grow /home to 12 GiB',
  chapter: 15,
  scope: 'exam-objective',
  rhel: 9,
  objectives: ['storage.lvm.resize'],
  requiresConcepts: [],
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
    tasks: [TASK],
    concepts: [],
    tasksById: new Map([[TASK.id, TASK]]),
    conceptsById: new Map(),
  }
}

const GRADE = '# baseline-fail: lv-home-size, fs-home-size\nck lv-home-size "d" $?\nck fs-home-size "e" $?\n'

/** Declares `fs-home-size@post`: a reboot demo, section 7.2's headline case. */
const PERSISTENCE: Fixture = {
  kind: 'antisolution',
  name: '02-removed-persistence.sh',
  script: '#!/bin/bash\n# expect-fail: fs-home-size@post\ntrue\n',
}

/** No phase, so `both`: caught in verdict A. */
const CHCON: Fixture = {
  kind: 'antisolution',
  name: '01-chcon-only.sh',
  script: '#!/bin/bash\n# expect-fail: lv-home-size\ntrue\n',
}

/** On disk, and unusable: no header at all. */
const BROKEN: Fixture = { kind: 'antisolution', name: '03-no-header.sh', script: '#!/bin/bash\ntrue\n' }

const SCRIPTS: TaskScripts = {
  setup: 'echo setup',
  grade: GRADE,
  fixtures: [
    { kind: 'none', name: 'no-action', script: '' },
    { kind: 'solution', name: '01-lvextend.sh', script: 'true\n' },
    PERSISTENCE,
    CHCON,
  ],
}

const ALL_PASS = parseVerdict(
  [
    '{"id":"lv-home-size","desc":"d","status":"pass"}',
    '{"id":"fs-home-size","desc":"e","status":"pass"}',
  ].join('\n'),
)

const AFTER_REBOOT = parseVerdict(
  [
    '{"id":"lv-home-size","desc":"d","status":"pass"}',
    '{"id":"fs-home-size","desc":"e","status":"fail","detail":"/home is 8G, not 12G"}',
  ].join('\n'),
)

/** A promise plus its resolver, so a test can decide when a stage completes. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open = (): void => {}
  const wait = new Promise<void>((resolve) => {
    open = () => resolve()
  })
  return { wait, open }
}

interface Harness {
  request: (path: string, init?: RequestInit) => Promise<Response>
  vmState: VmStateStore
  /** Everything the fake runtime consults, mutable between requests. */
  runtimeState: {
    resetGate?: Promise<void>
    resetThrows?: string
    setupCode: number
    fixtureCode: number
    verdictA: Verdict
    verdictB?: Verdict
    regressions: string[]
  }
  scripts: { current: TaskScripts; error?: Error }
  close: () => void
}

function harness(): Harness {
  const runtimeState: Harness['runtimeState'] = {
    setupCode: 0,
    fixtureCode: 0,
    verdictA: ALL_PASS,
    verdictB: AFTER_REBOOT,
    regressions: ['fs-home-size'],
  }
  const scripts: Harness['scripts'] = { current: SCRIPTS }

  const runtime: LabRuntime = {
    transportKind: 'ssh',
    snapshot: 'clean',
    reset: async () => {
      if (runtimeState.resetThrows !== undefined) throw new Error(runtimeState.resetThrows)
      if (runtimeState.resetGate !== undefined) await runtimeState.resetGate
    },
    exec: async (script: string) => {
      const code = script.includes('echo setup') ? runtimeState.setupCode : runtimeState.fixtureCode
      return { stdout: '', stderr: code === 0 ? '' : 'exploded', code }
    },
    gradeTask: async () => {
      const b = runtimeState.verdictB
      const byId = new Map((b ?? runtimeState.verdictA).checkpoints.map((cp) => [cp.id, cp]))
      return {
        verdictA: runtimeState.verdictA,
        ...(b === undefined ? {} : { verdictB: b }),
        regressions: runtimeState.regressions
          .map((id) => byId.get(id))
          .filter((cp): cp is NonNullable<typeof cp> => cp !== undefined),
        rebooted: b !== undefined,
      }
    },
  }

  const db = openHistoryDb({ path: MEMORY_DB })
  const vmState = new VmStateStore(db, { now: () => 7000 })
  let clock = 1_000_000
  const app = createApp({
    bank: bank(),
    runtime,
    sessions: new SessionStore(),
    assertLib: '',
    loadScripts: async () => {
      if (scripts.error !== undefined) throw scripts.error
      return scripts.current
    },
    now: () => (clock += 1000),
    vmState,
  })

  return {
    request: async (path, init) => app.request(path, init),
    vmState,
    runtimeState,
    scripts,
    close: () => db.close(),
  }
}

const JSON_HEADERS = { 'content-type': 'application/json' }

async function start(h: Harness): Promise<string> {
  const res = await h.request('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ taskId: TASK.id, mode: 'practice' }),
    headers: JSON_HEADERS,
  })
  const body = (await res.json()) as { id?: unknown }
  if (typeof body.id !== 'string') throw new Error(`no session id in ${JSON.stringify(body)}`)
  return body.id
}

/**
 * A session in `phase: 'graded'` — which `session.ts` sets at `/finish`, not at
 * `/grade`. That naming is worth stating once here, because it is what
 * `POST /api/demos`' 409 turns on: the demo is offered after the *attempt* is over,
 * per section 7.2's "after a task completes", and a session that has merely been
 * graded is still live and still revertible out from under the student.
 */
async function finished(h: Harness): Promise<string> {
  const id = await start(h)
  expect((await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })).status).toBe(200)
  expect((await h.request(`/api/sessions/${id}/finish`, { method: 'POST' })).status).toBe(200)
  return id
}

function startDemo(h: Harness, body: unknown): Promise<Response> {
  return h.request('/api/demos', { method: 'POST', body: JSON.stringify(body), headers: JSON_HEADERS })
}

/** Poll until the demo settles, the way a client does. Fails rather than hanging. */
async function settled(h: Harness, id: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 200; i += 1) {
    const body = (await (await h.request(`/api/demos/${id}`)).json()) as Record<string, unknown>
    if (body.phase !== 'running') return body
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error(`demo ${id} never settled`)
}

describe('GET /api/tasks/:area/:slug/antisolutions', () => {
  it('lists the menu section 7.2 describes, classified and with a start URL', async () => {
    const h = harness()
    try {
      const res = await h.request(`/api/tasks/${TASK.id}/antisolutions`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        taskId: TASK.id,
        rebootCheck: true,
        demos: [
          {
            name: '02-removed-persistence.sh',
            kind: 'reboot',
            headline: expect.stringContaining('fails after the reboot'),
            expectedFlips: ['fs-home-size'],
            declared: ['fs-home-size@post'],
            start: '/api/demos',
          },
          {
            name: '01-chcon-only.sh',
            kind: 'immediate',
            headline: expect.stringContaining('immediately'),
            expectedFlips: [],
            // The phase is spelled out even when it was defaulted, so a menu entry is
            // greppable against the content that produced it.
            declared: ['lv-home-size@both'],
            start: '/api/demos',
          },
        ],
        problems: [],
      })
    } finally {
      h.close()
    }
  })

  it('is read-only: it does not touch the guest, so it is safe mid-session', async () => {
    const h = harness()
    try {
      // A gate that would deadlock if anything reverted, and an empty vm_state after.
      h.runtimeState.resetGate = gate().wait
      expect((await h.request(`/api/tasks/${TASK.id}/antisolutions`)).status).toBe(200)
      expect(h.vmState.current()).toBeUndefined()
    } finally {
      h.close()
    }
  })

  it('keeps offering the parseable entries when one header is malformed', async () => {
    const h = harness()
    try {
      h.scripts.current = { ...SCRIPTS, fixtures: [...SCRIPTS.fixtures, BROKEN] }
      const body = (await (await h.request(`/api/tasks/${TASK.id}/antisolutions`)).json()) as {
        demos: Array<{ name: string }>
        problems: string[]
      }
      expect(body.demos.map((d) => d.name)).toEqual(['02-removed-persistence.sh', '01-chcon-only.sh'])
      expect(body.problems).toHaveLength(1)
      expect(body.problems[0]).toContain('03-no-header.sh')
    } finally {
      h.close()
    }
  })

  it('404s an unknown task', async () => {
    const h = harness()
    try {
      const res = await h.request('/api/tasks/storage/999-nope/antisolutions')
      expect(res.status).toBe(404)
    } finally {
      h.close()
    }
  })

  it('500s when the fixtures cannot be read, because that is content, not request', async () => {
    const h = harness()
    try {
      h.scripts.error = new ContentError('content/tasks/storage/014-grow-home-lv', ['grade.sh is missing'])
      const res = await h.request(`/api/tasks/${TASK.id}/antisolutions`)
      expect(res.status).toBe(500)
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('grade.sh is missing') })
    } finally {
      h.close()
    }
  })
})

describe('POST /api/demos rejects', () => {
  it('400s a body that is not an object, and one missing either field', async () => {
    const h = harness()
    try {
      expect((await h.request('/api/demos', { method: 'POST' })).status).toBe(400)
      expect((await startDemo(h, { name: PERSISTENCE.name })).status).toBe(400)
      expect((await startDemo(h, { sessionId: 's1' })).status).toBe(400)
      // Not a string is the same defect as absent.
      expect((await startDemo(h, { sessionId: 1, name: PERSISTENCE.name })).status).toBe(400)
    } finally {
      h.close()
    }
  })

  it('404s an unknown session', async () => {
    const h = harness()
    try {
      const res = await startDemo(h, { sessionId: 'nope', name: PERSISTENCE.name })
      expect(res.status).toBe(404)
    } finally {
      h.close()
    }
  })

  it('409s a live session, rather than reverting work in progress', async () => {
    const h = harness()
    try {
      const id = await start(h)
      const demo = await startDemo(h, { sessionId: id, name: PERSISTENCE.name })
      expect(demo.status).toBe(409)
      expect(await demo.json()).toMatchObject({ error: expect.stringContaining('still active') })
      // Nothing ran: the guest still carries the student's own attempt.
      expect(h.vmState.current()?.currentTask).toBe(TASK.id)
    } finally {
      h.close()
    }
  })

  it('409s a session that has been graded but not finished', async () => {
    const h = harness()
    try {
      // The case the phase name makes easy to get wrong. Grading is repeatable and
      // leaves the session live, so the student may still be working — and a demo
      // reverts the guest, so accepting here would delete an attempt in progress.
      const id = await start(h)
      expect((await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })).status).toBe(200)

      expect((await startDemo(h, { sessionId: id, name: PERSISTENCE.name })).status).toBe(409)
      expect(h.vmState.current()?.currentTask).toBe(TASK.id)
    } finally {
      h.close()
    }
  })

  it('404s an anti-solution name it does not have', async () => {
    const h = harness()
    try {
      const id = await finished(h)
      const res = await startDemo(h, { sessionId: id, name: '99-invented.sh' })
      expect(res.status).toBe(404)
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('no anti-solution named') })
    } finally {
      h.close()
    }
  })

  it('500s a name that exists but whose header will not parse', async () => {
    const h = harness()
    try {
      // The distinction the route separates out: a client typo and a content defect
      // both leave the name out of `plans`, and only one of them is the client's fault.
      h.scripts.current = { ...SCRIPTS, fixtures: [...SCRIPTS.fixtures, BROKEN] }
      const id = await finished(h)
      const res = await startDemo(h, { sessionId: id, name: BROKEN.name })
      expect(res.status).toBe(500)
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('03-no-header.sh') })
    } finally {
      h.close()
    }
  })

  it('500s when the fixtures cannot be loaded', async () => {
    const h = harness()
    try {
      const id = await finished(h)
      h.scripts.error = new Error('disk on fire')
      expect((await startDemo(h, { sessionId: id, name: PERSISTENCE.name })).status).toBe(500)
    } finally {
      h.close()
    }
  })
})

describe('POST /api/demos accepts', () => {
  it('answers 202 with a running resource and the URL to poll', async () => {
    const h = harness()
    try {
      const id = await finished(h)
      // Gated only now: `POST /api/sessions` reverts too, so gating earlier would
      // block the attempt this demo is supposed to come after.
      const open = gate()
      h.runtimeState.resetGate = open.wait

      const res = await startDemo(h, { sessionId: id, name: PERSISTENCE.name })
      // 202, not 200: the demo has been accepted and has not happened yet.
      expect(res.status).toBe(202)
      const body = (await res.json()) as Record<string, unknown>
      expect(body).toMatchObject({
        id: 'd1',
        taskId: TASK.id,
        name: PERSISTENCE.name,
        phase: 'running',
        kind: 'reboot',
        // The classification is known before anything runs, so the screen can say what
        // the student is about to watch while they are waiting for it.
        expectedFlips: ['fs-home-size'],
        before: null,
        after: null,
        flipped: [],
        taught: null,
        poll: '/api/demos/d1',
      })

      open.open()
      await settled(h, 'd1')
    } finally {
      h.close()
    }
  })

  it('carries both verdicts and names the checkpoint that flipped once it is done', async () => {
    const h = harness()
    try {
      const id = await finished(h)
      expect((await startDemo(h, { sessionId: id, name: PERSISTENCE.name })).status).toBe(202)

      const body = await settled(h, 'd1')
      expect(body).toMatchObject({
        phase: 'done',
        taught: true,
        problems: [],
        before: { label: 'A', passed: 2, failed: 0 },
        after: { label: 'B', passed: 1, failed: 1 },
        // The pedagogical payload: the id and the detail, side by side with the pass.
        flipped: [{ id: 'fs-home-size', desc: 'e', detail: '/home is 8G, not 12G' }],
      })
      expect(body.endedAt).toEqual(expect.any(Number))
    } finally {
      h.close()
    }
  })

  it('reports done-but-taught-nothing separately from failed', async () => {
    const h = harness()
    try {
      // The anti-solution ran and the promised checkpoint stayed green. The demo
      // succeeded as a *run* and failed as a *lesson*, and a screen must not present
      // two identical green columns as a persistence demonstration.
      h.runtimeState.verdictB = ALL_PASS
      h.runtimeState.regressions = []
      const id = await finished(h)
      await startDemo(h, { sessionId: id, name: PERSISTENCE.name })

      const body = await settled(h, 'd1')
      expect(body.phase).toBe('done')
      expect(body.taught).toBe(false)
      expect((body.problems as string[]).join(' ')).toContain('still passed after the reboot')
      expect(body.failure).toBeNull()
    } finally {
      h.close()
    }
  })

  it('records a failed stage when setup broke, without a verdict', async () => {
    const h = harness()
    try {
      const id = await finished(h)
      // Broken only now: the session's own setup had to succeed for the attempt to
      // exist at all.
      h.runtimeState.setupCode = 1
      await startDemo(h, { sessionId: id, name: PERSISTENCE.name })

      const body = await settled(h, 'd1')
      expect(body.phase).toBe('failed')
      expect(body.failure).toMatchObject({ stage: 'setup', message: expect.stringContaining('exited 1') })
      expect(body.before).toBeNull()
      expect(body.taught).toBeNull()
    } finally {
      h.close()
    }
  })

  it('records a crash when the transport threw rather than a script exiting', async () => {
    const h = harness()
    try {
      // A thrown error is not a stage: nothing reported an exit code, so `failure` is
      // null and `error` carries it. The 202 has already been answered by then, which
      // is exactly the case a blocking POST could not report at all.
      const id = await finished(h)
      h.runtimeState.resetThrows = 'vmrun: could not connect to the guest'
      expect((await startDemo(h, { sessionId: id, name: PERSISTENCE.name })).status).toBe(202)

      const body = await settled(h, 'd1')
      expect(body.phase).toBe('failed')
      expect(body.failure).toBeNull()
      expect(body.error).toContain('could not connect')
    } finally {
      h.close()
    }
  })

  it('runs an immediate demo and says the grader caught it before any reboot', async () => {
    const h = harness()
    try {
      h.runtimeState.verdictA = AFTER_REBOOT
      h.runtimeState.verdictB = undefined
      h.runtimeState.regressions = []
      const id = await finished(h)
      await startDemo(h, { sessionId: id, name: CHCON.name })

      const body = await settled(h, 'd1')
      expect(body).toMatchObject({
        phase: 'done',
        kind: 'immediate',
        taught: true,
        expectedFlips: [],
        before: { label: 'A', passed: 1, failed: 1 },
        // Two columns always, one of them empty and explicable, so the UI does not
        // have to branch on whether an "after" exists.
        after: null,
      })
    } finally {
      h.close()
    }
  })
})

describe('one guest, one demo', () => {
  it('409s a second demo while the first holds the guest, and points at it', async () => {
    const h = harness()
    try {
      const id = await finished(h)
      const open = gate()
      h.runtimeState.resetGate = open.wait
      expect((await startDemo(h, { sessionId: id, name: PERSISTENCE.name })).status).toBe(202)

      const second = await startDemo(h, { sessionId: id, name: CHCON.name })
      expect(second.status).toBe(409)
      expect(await second.json()).toMatchObject({
        error: expect.stringContaining('still running on the guest'),
        demo: '/api/demos/d1',
      })

      open.open()
      await settled(h, 'd1')
    } finally {
      h.close()
    }
  })

  it('releases the guest once the first demo settles, including after a crash', async () => {
    const h = harness()
    try {
      const id = await finished(h)
      h.runtimeState.resetThrows = 'boom'
      await startDemo(h, { sessionId: id, name: PERSISTENCE.name })
      expect((await settled(h, 'd1')).phase).toBe('failed')

      // Released in `#settle`, not by a success handler, so a crashed run does not
      // refuse every later demo with a 409 naming a run that ended minutes ago.
      delete h.runtimeState.resetThrows
      const second = await startDemo(h, { sessionId: id, name: CHCON.name })
      expect(second.status).toBe(202)
      expect(await second.json()).toMatchObject({ id: 'd2', poll: '/api/demos/d2' })
      await settled(h, 'd2')
    } finally {
      h.close()
    }
  })
})

describe('GET /api/demos/:id', () => {
  it('404s an id that was never issued', async () => {
    const h = harness()
    try {
      const res = await h.request('/api/demos/d99')
      expect(res.status).toBe(404)
      expect(await res.json()).toMatchObject({ error: 'unknown demo' })
    } finally {
      h.close()
    }
  })

  it('200s in the running phase: "not finished yet" is an answer, not an error', async () => {
    const h = harness()
    try {
      const id = await finished(h)
      const open = gate()
      h.runtimeState.resetGate = open.wait
      await startDemo(h, { sessionId: id, name: PERSISTENCE.name })

      const res = await h.request('/api/demos/d1')
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.phase).toBe('running')
      expect(body.endedAt).toBeUndefined()

      open.open()
      expect((await settled(h, 'd1')).phase).toBe('done')
    } finally {
      h.close()
    }
  })
})

describe('what a demo leaves behind', () => {
  it('marks the guest unknown, so the next grade is refused with an offer to reset', async () => {
    const h = harness()
    try {
      const id = await finished(h)
      await startDemo(h, { sessionId: id, name: PERSISTENCE.name })
      expect((await settled(h, 'd1')).phase).toBe('done')

      // Section 5.5. The guest now carries this task's setup plus a deliberately wrong
      // solution plus a reboot, and grading against that would fail the student for
      // somebody else's mistake.
      const row = h.vmState.current()
      expect(row?.currentTask).toBeNull()
      expect(row?.currentSnapshot).toBeNull()

      // Asserted against the guard rather than through `/grade`, because *this*
      // session is finished and `/grade` refuses it for that reason first. The next
      // attempt at this task — a new session, or this one after a `/reset` — is the
      // one the guard is protecting, and it is the guard's answer that decides.
      const stale = h.vmState.staleFor(TASK.id)
      expect(stale?.message).toContain('nothing is known about the guest')
      expect(stale?.liveTask).toBeNull()
    } finally {
      h.close()
    }
  })

  it('marks it unknown even when the demo failed before grading', async () => {
    const h = harness()
    try {
      const id = await finished(h)
      h.runtimeState.setupCode = 1
      await startDemo(h, { sessionId: id, name: PERSISTENCE.name })
      expect((await settled(h, 'd1')).phase).toBe('failed')

      // A half-set-up guest is exactly what the unknown row exists to describe.
      expect(h.vmState.current()?.currentTask).toBeNull()
    } finally {
      h.close()
    }
  })

  it('writes no attempt row: a demo is teaching, not evidence about the student', async () => {
    const h = harness()
    try {
      const id = await finished(h)
      await startDemo(h, { sessionId: id, name: PERSISTENCE.name })
      await settled(h, 'd1')

      const body = (await (await h.request(`/api/sessions/${id}`)).json()) as Record<string, unknown>
      // The session is untouched by the demo: same phase, same rung.
      expect(body).toMatchObject({ id, phase: 'graded' })
    } finally {
      h.close()
    }
  })
})
