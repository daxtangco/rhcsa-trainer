import { Hono } from 'hono'
import type { Bank } from '../engine/content/bank.ts'
import type { TaskSpec } from '../engine/content/task.ts'
import { rungContent, type RungContent, type RungContext } from '../engine/disclosure/content.ts'
import { deriveRating, RUNGS, TOP_RUNG, type Rating } from '../engine/disclosure/ladder.ts'
import type { GradeResult } from '../engine/grading/grader.ts'
import type { TaskScripts } from '../engine/validate/harness.ts'
import type { LabRuntime } from './lab.ts'
import {
  countCheckpoints,
  maxRungFor,
  reportFor,
  SessionStore,
  type SessionMode,
  type SessionRecord,
} from './session.ts'

export interface AppDeps {
  bank: Bank
  runtime: LabRuntime
  sessions: SessionStore
  assertLib: string
  loadScripts: (task: TaskSpec, assertLib: string) => Promise<TaskScripts>
  /** Injected so tests get a deterministic clock. */
  now: () => number
}

// Exhaustive by construction, the same way config.ts's KINDS is: adding a
// SessionMode fails to typecheck until it is listed here, so this cannot drift
// out of sync with the type it validates.
const MODES: Record<SessionMode, true> = {
  guided: true,
  practice: true,
  drill: true,
  exam: true,
}

