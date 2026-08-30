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

/**
 * Bound how long selection may take, independent of SSH's own ConnectTimeout.
 *
 * Deliberately shorter than `ConnectTimeout=10`, and that has a cost worth
 * knowing rather than discovering: on a link that genuinely needs more than
 * 3s to establish — a loaded NAT, a guest still finishing boot — ssh gets
 * declared unavailable here and selection falls back to vmrun for the rest
 * of the session, which costs three vmrun round trips per exec instead of
 * one ssh round trip. Everything still works, just several times slower,
 * with nothing at runtime saying why. The abandoned ssh probe is not
 * cancelled when this fires: it keeps running under makeSshRunner's own 120s
 * ceiling, and whatever it eventually resolves to is simply discarded.
 * `probeTimeoutMs` is here for anyone who needs to widen this.
 */
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

  // 'fake' is an accepted RHCSA_TRANSPORT value (loadVmConfig's KINDS is
  // exhaustive over TransportKind, not over what's selectable here), but
  // select.ts deliberately does not import fake.ts: test scaffolding has no
  // place in the production selector, and ChooseOptions has no slot to put
  // one in. Falling through to the probe below would silently hand the
  // caller a live SshTransport when they asked to be pinned to fake — a pin
  // accepted and then discarded. Refuse it explicitly instead.
  if (pinned === 'fake') {
    throw new Error(
      "the 'fake' transport is not selectable: it exists for tests and is " +
        'constructed directly with a handler. Unset RHCSA_TRANSPORT, or set it ' +
        'to ssh or vmrun.',
    )
  }

  if (pinned === 'ssh' || pinned === 'vmrun') {
    const t = pinned === 'ssh' ? ssh : vmrun
    if (await availableWithin(t, ms)) return t
    throw new NoTransportError([pinned])
  }

  if (await availableWithin(ssh, ms)) return ssh
  if (await availableWithin(vmrun, ms)) return vmrun
  throw new NoTransportError(['ssh', 'vmrun'])
}
