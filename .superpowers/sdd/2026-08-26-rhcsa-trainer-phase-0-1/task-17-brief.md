### Task 17: `VmrunTransport` and VM lifecycle

The fallback transport and the snapshot machinery. `runProgramInGuest` works with no guest networking at all, which is exactly what troubleshooting tasks need — they break networking on purpose.

**Files:**
- Create: `src/engine/vm/vmrun.ts`
- Create: `src/engine/vm/config.ts`
- Test: `test/vm/config.test.ts`, `test/vm/vmrun.test.ts`

**Interfaces:**
- Consumes: `LabTransport`, `ExecResult`, `TransportKind` (T2).
- Produces:
  - `interface VmConfig { vmx: string; ip?: string; sshUser: string; sshPort: number; sshKey: string; vmrun: string; forceTransport?: TransportKind }`
  - `interface VmrunConfigSlice` — the exported subset of `VmConfig` that `VmrunTransport` and `VmController` actually read. Task 18 must satisfy it structurally.
  - `function loadVmConfig(env: Record<string, string | undefined>): VmConfig`
  - `type Runner = (exe: string, args: string[]) => Promise<ExecResult>` — the single injection seam; the real one wraps `execFile`
  - `class VmrunTransport implements LabTransport` — `kind = 'vmrun'`
  - `class VmController` — `power()`, `stop()`, `snapshot(name)`, `revert(name)`, `listSnapshots()`, `reboot()`, `waitForGuest()`

**Design notes.**
- `runProgramInGuest` cannot pipe stdin, so a script is delivered by writing it to a host temp file, `copyFileFromHostToGuest`, then running `bash /tmp/<name>`. Three round trips per exec — slow, which is why SSH is preferred, but it is the only path that survives broken networking.
- `vmrun` exit codes are unreliable; `VmrunTransport` reports the **guest program's** exit code, which `runProgramInGuest` surfaces on stdout as `Guest program exited with non-zero code: N`.
- `reboot()` polls `waitForGuest()` rather than sleeping a fixed interval, with a 120 s ceiling.

- [ ] **Step 1: Write the failing config test**

`test/vm/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { loadVmConfig } from '../../src/engine/vm/config.ts'

describe('loadVmConfig', () => {
  it('applies documented defaults', () => {
    const c = loadVmConfig({ RHCSA_VMX: 'C:\\VMs\\rhcsa-lab\\rhcsa-lab.vmx' })
    expect(c.vmx).toBe('C:\\VMs\\rhcsa-lab\\rhcsa-lab.vmx')
    expect(c.sshUser).toBe('student')
    expect(c.sshPort).toBe(22)
    expect(c.sshKey).toMatch(/\.ssh\/rhcsa_lab$/)
    expect(c.vmrun).toBe('/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe')
    expect(c.forceTransport).toBeUndefined()
  })

  it('honours overrides, including the R1 port-forward fallback', () => {
    const c = loadVmConfig({
      RHCSA_VMX: 'x.vmx',
      RHCSA_VM_IP: '127.0.0.1',
      RHCSA_SSH_PORT: '2222',
      RHCSA_SSH_USER: 'lab',
      RHCSA_TRANSPORT: 'vmrun',
    })
    expect(c.ip).toBe('127.0.0.1')
    expect(c.sshPort).toBe(2222)
    expect(c.sshUser).toBe('lab')
    expect(c.forceTransport).toBe('vmrun')
  })

  it('throws when RHCSA_VMX is missing, naming the file that sets it', () => {
    expect(() => loadVmConfig({})).toThrow(/RHCSA_VMX/)
    expect(() => loadVmConfig({})).toThrow(/\.env\.local/)
  })

  it('rejects an unknown forced transport rather than silently ignoring it', () => {
    expect(() => loadVmConfig({ RHCSA_VMX: 'x', RHCSA_TRANSPORT: 'telepathy' })).toThrow(
      /RHCSA_TRANSPORT/,
    )
  })

  it('rejects a non-numeric port', () => {
    expect(() => loadVmConfig({ RHCSA_VMX: 'x', RHCSA_SSH_PORT: 'ssh' })).toThrow(/RHCSA_SSH_PORT/)
  })
})
```

