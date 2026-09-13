import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ContentError } from '../../src/engine/content/errors.ts'
import { loadCorpus } from '../../src/engine/corpus/corpus.ts'
import type { CorpusItem, Edition } from '../../src/engine/corpus/items.ts'

// `loadCorpus` is tested against corpora written to a temp directory rather than
// against checked-in fixtures, because most of what it does is notice
// *disagreements between five files*, and a fixture set expressing every
// disagreement would be twenty files whose defect is only visible by diffing them.
// Here the plant sits next to the assertion. `test/corpus/corpus-real.test.ts`
// covers the other direction, against the real corpus.

const temps: string[] = []

afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

interface CorpusFiles {
  r9?: { labs?: unknown; exercises?: unknown }
  r10?: { labs?: unknown; exercises?: unknown }
  /** `null` writes no signal file at all; `string` writes it verbatim, for bad JSON. */
  signal?: unknown
}

function ex(id: string, edition: Edition, chapter: number, title = 'Doing Something'): CorpusItem {
  return {
    id,
    kind: 'exercise',
    chapter,
    edition,
    text: `${id} ${title}\n 1. Open a root shell.\n 2. Type pvs to list physical volumes.`,
  }
}

function lab(id: string, edition: Edition, chapter: number): CorpusItem {
  return { id, kind: 'lab', chapter, edition, text: `${id}\nCreate a logical volume.` }
}

/** The corpus every test below starts from: two chapters, both kinds, one slot per group. */
function baseline(): CorpusFiles {
  return {
    r9: {
      labs: [lab('Lab 15.1', 'r9', 15), lab('Lab 26.1', 'r9', 26)],
      exercises: [ex('Exercise 15-1', 'r9', 15), ex('Exercise 15-2', 'r9', 15)],
    },
    r10: {
      labs: [lab('Lab 15.1', 'r10', 15)],
      exercises: [ex('Exercise 15-2', 'r10', 15), ex('Exercise 16-1', 'r10', 16)],
    },
    signal: {
      'Lab 15.1': ['r10', 'r9'],
      'Lab 26.1': ['r9'],
      'Exercise 15-1': ['r9'],
      'Exercise 15-2': ['r10', 'r9'],
      'Exercise 16-1': ['r10'],
    },
  }
}

async function write(files: CorpusFiles): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rhcsa-corpus-'))
  temps.push(root)

  for (const edition of ['r9', 'r10'] as const) {
    const dir = join(root, edition)
    await mkdir(dir, { recursive: true })
    const group = files[edition]
    for (const [name, value] of [
      ['labs', group?.labs],
      ['exercises', group?.exercises],
    ] as const) {
      if (value === undefined) continue
      const body = typeof value === 'string' ? value : JSON.stringify(value)
      await writeFile(join(dir, `${name}.json`), body)
    }
  }

  if (files.signal !== undefined) {
    const body = typeof files.signal === 'string' ? files.signal : JSON.stringify(files.signal)
    await writeFile(join(root, 'signal.json'), body)
  }

  return root
}

async function problemsOf(files: CorpusFiles): Promise<string[]> {
  const root = await write(files)
  const error = await loadCorpus(root).then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(ContentError)
  const contentError = error as ContentError
  expect(contentError.where).toBe(root)
  return contentError.problems
}

