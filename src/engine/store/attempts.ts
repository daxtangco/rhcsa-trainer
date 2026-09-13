import type { DatabaseSync } from 'node:sqlite'
import { RUNGS, type Rating, type Rung } from '../disclosure/ladder.ts'
import { parseVerdict, type Verdict } from '../grading/verdict.ts'
import {
  MEMORY_DB,
  openHistoryDb,
  type AttemptMode,
  type PredictedOutcome,
} from './schema.ts'

export { MEMORY_DB, type AttemptMode, type PredictedOutcome }

/**
 * The part of `server/session.ts`'s `GradeReport` this store reads. Structural,
 * not imported: the engine is the lower layer and must not depend on the server.
 * A `GradeReport` satisfies it, so `app.ts` passes its report straight in, and if
 * a field here is ever renamed there the call site stops compiling.
 *
 * The store takes the **report** rather than a pre-computed "is this clean" flag
 * on purpose. Drift is derived here, once, by `attemptDrift` — so no caller can
 * record a drifted attempt as clean by forgetting to look.
 */
export interface AttemptReport {
  /** Distinct checkpoint ids that passed. */
  passed: number
  /** Distinct checkpoint ids the verdict carried. */
  total: number
  /** Distinct checkpoint ids the grade script declares. */
  expectedTotal: number
  incomplete: boolean
  countDisputed: boolean
  regressionCount: number
  rebooted: boolean
  rebootError?: string
}

/**
 * Why an attempt may or may not be used as evidence about the student.
 *
 * `clean` is the only field a scheduler should ever consult, and it is recomputed
 * from the database's own generated column on the way back out — never read from
 * whatever the writer believed at the time.
 */
export interface AttemptDrift {
  /**
   * The report could not support a truth-claim in either direction. Mirrors
   * `server/session.ts`'s `reportSuspect`, which is the function `app.ts` uses to
   * withhold the rating; `test/store/attempts.test.ts` pins the two together
   * across the whole input matrix so they cannot drift apart.
   */
  suspect: boolean
  /** Fewer distinct ids arrived than the grade script declares. */
  incomplete: boolean
  /** The grade script's own headers name ids its checkpoint count never saw. */
  countDisputed: boolean
  /** The count that arrived disagrees with the count the task declares, in either direction. */
  countMismatch: boolean
  /** No drift signal fired. Only a clean attempt may carry a rating, and the schema enforces it. */
  clean: boolean
}

/**
 * The three ways a grade turns out to have been measured against a guest that had
 * drifted, plus the derived verdict on whether the attempt is usable.
 *
 * `suspect` restates `reportSuspect`'s rule rather than calling it, because that
 * function lives in the server layer. The duplication is deliberate and pinned by
 * a test; the alternative was an engine module importing `server/session.ts`.
 */
export function attemptDrift(report: AttemptReport): AttemptDrift {
  const countMismatch = report.total !== report.expectedTotal
  const suspect = report.incomplete || report.countDisputed || report.total > report.expectedTotal
  return {
    suspect,
    incomplete: report.incomplete,
    countDisputed: report.countDisputed,
    countMismatch,
    clean: !suspect && !countMismatch,
  }
}

export interface AttemptInput {
  taskId: string
  /** The task's objectives, section 9.2's scheduling unit. */
  objectiveIds: readonly string[]
  mode: AttemptMode
  startedAt: number
  finishedAt: number
  /** The rung the ladder reached, which is what section 9.2 derives the rating from. */
  rungUsed: Rung
  /** "Works now". */
  verdictA: Verdict
  /** "Survives reboot". Absent when no reboot was performed. */
  verdictB?: Verdict
  /** What actually counts: `grader.ts`'s `finalVerdict` of the two above. */
  finalVerdict: Verdict
  report: AttemptReport
  /**
   * Derived, never self-reported (section 9.2), and `null` both for guided mode
   * and for a report that cannot support one. The schema rejects a non-null
   * rating on a drifted attempt outright.
   */
  rating: Rating | null
  /** Section 10.2's pre-grade click, once a later Phase 2 bullet captures it. */
  predictedOutcome?: PredictedOutcome
}

