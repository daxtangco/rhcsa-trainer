import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  countCheckpoints,
  maxRungFor,
  reportFor,
  SessionStore,
} from '../../src/server/session.ts'
import type { GradeResult } from '../../src/engine/grading/grader.ts'
import { parseVerdict } from '../../src/engine/grading/verdict.ts'

const GRADE = `#!/usr/bin/env bash
# baseline-fail: lv-home-size
set -uo pipefail

lvs --noheadings -o lv_size rhel/home
ck lv-home-size "the home LV is at least 12 GiB" $?

  ck fs-home-size "the filesystem fills it" $? "detail"

# ck not-a-real-one "commented out" $?
exit 0
`

// The shape Task 21's real grader has: no bare `ck` anywhere, and `lv-home-size`
// emitted from both arms of an if/else. Five call sites, three ids. A count of
// call sites would say five and the UI would mask two checkpoints that do not
// exist, so the fixture has to look like the thing being counted.
const GRADE_BRANCHED = `#!/usr/bin/env bash
set -uo pipefail

if within_pct "$\{lv_bytes:-0}" "$TARGET" 2; then
  ck_pass lv-home-size "the home LV is at least 12 GiB"
else
  ck_fail lv-home-size "the home LV is at least 12 GiB" "got $\{lv_bytes:-0} bytes"
fi

ck_pass 'home-from-lv' "/home is mounted from a logical volume"

if [[ -n $\{fs_bytes:-} ]]; then
  ck_pass fs-home-size "the filesystem fills it"
else
  ck_skip fs-home-size "the filesystem fills it" "no filesystem to measure"
fi
`

function result(over: Partial<GradeResult> = {}): GradeResult {
  const verdictA = parseVerdict(
    [
      '{"id":"lv-home-size","desc":"the home LV is at least 12 GiB","status":"pass"}',
      '{"id":"fs-home-size","desc":"the filesystem fills it","status":"fail"}',
    ].join('\n'),
  )
  return { verdictA, regressions: [], rebooted: false, ...over }
}

