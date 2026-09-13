import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadObjectives, type ObjectiveSet } from '../../src/engine/content/objectives.ts'
import { loadCorpus, type Corpus } from '../../src/engine/corpus/corpus.ts'
import { guidedForObjective, guidedItem, type GuidedItem } from '../../src/engine/guided/select.ts'
import { parseGuidedSteps, titleContinuation } from '../../src/engine/guided/steps.ts'

// Guided mode against the real books and the real objective taxonomy, with the
// counts written down.
//
// Everything in `steps.test.ts` and `select.test.ts` runs on input this file's
// author chose, which is exactly the weakness of testing a heuristic: it proves
// the rule does what its author meant, not that its author read the corpus right.
// So every figure below was measured on 2026-09-13 against `corpus/` and
// `content/objectives.yaml` and is asserted exactly. When the corpus is
// regenerated these will move, and reading *which* number moved is the fastest
// description available of what the new extraction did.

const CORPUS = fileURLToPath(new URL('../../corpus', import.meta.url))
const OBJECTIVES = fileURLToPath(new URL('../../content/objectives.yaml', import.meta.url))

let corpus: Corpus
let objectives: ObjectiveSet
let exerciseSlots: string[]
let items: GuidedItem[]

beforeAll(async () => {
  ;[corpus, objectives] = await Promise.all([loadCorpus(CORPUS), loadObjectives(OBJECTIVES)])
  exerciseSlots = [...corpus.byId.entries()]
    .filter(([, instances]) => instances[0]?.kind === 'exercise')
    .map(([id]) => id)
  items = exerciseSlots
    .map((id) => guidedItem(corpus, id))
    .filter((i): i is GuidedItem => i !== undefined)
})

