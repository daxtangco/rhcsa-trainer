import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { ExecResult } from '../../src/engine/vm/transport.ts'
import {
  captureLayout,
  makeRunner,
  VmController,
  VmrunTransport,
} from '../../src/engine/vm/vmrun.ts'

const execFileAsync = promisify(execFile)

const CFG = {
  vmx: 'C:\\VMs\\rhcsa-lab\\rhcsa-lab.vmx',
  sshUser: 'student',
  sshPort: 22,
  sshKey: '/home/u/.ssh/rhcsa_lab',
  vmrun: '/vmrun.exe',
}

/** Every vmrun guest operation this transport issues. */
const GUEST_COMMANDS = [
  'copyFileFromHostToGuest',
  'copyFileFromGuestToHost',
  'runProgramInGuest',
  'deleteFileInGuest',
]

const WINDOWS_FORM = /^([A-Za-z]:[\\/]|\\\\)/

/**
 * The inverse of the production `toWindowsPath`: a fake guest is handed the
 * Windows form of a host path and has to write the real file.
 */
async function hostForm(p: string): Promise<string> {
  if (!WINDOWS_FORM.test(p)) return p
  const { stdout } = await execFileAsync('wslpath', ['-u', p])
  return stdout.trim()
}

function recorder(replies: Array<ExecResult | ((args: string[]) => ExecResult)> = []) {
  const calls: string[][] = []
  let i = 0
  const runner = async (_exe: string, args: string[]): Promise<ExecResult> => {
    calls.push(args)
    const reply = replies[i++]
    if (typeof reply === 'function') return reply(args)
    return reply ?? { stdout: '', stderr: '', code: 0 }
  }
  return { runner, calls }
}

/**
 * A fake guest that honours exec()'s capture protocol: asked to copy a capture
 * file out, it writes the marker line plus this guest's output to the host
 * destination, exactly as a real guest running the staged wrapper would have
 * left it. vmrun's own replies stay empty, because that is what real vmrun
 * returns for a guest program's output — nothing.
 *
 * That last part is why the tests need this and not `recorder`. A guest whose
 * output can only arrive through the capture files is the only kind that fails
 * if exec() ever goes back to passing vmrun's own stdout off as the guest's.
 */
function fakeGuest(out: { stdout?: string; stderr?: string; code?: number } = {}) {
  const calls: string[][] = []
  const code = out.code ?? 0
  const runner = async (_exe: string, args: string[]): Promise<ExecResult> => {
    calls.push(args)
    const command = args.find((a) => GUEST_COMMANDS.includes(a))

    if (command === 'copyFileFromGuestToHost') {
      const guestSrc = args.at(-2) ?? ''
      const which = /^\/tmp\/rhcsa-([0-9a-f]+)\.(out|err)$/.exec(guestSrc)
      if (!which)
        return {
          stdout: '',
          stderr: `no such guest file: ${guestSrc}`,
          code: 1,
        }
      const { marker } = captureLayout(which[1] ?? '')
      const text = which[2] === 'out' ? (out.stdout ?? '') : (out.stderr ?? '')
      await writeFile(await hostForm(args.at(-1) ?? ''), `${marker}\n${text}`, 'utf8')
      return { stdout: '', stderr: '', code: 0 }
    }

    // Only the script run reports the guest's status; the cleanup rm is also a
    // runProgramInGuest and must not be given the script's exit code.
    if (command === 'runProgramInGuest' && args.includes('/usr/bin/bash') && code !== 0) {
      // How real vmrun reports a non-zero guest program: it exits 255 itself
      // and says so in prose on its own stdout.
      return {
        stdout: `Error: Guest program exited with non-zero code: ${code}\n`,
        stderr: '',
        code: 255,
      }
    }
    return { stdout: '', stderr: '', code: 0 }
  }
  return { runner, calls }
}

describe('makeRunner / realRunner', () => {
  it('never leaks the guest password into the result, even on failure', async () => {
    const r = await makeRunner()('/bin/false', ['-gp', 'SUPERSECRET', 'x'])
    expect(r.code).not.toBe(0)
    expect(`${r.stdout}${r.stderr}`).not.toContain('SUPERSECRET')
  })

  it('reports a hung command as 124 rather than as a plain failure', async () => {
    const r = await makeRunner({ timeoutMs: 200 })('/bin/sh', ['-c', 'sleep 5'])
    expect(r.code).toBe(124)
    expect(r.stderr).toMatch(/timed out/i)
  })
})

