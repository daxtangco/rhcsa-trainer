import { describe, expect, it } from 'vitest'
import { FakeTransport } from '../../src/engine/vm/fake.ts'
import {
  OFFLINE_STATE_FILE,
  enforceOffline,
  enforceOfflineScript,
  offlineRequiredFor,
  offlineStatus,
  offlineStatusScript,
  parseOfflineReport,
  restoreNetwork,
  restoreNetworkScript,
} from '../../src/engine/vm/offline.ts'

const OK = { stdout: '', stderr: '', code: 0 }

/** Guest output for one successful enforcement, in the scripts' own protocol. */
const ENFORCED = [
  'rhcsa-offline: note=dropped default route (-4): default via 192.168.70.2 dev ens160',
  'rhcsa-offline: state=offline',
  'rhcsa-offline: internet=unreachable',
  'rhcsa-offline: enforced=yes',
  'rhcsa-offline: preserved=172.22.101.110/32 via 192.168.70.2 dev ens160',
  'rhcsa-offline: changed=yes',
  '',
].join('\n')

describe('offlineRequiredFor', () => {
  it('goes offline in drill and exam only (spec 10.3)', () => {
    expect(offlineRequiredFor('drill')).toBe(true)
    expect(offlineRequiredFor('exam')).toBe(true)
    // Practice is section 9.1's untimed, full-ladder mode: a mode that withholds
    // nothing else has no reason to withhold the internet.
    expect(offlineRequiredFor('practice')).toBe(false)
    // Guided mode shows the student the command to type; there is nothing to look up.
    expect(offlineRequiredFor('guided')).toBe(false)
  })
})

describe('the guest scripts as text', () => {
  const enforce = enforceOfflineScript()

  /**
   * The script's executable lines. Its comments name the measured addresses on
   * purpose — that is where the reasoning is recorded — so an assertion that no
   * address is baked in has to distinguish prose from code, the same distinction
   * `docs/r1-findings.md` warns the checkpoint-id grep gets wrong.
   */
  const code = enforce
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n')

  it('derives the peer from the live ssh connection rather than a constant', () => {
    // The whole point. WSL's eth0 address is a DHCP lease (172.22.101.110 when
    // docs/r1-findings.md was written) and changes across host reboots, so a
    // hardcoded peer or subnet would brick the control channel one reboot later.
    expect(code).toContain('SSH_CONNECTION')
    expect(code).not.toContain('172.22.')
  })

  it('derives the gateway too, instead of assuming VMware NAT is at .2', () => {
    // 192.168.70.2 appears only in prose, never in a command: the guest is asked
    // via `ip route get`. Nothing here may depend on one host's VMware install.
    expect(code).not.toContain('192.168.70.')
    expect(code).toContain('ip route get')
  })

  it('adds the preserve route strictly before deleting the default route', () => {
    // The one safety property available without a transaction. Asserted on the
    // text as well as on execution (offline-script.test.ts) because it is the
    // property that decides whether the app can still reach the guest.
    const add = enforce.indexOf('sudo ip route add $spec')
    const del = enforce.indexOf('sudo ip "$fam" route del default')
    expect(add).toBeGreaterThan(-1)
    expect(del).toBeGreaterThan(-1)
    expect(add).toBeLessThan(del)
  })

  it('checks for an existing default route before it touches anything', () => {
    // Idempotence, and it has to come first: adding preserve routes and only
    // then discovering there was no default route to drop would leave host
    // routes behind with no state file naming them.
    const guard = enforce.indexOf('already offline')
    const add = enforce.indexOf('sudo ip route add $spec')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(add)
  })

  it('keeps its state on tmpfs, so a reboot or a revert clears it', () => {
    expect(OFFLINE_STATE_FILE.startsWith('/run/')).toBe(true)
    for (const s of [enforce, restoreNetworkScript(), offlineStatusScript()]) {
      expect(s).toContain(OFFLINE_STATE_FILE)
    }
  })

  it('names the snapshot revert as the recovery path when there is no record', () => {
    // Restoration is not a transaction and does not pretend to be one.
    expect(restoreNetworkScript()).toContain('clean snapshot')
  })

  it('interpolates the guest sshd port, and refuses a value that is not one', () => {
    expect(enforceOfflineScript({ sshPort: 2222 })).toContain('sport = :2222 ')
    expect(enforceOfflineScript()).toContain('sport = :22 ')
    // Guarded because the value is interpolated into a script that runs commands
    // under sudo. loadVmConfig checks RHCSA_SSH_PORT, but these builders are
    // exported and a caller may pass a number from anywhere.
    expect(() => enforceOfflineScript({ sshPort: 0 })).toThrow(/port number/)
    expect(() => enforceOfflineScript({ sshPort: 22.5 })).toThrow(/port number/)
    expect(() => enforceOfflineScript({ sshPort: 70000 })).toThrow(/port number/)
  })

  it('changes nothing in the status script', () => {
    const status = offlineStatusScript()
    expect(status).not.toContain('route add')
    expect(status).not.toContain('route del')
    expect(status).not.toContain('rm -f')
  })
})

