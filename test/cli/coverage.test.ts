import { describe, expect, it } from 'vitest'
import { run } from '../../src/cli/index.ts'

const BANK = new URL('../fixtures/bank', import.meta.url).pathname
const UNRESOLVED = new URL('../fixtures/bank-unresolved', import.meta.url).pathname

function capture() {
  const out: string[] = []
  const err: string[] = []
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err }
}

describe('rhcsa coverage', () => {
  it('reports counts and exits 0 when every reference resolves', async () => {
    const c = capture()
    const code = await run(['coverage', '--content', BANK], c.io)

    expect(code).toBe(0)
    const text = c.out.join('\n')
    expect(text).toMatch(/tasks: 2/)
    expect(text).toMatch(/concepts: 2/)
    expect(text).toMatch(/objectives: 3/)
    expect(text).toMatch(/uncovered objectives: 1/)
    expect(text).toMatch(/autofs\.maps\.configure/)
    expect(text).toMatch(/untaught concepts: 1/)
    expect(text).toMatch(/storage\.orphan-concept/)
  })

  it('exits 1 under --strict while coverage gaps remain', async () => {
    // Gaps are expected during Phase 1, so they only become failures on demand.
    const c = capture()
    const code = await run(['coverage', '--content', BANK, '--strict'], c.io)
    expect(code).toBe(1)
    expect(c.err.join('\n')).toMatch(/1 uncovered objective/)
    // A regression that stopped printing the report entirely while still
    // exiting 1 would pass an exit-code-only assertion.
    expect(c.out.join('\n')).toMatch(/tasks: \d/)
  })

  it('exits 2 with usage when --content is the empty string', async () => {
    // ''.startsWith('--') is false, so an empty value slipped past the
    // existing guard and loadBank('') resolved against the process cwd — not
    // a content root anyone meant.
    const c = capture()
    const code = await run(['coverage', '--content', ''], c.io)
    expect(code).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage: rhcsa/)
  })

  it('reports a ContentError legibly and exits 1', async () => {
    const c = capture()
    const code = await run(
      ['coverage', '--content', new URL('../fixtures/bank-dupe', import.meta.url).pathname],
      c.io,
    )
    expect(code).toBe(1)
    expect(c.err.join('\n')).toMatch(/duplicate task id/)
  })

  it('exits 2 with usage on an unknown command', async () => {
    const c = capture()
    expect(await run(['frobnicate'], c.io)).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage: rhcsa/)
  })

  it('exits 2 with usage when no command is given', async () => {
    const c = capture()
    expect(await run([], c.io)).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage: rhcsa/)
  })

  it('exits 2 with usage on an unknown option instead of silently ignoring it', async () => {
    // A typo'd --strict (--strick) must never disable strictness quietly.
    const c = capture()
    const code = await run(['coverage', '--content', BANK, '--strick'], c.io)
    expect(code).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage: rhcsa/)
  })

  it('does not print the report when an unknown option is rejected', async () => {
    const c = capture()
    await run(['coverage', '--content', BANK, '--strick'], c.io)
    expect(c.out).toEqual([])
  })

  it('exits 2 with usage when --content has no following value', async () => {
    const c = capture()
    const code = await run(['coverage', '--content'], c.io)
    expect(code).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage: rhcsa/)
  })

  it('exits 2 with usage when --content is followed by a flag-shaped value', async () => {
    const c = capture()
    const code = await run(['coverage', '--content', '--strict'], c.io)
    expect(code).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage: rhcsa/)
  })

  it('reports an unresolved reference as a problem, with counts still on stdout', async () => {
    const c = capture()
    const code = await run(['coverage', '--content', UNRESOLVED], c.io)
    expect(code).toBe(1)
    expect(c.err.join('\n')).toMatch(/requires unknown concept/)
    const text = c.out.join('\n')
    expect(text).toMatch(/tasks: 1/)
    expect(text).toMatch(/concepts: 1/)
    expect(text).toMatch(/objectives: 1/)
  })
})
