import type { DemoFailure, DemoOutcome, DemoPlan } from '../engine/demo/antisolution.ts'

/**
 * Anti-solution demonstrations as **resources**, not as request/response.
 *
 * ## Why the shape is a resource and a poll, and not one blocking request
 *
 * The run is `reset` → `setup.sh` → the anti-solution → grade → **reboot** → grade
 * again. Measured on this project's guest, the revert alone takes about five
 * seconds, and `waitForGuest` in the VM layer is written against a 120-second
 * ceiling for a boot. So a synchronous `POST` would hold a connection open across a
 * deliberate reboot of the machine, for somewhere between tens of seconds and two
 * minutes, and every layer between the browser and Hono gets an opinion about that:
 * a proxy read timeout, a `fetch` abort, a laptop lid. Each of those produces the
 * one outcome this feature must never produce — the guest has been reverted and
 * sabotaged, and the client does not know how it went, so it cannot tell the student
 * why their next grade is failing.
 *
 * The existing session routes are the model, and following them is most of the
 * argument for this shape: a session is already a server-side resource with an id, a
 * phase, and separate routes that advance and read it, precisely because the work
 * outlives the request that started it. A demo is the same thing with a shorter life.
 * `POST /api/demos` therefore answers 202 with an id and the URL to poll, and every
 * outcome — including a failed reboot — is a state on the resource that a later `GET`
 * can read. Nothing is lost to a dropped connection; at worst the student refreshes.
 *
 * ## Why the store is in memory, and why that is not a gap
 *
 * A demo is not evidence about the student. It teaches, it produces no rating, it
 * writes no attempt, and re-running it costs a revert. So there is nothing here that
 * `attempts` exists to preserve, and a restart losing an in-flight demo is a
 * recoverable annoyance rather than lost history — the same trade `SessionStore`
 * already makes, on a resource that matters more.
 */

/**
 * `running` is the only non-terminal phase.
 *
 * `failed` means the *demo* could not be produced — setup broke, or the
 * anti-solution script aborted. It is deliberately distinct from a `done` demo whose
 * `outcome.taught` is false, which means the demo ran fine and did not teach what it
 * promised. A screen must be able to tell "we could not show you this" from "we
 * showed you this and it did not do what we said", because only the second one is a
 * statement about the content.
 */
export type DemoPhase = 'running' | 'done' | 'failed'

export interface DemoRecord {
  id: string
  taskId: string
  /** The anti-solution's file name. */
  name: string
  /** The classification made before anything ran, so a poll can describe a demo in flight. */
  plan: DemoPlan
  phase: DemoPhase
  startedAt: number
  endedAt?: number
  /** Present exactly when `phase` is `done`. */
  outcome?: DemoOutcome
  /** Present when the run stopped before grading. */
  failure?: DemoFailure
  /** Present when the run threw — a transport error rather than a script exiting non-zero. */
  error?: string
}

export class DemoStore {
  #byId = new Map<string, DemoRecord>()
  #seq = 0
  /**
   * The id of the demo currently holding the guest, or `undefined`.
   *
   * One guest, so one demo at a time — and unlike two concurrent sessions, which
   * merely confuse each other, two concurrent demos revert the machine out from under
   * each other mid-run and produce two verdicts that describe neither. Tracked here
   * rather than by scanning `#byId` for a `running` phase so that the check the route
   * makes and the slot the run occupies are the same fact.
   */
  #active: string | undefined

  create(taskId: string, plan: DemoPlan, now: number): DemoRecord {
    this.#seq += 1
    const record: DemoRecord = {
      id: `d${this.#seq}`,
      taskId,
      name: plan.name,
      plan,
      phase: 'running',
      startedAt: now,
    }
    this.#byId.set(record.id, record)
    this.#active = record.id
    return record
  }

  get(id: string): DemoRecord | undefined {
    return this.#byId.get(id)
  }

  /** The demo holding the guest, if any. */
  active(): DemoRecord | undefined {
    return this.#active === undefined ? undefined : this.#byId.get(this.#active)
  }

  finish(id: string, now: number, outcome: DemoOutcome): DemoRecord | undefined {
    return this.#settle(id, now, 'done', (r) => {
      r.outcome = outcome
    })
  }

  fail(id: string, now: number, failure: DemoFailure): DemoRecord | undefined {
    return this.#settle(id, now, 'failed', (r) => {
      r.failure = failure
    })
  }

  /** A thrown transport error: the run did not reach a stage it could name. */
  crash(id: string, now: number, error: string): DemoRecord | undefined {
    return this.#settle(id, now, 'failed', (r) => {
      r.error = error
    })
  }

  #settle(id: string, now: number, phase: DemoPhase, apply: (r: DemoRecord) => void): DemoRecord | undefined {
    const r = this.#byId.get(id)
    if (r === undefined) return undefined
    r.phase = phase
    r.endedAt = now
    apply(r)
    // Released here and in every terminal path, rather than by the route's success
    // handler, so a crash cannot leave the guest marked busy for the rest of the
    // process's life — which would refuse every later demo with a 409 naming a run
    // that ended minutes ago.
    if (this.#active === id) this.#active = undefined
    return r
  }
}

/** What a poll returns. Flattened from the record so the wire shape is stated in one place. */
export function demoView(r: DemoRecord) {
  return {
    id: r.id,
    taskId: r.taskId,
    name: r.name,
    phase: r.phase,
    kind: r.plan.kind,
    headline: r.plan.headline,
    /** The `@post` ids this demo claimed would flip, before it ran. */
    expectedFlips: r.plan.flips,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    /**
     * The side-by-side payload. `before` is "works now", `after` is "survives
     * reboot", `flipped` names the checkpoints that went from one to the other —
     * which is the whole lesson, so it is a field and not something the UI has to
     * diff out of two lists.
     */
    before: r.outcome?.before ?? null,
    after: r.outcome?.after ?? null,
    flipped: r.outcome?.flipped.map((cp) => ({ id: cp.id, desc: cp.desc, detail: cp.detail })) ?? [],
    taught: r.outcome?.taught ?? null,
    problems: r.outcome?.problems ?? [],
    failure: r.failure === undefined ? null : { stage: r.failure.stage, message: r.failure.message },
    error: r.error ?? null,
  }
}
