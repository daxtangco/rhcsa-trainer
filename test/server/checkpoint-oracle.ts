/**
 * A differential oracle for `countCheckpoints`, with **real bash** as the
 * reference implementation.
 *
 * Why this file exists: `countCheckpoints` had five defects in three fix rounds,
 * and every one of them was introduced by a round that verified its work by
 * reasoning about shell shapes instead of measuring what a shell does with them.
 * Reasoning is what produced "`}` starts a comment after a non-blank character"
 * (bash: syntax error) and "an odd number of `"` on a line is harmless". So this
 * table does not encode an expected number at all. For each fragment it asks
 * bash which checkpoint ids the fragment *actually emits*, and requires
 * `countCheckpoints` to agree.
 *
 * It needs no VM, no root and no network, because `ck`, `ck_pass`, `ck_fail` and
 * `ck_skip` in `content/lib/assert.sh` are pure bash string manipulation plus
 * `printf`. Prepending that library to a fragment and running it under bash is
 * the whole apparatus. Temp files go under `os.tmpdir()`; nothing is written
 * inside the repo.
 *
 * **The constraint every case must satisfy: it must be single-path.** Every `ck`
 * a fragment contains has to be on the path the fragment actually takes, and the
 * fragment must not contain a `ck` on a path it does not take. `countCheckpoints`
 * is *static*: it counts the distinct ids declared on **all** paths, because a
 * real grader emits the same id from both arms of an if/else and the session
 * needs the number of checkpoints that will arrive, not the number of calls. So
 * on a branching script "emitted" and "declared" are legitimately different sets
 * and bash is not an oracle for it. `if false; then …; else ck x; fi` is
 * admissible because its only `ck` is on the taken path; `if $c; then ck a; else
 * ck b; fi` is not, and belongs in a hand-expected test instead.
 *
 * Two lists, and the difference between them is load-bearing:
 *
 * - `ORACLE_CASES` — bash and the counter must agree. This is the gate.
 * - `ORACLE_DIVERGENCES` — shapes where they provably do not, each pinned to its
 *   measured pair so it stays visible. A shape is only allowed in here with a
 *   direction (`over` fails closed and loud, `under` fails open and silent) and a
 *   reason it is not fixed. It is not a place to park an under-count.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { countCheckpoints } from '../../src/server/session.ts'

/** A literal tab, so a heredoc terminator's indentation is visible in source. */
const TAB = '\t'

/** One fragment per line, newline-terminated the way a real grader is. */
function sh(...lines: string[]): string {
  return lines.join('\n') + '\n'
}

export interface OracleCase {
  /** Stable name. Appears in the failure output and in the report table. */
  name: string
  /** The grader fragment. Must be single-path — see the module docstring. */
  script: string
}

/**
 * Shapes bash and `countCheckpoints` must agree on.
 *
 * Seeded from every shape the round-3 re-review named (R1-R7), both parities
 * wherever it measured parities, plus every shape earlier rounds pinned: the
 * separator form `assert.sh` documents, `&&`, `||`, `|`, quoted and unquoted
 * heredoc bodies, `<<-`, `<<<`, a quoted id, the F17 id-class collision and the
 * comment forms.
 */
