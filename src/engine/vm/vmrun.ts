import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { toWindowsPath } from './hostpath.ts'
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

export interface CaptureLayout {
  /** Guest path of the staged wrapper script. */
  script: string
  /** Guest path the wrapper redirects fd 1 to. */
  stdout: string
  /** Guest path the wrapper redirects fd 2 to. */
  stderr: string
  /** First line of both capture files, written before the caller's script runs. */
  marker: string
}

/**
 * The guest-side paths and capture marker for one `exec`, all derived from one
 * random id so a reader can see at a glance that they belong to each other.
 *
 * Random rather than counter-derived: two processes (the server and the CLI)
 * can run against the same guest, and two counters both starting at 1 would
 * collide on the same path — a silent clobber that looks like a flaky grader.
 *
 * Exported for the tests, which have to fake a guest-to-host copy and so need
 * the same marker this module will go looking for. One shared derivation beats
 * writing the naming scheme down in two places that can drift apart.
 */
export function captureLayout(id: string): CaptureLayout {
  return {
    script: `/tmp/rhcsa-${id}.sh`,
    stdout: `/tmp/rhcsa-${id}.out`,
    stderr: `/tmp/rhcsa-${id}.err`,
    marker: `--rhcsa-${id}--`,
  }
}

/**
 * Wraps the caller's script so the guest captures its own output to files.
 *
 * `vmrun runProgramInGuest` does not return the guest program's stdout, and no
 * flag makes it: the guest program inherits `vmtoolsd`'s stdout, so its output
 * lands in the guest's journal and never crosses back to the host. Measured —
 * `scripts/provision.sh`'s readiness probe used to grep for a string the guest
 * printed and failed 92 consecutive times against a completely healthy guest,
 * while that guest's journal recorded all 92 runs succeeding. So the guest has
 * to write its output somewhere the host can fetch it afterwards, and this
 * wrapper is that arrangement.
 *
 * `exec` with only redirections and no command replaces this shell's own file
 * descriptors for the rest of the file. That is deliberately not a `{ ... }`
 * group around the caller's script: a group has to be closed, which breaks on
 * a script ending inside a heredoc, and an empty group is a bash syntax error.
 * `exec` prepends lines and changes nothing else, so the caller's text is
 * appended verbatim and the script's exit status stays its own — measured, a
 * wrapped `exit 3` still exits 3.
 *
 * The marker goes to both streams before the caller's script runs, which buys
 * two things. Neither capture file is ever 0 bytes, so nothing here depends on
 * how vmrun copies an empty file out of a guest — unverified behaviour that
 * the commonest case of all, a command that prints nothing, would otherwise
 * hit on every single exec. And the marker's presence is a positive integrity
 * check: a captured file not starting with it was truncated, never written, or
 * belongs to some other exec, and that gets reported rather than quietly
 * returned as "the command produced no output".
 */
function wrapScript(script: string, g: CaptureLayout): string {
  return [
    '# Staged by VmrunTransport. Deleted after the run; do not edit.',
    `exec >'${g.stdout}' 2>'${g.stderr}'`,
    `printf '%s\\n' '${g.marker}'`,
    `printf '%s\\n' '${g.marker}' >&2`,
    '',
    script.endsWith('\n') ? script : `${script}\n`,
  ].join('\n')
}

/**
 * Reads one captured stream back, or `null` when the capture cannot be
 * trusted. `null` is not "empty output" — see `wrapScript` for why the two are
 * distinguishable at all, and `exec` for what it does with the difference.
 */
async function readCapture(hostPath: string, marker: string): Promise<string | null> {
  let raw: string
  try {
    raw = await readFile(hostPath, 'utf8')
  } catch {
    return null
  }
  const prefix = `${marker}\n`
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : null
}