describe('parseOfflineReport', () => {
  it('reads one successful enforcement', () => {
    const r = parseOfflineReport({ stdout: ENFORCED, stderr: '', code: 0 })
    expect(r.ok).toBe(true)
    expect(r.state).toBe('offline')
    expect(r.enforced).toBe(true)
    expect(r.changed).toBe(true)
    expect(r.preserved).toEqual(['172.22.101.110/32 via 192.168.70.2 dev ens160'])
    // The read-back is what matters: no default route is left.
    expect(r.defaultRoutes).toEqual([])
    // null is the good outcome — offline mode holding, in the guest's own words.
    expect(r.internetRoute).toBeNull()
    expect(r.errors).toEqual([])
  })

  it('reports an idempotent no-op as ok but unchanged', () => {
    const r = parseOfflineReport({
      stdout: [
        'rhcsa-offline: note=already offline: the guest has no default route',
        'rhcsa-offline: state=offline',
        'rhcsa-offline: internet=unreachable',
        'rhcsa-offline: enforced=no',
        'rhcsa-offline: changed=no',
      ].join('\n'),
      stderr: '',
      code: 0,
    })
    expect(r.ok).toBe(true)
    expect(r.changed).toBe(false)
    expect(r.enforced).toBe(false)
  })

  it('keeps the state it was told even when the script exited non-zero', () => {
    const r = parseOfflineReport({
      stdout: [
        'rhcsa-offline: error=could not add the route that keeps the control channel alive',
        'rhcsa-offline: default=default via 192.168.70.2 dev ens160',
        'rhcsa-offline: state=online',
        'rhcsa-offline: internet=203.0.113.1 via 192.168.70.2 dev ens160',
        'rhcsa-offline: enforced=no',
        'rhcsa-offline: changed=no',
      ].join('\n'),
      stderr: '',
      code: 1,
    })
    expect(r.ok).toBe(false)
    // The abort left the guest reachable, and saying so is the whole value of
    // the report: a caller must be able to tell "refused to go offline" from
    // "went offline and took the control channel with it".
    expect(r.state).toBe('online')
    expect(r.defaultRoutes).toEqual(['default via 192.168.70.2 dev ens160'])
    expect(r.internetRoute).toBe('203.0.113.1 via 192.168.70.2 dev ens160')
    expect(r.errors).toHaveLength(1)
  })

  it("reports 'unknown' rather than inventing a state when nothing was said", () => {
    // Collapsing this into 'online' would report a machine nobody looked at.
    const r = parseOfflineReport({ stdout: '', stderr: 'sudo: a password is required', code: 1 })
    expect(r.state).toBe('unknown')
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('sudo: a password is required')
  })

  it('fails when a code-0 run said nothing, instead of reporting a clean no-op', () => {
    // A guest that exits 0 with no protocol line ran something other than this
    // script (a ForceCommand, a shell that ate stdin — the case SshTransport's
    // own probe marker exists for).
    const r = parseOfflineReport({ stdout: 'Last login: Sat\n', stderr: '', code: 0 })
    expect(r.ok).toBe(false)
    expect(r.state).toBe('unknown')
    expect(r.errors).toHaveLength(1)
  })

  it('files unrecognised output as noise instead of failing on it', () => {
    // parseVerdict's rule, for parseVerdict's reason.
    const r = parseOfflineReport({
      stdout: [
        'Warning: Permanently added something',
        'rhcsa-offline: state=online',
        'rhcsa-offline: internet=203.0.113.1 via 192.168.70.2 dev ens160',
        'rhcsa-offline: enforced=no',
        'rhcsa-offline: changed=no',
        'rhcsa-offline: state=weird',
        'rhcsa-offline: not-a-key-value-line',
        'rhcsa-offline: brandnew=7',
      ].join('\n'),
      stderr: '',
      code: 0,
    })
    expect(r.ok).toBe(true)
    expect(r.state).toBe('online')
    expect(r.notes).toContain('Warning: Permanently added something')
    expect(r.notes).toContain('state=weird')
    expect(r.notes).toContain('not-a-key-value-line')
    expect(r.notes).toContain('brandnew=7')
  })
})

