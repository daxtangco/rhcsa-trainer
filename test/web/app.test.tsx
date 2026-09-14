// @vitest-environment jsdom
//
// The screen driven end to end against a faked API client, which is what proves
// the handlers wire up at all. The disclosure in round 1's report - that
// `createApi()` at module scope made this untestable - was wrong: `vi.mock` is
// hoisted above the mocked module's own top-level code, so the fake is in place
// before `App.tsx` ever calls `createApi()`. The real obstacles were two jsdom
// gaps, `matchMedia` (xterm reads it) and `WebSocket`, both stubbed below.
import { describe, expect, it, vi } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import type {
  createApi,
  FinishResponse,
  GradeReportView,
  GradeResponse,
  SessionMode,
  SessionView,
  StartedSession,
  TaskSummary,
} from '../../src/web/api.ts'

const TASK_ID = 'storage/014-grow-home-lv'
const TITLE = 'Grow /home to 12 GiB'
const PROMPT = 'Grow it.'

const TASK: TaskSummary = {
  id: TASK_ID,
  title: TITLE,
  chapter: 14,
  scope: 'exam-objective',
  difficulty: 3,
  timeBudget: 600,
  weight: 'high',
  rebootCheck: false,
  transport: 'ssh',
  objectives: [],
}

/** A clean sweep. The screen's most dangerous input, so every test starts here. */
const REPORT: GradeReportView = {
  passed: 5,
  total: 5,
  expectedTotal: 5,
  incomplete: false,
  countDisputed: false,
  allPassed: true,
  rebooted: true,
  regressionCount: 0,
}

/** What `POST /grade` sends: the report in an envelope, phase still `active`. */
const GRADED: GradeResponse = { phase: 'active', rung: 5, ...REPORT }

/**
 * `mode` is echoed back from the request, the way the server does, so one fake
 * serves both the guided and the rated arms - and so a test that asks for guided
 * cannot quietly be handed a practice session. `finish` mirrors `app.ts`'s
 * `if (s.mode !== 'guided')`: a guided attempt is finished with `rating: null`,
 * and `phase: 'graded'` is the only thing on the response that says it is over.
 */
let mode: SessionMode = 'practice'

const fake = {
  health: vi.fn(async () => ({ ok: true, transport: 'ssh' as const, tasks: 1 })),
  // `chapters` is the book's chapter list, not the bank's; one task in chapter 15
  // and a book that also has 16 is the smallest shape that keeps the picker's
  // backlog row exercised through the whole app rather than only in its own test.
  tasks: vi.fn(async (): Promise<{ tasks: TaskSummary[]; chapters: number[] }> => ({
    tasks: [TASK],
    chapters: [15, 16],
  })),
  task: vi.fn(async () => ({ id: TASK_ID, title: TITLE, concepts: [] })),
  concept: vi.fn(async () => ({ id: 'lvm-extend', title: 'Extending a logical volume', body: 'b' })),
  start: vi.fn(async (taskId: string, m: SessionMode): Promise<StartedSession> => {
    mode = m
    return {
      id: 's1',
      taskId,
      title: TITLE,
      prompt: PROMPT,
      mode: m,
      rung: m === 'guided' ? 5 : 1,
      maxRung: 5,
      checkpointTotal: 5,
      timeBudget: 600,
      rebootCheck: false,
      taskTransport: 'ssh',
      transport: 'ssh',
      // Derived from the mode the caller asked for, the same way the server derives
      // it, so a test that starts an exam cannot be quietly handed an online guest.
      offline: m === 'drill' || m === 'exam',
    }
  }),
  hint: vi.fn(async () => ({
    rung: 5,
    content: { rung: 5, kind: 'solution' as const, title: 'the solution', body: 'lvextend' },
    all: [{ rung: 5, kind: 'solution' as const, title: 'the solution', body: 'lvextend' }],
  })),
  reset: vi.fn(
    async (): Promise<SessionView> => ({
      id: 's1',
      taskId: TASK_ID,
      mode,
      rung: 1,
      maxRung: 5,
      checkpointTotal: 5,
      startedAt: 0,
      phase: 'active',
    }),
  ),
  // The four Phase 2 reads, present because `shapeCheck` below compares this
  // object to the whole client and would otherwise fail to compile. The lab
  // calls none of them - `App` mounts the Dashboard, Learn and Concepts screens
  // only when they are opened - and `test/web/nav.test.tsx` asserts exactly that
  // rather than leaving it to these stubs to prove.
  overview: vi.fn(async () => ({
    tasks: { total: 1, byScope: { 'exam-objective': 1 } },
    objectives: { total: 1, covered: 1, uncovered: 0, untouched: 0 },
    concepts: { total: 1, untaught: 0, unreachable: 0 },
    attempts: { total: 0, clean: 0, byMode: {} },
    vm: null,
  })),
  conceptGraph: vi.fn(async () => ({ concepts: [], problems: [] })),
  guidedForTask: vi.fn(async () => []),
  guidedForObjective: vi.fn(async () => []),
  grade: vi.fn(async (): Promise<GradeResponse> => GRADED),
  finish: vi.fn(
    async (): Promise<FinishResponse> => ({
      id: 's1',
      taskId: TASK_ID,
      mode,
      rung: mode === 'guided' ? 5 : 1,
      maxRung: 5,
      checkpointTotal: 5,
      startedAt: 0,
      endedAt: 1,
      phase: 'graded',
      report: REPORT,
      rating: mode === 'guided' ? null : 'hard',
    }),
  ),
}

