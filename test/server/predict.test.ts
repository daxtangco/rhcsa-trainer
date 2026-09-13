import { describe, expect, it } from 'vitest'
import type { Bank } from '../../src/engine/content/bank.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'
import { parseVerdict, type Verdict } from '../../src/engine/grading/verdict.ts'
import { AttemptStore } from '../../src/engine/store/attempts.ts'
import { MEMORY_DB, openHistoryDb } from '../../src/engine/store/schema.ts'
import type { TaskScripts } from '../../src/engine/validate/harness.ts'
import { createApp } from '../../src/server/app.ts'
import type { LabRuntime } from '../../src/server/lab.ts'
import { SessionStore } from '../../src/server/session.ts'

/**
 * Section 10.2's capture, through the routes: the ordering rules that make the
 * measurement worth anything, and the fact that the prediction reaches the same
 * attempt row as the verdict.
 *
 * The arithmetic of the 2×2 is unit-tested in `calibration.test.ts`. What is only
 * observable here is the *sequencing*: a prediction made after a verdict, a
 * prediction made after a reset that followed a verdict, and a second prediction that
 * contradicts the first.
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

/** Two checkpoints, both declared, so a full verdict is clean and scorable. */
const GRADE = '# baseline-fail: lv-home-size, fs-home-size\nck lv-home-size "d" $?\nck fs-home-size "e" $?\n'

const SCRIPTS: TaskScripts = {
  setup: 'echo setup',
  grade: GRADE,
  fixtures: [{ kind: 'solution', name: '01.sh', script: 'true\n' }],
}

const ALL_PASS = parseVerdict(
  [
    '{"id":"lv-home-size","desc":"d","status":"pass"}',
    '{"id":"fs-home-size","desc":"e","status":"pass"}',
  ].join('\n'),
)

const ONE_FAILS = parseVerdict(
  [
    '{"id":"lv-home-size","desc":"d","status":"pass"}',
    '{"id":"fs-home-size","desc":"e","status":"fail"}',
  ].join('\n'),
)

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

interface Harness {
  request: (path: string, init?: RequestInit) => Promise<Response>
  attempts: AttemptStore
  /** Swap the verdict the next grade returns. */
  verdict: { a: Verdict; b?: Verdict; regressions: string[] }
  close: () => void
}

function harness(): Harness {
  const verdict: Harness['verdict'] = { a: ALL_PASS, regressions: [] }
  const runtime: LabRuntime = {
    transportKind: 'ssh',
    snapshot: 'clean',
    reset: async () => {},
    exec: async () => ({ stdout: '', stderr: '', code: 0 }),
    gradeTask: async () => {
      const b = verdict.b
      const byId = new Map((b ?? verdict.a).checkpoints.map((cp) => [cp.id, cp]))
      return {
        verdictA: verdict.a,
        ...(b === undefined ? {} : { verdictB: b }),
        regressions: verdict.regressions
          .map((id) => byId.get(id))
          .filter((cp): cp is NonNullable<typeof cp> => cp !== undefined),
        rebooted: b !== undefined,
      }
    },
  }
  const db = openHistoryDb({ path: MEMORY_DB })
  const attempts = new AttemptStore(db, { now: () => 5000 })
  let clock = 1_000_000
  const app = createApp({
    bank: bank(),
    runtime,
    sessions: new SessionStore(),
    assertLib: '',
    loadScripts: async () => SCRIPTS,
    now: () => (clock += 60_000),
    attempts,
  })
  return {
    request: async (path, init) => app.request(path, init),
    attempts,
    verdict,
    close: () => attempts.close(),
  }
}

async function start(h: Harness): Promise<string> {
  const res = await h.request('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ taskId: TASK.id, mode: 'practice' }),
    headers: { 'content-type': 'application/json' },
  })
  expect(res.status).toBe(201)
  const body = (await res.json()) as { id?: unknown }
  if (typeof body.id !== 'string') throw new Error(`no session id in ${JSON.stringify(body)}`)
  return body.id
}

function predict(h: Harness, id: string, predicted: unknown): Promise<Response> {
  return h.request(`/api/sessions/${id}/predict`, {
    method: 'POST',
    body: JSON.stringify({ predicted }),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/sessions/:id/predict', () => {
  it('records a prediction on an ungraded session', async () => {
    const h = harness()
    try {
      const id = await start(h)
      const res = await predict(h, id, 'pass')
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ id, predicted: 'pass' })
    } finally {
      h.close()
    }
  })

  it('accepts all three outcomes and nothing else', async () => {
    const h = harness()
    try {
      for (const value of ['pass', 'unsure', 'fail']) {
        const id = await start(h)
        expect((await predict(h, id, value)).status).toBe(200)
      }
      const id = await start(h)
      // 400, not 409: the *client* sent something wrong.
      const res = await predict(h, id, 'probably')
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('pass, unsure, fail') })
    } finally {
      h.close()
    }
  })

  it('rejects a body that is not an object', async () => {
    const h = harness()
    try {
      const id = await start(h)
      const res = await h.request(`/api/sessions/${id}/predict`, { method: 'POST' })
      expect(res.status).toBe(400)
    } finally {
      h.close()
    }
  })

  it('404s an unknown session', async () => {
    const h = harness()
    try {
      expect((await predict(h, 'nope', 'pass')).status).toBe(404)
    } finally {
      h.close()
    }
  })
})

