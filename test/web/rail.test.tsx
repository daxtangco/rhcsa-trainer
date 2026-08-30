// @vitest-environment jsdom
//
// A per-file docblock rather than `environmentMatchGlobs` in vitest.config.ts:
// that option is deprecated in the installed vitest 3.2.7 and removed in 4.0,
// and package.json pins `^3.0.0`. It also leaves test/web/api.test.ts in the
// Node environment, where its `Response` and `fetch` are Node 22's real ones.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Rail } from '../../src/web/components/Rail.tsx'
import type { ConceptRef, GradeReportView, StartedSession } from '../../src/web/api.ts'

function session(over: Partial<StartedSession> = {}): StartedSession {
  return {
    id: 's1',
    taskId: 'storage/014-grow-home-lv',
    title: 'Grow /home to 12 GiB',
    prompt: 'Grow it.',
    mode: 'exam',
    rung: 1,
    maxRung: 2,
    checkpointTotal: 5,
    timeBudget: 600,
    rebootCheck: true,
    // What the task needs, and what the server is using. Distinct fields
    // because they mean different things: see mandate 1.
    taskTransport: 'ssh',
    transport: 'ssh',
    ...over,
  }
}

function noop() {}

const props = {
  elapsedS: 90,
  onHint: noop,
  onGrade: noop,
  onFinish: noop,
  onReset: noop,
}

const CONCEPTS: ConceptRef[] = [
  { id: 'lvm-extend', title: 'Extending a logical volume' },
  { id: 'xfs-grow', title: 'Growing an XFS filesystem' },
]

