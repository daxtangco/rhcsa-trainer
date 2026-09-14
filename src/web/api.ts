// Type-only, so `verbatimModuleSyntax` erases it and no server code reaches the
// bundle. One definition: a mode the ladder gains must not be a mode the picker
// silently cannot offer, and a phase the session gains must not be a phase the
// screen compares against with a typo nobody catches - `phase: string` would let
// `phase === 'gradedd'` compile and silently never match.
import type { SessionMode, SessionPhase } from '../server/session.ts'
export type { SessionMode, SessionPhase }
// Same reasoning, one layer further in: the guided walkthrough the Learn screen
// renders is `src/engine/guided/select.ts`'s own type, imported rather than
// restated. A restated copy is a second definition of a 5-field nested shape
// that no compiler compares, and the field this screen would get wrong is
// `alternate` - optional on the engine's type for the 12 slots of 96 that have
// no second edition. Type-only, so `verbatimModuleSyntax` erases it and the
// engine's loaders (which read the filesystem) never reach the bundle;
// `typedStepMatches` is imported as a value in the walkthrough, and that one
// module has no Node built-ins by design.
import type { GuidedItem, GuidedText } from '../engine/guided/select.ts'
import type { GuidedStep } from '../engine/guided/steps.ts'
import type { Edition } from '../engine/corpus/items.ts'
export type { Edition, GuidedItem, GuidedStep, GuidedText }

export interface TaskSummary {
  id: string
  title: string
  chapter: number
  scope: 'exam-objective' | 'instrumental'
  difficulty: number
  timeBudget: number
  weight: 'low' | 'medium' | 'high'
  rebootCheck: boolean
  /**
   * **The task's** transport: which control plane this lab requires. The field
   * of the same name on `/api/health` and on `StartedSession` means the
   * opposite — the server's live transport — so the two are never
   * interchangeable. The name is kept as the wire spells it (`summary()` in
   * `src/server/app.ts`) because a type that renames a field it does not remap
   * is a type that lies; `StartedSession` below carries both meanings and
   * distinguishes them by name, which is where the comparison actually happens.
   */
  transport: 'ssh' | 'vmrun'
  objectives: string[]
}

/**
 * What `GET /api/tasks` returns. `chapters` is every chapter the *book* has, which
 * is a strictly larger set than the chapters `tasks` covers — that difference is
 * the authoring backlog, and it is the reason this route returns an object rather
 * than the bare array it used to. It is `[]` when the server has no corpus loaded,
 * and a caller that gets `[]` must not substitute a guessed range: it knows the
 * chapters it has tasks for and nothing else.
 */
export interface TaskListView {
  tasks: TaskSummary[]
  chapters: number[]
}

export interface StartedSession {
  id: string
  taskId: string
  title: string
  prompt: string
  mode: SessionMode
  rung: number
  maxRung: number
  checkpointTotal: number
  timeBudget: number
  rebootCheck: boolean
  /** What the task needs. A `vmrun`-only task cannot be driven over ssh. */
  taskTransport: 'ssh' | 'vmrun'
  /** What the server is actually using. The same value `/api/health` reports. */
  transport: 'ssh' | 'vmrun'
  /**
   * Whether the guest's default route was dropped for this mode (§10.3: drill and
   * exam). Sent for every mode, not only the offline ones, because the student
   * needs to know which situation they are in before they reach for `curl`.
   */
  offline: boolean
  /**
   * Present only when the guest is not in the state `offline` claims. The
   * session still opened - a degraded lab is better than no lab - so this is the
   * only thing standing between the student and a false belief about their own
   * machine, and the rail shows it as a warning rather than a note.
   */
  offlineWarning?: string
}

/**
 * What the session routes hand back: the record itself, without the task fields
 * that only `POST /api/sessions` bothers to inline. `/reset` returns this.
 */
export interface SessionView {
  id: string
  taskId: string
  mode: SessionMode
  rung: number
  maxRung: number
  checkpointTotal: number
  startedAt: number
  endedAt?: number
  /**
   * `'graded'` is terminal: `POST /finish` sets it, and both `/finish` and
   * `/reset` answer 409 afterwards. This, not the rating, is what the screen
   * reads to decide an attempt is over — `rating` is null for guided mode by
   * design (`app.ts`'s `if (s.mode !== 'guided')`), so keying anything to it
   * makes the guard mode-dependent.
   */
  phase: SessionPhase
  /**
   * Only `/reset` fills these in, and it has to: the revert restores the running
   * kernel, so the guest comes back online and the server re-applies the mode's
   * network state afterwards. That second attempt can fail where the first
   * succeeded, so the answer travels back with the reset rather than being
   * remembered from session start. `GET /api/sessions/:id` omits both.
   */
  offline?: boolean
  offlineWarning?: string
}

/** One concept card, named but not opened. `/api/tasks/:area/:slug` returns these. */
export interface ConceptRef {
  id: string
  title: string
}

