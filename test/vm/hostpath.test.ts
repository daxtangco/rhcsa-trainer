import { describe, expect, it, vi } from 'vitest'
import { toWindowsPath } from '../../src/engine/vm/hostpath.ts'

/**
 * The conversion these tests guard is what makes `vmrun copyFileFromHostToGuest`
 * work at all from WSL, so the WSL-only assertions run against the real
 * `wslpath` rather than a stub: a stubbed converter would still pass if the
 * real one were wired up wrong, which is exactly the defect that reached the
 * first real VM.
 */
const onWsl = !!process.env.WSL_DISTRO_NAME

describe('toWindowsPath', () => {
  it('leaves a path Windows can already open alone', async () => {
    // Notably RHCSA_VMX, which the checklist tells the user to write this way.
    expect(await toWindowsPath('C:\\VMs\\rhcsa-lab\\rhcsa-lab.vmx')).toBe(
      'C:\\VMs\\rhcsa-lab\\rhcsa-lab.vmx',
    )
    expect(await toWindowsPath('C:/VMs/rhcsa-lab/rhcsa-lab.vmx')).toBe(
      'C:/VMs/rhcsa-lab/rhcsa-lab.vmx',
    )
    expect(await toWindowsPath('\\\\wsl.localhost\\Ubuntu\\tmp\\x.sh')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\tmp\\x.sh',
    )
  })

  it('passes a POSIX path through untouched when not running under WSL', async () => {
    vi.stubEnv('WSL_DISTRO_NAME', '')
    expect(await toWindowsPath('/tmp/rhcsa-stage-x/script.sh')).toBe(
      '/tmp/rhcsa-stage-x/script.sh',
    )
    vi.unstubAllEnvs()
  })

  it.runIf(onWsl)('converts a WSL path to a form Windows can open', async () => {
    const out = await toWindowsPath('/tmp/rhcsa-stage-x/script.sh')
    // A bare POSIX path here is the bug: WSL hands Windows programs argv
    // verbatim, so vmrun would receive a string that is not a Windows path.
    expect(out).toMatch(/^([A-Za-z]:\\|\\\\)/)
    expect(out).toContain('script.sh')
  })

  it.runIf(onWsl)('uses the drive letter for a real drive mount, not a UNC path', async () => {
    // Throughput, not cosmetics: provision.sh copies a ~10 GB ISO from here,
    // and the UNC form would push it through the 9P share.
    expect(await toWindowsPath('/mnt/c/ISO/rhel-9.8-x86_64-dvd.iso')).toBe(
      'C:\\ISO\\rhel-9.8-x86_64-dvd.iso',
    )
  })
})
