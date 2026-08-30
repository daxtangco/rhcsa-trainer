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
 *
 * **Both lists compare id sets, not the two cardinalities.** That distinction is
 * the reason this file changed after the round that introduced it: `bash === 1 &&
 * counter === 1` is satisfied by a compensating pair, one phantom id gained while
 * one real id is lost, and a count comparison cannot see it. Nothing at runtime
 * can see it either, because `expectedTotal` is a number. Exactly one case
 * legitimately declares a different id from the one bash emits, it says so, and
 * even there the counts still have to agree.
 *
 * What this table still cannot check is whether an entry's prose *describes the
 * shape it pins*. The divergence this round retired had internally consistent
 * numbers, a correctly derived direction and a green guard, and was wrong anyway:
 * the snippet exhibited the harmless face of the shape while the prose claimed the
 * shape was unreachable. That failure mode is a review problem, not an assertion
 * problem — so where a shape has two faces, pin both.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkpointIds } from '../../src/server/session.ts'

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
  /**
   * The ids the counter is expected to declare, when they deliberately differ
   * from the ids bash emits. Omitted almost everywhere, because the gate is that
   * the two **id sets are equal** — comparing only the two cardinalities lets a
   * compensating pair through, one phantom id gained while one real id is lost.
   *
   * Setting this excuses *which* ids, never **how many**: the count comparison is
   * unconditional, so an override cannot hide a miscount, only a renaming. Exactly
   * one shape needs it, and the reason is in that entry.
   */
  counterIds?: string[]
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
    //
    // The one case in the table whose id set legitimately differs from bash's.
    // Bash's id is the entire string, spaces and all; the counter truncates a
    // quoted id to its first word on purpose (R3), because keeping the whole run
    // re-admitted the phantom-id bug the quoted-id exception exists to fix. What
    // has to agree — and does — is the *count*: one checkpoint, not two.
    name: 'r3-separator-inside-quoted-id',
    script: sh('ck "real-id; ck phantom" "d" 0'),
    counterIds: ['real-id'],
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

  // ------------------------------------- a quoted run that spans lines (was a
  // ------------------------------------- divergence, and was disclosed wrongly)
  //
  // These were pinned as a single `over`/loud/double-quoted divergence that "no
  // grader in the bank contains". Measured, every part of that was wrong: the
  // natural arrangement is a silent **under**-count, single-quoted behaves
  // identically and single is what the bank contains, and `content/lib/assert.sh`
  // holds three multi-line single-quoted `awk` programs while `harness.ts:65`
  // prepends it to all five graders before counting. They are cases now, not
  // divergences, because the counter carries the open quote across the newline.
  {
    // `assert.sh`'s own two documented idioms composed: a multi-line `awk` program
    // closed on the same line as the `ck` that checks its exit status. This is the
    // shape that made a student who never edited /etc/fstab read as complete.
    name: 'multiline-awk-then-ck-same-line',
    script: sh(`awk 'BEGIN {`, ' exit 0', `}' /etc/fstab; ck fstab-checked "d" $?`),
  },
  {
    name: 'multiline-awk-then-two-ck',
    script: sh(`awk 'BEGIN {`, ' exit 0', `}'; ck one-id "d" $?; ck two-id "d" 0`),
  },
  {
    // `assert.sh:150-153`'s `is_persistent` fstab body, inlined with the `then ck`
    // form the library documents. The condition is arranged to be true so the
    // fragment stays single-path.
    name: 'multiline-awk-is-persistent-shape',
    script: sh(
      `if awk -v t="x" '`,
      '      /^[[:space:]]*#/ { next }',
      `      END { exit 0 }' /etc/hosts; then ck persist-config "d" 0; fi`,
    ),
  },
  { name: 'multiline-single-quoted', script: sh(`echo 'a`, `b'; ck real-id "d" 0`) },
  { name: 'multiline-double-quoted', script: sh('echo "a', 'b"; ck real-id "d" 0') },
  {
    // The unbounded half, and the reason the old entry's cost argument was
    // inverted: the `<<` on a middle line is *string content* to bash, but the
    // line-at-a-time walk read it as code and queued a heredoc whose terminator
    // never arrives — discarding every remaining line of the grader. The
    // swallow-the-rest-of-the-file mode was reachable *before* this fix, not after.
    name: 'multiline-double-quoted-holds-heredoc',
    script: sh('msg="a', 'cat <<EOF', 'b"', 'ck real-id "d" 0', 'ck two-id "d" 0'),
  },
  {
    name: 'multiline-single-quoted-holds-heredoc',
    script: sh(`msg='a`, 'cat <<EOF', `b'`, 'ck real-id "d" 0', 'ck two-id "d" 0'),
  },
  {
    // The shape the previous round pinned as the loud over-count. It is not a
    // divergence any more: the second line is string content up to its closing
    // quote, so the phantom id is gone and the count equals bash's.
    name: 'multiline-run-closed-on-next-line',
    script: sh('x="a', 'ck phantom-id "', 'ck real-id "d" 0'),
  },
  {
    // A run may stay open across several lines, and the id survives on the
    // *opening* line, so a `ck` whose description spans lines still counts.
    name: 'multiline-description-spans-lines',
    script: sh('ck real-id "line one', 'line two', 'line three" 0'),
  },
  {
    // An unterminated run at end of file: bash prints "unexpected EOF" and runs
    // nothing further, and the counter declares nothing further either.
    name: 'multiline-unterminated-at-eof',
    script: sh('ck real-id "d" 0', 'x="never closed'),
  },

  // ------------------------------------------------------- ANSI-C quoting ($'…')
  {
    // Was a divergence. Inside `$'…'` bash **does** honour `\'`, unlike a plain
    // single-quoted run, so pairing the quotes without escapes closed the run one
    // quote early and desynchronised the rest of the line: R1 through a third
    // quoting form, in the fail-open direction.
    name: 'ansi-c-escaped-quote',
    script: sh(String.raw`echo $'a\'b'; ck real-id "d" 0`),
  },
  {
    // The seven `$'…'` in `assert.sh` are all of this shape — control literals
    // with no escaped quote — and it is prepended to every grader.
    name: 'ansi-c-control-literal',
    script: sh(String.raw`echo $'\t'; ck real-id "d" 0`),
  },
  {
    // `$'…'` really does span lines, so the carried state has to remember which
    // of the three quoting forms it is inside, not just the quote character.
    name: 'ansi-c-spanning-lines',
    script: sh(String.raw`x=$'a`, String.raw`b'; ck real-id "d" 0`),
  },
  {
    name: 'ansi-c-spanning-lines-escaped-quote',
    script: sh(String.raw`x=$'a\'`, String.raw`b'; ck real-id "d" 0`),
  },
  {
    // The reason the `$` is *tracked* rather than read back off the line: here the
    // `$` is escaped, so this is a **plain** single-quoted run and `\'` does not
    // close it. Deciding ANSI-C with `line.charAt(i - 1) === '$'` loses this `ck`.
    name: 'ansi-c-escaped-dollar-is-not-ansi-c',
    script: sh(String.raw`echo \$'a\'; ck real-id "d" 0`),
  },

  // --------------------------------------- command substitution, `$( )` (M-J)
  //
  // Suppressing a `ck` inside `$( )` is **correct, not approximate**: its JSONL is
  // captured into the substitution, so the harness never receives it and the
  // counter must not declare it. Both directions are load-bearing and neither was
  // pinned when the mechanism was introduced.
  {
    // Delete the `$(` depth tracking and the `)` becomes a word break, so the `#`
    // reads as a comment and this real checkpoint is lost. Fail-open.
    name: 'subst-closing-paren-is-not-a-word-break',
    script: sh('y=$(echo a)#tag; ck real-id "$y" 0'),
  },
  {
    // The other direction: without the tracking, the captured `ck` is declared as
    // a checkpoint that can never arrive. Fail-closed.
    name: 'subst-ck-inside-is-not-emitted',
    script: sh('x=$(ck phantom "d" 0)', 'ck real-id "d" 0'),
  },

  // --------------------------------------------- heredoc delimiters: bash words
  //
  // A delimiter is an ordinary bash word, not an identifier. The regex this
  // replaced failed in **both** directions, and the first three are silent
  // fail-opens that discard every remaining line of the grader.
  { name: 'hd-delim-hyphenated', script: sh('cat <<EOF-1', 'body', 'EOF-1', 'ck real-id "d" 0') },
  { name: 'hd-delim-dotted', script: sh('cat <<EOF.txt', 'body', 'EOF.txt', 'ck real-id "d" 0') },
  {
    // Quote removal applies to *part* of a word: the delimiter is `EOF`.
    name: 'hd-delim-partly-quoted',
    script: sh(`cat <<E'OF'`, 'body', 'EOF', 'ck real-id "d" 0'),
  },
  {
    // The common idiom for a literal heredoc. The regex matched nothing at all, so
    // the body was scanned as code and the phantom was counted.
    name: 'hd-delim-backslash-quoted',
    script: sh('cat <<\\EOF', 'ck phantom "d" 0', 'EOF', 'ck real-id "d" 0'),
  },
  {
    name: 'hd-delim-quoted-hyphenated',
    script: sh(`cat <<'END-OF-MSG'`, 'ck phantom "d" 0', 'END-OF-MSG', 'ck real-id "d" 0'),
  },
  {
    // A delimiter may start with a digit; an identifier may not.
    name: 'hd-delim-leading-digit',
    script: sh('cat <<2EOF', 'ck phantom "d" 0', '2EOF', 'ck real-id "d" 0'),
  },
  {
    name: 'hd-delim-then-redirect',
    script: sh('cat <<EOF >/dev/null', 'ck phantom "d" 0', 'EOF', 'ck real-id "d" 0'),
  },
  {
    // The shape that makes `WORD_END` carry `<` and `>` load-bearing: with no
    // space, only the redirection operator ends the delimiter. Measured, bash
    // reads the delimiter as `EOF` here and redirects the body — so dropping `>`
    // from `WORD_END` would name the delimiter `EOF>/dev/null`, never match the
    // terminator, and discard the rest of the grader. `WORD_BREAK` still must not
    // carry them: that list answers where a `#` starts a comment, where `>#` is a
    // syntax error, and adding them there re-opens R6.
    name: 'hd-delim-tight-redirect',
    script: sh('cat <<EOF>/dev/null', 'ck phantom "d" 0', 'EOF', 'ck real-id "d" 0'),
  },
  {
    name: 'hd-delim-then-pipe',
    script: sh('cat <<EOF | cat', 'ck phantom "d" 0', 'EOF', 'ck real-id "d" 0'),
  },
  {
    name: 'hd-delim-dash-hyphenated',
    script: sh('cat <<-END-OF-MSG', `${TAB}ck phantom "d" 0`, `${TAB}END-OF-MSG`, 'ck real "d" 0'),
  },
  {
    // A space between `<<` and the delimiter is legal.
    name: 'hd-delim-after-space',
    script: sh('cat << EOF', 'ck phantom "d" 0', 'EOF', 'ck real-id "d" 0'),
  },

  // ------------------------------ an escaped quote inside a run that was already
  // ------------------------------ open when the line started (R1, re-opened)
  //
  // The round that carried quote state across the newline computed `escapes` two
  // different ways at the two call sites of one helper: the main loop passed
  // `ch === '"' || ansiC`, the carried-run prologue passed `ansiC` alone. So a
  // `"…"` that spanned lines paired its quotes *positionally* — exactly the defect
  // whose fix `closingQuote`'s own docstring describes, arriving through the
  // newline instead of within a line. The direction is the bad one: the walk stays
  // **inside** the string, so `expectedTotal` collapses toward 0 — and once it
  // does, `incomplete` cannot fire for any nonzero arrival count. A grader that
  // dies before its first `ck` is still caught (`allPassed`'s `length > 0` guard),
  // but one that died on its **second** command, having passed the first, reports
  // the lab passed with nothing after it checked.
  // Not one of the 349 tests told the defect from the fix, in either direction,
  // and the six pinned counts were byte-identical both ways. Hence these rows.
  {
    name: 'carried-dq-escaped-quote',
    script: sh('x="a', String.raw`b\"c"`, 'ck real-id "d" 0'),
  },
  {
    name: 'carried-dq-escaped-quote-then-ck-same-line',
    script: sh('echo "a', String.raw`b\"" ; ck real-id "d" 0`),
  },
  {
    name: 'carried-dq-escaped-quote-then-ck-next-line',
    script: sh('echo "a', String.raw`b\""`, 'ck real-id "d" 0'),
  },
  {
    // The one line of this family that could plausibly be written by a grader
    // author: a `grep` pattern spanning lines and quoting something inside itself.
    // An `awk` program written with `"` instead of `'` is the same shape, and awk
    // programs routinely contain `\"` — which is how close this was to reachable.
    name: 'carried-dq-escaped-quote-grep-shape',
    script: sh('grep -q "Listen 82', String.raw`and \"quoted\"" /etc/hosts; ck listen-set "d" $?`),
  },
  {
    name: 'carried-dq-escaped-quote-three-lines',
    script: sh('msg="a', String.raw`b \" c`, 'd"', 'ck real-id "d" 0', 'ck two-id "d" 0'),
  },
  {
    // The unbounded half again: mispairing the carried quote also queued a phantom
    // heredoc from a `<<` the run should have hidden, so two checkpoints were lost.
    name: 'carried-dq-escaped-quote-then-heredoc',
    script: sh(
      'x="a',
      String.raw`b\"c"`,
      'cat <<EOF',
      'body',
      'EOF',
      'ck real-id "d" 0',
      'ck two-id "d" 0',
    ),
  },
  {
    // Control, and the reason the fix is a `quote === '"'` test rather than `true`:
    // a carried **plain** single-quoted run still processes no escapes, so `b\'`
    // closes it. This is `'it\'`'s asymmetry surviving the newline; honouring `\'`
    // here would lose the `ck` after it, which is R1 in the other direction.
    name: 'carried-sq-keeps-backslash',
    script: sh(String.raw`x='a`, String.raw`b\'; ck real-id "d" 0`),
  },
  {
    // Control: `$'…'` carried across the newline *does* honour `\'`, and did before
    // the fix too, because `ansiC` was the one flag being passed.
    name: 'carried-ansi-c-escaped-quote',
    script: sh(String.raw`x=$'a`, String.raw`b\'c'`, 'ck real-id "d" 0'),
  },
  {
    // Control: an escaped backslash is not an escaped quote, so the run closes at
    // the `"`. Agreed before and after; it is here so a future `escapes` change
    // that swallows `\\` is caught.
    name: 'carried-dq-escaped-backslash',
    script: sh('x="a', String.raw`b\\"`, 'ck real-id "d" 0'),
  },

  // ------------------------- a heredoc opener and an unterminated quote on the
  // ------------------------- same line: which one claims the next line
  //
  // Measured, and the opposite of what this walk's docstring asserted for a round:
  // bash finishes the unterminated **word** across the newline first and only then
  // gathers the heredoc body. On `cat <<EOF; x="a` / `ck inside "d" 0` / `b"` /
  // `EOF` / `ck real-id "d" 0` bash emits `real-id` and not `inside`, and printing
  // `$x` afterwards gives `a⏎ck inside d 0⏎b` — the body began at `EOF` and was
  // empty. Checking the pending body first therefore swallowed the rest of the
  // file: a silent fail-open. The guard now gives the carried run precedence.
  {
    name: 'heredoc-opener-with-open-quote-same-line',
    script: sh('cat <<EOF; x="a', 'b"', 'EOF', 'ck real-id "d" 0'),
  },
  {
    // The docstring's own example, and the discriminating one: `ck inside` sits
    // where the body would be if the body won. bash never runs it.
    name: 'heredoc-opener-with-open-quote-and-ck-between',
    script: sh('cat <<EOF; x="a', 'ck inside "d" 0', 'b"', 'EOF', 'ck real-id "d" 0'),
  },
  {
    name: 'heredoc-opener-with-open-quote-and-operator',
    script: sh('cat <<EOF && x="a', 'b"', 'EOF', 'ck real-id "d" 0'),
  },
  {
    name: 'heredoc-opener-with-open-single-quote',
    script: sh(`cat <<EOF; x='a`, `b'`, 'EOF', 'ck real-id "d" 0'),
  },
  {
    // The pre-existing member of the family, and the one that was **fail-closed**:
    // the delimiter word itself falls inside the quoted run, so bash absorbs `EOF`
    // into the assignment, never terminates the body, prints the rest of the file
    // and emits nothing. The counter used to declare `real-id`. Both now say
    // nothing, so the same condition closed an over-count and four under-counts.
    name: 'heredoc-delimiter-swallowed-by-open-quote',
    script: sh('cat <<EOF; x="a', 'EOF', 'b"', 'ck real-id "d" 0'),
  },
  {
    // Control: with no run open, the body still wins and its `ck` is still
    // suppressed. This is the rule the new condition must not have broken.
    name: 'heredoc-body-suppressed-with-no-open-quote',
    script: sh('cat <<EOF', 'ck phantom "d" 0', 'EOF', 'ck real-id "d" 0'),
  },
  {
    // Control: a quote that *closes* on the opener line leaves the body in charge.
    name: 'heredoc-body-suppressed-after-closed-quote',
    script: sh('cat <<EOF; x="a"', 'ck phantom "d" 0', 'EOF', 'ck real-id "d" 0'),
  },
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
  /**
   * `both` is the compensating pair — a phantom id gained *and* a real id lost on
   * the same input. It is listed because it is the case a cardinality comparison
   * cannot see at all, and because nothing on `GradeReport` can see it either:
   * `expectedTotal` is a number, so the two errors cancel and the `incomplete`
   * guard is silently disarmed. If one ever appears here it is a defect, not a
   * residual.
   */
  direction: 'over' | 'under' | 'both'
  /** The ids real bash emits. */
  bashIds: string[]
  /** The ids the counter declares. Differs from `bashIds` — that is the point. */
  counterIds: string[]
  /** Why it is not closed. */
  why: string
}