- [ ] **Step 2: Write the failing transport test**

`test/vm/vmrun.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ExecResult } from '../../src/engine/vm/transport.ts'
import { VmController, VmrunTransport } from '../../src/engine/vm/vmrun.ts'

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

    expect(r.calls[0]?.[0]).toBe('copyFileFromHostToGuest')
    expect(r.calls[0]?.[1]).toBe(CFG.vmx)
    // guest destination is under /tmp and unique per exec. Asserted from the
    // end of argv, not index 3: the guest auth flags sit in between, so the
    // fixed index would land on the username.
    expect(r.calls[0]?.at(-1)).toMatch(/^\/tmp\/rhcsa-[a-z0-9]+\.sh$/)

    expect(r.calls[1]?.[0]).toBe('runProgramInGuest')
    expect(r.calls[1]).toContain('/usr/bin/bash')
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
    expect(last?.[0]).toBe('deleteFileInGuest')
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

  it('reboot waits for the guest to come back and does not sleep blindly', async () => {
    let probes = 0
    const runner = async (_e: string, args: string[]): Promise<ExecResult> => {
      if (args[0] === 'runProgramInGuest' || args[0] === 'copyFileFromHostToGuest') {
        probes += 1
        // Unreachable for the first two probes, then up.
        return probes <= 2
          ? { stdout: '', stderr: 'not connected', code: 255 }
          : { stdout: 'up\n', stderr: '', code: 0 }
      }
      return { stdout: '', stderr: '', code: 0 }
    }
    const c = new VmController(CFG, runner, { pollMs: 1, timeoutMs: 5000 })
    await c.reboot()
    expect(probes).toBeGreaterThan(2)
  })

  it('reboot throws a legible error when the guest never returns', async () => {
    const runner = async (): Promise<ExecResult> => ({ stdout: '', stderr: 'down', code: 255 })
    const c = new VmController(CFG, runner, { pollMs: 1, timeoutMs: 30 })
    await expect(c.reboot()).rejects.toThrow(/guest did not come back within 30ms/)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/vm/`
Expected: FAIL — `Cannot find module '../../src/engine/vm/vmrun.ts'` and `.../config.ts`.

- [ ] **Step 4: Write `src/engine/vm/config.ts`**

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { TransportKind } from './transport.ts'

export interface VmConfig {
  vmx: string
  ip?: string
  sshUser: string
  sshPort: number
  sshKey: string
  vmrun: string
  /** Set by RHCSA_TRANSPORT to skip probing, or by a task that needs vmrun. */
  forceTransport?: TransportKind
}

const DEFAULT_VMRUN = '/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe'
const KINDS: readonly string[] = ['ssh', 'vmrun', 'fake']

export function loadVmConfig(env: Record<string, string | undefined>): VmConfig {
  const vmx = env.RHCSA_VMX
  if (!vmx) {
    throw new Error(
      'RHCSA_VMX is not set. Put it in .env.local at the repo root, as described ' +
        'in docs/vm-build-checklist.md section 6.',
    )
  }

  const portRaw = env.RHCSA_SSH_PORT ?? '22'
  const sshPort = Number(portRaw)
  if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) {
    throw new Error(`RHCSA_SSH_PORT must be a port number, got ${JSON.stringify(portRaw)}`)
  }

  const forced = env.RHCSA_TRANSPORT
  if (forced !== undefined && !KINDS.includes(forced)) {
    throw new Error(`RHCSA_TRANSPORT must be one of ${KINDS.join(', ')}, got ${JSON.stringify(forced)}`)
  }

  return {
    vmx,
    ip: env.RHCSA_VM_IP,
    sshUser: env.RHCSA_SSH_USER ?? 'student',
    sshPort,
    sshKey: env.RHCSA_SSH_KEY ?? join(homedir(), '.ssh', 'rhcsa_lab'),
    vmrun: env.RHCSA_VMRUN ?? DEFAULT_VMRUN,
    forceTransport: forced as TransportKind | undefined,
  }
}
```

- [ ] **Step 5: Write `src/engine/vm/vmrun.ts`**

```ts
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ExecResult, LabTransport, TransportKind } from './transport.ts'

