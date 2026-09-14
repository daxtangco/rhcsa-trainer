import { beforeAll, describe, expect, it } from 'vitest'
import { loadBank, type Bank } from '../../src/engine/content/bank.ts'
import { loadCorpus, type Corpus } from '../../src/engine/corpus/corpus.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'
import { parseVerdict } from '../../src/engine/grading/verdict.ts'
import type { TaskScripts } from '../../src/engine/validate/harness.ts'
import { createApp } from '../../src/server/app.ts'
import type { LabRuntime } from '../../src/server/lab.ts'
import { SessionStore } from '../../src/server/session.ts'

/**
 * Guided mode's three routes (spec section 9.1).
 *
 * Driven against the **real** bank and the **real** corpus, because the whole
 * selection logic is a join between an objective's `chapters:` and a corpus
 * exercise id, and a synthetic two-item corpus would assert that the join compiles
 * rather than that it selects. `test/guided/` already pins the selection itself; what
 * is only observable here is the status code each failure gets.
 */

const SCRIPTS: TaskScripts = {
  setup: 'echo setup',
  grade: '# baseline-fail: a\nck a "d" $?\n',
  fixtures: [{ kind: 'solution', name: '01.sh', script: 'true\n' }],
}

const RUNTIME: LabRuntime = {
  transportKind: 'ssh',
  snapshot: 'clean',
  reset: async () => {},
  exec: async () => ({ stdout: '', stderr: '', code: 0 }),
  gradeTask: async () => ({
    verdictA: parseVerdict('{"id":"a","desc":"d","status":"pass"}'),
    regressions: [],
    rebooted: false,
  }),
}

let bank: Bank
let corpus: Corpus

beforeAll(async () => {
  ;[bank, corpus] = await Promise.all([loadBank('content'), loadCorpus('corpus')])
})

function app(over: { bank?: Bank; corpus?: Corpus } = {}) {
  const a = createApp({
    bank: over.bank ?? bank,
    runtime: RUNTIME,
    sessions: new SessionStore(),
    assertLib: '',
    loadScripts: async () => SCRIPTS,
    now: () => 1000,
    ...('corpus' in over ? { corpus: over.corpus } : { corpus }),
  })
  return (path: string) => a.request(path)
}

/** A bank whose one task names an objective the taxonomy does not define. */
function brokenBank(): Bank {
  const broken: TaskSpec = {
    id: 'storage/999-broken',
    title: 'broken',
    chapter: 15,
    scope: 'exam-objective',
    rhel: 9,
    objectives: ['storage.does.not.exist'],
    requiresConcepts: [],
    difficulty: 3,
    timeBudget: 600,
    weight: 'high',
    editions: ['r9'],
    rebootCheck: false,
    requiresDisks: 0,
    claims: [],
    transport: 'ssh',
    prompt: 'x',
    dir: '/content/tasks/storage/999-broken',
  }
  return { ...bank, tasks: [broken], tasksById: new Map([[broken.id, broken]]) }
}