export const ORACLE_DIVERGENCES: OracleDivergence[] = [
  {
    name: 'command-prefix-before-ck-negation',
    script: sh('! ck real-id "d" 1'),
    direction: 'under',
    bashIds: ['real-id'],
    counterIds: [],
    why:
      "`CK_CALL` recognises a `ck` at the start of a line or after one of `;&|{()`, " +
      'and that set does not cover every position where bash still begins a ' +
      'command. A `!` negation is one; the same miss covers `LC_ALL=C ck …`, ' +
      '`time ck …` and `eval \'ck …\'`, each measured at 0 against bash 1. Closing ' +
      'it means recognising bash command prefixes rather than punctuation, which ' +
      'is a larger change than the reachability justifies: measured, no grader in ' +
      'the bank negates, prefixes, times or evals a `ck`, and the six counts the ' +
      'bank pins are unmoved. It is a silent fail-open, not an accepted residual.',
  },
  {
    name: 'continuation-between-ck-and-id',
    script: sh('ck \\', 'cont-id "d" 0'),
    direction: 'under',
    bashIds: ['cont-id'],
    counterIds: [],
    why:
      'A `\\` line continuation that falls between the `ck` token and its id puts ' +
      'the id on the next line, and this walk has no lookahead: it matches an id ' +
      'only on the line the token is on. A continuation *after* the id counts ' +
      'correctly, which is where all ten continuations in the bank fall — measured. ' +
      'One *before* the `ck` counts correctly only when it ends a complete word ' +
      '(`: \\` and `test -f /etc/hosts \\` both agree); when it glues the previous ' +
      'word onto the `ck` it does not, and that is the separate `over` entry below. ' +
      'Fixing either means joining continued lines before scanning, which changes ' +
      'what every other rule sees. Silent fail-open, unreachable today.',
  },
  {
    // The shape the entry above used to claim counted correctly. Split out rather
    // than folded in, because the direction is the opposite one.
    name: 'continuation-glues-word-onto-ck',
    script: sh('echo a\\', 'ck real-id "d" 0'),
    direction: 'over',
    bashIds: [],
    counterIds: ['real-id'],
    why:
      'A trailing `\\` joins the two lines before bash tokenises them, so ' +
      '`echo a\\` + `ck real-id …` is the single command `echo ack real-id "d" 0`: ' +
      'bash prints a word and emits no checkpoint at all. This walk sees a fresh ' +
      'line beginning with `ck` and declares one. `true \\` + `ck real-id` is the ' +
      'same miss with `ck` becoming an argument rather than part of a word. ' +
      'Fail-closed, so the student gets a loud false fail rather than a false pass, ' +
      'and pre-existing rather than introduced. Measured absent from the bank: all ' +
      'ten trailing-`\\` lines in the counted text fall after a `ck` id, inside ' +
      '`ck_fail` and `printf` argument lists.',
  },
  {
    // Named for `$[ … ]`, but do not read this as a deprecated-syntax curiosity:
    // the `arith` guard's blind spot is "arithmetic contexts `arith` does not
    // enter" generally, and `$[ … ]` is only the oldest one. Array subscripts
    // (`${a[i << 1]}`), subscripted assignment targets (`a[1 << 1]=x`) and
    // substring offsets (`${s: 1 << 1}`) are all ordinary, current bash that
    // fails the same way — measured, each: bash 1 (`real-id`), counter 0.
    name: 'deprecated-arith-read-as-heredoc',
    script: sh('echo $[1 << 2]', 'ck real-id "d" 0'),
    direction: 'under',
    bashIds: ['real-id'],
    counterIds: [],
    why:
      "`$[ … ]` is bash's pre-2.0 arithmetic form, and the `arith` guard that keeps " +
      'a shift operator from looking like a heredoc opener recognises `$((` and ' +
      '`((` only. So `1 << 2` inside `$[ ]` is read as `<<` with the delimiter ' +
      '`2]`, queueing a body whose terminator never arrives and discarding every ' +
      'remaining line of the grader. **This contradicts the previous round\'s ' +
      'argument for widening the delimiter parser** — that widening could only move ' +
      'shapes in the fail-closed direction. It moved this one open, and silently. ' +
      'Not closed here because the exception granted for this round covers two ' +
      'named regressions only. **This is not a deprecated-syntax curiosity**: ' +
      '`$[ … ]` is the oldest member of a live class, "arithmetic context `arith` ' +
      'does not enter", and array subscripts, subscripted assignment targets and ' +
      'substring offsets are ordinary current bash in the same class, measured to ' +
      'fail identically (bash 1, counter 0 in each). Pinning those needs their own ' +
      'entries; this one is left named for its own shape and measured absent from ' +
      '`content/`, so the reachability is the lowest in this list.',
  },
  {
    // Pins the `subst` half of this seam only. The `arith` half is the sibling
    // entry below, and its direction is the opposite one — do not read this
    // entry's "fail-closed" as a claim about the whole seam.
    name: 'subst-depth-resets-across-newline',
    script: sh(`x=$(echo 'a`, `b'; ck phantom "d" 0)`, 'ck real-id "d" 0'),
    direction: 'over',
    bashIds: ['real-id'],
    counterIds: ['phantom', 'real-id'],
    why:
      'The `$( )` nesting depth is a local of `scanLine` and resets on every line, ' +
      'while the open quote now survives the newline: two pieces of lexical state ' +
      'with different lifetimes. So a substitution that spans lines loses its ' +
      'depth, and a `ck` on the closing line is declared even though its JSONL ' +
      'goes into the captured output and the harness never sees it. Fail-closed — ' +
      'for *this* mechanism. `(( ))` shares the same reset and is pinned ' +
      'separately as `arith-depth-resets-across-newline`, because it fails in the ' +
      'opposite direction: silent, not loud. Closing either means giving `subst` ' +
      'and `arith` the same lifetime as `quoted`, which is the right shape and is ' +
      'exactly the kind of multi-line state change this round is not permitted to ' +
      'make. Measured absent from the bank: no multi-line `$( )` in the counted ' +
      'text.',
  },
  {
    // The sibling of the entry above, and the reason it is wrong to read that one
    // as pinning "the cost" of `arith`/`subst` resetting across the newline: this
    // shape resets `arith` instead of `subst`, and it fails **open**, not closed.
    // A round-6 disclosure and this file's own docstring on `scanLine` both said
    // this seam was covered by the entry above; it was not, and the unpinned
    // third was the dangerous direction. See P25/P20 in
    // `whole-branch-parked.md`.
    name: 'arith-depth-resets-across-newline',
    script: sh('x=$((', '1 << 2 ))', 'ck real-id "d" 0'),
    direction: 'under',
    bashIds: ['real-id'],
    counterIds: [],
    why:
      '`arith` is a `scanLine` local and resets on every line, same as `subst`, ' +
      "but the sibling shape above can't stand in for this one: there the reset " +
      'gains a phantom id while keeping the real one (fail-closed, loud). Here, ' +
      'with the arithmetic context reset, line 2\'s `<<` is read as a heredoc ' +
      "opener with delimiter `2` — `1 << 2 ))` has no arithmetic context left to " +
      'keep it a shift operator — and the body never finds its terminator, so ' +
      'every remaining line of the grader, including the real checkpoint, is ' +
      'discarded. Silent fail-open. The one-line form (`x=$(( 1 << 2 ))`) agrees ' +
      'with bash, so this is purely a cost of the newline, not of `((` itself. ' +
      'Not reachable in the bank today, but `$(( ))` / `(( ))` appear six times ' +
      'in the counted text including `content/lib/assert.sh`, which is prepended ' +
      'to every grader — the closest shape on this list to reachable, and one ' +
      'authoring choice away (a `$((` left open at end of line). Closing it means ' +
      'the same multi-line state change as the sibling entry, which this round ' +
      'does not make.',
  },
  {
    name: 'brace-list-containing-ck',
    script: sh('echo {ck one,two}', 'ck real-id "d" 0'),
    direction: 'over',
    bashIds: ['real-id'],
    counterIds: ['one', 'real-id'],
    why:
      '`{` is one of `CK_CALL`\'s separators because a brace group is a real place ' +
      'for a `ck` to start, but a brace *list* is not: bash does not expand a ' +
      'brace list containing a space, so `{ck one,two}` is printed literally and ' +
      'emits nothing. The counter declares `one` as well as the real id. This is ' +
      'the loud direction — `expectedTotal` lands high, `incomplete` fires on a ' +
      'correct run and the student reports a false fail — and the unquoted-metachar ' +
      'family it belongs to is parked for the static lint. Not in the bank.',
  },
  {
    name: 'unquoted-sed-delimiter-holding-ck',
    script: sh(String.raw`echo a | sed s|a|ck\ phantom|`, 'ck real-id "d" 0'),
    direction: 'over',
    bashIds: ['real-id'],
    counterIds: ['phantom', 'real-id'],
    why:
      'An unquoted `|` used as a `sed` delimiter is a pipe to this walk, and ' +
      '`CK_CALL` treats a pipe as a position a command may start at — so the `ck` ' +
      "inside the substitution is declared. Same family as the brace list: it is " +
      'the fail-closed direction, it needs the walk to model what `sed` does with ' +
      'its own argument, and the sketcher-side version of this is already parked. ' +
      'Measured absent from the bank; the six pinned counts are unmoved.',
  },
  {
    // A third `closingQuote` call site (`heredocDelimiter`, session.ts:200) that
    // computes `escapes` a third way, distinct from the two the main loop and the
    // carried-run prologue agree on: `ch === '"'` alone, with no ANSI-C case at
    // all. Not caught by the pinned six because none of them opens a heredoc with
    // a `$'…'` delimiter.
    name: 'heredoc-delimiter-ansi-c-quoted',
    script: sh(`cat <<$'EOF'`, 'ck phantom "d" 0', 'EOF', 'ck real-id "d" 0'),
    direction: 'under',
    bashIds: ['real-id'],
    counterIds: [],
    why:
      "bash ANSI-C-dequotes a heredoc delimiter, so `$'EOF'` names the same word " +
      "`'EOF'` does: `EOF`. `heredocDelimiter` does not recognise `$'…'` as a form " +
      "at all — it has no `dollar` tracking the way `scanLine`'s main loop does — " +
      "so the `$` is read as an ordinary character and folded into the delimiter, " +
      'landing on `$EOF` instead of `EOF`. The real terminator on the line below ' +
      'never matches that, so the heredoc body never closes and every remaining ' +
      'line of the grader — including the real checkpoint — is discarded. Silent ' +
      'fail-open, and structural: this is the third site computing one predicate ' +
      'three different ways in the function P18 exists to replace by construction. ' +
      'Not fixed here — the fix is `heredocDelimiter` sharing `scanLine`\'s ' +
      '`dollar` tracking (or the walk P18 unifies them into), which is a change to ' +
      'the lexer this round does not make. Measured absent from the bank: no ' +
      'grader opens a heredoc with an ANSI-C-quoted delimiter.',
  },
]

export interface OracleRow {
  name: string
  /** Distinct ids real bash emitted from `assertLib + script`. */
  bash: number
  /** What `countCheckpoints(script)` says. */
  counter: number
  bashIds: string[]
  /**
   * The ids the counter declared, not just how many. Both sides carry their ids
   * so the gate can compare **sets**: a compensating pair leaves `bash` and
   * `counter` equal and is invisible to a count comparison.
   */
  counterIds: string[]
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
          const counterIds = checkpointIds(c.script)
          return {
            name: c.name,
            bash: bashIds.length,
            counter: counterIds.length,
            bashIds,
            counterIds,
          }
        }),
      )
      rows.push(...done)
    }
    return rows
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
