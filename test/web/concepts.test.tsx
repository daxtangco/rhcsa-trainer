// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createApi, type ConceptGraphView } from '../../src/web/api.ts'
import { Concepts } from '../../src/web/screens/Concepts.tsx'
import { fakeFetch, routes } from './fake-fetch.ts'

/**
 * Three cards covering the three states the bank can produce: taught and
 * reachable, untaught but reachable as somebody's prerequisite, and unreachable.
 * The middle one is the distinction `CoverageReport` draws and the reason the
 * screen has two lists instead of one.
 */
const GRAPH: ConceptGraphView = {
  problems: [],
  concepts: [
    {
      id: 'lvm.extend',
      title: 'Extending a logical volume',
      area: 'storage',
      objectives: ['storage.lvm.resize'],
      prerequisites: ['lvm.model'],
      taught: true,
      reachable: true,
      requiredByTasks: ['storage/014-grow-home-lv'],
    },
    {
      id: 'lvm.model',
      title: 'The LVM object model',
      area: 'storage',
      objectives: [],
      prerequisites: [],
      taught: false,
      reachable: true,
      requiredByTasks: [],
    },
    {
      id: 'selinux.booleans',
      title: 'SELinux booleans',
      area: 'selinux',
      objectives: ['selinux.booleans'],
      prerequisites: [],
      taught: false,
      reachable: false,
      requiredByTasks: [],
    },
  ],
}

const CARD = { id: 'lvm.extend', title: 'Extending a logical volume', body: 'lvextend -r -L +2G ...' }

function mount(handler: (url: string) => [number, unknown]) {
  const { impl, seen } = fakeFetch(handler)
  render(<Concepts api={createApi(impl)} />)
  return seen
}

const OK = routes({ '/api/concepts': GRAPH, '/api/concepts/lvm.extend': CARD })

describe('Concepts, the states it can and cannot derive', () => {
  it('separates untaught from unreachable, because one is stricter than the other', async () => {
    mount(OK)
    await waitFor(() => expect(screen.getByText('unreachable cards')).toBeDefined())

    // The unreachable card is called out as content that can never be delivered.
    expect(screen.getByText(/This content exists and cannot be delivered/)).toBeDefined()
    // The untaught-but-reachable one is not lumped in with it: two cards are
    // untaught, only one of them is out of reach.
    expect(screen.getByText(/2 cards that no task names directly/)).toBeDefined()
    expect(screen.getByText(/still reachable if some task's card needs it/)).toBeDefined()
    expect(screen.getByText(/1 card that no task requires/)).toBeDefined()
  })

  it('says plainly that needed-again and demonstrated-cold need attempt history', async () => {
    // Section 11 asks for four states. Two are facts about the bank and are here;
    // two are facts about the student, live in `concept_state`, and nothing in this
    // build writes that table. Rendering them as zero would say "you have never
    // needed this card" on the strength of a table nobody has ever written to.
    mount(OK)
    await waitFor(() => expect(screen.getByText('Needed again, and demonstrated cold')).toBeDefined())
    expect(screen.getByText('not computed')).toBeDefined()
    expect(screen.getByText(/concept_state.times_needed/)).toBeDefined()
    expect(screen.getByText(/rather than shown as zero/)).toBeDefined()
  })

  it('renders problems first and loudly', async () => {
    // Risk R7: a missing card must be visible, not silent.
    mount(
      routes({
        '/api/concepts': {
          ...GRAPH,
          problems: ['storage/014-grow-home-lv: requires unknown concept: lvm.nope'],
        },
      }),
    )
    await waitFor(() => expect(screen.getByText('1 content problem')).toBeDefined())
    expect(screen.getByText(/requires unknown concept: lvm.nope/)).toBeDefined()
    expect(screen.getByText(/An authoring bug, not your doing/)).toBeDefined()
  })

  it('reports a failed read as a failed read', async () => {
    mount(() => [500, { error: 'bank refused to load' }])
    await waitFor(() =>
      expect(screen.getByText(/the concept graph could not be read: bank refused to load/)).toBeDefined(),
    )
  })
})

describe('Concepts, the index itself', () => {
  it('opens a card body on demand, because nothing here is withheld', async () => {
    // `GET /api/concepts/:id` is ungated by design - this app replaces the book -
    // so the index is browsable rather than a list of locked titles.
    const seen = mount(OK)
    // Queried by role rather than by text throughout: a card's title can appear
    // both in a gap list and in the index, so only the row's button is unambiguous.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Extending a logical volume/ })).toBeDefined(),
    )
    expect(screen.queryByText(/lvextend -r/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Extending a logical volume/ }))
    await waitFor(() => expect(screen.getByText(/lvextend -r/)).toBeDefined())
    expect(seen).toContain('/api/concepts/lvm.extend')
    // The graph's own metadata comes with it: what needs it, and what it needs.
    expect(screen.getByText(/needs first: lvm.model/)).toBeDefined()
    expect(screen.getByText(/required by: storage\/014-grow-home-lv/)).toBeDefined()
  })

  it('says so when a card no task requires is opened', async () => {
    mount(routes({ '/api/concepts': GRAPH, '/api/concepts/selinux.booleans': { ...CARD, id: 'selinux.booleans', body: 'setsebool -P ...' } }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /SELinux booleans/ })).toBeDefined(),
    )
    fireEvent.click(screen.getByRole('button', { name: /SELinux booleans/ }))
    await waitFor(() =>
      expect(screen.getByText(/No task requires this card, so no lab will ever hand it to you/)).toBeDefined(),
    )
  })

  it('filters by area without hiding the gap lists', async () => {
    mount(OK)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /SELinux booleans/ })).toBeDefined(),
    )

    fireEvent.click(screen.getByRole('button', { name: /^storage \(2\)$/ }))
    // The selinux card leaves the index...
    expect(screen.queryByRole('button', { name: /SELinux booleans/ })).toBeNull()
    // ...but not the unreachable list, which is the one thing that must stay in
    // sight whatever is being browsed.
    expect(screen.getByText(/This content exists and cannot be delivered/)).toBeDefined()
  })

  it('does not badge every card, so the gaps are the things that stand out', async () => {
    mount(OK)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Extending a logical volume/ })).toBeDefined(),
    )
    // Two untaught cards, one of them also unreachable, so two badges and one.
    // Nothing carries a green "taught" badge: the gap is the signal.
    expect(screen.getAllByText('untaught').length).toBe(2)
    expect(screen.getAllByText('unreachable').length).toBe(1)
    expect(screen.queryByText('taught')).toBeNull()
  })
})