const execFileAsync = promisify(execFile)

/** The single seam that keeps every test off the real hypervisor. */
export type Runner = (exe: string, args: string[]) => Promise<ExecResult>

/** vmrun reports the guest program's exit status in prose on stdout. */
const GUEST_CODE_RE = /Guest program exited with non-zero code:\s*(\d+)/

export const realRunner: Runner = async (exe, args) => {
  try {
    const { stdout, stderr } = await execFileAsync(exe, args, { maxBuffer: 32 * 1024 * 1024 })
    return { stdout, stderr, code: 0 }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number; message?: string }
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? '',
      code: typeof err.code === 'number' ? err.code : 1,
    }
  }
}

/** Fields VmrunTransport actually needs, so tests can pass a literal. */
export interface VmrunConfigSlice {
  vmx: string
  vmrun: string
  sshUser: string
}

function guestAuth(cfg: VmrunConfigSlice): string[] {
  // The guest password is only ever read from the environment, never stored in
  // the repo. Guest ops fail with a clear vmrun error if it is unset.
  return ['-gu', cfg.sshUser, '-gp', process.env.RHCSA_GUEST_PASSWORD ?? '']
}

let counter = 0
function guestScriptPath(): string {
  // Unique per exec so concurrent grading cannot clobber a staged script.
  counter += 1
  const tag = `${counter.toString(36)}${(counter * 7919).toString(36)}`
  return `/tmp/rhcsa-${tag}.sh`
}

/**
 * Runs scripts through `vmrun runProgramInGuest`.
 *
 * Slower than SSH — three vmrun round trips per exec — but it needs no guest
 * networking, which is what makes fault-injection tasks gradeable.
 */
export class VmrunTransport implements LabTransport {
  readonly kind: TransportKind = 'vmrun'
  #cfg: VmrunConfigSlice
  #run: Runner

  constructor(cfg: VmrunConfigSlice, run: Runner = realRunner) {
    this.#cfg = cfg
    this.#run = run
  }

  async exec(script: string): Promise<ExecResult> {
    const dir = await mkdtemp(join(tmpdir(), 'rhcsa-stage-'))
    const hostPath = join(dir, 'script.sh')
    const guestPath = guestScriptPath()
    await writeFile(hostPath, script, 'utf8')

    try {
      const auth = guestAuth(this.#cfg)

      await this.#run(this.#cfg.vmrun, [
        'copyFileFromHostToGuest',
        this.#cfg.vmx,
        ...auth,
        hostPath,
        guestPath,
      ])

      const result = await this.#run(this.#cfg.vmrun, [
        'runProgramInGuest',
        this.#cfg.vmx,
        ...auth,
        // No -noWait / -activeWindow / -interactive: those are bare presence
        // flags, not `=false` assignments, and blocking until the guest program
        // exits is already vmrun's default. Passing them as `flag=false` is a
        // syntax error, not a no-op.
        '/usr/bin/bash',
        guestPath,
      ])

      const reported = GUEST_CODE_RE.exec(`${result.stdout}\n${result.stderr}`)
      const code = reported ? Number(reported[1]) : result.code

      return { stdout: result.stdout, stderr: result.stderr, code }
    } finally {
      // Best effort: a leftover /tmp script is harmless, a thrown cleanup
      // error would mask the real result.
      await this.#run(this.#cfg.vmrun, [
        'deleteFileInGuest',
        this.#cfg.vmx,
        ...guestAuth(this.#cfg),
        guestPath,
      ]).catch(() => undefined)
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { stdout } = await this.#run(this.#cfg.vmrun, ['list'])
      const want = this.#cfg.vmx.toLowerCase()
      return stdout
        .split('\n')
        .map((l) => l.trim().toLowerCase())
        .includes(want)
    } catch {
      return false
    }
  }
}

export interface VmControllerOptions {
  pollMs?: number
  timeoutMs?: number
}

/**
 * Power, snapshot and reboot control. Separate from the transport because
 * lifecycle is not exec — a transport that can run a command says nothing
 * about whether we may revert the disk underneath it.
 */
export class VmController {
  #cfg: VmrunConfigSlice
  #run: Runner
  #pollMs: number
  #timeoutMs: number

