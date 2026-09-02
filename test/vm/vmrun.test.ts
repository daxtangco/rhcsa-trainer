import { describe, expect, it } from 'vitest'
import type { ExecResult } from '../../src/engine/vm/transport.ts'
import { VmController, VmrunTransport, makeRunner } from '../../src/engine/vm/vmrun.ts'

const CFG = {
  vmx: 'C:\\VMs\\rhcsa-lab\\rhcsa-lab.vmx',
  sshUser: 'student',
  sshPort: 22,
  sshKey: '/home/u/.ssh/rhcsa_lab',
  vmrun: '/vmrun.exe',
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
    const r = recorder([
      { stdout: '', stderr: '', code: 0 }, // copyFileFromHostToGuest
      { stdout: 'hello\n', stderr: '', code: 0 }, // runProgramInGuest
      { stdout: '', stderr: '', code: 0 }, // cleanup
    ])
    const t = new VmrunTransport(CFG, r.runner)
    const out = await t.exec('echo hello')

    expect(out.stdout).toBe('hello\n')
    expect(out.code).toBe(0)

    // The auth flags come first, so the command is not at index 0 — see the
    // ordering test below for why that is not negotiable.
    expect(r.calls[0]).toContain('copyFileFromHostToGuest')
    expect(r.calls[0]).toContain(CFG.vmx)
    // guest destination is under /tmp and unique per exec. Asserted from the
    // end of argv rather than a fixed index, which the auth flags would shift.
    expect(r.calls[0]?.at(-1)).toMatch(/^\/tmp\/rhcsa-[a-z0-9]+\.sh$/)

    expect(r.calls[1]).toContain('runProgramInGuest')
    expect(r.calls[1]).toContain('/usr/bin/bash')
  })

  it('puts the auth flags before the command, as vmrun requires', async () => {
    // vmrun's own usage: "AUTHENTICATION-FLAGS ... must appear before the
    // command and any command parameters." Violating it does not fail cleanly —
    // real vmrun 1.17.0 prompted for guest credentials on the terminal, then
    // took `-gu` as copyFileFromHostToGuest's host path and reported "The file
    // name is not valid" about a flag. Nothing off a fake transport can catch
    // that, so the ordering is asserted directly.
    const r = recorder()
    await new VmrunTransport(CFG, r.runner).exec('true')

    const GUEST_COMMANDS = ['copyFileFromHostToGuest', 'runProgramInGuest', 'deleteFileInGuest']
    expect(r.calls).toHaveLength(3)

    for (const call of r.calls) {
      const command = call.findIndex((a) => GUEST_COMMANDS.includes(a))
      expect(command).toBeGreaterThan(-1)
      expect(call.indexOf('-gu')).toBeLessThan(command)
      expect(call.indexOf('-gp')).toBeLessThan(command)
      // The vmx is a command parameter, so it follows the command too.
      expect(call.indexOf(CFG.vmx)).toBeGreaterThan(command)
    }
  })

  it('hands vmrun a host path Windows can open, not the raw staging path', async () => {
    const r = recorder()
    await new VmrunTransport(CFG, r.runner).exec('true')
    // Second from the end: the host source, with the guest destination last.
    const staged = r.calls[0]?.at(-2)

    if (process.env.WSL_DISTRO_NAME) {
      expect(staged).toMatch(/^([A-Za-z]:\\|\\\\)/)
    } else {
      // Off WSL there is nothing to convert, so the staging path arrives as-is.
      expect(staged).toMatch(/script\.sh$/)
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

  it('extracts the guest exit code that vmrun reports on stdout', async () => {
    // vmrun itself exits non-zero here, but the number that matters is the
    // guest program's.
    const r = recorder([
      { stdout: '', stderr: '', code: 0 },
      {
        stdout: 'Error: Guest program exited with non-zero code: 3\n',
        stderr: '',
        code: 255,
      },
      { stdout: '', stderr: '', code: 0 },
    ])
    const out = await new VmrunTransport(CFG, r.runner).exec('exit 3')
    expect(out.code).toBe(3)
  })

  it('removes the staged script even when the guest program fails', async () => {
    const r = recorder([
      { stdout: '', stderr: '', code: 0 },
      { stdout: '', stderr: 'boom', code: 1 },
      { stdout: '', stderr: '', code: 0 },
    ])
    await new VmrunTransport(CFG, r.runner).exec('false')
    const last = r.calls.at(-1)
    expect(last).toContain('deleteFileInGuest')
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
      // Not args[0]: the guest auth flags precede the command in vmrun's argv.
      if (args.includes('runProgramInGuest')) {
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
