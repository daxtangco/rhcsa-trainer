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
 * A `ck` may also follow `then`, `do`, `else`, `{`, `(` or `)`. That group used
 * to be a documented known-miss list, and the list was wrong twice: the second
 * time because a `case` label is a **closing** paren, so
 * `enabled) ck en-id "d" 0 ;;` counted 0 against bash's 1 and no reader gets
 * that from "`(`" — while `case` is already the bank's idiom
 * (`content/tasks/storage/014-grow-home-lv/grade.sh` and `assert.sh` each
 * contain one). Widening the pattern is now verifiable in a way it was not when
 * the list was written, because `test/server/checkpoint-oracle.ts` measures every
 * one of these shapes against real bash. The asymmetry above decides the rest: a
 * miss here is a silent fail-open, and an over-count from too wide a pattern is a
 * false *fail*, which is loud.
 *
 * A line continuation **before** the `ck` is not a miss, though the opposite was
 * once claimed here: measured, `test -f /x \` followed by `  && ck cont-id "d" $?`
 * counts 1, and so does `: \` followed by `; ck cont-id` — the separator
 * alternation and the leading-space alternation each cover it. A continuation that
 * falls **between `ck` and its id** is a miss, and this is where the earlier
 * wording was too broad: measured, `ck \` followed by `cont-id "d" 0` counts 0
 * against bash's 1, because the id has to be on the same line as the token. That
 * is a silent under-count. No grader in the bank continues a line there — every
 * continuation in the bank falls after the id — and the fix is a second line of
 * lookahead this walk does not have.
 */
const CK_CALL =
  /(?:^|[;&|{()])[ \t]*(?:(?:then|do|else)[ \t]+)?ck(?:_pass|_fail|_skip)?[ \t]+["']?([A-Za-z0-9_][A-Za-z0-9_-]*)/g

/**
 * Where a bash **word** ends. This is `WORD_BREAK` plus `<` and `>`, and the two
 * lists differ on purpose: `WORD_BREAK` answers "may a `#` here start a comment",
 * where a redirect's `>` is unreachable because it needs a target, while this one
 * answers "how far does this word run", where `cat <<EOF >out` plainly ends the
 * delimiter at the `>`. Unifying them would put `>` back into the comment
 * question and re-open R6.
 */
const WORD_END = /[ \t;&|()<>]/

/**
 * A `ck` token sitting immediately before the quote that quotes its id, **word
 * anchored**. Unanchored it fired on any word ending in `ck`, and `-check` is the
 * most natural suffix an RHCSA checkpoint id could have: `ck perm-check "checked;
 * ck also-ran" $?` kept the whole description and declared `also-ran` as a second
 * checkpoint. `-` is inside the class on purpose — that is what makes
 * `perm-check` not a `ck` token.
 */
const CK_BEFORE_QUOTE = /(?:^|[^A-Za-z0-9_-])ck(?:_pass|_fail|_skip)?[ \t]+$/

/**
 * The id at the head of a quoted run, and nothing else. `CK_CALL`'s class is the
 * definition of what an id may contain, so a space or a separator ends one.
 */
const QUOTED_ID = /^[A-Za-z0-9_][A-Za-z0-9_-]*/

/**
 * Where bash begins a new word, which is where a `#` begins a comment. These are
 * its metacharacters, minus two: `<` and `>` are omitted because a redirect needs
 * a target, so `>#` is a syntax error and the position is unreachable. `}` is
 * omitted because it is **not** a metacharacter — measured, `{ true; }#note` is a
 * bash syntax error and `${x}#tag` is a single word, so treating `}` as a word
 * break (a previous review's list claimed it) would cut `echo ${x}#tag; ck real`
 * at the `#` and lose a real checkpoint.
 */
const WORD_BREAK = /[ \t;&|()]/

/** A heredoc this line opens, and whether `<<-` lets its terminator be indented. */
interface PendingHeredoc {
  delim: string
  /** `<<-`: bash strips leading **tabs** from the terminator, never spaces. */
  dash: boolean
}