describe('GET /api/guided/task/:area/:slug', () => {
  it('returns guided items for a real task', async () => {
    const res = await app()('/api/guided/task/storage/014-grow-home-lv')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items?: unknown }
    expect(Array.isArray(body.items)).toBe(true)
    const items = body.items as Array<Record<string, unknown>>
    expect(items.length).toBeGreaterThan(0)
    // The wire shape is `GuidedItem`, unchanged: `shown` is what the student types.
    expect(items[0]).toMatchObject({
      id: expect.stringContaining('Exercise '),
      chapter: expect.any(Number),
      crossEdition: expect.any(Boolean),
      shown: { edition: 'r9', steps: expect.any(Array) },
    })
  })

  it('404s an unknown task', async () => {
    const res = await app()('/api/guided/task/storage/999-nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('unknown task') })
  })

  it('500s when the task names an unknown objective, because the content is wrong', async () => {
    // `guidedForTask` throws a ContentError for exactly this, and returning an empty
    // list would hide an authoring defect behind a plausible short list.
    const res = await app({ bank: brokenBank() })('/api/guided/task/storage/999-broken')
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining('maps to unknown objective'),
    })
  })

  it('honours ?primary=r10 by showing the other edition', async () => {
    const res = await app()('/api/guided/task/storage/014-grow-home-lv?primary=r10')
    expect(res.status).toBe(200)
    const items = ((await res.json()) as { items: Array<{ shown: { edition: string } }> }).items
    // Every cross-edition slot shows RHCSA 10; a slot only RHCSA 9 has still shows r9,
    // which is `guidedItem` degrading to the material that exists rather than blanking.
    expect(items.some((i) => i.shown.edition === 'r10')).toBe(true)
  })

  it('400s a ?primary that is not an edition, rather than casting it', async () => {
    const res = await app()('/api/guided/task/storage/014-grow-home-lv?primary=r11')
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('r9 or r10') })
  })

  it('500s with a message naming the wiring when no corpus is loaded', async () => {
    const res = await app({ corpus: undefined })('/api/guided/task/storage/014-grow-home-lv')
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('corpus is not loaded') })
  })
})

describe('GET /api/guided/objective/:id', () => {
  it('returns guided items for every objective in the bank', async () => {
    // `test/guided/corpus-real.test.ts` asserts the gap count is 0 against the
    // selector; this asserts the *route* reaches the same answer for all of them, so
    // no objective is a 404 or a 500 through HTTP.
    const request = app()
    for (const objective of bank.objectives.objectives) {
      const res = await request(`/api/guided/objective/${objective.id}`)
      expect(res.status, objective.id).toBe(200)
      const items = ((await res.json()) as { items: unknown[] }).items
      expect(items.length, objective.id).toBeGreaterThan(0)
    }
  })

  it('404s an unknown objective', async () => {
    const res = await app()('/api/guided/objective/nope.not.real')
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('unknown objective') })
  })

  it('400s a bad ?primary', async () => {
    const first = bank.objectives.objectives[0]?.id ?? ''
    const res = await app()(`/api/guided/objective/${first}?primary=`)
    expect(res.status).toBe(400)
  })

  it('has no 500 arm of its own: the resolved objective cannot throw', async () => {
    const first = bank.objectives.objectives[0]?.id ?? ''
    expect((await app()(`/api/guided/objective/${first}`)).status).toBe(200)
  })
})

