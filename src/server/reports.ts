import type { Bank, CoverageReport } from '../engine/content/bank.ts'
import { SCOPES, type TaskScope } from '../engine/content/task.ts'
import type { AttemptRow } from '../engine/store/attempts.ts'
import { MODE_VALUES, type AttemptMode } from '../engine/store/schema.ts'
import type { VmStateStore } from '../engine/store/vm-state.ts'

/**
 * The two whole-bank read models behind the Dashboard and Concepts screens
 * (spec section 11).
 *
 * Both are assembled from `checkCoverage`, which is the bank's existing analysis
 * and is *called*, not reimplemented. That matters beyond saving code: coverage is
 * the function `npm run validate` and `refuseToServe` already gate on, so a screen
 * built on it cannot report a gap the validator does not, or miss one it does. A
 * second traversal here would be a second opinion about the same bank, and the
 * first time the two disagreed the screen would be the one the student believed.
 *
 * ## What is deliberately absent
 *
 * There is no readiness percentage in `overview`, and adding one later must be a
 * decision rather than an oversight. Section 9.4:
 *
 * > Readiness is reported bluntly … A study tool that flatters is worse than no
 * > study tool.
 *
 * Every number below is a count of something on disk or in the database. A
 * readiness figure is a *prediction*, and predicting it needs the FSRS scheduler
 * that section 9 puts in Phase 3 — so the only readiness number this server could
 * compute today would be some ratio of coverage to bank size, which measures how
 * much of the bank has been authored and would be read as how likely the student is
 * to pass. That is precisely the flattery section 9.4 forbids. The screen says the
 * number is not available yet; that is a true statement, and a manufactured
 * percentage would not be.
 */

/**
 * Exhaustive by construction, the same way `app.ts`'s `MODES` is: a third
 * `TaskScope` fails to compile at its declaration rather than silently vanishing
 * from the breakdown. Imported from `content/task.ts` rather than redeclared -
 * collecting keys from whatever scopes the bank happens to use would omit
 * `instrumental: 0` on a bank with no instrumental tasks, which reads as "the
 * breakdown does not track that" rather than "there are none".
 */
const SCOPE_VALUES = Object.keys(SCOPES) as TaskScope[]

export interface ConceptView {
  id: string
  title: string
  /**
   * The id's first dotted segment: `storage` for `storage.lvm-abstraction-stack`.
   *
   * Derived from the id rather than read from the file's directory, because the id
   * is the field `parseConcept` validates (`CONCEPT_ID_RE`) and the directory is a
   * filesystem detail the loader discards by the time a `ConceptSpec` exists.
   * Measured against the bank on 2026-09-13: all 40 cards live in a directory whose
   * name equals this segment, so the two agree today and the id is the one that
   * cannot silently drift.
   */
  area: string
  objectives: string[]
  prerequisites: string[]
  /** Some task's `requires_concepts` names this card, so a student can reach it directly. */
  taught: boolean
  /**
   * Reachable from what tasks require, following prerequisite edges. Weaker than
   * `taught` and the pair is the useful part: `taught: false, reachable: true` is
   * `selinux.labels-now-vs-policy` — a card no task names but that a named card
   * needs first, so a student *does* meet it. `reachable: false` is content that
   * exists and no route can deliver, which is the authoring bug.
   */
  reachable: boolean
  /** Task ids whose `requires_concepts` name this card, in bank order. */
  requiredByTasks: string[]
}

export interface ConceptsView {
  concepts: ConceptView[]
  /** `checkCoverage`'s authoring bugs, verbatim. The screen prints them; it does not rank them. */
  problems: string[]
}

export interface OverviewView {
  tasks: { total: number; byScope: Record<string, number> }
  objectives: { total: number; covered: number; uncovered: number; untouched: number }
  concepts: { total: number; untaught: number; unreachable: number }
  attempts: { total: number; clean: number; byMode: Record<string, number> }
  /**
   * Section 5.5's row, or `null` when the store has never been written — which is a
   * real state and not an error: it is a freshly opened database, before any session
   * has applied a `setup.sh`. Distinct from a row with `snapshot: null`, which is
   * `VmStateStore.unknown()` saying the guest is mid-revert or carrying a failed
   * setup. A screen must be able to tell "nothing has happened yet" from "something
   * happened and we do not know what", because only the second one calls for a reset.
   */
  vm: { snapshot: string | null; currentTask: string | null; appliedAt: number } | null
}

