### Task 18: `SshTransport` and transport selection

The primary transport, plus the selector that makes the dual control plane automatic.

**Files:**
- Create: `src/engine/vm/ssh.ts`
- Create: `src/engine/vm/select.ts`
- Test: `test/vm/ssh.test.ts`, `test/vm/select.test.ts`

**Interfaces:**
- Consumes: `LabTransport`, `ExecResult` (T2); `VmConfig`, `VmrunTransport` (T17). Note it does **not** consume `Runner` or `realRunner`: `ssh.ts` spawns `ssh` itself and `select.ts` imports neither.
- Produces:
  - `class SshTransport implements LabTransport` — `kind = 'ssh'`
  - `class NoTransportError extends Error`
  - `function chooseTransport(cfg: VmConfig, opts?: ChooseOptions): Promise<LabTransport>`
  - `interface ChooseOptions { ssh?: LabTransport; vmrun?: LabTransport; require?: TransportKind }`

**Design notes.**
- The script goes to `ssh` on **stdin**, not as an argv argument. Quoting a multi-line bash script through argv is the classic source of grading bugs where a `$` or a newline changes meaning.
- SSH options are pinned: `BatchMode=yes` (never prompt — a hung prompt looks like a hung grader), `StrictHostKeyChecking=accept-new`, and a dedicated `UserKnownHostsFile` so reverting snapshots does not trip host-key warnings on the user's real `known_hosts`.
- **`BatchMode=yes` is correct rather than accidentally correct, and it stays.** With `/etc/sudoers.d/rhcsa-trainer` in place (see the Global Constraints and Task 19), the guest never has a legitimate reason to prompt for anything. So any password prompt means the drop-in is missing, and `BatchMode` turns that into a fast, clean, diagnosable failure instead of a hang that looks like a slow grader.
- `chooseTransport` probes with a **3 s** ceiling. A task can pin `require: 'vmrun'` — that is how fault-injection tasks stay gradeable after they break networking.

- [ ] **Step 1: Write the failing SSH test**

`test/vm/ssh.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ExecResult } from '../../src/engine/vm/transport.ts'
import { SshTransport } from '../../src/engine/vm/ssh.ts'

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
    // A dedicated known_hosts file, so snapshot reverts never touch the user's.
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
    const r = recorder({ stdout: 'ok\n', stderr: '', code: 0 })
    expect(await new SshTransport(CFG, r.runner).isAvailable()).toBe(true)
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
```

- [ ] **Step 2: Write the failing selection test**

`test/vm/select.test.ts`:

```ts
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
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/vm/ssh.test.ts test/vm/select.test.ts`
Expected: FAIL — both modules missing.

- [ ] **Step 4: Write `src/engine/vm/ssh.ts`**

```ts
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ExecResult, LabTransport, TransportKind } from './transport.ts'

/** Like Runner, but with stdin — the reason SSH gets its own seam. */
export type SshRunner = (exe: string, args: string[], stdin?: string) => Promise<ExecResult>

export const realSshRunner: SshRunner = (exe, args, stdin) =>
  new Promise((resolve) => {
    const child = execFile(
      exe,
      args,
      { maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === 'number'
            ? (err as { code: number }).code
            : err
              ? 1
              : 0
        resolve({ stdout, stderr, code })
      },
    )
    if (stdin !== undefined) {
      child.stdin?.end(stdin)
    }
  })

export interface SshConfigSlice {
  ip?: string
  sshUser: string
  sshPort: number
  sshKey: string
}

/** Separate from the user's known_hosts: snapshot reverts change host keys. */
const KNOWN_HOSTS = join(homedir(), '.ssh', 'rhcsa_known_hosts')

export class SshTransport implements LabTransport {
  readonly kind: TransportKind = 'ssh'
  #cfg: SshConfigSlice
  #run: SshRunner

  constructor(cfg: SshConfigSlice, run: SshRunner = realSshRunner) {
    this.#cfg = cfg
    this.#run = run
  }

  #args(): string[] {
    if (!this.#cfg.ip) {
      throw new Error(
        'SshTransport has no IP. Set RHCSA_VM_IP in .env.local, or let the vmrun ' +
          'transport handle it.',
      )
    }
    return [
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      `UserKnownHostsFile=${KNOWN_HOSTS}`,
      '-o',
      'ConnectTimeout=10',
      '-o',
      'LogLevel=ERROR',
      '-i',
      this.#cfg.sshKey,
      '-p',
      String(this.#cfg.sshPort),
      `${this.#cfg.sshUser}@${this.#cfg.ip}`,
      // Read the script from stdin, so nothing about it is ever quoted.
      'bash -s',
    ]
  }

  async exec(script: string): Promise<ExecResult> {
    return await this.#run('ssh', this.#args(), script)
  }

  async isAvailable(): Promise<boolean> {
    if (!this.#cfg.ip) return false
    try {
      const r = await this.#run('ssh', this.#args(), 'echo rhcsa-probe\n')
      return r.code === 0
    } catch {
      return false
    }
  }
}
```

Note: `ConnectTimeout=10` is SSH's own ceiling for the connect phase. The 3 s probe ceiling in `chooseTransport` is separate and shorter — it bounds how long *selection* may take, so a dead network does not stall the UI.

- [ ] **Step 5: Write `src/engine/vm/select.ts`**

```ts
import type { VmConfig } from './config.ts'
import { SshTransport } from './ssh.ts'
import type { LabTransport, TransportKind } from './transport.ts'
import { VmrunTransport } from './vmrun.ts'