export interface AttemptRow {
  id: number
  taskId: string
  objectiveIds: string[]
  mode: AttemptMode
  startedAt: number
  finishedAt: number
  /** When the row was written, from the injected clock. */
  recordedAt: number
  /** `finished_at - started_at`, rounded to seconds by the schema. */
  durationS: number
  rungUsed: Rung
  verdictA: Verdict
  verdictB?: Verdict
  finalVerdict: Verdict
  checkpointsPassed: number
  checkpointsSeen: number
  checkpointsExpected: number
  regressionCount: number
  rebooted: boolean
  rebootError?: string
  drift: AttemptDrift
  rating: Rating | null
  predictedOutcome?: PredictedOutcome
}

const INSERT_ATTEMPT = `
INSERT INTO attempts (
  task_id, mode, started_at, finished_at, recorded_at, rung_used,
  verdict_a, verdict_b, verdict_final,
  checkpoints_passed, checkpoints_seen, checkpoints_expected,
  regression_count, rebooted, reboot_error,
  report_suspect, incomplete, count_disputed,
  rating, predicted_outcome
) VALUES (
  :taskId, :mode, :startedAt, :finishedAt, :recordedAt, :rungUsed,
  :verdictA, :verdictB, :verdictFinal,
  :passed, :seen, :expected,
  :regressions, :rebooted, :rebootError,
  :suspect, :incomplete, :countDisputed,
  :rating, :predictedOutcome
)`

const SELECT_COLUMNS = `
  id, task_id, mode, started_at, finished_at, recorded_at, duration_s, rung_used,
  verdict_a, verdict_b, verdict_final,
  checkpoints_passed, checkpoints_seen, checkpoints_expected,
  regression_count, rebooted, reboot_error,
  report_suspect, incomplete, count_disputed, clean,
  rating, predicted_outcome`

function bool(v: boolean): number {
  return v ? 1 : 0
}

/**
 * Everything read back out of SQLite is unknown until checked, including rows
 * this module wrote: the file is a file, on a machine whose whole purpose is
 * being broken and reverted by a student. A wrong column type here would
 * otherwise surface as a nonsense readiness report weeks later.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(row: Record<string, unknown>, col: string): number {
  const v = row[col]
  if (typeof v === 'number') return v
  // A rowid arrives as a bigint once it exceeds 2^32 on some builds.
  if (typeof v === 'bigint') return Number(v)
  throw new Error(`attempts.${col}: expected a number, found ${typeof v}`)
}

function text(row: Record<string, unknown>, col: string): string {
  const v = row[col]
  if (typeof v === 'string') return v
  throw new Error(`attempts.${col}: expected text, found ${typeof v}`)
}

function optText(row: Record<string, unknown>, col: string): string | undefined {
  const v = row[col]
  if (v === null || v === undefined) return undefined
  if (typeof v === 'string') return v
  throw new Error(`attempts.${col}: expected text or null, found ${typeof v}`)
}

function flag(row: Record<string, unknown>, col: string): boolean {
  const v = num(row, col)
  if (v !== 0 && v !== 1) throw new Error(`attempts.${col}: expected 0 or 1, found ${v}`)
  return v === 1
}

const RUNG_SET: ReadonlySet<number> = new Set<number>(RUNGS)

function rung(row: Record<string, unknown>): Rung {
  const v = num(row, 'rung_used')
  if (!RUNG_SET.has(v)) throw new Error(`attempts.rung_used: ${v} is not a rung`)
  // Checked against RUNGS itself, so a sixth rung added to the union reaches
  // this guard through `RUNGS` rather than being rejected here.
  return v as Rung
}

/**
 * Decoded by feeding the stored checkpoints back through `parseVerdict`, the
 * same validator the grader's stdout goes through. Reusing it means a checkpoint
 * whose shape no longer holds is *caught* rather than trusted, and means there is
 * no second copy of the checkpoint schema to keep in step.
 *
 * `JSON.stringify` escapes newlines inside strings, so a checkpoint whose
 * `detail` contains one cannot split its own JSONL line.
 */
function decodeVerdict(json: string, label: string): Verdict {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (e) {
    throw new Error(`${label}: stored verdict is not JSON: ${e instanceof Error ? e.message : e}`)
  }
  if (!isRecord(raw) || !Array.isArray(raw.checkpoints) || !Array.isArray(raw.noise)) {
    throw new Error(`${label}: stored verdict is not a verdict`)
  }
  const reparsed = parseVerdict(raw.checkpoints.map((c) => JSON.stringify(c)).join('\n'))
  if (reparsed.noise.length > 0) {
    throw new Error(
      `${label}: ${reparsed.noise.length} of ${raw.checkpoints.length} stored checkpoints no longer` +
        ' parse as checkpoints',
    )
  }
  return { checkpoints: reparsed.checkpoints, noise: raw.noise.filter((n) => typeof n === 'string') }
}