/**
 * Runs scripts through `vmrun runProgramInGuest`.
 *
 * Slower than SSH — five vmrun round trips per exec — but it needs no guest
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

  /**
   * Builds argv for a guest operation with the auth flags in the one position
   * vmrun accepts them.
   *
   * `vmrun` with no arguments states the rule: "AUTHENTICATION-FLAGS ... must
   * appear before the command and any command parameters." Passing them after
   * the vmx path does not merely fail — vmrun prompts for guest credentials on
   * the terminal and then consumes `-gu` as the command's first parameter, so
   * `copyFileFromHostToGuest` reported "The file name is not valid" about a
   * flag (measured against real vmrun 1.17.0). Every guest op goes through
   * here so that ordering lives in one place rather than at three call sites.
   */
  #guestArgv(command: string, ...params: string[]): string[] {
    return [...guestAuth(this.#cfg), command, this.#cfg.vmx, ...params]
  }

  async exec(script: string): Promise<ExecResult> {
    const g = captureLayout(randomBytes(6).toString('hex'))
    const dir = await mkdtemp(join(tmpdir(), 'rhcsa-stage-'))
    const stagedHost = join(dir, 'script.sh')
    const outHost = join(dir, 'stdout')
    const errHost = join(dir, 'stderr')
    await writeFile(stagedHost, wrapScript(script, g), 'utf8')

    try {
      const copyIn = await this.#run(
        this.#cfg.vmrun,
        this.#guestArgv(
          'copyFileFromHostToGuest',
          // vmrun.exe is a Windows program, so the *host* side of this copy has
          // to be a path Windows can open — `stagedHost` as written by mkdtemp
          // cannot be (see toWindowsPath). The guest side stays POSIX: that one
          // is interpreted by the guest, not by Windows.
          await toWindowsPath(stagedHost),
          g.script,
        ),
      )
      // Checked, where it used to be ignored. With the script never staged, the
      // run below is just bash exiting 127 about a missing file, which sends
      // the reader hunting in the guest for a copy that never left the host.
      if (copyIn.code !== 0) {
        return {
          stdout: '',
          stderr:
            copyIn.stderr.trim().length > 0
              ? copyIn.stderr
              : `vmrun could not stage ${g.script} in the guest (exit ${copyIn.code})`,
          code: copyIn.code,
        }
      }

      const run = await this.#run(
        this.#cfg.vmrun,
        // No -noWait / -activeWindow / -interactive: those are bare presence
        // flags, not `=false` assignments, and blocking until the guest program
        // exits is already vmrun's default. Passing them as `flag=false` is a
        // syntax error, not a no-op.
        this.#guestArgv('runProgramInGuest', '/usr/bin/bash', g.script),
      )

      // Two more round trips, and the reason this transport costs five rather
      // than three: the guest's output only exists as files in the guest, so it
      // has to be fetched. The host destinations are inside the mkdtemp
      // directory, which is also where the copy *in* above reads from — a form
      // vmrun demonstrably handles, since that is the path provision.sh's own
      // guest copy uses. The one thing not yet exercised against real vmrun is
      // the write direction to that path; if it turns out vmrun cannot write
      // there, the marker check below reports it in stderr rather than handing
      // a grader a silent empty string.
      const copyOut = await this.#run(
        this.#cfg.vmrun,
        this.#guestArgv('copyFileFromGuestToHost', g.stdout, await toWindowsPath(outHost)),
      )
      const copyErr = await this.#run(
        this.#cfg.vmrun,
        this.#guestArgv('copyFileFromGuestToHost', g.stderr, await toWindowsPath(errHost)),
      )

      const captured = {
        stdout: await readCapture(outHost, g.marker),
        stderr: await readCapture(errHost, g.marker),
      }

      const reported = GUEST_CODE_RE.exec(`${run.stdout}\n${run.stderr}`)
      const code = reported ? Number(reported[1]) : run.code

      // `run.stdout` is deliberately absent from every result below. It is
      // vmrun's own prose about the guest program ("Guest program exited with
      // non-zero code: 3"), not the guest program's output, and returning it as
      // the latter is the entire bug this function exists to not have: a grader
      // reading command output over this transport got vmrun's chatter, or more
      // often the empty string, and graded against it. GUEST_CODE_RE above and
      // the diagnostic below are the only legitimate uses for that prose.
      const missing = (['stdout', 'stderr'] as const).filter((s) => captured[s] === null)
      if (missing.length === 0) {
        return {
          stdout: captured.stdout ?? '',
          stderr: captured.stderr ?? '',
          code,
        }
      }

      // Every string here has been through makeRunner, which redacts `-gp`, so
      // the guest password cannot ride along into a grader's output.
      const why = [copyOut.stderr, copyErr.stderr, run.stderr]
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .join(' | ')
      return {
        stdout: captured.stdout ?? '',
        // The failure is reported on stderr, never on stdout: a grader parses
        // stdout, and a diagnostic mixed into it would be indistinguishable
        // from the guest having printed it.
        stderr: [
          `vmrun transport: guest ${missing.join(' and ')} could not be captured.`,
          why.length > 0 ? `vmrun reported: ${why}` : 'vmrun reported nothing.',
          captured.stderr ?? '',
        ]
          .filter((s) => s.length > 0)
          .join('\n'),
        code,
      }
    } finally {
      // One rm for all three paths rather than three deleteFileInGuest calls,
      // which keeps cleanup to a single round trip. Arguments after the program
      // reach the program rather than vmrun — provision.sh's step 5 passes
      // `/usr/bin/bash -c '<script>'` this way against real vmrun 1.17.0.
      //
      // Best effort: leftover /tmp files are harmless, and a thrown cleanup
      // error would mask the real result.
      await this.#run(
        this.#cfg.vmrun,
        this.#guestArgv('runProgramInGuest', '/usr/bin/rm', '-f', g.script, g.stdout, g.stderr),
      ).catch(() => undefined)
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
    // VERIFIED against real vmrun 1.17.0 / Workstation 25.0.1 (2026-09-06).
    // revertToSnapshot always leaves the VM POWERED OFF, even for a snapshot
    // that includes memory — `vmrun list` reported 0 running immediately after.
    // So this start is not a defensive no-op, it is required, and it resumes
    // from the checkpoint rather than cold-booting. Measured: revert to guest
    // answering SSH in ~12s total, ~11s of that inside this start. The design's
    // "~5s" figure (spec §4) is optimistic; ~12s is the real number.
    //
    // Do NOT use the guest's `uptime -s` or `uptime -p` to decide whether a
    // resume happened. Those derive from (wall clock now - /proc/uptime), and a
    // resumed VM's clock gets resynced forward by VMware Tools, so they report
    // a convincing but fictitious fresh boot time — that reading led to a wrong
    // "it cold-booted" conclusion during this very verification. The signals
    // that hold up: a single unchanged boot ID with the journal continuous
    // across the revert, /proc/uptime far below the wall time since boot, and
    // vmware.log's "Completed pending lazy checkpoint restore" + OS_Resume.
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
