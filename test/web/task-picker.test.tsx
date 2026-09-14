// @vitest-environment jsdom
//
// The first describe holds a class-name assertion, which nothing else in
// `test/web/` does. The reason is that the defect it pins is a *layout* defect and
// jsdom has no layout: `offsetHeight` and `scrollHeight` are both 0 for everything,
// so "is the Start button reachable" cannot be asked here. The class is the only
// mechanical trace the fix leaves. The second describe is ordinary rendered-output
// testing and needs no such excuse.
//
// The defect was real and shipped. `App.tsx` mounts every screen inside a
// container that is `overflow-hidden`, which makes "provide your own scroller" a
// contract each screen has to meet on its own - `Dashboard`, `Concepts`,
// `NotBuilt` and both of `Learn`'s panes meet it, and `Lab` meets it on its
// `<main>`. `TaskPicker` did not, and got away with it for as long as the bank
// held five tasks and fit on one screen. At twenty-seven the task list, the Start
// button and the note about reverting the snapshot were all below the fold with no
// way to scroll to them, so the picker could not be used to start most of the
// tasks in the bank. Found by hand, at the screen, on the way into the Phase 1
// exit-criterion run - which is exactly what that checklist's item 1 is for.
//
// Testing for the class rather than the behaviour is a compromise and worth naming
// as one: it would pass if someone put `overflow-y-auto` on an element that had no
// bounded height, which is the other half of how this goes wrong. `h-full` is
// asserted alongside it for that reason - together they are the pair that actually
// scrolls, and either one alone does nothing.
import { describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import type { TaskSummary } from '../../src/web/api.ts'
import { TaskPicker } from '../../src/web/components/TaskPicker.tsx'

const task = (n: number, chapter = 15): TaskSummary => ({
  id: `storage/${String(n).padStart(3, '0')}-task`,
  title: `Task number ${n}`,
  chapter,
  scope: 'exam-objective',
  difficulty: 3,
  timeBudget: 900,
  weight: 'medium',
  rebootCheck: false,
  transport: 'ssh',
  objectives: [],
})

describe('the task picker scrolls', () => {
  it('carries its own scroller, because App mounts it inside overflow-hidden', () => {
    const { container } = render(
      <TaskPicker tasks={Array.from({ length: 27 }, (_, i) => task(i + 1))} onStart={() => {}} />,
    )

    const root = container.firstElementChild
    expect(root).not.toBeNull()
    // `h-full` bounds it against the shell; `overflow-y-auto` scrolls what does not
    // fit. Both, or neither works.
    expect(root?.className).toContain('h-full')
    expect(root?.className).toContain('overflow-y-auto')
  })

  it('still renders every task in the bank, not a truncated window of them', () => {
    // The bug looked like truncation, so this pins that the component was never
    // dropping rows - all twenty-seven were rendered and simply unreachable. A
    // future "fix" that paginates instead of scrolling would fail here.
    const { getByText } = render(
      <TaskPicker tasks={Array.from({ length: 27 }, (_, i) => task(i + 1))} onStart={() => {}} />,
    )

    expect(getByText('Task number 1')).toBeDefined()
    expect(getByText('Task number 27')).toBeDefined()
  })
})

describe('the task picker orders by chapter and shows the backlog', () => {
  it('renders chapters ascending, not in the order the bank hands them over', () => {
    // The bank's own order is by task file path, so it comes out area-then-number
    // and the chapters interleave. The book's order is a dependency order, so the
    // screen has to impose it.
    const { container } = render(
      <TaskPicker
        tasks={[task(1, 22), task(2, 3), task(3, 15)]}
        chapters={[3, 15, 22]}
        onStart={() => {}}
      />,
    )

    const headings = [...container.querySelectorAll('span')]
      .map((s) => s.textContent ?? '')
      .filter((t) => t.startsWith('Chapter '))
    expect(headings).toEqual(['Chapter 3', 'Chapter 15', 'Chapter 22'])
  })

  it('shows a chapter the book has and the bank does not, instead of skipping it', () => {
    // The gap is the deliverable: 27 tasks look finished until the screen says
    // which chapters have nothing. Chapter 12 here stands for the real ones (1,
    // 12, 16, 17, 21 at the time of writing).
    const { getByText, getAllByText } = render(
      <TaskPicker tasks={[task(1, 11), task(2, 13)]} chapters={[11, 12, 13]} onStart={() => {}} />,
    )

    expect(getByText('Chapter 12')).toBeDefined()
    expect(getAllByText('no task yet').length).toBe(1)
    expect(getByText(/2 tasks across 2 chapters/)).toBeDefined()
    expect(getByText(/1 chapter has no task yet \(12\)/)).toBeDefined()
  })

  it('does not offer an empty chapter as something to start', () => {
    // A backlog row must not be a button. If it were, clicking it would either
    // select an id that does not exist or silently do nothing, and both read as a
    // broken screen rather than as an honest gap.
    const { container } = render(
      <TaskPicker tasks={[task(1, 11)]} chapters={[11, 12]} onStart={() => {}} />,
    )

    // Four mode cards, one task row, that row's own Start. No seventh button for
    // chapter 12.
    expect(container.querySelectorAll('button').length).toBe(6)
  })

  it('falls back to the chapters the tasks name when the server sent no corpus', () => {
    // `chapters: []` means "this server has no book extracted", which is not the
    // same claim as "no chapters exist". Grouping still has to work, and the
    // backlog sentence has to stay off the screen rather than reporting zero
    // chapters covered.
    const { getByText, queryByText } = render(
      <TaskPicker tasks={[task(1, 13), task(2, 4)]} chapters={[]} onStart={() => {}} />,
    )

    expect(getByText('Chapter 4')).toBeDefined()
    expect(getByText('Chapter 13')).toBeDefined()
    expect(queryByText('no task yet')).toBeNull()
    expect(getByText(/2 tasks across 2 chapters/)).toBeDefined()
  })

  it('defaults the selection to the first task in chapter order, not the first given', () => {
    // Pressing Start without choosing should begin at the earliest chapter the
    // bank covers. The first element of `tasks` is chapter 22 here, so a default
    // of `tasks[0]` would start the student three-quarters of the way through the
    // book.
    const started: string[] = []
    const { getByText } = render(
      <TaskPicker
        tasks={[task(1, 22), task(2, 3)]}
        chapters={[3, 22]}
        onStart={(id) => started.push(id)}
      />,
    )

    fireEvent.click(getByText('Start'))
    expect(started).toEqual(['storage/002-task'])
  })
})

describe('Start sits on the row it starts', () => {
  // The scroller above makes the bottom of the page *reachable*; it does not make it
  // a sensible place to keep the button. With twenty-seven tasks, starting the first
  // one meant scrolling to the bottom and back, and the trip back was the worse half
  // - by then the screen no longer showed which task was about to run. These pin the
  // placement, because a later tidy-up that collects the button back into a footer
  // would reintroduce exactly that.

  const rowOf = (el: Element | null): Element | null => el?.closest('li') ?? null

  it('renders exactly one Start, on the selected row', () => {
    const { container, getByText, getAllByText } = render(
      <TaskPicker tasks={[task(1, 4), task(2, 9)]} chapters={[4, 9]} onStart={() => {}} />,
    )

    expect(getAllByText('Start')).toHaveLength(1)
    // Same `li` as the selected task's title - not a footer, not the chapter
    // heading, not the other row.
    expect(rowOf(getByText('Start'))).toBe(rowOf(getByText('Task number 1')))
    // And nothing after the list: the last button in the document belongs to a row.
    const buttons = [...container.querySelectorAll('button')]
    expect(rowOf(buttons[buttons.length - 1] ?? null)).not.toBeNull()
  })

  it('moves Start to whichever row is selected, and starts that one', () => {
    const started: Array<[string, string]> = []
    const { getByText } = render(
      <TaskPicker
        tasks={[task(1, 4), task(2, 9)]}
        chapters={[4, 9]}
        onStart={(id, mode) => started.push([id, mode])}
      />,
    )

    fireEvent.click(getByText('Task number 2'))
    expect(rowOf(getByText('Start'))).toBe(rowOf(getByText('Task number 2')))

    fireEvent.click(getByText('Start'))
    // The id of the row the button is on, and the mode still comes from the cards
    // above - `practice` is the default.
    expect(started).toEqual([['storage/002-task', 'practice']])
  })

  it('reports the revert on the row and refuses a second press while it runs', () => {
    const started: string[] = []
    const { getByText, queryByText } = render(
      <TaskPicker
        tasks={[task(1, 4)]}
        chapters={[4]}
        busy
        onStart={(id) => started.push(id)}
      />,
    )

    // The busy label replaces Start where the click was, rather than fifteen seconds
    // of nothing happening in the corner of the screen the student is not looking at.
    expect(queryByText('Start')).toBeNull()
    const button = getByText('reverting...')
    fireEvent.click(button)
    expect(started).toEqual([])
  })

  it('shows a failed start beside the row, not at the bottom of the page', () => {
    // `error` is the response to pressing Start, so it belongs where Start is. The
    // old layout put it above a footer button, which is off-screen for every row
    // except the last few.
    const { container, getByText } = render(
      <TaskPicker
        tasks={[task(1, 4), task(2, 9)]}
        chapters={[4, 9]}
        error="the guest is not reachable"
        onStart={() => {}}
      />,
    )

    const list = container.querySelector('ul')
    expect(list).not.toBeNull()
    expect(list?.contains(getByText('the guest is not reachable'))).toBe(true)
  })

  it('still shows an error when nothing is selected, because then there is no row', () => {
    // This is the list itself failing to load - `Lab` sets the same `error` from
    // `api.tasks()`. With no rows, an error that only renders beside a row would
    // leave the student on an empty screen with no explanation.
    const { getByText } = render(<TaskPicker tasks={[]} error="corpus not loaded" onStart={() => {}} />)

    expect(getByText('corpus not loaded')).toBeDefined()
  })
})
