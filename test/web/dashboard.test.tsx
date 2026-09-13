// @vitest-environment jsdom
//
// What this file is really testing is a refusal. Section 9.4: "a study tool that
// flatters is worse than no study tool", and the flattery available to a Phase 2
// dashboard is a readiness percentage, an empty drill queue and a zero for every
// unmeasured thing. Most assertions below are therefore negative - they pin the
// absence of a number that would be false.
import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createApi, type ConceptGraphView, type OverviewView } from '../../src/web/api.ts'
import { Dashboard } from '../../src/web/screens/Dashboard.tsx'
import { fakeFetch, routes } from './fake-fetch.ts'

const OVERVIEW: OverviewView = {
  tasks: { total: 5, byScope: { 'exam-objective': 4, instrumental: 1 } },
  objectives: { total: 68, covered: 6, uncovered: 62, untouched: 41 },
  concepts: { total: 40, untaught: 1, unreachable: 0 },
  attempts: { total: 3, clean: 2, byMode: { practice: 2, guided: 1 } },
  vm: { snapshot: 'clean', currentTask: 'storage/014-grow-home-lv', appliedAt: 1_757_000_000_000 },
}

const GRAPH: ConceptGraphView = {
  problems: [],
  concepts: [
    {
      id: 'lvm.extend',
      title: 'Extending a logical volume',
      area: 'storage',
      objectives: ['storage.lvm.resize'],
      prerequisites: [],
      taught: true,
      reachable: true,
      requiredByTasks: ['storage/014-grow-home-lv'],
    },
    {
      id: 'autofs.maps',
      title: 'autofs maps',
      area: 'storage',
      objectives: ['storage.autofs'],
      prerequisites: [],
      taught: false,
      reachable: false,
      requiredByTasks: [],
    },
  ],
}

function mount(handler: (url: string) => [number, unknown]) {
  const { impl, seen } = fakeFetch(handler)
  render(<Dashboard api={createApi(impl)} onNavigate={() => undefined} />)
  return seen
}

const OK = routes({ '/api/overview': OVERVIEW, '/api/concepts': GRAPH })

describe('Dashboard, what it refuses to claim', () => {
  it('states that readiness, the drill queue, the weakest objectives and the holdouts are not computed', async () => {
    mount(OK)
    await waitFor(() => expect(screen.getByText('Bank coverage')).toBeDefined())

    // Four measurements section 11 asks for that this build cannot make. Each is
    // named as absent, and each says what would produce it.
    expect(screen.getByText('Readiness')).toBeDefined()
    expect(screen.getByText("Today's drill queue")).toBeDefined()
    expect(screen.getByText('Weakest objectives')).toBeDefined()
    expect(screen.getByText('Sealed-holdout status')).toBeDefined()
    expect(screen.getAllByText('not computed').length).toBe(4)

    // The specific lie each one replaces.
    expect(screen.getByText(/No percentage is shown here/)).toBeDefined()
    expect(screen.getByText(/Empty is not the same as unscheduled/)).toBeDefined()
  })

  it('renders no percentage anywhere', async () => {
    // Blunt on purpose. A readiness meter is the one thing that could be derived
    // from the counts on this screen and would be false about the student, so a
    // future edit that adds a percent sign should fail a test rather than ship.
    const { container } = render(
      <Dashboard api={createApi(fakeFetch(OK).impl)} onNavigate={() => undefined} />,
    )
    await waitFor(() => expect(screen.getByText('Bank coverage')).toBeDefined())
    expect(container.textContent).not.toMatch(/%/)
  })

  it('shows the counts it does have, labelled as facts about the bank', async () => {
    mount(OK)
    await waitFor(() => expect(screen.getByText('Bank coverage')).toBeDefined())

    expect(screen.getByText('6 / 68')).toBeDefined()
    expect(screen.getByText('4 exam-objective, 1 instrumental')).toBeDefined()
    expect(screen.getByText('2 practice, 1 guided')).toBeDefined()
    expect(screen.getByText(/an objective can be covered by a task you have never attempted/)).toBeDefined()
  })
})