// Checked against the real client's shape at compile time, so a route that
// changes its signature breaks this file instead of letting the fake drift into
// describing an API that no longer exists.
const shapeCheck: ReturnType<typeof createApi> = fake
void shapeCheck

vi.mock('../../src/web/api.ts', () => ({
  createApi: () => fake,
  ApiError: class ApiError extends Error {},
}))

// xterm queries `matchMedia` while opening, and jsdom does not implement it.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }),
})

class FakeWS {
  static OPEN = 1
  readyState = 0
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  send() {}
  close() {}
}
Object.defineProperty(globalThis, 'WebSocket', { writable: true, value: FakeWS })

const { App } = await import('../../src/web/App.tsx')

async function enterLab(modeLabel: RegExp) {
  render(<App />)
  await waitFor(() => expect(screen.getByText(TITLE)).toBeDefined())
  await act(async () => {
    // `/^Guided /` and not `/^Guided$/`: the button's accessible name is its
    // label joined with the blurb underneath it.
    screen.getByRole('button', { name: modeLabel }).click()
  })
  // TaskPicker's Start button is disabled for one commit after the task list
  // arrives, because the effect that picks a default task runs after the render
  // that displayed it. Clicking too early is a click on a disabled button, which
  // does nothing and fails nothing.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Start$/ }).getAttribute('disabled')).toBeNull(),
  )
  await act(async () => {
    screen.getByRole('button', { name: /^Start$/ }).click()
  })
  await waitFor(() => expect(screen.getByText(PROMPT)).toBeDefined())
}

function key(k: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  })
}

function resetFake() {
  fake.grade.mockClear()
  fake.grade.mockResolvedValue(GRADED)
  fake.hint.mockClear()
  fake.finish.mockClear()
  fake.reset.mockClear()
}

