import { NotYet } from '../components/NotYet.tsx'

/**
 * The two screens section 11 names and section 16 schedules for Phase 3.
 *
 * They are reachable, and they contain no content — not one derived tick, not one
 * placeholder exam. That is the whole point. Section 11 says Track's ticks are
 * *"**derived** from task results"*, so a Track table drawn now would have to draw
 * 28 chapters of empty boxes beside durations summed from a bank that is a fifth
 * built, and a student reading it would take it for a progress report. Section 9.3's
 * exams do not exist either: the composer that respects `claims` collisions is Phase
 * 3, and eight buttons that cannot start a sitting are worse than a sentence saying
 * so.
 */
const COPY = {
  track: {
    title: 'Track',
    intro:
      'The 28-chapter program table in four phases, with durations summed from each chapter’s ' +
      'task time budgets.',
    needs:
      'Section 11 requires the ticks to be derived from task results and not clickable, which ' +
      'means joining the attempt history to chapters — the same per-objective reporting the ' +
      'Dashboard is waiting on. The bank is also still growing toward ~120 tasks through Phase 3, ' +
      'so a table drawn today would show mostly empty chapters and would be read as your progress ' +
      'rather than as the bank’s.',
  },
  exams: {
    title: 'Exams',
    intro: 'Eight practice exams with assigned roles, time-triage drills, and past reports.',
    needs:
      'A mock exam is a composed task set that fits the objective distribution and the time ' +
      'budget without two tasks claiming the same disk or the same username — that composer, the ' +
      'triage drills of section 10.1 and the diagnostic baseline are all Phase 3. Nothing here ' +
      'would be a rehearsal yet, and a rehearsal that is not one is the most expensive thing this ' +
      'app could offer you.',
  },
}

export interface NotBuiltProps {
  screen: 'track' | 'exams'
}

export function NotBuilt({ screen }: NotBuiltProps) {
  const copy = COPY[screen]
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl p-6 text-sm text-zinc-300">
        <h1 className="text-xl text-zinc-100">{copy.title}</h1>
        <p className="mt-1 text-xs text-zinc-500">{copy.intro}</p>
        <div className="mt-4">
          <NotYet what={`${copy.title} is not built yet`} needs={copy.needs}>
            <p className="mt-2 text-xs text-zinc-500">
              Phase 2 built the Dashboard, Learn and Concepts screens; this one arrives with the
              study engine in Phase 3. Until then the Lab screen runs every real graded task in the
              bank, and Learn walks the book’s exercises.
            </p>
          </NotYet>
        </div>
      </div>
    </div>
  )
}
