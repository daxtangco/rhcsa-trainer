import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
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