describe('countCheckpoints', () => {
  it('counts distinct ids and ignores commented-out ones', () => {
    expect(countCheckpoints(GRADE)).toBe(2)
  })

  it('counts an id once however many branches emit it', () => {
    expect(countCheckpoints(GRADE_BRANCHED)).toBe(3)
  })

  it('sees a ck that follows a command separator, which is what assert.sh documents', () => {
    // `content/lib/assert.sh:60` teaches `some_condition; ck my-id "…" $?`. The
    // counter used to allow only whitespace before `ck`, so a grader written to
    // the library's own documentation declared fewer checkpoints than it has -
    // and `expectedTotal` then matched a truncated run, turning mandate 7's
    // guard off for exactly the authoring style the project ships.
    expect(countCheckpoints('test -f /etc/fstab; ck gamma "d" $?\n')).toBe(1)
    expect(countCheckpoints('true && ck delta "d" $?\n')).toBe(1)
    expect(countCheckpoints('false || ck zeta "d" $?\n')).toBe(1)
    expect(countCheckpoints('grep -q x /f | ck epsilon "d" $?\n')).toBe(1)
    // One of each in one script, which is the shape a real grader would have.
    expect(countCheckpoints('ck one "d" $?\nfalse; ck two "d" $?\n')).toBe(2)
  })

  it('still ignores a ck in a comment or inside a string', () => {
    // Both measured and both genuinely right before the separator change, which
    // is why they are pinned: allowing `; ck` is one comment-strip away from
    // counting assert.sh's own usage line.
    expect(countCheckpoints('# ck nope "d" $?\nck real "d" $?\n')).toBe(1)
    expect(countCheckpoints('ck real "d" $?   # ck nope "d" $?\n')).toBe(1)
    expect(
      countCheckpoints('# Usage:  some_condition; ck my-id "what was checked" $? "what"\n'),
    ).toBe(0)
    expect(countCheckpoints('printf "run ck now"\nck real "d" $?\n')).toBe(1)
    expect(countCheckpoints('echo "ck_pass fake-id"\nck real "d" $?\n')).toBe(1)
  })

  it('does not count a ck inside a heredoc body', () => {
    // The over-count direction, and the only one that produces a false *fail*:
    // a checkpoint that is printed rather than run inflates `expectedTotal`, so
    // a complete run is reported `incomplete` and a correct solution fails.
    expect(countCheckpoints('cat <<\'EOF\'\nck heredoc-id "x" $?\nEOF\nck real "y" $?\n')).toBe(1)
    expect(countCheckpoints('cat <<EOF\nck heredoc-id "x" $?\nEOF\nck real "y" $?\n')).toBe(1)
    expect(countCheckpoints('cat <<-EOF\n\tck heredoc-id "x" $?\n\tEOF\nck real "y" $?\n')).toBe(1)
    // `<<<` is a herestring: it opens nothing, so the next line still counts.
    expect(countCheckpoints('grep -q x <<<WORD\nck real "y" $?\n')).toBe(1)
  })

  it('does not collide two ids that share a prefix across a non-convention character', () => {
    // The collision, which is the dangerous half: with a `[a-z0-9-]` id class
    // `ck lv_size` truncated to `lv`, collapsed into the `lv` already in the set
    // and counted 1 where the grader emits 2. `expectedTotal` then lands one
    // low, a run that stopped after the first checkpoint matches it, and the
    // student is told they passed a checkpoint that never ran - the same
    // fail-open as the heredoc and separator bugs, through a third door.
    //
    // Nothing else would catch it: `rhcsa validate`'s emitted-id check needs a
    // VM, and the static lint that would reject the id does not exist yet.
    expect(countCheckpoints('ck lv "d" $?\nck lv_size "d" $?\n')).toBe(2)
    // Not the convention either, and previously counted as nothing at all.
    expect(countCheckpoints('ck My-Id "d" $?\n')).toBe(1)
    // Lowercase kebab remains what authors write; the counter is just permissive
    // so that a non-conforming id is a lint error rather than a silent miscount.
    expect(countCheckpoints('ck lv-size "d" $?\nck lv "d" $?\n')).toBe(2)
  })

  it('does not let a << that is not a heredoc opener swallow the rest of the grader', () => {
    // The unanchored, quote-blind HEREDOC_START was the same defect F8 fixed one
    // file over: `echo "a << b"` opened a heredoc named `b`, every line after it
    // was discarded, and a grader containing that line declared fewer
    // checkpoints than it has. `expectedTotal` is the only thing standing between
    // a truncated run and a false pass, so this is the fail-open direction.
    // `ck` is at column 0 in each case, so only heredoc handling can move it.
    expect(countCheckpoints('echo "a << b"\nck real-id "d" $?\n')).toBe(1)
    expect(countCheckpoints("echo 'x << y'\nck real-id \"d\" $?\n")).toBe(1)
    expect(countCheckpoints('printf "%s\\n" "a << EOF"\nck real-id "d" $?\nck two "d" $?\n')).toBe(2)
    // A `<<` inside a trailing comment. Measured: this one already passed before
    // the fix, because the old scanner cut comments in a separate pass *before*
    // looking for an opener. It is pinned anyway, because the new scanner does
    // both in one walk and so depends on an ordering - the walk stops at the `#`
    // before it ever reaches these two `<`s - that nothing else asserts.
    expect(countCheckpoints('echo hi   # heredocs use << here\nck real-id "d" $?\n')).toBe(1)
    // An arithmetic shift, which was disclosed as a residual for two rounds and
    // is now closed: inside `$(( ))` a `<<` is a left shift, not a redirect. It
    // used to open a phantom heredoc named `shift` and discard every line after
    // it, while `$(( bytes << 3 ))` was counted - a distinction between a shift
    // by an identifier and a shift by a literal that no grader author could be
    // expected to hold in their head. Both are 1 now.
    expect(countCheckpoints('want=$(( 1 << shift ))\nck real-id "d" $?\n')).toBe(1)
    expect(countCheckpoints('want=$(( bytes << 3 ))\nck real-id "d" $?\n')).toBe(1)
    expect(countCheckpoints('(( x = 1 << shift ))\nck real-id "d" $?\n')).toBe(1)
    expect(countCheckpoints('want=$(( (2 + 1) << shift ))\nck real-id "d" $?\n')).toBe(1)
  })

  it('does not lose a ck after an escaped quote earlier on the line', () => {
    // The fail-open regression round 3 introduced, and the one that matters most
    // on this branch. The quote walk paired `"` characters positionally, which
    // bash does not - it pairs them after removing escaped ones - so one `\"` in
    // a description left the walk running *inside* the string and everything
    // after it on the line was discarded. That line is the
    // `some_condition; ck my-id "…" $?` form `content/lib/assert.sh:60` documents
    // as *the* usage, so the checkpoint vanishes from `expectedTotal`, a grader
    // killed partway matches the deflated total, `incomplete` stays false, and a
    // student who changed nothing is told the task passed.
    expect(countCheckpoints('echo "it\\"s ok"; ck real-id "d" $?\n')).toBe(1)
    expect(countCheckpoints('echo "a\\"b"; ck lost-id "d" $?\n')).toBe(1)
    expect(countCheckpoints('printf \'%s\\n\' "wanted \\" here"; ck real-id "d" $?\n')).toBe(1)
    // A backslash outside any run escapes the quote too, so this opens nothing.
    expect(countCheckpoints('echo \\"; ck real-id "d" $?\n')).toBe(1)
    // An escaped backslash must not eat the closing quote.
    expect(countCheckpoints('echo "a\\\\"; ck real-id "d" $?\n')).toBe(1)
    // The worse variant, and the fourth route into "a phantom heredoc discards
    // the rest of the file": the `<<` sits inside the run the walk lost track of.
    expect(countCheckpoints('echo "a \\" b << EOF c"\nck one-id "d" 0\nck two-id "d" 0\n')).toBe(2)
    // Even parity was always correct. Pinned so the characterisation stays exact
    // - the bug was odd-parity only - and so a fix cannot regress these.
    expect(countCheckpoints('grep -q "\\"Listen 82\\"" /etc/hosts; ck listen-set "d" $?\n')).toBe(1)
    expect(countCheckpoints('ck first-id "a \\"b\\" c" 0\nck second-id "d" 0\n')).toBe(2)
    // And the asymmetry the fix must not flatten: bash processes no escapes at
    // all inside single quotes, so `'it\'` is a *complete* run. Honouring `\`
    // there would lose the `ck` in the other direction.
    expect(countCheckpoints("echo 'it\\'; ck real-id \"d\" $?\n")).toBe(1)
    expect(countCheckpoints("echo 'a\\\"b'; ck real-id \"d\" $?\n")).toBe(1)
  })

  it('does not let a word merely ending in ck keep a quoted run, or one ck declare two ids', () => {
    // The quoted-id exception, minimised. It exists only to preserve a quoted
    // *id*, and an id cannot contain a space or a separator - so only the leading
    // id-shaped prefix of the run survives and there is nothing left inside it
    // for CK_CALL to find. Both of these were fail-closed: a phantom id makes a
    // *complete* run on a correctly solved machine report `incomplete` and forces
    // allPassed false, which is a false fail.
    //
    // `-check` is the most natural suffix an RHCSA checkpoint id could have, and
    // `perm-check` is not a `ck` token.
    expect(countCheckpoints('ck perm-check "checked; ck also-ran" $?\n')).toBe(1)
    expect(countCheckpoints('ck fs-check "ran && ck nope" $?\n')).toBe(1)
    expect(countCheckpoints('fsck "$dev; ck phantom" >/dev/null\nck real-id "d" 0\n')).toBe(1)
    // The exception used as a weapon: the id bash is handed here is the whole
    // string `real-id; ck phantom`, so there is exactly one checkpoint.
    expect(countCheckpoints('ck "real-id; ck phantom" "d" $?\n')).toBe(1)
    // And the shape the exception exists for still works.
    expect(countCheckpoints("ck_pass 'home-from-lv' \"desc\"\n")).toBe(1)
    expect(countCheckpoints('ck "quoted-id" "desc" $?\n')).toBe(1)
  })

  it('ends a heredoc body where bash ends it, not where trim() does', () => {
    // Bash ends a `<<EOF` body only at a line *equal* to the delimiter. Matching
    // `raw.trim()` accepted a tab-indented and a trailing-space `EOF` too, so the
    // body ended early and the lines bash treats as printed text were read as
    // code - an over-count, so a false fail.
    expect(
      countCheckpoints('cat <<EOF\n\tEOF\nck phantom "d" 0\nEOF\nck real-id "d" 0\n'),
    ).toBe(1)
    expect(
      countCheckpoints('cat <<EOF\nEOF \nck phantom "d" 0\nEOF\nck real-id "d" 0\n'),
    ).toBe(1)
    // `<<-` strips leading tabs, so this one does terminate...
    expect(
      countCheckpoints('cat <<-EOF\n\tck heredoc-id "x" 0\n\tEOF\nck real-id "y" 0\n'),
    ).toBe(1)
    // ...and never strips spaces, so this one does not.
    expect(
      countCheckpoints('cat <<-EOF\n  EOF\nck phantom "d" 0\nEOF\nck real-id "d" 0\n'),
    ).toBe(1)
    // Every opener on the line, in order. Keeping only the first read `B`'s body
    // as code once `A` had terminated.
    expect(
      countCheckpoints('cat <<A <<B\nbody-a\nA\nck phantom "d" 0\nB\nck real-id "d" 0\n'),
    ).toBe(1)
  })

  it('starts a comment wherever bash starts a word, and nowhere else', () => {
    // Bash begins a comment at the start of a word, and its word delimiters are
    // its metacharacters - so `;`, `&`, `|`, `(` and `)` begin one just as
    // whitespace does. Requiring whitespace missed all of them.
    expect(countCheckpoints('true;# note; ck phantom "d" 0\nck real-id "d" 0\n')).toBe(1)
    expect(countCheckpoints('(true)# note; ck phantom "d" 0\nck real-id "d" 0\n')).toBe(1)
    expect(countCheckpoints('true &#note; ck phantom "d" 0\nck real-id "d" 0\n')).toBe(1)
    // The fail-open one: a `<<` inside a comment the walk did not recognise
    // opened a phantom heredoc and discarded every remaining line of the grader.
    expect(countCheckpoints('true;#uses <<EOF style\nck real-id "d" 0\n')).toBe(1)
    // The other direction, and the reason `}` is deliberately *not* on that list
    // even though a previous review's wording put it there: `}` is not a bash
    // metacharacter. Measured - `{ true; }#note` is a syntax error and `${x}#tag`
    // is a single word - so treating `}` as a word break would cut this line at
    // the `#` and lose a real checkpoint, which is the fail-open direction.
    expect(countCheckpoints('x=abc; y=${x}#tag; ck real-id "$y" 0\n')).toBe(1)
    // Parameter expansion, where a `#` is never a comment.
    expect(countCheckpoints('x=/abc; y=${x#/}; ck real-id "$y" 0\n')).toBe(1)
    expect(countCheckpoints('s=abc; echo ${#s}; ck real-id "d" 0\n')).toBe(1)
    expect(countCheckpoints('echo a#b; ck real-id "d" 0\n')).toBe(1)
    expect(countCheckpoints('echo \\#; ck real-id "d" 0\n')).toBe(1)
  })

  it('sees a ck after then, do, else, a brace group, a subshell or a case label', () => {
    // This group used to be a documented known-miss list, and the list was wrong
    // twice. The second time it was wrong about the member the bank is closest to
    // writing: a `case` label is a *closing* paren, so `enabled) ck en-id "d" 0`
    // counted 0 against bash's 1, and no reader gets that from "`(`". `case` is
    // already the bank's idiom - 014's grade.sh and assert.sh each contain one.
    // Every miss here is a silent fail-open; an over-count from too wide a
    // pattern is a false fail, which is loud. So the pattern is widened, and the
    // differential oracle is what makes that verifiable.
    expect(countCheckpoints('case enabled in\n  enabled) ck en-id "d" 0 ;;\nesac\n')).toBe(1)
    expect(countCheckpoints('if true; then ck then-id "d" 0; fi\n')).toBe(1)
    expect(countCheckpoints('for x in a; do ck do-id "d" 0; done\n')).toBe(1)
    expect(countCheckpoints('if false; then true; else ck else-id "d" 0; fi\n')).toBe(1)
    expect(countCheckpoints('{ ck brace-id "d" 0; }\n')).toBe(1)
    expect(countCheckpoints('( ck paren-id "d" 0 )\n')).toBe(1)
    expect(countCheckpoints('(ck tight-id "d" 0)\n')).toBe(1)
    // A word merely *ending* in one of the keywords is not the keyword.
    expect(countCheckpoints('mydo ck arg-id "d" 0\n')).toBe(0)
  })

  it('does not count a ck that a string only mentions after a separator', () => {
    // The fail-closed twin, and a regression the separator alternation
    // introduced: a phantom id makes a *complete* run on a correctly solved
    // machine report `incomplete` and forces allPassed false - a false fail,
    // which the reportFor comment names as the direction to avoid. The old
    // tests only pinned separator-free strings, which is why this got through.
    expect(countCheckpoints('printf "ok; ck phantom-id\\n"\nck real-id "d" $?\n')).toBe(1)
    expect(countCheckpoints('echo "done; ck it later"\nck real-id "d" $?\n')).toBe(1)
    expect(countCheckpoints("echo 'step 1 && ck nope'\nck real-id \"d\" $?\n")).toBe(1)
    // A `#` inside a quoted run is not a comment, so the real ck after it still
    // counts. Stripping comments before quotes truncated this line at the `#`
    // and lost the checkpoint entirely.
    expect(countCheckpoints('printf "a # b"; ck real-id "d" $?\n')).toBe(1)
  })

  it('keeps a quoted checkpoint id, which is why this scanner is not the sketch scanner', () => {
    // commandSketch empties every quoted run because its contents are argument
    // text. Here the contents can be the id itself, so a quote that directly
    // follows a `ck` token is kept. GRADE_BRANCHED has that shape for real.
    expect(countCheckpoints(GRADE_BRANCHED)).toBe(3)
    expect(countCheckpoints('ck_pass \'home-from-lv\' "desc"\n')).toBe(1)
    expect(countCheckpoints('ck "quoted-id" "desc" $?\n')).toBe(1)
  })

  it('finds no checkpoints in the assertion library that gets prepended to every grader', async () => {
    // loadTaskScripts hands `assertLib + grade.sh` to countCheckpoints, so an
    // example `ck` call in a comment-free line of assert.sh would inflate the
    // masked total for every task at once, silently.
    const lib = await readFile(
      fileURLToPath(new URL('../../content/lib/assert.sh', import.meta.url)),
      'utf8',
    )
    expect(countCheckpoints(lib)).toBe(0)
  })
})

