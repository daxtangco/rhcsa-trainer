import { describe, expect, it } from 'vitest'
import { loadBank } from '../../src/engine/content/bank.ts'
import { ContentError } from '../../src/engine/content/errors.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'
import {
  planDemo,
  planDemos,
  runDemo,
  type DemoRuntime,
} from '../../src/engine/demo/antisolution.ts'
import { parseVerdict } from '../../src/engine/grading/verdict.ts'
import { loadTaskScripts, type Fixture, type TaskScripts } from '../../src/engine/validate/harness.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Section 7.2's anti-solution demonstrations, against the fake transport only.
 *
 * **Nothing in this file touches a guest.** The demo's whole value is a real reboot of
 * a real machine, so what can be asserted without one is the *classification* (which
 * is pure, and is checked against the shipped bank), the *sequencing* (revert, setup,
 * anti-solution, grade — asserted as an ordered call list), and the *read model* (that
 * both verdicts and the flipped ids arrive in a shape a UI can put side by side).
 * Whether a given anti-solution actually flips on the real guest is what
 * `npm run validate` measures, and it is stated as unverified here.
 */

function task(over: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: 'storage/014-grow-home-lv',
    title: 'Grow /home',
    chapter: 15,
    scope: 'exam-objective',
    rhel: 9,
    objectives: ['storage.lvm.resize'],
    requiresConcepts: [],
    difficulty: 3,
    timeBudget: 600,
    weight: 'high',
    editions: ['r9'],
    rebootCheck: true,
    requiresDisks: 0,
    claims: [],
    transport: 'ssh',
    prompt: 'grow it',
    dir: '/content/tasks/storage/014-grow-home-lv',
    ...over,
  }
}

function anti(name: string, header: string): Fixture {
  return { kind: 'antisolution', name, script: `#!/bin/bash\n# expect-fail: ${header}\ntrue\n` }
}

const GRADE = '# baseline-fail: lv-home-size, fs-home-size\nck lv-home-size "d" $?\nck fs-home-size "e" $?\n'

function scripts(fixtures: Fixture[]): TaskScripts {
  return { setup: 'echo setup', grade: GRADE, fixtures: [{ kind: 'none', name: 'no-action', script: '' }, ...fixtures] }
}

const A_BOTH_PASS = parseVerdict(
  [
    '{"id":"lv-home-size","desc":"d","status":"pass"}',
    '{"id":"fs-home-size","desc":"e","status":"pass"}',
  ].join('\n'),
)

const B_ONE_FAILS = parseVerdict(
  [
    '{"id":"lv-home-size","desc":"d","status":"pass"}',
    '{"id":"fs-home-size","desc":"e","status":"fail","detail":"12G expected, 8G found"}',
  ].join('\n'),
)

interface FakeOptions {
  verdictA?: typeof A_BOTH_PASS
  verdictB?: typeof A_BOTH_PASS
  regressionIds?: string[]
  setupCode?: number
  fixtureCode?: number
}

function fake(opts: FakeOptions = {}) {
  const calls: string[] = []
  const runtime: DemoRuntime = {
    reset: async () => {
      calls.push('reset')
    },
    exec: async (script) => {
      const isSetup = script.includes('echo setup')
      calls.push(isSetup ? 'setup' : 'antisolution')
      const code = isSetup ? (opts.setupCode ?? 0) : (opts.fixtureCode ?? 0)
      return { stdout: '', stderr: code === 0 ? '' : 'boom', code }
    },
    gradeTask: async () => {
      calls.push('grade')
      const a = opts.verdictA ?? A_BOTH_PASS
      const b = opts.verdictB
      const byId = new Map((b ?? a).checkpoints.map((cp) => [cp.id, cp]))
      return {
        verdictA: a,
        ...(b === undefined ? {} : { verdictB: b }),
        regressions: (opts.regressionIds ?? [])
          .map((id) => byId.get(id))
          .filter((cp): cp is NonNullable<typeof cp> => cp !== undefined),
        rebooted: b !== undefined,
      }
    },
  }
  return { runtime, calls }
}

