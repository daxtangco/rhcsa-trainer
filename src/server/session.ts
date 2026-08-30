import {
  advance,
  MAX_RUNG,
  TOP_RUNG,
  type LadderMode,
  type Rung,
} from '../engine/disclosure/ladder.ts'
import { finalVerdict, type GradeResult } from '../engine/grading/grader.ts'
import { allPassed, statusById, type CheckpointStatus } from '../engine/grading/verdict.ts'

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
 *
 * A `ck` may begin its line or follow a command separator, because
 * `content/lib/assert.sh` documents `some_condition; ck my-id "…" $?` as *the*
 * usage — and a checkpoint this counter cannot see is a checkpoint the
 * `incomplete` guard below stops defending. It is deliberately blind to a `ck`
 * in a comment (stripped before matching) and, in practice, to the word `ck`
 * inside a string, since no separator precedes it there.
 *
 * Known misses, all fail-*open* in the counting direction (they under-count, so
 * `incomplete` under-fires) and none of them used by any grader in the bank: a
 * `ck` after `then`, `do`, `else`, `{`, `(` or a line continuation, and an id
 * that breaks the `[a-z0-9-]` convention (`ck my_id` counts as `my`).
 */
const CK_CALL = /(?:^[ \t]*|[;&|][ \t]*)ck(?:_pass|_fail|_skip)?[ \t]+["']?([a-z0-9][a-z0-9-]*)/g

/** `<<EOF`, `<<-EOF` or `<<'EOF'`. `<<<` is a herestring and opens nothing. */
const HEREDOC_START = /<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/

/**
 * Drop a trailing comment. A `#` only starts one at the beginning of a word, so
 * `${lv_bytes#/}` and `grep -q '#' file; ck id "…" $?` survive intact.
 */
function withoutComment(line: string): string {
  const hash = /(?:^|[ \t])#/.exec(line)
  return hash === null ? line : line.slice(0, hash.index)
}

export function countCheckpoints(gradeScript: string): number {
  const ids = new Set<string>()
  let heredoc: string | undefined

  for (const raw of gradeScript.split('\n')) {
    if (heredoc !== undefined) {
      if (raw.trim() === heredoc) heredoc = undefined
      continue
    }

    // A `ck` inside a heredoc body is text the grader prints, not a checkpoint
    // it runs: counting it inflates `expectedTotal` and reports a correct
    // solution as `incomplete`, which is a false *fail*.
    const code = withoutComment(raw).replace(/<<</g, ' ')
    const started = HEREDOC_START.exec(code)
    if (started?.[2] !== undefined) heredoc = started[2]

    for (const m of code.matchAll(CK_CALL)) {
      const id = m[1]
      if (id !== undefined) ids.add(id)
    }
  }

  return ids.size
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
  /** Distinct checkpoint ids that passed. */
  passed: number
  /**
   * How many distinct checkpoint ids the verdict carried — the same unit
   * `expectedTotal` is counted in, so `passed of total` and the comparison
   * against `expectedTotal` are both apples to apples. A grader that emits one
   * id twice does not make this go up.
   */
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
  //
  // Both sides must be counted in the same unit. `expectedTotal` is distinct
  // ids; `v.checkpoints` is *lines*, and parseVerdict does not dedupe — so
  // comparing the array length let a grader that emitted one id twice and then
  // died report a pass for a checkpoint that never ran. `statusById` collapses
  // to one entry per id, which is the unit both sides now speak.
  const status = statusById(v)
  const incomplete = status.size < expectedTotal

  const report: GradeReport = {
    passed: [...status.values()].filter((s) => s === 'pass').length,
    total: status.size,
    expectedTotal,
    incomplete,
    allPassed: allPassed(v) && !incomplete,
    rebooted: result.rebooted,
    regressionCount: result.regressions.length,
  }
  if (result.rebootError !== undefined) report.rebootError = result.rebootError

  if (namesCheckpoints(mode) || revealed) {
    // One row per distinct id, last-wins on the status, matching `statusById`
    // and `total` above: a list of four rows under a heading that says "3 of 5"
    // is the same wrong-unit bug wearing a different coat.
    const rows = new Map<string, MaskedCheckpoint>()
    for (const c of v.checkpoints) rows.set(c.id, { id: c.id, desc: c.desc, status: c.status })
    report.checkpoints = [...rows.values()]
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
