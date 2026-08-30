import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
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

/**
 * `execFile`'s own failure message echoes the full argv, and `-gp <password>`
 * is on that argv (see `guestAuth`), so a fallback message built from a raw
 * error must never be that message verbatim. Redact the value following
 * `-gp` before it can reach any string this module returns.
 */
function redactArgv(args: string[]): string[] {
  const out = [...args]
  const i = out.indexOf('-gp')
  if (i >= 0 && i + 1 < out.length) out[i + 1] = '<redacted>'
  return out
}

/**
 * Builds a `Runner` bounded by `timeoutMs` (default 120s — a ceiling for a
 * wedged hypervisor, not a latency budget; a healthy vmrun guest op is well
 * under a second, but a slow `revertToSnapshot` on a large VM is legitimate).
 *
 * A killed/timed-out child reports `code: 124` — what `timeout(1)` uses, and
 * what `scripts/r1-probe.sh` already teaches the reader to read as "timed out
 * silently" — rather than being indistinguishable from a plain exit 1.
 */
export function makeRunner(opts: { timeoutMs?: number } = {}): Runner {
  const timeoutMs = opts.timeoutMs ?? 120_000
  return async (exe, args) => {
    try {
      const { stdout, stderr } = await execFileAsync(exe, args, {
        maxBuffer: 32 * 1024 * 1024,
        timeout: timeoutMs,
      })
      return { stdout, stderr, code: 0 }
    } catch (e) {
      const err = e as {
        stdout?: string
        stderr?: string
        code?: number
        killed?: boolean
        signal?: string | null
      }

      // On a timeout, execFile's `code` is `null`, not a number: this must be
      // checked before falling back to `code ?? 1`, or a 120s hang and an
      // ordinary failure become indistinguishable to every caller.
      const timedOut = err.killed === true || (typeof err.code !== 'number' && !!err.signal)
      if (timedOut) {
        return {
          stdout: err.stdout ?? '',
          stderr: `timed out after ${timeoutMs}ms running ${exe}`,
          code: 124,
        }
      }

      // Never surface err.message unredacted: it is execFile's own
      // "Command failed: <exe> <argv...>" line, and argv may contain -gp
      // <password>. Prefer vmrun's own stderr (no argv in it); fall back to a
      // redacted rebuild of the same shape only when stderr is empty.
      const stderr =
        err.stderr && err.stderr.length > 0
          ? err.stderr
          : `Command failed: ${exe} ${redactArgv(args).join(' ')}`

      return {
        stdout: err.stdout ?? '',
        stderr,
        code: typeof err.code === 'number' ? err.code : 1,
      }
    }
  }
}

/** Keep the exported name and type stable: constructors below default to it. */
export const realRunner: Runner = makeRunner()

/** Fields VmrunTransport and VmController actually need, so tests can pass a literal. */
export interface VmrunConfigSlice {
  vmx: string
  vmrun: string
  sshUser: string
  guestPassword?: string
}

/**
 * vmrun has no interface for passing a guest password other than this argv
 * flag, so the password is visible in the host's process list for the
 * duration of each guest operation. That is inherent to vmrun and not
 * something this code can fix — worth a reader knowing rather than
 * discovering. `?? ''` on a missing password is deliberate, not a gap: vmrun
 * fails with its own clear error on a wrong or empty password, which is a
 * better diagnostic than one invented here.
 */
function guestAuth(cfg: VmrunConfigSlice): string[] {
  return ['-gu', cfg.sshUser, '-gp', cfg.guestPassword ?? '']
}

function guestScriptPath(): string {
  // Random rather than counter-derived: two processes (the server and the
  // CLI) can run against the same guest, and two counters both starting at 1
  // would collide on the same path — a silent clobber that looks like a
  // flaky grader.
  return `/tmp/rhcsa-${randomBytes(6).toString('hex')}.sh`
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
    // very persistence the graders check. soft requires open-vm-tools running
    // in the guest to acknowledge it: against a guest without it, this call
    // hangs and never returns — observed live, see docs/r1-findings.md.
    // makeRunner's timeout (120s default) is what bounds that hang.
    await this.#run(this.#cfg.vmrun, ['stop', this.#cfg.vmx, 'soft'])
  }

  async snapshot(name: string): Promise<void> {
    await this.#run(this.#cfg.vmrun, ['snapshot', this.#cfg.vmx, name])
  }

  async revert(name: string): Promise<void> {
    await this.#run(this.#cfg.vmrun, ['revertToSnapshot', this.#cfg.vmx, name])
    // A live-snapshot revert (the design's ~5s reset mechanism, spec §4) may
    // leave the VM already running, in which case this start is expected to
    // fail — and its failure is deliberately ignored either way. Unverified
    // against real vmrun; the VM acceptance step is where that gets confirmed.
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
   * `systemctl reboot` kills the connection mid-command, so a non-zero
   * *result* here is expected and ignored — waitForGuest is the real
   * assertion of success. But exec only ever *rejects* when staging the
   * script on the host fails, or when the injected Runner itself throws
   * (i.e. vmrun is missing) — a host-side problem, not a guest one. That is
   * not swallowed: left to propagate, or a missing vmrun.exe turns into a
   * silent 120s wait ending in a "guest did not come back" error that sends
   * the reader looking at the guest for a problem that is on the host.
   */
  async reboot(): Promise<void> {
    const t = new VmrunTransport(this.#cfg, this.#run)
    await t.exec('sudo systemctl reboot || sudo reboot')
    // Give the machine a moment to actually go down, or the first probe can
    // succeed against the still-running pre-reboot system.
    await new Promise((r) => setTimeout(r, this.#pollMs))
    await this.waitForGuest()
  }
}