describe('Rail', () => {
  it('shows how many checkpoints there are without naming them', () => {
    render(<Rail {...props} session={session()} rung={1} />)
    expect(screen.getByText('5 checkpoints')).toBeDefined()
    expect(screen.queryByText(/lv-home-size/)).toBeNull()
  })

  it('shows the elapsed time against the budget', () => {
    render(<Rail {...props} session={session()} rung={1} elapsedS={90} />)
    expect(screen.getByText('01:30 / 10:00')).toBeDefined()
  })

  it('says so when the time budget is blown', () => {
    render(<Rail {...props} session={session()} rung={1} elapsedS={900} />)
    expect(screen.getByText(/over budget/i)).toBeDefined()
  })

  it('disables the hint button at the mode cap and says why', () => {
    render(<Rail {...props} session={session()} rung={2} />)
    const hint = screen.getByRole('button', { name: /hint/i })
    expect(hint.getAttribute('disabled')).not.toBeNull()
    expect(screen.getByText(/no more hints in exam mode/i)).toBeDefined()
  })

  it('names the checkpoints when the report names them', () => {
    const report: GradeReportView = {
      passed: 1,
      total: 2,
      expectedTotal: 2,
      incomplete: false,
      allPassed: false,
      rebooted: true,
      regressionCount: 0,
      checkpoints: [
        { id: 'lv-home-size', desc: 'the home LV is at least 12 GiB', status: 'pass' },
        { id: 'fs-home-size', desc: 'the filesystem fills it', status: 'fail' },
      ],
    }
    render(<Rail {...props} session={session({ mode: 'practice' })} rung={1} report={report} />)
    expect(screen.getByText('the filesystem fills it')).toBeDefined()
  })

  it('shows only the tally when the report masks the checkpoints', () => {
    const report: GradeReportView = {
      passed: 3,
      total: 5,
      expectedTotal: 5,
      incomplete: false,
      allPassed: false,
      rebooted: true,
      regressionCount: 0,
    }
    render(<Rail {...props} session={session()} rung={1} report={report} />)
    expect(screen.getByText('3 / 5 passed')).toBeDefined()
    expect(screen.getByText(/which ones is not shown/i)).toBeDefined()
  })

  it('calls out a persistence failure in words, not a number', () => {
    // This is the single most valuable output in the whole app, so it does not
    // get to be a subtle badge.
    const report: GradeReportView = {
      passed: 4,
      total: 5,
      expectedTotal: 5,
      incomplete: false,
      allPassed: false,
      rebooted: true,
      regressionCount: 1,
    }
    render(<Rail {...props} session={session()} rung={1} report={report} />)
    expect(screen.getByText(/passed before the reboot and failed after it/i)).toBeDefined()
  })

  it('surfaces a guest that never came back', () => {
    const report: GradeReportView = {
      passed: 0,
      total: 5,
      expectedTotal: 5,
      incomplete: false,
      allPassed: false,
      rebooted: false,
      rebootError: 'guest did not come back within 120000ms',
      regressionCount: 0,
    }
    render(<Rail {...props} session={session()} rung={1} report={report} />)
    expect(screen.getByText(/did not come back/i)).toBeDefined()
    // The reboot did not run here either, but nothing passed, so the
    // "every checkpoint that ran passed" note must not claim otherwise. Without
    // this line, dropping `report.allPassed` from the persistence guard printed
    // that sentence over an 0/5 run and no test noticed.
    expect(screen.queryByText(/every checkpoint that ran passed/i)).toBeNull()
    expect(screen.getByText(/not all checkpoints passed/i)).toBeDefined()
  })

  it('calls onGrade when the grade button is pressed', () => {
    const onGrade = vi.fn()
    render(<Rail {...props} session={session()} rung={1} onGrade={onGrade} />)
    screen.getByRole('button', { name: /grade/i }).click()
    expect(onGrade).toHaveBeenCalledOnce()
  })

  it('asks before resetting, and does nothing if the answer is no', () => {
    const onReset = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Rail {...props} session={session()} rung={1} onReset={onReset} />)
    screen.getByRole('button', { name: /reset lab/i }).click()
    expect(confirm).toHaveBeenCalledOnce()
    expect(onReset).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    screen.getByRole('button', { name: /reset lab/i }).click()
    expect(onReset).toHaveBeenCalledOnce()
    confirm.mockRestore()
  })

  it('warns when the task needs a transport the server is not using', () => {
    render(
      <Rail
        {...props}
        session={session({ taskTransport: 'vmrun' })}
        serverTransport="ssh"
        rung={1}
      />,
    )
    expect(screen.getByText(/needs the vmrun transport/i)).toBeDefined()
  })

  it('says nothing about transport when the task wants what the server has', () => {
    // The negative arm, which is the one that matters. The positive test above
    // passed for months against a comparison of `session.transport` to
    // `props.serverTransport` — two names for the same server-side value, so the
    // banner was unreachable and its test proved only that the JSX renders.
    render(
      <Rail {...props} session={session({ taskTransport: 'ssh' })} serverTransport="ssh" rung={1} />,
    )
    expect(screen.queryByText(/needs the .* transport/i)).toBeNull()
  })

  it('refuses to call a truncated grader run a score', () => {
    const report: GradeReportView = {
      passed: 3,
      total: 3,
      expectedTotal: 7,
      incomplete: true,
      allPassed: false,
      rebooted: true,
      regressionCount: 0,
    }
    render(<Rail {...props} session={session()} rung={1} report={report} />)
    expect(screen.getByText(/is not a score/i)).toBeDefined()
    expect(screen.getByText(/reported 3 of 7 checkpoints and then stopped/i)).toBeDefined()
    // And it is not dressed up as a pass. A verdict of either kind over a
    // partial run is a claim the data cannot support.
    expect(screen.queryByText(/all checkpoints passed/i)).toBeNull()
  })

  it('disables hint, grade and reset once the attempt is finished', () => {
    render(<Rail {...props} session={session({ mode: 'practice', maxRung: 5 })} rung={1} finished />)
    expect(screen.getByRole('button', { name: /grade/i }).getAttribute('disabled')).not.toBeNull()
    expect(screen.getByRole('button', { name: /hint/i }).getAttribute('disabled')).not.toBeNull()
    expect(
      screen.getByRole('button', { name: /reset lab/i }).getAttribute('disabled'),
    ).not.toBeNull()
    // A disabled button with no explanation reads as a bug.
    expect(screen.getByText(/this attempt is finished/i)).toBeDefined()
  })

  it('offers concept cards outside exam mode and hides them inside it', () => {
    // Both arms. `/api/concepts/:id` is deliberately ungated — the app exists to
    // replace the book — so this component is the only thing standing between
    // exam mode and a rung-3 card that the hint ladder refuses to hand over.
    const { unmount } = render(
      <Rail
        {...props}
        session={session({ mode: 'exam' })}
        rung={1}
        concepts={CONCEPTS}
        onConcept={noop}
      />,
    )
    expect(screen.queryByRole('button', { name: /Extending a logical volume/i })).toBeNull()
    // Absent, not disabled-but-visible: a greyed-out card title is still a hint
    // about what the task is made of.
    expect(screen.queryByText(/Extending a logical volume/i)).toBeNull()
    unmount()

    render(
      <Rail
        {...props}
        session={session({ mode: 'practice' })}
        rung={1}
        concepts={CONCEPTS}
        onConcept={noop}
      />,
    )
    expect(screen.getByRole('button', { name: /Extending a logical volume/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /Growing an XFS filesystem/i })).toBeDefined()
  })

  it('warns when more checkpoints arrived than the script declares, and does not fail the run', () => {
    // `incomplete` is `total < expectedTotal`, so it cannot see this direction.
    // Over-arrival means countCheckpoints under-counted; the counter is the
    // suspect, not the machine.
    const report: GradeReportView = {
      passed: 6,
      total: 6,
      expectedTotal: 5,
      incomplete: false,
      allPassed: true,
      rebooted: true,
      regressionCount: 0,
    }
    render(<Rail {...props} session={session()} rung={1} report={report} />)
    expect(screen.getByText(/checkpoint count is wrong \(6 reported, 5 expected\)/i)).toBeDefined()
    expect(screen.getByText(/may be unreliable/i)).toBeDefined()
    // Not a failed verdict: failing a correct run over a bad count is the exact
    // mistake reportFor's warn-don't-fail guard exists to avoid.
    expect(screen.queryByText(/did not pass/i)).toBeNull()
    expect(screen.queryByText(/failed/i)).toBeNull()
    // But not a pass either, because the count it would be a pass out of is the
    // thing under suspicion.
    expect(screen.queryByText(/all checkpoints passed/i)).toBeNull()
    // The tally still shows, so the numbers that produced the warning are visible.
    expect(screen.getByText('6 / 6 passed')).toBeDefined()
  })

  it('warns on a declared count of zero even though the report says everything passed', () => {
    // The measured shape of the bug class: one injected line took grader 019's
    // count from 8 to 0. `incomplete` is then `0 < 0` -> false and `allPassed`
    // is true, so every other signal on this screen says "pass".
    const report: GradeReportView = {
      passed: 3,
      total: 3,
      expectedTotal: 0,
      incomplete: false,
      allPassed: true,
      rebooted: true,
      regressionCount: 0,
      checkpoints: [
        { id: 'a', desc: 'first', status: 'pass' },
        { id: 'b', desc: 'second', status: 'pass' },
        { id: 'c', desc: 'third', status: 'pass' },
      ],
    }
    render(<Rail {...props} session={session({ mode: 'practice' })} rung={1} report={report} />)
    expect(screen.getByText(/checkpoint count is wrong \(3 reported, 0 expected\)/i)).toBeDefined()
    expect(screen.queryByText(/all checkpoints passed/i)).toBeNull()
    // Not the truncation copy: nothing was truncated, the declaration was.
    expect(screen.queryByText(/is not a score/i)).toBeNull()
  })

  it('withholds the pass when the reboot check never ran on a task that declares one', () => {
    const report: GradeReportView = {
      passed: 5,
      total: 5,
      expectedTotal: 5,
      incomplete: false,
      allPassed: true,
      rebooted: false,
      rebootError: 'guest did not come back within 120000ms',
      regressionCount: 0,
    }
    render(<Rail {...props} session={session({ rebootCheck: true })} rung={1} report={report} />)
    expect(screen.queryByText(/all checkpoints passed/i)).toBeNull()
    expect(screen.getByText(/reboot check did not run/i)).toBeDefined()
    // And still not a failure: the checkpoints that ran did pass.
    expect(screen.queryByText(/not all checkpoints passed/i)).toBeNull()
  })

  it('does not withhold the pass on a task with no reboot check', () => {
    // The control. `rebooted: false` is the normal, correct outcome for a task
    // that declares no reboot check, so the guard above must not fire on it.
    const report: GradeReportView = {
      passed: 5,
      total: 5,
      expectedTotal: 5,
      incomplete: false,
      allPassed: true,
      rebooted: false,
      regressionCount: 0,
    }
    render(<Rail {...props} session={session({ rebootCheck: false })} rung={1} report={report} />)
    expect(screen.getByText(/all checkpoints passed/i)).toBeDefined()
    expect(screen.queryByText(/reboot check did not run/i)).toBeNull()
  })

  it('says all checkpoints passed when the counts agree and everything passed', () => {
    // The control for the two tests above: without this, suppressing the pass
    // verdict everywhere would satisfy them both.
    const report: GradeReportView = {
      passed: 5,
      total: 5,
      expectedTotal: 5,
      incomplete: false,
      allPassed: true,
      rebooted: true,
      regressionCount: 0,
    }
    render(<Rail {...props} session={session()} rung={1} report={report} />)
    expect(screen.getByText(/all checkpoints passed/i)).toBeDefined()
  })
})