describe('loadCorpus', () => {
  it('loads all five files and indexes them', async () => {
    const corpus = await loadCorpus(await write(baseline()))

    expect(corpus.items).toHaveLength(7)
    expect(corpus.byId.size).toBe(5)
    expect(corpus.editionsById.size).toBe(5)
  })

  it('sorts items by numeric id, then primary edition first', async () => {
    // Numeric collation, not lexicographic: `Exercise 9-1` must precede
    // `Exercise 15-1`, and r9 must precede r10 within a slot even though 'r10'
    // sorts first alphabetically.
    const corpus = await loadCorpus(
      await write({
        r9: {
          labs: [lab('Lab 15.1', 'r9', 15)],
          exercises: [ex('Exercise 15-1', 'r9', 15), ex('Exercise 9-1', 'r9', 9)],
        },
        r10: { labs: [lab('Lab 15.1', 'r10', 15)], exercises: [ex('Exercise 15-1', 'r10', 15)] },
        signal: {
          'Lab 15.1': ['r9', 'r10'],
          'Exercise 9-1': ['r9'],
          'Exercise 15-1': ['r9', 'r10'],
        },
      }),
    )
    expect(corpus.items.map((i) => `${i.id}/${i.edition}`)).toEqual([
      'Exercise 9-1/r9',
      'Exercise 15-1/r9',
      'Exercise 15-1/r10',
      'Lab 15.1/r9',
      'Lab 15.1/r10',
    ])
    expect(corpus.byId.get('Exercise 15-1')?.map((i) => i.edition)).toEqual(['r9', 'r10'])
  })

  it('indexes exercises by chapter and leaves labs out of that index', async () => {
    // Spec section 2 assigns labs to graded prompts and exercises to guided
    // walkthroughs. A lab reachable from the guided index would be the wrong
    // feature reading the wrong half of the corpus.
    const corpus = await loadCorpus(await write(baseline()))

    expect([...corpus.exerciseIdsByChapter.keys()].sort((a, b) => a - b)).toEqual([15, 16])
    expect(corpus.exerciseIdsByChapter.get(15)).toEqual(['Exercise 15-1', 'Exercise 15-2'])
    expect(corpus.exerciseIdsByChapter.get(16)).toEqual(['Exercise 16-1'])
    expect(corpus.exerciseIdsByChapter.get(26)).toBeUndefined()
  })

  it('orders each chapter numerically rather than lexicographically', async () => {
    const corpus = await loadCorpus(
      await write({
        r9: {
          labs: [lab('Lab 2.1', 'r9', 2)],
          exercises: [
            ex('Exercise 2-10', 'r9', 2),
            ex('Exercise 2-2', 'r9', 2),
            ex('Exercise 2-1', 'r9', 2),
          ],
        },
        r10: { labs: [lab('Lab 2.1', 'r10', 2)], exercises: [ex('Exercise 2-1', 'r10', 2)] },
        signal: {
          'Lab 2.1': ['r9', 'r10'],
          'Exercise 2-1': ['r9', 'r10'],
          'Exercise 2-2': ['r9'],
          'Exercise 2-10': ['r9'],
        },
      }),
    )
    expect(corpus.exerciseIdsByChapter.get(2)).toEqual([
      'Exercise 2-1',
      'Exercise 2-2',
      'Exercise 2-10',
    ])
  })

  it('reads signal.json primary-edition-first even though the file stores it alphabetically', async () => {
    const corpus = await loadCorpus(await write(baseline()))
    expect(corpus.editionsById.get('Exercise 15-2')).toEqual(['r9', 'r10'])
    expect(corpus.editionsById.get('Exercise 16-1')).toEqual(['r10'])
  })

  it('names a missing file rather than throwing a bare ENOENT', async () => {
    const files = baseline()
    delete files.r10?.exercises
    const problems = await problemsOf(files)

    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/r10\/exercises\.json/)
    expect(problems[0]).toMatch(/ENOENT|no such file/)
  })

  it('names a file whose JSON does not parse', async () => {
    const files = baseline()
    if (files.r9) files.r9.labs = '[{"id": "Lab 15.1",'
    const problems = await problemsOf(files)

    expect(problems.some((p) => p.includes('r9/labs.json') && /JSON/i.test(p))).toBe(true)
  })

  it('names a missing signal.json, and refuses to return a corpus without it', async () => {
    const files = baseline()
    delete files.signal
    const problems = await problemsOf(files)

    expect(problems.some((p) => p.includes('signal.json'))).toBe(true)
  })

  it('reports an empty item file with the file path in front of the message', async () => {
    const files = baseline()
    if (files.r9) files.r9.exercises = []
    const problems = await problemsOf(files)

    expect(problems.some((p) => /r9\/exercises\.json.*contains no items/.test(p))).toBe(true)
  })

  it('reports problems from every bad file at once', async () => {
    const files = baseline()
    if (files.r9) files.r9.exercises = []
    if (files.r10) files.r10.labs = []
    const problems = await problemsOf(files)

    expect(problems.some((p) => p.includes('r9/exercises.json'))).toBe(true)
    expect(problems.some((p) => p.includes('r10/labs.json'))).toBe(true)
  })

  describe('the signal cross-check', () => {
    it('catches a slot the signal does not mention', async () => {
      // A signal from an older, smaller extraction run. Guided mode reads the
      // signal, so this is the stale-file failure the check exists for.
      const files = baseline()
      const signal = { ...(files.signal as Record<string, string[]>) }
      delete signal['Exercise 16-1']
      files.signal = signal

      const problems = await problemsOf(files)
      expect(problems).toEqual([
        expect.stringMatching(/signal\.json: no entry for Exercise 16-1, which r10 contains/),
      ])
    })

    it('catches a slot the signal records with the wrong editions', async () => {
      const files = baseline()
      files.signal = { ...(files.signal as object), 'Exercise 15-2': ['r9'] }

      const problems = await problemsOf(files)
      expect(problems).toEqual([
        expect.stringMatching(
          /signal\.json: Exercise 15-2 is recorded as \[r9\] but the item files contain it in \[r9, r10\]/,
        ),
      ])
    })

    it('catches a slot the signal records that no item file contains', async () => {
      // The opposite direction, and not redundant: this one is invisible from the
      // items' side, because nothing there ever mentions the extra id.
      const files = baseline()
      files.signal = { ...(files.signal as object), 'Exercise 27-1': ['r9', 'r10'] }

      const problems = await problemsOf(files)
      expect(problems).toEqual([
        expect.stringMatching(
          /signal\.json: records Exercise 27-1, which no edition's item file contains/,
        ),
      ])
    })

    it('stays quiet when an item file failed, so the real error is not buried', async () => {
      // Without the guard, one unreadable file produces a "no entry for" line for
      // every item the signal knows about, and the reason the load failed is on
      // page two.
      const files = baseline()
      if (files.r9) files.r9.exercises = 'not json at all'
      const problems = await problemsOf(files)

      expect(problems.some((p) => p.includes('r9/exercises.json'))).toBe(true)
      expect(problems.filter((p) => /no entry for|records .*which no edition/.test(p))).toEqual([])
    })
  })
})
