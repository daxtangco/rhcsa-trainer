import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadCorpus, type Corpus } from '../../src/engine/corpus/corpus.ts'
import { headingTitle } from '../../src/engine/corpus/items.ts'

// The counts. `corpus.test.ts` proves the loader rejects a bad corpus; this file
// proves the corpus on disk is the one the spec and the extraction script describe,
// with the numbers written down. Every figure here was measured on 2026-09-13 and
// is asserted exactly, because the corpus is a generated artifact of two fixed
// PDFs: a number that moves means the extraction moved, and that is the event
// worth failing a test for.

const ROOT = fileURLToPath(new URL('../../corpus', import.meta.url))

let corpus: Corpus

beforeAll(async () => {
  corpus = await loadCorpus(ROOT)
})

function editionsOf(id: string): string {
  return (corpus.editionsById.get(id) ?? []).join('+')
}

describe('the real corpus', () => {
  it('loads without a single problem', async () => {
    // The assertion that every rule in items.ts is compatible with the corpus it
    // was written against. If this fails, either the corpus was regenerated or a
    // rule was tightened past what the books contain.
    await expect(loadCorpus(ROOT)).resolves.toBeDefined()
  })

  it('holds 238 instances: 58 labs and 180 exercises', () => {
    // Spec section 2 states 30 + 28 lab instances and 95 + 85 exercise instances.
    // These are the measured values and they agree with it exactly.
    const labs = corpus.items.filter((i) => i.kind === 'lab')
    const exercises = corpus.items.filter((i) => i.kind === 'exercise')

    expect(corpus.items).toHaveLength(238)
    expect(labs).toHaveLength(58)
    expect(exercises).toHaveLength(180)
    expect(labs.filter((i) => i.edition === 'r9')).toHaveLength(30)
    expect(labs.filter((i) => i.edition === 'r10')).toHaveLength(28)
    expect(exercises.filter((i) => i.edition === 'r9')).toHaveLength(95)
    expect(exercises.filter((i) => i.edition === 'r10')).toHaveLength(85)
  })

  it('holds 126 slots: 30 lab slots and 96 exercise slots', () => {
    const slots = [...corpus.byId.entries()]
    expect(slots).toHaveLength(126)
    expect(slots.filter(([, v]) => v[0]?.kind === 'lab')).toHaveLength(30)
    expect(slots.filter(([, v]) => v[0]?.kind === 'exercise')).toHaveLength(96)
  })

  it('pairs 84 exercise slots and 28 lab slots across the two editions', () => {
    // Section 14.4's weight signal: 112 of the 126 slots are in both books.
    const paired = [...corpus.byId.entries()].filter(([id]) => editionsOf(id) === 'r9+r10')
    expect(paired).toHaveLength(112)
    expect(paired.filter(([, v]) => v[0]?.kind === 'exercise')).toHaveLength(84)
    expect(paired.filter(([, v]) => v[0]?.kind === 'lab')).toHaveLength(28)
  })

  it('has 11 RHCSA 9 only exercises, 9 of them the containers chapter', () => {
    const only9 = [...corpus.byId.keys()].filter(
      (id) => corpus.byId.get(id)?.[0]?.kind === 'exercise' && editionsOf(id) === 'r9',
    )
    expect(only9).toEqual([
      'Exercise 2-8',
      'Exercise 15-5',
      'Exercise 26-1',
      'Exercise 26-2',
      'Exercise 26-3',
      'Exercise 26-4',
      'Exercise 26-5',
      'Exercise 26-6',
      'Exercise 26-7',
      'Exercise 26-8',
      'Exercise 26-9',
    ])
  })

  it('is short exactly the two labs the spec names, and no others', () => {
    // Spec section 2: *"The lab delta is exactly −2, and both absent labs are
    // precisely the removed content: RHCSA 9's `Lab 15.2` (Stratis) and `Lab 26.1`
    // (containers)."* This is the strongest independent check available on the
    // extraction — the spec's claim was made from the two tables of contents, and
    // it is confirmed here from the sliced bodies.
    const only9 = [...corpus.byId.keys()].filter(
      (id) => corpus.byId.get(id)?.[0]?.kind === 'lab' && editionsOf(id) === 'r9',
    )
    const only10 = [...corpus.byId.keys()].filter(
      (id) => corpus.byId.get(id)?.[0]?.kind === 'lab' && editionsOf(id) === 'r10',
    )

    expect(only9).toEqual(['Lab 15.2', 'Lab 26.1'])
    expect(only10).toEqual([])
  })

  it('has exactly one RHCSA 10 only exercise', () => {
    const only10 = [...corpus.byId.keys()].filter(
      (id) => corpus.byId.get(id)?.[0]?.kind === 'exercise' && editionsOf(id) === 'r10',
    )
    expect(only10).toEqual(['Exercise 9-4'])
    expect(headingTitle('Exercise 9-4', corpus.byId.get('Exercise 9-4')?.[0]?.text ?? '')).toBe(
      'Managing Flatpak Applications',
    )
  })

  it('keeps every instance of a slot in one chapter, and every chapter in its id', () => {
    // The invariant `exerciseIdsByChapter` rests on: one chapter per slot, read off
    // the first instance. 238/238 items agree with their own id.
    for (const [id, instances] of corpus.byId) {
      const chapters = new Set(instances.map((i) => i.chapter))
      expect(chapters.size, id).toBe(1)
      const fromId = Number(/(\d{1,2})[.-]/.exec(id.replace(/^\w+ /, ''))?.[1])
      expect(instances[0]?.chapter, id).toBe(fromId)
    }
  })

  it('indexes exercises for chapters 2 to 26, and none for 1, 27 or 28', () => {
    // 25 chapters carry exercises. Chapter 1 is the RHCSA introduction, 27 and 28
    // are the two sample exams, and neither prints any — so an objective added for
    // one of those chapters would resolve to no guided material at all.
    expect([...corpus.exerciseIdsByChapter.keys()].sort((a, b) => a - b)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ])
    for (const chapter of [1, 27, 28]) {
      expect(corpus.exerciseIdsByChapter.get(chapter)).toBeUndefined()
    }
  })

  it('accounts for all 96 exercise slots across the chapter index exactly once', () => {
    const indexed = [...corpus.exerciseIdsByChapter.values()].flat()
    expect(indexed).toHaveLength(96)
    expect(new Set(indexed).size).toBe(96)
  })

  it('has no exercise heading that is a sentence fragment rather than a title', () => {
    // This used to assert exactly one, and name it: RHCSA 10's `Exercise 18-2` body
    // had been sliced from a prose cross-reference — *"(see Exercise 18-2 for the
    // exact procedure…)"* won the longest-body dedupe — so its heading was a
    // sentence fragment.
    //
    // `beats()` in scripts/extract-corpus.ts fixed the rule a while ago, by demoting
    // an exercise slice with no `1.` step near the top: that is what separates a
    // numbered walkthrough from a sentence mentioning one, and
    // test/corpus/extract.test.ts pins the rule against the shape of the defect.
    // What stayed pinned here was the **artifact**, because `corpus/` is generated
    // and regenerating it needs `pdftotext -layout`, which this RHEL 9 host had no
    // poppler for.
    //
    // It has one now — a rootless poppler 21.01.0 under `~/.local/poppler`, the same
    // version RHEL 9 ships, unpacked from `dnf download --resolve poppler-utils`
    // without installing anything — so `npm run corpus` re-ran and this is 0. The
    // regeneration changed exactly three of 360 entries and reproduced the
    // extractor's measured baseline exactly (r9 30/95, r10 28/85, 112 shared), which
    // is the evidence that it fixed the defect rather than resliced the books:
    // `Exercise 18-2` became its real six-step rescue walkthrough, and `21-2` and
    // `6-4` changed only in intra-line spacing, where this poppler preserves column
    // gaps that the newer one on the old WSL distro collapsed.
    //
    // The rule reads the body rather than the title because the two obvious title
    // filters both damage real content: a lowercase-initial test would drop
    // `Exercise 2-5`, *"vim Practice"*, in both editions, and a punctuation test
    // would drop `Exercise 13-4`, *"Changing rsyslog.conf Rules"*.
    const suspect = corpus.items
      .filter((i) => i.kind === 'exercise')
      .filter((i) => /\.\)|\) /.test(headingTitle(i.id, i.text)))
      .map((i) => `${i.edition} ${i.id}`)

    expect(suspect).toEqual([])

    // Two entries, not three: `r10 Exercise 18-2` came off this list with the same
    // regeneration. What is left is the reason the rule reads the body instead of the
    // title — both remaining entries are real content with a lowercase-initial name.
    const lowercase = corpus.items
      .filter((i) => i.kind === 'exercise' && /^[a-z]/.test(headingTitle(i.id, i.text)))
      .map((i) => `${i.edition} ${i.id}`)
    expect(lowercase).toEqual(['r9 Exercise 2-5', 'r10 Exercise 2-5'])
  })

  it('puts every real exercise\'s first numbered step inside the extractor\'s scan window', () => {
    // `STEP_SCAN_LINES = 14` in scripts/extract-corpus.ts is a measurement, and this
    // is the measurement. The deepest real first step in either book is `r10
    // Exercise 14-3`'s, on body line 12, behind eleven lines of "you will need a
    // spare disk you do not mind erasing" preamble — so the window has two lines of
    // headroom and no more. A regenerated corpus that moves it past 14 would make
    // the extractor start demoting real exercises, which is a silent content loss;
    // asserted as the maximum rather than a threshold so it fails while there is
    // still headroom to see.
    const WINDOW = 14
    const depths = corpus.items
      .filter((i) => i.kind === 'exercise')
      .map((i) => {
        const body = i.text.split('\n').slice(1, WINDOW + 1)
        return { id: `${i.edition} ${i.id}`, at: body.findIndex((l) => /^\s*1\.\s/.test(l)) + 1 }
      })

    // Every real exercise now clears the window, including the one that used to be
    // the exception. The old `r10 Exercise 18-2` slice missed it while still
    // containing a `1.` far below — the first step of a *different* section the bad
    // slice had swallowed — which is why the window is part of the rule and not a
    // shortcut: unbounded, that cross-reference would have looked like a procedure.
    expect(depths.filter((d) => d.at === 0).map((d) => d.id)).toEqual([])

    const deepest = depths.filter((d) => d.at > 0).sort((a, b) => b.at - a.at)[0]
    expect(deepest).toEqual({ id: 'r10 Exercise 14-3', at: 12 })
  })
})
