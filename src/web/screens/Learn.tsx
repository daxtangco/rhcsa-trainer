import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Api, GuidedItem, TaskSummary } from '../api.ts'
import { groupByChapter } from '../chapters.ts'
import { GuidedWalkthrough } from '../components/GuidedWalkthrough.tsx'

const LABEL = 'uppercase tracking-wide text-xs text-zinc-500'
const ALARM = 'rounded border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200'

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * What the guided list was asked for. Three routes exist and they answer different
 * questions, so the screen keeps which one was used rather than flattening them
 * into a bare id: *"prepare me for this task"* unions the chapters of every
 * objective the task names, *"teach me this objective"* takes that objective's
 * chapters alone, and *"open chapter 12"* goes straight at the corpus - the only
 * one of the three that can reach a chapter the bank has no task for.
 *
 * `label` is carried rather than derived because `id` is the route's argument and
 * not always the thing to print: a chapter's id is `12`, which on its own reads as
 * an item count.
 */
type Source =
  | { kind: 'task'; id: string; label: string }
  | { kind: 'objective'; id: string; label: string }
  | { kind: 'chapter'; id: string; label: string }

export interface LearnProps {
  api: Api
}

/**
 * Section 9.1's guided mode: first contact with an objective, sourced from the 180
 * exercise instances of the two editions.
 *
 * The screen is a picker and a walkthrough. The picker exists because guided items
 * are addressed by task or by objective and the student is the one who knows which
 * they want; the walkthrough is `GuidedWalkthrough`, which carries every decision
 * about typing and verification.
 *
 * **The objective list here is the bank's, not the taxonomy's, and that is stated on
 * screen.** There is no route that lists objectives, so these are collected from
 * the `objectives` field of the tasks `/api/tasks` returns — every objective some
 * task claims, which is a subset of `content/objectives.yaml`. Guided material
 * exists for objectives no task covers yet (the corpus is keyed on chapters, not on
 * the bank), so this list under-offers, and saying so is cheaper than a route this
 * screen does not own.
 */
