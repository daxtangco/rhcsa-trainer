import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  attemptDrift,
  openAttemptStore,
  type AttemptInput,
  type AttemptReport,
  type AttemptStore,
} from '../../src/engine/store/attempts.ts'
import { MEMORY_DB, SCHEMA_VERSION, openHistoryDb } from '../../src/engine/store/schema.ts'
import { parseVerdict } from '../../src/engine/grading/verdict.ts'
import { reportSuspect, type GradeReport } from '../../src/server/session.ts'

/**
 * Named instants, so nothing in here reads a real clock: `startedAt` and
 * `finishedAt` are the session's, `recordedAt` comes from the store's injected
 * one. A test that asserted on `Date.now()` would be asserting on the machine.
 */
const T0 = 1_700_000_000_000
const STARTED = T0
const FINISHED = T0 + 240_000 // four minutes
const RECORDED = T0 + 240_500

const VERDICT_A = parseVerdict(
  [
    '{"id":"lv-home-size","desc":"the home LV is at least 12 GiB","status":"pass"}',
    '{"id":"fs-home-size","desc":"the filesystem fills it","status":"pass"}',
  ].join('\n'),
)

const VERDICT_B = parseVerdict(
  [
    '{"id":"lv-home-size","desc":"the home LV is at least 12 GiB","status":"pass"}',
    '{"id":"fs-home-size","desc":"the filesystem fills it","status":"fail","detail":"not in fstab"}',
  ].join('\n'),
)

function report(over: Partial<AttemptReport> = {}): AttemptReport {
  return {
    passed: 2,
    total: 2,
    expectedTotal: 2,
    incomplete: false,
    countDisputed: false,
    regressionCount: 0,
    rebooted: false,
    ...over,
  }
}

function attempt(over: Partial<AttemptInput> = {}): AttemptInput {
  return {
    taskId: 'storage/grow-home-lv',
    objectiveIds: ['lvm-manage', 'fs-mount'],
    mode: 'practice',
    startedAt: STARTED,
    finishedAt: FINISHED,
    rungUsed: 1,
    verdictA: VERDICT_A,
    finalVerdict: VERDICT_A,
    report: report(),
    rating: 'easy',
    ...over,
  }
}

const open: AttemptStore[] = []

function store(now: () => number = () => RECORDED): AttemptStore {
  const s = openAttemptStore({ path: MEMORY_DB, now })
  open.push(s)
  return s
}

afterEach(() => {
  while (open.length > 0) open.pop()?.close()
})

