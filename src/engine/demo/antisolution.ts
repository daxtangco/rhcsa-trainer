import { ContentError } from '../content/errors.ts'
import type { TaskSpec } from '../content/task.ts'
import type { GradeResult } from '../grading/grader.ts'
import { statusById, type Checkpoint, type Verdict } from '../grading/verdict.ts'
import type { ExecResult } from '../vm/transport.ts'
import { parseExpectations, type ExpectedFailure } from '../validate/expectations.ts'
import type { Fixture, TaskScripts } from '../validate/harness.ts'

/**
 * Section 7.2's anti-solutions, run as a **demonstration** rather than as a gate.
 *
 * > The set of anti-solutions per task is a teaching asset in its own right. After
 * > a task completes, the app can offer: *"Here are three ways this looks correct
 * > but isn't. Want to see one?"* … The user watches a plausible-looking solution
 * > pass the immediate check and fail the reboot check. This is the single most
 * > valuable teaching moment the harness can produce, and it comes free.
 *
 * "Comes free" is literal, and it constrains this module more than it sounds. The
 * validation harness (`validate/harness.ts`) already reverts, runs `setup.sh`, runs
 * the fixture, and grades — and `grading/grader.ts` already runs verdict A, reboots,
 * runs verdict B, and computes the pass→fail set as `regressions`. So one
 * `gradeTask` call *is* the before/after contrast; there is nothing to build except
 * the sequencing and the read model. This module therefore adds no grading logic,
 * no second checkpoint comparison, and no second header parser: `parseExpectations`
 * is the one that `harness.ts` and `cli/lint.ts` both use, and it is called here,
 * not reimplemented.
 *
 * ## The difference from validation, which is the reason this is a separate module
 *
 * `validateTask` asks *"is this grader correct?"* and answers with a list of
 * failures. A demonstration asks *"what does this mistake look like?"* and answers
 * with two verdicts the student reads side by side. The same run produces both, but
 * the framing inverts: an anti-solution behaving exactly as declared is a **success**
 * for the validator and is also the *only* case worth showing a student, because a
 * demonstration whose "after" verdict does not actually fail teaches the opposite of
 * the lesson. So `DemoOutcome.taught` is checked against the declaration for the
 * student's sake, not the grader's.
 *
 * ## Reboot versus relabel: what is derivable and what is not
 *
 * The assignment for this module asked which demonstrations are caught by a reboot
 * and which by a relabel (`restorecon` / `/.autorelabel`), derived from the content
 * rather than hardcoded. Half of that is derivable and half is not, and the honest
 * answer is worth more than a guess:
 *
 * **Reboot demonstrations are derivable.** `parseExpectations` returns a phase per
 * checkpoint, `expectedStatus` maps `@post` to "must fail in verdict B and pass in
 * verdict A", and `grader.ts` only produces a verdict B when `task.rebootCheck` is
 * true. So an anti-solution declaring at least one `@post` id on a reboot-checking
 * task is exactly one that passes now and fails after the reboot — see `demoKind`.
 * Measured against the bank on 2026-09-13: 12 of the 44 anti-solutions declare a
 * `@post` id, across 9 of the 12 tasks, and every one of those 9 has
 * `reboot_check: true`.
 *
 * **Relabel demonstrations are not derivable, and cannot currently be run at all.**
 * Three independent measurements say so:
 *
 * 1. `ExpectPhase` is `'pre' | 'post' | 'both'`. There is no phase that means "after
 *    a relabel", so no anti-solution in the bank can declare one, and there is
 *    nothing in a header to derive a relabel demonstration *from*.
 * 2. The VM layer has no relabel operation. `VmController` exposes power, stop,
 *    snapshot, revert, listSnapshots, guestUp, waitForGuest and reboot — so even
 *    given a declaration there is no machinery to trigger `/.autorelabel` and take a
 *    second verdict across it.
 * 3. The bank does not encode relabel durability as a phase in the first place; it
 *    encodes it as a **policy** checkpoint that fails immediately.
 *    `selinux/019-httpd-alt-port/antisolutions/01-chcon-only.sh` declares
 *    `# expect-fail: context-permanent` with no phase — so `both`, failing in
 *    verdict A — and its own comment says *"this anti-solution passes the reboot
 *    check"*; `selinux/032-selinux-denial-triage/antisolutions/01-chcon-only.sh`
 *    does the same with `context-policy` and says *"surviving a reboot and surviving
 *    a relabel are two different kinds of durability"*. The grader answers the
 *    relabel question with `matchpathcon` against the policy, at grade time, which
 *    is why it needs no relabel to ask it.
 *
 * That third point is the useful one, and it is why `DemoKind` has an `immediate`
 * arm rather than a `relabel` arm: a chcon-only anti-solution *is* a demonstration,
 * and a good one, but its lesson is "the grader checks the policy, not the label you
 * can see" and it lands entirely in verdict A. Labelling it `relabel` would promise a
 * before/after contrast this server cannot produce. If a relabel demonstration is
 * wanted, it needs a new `ExpectPhase` and a controller operation, in that order —
 * both outside this module.
 */

