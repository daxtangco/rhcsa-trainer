// Type-only, so `verbatimModuleSyntax` erases it and no server code reaches the
// bundle. One definition: a mode the ladder gains must not be a mode the picker
// silently cannot offer, and a phase the session gains must not be a phase the
// screen compares against with a typo nobody catches - `phase: string` would let
// `phase === 'gradedd'` compile and silently never match.
import type { SessionMode, SessionPhase } from '../server/session.ts'
export type { SessionMode, SessionPhase }

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
    async tasks(): Promise<TaskSummary[]> {
      return (await call<{ tasks: TaskSummary[] }>('/api/tasks')).tasks
    },
    // The id already contains the slash the route needs, so it must not be
    // percent-encoded.
    task: (id: string) => call<TaskDetail>(`/api/tasks/${id}`),
    concept: (id: string) => call<ConceptCard>(`/api/concepts/${id}`),
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
