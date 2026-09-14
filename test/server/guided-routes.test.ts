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
 * Guided mode's two routes (spec section 9.1).
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
