import { describe, expect, it, vi } from 'vitest'
import { finalVerdict, grade } from '../../src/engine/grading/grader.ts'
import { FakeTransport } from '../../src/engine/vm/fake.ts'
import { allPassed } from '../../src/engine/grading/verdict.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'

function task(over: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: 'storage/014-grow-var',
    title: 'Grow var',
    chapter: 15,
    scope: 'exam-objective',
    rhel: 9,
    objectives: ['storage.lvm.resize'],
    requiresConcepts: [],
    difficulty: 3,
    timeBudget: 480,
    weight: 'high',
    editions: ['r9'],
    rebootCheck: true,
    requiresDisks: 0,
    claims: [],
    transport: 'ssh',
    prompt: 'Grow var to 6G.',
    dir: '/nowhere',
    ...over,
  }
}

const PASS_PASS = [
  '{"id":"lv-var-size","desc":"var LV >= 6G","status":"pass"}',
  '{"id":"var-from-lv","desc":"/var mounted from the LV","status":"pass"}',
].join('\n')

const PASS_FAIL = [
  '{"id":"lv-var-size","desc":"var LV >= 6G","status":"pass"}',
  '{"id":"var-from-lv","desc":"/var mounted from the LV","status":"fail","detail":"not mounted"}',
].join('\n')

