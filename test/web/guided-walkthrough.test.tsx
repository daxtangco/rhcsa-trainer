// @vitest-environment jsdom
//
// The typing gate of spec section 9.1, driven step by step. Behavioural: every
// assertion here is about what the student can and cannot get past, because the
// two ways this component can be wrong are both invisible in a snapshot - a step
// that advances without the command being typed, and a step that can never be
// advanced at all.
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { GuidedWalkthrough } from '../../src/web/components/GuidedWalkthrough.tsx'
import type { GuidedItem, GuidedStep } from '../../src/web/api.ts'

/**
 * Three steps of the shape the corpus actually produces, and the middle one is the
 * important one: `commands: []` is not a defect, it is 347 of the 1405 parsed steps
 * (`steps.ts`, measured 2026-09-14). The text is close to real - the wording is
 * from the pattern `commandCandidates` documents.
 */
const STEPS: GuidedStep[] = [
  {
    n: 1,
    text: 'Type pvcreate /dev/sdd1 to mark the new partition as a physical volume.',
    commands: ['pvcreate /dev/sdd1'],
  },
  { n: 2, text: 'Open a root shell on server2.', commands: [] },
  { n: 3, text: 'Use vgextend vgdata /dev/sdd1 to grow the volume group.', commands: ['vgextend vgdata /dev/sdd1'] },
]

const ITEM: GuidedItem = {
  id: 'Exercise 15-2',
  chapter: 15,
  editions: ['r9', 'r10'],
  crossEdition: true,
  shown: {
    edition: 'r9',
    title: 'Creating the Volume Group and Logical Volumes',
    preamble: 'To do this exercise, you need a hard disk with free, unpartitioned space.',
    steps: STEPS,
  },
  // A different title from `shown`, which is the case for 6 of the 84
  // cross-edition slots and the reason the alternate renders its own.
  alternate: {
    edition: 'r10',
    title: 'Creating the Volume Group',
    preamble: '',
    steps: [{ n: 1, text: 'Type pvs to list the physical volumes.', commands: ['pvs'] }],
  },
}

function type(stepN: number, value: string) {
  const input = screen.getByLabelText(new RegExp(`step ${stepN}`))
  fireEvent.change(input, { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: /^Check$/ }))
}