describe('Dashboard, VM state (UI rule 1)', () => {
  it('shows the snapshot and the applied task, and says power state is not reported', async () => {
    mount(OK)
    await waitFor(() => expect(screen.getByText('clean')).toBeDefined())
    expect(screen.getByText('storage/014-grow-home-lv')).toBeDefined()
    expect(screen.getByText(/Power state is not reported/)).toBeDefined()
  })

  it('treats a missing row as nothing known, not as an error and not as clean', async () => {
    mount(routes({ '/api/overview': { ...OVERVIEW, vm: null }, '/api/concepts': GRAPH }))
    await waitFor(() => expect(screen.getByText(/Nothing known/)).toBeDefined())
    expect(screen.getByText(/it is not a claim that the VM is clean/)).toBeDefined()
  })

  it('says a half-applied setup is unknown and names the consequence', async () => {
    // `VmStateStore.unknown()` writes the null pair before a revert, so this is
    // what an interrupted revert looks like. Section 5.5 refuses to grade here, so
    // the screen has to say so or the later refusal arrives as a surprise.
    mount(
      routes({
        '/api/overview': { ...OVERVIEW, vm: { snapshot: null, currentTask: null, appliedAt: 1 } },
        '/api/concepts': GRAPH,
      }),
    )
    await waitFor(() => expect(screen.getByText(/grading is refused until a reset/)).toBeDefined())
    expect(screen.getAllByText('unknown').length).toBe(2)
  })

  it('does not report a failed read as nothing known', async () => {
    // The dangerous conflation: an unreachable server is not evidence about the
    // guest. Saying "nothing known about the VM" on the authority of a 500 is a
    // claim made from no measurement.
    mount((url) =>
      url === '/api/overview' ? [500, { error: 'db locked' }] : [200, GRAPH],
    )
    await waitFor(() => expect(screen.getByText(/The VM state could not be read/)).toBeDefined())
    expect(screen.queryByText(/Nothing known/)).toBeNull()
    // And the counts are named as missing rather than silently absent.
    expect(screen.getByText(/The bank and attempt counts could not be read/)).toBeDefined()
    expect(screen.queryByText('Bank coverage')).toBeNull()
  })
})

describe('Dashboard, concept gaps (risk R7)', () => {
  it('names the untaught cards rather than only counting them', async () => {
    // R7's mitigation is "a missing card is visible, not silent", and a count is
    // not actionable - the id is.
    mount(OK)
    await waitFor(() => expect(screen.getByText(/autofs maps/)).toBeDefined())
    // The id is in a child span, so the row's own text is asserted rather than
    // queried: `getByText` joins direct text children only.
    expect(screen.getByText(/autofs maps/).textContent).toMatch(/autofs\.maps.*unreachable/)
  })

  it('renders the graph problems loudly and attributes them to authoring', async () => {
    mount(
      routes({
        '/api/overview': OVERVIEW,
        '/api/concepts': { ...GRAPH, problems: ['storage/014: requires unknown concept: lvm.nope'] },
      }),
    )
    await waitFor(() => expect(screen.getByText('1 content problem in the concept graph')).toBeDefined())
    expect(screen.getByText(/requires unknown concept: lvm.nope/)).toBeDefined()
    expect(screen.getByText(/not your doing/)).toBeDefined()
  })

  it('keeps the VM state visible when the concept graph is the half that failed', async () => {
    // Two reads, two errors. The student came here to check the machine; a broken
    // concept graph must not take that away.
    mount((url) => (url === '/api/concepts' ? [500, { error: 'boom' }] : [200, OVERVIEW]))
    await waitFor(() => expect(screen.getByText(/concept graph could not be read/)).toBeDefined())
    expect(screen.getByText('clean')).toBeDefined()
    expect(screen.getByText('Bank coverage')).toBeDefined()
  })
})
