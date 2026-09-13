import { Hono } from 'hono'
import { checkCoverage, type Bank } from '../engine/content/bank.ts'
import { ContentError } from '../engine/content/errors.ts'
import type { TaskSpec } from '../engine/content/task.ts'
import type { Corpus } from '../engine/corpus/corpus.ts'
import type { Edition } from '../engine/corpus/items.ts'
import { planDemos, runDemo, type DemoPlan } from '../engine/demo/antisolution.ts'
import { rungContent, type RungContent, type RungContext } from '../engine/disclosure/content.ts'
import { deriveRating, RUNGS, TOP_RUNG, type Rating } from '../engine/disclosure/ladder.ts'
import { guidedForObjective, guidedForTask } from '../engine/guided/select.ts'
import { finalVerdict, type GradeResult } from '../engine/grading/grader.ts'
import { enforceOffline, offlineRequiredFor, restoreNetwork } from '../engine/vm/offline.ts'
import type { AttemptRow, AttemptStore } from '../engine/store/attempts.ts'
import type { PredictedOutcome } from '../engine/store/schema.ts'
import type { StaleState, VmStateStore } from '../engine/store/vm-state.ts'
import type { TaskScripts } from '../engine/validate/harness.ts'
import { calibrationReport } from './calibration.ts'
import { DemoStore, demoView } from './demos.ts'
import type { LabRuntime } from './lab.ts'
import { conceptsView, overviewView } from './reports.ts'
import {
  checkpointCount,
  maxRungFor,
  reportFor,
  reportSuspect,
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
  /**
   * Where a finished attempt becomes history (Phase 2). Optional so a test can
   * exercise a route without a database: nothing in any served response depends on
   * it, so its absence changes behaviour in exactly one way — the attempt is not
   * recorded. `index.ts` always wires one.
   */
  attempts?: AttemptStore
  /**
   * Section 5.5's stale-state guard: what the guest is carrying, and whether a
   * grade against it can mean anything. Optional for the same reason `attempts` is,
   * and with the same shape of consequence — absent, no grade is refused and no
   * setup is recorded — so the two are the only optional deps here. `index.ts`
   * always wires one, on the same database handle.
   *
   * Optional rather than required is a real cost and it is worth naming: a guard
   * that can be left unwired is a guard that can be forgotten. What made it the
   * lesser cost is that the alternative was a required dep on a store, which every
   * caller and every test of every unrelated route would have to construct — and
   * `test/vm/e2e-exit-criterion.vm.test.ts` builds this object too. The guard is
   * pinned instead by `test/server/stale-state.test.ts`, which drives it through
   * the routes rather than trusting the type.
   */
  vmState?: VmStateStore
  /**
   * The extracted book corpus, loaded once at startup exactly as the bank is
   * (`index.ts`). Guided mode's two routes are the only readers.
   *
   * Optional for the same reason `attempts` and `vmState` are, and not for a better
   * one: `test/vm/e2e-exit-criterion.vm.test.ts` constructs an `AppDeps`, so a
   * required field here would break a test file this change does not own. Absent, the
   * guided routes answer 500 naming the missing wiring rather than an empty item
   * list — an empty list is a legitimate answer for an objective the book teaches
   * without exercises, and it must not double as "the server forgot to load the
   * corpus".
   */
  corpus?: Corpus
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

/**
 * Section 10.2's three answers, exhaustive by construction like `MODES` above.
 *
 * Declared here rather than built from `schema.ts`'s exported `OUTCOME_VALUES`
 * because that is an array — `includes` on it cannot narrow a `string` without a cast,
 * and a cast in a validator is the validator not validating. This record fails to
 * compile if a fourth outcome is added to the union, which is the same guarantee
 * `OUTCOME_VALUES` gives the database's `CHECK`.
 */
const OUTCOMES: Record<PredictedOutcome, true> = { pass: true, unsure: true, fail: true }

function isPredictedOutcome(v: unknown): v is PredictedOutcome {
  return typeof v === 'string' && Object.hasOwn(OUTCOMES, v)
}

/**
 * The two editions, validated rather than cast.
 *
 * `corpus/items.ts` keeps its own `EDITIONS` record private and exports only
 * `EDITION_ORDER`, so this is a third copy of a two-element list — worth it, because
 * the alternative at the `?primary=` query parameter is `as Edition`, and a cast
 * there would send `primary: 'r11'` into `guidedItem`, where it silently matches no
 * instance and promotes the alternate. The student would be shown the *other*
 * edition's walkthrough with no indication that their request was nonsense.
 */
const EDITIONS: Record<Edition, true> = { r9: true, r10: true }

function isEdition(v: unknown): v is Edition {
  return typeof v === 'string' && Object.hasOwn(EDITIONS, v)
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

/**
 * Section 5.5's refusal, as a response body: *"grading task X while task Y's setup
 * is live is refused, with an offer to reset."*
 *
 * `error` is the sentence a student reads, and it names both tasks — the store
 * writes that half, because which machine is live is the store's fact — plus the
 * offer, which is this layer's, because it is a route. `staleState` is the same
 * thing structured, so the client can render Reset as a button instead of parsing
 * the prose; `reset` is the route that already exists, already reverts, and already
 * reapplies *this* session's setup, so the offer is not a promise about work nobody
 * has written.
 */
function staleBody(stale: StaleState, sessionId: string) {
  return {
    error:
      `${stale.message}. Reset this session to revert the guest and reapply` +
      ` ${stale.requestedTask}'s setup.`,
    staleState: {
      requestedTask: stale.requestedTask,
      liveTask: stale.liveTask,
      currentSnapshot: stale.currentSnapshot,
      appliedAt: stale.appliedAt,
      reset: `/api/sessions/${sessionId}/reset`,
    },
  }
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()
  /**
   * In-process, created here rather than injected, because a demo is not evidence
   * and nothing outside this router reads one. See `demos.ts` for why it is not
   * persisted.
   */
  const demos = new DemoStore()

  /**
   * Every attempt the server can reach, oldest first.
   *
   * One `store.all()`, not a loop over `bank.tasks`. The loop was the first version
   * and it had a real hole: the store is append-only and deliberately outlives
   * content edits (`forTask`'s comment calls history a fact), so renaming or
   * renumbering a task orphans its rows while leaving them in the database — and a
   * per-task read cannot see them. `/api/overview`'s totals and the calibration
   * quadrants both understated, silently, in the direction that flatters. §9.4's
   * only job is to be believed when it says the user is not ready.
   */
  function allAttempts(): AttemptRow[] {
    return deps.attempts?.all() ?? []
  }

  /**
   * How many of them are clean, read from the `clean_attempts` view rather than by
   * filtering `drift.clean` off the rows above.
   *
   * The two agree today — `drift.clean` is decoded from the same generated column the
   * view filters on — and asking the view anyway is the point: `clean` is the
   * schema's definition of usable evidence, and there must be exactly one place that
   * decides it. A filter here would be a second one, and the first time the generated
   * column's expression changed, the dashboard would be the copy nobody remembered.
   */
  function cleanAttemptCount(): number {
    return deps.attempts?.cleanCount() ?? 0
  }

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

  /**
   * Revert the guest, apply the task's `setup.sh`, and record what the guest is
   * left carrying (section 5.5). Returns the message for a 500, or `undefined` when
   * the guest is ready. Throws whatever the transport throws; both call sites
   * already catch.
   *
   * One function rather than two copies because the *order* of the three writes is
   * the guard, and a second copy is a second chance to get it wrong.
   */
  async function applySetup(task: TaskSpec, scripts: TaskScripts): Promise<string | undefined> {
    // Recorded before the revert, not after a failure. From here until setup.sh
    // exits 0 the guest is neither the previous task's machine nor this one's, so
    // every way out of this function that is not the last line leaves a row saying
    // exactly that — including a thrown transport error and a process that dies
    // mid-revert, neither of which reaches a failure handler. See
    // `VmStateStore.unknown`.
    deps.vmState?.unknown()
    // Revert first. Running setup before the revert means the revert throws the
    // setup away, and the student gets an untouched machine with a prompt that
    // assumes otherwise.
    await deps.runtime.reset()
    const r = await deps.runtime.exec(scripts.setup)
    // A non-zero exit leaves the clean snapshot plus however much of setup.sh ran,
    // which is a machine nothing can describe, so the unknown row above stands and
    // the grade guard will refuse against it.
    if (r.code !== 0) return `setup.sh exited ${r.code}: ${r.stderr || r.stdout}`
    deps.vmState?.applied(task.id, deps.runtime.snapshot)
    return undefined
  }

  /**
   * Put the guest's default route into whatever state this mode calls for
   * (section 10.3). Returns the warning to show the student, or `undefined` when
   * the guest is in the state the mode claims.
   *
   * Drill and exam drop the route, so `man` and /usr/share/doc become the path of
   * least resistance the way they are on the real exam. An honest habit device,
   * not a cage — it cannot stop a browser on the host and does not pretend to
   * (docs/offline-mode.md). Practice and guided *restore* rather than skip: the
   * previous session on this guest may have been an exam.
   *
   * Called after `applySetup`, never before, at both call sites. A `setup.sh` may
   * install from the ISO-backed repo, and §4.2's "packages still work offline" is
   * the untested claim this whole feature leans on, so setup runs with the route
   * still up. It also has to be after the *revert* for a harder reason: the revert
   * restores the running kernel, which brings the default route back and clears
   * `/run` — so a guest that went offline at session start is online again after
   * `/reset`, and re-applying is the only thing that keeps the mode's promise true
   * for the rest of the attempt.
   *
   * Nothing here refuses the session. Both calls report through `ok` rather than
   * throwing, and a guest that would not go offline is a degraded session, not a
   * lost one — refusing to open it would cost real practice to protect a nicety.
   * Silence is the one thing not allowed: a student told they are offline while
   * they are not has been lied to, and will sit a rehearsal learning the habit
   * this feature exists to build against.
   */
  async function applyNetworkMode(mode: SessionMode): Promise<string | undefined> {
    const wantOffline = offlineRequiredFor(mode)
    try {
      const outcome = wantOffline
        ? await enforceOffline(deps.runtime)
        : await restoreNetwork(deps.runtime)
      if (outcome.ok) return undefined
      const why = outcome.errors.join('; ')
      return wantOffline
        ? `offline mode could not be applied, so this ${mode} session still has internet access: ${why}`
        : `the guest's network could not be restored, so this ${mode} session may still be offline: ${why}`
    } catch (e) {
      // Only a transport-level throw reaches here. Same policy: report, do not refuse.
      return `the guest's network state could not be read, so whether this ${mode} session is offline is unknown: ${message(e)}`
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

  /**
   * The Concepts screen's whole list (spec section 11).
   *
   * `checkCoverage` is called per request rather than cached at startup. The bank is
   * immutable once loaded, so the answer cannot change between requests — the reason
   * to recompute is that a cache would be a second representation of the bank that
   * *could* diverge, in exchange for saving a traversal whose own author measured it
   * as free ("Forty cards make the rebuild free"). Registered before
   * `/api/concepts/:id`; Hono matches on the literal path, so the two do not compete.
   */
  app.get('/api/concepts', (c) => c.json(conceptsView(deps.bank, checkCoverage(deps.bank))))

  /**
   * The Dashboard's counts.
   *
   * There is no readiness percentage here, deliberately — see `reports.ts` for the
   * section 9.4 argument. Everything returned is a count of something on disk or in
   * the database, so no field can flatter.
   */
  app.get('/api/overview', (c) =>
    c.json(
      overviewView({
        bank: deps.bank,
        coverage: checkCoverage(deps.bank),
        attempts: allAttempts(),
        cleanAttempts: cleanAttemptCount(),
        vmState: deps.vmState,
      }),
    ),
  )

  /**
   * Section 10.2's 2×2, and the persistence cross-reference.
   *
   * A 200 with every count at zero and `persistence.clustered: null` is the correct
   * answer on a fresh database: the question was well formed and the honest answer is
   * "nothing is known yet". `calibration.ts` says why that is `null` and not `false`.
   */
  app.get('/api/calibration', (c) => c.json(calibrationReport(allAttempts())))

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

  /**
   * `?primary=r9|r10`, or a message saying what was sent.
   *
   * Returns the option object rather than the edition so the two absent cases stay
   * distinguishable: no parameter means "use `select.ts`'s default", which is not the
   * same as passing `r9` explicitly today and would stop being the same the day the
   * default moves to RHCSA 10.
   */
  function primaryFor(raw: string | undefined): { opts: { primary?: Edition } } | { error: string } {
    if (raw === undefined) return { opts: {} }
    if (!isEdition(raw)) return { error: `primary must be r9 or r10, not ${JSON.stringify(raw)}` }
    return { opts: { primary: raw } }
  }

  /**
   * Guided walkthroughs for one graded task (spec section 9.1).
   *
   * Three distinct failures, and keeping them distinct is the whole reason this route
   * has more than one guard:
   *
   * - **404** — no such task. The client asked about something that does not exist.
   * - **400** — `?primary=` is not an edition. The client sent something wrong.
   * - **500** — `guidedForTask` threw a `ContentError`, which it does for exactly one
   *   reason: the task names an objective no taxonomy defines. That is the *content*
   *   being wrong, not the request, and `checkCoverage` already reports it as
   *   "maps to unknown objective" — so a bank that reaches this line skipped
   *   `npm run validate`. Answering 404 or an empty list here would hide an authoring
   *   defect behind a plausible-looking short list, which is the failure mode
   *   `select.ts` chose to throw in order to prevent.
   *
   * An empty `items` array on a 200 is a real answer and not a fourth failure: it
   * means the book teaches this task's chapters without exercises. Measured
   * 2026-09-13, no objective in the bank is in that state, and three chapters (1, 27,
   * 28) have no exercises in either edition, so it is one objective away from
   * happening.
   */
  app.get('/api/guided/task/:area/:slug', (c) => {
    const corpus = deps.corpus
    if (corpus === undefined) return c.json({ error: 'the corpus is not loaded on this server' }, 500)
    const id = `${c.req.param('area')}/${c.req.param('slug')}`
    const task = deps.bank.tasksById.get(id)
    if (task === undefined) return c.json({ error: `unknown task: ${id}` }, 404)

    const primary = primaryFor(c.req.query('primary'))
    if ('error' in primary) return c.json({ error: primary.error }, 400)

    try {
      return c.json({ items: guidedForTask(corpus, task, deps.bank.objectives, primary.opts) })
    } catch (e) {
      // A ContentError is the bank lying about itself; anything else is a bug here.
      // Both are 500s, and both name the task, because the reader's next step in
      // either case is to run the validator against it.
      if (e instanceof ContentError) {
        return c.json({ error: `${e.where}: ${e.problems.join('; ')}` }, 500)
      }
      return c.json({ error: message(e) }, 500)
    }
  })

  /**
   * Guided walkthroughs for one objective. No 500 arm: `guidedForObjective` takes the
   * resolved `Objective` rather than an id, so the unknown-id case is this route's
   * 404 and there is no way for it to throw a `ContentError`.
   */
  app.get('/api/guided/objective/:id', (c) => {
    const corpus = deps.corpus
    if (corpus === undefined) return c.json({ error: 'the corpus is not loaded on this server' }, 500)
    const id = c.req.param('id')
    const objective = deps.bank.objectives.byId.get(id)
    if (objective === undefined) return c.json({ error: `unknown objective: ${id}` }, 404)

    const primary = primaryFor(c.req.query('primary'))
    if ('error' in primary) return c.json({ error: primary.error }, 400)

    return c.json({ items: guidedForObjective(corpus, objective, primary.opts) })
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
      const failed = await applySetup(task, scripts)
      if (failed !== undefined) return c.json({ error: failed }, 500)
    } catch (e) {
      return c.json({ error: message(e) }, 500)
    }

    const offlineWarning = await applyNetworkMode(mode)

    // `scripts.grade` is the assertion library concatenated with grade.sh
    // (harness.ts), so this counts over both. content/lib/assert.sh contains no
    // `ck` call today and a test pins that, because the number below is the
    // masked total the student is shown and an example `ck` added to the
    // library would inflate it for every task at once, silently.
    const count = checkpointCount(scripts.grade)

    // Zero is the one count that cannot be salvaged by withholding later. Every
    // guard in `reportFor` is a comparison against this number, and at zero
    // `incomplete` is `size < 0` — false for every possible run — so a grader
    // whose whole body was swallowed reports a pass over an untouched machine.
    // Refusing here is safe in the way refusing at grade time would not be: no
    // work exists yet, so nothing is trapped and nothing is lost. It is also the
    // only refusal in this fix — a *disputed* count still opens a session, because
    // withholding the verdict costs the student nothing and refusing costs them the
    // practice.
    if (count.total === 0) {
      return c.json(
        {
          error:
            `${task.id}: its grade script declares no checkpoints, so a grading run could not be ` +
            `scored against anything. Run \`npm run lint:content\` — a grader that counted 0 is a ` +
            `broken grader, not an easy task.`,
        },
        500,
      )
    }

    const s = deps.sessions.create(task.id, mode, count, deps.now())
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
        /**
         * Whether the guest's default route is gone for this mode (§10.3). Stated
         * even when it is `false`, because the student needs to know which of the
         * two situations they are in before they reach for `curl`.
         */
        offline: offlineRequiredFor(mode),
        /** Present only when the line above could not be made true. */
        ...(offlineWarning === undefined ? {} : { offlineWarning }),
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
    // A finished attempt has a clock that has already stopped. `restart` moves
    // `startedAt` forward and leaves `endedAt` where it was, so anything reading
    // `endedAt - startedAt` as time spent gets a negative number. The comment
    // below already argues that a reset must not make the report describe an
    // attempt that did not happen; that applies to the clock as much as to the
    // rung. There is no learning use for reverting a finished session's VM -
    // starting a new session is that.
    if (s.phase === 'graded') {
      return c.json({ error: `session ${s.id} is finished; start a new one to attempt it again` }, 409)
    }
    const task = deps.bank.tasksById.get(s.taskId)
    if (task === undefined) return c.json({ error: `unknown task: ${s.taskId}` }, 500)

    try {
      const scripts = await deps.loadScripts(task, deps.assertLib)
      const failed = await applySetup(task, scripts)
      if (failed !== undefined) return c.json({ error: failed }, 500)
    } catch (e) {
      return c.json({ error: message(e) }, 500)
    }

    // Re-applied, not assumed to have survived. `applySetup` reverted the guest to
    // the powered-on `clean` snapshot, which restores the running kernel: the
    // default route is back and `/run/rhcsa-offline.state` is gone. Without this
    // line, one Reset silently hands an exam-mode student the internet for the
    // rest of their attempt, and the badge would still say offline.
    const offlineWarning = await applyNetworkMode(s.mode)

    // The rung is deliberately not rolled back. Disclosure already spent stays
    // spent - otherwise reset is a way to launder hints, and the rating derived
    // at finish stops describing the attempt that actually happened. What resets
    // is the machine and the clock.
    deps.sessions.restart(s.id, deps.now())
    return c.json({
      ...view(s),
      offline: offlineRequiredFor(s.mode),
      ...(offlineWarning === undefined ? {} : { offlineWarning }),
    })
  })

  // Unlike `/reset`, `/grade` and `/finish`, this route stays open after a
  // finish, deliberately. Nothing stored can be contradicted by a later rung:
  // `rating` below is a local, derived once from the `rungUsed` captured at that
  // moment and never persisted, and `/finish` is already 409 on a second call. So
  // what is left is disclosure, and the mode caps are what keep that honest -
  // exam stops at rung 2 and drill at 3, so neither can reach solution content
  // after finishing. In practice mode reaching rung 5 right after the attempt is
  // scored is the product working: this app exists so the user never has to open
  // the book, and that is the moment they most want the whole answer.
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

  /**
   * Section 10.2's one click, before grading: *"Before you hit grade: will this
   * pass?"*
   *
   * ## The ordering rule, which is the only thing this route really enforces
   *
   * A prediction recorded *after* the student has seen a verdict is worse than no
   * prediction at all. Absent, an attempt is simply counted out of the quadrants.
   * Contaminated, it lands in a specific quadrant — and section 10.2's quadrants are
   * not a score, they are a **diagnosis with opposite remedies**: overconfident means
   * "stop studying, drill verification habits", underconfident means "you know this,
   * move faster". A student who reads the verdict and then clicks the matching answer
   * fills the calibrated cells, which reads as "your self-assessment is reliable" and
   * suppresses the one intervention they needed. So the guard is not tidiness; it is
   * the difference between a diagnosis and a flattering one, which is the same line
   * section 9.4 draws about readiness.
   *
   * `sawVerdict` — not `phase`, and not `s.result` — is what that guard reads, because
   * `restart` deletes `result` and leaves `phase` active. Grade, reset, predict would
   * otherwise be a legal *first* prediction made with the previous verdict in hand.
   * See `SessionRecord.sawVerdict`, which is monotonic for exactly this reason. A
   * finished session is covered by the same check: `/finish` refuses without a
   * result, and a result implies a verdict was seen.
   *
   * ## A second, different prediction is refused
   *
   * Re-posting the *same* value is 200 and a no-op — a double-clicked button must not
   * be an error. A *different* value is 409, because between the two clicks the
   * student may have spent a `/hint`, and a prediction made after new information is
   * a different measurement wearing the same name. Overwriting would silently record
   * the later, better-informed guess as though it were the cold one, which is the
   * same contamination as predicting after the verdict, only smaller. Refusing keeps
   * the first click — the cold one — which is the one section 10.2 asked for.
   *
   * 409 throughout rather than 400: the body is well formed and the student did
   * nothing wrong; it is the *session* that has nothing left to give. Same idiom as
   * `/hint`'s rung cap and `/grade`'s stale-state refusal.
   */
  app.post('/api/sessions/:id/predict', async (c) => {
    const s = deps.sessions.get(c.req.param('id'))
    if (s === undefined) return c.json({ error: 'unknown session' }, 404)

    const raw: unknown = await c.req.json().catch(() => undefined)
    if (!isRecord(raw)) {
      return c.json({ error: 'body must be a JSON object with predicted' }, 400)
    }
    if (!isPredictedOutcome(raw.predicted)) {
      return c.json({ error: 'predicted must be one of pass, unsure, fail' }, 400)
    }
    const predicted = raw.predicted

    if (s.sawVerdict) {
      return c.json(
        {
          error:
            `session ${s.id} has already been graded, so a prediction recorded now would not be a` +
            ' prediction. Start a new session to record one.',
        },
        409,
      )
    }

    const existing = s.predictedOutcome
    if (existing !== undefined && existing !== predicted) {
      return c.json(
        {
          error:
            `session ${s.id} already predicted "${existing}"; a second, different prediction is not` +
            ' recorded, because the first one is the cold one.',
          predicted: existing,
        },
        409,
      )
    }

    deps.sessions.predict(s.id, predicted)
    return c.json({ id: s.id, predicted, calibration: '/api/calibration' })
  })

  app.post('/api/sessions/:id/grade', async (c) => {
    const s = deps.sessions.get(c.req.param('id'))
    if (s === undefined) return c.json({ error: 'unknown session' }, 404)
    // Finishing is what unmasks the checkpoint names, so grading afterwards is
    // grading with the answer key in hand - and the rating derived at the next
    // finish would describe an attempt that never happened. 409 for the same
    // reason /hint's rung cap uses it - the request is well formed, the session
    // has nothing left to give - and not because /hint refuses a finished
    // session, which it deliberately does not.
    if (s.phase === 'graded') {
      return c.json({ error: `session ${s.id} is finished; start a new one to attempt it again` }, 409)
    }
    const task = deps.bank.tasksById.get(s.taskId)
    if (task === undefined) return c.json({ error: `unknown task: ${s.taskId}` }, 500)

    // Section 5.5, and the one refusal in this app that happens *before* the thing
    // it is protecting against runs. Grading this task while another task's setup.sh
    // is live measures correct work against the wrong machine, and what the student
    // then reads is pages of failures they cannot explain — so the grader's output
    // is itself the harm, and reporting the staleness alongside it would be too
    // late. Nothing below this line runs: no script is loaded, no grade.sh executes.
    //
    // 409 for the same reason the phase check above uses it — the request is well
    // formed and it is the *guest* that has nothing to give — and never a 400: the
    // student did nothing wrong.
    const stale = deps.vmState?.staleFor(s.taskId)
    if (stale !== undefined) return c.json(staleBody(stale, s.id), 409)

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
      ...reportFor(s.mode, result, false, s.checkpointTotal, s.missingDeclared),
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
    const report = reportFor(s.mode, result, true, s.checkpointTotal, s.missingDeclared)

    // The rating is withheld on a report that cannot support a claim, in either
    // direction. It used to be derived from `report.allPassed` with nothing
    // consulted about whether the report was trustworthy — and `anyPassed` and
    // `hadRegression` come off that same report, so guarding only the `passed`
    // argument would still let a truncated or deflated run write a rating. The
    // screen has withheld on these signals since Task 24; this is the half that
    // did not, which meant the rail and the rating could contradict each other off
    // one report.
    //
    // `null` is already the shape guided mode produces and the client already
    // renders it as "no rating", so withholding needs no new state anywhere. What
    // it must never do is withhold the **exit**: `/finish` has already ended the
    // attempt above, and it still answers 200 with the report, so the session
    // closes either way. A student must always be able to finish.
    let rating: Rating | null = null
    if (s.mode !== 'guided' && !reportSuspect(report)) {
      rating = deriveRating({
        rungUsed: s.rung,
        passed: report.allPassed,
        anyPassed: report.passed > 0,
        durationS: Math.round((now - s.startedAt) / 1000),
        timeBudgetS: task?.timeBudget ?? 600,
        hadRegression: report.regressionCount > 0,
      })
    }

    // The attempt becomes history here and nowhere else. `/finish` is the one
    // terminal transition — a second call is the 409 above — so this cannot
    // double-write, and it is also the first line at which both the report and
    // the rating exist. `/grade` deliberately does not record: a student may grade
    // as often as they like, and each of those is the same attempt.
    //
    // The store derives its own drift flags from `report`, so the withholding
    // above and the row written here cannot disagree: a suspect report reaches the
    // database marked suspect and with `rating` null, and the schema refuses the
    // row outright if that ever stops being true.
    //
    // Wrapped, because a failed write must not withhold the exit. The attempt has
    // already ended, the student is owed their report, and the whole design note on
    // `/finish` above is that a session must always be closeable. A lost row is
    // logged loudly rather than turned into a 500 over work that is already done.
    try {
      deps.attempts?.record({
        taskId: s.taskId,
        objectiveIds: task?.objectives ?? [],
        mode: s.mode,
        startedAt: s.startedAt,
        finishedAt: now,
        rungUsed: s.rung,
        verdictA: result.verdictA,
        verdictB: result.verdictB,
        finalVerdict: finalVerdict(result),
        report,
        rating,
        // Section 10.2's click lands on *this* row, which is the only row the
        // verdict lands on — that co-location is the whole measurement. A quadrant
        // is `predicted_outcome` against what `checkpoints_passed` says actually
        // happened, and computing it needs both on one row of one table; a
        // prediction stored anywhere else would have to be joined back by
        // timestamp, and a session that was graded three times has three
        // timestamps and one prediction.
        //
        // `undefined` when the student did not click, which the store turns into a
        // `NULL` column — the third state, not a default. `calibration.ts` counts
        // those attempts out rather than guessing at what they would have said.
        predictedOutcome: s.predictedOutcome,
      })
    } catch (e) {
      console.error(`[finish] session ${s.id} was not recorded: ${message(e)}`)
    }

    return c.json({ ...view(s), report, rating })
  })

  /**
   * The menu section 7.2 describes: *"Here are three ways this looks correct but
   * isn't. Want to see one?"*
   *
   * Read-only and cheap — it reads the fixture files and their headers, and touches
   * no guest. So it is safe to call while a session is live, which matters because
   * this is what the finish screen renders.
   *
   * `problems` is returned alongside rather than folded into an error, for
   * `planDemos`' reason: one anti-solution with a malformed header must not empty the
   * menu, and it must not vanish from it either.
   */
  app.get('/api/tasks/:area/:slug/antisolutions', async (c) => {
    const id = `${c.req.param('area')}/${c.req.param('slug')}`
    const task = deps.bank.tasksById.get(id)
    if (task === undefined) return c.json({ error: `unknown task: ${id}` }, 404)

    let scripts: TaskScripts
    try {
      scripts = await deps.loadScripts(task, deps.assertLib)
    } catch (e) {
      return c.json({ error: message(e) }, 500)
    }

    const { plans, problems } = planDemos(task, scripts)
    return c.json({
      taskId: task.id,
      rebootCheck: task.rebootCheck,
      demos: plans.map((p) => ({
        name: p.name,
        kind: p.kind,
        headline: p.headline,
        expectedFlips: p.flips,
        /** `id@phase`, the form the lint prints, so a menu entry is greppable in content. */
        declared: p.declared.map((d) => `${d.id}@${d.phase}`),
        start: '/api/demos',
      })),
      problems,
    })
  })

  /**
   * Start a demonstration. Answers **202** with a resource id and the URL to poll.
   *
   * The 202-and-poll shape is argued in `demos.ts`; the short version is that this
   * request would otherwise stay open across a revert, a `setup.sh`, an
   * anti-solution, two grading runs and a **deliberate reboot of the guest**, and a
   * client that times out halfway through cannot then tell the student why their next
   * grade is refused. The existing session routes are the model: work that outlives
   * its request becomes a resource with a phase.
   *
   * Status codes, and what each one is protecting:
   *
   * - **400** — the body is not `{ sessionId, name }`.
   * - **404** — no such session, or the task has no anti-solution by that name.
   * - **409, the attempt is not over** — `phase: 'graded'` is set at `/finish`, not at
   *   `/grade`, and that is the phase required here. Grading is repeatable and leaves
   *   the session live, so a session that has merely been graded is one the student may
   *   still be working on. Section 7.2 places this *after* a task completes,
   *   and there is a hard reason as well as a pedagogical one: the demo reverts the
   *   guest and runs a wrong solution on it, so offering it mid-attempt is offering to
   *   destroy work in progress. Refusing here means a student cannot ask for a
   *   demonstration of the mistake they are currently in the middle of making, which
   *   is a real cost, and it is the smaller one.
   * - **409, a demo is already running** — one guest. Two concurrent demos revert the
   *   machine out from under each other and produce two verdicts describing neither.
   * - **500** — the fixtures could not be loaded, or the header is malformed. Content,
   *   not request.
   */
  app.post('/api/demos', async (c) => {
    const raw: unknown = await c.req.json().catch(() => undefined)
    if (!isRecord(raw)) return c.json({ error: 'body must be a JSON object with sessionId and name' }, 400)
    const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : undefined
    const name = typeof raw.name === 'string' ? raw.name : undefined
    if (sessionId === undefined) return c.json({ error: 'sessionId must be a string' }, 400)
    if (name === undefined) return c.json({ error: 'name must be a string' }, 400)

    const s = deps.sessions.get(sessionId)
    if (s === undefined) return c.json({ error: 'unknown session' }, 404)
    if (s.phase !== 'graded') {
      return c.json(
        {
          error:
            `session ${s.id} is still active. A demonstration reverts the guest and runs a` +
            ' deliberately wrong solution on it, so it is offered after the attempt is finished.',
        },
        409,
      )
    }

    const active = demos.active()
    if (active !== undefined) {
      return c.json(
        {
          error: `demo ${active.id} (${active.taskId} ${active.name}) is still running on the guest`,
          demo: `/api/demos/${active.id}`,
        },
        409,
      )
    }

    const task = deps.bank.tasksById.get(s.taskId)
    if (task === undefined) return c.json({ error: `unknown task: ${s.taskId}` }, 500)

    let scripts: TaskScripts
    try {
      scripts = await deps.loadScripts(task, deps.assertLib)
    } catch (e) {
      return c.json({ error: message(e) }, 500)
    }

    const { plans, problems } = planDemos(task, scripts)
    const plan = plans.find((p) => p.name === name)
    if (plan === undefined) {
      // A name the client made up is a 404. A name that exists on disk but whose
      // header would not parse is not in `plans` either, so it is separated out here
      // and reported as the content defect it is — otherwise a broken header looks
      // to the client exactly like a typo.
      const broken = problems.filter((p) => p.includes(name))
      if (broken.length > 0) return c.json({ error: broken.join('; ') }, 500)
      return c.json({ error: `${task.id} has no anti-solution named ${name}` }, 404)
    }

    const record = demos.create(task.id, plan, deps.now())
    // Deliberately not awaited: this is the whole point of the 202. `void` marks it,
    // and the promise cannot reject — every path inside is caught and settles the
    // record — so this cannot become an unhandled rejection that takes the process
    // down mid-demo.
    void (async (): Promise<void> => {
      try {
        const result = await runDemo({
          task,
          scripts,
          plan,
          runtime: deps.runtime,
          // Section 5.5, at both ends. A demo leaves the guest carrying this task's
          // setup plus a wrong solution, which no `vm_state` row can describe, so the
          // next `/grade` must be refused until a reset. See `RunDemoOptions`.
          markUnknown: () => deps.vmState?.unknown(),
        })
        if (result.ok) demos.finish(record.id, deps.now(), result.outcome)
        else demos.fail(record.id, deps.now(), result.failure)
      } catch (e) {
        demos.crash(record.id, deps.now(), message(e))
      }
    })()

    return c.json({ ...demoView(record), poll: `/api/demos/${record.id}` }, 202)
  })

  /**
   * Poll a demonstration. 200 in every phase, including `running` — "not finished
   * yet" is the answer to a well-formed question, not an error — so a client polls
   * this one URL and switches on `phase`.
   */
  app.get('/api/demos/:id', (c) => {
    const record = demos.get(c.req.param('id'))
    if (record === undefined) return c.json({ error: 'unknown demo' }, 404)
    return c.json(demoView(record))
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