describe('GET /api/guided/chapter/:chapter', () => {
  const items = async (path: string) => {
    const res = await app()(path)
    expect(res.status, path).toBe(200)
    return ((await res.json()) as { items: Array<{ id: string; chapter: number }> }).items
  }

  it('reaches every chapter the bank has no task for', async () => {
    // The measured reason the route exists. These five chapters are in the corpus
    // and in `GET /api/tasks`'s `chapters`, and no objective's `chapters:` lists
    // them - so `guidedForTask` and `guidedForObjective`, which both walk the bank,
    // cannot return their exercises at all. Asserted by chapter number rather than
    // by count, because a task authored for chapter 12 tomorrow must not turn this
    // test red: the route's answer does not depend on the bank.
    for (const chapter of [12, 16, 17, 21]) {
      const list = await items(`/api/guided/chapter/${chapter}`)
      expect(list.length, `chapter ${chapter}`).toBeGreaterThan(0)
      expect(list.every((i) => i.chapter === chapter), `chapter ${chapter}`).toBe(true)
    }
  })

  it('answers 200 with an empty list for a chapter the book prints no exercise for', async () => {
    // Chapters 1, 27 and 28: an introduction and the two sample exams. Not a 404 -
    // the chapter exists and the honest answer about it is "nothing numbered here".
    for (const chapter of [1, 27, 28]) {
      expect(await items(`/api/guided/chapter/${chapter}`), `chapter ${chapter}`).toEqual([])
    }
  })

  it('answers every chapter the task list advertises, so the Learn sidebar has no dead heading', async () => {
    // The sidebar makes a button of every chapter in `chapters`. If any of them
    // could 400 or 500, the screen would offer a click that reports a failure the
    // student did not cause.
    const res = await app()('/api/tasks')
    const chapters = ((await res.json()) as { chapters: number[] }).chapters
    expect(chapters.length).toBeGreaterThan(0)
    for (const chapter of chapters) {
      expect((await app()(`/api/guided/chapter/${chapter}`)).status, `chapter ${chapter}`).toBe(200)
    }
  })

  it('400s a chapter outside the schema bound, and says what the bound is', async () => {
    // 400 and not 404: 28 is the corpus schema's own limit, so 99 is a malformed
    // request rather than a chapter that might exist somewhere. `1.5` and `twelve`
    // are the same class of mistake - `Number('twelve')` is `NaN`, which `<` and `>`
    // both answer false to, so the integer check is what rejects it.
    for (const bad of ['0', '99', '1.5', 'twelve', '-3']) {
      const res = await app()(`/api/guided/chapter/${bad}`)
      expect(res.status, bad).toBe(400)
      expect(await res.json(), bad).toMatchObject({
        error: expect.stringContaining('integer 1-28'),
      })
    }
  })

  it('400s a bad ?primary, like the other two routes', async () => {
    expect((await app()('/api/guided/chapter/15?primary=')).status).toBe(400)
    expect((await app()('/api/guided/chapter/15?primary=r11')).status).toBe(400)
  })

  it('honours ?primary where the edition has the exercise, and falls back where it does not', async () => {
    // `primary` is a preference, not a filter. Chapter 15 is the case that proves
    // it: four of its five exercises are in both books and show r10 when asked,
    // while Exercise 15-5 (Stratis) is RHCSA 9 only and shows r9 rather than
    // vanishing from the list. Dropping it would silently shrink the chapter.
    const res = await app()('/api/guided/chapter/15?primary=r10')
    expect(res.status).toBe(200)
    const list = ((await res.json()) as {
      items: Array<{ id: string; editions: string[]; shown: { edition: string } }>
    }).items
    expect(list.length).toBeGreaterThan(0)
    for (const i of list) {
      expect(i.shown.edition, i.id).toBe(i.editions.includes('r10') ? 'r10' : 'r9')
    }
    // Both arms are actually exercised, or the loop above asserts nothing.
    expect(list.some((i) => i.shown.edition === 'r10')).toBe(true)
    expect(list.some((i) => !i.editions.includes('r10'))).toBe(true)
  })

  it('500s when the server has no corpus, rather than reporting an empty book', async () => {
    // `corpus` is optional on `AppDeps` — a server started without the extracted
    // books is a working lab with no guided mode. An empty list here would be
    // indistinguishable from chapter 1's real answer.
    const res = await app({ corpus: undefined })('/api/guided/chapter/15')
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('not loaded') })
  })
})

/**
 * Not a guided route, but this is the only server test file that loads the real
 * corpus, and `chapters` is a fact about the corpus. `test/server/app.test.ts`
 * covers the other side — the empty list a server with no corpus returns.
 */
describe('GET /api/tasks chapters', () => {
  it('lists the book chapters, ascending, including ones the bank has no task for', async () => {
    const res = await app()('/api/tasks')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tasks: Array<{ chapter: number }>; chapters: number[] }

    // Ascending and deduplicated: the corpus has hundreds of items across these
    // chapters, and the picker groups on this list in the order it arrives.
    expect(body.chapters.length).toBeGreaterThan(0)
    expect([...body.chapters].sort((a, b) => a - b)).toEqual(body.chapters)
    expect(new Set(body.chapters).size).toBe(body.chapters.length)

    // The claim that makes the field worth returning: it is a *superset* of the
    // chapters the tasks cover, and strictly larger. If it were merely equal, the
    // picker could derive it from the task list and the authoring backlog would be
    // invisible - which is the bug this field exists to prevent.
    const covered = new Set(body.tasks.map((t) => t.chapter))
    for (const c of covered) expect(body.chapters, `chapter ${c}`).toContain(c)
    expect(body.chapters.filter((c) => !covered.has(c)).length).toBeGreaterThan(0)
  })
})
