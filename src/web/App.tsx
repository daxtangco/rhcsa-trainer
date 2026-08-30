import { useCallback, useEffect, useState } from 'react'
import {
  createApi,
  type ConceptCard,
  type ConceptRef,
  type GradeReportView,
  type RungContentView,
  type SessionMode,
  type StartedSession,
  type TaskSummary,
} from './api.ts'
import { Rail } from './components/Rail.tsx'
import { TaskPicker } from './components/TaskPicker.tsx'
import { TerminalPane } from './components/TerminalPane.tsx'

const api = createApi()

type Busy = 'hinting' | 'grading' | 'finishing' | 'reverting' | null

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function App() {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [serverTransport, setServerTransport] = useState<'ssh' | 'vmrun'>()
  const [session, setSession] = useState<StartedSession>()
  const [concepts, setConcepts] = useState<ConceptRef[]>([])
  const [card, setCard] = useState<ConceptCard>()
  const [rung, setRung] = useState(1)
  const [elapsedS, setElapsedS] = useState(0)
  const [report, setReport] = useState<GradeReportView>()
  const [rating, setRating] = useState<string | null>(null)
  const [hint, setHint] = useState<RungContentView[]>([])
  const [busy, setBusy] = useState<Busy>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The attempt is over and a rating has been derived from it. Everything that
  // could contradict that rating is switched off below.
  const finished = rating !== null

  useEffect(() => {
    api
      .tasks()
      .then(setTasks)
      .catch((e: unknown) => setError(message(e)))
    api
      .health()
      .then((h) => setServerTransport(h.transport))
      .catch(() => undefined)
  }, [])

  // One timer for the whole session. It counts wall-clock time, including the
  // time spent reading a hint, because the exam clock does too. It stops at
  // finish: a clock that keeps climbing past a recorded rating - and eventually
  // flips the rail to "over budget" - describes an attempt that is already over.
  useEffect(() => {
    if (session === undefined || finished) return
    const started = Date.now()
    const t = setInterval(() => setElapsedS(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(t)
  }, [session, finished])

  const start = useCallback(async (taskId: string, mode: SessionMode) => {
    setError(null)
    setStarting(true)
    try {
      const s = await api.start(taskId, mode)
      setSession(s)
      setRung(s.rung)
      setReport(undefined)
      setRating(null)
      setHint([])
      setCard(undefined)
      setElapsedS(0)

      // The concept cards this task is built from. Named here, gated by mode in
      // the rail: exam mode gets no affordance at all.
      try {
        setConcepts((await api.task(s.taskId)).concepts)
      } catch (e: unknown) {
        setConcepts([])
        // Say which half failed. The lab is up; only the card index is missing.
        setError(`the lab is running, but its concept cards could not be listed: ${message(e)}`)
      }

      if (s.mode === 'guided') {
        // Guided mode is full disclosure: open everything immediately rather
        // than making the student click four times to get to it.
        const h = await api.hint(s.id)
        setRung(h.rung)
        setHint(h.all ?? [h.content])
      }
    } catch (e: unknown) {
      setError(message(e))
    } finally {
      setStarting(false)
    }
  }, [])

  const doHint = useCallback(async () => {
    if (session === undefined) return
    setBusy('hinting')
    setError(null)
    try {
      const h = await api.hint(session.id)
      setRung(h.rung)
      setHint(h.all ?? [h.content])
    } catch (e: unknown) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }, [session])

  const doConcept = useCallback(async (id: string) => {
    setError(null)
    try {
      setCard(await api.concept(id))
    } catch (e: unknown) {
      setError(message(e))
    }
  }, [])

  const doReset = useCallback(async () => {
    if (session === undefined) return
    setBusy('reverting')
    setError(null)
    try {
      const s = await api.reset(session.id)
      // A fresh object, so the timer effect above re-runs and the clock starts
      // over. The rung comes back from the server unchanged, and the hints
      // already opened stay on screen: disclosure that has been spent is spent.
      setSession({ ...session, rung: s.rung })
      setRung(s.rung)
      setReport(undefined)
      setRating(null)
      setElapsedS(0)
    } catch (e: unknown) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }, [session])

  const doGrade = useCallback(async () => {
    if (session === undefined) return
    setBusy('grading')
    setError(null)
    try {
      setReport(await api.grade(session.id))
    } catch (e: unknown) {
      // Drop the previous report. Without this, a student who grades to 5/5,
      // then breaks something, then re-grades into a 500 is left looking at the
      // old green tally with an error box beside it - a screen that says they
      // passed a machine state that was never graded. Clearing it also disables
      // Finish, which is right: there is nothing current to finish on.
      setReport(undefined)
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }, [session])

  const doFinish = useCallback(async () => {
    if (session === undefined) return
    setBusy('finishing')
    // Cleared like every other handler. Without this a stale error from an
    // earlier grade sits in the rail through a successful finish.
    setError(null)
    try {
      const done = await api.finish(session.id)
      setReport(done.report)
      setRating(done.rating)
    } catch (e: unknown) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }, [session])

  // F2/F4/F8 rather than control keys: the terminal has to receive every
  // control sequence the shell uses, and ^R, ^H and ^G are all taken.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A finished attempt is closed to the keyboard too. Disabling the buttons
      // and leaving the shortcuts live would be a hole exactly the shape of the
      // thing being prevented.
      if (session === undefined || rating !== null) return
      if (e.key === 'F2') {
        e.preventDefault()
        void doHint()
      } else if (e.key === 'F4') {
        e.preventDefault()
        void doGrade()
      } else if (e.key === 'F8') {
        e.preventDefault()
        void doFinish()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session, rating, doHint, doGrade, doFinish])

  if (session === undefined) {
    return <TaskPicker tasks={tasks} error={error} busy={starting} onStart={start} />
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-950">
      <header className="border-b border-zinc-800 p-4">
        <div className="text-xs uppercase tracking-wide text-zinc-500">{session.taskId}</div>
        <h1 className="text-lg text-zinc-100">{session.title}</h1>
        <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-zinc-300">
          {session.prompt}
        </pre>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-auto">
          <TerminalPane />
          {hint.length > 0 ? (
            <div className="m-2 rounded border border-zinc-800 bg-zinc-900 p-4">
              {hint.map((h) => (
                <section key={h.rung} className="mb-4">
                  <h2 className="text-sm uppercase tracking-wide text-zinc-500">
                    rung {h.rung} — {h.title}
                  </h2>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-zinc-200">
                    {h.body}
                  </pre>
                </section>
              ))}
            </div>
          ) : null}
          {card !== undefined ? (
            <div className="m-2 rounded border border-sky-900 bg-zinc-900 p-4">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-sm uppercase tracking-wide text-zinc-500">
                  concept — {card.title}
                </h2>
                <button
                  type="button"
                  onClick={() => setCard(undefined)}
                  className="text-xs text-zinc-500 underline"
                >
                  close
                </button>
              </div>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-zinc-200">
                {card.body}
              </pre>
            </div>
          ) : null}
          {rating !== null ? (
            <div className="m-2 rounded border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-200">
              Attempt finished. Scheduler rating: <strong>{rating}</strong>. This is derived from
              the grade, the rung you needed and the time you took — nothing here is self-reported.
              Hint, Grade and Reset are inactive from here, and so are F2, F4 and F8: grading again
              would change the report this rating was derived from. Start a new session to attempt
              the task again.
            </div>
          ) : null}
        </main>

        <Rail
          session={session}
          rung={rung}
          elapsedS={elapsedS}
          report={report}
          busy={busy}
          error={error}
          finished={finished}
          serverTransport={serverTransport}
          concepts={concepts}
          onConcept={doConcept}
          onHint={doHint}
          onGrade={doGrade}
          onFinish={doFinish}
          onReset={doReset}
        />
      </div>
    </div>
  )
}
