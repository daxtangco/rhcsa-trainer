import { describe, expect, it } from 'vitest'
import type { Bank } from '../../src/engine/content/bank.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'
import { parseVerdict } from '../../src/engine/grading/verdict.ts'
import { MEMORY_DB } from '../../src/engine/store/schema.ts'
import { openVmStateStore, type VmStateStore } from '../../src/engine/store/vm-state.ts'
import type { TaskScripts } from '../../src/engine/validate/harness.ts'
import { createApp } from '../../src/server/app.ts'
import type { LabRuntime } from '../../src/server/lab.ts'
import { SessionStore } from '../../src/server/session.ts'

/**
 * Section 5.5 through the routes: *"Grading task X while task Y's setup is live is
 * refused, with an offer to reset."*
 *
 * The load-bearing assertion in most of these is `calls` — the refusal has to happen
 * **before** `grade.sh` runs, because the grader's own output is what misleads the
 * student. A 409 that arrives after a page of failures has already been computed
 * would satisfy the status code and none of the design.
 */

function task(id: string, objectives: string[]): TaskSpec {
  return {
    id,
    title: id,
    chapter: 15,
    scope: 'exam-objective',
    rhel: 9,
    objectives,
    requiresConcepts: [],
    difficulty: 3,
    timeBudget: 600,
    weight: 'high',
    editions: ['r9'],
    rebootCheck: false,
    requiresDisks: 0,
    claims: [],
    transport: 'ssh',
    prompt: `do ${id}`,
    dir: `/content/tasks/${id}`,
  } satisfies TaskSpec
}

const GROW = task('storage/014-grow-home-lv', ['storage.lvm.resize'])
const HTTPD = task('selinux/019-httpd-alt-port', ['selinux.context'])

/** Two checkpoints, both declared: the two witnesses agree, so nothing is suspect. */
const GRADE = '# baseline-fail: lv-home-size, fs-home-size\nck lv-home-size "d" $?\nck fs-home-size "e" $?\n'

const ALL_PASS = [
  '{"id":"lv-home-size","desc":"d","status":"pass"}',
  '{"id":"fs-home-size","desc":"e","status":"pass"}',
].join('\n')

function bank(): Bank {
  const objectives = [
    { id: 'storage.lvm.resize', text: 'Extend existing logical volumes', chapters: [15] },
    { id: 'selinux.context', text: 'Manage SELinux contexts', chapters: [22] },
  ]
  return {
    root: '/content',
    objectives: {
      version: 'rhel9',
      source: 'test',
      objectives,
      byId: new Map(objectives.map((o) => [o.id, o])),
    },
    tasks: [GROW, HTTPD],
    concepts: [],
    tasksById: new Map([GROW, HTTPD].map((t) => [t.id, t])),
    conceptsById: new Map(),
  }
}

interface Harness {
  request: (path: string, init?: RequestInit) => Promise<Response>
  vmState: VmStateStore
  /** Every call the app made to the guest, in order. */
  calls: string[]
  /** Flip to make the next `setup.sh` exit non-zero. */
  failSetup: { on: boolean }
  /** Flip to make the next revert throw, the way a dead `vmrun` would. */
  failReset: { on: boolean }
}

function harness(): Harness {
  const scripts: TaskScripts = {
    setup: 'echo setup',
    grade: GRADE,
    fixtures: [{ kind: 'solution', name: '01.sh', script: 'true\n' }],
  }
  const calls: string[] = []
  const failSetup = { on: false }
  const failReset = { on: false }
  const runtime: LabRuntime = {
    transportKind: 'ssh',
    snapshot: 'clean',
    reset: async () => {
      calls.push('reset')
      if (failReset.on) throw new Error('vmrun revert failed')
    },
    exec: async () => {
      calls.push('setup')
      return failSetup.on
        ? { stdout: '', stderr: 'setup blew up', code: 1 }
        : { stdout: '', stderr: '', code: 0 }
    },
    gradeTask: async () => {
      calls.push('grade')
      return { verdictA: parseVerdict(ALL_PASS), regressions: [], rebooted: false }
    },
  }
  // A fixed clock for the store and a moving one for the sessions: every
  // `appliedAt` asserted below is 5_000, and nothing here reads a real clock.
  const vmState = openVmStateStore({ path: MEMORY_DB, now: () => 5_000 })
  let clock = 1_000_000
  const app = createApp({
    bank: bank(),
    runtime,
    sessions: new SessionStore(),
    assertLib: '',
    loadScripts: async () => scripts,
    now: () => (clock += 60_000),
    vmState,
  })
  // Awaited here rather than at each call site: `app.request` is typed
  // `Response | Promise<Response>`.
  return { request: async (path, init) => app.request(path, init), vmState, calls, failSetup, failReset }
}

