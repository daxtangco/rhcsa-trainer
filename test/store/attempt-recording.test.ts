import { describe, expect, it, vi } from 'vitest'
import type { Bank } from '../../src/engine/content/bank.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'
import { parseVerdict } from '../../src/engine/grading/verdict.ts'
import { openAttemptStore, type AttemptStore } from '../../src/engine/store/attempts.ts'
import { MEMORY_DB } from '../../src/engine/store/schema.ts'
import type { TaskScripts } from '../../src/engine/validate/harness.ts'
import { createApp } from '../../src/server/app.ts'
import type { LabRuntime } from '../../src/server/lab.ts'
import { SessionStore } from '../../src/server/session.ts'

/**
 * The wiring test for Phase 2's first bullet: a graded, finished session lands in
 * the history database. It lives beside the store rather than in
 * `test/server/app.test.ts` so the 60-odd assertions there keep running against an
 * app with no database at all — which is also the case `attempts` being optional
 * has to keep working.
 */

const TASK = {
  id: 'storage/014-grow-home-lv',
  title: 'Grow /home to 12 GiB',
  chapter: 15,
  scope: 'exam-objective',
  rhel: 9,
  objectives: ['storage.lvm.resize', 'storage.fs.mount'],
  requiresConcepts: [],
  difficulty: 3,
  timeBudget: 600,
  weight: 'high',
  editions: ['r9'],
  rebootCheck: false,
  requiresDisks: 0,
  claims: [],
  transport: 'ssh',
  prompt: 'Grow the home logical volume to 12 GiB.',
  dir: '/content/tasks/storage/014-grow-home-lv',
} satisfies TaskSpec

/** Two checkpoints, both declared: the two witnesses agree. */
const HONEST = '# baseline-fail: lv-home-size, fs-home-size\nck lv-home-size "d" $?\nck fs-home-size "e" $?\n'

/**
 * The same grader with an unterminated heredoc after the first `ck`. The lexer
 * stops there and counts 1 while the header still names both ids, so
 * `checkpointCount` reports a disputed count — the drift case that `incomplete`
 * is structurally blind to.
 */
const DEFLATED =
  '# baseline-fail: lv-home-size, fs-home-size\nck lv-home-size "d" $?\ncat <<NOPE\nck fs-home-size "e" $?\n'

const ALL_PASS = [
  '{"id":"lv-home-size","desc":"d","status":"pass"}',
  '{"id":"fs-home-size","desc":"e","status":"pass"}',
].join('\n')

function bank(): Bank {
  const objectives = [
    { id: 'storage.lvm.resize', text: 'Extend existing logical volumes', chapters: [15] },
    { id: 'storage.fs.mount', text: 'Mount file systems', chapters: [15] },
  ]
  return {
    root: '/content',
    objectives: {
      version: 'rhel9',
      source: 'test',
      objectives,
      byId: new Map(objectives.map((o) => [o.id, o])),
    },
    tasks: [TASK],
    concepts: [],
    tasksById: new Map<string, TaskSpec>([[TASK.id, TASK]]),
    conceptsById: new Map(),
  }
}

interface Harness {
  request: (path: string, init?: RequestInit) => Promise<Response>
  attempts: AttemptStore
}

function harness(opts: { grade?: string; stdout?: string; attempts?: AttemptStore } = {}): Harness {
  const scripts: TaskScripts = {
    setup: 'echo setup',
    grade: opts.grade ?? HONEST,
    fixtures: [{ kind: 'solution', name: '01.sh', script: 'true\n' }],
  }
  const runtime: LabRuntime = {
    transportKind: 'ssh',
    snapshot: 'clean',
    reset: async () => {},
    exec: async () => ({ stdout: '', stderr: '', code: 0 }),
    gradeTask: async () => ({
      verdictA: parseVerdict(opts.stdout ?? ALL_PASS),
      regressions: [],
      rebooted: false,
    }),
  }
  const attempts = opts.attempts ?? openAttemptStore({ path: MEMORY_DB, now: () => 9_000 })
  // A minute per call, so a rung-1 solve lands inside the 600-second budget and
  // `deriveRating` has something real to answer.
  let clock = 1_000_000
  const app = createApp({
    bank: bank(),
    runtime,
    sessions: new SessionStore(),
    assertLib: '',
    loadScripts: async () => scripts,
    now: () => (clock += 60_000),
    attempts,
  })
  return { request: async (path, init) => app.request(path, init), attempts }
}

async function start(h: Harness, mode: string): Promise<string> {
  const res = await h.request('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ taskId: TASK.id, mode }),
    headers: { 'content-type': 'application/json' },
  })
  expect(res.status).toBe(201)
  const body: unknown = await res.json()
  const id = (body as { id?: unknown }).id
  if (typeof id !== 'string') throw new Error(`no session id in ${JSON.stringify(body)}`)
  return id
}

