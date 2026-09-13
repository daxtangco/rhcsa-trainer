import type { TaskSpec } from '../content/task.ts'
import type { ExecResult, LabTransport, TransportKind } from '../vm/transport.ts'
import { parseVerdict, statusById, type Checkpoint, type Verdict } from './verdict.ts'

export interface GradeOptions {
  task: TaskSpec
  transport: LabTransport
  /** Full text of grade.sh, with the assertion library prepended. */
  gradeScript: string
  /** Reboots the guest and resolves once it is reachable again. */
  reboot: () => Promise<void>
  /**
   * A second channel, used for the **post-reboot run only**, and only when the
   * first one produced no checkpoints at all.
   *
   * The case it exists for is measured and specific, and it is not a flake.
   * `storage/014-grow-home-lv`'s `antisolutions/02-removed-persistence.sh`
   * un-persists `/home`; `/home/student/.ssh/authorized_keys` lives on that same
   * logical volume, so after the reboot ssh key auth has nothing to read and the
   * grader never starts. The machine is fine, the change under test is exactly
   * what the fixture meant to make, and the persistence question — did `/home`
   * come back mounted from the LV? — is still perfectly answerable, just not over
   * ssh. `vmrun` goes through open-vm-tools and never authenticates, so it can
   * answer it. Measured 2026-09-13: pinned to ssh the fixture reported
   * `Permission denied (publickey,…)` and 5/6, while over vmrun the same fixture
   * set reported 6/6 with no content change — the two channels disagreeing about
   * identical content is what identified this. Re-measured with this field wired
   * up, `RHCSA_TRANSPORT=ssh npm run validate -- storage/014-grow-home-lv` reports
   * 6/6 and carries the fallback note on `02-removed-persistence.sh`.
   *
   * Deliberately narrow, in three ways:
   *
   * - **Verdict B only.** If the *first* run cannot reach the guest, nothing has
   *   been established about the machine and quietly switching channels would
   *   hide a broken lab setup. By verdict B a full verdict A is already in hand.
   * - **Only on "nothing at all".** A grader that emitted even one checkpoint ran;
   *   re-running it elsewhere would risk two disagreeing measurements of one
   *   reboot.
   * - **Never silent.** A verdict B that came from here is stamped
   *   `verdictBVia`, because a pass over a channel the caller did not choose is a
   *   different claim from a pass over the one it did.
   */
  fallback?: LabTransport
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
  /**
   * Set when the guest came back but the post-reboot grade run never executed:
   * the machine is up and the *control channel* is not. Distinct from
   * `rebootError` because the two send a reader to opposite places — one to the
   * guest's boot, one to the transport.
   */
  postRebootError?: string
  /**
   * Which channel produced verdict B, set **only** when it was not the one the
   * caller passed as `transport` — that is, when `GradeOptions.fallback` was used.
   * Absent on every ordinary grade, so it reads as "something unusual happened
   * here" rather than as a field to be checked.
   */
  verdictBVia?: TransportKind
}

const NOT_REPORTED_DETAIL =
  'this checkpoint was not reported after the reboot; the grader likely stopped before reaching it'

/** Enough stderr to name the cause, bounded so one failure cannot flood a report. */
const MAX_STDERR = 300

/**
 * Why an unexecuted second run is worth telling apart from a truncated one.
 *
 * `waitForGuest` polls with **vmrun** (open-vm-tools), so it reports the guest up
 * the moment `vmtoolsd` starts and never tests whether ssh can *authenticate*.
 * The grade run that follows goes over the ssh transport. Those two can disagree,
 * and one task in this bank makes them disagree by design:
 * `storage/014-grow-home-lv`'s `antisolutions/02-removed-persistence.sh`
 * un-persists `/home`, and `/home/student/.ssh/authorized_keys` lives on that very
 * logical volume (measured on the lab guest, 2026-09-13:
 * `df --output=source /home/student/.ssh/authorized_keys` → `/dev/mapper/rhel-home`).
 * After the reboot sshd is listening and key auth has nothing to read, so the
 * grader never runs.
 *
 * Before this, that arrived as `fail: this checkpoint was not reported after the
 * reboot; the grader likely stopped before reaching it` — a guess, and the wrong
 * one, pointing at content that is fine. The tell that it was wrong: the missing
 * ids were the *first* and *fourth* a grader with no `set -e` emits, and a script
 * that "stopped partway" cannot skip the first and deliver the fifth.
 */
function describeExecFailure(r: ExecResult): string {
  const why = r.stderr.trim().replace(/\s+/g, ' ')
  const tail = why.length > MAX_STDERR ? `${why.slice(0, MAX_STDERR)}…` : why
  const head = `the post-reboot grade run never executed (the transport exited ${r.code} and emitted no checkpoints)`
  return tail.length > 0 ? `${head}: ${tail}` : `${head}, and said nothing on stderr`
}

const REBOOT_FAILED_DETAIL =
  'the guest did not come back after reboot, so persistence could not be verified'