describe('the transport-facing entry points', () => {
  it('sends the enforce script and parses what comes back', async () => {
    const t = new FakeTransport(() => ({ stdout: ENFORCED, stderr: '', code: 0 }))
    const r = await enforceOffline(t)
    expect(r.state).toBe('offline')
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0]).toBe(enforceOfflineScript())
  })

  it('passes sshPort through to the script it sends', async () => {
    const t = new FakeTransport(() => ({ stdout: ENFORCED, stderr: '', code: 0 }))
    await enforceOffline(t, { sshPort: 2222 })
    expect(t.calls[0]).toContain('sport = :2222 ')
  })

  it('does not throw when the guest refuses to go offline', async () => {
    // Policy: offline mode is a habit device, so a machine that refused is a
    // degraded session, not a lost one. Refusing to open the session would cost
    // the student the practice to protect a nicety.
    const t = new FakeTransport(() => ({
      stdout: 'rhcsa-offline: error=nope\nrhcsa-offline: state=online\n',
      stderr: '',
      code: 1,
    }))
    const r = await enforceOffline(t)
    expect(r.ok).toBe(false)
    expect(r.state).toBe('online')
  })

  it('does not throw when the transport itself returns nothing useful', async () => {
    const t = new FakeTransport(() => ({ stdout: '', stderr: 'no route to host', code: 255 }))
    const r = await enforceOffline(t)
    expect(r.ok).toBe(false)
    expect(r.state).toBe('unknown')
  })

  it('sends the right script for restore and for status', async () => {
    const t = new FakeTransport(() => OK)
    await restoreNetwork(t)
    await offlineStatus(t)
    expect(t.calls[0]).toBe(restoreNetworkScript())
    expect(t.calls[1]).toBe(offlineStatusScript())
  })

  it('works over the vmrun transport, which needs no guest networking', async () => {
    // Offline mode neither helps nor hurts vmrun: it reaches the guest through
    // open-vm-tools. So all three operations are available while the guest is
    // offline, and the fake stands in for either transport here because the
    // engine only ever sees LabTransport.
    const t = new FakeTransport(() => ({ stdout: ENFORCED, stderr: '', code: 0 }), {
      available: true,
    })
    expect((await enforceOffline(t)).ok).toBe(true)
    // And the script has a peer source that does not need SSH_CONNECTION, which
    // vmrun cannot set: without it, an enforcement driven over vmrun would kill
    // the terminal bridge's separate ssh connection.
    expect(t.calls[0]).toContain('ss -Htn state established')
  })
})
