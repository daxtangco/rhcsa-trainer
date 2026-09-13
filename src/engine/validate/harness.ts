import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { TaskSpec } from '../content/task.ts'
import { grade } from '../grading/grader.ts'
import { duplicateIds, statusById, type Verdict } from '../grading/verdict.ts'
import type { LabTransport } from '../vm/transport.ts'
import { expectedStatus, parseExpectations, type ExpectedFailure } from './expectations.ts'

export type FixtureKind = 'none' | 'solution' | 'antisolution'

export interface Fixture {
  kind: FixtureKind
  name: string
  script: string
}

export interface TaskScripts {
  setup: string
  /** grade.sh with the assertion library already prepended. */
  grade: string
  fixtures: Fixture[]
}

export interface HarnessDeps {
  transport: LabTransport
  /**
   * Passed straight to `grade()` as its post-reboot fallback channel; see
   * `GradeOptions.fallback` for what it is for and why it is that narrow. Only
   * verdict B uses it — `setup.sh` and the fixture script above run on
   * `transport` alone, because a fixture that cannot be *applied* has measured
   * nothing and must fail rather than quietly change channels.
   */
  fallback?: LabTransport
  /** Revert to the clean snapshot. */
  reset: () => Promise<void>
  reboot: () => Promise<void>
}

export interface FixtureResult {
  taskId: string
  kind: FixtureKind
  name: string
  ok: boolean
  failures: string[]
  /**
   * Things a reader needs to know about *how* the result was obtained, which are
   * not themselves failures. Kept separate from `failures` because `ok` is derived
   * from that array, so anything appended there changes the exit code — and a note
   * that turned a validate run red would make the honest report the expensive one.
   *
   * Optional so that every existing construction of a `FixtureResult` — including
   * the early returns above and the ones in `run.ts` — stays valid, and so a caller
   * that never looks at notes reads exactly what it read before.
   */
  notes?: string[]
}

/**
 * Fixture floors. Exported because `src/cli/lint.ts` enforces the same two
 * numbers without a guest, and two copies of a floor drift apart. `inventoryGate`
 * below is the runtime half, reached only from `rhcsa validate`, which reverts a
 * snapshot; the lint is the half that runs on a checkout with no ISO. The
 * *reason* for the floors lives on `inventoryGate`.
 */
export const MIN_SOLUTIONS = 2
export const MIN_ANTISOLUTIONS = 1

export async function loadTaskScripts(task: TaskSpec, assertLib: string): Promise<TaskScripts> {
  const setup = await readFile(join(task.dir, 'setup.sh'), 'utf8')
  const gradeBody = await readFile(join(task.dir, 'grade.sh'), 'utf8')

  const collect = async (sub: string, kind: FixtureKind): Promise<Fixture[]> => {
    const dir = join(task.dir, sub)
    const names = (await readdir(dir).catch(() => [])).filter((n) => n.endsWith('.sh')).sort()
    return Promise.all(
      names.map(async (name) => ({
        kind,
        name,
        script: await readFile(join(dir, name), 'utf8'),
      })),
    )
  }

  return {
    setup,
    // assertLib is prepended before grade.sh's own text, so `# baseline-fail:`
    // gets parsed out of the *combined* string below. An assertion library
    // that ever contained that literal would trip expectations.ts's "more
    // than one header" guard — acceptable, since that fails loudly rather
    // than silently. content/lib/assert.sh does not contain it today.
    grade: `${assertLib}\n${gradeBody}`,
    fixtures: [
      { kind: 'none', name: 'no-action', script: '' },
      ...(await collect('solutions', 'solution')),
      ...(await collect('antisolutions', 'antisolution')),
    ],
  }
}

function inventoryGate(task: TaskSpec, scripts: TaskScripts): FixtureResult {
  const failures: string[] = []
  const solutions = scripts.fixtures.filter((f) => f.kind === 'solution').length
  const antis = scripts.fixtures.filter((f) => f.kind === 'antisolution').length

  // Multiple independent solutions are what catch a grader over-fitted to one
  // author's habits; anti-solutions are what catch false positives.
  if (solutions < MIN_SOLUTIONS) {
    failures.push(`needs at least ${MIN_SOLUTIONS} solutions, found ${solutions}`)
  }
  if (antis < MIN_ANTISOLUTIONS) {
    failures.push(`needs at least ${MIN_ANTISOLUTIONS} anti-solution, found ${antis}`)
  }

  return {
    taskId: task.id,
    kind: 'none',
    name: 'fixture-inventory',
    ok: failures.length === 0,
    failures,
  }
}

/**
 * A declared id the grader never emits at all is a live defect, not a
 * harmless typo: `expectedStatus` defaults an undeclared id to 'pass', so an
 * id that never shows up in the verdict silently agrees with whatever the
 * grader does for the real checkpoint it was meant to name. Applied
 * identically to grade.sh's `# baseline-fail:` header and to an
 * anti-solution's `# expect-fail:` header.
 */