/**
 * What kind of teaching moment an anti-solution produces. Derived from its
 * `# expect-fail:` phases and the task's `reboot_check`, never from a list of file
 * names — see this file's header for the third kind that is deliberately absent.
 */
export type DemoKind =
  /**
   * Section 7.2's headline: passes the immediate check, fails the reboot check. At
   * least one `@post` id, on a task that reboots.
   */
  | 'reboot'
  /**
   * Wrong from the start: every declared id fails in verdict A (phase `both`), or is
   * expected to *stop* failing after the reboot (phase `pre`). Still worth showing —
   * "this is what the grader catches and why" — but the contrast is between the
   * anti-solution and a correct solution, not between two verdicts.
   */
  | 'immediate'

export interface DemoPlan {
  taskId: string
  /** The anti-solution's file name, e.g. `02-removed-persistence.sh`. */
  name: string
  kind: DemoKind
  /** Every declared failure, phase retained, as `parseExpectations` returned it. */
  declared: ExpectedFailure[]
  /**
   * The ids declared `@post`: the ones whose flip from pass to fail *is* the lesson.
   * Empty on an `immediate` demo, which is what makes the two kinds distinguishable
   * without re-reading `kind`.
   */
  flips: string[]
  /**
   * One sentence naming what the student is about to watch, built from the
   * declaration. Carried on the plan rather than composed in the UI because the
   * reason a demo is worth watching is the reason it was classified, and those two
   * must not be able to disagree.
   */
  headline: string
}

function headlineFor(kind: DemoKind, task: TaskSpec, flips: string[]): string {
  if (kind === 'reboot') {
    return (
      `this passes the immediate check and then fails after the reboot: ${flips.join(', ')}` +
      ` stop holding once ${task.id.split('/')[1] ?? task.id} restarts`
    )
  }
  return 'the grader catches this immediately, before any reboot is needed'
}

/**
 * Classify one anti-solution. Throws the `ContentError` `parseExpectations` throws
 * when the header is missing or malformed, for the reason `harness.ts` lets it
 * through: an anti-solution with no `# expect-fail:` header is a fixture nothing can
 * check, and `rhcsa lint` already refuses to ship one.
 */
export function planDemo(task: TaskSpec, fixture: Fixture): DemoPlan {
  const where = `${task.id}/antisolutions/${fixture.name}`
  const declared = parseExpectations(fixture.script, where)
  const flips = declared.filter((d) => d.phase === 'post').map((d) => d.id)

  // `task.rebootCheck` is required as well as a `@post` id, because `grader.ts`
  // skips the reboot entirely without it — so the demo would promise a contrast and
  // return one verdict. `harness.ts` already reports the same combination as a
  // content defect (`declares @post but the task has reboot_check: false`), so this
  // branch is unreachable against a linted bank and is written anyway: what it costs
  // is a demo classified `immediate`, and what the alternative costs is a screen with
  // an empty "after" column.
  const kind: DemoKind = flips.length > 0 && task.rebootCheck ? 'reboot' : 'immediate'

  return { taskId: task.id, name: fixture.name, kind, declared, flips, headline: headlineFor(kind, task, flips) }
}