export function Learn({ api }: LearnProps) {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [chapters, setChapters] = useState<number[]>([])
  const [tasksError, setTasksError] = useState<string | null>(null)
  const [source, setSource] = useState<Source>()
  const [items, setItems] = useState<GuidedItem[]>()
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    api
      .tasks()
      .then((v) => {
        setTasks(v.tasks)
        setChapters(v.chapters)
      })
      .catch((e: unknown) => setTasksError(message(e)))
  }, [api])

  const objectives = useMemo(
    () => [...new Set(tasks.flatMap((t) => t.objectives))].sort((a, b) => a.localeCompare(b)),
    [tasks],
  )

  // The same grouping the Lab picker uses, for the same reason: the bank's own
  // order is by task file path, and the book's order is a dependency order. Here it
  // does one thing more - the chapters with no task are the only ones whose heading
  // is the *only* way in, so the heading being a button is what makes them
  // studyable at all.
  const groups = useMemo(() => groupByChapter(tasks, chapters), [tasks, chapters])

  const choose = useCallback(
    (next: Source) => {
      setSource(next)
      setItems(undefined)
      setItemsError(null)
      setOpenId(null)
      setLoading(true)
      const request =
        next.kind === 'task'
          ? api.guidedForTask(next.id)
          : next.kind === 'objective'
            ? api.guidedForObjective(next.id)
            : api.guidedForChapter(Number(next.id))
      request
        .then(setItems)
        .catch((e: unknown) => setItemsError(message(e)))
        .finally(() => setLoading(false))
    },
    [api],
  )

  const open = items?.find((i) => i.id === openId)

  return (
    <div className="flex h-full min-h-0 text-sm text-zinc-300">
      <aside className="w-80 shrink-0 overflow-y-auto border-r border-zinc-800 p-4">
        <h1 className="text-lg text-zinc-100">Learn</h1>
        <p className="mt-1 text-xs text-zinc-500">
          The book's own exercises, one step at a time. You type each command; nothing here is
          clickable that should be typed.
        </p>

        {tasksError !== null ? (
          <div className={`mt-3 ${ALARM}`}>the task list could not be read: {tasksError}</div>
        ) : null}

        <div className="mt-4">
          <div className={LABEL}>by chapter</div>
          <p className="mt-1 text-xs text-zinc-500">
            Click a chapter for the book's exercises in it, or a task under it to prepare for that
            graded lab. Chapter order, because the book's is a dependency order.
          </p>
          <ul className="mt-2 space-y-2">
            {groups.map((g) => (
              <li key={g.chapter}>
                {/*
                  The heading is a button, and that is the load-bearing part of this
                  screen. `guidedForTask` and `guidedForObjective` both reach the
                  corpus *through* the bank, so before `guidedForChapter` existed a
                  chapter with no task had no entry point here at all - its exercises
                  were in the corpus and unreachable. Those are exactly the chapters a
                  student most needs the book for, since there is no graded lab to
                  practise instead.
                */}
                <button
                  type="button"
                  onClick={() =>
                    choose({ kind: 'chapter', id: String(g.chapter), label: `chapter ${g.chapter}` })
                  }
                  className={`flex w-full items-baseline gap-2 text-left text-xs ${
                    source?.kind === 'chapter' && source.id === String(g.chapter)
                      ? 'text-emerald-300'
                      : 'text-zinc-400'
                  }`}
                >
                  <span className="tracking-wide">Chapter {g.chapter}</span>
                  {g.tasks.length === 0 ? (
                    <span className="text-amber-600/80">no graded lab</span>
                  ) : null}
                </button>
                <ul className="mt-1 space-y-1 pl-3">
                  {g.tasks.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => choose({ kind: 'task', id: t.id, label: t.id })}
                        className={`w-full text-left text-xs ${
                          source?.kind === 'task' && source.id === t.id
                            ? 'text-emerald-300'
                            : 'text-zinc-300'
                        }`}
                      >
                        {t.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4">
          <div className={LABEL}>or an objective</div>
          <ul className="mt-1 space-y-1">
            {objectives.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => choose({ kind: 'objective', id, label: id })}
                  className={`w-full text-left font-mono text-xs ${
                    source?.kind === 'objective' && source.id === id
                      ? 'text-emerald-300'
                      : 'text-zinc-300'
                  }`}
                >
                  {id}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-zinc-500">
            These are the objectives this bank's tasks claim, not the full EX200 taxonomy — there is
            no route that lists it. Objectives no task covers yet still have exercises, and they are
            missing from this list rather than from the corpus.
          </p>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {source === undefined ? (
          <p className="text-zinc-500">
            Pick a chapter, a task or an objective on the left. Guided mode is first contact:
            everything is open, and the graded version of the same material comes later on the Lab
            screen.
          </p>
        ) : loading ? (
          <p className="text-zinc-500">reading the corpus...</p>
        ) : itemsError !== null ? (
          <div className={ALARM}>the walkthroughs could not be read: {itemsError}</div>
        ) : items === undefined || items.length === 0 ? (
          // A real answer rather than an error: `guidedForObjective` returns an
          // empty list for a chapter the books teach without exercises, and
          // chapters 1, 27 and 28 have none in either edition.
          <p className="text-zinc-400">
            No guided exercise for {source.label}. That means the book teaches this material without a
            numbered exercise, not that anything is broken — the graded task on the Lab screen is
            still there.
          </p>
        ) : open !== undefined ? (
          <>
            <button
              type="button"
              onClick={() => setOpenId(null)}
              className="text-xs text-zinc-500 underline"
            >
              back to the {items.length} walkthroughs for {source.label}
            </button>
            <div className="mt-3">
              {/*
                Keyed by the item, so switching walkthroughs resets the step
                position, the input and the miss count by remount. The
                alternative - an effect that clears three pieces of state when a
                prop changes - is the same thing spelled in a way that can be got
                wrong later by adding a fourth.
              */}
              <GuidedWalkthrough key={open.id} item={open} />
            </div>
          </>
        ) : (
          <>
            <h2 className="text-zinc-100">
              {items.length === 1 ? '1 walkthrough' : `${items.length} walkthroughs`} for{' '}
              {source.label}
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Ordered as the exam values them: exercises printed in both editions first (durable
              core material), then the ones only your edition has, then the other edition's. Within
              a group, book order — a chapter builds on itself.
            </p>
            <ul className="mt-3 divide-y divide-zinc-800 rounded border border-zinc-800">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(item.id)}
                    className="flex w-full items-baseline gap-3 p-3 text-left"
                  >
                    <span className="w-24 shrink-0 text-xs text-zinc-500">{item.id}</span>
                    <span className="min-w-0 flex-1 text-zinc-100">{item.shown.title}</span>
                    {item.crossEdition ? (
                      <span className="shrink-0 rounded border border-emerald-800 px-1.5 py-0.5 text-xs text-emerald-300">
                        in both editions
                      </span>
                    ) : null}
                    <span className="shrink-0 text-xs text-zinc-500">
                      {item.shown.steps.length === 1 ? '1 step' : `${item.shown.steps.length} steps`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  )
}