export class NoTransportError extends Error {
  readonly attempted: TransportKind[]

  constructor(attempted: TransportKind[]) {
    super(
      `no usable transport to the lab VM (tried: ${attempted.join(', ')}).\n` +
        '  - is the VM running?   vmrun.exe list\n' +
        '  - is vmtoolsd running in the guest?\n' +
        '  - for ssh, check RHCSA_VM_IP and that the key in RHCSA_SSH_KEY is authorized\n' +
        '  - see docs/vm-build-checklist.md and docs/r1-findings.md',
    )
    this.name = 'NoTransportError'
    this.attempted = attempted
  }
}

export interface ChooseOptions {
  /** Injected in tests; constructed from cfg otherwise. */
  ssh?: LabTransport
  vmrun?: LabTransport
  /**
   * Pin a transport. Set from a task's `transport:` field — fault-injection
   * tasks require vmrun because they deliberately break networking.
   */
  require?: TransportKind
  probeTimeoutMs?: number
}

/** Bound how long selection may take, independent of SSH's own ConnectTimeout. */
const PROBE_TIMEOUT_MS = 3000

async function availableWithin(t: LabTransport, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  try {
    return await Promise.race([t.isAvailable(), timeout])
  } catch {
    return false
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * SSH when it works, vmrun when it does not.
 *
 * `require` wins over `cfg.forceTransport`: the environment states a
 * preference, a task states a requirement.
 */
export async function chooseTransport(
  cfg: VmConfig,
  opts: ChooseOptions = {},
): Promise<LabTransport> {
  const ms = opts.probeTimeoutMs ?? PROBE_TIMEOUT_MS
  const ssh = opts.ssh ?? new SshTransport(cfg)
  const vmrun = opts.vmrun ?? new VmrunTransport(cfg)

  const pinned = opts.require ?? cfg.forceTransport
  if (pinned === 'ssh' || pinned === 'vmrun') {
    const t = pinned === 'ssh' ? ssh : vmrun
    if (await availableWithin(t, ms)) return t
    throw new NoTransportError([pinned])
  }

  if (await availableWithin(ssh, ms)) return ssh
  if (await availableWithin(vmrun, ms)) return vmrun
  throw new NoTransportError(['ssh', 'vmrun'])
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck`
Expected: 9 ssh tests + 7 select tests PASS; typecheck clean.

- [ ] **Step 7: ACCEPTANCE (deferred until the VM exists)**

Depends on Task 19 having installed the key. With the VM running:

```bash
cd /home/daxtangco/rhcsa-trainer
node --input-type=module -e "
import { loadVmConfig } from './src/engine/vm/config.ts'
import { chooseTransport } from './src/engine/vm/select.ts'
const t = await chooseTransport(loadVmConfig(process.env))
console.log('chose:', t.kind)
console.log((await t.exec('hostnamectl --static; findmnt -no SOURCE /var')).stdout)
"
```

Expected: `chose: ssh` (or `vmrun` if R1 was unresolved — both are correct outcomes), then the hostname and `/dev/mapper/rhel-var`.

Then prove the fallback for real, which is the claim that matters:

```bash
# From the VM console, not over SSH - this deliberately cuts the connection:
#   sudo systemctl stop sshd
# Then, back in WSL:
node --input-type=module -e "
import { loadVmConfig } from './src/engine/vm/config.ts'
import { chooseTransport } from './src/engine/vm/select.ts'
const t = await chooseTransport(loadVmConfig(process.env))
console.log('chose:', t.kind)   // must be vmrun
console.log((await t.exec('systemctl is-active sshd')).stdout)
"
# Then restore it from the console: sudo systemctl start sshd
```

Expected: `chose: vmrun`, and `inactive`. If this step does not produce `vmrun`, the dual control plane is not real and the troubleshooting task family in Phase 2 cannot be built — stop and fix it here.

- [ ] **Step 8: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add src/engine/vm/ssh.ts src/engine/vm/select.ts test/vm && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(vm): SshTransport and automatic transport selection

Scripts go over stdin as 'bash -s', so nothing in a grader is ever quoted
through argv. BatchMode=yes means a missing key fails instead of hanging on a
prompt, and a dedicated known_hosts file keeps snapshot reverts from tripping
host-key warnings. A task's require: wins over the environment's preference,
which is what keeps fault-injection tasks gradeable."
```

---