describe('maxRungFor', () => {
  it('gives guided mode the whole ladder', () => {
    // Guided mode is full disclosure by construction, so every rung is open
    // from the start - there is nothing to unlock.
    expect(maxRungFor('guided')).toBe(5)
  })

  it('defers to MAX_RUNG for the graded modes', () => {
    expect(maxRungFor('practice')).toBe(5)
    expect(maxRungFor('drill')).toBe(3)
    expect(maxRungFor('exam')).toBe(2)
  })
})

describe('reportFor', () => {
  it('names the checkpoints in practice mode', () => {
    const r = reportFor('practice', result(), false, 2)
    expect(r.total).toBe(2)
    expect(r.passed).toBe(1)
    expect(r.allPassed).toBe(false)
    expect(r.checkpoints?.map((c) => c.id)).toEqual(['lv-home-size', 'fs-home-size'])
  })

  it('withholds the checkpoints in exam mode until they are revealed', () => {
    const hidden = reportFor('exam', result(), false, 2)
    expect(hidden.passed).toBe(1)
    expect(hidden.total).toBe(2)
    expect(hidden.checkpoints).toBeUndefined()
    expect(hidden.regressions).toBeUndefined()

    const shown = reportFor('exam', result(), true, 2)
    expect(shown.checkpoints).toHaveLength(2)
  })

  it('scores the post-reboot verdict, not the pre-reboot one', () => {
    // The whole point of verdict B: what survives is what counts.
    const verdictB = parseVerdict(
      [
        '{"id":"lv-home-size","desc":"x","status":"pass"}',
        '{"id":"fs-home-size","desc":"y","status":"pass"}',
      ].join('\n'),
    )
    const r = reportFor('practice', result({ verdictB, rebooted: true }), false, 2)
    expect(r.passed).toBe(2)
    expect(r.allPassed).toBe(true)
    expect(r.rebooted).toBe(true)
  })

  it('counts regressions and only names them when revealed', () => {
    // verdictB carries both ids, because that is what grade() produces:
    // completeVerdictB fills any id A saw that B never emitted.
    const regressed = result({
      rebooted: true,
      verdictB: parseVerdict(
        [
          '{"id":"lv-home-size","desc":"x","status":"fail"}',
          '{"id":"fs-home-size","desc":"y","status":"fail"}',
        ].join('\n'),
      ),
      regressions: [{ id: 'lv-home-size', desc: 'x', status: 'fail' }],
    })
    expect(reportFor('drill', regressed, false, 2).regressionCount).toBe(1)
    expect(reportFor('drill', regressed, false, 2).regressions).toBeUndefined()
    expect(reportFor('drill', regressed, true, 2).regressions).toEqual(['lv-home-size'])
  })

  it('surfaces a reboot that never came back', () => {
    const r = reportFor('practice', result({ rebootError: 'timed out' }), false, 2)
    expect(r.rebootError).toBe('timed out')
  })

  it('refuses to call a truncated grader run a pass', () => {
    // Measured, not hypothesised: parseVerdict never throws, so a grader killed
    // partway through its output yields a *short* checkpoint list and the
    // partial line lands in `noise`. allPassed() is then true over the two that
    // arrived, and without the expectedTotal comparison the student is told
    // they passed a task they were never fully graded on.
    const partial = parseVerdict(
      [
        '{"id":"lv-home-size","desc":"x","status":"pass"}',
        '{"id":"fs-home-size","desc":"y","status":"pass"}',
      ].join('\n'),
    )
    const r = reportFor('practice', result({ verdictA: partial }), false, 5)

    expect(r.passed).toBe(2)
    expect(r.total).toBe(2)
    expect(r.expectedTotal).toBe(5)
    expect(r.incomplete).toBe(true)
    expect(r.allPassed).toBe(false)
  })

  it('refuses to call a run that emitted one id twice a pass', () => {
    // Mandate 7's bug through the other door. Three lines arrived and three
    // were declared, so a comparison of *lines* to *ids* said complete - while
    // the third checkpoint never ran, because the second line was a repeat.
    // `total`, `passed` and the guard all have to speak the same unit.
    const dupe = parseVerdict(
      [
        '{"id":"fstab-entry","desc":"x","status":"pass"}',
        '{"id":"mount-present","desc":"y","status":"pass"}',
        '{"id":"fstab-entry","desc":"x","status":"pass"}',
      ].join('\n'),
    )
    const r = reportFor('practice', result({ verdictA: dupe }), false, 3)

    expect(r.total).toBe(2)
    expect(r.passed).toBe(2)
    expect(r.expectedTotal).toBe(3)
    expect(r.incomplete).toBe(true)
    expect(r.allPassed).toBe(false)
    // And the list the client renders is one row per id, so it cannot disagree
    // with `total` in front of the student.
    expect(r.checkpoints?.map((c) => c.id)).toEqual(['fstab-entry', 'mount-present'])
  })

  it('does not let a repeated id inflate the passed count', () => {
    const dupe = parseVerdict(
      [
        '{"id":"lv-home-size","desc":"x","status":"pass"}',
        '{"id":"lv-home-size","desc":"x","status":"pass"}',
        '{"id":"fs-home-size","desc":"y","status":"fail"}',
      ].join('\n'),
    )
    const r = reportFor('practice', result({ verdictA: dupe }), false, 2)
    expect(r.passed).toBe(1)
    expect(r.total).toBe(2)
    expect(r.incomplete).toBe(false)
  })

  it('warns when more checkpoints arrive than the script declared, and still passes the run', () => {
    // The only observable runtime signature of an under-count, which is the
    // failure mode this guard's own input can have: the grader emitted these ids,
    // so the machine is not the suspect - countCheckpoints is. No report field can
    // express it, and failing the grade over it would fail a correct run because
    // of a bad count, which is the mistake the guard exists to prevent. So: warn.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const over = parseVerdict(
        [
          '{"id":"a","desc":"x","status":"pass"}',
          '{"id":"b","desc":"x","status":"pass"}',
          '{"id":"c","desc":"x","status":"pass"}',
        ].join('\n'),
      )
      const r = reportFor('practice', result({ verdictA: over }), false, 2)

      expect(r.total).toBe(3)
      expect(r.expectedTotal).toBe(2)
      expect(r.incomplete).toBe(false)
      expect(r.allPassed).toBe(true)

      expect(warn).toHaveBeenCalledTimes(1)
      const said = warn.mock.calls.at(0)?.at(0)
      expect(typeof said).toBe('string')
      // Both numbers, so the reader can tell which side to go and look at.
      expect(String(said)).toMatch(/3 checkpoints arrived/)
      expect(String(said)).toMatch(/declares 2/)
    } finally {
      warn.mockRestore()
    }
  })

  it('says nothing when the counts agree', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      reportFor('practice', result(), false, 2)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('calls a full verdict complete', () => {
    const full = parseVerdict(
      [
        '{"id":"lv-home-size","desc":"x","status":"pass"}',
        '{"id":"fs-home-size","desc":"y","status":"pass"}',
      ].join('\n'),
    )
    const r = reportFor('practice', result({ verdictA: full }), false, 2)

    expect(r.incomplete).toBe(false)
    expect(r.expectedTotal).toBe(2)
    expect(r.allPassed).toBe(true)
  })
})

