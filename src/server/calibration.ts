import type { AttemptRow } from '../engine/store/attempts.ts'

/**
 * Section 10.2's confidence calibration, as a report.
 *
 * The capture is one click (`POST /api/sessions/:id/predict`); this is the half
 * that makes the click worth recording. The spec's table is a 2×2 of predicted
 * against **actual** outcome, and each cell implies a different remedy — that is
 * the whole point of computing it:
 *
 * > **Overconfident** → a *verification* problem, not a knowledge problem. Remedy
 * > is habit drills, not more study. Studying harder would waste weeks.
 * > **Underconfident** → knows more than they think, burning exam time
 * > double-checking correct work. Remedy is to move faster.
 *
 * Two cells therefore point at opposite interventions, and a report that puts an
 * attempt in the wrong cell does not merely lose precision — it recommends the
 * wrong remedy for weeks. Everything defensive below follows from that.
 */

/** `'unsure'` makes no claim, so it is not a quadrant. See `CalibrationReport.unsure`. */
export type CalibrationQuadrant =
  | 'calibratedPass'
  | 'overconfident'
  | 'underconfident'
  | 'calibratedFail'

/**
 * The four cells of the spec's table, in its reading order.
 *
 * Keyed by the union rather than typed `Record<string, number>`, following
 * `store/schema.ts`'s `MODES` and `content/task.ts`'s `SCOPES`: the zeroed literal
 * in `emptyQuadrants` is checked against this type, so a fifth cell cannot be added
 * to the union without the initialiser failing to compile.
 */
export type QuadrantCounts = Record<CalibrationQuadrant, number>

export interface PersistenceCluster {
  /**
   * Overconfident attempts that were actually rebooted, i.e. the ones that *could*
   * have produced the evidence either way. The denominator, and it is not simply
   * `quadrants.overconfident` — see `clustered`.
   */
  considered: number
  /** Overconfident attempts carrying at least one pass → fail regression across the reboot. */
  onPersistence: number
  /**
   * Overconfident attempts on a task that never rebooted, so no verdict B exists
   * and the question cannot be asked of them. Reported rather than folded into
   * `considered`, because including them would make the ratio a statement about
   * which tasks set `reboot_check` rather than about the student.
   */
  notRebooted: number
  /**
   * Whether section 10.2's sharpest claim holds — *"if overconfident failures
   * cluster on persistence checkpoints, the diagnosis is not 'verify more' but
   * 'you believe you are finished before you have made it permanent'"* — or `null`
   * when there is not enough data to say.
   *
   * `null` rather than `false`, and the distinction is the whole reason this field
   * is not a boolean: the two answers lead somewhere different. `false` says *the
   * failures are spread out, so treat this as a verification habit*; `null` says
   * *nothing is known yet, keep practising*. Collapsing them would let one
   * overconfident attempt out of one silently recommend a specific habit drill, or
   * silently rule one out.
   */
  clustered: boolean | null
  /** The sentence a screen may print. Says "not enough data" when `clustered` is null. */
  statement: string
}

export interface CalibrationReport {
  /** Clean attempts carrying a prediction: the population the quadrants count. */
  considered: number
  /** Why attempts were left out, so a screen can say the report is thin rather than flat. */
  excluded: {
    /** The student did not click. Absent is absent; see `SessionRecord.predictedOutcome`. */
    noPrediction: number
    /**
     * The attempt carries a prediction but the grading run drifted, so there is no
     * trustworthy *actual* outcome to score the prediction against. `schema.ts`
     * already refuses a rating on these rows and exposes them only through
     * `clean_attempts`; a quadrant is the same kind of claim as a rating.
     */
    drifted: number
  }
  quadrants: QuadrantCounts
  /**
   * Predicted `unsure`, split by what happened. Deliberately outside the 2×2: the
   * spec's table has two predicted rows, and `unsure` asserts nothing, so there is
   * no such thing as an overconfident `unsure`. Counted anyway because a student
   * who clicks it for everything has produced a calibration report with no
   * quadrants in it, and that fact has to be visible somewhere.
   */
  unsure: { passed: number; failed: number }
  persistence: PersistenceCluster
}

/**
 * How many overconfident-and-rebooted attempts the cluster claim needs before it
 * is made at all.
 *
 * Five is a judgement, not a measurement — there is no calibration history in this
 * build to fit a threshold against, and saying so is more useful than a number
 * dressed up as derived. What fixes the *direction* of the judgement is the cost
 * asymmetry: the claim's remedy is "stop studying and drill a habit instead", so a
 * false positive costs weeks of the wrong work, while withholding it costs a
 * sentence on a dashboard that already says the data is thin. Section 9.4's rule —
 * *"a study tool that flatters is worse than no study tool"* — cuts the same way
 * for a tool that diagnoses confidently from four data points.
 */