/**
 * The quoted run a line ended **inside**, carried to the next line. Bash's lexer
 * is not line-at-a-time: `awk 'BEGIN {⏎ … ⏎}'` is one word spanning three lines,
 * and `content/lib/assert.sh` — which `harness.ts:65` prepends to every grader
 * before this counter runs — contains three of them (`:103-107`, `:150-153`,
 * `:164-170`). Without this state the closing line reads as fresh code, so
 * composing the bank's own two documented idioms — a multi-line `awk` program and
 * `assert.sh:60`'s `some_condition; ck my-id "…" $?` — silently dropped the
 * checkpoint: measured, `…}' /etc/fstab; ck fstab-checked "d" $?` counted 0
 * against bash's 1. That is the fail-open direction, and it is unbounded, because
 * a `<<` on a middle line of the run was read as code and queued a phantom
 * heredoc whose terminator never arrives, discarding every remaining line.
 */
interface OpenQuote {
  quote: string
  /**
   * `$'…'`, which honours `\'` where a plain single-quoted run does not — and
   * which really does span lines: measured, `x=$'a⏎b'` is one word to bash.
   */
  ansiC: boolean
}

/**
 * The heredoc a `<<` opens, given the slice of the line that starts at it, or
 * `undefined` if it opens none. Called only from `scanLine`, and only outside
 * `$(( ))`, so a left shift never reaches here.
 *
 * This was a regex (`/^<<(-?)[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/`) and a
 * regex could not express it, because a delimiter is an ordinary bash **word**:
 * quote removal applies to any part of it, and it ends at whitespace or a
 * metacharacter, not at the end of an identifier. The old class was narrower than
 * that in both directions, and both were measured wrong against bash:
 *
 * - `<<EOF-1`, `<<EOF.txt`, `<<E'OF'` → it parsed the delimiter as `EOF`, so the
 *   real terminator never matched and **every remaining line of the grader was
 *   discarded**. bash 1, counter 0 — a silent fail-open.
 * - `<<\EOF`, `<<'END-OF-MSG'`, `<<2EOF` → it matched nothing at all, so the body
 *   was scanned as code and any `ck`-looking text in it was counted. bash 1,
 *   counter 2 — a false fail. `<<\EOF` is the common idiom for a literal heredoc
 *   and a hyphenated delimiter is ordinary style.
 *
 * Quoting decides expansion inside the body, which this counter does not model,
 * so it is only removed here and not recorded. What matters is the delimiter the
 * terminator has to equal, which is the word after quote removal.
 */
function heredocDelimiter(slice: string): PendingHeredoc | undefined {
  let i = 2
  const dash = slice.charAt(i) === '-'
  if (dash) i += 1
  while (i < slice.length && (slice.charAt(i) === ' ' || slice.charAt(i) === '\t')) i += 1

  let delim = ''
  while (i < slice.length) {
    const ch = slice.charAt(i)
    // A backslash quotes exactly the next character: `<<\EOF` names `EOF`.
    if (ch === '\\') {
      if (i + 1 >= slice.length) break
      delim += slice.charAt(i + 1)
      i += 2
      continue
    }
    if (ch === "'" || ch === '"') {
      const close = closingQuote(slice, i + 1, ch, ch === '"')
      // An unclosed run means the word runs off the end of the line; bash would
      // keep reading, and this counter has nothing to read.
      if (close === -1) return undefined
      delim += slice.slice(i + 1, close)
      i = close + 1
      continue
    }
    if (WORD_END.test(ch)) break
    delim += ch
    i += 1
  }

  // `cat <<` with no word is a bash syntax error, so there is no heredoc to open.
  return delim === '' ? undefined : { delim, dash }
}