describe('classifying an anti-solution', () => {
  it('calls a @post declaration on a reboot-checking task a reboot demo', () => {
    const plan = planDemo(task(), anti('02-removed-persistence.sh', 'persist-config, fs-home-size@post'))
    expect(plan.kind).toBe('reboot')
    expect(plan.flips).toEqual(['fs-home-size'])
    expect(plan.headline).toContain('fails after the reboot')
  })

  it('calls a phase-less declaration an immediate demo, because it fails in verdict A', () => {
    // The default phase is `both`, so nothing passes before and nothing to contrast.
    const plan = planDemo(task(), anti('01-chcon-only.sh', 'context-permanent'))
    expect(plan.kind).toBe('immediate')
    expect(plan.flips).toEqual([])
    expect(plan.headline).toContain('immediately')
  })

  it('calls a @pre declaration immediate, not reboot', () => {
    const plan = planDemo(task(), anti('03-permissive.sh', 'mode-enforcing-now@pre'))
    expect(plan.kind).toBe('immediate')
    expect(plan.flips).toEqual([])
  })

  it('refuses to promise a contrast the grader cannot produce', () => {
    // `@post` on a task that does not reboot-check: `grader.ts` never runs verdict B,
    // so classifying this `reboot` would leave the UI's "after" column empty.
    const plan = planDemo(task({ rebootCheck: false }), anti('x.sh', 'fs-home-size@post'))
    expect(plan.kind).toBe('immediate')
  })

  it('throws the ContentError for a missing header, like the harness does', () => {
    const fixture: Fixture = { kind: 'antisolution', name: 'x.sh', script: 'true\n' }
    expect(() => planDemo(task(), fixture)).toThrow(ContentError)
  })
})

describe('planDemos', () => {
  it('collects a broken header instead of losing the whole menu', () => {
    const { plans, problems } = planDemos(
      task(),
      scripts([
        anti('01-good.sh', 'fs-home-size@post'),
        { kind: 'antisolution', name: '02-no-header.sh', script: 'true\n' },
        { kind: 'solution', name: '01-sol.sh', script: 'true\n' },
      ]),
    )
    expect(plans.map((p) => p.name)).toEqual(['01-good.sh'])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('02-no-header.sh')
    expect(problems[0]).toContain('expect-fail')
  })

  it('ignores solutions and the no-action fixture', () => {
    const { plans } = planDemos(task(), scripts([{ kind: 'solution', name: '01.sh', script: 'true\n' }]))
    expect(plans).toEqual([])
  })
})

