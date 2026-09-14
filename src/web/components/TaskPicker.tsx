import { useEffect, useMemo, useState } from 'react'
import type { SessionMode, TaskSummary } from '../api.ts'

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

interface ChapterGroup {
  chapter: number
  tasks: TaskSummary[]
}

/**
 * Chapter order, with the empty chapters kept in.
 *
 * The order matters because the bank arrives in the order `bank.ts` loads it,
 * which sorts task *file paths* - so it comes out grouped by area and then by
 * authoring number, and `net/044` sits next to `net/045` while the chapters
 * interleave. That is the order the files were written in, not an order to study
 * in. The book's own order is a dependency order: chapter 15 assumes chapter 14,
 * and reading it the other way round is the thing this screen should not quietly
 * encourage.
 *
 * `chapters` comes from the book corpus and is a strictly larger set than the
 * chapters the bank covers, which is the whole point: a chapter with no task is
 * rendered as an empty group rather than skipped, because the gaps are the
 * authoring backlog and a picker that hides them makes 27 tasks look finished. A
 * task whose chapter is *not* in `chapters` still gets a group - that covers both
 * the server-has-no-corpus case (`chapters` is `[]`, so grouping falls back to the
 * chapters the tasks name) and the case of a task claiming a chapter the book does
 * not have, which should be visible rather than dropped on the floor.
 */
function groupByChapter(tasks: TaskSummary[], chapters: number[]): ChapterGroup[] {
  const byChapter = new Map<number, TaskSummary[]>()
  for (const c of chapters) byChapter.set(c, [])
  for (const t of tasks) {
    const existing = byChapter.get(t.chapter)
    if (existing === undefined) byChapter.set(t.chapter, [t])
    else existing.push(t)
  }
  return [...byChapter.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([chapter, list]) => ({
      chapter,
      // Within one chapter, the id is the authoring order and there is nothing
      // better to sort on: two tasks in the same chapter do not declare which
      // comes first.
      tasks: [...list].sort((a, b) => a.id.localeCompare(b.id)),
    }))
}

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

  useEffect(() => {
    // The default is the first task *in chapter order*, not `tasks[0]`, so that
    // pressing Start without choosing anything starts the earliest chapter the
    // bank covers rather than whichever area sorts first alphabetically.
    if (selected !== null) return
    const first = groups.flatMap((g) => g.tasks)[0]
    if (first !== undefined) setSelected(first.id)
  }, [groups, selected])

  return (
    // The scroller is this outer div and not the centred column, for the same
    // reason `Dashboard` and `Concepts` do it this way: `App`'s shell is
    // `overflow-hidden`, so a screen taller than the viewport has to say so itself
    // or its bottom is simply unreachable. The picker got away without it while the
    // bank held five tasks and fit on screen; at twenty-seven the Start button and
    // the last third of the list sat below the fold with no way to reach them.
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
                  Not authored. Study the chapter from the book; there is no graded lab for it.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-800/60">
                  {g.tasks.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(t.id)}
                        className={`flex w-full items-center gap-3 p-3 pl-6 text-left ${
                          selected === t.id ? 'bg-zinc-900' : ''
                        }`}
                      >
                        <span className="flex-1 text-zinc-100">{t.title}</span>
                        {t.scope === 'instrumental' ? (
                          <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                            supporting
                          </span>
                        ) : null}
                        {t.rebootCheck ? (
                          <span className="text-xs text-zinc-500">reboot check</span>
                        ) : null}
                        <span className="text-xs text-zinc-500">
                          {Math.round(t.timeBudget / 60)} min
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>

        {error !== null && error !== undefined ? (
          <div className="mt-4 rounded border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <button
          type="button"
          disabled={selected === null || busy}
          onClick={() => selected !== null && onStart(selected, mode)}
          className="mt-6 rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-40"
        >
          {busy ? 'reverting the snapshot...' : 'Start'}
        </button>
        <p className="mt-2 text-xs text-zinc-500">
          Starting reverts the lab VM to the clean snapshot and runs the task's setup. It takes
          about fifteen seconds and discards anything left over from a previous attempt.
        </p>
      </div>
    </div>
  )
}
