import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Api, ConceptCard, ConceptGraphView, ConceptNode } from '../api.ts'
import { NotYet } from '../components/NotYet.tsx'

const LABEL = 'uppercase tracking-wide text-xs text-zinc-500'
const ALARM = 'rounded border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200'
const WARN = 'rounded border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-200'

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'alarm'; children: string }) {
  const cls =
    tone === 'ok'
      ? 'border-emerald-800 text-emerald-300'
      : tone === 'warn'
        ? 'border-amber-800 text-amber-300'
        : 'border-rose-800 text-rose-300'
  return <span className={`rounded border px-1.5 py-0.5 text-xs ${cls}`}>{children}</span>
}

/**
 * One card's row, and the two things it can honestly say about itself.
 *
 * `taught` and `reachable` are properties of the bank: whether a task names this
 * card, and whether any route through the prerequisite graph reaches it. They are
 * rendered as badges only when they are *false*, because the interesting state is
 * the gap — 40 rows each carrying a green "taught" badge is 40 badges nobody
 * reads, and it is also the arrangement that makes the two missing rows hardest to
 * see.
 */
function ConceptRow({
  concept,
  open,
  body,
  bodyError,
  onToggle,
}: {
  concept: ConceptNode
  open: boolean
  body: ConceptCard | undefined
  bodyError: string | null
  onToggle: () => void
}) {
  return (
    <li className="border-t border-zinc-800 first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-baseline gap-2 p-2 text-left"
      >
        <span className="flex-1 text-zinc-100">{concept.title}</span>
        {concept.taught ? null : <Badge tone="warn">untaught</Badge>}
        {concept.reachable ? null : <Badge tone="alarm">unreachable</Badge>}
        <span className="text-xs text-zinc-500">
          {concept.requiredByTasks.length === 1
            ? '1 task'
            : `${concept.requiredByTasks.length} tasks`}
        </span>
      </button>

      {open ? (
        <div className="px-2 pb-3">
          <div className="text-xs text-zinc-500">{concept.id}</div>
          {concept.prerequisites.length > 0 ? (
            <div className="mt-1 text-xs text-zinc-400">
              needs first: {concept.prerequisites.join(', ')}
            </div>
          ) : null}
          {concept.objectives.length > 0 ? (
            <div className="mt-1 text-xs text-zinc-400">
              teaches toward: {concept.objectives.join(', ')}
            </div>
          ) : null}
          {concept.requiredByTasks.length > 0 ? (
            <div className="mt-1 text-xs text-zinc-400">
              required by: {concept.requiredByTasks.join(', ')}
            </div>
          ) : (
            <div className="mt-1 text-xs text-amber-300">
              No task requires this card, so no lab will ever hand it to you.
            </div>
          )}

          {bodyError !== null ? (
            <div className="mt-2 text-xs text-rose-300">the card could not be read: {bodyError}</div>
          ) : body === undefined ? (
            <div className="mt-2 text-xs text-zinc-500">reading the card...</div>
          ) : (
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-zinc-200">
              {body.body}
            </pre>
          )}
        </div>
      ) : null}
    </li>
  )
}

export interface ConceptsProps {
  api: Api
}

/**
 * Section 11's Concepts screen: *"the concept graph: taught, needed-again,
 * demonstrated-cold, never encountered. The personalised replacement for a book's
 * table of contents."*
 *
 * **Two of those four states exist today, and the other two are not zero — they are
 * unmeasured.** `taught` and `reachable` come off `GET /api/concepts` and are
 * computed by `CoverageReport` from the bank on disk. *Needed-again* is
 * `concept_state.times_needed > 1` and *demonstrated-cold* is
 * `concept_state.demonstrated_cold`, and `src/engine/store/schema.ts` says
 * plainly that nothing reads or writes `concept_state` in this build. So this
 * screen states both absences and shows neither as a count. The same paragraph is
 * why the word *personalised* does not appear above the list: nothing here is yet
 * a fact about the student.
 *
 * What it is instead — a browsable, honest index of every card, with each card's
 * body one click away — is still the thing the spec is after, because
 * `GET /api/concepts/:id` is ungated by design: this app is meant to replace the
 * book, so nothing about a concept is withheld outside a live attempt's ladder.
 */