describe('running a demonstration', () => {
  it('reverts, sets up, applies the anti-solution, then grades, in that order', async () => {
    const { runtime, calls } = fake({ verdictB: B_ONE_FAILS, regressionIds: ['fs-home-size'] })
    const s = scripts([anti('02.sh', 'fs-home-size@post')])
    const plan = planDemo(task(), s.fixtures[1] as Fixture)

    const result = await runDemo({ task: task(), scripts: s, plan, runtime })
    expect(result.ok).toBe(true)
    // The same order `harness.ts`'s runFixture uses, which is the order that has been
    // exercised against the real guest.
    expect(calls).toEqual(['reset', 'setup', 'antisolution', 'grade'])
  })

  it('carries both verdicts and names the checkpoint that flipped', async () => {
    const { runtime } = fake({ verdictB: B_ONE_FAILS, regressionIds: ['fs-home-size'] })
    const s = scripts([anti('02.sh', 'fs-home-size@post')])
    const plan = planDemo(task(), s.fixtures[1] as Fixture)

    const result = await runDemo({ task: task(), scripts: s, plan, runtime })
    if (!result.ok) throw new Error('expected a verdict')
    const { outcome } = result

    // The pedagogical payload: two passes before, one failure after, and the id.
    expect(outcome.before).toMatchObject({ label: 'A', passed: 2, failed: 0 })
    expect(outcome.after).toMatchObject({ label: 'B', passed: 1, failed: 1 })
    expect(outcome.flipped.map((cp) => cp.id)).toEqual(['fs-home-size'])
    // Unmasked: the student is reading somebody else's deliberately wrong solution.
    expect(outcome.after?.checkpoints.find((cp) => cp.id === 'fs-home-size')?.detail).toContain('8G')
    expect(outcome.taught).toBe(true)
    expect(outcome.problems).toEqual([])
  })

  it('says so when a reboot demo did not actually flip', async () => {
    // Green before and green after, on a demo that promised a failure. Showing this to
    // a student teaches that persistence failures do not happen.
    const { runtime } = fake({ verdictB: A_BOTH_PASS })
    const s = scripts([anti('02.sh', 'fs-home-size@post')])
    const plan = planDemo(task(), s.fixtures[1] as Fixture)

    const result = await runDemo({ task: task(), scripts: s, plan, runtime })
    if (!result.ok) throw new Error('expected a verdict')
    expect(result.outcome.taught).toBe(false)
    expect(result.outcome.problems.join(' ')).toContain('still passed after the reboot')
  })

  it('says so when the reboot never happened on a reboot demo', async () => {
    const { runtime } = fake({})
    const s = scripts([anti('02.sh', 'fs-home-size@post')])
    const plan = planDemo(task(), s.fixtures[1] as Fixture)

    const result = await runDemo({ task: task(), scripts: s, plan, runtime })
    if (!result.ok) throw new Error('expected a verdict')
    expect(result.outcome.after).toBeNull()
    expect(result.outcome.taught).toBe(false)
    expect(result.outcome.problems.join(' ')).toContain('no verdict B')
  })

  it('says so when an immediate demo turned out to pass everything', async () => {
    const { runtime } = fake({})
    const s = scripts([anti('01.sh', 'context-permanent')])
    const plan = planDemo(task(), s.fixtures[1] as Fixture)

    const result = await runDemo({ task: task(), scripts: s, plan, runtime })
    if (!result.ok) throw new Error('expected a verdict')
    expect(result.outcome.taught).toBe(false)
    expect(result.outcome.problems.join(' ')).toContain('demonstrated nothing')
  })

  it('stops at a failed setup rather than grading the wrong machine', async () => {
    const { runtime, calls } = fake({ setupCode: 1 })
    const s = scripts([anti('02.sh', 'fs-home-size@post')])
    const plan = planDemo(task(), s.fixtures[1] as Fixture)

    const result = await runDemo({ task: task(), scripts: s, plan, runtime })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.failure.stage).toBe('setup')
    expect(calls).toEqual(['reset', 'setup'])
  })

  it('stops when the anti-solution script itself aborts', async () => {
    const { runtime, calls } = fake({ fixtureCode: 1 })
    const s = scripts([anti('02.sh', 'fs-home-size@post')])
    const plan = planDemo(task(), s.fixtures[1] as Fixture)

    const result = await runDemo({ task: task(), scripts: s, plan, runtime })
    if (result.ok) throw new Error('expected a failure')
    expect(result.failure.stage).toBe('antisolution')
    expect(calls).toEqual(['reset', 'setup', 'antisolution'])
  })

  it('marks the guest unknown before the revert and again at the end', async () => {
    const { runtime } = fake({ verdictB: B_ONE_FAILS, regressionIds: ['fs-home-size'] })
    const s = scripts([anti('02.sh', 'fs-home-size@post')])
    const plan = planDemo(task(), s.fixtures[1] as Fixture)
    let marks = 0

    await runDemo({ task: task(), scripts: s, plan, runtime, markUnknown: () => { marks += 1 } })
    // Section 5.5: the post-demo guest is this task's setup plus a deliberately wrong
    // solution, which no vm_state row can describe, so the next grade must be refused.
    expect(marks).toBe(2)
  })

  it('marks the guest unknown even when the demo fails before grading', async () => {
    const { runtime } = fake({ setupCode: 1 })
    const s = scripts([anti('02.sh', 'fs-home-size@post')])
    const plan = planDemo(task(), s.fixtures[1] as Fixture)
    let marks = 0

    await runDemo({ task: task(), scripts: s, plan, runtime, markUnknown: () => { marks += 1 } })
    // Once, before the revert. The guest is reverted-and-half-set-up, which is exactly
    // the state the unknown row exists to describe.
    expect(marks).toBe(1)
  })

  it('reports a plan whose fixture is not in the scripts rather than throwing', async () => {
    const { runtime, calls } = fake({})
    const s = scripts([anti('02.sh', 'fs-home-size@post')])
    const plan = planDemo(task(), s.fixtures[1] as Fixture)

    const result = await runDemo({ task: task(), scripts: { ...s, fixtures: [] }, plan, runtime })
    if (result.ok) throw new Error('expected a failure')
    expect(result.failure.message).toContain('no anti-solution named 02.sh')
    // Nothing touched the guest, which is the point: a mismatched plan must not revert.
    expect(calls).toEqual([])
  })
})