  constructor(cfg: VmrunConfigSlice, run: Runner = realRunner, opts: VmControllerOptions = {}) {
    this.#cfg = cfg
    this.#run = run
    this.#pollMs = opts.pollMs ?? 2000
    this.#timeoutMs = opts.timeoutMs ?? 120_000
  }

  async power(): Promise<void> {
    await this.#run(this.#cfg.vmrun, ['start', this.#cfg.vmx, 'nogui'])
  }

  async stop(): Promise<void> {
    // soft = ACPI shutdown, so filesystems flush. hard would corrupt the
    // very persistence the graders check.
    await this.#run(this.#cfg.vmrun, ['stop', this.#cfg.vmx, 'soft'])
  }

  async snapshot(name: string): Promise<void> {
    await this.#run(this.#cfg.vmrun, ['snapshot', this.#cfg.vmx, name])
  }

  async revert(name: string): Promise<void> {
    await this.#run(this.#cfg.vmrun, ['revertToSnapshot', this.#cfg.vmx, name])
    // A live snapshot resumes running; a powered-off one does not. start is
    // idempotent, so call it either way.
    await this.power()
  }

  async listSnapshots(): Promise<string[]> {
    const { stdout } = await this.#run(this.#cfg.vmrun, ['listSnapshots', this.#cfg.vmx])
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !/^Total snapshots:/i.test(l))
  }

  /** True when a trivial command runs in the guest. */
  async guestUp(): Promise<boolean> {
    const t = new VmrunTransport(this.#cfg, this.#run)
    try {
      const r = await t.exec('echo up')
      return r.code === 0
    } catch {
      return false
    }
  }

  async waitForGuest(): Promise<void> {
    const deadline = Date.now() + this.#timeoutMs
    for (;;) {
      if (await this.guestUp()) return
      if (Date.now() >= deadline) {
        throw new Error(`guest did not come back within ${this.#timeoutMs}ms`)
      }
      await new Promise((r) => setTimeout(r, this.#pollMs))
    }
  }

  /**
   * Reboot and block until the guest answers again.
   *
   * `systemctl reboot` kills the connection mid-command, so a non-zero result
   * here is expected and ignored; waitForGuest is the real assertion.
   */
  async reboot(): Promise<void> {
    const t = new VmrunTransport(this.#cfg, this.#run)
    await t.exec('sudo systemctl reboot || sudo reboot').catch(() => undefined)
    // Give the machine a moment to actually go down, or the first probe can
    // succeed against the still-running pre-reboot system.
    await new Promise((r) => setTimeout(r, this.#pollMs))
    await this.waitForGuest()
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 5 config tests + 13 vmrun tests PASS; typecheck clean.

If the "reboot waits" test hangs, the `pollMs: 1` injection is not being honoured — check that `VmController` passes its own runner into the `VmrunTransport` it constructs, otherwise the probe hits the real `vmrun`.

- [ ] **Step 7: ACCEPTANCE (deferred until the VM exists)**

With `rhcsa-lab` built and running, and `RHCSA_GUEST_PASSWORD` exported in the shell:

```bash
cd /home/daxtangco/rhcsa-trainer
node --input-type=module -e "
import { loadVmConfig } from './src/engine/vm/config.ts'
import { VmController, VmrunTransport } from './src/engine/vm/vmrun.ts'
const cfg = loadVmConfig(process.env)
const t = new VmrunTransport(cfg)
console.log('available:', await t.isAvailable())
console.log(await t.exec('hostname; id -un; getenforce'))
console.log('snapshots:', await new VmController(cfg).listSnapshots())
"
```

Expected: `available: true`; the guest hostname, `student`, and `Enforcing`; and a snapshot list containing `golden`.

- [ ] **Step 8: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/vm test/vm && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(vm): VmrunTransport and VM lifecycle control

A single injected Runner keeps every test off the hypervisor. The guest exit
code is parsed out of vmrun's prose because vmrun's own exit status is not
trustworthy. reboot polls for the guest instead of sleeping, and stop is soft
so filesystems flush - a hard stop would corrupt the persistence the graders
are there to check."
```

---

