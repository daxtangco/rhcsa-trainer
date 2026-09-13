import { useCallback, useEffect, useState } from 'react'
import type { Api, ConceptGraphView, OverviewView, VmStateView } from '../api.ts'
import { NotYet } from '../components/NotYet.tsx'
import type { ScreenId } from '../nav.ts'

const LABEL = 'uppercase tracking-wide text-xs text-zinc-500'
const CARD = 'rounded border border-zinc-800 bg-zinc-900/40 p-3'
const ALARM = 'rounded border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200'

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className={LABEL}>{label}</div>
      <div className="text-zinc-100">{value}</div>
      {note === undefined ? null : <div className="text-xs text-zinc-500">{note}</div>}
    </div>
  )
}

/** `{ instrumental: 1, 'exam-objective': 4 }` as `4 exam-objective, 1 instrumental`. */
function tally(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (entries.length === 0) return 'none'
  return entries.map(([k, n]) => `${n} ${k}`).join(', ')
}

/**
 * UI rule 1: *"VM state is always visible — snapshot, power state, applied task.
 * Confusion about machine state is the largest time-waster in any lab setup."*
 *
 * Three of those four things are honest here and the fourth is named as missing.
 * `vm_state` records the snapshot and the applied task, and the row's timestamp
 * says when. **Power state is not in this build's API at all** — neither
 * `/api/overview` nor `/api/health` reports it; `/api/health` reports which
 * transport was selected, which is a different fact (a `vmrun` transport is
 * selected whether or not the guest is running). Printing "powered on" from a
 * successful transport selection would be exactly the invented measurement this
 * screen exists to avoid, so the panel says what it does not know.
 *
 * Two distinct absences, both rendered as themselves rather than as an error:
 *
 * - `vm === null` — no row. Nothing has ever been applied to the guest by this
 *   app. The state of a fresh install, and the correct answer for it.
 * - `currentTask === null` on a row that exists — `VmStateStore.unknown()`, which
 *   is written *before* a revert precisely so that an interrupted revert reads as
 *   unknown rather than as the task that was there before. Section 5.5's guard
 *   refuses to grade in this state, so saying so here is what makes the later
 *   refusal legible instead of surprising.
 */
function VmPanel({
  vm,
  error,
  onReread,
}: {
  vm: VmStateView | null | undefined
  /**
   * A third absence, and the one that must not be collapsed into the two above.
   * A failed read means the app does not know what the store says; rendering that
   * as `vm: null` would print "nothing known about the guest" on the authority of
   * a network error, which is a claim about the machine made from no evidence.
   */
  error: string | null
  onReread: () => void
}) {
  return (
    <section className={CARD}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm text-zinc-200">VM state</h2>
        <button type="button" onClick={onReread} className="text-xs text-zinc-500 underline">
          re-read
        </button>
      </div>

      {error !== null ? (
        <p className="mt-2 text-sm text-rose-300">
          The VM state could not be read: {error}. This says nothing about the guest — the app
          failed to ask, so treat the machine as unknown and re-read.
        </p>
      ) : vm === undefined ? (
        <p className="mt-2 text-sm text-zinc-500">reading...</p>
      ) : vm === null ? (
        <p className="mt-2 text-sm text-zinc-300">
          Nothing known. No task setup has been recorded against the guest, which is what a fresh
          install looks like — it is not an error, and it is not a claim that the VM is clean.
          Starting a lab reverts the snapshot and records what was applied.
        </p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <Stat label="snapshot" value={vm.snapshot ?? 'unknown'} />
            <Stat
              label="applied task"
              value={vm.currentTask ?? 'unknown'}
              note={
                vm.currentTask === null
                  ? 'a revert or setup was interrupted; grading is refused until a reset'
                  : undefined
              }
            />
          </div>
          <div className="mt-2 text-xs text-zinc-500">
            recorded {new Date(vm.appliedAt).toLocaleString()}
          </div>
        </>
      )}

      <p className="mt-2 text-xs text-zinc-500">
        Power state is not reported by this build: the server publishes the selected transport, not
        whether the guest is running, and the two are not the same fact. Read it in the VMware
        console.
      </p>
    </section>
  )
}