describe('VmrunTransport', () => {
  it('reports its kind', () => {
    const r = recorder()
    expect(new VmrunTransport(CFG, r.runner).kind).toBe('vmrun')
  })

  it('copies the script into the guest, then runs it with bash', async () => {
    const g = fakeGuest({ stdout: 'hello\n' })
    const out = await new VmrunTransport(CFG, g.runner).exec('echo hello')

    expect(out.stdout).toBe('hello\n')
    expect(out.code).toBe(0)

    // The auth flags come first, so the command is not at index 0 — see the
    // ordering test below for why that is not negotiable.
    expect(g.calls[0]).toContain('copyFileFromHostToGuest')
    expect(g.calls[0]).toContain(CFG.vmx)
    // guest destination is under /tmp and unique per exec. Asserted from the
    // end of argv rather than a fixed index, which the auth flags would shift.
    expect(g.calls[0]?.at(-1)).toMatch(/^\/tmp\/rhcsa-[a-z0-9]+\.sh$/)

    expect(g.calls[1]).toContain('runProgramInGuest')
    expect(g.calls[1]).toContain('/usr/bin/bash')
  })

  it('returns the guest program output on both streams, not vmrun own', async () => {
    // The defect this replaced: exec returned vmrun's stdout verbatim. vmrun
    // does not carry the guest program's stdout at all — the guest program
    // inherits vmtoolsd's stdout, so its output goes to the guest journal and
    // never crosses back — so every grader reading command output over this
    // transport was handed vmrun's chatter, or far more often the empty string,
    // and graded against it. The output now has to travel as files.
    const g = fakeGuest({ stdout: 'sda 40G\n', stderr: 'warning: none\n' })
    const out = await new VmrunTransport(CFG, g.runner).exec('lsblk')

    expect(out.stdout).toBe('sda 40G\n')
    expect(out.stderr).toBe('warning: none\n')

    const fetches = g.calls.filter((c) => c.includes('copyFileFromGuestToHost'))
    expect(fetches.map((c) => c.at(-2))).toEqual([
      expect.stringMatching(/^\/tmp\/rhcsa-[0-9a-f]+\.out$/),
      expect.stringMatching(/^\/tmp\/rhcsa-[0-9a-f]+\.err$/),
    ])
  })

  it('keeps vmrun prose out of the result while still reading the exit code from it', async () => {
    const g = fakeGuest({ stdout: '', code: 3 })
    const out = await new VmrunTransport(CFG, g.runner).exec('exit 3')

    expect(out.code).toBe(3)
    expect(out.stdout).toBe('')
    expect(`${out.stdout}${out.stderr}`).not.toMatch(/Guest program/)
  })

  it('tells a command that printed nothing apart from a capture that failed', async () => {
    // Both produce stdout === '', and conflating them is how a broken transport
    // passes for a working one. The marker line the staged wrapper writes ahead
    // of the caller's script is what separates them.
    const quiet = fakeGuest({ stdout: '', stderr: '' })
    const ok = await new VmrunTransport(CFG, quiet.runner).exec('systemctl enable sshd')
    expect(ok.stdout).toBe('')
    expect(ok.stderr).toBe('')
    expect(ok.code).toBe(0)

    // recorder answers every call 0 without ever writing the capture files —
    // which is what a copy-out that silently did nothing looks like.
    const r = recorder()
    const blind = await new VmrunTransport(CFG, r.runner).exec('systemctl enable sshd')
    expect(blind.stdout).toBe('')
    expect(blind.stderr).toMatch(/could not be captured/)
  })

  it('reports a capture that lost its marker instead of calling it empty', async () => {
    // A capture file that exists but does not open with this exec's marker was
    // truncated, written by some other exec, or never written by the wrapper at
    // all. None of those are "the command printed nothing".
    const runner = async (_e: string, args: string[]): Promise<ExecResult> => {
      if (args.includes('copyFileFromGuestToHost')) {
        await writeFile(await hostForm(args.at(-1) ?? ''), 'half an answer\n', 'utf8')
      }
      return { stdout: '', stderr: '', code: 0 }
    }
    const out = await new VmrunTransport(CFG, runner).exec('lsblk')

    expect(out.stdout).toBe('')
    expect(out.stderr).toMatch(/could not be captured/)
    expect(out.stderr).not.toContain('half an answer')
  })

  it('stops with a legible error when the script never reaches the guest', async () => {
    const r = recorder([{ stdout: '', stderr: 'Error: A file was not found\n', code: 4 }])
    const out = await new VmrunTransport(CFG, r.runner).exec('lsblk')

    expect(out.code).toBe(4)
    expect(out.stderr).toMatch(/not found/)
    // Running the script anyway makes bash exit 127 about a missing file, which
    // points the reader at the guest for a copy that never left the host.
    expect(r.calls.some((c) => c.includes('/usr/bin/bash'))).toBe(false)
  })

  it('puts the auth flags before the command, as vmrun requires', async () => {
    // vmrun's own usage: "AUTHENTICATION-FLAGS ... must appear before the
    // command and any command parameters." Violating it does not fail cleanly —
    // real vmrun 1.17.0 prompted for guest credentials on the terminal, then
    // took `-gu` as copyFileFromHostToGuest's host path and reported "The file
    // name is not valid" about a flag. Nothing off a fake transport can catch
    // that, so the ordering is asserted directly.
    const g = fakeGuest()
    await new VmrunTransport(CFG, g.runner).exec('true')

    // Five, not three: staging the script, running it, fetching each captured
    // stream, then one rm for all three guest files.
    expect(g.calls).toHaveLength(5)

    for (const call of g.calls) {
      const command = call.findIndex((a) => GUEST_COMMANDS.includes(a))
      expect(command).toBeGreaterThan(-1)
      expect(call.indexOf('-gu')).toBeLessThan(command)
      expect(call.indexOf('-gp')).toBeLessThan(command)
      // The vmx is a command parameter, so it follows the command too.
      expect(call.indexOf(CFG.vmx)).toBeGreaterThan(command)
    }
  })

  it('hands vmrun a host path Windows can open, in both copy directions', async () => {
    const g = fakeGuest()
    await new VmrunTransport(CFG, g.runner).exec('true')

    // Host side of the copy in: second from the end, with the guest destination
    // last. Host side of each copy out: last, with the guest source before it.
    const hostSides = [
      g.calls[0]?.at(-2),
      ...g.calls.filter((c) => c.includes('copyFileFromGuestToHost')).map((c) => c.at(-1)),
    ]
    expect(hostSides).toHaveLength(3)

    for (const p of hostSides) {
      if (process.env.WSL_DISTRO_NAME) {
        expect(p).toMatch(WINDOWS_FORM)
      } else {
        // Off WSL there is nothing to convert, so the staging paths arrive
        // as-is — and a POSIX path is what a native vmrun wants there anyway.
        expect(p).toMatch(/rhcsa-stage-/)
      }
    }
  })

  it('passes guest credentials on every guest operation', async () => {
    const r = recorder()
    await new VmrunTransport(CFG, r.runner).exec('true')
    for (const call of r.calls) {
      expect(call).toContain('-gu')
      expect(call).toContain('student')
      expect(call).toContain('-gp')
    }
  })

  it('removes the staged script and both capture files even when the guest fails', async () => {
    const g = fakeGuest({ stderr: 'boom\n', code: 1 })
    await new VmrunTransport(CFG, g.runner).exec('false')

    const last = g.calls.at(-1) ?? []
    expect(last).toContain('/usr/bin/rm')
    // One rm for all three, so cleanup costs a single round trip.
    expect(last.filter((a) => a.startsWith('/tmp/rhcsa-'))).toHaveLength(3)
  })

  it('isAvailable is true only when the vmx appears in vmrun list', async () => {
    const listed = recorder([
      { stdout: `Total running VMs: 1\n${CFG.vmx}\n`, stderr: '', code: 0 },
    ])
    expect(await new VmrunTransport(CFG, listed.runner).isAvailable()).toBe(true)

    const other = recorder([
      { stdout: 'Total running VMs: 1\nC:\\VMs\\ubuntu\\ubuntu.vmx\n', stderr: '', code: 0 },
    ])
    expect(await new VmrunTransport(CFG, other.runner).isAvailable()).toBe(false)
  })

  it('isAvailable is false rather than throwing when vmrun is missing', async () => {
    const runner = async () => {
      throw new Error('ENOENT')
    }
    expect(await new VmrunTransport(CFG, runner).isAvailable()).toBe(false)
  })

  it('matches the vmx case-insensitively, because Windows paths vary', async () => {
    const r = recorder([
      { stdout: 'Total running VMs: 1\nc:\\vms\\rhcsa-lab\\RHCSA-LAB.VMX\n', stderr: '', code: 0 },
    ])
    expect(await new VmrunTransport(CFG, r.runner).isAvailable()).toBe(true)
  })
})