export const MIN_OVERCONFIDENT_FOR_CLUSTER = 5

/**
 * The share of overconfident failures that must be persistence failures for
 * "cluster" to be the honest word. A simple majority: below it the failures are by
 * definition mostly something else, and the spec's alternative diagnosis
 * ("verify more") is the one that fits.
 */
export const CLUSTER_SHARE = 0.5

function emptyQuadrants(): QuadrantCounts {
  return { calibratedPass: 0, overconfident: 0, underconfident: 0, calibratedFail: 0 }
}

/**
 * Whether every checkpoint the grade script declares came back a pass.
 *
 * Read off the stored columns rather than re-derived from `finalVerdict`, because
 * those columns *are* what `reportFor` concluded at the time and re-deriving would
 * be a second opinion about a closed attempt. On a clean row
 * `checkpoints_seen = checkpoints_expected` holds by the schema's generated
 * `clean`, so this comparison is exactly `allPassed && !incomplete` — and this
 * function is only ever called on clean rows.
 */
function actuallyPassed(row: AttemptRow): boolean {
  return row.checkpointsPassed === row.checkpointsExpected
}

function quadrantFor(predicted: 'pass' | 'fail', passed: boolean): CalibrationQuadrant {
  if (predicted === 'pass') return passed ? 'calibratedPass' : 'overconfident'
  return passed ? 'underconfident' : 'calibratedFail'
}

function clusterStatement(cluster: Omit<PersistenceCluster, 'statement'>): string {
  if (cluster.clustered === null) {
    return (
      `not enough data: ${cluster.considered} overconfident attempt(s) with a reboot check, and this` +
      ` claim needs ${MIN_OVERCONFIDENT_FOR_CLUSTER}`
    )
  }
  if (cluster.clustered) {
    return (
      `${cluster.onPersistence} of ${cluster.considered} overconfident failures regressed across the` +
      ' reboot: you believe you are finished before you have made it permanent'
    )
  }
  return (
    `${cluster.onPersistence} of ${cluster.considered} overconfident failures regressed across the` +
    ' reboot, so these are not persistence failures — the gap is verification, not permanence'
  )
}

/**
 * Section 10.2's 2×2 plus its cross-reference against the reboot check.
 *
 * Takes rows rather than a store so the arithmetic is testable without a database
 * and so the caller decides which population it is asking about; `app.ts` hands in
 * every attempt it can reach. Rows that are not clean are counted and dropped — see
 * `excluded.drifted`.
 */
export function calibrationReport(rows: readonly AttemptRow[]): CalibrationReport {
  const quadrants = emptyQuadrants()
  const unsure = { passed: 0, failed: 0 }
  const excluded = { noPrediction: 0, drifted: 0 }
  let considered = 0
  let overconfidentRebooted = 0
  let overconfidentNotRebooted = 0
  let onPersistence = 0

  for (const row of rows) {
    const predicted = row.predictedOutcome
    if (predicted === undefined) {
      excluded.noPrediction += 1
      continue
    }
    if (!row.drift.clean) {
      excluded.drifted += 1
      continue
    }

    considered += 1
    const passed = actuallyPassed(row)
    if (predicted === 'unsure') {
      if (passed) unsure.passed += 1
      else unsure.failed += 1
      continue
    }

    const quadrant = quadrantFor(predicted, passed)
    quadrants[quadrant] += 1
    if (quadrant !== 'overconfident') continue

    // The cross-reference, and the only place the reboot check enters this report.
    // `regressionCount` is `grader.ts`'s pass-in-A-fail-in-B count, which is
    // section 5.4 step 4's persistence failure and nothing else — not a checkpoint
    // that merely failed, which could be any kind of wrong.
    if (!row.rebooted) {
      overconfidentNotRebooted += 1
      continue
    }
    overconfidentRebooted += 1
    if (row.regressionCount > 0) onPersistence += 1
  }

  const enough = overconfidentRebooted >= MIN_OVERCONFIDENT_FOR_CLUSTER
  const partial = {
    considered: overconfidentRebooted,
    onPersistence,
    notRebooted: overconfidentNotRebooted,
    clustered: enough ? onPersistence > overconfidentRebooted * CLUSTER_SHARE : null,
  }

  return {
    considered,
    excluded,
    quadrants,
    unsure,
    persistence: { ...partial, statement: clusterStatement(partial) },
  }
}