/**
 * Only the fields the Lab screen reads. The route returns the full summary plus
 * expanded objectives as well; narrowing here keeps the client from claiming to
 * know a shape it never looks at.
 */
export interface TaskDetail {
  id: string
  title: string
  concepts: ConceptRef[]
}

export interface ConceptCard {
  id: string
  title: string
  body: string
}

export interface CheckpointView {
  id: string
  desc: string
  status: 'pass' | 'fail' | 'skip'
}

export interface GradeReportView {
  /** Distinct checkpoint ids that passed. Not a line count. */
  passed: number
  /** Distinct checkpoint ids the verdict carried. Not a line count. */
  total: number
  /**
   * How many distinct ids the grade script declares, counted before anything
   * ran. `total` below it means a truncated grader; `total` above it means the
   * counter under-counted, which is the only runtime signal of that bug class.
   */
  expectedTotal: number
  /** The grader emitted fewer distinct ids than the script declares. */
  incomplete: boolean
  /**
   * `expectedTotal` is contradicted by the grade script's own `# baseline-fail:`
   * and `# unprobed-invariant:` headers, which name ids the counter never saw. So
   * the number this run was scored against is deflated, and `incomplete` cannot
   * see it — a deflated count makes every other signal on this report read clean.
   * Required, not optional: the server sends it on every report.
   */
  countDisputed: boolean
  /**
   * Which declared ids the counter missed, masked like `checkpoints`. For the
   * grader's author reading the JSON; the rail renders no ids here, because a
   * student cannot act on one.
   */
  disputedIds?: string[]
  /**
   * Final. `reportFor` already computes this as `allPassed(v) && !incomplete`,
   * so re-ANDing `!incomplete` here would state a false thing about the contract
   * and leave the next person to change one side with a double negation.
   */
  allPassed: boolean
  rebooted: boolean
  rebootError?: string
  regressionCount: number
  checkpoints?: CheckpointView[]
  regressions?: string[]
}

/**
 * `POST /api/sessions/:id/grade` spreads the report into an envelope carrying
 * the session's phase and rung. `finish`'s `report` is the bare report, which is
 * why these are two types and not one with optional fields: an optional field
 * that always arrives is as much of a lie as one that never does.
 */
export interface GradeResponse extends GradeReportView {
  phase: SessionPhase
  rung: number
}

export interface FinishResponse extends SessionView {
  report: GradeReportView
  rating: string | null
}

export interface RungContentView {
  rung: number
  kind: 'prompt' | 'nudge' | 'concepts' | 'sketch' | 'solution'
  title: string
  body: string
}

export interface HintResponse {
  rung: number
  content: RungContentView
  all?: RungContentView[]
}

/**
 * One card in the concept graph, as `GET /api/concepts` lists them.
 *
 * `taught` and `reachable` are the two facts the Concepts screen can state, and
 * both are facts about **the bank**, not about the student: `taught` means some
 * task's `requires_concepts` names this card, `reachable` means it is that or a
 * transitive prerequisite of one (`CoverageReport` in
 * `src/engine/content/bank.ts` computes both). Section 11 asks for four states,
 * and the other two — needed-again, demonstrated-cold — are facts about the
 * student that live in `concept_state.times_needed` and
 * `concept_state.demonstrated_cold`. `src/engine/store/schema.ts` says in as many
 * words that nothing writes that table yet, so those two are absent from this
 * type rather than present and always zero. A zero that is really "unmeasured"
 * is the one thing section 9.4 forbids this app from rendering.
 */
export interface ConceptNode {
  id: string
  title: string
  area: string
  objectives: string[]
  prerequisites: string[]
  /** Some task's `requires_concepts` names it, so the student can be shown it. */
  taught: boolean
  /** It, or a transitive prerequisite of one that is. Stricter than `taught`. */
  reachable: boolean
  requiredByTasks: string[]
}

export interface ConceptGraphView {
  concepts: ConceptNode[]
  /**
   * Authoring bugs: a `requires_concepts` or prerequisite that does not resolve.
   * Rendered first and loudly on the Concepts screen — risk R7's mitigation is
   * that a missing card is *visible, not silent*, and a problem list folded into
   * a corner is silent.
   */
  problems: string[]
}

/**
 * What the guest is known to be carrying, from `vm_state`'s single row.
 *
 * Every field is nullable, and the two shapes of "nothing known" are different
 * and both real. `OverviewView.vm === null` is no row at all: the store has never
 * been written, which is the state of a fresh install. `currentTask === null` on
 * a row that exists is `VmStateStore.unknown()` — written deliberately before a
 * revert, so that an interrupted revert reads as unknown rather than as the
 * previous task. Neither is an error, and UI rule 1 makes rendering them a
 * requirement rather than a nicety.
 */
export interface VmStateView {
  snapshot: string | null
  currentTask: string | null
  appliedAt: number
}

/**
 * `GET /api/overview`: what the bank and the history can be counted without a
 * scheduler. Every field here is a count of something that exists on disk or in
 * the attempts table today; nothing in it is a readiness estimate, and the
 * Dashboard says so in words rather than filling the gap with these numbers.
 */