describe('VmController', () => {
  it('starts the VM headless-nogui and reverts to a named snapshot', async () => {
    const r = recorder()
    const c = new VmController(CFG, r.runner)

    await c.power()
    expect(r.calls[0]).toEqual(['start', CFG.vmx, 'nogui'])

    await c.revert('clean')
    expect(r.calls[1]).toEqual(['revertToSnapshot', CFG.vmx, 'clean'])
    // Reverting leaves the VM powered off unless it was a live snapshot, so
    // the controller always starts it afterwards.
    expect(r.calls[2]).toEqual(['start', CFG.vmx, 'nogui'])
  })

  it('takes a snapshot and lists snapshots', async () => {
    const r = recorder([
      { stdout: '', stderr: '', code: 0 },
      { stdout: 'Total snapshots: 2\ngolden\nclean\n', stderr: '', code: 0 },
    ])
    const c = new VmController(CFG, r.runner)

    await c.snapshot('clean')
    expect(r.calls[0]).toEqual(['snapshot', CFG.vmx, 'clean'])

    expect(await c.listSnapshots()).toEqual(['golden', 'clean'])
  })

  it('stops the VM softly so filesystems flush', async () => {
    const r = recorder()
    await new VmController(CFG, r.runner).stop()
    expect(r.calls[0]).toEqual(['stop', CFG.vmx, 'soft'])
  })

  it('reboot polls until the guest answers, rather than sleeping once', async () => {
    let probes = 0
    const runner = async (_e: string, args: string[]): Promise<ExecResult> => {
      // Keyed on the interpreter, not on `runProgramInGuest`: exec's cleanup rm
      // is a runProgramInGuest too, so counting those would count two per exec
      // and this test would pass without the loop it exists to prove. And not
      // args[0] either — the guest auth flags precede the command in argv.
      if (args.includes('/usr/bin/bash')) {
        probes += 1
        // Probe 1 is consumed by reboot's own reboot command. Probe 2 is
        // waitForGuest's first attempt and must fail, so that reaching probe 3
        // proves it looped instead of accepting the first answer.
        return probes <= 2
          ? { stdout: '', stderr: 'not connected', code: 255 }
          : { stdout: 'up\n', stderr: '', code: 0 }
      }
      return { stdout: '', stderr: '', code: 0 }
    }
    const c = new VmController(CFG, runner, { pollMs: 1, timeoutMs: 5000 })
    await c.reboot()
    expect(probes).toBe(3)
  })

  it('reboot throws a legible error when the guest never returns', async () => {
    const runner = async (): Promise<ExecResult> => ({ stdout: '', stderr: 'down', code: 255 })
    const c = new VmController(CFG, runner, { pollMs: 1, timeoutMs: 30 })
    await expect(c.reboot()).rejects.toThrow(/guest did not come back within 30ms/)
  })

  it('surfaces a host-side failure instead of waiting out the guest timeout', async () => {
    const runner = async () => {
      throw new Error('ENOENT: vmrun.exe')
    }
    const c = new VmController(CFG, runner, { pollMs: 1, timeoutMs: 30 })
    await expect(c.reboot()).rejects.toThrow(/ENOENT/)
  })
})