describe('GuidedWalkthrough, the typing gate', () => {
  it('shows every step from the start, and takes input only on the current one', () => {
    // Guided mode is full disclosure by construction, so the tail is visible; the
    // gate is on input, not on sight. Hiding the later steps would be withholding
    // in the one mode that withholds nothing.
    render(<GuidedWalkthrough item={ITEM} />)
    expect(screen.getByText(/mark the new partition/)).toBeDefined()
    expect(screen.getByText(/Open a root shell/)).toBeDefined()
    expect(screen.getByText(/grow the volume group/)).toBeDefined()

    expect(screen.getByLabelText(/step 1/)).toBeDefined()
    expect(screen.queryByLabelText(/step 3/)).toBeNull()
  })

  it('shows the preamble, because it is usually the precondition', () => {
    render(<GuidedWalkthrough item={ITEM} />)
    expect(screen.getByText(/free, unpartitioned space/)).toBeDefined()
  })

  it('refuses a wrong line and does not advance', () => {
    render(<GuidedWalkthrough item={ITEM} />)
    type(1, 'pvcreate /dev/sdc1')
    expect(screen.getByText(/Not that line yet/)).toBeDefined()
    // Still on step 1: step 2 is the acknowledge-only step, so its button
    // appearing is the signal that the gate opened.
    expect(screen.getByLabelText(/step 1/)).toBeDefined()
    expect(screen.queryByRole('button', { name: /Done, next step/ })).toBeNull()
  })

  it('refuses the same command in the wrong case', () => {
    // The reason `typedStepMatches` is imported rather than reimplemented. Its
    // docblock: "`LS` is not `ls`, and a guided mode that accepted it would be
    // teaching the student a habit the exam fails them for." A loosened matcher
    // in the web layer would pass every other test in this file.
    render(<GuidedWalkthrough item={ITEM} />)
    type(1, 'PVCREATE /dev/sdd1')
    expect(screen.getByText(/Not that line yet/)).toBeDefined()
    expect(screen.queryByRole('button', { name: /Done, next step/ })).toBeNull()
  })

  it('accepts the right line with sloppy whitespace', () => {
    // The other half of the same rule: runs of spaces collapse, because
    // `lvextend  -L 6G` and `lvextend -L 6G` are the same command to bash.
    render(<GuidedWalkthrough item={ITEM} />)
    type(1, '   pvcreate    /dev/sdd1  ')
    expect(screen.getByRole('button', { name: /Done, next step/ })).toBeDefined()
    expect(screen.queryByLabelText(/step 1/)).toBeNull()
  })

  it('advances a step with no typeable command on acknowledgement alone', () => {
    // 347 of 1405 corpus steps are here, and `typedStepMatches` returns false for
    // every one of them by design. Gating them on typing makes a quarter of the
    // corpus an unpassable wall, so this asserts both halves: no input box, and a
    // button that works.
    render(<GuidedWalkthrough item={ITEM} />)
    type(1, 'pvcreate /dev/sdd1')

    expect(screen.queryByLabelText(/step 2/)).toBeNull()
    expect(screen.getByText(/No command to type in this step/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /Done, next step/ }))

    // Straight through to step 3, which types again.
    expect(screen.getByLabelText(/step 3/)).toBeDefined()
  })

  it('offers the escape hatch only after a real attempt, and it advances', () => {
    // Aimed at a measured defect, not at impatience: roughly one step in fourteen
    // carries a false command candidate, and on those the student who types what
    // the book says is correct while the matcher disagrees. Offering it before an
    // attempt would turn the exercise into a clicking exercise.
    render(<GuidedWalkthrough item={ITEM} />)
    const hatch = /prose is authoritative/
    expect(screen.queryByRole('button', { name: hatch })).toBeNull()

    type(1, 'not it')
    fireEvent.click(screen.getByRole('button', { name: hatch }))
    expect(screen.getByRole('button', { name: /Done, next step/ })).toBeDefined()

    // And it does not persist across the advance: the next step starts clean.
    fireEvent.click(screen.getByRole('button', { name: /Done, next step/ }))
    expect(screen.queryByRole('button', { name: hatch })).toBeNull()
  })

  it('closes with what was and was not verified', () => {
    render(<GuidedWalkthrough item={ITEM} />)
    type(1, 'pvcreate /dev/sdd1')
    fireEvent.click(screen.getByRole('button', { name: /Done, next step/ }))
    type(3, 'vgextend vgdata /dev/sdd1')

    expect(screen.getByText(/Walkthrough complete/)).toBeDefined()
    // The honest limit, said rather than implied: the typing was checked, the
    // machine was not.
    expect(screen.getByText(/The machine was not graded/)).toBeDefined()
  })
})

describe('GuidedWalkthrough, the two editions', () => {
  it('badges a cross-edition exercise', () => {
    render(<GuidedWalkthrough item={ITEM} />)
    expect(screen.getByText('in both editions')).toBeDefined()
  })

  it('names the single edition when the slot only exists in one', () => {
    const only: GuidedItem = {
      ...ITEM,
      editions: ['r9'],
      crossEdition: false,
    }
    delete only.alternate
    render(<GuidedWalkthrough item={only} />)
    expect(screen.queryByText('in both editions')).toBeNull()
    expect(screen.getByText('RHCSA 9 only')).toBeDefined()
    expect(screen.queryByText(/wording/)).toBeNull()
  })

  it('keeps the alternate edition behind a toggle, under its own title', () => {
    // Not interleaved, because the step counts and numbering differ between the
    // books - and titled with `alternate.title`, because for six of the 84 paired
    // slots the two books genuinely disagree and reusing the shown title would
    // mislabel them.
    render(<GuidedWalkthrough item={ITEM} />)
    expect(screen.queryByText('Creating the Volume Group')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /show the RHCSA 10 wording/ }))
    expect(screen.getByText('Creating the Volume Group')).toBeDefined()
    expect(screen.getByText(/Type pvs to list/)).toBeDefined()
    // The shown edition is untouched: this is a comparison, not a replacement.
    expect(screen.getByText('Creating the Volume Group and Logical Volumes')).toBeDefined()
    // And nothing in the alternate is typeable - one input, on the shown step.
    expect(screen.getAllByRole('textbox').length).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: /hide the RHCSA 10 wording/ }))
    expect(screen.queryByText('Creating the Volume Group')).toBeNull()
  })
})