export interface OverviewView {
  tasks: { total: number; byScope: Record<string, number> }
  /**
   * `covered` / `uncovered` split the taxonomy by whether an **exam-objective
   * task** exercises it. `untouched` is section 6.2's stricter claim, verbatim
   * from `CoverageReport.untouchedObjectives`: no task of any scope exercises it
   * *and* no card teaches toward it. All three are properties of the content, not
   * of the student's history — an objective can be `covered` and never attempted.
   */
  objectives: { total: number; covered: number; uncovered: number; untouched: number }
  concepts: { total: number; untaught: number; unreachable: number }
  /** `clean` is the generated column: an attempt with no drift signal on it. */
  attempts: { total: number; clean: number; byMode: Record<string, number> }
  vm: VmStateView | null
}

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Guarded rather than cast. `(body as { error?: string }).error` would hand a
 * non-string straight to the rail, where template interpolation renders it as
 * `[object Object]` — a message the student cannot act on, describing a failure
 * they did not cause.
 */
function errorMessage(body: unknown): string | undefined {
  if (isRecord(body) && typeof body['error'] === 'string') return body['error']
  return undefined
}

export function createApi(fetchImpl: typeof fetch = fetch) {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(path, init)
    const text = await res.text()

    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      // An HTML error page from a proxy is the usual cause. Say so plainly
      // rather than throwing a JSON parse error nobody can act on.
      throw new ApiError(res.status, `${res.status} ${res.statusText}: ${text.slice(0, 120)}`)
    }

    if (!res.ok) {
      throw new ApiError(res.status, errorMessage(body) ?? `${res.status} ${res.statusText}`)
    }
    // The one cast in the web layer. A generic JSON client cannot narrow to `T`
    // without a per-route validator, and five hand-written validators for a
    // single-user local app is a worse trade than one honest cast at the
    // deserialization boundary. Everything downstream of this line is trusted
    // only as far as the server is.
    return body as T
  }

  function post<T>(path: string, body?: unknown): Promise<T> {
    return call<T>(path, {
      method: 'POST',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
  }

  return {
    /** `transport` here is the **server's** live transport, not any task's. */
    health: () => call<{ ok: boolean; transport: 'ssh' | 'vmrun'; tasks: number }>('/api/health'),
    /**
     * The whole list plus the book's chapter list. This used to unwrap to
     * `TaskSummary[]`; it stopped when the picker needed to show the chapters that
     * have no task, because that fact is not in the tasks. Callers that only want
     * the array take `.tasks` at the call site rather than getting a second method
     * for the same route.
     */
    tasks: () => call<TaskListView>('/api/tasks'),
    // The id already contains the slash the route needs, so it must not be
    // percent-encoded.
    task: (id: string) => call<TaskDetail>(`/api/tasks/${id}`),
    concept: (id: string) => call<ConceptCard>(`/api/concepts/${id}`),
    overview: () => call<OverviewView>('/api/overview'),
    /**
     * The whole graph. Named `conceptGraph` and not `concepts` so it cannot be
     * confused at a call site with `concept(id)` above, which returns one card's
     * *body* — this returns 40 cards' metadata and no body at all.
     */
    conceptGraph: () => call<ConceptGraphView>('/api/concepts'),
    /** Like `task`, the id already contains the slash the route needs. */
    guidedForTask: async (taskId: string): Promise<GuidedItem[]> =>
      (await call<{ items: GuidedItem[] }>(`/api/guided/task/${taskId}`)).items,
    /** Objective ids are dotted (`net.firewall.settings`), so there is no slash to preserve. */
    guidedForObjective: async (id: string): Promise<GuidedItem[]> =>
      (await call<{ items: GuidedItem[] }>(`/api/guided/objective/${encodeURIComponent(id)}`)).items,
    start: (taskId: string, mode: SessionMode) =>
      post<StartedSession>('/api/sessions', { taskId, mode }),
    hint: (id: string) => post<HintResponse>(`/api/sessions/${id}/hint`),
    // Returns the session, not a report: the machine and the clock go back, the
    // rung does not.
    reset: (id: string) => post<SessionView>(`/api/sessions/${id}/reset`),
    grade: (id: string) => post<GradeResponse>(`/api/sessions/${id}/grade`),
    finish: (id: string) => post<FinishResponse>(`/api/sessions/${id}/finish`),
  }
}

/**
 * The client, as the screens receive it.
 *
 * Derived from `createApi` rather than declared, so a route that changes shape
 * breaks the screens that read it instead of letting this interface drift into
 * describing an API that no longer exists — the same trick
 * `test/web/app.test.tsx` plays with its `shapeCheck`. Screens take it as a prop
 * because `App` holds exactly one instance: a screen that called `createApi()` at
 * its own module scope would be a second base URL to keep in step and a second
 * thing for a test to mock.
 */
export type Api = ReturnType<typeof createApi>
