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