function checkEmittedIds(
  declared: ExpectedFailure[],
  verdictA: Verdict,
  headerName: 'baseline-fail' | 'expect-fail',
  failures: string[],
): void {
  const emitted = new Set(verdictA.checkpoints.map((c) => c.id))
  for (const d of declared) {
    if (!emitted.has(d.id)) {
      failures.push(`${headerName} names ${d.id}, which the grader never emits`)
    }
  }
}

function checkVerdict(
  verdict: Verdict,
  label: 'A' | 'B',
  expect: (id: string) => 'pass' | 'fail',
  failures: string[],
): void {
  if (verdict.checkpoints.length === 0) {
    failures.push(`verdict ${label}: grader emitted no checkpoints`)
  }
  for (const cp of verdict.checkpoints) {
    const want = expect(cp.id)
    // A skip proves nothing about whether the grader detected the error — it
    // gave up rather than caught it — so it must never silently satisfy a
    // declared failure. Report it as its own problem instead.
    if (want === 'fail' && cp.status === 'skip') {
      failures.push(
        `verdict ${label} ${cp.id}: expected fail, got skip (a skip does not prove the grader caught this)`,
      )
      continue
    }
    const got = cp.status === 'pass' ? 'pass' : 'fail'
    if (got !== want) {
      const detail = cp.detail ? ` (${cp.detail})` : ''
      failures.push(`verdict ${label} ${cp.id}: expected ${want}, got ${cp.status}${detail}`)
    }
  }
}

