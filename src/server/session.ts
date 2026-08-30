import {
  advance,
  MAX_RUNG,
  TOP_RUNG,
  type LadderMode,
  type Rung,
} from '../engine/disclosure/ladder.ts'
import { finalVerdict, type GradeResult } from '../engine/grading/grader.ts'
import { allPassed, type CheckpointStatus } from '../engine/grading/verdict.ts'

export type SessionMode = 'guided' | LadderMode
export type SessionPhase = 'active' | 'graded'

export interface SessionRecord {
  id: string
  taskId: string
  mode: SessionMode
  rung: Rung
  /** Number of checkpoints the grader will emit, known before grading. */
  checkpointTotal: number
  startedAt: number
  endedAt?: number
  phase: SessionPhase
  result?: GradeResult
}

/**
 * Every checkpoint id a grader can emit, found without running it. Graders emit
 * through `ck`, `ck_pass`, `ck_fail` or `ck_skip`, and a single checkpoint is
 * routinely emitted from several branches of an if/else — so this counts
 * distinct ids, not call sites. Task 22's authoring rule is what makes it
 * possible: every id is a literal, never a variable.
 */
const CK_CALL = /^[ \t]*ck(?:_pass|_fail|_skip)?[ \t]+["']?([a-z0-9][a-z0-9-]*)/gm

export function countCheckpoints(gradeScript: string): number {
  return new Set([...gradeScript.matchAll(CK_CALL)].map((m) => m[1])).size
}

export function maxRungFor(mode: SessionMode): Rung {
  // Guided mode has no ladder to climb: everything is open from the start.
  return mode === 'guided' ? TOP_RUNG : MAX_RUNG[mode]
}

/** Whether a mode names its checkpoints as soon as it grades. */
function namesCheckpoints(mode: SessionMode): boolean {
  return mode === 'guided' || mode === 'practice'
}

export interface MaskedCheckpoint {
  id: string
  desc: string
  status: CheckpointStatus
}

export interface GradeReport {
  passed: number
  /** How many checkpoints the verdict actually carried. */
  total: number
  /** How many the grade script declares. Differs from `total` on a short run. */
  expectedTotal: number
  /** The grader emitted fewer checkpoints than it declares. */
  incomplete: boolean
  allPassed: boolean
  rebooted: boolean
  rebootError?: string
  regressionCount: number
  checkpoints?: MaskedCheckpoint[]
  regressions?: string[]
}

/**
 * `revealed` is for after the attempt is over: drill and exam mode hide which
 * checkpoints failed while the student can still act on it, because "two of six
 * failed" is the question and "which two" is the answer.
 *
 * `expectedTotal` is the session's `checkpointTotal`, counted statically from
 * the grade script before anything ran. It is the only thing standing between a
 * truncated grader run and a false pass — see the `incomplete` comment below.
 */
export function reportFor(
  mode: SessionMode,
  result: GradeResult,
  revealed: boolean,
  expectedTotal: number,
): GradeReport {
  // finalVerdict returns verdict B when there was one: what survives is what
  // counts.
  const v = finalVerdict(result)

  // A grader that stopped early emits fewer checkpoints than it declares, and
  // `allPassed` only looks at the ones that arrived — so a truncated run over an
  // untouched machine reports a pass. Measured, not assumed: parseVerdict never
  // throws, so a stream cut mid-line yields a short checkpoint list with the
  // partial line filed as noise. countCheckpoints gave us the real number
  // before anything ran; trust that one. Verdict B has its own backstop for this
  // (completeVerdictB); verdict A has nothing above it inside grade() to
  // compare against, which is why the comparison belongs here, where the
  // session knows what was declared.
  const incomplete = v.checkpoints.length < expectedTotal

  const report: GradeReport = {
    passed: v.checkpoints.filter((c) => c.status === 'pass').length,
    total: v.checkpoints.length,
    expectedTotal,
    incomplete,
    allPassed: allPassed(v) && !incomplete,
    rebooted: result.rebooted,
    regressionCount: result.regressions.length,
  }
  if (result.rebootError !== undefined) report.rebootError = result.rebootError

  if (namesCheckpoints(mode) || revealed) {
    report.checkpoints = v.checkpoints.map((c) => ({
      id: c.id,
      desc: c.desc,
      status: c.status,
    }))
    report.regressions = result.regressions.map((c) => c.id)
  }

  return report
}

export class SessionStore {
  #byId = new Map<string, SessionRecord>()
  #seq = 0

  create(taskId: string, mode: SessionMode, checkpointTotal: number, now: number): SessionRecord {
    this.#seq += 1
    const record: SessionRecord = {
      id: `s${this.#seq}`,
      taskId,
      mode,
      rung: 1,
      checkpointTotal,
      startedAt: now,
      phase: 'active',
    }
    this.#byId.set(record.id, record)
    return record
  }

  get(id: string): SessionRecord | undefined {
    return this.#byId.get(id)
  }

  list(): SessionRecord[] {
    return [...this.#byId.values()]
  }

  #require(id: string): SessionRecord {
    const s = this.#byId.get(id)
    if (s === undefined) throw new Error(`unknown session: ${id}`)
    return s
  }

  advanceRung(id: string): SessionRecord {
    const s = this.#require(id)
    if (s.mode === 'guided') {
      // Nothing to unlock; report the top so the caller can render everything.
      s.rung = TOP_RUNG
      return s
    }
    s.rung = advance({ mode: s.mode, rung: s.rung }).rung
    return s
  }

  /**
   * Put the clock back to zero after the VM has been reverted. Everything else
   * about the attempt survives, the rung most of all: see the `/reset` route.
   */
  restart(id: string, now: number): SessionRecord {
    const s = this.#require(id)
    s.startedAt = now
    return s
  }

  /**
   * Store a grading result without ending the attempt. The student may grade as
   * often as they like; in drill and exam mode the report they get back is
   * masked, so grading is not a way to discover the answer.
   */
  record(id: string, result: GradeResult): SessionRecord {
    const s = this.#require(id)
    s.result = result
    return s
  }

  /** End the attempt. This is what unmasks the checkpoint names. */
  finish(id: string, now: number): SessionRecord {
    const s = this.#require(id)
    s.phase = 'graded'
    s.endedAt = now
    return s
  }
}
