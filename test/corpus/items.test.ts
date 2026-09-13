import { describe, expect, it } from 'vitest'
import { ContentError } from '../../src/engine/content/errors.ts'
import {
  headingTitle,
  parseCorpusItems,
  parseSignal,
  type ExpectedFileShape,
} from '../../src/engine/corpus/items.ts'

// Every rule in items.ts exists to make one specific bad regeneration loud, so
// every rule is tested by planting exactly that regeneration and requiring the
// message to name the field. A validator whose rejections nobody has read is a
// validator that rejects the wrong things.

const R9_EX: ExpectedFileShape = { edition: 'r9', kind: 'exercise' }
const R9_LAB: ExpectedFileShape = { edition: 'r9', kind: 'lab' }

/**
 * A well-formed exercise entry, with `over` applied last. `text` follows `id`
 * unless it is overridden, so a test that changes the id is not also, silently,
 * testing the heading-line rule.
 */
function exercise(over: Record<string, unknown> = {}): Record<string, unknown> {
  const id = typeof over.id === 'string' ? over.id : 'Exercise 15-1'
  return {
    kind: 'exercise',
    chapter: 15,
    edition: 'r9',
    text: `${id} Creating a Physical Volume\n 1. Open a root shell.`,
    ...over,
    id,
  }
}

function problemsOf(fn: () => unknown): string[] {
  try {
    fn()
  } catch (error) {
    if (error instanceof ContentError) return error.problems
    throw error
  }
  throw new Error('expected a ContentError, none was thrown')
}

