import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { run } from '../../src/cli/index.ts'

// fileURLToPath, not .pathname: .pathname percent-encodes, so a space in a
// parent directory would yield a path that does not exist.
const BANK = fileURLToPath(new URL('../fixtures/bank', import.meta.url))
const DUPE = fileURLToPath(new URL('../fixtures/bank-dupe', import.meta.url))

function capture() {
  const out: string[] = []
  const err: string[] = []
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err }
}

describe('rhcsa validate', () => {
  // Every case here returns before loadVmConfig/chooseTransport, so none of
  // them touch a real VM or require RHCSA_VMX to be set.

  it('exits 2 with usage on an unknown option', async () => {
    const c = capture()
    const code = await run(['validate', '--content', BANK, '--bogus'], c.io)
    expect(code).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage: rhcsa/)
  })

  it('exits 2 with usage when --content has no following value', async () => {
    const c = capture()
    const code = await run(['validate', '--content'], c.io)
    expect(code).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage: rhcsa/)
  })

  it('exits 2 with usage when --content is the empty string', async () => {
    const c = capture()
    const code = await run(['validate', '--content', ''], c.io)
    expect(code).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage: rhcsa/)
  })

  it('exits 2 with usage when --snapshot is followed by a flag-shaped value', async () => {
    const c = capture()
    const code = await run(['validate', '--content', BANK, '--snapshot', '--content'], c.io)
    expect(code).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage: rhcsa/)
  })

  it('reports a ContentError legibly and exits 1', async () => {
    const c = capture()
    const code = await run(['validate', '--content', DUPE], c.io)
    expect(code).toBe(1)
    expect(c.err.join('\n')).toMatch(/duplicate task id/)
  })

  it('exits 1 naming an unknown task id without touching the VM', async () => {
    const c = capture()
    const code = await run(['validate', '--content', BANK, 'no/such-task'], c.io)
    expect(code).toBe(1)
    expect(c.err.join('\n')).toMatch(/unknown task: no\/such-task/)
  })
})