describe('grade', () => {
  it('skips the reboot entirely when the task does not ask for one', async () => {
    const reboot = vi.fn(async () => {})
    const t = new FakeTransport(() => ({ stdout: PASS_PASS, stderr: '', code: 0 }))

    const r = await grade({
      task: task({ rebootCheck: false }),
      transport: t,
      gradeScript: 'grade',
      reboot,
    })

    expect(reboot).not.toHaveBeenCalled()
    expect(r.rebooted).toBe(false)
    expect(r.verdictB).toBeUndefined()
    expect(r.regressions).toEqual([])
    expect(t.calls).toHaveLength(1)
  })

  it('skips the reboot when nothing passed, because there is nothing to persist', async () => {
    const reboot = vi.fn(async () => {})
    const allFail = '{"id":"lv-var-size","desc":"var LV >= 6G","status":"fail"}'
    const t = new FakeTransport(() => ({ stdout: allFail, stderr: '', code: 0 }))

    const r = await grade({ task: task(), transport: t, gradeScript: 'grade', reboot })

    expect(reboot).not.toHaveBeenCalled()
    expect(r.verdictB).toBeUndefined()
  })

  it('reboots and grades again when reboot_check is set and something passed', async () => {
    const reboot = vi.fn(async () => {})
    let rebooted = false
    const t = new FakeTransport(() => ({
      stdout: rebooted ? PASS_FAIL : PASS_PASS,
      stderr: '',
      code: 0,
    }))
    reboot.mockImplementation(async () => {
      rebooted = true
    })

    const r = await grade({ task: task(), transport: t, gradeScript: 'grade', reboot })

    expect(reboot).toHaveBeenCalledTimes(1)
    expect(r.rebooted).toBe(true)
    expect(t.calls).toHaveLength(2)
    expect(r.verdictB?.checkpoints).toHaveLength(2)
  })

  it('names the pass-to-fail checkpoints as regressions', async () => {
    let rebooted = false
    const t = new FakeTransport(() => ({
      stdout: rebooted ? PASS_FAIL : PASS_PASS,
      stderr: '',
      code: 0,
    }))

    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {
        rebooted = true
      },
    })

    expect(r.regressions.map((c) => c.id)).toEqual(['var-from-lv'])
    expect(r.regressions[0]?.detail).toBe('not mounted')
  })

  it('does not count an already-failing checkpoint as a regression', async () => {
    const t = new FakeTransport(() => ({ stdout: PASS_FAIL, stderr: '', code: 0 }))
    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {},
    })
    expect(r.regressions).toEqual([])
  })

  it('records a reboot failure as a result rather than throwing', async () => {
    // The user broke boot. That is itself a finding, not a crash.
    const t = new FakeTransport(() => ({ stdout: PASS_PASS, stderr: '', code: 0 }))
    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {
        throw new Error('timed out waiting for SSH after 120s')
      },
    })

    expect(r.rebooted).toBe(false)
    expect(r.rebootError).toMatch(/timed out waiting for SSH/)
    expect(r.verdictB).toBeUndefined()
    expect(r.verdictA.checkpoints).toHaveLength(2)
  })

  it('ignores the grader exit code', async () => {
    // Spec section 6.5 rule 3: one failing check must not abort the rest, so a
    // non-zero exit is normal and must not be treated as an error.
    const t = new FakeTransport(() => ({ stdout: PASS_FAIL, stderr: 'lvs: warning', code: 1 }))
    const r = await grade({
      task: task({ rebootCheck: false }),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {},
    })
    expect(r.verdictA.checkpoints).toHaveLength(2)
  })

  // --- Deviation 2: verdict B must account for every checkpoint verdict A reported. ---

  it('completes verdict B when it omits an id that passed in A, and reports it as a regression', async () => {
    const verdictALines = [
      '{"id":"a","desc":"A check","status":"pass"}',
      '{"id":"b","desc":"B check","status":"pass"}',
    ].join('\n')
    // Verdict B's grader died after reporting only "a" - "b" never ran.
    const verdictBLines = '{"id":"a","desc":"A check","status":"pass"}'

    let rebooted = false
    const t = new FakeTransport(() => ({
      stdout: rebooted ? verdictBLines : verdictALines,
      stderr: '',
      code: 0,
    }))

    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {
        rebooted = true
      },
    })

    expect(r.verdictB?.checkpoints.map((cp) => cp.id)).toEqual(['a', 'b'])
    const bCheckpoint = r.verdictB?.checkpoints.find((cp) => cp.id === 'b')
    expect(bCheckpoint?.status).toBe('fail')
    expect(bCheckpoint?.detail).toBeTruthy()
    // Finding 1: the synthesized checkpoint must carry A's desc through, not
    // an empty placeholder - the report builder shows desc to the user, and
    // losing it turns a named regression into an unnamed failed checkpoint.
    expect(bCheckpoint?.desc).toBe('B check')
    expect(r.regressions.map((cp) => cp.id)).toEqual(['b'])
  })

  it('appends multiple checkpoints missing from B in verdict A\'s original order, after B\'s own checkpoints', async () => {
    // Finding 2: with only one missing id (as in the tests above), reversing
    // the append order is invisible. Four ids, three of them missing, is
    // enough that a reversed or sorted append would show up as a reordering.
    const verdictALines = [
      '{"id":"a","desc":"A check","status":"pass"}',
      '{"id":"b","desc":"B check","status":"pass"}',
      '{"id":"c","desc":"C check","status":"pass"}',
      '{"id":"d","desc":"D check","status":"pass"}',
    ].join('\n')
    // B's grader dies right after reporting "a" - b, c, d never ran.
    const verdictBLines = '{"id":"a","desc":"A check","status":"pass"}'

    let rebooted = false
    const t = new FakeTransport(() => ({
      stdout: rebooted ? verdictBLines : verdictALines,
      stderr: '',
      code: 0,
    }))

    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {
        rebooted = true
      },
    })

    // "a" is B's own checkpoint; b, c, d are appended, and must stay in A's order.
    expect(r.verdictB?.checkpoints.map((cp) => cp.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('keeps verdict B\'s own noise when checkpoints are completed', async () => {
    // Finding 3: the completion path builds a new Verdict object; confirm it
    // does not drop B's noise while doing so (symmetric to the equivalent
    // assertion already made for the rebootError downgrade path below).
    const verdictALines = [
      '{"id":"a","desc":"A check","status":"pass"}',
      '{"id":"b","desc":"B check","status":"pass"}',
    ].join('\n')
    const verdictBLines = [
      'WARNING: lvs emitted a stray line',
      '{"id":"a","desc":"A check","status":"pass"}',
    ].join('\n')

    let rebooted = false
    const t = new FakeTransport(() => ({
      stdout: rebooted ? verdictBLines : verdictALines,
      stderr: '',
      code: 0,
    }))

    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {
        rebooted = true
      },
    })

    expect(r.verdictB?.noise).toEqual(['WARNING: lvs emitted a stray line'])
  })

  it('does not let mutating a completed verdict B\'s noise reach verdict A\'s noise', async () => {
    // Finding 4: the completion path must not alias verdict B's returned
    // noise array with anything a caller could also reach through verdictA.
    const verdictALines = [
      '{"id":"a","desc":"A check","status":"pass"}',
      '{"id":"b","desc":"B check","status":"pass"}',
    ].join('\n')
    const verdictBLines = '{"id":"a","desc":"A check","status":"pass"}'

    let rebooted = false
    const t = new FakeTransport(() => ({
      stdout: rebooted ? verdictBLines : verdictALines,
      stderr: '',
      code: 0,
    }))

    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {
        rebooted = true
      },
    })

    const verdictANoiseBefore = [...r.verdictA.noise]
    r.verdictB?.noise.push('injected by a caller')
    expect(r.verdictA.noise).toEqual(verdictANoiseBefore)
  })

  it('completes a checkpoint missing from B as fail but does not count it as a regression when it had already failed in A', async () => {
    const verdictALines = [
      '{"id":"a","desc":"A check","status":"pass"}',
      '{"id":"b","desc":"B check","status":"fail"}',
    ].join('\n')
    // B's grader only reports "a" - "b" was already broken in A and is absent here too.
    const verdictBLines = '{"id":"a","desc":"A check","status":"pass"}'

    let rebooted = false
    const t = new FakeTransport(() => ({
      stdout: rebooted ? verdictBLines : verdictALines,
      stderr: '',
      code: 0,
    }))

    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {
        rebooted = true
      },
    })

    expect(r.verdictB?.checkpoints.map((cp) => cp.id)).toEqual(['a', 'b'])
    const bCheckpoint = r.verdictB?.checkpoints.find((cp) => cp.id === 'b')
    expect(bCheckpoint?.status).toBe('fail')
    expect(r.regressions).toEqual([])
  })

  // --- Deviation 3: pass in A, skip in B is a regression too. ---

  it('counts a pass-to-skip transition as a regression', async () => {
    const verdictALines = '{"id":"a","desc":"A check","status":"pass"}'
    const verdictBLines = '{"id":"a","desc":"A check","status":"skip","detail":"dependency gone"}'

    let rebooted = false
    const t = new FakeTransport(() => ({
      stdout: rebooted ? verdictBLines : verdictALines,
      stderr: '',
      code: 0,
    }))

    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {
        rebooted = true
      },
    })

    expect(r.regressions.map((cp) => cp.id)).toEqual(['a'])
    expect(r.regressions[0]?.status).toBe('skip')
  })

  // --- F13: the one real-transport failure mode that is not an exit code. ---
  // `LabTransport.exec` is documented as never throwing on non-zero exit, but
  // both real transports still reject for infrastructure reasons unrelated to
  // exit status (no guest IP, a staging failure). Before this, no
  // `FakeTransport` handler in the suite ever rejected, so this path had no
  // test anywhere.

  it('rejects out of grade() when the first exec rejects, rather than swallowing it into a verdict', async () => {
    // grade() wraps only reboot() in a try/catch (see the module comment on
    // GradeOptions); the exec calls are unguarded on purpose, so a rejection
    // here must propagate with the transport's own message.
    const t = new FakeTransport(() => {
      throw new Error('no guest IP could be determined')
    })

    await expect(
      grade({ task: task(), transport: t, gradeScript: 'grade', reboot: async () => {} }),
    ).rejects.toThrow(/no guest IP could be determined/)
  })

  it('discards verdict A entirely when the second exec rejects after a successful reboot', async () => {
    // A real, deliberate residual (whole-branch review, target 3(d)): when the
    // reboot itself succeeds but the post-reboot exec rejects, verdict A ("it
    // works now") is thrown away because verdict B ("survives a reboot") never
    // arrived — grade() has no fallback here. This test documents that
    // behaviour; it is not a fix and none is wanted for it in this dispatch.
    let rebooted = false
    const t = new FakeTransport(() => {
      if (!rebooted) return { stdout: PASS_PASS, stderr: '', code: 0 }
      throw new Error('connection reset by peer')
    })

    await expect(
      grade({
        task: task(),
        transport: t,
        gradeScript: 'grade',
        reboot: async () => {
          rebooted = true
        },
      }),
    ).rejects.toThrow(/connection reset by peer/)
  })
})

