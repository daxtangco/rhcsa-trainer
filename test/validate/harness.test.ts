import { describe, expect, it } from 'vitest'
import { validateTask, type TaskScripts } from '../../src/engine/validate/harness.ts'
import { FakeTransport } from '../../src/engine/vm/fake.ts'
import type { TaskSpec } from '../../src/engine/content/task.ts'

function task(over: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: 'storage/014-grow-var',
    title: 'Grow var',
    chapter: 15,
    scope: 'exam-objective',
    rhel: 9,
    objectives: ['storage.lvm.resize'],
    requiresConcepts: [],
    difficulty: 3,
    timeBudget: 480,
    weight: 'high',
    editions: ['r9'],
    rebootCheck: true,
    requiresDisks: 0,
    claims: [],
    transport: 'ssh',
    prompt: 'Grow var.',
    dir: '/nowhere',
    ...over,
  }
}

/**
 * A two-variable world: did the LV grow, and is there a persistence config?
 * The handler is a state machine, never a simulated Linux.
 */
function world() {
  const state = { grown: false, persisted: false, mounted: false, rebooted: false }

  const handler = (script: string) => {
    if (script.includes('SETUP')) {
      state.grown = false
      state.persisted = false
      state.mounted = true
      state.rebooted = false
      return { stdout: '', stderr: '', code: 0 }
    }
    // Non-exclusive, and deliberately so: the correct solution is the single
    // script 'GROW\nPERSIST\n', so an if/return chain would set `grown` and
    // return before it ever noticed the PERSIST line.
    if (script.includes('GROW')) {
      state.grown = true
      state.mounted = true
    }
    if (script.includes('PERSIST')) {
      state.persisted = true
    }
    if (script.includes('GROW') || script.includes('PERSIST')) {
      return { stdout: '', stderr: '', code: 0 }
    }
    if (script.includes('GRADE')) {
      const mounted = state.rebooted ? state.persisted : state.mounted
      const lines = [
        `{"id":"lv-var-size","desc":"var LV >= 6G","status":"${state.grown ? 'pass' : 'fail'}"}`,
        `{"id":"persist-config","desc":"mounts at boot","status":"${state.persisted ? 'pass' : 'fail'}"}`,
        `{"id":"var-from-lv","desc":"/var mounted","status":"${mounted ? 'pass' : 'fail'}"}`,
      ]
      return { stdout: lines.join('\n'), stderr: '', code: 0 }
    }
    return { stdout: '', stderr: '', code: 0 }
  }

  return { state, handler }
}

function deps(w: ReturnType<typeof world>) {
  const transport = new FakeTransport(w.handler)
  return {
    transport,
    reset: async () => {
      w.state.grown = false
      w.state.persisted = false
      w.state.mounted = false
      w.state.rebooted = false
    },
    reboot: async () => {
      w.state.rebooted = true
    },
  }
}

const CORRECT = 'GROW\nPERSIST\n'
const FORGOT_PERSIST = 'GROW\n'

/**
 * grade.sh declares its own baseline. In this world, before any work: the LV
 * has not grown and nothing is persisted, but /var IS still mounted — so
 * var-from-lv passes now and only fails after the reboot.
 */
const BASELINE = '# baseline-fail: lv-var-size, persist-config, var-from-lv@post\n'

function scripts(over: Partial<TaskScripts> = {}): TaskScripts {
  return {
    setup: 'SETUP',
    grade: `${BASELINE}GRADE`,
    fixtures: [
      { kind: 'none', name: 'no-action', script: '' },
      { kind: 'solution', name: '01-lvextend.sh', script: CORRECT },
      { kind: 'solution', name: '02-mount-unit.sh', script: CORRECT },
      {
        kind: 'antisolution',
        name: '01-forgot-persistence.sh',
        script: `# expect-fail: persist-config, var-from-lv@post\n${FORGOT_PERSIST}`,
      },
    ],
    ...over,
  }
}