describe('a prediction made after the verdict', () => {
  it('is refused with 409 once the session has been graded', async () => {
    const h = harness()
    try {
      const id = await start(h)
      expect((await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })).status).toBe(200)

      const res = await predict(h, id, 'pass')
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({
        error: expect.stringContaining('would not be a prediction'),
      })
    } finally {
      h.close()
    }
  })

  it('is still refused after a reset, which is what `sawVerdict` exists for', async () => {
    const h = harness()
    try {
      const id = await start(h)
      await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })
      // `restart` deletes `result` and leaves `phase` active, so a guard reading
      // either of those would read this as a session that has never graded — and
      // record a *first* prediction made with the previous verdict in hand.
      expect((await h.request(`/api/sessions/${id}/reset`, { method: 'POST' })).status).toBe(200)

      expect((await predict(h, id, 'pass')).status).toBe(409)
    } finally {
      h.close()
    }
  })

  it('leaves the column null when the prediction was refused', async () => {
    const h = harness()
    try {
      const id = await start(h)
      await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })
      await predict(h, id, 'pass')
      await h.request(`/api/sessions/${id}/finish`, { method: 'POST' })

      const rows = h.attempts.forTask(TASK.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.predictedOutcome).toBeUndefined()
    } finally {
      h.close()
    }
  })
})

describe('a second prediction', () => {
  it('is idempotent when it repeats the first', async () => {
    const h = harness()
    try {
      const id = await start(h)
      expect((await predict(h, id, 'fail')).status).toBe(200)
      // A double-clicked button must not be an error.
      expect((await predict(h, id, 'fail')).status).toBe(200)
    } finally {
      h.close()
    }
  })

  it('is refused with 409 when it contradicts the first, and the first is kept', async () => {
    const h = harness()
    try {
      const id = await start(h)
      await predict(h, id, 'pass')
      // A `/hint` between the two clicks is genuinely new information, so the second
      // click is no longer the cold one section 10.2 asked for.
      await h.request(`/api/sessions/${id}/hint`, { method: 'POST' })

      const res = await predict(h, id, 'fail')
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ predicted: 'pass' })

      await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })
      await h.request(`/api/sessions/${id}/finish`, { method: 'POST' })
      expect(h.attempts.forTask(TASK.id)[0]?.predictedOutcome).toBe('pass')
    } finally {
      h.close()
    }
  })
})

describe('the prediction lands on the attempt row the verdict lands on', () => {
  it('writes predicted_outcome beside the verdict at /finish', async () => {
    const h = harness()
    try {
      const id = await start(h)
      await predict(h, id, 'pass')
      await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })
      await h.request(`/api/sessions/${id}/finish`, { method: 'POST' })

      const rows = h.attempts.forTask(TASK.id)
      expect(rows).toHaveLength(1)
      const stored = rows[0]
      expect(stored?.predictedOutcome).toBe('pass')
      // The same row: the quadrant is this column against these checkpoint counts,
      // and computing it must not need a join by timestamp.
      expect(stored?.checkpointsPassed).toBe(2)
      expect(stored?.checkpointsExpected).toBe(2)
      expect(stored?.drift.clean).toBe(true)
    } finally {
      h.close()
    }
  })

  it('records one row for a session graded three times, carrying the one prediction', async () => {
    const h = harness()
    try {
      const id = await start(h)
      await predict(h, id, 'fail')
      for (let i = 0; i < 3; i += 1) {
        await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })
      }
      await h.request(`/api/sessions/${id}/finish`, { method: 'POST' })

      const rows = h.attempts.forTask(TASK.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.predictedOutcome).toBe('fail')
    } finally {
      h.close()
    }
  })

  it('writes no prediction when the student never clicked', async () => {
    const h = harness()
    try {
      const id = await start(h)
      await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })
      await h.request(`/api/sessions/${id}/finish`, { method: 'POST' })
      expect(h.attempts.forTask(TASK.id)[0]?.predictedOutcome).toBeUndefined()
    } finally {
      h.close()
    }
  })
})

describe('GET /api/calibration', () => {
  it('answers zeroes and no cluster claim on an empty history', async () => {
    const h = harness()
    try {
      const res = await h.request('/api/calibration')
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({
        considered: 0,
        quadrants: { calibratedPass: 0, overconfident: 0, underconfident: 0, calibratedFail: 0 },
        persistence: { clustered: null },
      })
    } finally {
      h.close()
    }
  })

  it('scores an overconfident attempt against what actually happened', async () => {
    const h = harness()
    try {
      h.verdict.a = ONE_FAILS
      const id = await start(h)
      await predict(h, id, 'pass')
      await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })
      await h.request(`/api/sessions/${id}/finish`, { method: 'POST' })

      const body = await (await h.request('/api/calibration')).json()
      expect(body).toMatchObject({
        considered: 1,
        quadrants: { overconfident: 1, calibratedPass: 0 },
        // One overconfident attempt is nowhere near enough to diagnose a cluster.
        persistence: { clustered: null, considered: 0, notRebooted: 1 },
      })
    } finally {
      h.close()
    }
  })

  it('cross-references an overconfident failure against the reboot check', async () => {
    const h = harness()
    try {
      // Passed before the reboot, failed after: section 5.4 step 4's persistence
      // failure, which is the signal `persistence` counts.
      h.verdict.a = ALL_PASS
      h.verdict.b = ONE_FAILS
      h.verdict.regressions = ['fs-home-size']

      const id = await start(h)
      await predict(h, id, 'pass')
      await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })
      await h.request(`/api/sessions/${id}/finish`, { method: 'POST' })

      const body = await (await h.request('/api/calibration')).json()
      expect(body).toMatchObject({
        quadrants: { overconfident: 1 },
        persistence: { considered: 1, onPersistence: 1, notRebooted: 0, clustered: null },
      })
    } finally {
      h.close()
    }
  })
})
