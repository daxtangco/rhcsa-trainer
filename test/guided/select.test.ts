import { describe, expect, it } from 'vitest'
import { ContentError } from '../../src/engine/content/errors.ts'
import type { Corpus } from '../../src/engine/corpus/corpus.ts'
import type { CorpusItem, Edition } from '../../src/engine/corpus/items.ts'
import type { Objective, ObjectiveSet } from '../../src/engine/content/objectives.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'
import {
  guidedForChapter,
  guidedForObjective,
  guidedForTask,
  guidedItem,
} from '../../src/engine/guided/select.ts'

// The `Corpus` here is built in memory rather than loaded, because what is under
// test is the selection rules and not the loader — `test/corpus/corpus.test.ts`
// owns the loader, and `test/guided/corpus-real.test.ts` runs these same functions
// against the real thing. Building it by hand also exercises the reason
// `guidedItem` re-checks the signal instead of trusting it: this is exactly the
// caller that can hand it a `Corpus` the loader would have rejected.

function ex(id: string, edition: Edition, chapter: number, title: string, steps: string[]): CorpusItem {
  const body = steps.map((s, i) => ` ${i + 1}. ${s}`).join('\n')
  return { id, kind: 'exercise', chapter, edition, text: `${id} ${title}\n\n${body}` }
}

/**
 * A lab whose body is a numbered list, because that is what a lab body is:
 * measured over the real corpus, 52 of the 58 lab instances parse into steps. So
 * "no lab is ever selected" cannot be tested with a lab that has no steps — it
 * would pass for the wrong reason, and the `kind` check could be deleted without
 * any test noticing.
 */
function lab(id: string, edition: Edition, chapter: number): CorpusItem {
  return {
    id,
    kind: 'lab',
    chapter,
    edition,
    text: `${id}\n 1. Create a volume group named vgdata.\n 2. Create a 6 GB logical volume in it.`,
  }
}

interface Slot {
  items: CorpusItem[]
  /** What signal.json says. Defaults to the editions the items are actually in. */
  signal?: Edition[]
}

function corpusOf(slots: Slot[]): Corpus {
  const items = slots.flatMap((s) => s.items)
  const byId = new Map<string, CorpusItem[]>()
  const editionsById = new Map<string, Edition[]>()
  const exerciseIdsByChapter = new Map<number, string[]>()

  for (const slot of slots) {
    const first = slot.items[0]
    if (first === undefined) continue
    byId.set(first.id, slot.items)
    editionsById.set(first.id, slot.signal ?? slot.items.map((i) => i.edition))
    if (first.kind === 'exercise') {
      const list = exerciseIdsByChapter.get(first.chapter) ?? []
      list.push(first.id)
      exerciseIdsByChapter.set(first.chapter, list)
    }
  }

  return { root: '/in-memory', items, byId, editionsById, exerciseIdsByChapter }
}

const CH15 = [
  {
    items: [
      ex('Exercise 15-1', 'r9', 15, 'Creating a Physical Volume', ['Type pvcreate /dev/sdb1.']),
      ex('Exercise 15-1', 'r10', 15, 'Creating a Physical Volume', ['Type pvcreate /dev/sdb1.']),
    ],
  },
  {
    items: [
      ex('Exercise 15-2', 'r9', 15, 'Creating the Volume Group', ['Type vgcreate vgdata /dev/sdb1.']),
      ex('Exercise 15-2', 'r10', 15, 'Creating the Volume Group', [
        'Type vgcreate vgdata /dev/sdb1.',
        'Type vgs to verify.',
      ]),
    ],
  },
  // RHCSA 9 only, like the nine container exercises of chapter 26.
  { items: [ex('Exercise 15-5', 'r9', 15, 'Using Stratis', ['Type dnf install stratisd.'])] },
  { items: [lab('Lab 15.1', 'r9', 15), lab('Lab 15.1', 'r10', 15)] },
]

const CORPUS = corpusOf(CH15)

function objective(id: string, chapters: number[]): Objective {
  return { id, text: `objective ${id}`, chapters }
}

function objectiveSet(objectives: Objective[]): ObjectiveSet {
  return {
    version: 'rhel9',
    source: 'test',
    objectives,
    byId: new Map(objectives.map((o) => [o.id, o])),
  }
}

function task(over: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: 'storage/014-grow-var',
    title: 'Grow /var',
    chapter: 26,
    scope: 'exam-objective',
    rhel: 9,
    objectives: ['storage.lvm.resize'],
    requiresConcepts: [],
    difficulty: 3,
    timeBudget: 600,
    weight: 'high',
    editions: ['r9'],
    rebootCheck: true,
    requiresDisks: 0,
    claims: [],
    transport: 'ssh',
    prompt: 'Grow it.',
    dir: '/nowhere',
    ...over,
  }
}