export function Concepts({ api }: ConceptsProps) {
  const [graph, setGraph] = useState<ConceptGraphView>()
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [bodies, setBodies] = useState<Record<string, ConceptCard>>({})
  const [bodyError, setBodyError] = useState<string | null>(null)
  const [area, setArea] = useState<string | null>(null)

  useEffect(() => {
    api
      .conceptGraph()
      .then(setGraph)
      .catch((e: unknown) => setError(message(e)))
  }, [api])

  const toggle = useCallback(
    (id: string) => {
      setBodyError(null)
      if (open === id) {
        setOpen(null)
        return
      }
      setOpen(id)
      // Cached, because the body does not change while the app runs and reopening
      // a card should not flash "reading..." at someone comparing two of them.
      if (bodies[id] !== undefined) return
      api
        .concept(id)
        .then((c) => setBodies((prev) => ({ ...prev, [c.id]: c })))
        .catch((e: unknown) => setBodyError(message(e)))
    },
    [api, bodies, open],
  )

  const concepts = graph?.concepts ?? []
  const areas = useMemo(
    () => [...new Set(concepts.map((c) => c.area))].sort((a, b) => a.localeCompare(b)),
    [concepts],
  )
  const shown = area === null ? concepts : concepts.filter((c) => c.area === area)
  const untaught = concepts.filter((c) => !c.taught)
  const unreachable = concepts.filter((c) => !c.reachable)
  const problems = graph?.problems ?? []

  return (
    // Its own scroll container: `App` gives each screen a fixed-height slot.
    <div className="h-full overflow-y-auto">
    <div className="mx-auto max-w-4xl p-6 text-sm text-zinc-300">
      <h1 className="text-xl text-zinc-100">Concepts</h1>
      <p className="mt-1 text-xs text-zinc-500">
        Every card in the bank, with what requires it and what it needs first. Open one to read it —
        nothing here is withheld, because this is the book.
      </p>

      {/*
        First on the screen and loud, which is risk R7's whole mitigation: *"a
        missing card is visible, not silent."* A problem here is a reference that
        does not resolve, so the student can be sent to a rung-3 card that is not
        there.
      */}
      {problems.length > 0 ? (
        <div className={`mt-4 ${ALARM}`}>
          <div className="text-zinc-100">
            {problems.length === 1 ? '1 content problem' : `${problems.length} content problems`}
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            An authoring bug, not your doing: something names a card or a prerequisite that does not
            exist. <code className="mx-1">rhcsa validate</code> fails on these and the server
            refuses to serve a bank that has them.
          </p>
        </div>
      ) : null}

      {error !== null ? (
        <div className={`mt-4 ${ALARM}`}>the concept graph could not be read: {error}</div>
      ) : null}

      {graph === undefined && error === null ? (
        <p className="mt-4 text-zinc-500">reading...</p>
      ) : null}

      {graph !== undefined ? (
        <>
          <div className="mt-4 grid gap-3">
            {unreachable.length > 0 ? (
              <div className={ALARM}>
                <div className={LABEL}>unreachable cards</div>
                <p className="mt-1 text-xs">
                  {unreachable.length === 1 ? '1 card' : `${unreachable.length} cards`} that no task
                  requires and that nothing a task requires needs first. This content exists and
                  cannot be delivered to you by any route.
                </p>
                <ul className="mt-1 space-y-1 text-xs">
                  {unreachable.map((c) => (
                    <li key={c.id}>
                      {c.title} <span className="opacity-70">({c.id})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {untaught.length > 0 ? (
              <div className={WARN}>
                <div className={LABEL}>untaught cards</div>
                <p className="mt-1 text-xs">
                  {untaught.length === 1 ? '1 card' : `${untaught.length} cards`} that no task
                  names directly. A card in this list is still reachable if some task's card needs
                  it as a prerequisite — the unreachable list above is the stricter test.
                </p>
                <ul className="mt-1 space-y-1 text-xs">
                  {untaught.map((c) => (
                    <li key={c.id}>
                      {c.title} <span className="opacity-70">({c.id})</span>
                      {c.reachable ? ' — reachable as a prerequisite' : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <NotYet
              what="Needed again, and demonstrated cold"
              needs={
                'Section 11 asks for four states and this screen can derive two. Needed-again is ' +
                'concept_state.times_needed > 1 — a card the hint ladder handed you at rung 3 ' +
                'more than once — and demonstrated-cold is concept_state.demonstrated_cold, set ' +
                'when you pass a task requiring the card without opening the ladder at all. Both ' +
                'are per-student facts and nothing in this build reads or writes concept_state; ' +
                'the writers arrive with the scheduler in Phase 3. They are absent here rather ' +
                'than shown as zero, because a zero would read as "you have never needed this" ' +
                'when the truth is that nobody counted.'
              }
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className={LABEL}>area</span>
            <button
              type="button"
              onClick={() => setArea(null)}
              className={`rounded border px-2 py-0.5 text-xs ${
                area === null ? 'border-emerald-700 text-emerald-300' : 'border-zinc-800 text-zinc-400'
              }`}
            >
              all ({concepts.length})
            </button>
            {areas.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setArea(a)}
                className={`rounded border px-2 py-0.5 text-xs ${
                  area === a ? 'border-emerald-700 text-emerald-300' : 'border-zinc-800 text-zinc-400'
                }`}
              >
                {a} ({concepts.filter((c) => c.area === a).length})
              </button>
            ))}
          </div>

          {/* Unpadded on purpose: the rows carry their own padding, so a click
              anywhere on a row hits its button rather than a gutter beside it. */}
          <ul className="mt-2 rounded border border-zinc-800 bg-zinc-900/40">
            {shown.map((c) => (
              <ConceptRow
                key={c.id}
                concept={c}
                open={open === c.id}
                body={bodies[c.id]}
                bodyError={open === c.id ? bodyError : null}
                onToggle={() => toggle(c.id)}
              />
            ))}
          </ul>
        </>
      ) : null}
    </div>
    </div>
  )
}
