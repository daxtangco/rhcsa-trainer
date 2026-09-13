import { describe, expect, it } from 'vitest'
import type { AttemptRow } from '../../src/engine/store/attempts.ts'
import type { PredictedOutcome } from '../../src/engine/store/schema.ts'
import { parseVerdict } from '../../src/engine/grading/verdict.ts'
import {
  calibrationReport,
  CLUSTER_SHARE,
  MIN_OVERCONFIDENT_FOR_CLUSTER,
} from '../../src/server/calibration.ts'

/**
 * Section 10.2's 2×2 as arithmetic, without a database.
 *
 * `calibrationReport` takes rows rather than a store precisely so this file can
 * assemble the populations that matter — including ones the real bank would take
 * weeks of study to produce — and assert the quadrant each attempt lands in. The
 * route-level half is in `predict.test.ts`.
 */

const VERDICT = parseVerdict('{"id":"a","desc":"d","status":"pass"}')

interface RowOptions {
  predicted?: PredictedOutcome
  /** Every declared checkpoint passed. */
  passed?: boolean
  clean?: boolean
  rebooted?: boolean
  regressions?: number
}

let seq = 0

/**
 * One attempt row.
 *
 * `passed` is expressed by moving `checkpointsPassed` to or below
 * `checkpointsExpected`, not by a flag, because that comparison is what
 * `calibrationReport` actually reads — a fixture with its own `passed` boolean would
 * pass whatever the function did with the columns.
 */
function row(opts: RowOptions = {}): AttemptRow {
  seq += 1
  const passed = opts.passed ?? true
  const clean = opts.clean ?? true
  const out: AttemptRow = {
    id: seq,
    taskId: 'storage/014-grow-home-lv',
    objectiveIds: ['storage.lvm.resize'],
    mode: 'practice',
    startedAt: 1000,
    finishedAt: 2000,
    recordedAt: 2000,
    durationS: 1,
    rungUsed: 1,
    verdictA: VERDICT,
    finalVerdict: VERDICT,
    checkpointsPassed: passed ? 3 : 1,
    checkpointsSeen: clean ? 3 : 2,
    checkpointsExpected: 3,
    regressionCount: opts.regressions ?? 0,
    rebooted: opts.rebooted ?? false,
    drift: {
      suspect: !clean,
      incomplete: !clean,
      countDisputed: false,
      countMismatch: !clean,
      clean,
    },
    rating: null,
  }
  if (opts.predicted !== undefined) out.predictedOutcome = opts.predicted
  return out
}

describe('the four quadrants', () => {
  it('puts each predicted/actual pair in the cell section 10.2 names', () => {
    const report = calibrationReport([
      row({ predicted: 'pass', passed: true }),
      row({ predicted: 'pass', passed: false }),
      row({ predicted: 'fail', passed: true }),
      row({ predicted: 'fail', passed: false }),
    ])

    expect(report.quadrants).toEqual({
      calibratedPass: 1,
      overconfident: 1,
      underconfident: 1,
      calibratedFail: 1,
    })
    expect(report.considered).toBe(4)
  })

  it('reads "actually passed" off the stored columns, not off finalVerdict', () => {
    // A row whose verdict object says pass but whose columns say two of three
    // checkpoints failed. The columns are what `reportFor` concluded at the time, and
    // that is the closed attempt's answer.
    const r = row({ predicted: 'pass' })
    r.checkpointsPassed = 1
    expect(calibrationReport([r]).quadrants.overconfident).toBe(1)
  })

  it('counts unsure outside the 2x2, split by outcome', () => {
    const report = calibrationReport([
      row({ predicted: 'unsure', passed: true }),
      row({ predicted: 'unsure', passed: false }),
      row({ predicted: 'unsure', passed: false }),
    ])
    expect(report.unsure).toEqual({ passed: 1, failed: 2 })
    // Three attempts were considered and no quadrant was filled: a student clicking
    // unsure for everything must be visible as exactly that, not as an empty report.
    expect(report.considered).toBe(3)
    expect(report.quadrants).toEqual({
      calibratedPass: 0,
      overconfident: 0,
      underconfident: 0,
      calibratedFail: 0,
    })
  })
})