/**
 * What `CK_CALL` is allowed to look at, plus the heredocs the line opens. The
 * twin of `commandSketch`'s `scanLine`, and deliberately not shared with it: a
 * **quoted id must survive here** (`ck_pass 'home-from-lv' "…"` is a shape the
 * bank uses) and must not survive there (a quoted `sed` expression is argument
 * text). One scanner cannot be right for both.
 *
 * Everything in here is measured against real bash by
 * `test/server/checkpoint-oracle.ts`, which is the reason this walk is allowed to
 * be this detailed: five of the six defects this function has had were introduced
 * by a round that reasoned about shell syntax instead of running any.
 *
 * Six orderings and rules are load-bearing, each because the alternative was
 * measured wrong:
 *
 * 1. `<<` is read **before** any quote handling, so `<<'EOF'` still names its
 *    delimiter. Emptying quoted runs first loses it.
 * 2. A quoted run is emptied **unless** a word-anchored `ck` token precedes it,
 *    and then only its leading id survives. So the phantom id in
 *    `printf "ok; ck phantom-id\n"` disappears, `ck_pass 'home-from-lv'` is kept,
 *    and `ck "real-id; ck phantom"` — where the id bash is handed is the entire
 *    string — cannot declare two checkpoints. Keeping the whole run re-admitted
 *    the phantom-id bug inside the exception meant to fix it.
 * 3. The comment cut happens inside the same walk, so a `#` inside a quoted run
 *    is not a comment. Stripping comments first truncated
 *    `printf "a # b"; ck real "d" $?` at the `#`, leaving an unterminated quote
 *    and losing a real checkpoint.
 * 4. A closing quote is found with the **escapes honoured in the two forms that
 *    honour them** — `"…"` and `$'…'` — and not in a plain `'…'`, where bash
 *    processes no escapes at all and `'it\'` is therefore a complete run. See
 *    `closingQuote`: all three answers are measured, and collapsing any two of
 *    them re-opens R1 in one direction or the other.
 * 5. `<<` is not a heredoc opener inside `$(( ))` or `(( ))`, where it is a left
 *    shift. `want=$(( 1 << shift ))` opened a heredoc named `shift` and discarded
 *    the rest of the file, while `$(( bytes << 3 ))` was fine because a literal
 *    is not an identifier — a distinction no grader author could be expected to
 *    hold in their head.
 * 6. A quoted run that does not close **carries to the next line** rather than
 *    ending the scan, because bash's lexer is not line-at-a-time either. See
 *    `OpenQuote` for the measured fail-open this closes and why the shape is
 *    already present in the counted text.
 *
 * What is left is a **line-at-a-time walk over a grammar that is not**, and rule
 * 6 narrows that gap without closing it. The residual classes are pinned in
 * `ORACLE_DIVERGENCES` with measured pairs; the largest is `CK_CALL`'s anchor set,
 * which does not know the positions where a command may still begin (`! ck …`,
 * `LC_ALL=C ck …`, `time ck …`, `eval 'ck …'`, and a `\` continuation that
 * separates `ck` from its id). Every one of those is a silent **under**-count.
 *
 * Rule 6 also left a seam worth naming, because it is the one place this walk is
 * now inconsistent with itself: `quoted` crosses the newline while `subst` and
 * `arith` are `scanLine` locals that reset on every line, so the pieces of lexical
 * state have different lifetimes. `subst-depth-resets-across-newline` pins what
 * that costs. Nothing in either list is reachable in the bank today, which is a
 * statement about five graders rather than a guarantee about the next one.
 */