async function start(h: Harness, taskId: string): Promise<string> {
  const res = await h.request('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ taskId, mode: 'practice' }),
    headers: { 'content-type': 'application/json' },
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { id?: unknown }
  if (typeof body.id !== 'string') throw new Error(`no session id in ${JSON.stringify(body)}`)
  return body.id
}

async function grade(h: Harness, id: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

describe('POST /api/sessions records what is applied to the guest', () => {
  it('records the task and the snapshot after setup.sh succeeds', async () => {
    const h = harness()
    try {
      await start(h, GROW.id)
      expect(h.vmState.current()).toEqual({
        currentTask: GROW.id,
        currentSnapshot: 'clean',
        appliedAt: 5_000,
      })
    } finally {
      h.vmState.close()
    }
  })

  it('leaves the guest unknown when setup.sh exits non-zero', async () => {
    const h = harness()
    try {
      await start(h, GROW.id)
      h.failSetup.on = true
      const res = await h.request('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ taskId: HTTPD.id, mode: 'practice' }),
        headers: { 'content-type': 'application/json' },
      })
      expect(res.status).toBe(500)

      // Not still GROW: the revert already happened. Not HTTPD either: its setup did
      // not finish, so what is on the guest is the clean snapshot plus however much
      // of that script ran.
      expect(h.vmState.current()).toEqual({
        currentTask: null,
        currentSnapshot: null,
        appliedAt: 5_000,
      })
    } finally {
      h.vmState.close()
    }
  })

  it('leaves the guest unknown when the revert itself throws', async () => {
    const h = harness()
    try {
      await start(h, GROW.id)
      h.failReset.on = true
      const res = await h.request('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ taskId: HTTPD.id, mode: 'practice' }),
        headers: { 'content-type': 'application/json' },
      })
      expect(res.status).toBe(500)

      // This is the case that pins the write *ordering*: the row is written before
      // the revert, so a revert that throws — or a process that dies inside one —
      // still leaves a row that does not claim GROW is live.
      expect(h.vmState.current()?.currentTask).toBeNull()
    } finally {
      h.vmState.close()
    }
  })
})

