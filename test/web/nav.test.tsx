// @vitest-environment jsdom
//
// The shell, and the three things about it that can be silently wrong: a nav key
// that steals one of the lab's, a lab that gets torn down (and takes the guest-side
// `ssh -tt` with it) when the student glances at another screen, and a screen that
// fetches at startup for a student who never opens it. All three are invisible in a
// rendered snapshot, so all three are asserted behaviourally here.
import { describe, expect, it, vi } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import type {
  createApi,
  FinishResponse,
  GradeReportView,
  GradeResponse,
  SessionView,
  StartedSession,
  TaskSummary,
} from '../../src/web/api.ts'
import { SCREENS } from '../../src/web/nav.ts'

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
  objectives: ['storage.lvm.resize'],
}

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

const SESSION: StartedSession = {
  id: 's1',
  taskId: TASK_ID,
  title: TITLE,
  prompt: PROMPT,
  mode: 'practice',
  rung: 1,
  maxRung: 5,
  checkpointTotal: 5,
  timeBudget: 600,
  rebootCheck: false,
  taskTransport: 'ssh',
  transport: 'ssh',
  // Practice mode, so online — §9.1's untimed mode with the whole ladder open has
  // no business withholding the internet.
  offline: false,
}

const fake = {
  health: vi.fn(async () => ({ ok: true, transport: 'ssh' as const, tasks: 1 })),
  tasks: vi.fn(async (): Promise<TaskSummary[]> => [TASK]),
  task: vi.fn(async () => ({ id: TASK_ID, title: TITLE, concepts: [] })),
  concept: vi.fn(async () => ({ id: 'lvm.extend', title: 'Extending a logical volume', body: 'b' })),
  overview: vi.fn(async () => ({
    tasks: { total: 1, byScope: { 'exam-objective': 1 } },
    objectives: { total: 68, covered: 1, uncovered: 67, untouched: 41 },
    concepts: { total: 1, untaught: 0, unreachable: 0 },
    attempts: { total: 0, clean: 0, byMode: {} },
    vm: null,
  })),
  conceptGraph: vi.fn(async () => ({ concepts: [], problems: [] })),
  guidedForTask: vi.fn(async () => []),
  guidedForObjective: vi.fn(async () => []),
  start: vi.fn(async (): Promise<StartedSession> => SESSION),
  hint: vi.fn(async () => ({
    rung: 2,
    content: { rung: 2, kind: 'nudge' as const, title: 'a nudge', body: 'look at lvextend' },
  })),
  reset: vi.fn(
    async (): Promise<SessionView> => ({
      id: 's1',
      taskId: TASK_ID,
      mode: 'practice',
      rung: 1,
      maxRung: 5,
      checkpointTotal: 5,
      startedAt: 0,
      phase: 'active',
    }),
  ),
  grade: vi.fn(async (): Promise<GradeResponse> => ({ phase: 'active', rung: 1, ...REPORT })),
  finish: vi.fn(
    async (): Promise<FinishResponse> => ({
      id: 's1',
      taskId: TASK_ID,
      mode: 'practice',
      rung: 1,
      maxRung: 5,
      checkpointTotal: 5,
      startedAt: 0,
      endedAt: 1,
      phase: 'graded',
      report: REPORT,
      rating: 'hard',
    }),
  ),
}

// The same compile-time drift guard `app.test.tsx` uses.
const shapeCheck: ReturnType<typeof createApi> = fake
void shapeCheck

vi.mock('../../src/web/api.ts', () => ({
  createApi: () => fake,
  ApiError: class ApiError extends Error {},
}))

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

/**
 * Counts openings and closings, which is the whole point of this file's central
 * assertion: the socket's far end is the guest-side `ssh -tt`, so a close is a
 * killed shell and a lost scrollback, and React unmounting a hidden subtree is the
 * easy way to cause one by accident.
 */
class FakeWS {
  static OPEN = 1
  static opened = 0
  static closed = 0
  readyState = 0
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  constructor() {
    FakeWS.opened += 1
  }
  send() {}
  close() {
    FakeWS.closed += 1
  }
}
Object.defineProperty(globalThis, 'WebSocket', { writable: true, value: FakeWS })