describe('parseCorpusItems', () => {
  it('returns the items of a well-formed file', () => {
    const items = parseCorpusItems([exercise()], 'r9/exercises.json', R9_EX)

    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('Exercise 15-1')
    expect(items[0]?.chapter).toBe(15)
    expect(items[0]?.edition).toBe('r9')
    expect(items[0]?.kind).toBe('exercise')
    expect(items[0]?.text).toMatch(/Open a root shell/)
  })

  it('rejects a file that is not an array', () => {
    expect(problemsOf(() => parseCorpusItems({ items: [] }, 'r9/exercises.json', R9_EX))).toEqual([
      'file must contain a JSON array of corpus items',
    ])
  })

  it('rejects an empty file, because guided mode over an empty list offers nothing', () => {
    // The failure this module was written for: valid JSON, zero content, no error
    // anywhere downstream. The message must send the reader to the extractor.
    const problems = problemsOf(() => parseCorpusItems([], 'r9/exercises.json', R9_EX))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/contains no items/)
    expect(problems[0]).toMatch(/scripts\/extract-corpus\.ts/)
  })

  it('names the file in the error, so a five-file corpus reports which one broke', () => {
    let caught: unknown
    try {
      parseCorpusItems([], 'r10/labs.json', R9_LAB)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ContentError)
    expect((caught as ContentError).where).toBe('r10/labs.json')
    expect((caught as ContentError).message).toMatch(/^r10\/labs\.json: 1 problem/)
  })

  it('rejects an id that is not the shape the extractor writes', () => {
    const problems = problemsOf(() =>
      parseCorpusItems([exercise({ id: 'Exercise 15.1' })], 'r9/exercises.json', R9_EX),
    )
    expect(problems.join('\n')).toMatch(/items\[0\]\.id must be a exercise id/)
    expect(problems.join('\n')).toMatch(/"Exercise 15\.1"/)
  })

  it('rejects a lab id in an exercises file and an exercise id in a labs file', () => {
    // A mis-split is the extractor's `filter((i) => i.kind === 'lab')` breaking,
    // and it must not be readable as a variation in id style.
    expect(
      problemsOf(() =>
        parseCorpusItems([exercise({ id: 'Lab 15.1' })], 'r9/exercises.json', R9_EX),
      ).join('\n'),
    ).toMatch(/id must be a exercise id/)

    expect(
      problemsOf(() =>
        parseCorpusItems(
          [{ id: 'Exercise 15-1', kind: 'lab', chapter: 15, edition: 'r9', text: 'Exercise 15-1' }],
          'r9/labs.json',
          R9_LAB,
        ),
      ).join('\n'),
    ).toMatch(/id must be a lab id/)
  })

  it('rejects a kind or an edition that disagrees with the path', () => {
    const problems = problemsOf(() =>
      parseCorpusItems([exercise({ kind: 'lab', edition: 'r10' })], 'r9/exercises.json', R9_EX),
    )
    expect(problems).toContain('items[0].kind must be "exercise", got "lab"')
    expect(problems).toContain('items[0].edition must be "r9", got "r10"')
  })

  it('rejects an unknown edition tag as well as the wrong known one', () => {
    expect(
      problemsOf(() =>
        parseCorpusItems([exercise({ edition: 'rhel9' })], 'r9/exercises.json', R9_EX),
      ),
    ).toContain('items[0].edition must be "r9", got "rhel9"')
  })

  it('rejects a chapter that contradicts the id', () => {
    // Both are derived from one capture group in the extractor, so a disagreement
    // is not a typo in the data, it is the extractor having changed shape.
    expect(
      problemsOf(() => parseCorpusItems([exercise({ chapter: 14 })], 'r9/exercises.json', R9_EX)),
    ).toContain('items[0].chapter is 14 but its id Exercise 15-1 says chapter 15')
  })

  it('rejects a chapter outside 1-28', () => {
    const problems = problemsOf(() =>
      parseCorpusItems(
        [exercise({ id: 'Exercise 29-1', chapter: 29 })],
        'r9/exercises.json',
        R9_EX,
      ),
    )
    expect(problems.join('\n')).toMatch(/chapter must be an integer 1-28, got 29/)
  })

  it('rejects a non-integer chapter without also claiming it contradicts the id', () => {
    const problems = problemsOf(() =>
      parseCorpusItems([exercise({ chapter: 15.5 })], 'r9/exercises.json', R9_EX),
    )
    expect(problems).toEqual(['items[0].chapter must be an integer 1-28, got 15.5'])
  })

  it('rejects a body that does not start with its own heading line', () => {
    // The invariant `guided/select.ts` reads the title from. If it stops holding,
    // titles silently become the first words of prose.
    const problems = problemsOf(() =>
      parseCorpusItems(
        [exercise({ text: '1. Open a root shell.\n2. Type pvcreate /dev/sdb1.' })],
        'r9/exercises.json',
        R9_EX,
      ),
    )
    expect(problems.join('\n')).toMatch(/text must begin with the heading line "Exercise 15-1"/)
  })

  it('rejects an empty body', () => {
    expect(
      problemsOf(() => parseCorpusItems([exercise({ text: '   ' })], 'r9/exercises.json', R9_EX)),
    ).toContain('items[0].text must be a non-empty string')
  })

  it('rejects an exercise whose heading has no title, and accepts a lab that has none', () => {
    // Measured over the real corpus: 180/180 exercise headings carry a title and
    // 58/58 lab headings do not, so the rule is per kind rather than global.
    expect(
      problemsOf(() =>
        parseCorpusItems([exercise({ text: 'Exercise 15-1\n 1. Open a root shell.' })], 'f', R9_EX),
      ),
    ).toContain('items[0]: exercise Exercise 15-1 has no title after its id on the heading line')

    const labs = parseCorpusItems(
      [{ id: 'Lab 15.1', kind: 'lab', chapter: 15, edition: 'r9', text: 'Lab 15.1\nCreate an LV.' }],
      'r9/labs.json',
      R9_LAB,
    )
    expect(labs[0]?.id).toBe('Lab 15.1')
  })

  it('rejects a duplicate id', () => {
    expect(
      problemsOf(() => parseCorpusItems([exercise(), exercise()], 'r9/exercises.json', R9_EX)),
    ).toContain('items[1]: duplicate id Exercise 15-1')
  })

  it('rejects an entry that is not an object, and keeps checking the rest', () => {
    const problems = problemsOf(() =>
      parseCorpusItems(['Exercise 15-1', exercise({ chapter: 2 })], 'r9/exercises.json', R9_EX),
    )
    expect(problems[0]).toBe('items[0] must be a JSON object')
    expect(problems[1]).toMatch(/items\[1\]\.chapter is 2/)
  })

  it('reports every problem in the file in one throw', () => {
    // The whole reason for reusing ContentError: one run of the loader should be
    // enough to fix a bad regeneration, not one run per defect.
    const problems = problemsOf(() =>
      parseCorpusItems(
        [
          exercise({ id: 'nonsense' }),
          exercise({ id: 'Exercise 15-2', chapter: 3 }),
          exercise({ id: 'Exercise 15-3', edition: 'r10' }),
        ],
        'r9/exercises.json',
        R9_EX,
      ),
    )
    expect(problems).toEqual([
      expect.stringMatching(/items\[0\]\.id must be a exercise id/),
      'items[1].chapter is 3 but its id Exercise 15-2 says chapter 15',
      'items[2].edition must be "r9", got "r10"',
    ])
  })
})