describe('guided mode over the real corpus', () => {
  it('turns every one of the 96 exercise slots into a guided item', () => {
    // No slot is skipped. A slot that stopped producing an item would be an
    // objective quietly offering one walkthrough fewer, which is the failure the
    // whole corpus layer is built to make loud.
    expect(exerciseSlots).toHaveLength(96)
    expect(items).toHaveLength(96)
  })

  it('parses all 180 exercise instances into 1405 steps, none of them empty', () => {
    // 1405, not the 1406 pinned before 2026-09-14. The whole difference is
    // `r10 Exercise 18-2`, whose body stopped being a mis-sliced prose
    // cross-reference when the corpus was regenerated: seven pseudo-steps became the
    // six real ones of its rescue walkthrough. Nothing else moved — 180 instances,
    // min 1, max 16 and a median of 8 all held — which is what says the regeneration
    // repaired one entry rather than reslicing the books.
    const instances = corpus.items.filter((i) => i.kind === 'exercise')
    const stepCounts = instances.map((i) => parseGuidedSteps(i.text).length)

    expect(instances).toHaveLength(180)
    expect(stepCounts.filter((n) => n === 0)).toEqual([])
    expect(stepCounts.reduce((a, b) => a + b, 0)).toBe(1405)
    expect(Math.min(...stepCounts)).toBe(1)
    expect(Math.max(...stepCounts)).toBe(16)
  })

  it('numbers every step contiguously from 1, in both editions', () => {
    // The property `typedStepMatches` and any progress bar depend on. It is also
    // the check that the "a number out of sequence ends the list" rule did not
    // instead drop a step out of the middle of one.
    for (const instance of corpus.items.filter((i) => i.kind === 'exercise')) {
      const numbers = parseGuidedSteps(instance.text).map((s) => s.n)
      expect(numbers, `${instance.edition} ${instance.id}`).toEqual(
        numbers.map((_, i) => i + 1),
      )
    }
  })

  it('offers a command candidate for 1058 of the 1405 steps, and 1271 in total', () => {
    // Three steps in four. The other 347 are prose the student advances by
    // acknowledging — *"Open a root shell."*, *"Which command schedules a cron
    // job?"* — and `typedStepMatches` returns false for all of them by design, so
    // a caller must not gate advancement on it.
    //
    // Each figure dropped by three when the corpus was regenerated, and all three
    // came from `r10 Exercise 18-2`: its old mis-sliced body offered five
    // command-bearing steps, its real rescue walkthrough offers two, because booting
    // to the rescue option is menu selections rather than typed commands. A ratio
    // that held at three in four across that change is the ratio being a property of
    // the books and not of one entry.
    const steps = corpus.items
      .filter((i) => i.kind === 'exercise')
      .flatMap((i) => parseGuidedSteps(i.text))

    expect(steps).toHaveLength(1405)
    expect(steps.filter((s) => s.commands.length > 0)).toHaveLength(1058)
    expect(steps.reduce((n, s) => n + s.commands.length, 0)).toBe(1271)
  })

  it('never offers a lab as guided material', () => {
    // Spec section 2's role table, asserted against all 30 lab slots rather than
    // against one invented lab — and it matters, because 52 of the 58 lab
    // instances do parse into numbered steps. A lab's numbered list is a list of
    // requirements to be graded, not of commands to type, and nothing downstream
    // of the `kind` check can tell the two apart.
    const labSlots = [...corpus.byId.entries()]
      .filter(([, instances]) => instances[0]?.kind === 'lab')
      .map(([id]) => id)

    expect(labSlots).toHaveLength(30)
    expect(
      corpus.items.filter((i) => i.kind === 'lab' && parseGuidedSteps(i.text).length > 0),
    ).toHaveLength(52)
    for (const id of labSlots) {
      expect(guidedItem(corpus, id), id).toBeUndefined()
    }
  })

  it('shows RHCSA 9 by default and carries RHCSA 10 as the alternate for 84 slots', () => {
    const cross = items.filter((i) => i.crossEdition)

    expect(cross).toHaveLength(84)
    expect(cross.every((i) => i.shown.edition === 'r9')).toBe(true)
    expect(cross.every((i) => i.alternate?.edition === 'r10')).toBe(true)
    expect(items.filter((i) => i.alternate !== undefined)).toHaveLength(84)
  })

  it('shows the only edition there is for the 12 single-edition slots', () => {
    const single = items.filter((i) => !i.crossEdition)

    expect(single).toHaveLength(12)
    expect(single.filter((i) => i.shown.edition === 'r9')).toHaveLength(11)
    // `Exercise 9-4`, *"Managing Flatpak Applications"*: RHCSA 10 only, and still
    // offered under the default `primary: 'r9'` rather than dropped.
    expect(single.filter((i) => i.shown.edition === 'r10').map((i) => i.id)).toEqual([
      'Exercise 9-4',
    ])
    expect(single.every((i) => i.alternate === undefined)).toBe(true)
  })

  it('repairs 13 RHCSA 10 titles the layout wrapped, and no RHCSA 9 title', () => {
    const wrapped = corpus.items.filter((i) => titleContinuation(i.text) !== undefined)

    expect(wrapped).toHaveLength(13)
    expect(wrapped.every((i) => i.edition === 'r10')).toBe(true)
    // Checkable against a second source: RHCSA 9 prints the same title unwrapped.
    const repaired = guidedItem(corpus, 'Exercise 15-2', { primary: 'r10' })
    expect(repaired?.shown.title).toBe('Creating the Volume Group and Logical Volumes')
    expect(repaired?.alternate?.title).toBe('Creating the Volume Group and Logical Volumes')
    expect(repaired?.shown.preamble.startsWith('In Exercise 15-1')).toBe(true)
  })

  it('resolves all 68 objectives to at least one guided item', () => {
    // The assertion that would catch a regeneration that lost a chapter's
    // headings: the 68 objectives name 23 distinct chapters between them, all 23
    // of which the corpus has exercises for, so a chapter dropped from the corpus
    // shows up here as an objective with nothing to offer.
    const named = new Set(objectives.objectives.flatMap((o) => o.chapters))
    const empty = objectives.objectives
      .filter((o) => guidedForObjective(corpus, o).length === 0)
      .map((o) => o.id)

    expect(objectives.objectives).toHaveLength(68)
    expect(named.size).toBe(23)
    expect([...named].filter((c) => !corpus.exerciseIdsByChapter.has(c))).toEqual([])
    expect(empty).toEqual([])
  })

  it('offers between 1 and 9 items per objective, which is a chapter and readable', () => {
    const counts = objectives.objectives.map((o) => guidedForObjective(corpus, o).length)
    expect(Math.min(...counts)).toBe(1)
    expect(Math.max(...counts)).toBe(9)
  })

  it('orders a mixed-edition objective cross-edition first and other-edition last', () => {
    // `pkg.dnf.install` names chapter 9, whose four slots are three pairs and the
    // one RHCSA 10 only exercise, so it exercises two of the three groups against
    // real data.
    const objective = objectives.byId.get('pkg.dnf.install')
    expect(objective?.chapters).toEqual([9])

    const selected = guidedForObjective(corpus, objective ?? { id: '', text: '', chapters: [] })
    expect(selected.map((i) => i.id)).toEqual([
      'Exercise 9-1',
      'Exercise 9-2',
      'Exercise 9-3',
      'Exercise 9-4',
    ])
    expect(selected.map((i) => i.crossEdition)).toEqual([true, true, true, false])
  })

  it('keeps a chapter in the order the book builds it in', () => {
    // Exercise 15-1 creates the physical volume 15-2 assigns to a volume group.
    const objective = objectives.byId.get('storage.lvm.pv')
    const selected = guidedForObjective(corpus, objective ?? { id: '', text: '', chapters: [] })

    expect(selected.map((i) => i.id)).toEqual([
      'Exercise 15-1',
      'Exercise 15-2',
      'Exercise 15-3',
      'Exercise 15-4',
      'Exercise 15-5',
    ])
  })

  it('gives every guided item a title, a non-empty step list and a chapter', () => {
    for (const item of items) {
      expect(item.shown.title, item.id).not.toBe('')
      expect(item.shown.steps.length, item.id).toBeGreaterThan(0)
      expect(item.chapter, item.id).toBeGreaterThanOrEqual(2)
      expect(item.editions.length, item.id).toBeGreaterThan(0)
    }
  })
})
