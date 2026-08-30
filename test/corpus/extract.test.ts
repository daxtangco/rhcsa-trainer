import { describe, expect, it } from 'vitest'
import { findItems, weightSignal } from '../../scripts/extract-corpus.ts'

const SAMPLE = [
  'Chapter 15. Managing Advanced Storage',
  'some prose about volume groups',
  '',
  'Exercise 15-1 Creating a volume group',
  '1. Open a root shell.',
  '2. Run vgcreate vgdata /dev/sdb.',
  '',
  'Exercise 15-2 Extending a logical volume',
  '1. Run lvextend -L 6G /dev/vgdata/lvdata.',
  '',
  'Lab 15.1  Managing logical volumes',
  'Create a volume group and a 6 GB logical volume.',
  '',
  'Chapter 16. Managing Autofs',
  'Exercise 16-1 Configuring autofs',
  '1. Install autofs.',
].join('\n')

describe('findItems', () => {
  it('finds exercises with their chapter and body', () => {
    const items = findItems(SAMPLE, 'r9')
    const ex = items.filter((i) => i.kind === 'exercise')

    expect(ex.map((i) => i.id)).toEqual(['Exercise 15-1', 'Exercise 15-2', 'Exercise 16-1'])
    expect(ex[0]?.chapter).toBe(15)
    expect(ex[0]?.text).toMatch(/vgcreate vgdata/)
    expect(ex[2]?.chapter).toBe(16)
    expect(ex[0]?.edition).toBe('r9')
  })

  it('finds labs and tolerates the double space the layout extraction leaves', () => {
    const items = findItems(SAMPLE, 'r9')
    const labs = items.filter((i) => i.kind === 'lab')

    expect(labs.map((i) => i.id)).toEqual(['Lab 15.1'])
    expect(labs[0]?.chapter).toBe(15)
    expect(labs[0]?.text).toMatch(/6 GB logical volume/)
  })

  it('stops an item body at the next heading rather than swallowing the chapter', () => {
    const items = findItems(SAMPLE, 'r9')
    const first = items.find((i) => i.id === 'Exercise 15-1')
    expect(first?.text).not.toMatch(/Extending a logical volume/)
  })

  it('deduplicates ids that appear in both a table of contents and the body', () => {
    // Every lab and exercise id appears at least twice: once in the contents
    // listing and once at the real heading. The longest body wins, because the
    // contents entry is a single line.
    const withToc = ['Exercise 15-1 Creating a volume group', '', SAMPLE].join('\n')
    const ids = findItems(withToc, 'r9')
      .filter((i) => i.kind === 'exercise')
      .map((i) => i.id)
    expect(ids).toEqual(['Exercise 15-1', 'Exercise 15-2', 'Exercise 16-1'])
  })

  it('keeps the real (longer) body rather than the one-line contents entry when deduplicating', () => {
    // Mandate 3: the id-list assertion above passes even if the "first match
    // wins" rule were substituted for "longest body wins" — this test pins
    // the actual surviving content, not just the id ordering.
    const withToc = ['Exercise 15-1 Creating a volume group', '', SAMPLE].join('\n')
    const items = findItems(withToc, 'r9').filter((i) => i.kind === 'exercise')
    const winner = items.find((i) => i.id === 'Exercise 15-1')
    expect(winner?.text).toMatch(/vgcreate vgdata/)
    expect(winner?.text).not.toBe('Exercise 15-1 Creating a volume group')
  })

  it('terminates a body at RHCSA 9\'s bare form-feed chapter opening, not just at the dotted form', () => {
    // Mandate 2: RHCSA 9's real body chapters open as a form feed, a bare
    // "Chapter N" alone on the line, a blank line, then the title — which the
    // brief's dotted-only CHAPTER_RE never matches. Here there is no
    // subsequent Lab/Exercise heading at all, so only the chapter terminator
    // (not the next-heading bound) can stop the body before end of input.
    const r9Body = [
      'Exercise 15-1 Creating a volume group',
      '1. Open a root shell.',
      '2. Run vgcreate vgdata /dev/sdb.',
      '',
      '\fChapter 16',
      '',
      'Managing Autofs',
      'This prose belongs to chapter 16 and must not leak into exercise 15-1.',
    ].join('\n')

    const items = findItems(r9Body, 'r9')
    const ex = items.find((i) => i.id === 'Exercise 15-1')
    expect(ex?.text).toMatch(/vgcreate vgdata/)
    expect(ex?.text).not.toMatch(/must not leak/)
  })

  it('caps a body at MAX_BODY_LINES when no heading or chapter line ever terminates it', () => {
    // Mandate 4: nothing here bounds the body except the line cap — no next
    // heading, no chapter line, well past 120 lines of filler.
    const filler = Array.from({ length: 200 }, (_, n) => `filler line ${n}`)
    const capped = ['Exercise 20-1 Some exercise', ...filler].join('\n')

    const items = findItems(capped, 'r9')
    const ex = items.find((i) => i.id === 'Exercise 20-1')
    const lineCount = ex?.text.split('\n').length ?? 0
    // Heading line + 120 filler lines (indices 0-119) = 121, not the full 201.
    expect(lineCount).toBe(121)
    expect(ex?.text).not.toMatch(/filler line 199/)
  })

  it('trims leading whitespace from an indented heading and trailing whitespace from the body', () => {
    // Fix-1 F1: the body is joined and then `.replace(...).trim()`'d, but
    // nothing asserted on either boundary — a heading matched via the
    // regexes' `\s*` tolerance keeps its leading indentation, and a body
    // ending right before end-of-input keeps its trailing blank lines,
    // unless `.trim()` actually runs.
    const indented = ['   Exercise 22-1 Some description', '1. Do the first step.', '2. Do the second step.', '', ''].join(
      '\n',
    )

    const items = findItems(indented, 'r9')
    const ex = items.find((i) => i.id === 'Exercise 22-1')
    expect(ex?.text.startsWith('Exercise 22-1 Some description')).toBe(true)
    expect(ex?.text.endsWith('step.')).toBe(true)
  })

  it('collapses three or more consecutive blank lines inside a body to a single blank line', () => {
    // Fix-1 F1: distinct from the trim test above — this run of blank lines
    // sits between two real content lines, so only `.replace(/\n{3,}/g, ...)`
    // (not `.trim()`, which only touches the ends) can collapse it.
    const blankRun = [
      'Exercise 23-1 First step',
      'line one of body.',
      '',
      '',
      '',
      '',
      'line two of body, after several blank lines.',
      'Exercise 23-2 Next exercise',
      'body of next exercise.',
    ].join('\n')

    const items = findItems(blankRun, 'r9')
    const ex = items.find((i) => i.id === 'Exercise 23-1')
    expect(ex?.text).not.toMatch(/\n{3,}/)
    expect(ex?.text).toContain('of body.\n\nline two')
  })

  it('returns items sorted by id even when headings appear out of order in the source text', () => {
    // Fix-1 F2: every existing fixture's headings happen to already appear in
    // id order in the source, so the final `.sort(...)` in findItems could be
    // deleted without any test noticing. Here the source order is reversed.
    const outOfOrder = [
      'Exercise 24-2 This appears first in the source text',
      'body of exercise two.',
      '',
      'Exercise 24-1 This appears second in the source text',
      'body of exercise one.',
    ].join('\n')

    const items = findItems(outOfOrder, 'r9').filter((i) => i.kind === 'exercise')
    expect(items.map((i) => i.id)).toEqual(['Exercise 24-1', 'Exercise 24-2'])
  })
})

describe('weightSignal', () => {
  it('records which editions contain each item', () => {
    const items = [
      ...findItems(SAMPLE, 'r9'),
      ...findItems('Chapter 15. x\nExercise 15-1 Creating a volume group\n1. Do it.', 'r10'),
    ]
    const signal = weightSignal(items)

    // Present in both editions: durable core RHCSA material.
    expect(signal['Exercise 15-1']).toEqual(['r10', 'r9'])
    // Present in one: version-specific.
    expect(signal['Lab 15.1']).toEqual(['r9'])
  })
})