const { App } = await import('../../src/web/App.tsx')

function key(k: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  })
}

/** Which nav button is marked `aria-current="page"`. */
function here(): string {
  const el = document.querySelector('nav [aria-current="page"]')
  return el?.textContent ?? 'none'
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

function clearAll() {
  for (const fn of Object.values(fake)) fn.mockClear()
  FakeWS.opened = 0
  FakeWS.closed = 0
}

/** Gets as far as a running attempt, so the terminal socket exists. */
async function startAnAttempt() {
  render(<App />)
  await waitFor(() => expect(screen.getByText(TITLE)).toBeDefined())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Start$/ }).getAttribute('disabled')).toBeNull(),
  )
  await act(async () => {
    screen.getByRole('button', { name: /^Start$/ }).click()
  })
  await waitFor(() => expect(screen.getByText(PROMPT)).toBeDefined())
}

describe('the nav bar', () => {
  it('claims no key the lab already owns', () => {
    // Structural, and the cheapest guard in the suite. The lab's shortcuts are F2
    // (hint), F4 (grade) and F8 (finish) - themselves chosen because the terminal
    // must receive every Ctrl sequence, which is why the spec's ^G/^H/^R are not
    // what shipped. A nav key overlapping one of those would spend a hint rung or
    // grade an unfinished machine on a keypress meant to change screens.
    const navKeys = SCREENS.map((s) => s.key).filter((k): k is string => k !== null)
    expect(navKeys).not.toContain('F2')
    expect(navKeys).not.toContain('F4')
    expect(navKeys).not.toContain('F8')
    // And no Ctrl or Alt chord anywhere: xterm forwards those to the shell.
    expect(navKeys.every((k) => /^F\d+$/.test(k))).toBe(true)
    // Distinct, or one key would open two screens.
    expect(new Set(navKeys).size).toBe(navKeys.length)
  })

  it('lists all six screens of section 11 and marks the two that are not built', async () => {
    clearAll()
    render(<App />)
    const nav = screen.getByRole('navigation', { name: 'screens' })
    const labels = [...nav.querySelectorAll('button')].map((b) => b.textContent ?? '')
    expect(labels.length).toBe(6)
    // In section 11's order, with the shortcut printed - the keys are arbitrary,
    // so an unprinted key is a key nobody finds.
    expect(labels[0]).toMatch(/^DashboardF3$/)
    expect(labels[2]).toMatch(/^LabF7$/)
    expect(labels[5]).toMatch(/^ConceptsF9$/)
    // Track and Exams carry no shortcut and say what they are.
    expect(labels[3]).toMatch(/^Trackphase 3$/)
    expect(labels[4]).toMatch(/^Examsphase 3$/)
    await waitFor(() => expect(screen.getByText(TITLE)).toBeDefined())
  })
})

describe('App, moving between screens', () => {
  it('opens on the Lab and asks nothing on behalf of a screen nobody opened', async () => {
    // The lab is the one screen with a real graded attempt behind it, and it is
    // also why the other three mount lazily: three reads fired at startup for
    // screens the student may never open is latency spent on nothing.
    clearAll()
    render(<App />)
    await waitFor(() => expect(screen.getByText(TITLE)).toBeDefined())
    expect(here()).toMatch(/^Lab/)
    expect(fake.overview).not.toHaveBeenCalled()
    expect(fake.conceptGraph).not.toHaveBeenCalled()
    expect(fake.guidedForTask).not.toHaveBeenCalled()
  })

  it('moves on F3, F6, F9 and back on F7', async () => {
    clearAll()
    render(<App />)
    await waitFor(() => expect(screen.getByText(TITLE)).toBeDefined())

    key('F3')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeDefined())
    expect(here()).toMatch(/^Dashboard/)
    expect(fake.overview).toHaveBeenCalledTimes(1)

    key('F6')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Learn' })).toBeDefined())
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).toBeNull()

    key('F9')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Concepts' })).toBeDefined())
    expect(fake.conceptGraph).toHaveBeenCalled()

    key('F7')
    expect(here()).toMatch(/^Lab/)
    expect(screen.queryByRole('heading', { name: 'Concepts' })).toBeNull()
  })

  it('navigates by click as well, for the two screens with no shortcut', async () => {
    clearAll()
    render(<App />)
    await waitFor(() => expect(screen.getByText(TITLE)).toBeDefined())
    await act(async () => {
      screen.getByRole('button', { name: /^Track/ }).click()
    })
    expect(here()).toMatch(/^Track/)
  })
})

