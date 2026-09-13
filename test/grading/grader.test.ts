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

  // --- The post-reboot run that never ran. ---
  //
  // Measured, not hypothetical: `storage/014-grow-home-lv`'s
  // `antisolutions/02-removed-persistence.sh` comments /home out of fstab, and
  // /home/student/.ssh/authorized_keys lives on rhel/home. `waitForGuest` polls
  // over vmrun, so it reports the guest up while ssh key auth has nothing to read.
  // The old code discarded runB's code and stderr, so this arrived as two
  // checkpoints accused of "the grader likely stopped before reaching it" - a
  // guess about content, produced by a broken control channel.
  const SSH_DENIED = 'student@192.168.70.130: Permission denied (publickey).'

  /** A transport whose first exec is verdict A and whose second is the caller's. */
  function twoRuns(second: () => { stdout: string; stderr: string; code: number }) {
    const t: FakeTransport = new FakeTransport(() =>
      t.calls.length === 1 ? { stdout: PASS_PASS, stderr: '', code: 0 } : second(),
    )
    return t
  }

  it('names a post-reboot run that never executed instead of blaming the grader', async () => {
    const t = twoRuns(() => ({ stdout: '', stderr: SSH_DENIED, code: 255 }))
    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {},
    })

    expect(r.rebooted).toBe(true)
    // The guest came back. Saying otherwise would send the reader to debug a
    // boot that worked.
    expect(r.rebootError).toBeUndefined()
    expect(r.postRebootError).toMatch(/never executed \(the transport exited 255/)
    expect(r.postRebootError).toContain('Permission denied (publickey)')

    // Unverified is still fail - only the sentence changes.
    expect(r.verdictB?.checkpoints.map((cp) => cp.status)).toEqual(['fail', 'fail'])
    for (const cp of r.verdictB?.checkpoints ?? []) {
      expect(cp.detail).toBe(r.postRebootError)
      expect(cp.detail).not.toMatch(/stopped before reaching it/)
    }
    expect(r.regressions.map((c) => c.id)).toEqual(['lv-var-size', 'var-from-lv'])
  })

  it('still blames the grader when the second run stopped partway', async () => {
    // One checkpoint out, then died: this is the `set -e` case the old wording
    // was written for, and it must keep that wording.
    const t = twoRuns(() => ({
      stdout: '{"id":"lv-var-size","desc":"var LV >= 6G","status":"pass"}',
      stderr: 'grade.sh: line 40: lvs: command not found',
      code: 127,
    }))
    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {},
    })

    expect(r.postRebootError).toBeUndefined()
    expect(r.verdictB?.checkpoints.map((cp) => cp.id)).toEqual(['lv-var-size', 'var-from-lv'])
    expect(r.verdictB?.checkpoints[1]?.detail).toMatch(/stopped before reaching it/)
  })

  it('does not read a normal non-zero grader exit as a transport failure', async () => {
    // A grader that reports a failure ends non-zero by design (section 6.5 rule
    // 3). Reading that as "the run never happened" would relabel every honest
    // persistence failure in the bank as infrastructure.
    const t = twoRuns(() => ({ stdout: PASS_FAIL, stderr: 'lvs: warning', code: 1 }))
    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {},
    })

    expect(r.postRebootError).toBeUndefined()
    expect(r.regressions.map((c) => c.id)).toEqual(['var-from-lv'])
  })

  it('keeps calling an empty second run with exit 0 a grader problem', async () => {
    // Both halves of the condition are load-bearing. Silence with a clean exit is
    // a grader that emitted nothing, which is a content bug and must keep saying so.
    const t = twoRuns(() => ({ stdout: '', stderr: '', code: 0 }))
    const r = await grade({
      task: task(),
      transport: t,
      gradeScript: 'grade',
      reboot: async () => {},
    })

    expect(r.postRebootError).toBeUndefined()
    expect(r.verdictB?.checkpoints[0]?.detail).toMatch(/stopped before reaching it/)
  })

  it('bounds the stderr it quotes, and says so when there is none', async () => {
    const flood = twoRuns(() => ({ stdout: '', stderr: 'x'.repeat(5000), code: 255 }))
    const r = await grade({
      task: task(),
      transport: flood,
      gradeScript: 'grade',
      reboot: async () => {},
    })
    expect(r.postRebootError?.length).toBeLessThan(500)
    expect(r.postRebootError).toMatch(/…$/)

    const silent = twoRuns(() => ({ stdout: '', stderr: '   \n', code: 255 }))
    const r2 = await grade({
      task: task(),
      transport: silent,
      gradeScript: 'grade',
      reboot: async () => {},
    })
    expect(r2.postRebootError).toMatch(/said nothing on stderr$/)
  })

  // --- The post-reboot fallback channel. ---
  //
  // Same measured case as the block above, one step further on. `SSH_DENIED` is
  // not a flake and not a broken lab: `02-removed-persistence.sh` un-persists
  // /home, /home/student/.ssh/authorized_keys is on rhel/home, and the
  // persistence question — did /home come back mounted from the LV? — is still
  // perfectly answerable, just not over ssh. vmrun goes through open-vm-tools and
  // never authenticates, so `GradeOptions.fallback` lets verdict B be measured
  // instead of abandoned. What these tests hold in place is how *narrow* that is.

  /** As `twoRuns`, but labelled ssh so the fallback's `kind` guard is reachable. */
  function overSsh(second: () => { stdout: string; stderr: string; code: number }) {
    const t: FakeTransport = new FakeTransport(
      () => (t.calls.length === 1 ? { stdout: PASS_PASS, stderr: '', code: 0 } : second()),
      { kind: 'ssh' },
    )
    return t
  }

  function overVmrun(handler: () => { stdout: string; stderr: string; code: number }) {
    return new FakeTransport(handler, { kind: 'vmrun' })
  }

  it('measures verdict B over the fallback when the chosen channel did not survive', async () => {
    const primary = overSsh(() => ({ stdout: '', stderr: SSH_DENIED, code: 255 }))
    const fallback = overVmrun(() => ({ stdout: PASS_FAIL, stderr: '', code: 1 }))

    const r = await grade({
      task: task(),
      transport: primary,
      gradeScript: 'grade',
      reboot: async () => {},
      fallback,
    })

    // The whole point: a real persistence answer where there was none.
    expect(r.postRebootError).toBeUndefined()
    expect(r.verdictB?.checkpoints.map((cp) => `${cp.id}:${cp.status}`)).toEqual([
      'lv-var-size:pass',
      'var-from-lv:fail',
    ])
    // And the regression is derived from the fallback's verdict, not fabricated:
    // one id regressed, not both, which is exactly what the un-persisted fixture
    // should show and what the abandoned-verdict path could never distinguish.
    expect(r.regressions.map((c) => c.id)).toEqual(['var-from-lv'])
    // Never silent. A pass over a channel the caller did not choose is a different
    // claim from a pass over the one it did.
    expect(r.verdictBVia).toBe('vmrun')
    expect(primary.calls).toHaveLength(2)
    expect(fallback.calls).toHaveLength(1)
  })

  it('leaves the fallback untouched when the chosen channel worked', async () => {
    // The condition is "produced no checkpoints at all", not "reported a failure".
    // A grader that emitted even one checkpoint ran, and re-running it elsewhere
    // would mean two disagreeing measurements of a single reboot.
    const primary = overSsh(() => ({ stdout: PASS_FAIL, stderr: '', code: 1 }))
    const fallback = overVmrun(() => ({ stdout: PASS_PASS, stderr: '', code: 0 }))

    const r = await grade({
      task: task(),
      transport: primary,
      gradeScript: 'grade',
      reboot: async () => {},
      fallback,
    })

    expect(fallback.calls).toEqual([])
    expect(r.verdictBVia).toBeUndefined()
    expect(r.regressions.map((c) => c.id)).toEqual(['var-from-lv'])
  })

  it('never reaches for the fallback on verdict A', async () => {
    // Verdict B only. If the *first* run cannot reach the guest, nothing has been
    // established about the machine, and switching channels there would hide a
    // broken lab setup behind a grade. `grade()` gets that for free by returning
    // before the reboot when nothing passed — this pins that it stays free.
    const primary = new FakeTransport(() => ({ stdout: '', stderr: SSH_DENIED, code: 255 }), {
      kind: 'ssh',
    })
    const fallback = overVmrun(() => ({ stdout: PASS_PASS, stderr: '', code: 0 }))
    const reboot = vi.fn(async () => {})

    const r = await grade({ task: task(), transport: primary, gradeScript: 'grade', reboot, fallback })

    expect(fallback.calls).toEqual([])
    expect(reboot).not.toHaveBeenCalled()
    expect(r.rebooted).toBe(false)
    expect(r.verdictB).toBeUndefined()
    expect(r.verdictBVia).toBeUndefined()
  })

  it('does not re-run an identical failure when the fallback is the same kind', async () => {
    // Easy to trip: both transports usually come out of one config object, and a
    // run already on vmrun would otherwise fail, retry over vmrun, fail the same
    // way, and report the second failure as though it were new information.
    const primary = overSsh(() => ({ stdout: '', stderr: SSH_DENIED, code: 255 }))
    const sameKind = new FakeTransport(() => ({ stdout: PASS_PASS, stderr: '', code: 0 }), {
      kind: 'ssh',
    })

    const r = await grade({
      task: task(),
      transport: primary,
      gradeScript: 'grade',
      reboot: async () => {},
      fallback: sameKind,
    })

    expect(sameKind.calls).toEqual([])
    expect(r.verdictBVia).toBeUndefined()
    expect(r.postRebootError).toContain('Permission denied (publickey)')
  })

  it('names both channels when the fallback fails too, and keeps the first as the headline', async () => {
    const primary = overSsh(() => ({ stdout: '', stderr: SSH_DENIED, code: 255 }))
    const fallback = overVmrun(() => ({ stdout: '', stderr: 'vmrun: guest tools are not running', code: 4 }))

    const r = await grade({
      task: task(),
      transport: primary,
      gradeScript: 'grade',
      reboot: async () => {},
      fallback,
    })

    expect(r.verdictBVia).toBeUndefined()
    // The chosen channel's own stderr, still first: it is the failure the reader
    // asked about. The fallback's is a parenthetical so nobody debugs a channel
    // they never selected.
    expect(r.postRebootError).toMatch(/exited 255.*Permission denied/)
    expect(r.postRebootError).toContain('the vmrun fallback was tried and also produced no checkpoints, exiting 4')
    expect(r.postRebootError).not.toContain('guest tools are not running')
    // And the verdict is still fully downgraded — a fallback that failed changes
    // nothing about what was verified.
    expect(r.verdictB?.checkpoints.map((cp) => cp.status)).toEqual(['fail', 'fail'])
  })

  it('keeps the first diagnosis when the fallback throws rather than exiting', async () => {
    // `LabTransport.exec` promises not to throw on a non-zero *exit*, not that it
    // cannot throw at all: a missing vmrun.exe or an unresolvable .vmx surfaces
    // here. Losing the real diagnosis to that would be a strictly worse report
    // than not having a fallback at all.
    const primary = overSsh(() => ({ stdout: '', stderr: SSH_DENIED, code: 255 }))
    const fallback = new FakeTransport(
      () => {
        throw new Error('ENOENT: vmrun.exe')
      },
      { kind: 'vmrun' },
    )

    const r = await grade({
      task: task(),
      transport: primary,
      gradeScript: 'grade',
      reboot: async () => {},
      fallback,
    })

    expect(r.postRebootError).toContain('Permission denied (publickey)')
    expect(r.postRebootError).toContain('exiting -1')
    expect(r.verdictBVia).toBeUndefined()
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