function decodeRating(row: Record<string, unknown>): Rating | null {
  const v = optText(row, 'rating')
  if (v === undefined) return null
  // The column's CHECK is the gate; this narrows without a second list to drift.
  return v as Rating
}

function decodeRow(row: Record<string, unknown>): AttemptRow {
  const id = num(row, 'id')
  const label = `attempt ${id}`
  const out: AttemptRow = {
    id,
    taskId: text(row, 'task_id'),
    objectiveIds: [],
    mode: text(row, 'mode') as AttemptMode,
    startedAt: num(row, 'started_at'),
    finishedAt: num(row, 'finished_at'),
    recordedAt: num(row, 'recorded_at'),
    durationS: num(row, 'duration_s'),
    rungUsed: rung(row),
    verdictA: decodeVerdict(text(row, 'verdict_a'), `${label} verdict A`),
    finalVerdict: decodeVerdict(text(row, 'verdict_final'), `${label} final verdict`),
    checkpointsPassed: num(row, 'checkpoints_passed'),
    checkpointsSeen: num(row, 'checkpoints_seen'),
    checkpointsExpected: num(row, 'checkpoints_expected'),
    regressionCount: num(row, 'regression_count'),
    rebooted: flag(row, 'rebooted'),
    drift: {
      suspect: flag(row, 'report_suspect'),
      incomplete: flag(row, 'incomplete'),
      countDisputed: flag(row, 'count_disputed'),
      countMismatch: num(row, 'checkpoints_seen') !== num(row, 'checkpoints_expected'),
      // The generated column, not a recomputation: what the schema says is what
      // the scheduler must see.
      clean: flag(row, 'clean'),
    },
    rating: decodeRating(row),
  }
  const b = optText(row, 'verdict_b')
  if (b !== undefined) out.verdictB = decodeVerdict(b, `${label} verdict B`)
  const rebootError = optText(row, 'reboot_error')
  if (rebootError !== undefined) out.rebootError = rebootError
  const predicted = optText(row, 'predicted_outcome')
  if (predicted !== undefined) out.predictedOutcome = predicted as PredictedOutcome
  return out
}

export interface AttemptStoreOptions {
  /**
   * Injected so tests are deterministic — the store never calls `Date.now()`.
   * Used for `recorded_at` only: `startedAt` and `finishedAt` belong to the
   * session and are already measured against `app.ts`'s injected clock.
   */
  now: () => number
}

/**
 * Attempt history. One user, so there is no `user_id` anywhere (spec section 12).
 */
export class AttemptStore {
  readonly #db: DatabaseSync
  readonly #now: () => number

  constructor(db: DatabaseSync, opts: AttemptStoreOptions) {
    this.#db = db
    this.#now = opts.now
  }

  /**
   * Writes the attempt and its objective rows in one transaction, so a scheduler
   * can never find an attempt whose objectives are half there. `DELETE`-free and
   * append-only in practice: an attempt is a historical fact.
   *
   * Returns the row as stored — read back rather than echoed, because `clean` and
   * `duration_s` are computed by the schema and the caller's beliefs about them
   * are exactly what must not be trusted.
   */
  record(input: AttemptInput): AttemptRow {
    const drift = attemptDrift(input.report)
    const db = this.#db

    db.exec('BEGIN')
    let id: number
    try {
      const res = db.prepare(INSERT_ATTEMPT).run({
        taskId: input.taskId,
        mode: input.mode,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        recordedAt: this.#now(),
        rungUsed: input.rungUsed,
        verdictA: JSON.stringify(input.verdictA),
        verdictB: input.verdictB === undefined ? null : JSON.stringify(input.verdictB),
        verdictFinal: JSON.stringify(input.finalVerdict),
        passed: input.report.passed,
        seen: input.report.total,
        expected: input.report.expectedTotal,
        regressions: input.report.regressionCount,
        rebooted: bool(input.report.rebooted),
        rebootError: input.report.rebootError ?? null,
        suspect: bool(drift.suspect),
        incomplete: bool(drift.incomplete),
        countDisputed: bool(drift.countDisputed),
        rating: input.rating,
        predictedOutcome: input.predictedOutcome ?? null,
      })
      id = Number(res.lastInsertRowid)

      const link = db.prepare(
        'INSERT OR IGNORE INTO attempt_objectives (attempt_id, objective_id) VALUES (?, ?)',
      )
      for (const objectiveId of input.objectiveIds) link.run(id, objectiveId)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }

