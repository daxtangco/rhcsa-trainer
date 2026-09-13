import type { DatabaseSync } from 'node:sqlite'
import { MEMORY_DB, openHistoryDb } from './schema.ts'

export { MEMORY_DB }

/**
 * Section 5.5's guard, at the end where it refuses.
 *
 * > SQLite records which task's `setup.sh` is currently applied. Grading task X
 * > while task Y's setup is live is refused, with an offer to reset. Without this
 * > guard the user receives pages of inexplicable failures on correct work and
 * > loses confidence in the grader.
 *
 * That last sentence is the whole design constraint, and it is about **trust in the
 * grader** rather than about data quality. `schema.ts` already carries the other
 * half of the guard — three expressions of "a drifted attempt cannot be read as
 * evidence" — but every one of those is consulted *after* `grade.sh` has run, so
 * none of them stops the student reading a page of failures against work that was
 * correct. Refusing before the grader runs is what does.
 *
 * The two halves are also asymmetric in what they cost when wrong. Withholding a
 * rating from a drifted attempt costs one data point. Refusing a grade costs the
 * student the run, so this half refuses only on **positive evidence** of a
 * mismatch: see `staleFor`, which permits when the store has no record at all.
 */

/** What the guest is known to be carrying. */
export interface VmState {
  /**
   * The task whose `setup.sh` is applied, or `null` when nothing is known — see
   * `VmStateStore.unknown`. Text, not a reference: the bank stays renumberable.
   */
  currentTask: string | null
  /** The snapshot the guest was reverted to before that setup ran; `null` with `currentTask`. */
  currentSnapshot: string | null
  /** From the injected clock, at the moment the row was written. */
  appliedAt: number
}

/**
 * Why grading the requested task now would measure it against the wrong machine.
 *
 * Carries both task ids because section 5.5's refusal is only actionable if the
 * student can see what happened: "the guest is stale" sends them looking for a
 * mistake in their own work, which is the confidence loss the guard exists to
 * prevent. `message` says both out loud, and `server/app.ts` appends the offer to
 * reset — the offer names a route, which is the server's business and not this
 * layer's.
 */
export interface StaleState {
  /** The task the caller wants to grade. */
  requestedTask: string
  /** The task whose setup is live, or `null` when the guest's state is unknown. */
  liveTask: string | null
  currentSnapshot: string | null
  appliedAt: number
  /** Names `requestedTask`, and `liveTask` when there is one. No route, no offer. */
  message: string
}

const UPSERT = `
INSERT INTO vm_state (id, current_task, current_snapshot, applied_at)
VALUES (1, :task, :snapshot, :at)
ON CONFLICT (id) DO UPDATE SET
  current_task     = excluded.current_task,
  current_snapshot = excluded.current_snapshot,
  applied_at       = excluded.applied_at`

const SELECT = 'SELECT current_task, current_snapshot, applied_at FROM vm_state WHERE id = 1'

/**
 * Read back rather than trusted, the same way `attempts.ts` does it and for the same
 * reason: the file is a file, on a machine whose whole purpose is being broken and
 * reverted by a student.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function optText(row: Record<string, unknown>, col: string): string | null {
  const v = row[col]
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v
  throw new Error(`vm_state.${col}: expected text or null, found ${typeof v}`)
}

function num(row: Record<string, unknown>, col: string): number {
  const v = row[col]
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  throw new Error(`vm_state.${col}: expected a number, found ${typeof v}`)
}

export interface VmStateStoreOptions {
  /** Injected so tests are deterministic — this store never calls `Date.now()`. */
  now: () => number
}

/**
 * What is applied to the one guest, and whether a grade against it can mean
 * anything.
 *
 * One row (`schema.ts` enforces `id = 1`), because there is one VM and one user.
 */
export class VmStateStore {
  readonly #db: DatabaseSync
  readonly #now: () => number

  constructor(db: DatabaseSync, opts: VmStateStoreOptions) {
    this.#db = db
    this.#now = opts.now
  }

