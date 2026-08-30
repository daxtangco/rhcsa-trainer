import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ExecResult, LabTransport, TransportKind } from './transport.ts'

/** Like Runner, but with stdin — the reason SSH gets its own seam. */
export type SshRunner = (exe: string, args: string[], stdin?: string) => Promise<ExecResult>

/**
 * The shape of whatever `execFile`'s callback hands us as `err`, narrowed
 * without an `as` cast. Every field is optional and none of the names are
 * ssh-specific: this is the shape of *any* caught execFile error, so the
 * identical idiom at vmrun.ts:49 (parked, Task 17, closed) can move onto this
 * same predicate later without a rewrite.
 */
interface ExecFileError {
  stdout?: string
  stderr?: string
  code?: number
  killed?: boolean
  signal?: string | null
}

function isExecFileError(e: unknown): e is ExecFileError {
  return typeof e === 'object' && e !== null
}

/**
 * Builds an `SshRunner` bounded by `timeoutMs` (default 120s — a ceiling for
 * a wedged connection, not a latency budget; select.ts's own, shorter,
 * probe ceiling is what bounds transport *selection*).
 *
 * `ConnectTimeout=10` in the ssh argv only bounds the connect phase: once
 * connected, a script that blocks on a device, a lock, an NFS mount, or a
 * hung systemd unit hangs with no ceiling at all without this.
 *
 * A killed/timed-out child reports `code: 124` — the same convention makeRunner
 * (vmrun.ts) already uses — rather than being indistinguishable from a plain
 * exit 1.
 *
 * No credential redaction here, unlike vmrun.ts's redactArgv: ssh authenticates
 * with a key *file*, so its argv carries a path (`-i /home/u/.ssh/rhcsa_lab`),
 * never a secret. The asymmetry with vmrun.ts is deliberate, not an oversight.
 */
export function makeSshRunner(opts: { timeoutMs?: number } = {}): SshRunner {
  const timeoutMs = opts.timeoutMs ?? 120_000
  return (exe, args, stdin) =>
    new Promise((resolve) => {
      const child = execFile(
        exe,
        args,
        { maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs },
        (err, stdout, stderr) => {
          if (!err) {
            resolve({ stdout, stderr, code: 0 })
            return
          }
          if (!isExecFileError(err)) {
            resolve({ stdout, stderr, code: 1 })
            return
          }

          // On a timeout, execFile's `code` is `null`, not a number: this
          // must be checked before falling back to `code ?? 1`, or a 120s
          // hang and an ordinary failure become indistinguishable to every
          // caller.
          const timedOut = err.killed === true || (typeof err.code !== 'number' && !!err.signal)
          if (timedOut) {
            resolve({
              stdout,
              stderr: `timed out after ${timeoutMs}ms running ${exe}`,
              code: 124,
            })
            return
          }

          resolve({
            stdout,
            stderr,
            code: typeof err.code === 'number' ? err.code : 1,
          })
        },
      )
      if (stdin !== undefined) {
        child.stdin?.end(stdin)
      }
    })
}

/** Keep the exported name and type stable: SshTransport's constructor defaults to it. */
export const realSshRunner: SshRunner = makeSshRunner()

export interface SshConfigSlice {
  ip?: string
  sshUser: string
  sshPort: number
  sshKey: string
}

/**
 * Separate from the user's known_hosts, but not because a snapshot revert
 * could change host keys — it can't: a revert restores the guest's host keys
 * along with everything else in the filesystem, and `accept-new` would not
 * rescue a changed key anyway (ssh_config(5): it adds *new* host keys
 * automatically but "will not permit connections to hosts with changed host
 * keys"). What actually invalidates a host key is *rebuilding* the VM from
 * the ISO, which this project expects as its last-resort recovery path
 * (docs/vm-build-checklist.md). The dedicated file's real value: when a
 * rebuild does invalidate the key, the failure and its fix are confined to a
 * throwaway file the user can delete outright, instead of an editing session
 * in the known_hosts they use for real work.
 */
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
      // Not just code 0: ssh can exit 0 with the remote bash never running
      // the script (a guest-side ForceCommand, a shell that eats stdin). The
      // marker is what proves a script actually executed, not merely that
      // ssh connected.
      return r.code === 0 && r.stdout.includes('rhcsa-probe')
    } catch {
      return false
    }
  }
}
