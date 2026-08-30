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

  it('reads the guest password only from the environment: absent when unset, present when set', () => {
    expect(loadVmConfig({ RHCSA_VMX: 'x' }).guestPassword).toBeUndefined()
    expect(
      loadVmConfig({ RHCSA_VMX: 'x', RHCSA_GUEST_PASSWORD: 'hunter2' }).guestPassword,
    ).toBeDefined()
  })
})
