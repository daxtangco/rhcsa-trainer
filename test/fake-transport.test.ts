import { describe, expect, it } from 'vitest'
import { FakeTransport } from '../src/engine/vm/fake.ts'

describe('FakeTransport', () => {
  it('returns what the handler produces and records the script', async () => {
    const t = new FakeTransport((script) => ({
      stdout: script.includes('lvs') ? 'rhel var 6.00g' : '',
      stderr: '',
      code: 0,
    }))

    const r = await t.exec('lvs --noheadings')

    expect(r.stdout).toBe('rhel var 6.00g')
    expect(r.code).toBe(0)
    expect(t.calls).toEqual(['lvs --noheadings'])
  })

  it("returns the handler's result unchanged", async () => {
    const t = new FakeTransport(() => ({ stdout: 'ok', stderr: '', code: 0 }))
    await expect(t.exec('true')).resolves.toEqual({ stdout: 'ok', stderr: '', code: 0 })
  })

  it('supports simulating an unreachable VM', async () => {
    const t = new FakeTransport(() => ({ stdout: '', stderr: '', code: 0 }), { available: false })
    await expect(t.isAvailable()).resolves.toBe(false)
  })

  it('reports kind "fake" so callers can assert they are not on real hardware', () => {
    const t = new FakeTransport(() => ({ stdout: '', stderr: '', code: 0 }))
    expect(t.kind).toBe('fake')
  })

  it('lets a handler hold mutable state across calls', async () => {
    // This is the pattern every grading test uses: the handler is a tiny
    // state machine, never a simulated Linux.
    let varSizeGb = 2
    const t = new FakeTransport((script) => {
      if (script.startsWith('lvextend')) {
        varSizeGb = 6
        return { stdout: '', stderr: '', code: 0 }
      }
      return { stdout: `${varSizeGb}`, stderr: '', code: 0 }
    })

    expect((await t.exec('lvs')).stdout).toBe('2')
    await t.exec('lvextend -L 6G /dev/rhel/var')
    expect((await t.exec('lvs')).stdout).toBe('6')
  })
})