export const ORACLE_CASES: OracleCase[] = [
  // ---------------------------------------------------------------- R1: escapes
  { name: 'r1-escaped-quote-then-ck', script: sh(String.raw`echo "it\"s ok"; ck real-id "d" $?`) },
  { name: 'r1-escaped-quote-short', script: sh(String.raw`echo "a\"b"; ck lost-id "d" $?`) },
  {
    name: 'r1-printf-escaped-quote',
    script: sh(String.raw`printf '%s\n' "wanted \" here"; ck real-id "d" $?`),
  },
  { name: 'r1-bare-escaped-quote', script: sh(String.raw`echo \"; ck real-id "d" $?`) },
  {
    // The worst variant: the `<<` sits *inside* the run the walk lost track of,
    // so a phantom heredoc discards every remaining line of the grader.
    name: 'r1-heredoc-inside-desynced-string',
    script: sh(String.raw`echo "a \" b << EOF c"`, 'ck one-id "d" 0', 'ck two-id "d" 0'),
  },
  {
    // Even parity, correct before this round. Pinned so the characterisation
    // stays exact: the bug was odd-parity only.
    name: 'r1-even-parity-nested-quotes',
    script: sh(String.raw`grep -q "\"Listen 82\"" /etc/hosts; ck listen-set "d" $?`),
  },
  {
    name: 'r1-even-parity-escaped-desc',
    script: sh(String.raw`ck first-id "a \"b\" c" 0`, 'ck second-id "d" 0'),
  },
  {
    // Bash processes no escapes at all inside single quotes, so `'it\'` is a
    // *complete* run. A fix that treats both quote types alike loses the `ck`.
    name: 'r1-single-quote-keeps-backslash',
    script: sh(String.raw`echo 'it\'; ck real-id "d" $?`),
  },
  {
    name: 'r1-single-quote-holds-escaped-double',
    script: sh(String.raw`echo 'a\"b'; ck real-id "d" $?`),
  },
  {
    // An escaped backslash must not eat the closing quote.
    name: 'r1-double-backslash-before-close',
    script: sh(String.raw`echo "a\\"; ck real-id "d" $?`),
  },

  // ------------------------------------------------- R2/R3: the quoted-id rule
  {
    // `-check` is the most natural suffix an RHCSA checkpoint id could have, and
    // `perm-check` is not a `ck` token.
    name: 'r2-id-ending-in-check',
    script: sh('ck perm-check "checked; ck also-ran" 0'),
  },
  { name: 'r2-id-ending-in-check-amp', script: sh('ck fs-check "ran && ck nope" 0') },
  {
    name: 'r2-fsck-before-quote',
    script: sh('dev=/dev/null', 'fsck "$dev; ck phantom" >/dev/null 2>&1', 'ck real-id "d" 0'),
  },
  {
    // The exception used as a weapon: the id bash is handed is the whole string.
    name: 'r3-separator-inside-quoted-id',
    script: sh('ck "real-id; ck phantom" "d" 0'),
  },
  { name: 'pin-quoted-id-single', script: sh(`ck_pass 'home-from-lv' "desc"`) },
  { name: 'pin-quoted-id-double', script: sh('ck "quoted-id" "desc" 0') },

  // ----------------------------------------- R4: heredoc terminator, bash rules
  {
    // A tab-indented `EOF` does not end a plain `<<EOF` body.
    name: 'r4-tab-indented-eof-plain',
    script: sh('cat <<EOF', `${TAB}EOF`, 'ck phantom "d" 0', 'EOF', 'ck real-id "d" 0'),
  },
  {
    // Nor does a trailing space.
    name: 'r4-trailing-space-eof',
    script: sh('cat <<EOF', 'EOF ', 'ck phantom "d" 0', 'EOF', 'ck real-id "d" 0'),
  },
  {
    // `<<-` strips leading *tabs*, so this one does terminate.
    name: 'r4-dash-tab-indented-eof',
    script: sh('cat <<-EOF', `${TAB}ck heredoc-id "x" 0`, `${TAB}EOF`, 'ck real-id "y" 0'),
  },
  {
    // `<<-` strips tabs only, never spaces, so this one does not.
    name: 'r4-dash-space-indented-eof',
    script: sh('cat <<-EOF', '  EOF', 'ck phantom "d" 0', 'EOF', 'ck real-id "d" 0'),
  },

  // ------------------------------------------- R5: several openers on one line
  {
    name: 'r5-two-openers-one-line',
    script: sh('cat <<A <<B', 'body-a', 'A', 'ck phantom "d" 0', 'B', 'ck real-id "d" 0'),
  },
  {
    name: 'pin-two-heredocs-in-sequence',
    script: sh('cat <<A', 'a-body', 'A', 'cat <<B', 'b-body', 'B', 'ck real-id "d" 0'),
  },

  // ------------------------------------------------- R6: where a comment starts
  {
    name: 'r6-comment-after-semicolon',
    script: sh('true;# note; ck phantom "d" 0', 'ck real-id "d" 0'),
  },
  {
    name: 'r6-comment-after-close-paren',
    script: sh('(true)# note; ck phantom "d" 0', 'ck real-id "d" 0'),
  },
  {
    name: 'r6-comment-after-ampersand',
    script: sh('true &#note; ck phantom "d" 0', 'ck real-id "d" 0'),
  },
  {
    name: 'r6-comment-after-and-and',
    script: sh('true &&#note', 'ck real-id "d" 0'),
  },
  {
    // The fail-open one: a `<<` inside an unrecognised comment opens a phantom
    // heredoc and discards the rest of the file.
    name: 'r6-comment-after-semicolon-holds-heredoc',
    script: sh('true;#uses <<EOF style', 'ck real-id "d" 0'),
  },
  {
    // The other direction, and why `}` must not join the list: `}` is not a bash
    // metacharacter, so this `#` is part of a word, not a comment.
    name: 'r6-hash-after-close-brace-is-not-a-comment',
    script: sh('x=abc; y=${x}#tag; ck real-id "$y" 0'),
  },
  { name: 'r6-parameter-strip-hash', script: sh('x=/abc; y=${x#/}; ck real-id "$y" 0') },
  { name: 'r6-parameter-length-hash', script: sh('s=abc; echo ${#s}; ck real-id "d" 0') },
  { name: 'r6-hash-mid-word', script: sh('echo a#b; ck real-id "d" 0') },
  { name: 'r6-escaped-hash', script: sh(String.raw`echo \#; ck real-id "d" 0`) },
  {
    name: 'r6-comment-after-redirect-word',
    script: sh('echo hi >/dev/null #x; ck phantom "d" 0', 'ck real-id "d" 0'),
  },

  // --------------------------------------------- arithmetic, not a redirect
  {
    // The disclosed residual, now closed: `shift` is an identifier, so
    // HEREDOC_START matched it and every later line was discarded.
    name: 'arith-shift-by-identifier',
    script: sh('want=$(( 1 << shift ))', 'ck real-id "d" 0'),
  },
  {
    // A shift by a literal was already counted. The distinction between this and
    // the line above is one no grader author could hold in their head.
    name: 'arith-shift-by-literal',
    script: sh('want=$(( bytes << 3 ))', 'ck real-id "d" 0'),
  },
  {
    name: 'arith-double-paren-shift',
    script: sh('(( x = 1 << shift ))', 'ck real-id "d" 0'),
  },
  {
    name: 'arith-shift-inside-quotes',
    script: sh('echo "$(( 1 << shift ))"; ck real-id "d" 0'),
  },
  {
    name: 'arith-nested-parens-then-shift',
    script: sh('want=$(( (2 + 1) << shift ))', 'ck real-id "d" 0'),
  },

  // ------------------------------------------- R7: the known-misses group
  {
    // A `case` label is a *closing* paren, and `case` is already the bank's
    // idiom (014's grade.sh and assert.sh both contain one).
    name: 'r7-case-label',
    script: sh('case enabled in', '  enabled) ck en-id "d" 0 ;;', 'esac'),
  },
  { name: 'r7-after-then', script: sh('if true; then ck then-id "d" 0; fi') },
  { name: 'r7-after-do', script: sh('for x in a; do ck do-id "d" 0; done') },
  { name: 'r7-after-else', script: sh('if false; then true; else ck else-id "d" 0; fi') },
  { name: 'r7-brace-group', script: sh('{ ck brace-id "d" 0; }') },
  { name: 'r7-subshell', script: sh('( ck paren-id "d" 0 )') },
  { name: 'r7-subshell-no-space', script: sh('(ck tight-id "d" 0)') },
  {
    name: 'r7-function-body',
    script: sh('check_it() {', '  ck fn-id "d" 0', '}', 'check_it'),
  },

  // ---------------------------------------------- shapes earlier rounds pinned
  { name: 'pin-separator-semicolon', script: sh('test -f /etc/fstab; ck gamma "d" $?') },
  { name: 'pin-and-and', script: sh('true && ck delta "d" $?') },
  { name: 'pin-or-or', script: sh('false || ck zeta "d" $?') },
  { name: 'pin-pipeline', script: sh('printf x | ck epsilon "d" 0') },
  { name: 'pin-indented-ck', script: sh('  ck indented-id "d" 0') },
  { name: 'pin-two-ck-one-line', script: sh('ck one-id "d" 0; ck two-id "d" 0') },
  {
    name: 'pin-all-four-helpers',
    script: sh('ck_pass a-id "d"', 'ck_fail b-id "d"', 'ck_skip c-id "d"', 'ck d-id "d" 0'),
  },
  {
    name: 'pin-heredoc-quoted-delimiter',
    script: sh(`cat <<'EOF'`, 'ck heredoc-id "x" 0', 'EOF', 'ck real-id "y" 0'),
  },
  {
    name: 'pin-heredoc-plain-delimiter',
    script: sh('cat <<EOF', 'ck heredoc-id "x" 0', 'EOF', 'ck real-id "y" 0'),
  },
  {
    name: 'pin-heredoc-double-quoted-delimiter',
    script: sh('cat <<"EOF"', 'ck heredoc-id "x" 0', 'EOF', 'ck real-id "y" 0'),
  },
  {
    name: 'pin-heredoc-opener-and-ck-same-line',
    script: sh('cat <<EOF; ck real-id "d" 0', 'body', 'EOF'),
  },
  {
    name: 'pin-comment-inside-heredoc-body',
    script: sh('cat <<EOF', '# ck nope "d" 0', 'EOF', 'ck real-id "d" 0'),
  },
  { name: 'pin-herestring-word', script: sh('grep -q x <<<WORD', 'ck real-id "y" 0') },
  {
    name: 'pin-herestring-variable',
    script: sh('perm=755', 'grep -q 7 <<<"$perm"', 'ck real-id "d" $?'),
  },
  { name: 'pin-f17-id-class-collision', script: sh('ck lv "d" 0', 'ck lv_size "d" 0') },
  { name: 'pin-uppercase-id', script: sh('ck My-Id "d" 0') },
  { name: 'pin-comment-line', script: sh('# ck nope "d" 0', 'ck real-id "d" 0') },
  { name: 'pin-trailing-comment', script: sh('ck real-id "d" 0   # ck nope "d" 0') },
  {
    // `assert.sh:60`'s own usage line, which must count nothing.
    name: 'pin-assert-usage-comment',
    script: sh('# Usage:  some_condition; ck my-id "what was checked" $? "what to look at"'),
  },
  {
    name: 'pin-string-mentions-ck-after-separator',
    script: sh(String.raw`printf "ok; ck phantom-id\n"`, 'ck real-id "d" 0'),
  },
  {
    name: 'pin-string-mentions-ck-after-and',
    script: sh(`echo 'step 1 && ck nope'`, 'ck real-id "d" 0'),
  },
  {
    // `\n` only so the checkpoint line bash prints is a line of its own: without
    // it `printf` leaves the JSON glued to `a # b` and the oracle's line parser
    // cannot see it. The shape under test - a `#` inside a quoted run - is the
    // same one `session.test.ts` pins without the newline.
    name: 'pin-hash-inside-string',
    script: sh(String.raw`printf "a # b\n"; ck real-id "d" 0`),
  },
  { name: 'pin-lt-lt-inside-double-quotes', script: sh('echo "a << b"', 'ck real-id "d" 0') },
  { name: 'pin-lt-lt-inside-single-quotes', script: sh(`echo 'x << y'`, 'ck real-id "d" 0') },
  {
    name: 'pin-lt-lt-inside-comment',
    script: sh('echo hi   # heredocs use << here', 'ck real-id "d" 0'),
  },
  { name: 'pin-single-quotes-inside-double', script: sh(`echo "a 'b' c"; ck real-id "d" 0`) },
  { name: 'pin-double-quotes-inside-single', script: sh(`echo 'a "b" c'; ck real-id "d" 0`) },
]

