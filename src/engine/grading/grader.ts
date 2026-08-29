import type { TaskSpec } from '../content/task.ts'
import type { LabTransport } from '../vm/transport.ts'
import { parseVerdict, statusById, type Checkpoint, type Verdict } from './verdict.ts'

export interface GradeOptions {
  task: TaskSpec
  transport: LabTransport
  /** Full text of grade.sh, with the assertion library prepended. */
  gradeScript: string
  /** Reboots the guest and resolves once it is reachable again. */
  reboot: () => Promise<void>
}

export interface GradeResult {
  /** "Works now". */
  verdictA: Verdict
  /** "Survives reboot". Absent when no reboot was performed. */
  verdictB?: Verdict
  /** Checkpoints that passed in A and regressed (failed or were skipped) in B: persistence failures. */
  regressions: Checkpoint[]
  rebooted: boolean
  /** Set when the VM did not come back. The user broke boot. */
  rebootError?: string
}

const NOT_REPORTED_DETAIL =
  'this checkpoint was not reported after the reboot; the grader likely stopped before reaching it'

const REBOOT_FAILED_DETAIL =
  'the guest did not come back after reboot, so persistence could not be verified'

/**
 * A grader that dies partway through its second run (the guest came back in
 * a broken state and the script hit `set -e`) still reports whatever
 * checkpoints it got to. Any checkpoint verdict A saw that verdict B never
 * emitted is filled in here as `fail`, in A's order, appended after B's own
 * checkpoints - so a regression on that id is never invisible to the
 * regression filter, which only ever looks at B.
 */
function completeVerdictB(verdictA: Verdict, verdictB: Verdict): Verdict {
  const reportedInB = new Set(verdictB.checkpoints.map((cp) => cp.id))
  const missing: Checkpoint[] = []
  for (const cp of verdictA.checkpoints) {
    if (reportedInB.has(cp.id)) continue
    missing.push({ id: cp.id, desc: cp.desc, status: 'fail', detail: NOT_REPORTED_DETAIL })
  }
  if (missing.length === 0) return verdictB
  return { checkpoints: [...verdictB.checkpoints, ...missing], noise: verdictB.noise }
}

/**
 * The verdict that actually counts.
 *
 * When the reboot itself failed, the guest's post-change state is unknown -
 * unverifiable is not the same as passing, so every pass in verdict A is
 * downgraded to fail rather than letting an unbootable machine score clean.
 * The checkpoint count and every id/desc are preserved, because the app
 * shows the user a masked checkpoint total derived from the grader script
 * before they start, and that total must never disagree with the verdict.
 * Otherwise, B is the real answer once a reboot happened, else A stands.
 */
export function finalVerdict(r: GradeResult): Verdict {
  if (r.rebootError !== undefined) {
    return {
      checkpoints: r.verdictA.checkpoints.map((cp) =>
        cp.status === 'pass'
          ? { ...cp, status: 'fail', detail: REBOOT_FAILED_DETAIL }
          : { ...cp },
      ),
      noise: r.verdictA.noise,
    }
  }
  return r.verdictB ?? r.verdictA
}

export async function grade(opts: GradeOptions): Promise<GradeResult> {
  const { task, transport, gradeScript, reboot } = opts

  // Exit code is deliberately ignored (spec section 6.5 rule 3).
  const runA = await transport.exec(gradeScript)
  const verdictA = parseVerdict(runA.stdout)

  const anythingPassed = verdictA.checkpoints.some((cp) => cp.status === 'pass')

  // No point rebooting to test persistence of work that was never done.
  if (!task.rebootCheck || !anythingPassed) {
    return { verdictA, regressions: [], rebooted: false }
  }

  try {
    await reboot()
  } catch (e) {
    return {
      verdictA,
      regressions: [],
      rebooted: false,
      rebootError: e instanceof Error ? e.message : String(e),
    }
  }

  const runB = await transport.exec(gradeScript)
  const verdictB = completeVerdictB(verdictA, parseVerdict(runB.stdout))

  const before = statusById(verdictA)
  const regressions = verdictB.checkpoints.filter(
    (cp) =>
      before.get(cp.id) === 'pass' && (cp.status === 'fail' || cp.status === 'skip'),
  )

  return { verdictA, verdictB, regressions, rebooted: true }
}
