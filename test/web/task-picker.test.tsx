// @vitest-environment jsdom
//
// One assertion, and it is a class-name assertion, which nothing else in
// `test/web/` does. The reason is that the defect it pins is a *layout* defect and
// jsdom has no layout: `offsetHeight` and `scrollHeight` are both 0 for everything,
// so "is the Start button reachable" cannot be asked here. The class is the only
// mechanical trace the fix leaves.
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
import { render } from '@testing-library/react'
import type { TaskSummary } from '../../src/web/api.ts'
import { TaskPicker } from '../../src/web/components/TaskPicker.tsx'

const task = (n: number): TaskSummary => ({
  id: `storage/${String(n).padStart(3, '0')}-task`,
  title: `Task number ${n}`,
  chapter: 15,
  scope: 'exam-objective',
  rebootCheck: false,
  timeBudget: 900,
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