describe('against the shipped bank', () => {
  it('classifies every anti-solution without a single header problem', async () => {
    const bank = await loadBank('content')
    const assertLib = await readFile(join('content', 'lib', 'assert.sh'), 'utf8')

    let total = 0
    const reboot: string[] = []
    for (const t of bank.tasks) {
      const s = await loadTaskScripts(t, assertLib)
      const { plans, problems } = planDemos(t, s)
      // `rhcsa lint` already gates on these headers, so any problem here means the
      // shipped content regressed rather than that this classifier is fussy.
      expect(problems, t.id).toEqual([])
      total += plans.length
      for (const p of plans) if (p.kind === 'reboot') reboot.push(`${t.id} ${p.name}`)
    }

    // Re-measured 2026-09-14 over the 27-task bank; it read 100/20 over the 22-task
    // one, 77/15 over the 17-task one and 44/12 over the 11-task one. Pinned so that
    // content losing a `@post` declaration — the one thing that turns section 7.2's
    // headline demonstration into an ordinary "the grader caught it" — fails a test
    // rather than quietly shrinking the menu.
    //
    // Growing the bank moves both numbers, so a reader who sees this diff should
    // check the delta and not just the total. This one is +26/+4 and every unit of it
    // is accounted for: the five tasks added contributed 25 plans (tools/047 5,
    // systemd/048 4, pkg/049 6, selinux/050 5, tools/051 5) and 4 reboot demos —
    // systemd/048 3, selinux/050 1 — and the twenty-sixth plan is the anti-solution
    // added to `storage/042` to give its `space-untouched` invariant something that
    // proves it discriminates.
    //
    // `systemd/048` accounting for three of the four new reboot demos is the expected
    // shape rather than a surprise: a task about targets and clean shutdown is almost
    // entirely a question about what survives a reboot, so most of its mistakes can
    // only be caught in verdict B. `storage/042` still contributes none *by design* —
    // it is the one task in the bank declaring `reboot_check: false`, because the
    // block device its student partitions is a loop device that does not survive a
    // reboot. A reboot demo appearing for 042 is therefore a signal that its
    // `reboot_check` was flipped, not a harmless drift.
    expect(total).toBe(126)
    expect(reboot).toHaveLength(24)
    expect(reboot).toContain('storage/014-grow-home-lv 02-removed-persistence.sh')
    expect(reboot).toContain('systemd/017-boot-time-service 01-started-not-enabled.sh')
    // One from each batch-1 task that has one, so a `@post` quietly dropped from the
    // new content fails by name rather than only shifting the total by one.
    expect(reboot).toContain('sys/039-process-signals-and-priority 01-renice-only-no-config.sh')
    expect(reboot).toContain('sys/040-time-and-tuning 03-tuned-started-not-enabled.sh')
    // And one from each batch-2a task that has one, for the same reason. These four
    // are the whole persistence story of the batch: a transient hostname, a runtime
    // firewall rule, an autofs unit started but never enabled, and a relabel skipped
    // after a `mv` carried a label in from /root. (That last fixture staged from /tmp
    // until 2026-09-14, when the guest showed the login working under Enforcing with
    // the /tmp label; its header carries the policy rules that explain why.)
    expect(reboot).toContain('net/044-hostname-and-name-resolution 01-transient-hostname-only.sh')
    expect(reboot).toContain('net/045-firewall-restricted-service 01-runtime-only-rich-rule.sh')
    expect(reboot).toContain('storage/043-nfs-and-autofs 02-autofs-started-not-enabled.sh')
    expect(reboot).toContain(
      'net/046-key-based-ssh-login 04-moved-from-root-home-then-setenforce.sh',
    )
    // And batch 2b's four, named for the same reason. All three of `systemd/048`'s are
    // listed rather than one, because they are three genuinely different ways to fail
    // a persistence question — a timed shutdown cancelled in the running system but
    // left armed for next boot, a target isolated now without changing what boots, and
    // /etc/default/grub edited without regenerating the config it feeds. Losing any one
    // of them costs a distinct lesson, so a total that still reads 24 because one was
    // replaced by another task's demo should not pass quietly.
    expect(reboot).toContain('systemd/048-targets-and-clean-shutdown 01-cancelled-but-still-armed.sh')
    expect(reboot).toContain('systemd/048-targets-and-clean-shutdown 03-isolated-only.sh')
    expect(reboot).toContain('systemd/048-targets-and-clean-shutdown 04-edited-default-grub-only.sh')
    expect(reboot).toContain('selinux/050-port-labels-and-modes 01-setenforce-only.sh')
    // The negative half of the same claim, and the one a bank-growth diff would
    // otherwise hide.
    expect(reboot.some((r) => r.startsWith('storage/042-'))).toBe(false)
  })

  it('classifies both chcon-only anti-solutions as immediate, not as relabel demos', async () => {
    // The measured basis for `antisolution.ts`'s claim that relabel demonstrations are
    // not derivable: the bank encodes relabel durability as a policy checkpoint that
    // fails in verdict A, and both of these say in their own comments that they pass
    // the reboot check. There is no phase, and no controller operation, for a relabel.
    const bank = await loadBank('content')
    const assertLib = await readFile(join('content', 'lib', 'assert.sh'), 'utf8')

    for (const id of ['selinux/019-httpd-alt-port', 'selinux/032-selinux-denial-triage']) {
      const t = bank.tasksById.get(id)
      if (t === undefined) throw new Error(`${id} is not in the bank`)
      const { plans } = planDemos(t, await loadTaskScripts(t, assertLib))
      const chcon = plans.find((p) => p.name.includes('chcon-only'))
      expect(chcon?.kind, id).toBe('immediate')
      expect(chcon?.flips, id).toEqual([])
    }
  })
})