async function runFixture(
  task: TaskSpec,
  scripts: TaskScripts,
  fixture: Fixture,
  deps: HarnessDeps,
): Promise<FixtureResult> {
  const failures: string[] = []
  const notes: string[] = []

  let declared: ExpectedFailure[] = []
  if (fixture.kind === 'antisolution') {
    try {
      declared = parseExpectations(fixture.script, `${task.id}/antisolutions/${fixture.name}`)
    } catch (e) {
      return {
        taskId: task.id,
        kind: fixture.kind,
        name: fixture.name,
        ok: false,
        failures: [e instanceof Error ? e.message : String(e)],
      }
    }

    if (!task.rebootCheck && declared.some((d) => d.phase === 'post')) {
      const ids = declared
        .filter((d) => d.phase === 'post')
        .map((d) => d.id)
        .join(', ')
      if (ids !== '') {
        failures.push(
          `declares @post but the task has reboot_check: false, so verdict B never runs (${ids})`,
        )
      }
    }
  }

  await deps.reset()

  // A setup script that fails leaves the fixture measuring the wrong machine,
  // so every downstream failure would be a red herring. Stop here instead.
  const setupResult = await deps.transport.exec(scripts.setup)
  if (setupResult.code !== 0) {
    failures.push(`setup.sh exited ${setupResult.code}: ${setupResult.stderr.trim()}`)
    return { taskId: task.id, kind: fixture.kind, name: fixture.name, ok: false, failures }
  }

  if (fixture.script.trim() !== '') {
    // Same reasoning as setup.sh above: a fixture script that aborts leaves the
    // grader measuring a machine nobody arranged, so its checkpoint mismatches
    // would be red herrings pointing at the grader. Every fixture here runs
    // `set -euo pipefail`; an anti-solution that deliberately models a command
    // erroring should say so with an explicit `|| true`.
    const fixtureResult = await deps.transport.exec(fixture.script)
    if (fixtureResult.code !== 0) {
      failures.push(
        `${fixture.kind} script exited ${fixtureResult.code}: ${fixtureResult.stderr.trim()}`,
      )
      return { taskId: task.id, kind: fixture.kind, name: fixture.name, ok: false, failures }
    }
  }

  const result = await grade({
    task,
    transport: deps.transport,
    gradeScript: scripts.grade,
    reboot: deps.reboot,
    ...(deps.fallback ? { fallback: deps.fallback } : {}),
  })

  if (result.rebootError !== undefined) {
    failures.push(`reboot failed: ${result.rebootError}`)
  }

  // Not a failure. The fixture measured what it set out to measure and the
  // persistence answer is real — it just did not come back over the channel this
  // run declared. Recording it in `notes` rather than `failures` is the whole
  // point of the fallback: a green result that says how it got there.
  if (result.verdictBVia !== undefined) {
    notes.push(
      `post-reboot grading fell back to the ${result.verdictBVia} transport because the ` +
        `${deps.transport.kind} channel did not survive this fixture; verdict B is over ` +
        `${result.verdictBVia}, verdict A over ${deps.transport.kind}`,
    )
  }

  // An infrastructure failure, reported as one and reported *first*.
  //
  // `grade()` fabricates a fail row for every checkpoint verdict B never emitted,
  // so a second run that never executed arrives here as a full set of fails - and
  // every single one of them would be complained about individually as
  // "expected pass, got fail". That is a page of content complaints generated by
  // a broken control channel, which is how `storage/014-grow-home-lv` spent a
  // validate run accusing a grader that was fine. So verdict B is treated as
  // *absent* below rather than as measured: there is nothing in it to check.
  const verdictB = result.postRebootError === undefined ? result.verdictB : undefined
  if (result.postRebootError !== undefined) {
    failures.push(
      `post-reboot grading did not run, so nothing about persistence was measured here (this is a harness/guest failure, not a content mismatch): ${result.postRebootError}`,
    )
  }

  // Once, against verdict A only. Duplicate ids are a property of the grader,
  // not of a particular run, so checking inside checkVerdict would report the
  // same duplicate twice on any task with reboot_check: true.
  const dupes = duplicateIds(result.verdictA)
  if (dupes.length > 0) {
    failures.push(`grader emitted duplicate checkpoint ids: ${dupes.join(', ')}`)
  }

  if (fixture.kind === 'none') {
    // "Nothing may pass" is wrong for any task with an invariant checkpoint —
    // `home-mounted` is supposed to pass before the student touches anything.
    // So the task declares which checkpoints are the *goal*, and exactly those
    // must fail at baseline. Everything else must pass.
    // const, not let: TypeScript cannot narrow a `let` inside the closure below.
    const baseline = (() => {
      try {
        return parseExpectations(scripts.grade, `${task.id}/grade.sh`, 'baseline-fail')
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e))
        return undefined
      }
    })()

    if (baseline) {
      checkEmittedIds(baseline, result.verdictA, 'baseline-fail', failures)
      const want = (label: 'A' | 'B') => (id: string) => expectedStatus(baseline, id, label)
      checkVerdict(result.verdictA, 'A', want('A'), failures)
      if (verdictB) checkVerdict(verdictB, 'B', want('B'), failures)
    }
  } else {
    if (fixture.kind === 'antisolution') {
      // Same cross-check as the baseline header gets: a declared id the
      // grader never emits is a live defect, not a harmless typo (see
      // checkEmittedIds).
      checkEmittedIds(declared, result.verdictA, 'expect-fail', failures)
    }

    const want = (label: 'A' | 'B') => (id: string) =>
      fixture.kind === 'solution' ? 'pass' : expectedStatus(declared, id, label)

    checkVerdict(result.verdictA, 'A', want('A'), failures)
    if (verdictB) checkVerdict(verdictB, 'B', want('B'), failures)
    // `postRebootError` is excluded for the same reason `rebootError` is: the
    // @post declarations went unverified, but not because nothing passed in A,
    // and the message below would name the wrong cause. The failure that *is*
    // pushed for it is the one above.
    else if (task.rebootCheck && result.rebootError === undefined && result.postRebootError === undefined) {
      // No verdict B on a reboot-checking task means verdict A had no passes at
      // all, which a solution must never produce.
      if (fixture.kind === 'solution') {
        failures.push('verdict B was skipped: no checkpoint passed before the reboot')
      } else if (declared.some((d) => d.phase === 'post')) {
        // grade() skips the reboot when nothing passed in verdict A, so these
        // @post declarations were never actually verified. Passing green here
        // would mean the fixture tested half of what it claims.
        const ids = declared
          .filter((d) => d.phase === 'post')
          .map((d) => d.id)
          .join(', ')
        failures.push(
          `verdict B was skipped: no checkpoint passed before the reboot, so the @post declarations were never verified (${ids})`,
        )
      }
    }
  }

  // Keep the pass/fail comparison honest about ids that vanished between runs.
  if (verdictB) {
    const a = statusById(result.verdictA)
    for (const cp of verdictB.checkpoints) {
      if (!a.has(cp.id)) failures.push(`${cp.id} appeared only after the reboot`)
    }
  }

  return {
    taskId: task.id,
    kind: fixture.kind,
    name: fixture.name,
    ok: failures.length === 0,
    failures,
    ...(notes.length > 0 ? { notes } : {}),
  }
}

export async function validateTask(
  task: TaskSpec,
  scripts: TaskScripts,
  deps: HarnessDeps,
): Promise<FixtureResult[]> {
  const results: FixtureResult[] = []

  const gate = inventoryGate(task, scripts)

  // The fixture results come first and the gate last. Ordering matters: every
  // test that indexes `results[0]` means "the first fixture", and pushing the
  // gate ahead of the loop would silently retarget those assertions at the
  // inventory check instead.
  for (const fixture of scripts.fixtures) {
    results.push(await runFixture(task, scripts, fixture, deps))
  }

  if (!gate.ok) results.push(gate)

  return results
}
