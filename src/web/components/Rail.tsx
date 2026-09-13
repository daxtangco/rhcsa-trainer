import type { CheckpointView, ConceptRef, GradeReportView, StartedSession } from '../api.ts'

export interface RailProps {
  session: StartedSession
  rung: number
  elapsedS: number
  report?: GradeReportView
  busy?: 'hinting' | 'grading' | 'finishing' | 'reverting' | null
  error?: string | null
  /** The attempt is over and a rating has been derived from it. */
  finished?: boolean
  serverTransport?: 'ssh' | 'vmrun'
  /**
   * The task's concept cards, named but not opened. The rail holds the
   * affordance; the card body opens in the main pane, next to the hints, for the
   * same reason a hint does not live here — a solution must not be readable out
   * of the corner of your eye while you are still trying.
   */
  concepts?: ConceptRef[]
  onConcept?: (id: string) => void
  onHint: () => void
  onGrade: () => void
  onFinish: () => void
  onReset: () => void
}

function mmss(total: number): string {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Keyed by the status union rather than by `string`, so a fourth status fails to
// typecheck here instead of silently rendering the grey dot that the brief's
// `?? 'text-zinc-500'` fallback would have supplied. With literal keys the
// lookup is `string`, not `string | undefined`, so there is nothing to fall back
// from.
const DOT: Record<CheckpointView['status'], string> = {
  pass: 'text-emerald-400',
  fail: 'text-rose-400',
  skip: 'text-zinc-500',
}

/**
 * Whether to say anything about the outcome at all, and what.
 *
 * `null` is a real answer and the important one: it means the numbers on the
 * report cannot support a claim in either direction. `allPassed` arrives already
 * ANDed with `!incomplete` by `reportFor`, so it is read as final and is never
 * re-ANDed here - doing that would state a false thing about the contract and
 * leave the next person to change one side with a double negation.
 *
 * Withholding is deliberately not the same as failing. Both count signals mean
 * the *counter* is the suspect rather than the machine, and failing a correct run
 * over a bad count is precisely the mistake `reportFor`'s warn-don't-fail guard
 * exists to avoid. `persistenceUntested` can only ever suppress a pass, because
 * a genuine `fail` is returned before it is consulted.
 */
function verdictFor(
  report: GradeReportView | undefined,
  countSuspect: boolean,
  persistenceUntested: boolean,
): 'pass' | 'fail' | null {
  if (report === undefined || report.incomplete || countSuspect) return null
  if (!report.allPassed) return 'fail'
  return persistenceUntested ? null : 'pass'
}

const WARN = 'rounded border border-amber-800 bg-amber-950/40 p-2 text-xs text-amber-200'
const ALARM = 'rounded border border-rose-800 bg-rose-950/40 p-2 text-xs text-rose-200'
const LABEL = 'uppercase tracking-wide text-xs text-zinc-500'
/** Neither a warning nor an alarm: a true statement about the machine. */
const NOTE = 'rounded border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-400'

export function Rail(props: RailProps) {
  const { session, rung, elapsedS, report, busy } = props
  const overBudget = elapsedS > session.timeBudget
  const atCap = rung >= session.maxRung
  // Both null and undefined mean "not working". `busy !== null` alone would
  // treat an omitted prop as busy and disable every button.
  const working = busy !== undefined && busy !== null
  const finished = props.finished === true

  // The task's requirement against the server's reality. Comparing
  // session.transport here would compare the server's transport to itself:
  // both it and /api/health report runtime.transportKind.
  const mismatch =
    props.serverTransport !== undefined && session.taskTransport !== props.serverTransport

  // More distinct checkpoint ids arrived than the grade script declares. That
  // cannot be the machine's fault, so it means countCheckpoints under-counted -
  // and an under-count is exactly what switches `incomplete` off, which is why
  // this needs its own signal rather than riding on that flag. `expectedTotal`
  // of 0 with checkpoints arriving is the measured shape of it.
  const countOverArrived = report !== undefined && report.total > report.expectedTotal

  // The same defect one degree quieter, and the reason the check above is not
  // enough on its own: when the count is deflated rather than collapsed, the
  // arrivals *match* it. Eight checkpoints declared, a heredoc fail-open takes the
  // count to three, the grader dies after three - and total == expectedTotal, so
  // nothing above fires and nothing in `incomplete` fires either. The server
  // reconciles the count against the grade script's own headers and reports the
  // disagreement as `countDisputed`; this is the only signal on the screen that
  // sees that case.
  const countDisputed = report !== undefined && report.countDisputed
  const countSuspect = countOverArrived || countDisputed

  // The task declares that its change has to survive a restart, and the restart
  // did not happen. Today the grader only reaches `rebooted: false` with
  // something passing by way of a throw, so the amber rebootError box below is
  // always alongside - this is belt and braces. It becomes load-bearing the
  // moment the grader gains another way to skip the reboot, and the thing it
  // prevents is the worst output this screen can produce: the words "all
  // checkpoints passed" on an attempt whose persistence was never tested.
  const persistenceUntested =
    session.rebootCheck && report !== undefined && !report.rebooted && report.allPassed

  const verdict = verdictFor(report, countSuspect, persistenceUntested)

  // Exam mode gets no concept-card affordance at all - absent, not disabled.
  // GET /api/concepts/:id is ungated on purpose (this app replaces the book), so
  // this is the only thing between exam mode and a rung-3 card the hint ladder
  // refuses to hand over. Typing the URL by hand is a student choosing to
  // self-sabotage one rehearsal, which is theirs to choose.
  const concepts = props.concepts ?? []
  const showConcepts =
    session.mode !== 'exam' && concepts.length > 0 && props.onConcept !== undefined

  return (
    <aside className="w-72 shrink-0 border-l border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300 flex flex-col gap-4 overflow-y-auto">
      <div>
        <div className={LABEL}>mode</div>
        <div className="text-zinc-100">{session.mode}</div>
      </div>

      <div>
        <div className={LABEL}>time</div>
        <div className={overBudget ? 'text-amber-400' : 'text-zinc-100'}>
          {mmss(elapsedS)} / {mmss(session.timeBudget)}
        </div>
        {overBudget ? <div className="text-xs text-amber-400">over budget</div> : null}
      </div>

      <div>
        <div className={LABEL}>disclosure</div>
        <div className="text-zinc-100">
          rung {rung} of {session.maxRung}
        </div>
        {atCap ? (
          <div className="text-xs text-zinc-500">no more hints in {session.mode} mode</div>
        ) : null}
      </div>

      {showConcepts ? (
        <div>
          <div className={LABEL}>concepts</div>
          <ul className="mt-1 space-y-1">
            {concepts.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => props.onConcept?.(c.id)}
                  className="text-left text-xs text-sky-300 underline decoration-dotted"
                >
                  {c.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <div className={LABEL}>checkpoints</div>

        {report?.incomplete === true ? (
          <div className={`mt-1 ${ALARM}`}>
            The grader reported {report.total} of {report.expectedTotal} checkpoints and then
            stopped. This is not a score: the ones that never ran are unknown, not passed.
          </div>
        ) : null}

        {countOverArrived && report !== undefined ? (
          <div className={`mt-1 ${WARN}`}>
            This lab's checkpoint count is wrong ({report.total} reported, {report.expectedTotal}{' '}
            expected). The result may be unreliable — please re-run. Nothing here is your doing:
            the number the grade is scored against is what is broken.
          </div>
        ) : null}

        {countDisputed ? (
          <div className={`mt-1 ${WARN}`}>
            This lab's grade script declares checkpoints that its own checkpoint count cannot see,
            so the number this run was scored against is too low and no result can be read off it.
            Nothing here is your doing, and this is not a score — the lab needs fixing.
          </div>
        ) : null}

        {report === undefined ? (
          <div className="text-zinc-100">{session.checkpointTotal} checkpoints</div>
        ) : (
          <>
            <div className="mt-1 text-zinc-100">
              {report.passed} / {report.total} passed
            </div>
            {verdict === 'pass' ? (
              <div className="text-xs text-emerald-400">All checkpoints passed.</div>
            ) : null}
            {verdict === 'fail' ? (
              <div className="text-xs text-rose-300">Not all checkpoints passed.</div>
            ) : null}
            {persistenceUntested ? (
              <div className="text-xs text-amber-300">
                Every checkpoint that ran passed, but the reboot check did not run — so whether
                the change survives a restart is untested, and that is what this task is for.
              </div>
            ) : null}
            {report.checkpoints === undefined ? (
              <div className="text-xs text-zinc-500">which ones is not shown in this mode</div>
            ) : (
              <ul className="mt-2 space-y-1">
                {report.checkpoints.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    <span className={DOT[c.status]}>&#9679;</span>
                    <span className="text-xs">{c.desc}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {report !== undefined && report.regressionCount > 0 ? (
        <div className={ALARM}>
          {report.regressionCount === 1 ? '1 checkpoint' : `${report.regressionCount} checkpoints`}{' '}
          passed before the reboot and failed after it. That is a persistence failure: the change
          was never written anywhere that survives a restart.
        </div>
      ) : null}

      {report?.rebootError !== undefined ? (
        <div className={WARN}>The reboot check could not run: {report.rebootError}</div>
      ) : null}

      {/*
        §10.3. The warning outranks the note and replaces it: showing both would
        put "you are offline" and "you may not be offline" in the same corner of
        the same screen. A student who believes the wrong one of those learns the
        wrong habit from a run that looked right, so when the two disagree only the
        doubt is shown.
      */}
      {session.offlineWarning !== undefined ? (
        <div className={WARN}>{session.offlineWarning}</div>
      ) : session.offline ? (
        <div className={NOTE}>
          No default route in {session.mode} mode: <code>curl</code> and internet{' '}
          <code>dnf</code> will fail. <code>man</code> and <code>/usr/share/doc</code> are what you
          get in the exam, so they are what you get here. It cannot stop a browser on your host —
          that part is on you.
        </div>
      ) : null}

      {mismatch ? (
        <div className={WARN}>
          This task needs the {session.taskTransport} transport and the server is using{' '}
          {props.serverTransport}. Work at the VMware console and grade it with
          <code className="mx-1">rhcsa validate</code>.
        </div>
      ) : null}

      {props.error !== null && props.error !== undefined ? (
        <div className={ALARM}>{props.error}</div>
      ) : null}

      <div className="mt-auto flex flex-col gap-2">
        {finished ? (
          <div className="text-xs text-zinc-500">
            This attempt is finished. Nothing about it is saved — a rating, if one is shown, is
            shown once, in the pane, for this attempt only. Start a new session to attempt it
            again — grading or reverting now would change what this attempt showed.
          </div>
        ) : null}
        <button
          type="button"
          onClick={props.onHint}
          disabled={atCap || working || finished}
          className="rounded bg-zinc-800 px-3 py-2 text-zinc-100 disabled:opacity-40"
        >
          {busy === 'hinting' ? 'opening...' : 'Hint (F2)'}
        </button>
        <button
          type="button"
          onClick={props.onGrade}
          disabled={working || finished}
          className="rounded bg-emerald-700 px-3 py-2 text-white disabled:opacity-40"
        >
          {busy === 'grading' ? 'grading...' : 'Grade (F4)'}
        </button>
        <button
          type="button"
          onClick={props.onFinish}
          disabled={report === undefined || working || finished}
          className="rounded bg-zinc-800 px-3 py-2 text-zinc-100 disabled:opacity-40"
        >
          Finish (F8)
        </button>
        <button
          type="button"
          // Destructive and irreversible, so it asks. No keyboard shortcut
          // either: a function key that throws away twenty minutes of work is a
          // trap, and this is the one control that should cost a deliberate
          // click.
          onClick={() => {
            if (window.confirm('Reset the lab? This reverts the VM and restarts the timer.')) {
              props.onReset()
            }
          }}
          disabled={working || finished}
          className="rounded border border-zinc-700 px-3 py-2 text-zinc-400 disabled:opacity-40"
        >
          {busy === 'reverting' ? 'reverting...' : 'Reset lab'}
        </button>
      </div>
    </aside>
  )
}
