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
  /** Guest password for vmrun's -gp guest-auth flag. Only ever read here. */
  guestPassword?: string
  /** Set by RHCSA_TRANSPORT to skip probing, or by a task that needs vmrun. */
  forceTransport?: TransportKind
}

const DEFAULT_VMRUN = '/mnt/c/Program Files (x86)/VMware/VMware Workstation/vmrun.exe'

// Exhaustive by construction: adding a TransportKind fails to typecheck until
// it is listed here, so this list cannot drift out of sync with that type.
const KINDS: Record<TransportKind, true> = { ssh: true, vmrun: true, fake: true }

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
  if (forced !== undefined && !Object.hasOwn(KINDS, forced)) {
    throw new Error(
      `RHCSA_TRANSPORT must be one of ${Object.keys(KINDS).join(', ')}, got ${JSON.stringify(forced)}`,
    )
  }

  return {
    vmx,
    ip: env.RHCSA_VM_IP,
    sshUser: env.RHCSA_SSH_USER ?? 'student',
    sshPort,
    sshKey: env.RHCSA_SSH_KEY ?? join(homedir(), '.ssh', 'rhcsa_lab'),
    vmrun: env.RHCSA_VMRUN ?? DEFAULT_VMRUN,
    guestPassword: env.RHCSA_GUEST_PASSWORD,
    forceTransport: forced as TransportKind | undefined,
  }
}
