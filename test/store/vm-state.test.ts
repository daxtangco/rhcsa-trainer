import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MEMORY_DB } from '../../src/engine/store/schema.ts'
import { openVmStateStore, type VmStateStore } from '../../src/engine/store/vm-state.ts'

/**
 * Section 5.5's guard, at the end where it refuses.
 *
 * Both directions of every case, because a guard that refuses everything passes a
 * one-sided test and would also make the app unusable: for each refusal here there
 * is an insert or a call that must be **permitted**.
 */

const GROW = 'storage/014-grow-home-lv'
const HTTPD = 'selinux/019-httpd-alt-port'
const T0 = 1_700_000_000_000

const open: VmStateStore[] = []

function store(now: () => number = () => T0): VmStateStore {
  const s = openVmStateStore({ path: MEMORY_DB, now })
  open.push(s)
  return s
}

afterEach(() => {
  while (open.length > 0) open.pop()?.close()
})

describe('VmStateStore, recording what is applied to the guest', () => {
  it('records the task, the snapshot it was applied on top of, and when', () => {
    const s = store()
    expect(s.applied(GROW, 'clean')).toEqual({
      currentTask: GROW,
      currentSnapshot: 'clean',
      appliedAt: T0,
    })
    expect(s.current()).toEqual({ currentTask: GROW, currentSnapshot: 'clean', appliedAt: T0 })
  })

  it('takes its clock as a parameter', () => {
    const s = store(() => 424_242)
    expect(s.applied(GROW, 'clean').appliedAt).toBe(424_242)
  })

  it('knows nothing before anything has been applied', () => {
    expect(store().current()).toBeUndefined()
  })

  it('keeps one row: the last setup applied is the state of the guest', () => {
    let clock = T0
    const s = store(() => (clock += 1_000))
    s.applied(GROW, 'clean')
    s.applied(HTTPD, 'clean')
    // Not two rows and not an append-only log — there is one guest, and "what is on
    // it now" must not be a query over history.
    expect(s.current()).toEqual({ currentTask: HTTPD, currentSnapshot: 'clean', appliedAt: T0 + 2_000 })
  })

  it('records the unknown state as both columns null, not as the previous task', () => {
    const s = store()
    s.applied(GROW, 'clean')
    expect(s.unknown()).toEqual({ currentTask: null, currentSnapshot: null, appliedAt: T0 })
  })
})

describe('VmStateStore.staleFor, section 5.5\'s refusal', () => {
  it('permits grading the task whose setup is live', () => {
    const s = store()
    s.applied(GROW, 'clean')
    // The case that matters most often: this is every grade in a normal session, and
    // a guard that refused here would refuse everything.
    expect(s.staleFor(GROW)).toBeUndefined()
  })

  it('refuses grading a task while another task\'s setup is live, naming both', () => {
    const s = store()
    s.applied(HTTPD, 'clean')
    const stale = s.staleFor(GROW)

    expect(stale).toEqual({
      requestedTask: GROW,
      liveTask: HTTPD,
      currentSnapshot: 'clean',
      appliedAt: T0,
      message: expect.any(String),
    })
    // Both ids in the sentence, because "the guest is stale" sends the student
    // looking for a mistake in their own work — which is the confidence loss
    // section 5.5 exists to prevent.
    expect(stale?.message).toContain(HTTPD)
    expect(stale?.message).toContain(GROW)
  })

  it('refuses grading anything while the guest\'s state is unknown', () => {
    const s = store()
    s.applied(GROW, 'clean')
    s.unknown()

    const stale = s.staleFor(GROW)
    expect(stale?.liveTask).toBeNull()
    expect(stale?.message).toContain(GROW)
    expect(stale?.message).toMatch(/nothing is known about the guest/)
    // The task that *was* live is not named, because it is no longer a fact: the
    // revert that followed it may have half happened.
    expect(stale?.message).not.toContain(HTTPD)
  })

  it('permits again once a setup has been applied over the unknown state', () => {
    const s = store()
    s.unknown()
    expect(s.staleFor(GROW)).toBeDefined()
    s.applied(GROW, 'clean')
    expect(s.staleFor(GROW)).toBeUndefined()
  })

  it('permits when nothing was ever recorded, because that is no evidence rather than drift', () => {
    // Refusing here would let a failed bookkeeping write cost the student the run.
    // In the served path the row cannot be missing: POST /api/sessions writes it
    // before it touches the guest, which `test/server/stale-state.test.ts` pins.
    expect(store().staleFor(GROW)).toBeUndefined()
  })

  it('does not compare snapshots, only tasks', () => {
    const s = store()
    // Section 4.3's snapshot ladder is not built, so a snapshot comparison would be a
    // guess about a design that does not exist. Recorded, not consulted.
    s.applied(GROW, 'clean-plus-disks')
    expect(s.staleFor(GROW)).toBeUndefined()
  })

  it('survives the process, which is the whole reason this lives in SQLite', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rhcsa-vm-state-'))
    try {
      const path = join(dir, 'state', 'history.db')
      const first = openVmStateStore({ path, now: () => T0 })
      first.applied(HTTPD, 'clean')
      first.close()

      // A restarted server has no memory of what it applied; the guest has not
      // changed. Section 5.5 says SQLite records this, and this is why.
      const second = openVmStateStore({ path, now: () => T0 + 5_000 })
      try {
        expect(second.staleFor(GROW)?.liveTask).toBe(HTTPD)
        expect(second.staleFor(HTTPD)).toBeUndefined()
      } finally {
        second.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