describe('what is excluded, and why', () => {
  it('counts an attempt with no prediction out rather than defaulting it', () => {
    const report = calibrationReport([row(), row({ predicted: 'pass' })])
    expect(report.excluded.noPrediction).toBe(1)
    expect(report.considered).toBe(1)
    expect(report.quadrants.calibratedPass).toBe(1)
  })

  it('counts a drifted attempt out even though it carries a prediction', () => {
    // The prediction is real; the *actual outcome* is not trustworthy, so there is
    // nothing to score it against. Same rule the schema applies to `rating`.
    const report = calibrationReport([row({ predicted: 'pass', passed: false, clean: false })])
    expect(report.excluded.drifted).toBe(1)
    expect(report.considered).toBe(0)
    expect(report.quadrants.overconfident).toBe(0)
  })

  it('checks the prediction before the drift, so the two exclusions cannot double-count', () => {
    const report = calibrationReport([row({ clean: false })])
    expect(report.excluded).toEqual({ noPrediction: 1, drifted: 0 })
  })
})

describe('the persistence-cluster claim', () => {
  function overconfident(count: number, opts: RowOptions): AttemptRow[] {
    return Array.from({ length: count }, () => row({ predicted: 'pass', passed: false, ...opts }))
  }

  it('withholds the claim as null below the minimum, and says so', () => {
    const rows = overconfident(MIN_OVERCONFIDENT_FOR_CLUSTER - 1, {
      rebooted: true,
      regressions: 1,
    })
    const report = calibrationReport(rows)

    // Every one of these regressed, so a threshold-free implementation would have
    // claimed a cluster at 100%. `null` is the point of the test.
    expect(report.persistence.onPersistence).toBe(MIN_OVERCONFIDENT_FOR_CLUSTER - 1)
    expect(report.persistence.clustered).toBeNull()
    expect(report.persistence.statement).toContain('not enough data')
    expect(report.persistence.statement).toContain(String(MIN_OVERCONFIDENT_FOR_CLUSTER))
  })

  it('claims the cluster once there is enough data and a majority regressed', () => {
    const report = calibrationReport([
      ...overconfident(MIN_OVERCONFIDENT_FOR_CLUSTER, { rebooted: true, regressions: 1 }),
    ])
    expect(report.persistence.clustered).toBe(true)
    expect(report.persistence.statement).toContain('before you have made it permanent')
  })

  it('reports false, not null, when there is enough data and the failures are elsewhere', () => {
    const report = calibrationReport([
      ...overconfident(MIN_OVERCONFIDENT_FOR_CLUSTER, { rebooted: true, regressions: 0 }),
    ])
    // The distinction this whole field exists for: "spread out, so drill
    // verification" is a different remedy from "nothing is known yet".
    expect(report.persistence.clustered).toBe(false)
    expect(report.persistence.statement).toContain('verification, not permanence')
  })

  it('needs a strict majority: exactly half is not a cluster', () => {
    const n = MIN_OVERCONFIDENT_FOR_CLUSTER * 2
    const half = n / 2
    const report = calibrationReport([
      ...overconfident(half, { rebooted: true, regressions: 1 }),
      ...overconfident(half, { rebooted: true, regressions: 0 }),
    ])
    expect(CLUSTER_SHARE).toBe(0.5)
    expect(report.persistence.considered).toBe(n)
    expect(report.persistence.onPersistence).toBe(half)
    expect(report.persistence.clustered).toBe(false)
  })

  it('keeps un-rebooted attempts out of the denominator', () => {
    // Otherwise the ratio measures which tasks set reboot_check, not the student.
    const report = calibrationReport([
      ...overconfident(MIN_OVERCONFIDENT_FOR_CLUSTER, { rebooted: true, regressions: 1 }),
      ...overconfident(20, { rebooted: false }),
    ])
    expect(report.quadrants.overconfident).toBe(MIN_OVERCONFIDENT_FOR_CLUSTER + 20)
    expect(report.persistence.considered).toBe(MIN_OVERCONFIDENT_FOR_CLUSTER)
    expect(report.persistence.notRebooted).toBe(20)
    expect(report.persistence.clustered).toBe(true)
  })

  it('ignores regressions on attempts that were not overconfident', () => {
    // A *calibrated* failure that regressed is not evidence about confidence: the
    // student said it would fail and it did.
    const report = calibrationReport([
      ...Array.from({ length: 20 }, () =>
        row({ predicted: 'fail', passed: false, rebooted: true, regressions: 1 }),
      ),
    ])
    expect(report.quadrants.calibratedFail).toBe(20)
    expect(report.persistence.considered).toBe(0)
    expect(report.persistence.clustered).toBeNull()
  })
})

describe('an empty history', () => {
  it('answers with zeroes and no claim, rather than refusing', () => {
    const report = calibrationReport([])
    expect(report.considered).toBe(0)
    expect(report.quadrants).toEqual({
      calibratedPass: 0,
      overconfident: 0,
      underconfident: 0,
      calibratedFail: 0,
    })
    expect(report.persistence.clustered).toBeNull()
  })
})
