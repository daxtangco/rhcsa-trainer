import { Fragment, useEffect, useMemo, useState } from 'react'
import type { SessionMode, TaskSummary } from '../api.ts'
import { groupByChapter } from '../chapters.ts'

// Every `SessionMode` must have a card here, or the picker silently cannot offer
// a mode the ladder supports. The type on the array catches a *wrong* id, not a
// *missing* one, so this is a comment and not a guarantee - `SessionMode` itself
// is imported from `src/server/session.ts` so at least the list of legal ids has
// one definition. The labels and blurbs are copy, not a type.
const MODES: Array<{ id: SessionMode; label: string; blurb: string }> = [
  { id: 'guided', label: 'Guided', blurb: 'Everything open. Read the cards, follow along, learn it.' },
  { id: 'practice', label: 'Practice', blurb: 'Hints on request, all five rungs, named checkpoints.' },
  { id: 'drill', label: 'Drill', blurb: 'Concept cards only. No command sketch, no solution.' },
  { id: 'exam', label: 'Exam', blurb: 'One nudge. Scores are masked until you finish.' },
]

export interface TaskPickerProps {
  tasks: TaskSummary[]
  /**
   * Every chapter the book has, from `GET /api/tasks`. Defaults to `[]`, which
   * means "group by the chapters the tasks name" and not "there are no chapters" -
   * see `groupByChapter`.
   */
  chapters?: number[]
  error?: string | null
  busy?: boolean
  onStart: (taskId: string, mode: SessionMode) => void
}

export function TaskPicker({ tasks, chapters = [], error, busy = false, onStart }: TaskPickerProps) {
  const [mode, setMode] = useState<SessionMode>('practice')
  const [selected, setSelected] = useState<string | null>(null)

  const groups = useMemo(() => groupByChapter(tasks, chapters), [tasks, chapters])
  const empty = groups.filter((g) => g.tasks.length === 0)
  const failed = error !== null && error !== undefined

  useEffect(() => {
    // The default is the first task *in chapter order*, not `tasks[0]`, so that
    // starting without choosing anything begins at the earliest chapter the bank
    // covers rather than whichever area sorts first alphabetically.
    if (selected !== null) return
    const first = groups.flatMap((g) => g.tasks)[0]
    if (first !== undefined) setSelected(first.id)
  }, [groups, selected])

  return (
    // The scroller is this outer div and not the centred column, for the same
    // reason `Dashboard` and `Concepts` do it this way: `App`'s shell is
    // `overflow-hidden`, so a screen taller than the viewport has to say so itself
    // or its bottom is simply unreachable. The picker got away without it while the
    // bank held five tasks and fit on screen; at twenty-seven the task list and the
    // Start button sat below the fold with no way to reach them.
    // `h-full` bounds it against the shell, and `overflow-y-auto` goes on the
    // full-width element so the scrollbar sits at the window edge rather than down
    // the middle of the centred column.
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl p-8 text-zinc-200">
        <h1 className="text-2xl text-zinc-100">RHCSA lab</h1>

        <div className="mt-6 grid grid-cols-2 gap-3">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`rounded border p-3 text-left ${
                mode === m.id ? 'border-emerald-600 bg-emerald-950/30' : 'border-zinc-800'
              }`}
            >
              <div className="text-zinc-100">{m.label}</div>
              <div className="text-xs text-zinc-400">{m.blurb}</div>
            </button>
          ))}
        </div>

        <p className="mt-6 text-xs text-zinc-500">
          Chapter order, because the book's order is a dependency order — a chapter assumes the
          ones before it. {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} across{' '}
          {groups.length - empty.length} chapters.
          {empty.length > 0
            ? ` ${empty.length} ${empty.length === 1 ? 'chapter has' : 'chapters have'} no task yet` +
              ` (${empty.map((g) => g.chapter).join(', ')}) — that is the authoring backlog, not` +
              ` material you can skip.`
            : ''}
        </p>
        {/*
          This note used to sit under the Start button at the bottom of the page,
          which is now the one place it cannot be: Start moved onto the selected row
          and there is no bottom of the page to read any more. It says what pressing
          Start costs, so it has to be readable before the pressing rather than
          after.
        */}
        <p className="mt-1 text-xs text-zinc-500">
          Starting reverts the lab VM to the clean snapshot and runs the task's setup. It takes
          about fifteen seconds and discards anything left over from a previous attempt.
        </p>

        {/*
          A failure with no selection is a failure to load the list at all - the
          screen has no row to hang it on, so it goes here. When something *is*
          selected the same message renders beside that row instead, because that is
          where the click was.
        */}
        {failed && selected === null ? (
          <div className="mt-4 rounded border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <ul className="mt-3 divide-y divide-zinc-800 rounded border border-zinc-800">
          {groups.map((g) => (
            <li key={g.chapter}>
              <div className="flex items-baseline gap-2 bg-zinc-900/60 px-3 py-1.5">
                <span className="text-xs tracking-wide text-zinc-400">Chapter {g.chapter}</span>
                {g.tasks.length === 0 ? (
                  <span className="text-xs text-amber-600/80">no task yet</span>
                ) : null}
              </div>
              {g.tasks.length === 0 ? (
                // A row rather than nothing: the gap is the information. It is not a
                // button, because there is nothing to start - clicking it must not
                // look like it might work.
                <p className="px-3 py-2 pl-6 text-sm text-zinc-600 italic">
                  No graded lab yet. The book's own exercises for this chapter are on the Learn
                  screen — click the chapter heading there.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-800/60">
                  {g.tasks.map((t) => (
                    <Fragment key={t.id}>
                      {/*
                        Two siblings in one row rather than one big button, because
                        Start has to be a button of its own and a button inside a
                        button is invalid HTML - the browser hoists the inner one out
                        and the click targets stop being what the markup says. So the
                        selecting half is the button and the row carries the
                        highlight.
                      */}
                      <li
                        className={`flex items-center gap-3 pr-3 ${
                          selected === t.id ? 'bg-zinc-900' : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelected(t.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 p-3 pl-6 text-left"
                        >
                          <span className="min-w-0 flex-1 text-zinc-100">{t.title}</span>
                          {t.scope === 'instrumental' ? (
                            <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                              supporting
                            </span>
                          ) : null}
                          {t.rebootCheck ? (
                            <span className="text-xs text-zinc-500">reboot check</span>
                          ) : null}
                          <span className="shrink-0 text-xs text-zinc-500">
                            {Math.round(t.timeBudget / 60)} min
                          </span>
                        </button>
                        {/*
                          Start sits on the selected row, after the duration, and
                          nowhere else. It used to be a single button below the whole
                          list, which was fine while the bank held five tasks and is a
                          scroll to the bottom and back at twenty-seven - and the trip
                          back is the worse half, because by then the screen no longer
                          shows which task is about to run. Rendering it only for the
                          selected row keeps the button that starts a task beside the
                          task it starts, and keeps exactly one of them on screen.
                        */}
                        {selected === t.id ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onStart(t.id, mode)}
                            className="shrink-0 rounded bg-emerald-700 px-3 py-1 text-sm text-white disabled:opacity-40"
                          >
                            {busy ? 'reverting...' : 'Start'}
                          </button>
                        ) : null}
                      </li>
                      {failed && selected === t.id ? (
                        <li className="bg-rose-950/40 px-6 py-2 text-sm text-rose-200">{error}</li>
                      ) : null}
                    </Fragment>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