/**
 * Every anti-solution of a task, classified, with unparseable ones collected rather
 * than thrown.
 *
 * The asymmetry with `planDemo` is deliberate and is the same one `parseDeclaredIds`
 * draws: offering the student a menu must not be taken down by one bad header, and a
 * menu that silently omits the broken entry hides a content defect. So the caller
 * gets the plans it can offer *and* the problems, and can show both.
 */
export function planDemos(task: TaskSpec, scripts: TaskScripts): { plans: DemoPlan[]; problems: string[] } {
  const plans: DemoPlan[] = []
  const problems: string[] = []
  for (const fixture of scripts.fixtures) {
    if (fixture.kind !== 'antisolution') continue
    try {
      plans.push(planDemo(task, fixture))
    } catch (e) {
      if (e instanceof ContentError) problems.push(...e.problems.map((p) => `${e.where}: ${p}`))
      else problems.push(`${task.id}/antisolutions/${fixture.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { plans, problems }
}

/**
 * The transport surface a demo needs, structural rather than imported.
 *
 * `server/lab.ts`'s `LabRuntime` satisfies it, so `app.ts` passes its runtime
 * straight in, and the `FakeTransport`-backed runtime the tests build satisfies it
 * too. Declared here rather than imported for the reason `AttemptReport` is: the
 * engine is the lower layer and must not depend on the server. If a method here is
 * renamed there, the call site stops compiling.
 */
export interface DemoRuntime {
  reset(): Promise<void>
  exec(script: string): Promise<ExecResult>
  gradeTask(task: TaskSpec, gradeScript: string): Promise<GradeResult>
}

/** One verdict, reduced to what a side-by-side panel renders. */
export interface DemoVerdict {
  /** Which column this is: verdict A is "works now", verdict B is "survives reboot". */
  label: 'A' | 'B'
  passed: number
  failed: number
  /**
   * Unmasked, unlike a graded session's report.
   *
   * A demo has no rating, no ladder and no rung — the student already finished the
   * task, and what they are watching is a *deliberately wrong* solution somebody
   * else wrote. There is nothing left for masking to protect: the whole point is
   * that they read which checkpoint went red and why. This is the one place in the
   * server that hands over checkpoint descriptions and details unconditionally, and
   * it is safe precisely because nothing here describes the student's own work.
   */
  checkpoints: Checkpoint[]
}

function summarise(label: 'A' | 'B', verdict: Verdict): DemoVerdict {
  return {
    label,
    passed: verdict.checkpoints.filter((cp) => cp.status === 'pass').length,
    failed: verdict.checkpoints.filter((cp) => cp.status !== 'pass').length,
    checkpoints: verdict.checkpoints,
  }
}

export interface DemoOutcome {
  plan: DemoPlan
  /** "Works now". Always present: a demo that reached grading has a verdict A. */
  before: DemoVerdict
  /**
   * "Survives reboot", or `null` when no reboot happened — either because the task
   * does not reboot-check, or because `grader.ts` skipped the reboot after nothing
   * passed in verdict A. `null` rather than absent so the UI's two columns are always
   * two columns, one of which may say why it is empty.
   */
  after: DemoVerdict | null
  /**
   * The checkpoints that passed before and failed after: `grader.ts`'s `regressions`,
   * unchanged. **This is the pedagogical payload** — the ids here are the ones the UI
   * highlights, and they are what makes the contrast a lesson rather than two tables.
   */
  flipped: Checkpoint[]
  /**
   * Whether the demonstration actually taught what it claimed.
   *
   * `false` means the contrast the plan promised did not happen — a `reboot` demo
   * whose `@post` ids did not flip, most likely because the guest or the grader has
   * drifted. Reported rather than hidden, and the UI must say so: showing a student
   * "watch this fail after the reboot" and then two identical green columns teaches
   * that persistence failures do not happen, which is the exact opposite of section
   * 7.2's lesson and worse than showing nothing.
   */
  taught: boolean
  /** Why `taught` is false, empty when it is true. Also carries a failed reboot. */
  problems: string[]
}

/** Where a demo stopped, when it did not reach a verdict. */
export interface DemoFailure {
  plan: DemoPlan
  stage: 'setup' | 'antisolution'
  message: string
}

export type DemoResult = { ok: true; outcome: DemoOutcome } | { ok: false; failure: DemoFailure }

export interface RunDemoOptions {
  task: TaskSpec
  scripts: TaskScripts
  plan: DemoPlan
  runtime: DemoRuntime
  /**
   * Called immediately before the revert and again once the run is over.
   *
   * A demo leaves the guest carrying this task's `setup.sh` plus a **deliberately
   * wrong** solution, and then possibly a reboot on top. No `vm_state` row can
   * honestly describe that: it is not the clean snapshot and it is not "task X's
   * setup is applied" either, because something has since scribbled on it. So the
   * caller marks the state unknown at both ends, and section 5.5's guard refuses the
   * next grade until a reset — which is correct, because a grade against a machine a
   * demo just sabotaged would fail for reasons that are nothing to do with the
   * student.
   */
  markUnknown?: () => void
}

/**
 * Revert, set the task up, run the anti-solution, grade across the reboot.
 *
 * Deliberately identical in order to `harness.ts`'s `runFixture`, because that
 * sequence is the thing that has been exercised against the real guest. The
 * differences are all in what is *reported*, not in what is run.
 */
export async function runDemo(opts: RunDemoOptions): Promise<DemoResult> {
  const { task, scripts, plan, runtime } = opts
  const fixture = scripts.fixtures.find((f) => f.kind === 'antisolution' && f.name === plan.name)
  if (fixture === undefined) {
    return {
      ok: false,
      failure: { plan, stage: 'antisolution', message: `${plan.taskId} has no anti-solution named ${plan.name}` },
    }
  }

  opts.markUnknown?.()
  await runtime.reset()

  const setup = await runtime.exec(scripts.setup)
  if (setup.code !== 0) {
    // Same reasoning as `runFixture`: a failed setup leaves the anti-solution acting
    // on a machine nobody arranged, so every checkpoint after this point would be a
    // red herring — and in a *demonstration* a red herring is worse than an error,
    // because the student has been told in advance what to expect and will believe it.
    return {
      ok: false,
      failure: { plan, stage: 'setup', message: `setup.sh exited ${setup.code}: ${setup.stderr.trim() || setup.stdout.trim()}` },
    }
  }

  const applied = await runtime.exec(fixture.script)
  if (applied.code !== 0) {
    return {
      ok: false,
      failure: {
        plan,
        stage: 'antisolution',
        message: `${plan.name} exited ${applied.code}: ${applied.stderr.trim() || applied.stdout.trim()}`,
      },
    }
  }

  // One call. It runs verdict A, reboots when the task reboot-checks and something
  // passed, runs verdict B, and computes the pass→fail set. Section 7.2's whole
  // demonstration is the return value of this line.
  const result = await runtime.gradeTask(task, scripts.grade)

  const problems: string[] = []
  if (result.rebootError !== undefined) problems.push(`the guest did not come back: ${result.rebootError}`)

  const before = summarise('A', result.verdictA)
  const after = result.verdictB === undefined ? null : summarise('B', result.verdictB)

  // Checked against the declaration rather than against "did anything go red",
  // because a `reboot` demo whose *other* checkpoints failed still failed to show
  // the flip it advertised.
  if (plan.kind === 'reboot') {
    if (after === null) {
      problems.push(
        'no verdict B: the reboot did not happen, so the contrast this demo exists to show was never produced',
      )
    } else {
      const beforeStatus = statusById(result.verdictA)
      const afterStatus = statusById(result.verdictB ?? result.verdictA)
      for (const id of plan.flips) {
        const a = beforeStatus.get(id)
        const b = afterStatus.get(id)
        if (a === undefined) problems.push(`${id} was declared @post but the grader never emitted it`)
        else if (a !== 'pass') problems.push(`${id} was declared @post but did not pass before the reboot (${a})`)
        else if (b === 'pass') problems.push(`${id} was declared @post but still passed after the reboot`)
      }
    }
  } else if (before.failed === 0) {
    problems.push('every checkpoint passed, so this anti-solution demonstrated nothing')
  }

  opts.markUnknown?.()

  return {
    ok: true,
    outcome: { plan, before, after, flipped: result.regressions, taught: problems.length === 0, problems },
  }
}