  /**
   * Record that `taskId`'s `setup.sh` is applied on top of `snapshot`. Call this
   * only after the setup script has exited 0: a script that failed part way leaves
   * a machine no row can describe, and `unknown` is the honest record of that.
   */
  applied(taskId: string, snapshot: string): VmState {
    return this.#write(taskId, snapshot)
  }

  /**
   * Record that nothing is known about the guest.
   *
   * Written **before** a revert, not after a failure, and that ordering is the
   * point: from the moment the revert begins until `setup.sh` exits 0 the guest is
   * neither the old task's machine nor the new one's, so a crash, a thrown
   * transport error or a non-zero setup anywhere in between leaves a row that says
   * so. Recording the failure afterwards instead would leave the previous task's id
   * in place for every interleaving that never reaches the failure handler — which
   * is the exact row section 5.5 must not have: a confident claim about a machine
   * that has since been wiped.
   */
  unknown(): VmState {
    return this.#write(null, null)
  }

  /** What the guest is carrying, or `undefined` if nothing was ever recorded. */
  current(): VmState | undefined {
    const row = this.#db.prepare(SELECT).get()
    if (!isRecord(row)) return undefined
    return {
      currentTask: optText(row, 'current_task'),
      currentSnapshot: optText(row, 'current_snapshot'),
      appliedAt: num(row, 'applied_at'),
    }
  }

  /**
   * Why grading `taskId` right now would be measured against the wrong machine, or
   * `undefined` when it would not. The guard read, and the only one: there is
   * deliberately no `isFresh` or `mayGrade` beside it, because a boolean discards
   * the two task ids that make the refusal actionable.
   *
   * **A missing row permits the grade.** No row means the store has never been
   * written — a fresh database, or a `vm_state` write that failed — and that is an
   * absence of evidence rather than evidence of drift. Refusing there would make a
   * bookkeeping failure cost the student the run, which is the trade `app.ts`
   * already refuses to make for `attempts`; and in the served path the row cannot
   * be missing, because `POST /api/sessions` writes it before it touches the guest.
   * An **unknown** row is the opposite case and does refuse: something was done to
   * the guest and did not finish.
   */
  staleFor(taskId: string): StaleState | undefined {
    const state = this.current()
    if (state === undefined) return undefined
    if (state.currentTask === taskId) return undefined
    return {
      requestedTask: taskId,
      liveTask: state.currentTask,
      currentSnapshot: state.currentSnapshot,
      appliedAt: state.appliedAt,
      message:
        state.currentTask === null
          ? `nothing is known about the guest — the last revert or setup.sh did not finish — so` +
            ` grading ${taskId} would measure your work against a machine in an unknown state`
          : `${state.currentTask}'s setup.sh is live on the guest, so grading ${taskId} would` +
            ` measure your work against the wrong machine`,
    }
  }

  close(): void {
    this.#db.close()
  }

  #write(task: string | null, snapshot: string | null): VmState {
    this.#db.prepare(UPSERT).run({ task, snapshot, at: this.#now() })
    const stored = this.current()
    // Read back, not echoed: the row the guard will consult is the one that matters,
    // and the schema is what decides whether the pair of nulls was allowed.
    if (stored === undefined) throw new Error('vm_state vanished immediately after the write')
    return stored
  }
}

export interface OpenVmStateStoreOptions extends VmStateStoreOptions {
  /** File path, or `MEMORY_DB` for a throwaway. Parent directories are created. */
  path: string
}

/**
 * A store with a database of its own. `server/index.ts` does **not** use this — it
 * opens one handle and hands it to both stores, because there is one history file
 * and a second `DatabaseSync` on it would be a second connection with its own
 * transaction state for no gain. This exists for tests, and for a caller that wants
 * only the guard.
 */
export function openVmStateStore(opts: OpenVmStateStoreOptions): VmStateStore {
  return new VmStateStore(openHistoryDb({ path: opts.path }), { now: opts.now })
}