function scanLine(
  line: string,
  carried: OpenQuote | undefined,
): { code: string; heredocs: PendingHeredoc[]; open: OpenQuote | undefined } {
  let code = ''
  const heredocs: PendingHeredoc[] = []
  /** Nesting depth of `$(( … ))` / `(( … ))`. */
  let arith = 0
  /** Nesting depth of `$( … )`, so its closing paren is not a word break. */
  let subst = 0
  /** Whether a `#` here would start a comment. */
  let atWordStart = true
  /**
   * Whether the previous character was an **unquoted** `$`, so a `'` here opens
   * an ANSI-C run. Tracked rather than read back off the line, because
   * `line.charAt(i - 1) === '$'` also fires on `echo \$'a\'` — where the `$` is a
   * literal and the run is a plain single-quoted one that `\'` does *not* escape.
   * Measured, that shorter form loses the checkpoint in `echo \$'a\'; ck real-id`.
   */
  let dollar = false
  let i = 0

  if (carried !== undefined) {
    // The line opens inside a quoted run, so its leading part is string content:
    // it declares no checkpoint and — the unbounded half — opens no heredoc.
    // `escapes` has to be computed the same way the main-loop call site below
    // computes it. Passing `carried.ansiC` alone was R1 re-opened through the
    // newline: a carried `"…"` pairs `\"` positionally, the walk stays *inside*
    // the string, and every remaining line of the grader is discarded.
    const close = closingQuote(line, 0, carried.quote, carried.quote === '"' || carried.ansiC)
    if (close === -1) return { code: '', heredocs, open: carried }
    // The delimiters stay for the same reason they do below: so nothing on either
    // side of the run gets glued together.
    code = carried.quote + carried.quote
    atWordStart = false
    i = close + 1
  }

  while (i < line.length) {
    const ch = line.charAt(i)
    // Every branch below consumes at least one character, so only the plain-text
    // branch at the bottom can leave a `$` immediately behind us.
    const afterDollar = dollar
    dollar = false

    if (line.startsWith('$((', i) || line.startsWith('((', i)) {
      arith += 1
      code += ' '
      i += line.startsWith('$((', i) ? 3 : 2
      atWordStart = false
      continue
    }

    if (arith > 0 && line.startsWith('))', i)) {
      arith -= 1
      code += ' '
      i += 2
      atWordStart = false
      continue
    }

    // A command substitution's parens belong to the word around them: `$(date)#x`
    // is one word, so the `#` is not a comment there while it is after the `)` of
    // a subshell. Dropping them also keeps `CK_CALL`'s `(`/`)` anchors from
    // firing on one.
    if (line.startsWith('$(', i)) {
      subst += 1
      code += ' '
      i += 2
      atWordStart = false
      continue
    }
    if (subst > 0 && ch === ')') {
      subst -= 1
      code += ' '
      i += 1
      atWordStart = false
      continue
    }

    // Defence in depth: the anchored HEREDOC_START already refuses `<<<`,
    // because the character after `<<` is `<`. Skipping all three keeps the
    // herestring's word out of the emitted code as well.
    if (line.startsWith('<<<', i)) {
      code += ' '
      i += 3
      atWordStart = false
      continue
    }

    if (line.startsWith('<<', i)) {
      if (arith === 0) {
        // Every opener on the line, in order: `cat <<A <<B` has bodies for both,
        // and keeping only the first read `B`'s body as code.
        const opened = heredocDelimiter(line.slice(i))
        if (opened !== undefined) heredocs.push(opened)
      }
      code += ' '
      i += 2
      atWordStart = false
      continue
    }

    // Outside a quoted run a backslash removes the next character's special
    // meaning: `echo \"` opens no run, and `\#` starts no comment.
    if (ch === '\\' && i + 1 < line.length) {
      code += ' '
      i += 2
      atWordStart = false
      continue
    }

    if (ch === "'" || ch === '"') {
      // `$'…'` is a third quoting form and it honours `\'`, which a plain
      // single-quoted run does not. Missing that closed the run one quote early
      // and desynchronised the rest of the line: R1 through a third form.
      const ansiC = ch === "'" && afterDollar
      const close = closingQuote(line, i + 1, ch, ch === '"' || ansiC)
      const body = close === -1 ? line.slice(i + 1) : line.slice(i + 1, close)
      if (CK_BEFORE_QUOTE.test(code)) {
        // The id itself, and only the id: an id cannot contain a space or a
        // separator, so the rest of the run is description text with nothing in
        // it for `CK_CALL` to find. The quotes stay because `CK_CALL` allows one.
        code += ch + (QUOTED_ID.exec(body)?.[0] ?? '') + ch
      } else {
        // Argument text, and possibly a `; ck …` inside it. Keep the delimiters
        // so nothing on either side of the run gets glued together.
        code += ch + ch
      }
      atWordStart = false
      // An unclosed run does not end the string, it ends the *line*: bash keeps
      // reading the next one as the same word, and so does the caller.
      if (close === -1) return { code, heredocs, open: { quote: ch, ansiC } }
      i = close + 1
      continue
    }

    // A `#` starts a comment only at the start of a word, so `${lv_bytes#/}` and
    // `${#s}` survive while `true;# note` and `(true)# note` are comments.
    if (ch === '#' && atWordStart) break

    code += ch
    i += 1
    atWordStart = WORD_BREAK.test(ch)
    dollar = ch === '$'
  }

  return { code, heredocs, open: undefined }
}