function isSessionMode(v: unknown): v is SessionMode {
  return typeof v === 'string' && Object.hasOwn(MODES, v)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function summary(t: TaskSpec) {
  return {
    id: t.id,
    title: t.title,
    chapter: t.chapter,
    scope: t.scope,
    difficulty: t.difficulty,
    timeBudget: t.timeBudget,
    weight: t.weight,
    rebootCheck: t.rebootCheck,
    transport: t.transport,
    objectives: t.objectives,
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  /** Everything a rung needs: the task, its objectives, its cards, one solution. */
  async function contextFor(task: TaskSpec): Promise<RungContext> {
    const scripts = await deps.loadScripts(task, deps.assertLib)
    const solution = scripts.fixtures.find((f) => f.kind === 'solution')?.script ?? ''
    return {
      task,
      objectives: task.objectives
        .map((id) => deps.bank.objectives.byId.get(id))
        .filter((o) => o !== undefined),
      concepts: task.requiresConcepts
        .map((id) => deps.bank.conceptsById.get(id))
        .filter((c) => c !== undefined),
      solution,
    }
  }

  app.get('/api/health', (c) =>
    c.json({ ok: true, transport: deps.runtime.transportKind, tasks: deps.bank.tasks.length }),
  )

  app.get('/api/tasks', (c) => c.json({ tasks: deps.bank.tasks.map(summary) }))

  // Task ids contain a slash, so they arrive as two path segments.
  app.get('/api/tasks/:area/:slug', async (c) => {
    const id = `${c.req.param('area')}/${c.req.param('slug')}`
    const task = deps.bank.tasksById.get(id)
    if (task === undefined) return c.json({ error: `unknown task: ${id}` }, 404)

    return c.json({
      ...summary(task),
      objectives: task.objectives.map(
        (oid) => deps.bank.objectives.byId.get(oid) ?? { id: oid, text: oid, chapters: [] },
      ),
      concepts: task.requiresConcepts.map((cid) => ({
        id: cid,
        title: deps.bank.conceptsById.get(cid)?.title ?? cid,
      })),
    })
  })

  app.get('/api/concepts/:id', (c) => {
    const concept = deps.bank.conceptsById.get(c.req.param('id'))
    if (concept === undefined) return c.json({ error: 'unknown concept' }, 404)
    return c.json({
      id: concept.id,
      title: concept.title,
      body: concept.body,
      sources: concept.sources,
      prerequisites: concept.prerequisites,
    })
  })

  app.post('/api/sessions', async (c) => {
    const raw: unknown = await c.req.json().catch(() => undefined)
    // Name the problem that actually happened. A missing or unparseable body
    // used to be reported as `unknown task: undefined`, which sends the reader
    // looking for a task id they never sent.
    if (!isRecord(raw)) {
      return c.json({ error: 'body must be a JSON object with taskId and mode' }, 400)
    }
    const body: Record<string, unknown> = raw

    const taskId = typeof body.taskId === 'string' ? body.taskId : undefined
    if (taskId === undefined) return c.json({ error: 'taskId must be a string' }, 400)
    const task = deps.bank.tasksById.get(taskId)
    if (task === undefined) return c.json({ error: `unknown task: ${taskId}` }, 400)
    if (!isSessionMode(body.mode)) {
      return c.json({ error: 'mode must be one of guided, practice, drill, exam' }, 400)
    }
    const mode = body.mode

    let scripts: TaskScripts
    try {
      scripts = await deps.loadScripts(task, deps.assertLib)
    } catch (e) {
      return c.json({ error: message(e) }, 500)
    }

    try {
      // Revert first. Running setup before the revert means the revert throws
      // the setup away, and the student gets an untouched machine with a prompt
      // that assumes otherwise.
      await deps.runtime.reset()
      const r = await deps.runtime.exec(scripts.setup)
      if (r.code !== 0) {
        return c.json({ error: `setup.sh exited ${r.code}: ${r.stderr || r.stdout}` }, 500)
      }
    } catch (e) {
      return c.json({ error: message(e) }, 500)
    }

    // `scripts.grade` is the assertion library concatenated with grade.sh
    // (harness.ts), so this counts over both. content/lib/assert.sh contains no
    // `ck` call today and a test pins that, because the number below is the
    // masked total the student is shown and an example `ck` added to the
    // library would inflate it for every task at once, silently.
    const s = deps.sessions.create(task.id, mode, countCheckpoints(scripts.grade), deps.now())
    return c.json(
      {
        id: s.id,
        taskId: task.id,
        title: task.title,
        prompt: task.prompt.trim(),
        mode,
        rung: s.rung,
        maxRung: maxRungFor(mode),
        checkpointTotal: s.checkpointTotal,
        timeBudget: task.timeBudget,
        rebootCheck: task.rebootCheck,
        /** What the task needs. `vmrun`-only tasks cannot be driven over ssh. */
        taskTransport: task.transport,
        /** What this server is actually using. */
        transport: deps.runtime.transportKind,
      },
      201,
    )
  })

  app.get('/api/sessions/:id', (c) => {
    const s = deps.sessions.get(c.req.param('id'))
    if (s === undefined) return c.json({ error: 'unknown session' }, 404)
    return c.json(view(s))
  })

  app.post('/api/sessions/:id/reset', async (c) => {
    const s = deps.sessions.get(c.req.param('id'))
    if (s === undefined) return c.json({ error: 'unknown session' }, 404)
    const task = deps.bank.tasksById.get(s.taskId)
    if (task === undefined) return c.json({ error: `unknown task: ${s.taskId}` }, 500)

    try {
      const scripts = await deps.loadScripts(task, deps.assertLib)
      // Revert then setup, in that order and for the same reason as session
      // creation: setup written before the revert is thrown away by it.
      await deps.runtime.reset()
      const r = await deps.runtime.exec(scripts.setup)
      if (r.code !== 0) {
        return c.json({ error: `setup.sh exited ${r.code}: ${r.stderr || r.stdout}` }, 500)
      }
    } catch (e) {
      return c.json({ error: message(e) }, 500)
    }

    // The rung is deliberately not rolled back. Disclosure already spent stays
    // spent - otherwise reset is a way to launder hints, and the rating derived
    // at finish stops describing the attempt that actually happened. What resets
    // is the machine and the clock.
    deps.sessions.restart(s.id, deps.now())
    return c.json(view(s))
  })

  app.post('/api/sessions/:id/hint', async (c) => {
    const s = deps.sessions.get(c.req.param('id'))
    if (s === undefined) return c.json({ error: 'unknown session' }, 404)
    const task = deps.bank.tasksById.get(s.taskId)
    if (task === undefined) return c.json({ error: `unknown task: ${s.taskId}` }, 500)

    try {
      deps.sessions.advanceRung(s.id)
    } catch (e) {
      // advanceRung threw because the session is already at its mode's cap.
      // 409 rather than 400: the request is well formed, the session just has
      // nothing left to give.
      return c.json({ error: message(e) }, 409)
    }

    const ctx = await contextFor(task)
    if (s.mode === 'guided') {
      const all: RungContent[] = RUNGS.map((r) => rungContent(r, ctx))
      return c.json({ rung: s.rung, content: rungContent(TOP_RUNG, ctx), all })
    }
    return c.json({ rung: s.rung, content: rungContent(s.rung, ctx) })
  })

  app.post('/api/sessions/:id/grade', async (c) => {
    const s = deps.sessions.get(c.req.param('id'))
    if (s === undefined) return c.json({ error: 'unknown session' }, 404)
    // Finishing is what unmasks the checkpoint names, so grading afterwards is
    // grading with the answer key in hand - and the rating derived at the next
    // finish would describe an attempt that never happened. 409 for the same
    // reason /hint uses it: the request is well formed, the session has nothing
    // left to give.
    if (s.phase === 'graded') {
      return c.json({ error: `session ${s.id} is finished; start a new one to attempt it again` }, 409)
    }
    const task = deps.bank.tasksById.get(s.taskId)
    if (task === undefined) return c.json({ error: `unknown task: ${s.taskId}` }, 500)

    let result: GradeResult
    try {
      const scripts = await deps.loadScripts(task, deps.assertLib)
      result = await deps.runtime.gradeTask(task, scripts.grade)
    } catch (e) {
      return c.json({ error: message(e) }, 500)
    }

    deps.sessions.record(s.id, result)
    // revealed: false - grading is repeatable, so in drill and exam mode this
    // must not turn into a way to read the answer key.
    return c.json({
      phase: s.phase,
      rung: s.rung,
      ...reportFor(s.mode, result, false, s.checkpointTotal),
    })
  })

  app.post('/api/sessions/:id/finish', (c) => {
    const s = deps.sessions.get(c.req.param('id'))
    if (s === undefined) return c.json({ error: 'unknown session' }, 404)
    // Finishing is terminal and happens once. Otherwise the measured attack
    // works: finish early to read which checkpoints failed, fix exactly those,
    // finish again, and collect a rating that claims a cold solve - in exam
    // mode, where the whole point is that the report is masked until the end.
    if (s.phase === 'graded') {
      return c.json({ error: `session ${s.id} is already finished` }, 409)
    }
    const result = s.result
    if (result === undefined) {
      return c.json({ error: 'nothing has been graded yet' }, 409)
    }

    const now = deps.now()
    deps.sessions.finish(s.id, now)
    const task = deps.bank.tasksById.get(s.taskId)
    const report = reportFor(s.mode, result, true, s.checkpointTotal)

    let rating: Rating | null = null
    if (s.mode !== 'guided') {
      rating = deriveRating({
        rungUsed: s.rung,
        passed: report.allPassed,
        anyPassed: report.passed > 0,
        durationS: Math.round((now - s.startedAt) / 1000),
        timeBudgetS: task?.timeBudget ?? 600,
        hadRegression: report.regressionCount > 0,
      })
    }

    return c.json({ ...view(s), report, rating })
  })

  return app
}

function view(s: SessionRecord) {
  return {
    id: s.id,
    taskId: s.taskId,
    mode: s.mode,
    rung: s.rung,
    maxRung: maxRungFor(s.mode),
    checkpointTotal: s.checkpointTotal,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    phase: s.phase,
  }
}
