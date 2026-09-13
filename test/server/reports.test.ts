import { describe, expect, it } from 'vitest'
import { checkCoverage, loadBank, type Bank } from '../../src/engine/content/bank.ts'
import type { ConceptSpec } from '../../src/engine/content/concept.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'
import { parseVerdict } from '../../src/engine/grading/verdict.ts'
import { AttemptStore } from '../../src/engine/store/attempts.ts'
import { MEMORY_DB, openHistoryDb } from '../../src/engine/store/schema.ts'
import { VmStateStore } from '../../src/engine/store/vm-state.ts'
import type { TaskScripts } from '../../src/engine/validate/harness.ts'
import { createApp } from '../../src/server/app.ts'
import type { LabRuntime } from '../../src/server/lab.ts'
import { conceptsView, overviewView } from '../../src/server/reports.ts'
import { SessionStore } from '../../src/server/session.ts'

/**
 * The Dashboard and Concepts read models (spec section 11).
 *
 * The response shapes here are a **contract** with the screens, so most of these
 * assertions name every key rather than spot-checking one: a field quietly renamed is
 * a screen that renders `undefined`, and `toMatchObject` would not catch it.
 *
 * The fixture bank is built so that every gap `checkCoverage` distinguishes is present
 * exactly once — an untaught-but-reachable card, an untaught-and-unreachable one, an
 * uncovered objective and an instrumental task — because the whole argument for
 * calling `checkCoverage` instead of recounting is that these six lists are not
 * interchangeable.
 */

function task(id: string, over: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id,
    title: id,
    chapter: 15,
    scope: 'exam-objective',
    rhel: 9,
    objectives: [],
    requiresConcepts: [],
    difficulty: 3,
    timeBudget: 600,
    weight: 'high',
    editions: ['r9'],
    rebootCheck: false,
    requiresDisks: 0,
    claims: [],
    transport: 'ssh',
    prompt: `do ${id}`,
    dir: `/content/tasks/${id}`,
    ...over,
  }
}

function concept(id: string, over: Partial<ConceptSpec> = {}): ConceptSpec {
  return {
    id,
    title: id,
    rhel: 9,
    objectives: [],
    sources: ['r9:ch15'],
    prerequisites: [],
    body: 'x'.repeat(200),
    path: `/content/concepts/${id.replace('.', '/')}.md`,
    ...over,
  }
}

const GROW = task('storage/014-grow-home-lv', {
  objectives: ['storage.lvm.resize'],
  requiresConcepts: ['storage.lvm-abstraction-stack'],
})

/** Instrumental, so it exercises `pkg.dnf.install` without being able to cover it (spec 6.4). */
const HTTPD = task('selinux/019-httpd-alt-port', {
  scope: 'instrumental',
  objectives: ['pkg.dnf.install'],
  requiresConcepts: ['selinux.ports'],
})

const LVM = concept('storage.lvm-abstraction-stack', { objectives: ['storage.lvm.resize'] })
/** Required by a task. */
const PORTS = concept('selinux.ports', {
  objectives: ['selinux.context'],
  prerequisites: ['selinux.labels-now-vs-policy'],
})
/** No task names it, but `selinux.ports` needs it first — so untaught and still reachable. */
const LABELS = concept('selinux.labels-now-vs-policy', { objectives: ['selinux.context'] })
/** Nothing names it and nothing needs it: content no route can deliver. */
const ORPHAN = concept('tools.orphan', { objectives: ['selinux.context'] })

function bank(): Bank {
  const objectives = [
    { id: 'storage.lvm.resize', text: 'Extend existing logical volumes', chapters: [15] },
    { id: 'selinux.context', text: 'Manage SELinux contexts', chapters: [22] },
    { id: 'pkg.dnf.install', text: 'Install packages', chapters: [9] },
  ]
  const concepts = [LVM, PORTS, LABELS, ORPHAN]
  return {
    root: '/content',
    objectives: {
      version: 'rhel9',
      source: 'test',
      objectives,
      byId: new Map(objectives.map((o) => [o.id, o])),
    },
    tasks: [GROW, HTTPD],
    concepts,
    tasksById: new Map([GROW, HTTPD].map((t) => [t.id, t])),
    conceptsById: new Map(concepts.map((c) => [c.id, c])),
  }
}

const GRADE = '# baseline-fail: lv-home-size, fs-home-size\nck lv-home-size "d" $?\nck fs-home-size "e" $?\n'

const SCRIPTS: TaskScripts = {
  setup: 'echo setup',
  grade: GRADE,
  fixtures: [{ kind: 'solution', name: '01.sh', script: 'true\n' }],
}

const ALL_PASS = parseVerdict(
  [
    '{"id":"lv-home-size","desc":"d","status":"pass"}',
    '{"id":"fs-home-size","desc":"e","status":"pass"}',
  ].join('\n'),
)

/** A run that emits one of the two declared checkpoints: incomplete, so not clean. */
const TRUNCATED = parseVerdict('{"id":"lv-home-size","desc":"d","status":"pass"}')