describe('guidedItem', () => {
  it('builds the primary edition as the walkthrough and the other as the alternate', () => {
    const item = guidedItem(CORPUS, 'Exercise 15-2')

    expect(item?.id).toBe('Exercise 15-2')
    expect(item?.chapter).toBe(15)
    expect(item?.editions).toEqual(['r9', 'r10'])
    expect(item?.crossEdition).toBe(true)
    expect(item?.shown.edition).toBe('r9')
    expect(item?.shown.title).toBe('Creating the Volume Group')
    expect(item?.shown.steps).toHaveLength(1)
    expect(item?.alternate?.edition).toBe('r10')
    expect(item?.alternate?.steps).toHaveLength(2)
  })

  it('honours primary: r10, rather than taking whichever instance is listed first', () => {
    // `byId` is ordered r9-first because that is reading order. Selecting by
    // position instead of by edition would silently ignore this option.
    const item = guidedItem(CORPUS, 'Exercise 15-2', { primary: 'r10' })

    expect(item?.shown.edition).toBe('r10')
    expect(item?.shown.steps).toHaveLength(2)
    expect(item?.alternate?.edition).toBe('r9')
  })

  it('has no alternate for a single-edition slot, and flags it as not cross-edition', () => {
    const item = guidedItem(CORPUS, 'Exercise 15-5')

    expect(item?.editions).toEqual(['r9'])
    expect(item?.crossEdition).toBe(false)
    expect(item?.alternate).toBeUndefined()
  })

  it('falls back to the other edition when the primary is the one that is missing', () => {
    // With primary r9 and an r10-only exercise there is still material to teach,
    // so the guided path degrades to less choice rather than to a blank screen.
    const item = guidedItem(
      corpusOf([{ items: [ex('Exercise 9-4', 'r10', 9, 'Managing Flatpak', ['Type flatpak list.'])] }]),
      'Exercise 9-4',
    )

    expect(item?.shown.edition).toBe('r10')
    expect(item?.crossEdition).toBe(false)
    expect(item?.alternate).toBeUndefined()
  })

  it('never returns a lab, because labs are graded-task material', () => {
    // Spec section 2's role table. The one assertion in this file that is about
    // what guided mode *is* rather than how it orders things.
    expect(guidedItem(CORPUS, 'Lab 15.1')).toBeUndefined()
  })

  it('returns undefined for an id the corpus does not have', () => {
    expect(guidedItem(CORPUS, 'Exercise 99-1')).toBeUndefined()
  })

  it('returns undefined for a slot the signal does not record', () => {
    const corpus = corpusOf([
      { items: [ex('Exercise 15-1', 'r9', 15, 'Creating a PV', ['Type pvs.'])], signal: [] },
    ])
    expect(guidedItem(corpus, 'Exercise 15-1')).toBeUndefined()
  })

  it('returns undefined when no instance parses into a step', () => {
    // The extractor's known worst case: a body that lost the dedupe race and kept
    // a one-line table-of-contents entry. It has a title, so the loader accepts
    // it; it has no steps, so there is nothing to type.
    const corpus = corpusOf([
      {
        items: [
          { id: 'Exercise 15-1', kind: 'exercise', chapter: 15, edition: 'r9', text: 'Exercise 15-1 Creating a Physical Volume' },
        ],
      },
    ])
    expect(guidedItem(corpus, 'Exercise 15-1')).toBeUndefined()
  })
})

describe('guidedForObjective', () => {
  it('returns every exercise of the objective chapters, and no lab', () => {
    const items = guidedForObjective(CORPUS, objective('storage.lvm.vg', [15]))

    expect(items.map((i) => i.id)).toEqual([
      'Exercise 15-1',
      'Exercise 15-2',
      'Exercise 15-5',
    ])
  })

  it('puts cross-edition exercises before single-edition ones', () => {
    // Section 14.4.1: in both books means durable core RHCSA material, so a
    // student working top-down meets the exam-likeliest material first.
    const items = guidedForObjective(CORPUS, objective('storage.lvm.vg', [15]))
    expect(items.map((i) => i.crossEdition)).toEqual([true, true, false])
  })

  it('puts the other edition only group last, behind the primary edition only group', () => {
    const corpus = corpusOf([
      { items: [ex('Exercise 9-1', 'r9', 9, 'Using dnf', ['Type dnf repolist.'])] },
      {
        items: [
          ex('Exercise 9-2', 'r9', 9, 'Installing Software', ['Type dnf install nmap.']),
          ex('Exercise 9-2', 'r10', 9, 'Installing Software', ['Type dnf install nmap.']),
        ],
      },
      { items: [ex('Exercise 9-4', 'r10', 9, 'Managing Flatpak', ['Type flatpak list.'])] },
    ])

    expect(guidedForObjective(corpus, objective('pkg.dnf.install', [9])).map((i) => i.id)).toEqual([
      'Exercise 9-2',
      'Exercise 9-1',
      'Exercise 9-4',
    ])
  })

  it('orders within a group numerically, which is the order the chapter builds in', () => {
    // Exercise 15-1 creates the volume group Exercise 15-2 extends, so a
    // lexicographic sort putting 15-10 second would ask the student to extend
    // something that does not exist yet.
    const corpus = corpusOf(
      ['Exercise 2-10', 'Exercise 2-2', 'Exercise 2-1'].map((id) => ({
        items: [ex(id, 'r9', 2, 'Doing Something', ['Type ls.'])],
      })),
    )

    expect(guidedForObjective(corpus, objective('tools.shell.prompt', [2])).map((i) => i.id)).toEqual(
      ['Exercise 2-1', 'Exercise 2-2', 'Exercise 2-10'],
    )
  })

  it('unions several chapters and never repeats a slot', () => {
    const corpus = corpusOf([
      { items: [ex('Exercise 14-1', 'r9', 14, 'Creating Partitions', ['Type fdisk /dev/sdb.'])] },
      { items: [ex('Exercise 15-1', 'r9', 15, 'Creating a PV', ['Type pvcreate /dev/sdb1.'])] },
    ])

    // The duplicate chapter is what the `seen` guard is for; the schema allows it
    // and no objective in the real bank writes one today.
    const items = guidedForObjective(corpus, objective('storage.lvm.pv', [14, 15, 14]))
    expect(items.map((i) => i.id)).toEqual(['Exercise 14-1', 'Exercise 15-1'])
  })

  it('returns an empty list for a chapter with no exercises, rather than throwing', () => {
    // Chapters 1, 27 and 28 of the real corpus are in this position.
    expect(guidedForObjective(CORPUS, objective('exam.sample', [27]))).toEqual([])
  })
})

