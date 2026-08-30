import { describe, expect, it } from 'vitest'
import { FakeTransport } from '../../src/engine/vm/fake.ts'
import { NoTransportError, chooseTransport } from '../../src/engine/vm/select.ts'
import type { VmConfig } from '../../src/engine/vm/config.ts'

const CFG: VmConfig = {
  vmx: 'x.vmx',
  ip: '10.0.0.1',
  sshUser: 'student',
  sshPort: 22,
  sshKey: '/k',
  vmrun: '/vmrun.exe',
}

/** A stand-in whose availability is fixed at construction. */
function stub(kind: 'ssh' | 'vmrun', available: boolean) {
  const t = new FakeTransport(() => ({ stdout: '', stderr: '', code: 0 }))
  return Object.assign(t, {
    kind,
    isAvailable: async () => available,
  })
}

describe('chooseTransport', () => {
  it('prefers ssh when it is available', async () => {
    const t = await chooseTransport(CFG, {
      ssh: stub('ssh', true),
      vmrun: stub('vmrun', true),
    })
    expect(t.kind).toBe('ssh')
  })

  it('falls back to vmrun when ssh is down', async () => {
    // This is the whole point of the dual control plane: a task that breaks
    // networking is still gradeable.
    const t = await chooseTransport(CFG, {
      ssh: stub('ssh', false),
      vmrun: stub('vmrun', true),
    })
    expect(t.kind).toBe('vmrun')
  })

  it('honours require: vmrun without probing ssh at all', async () => {
    let probed = false
    const ssh = stub('ssh', true)
    ssh.isAvailable = async () => {
      probed = true
      return true
    }
    const t = await chooseTransport(CFG, { ssh, vmrun: stub('vmrun', true), require: 'vmrun' })
    expect(t.kind).toBe('vmrun')
    expect(probed).toBe(false)
  })

  it('honours cfg.forceTransport', async () => {
    const t = await chooseTransport(
      { ...CFG, forceTransport: 'vmrun' },
      { ssh: stub('ssh', true), vmrun: stub('vmrun', true) },
    )
    expect(t.kind).toBe('vmrun')
  })

  it('require beats cfg.forceTransport, because a task knows what it needs', async () => {
    const t = await chooseTransport(
      { ...CFG, forceTransport: 'ssh' },
      { ssh: stub('ssh', true), vmrun: stub('vmrun', true), require: 'vmrun' },
    )
    expect(t.kind).toBe('vmrun')
  })

  it('throws NoTransportError when a required transport is unavailable', async () => {
    await expect(
      chooseTransport(CFG, { ssh: stub('ssh', false), vmrun: stub('vmrun', true), require: 'ssh' }),
    ).rejects.toThrow(NoTransportError)
  })

  it('throws NoTransportError naming both attempts when neither works', async () => {
    const p = chooseTransport(CFG, { ssh: stub('ssh', false), vmrun: stub('vmrun', false) })
    await expect(p).rejects.toThrow(NoTransportError)
    await expect(p).rejects.toThrow(/ssh/)
    await expect(p).rejects.toThrow(/vmrun/)
    // The message has to tell the user what to do, not just what failed.
    await expect(p).rejects.toThrow(/vm-build-checklist/)
  })

  it("refuses a pinned 'fake' transport instead of silently falling through to a real one", async () => {
    // cfg.forceTransport === 'fake' is reachable through documented
    // RHCSA_TRANSPORT configuration. Without this, the pin would be
    // silently discarded and the caller would get a live SshTransport.
    await expect(
      chooseTransport(
        { ...CFG, forceTransport: 'fake' },
        { ssh: stub('ssh', true), vmrun: stub('vmrun', true) },
      ),
    ).rejects.toThrow(/RHCSA_TRANSPORT/)
  })
})