interface Harness {
  request: (path: string, init?: RequestInit) => Promise<Response>
  attempts: AttemptStore
  vmState: VmStateStore
  verdict: { current: typeof ALL_PASS }
  close: () => void
}

function harness(opts: { withStores?: boolean } = {}): Harness {
  const withStores = opts.withStores ?? true
  const verdict = { current: ALL_PASS }
  const runtime: LabRuntime = {
    transportKind: 'ssh',
    snapshot: 'clean',
    reset: async () => {},
    exec: async () => ({ stdout: '', stderr: '', code: 0 }),
    gradeTask: async () => ({ verdictA: verdict.current, regressions: [], rebooted: false }),
  }
  const db = openHistoryDb({ path: MEMORY_DB })
  const attempts = new AttemptStore(db, { now: () => 5000 })
  const vmState = new VmStateStore(db, { now: () => 7000 })
  let clock = 1_000_000
  const app = createApp({
    bank: bank(),
    runtime,
    sessions: new SessionStore(),
    assertLib: '',
    loadScripts: async () => SCRIPTS,
    now: () => (clock += 60_000),
    ...(withStores ? { attempts, vmState } : {}),
  })
  return {
    request: async (path, init) => app.request(path, init),
    attempts,
    vmState,
    verdict,
    close: () => db.close(),
  }
}

async function attempt(h: Harness, mode: string): Promise<void> {
  const res = await h.request('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ taskId: GROW.id, mode }),
    headers: { 'content-type': 'application/json' },
  })
  const body = (await res.json()) as { id?: unknown }
  const id = body.id
  if (typeof id !== 'string') throw new Error(`no session id in ${JSON.stringify(body)}`)
  await h.request(`/api/sessions/${id}/grade`, { method: 'POST' })
  await h.request(`/api/sessions/${id}/finish`, { method: 'POST' })
}

describe('GET /api/concepts', () => {
  it('returns the exact contract shape for every card', async () => {
    const h = harness()
    try {
      const res = await h.request('/api/concepts')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({
        concepts: [
          {
            id: 'storage.lvm-abstraction-stack',
            title: 'storage.lvm-abstraction-stack',
            area: 'storage',
            objectives: ['storage.lvm.resize'],
            prerequisites: [],
            taught: true,
            reachable: true,
            requiredByTasks: ['storage/014-grow-home-lv'],
          },
          {
            id: 'selinux.ports',
            title: 'selinux.ports',
            area: 'selinux',
            objectives: ['selinux.context'],
            prerequisites: ['selinux.labels-now-vs-policy'],
            taught: true,
            reachable: true,
            requiredByTasks: ['selinux/019-httpd-alt-port'],
          },
          {
            id: 'selinux.labels-now-vs-policy',
            title: 'selinux.labels-now-vs-policy',
            area: 'selinux',
            objectives: ['selinux.context'],
            prerequisites: [],
            // The pair that matters: no task names it, and a student still meets it.
            taught: false,
            reachable: true,
            requiredByTasks: [],
          },
          {
            id: 'tools.orphan',
            title: 'tools.orphan',
            area: 'tools',
            objectives: ['selinux.context'],
            prerequisites: [],
            taught: false,
            reachable: false,
            requiredByTasks: [],
          },
        ],
        problems: [],
      })
    } finally {
      h.close()
    }
  })

  it('does not shadow GET /api/concepts/:id', async () => {
    const h = harness()
    try {
      const res = await h.request('/api/concepts/selinux.ports')
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ id: 'selinux.ports' })
    } finally {
      h.close()
    }
  })

  it('reports checkCoverage problems verbatim rather than ranking them', () => {
    const b = bank()
    // A dangling prerequisite: `checkCoverage` folds `graph.problems` into
    // `problems`, and the screen must print that sentence, not a paraphrase.
    b.concepts = [concept('a.b', { prerequisites: ['nope.missing'], objectives: ['pkg.dnf.install'] })]
    b.conceptsById = new Map(b.concepts.map((c) => [c.id, c]))
    const coverage = checkCoverage(b)
    expect(conceptsView(b, coverage).problems).toEqual(coverage.problems)
    expect(coverage.problems.length).toBeGreaterThan(0)
  })

  it('derives the area from the id for every card in the real bank', async () => {
    // The one claim in `reports.ts` that is about the shipped content rather than
    // about the code: every card's directory equals its id's first segment, so
    // deriving the area from the id cannot disagree with where the file lives.
    const real = await loadBank('content')
    for (const c of conceptsView(real, checkCoverage(real)).concepts) {
      expect(c.area).not.toBe('')
      const spec = real.conceptsById.get(c.id)
      expect(spec?.path).toContain(`/concepts/${c.area}/`)
    }
  })
})