/**
 * A grader that dies partway through its second run (the guest came back in
 * a broken state and the script hit `set -e`) still reports whatever
 * checkpoints it got to. Any checkpoint verdict A saw that verdict B never
 * emitted is filled in here as `fail`, in A's order, appended after B's own
 * checkpoints - so a regression on that id is never invisible to the
 * regression filter, which only ever looks at B.
 *
 * `detail` overrides the "stopped before reaching it" wording when the caller
 * knows better. The statuses do not change: unverified is still fail, whichever
 * story produced it. Only the sentence the student reads changes, and it should,
 * because "your grader died here" and "the grader never started" send them to
 * different files.
 */
function completeVerdictB(
  verdictA: Verdict,
  verdictB: Verdict,
  detail = NOT_REPORTED_DETAIL,
): Verdict {
  const reportedInB = new Set(verdictB.checkpoints.map((cp) => cp.id))
  const missing: Checkpoint[] = []
  for (const cp of verdictA.checkpoints) {
    if (reportedInB.has(cp.id)) continue
    missing.push({ id: cp.id, desc: cp.desc, status: 'fail', detail })
  }
  if (missing.length === 0) return verdictB
  // Copy noise rather than reusing verdictB's array: the returned verdict
  // must share no mutable state with its input, so a caller pushing onto the
  // result cannot write back into a verdict this module did not create.
  return { checkpoints: [...verdictB.checkpoints, ...missing], noise: [...verdictB.noise] }
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
      // Copied, not aliased: verdictA.noise is still exposed on the input
      // GradeResult, and a caller mutating the returned verdict's noise must
      // not reach back into it.
      noise: [...r.verdictA.noise],
    }
  }
  return r.verdictB ?? r.verdictA
}

/**
 * "The run did not happen", as opposed to "the run happened and went badly".
 *
 * Both halves are needed. Zero checkpoints with exit 0 is a grader that emitted
 * nothing, which is a content bug and must keep saying so; and a non-zero exit
 * *with* checkpoints is the normal case, because the exit code is ignored by
 * contract (spec section 6.5 rule 3) and `ck_fail` scripts routinely end
 * non-zero.
 */
function neverRan(run: ExecResult, parsed: Verdict): boolean {
  return parsed.checkpoints.length === 0 && run.code !== 0
}

export async function grade(opts: GradeOptions): Promise<GradeResult> {
  const { task, transport, gradeScript, reboot, fallback } = opts

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

  let runB = await transport.exec(gradeScript)
  let parsedB = parseVerdict(runB.stdout)
  let verdictBVia: TransportKind | undefined
  let alsoFailed: string | undefined

  // The one retry in the whole grader, and the reasoning for it is on
  // `GradeOptions.fallback`. Guarded on `kind` so a caller that passes the same
  // transport twice — easy to do when both come out of one config object — runs
  // the grader once rather than running an identical failure twice and reporting
  // the second one.
  if (fallback !== undefined && fallback.kind !== transport.kind && neverRan(runB, parsedB)) {
    let retry: ExecResult
    try {
      retry = await fallback.exec(gradeScript)
    } catch (e) {
      // `LabTransport.exec` promises not to throw on a non-zero exit, not that it
      // cannot throw at all — vmrun.exe missing, or a `.vmx` path that does not
      // resolve, both surface here. Swallowing it back into the original result
      // is deliberate: the failure that a reader needs is the *first* one, about
      // the channel they chose, and losing that to a secondary problem with a
      // channel they never asked for would be a strictly worse report.
      retry = { stdout: '', stderr: e instanceof Error ? e.message : String(e), code: -1 }
    }
    const parsedRetry = parseVerdict(retry.stdout)
    if (!neverRan(retry, parsedRetry)) {
      runB = retry
      parsedB = parsedRetry
      verdictBVia = fallback.kind
    } else {
      // Both channels are gone, so the report names both. `runB` is deliberately
      // left as the *first* result: its stderr is the one a reader needs, because
      // it is about the channel they chose. This sentence is what stops them
      // chasing the fallback as if it were the primary problem.
      alsoFailed =
        ` (the ${fallback.kind} fallback was tried and also produced no checkpoints, exiting ` +
        `${retry.code})`
    }
  }

  const postRebootError = neverRan(runB, parsedB)
    ? `${describeExecFailure(runB)}${alsoFailed ?? ''}`
    : undefined

  const verdictB = completeVerdictB(verdictA, parsedB, postRebootError)

  const before = statusById(verdictA)
  const regressions = verdictB.checkpoints.filter(
    (cp) =>
      before.get(cp.id) === 'pass' && (cp.status === 'fail' || cp.status === 'skip'),
  )

  // Not folded into `rebootError`. The statuses those two produce are identical -
  // both mean "post-reboot state unverified", and `completeVerdictB` has already
  // downgraded every A-pass to fail - but they are different failures with
  // different fixes, and `finalVerdict`'s rebootError branch would relabel the
  // whole verdict "the guest did not come back", which here is measurably untrue:
  // `waitForGuest` saw it come back. Sending someone to debug a boot that worked
  // is the same category of error this field exists to stop.
  return { verdictA, verdictB, regressions, rebooted: true, postRebootError, verdictBVia }
}
