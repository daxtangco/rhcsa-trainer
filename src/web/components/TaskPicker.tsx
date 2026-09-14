import { useEffect, useState } from 'react'
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

export interface TaskPickerProps {
  tasks: TaskSummary[]
  error?: string | null
  busy?: boolean
  onStart: (taskId: string, mode: SessionMode) => void
}

export function TaskPicker({ tasks, error, busy = false, onStart }: TaskPickerProps) {
  const [mode, setMode] = useState<SessionMode>('practice')
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (selected === null && tasks.length > 0) setSelected(tasks[0]?.id ?? null)
  }, [tasks, selected])

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

        <ul className="mt-6 divide-y divide-zinc-800 rounded border border-zinc-800">
          {tasks.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setSelected(t.id)}
                className={`flex w-full items-center gap-3 p-3 text-left ${
                  selected === t.id ? 'bg-zinc-900' : ''
                }`}
              >
                <span className="w-10 text-xs text-zinc-500">ch{t.chapter}</span>
                <span className="flex-1 text-zinc-100">{t.title}</span>
                {t.scope === 'instrumental' ? (
                  <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                    supporting
                  </span>
                ) : null}
                {t.rebootCheck ? <span className="text-xs text-zinc-500">reboot check</span> : null}
                <span className="text-xs text-zinc-500">{Math.round(t.timeBudget / 60)} min</span>
              </button>
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