    const stored = this.byId(id)
    if (stored === undefined) throw new Error(`attempt ${id} vanished immediately after insert`)
    return stored
  }

  byId(id: number): AttemptRow | undefined {
    const row = this.#db.prepare(`SELECT ${SELECT_COLUMNS} FROM attempts WHERE id = ?`).get(id)
    if (!isRecord(row)) return undefined
    return this.#hydrate([decodeRow(row)])[0]
  }

  /**
   * Every attempt at one task, oldest first — drifted ones included. This is the
   * history view: a student looking at what they have done is entitled to see the
   * runs the grader could not score, and to see them marked.
   */
  forTask(taskId: string): AttemptRow[] {
    return this.#query('attempts', 'task_id = ?', [taskId])
  }

  /**
   * Every attempt in the table, oldest first, drifted included.
   *
   * Exists because the caller that wanted it (`/api/overview`, `/api/calibration`)
   * was looping `forTask` over `bank.tasks`, which cannot see an attempt whose task
   * has since been renamed or removed from the bank. That undercount runs in the
   * flattering direction — §9.4's whole job is to be believable when it says the
   * user is not ready, and a total that quietly drops history is not.
   *
   * Deliberately **not** filtered to the bank. A row for a task that no longer
   * exists is still something the user did, and the alternative is a report that
   * silently disagrees with `SELECT count(*)`.
   */
  all(): AttemptRow[] {
    return this.#query('attempts')
  }

  /**
   * How many attempts the `clean_attempts` view returns.
   *
   * A count, not rows: the only caller needs the number, and asking the view
   * rather than filtering `all()` on `drift.clean` keeps `clean`'s definition in
   * exactly one place — the generated column — instead of reimplementing it here
   * where it could drift from it.
   */
  cleanCount(): number {
    const row = this.#db.prepare('SELECT count(*) AS n FROM clean_attempts').get()
    if (!isRecord(row) || typeof row.n !== 'number') {
      throw new Error('clean_attempts count returned no number')
    }
    return row.n
  }

  /** Only the attempts at one task that may be used as evidence. */
  cleanForTask(taskId: string): AttemptRow[] {
    return this.#query('clean_attempts', 'task_id = ?', [taskId])
  }

  /**
   * The scheduler's read: attempts against one objective, oldest first, clean
   * only. There is deliberately **no** drifted variant of this method. Section
   * 9.2's ratings are per objective, so this is the shape FSRS will ask for, and
   * the guard is worth nothing if the convenient call is the unguarded one.
   */
  cleanAttemptsForObjective(objectiveId: string): AttemptRow[] {
    return this.#query(
      'clean_attempts',
      'id IN (SELECT attempt_id FROM attempt_objectives WHERE objective_id = ?)',
      [objectiveId],
    )
  }

  close(): void {
    this.#db.close()
  }

  #query(from: string, where?: string, params: readonly string[] = []): AttemptRow[] {
    const filter = where === undefined ? '' : ` WHERE ${where}`
    const rows = this.#db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM ${from}${filter} ORDER BY finished_at, id`)
      .all(...params)
    return this.#hydrate(rows.filter(isRecord).map(decodeRow))
  }

  /** One query for every attempt's objectives rather than one per attempt. */
  #hydrate(attempts: AttemptRow[]): AttemptRow[] {
    if (attempts.length === 0) return attempts
    const holes = attempts.map(() => '?').join(', ')
    const links = this.#db
      .prepare(
        `SELECT attempt_id, objective_id FROM attempt_objectives
         WHERE attempt_id IN (${holes}) ORDER BY objective_id`,
      )
      .all(...attempts.map((a) => a.id))
    const byAttempt = new Map<number, AttemptRow>(attempts.map((a) => [a.id, a]))
    for (const link of links) {
      if (!isRecord(link)) continue
      byAttempt.get(num(link, 'attempt_id'))?.objectiveIds.push(text(link, 'objective_id'))
    }
    return attempts
  }
}

export interface OpenAttemptStoreOptions extends AttemptStoreOptions {
  /** File path, or `MEMORY_DB` for a throwaway. Parent directories are created. */
  path: string
}

export function openAttemptStore(opts: OpenAttemptStoreOptions): AttemptStore {
  return new AttemptStore(openHistoryDb({ path: opts.path }), { now: opts.now })
}