/**
 * The index of the `quote` that closes the run, scanning from `from`, or -1.
 *
 * `escapes` is what separates the three quoting forms, and each setting is a
 * measured requirement rather than a preference. Inside `"…"` bash pairs quote
 * characters *after* removing escaped ones, so `\"` is not a candidate — pairing
 * positionally left the walk running *inside* the string on the odd number of `"`
 * that one `\"` in a description produces. Inside a plain `'…'` bash processes no
 * escapes at all, so `'it\'` is a **complete** run and honouring `\'` there would
 * lose the `ck` after it. Inside `$'…'` it does honour `\'`. Same scan, three
 * answers; collapsing any two of them re-opens R1 in one direction or the other.
 */
function closingQuote(line: string, from: number, quote: string, escapes: boolean): number {
  let i = from
  while (i < line.length) {
    const ch = line.charAt(i)
    if (escapes && ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) return i
    i += 1
  }
  return -1
}

/**
 * The distinct checkpoint ids, sorted — the set `countCheckpoints` returns the
 * size of. Exported for `test/server/checkpoint-oracle.ts`, which compares **id
 * sets** against the ids real bash emits rather than the two cardinalities: a
 * compensating pair, one phantom id gained while one real id is lost, leaves both
 * counts equal and is invisible to a count comparison. Four of this function's
 * six defects moved ids in both directions at once on some input, so that is not
 * a theoretical hole.
 */
export function checkpointIds(gradeScript: string): string[] {
  const ids = new Set<string>()
  const pending: PendingHeredoc[] = []
  /**
   * The quoted run the previous line ended inside. It **outranks** a pending
   * heredoc body, which is bash's own order and the opposite of what this
   * docstring claimed for one round. Measured on
   * `cat <<EOF; x="a` / `ck inside "d" 0` / `b"` / `EOF` / `ck real-id "d" 0`:
   * bash emits `real-id` and not `inside`, and printing `$x` afterwards gives
   * `a⏎ck inside d 0⏎b` — so bash finishes the unterminated *word* across the
   * newline first and only then gathers the body, which here starts at `EOF` and
   * is empty. Checking the body first swallowed the rest of the file instead.
   */
  let quoted: OpenQuote | undefined

  for (const raw of gradeScript.split('\n')) {
    const open = pending.at(0)
    if (open !== undefined && quoted === undefined) {
      // Bash's terminator rule, which `raw.trim() === delim` was not: a plain
      // `<<EOF` body ends only at a line *equal* to the delimiter, `<<-EOF`
      // strips leading tabs and never spaces, and a trailing space never
      // terminates at all. Accepting all three ended the body early, and the
      // lines bash treats as printed text were then read as code.
      const candidate = open.dash ? raw.replace(/^\t+/, '') : raw
      if (candidate === open.delim) pending.shift()
      continue
    }

    // A `ck` inside a heredoc body is text the grader prints, not a checkpoint
    // it runs: counting it inflates `expectedTotal` and reports a correct
    // solution as `incomplete`, which is a false *fail*.
    const scanned = scanLine(raw, quoted)
    quoted = scanned.open
    pending.push(...scanned.heredocs)

    for (const m of scanned.code.matchAll(CK_CALL)) {
      const id = m[1]
      if (id !== undefined) ids.add(id)
    }
  }

  return [...ids].sort()
}

export function countCheckpoints(gradeScript: string): number {
  return checkpointIds(gradeScript).length
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
   * Put the clock back to zero after the VM has been reverted. The rung
   * deliberately survives — see the `/reset` route — but the last grading result
   * does **not**, because a reverted machine has no valid verdict.
   *
   * Measured, exam mode with an injected clock: grade → finish rated a 20-minute
   * solve `good`, while grade → reset → finish rated the same verdict `easy`.
   * `startedAt` had moved to the reset and `endedAt` was half a second later, so
   * `deriveRating` saw `rungUsed <= 1 && durationS <= timeBudgetS` and laundered
   * an over-budget attempt into a cold, inside-budget one — over a verdict
   * measured on a machine that has since been wiped and re-`setup`'d. Clearing it
   * makes `/finish` answer its existing 409 "nothing has been graded yet"
   * instead, which is true. That keeps reset-to-retry working, which a 409 on
   * `/reset`-after-grade would not.
   */
  restart(id: string, now: number): SessionRecord {
    const s = this.#require(id)
    s.startedAt = now
    delete s.result
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