describe('guidedForTask', () => {
  const objectives = objectiveSet([
    objective('storage.lvm.resize', [15]),
    objective('storage.partitions', [14]),
  ])

  it('selects from the objectives chapters and ignores the task chapter', () => {
    // The measured case this rule exists for:
    // `troubleshooting/028-restore-remote-access` declares chapter 26 while its
    // objectives map to 8, 11 and 23. Here the task claims 26 and must still be
    // taught out of chapter 15.
    const items = guidedForTask(CORPUS, task(), objectives)

    expect(items.map((i) => i.id)).toEqual(['Exercise 15-1', 'Exercise 15-2', 'Exercise 15-5'])
    expect(items.every((i) => i.chapter === 15)).toBe(true)
  })

  it('unions the chapters of every objective the task maps to', () => {
    const corpus = corpusOf([
      ...CH15,
      { items: [ex('Exercise 14-1', 'r9', 14, 'Creating Partitions', ['Type fdisk /dev/sdb.'])] },
    ])
    const items = guidedForTask(
      corpus,
      task({ objectives: ['storage.partitions', 'storage.lvm.resize'] }),
      objectives,
    )

    expect(items.map((i) => i.id)).toContain('Exercise 14-1')
    expect(items.map((i) => i.id)).toContain('Exercise 15-2')
  })

  it('passes the primary edition through', () => {
    const items = guidedForTask(CORPUS, task(), objectives, { primary: 'r10' })
    expect(items[0]?.shown.edition).toBe('r10')
  })

  it('throws on an objective id no taxonomy defines, naming the task and every bad id', () => {
    // The one loud failure in the module. A task referencing an objective that
    // does not exist has skipped `npm run validate`, and returning the items for
    // the ids that did resolve would hide that behind a plausible short list.
    let caught: unknown
    try {
      guidedForTask(CORPUS, task({ objectives: ['storage.lvm.resize', 'nope.one', 'nope.two'] }), objectives)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ContentError)
    expect((caught as ContentError).where).toBe('storage/014-grow-var')
    expect((caught as ContentError).problems).toEqual([
      'maps to unknown objective: nope.one',
      'maps to unknown objective: nope.two',
    ])
  })
})

describe('guidedForChapter', () => {
  it('returns the chapter exercises in the same order the other two routes use', () => {
    // Same ordering, because it is the same selector underneath: a chapter is
    // asked for directly instead of via an objective's `chapters:` list.
    expect(guidedForChapter(CORPUS, 15).map((i) => i.id)).toEqual([
      'Exercise 15-1',
      'Exercise 15-2',
      'Exercise 15-5',
    ])
  })

  it('reaches a chapter no objective and no task names, which the other two cannot', () => {
    // The reason this function exists. `guidedForObjective` needs an objective
    // whose `chapters:` lists the chapter and `guidedForTask` needs a task that
    // maps to such an objective; the real bank has neither for chapters 1, 12, 16,
    // 17 and 21, so their exercises sat in the corpus with no entry point.
    const corpus = corpusOf([
      { items: [ex('Exercise 12-1', 'r9', 12, 'Managing Users', ['Type useradd linda.'])] },
    ])
    expect(guidedForChapter(corpus, 12).map((i) => i.id)).toEqual(['Exercise 12-1'])
  })

  it('returns an empty list for a chapter the book teaches without exercises', () => {
    // Chapters 1, 27 and 28. An answer, not an error - the route returns 200.
    expect(guidedForChapter(CORPUS, 27)).toEqual([])
  })

  it('excludes labs, like the other two', () => {
    expect(guidedForChapter(CORPUS, 15).map((i) => i.id)).not.toContain('Lab 15.1')
  })

  it('passes the primary edition through', () => {
    expect(guidedForChapter(CORPUS, 15, { primary: 'r10' })[0]?.shown.edition).toBe('r10')
  })
})