describe('AttemptStore, a clean attempt', () => {
  it('round-trips every field the spec records on an attempt', () => {
    const s = store()
    const row = s.record(attempt())

    expect(row.taskId).toBe('storage/grow-home-lv')
    expect(row.objectiveIds).toEqual(['fs-mount', 'lvm-manage'])
    expect(row.mode).toBe('practice')
    expect(row.startedAt).toBe(STARTED)
    expect(row.finishedAt).toBe(FINISHED)
    expect(row.rungUsed).toBe(1)
    expect(row.rating).toBe('easy')
    expect(row.checkpointsPassed).toBe(2)
    expect(row.checkpointsSeen).toBe(2)
    expect(row.checkpointsExpected).toBe(2)
    expect(row.regressionCount).toBe(0)
    expect(row.rebooted).toBe(false)
    expect(row.rebootError).toBeUndefined()
    expect(row.drift.clean).toBe(true)
  })

  it('round-trips the per-checkpoint results of verdict A, verdict B and the final verdict', () => {
    const s = store()
    const row = s.record(
      attempt({
        verdictA: VERDICT_A,
        verdictB: VERDICT_B,
        finalVerdict: VERDICT_B,
        report: report({ passed: 1, rebooted: true, regressionCount: 1 }),
        rating: 'again',
      }),
    )

    // Not "two checkpoints came back": the whole shape, because a persistence
    // failure is spec section 5.4's highest-value output and it lives in the
    // difference between these two lists.
    expect(row.verdictA).toEqual(VERDICT_A)
    expect(row.verdictB).toEqual(VERDICT_B)
    expect(row.finalVerdict).toEqual(VERDICT_B)
    expect(row.verdictB?.checkpoints[1]?.detail).toBe('not in fstab')
    expect(row.regressionCount).toBe(1)
    expect(row.rebooted).toBe(true)
  })

  it('leaves verdict B absent when no reboot check ran, rather than storing an empty one', () => {
    const s = store()
    expect(s.record(attempt()).verdictB).toBeUndefined()
  })

  it('takes its recording clock as a parameter', () => {
    const s = store(() => 424_242)
    expect(s.record(attempt()).recordedAt).toBe(424_242)
  })

  it('derives the duration the schema computes, not one the caller asserted', () => {
    const s = store()
    // 240_000 ms, rounded the way app.ts rounds it for deriveRating.
    expect(s.record(attempt()).durationS).toBe(240)
    expect(s.record(attempt({ finishedAt: STARTED + 1_600 })).durationS).toBe(2)
  })

  it('records a guided attempt, which carries no rating and is still clean', () => {
    const s = store()
    const row = s.record(attempt({ mode: 'guided', rating: null }))
    expect(row.rating).toBeNull()
    expect(row.drift.clean).toBe(true)
  })

  it('survives the process: an on-disk database reopens with the attempt in it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rhcsa-attempts-'))
    try {
      // Nested, so the store is also shown creating its parent directory.
      const path = join(dir, 'state', 'history.db')
      const first = openAttemptStore({ path, now: () => RECORDED })
      const written = first.record(attempt())
      first.close()

      const second = openAttemptStore({ path, now: () => RECORDED })
      try {
        expect(second.forTask('storage/grow-home-lv')).toEqual([written])
      } finally {
        second.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('AttemptStore, the stale-state guard', () => {
  it('marks an incomplete run unclean and keeps it out of the scheduler read', () => {
    const s = store()
    // The grader declared five checkpoints and two arrived: the three that never
    // ran are unknown, not passed.
    const row = s.record(
      attempt({ report: report({ passed: 2, total: 2, expectedTotal: 5, incomplete: true }), rating: null }),
    )

    expect(row.drift).toEqual({
      suspect: true,
      incomplete: true,
      countDisputed: false,
      countMismatch: true,
      clean: false,
    })
    expect(s.forTask(row.taskId)).toHaveLength(1)
    expect(s.cleanForTask(row.taskId)).toEqual([])
    expect(s.cleanAttemptsForObjective('lvm-manage')).toEqual([])
  })

  it('marks a disputed checkpoint count unclean even though the count itself looks whole', () => {
    const s = store()
    // countDisputed is the case `incomplete` is structurally blind to: the
    // declared header set names ids the counter never saw, so expectedTotal is
    // deflated and 2-of-2 is a pass against the wrong denominator.
    const row = s.record(
      attempt({ report: report({ countDisputed: true }), rating: null }),
    )

    expect(row.drift.suspect).toBe(true)
    expect(row.drift.incomplete).toBe(false)
    expect(row.drift.countMismatch).toBe(false)
    expect(row.drift.clean).toBe(false)
    expect(s.cleanForTask(row.taskId)).toEqual([])
  })

  it('marks a run whose count over-arrived unclean, which is the counter-bug direction', () => {
    const s = store()
    const row = s.record(
      attempt({ report: report({ passed: 3, total: 3, expectedTotal: 2 }), rating: null }),
    )
    expect(row.drift).toEqual({
      suspect: true,
      incomplete: false,
      countDisputed: false,
      countMismatch: true,
      clean: false,
    })
  })

  it('refuses outright to store a rating on a drifted attempt', () => {
    const s = store()
    // The database is the last line, not the first: app.ts already withholds the
    // rating via reportSuspect. This is what makes a future caller that forgets
    // fail loudly at the write instead of quietly feeding FSRS.
    expect(() =>
      s.record(attempt({ report: report({ expectedTotal: 5, incomplete: true }), rating: 'easy' })),
    ).toThrow(/CHECK constraint failed/)
    expect(s.forTask('storage/grow-home-lv')).toEqual([])
  })

  it('does not treat a failed reboot as drift, because that is a result about the student', () => {
    const s = store()
    const row = s.record(
      attempt({
        report: report({ passed: 0, rebooted: false, rebootError: 'guest never came back' }),
        rating: 'again',
      }),
    )
    expect(row.rebootError).toBe('guest never came back')
    expect(row.drift.clean).toBe(true)
    expect(row.rating).toBe('again')
  })

  it('rolls the objective rows back with the attempt when the write is refused', () => {
    const s = store()
    expect(() =>
      s.record(attempt({ report: report({ expectedTotal: 5, incomplete: true }), rating: 'good' })),
    ).toThrow()
    // A second, valid write must still succeed: a rolled-back transaction that
    // left BEGIN open would fail here with "cannot start a transaction within a
    // transaction".
    expect(s.record(attempt()).drift.clean).toBe(true)
  })
})

/**
 * `attemptDrift` restates `server/session.ts`'s rule rather than importing it,
 * because the engine is the lower layer. This is the pin that keeps the two
 * honest: the whole input matrix, not a sample.
 */
describe('attemptDrift agrees with the server-side reportSuspect', () => {
  function gradeReport(over: Partial<GradeReport>): GradeReport {
    return {
      passed: 0,
      total: 2,
      expectedTotal: 2,
      incomplete: false,
      countDisputed: false,
      allPassed: false,
      rebooted: false,
      regressionCount: 0,
      ...over,
    }
  }

  for (const incomplete of [false, true]) {
    for (const countDisputed of [false, true]) {
      for (const total of [1, 2, 3]) {
        const label = `incomplete=${incomplete} countDisputed=${countDisputed} total=${total}/2`
        it(label, () => {
          const r = gradeReport({ incomplete, countDisputed, total })
          expect(attemptDrift(r).suspect).toBe(reportSuspect(r))
        })
      }
    }
  }
})

describe('AttemptStore, reading attempts back for one task', () => {
  it('returns only that task\'s attempts, oldest first, drifted ones included and marked', () => {
    const s = store()
    const grow = 'storage/grow-home-lv'
    const other = 'selinux/httpd-context'

    const second = s.record(attempt({ taskId: grow, startedAt: STARTED + 60_000, finishedAt: FINISHED + 60_000 }))
    const first = s.record(attempt({ taskId: grow, rating: 'good' }))
    const drifted = s.record(
      attempt({
        taskId: grow,
        startedAt: STARTED + 120_000,
        finishedAt: FINISHED + 120_000,
        report: report({ expectedTotal: 5, incomplete: true }),
        rating: null,
      }),
    )
    s.record(attempt({ taskId: other, objectiveIds: ['selinux-context'] }))

    // Ordered by finished_at, not by insert order: the second attempt was
    // written first on purpose.
    expect(s.forTask(grow).map((a) => a.id)).toEqual([first.id, second.id, drifted.id])
    expect(s.forTask(grow).map((a) => a.drift.clean)).toEqual([true, true, false])
    expect(s.cleanForTask(grow).map((a) => a.id)).toEqual([first.id, second.id])
    expect(s.forTask(other).map((a) => a.taskId)).toEqual([other])
    expect(s.forTask('storage/no-such-task')).toEqual([])
  })

  it('counts an attempt at a task no longer in the bank, which per-task reads cannot', () => {
    // The defect `all()` exists for. `/api/overview` and `/api/calibration` used to
    // sum `forTask` over `bank.tasks`, and this store is append-only precisely so
    // that history outlives content edits — so renaming a task orphaned its rows and
    // both reports quietly shrank. The direction is what makes it worth a test:
    // §9.4's only job is to be believed when it says the user is not ready, and it
    // was understating in the flattering direction.
    const s = store()
    const live = s.record(attempt())
    const orphan = s.record(
      attempt({
        taskId: 'storage/014-renamed-away',
        startedAt: STARTED + 60_000,
        finishedAt: FINISHED + 60_000,
      }),
    )
    const drifted = s.record(
      attempt({
        taskId: 'storage/014-renamed-away',
        startedAt: STARTED + 120_000,
        finishedAt: FINISHED + 120_000,
        report: report({ expectedTotal: 5, incomplete: true }),
        rating: null,
      }),
    )

    expect(s.all().map((a) => a.id)).toEqual([live.id, orphan.id, drifted.id])
    // Objectives are hydrated on the whole-table read too, not only the per-task one.
    expect(s.all()[0]?.objectiveIds).toEqual(['fs-mount', 'lvm-manage'])
    // The clean count comes from the view, so the drifted row is out and the orphan
    // is in — being unreachable from the bank is not the same as being bad evidence.
    expect(s.cleanCount()).toBe(2)
  })

  it('counts nothing in an empty table rather than throwing', () => {
    const s = store()
    expect(s.all()).toEqual([])
    expect(s.cleanCount()).toBe(0)
  })

  it('reads back by objective, which is the unit FSRS schedules', () => {
    const s = store()
    const lvm = s.record(attempt({ objectiveIds: ['lvm-manage'] }))
    s.record(attempt({ taskId: 'selinux/httpd-context', objectiveIds: ['selinux-context'] }))

    expect(s.cleanAttemptsForObjective('lvm-manage').map((a) => a.id)).toEqual([lvm.id])
    expect(s.cleanAttemptsForObjective('selinux-context')).toHaveLength(1)
    expect(s.cleanAttemptsForObjective('never-attempted')).toEqual([])
  })

  it('keeps each attempt\'s objectives to itself when several share one', () => {
    const s = store()
    const a = s.record(attempt({ objectiveIds: ['lvm-manage', 'fs-mount'] }))
    const b = s.record(attempt({ objectiveIds: ['lvm-manage'], startedAt: STARTED + 1, finishedAt: FINISHED + 1 }))

    const rows = s.cleanAttemptsForObjective('lvm-manage')
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id])
    expect(rows.map((r) => r.objectiveIds)).toEqual([['fs-mount', 'lvm-manage'], ['lvm-manage']])
  })

  it('finds one attempt by id and nothing for an id that was never written', () => {
    const s = store()
    const row = s.record(attempt())
    expect(s.byId(row.id)).toEqual(row)
    expect(s.byId(row.id + 1)).toBeUndefined()
  })
})

describe('the history database', () => {
  it('stamps its schema version and refuses a file written by a newer build', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rhcsa-attempts-version-'))
    try {
      const path = join(dir, 'history.db')
      const db = openHistoryDb({ path })
      expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
      db.close()

      const ahead = new DatabaseSync(path)
      ahead.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
      ahead.close()

      // Misreading a newer file's columns is worse than not opening it: the
      // damage would surface weeks later as a wrong readiness report.
      expect(() => openHistoryDb({ path })).toThrow(/newer build/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('holds no content, so the bank can be renumbered without a migration', () => {
    const db = openHistoryDb({ path: MEMORY_DB })
    try {
      const names = db
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name")
        .all()
        .map((r) => (r as { name: string }).name)
      // Section 12's six tables, `attempt_objectives` (section 9.2's scheduling
      // unit) and the guard's view. A seventh name appearing here is either a table
      // section 12 does not list or content that has leaked into the history file.
      expect(names).toEqual([
        'attempt_objectives',
        'attempts',
        'clean_attempts',
        'concept_state',
        'exam_sessions',
        'objective_state',
        'triage_sessions',
        'vm_state',
      ])
    } finally {
      db.close()
    }
  })

  it('rejects a mode, rating or rung it does not recognise, so a typo cannot be stored', () => {
    const db = openHistoryDb({ path: MEMORY_DB })
    try {
      const insert = (cols: string, vals: string) =>
        db.exec(`INSERT INTO attempts (${cols}) VALUES (${vals})`)
      const base =
        "task_id, started_at, finished_at, recorded_at, verdict_a, verdict_final," +
        ' checkpoints_passed, checkpoints_seen, checkpoints_expected, regression_count,' +
        ' rebooted, report_suspect, incomplete, count_disputed'
      const baseVals = "'t', 0, 0, 0, '{}', '{}', 0, 0, 0, 0, 0, 0, 0, 0"

      expect(() => insert(`${base}, mode, rung_used`, `${baseVals}, 'tutorial', 1`)).toThrow(
        /CHECK constraint failed/,
      )
      expect(() => insert(`${base}, mode, rung_used`, `${baseVals}, 'practice', 6`)).toThrow(
        /CHECK constraint failed/,
      )
      expect(() =>
        insert(`${base}, mode, rung_used, rating`, `${baseVals}, 'practice', 1, 'perfect'`),
      ).toThrow(/CHECK constraint failed/)
    } finally {
      db.close()
    }
  })
})
