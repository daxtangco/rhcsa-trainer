import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadBank } from '../../src/engine/content/bank.ts'
import { loadTaskScripts } from '../../src/engine/validate/harness.ts'
import { chooseTransport } from '../../src/engine/vm/select.ts'
import { loadVmConfig } from '../../src/engine/vm/config.ts'
import { VmController } from '../../src/engine/vm/vmrun.ts'
import { createApp } from '../../src/server/app.ts'
import { createLabRuntime } from '../../src/server/lab.ts'
import type { LabRuntime } from '../../src/server/lab.ts'
import { SessionStore } from '../../src/server/session.ts'

const TASK_ID = 'storage/014-grow-home-lv'
const CONTENT = process.env.RHCSA_CONTENT ?? 'content'
const SNAPSHOT = process.env.RHCSA_SNAPSHOT ?? 'clean'

/** The whole point: the reboot is real, so the budget is real. */
const E2E_TIMEOUT = 300_000

/**
 * Wait until the guest will actually accept a command, not merely until vmrun
 * says it is up. `waitForGuest` polls through the guest *tools*, which answer
 * seconds before sshd is listening — so the first exec after a revert or a
 * reboot can fail on connection refused, and over HTTP that arrives as a bare
 * 500 with nothing in it to diagnose. Thirty attempts two seconds apart is a
 * minute of slack against a boot that normally takes far less.
 */
async function waitForSsh(runtime: LabRuntime): Promise<void> {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const r = await runtime.exec('true')
      if (r.code === 0) return
    } catch {
      // sshd is not listening yet; that is what we are waiting for.
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('guest tools answered but sshd never accepted a connection (30 attempts, 2s apart)')
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Narrows with a message that names what was being read, which a cast cannot.
 *
 * The difference is not cosmetic. Under `as Record<string, unknown>`, a rung-2
 * response whose `content` came back `undefined` yields `String(undefined)` — the
 * literal seven-character string `"undefined"` — and the assertions below then
 * happily describe it. This throws at the point of the lie, naming the field.
 * That is the same contract the grader itself is built on, applied to the test
 * that certifies the grader.
 */
function obj(v: unknown, what: string): Record<string, unknown> {
  if (!isRecord(v)) throw new Error(`${what}: expected an object, got ${JSON.stringify(v)}`)
  return v
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new Error(`${what}: expected a string, got ${JSON.stringify(v)}`)
  return v
}

async function buildApp() {
  const cfg = loadVmConfig(process.env)
  const bank = await loadBank(CONTENT)
  const assertLib = await readFile(join(CONTENT, 'lib', 'assert.sh'), 'utf8')
  const transport = await chooseTransport(cfg)
  const controller = new VmController(cfg)
  // The runtime is returned as well as injected: the test has to reach the
  // guest to apply the solution, and building a second transport of its own
  // would mean a second SSH identity and a second set of host keys to get
  // wrong. One connection, used by both the app and the test.
  const runtime = createLabRuntime({ transport, controller, snapshot: SNAPSHOT })
  // grade() execs verdict B the instant reboot() resolves, and reboot() resolves
  // on guest-tools readiness. Bolt the sshd wait onto this one instance rather
  // than changing Task 17's contract for the callers that grade over vmrun and
  // genuinely do not care.
  //
  // Patching *after* createLabRuntime is deliberate and not a bug: `lab.ts:31`
  // stores `reboot: () => opts.controller.reboot()`, a closure that reads the
  // property at call time, so the runtime picks this up. The next reader will
  // have the same doubt, which is why the line is here.
  const rebooted = controller.reboot.bind(controller)
  controller.reboot = async () => {
    await rebooted()
    await waitForSsh(runtime)
  }
  const app = createApp({
    bank,
    runtime,
    sessions: new SessionStore(),
    assertLib,
    loadScripts: loadTaskScripts,
    now: () => Date.now(),
  })
  return { app, bank, assertLib, runtime, transportKind: transport.kind }
}

type App = Awaited<ReturnType<typeof buildApp>>['app']

async function post(app: App, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`POST ${path}: status ${res.status}, body was not JSON: ${text.slice(0, 200)}`)
  }
  return obj(parsed, `POST ${path} response`)
}

