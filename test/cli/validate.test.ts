import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { run, transportMismatchWarning } from '../../src/cli/index.ts'

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

// The one part of `validate` past `chooseTransport` that can be tested without a
// hypervisor, which is why it is a pure exported function rather than four lines
// inline. What it guards is described on the function itself: a task declaring
// `transport: ssh` is validated over vmrun whenever the ssh probe fails, and the
// pass that produces is silently about a different code path.
describe('transportMismatchWarning', () => {
  it('says nothing when every task got the transport it declared', () => {
    expect(
      transportMismatchWarning(
        [
          { id: 'storage/014-grow-home-lv', transport: 'ssh' },
          { id: 'selinux/019-httpd-alt-port', transport: 'ssh' },
        ],
        'ssh',
      ),
    ).toEqual([])
  })

  it('names every mismatched task, not just the count', () => {
    // Naming them is the whole point: the reader's next move is to split the run
    // into two commands, and a bare count cannot tell them how.
    const lines = transportMismatchWarning(
      [
        { id: 'storage/014-grow-home-lv', transport: 'ssh' },
        { id: 'troubleshooting/028-restore-remote-access', transport: 'vmrun' },
        { id: 'selinux/019-httpd-alt-port', transport: 'ssh' },
      ],
      'vmrun',
    )
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('2 of 3 task(s)')
    expect(lines[0]).toContain('RHCSA_TRANSPORT=ssh')
    expect(lines.slice(1)).toEqual([
      '  storage/014-grow-home-lv declares ssh, running over vmrun',
      '  selinux/019-httpd-alt-port declares ssh, running over vmrun',
    ])
    // The task that got what it asked for is absent, which is what makes the
    // list readable when only one task in a large run is affected.
    expect(lines.join('\n')).not.toContain('028-restore-remote-access')
  })

  it('warns on a vmrun-declaring task running over ssh as well', () => {
    // Not a symmetry for its own sake. `validate` pins vmrun whenever *any* task
    // demands it, so this direction should be unreachable — and a warning is how
    // it announces itself if that pin is ever broken, rather than a fault-injection
    // task quietly breaking the network out from under an ssh run.
    const lines = transportMismatchWarning(
      [{ id: 'troubleshooting/028-restore-remote-access', transport: 'vmrun' }],
      'ssh',
    )
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('RHCSA_TRANSPORT=vmrun')
    expect(lines[1]).toBe(
      '  troubleshooting/028-restore-remote-access declares vmrun, running over ssh',
    )
  })

  it('suggests one transport when the mismatched tasks disagree with each other', () => {
    // A mixed set cannot be fixed by one env var, so the suggestion is necessarily
    // partial. It is sorted rather than "whichever task came first" so the advice
    // is stable across a reordered bank — a warning that changed with directory
    // order would read as a new problem each time.
    const lines = transportMismatchWarning(
      [
        { id: 'b/two', transport: 'vmrun' },
        { id: 'a/one', transport: 'ssh' },
      ],
      'fake',
    )
    expect(lines[0]).toContain('2 of 2 task(s)')
    expect(lines[0]).toContain('RHCSA_TRANSPORT=ssh')
  })
})