describe('POST /api/sessions/:id/grade refuses a stale guest', () => {
  it('refuses grading a task whose setup is no longer live, and does not run grade.sh', async () => {
    const h = harness()
    try {
      const grow = await start(h, GROW.id)
      // The scenario section 5.5 describes: a second session takes the guest, and the
      // student goes back to the first tab and presses Grade.
      await start(h, HTTPD.id)
      const before = [...h.calls]

      const { status, body } = await grade(h, grow)
      expect(status).toBe(409)
      expect(h.calls).toEqual(before)

      const error = String(body.error)
      expect(error).toContain(HTTPD.id)
      expect(error).toContain(GROW.id)
      expect(error).toMatch(/setup\.sh is live/)
      // The offer, in the same sentence as the diagnosis.
      expect(error).toMatch(/Reset this session/)
      expect(body.staleState).toEqual({
        requestedTask: GROW.id,
        liveTask: HTTPD.id,
        currentSnapshot: 'clean',
        appliedAt: 5_000,
        // The route that already exists, already reverts and already reapplies this
        // session's setup — so the client can render the offer as a button.
        reset: `/api/sessions/${grow}/reset`,
      })
    } finally {
      h.vmState.close()
    }
  })

  it('grades the session whose setup is live, in the same app that just refused', async () => {
    const h = harness()
    try {
      const grow = await start(h, GROW.id)
      const httpd = await start(h, HTTPD.id)

      expect((await grade(h, grow)).status).toBe(409)
      // The other half. A guard that refused this too would pass every assertion in
      // the test above and make the app unusable.
      const ok = await grade(h, httpd)
      expect(ok.status).toBe(200)
      expect(ok.body).toMatchObject({ passed: 2, total: 2, allPassed: true })
      expect(h.calls).toContain('grade')
    } finally {
      h.vmState.close()
    }
  })

  it('accepts the offer: the reset route it names makes the same grade succeed', async () => {
    const h = harness()
    try {
      const grow = await start(h, GROW.id)
      await start(h, HTTPD.id)
      const refused = await grade(h, grow)
      const offer = (refused.body.staleState as { reset: string }).reset

      // Follow the offer the refusal made, rather than a path this test knows: if the
      // two ever diverge, the offer is a promise about work nobody has written.
      const reset = await h.request(offer, { method: 'POST' })
      expect(reset.status).toBe(200)
      expect(h.vmState.current()?.currentTask).toBe(GROW.id)

      const after = await grade(h, grow)
      expect(after.status).toBe(200)
      expect(after.body).toMatchObject({ allPassed: true })
    } finally {
      h.vmState.close()
    }
  })

  it('refuses grading against a guest whose state is unknown, and says nothing is known', async () => {
    const h = harness()
    try {
      const grow = await start(h, GROW.id)
      h.failSetup.on = true
      // /reset is the other route that touches the guest, and it fails the same way.
      expect((await h.request(`/api/sessions/${grow}/reset`, { method: 'POST' })).status).toBe(500)
      const before = [...h.calls]

      const { status, body } = await grade(h, grow)
      expect(status).toBe(409)
      expect(h.calls).toEqual(before)
      expect(String(body.error)).toMatch(/nothing is known about the guest/)
      expect(String(body.error)).toContain(GROW.id)
      expect(body.staleState).toMatchObject({ liveTask: null, requestedTask: GROW.id })
    } finally {
      h.vmState.close()
    }
  })

  it('leaves the phase check first, because a finished session cannot act on a reset offer', async () => {
    const h = harness()
    try {
      const grow = await start(h, GROW.id)
      await grade(h, grow)
      await h.request(`/api/sessions/${grow}/finish`, { method: 'POST' })
      await start(h, HTTPD.id)

      // Two reasons to refuse at once, and the phase check wins because it is about
      // the *session* rather than the guest: telling a student to reset a session
      // that is already over would be advice they cannot act on.
      const { status, body } = await grade(h, grow)
      expect(status).toBe(409)
      expect(String(body.error)).toMatch(/is finished/)
      expect(body.staleState).toBeUndefined()
    } finally {
      h.vmState.close()
    }
  })

  it('refuses nothing when no store is wired, which is what the dep being optional means', async () => {
    // `vmState` is optional so that every test of an unrelated route, and
    // `test/vm/e2e-exit-criterion.vm.test.ts`, need not construct one. This is the
    // case that keeps that honest: absent, the guard does not fire and grading works
    // exactly as it did before this change.
    const app = createApp({
      bank: bank(),
      runtime: {
        transportKind: 'ssh',
        snapshot: 'clean',
        reset: async () => {},
        exec: async () => ({ stdout: '', stderr: '', code: 0 }),
        gradeTask: async () => ({ verdictA: parseVerdict(ALL_PASS), regressions: [], rebooted: false }),
      },
      sessions: new SessionStore(),
      assertLib: '',
      loadScripts: async () => ({
        setup: 'echo setup',
        grade: GRADE,
        fixtures: [{ kind: 'solution', name: '01.sh', script: 'true\n' }],
      }),
      now: () => 1_000,
    })
    const created = await app.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ taskId: GROW.id, mode: 'practice' }),
      headers: { 'content-type': 'application/json' },
    })
    const { id } = (await created.json()) as { id: string }
    await app.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ taskId: HTTPD.id, mode: 'practice' }),
      headers: { 'content-type': 'application/json' },
    })
    expect((await app.request(`/api/sessions/${id}/grade`, { method: 'POST' })).status).toBe(200)
  })
})