describe('phase 1 exit criterion', () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    ctx = await buildApp()
    // The guest may have been powered on moments ago; the session-create call
    // below reverts a snapshot and immediately runs setup.sh over the transport.
    await waitForSsh(ctx.runtime)
  }, 120_000)

  it(
    'teaches the concept, grades the solution and survives the reboot',
    async () => {
      const { app, bank, assertLib } = ctx

      // --- the lab exists and its prompt is real -------------------------
      const started = await post(app, '/api/sessions', { taskId: TASK_ID, mode: 'practice' })
      expect(started.error).toBeUndefined()
      const id = str(started.id, 'session id')
      expect(started.checkpointTotal).toBe(5)
      expect(str(started.prompt, 'task prompt')).toMatch(/12/)

      // --- "learned the concept from a concept card" ----------------------
      // Rung 2 names the objective and the cards but must not contain the
      // command. If it does, the ladder has collapsed into an answer key.
      const nudge = await post(app, `/api/sessions/${id}/hint`)
      expect(nudge.rung).toBe(2)
      const nudgeBody = str(obj(nudge.content, 'rung 2 content').body, 'rung 2 body')

      // A not.toMatch is satisfied by an empty string, and by a great many other
      // things that are not a working nudge: an empty `ctx.concepts`, an empty
      // `ctx.objectives`, or a rung-1 prompt returned when rung 2 was asked for.
      // Several of those are exactly what a wiring mistake between Task 21's
      // content and Task 23's loader would produce. Prove the body was assembled
      // from THIS task's objective and cards before trusting its absences.
      expect(nudgeBody).toContain('Extend existing logical volumes')
      expect(nudgeBody).toContain('Physical volumes, volume groups, logical volumes')
      expect(nudgeBody).toContain('XFS grows but never shrinks')
      expect(nudgeBody).not.toMatch(/lvextend|xfs_growfs/)

      // Rung 3 is the cards themselves, in full. This is the surface that
      // replaces the book, so an empty or stub card fails the criterion.
      const cards = await post(app, `/api/sessions/${id}/hint`)
      expect(cards.rung).toBe(3)
      const cardBody = str(obj(cards.content, 'rung 3 content').body, 'rung 3 body')
      expect(cardBody).toMatch(/physical volume/i)
      expect(cardBody).toMatch(/xfs_growfs/)

      // Measured: the two card bodies are 1811 and 1766 characters, so EITHER one
      // alone clears the 1500 this used to assert — the threshold could not detect
      // the failure it was written for. `requires_concepts` lists two cards and
      // rung 3 joins them with `\n\n---\n\n`, so pin both headings and the
      // separator: a `find` where a `filter` belonged, or a loader returning the
      // first match, must fail here rather than pass on one card.
      expect(cardBody).toContain('## Physical volumes, volume groups, logical volumes')
      expect(cardBody).toContain('## XFS grows but never shrinks')
      expect(cardBody).toContain('\n---\n')
      expect(cardBody.length).toBeGreaterThan(3000)

      // --- solve it the way a student would, in the guest -----------------
      const task = bank.tasksById.get(TASK_ID)
      if (task === undefined) throw new Error(`missing task ${TASK_ID}`)
      const scripts = await loadTaskScripts(task, assertLib)
      const solution = scripts.fixtures.find((f) => f.kind === 'solution')
      if (solution === undefined) throw new Error('no solution fixture')
      const run = await ctx.runtime.exec(solution.script)
      expect(run.code, run.stderr).toBe(0)

      // --- grade: verdict A, reboot, verdict B ----------------------------
      const report = await post(app, `/api/sessions/${id}/grade`)
      expect(report.error).toBeUndefined()
      expect(report.rebootError).toBeUndefined()
      expect(report.rebooted).toBe(true)
      expect(report.regressionCount).toBe(0)
      // The truncation guard, exercised against a real grader run for the only
      // time anywhere: `incomplete` is what stands between a grade.sh that died
      // half way and a student being told they passed.
      expect(report.incomplete).toBe(false)
      expect(report.expectedTotal).toBe(5)
      expect(report.passed).toBe(5)
      expect(report.total).toBe(5)
      expect(report.allPassed).toBe(true)

      // --- finish: the rating is derived, not asked for -------------------
      const done = await post(app, `/api/sessions/${id}/finish`)
      // 'graded' is the terminal phase in SessionPhase; there is no 'done'.
      expect(done.phase).toBe('graded')
      // Three rungs used on a fully passing attempt. `deriveRating` reaches
      // `rungUsed === 3` at src/engine/disclosure/ladder.ts:83 only because the
      // three earlier arms do not fire: no regression, rung below 4, and
      // `passed` true.
      expect(done.rating).toBe('hard')
      const finalReport = obj(done.report, 'final grade report')
      expect(Array.isArray(finalReport.checkpoints)).toBe(true)
    },
    E2E_TIMEOUT,
  )
})