describe('GET /api/overview', () => {
  it('returns the exact contract shape, with vm null before anything is applied', async () => {
    const h = harness({ withStores: false })
    try {
      const res = await h.request('/api/overview')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        tasks: { total: 2, byScope: { 'exam-objective': 1, instrumental: 1 } },
        // `selinux.context` and `pkg.dnf.install` have no exam-objective task; only
        // `selinux.context` is untouched-free, because a card teaches toward it.
        objectives: { total: 3, covered: 1, uncovered: 2, untouched: 0 },
        concepts: { total: 4, untaught: 2, unreachable: 1 },
        attempts: { total: 0, clean: 0, byMode: { guided: 0, practice: 0, drill: 0, exam: 0 } },
        vm: null,
      })
    } finally {
      h.close()
    }
  })

  it('names every mode at zero rather than omitting the unused ones', async () => {
    const h = harness()
    try {
      const body = await (await h.request('/api/overview')).json()
      expect(body).toMatchObject({
        attempts: { byMode: { guided: 0, practice: 0, drill: 0, exam: 0 } },
      })
    } finally {
      h.close()
    }
  })

  it('counts attempts by mode and counts only clean ones as clean', async () => {
    const h = harness()
    try {
      await attempt(h, 'practice')
      await attempt(h, 'drill')
      // A truncated grader: one of the two declared checkpoints arrived, so the
      // schema's generated `clean` column is 0 and `clean_attempts` excludes it.
      h.verdict.current = TRUNCATED
      await attempt(h, 'practice')

      const body = await (await h.request('/api/overview')).json()
      expect(body).toMatchObject({
        attempts: { total: 3, clean: 2, byMode: { practice: 2, drill: 1, guided: 0, exam: 0 } },
      })
    } finally {
      h.close()
    }
  })

  it('still counts an attempt whose task has left the bank', async () => {
    // The overview read used to loop `forTask` over `bank.tasks`, so a row whose
    // task id was renamed out of the bank became invisible while sitting in the
    // database. Written at the store level here rather than by renaming content,
    // because the orphaning event is a content edit between two runs of the app and
    // there is no way to stage that inside one request.
    const h = harness()
    try {
      await attempt(h, 'practice')
      h.attempts.record({
        taskId: 'storage/014-renamed-away',
        objectiveIds: [],
        mode: 'exam',
        startedAt: 1000,
        finishedAt: 2000,
        rungUsed: 1,
        verdictA: ALL_PASS,
        finalVerdict: ALL_PASS,
        report: {
          passed: 2,
          total: 2,
          expectedTotal: 2,
          incomplete: false,
          countDisputed: false,
          regressionCount: 0,
          rebooted: false,
        },
        rating: 'good',
      })

      const body = await (await h.request('/api/overview')).json()
      // 2, not 1. An undercount here runs in the direction that flatters, which is
      // the wrong direction for a report whose only job is to be believed when it
      // says the user is not ready.
      expect(body).toMatchObject({ attempts: { total: 2, clean: 2, byMode: { exam: 1, practice: 1 } } })
    } finally {
      h.close()
    }
  })

  it('reports the vm row once a session has applied a setup', async () => {
    const h = harness()
    try {
      await h.request('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ taskId: GROW.id, mode: 'practice' }),
        headers: { 'content-type': 'application/json' },
      })
      const body = await (await h.request('/api/overview')).json()
      expect(body).toMatchObject({
        vm: { snapshot: 'clean', currentTask: GROW.id, appliedAt: 7000 },
      })
    } finally {
      h.close()
    }
  })

  it('distinguishes an unknown guest from a store that has never been written', () => {
    // Both are "we cannot name a task", and only one of them calls for a reset — so
    // `vm: null` and `vm: { currentTask: null }` must not collapse into each other.
    const db = openHistoryDb({ path: MEMORY_DB })
    try {
      const store = new VmStateStore(db, { now: () => 7000 })
      const b = bank()
      const coverage = checkCoverage(b)
      const args = { bank: b, coverage, attempts: [], cleanAttempts: 0 }

      expect(overviewView({ ...args, vmState: store }).vm).toBeNull()
      store.unknown()
      expect(overviewView({ ...args, vmState: store }).vm).toEqual({
        snapshot: null,
        currentTask: null,
        appliedAt: 7000,
      })
    } finally {
      db.close()
    }
  })

  it('reports no readiness percentage of any name', async () => {
    // Section 9.4: a study tool that flatters is worse than no study tool, and FSRS
    // is Phase 3. Asserted as an absence so adding one has to be a decision.
    const h = harness()
    try {
      const body = await (await h.request('/api/overview')).json()
      const flat = JSON.stringify(body)
      for (const word of ['readiness', 'ready', 'percent', 'score', 'confidence']) {
        expect(flat.toLowerCase()).not.toContain(word)
      }
    } finally {
      h.close()
    }
  })

  it('works without an attempt store wired', async () => {
    const h = harness({ withStores: false })
    try {
      const body = await (await h.request('/api/overview')).json()
      expect(body).toMatchObject({ attempts: { total: 0, clean: 0 } })
    } finally {
      h.close()
    }
  })
})