/**
 * Shapes where bash and `countCheckpoints` provably disagree, pinned to the pair
 * they measure so the disagreement is visible rather than absent.
 *
 * `direction` is the whole point of the field. `over` means the counter declares
 * more than bash emits: `expectedTotal` lands high, `incomplete` fires on a
 * correct run, and the student gets a false *fail* — wrong, but loud, and the
 * `console.warn` in `reportFor` does not even have to catch it because the
 * student reports it. `under` is the fail-open direction, and an `under` entry in
 * this list is a bug being tolerated, not a shape being documented.
 */
export interface OracleDivergence extends OracleCase {
  direction: 'over' | 'under'
  bash: number
  counter: number
  /** Why it is not closed. */
  why: string
}

export const ORACLE_DIVERGENCES: OracleDivergence[] = [
  {
    name: 'quoted-run-spanning-lines',
    script: sh('x="a', 'ck phantom-id "', 'ck real-id "d" 0'),
    direction: 'over',
    bash: 1,
    counter: 2,
    why:
      'The scan is line-at-a-time, so a double-quoted run that spans lines is ' +
      'not tracked and the second line reads as code. Carrying quote state ' +
      'across lines would trade this loud over-count for a silent under-count: ' +
      'one line the walk misreads would then swallow every line after it, which ' +
      'is the failure mode four of this round\'s six findings are instances of. ' +
      'No grader in the bank contains a multi-line string.',
  },
  {
    name: 'ansi-c-quoting-with-escaped-quote',
    script: sh(String.raw`echo $'a\'b'; ck real-id "d" 0`),
    direction: 'under',
    bash: 1,
    counter: 0,
    why:
      'Inside `$\'…\'` bash *does* honour `\\\'`, unlike a plain single-quoted ' +
      'run, so the walk closes the run one quote early and desynchronises for ' +
      'the rest of the line. This is R1 through a third quoting form. It is ' +
      'listed here rather than fixed because closing it means the walk has to ' +
      'know it is in an ANSI-C run, which needs `$` lookbehind at every quote, ' +
      'and the shape is not reachable in the bank: no `$\'` appears in any ' +
      'grader, and the only `$\'…\'` uses anywhere in content/ are `$\'\\t\'`-style ' +
      'control-character literals with no escaped quote in them. It is an open ' +
      'fail-open risk, not an accepted residual.',
  },
]