describe('App, guided mode', () => {
  it('closes the attempt at finish even though guided produces no rating', async () => {
    // The defect this file exists for. `finished` used to be `rating !== null`,
    // and the server returns `rating: null` for guided, so every guard was off in
    // the one mode a beginner reaches for first.
    resetFake()
    await enterLab(/^Guided /)
    key('F4')
    await waitFor(() => expect(screen.getByText('5 / 5 passed')).toBeDefined())
    key('F8')
    await waitFor(() => expect(screen.getByText(/Attempt finished/)).toBeDefined())

    // Said in words, including why there is no rating - a finished attempt with
    // no explanation reads as one that failed to record.
    expect(screen.getByText(/Guided mode computes no rating/)).toBeDefined()
    // And the controls are shut, in the rail as well as in the box.
    expect(screen.getByRole('button', { name: /grade/i }).getAttribute('disabled')).not.toBeNull()
    expect(screen.getByRole('button', { name: /hint/i }).getAttribute('disabled')).not.toBeNull()
    expect(
      screen.getByRole('button', { name: /reset lab/i }).getAttribute('disabled'),
    ).not.toBeNull()
    expect(screen.getByText(/this attempt is finished/i)).toBeDefined()
  })

  it('ignores F2, F4 and F8 once the attempt is finished', async () => {
    // Item 1: the key handler. Disabled buttons beside live shortcuts would be a
    // hole exactly the shape of the thing being prevented, and guided is the arm
    // where the gate was inert.
    resetFake()
    await enterLab(/^Guided /)
    // Guided opens the whole ladder on start, so `hint` has already been called
    // once before any key is pressed.
    const hintsAtStart = fake.hint.mock.calls.length
    key('F4')
    await waitFor(() => expect(screen.getByText('5 / 5 passed')).toBeDefined())
    key('F8')
    await waitFor(() => expect(screen.getByText(/Attempt finished/)).toBeDefined())
    const gradesAtFinish = fake.grade.mock.calls.length

    key('F2')
    key('F4')
    key('F8')
    // Nothing queued behind the keypresses: no second grade to overwrite the
    // report, no second finish to record another rating, no hint to advance the
    // rung past what the attempt was rated on.
    await act(async () => {
      await Promise.resolve()
    })
    expect(fake.grade.mock.calls.length).toBe(gradesAtFinish)
    expect(fake.finish).toHaveBeenCalledTimes(1)
    expect(fake.hint.mock.calls.length).toBe(hintsAtStart)
    // The earned tally is still on screen rather than wiped by a 409.
    expect(screen.getByText('5 / 5 passed')).toBeDefined()
  })

  it('stops the clock at finish, so a solved lab is never called over budget', async () => {
    // Item 4, and the assertion that catches the original defect outright: under
    // `finished = rating !== null` this test fails on the "over budget" line,
    // because a guided attempt kept its timer running until the ten-minute budget
    // blew - on a lab the student had just solved.
    resetFake()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await enterLab(/^Guided /)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000)
      })
      expect(screen.getByText('00:04 / 10:00')).toBeDefined()

      key('F4')
      await waitFor(() => expect(screen.getByText('5 / 5 passed')).toBeDefined())
      key('F8')
      await waitFor(() => expect(screen.getByText(/Attempt finished/)).toBeDefined())

      const stopped = screen.getByText(/\d\d:\d\d \/ 10:00/).textContent
      await act(async () => {
        await vi.advanceTimersByTimeAsync(601_000)
      })
      expect(screen.getByText(/\d\d:\d\d \/ 10:00/).textContent).toBe(stopped)
      expect(screen.queryByText(/over budget/i)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('App, a rated mode', () => {
  it('clears a stale offline warning when the reset comes back clean', async () => {
    // The reset reverts the guest and the server re-applies the mode's network
    // state afterwards, so the answer from session start is out of date either way
    // it went. An amber "you still have internet access" left standing beside a
    // guest that is now genuinely offline is the same lie as the reverse - it
    // teaches the student to disbelieve the badge, and then the real warning is
    // just more furniture.
    resetFake()
    const started = fake.start.getMockImplementation()
    if (started === undefined) throw new Error('the fake client lost its start implementation')
    fake.start.mockImplementationOnce(async (taskId: string, m: SessionMode) => ({
      ...(await started(taskId, m)),
      offlineWarning: 'offline mode could not be applied, so this exam session still has internet access: sudo: no tty present',
    }))

    await enterLab(/^Exam /)
    expect(screen.getByText(/still has internet access/i)).toBeDefined()

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      await act(async () => {
        screen.getByRole('button', { name: /reset lab/i }).click()
      })
    } finally {
      confirm.mockRestore()
    }

    await waitFor(() => expect(screen.queryByText(/still has internet access/i)).toBeNull())
    // And the claim the warning was contradicting is back: this fake's `/reset`
    // omits `offline`, which is the "unchanged" answer, so exam mode still says so.
    expect(screen.getByText(/no default route in exam mode/i)).toBeDefined()
  })

  it('drops the stale tally when a re-grade fails, and shows the rating at finish', async () => {
    // Item 5. What this prevents: the green verdict from the previous grade left
    // standing next to an error box, which claims a pass for a machine state that
    // was never graded - the student has changed the machine since, so the tally
    // on screen describes an attempt that no longer exists.
    resetFake()
    fake.grade.mockReset()
    fake.grade.mockResolvedValueOnce(GRADED)
    fake.grade.mockRejectedValueOnce(new Error('grade blew up: exec failed'))
    await enterLab(/^Practice /)

    key('F4')
    await waitFor(() => expect(screen.getByText('5 / 5 passed')).toBeDefined())
    expect(screen.getByText('All checkpoints passed.')).toBeDefined()

    key('F4')
    await waitFor(() => expect(screen.getByText(/grade blew up/)).toBeDefined())
    expect(screen.queryByText('5 / 5 passed')).toBeNull()
    expect(screen.queryByText('All checkpoints passed.')).toBeNull()
    // Back to the masked total, which claims nothing.
    expect(screen.getByText('5 checkpoints')).toBeDefined()
    // And Finish is shut, because there is no current report to finish on.
    expect(screen.getByRole('button', { name: /finish/i }).getAttribute('disabled')).not.toBeNull()

    // F8 still reaches doFinish once a report exists again, and it clears the
    // stale error on the way through.
    fake.grade.mockResolvedValueOnce(GRADED)
    key('F4')
    await waitFor(() => expect(screen.getByText('5 / 5 passed')).toBeDefined())
    key('F8')
    await waitFor(() => expect(screen.getByText(/Rating \(not saved\)/)).toBeDefined())
    expect(screen.getByText('hard')).toBeDefined()
    expect(screen.queryByText(/grade blew up/)).toBeNull()
    expect(screen.queryByText(/Guided mode computes no rating/)).toBeNull()
  })

  it('says the rating was withheld for an untrustworthy report, not that the mode has none', async () => {
    // `rating === null` is what a guided finish and an untrustworthy-report
    // finish both look like off the wire. A copy fix that only handles the
    // guided case still tells a practice-mode student "guided mode records no
    // rating" here, which is false by name and false by implication both.
    resetFake()
    fake.finish.mockResolvedValueOnce({
      id: 's1',
      taskId: TASK_ID,
      mode: 'practice',
      rung: 1,
      maxRung: 5,
      checkpointTotal: 5,
      startedAt: 0,
      endedAt: 1,
      phase: 'graded',
      report: { ...REPORT, incomplete: true },
      rating: null,
    })
    await enterLab(/^Practice /)

    key('F4')
    await waitFor(() => expect(screen.getByText('5 / 5 passed')).toBeDefined())
    key('F8')
    await waitFor(() => expect(screen.getByText(/Attempt finished/)).toBeDefined())

    expect(screen.getByText(/checkpoint count could not be trusted/)).toBeDefined()
    expect(screen.queryByText(/Guided mode computes no rating/)).toBeNull()
    expect(screen.queryByText(/Rating \(not saved\)/)).toBeNull()
  })

  it('withholds the rating on countDisputed alone, with incomplete and the total both clean', async () => {
    // `reportUntrustworthy` reads three disjuncts, but the test above only ever
    // drives `incomplete`. Dropping `report.countDisputed` from the disjunct
    // (mutant M10) left the earlier suite green, because the App-level test for
    // this pane used `incomplete: true` instead of the signal this pane's third
    // disjunct actually exists for. This drives `countDisputed` alone -
    // `incomplete: false` and `total === expectedTotal` - so a regression here
    // is attributable to `countDisputed` and nothing else.
    resetFake()
    fake.finish.mockResolvedValueOnce({
      id: 's1',
      taskId: TASK_ID,
      mode: 'practice',
      rung: 1,
      maxRung: 5,
      checkpointTotal: 5,
      startedAt: 0,
      endedAt: 1,
      phase: 'graded',
      report: { ...REPORT, countDisputed: true },
      rating: null,
    })
    await enterLab(/^Practice /)

    key('F4')
    await waitFor(() => expect(screen.getByText('5 / 5 passed')).toBeDefined())
    key('F8')
    await waitFor(() => expect(screen.getByText(/Attempt finished/)).toBeDefined())

    expect(screen.getByText(/checkpoint count could not be trusted/)).toBeDefined()
    expect(screen.queryByText(/Guided mode computes no rating/)).toBeNull()
    expect(screen.queryByText(/Rating \(not saved\)/)).toBeNull()
  })
})