describe('validateTask', () => {
  it('passes a well-formed task with correct solutions and a declared anti-solution', async () => {
    const w = world()
    const results = await validateTask(task(), scripts(), deps(w))

    expect(results.map((r) => r.name)).toEqual([
      'no-action',
      '01-lvextend.sh',
      '02-mount-unit.sh',
      '01-forgot-persistence.sh',
    ])
    for (const r of results) {
      expect(r.failures, `${r.name}: ${r.failures.join('; ')}`).toEqual([])
      expect(r.ok).toBe(true)
    }
  })

  it('reports a post-reboot run that never happened as one failure, not a page of them', async () => {
    // The `storage/014-grow-home-lv` shape, reduced: the fixture's own change
    // breaks the ssh key the grader arrives on (authorized_keys lives on
    // rhel/home, which the fixture un-persists), while `waitForGuest` polls over
    // vmrun and reports the guest up regardless.
    //
    // The property under test is the *absence* of the derived complaints. Every
    // checkpoint verdict B never emitted is filled in as a fail, so without this
    // the run accuses three checkpoints of "expected pass, got fail" and points
    // the reader at a grader that is fine.
    const w = world()
    const bad = deps(w)
    bad.transport = new FakeTransport((script) => {
      if (!script.includes('GRADE')) return w.handler(script)
      if (w.state.rebooted) {
        return {
          stdout: '',
          stderr: 'student@192.168.70.130: Permission denied (publickey).',
          code: 255,
        }
      }
      return w.handler(script)
    })

    const results = await validateTask(task(), scripts(), bad)
    const sol = results.find((r) => r.name === '01-lvextend.sh')
    expect(sol?.ok).toBe(false)
    expect(sol?.failures).toHaveLength(1)
    expect(sol?.failures[0]).toMatch(/post-reboot grading did not run/)
    expect(sol?.failures[0]).toContain('Permission denied (publickey)')

    const text = sol?.failures.join('\n') ?? ''
    expect(text).not.toMatch(/verdict B/)
    expect(text).not.toMatch(/expected pass, got fail/)
    expect(text).not.toMatch(/reboot failed/)
    expect(text).not.toMatch(/no checkpoint passed before the reboot/)
  })

  it('measures the fixture over the fallback channel and says so in notes, not failures', async () => {
    // The same broken world as above, with `deps.fallback` supplied — the shape
    // `rhcsa validate` now runs in. Both fixtures below are honest results that
    // the previous test could only report as infrastructure failures.
    const w = world()
    const base = deps(w)
    const brokenAfterReboot = (script: string) => {
      if (!script.includes('GRADE') || !w.state.rebooted) return w.handler(script)
      return {
        stdout: '',
        stderr: 'student@192.168.70.130: Permission denied (publickey).',
        code: 255,
      }
    }
    const withFallback = {
      ...base,
      transport: new FakeTransport(brokenAfterReboot, { kind: 'ssh' }),
      // Reaches the same world, and that is the point: vmrun goes through
      // open-vm-tools, so it answers the persistence question on the very machine
      // whose ssh key auth the fixture destroyed.
      fallback: new FakeTransport(w.handler, { kind: 'vmrun' }),
    }

    const results = await validateTask(task(), scripts(), withFallback)

    // The whole task validates, including the anti-solution whose `@post`
    // declaration was previously unverifiable.
    for (const r of results) {
      expect(r.failures, `${r.name}: ${r.failures.join('; ')}`).toEqual([])
      expect(r.ok).toBe(true)
    }

    // Green, and not silently so: every fixture that rebooted and lost the channel
    // carries the note, which here is all four. `no-action` included, and that is
    // correct rather than sloppy — this world's baseline leaves /var still mounted,
    // so `var-from-lv` passes in verdict A, so `grade()` does reboot. A fixture
    // only skips the reboot when *nothing* passed.
    const noted = results.filter((r) => (r.notes ?? []).length > 0).map((r) => r.name)
    expect(noted).toEqual([
      'no-action',
      '01-lvextend.sh',
      '02-mount-unit.sh',
      '01-forgot-persistence.sh',
    ])
    const note = results.find((r) => r.name === '01-lvextend.sh')?.notes?.[0] ?? ''
    expect(note).toContain('fell back to the vmrun transport')
    expect(note).toContain('verdict B is over vmrun, verdict A over ssh')

    // `ok` is derived from `failures`, so a note must never reach that array: a
    // note that turned a validate run red would make the honest report the
    // expensive one, and the next person would delete the note.
    expect(results.every((r) => r.ok)).toBe(true)
  })

  it('fails the no-action fixture when a goal checkpoint passes without work', async () => {
    const w = world()
    // A grader that reports a pass on an untouched system is the dangerous
    // direction of error, so the no-action fixture must catch it.
    const s = scripts({ grade: `${BASELINE}GRADE_ALWAYS_PASS` })
    const bad = deps(w)
    bad.transport = new FakeTransport((script) =>
      script.includes('GRADE')
        ? {
            stdout: [
              '{"id":"lv-var-size","desc":"x","status":"pass"}',
              '{"id":"persist-config","desc":"y","status":"fail"}',
              '{"id":"var-from-lv","desc":"z","status":"pass"}',
            ].join('\n'),
            stderr: '',
            code: 0,
          }
        : { stdout: '', stderr: '', code: 0 },
    )

    const results = await validateTask(task(), s, bad)
    const none = results.find((r) => r.kind === 'none')
    expect(none?.ok).toBe(false)
    expect(none?.failures.join('\n')).toMatch(/verdict A lv-var-size: expected fail, got pass/)
  })

  it('accepts an invariant checkpoint that passes at baseline', async () => {
    // var-from-lv is a "do not break this" check, not a goal. Requiring it to
    // fail before the student starts would make every honest task unvalidatable.
    // Asserted the distinguishing way, so this is not a restatement of the
    // headline test: name var-from-lv in the *pre-reboot* baseline and the
    // harness must object to that id and only that id — which is the same
    // statement as "var-from-lv passes in verdict A while lv-var-size fails
    // there, exactly as declared".
    const w = world()
    const s = scripts({
      grade: '# baseline-fail: lv-var-size, persist-config, var-from-lv\nGRADE',
    })
    const results = await validateTask(task(), s, deps(w))
    const none = results.find((r) => r.kind === 'none')
    const text = none?.failures.join('\n') ?? ''
    expect(text).toMatch(/verdict A var-from-lv: expected fail, got pass/)
    expect(text).not.toMatch(/lv-var-size/)
  })

  it('fails a task whose grade.sh declares no baseline', async () => {
    const w = world()
    const results = await validateTask(task(), scripts({ grade: 'GRADE' }), deps(w))
    const none = results.find((r) => r.kind === 'none')
    expect(none?.ok).toBe(false)
    expect(none?.failures.join('\n')).toMatch(/"# baseline-fail:" header/)
  })

  it('stops immediately when setup.sh fails, instead of grading the wrong machine', async () => {
    const w = world()
    const bad = deps(w)
    bad.transport = new FakeTransport((script) =>
      script.includes('SETUP')
        ? { stdout: '', stderr: '/home is not on the rhel-home LV', code: 1 }
        : { stdout: '', stderr: '', code: 0 },
    )

    const results = await validateTask(task(), scripts(), bad)
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures).toEqual([
      'setup.sh exited 1: /home is not on the rhel-home LV',
    ])
  })

  it('fails a baseline declaration naming a checkpoint the grader never emits', async () => {
    const w = world()
    const s = scripts({ grade: `# baseline-fail: lv-var-size, typo-id\nGRADE` })
    const results = await validateTask(task(), s, deps(w))
    const none = results.find((r) => r.kind === 'none')
    expect(none?.failures.join('\n')).toMatch(/baseline-fail names typo-id/)
  })

  it('fails a solution that does not pass every checkpoint, catching over-fitting', async () => {
    const w = world()
    const s = scripts()
    s.fixtures = [{ kind: 'solution', name: '03-partial.sh', script: FORGOT_PERSIST }]

    const results = await validateTask(task(), s, deps(w))
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures.join('\n')).toMatch(/persist-config: expected pass, got fail/)
  })

  it('fails an anti-solution whose declared checkpoint did not actually fail', async () => {
    const w = world()
    const s = scripts()
    s.fixtures = [
      {
        kind: 'antisolution',
        name: '02-wrong-declaration.sh',
        script: `# expect-fail: lv-var-size\n${CORRECT}`,
      },
    ]

    const results = await validateTask(task(), s, deps(w))
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures.join('\n')).toMatch(/lv-var-size: expected fail, got pass/)
  })

  it('fails an anti-solution that breaks a checkpoint it did not declare', async () => {
    // This is the assertion that proves the right check caught the error, not
    // merely that something failed.
    const w = world()
    const s = scripts()
    s.fixtures = [
      {
        kind: 'antisolution',
        name: '03-underdeclared.sh',
        script: '# expect-fail: persist-config\nGROW\n',
      },
    ]

    const results = await validateTask(task(), s, deps(w))
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures.join('\n')).toMatch(/var-from-lv: expected pass, got fail/)
  })

  it('requires at least two solutions and one anti-solution', async () => {
    const w = world()
    const s = scripts()
    s.fixtures = [{ kind: 'solution', name: '01.sh', script: CORRECT }]

    const results = await validateTask(task(), s, deps(w))
    const gate = results.find((r) => r.kind === 'none' && r.name === 'fixture-inventory')
    expect(gate?.ok).toBe(false)
    expect(gate?.failures.join('\n')).toMatch(/needs at least 2 solutions/)
    expect(gate?.failures.join('\n')).toMatch(/needs at least 1 anti-solution/)
  })

  it('rejects a post-phase declaration on a task that never reboots', async () => {
    const w = world()
    const s = scripts()
    s.fixtures = [
      {
        kind: 'antisolution',
        name: '04-post-without-reboot.sh',
        script: `# expect-fail: var-from-lv@post\n${FORGOT_PERSIST}`,
      },
    ]

    const results = await validateTask(task({ rebootCheck: false }), s, deps(w))
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures.join('\n')).toMatch(
      /declares @post but the task has reboot_check: false/,
    )
  })

  it('reports duplicate checkpoint ids emitted by the grader', async () => {
    const w = world()
    const bad = deps(w)
    bad.transport = new FakeTransport((script) =>
      script.includes('GRADE')
        ? {
            stdout: [
              '{"id":"dup","desc":"x","status":"pass"}',
              '{"id":"dup","desc":"y","status":"pass"}',
            ].join('\n'),
            stderr: '',
            code: 0,
          }
        : { stdout: '', stderr: '', code: 0 },
    )
    const s = scripts()
    s.fixtures = [{ kind: 'solution', name: '01.sh', script: CORRECT }]

    const results = await validateTask(task({ rebootCheck: false }), s, bad)
    expect(results[0]?.failures.join('\n')).toMatch(/grader emitted duplicate checkpoint ids: dup/)
  })

  it('resets before every fixture so fixtures cannot contaminate each other', async () => {
    const w = world()
    let resets = 0
    const d = deps(w)
    const innerReset = d.reset
    d.reset = async () => {
      resets++
      await innerReset()
    }

    await validateTask(task(), scripts(), d)
    // 4 fixtures, one reset each.
    expect(resets).toBe(4)
  })

  it('resets each fixture before its own setup.sh, even right after an earlier fixture failed setup.sh', async () => {
    // A count alone is blind to position: reset() moved to the end of
    // runFixture would still fire once per fixture on the happy path, but it
    // would be unreachable on the early-return for a failing setup.sh, so the
    // fixture after that failure would inherit unreset state. Pin the order,
    // not just the count, and do it across a setup.sh failure so an
    // unreachable end-of-function reset actually shows up as a gap.
    const w = world()
    const sequence: string[] = []
    const d = deps(w)
    const innerReset = d.reset
    d.reset = async () => {
      sequence.push('reset')
      await innerReset()
    }
    let setupCalls = 0
    d.transport = new FakeTransport((script) => {
      if (script.includes('SETUP')) {
        setupCalls++
        sequence.push('setup')
        // The middle fixture's setup.sh fails.
        if (setupCalls === 2) return { stdout: '', stderr: 'boom', code: 1 }
        return w.handler(script)
      }
      if (script.includes('GRADE')) {
        sequence.push('grade')
        return w.handler(script)
      }
      sequence.push('fixture')
      return w.handler(script)
    })

    const s = scripts()
    s.fixtures = [
      { kind: 'solution', name: '01.sh', script: CORRECT },
      { kind: 'solution', name: '02-setup-fails.sh', script: CORRECT },
      { kind: 'solution', name: '03.sh', script: CORRECT },
    ]

    await validateTask(task({ rebootCheck: false }), s, d)

    expect(sequence.filter((tag) => tag === 'reset')).toHaveLength(3)
    const setupIndices = sequence.reduce<number[]>(
      (acc, tag, i) => (tag === 'setup' ? [...acc, i] : acc),
      [],
    )
    expect(setupIndices).toHaveLength(3)
    for (const i of setupIndices) {
      expect(sequence[i - 1]).toBe('reset')
    }
  })

  it('fails solution fixtures when the grader emits no checkpoints at all', async () => {
    // For a rebootCheck: false task, a grader that emits nothing is the only
    // failure a solution fixture would otherwise produce — expectedStatus
    // defaults to 'pass' for an id that never shows up, and 'pass' is exactly
    // what a solution fixture wants, so without this guard both solutions
    // would report ok: true for a grader that ran and said nothing at all.
    const w = world()
    const d = deps(w)
    d.transport = new FakeTransport((script) =>
      script.includes('GRADE') ? { stdout: '', stderr: '', code: 0 } : w.handler(script),
    )
    const s = scripts({ grade: '# baseline-fail: lv-var-size, persist-config\nGRADE' })

    const results = await validateTask(task({ rebootCheck: false }), s, d)
    const solutions = results.filter((r) => r.kind === 'solution')
    expect(solutions.length).toBeGreaterThan(0)
    for (const r of solutions) {
      expect(r.ok).toBe(false)
      expect(r.failures.join('\n')).toMatch(/verdict A: grader emitted no checkpoints/)
    }
  })

  it('reports duplicate checkpoint ids exactly once per fixture, not once per verdict', async () => {
    // duplicateIds runs once, against verdict A only, deliberately: checking
    // inside checkVerdict would report the same duplicate twice on any task
    // with rebootCheck: true, since checkVerdict runs once for A and once
    // for B. Pin the count, not just the presence, on a reboot-checking task
    // where both verdicts exist.
    const bad = {
      transport: new FakeTransport((script) =>
        script.includes('GRADE')
          ? {
              stdout: [
                '{"id":"dup","desc":"x","status":"pass"}',
                '{"id":"dup","desc":"y","status":"pass"}',
              ].join('\n'),
              stderr: '',
              code: 0,
            }
          : { stdout: '', stderr: '', code: 0 },
      ),
      reset: async () => {},
      reboot: async () => {},
    }
    const s = scripts()
    s.fixtures = [{ kind: 'solution', name: '01.sh', script: CORRECT }]

    const results = await validateTask(task({ rebootCheck: true }), s, bad)
    const dupeReports = results[0]?.failures.filter((f) =>
      f.includes('grader emitted duplicate checkpoint ids'),
    )
    expect(dupeReports).toHaveLength(1)
  })

  // --- Additions required over the brief (see task-11-brief.md, "Six changes I require") ---

  it('change 1: does not let a skip silently satisfy a declared failure', async () => {
    // lv-var-size is declared expect-fail, but the grader reports it as
    // skipped rather than failed. A skip proves the grader gave up, not that
    // it caught the error, so this must be its own reported problem — not a
    // silent pass of the declaration.
    const w = world()
    const bad = deps(w)
    bad.transport = new FakeTransport((script) =>
      script.includes('GRADE')
        ? {
            stdout: [
              '{"id":"lv-var-size","desc":"x","status":"skip"}',
              '{"id":"persist-config","desc":"y","status":"fail"}',
              '{"id":"var-from-lv","desc":"z","status":"pass"}',
            ].join('\n'),
            stderr: '',
            code: 0,
          }
        : { stdout: '', stderr: '', code: 0 },
    )
    const s = scripts()
    s.fixtures = [
      {
        kind: 'antisolution',
        name: '05-skip-not-proof.sh',
        script: `# expect-fail: lv-var-size, persist-config\n${FORGOT_PERSIST}`,
      },
    ]

    const results = await validateTask(task({ rebootCheck: false }), s, bad)
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures.join('\n')).toMatch(
      /lv-var-size: expected fail, got skip/,
    )
  })

  it('change 2: cross-checks anti-solution declared ids against emitted checkpoints', async () => {
    // Declares a checkpoint id the grader never emits at all (a typo). Without
    // the cross-check, expectedStatus's undeclared-id default of 'pass' would
    // silently agree with whatever the grader actually does for every real
    // checkpoint, masking a defect where the grader always passes one of them.
    const w = world()
    const s = scripts()
    s.fixtures = [
      {
        kind: 'antisolution',
        name: '06-typo-id.sh',
        script: `# expect-fail: typo-id\n${FORGOT_PERSIST}`,
      },
    ]

    const results = await validateTask(task(), s, deps(w))
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures.join('\n')).toMatch(
      /expect-fail names typo-id, which the grader never emits/,
    )
  })

  it('change 3: reports a failed reboot as its own failure', async () => {
    const w = world()
    const s = scripts()
    s.fixtures = [{ kind: 'solution', name: '01.sh', script: CORRECT }]
    const d = deps(w)
    d.reboot = async () => {
      throw new Error('vm did not come back')
    }

    const results = await validateTask(task(), s, d)
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures.join('\n')).toMatch(/reboot failed: vm did not come back/)
  })

  it('change 4: flags a checkpoint id that appears only after the reboot', async () => {
    let rebooted = false
    const transport = new FakeTransport((script) => {
      if (script.includes('SETUP')) return { stdout: '', stderr: '', code: 0 }
      if (script.includes('GRADE')) {
        const lines = ['{"id":"a","desc":"x","status":"pass"}']
        if (rebooted) lines.push('{"id":"b","desc":"y","status":"pass"}')
        return { stdout: lines.join('\n'), stderr: '', code: 0 }
      }
      return { stdout: '', stderr: '', code: 0 }
    })
    const d = {
      transport,
      reset: async () => {},
      reboot: async () => {
        rebooted = true
      },
    }
    const s = scripts()
    s.fixtures = [{ kind: 'solution', name: '01.sh', script: CORRECT }]

    const results = await validateTask(task(), s, d)
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures.join('\n')).toMatch(/b appeared only after the reboot/)
  })

  it('change 5: reports verdict B skipped when a solution passes nothing before the reboot', async () => {
    const transport = new FakeTransport((script) =>
      script.includes('GRADE')
        ? { stdout: '{"id":"a","desc":"x","status":"fail"}', stderr: '', code: 0 }
        : { stdout: '', stderr: '', code: 0 },
    )
    const d = { transport, reset: async () => {}, reboot: async () => {} }
    const s = scripts()
    s.fixtures = [{ kind: 'solution', name: '01.sh', script: CORRECT }]

    const results = await validateTask(task(), s, d)
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures.join('\n')).toMatch(
      /verdict B was skipped: no checkpoint passed before the reboot/,
    )
  })

  it('change 6: returns immediately with just the parse error for a malformed anti-solution', async () => {
    const w = world()
    const s = scripts()
    s.fixtures = [
      { kind: 'antisolution', name: '07-no-header.sh', script: FORGOT_PERSIST },
    ]

    const results = await validateTask(task(), s, deps(w))
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures).toHaveLength(1)
    expect(results[0]?.failures[0]).toMatch(/must declare a "# expect-fail:" header/)
  })

  // --- Task 21 mandates ---

  it('mandate 2: fails a solution fixture whose script exits non-zero, naming the exit code, without a checkpoint mismatch', async () => {
    // set -euo pipefail means a real solution script that hits a command
    // error (e.g. lvextend: insufficient free space) stops there and does
    // nothing. Discarding this exit code would make the machine look exactly
    // like no-action, and the harness would misreport it as grader
    // over-fitting rather than a script that could not run.
    const w = world()
    const bad = deps(w)
    bad.transport = new FakeTransport((script) => {
      if (script === CORRECT) {
        return { stdout: '', stderr: 'lvextend: insufficient free space', code: 5 }
      }
      return w.handler(script)
    })
    const s = scripts()
    s.fixtures = [{ kind: 'solution', name: '01.sh', script: CORRECT }]

    const results = await validateTask(task(), s, bad)
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures).toEqual([
      'solution script exited 5: lvextend: insufficient free space',
    ])
  })

  it('mandate 2: fails an antisolution fixture whose script exits non-zero, naming the exit code', async () => {
    // Applies identically to anti-solutions: antisolutions/03-wrong-lv.sh
    // declares the same checkpoint set as grade.sh's baseline-fail on
    // purpose, so a silently-swallowed exit code there would make a
    // no-op fixture pass its own declaration while probing nothing.
    const w = world()
    const bad = deps(w)
    bad.transport = new FakeTransport((script) => {
      if (script.includes('lvextend')) {
        return { stdout: '', stderr: 'lvextend: insufficient free space', code: 5 }
      }
      return w.handler(script)
    })
    const s = scripts()
    s.fixtures = [
      {
        kind: 'antisolution',
        name: '03-wrong-lv.sh',
        script: '# expect-fail: lv-var-size\nsudo lvextend -r -L +4G /dev/rhel/root\n',
      },
    ]

    const results = await validateTask(task(), s, bad)
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures).toEqual([
      'antisolution script exited 5: lvextend: insufficient free space',
    ])
  })

  it('mandate 3: reports @post declarations as unverified when an anti-solution passes nothing before the reboot', async () => {
    // grade() skips the reboot whenever nothing passed in verdict A (see
    // grader.ts's anythingPassed guard). For a *solution* fixture the harness
    // already catches this. For an anti-solution that declares an @post
    // checkpoint, the declaration would otherwise go completely unverified:
    // the fixture reports ok because verdict B never ran to contradict it.
    const transport = new FakeTransport((script) =>
      script.includes('GRADE')
        ? {
            stdout: [
              '{"id":"lv-var-size","desc":"x","status":"fail"}',
              '{"id":"persist-config","desc":"y","status":"fail"}',
              '{"id":"var-from-lv","desc":"z","status":"fail"}',
            ].join('\n'),
            stderr: '',
            code: 0,
          }
        : { stdout: '', stderr: '', code: 0 },
    )
    const d = { transport, reset: async () => {}, reboot: async () => {} }
    const s = scripts()
    s.fixtures = [
      {
        kind: 'antisolution',
        name: '08-nothing-passed.sh',
        script: `# expect-fail: lv-var-size, persist-config, var-from-lv@post\n${FORGOT_PERSIST}`,
      },
    ]

    const results = await validateTask(task(), s, d)
    expect(results[0]?.ok).toBe(false)
    expect(results[0]?.failures.join('\n')).toMatch(
      /verdict B was skipped: no checkpoint passed before the reboot, so the @post declarations were never verified \(var-from-lv\)/,
    )
  })

  it('mandate 3: does not fire when the anti-solution declares no @post checkpoint', async () => {
    // Retiring the "@pre-only anti-solution is invalid" phrasing (parked
    // finding 2's ledger summary) means a plain @pre-or-both declaration must
    // never trip this, even when nothing passed in A.
    const transport = new FakeTransport((script) =>
      script.includes('GRADE')
        ? { stdout: '{"id":"lv-var-size","desc":"x","status":"fail"}', stderr: '', code: 0 }
        : { stdout: '', stderr: '', code: 0 },
    )
    const d = { transport, reset: async () => {}, reboot: async () => {} }
    const s = scripts()
    s.fixtures = [
      { kind: 'antisolution', name: '09-pre-only.sh', script: '# expect-fail: lv-var-size\n' },
    ]

    const results = await validateTask(task(), s, d)
    expect(results[0]?.ok).toBe(true)
    expect(results[0]?.failures).toEqual([])
  })
})