export interface OracleRow {
  name: string
  /** Distinct ids real bash emitted from `assertLib + script`. */
  bash: number
  /** What `countCheckpoints(script)` says. */
  counter: number
  bashIds: string[]
}

/** Bash's stdout, whatever it exits with — a grader's exit code is ignored. */
function bashStdout(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('bash', [file], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    p.stdout.setEncoding('utf8')
    p.stdout.on('data', (chunk: string) => {
      out += chunk
    })
    p.on('error', reject)
    p.on('close', () => resolve(out))
  })
}

/**
 * The ids bash emitted. Parsed as JSON per line, which is `verdict.ts`'s own
 * contract with `assert.sh` — a line a fragment merely *printed* (a heredoc body,
 * an `echo`) is not JSON and is skipped, exactly as `parseVerdict` skips it.
 */
function idsFrom(stdout: string): string[] {
  const ids = new Set<string>()
  for (const line of stdout.split('\n')) {
    if (line === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof parsed === 'object' && parsed !== null && 'id' in parsed) {
      const id = parsed.id
      if (typeof id === 'string') ids.add(id)
    }
  }
  return [...ids].sort()
}

async function loadAssertLib(): Promise<string> {
  return readFile(fileURLToPath(new URL('../../content/lib/assert.sh', import.meta.url)), 'utf8')
}

/**
 * Run the whole table against bash. Fragments go to a temp directory under
 * `os.tmpdir()` that is removed afterwards, so nothing lands in the repo and
 * `git status --porcelain` stays empty.
 */
export async function measureOracle(cases: OracleCase[] = ORACLE_CASES): Promise<OracleRow[]> {
  const assertLib = await loadAssertLib()
  const dir = await mkdtemp(join(tmpdir(), 'rhcsa-ck-oracle-'))
  try {
    const rows: OracleRow[] = []
    // In batches: one bash per case is required (a fragment that opens a phantom
    // heredoc would swallow the fragments after it), but 70 at once is not.
    const BATCH = 12
    for (let i = 0; i < cases.length; i += BATCH) {
      const batch = cases.slice(i, i + BATCH)
      const done = await Promise.all(
        batch.map(async (c, n) => {
          const file = join(dir, `case-${i + n}.sh`)
          await writeFile(file, `${assertLib}\n${c.script}`, 'utf8')
          const bashIds = idsFrom(await bashStdout(file))
          return { name: c.name, bash: bashIds.length, counter: countCheckpoints(c.script), bashIds }
        }),
      )
      rows.push(...done)
    }
    return rows
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