export interface DashboardProps {
  api: Api
  onNavigate: (screen: ScreenId) => void
}

/**
 * Section 11's Dashboard: *"readiness statement, today's drill queue, weakest
 * objectives, untaught concepts, sealed-holdout status, VM status."*
 *
 * Two of those six can be computed from this build and four cannot, and the split
 * is not arbitrary — it is the Phase 2 / Phase 3 line of section 16. Readiness,
 * the drill queue and the weakest-objective ranking are all outputs of the FSRS
 * scheduler over `objective_state`, which Phase 3 builds; `schema.ts` states that
 * nothing reads or writes that table yet. Sealed holdouts are Phase 4. So this
 * screen shows the coverage and history counts that are real, and renders the
 * other four through `NotYet`, which names what would produce each one.
 *
 * The alternative — a readiness percentage derived from the counts that *are*
 * here — was rejected on section 9.4's terms. Coverage of the bank is a fact about
 * the bank; a percentage built from it would read as a fact about the student, and
 * it would rise every time a task was authored and nothing was studied.
 */
export function Dashboard({ api, onNavigate }: DashboardProps) {
  const [overview, setOverview] = useState<OverviewView>()
  const [graph, setGraph] = useState<ConceptGraphView>()
  // Two errors, not one. The two reads answer different questions and either can
  // fail alone: a missing concept graph must not blank out the VM state the
  // student came here to check, and the reverse holds too.
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [graphError, setGraphError] = useState<string | null>(null)

  const load = useCallback(() => {
    setOverviewError(null)
    api
      .overview()
      .then(setOverview)
      .catch((e: unknown) => setOverviewError(message(e)))
    setGraphError(null)
    api
      .conceptGraph()
      .then(setGraph)
      .catch((e: unknown) => setGraphError(message(e)))
  }, [api])

  useEffect(load, [load])

  // Risk R7's mitigation, verbatim: *"untaught concepts appear on the Dashboard.
  // A missing card is visible, not silent."* The count is on `/api/overview`, but
  // a count cannot be acted on, so the ids come from the graph — which is also
  // where `problems` lives, and an unresolvable `requires_concepts` is the failure
  // R7 is actually about.
  const untaught = graph?.concepts.filter((c) => !c.taught) ?? []
  const unreachable = graph?.concepts.filter((c) => !c.reachable) ?? []
  const problems = graph?.problems ?? []

  return (
    // The scroll container is the screen's own, not the shell's: `App` gives each
    // screen a fixed-height slot so the lab's terminal cannot be scrolled away
    // from its rail, and a screen that overflows has to say so itself.
    <div className="h-full overflow-y-auto">
    <div className="mx-auto max-w-4xl p-6 text-sm text-zinc-300">
      <h1 className="text-xl text-zinc-100">Dashboard</h1>
      <p className="mt-1 text-xs text-zinc-500">
        Everything below is either a count of what is on disk and in the attempt history, or a
        statement that a measurement is not available yet. There are no estimates on this screen.
      </p>

      {problems.length > 0 ? (
        <div className={`mt-4 ${ALARM}`}>
          <div className="text-zinc-100">
            {problems.length === 1 ? '1 content problem' : `${problems.length} content problems`} in
            the concept graph
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            These are authoring bugs, not your doing: a reference that does not resolve. Run
            <code className="mx-1">rhcsa validate</code>.
          </p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3">
        <VmPanel vm={overview?.vm} error={overviewError} onReread={load} />

        <NotYet
          what="Readiness"
          needs={
            'Section 9.4 reports readiness per objective — attempts, pass rate, mean time against ' +
            'budget, rung dependency, persistence-failure rate — and gates the claim on ' +
            'calibration. That needs the FSRS scheduler over objective_state and per-objective ' +
            'attempt history, which is Phase 3. No percentage is shown here because any number ' +
            'this build could produce would be about the bank, not about you.'
          }
        />

        <NotYet
          what="Today's drill queue"
          needs={
            'Empty is not the same as unscheduled, and this is unscheduled. Drill mode selects a ' +
            'due objective from objective_state and samples an unseen task tagged with it; the ' +
            'scheduler that writes objective_state is Phase 3, and nothing reads or writes that ' +
            'table in this build. Until then, choose a task on the Lab screen yourself.'
          }
        />

        <NotYet
          what="Weakest objectives"
          needs={
            'Ranking objectives by pass rate needs attempts joined to objectives. Attempts are ' +
            'being recorded, but /api/overview publishes their totals only, and the per-objective ' +
            'reporting of section 9.4 arrives with the scheduler in Phase 3.'
          }
        />

        <NotYet
          what="Sealed-holdout status"
          needs={
            'The two sealed holdouts (R9-D, R10-D) are Phase 4, and they are sealed until ' +
            'readiness is claimed — which nothing in this build can claim yet. No holdout has ' +
            'been reserved, so there is no status to report.'
          }
        />

        <section className={CARD}>
          <h2 className="text-sm text-zinc-200">Concept coverage</h2>
          {graphError !== null ? (
            <p className="mt-2 text-xs text-rose-300">
              the concept graph could not be read: {graphError}
            </p>
          ) : graph === undefined ? (
            <p className="mt-2 text-xs text-zinc-500">reading...</p>
          ) : (
            <>
              <div className="mt-2 grid grid-cols-3 gap-3">
                <Stat label="cards" value={String(graph.concepts.length)} />
                <Stat
                  label="untaught"
                  value={String(untaught.length)}
                  note="no task requires them"
                />
                <Stat
                  label="unreachable"
                  value={String(unreachable.length)}
                  note="not even a prerequisite of one"
                />
              </div>
              {untaught.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-amber-200">
                  {untaught.map((c) => (
                    <li key={c.id}>
                      {c.title} <span className="text-zinc-500">({c.id})</span>
                      {c.reachable ? ' — reachable as a prerequisite' : ' — unreachable'}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-zinc-500">
                  Every card is pulled in by at least one task.
                </p>
              )}
              <button
                type="button"
                onClick={() => onNavigate('concepts')}
                className="mt-3 text-xs text-sky-300 underline decoration-dotted"
              >
                open the concept graph
              </button>
            </>
          )}
        </section>

        {overviewError !== null ? (
          // Named rather than left as two missing sections: a screen that quietly
          // drops the counts it could not fetch reads as a bank with nothing in
          // it, which is the same class of lie as a zero for an unmeasured value.
          <div className={ALARM}>
            The bank and attempt counts could not be read: {overviewError}. Nothing about coverage
            or history is shown below, because nothing about it is known right now.
          </div>
        ) : overview === undefined ? null : (
          <>
            <section className={CARD}>
              <h2 className="text-sm text-zinc-200">Bank coverage</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Facts about the content, not about you: an objective can be covered by a task you
                have never attempted.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="tasks" value={String(overview.tasks.total)} note={tally(overview.tasks.byScope)} />
                <Stat label="objectives" value={String(overview.objectives.total)} />
                <Stat
                  label="covered"
                  value={`${overview.objectives.covered} / ${overview.objectives.total}`}
                  note="an exam-objective task exercises them"
                />
                <Stat
                  label="never taught, never demonstrated"
                  value={String(overview.objectives.untouched)}
                  note="no task exercises them and no card teaches toward them"
                />
              </div>
            </section>

            <section className={CARD}>
              <h2 className="text-sm text-zinc-200">Attempts recorded</h2>
              <div className="mt-2 grid grid-cols-3 gap-3">
                <Stat label="total" value={String(overview.attempts.total)} />
                <Stat
                  label="clean attempts"
                  value={String(overview.attempts.clean)}
                  note="no drift signal on the report"
                />
                <Stat label="by mode" value={tally(overview.attempts.byMode)} />
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                A count, not a score. Only a clean attempt can carry a rating, and what those
                attempts say about readiness is the Phase 3 reporting above.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
    </div>
  )
}