describe('SessionStore', () => {
  it('issues sequential ids and starts every session at rung 1', () => {
    const s = new SessionStore()
    const a = s.create('storage/014-grow-home-lv', 'practice', 5, 1000)
    const b = s.create('users/006-team-provisioning', 'exam', 6, 1001)

    expect(a.id).toBe('s1')
    expect(b.id).toBe('s2')
    expect(a.rung).toBe(1)
    expect(a.phase).toBe('active')
    expect(a.checkpointTotal).toBe(5)
    expect(a.startedAt).toBe(1000)
    expect(s.list().map((x) => x.id)).toEqual(['s1', 's2'])
  })

  it('advances the rung up to the mode cap and then refuses', () => {
    const s = new SessionStore()
    const a = s.create('t', 'exam', 3, 0)
    expect(s.advanceRung(a.id).rung).toBe(2)
    expect(() => s.advanceRung(a.id)).toThrow(/maximum in exam mode/)
  })

  it('keeps the attempt active while grading and stores the latest result', () => {
    const s = new SessionStore()
    const a = s.create('t', 'practice', 2, 1000)
    s.record(a.id, result())

    expect(s.get(a.id)?.result).toBeDefined()
    // Grading is repeatable: it must not end the attempt, or masking in exam
    // mode would be pointless.
    expect(s.get(a.id)?.phase).toBe('active')
  })

  it('ends the attempt on finish and keeps the last result', () => {
    const s = new SessionStore()
    const a = s.create('t', 'practice', 2, 1000)
    s.record(a.id, result())
    const done = s.finish(a.id, 4000)

    expect(done.phase).toBe('graded')
    expect(done.endedAt).toBe(4000)
    expect(done.result).toBeDefined()
    // The record in the store is the same one, not a detached copy.
    expect(s.get(a.id)?.phase).toBe('graded')
  })

  it('throws for an unknown id rather than returning a half-built session', () => {
    const s = new SessionStore()
    expect(() => s.advanceRung('nope')).toThrow(/unknown session: nope/)
    expect(s.get('nope')).toBeUndefined()
  })
})