function areaOf(conceptId: string): string {
  const dot = conceptId.indexOf('.')
  return dot === -1 ? conceptId : conceptId.slice(0, dot)
}

/**
 * The Concepts screen's list. `coverage` is passed in rather than computed here so
 * one request can build both views off a single `checkCoverage` call.
 */
export function conceptsView(bank: Bank, coverage: CoverageReport): ConceptsView {
  const untaught = new Set(coverage.untaughtConcepts)
  const unreachable = new Set(coverage.unreachableConcepts)

  // One pass over the tasks rather than a scan per card: 40 cards times 40 tasks is
  // free either way, but the inverted index is also the thing that makes
  // `requiredByTasks` bank-ordered without a sort, and bank order is task id order.
  const requiredBy = new Map<string, string[]>()
  for (const task of bank.tasks) {
    for (const cid of task.requiresConcepts) {
      const list = requiredBy.get(cid) ?? []
      list.push(task.id)
      requiredBy.set(cid, list)
    }
  }

  return {
    concepts: bank.concepts.map((c) => ({
      id: c.id,
      title: c.title,
      area: areaOf(c.id),
      objectives: c.objectives,
      prerequisites: c.prerequisites,
      taught: !untaught.has(c.id),
      reachable: !unreachable.has(c.id),
      requiredByTasks: requiredBy.get(c.id) ?? [],
    })),
    problems: coverage.problems,
  }
}

/**
 * Counts by mode, with every mode present at zero.
 *
 * Keyed off `MODE_VALUES` — the same exported list the schema builds its
 * `CHECK` constraint from — so the breakdown cannot list a mode the database would
 * refuse, or omit one it accepts.
 */
function byMode(rows: readonly AttemptRow[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const mode of MODE_VALUES) counts[mode] = 0
  for (const row of rows) {
    // A row whose mode is outside the union can only exist if something wrote past
    // the schema's CHECK, so it is counted under its own key rather than dropped:
    // a total that does not match the sum of the breakdown is how that gets noticed.
    const key: AttemptMode = row.mode
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function byScope(bank: Bank): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const scope of SCOPE_VALUES) counts[scope] = 0
  for (const task of bank.tasks) counts[task.scope] = (counts[task.scope] ?? 0) + 1
  return counts
}

export interface OverviewInput {
  bank: Bank
  coverage: CoverageReport
  /** Every attempt the server can reach. See `app.ts`'s `allAttempts`. */
  attempts: readonly AttemptRow[]
  /** Attempts the `clean_attempts` view returns, i.e. usable as evidence. */
  cleanAttempts: number
  vmState?: VmStateStore
}

export function overviewView(input: OverviewInput): OverviewView {
  const { bank, coverage } = input
  const objectiveTotal = bank.objectives.objectives.length
  const uncovered = coverage.uncoveredObjectives.length
  const state = input.vmState?.current()

  return {
    tasks: { total: bank.tasks.length, byScope: byScope(bank) },
    objectives: {
      total: objectiveTotal,
      // Subtracted rather than counted, because `uncoveredObjectives` is already
      // "every objective with no exam-objective task" over the same taxonomy — so
      // this is the complement by construction and cannot disagree with it.
      // Recounting coverage here would reintroduce the section 6.4 rule (an
      // instrumental task cannot confer coverage) as a second copy.
      covered: objectiveTotal - uncovered,
      uncovered,
      untouched: coverage.untouchedObjectives.length,
    },
    concepts: {
      total: bank.concepts.length,
      untaught: coverage.untaughtConcepts.length,
      unreachable: coverage.unreachableConcepts.length,
    },
    attempts: {
      total: input.attempts.length,
      clean: input.cleanAttempts,
      byMode: byMode(input.attempts),
    },
    vm:
      state === undefined
        ? null
        : {
            snapshot: state.currentSnapshot,
            currentTask: state.currentTask,
            appliedAt: state.appliedAt,
          },
  }
}
