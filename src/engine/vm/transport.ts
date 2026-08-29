export type TransportKind = 'ssh' | 'vmrun' | 'fake'

export interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

/**
 * The only channel the engine uses to touch the VM.
 *
 * Two real implementations exist because neither alone covers the objective
 * list: SSH is fast but dies on exactly the labs that matter most (root
 * password recovery, GRUB, broken fstab, firewall lockout), and vmrun keeps
 * working there because it goes through open-vm-tools instead of the network.
 */
export interface LabTransport {
  readonly kind: TransportKind
  /** Run a bash script in the guest as root. Never throws on non-zero exit. */
  exec(script: string): Promise<ExecResult>
  isAvailable(): Promise<boolean>
}