describe('App, what navigation must not break', () => {
  it('leaves F2, F4 and F8 to the lab, and the hidden lab does not answer them', async () => {
    // Two failures in one test because they are the same mistake seen from either
    // end: a nav key that also grades, and a lab that keeps grading from behind
    // another screen. The second is the worse one - F4 on the Dashboard would run
    // a grade script against the guest with nothing on screen to say it happened.
    clearAll()
    await startAnAttempt()

    key('F3')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeDefined())

    key('F2')
    key('F4')
    key('F8')
    await flush()

    expect(here()).toMatch(/^Dashboard/)
    expect(fake.hint).not.toHaveBeenCalled()
    expect(fake.grade).not.toHaveBeenCalled()
    expect(fake.finish).not.toHaveBeenCalled()

    // And they work again the moment the lab is back in front.
    key('F7')
    key('F4')
    await waitFor(() => expect(fake.grade).toHaveBeenCalledTimes(1))
  })

  it('keeps the terminal socket open while another screen is in front', async () => {
    // The socket's far end is `ssh -tt` on the guest. Unmounting the lab to show
    // the Dashboard would close it, killing the shell, the scrollback and anything
    // left running mid-attempt - and the student would come back to a dead pane
    // with no explanation.
    clearAll()
    await startAnAttempt()
    expect(FakeWS.opened).toBe(1)

    key('F3')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeDefined())
    expect(FakeWS.closed).toBe(0)
    // Still mounted, just not visible: the prompt is in the document.
    expect(screen.getByText(PROMPT)).toBeDefined()

    key('F7')
    await flush()
    // No reconnect either, which is the other half of the same claim: a socket
    // reopened per visit is a new shell in a new working directory.
    expect(FakeWS.opened).toBe(1)
    expect(FakeWS.closed).toBe(0)
  })
})

describe('App, the Phase 3 screens', () => {
  it('renders an honest empty state behind Track rather than a fake table', async () => {
    // Section 11 wants Track's ticks "derived from task results". Derived from
    // nothing, they would be 28 chapters of empty boxes that read as a progress
    // report - so there is no table at all, and a sentence saying why.
    clearAll()
    render(<App />)
    await waitFor(() => expect(screen.getByText(TITLE)).toBeDefined())
    await act(async () => {
      screen.getByRole('button', { name: /^Track/ }).click()
    })
    expect(screen.getByText('Track is not built yet')).toBeDefined()
    expect(screen.getByText('not computed')).toBeDefined()
    expect(screen.getByText(/derived from task results/)).toBeDefined()
    // No table, no chapter rows, no ticks.
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('renders an honest empty state behind Exams rather than eight dead buttons', async () => {
    clearAll()
    render(<App />)
    await waitFor(() => expect(screen.getByText(TITLE)).toBeDefined())
    await act(async () => {
      screen.getByRole('button', { name: /^Exams/ }).click()
    })
    expect(screen.getByText('Exams is not built yet')).toBeDefined()
    expect(screen.getByText(/a rehearsal that is not one/)).toBeDefined()
    // Nothing on the screen itself is clickable: no exam to start, no report to
    // open. (The document still holds the lab's own buttons - it stays mounted
    // behind this one - so the assertion is scoped to the Exams subtree.)
    const pane = screen.getByRole('heading', { name: 'Exams' }).closest('div')
    expect(pane?.querySelectorAll('button').length).toBe(0)
  })
})