describe('finalVerdict', () => {
  it('returns verdict B when a reboot happened, because B is the real answer', async () => {
    let rebooted = false
    const t = new FakeTransport(() => ({
      stdout: rebooted ? PASS_FAIL : PASS_PASS,
      stderr: '',
      code: 0,
    }))
    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {
        rebooted = true
      },
    })
    expect(finalVerdict(r)).toBe(r.verdictB)
  })

  it('falls back to verdict A when no reboot happened', async () => {
    const t = new FakeTransport(() => ({ stdout: PASS_PASS, stderr: '', code: 0 }))
    const r = await grade({
      task: task({ rebootCheck: false }),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {},
    })
    expect(finalVerdict(r)).toBe(r.verdictA)
  })

  // --- Deviation 1: rebootError must not grade as a pass. ---

  it('downgrades every pass to fail when the guest never came back, and does not mutate verdict A', () => {
    const verdictA = {
      checkpoints: [
        { id: 'a', desc: 'A check', status: 'pass' as const },
        { id: 'b', desc: 'B check', status: 'pass' as const },
      ],
      noise: ['stray warning'],
    }
    const r = {
      verdictA,
      regressions: [],
      rebooted: false,
      rebootError: 'timed out waiting for SSH after 120s',
    }

    const v = finalVerdict(r)

    expect(v).not.toBe(verdictA)
    expect(allPassed(v)).toBe(false)
    expect(v.checkpoints).toHaveLength(2)
    expect(v.checkpoints.map((cp) => cp.id)).toEqual(['a', 'b'])
    expect(v.checkpoints.map((cp) => cp.desc)).toEqual(['A check', 'B check'])
    expect(v.checkpoints.every((cp) => cp.status === 'fail')).toBe(true)
    for (const cp of v.checkpoints) {
      expect(cp.detail).toBeTruthy()
      expect(cp.detail).toMatch(/did not come back|reboot|persist/i)
    }
    expect(v.noise).toEqual(['stray warning'])

    // Verdict A itself must be untouched.
    expect(verdictA.checkpoints[0]?.status).toBe('pass')
    expect(verdictA.checkpoints[1]?.status).toBe('pass')
    expect(verdictA.checkpoints).toHaveLength(2)

    // Finding 4: the returned verdict's noise array must not be the same
    // array as verdictA's - pushing onto it must not reach back into A.
    v.noise.push('injected by a caller')
    expect(verdictA.noise).toEqual(['stray warning'])
  })

  it('only downgrades checkpoints that had already passed, leaving fail and skip alone', () => {
    const verdictA = {
      checkpoints: [
        { id: 'a', desc: 'A check', status: 'pass' as const },
        { id: 'b', desc: 'B check', status: 'fail' as const, detail: 'already broken' },
        { id: 'c', desc: 'C check', status: 'skip' as const },
      ],
      noise: [],
    }
    const r = {
      verdictA,
      regressions: [],
      rebooted: false,
      rebootError: 'timed out waiting for SSH after 120s',
    }

    const v = finalVerdict(r)

    expect(v.checkpoints).toHaveLength(3)
    const byId = new Map(v.checkpoints.map((cp) => [cp.id, cp]))
    expect(byId.get('a')?.status).toBe('fail')
    expect(byId.get('a')?.detail).toBeTruthy()
    expect(byId.get('b')?.status).toBe('fail')
    expect(byId.get('b')?.detail).toBe('already broken')
    expect(byId.get('c')?.status).toBe('skip')
  })

  it('preserves the checkpoint count under the rebootError downgrade, since the masked total depends on it', () => {
    const verdictA = {
      checkpoints: [
        { id: 'a', desc: 'A', status: 'pass' as const },
        { id: 'b', desc: 'B', status: 'pass' as const },
        { id: 'c', desc: 'C', status: 'fail' as const },
      ],
      noise: [],
    }
    const r = {
      verdictA,
      regressions: [],
      rebooted: false,
      rebootError: 'timed out waiting for SSH after 120s',
    }

    expect(finalVerdict(r).checkpoints).toHaveLength(verdictA.checkpoints.length)
  })
})
