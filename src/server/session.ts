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
 * `incomplete` guard below stops defending. It is blind to a `ck` in a comment
 * and to one inside a quoted run, both because `scanLine` removes them before
 * this pattern ever sees the line. That second half used to be an accident of
 * this pattern — "no separator precedes it inside a string" — and adding the
 * separator alternation quietly falsified it: `printf "ok; ck phantom-id\n"`
 * declared a checkpoint that does not exist, which reports a correct solution as
 * `incomplete`. It is now a property of the scan rather than a hope about the
 * regex.
 *
 * The id class is deliberately **wider than the authoring convention**, which is
 * lowercase kebab and stays that way — enforcing it belongs to the static lint
 * (Task 25), not here. The asymmetry is the point: a *counter* that cannot see
 * an id fails **open**, while a *validator* that rejects one fails **closed**.
 * Concretely, with a `[a-z0-9-]` class, `ck lv_size` next to `ck lv` counted as
 * the single id `lv`, so `expectedTotal` landed one low, a truncated run read as
 * complete, and the student was told a checkpoint passed that never ran. A
 * strict class buys nothing here — a non-conforming id is not rejected, it is
 * silently miscounted — so this accepts `_` and uppercase too and lets the lint
 * be the loud half. Measured: widening it moves none of the six counts the bank
 * pins (`assert.sh` 0; 019=8, 014=5, 017=5, 028=5, 006=8).
 *
 * Known misses. All of them under-count, which is the fail-*open* direction —
 * `expectedTotal` lands low, so `incomplete` under-fires — and none is used by
 * any grader in the bank (measured: 43 `ck` call sites across the five graders,
 * every one at column 0 or indented):
 *
 * - a `ck` after `then`, `do`, `else`, `{` or `(` on the same line. Nothing in
 *   `content/` or `docs/` matches that shape and `assert.sh` documents only the
 *   comment form and the separator form, so this stays a disclosure.
 * - a `ck` whose id is produced by an arithmetic shift's neighbour:
 *   `want=$(( 1 << shift ))` opens a phantom heredoc, because the `<<` is not
 *   inside quotes and this scan does not track redirect position. Every line
 *   after it is discarded. No grader shifts (measured: the only `$((` uses are
 *   `/ 86400` and `1024 ** 2..4`), and the runtime warning in `reportFor` is
 *   what would surface it if one did.
 *
 * A **line continuation is not** in this list, though it was once claimed here:
 * measured, `test -f /x \` followed by `  && ck cont-id "d" $?` counts 1, and so
 * does a continued bare `ck` — the separator alternation and the leading-space
 * alternation each cover it.
 */
const CK_CALL =
  /(?:^[ \t]*|[;&|][ \t]*)ck(?:_pass|_fail|_skip)?[ \t]+["']?([A-Za-z0-9_][A-Za-z0-9_-]*)/g

/**
 * `<<EOF`, `<<-EOF` or `<<'EOF'`, **anchored** — it is matched against the slice
 * that starts at a `<<`, never against the whole line. Unanchored, it was the
 * same defect F8 fixed in `content.ts`: `echo "a << b"` opened a heredoc named
 * `b` and every remaining line of the grader was discarded.
 */
const HEREDOC_START = /^<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/

/** A `ck` token sitting immediately before the quote that quotes its id. */
const CK_BEFORE_QUOTE = /ck(?:_pass|_fail|_skip)?[ \t]+$/

/**
 * What `CK_CALL` is allowed to look at, plus the heredoc the line opens. The
 * twin of `commandSketch`'s `scanLine`, and deliberately not shared with it: a
 * **quoted id must survive here** (`ck_pass 'home-from-lv' "…"` is a shape the
 * bank uses) and must not survive there (a quoted `sed` expression is argument
 * text). One scanner cannot be right for both.
 *
 * Three orderings in here are load-bearing, each because the alternative was
 * measured wrong:
 *
 * 1. `<<` is read **before** any quote handling, so `<<'EOF'` still names its
 *    delimiter. Emptying quoted runs first loses it.
 * 2. A quoted run is emptied **unless** a `ck` token precedes it, so the phantom
 *    id in `printf "ok; ck phantom-id\n"` disappears while `ck_pass 'id'`
 *    survives. Emptying unconditionally breaks the quoted id.
 * 3. The comment cut happens inside the same walk, so a `#` inside a quoted run
 *    is not a comment. Stripping comments first truncated
 *    `printf "a # b"; ck real "d" $?` at the `#`, leaving an unterminated quote
 *    and losing a real checkpoint.
 */
function scanLine(line: string): { code: string; heredoc?: string } {
  let code = ''
  let heredoc: string | undefined
  let i = 0

  while (i < line.length) {
    const ch = line.charAt(i)

    // Defence in depth: the anchored HEREDOC_START already refuses `<<<`,
    // because the character after `<<` is `<`. Skipping all three keeps the
    // herestring's word out of the emitted code as well.
    if (line.startsWith('<<<', i)) {
      code += ' '
      i += 3
      continue
    }

    if (line.startsWith('<<', i)) {
      const m = HEREDOC_START.exec(line.slice(i))
      if (heredoc === undefined && m?.[2] !== undefined) heredoc = m[2]
      code += ' '
      i += 2
      continue
    }

    if (ch === "'" || ch === '"') {
      const close = line.indexOf(ch, i + 1)
      if (CK_BEFORE_QUOTE.test(code)) {
        // The id itself. Keep it, quotes and all - `CK_CALL` allows the quote.
        code += close === -1 ? line.slice(i) : line.slice(i, close + 1)
      } else {
        // Argument text, and possibly a `; ck …` inside it. Keep the delimiters
        // so nothing on either side of the run gets glued together.
        code += ch + ch
      }
      // An unclosed quote runs to end of line.
      if (close === -1) break
      i = close + 1
      continue
    }

    // A `#` starts a comment only at the start of a word, so `${lv_bytes#/}`
    // survives.
    if (ch === '#' && (i === 0 || /[ \t]/.test(line.charAt(i - 1)))) break

    code += ch
    i += 1
  }

  return { code, heredoc }
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
    const scanned = scanLine(raw)
    if (scanned.heredoc !== undefined) heredoc = scanned.heredoc

    for (const m of scanned.code.matchAll(CK_CALL)) {
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

  // The other direction, which no field on this report can express: more distinct
  // ids arrived than the script declared. That cannot be the machine's fault -
  // the grader emitted them - so it means `countCheckpoints` under-counted, and
  // an under-count is what turns the `incomplete` guard off. Over-arrival is
  // therefore the runtime signature of a counter bug, and the counter has had
  // four. Warn, and do not fail the grade: the count is the suspect here, and
  // failing a correct run over a bad count is the mistake this whole guard exists
  // to avoid.
  if (status.size > expectedTotal) {
    console.warn(
      `[grade] ${status.size} checkpoints arrived but the script declares ${expectedTotal};` +
        ' countCheckpoints under-counted this grader',
    )
  }

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