describe('headingTitle', () => {
  it('returns the heading text after the id', () => {
    expect(headingTitle('Exercise 15-1', 'Exercise 15-1 Creating a Physical Volume\n 1. Go.')).toBe(
      'Creating a Physical Volume',
    )
  })

  it('drops the colon the book prints in Exercise 12-1 but nowhere else', () => {
    expect(headingTitle('Exercise 12-1', 'Exercise 12-1: Using Systemd Timers\n 1. Go.')).toBe(
      'Using Systemd Timers',
    )
  })

  it('keeps punctuation that is part of the title', () => {
    // Two real titles, from chapters 13 and 19. A blanket punctuation strip would
    // damage both.
    expect(headingTitle('Exercise 13-4', 'Exercise 13-4 Changing rsyslog.conf Rules')).toBe(
      'Changing rsyslog.conf Rules',
    )
    expect(headingTitle('Exercise 19-4', 'Exercise 19-4 Using if ... then ... else')).toBe(
      'Using if ... then ... else',
    )
  })

  it('is empty for a bare lab heading', () => {
    expect(headingTitle('Lab 15.1', 'Lab 15.1\nCreate a volume group.')).toBe('')
  })
})

describe('parseSignal', () => {
  it('reads the map and reorders each list so the primary edition leads', () => {
    // The file stores editions alphabetically, which puts r10 first because
    // '1' < '9'. Every ordering the guided layer produces depends on this fix.
    const signal = parseSignal({ 'Exercise 15-2': ['r10', 'r9'] }, 'signal.json')
    expect(signal.get('Exercise 15-2')).toEqual(['r9', 'r10'])
  })

  it('keeps a single-edition entry as it is', () => {
    expect(parseSignal({ 'Exercise 9-4': ['r10'] }, 'signal.json').get('Exercise 9-4')).toEqual([
      'r10',
    ])
  })

  it('rejects a file that is not an object', () => {
    expect(problemsOf(() => parseSignal([['Exercise 15-2', ['r9']]], 'signal.json'))).toEqual([
      'file must contain a JSON object of id to edition list',
    ])
  })

  it('rejects an empty signal', () => {
    const problems = problemsOf(() => parseSignal({}, 'signal.json'))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/records no items/)
    expect(problems[0]).toMatch(/scripts\/extract-corpus\.ts/)
  })

  it('rejects an empty or non-array edition list', () => {
    expect(problemsOf(() => parseSignal({ 'Exercise 15-2': [] }, 'signal.json'))).toEqual([
      'Exercise 15-2 must map to a non-empty array of edition tags',
    ])
    expect(problemsOf(() => parseSignal({ 'Exercise 15-2': 'r9' }, 'signal.json'))).toEqual([
      'Exercise 15-2 must map to a non-empty array of edition tags',
    ])
  })

  it('rejects an unknown edition tag', () => {
    expect(problemsOf(() => parseSignal({ 'Exercise 15-2': ['r9', 'r11'] }, 'signal.json'))).toEqual(
      ['Exercise 15-2 lists an unknown edition "r11"'],
    )
  })

  it('rejects the same edition twice, which would double-count the pairing signal', () => {
    expect(problemsOf(() => parseSignal({ 'Exercise 15-2': ['r9', 'r9'] }, 'signal.json'))).toEqual([
      'Exercise 15-2 lists edition r9 twice',
    ])
  })

  it('reports every bad entry in one throw', () => {
    const problems = problemsOf(() =>
      parseSignal({ a: ['r9', 'r11'], b: [], c: ['r10', 'r10'] }, 'signal.json'),
    )
    expect(problems).toHaveLength(3)
  })
})