describe('POST /api/sessions/:id/finish records the attempt', () => {
  it('writes one clean attempt carrying the rung, the verdicts, the objectives and the rating', async () => {
    const h = harness()
    try {
      const id = await start(h, 'practice')
      await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })
      const res = await h.request(`/api/sessions/${id}/finish`, { method: 'POST' })
      expect(res.status).toBe(200)
      const finish = (await res.json()) as { rating: string | null; startedAt: number; endedAt: number }

      const rows = h.attempts.forTask(TASK.id)
      expect(rows).toHaveLength(1)
      const row = rows[0]
      expect(row?.mode).toBe('practice')
      expect(row?.rungUsed).toBe(1)
      // The objectives are the task's, so Phase 3's per-objective scheduler has
      // something to join on.
      expect(row?.objectiveIds).toEqual(['storage.fs.mount', 'storage.lvm.resize'])
      // Same clock the response reports: nothing here reads Date.now().
      expect(row?.startedAt).toBe(finish.startedAt)
      expect(row?.finishedAt).toBe(finish.endedAt)
      expect(row?.recordedAt).toBe(9_000)
      expect(row?.verdictA.checkpoints.map((c) => c.id)).toEqual(['lv-home-size', 'fs-home-size'])
      expect(row?.finalVerdict.checkpoints.every((c) => c.status === 'pass')).toBe(true)
      expect(row?.checkpointsPassed).toBe(2)
      expect(row?.checkpointsExpected).toBe(2)
      expect(row?.drift.clean).toBe(true)
      // The rating the route derived, not a second derivation.
      expect(row?.rating).toBe(finish.rating)
      expect(row?.rating).toBe('easy')
    } finally {
      h.attempts.close()
    }
  })

  it('records the attempt once however many times the student graded', async () => {
    const h = harness()
    try {
      const id = await start(h, 'practice')
      await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })
      await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })
      await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })
      expect(h.attempts.forTask(TASK.id)).toEqual([])

      await h.request(`/api/sessions/${id}/finish`, { method: 'POST' })
      expect(h.attempts.forTask(TASK.id)).toHaveLength(1)
    } finally {
      h.attempts.close()
    }
  })

  it('records a drifted grade as drifted, and keeps it out of the scheduler read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = harness({ grade: DEFLATED })
    try {
      const id = await start(h, 'drill')
      await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })
      const res = await h.request(`/api/sessions/${id}/finish`, { method: 'POST' })
      const finish = (await res.json()) as { rating: string | null }

      // The route withholds the rating; the row agrees, and would have been
      // refused by the schema if it had not.
      expect(finish.rating).toBeNull()
      const row = h.attempts.forTask(TASK.id)[0]
      expect(row?.rating).toBeNull()
      expect(row?.drift.countDisputed).toBe(true)
      expect(row?.drift.suspect).toBe(true)
      expect(row?.drift.clean).toBe(false)

      // The attempt is still history — the student did the work — but it cannot
      // be read as evidence about the objective.
      expect(h.attempts.forTask(TASK.id)).toHaveLength(1)
      expect(h.attempts.cleanForTask(TASK.id)).toEqual([])
      expect(h.attempts.cleanAttemptsForObjective('storage.lvm.resize')).toEqual([])
    } finally {
      h.attempts.close()
      warn.mockRestore()
    }
  })

  it('records nothing for a session that was never graded', async () => {
    const h = harness()
    try {
      const id = await start(h, 'practice')
      const res = await h.request(`/api/sessions/${id}/finish`, { method: 'POST' })
      expect(res.status).toBe(409)
      expect(h.attempts.forTask(TASK.id)).toEqual([])
    } finally {
      h.attempts.close()
    }
  })

  it('still lets the student finish when the write fails, and says so', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // A closed database is the cheapest real write failure: every statement on it
    // throws, exactly as a full or unwritable disk would.
    const dead = openAttemptStore({ path: MEMORY_DB, now: () => 0 })
    dead.close()
    const h = harness({ attempts: dead })

    const id = await start(h, 'practice')
    await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })
    const res = await h.request(`/api/sessions/${id}/finish`, { method: 'POST' })

    // 200 with the report, because the attempt is over and a student must always
    // be able to close a session.
    expect(res.status).toBe(200)
    expect((await res.json()) as { phase: string }).toMatchObject({ phase: 'graded' })
    expect(error).toHaveBeenCalledWith(expect.stringContaining('was not recorded'))
    error.mockRestore()
  })

  it('serves every route unchanged with no store wired at all', async () => {
    // `attempts` is the one optional dep; this is the case that keeps it honest.
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
        grade: HONEST,
        fixtures: [{ kind: 'solution', name: '01.sh', script: 'true\n' }],
      }),
      now: () => 1_000,
    })
    const created = await app.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ taskId: TASK.id, mode: 'practice' }),
      headers: { 'content-type': 'application/json' },
    })
    const id = (await created.json()) as { id: string }
    await app.request(`/api/sessions/${id.id}/grade`, { method: 'POST' })
    const res = await app.request(`/api/sessions/${id.id}/finish`, { method: 'POST' })
    expect(res.status).toBe(200)
  })
})
