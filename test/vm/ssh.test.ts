import { describe, expect, it } from 'vitest'
import type { ExecResult } from '../../src/engine/vm/transport.ts'
import { SshTransport, makeSshRunner } from '../../src/engine/vm/ssh.ts'

const CFG = {
  ip: '192.168.226.128',
  sshUser: 'student',
  sshPort: 22,
  sshKey: '/home/u/.ssh/rhcsa_lab',
}

function recorder(reply: ExecResult = { stdout: '', stderr: '', code: 0 }) {
  const calls: Array<{ exe: string; args: string[]; stdin?: string }> = []
  const runner = async (exe: string, args: string[], stdin?: string): Promise<ExecResult> => {
    calls.push({ exe, args, stdin })
    return reply
  }
  return { runner, calls }
}

describe('SshTransport', () => {
  it('reports its kind', () => {
    expect(new SshTransport(CFG, recorder().runner).kind).toBe('ssh')
  })

  it('sends the script on stdin, never as an argv argument', async () => {
    // Passing a multi-line script through argv is how quoting bugs get into
    // graders. stdin has no quoting rules at all.
    const r = recorder()
    const script = "set -euo pipefail\necho 'it$works'\n"
    await new SshTransport(CFG, r.runner).exec(script)

    expect(r.calls[0]?.stdin).toBe(script)
    expect(r.calls[0]?.args.join(' ')).not.toContain('it$works')
    expect(r.calls[0]?.args.at(-1)).toBe('bash -s')
  })

  it('pins the SSH options that keep a grader from hanging', async () => {
    const r = recorder()
    await new SshTransport(CFG, r.runner).exec('true')
    const args = r.calls[0]?.args.join(' ') ?? ''

    expect(args).toContain('BatchMode=yes')
    expect(args).toContain('StrictHostKeyChecking=accept-new')
    expect(args).toContain('ConnectTimeout=10')
    // A dedicated known_hosts file, so a rebuilt VM's changed key is confined
    // to a throwaway file rather than the user's real known_hosts.
    expect(args).toMatch(/UserKnownHostsFile=\S*rhcsa/)
    expect(args).toContain('-i /home/u/.ssh/rhcsa_lab')
    expect(args).toContain('-p 22')
    expect(args).toContain('student@192.168.226.128')
  })

  it('honours a non-default port, for the R1 port-forward fallback', async () => {
    const r = recorder()
    await new SshTransport({ ...CFG, ip: '127.0.0.1', sshPort: 2222 }, r.runner).exec('true')
    const args = r.calls[0]?.args.join(' ') ?? ''
    expect(args).toContain('-p 2222')
    expect(args).toContain('student@127.0.0.1')
  })

  it('returns the remote exit code and both streams verbatim', async () => {
    const r = recorder({ stdout: 'out', stderr: 'err', code: 7 })
    const out = await new SshTransport(CFG, r.runner).exec('exit 7')
    expect(out).toEqual({ stdout: 'out', stderr: 'err', code: 7 })
  })

  it('isAvailable is true when a probe command succeeds', async () => {
    const r = recorder({ stdout: 'rhcsa-probe\n', stderr: '', code: 0 })
    expect(await new SshTransport(CFG, r.runner).isAvailable()).toBe(true)
  })

  it('isAvailable is false when ssh exits 0 but the script never ran', async () => {
    // A guest-side ForceCommand, or a shell that swallows stdin: connection
    // fine, script never executed. This must not count as available.
    const r = recorder({ stdout: 'Last login: …\n', stderr: '', code: 0 })
    expect(await new SshTransport(CFG, r.runner).isAvailable()).toBe(false)
  })

  it('isAvailable is false when the probe fails or throws', async () => {
    expect(
      await new SshTransport(CFG, recorder({ stdout: '', stderr: 'refused', code: 255 }).runner).isAvailable(),
    ).toBe(false)

    const thrower = async () => {
      throw new Error('ENOENT: ssh not installed')
    }
    expect(await new SshTransport(CFG, thrower).isAvailable()).toBe(false)
  })

  it('isAvailable is false with no IP, without attempting a connection', async () => {
    const r = recorder()
    const t = new SshTransport({ ...CFG, ip: undefined }, r.runner)
    expect(await t.isAvailable()).toBe(false)
    expect(r.calls).toHaveLength(0)
  })

  it('exec throws a legible error with no IP', async () => {
    const t = new SshTransport({ ...CFG, ip: undefined }, recorder().runner)
    await expect(t.exec('true')).rejects.toThrow(/no IP/)
  })
})

describe('makeSshRunner / realSshRunner', () => {
  // The mocked tests above prove SshTransport hands the script to its
  // runner's third parameter. Only this one proves the real runner actually
  // writes it to the child's stdin, rather than dropping it silently.
  it('the real runner delivers the script on the child stdin, not argv', async () => {
    const r = await makeSshRunner()('/bin/cat', [], 'hello-from-stdin\n')
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('hello-from-stdin\n')
  })

  it('reports a hung command as 124 rather than as a plain failure', async () => {
    const r = await makeSshRunner({ timeoutMs: 200 })('/bin/sh', ['-c', 'sleep 5'])
    expect(r.code).toBe(124)
    expect(r.stderr).toMatch(/timed out/i)
  })
})
