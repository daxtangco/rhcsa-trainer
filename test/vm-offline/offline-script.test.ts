import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  enforceOfflineScript,
  offlineStatusScript,
  parseOfflineReport,
  restoreNetworkScript,
} from '../../src/engine/vm/offline.ts'
import type { OfflineOutcome } from '../../src/engine/vm/offline.ts'

const execFileAsync = promisify(execFile)

/**
 * The guest scripts, executed for real — by the host's own `bash`, against the
 * `ip`/`ss`/`sudo` stubs in `stub-net.sh`.
 *
 * This is the only way to test the scripts' *ordering* without a VM, and
 * ordering is the property that decides whether the app can still reach the
 * guest after offline mode is applied. What it cannot test is whether real
 * iproute2 accepts these argument forms, or whether the preserved host route
 * actually keeps ssh alive — see stub-net.sh's header, and the module's report.
 *
 * Nothing here touches this host's routing table: `ip` is a shell function, and
 * `sudo` resolves to that function rather than to /usr/bin/sudo.
 */

const STUB = join(dirname(fileURLToPath(import.meta.url)), 'stub-net.sh')

/** A guest with the topology measured in docs/r1-findings.md. */
const VMNET8 = [
  '-4|default|via 192.168.70.2 dev ens160 proto dhcp src 192.168.70.128 metric 100',
  '-4|192.168.70.0/24|dev ens160 proto kernel scope link src 192.168.70.128 metric 100',
  '',
].join('\n')

/**
 * An off-subnet client, reached through the default route — the case the preserve
 * machinery exists for.
 *
 * Deliberately *not* what the real lab guest sees: measured on 2026-09-13, Windows
 * SNATs WSL's traffic onto VMnet8, so the guest reports its ssh peer as
 * `192.168.70.1` and finds it on-link (see 'adds no route for an on-link peer',
 * which is the real topology's path, and the module header). This address is the
 * WSL eth0 address from `docs/r1-findings.md` used as a stand-in for the topologies
 * where the client genuinely is off-subnet — bridged mode, a NAT port-forward, or
 * the app running somewhere other than WSL.
 */
const WSL_PEER = '172.22.101.110'

interface RunResult {
  report: OfflineOutcome
  /** Every route mutation the script made, in the order it made them. */
  ops: string[]
  routes: string[]
  /** The guest state file's lines, or `null` when it does not exist. */
  state: string[] | null
  code: number
}

interface RunOptions {
  script: string
  routes?: string
  /** `ip route get` answers: `addr|DEFAULT`, `addr|ONLINK`, or `addr|<literal line>`. */
  gets?: string
  sshConnection?: string
  ssOut?: string
  failAdd?: string
  failDel?: string
}

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function lines(path: string): Promise<string[] | null> {
  try {
    const raw = await readFile(path, 'utf8')
    return raw.split('\n').filter((l) => l !== '')
  } catch {
    return null
  }
}

/**
 * One run in its own directory, so a sequence of calls (enforce then restore)
 * can share `dir` and see each other's state — which is the whole point of the
 * round-trip test.
 */
async function run(opts: RunOptions, dir?: string): Promise<{ result: RunResult; dir: string }> {
  const d = dir ?? (await mkdtemp(join(tmpdir(), 'rhcsa-offline-')))
  if (dir === undefined) dirs.push(d)

  const routes = join(d, 'routes')
  const gets = join(d, 'gets')
  const oplog = join(d, 'oplog')
  const state = join(d, 'offline.state')
  const combined = join(d, 'run.sh')

  if (opts.routes !== undefined) await writeFile(routes, opts.routes, 'utf8')
  await writeFile(gets, opts.gets ?? '', 'utf8')
  if (dir === undefined) await writeFile(oplog, '', 'utf8')
  await writeFile(combined, `${await readFile(STUB, 'utf8')}\n${opts.script}`, 'utf8')

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    ROUTES: routes,
    GETS: gets,
    OPLOG: oplog,
    RHCSA_OFFLINE_STATE: state,
  }
  if (opts.sshConnection !== undefined) env.SSH_CONNECTION = opts.sshConnection
  if (opts.ssOut !== undefined) env.SS_OUT = opts.ssOut
  if (opts.failAdd !== undefined) env.FAIL_ADD = opts.failAdd
  if (opts.failDel !== undefined) env.FAIL_DEL = opts.failDel

  let stdout = ''
  let stderr = ''
  let code = 0
  try {
    const r = await execFileAsync('bash', [combined], { env })
    stdout = r.stdout
    stderr = r.stderr
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number }
    stdout = err.stdout ?? ''
    stderr = err.stderr ?? ''
    code = typeof err.code === 'number' ? err.code : 1
  }

  return {
    dir: d,
    result: {
      report: parseOfflineReport({ stdout, stderr, code }),
      ops: (await lines(oplog)) ?? [],
      routes: (await lines(routes)) ?? [],
      state: await lines(state),
      code,
    },
  }
}

describe('enforceOfflineScript, executed', () => {
  it('adds the peer route before dropping the default route', async () => {
    const { result } = await run({
      script: enforceOfflineScript(),
      routes: VMNET8,
      gets: `${WSL_PEER}|DEFAULT\n`,
      sshConnection: `${WSL_PEER} 54321 192.168.70.128 22`,
    })

    // The ordering, measured rather than argued: if these two were the other way
    // round there would be an instant with no route back to the ssh client.
    expect(result.ops).toEqual([
      `add -4 ${WSL_PEER}/32 via 192.168.70.2 dev ens160`,
      'del -4 default',
    ])
    expect(result.code).toBe(0)
    expect(result.report.ok).toBe(true)
    expect(result.report.state).toBe('offline')
    expect(result.report.changed).toBe(true)
    expect(result.report.enforced).toBe(true)
    // The habit device working: the guest's own FIB says an off-subnet address
    // has no path, so curl and internet dnf fail.
    expect(result.report.internetRoute).toBeNull()
    // And the control channel's route is still there, so this run did not saw
    // off the branch it was sitting on.
    expect(result.report.preserved).toEqual([`${WSL_PEER}/32 via 192.168.70.2 dev ens160`])
    expect(result.routes).toContain(`-4|${WSL_PEER}/32|via 192.168.70.2 dev ens160`)
  })

  it('records what it removed, so restore is not a reconstruction', async () => {
    const { result } = await run({
      script: enforceOfflineScript(),
      routes: VMNET8,
      gets: `${WSL_PEER}|DEFAULT\n`,
      sshConnection: `${WSL_PEER} 54321 192.168.70.128 22`,
    })
    // The default route is stored verbatim as `ip route show` printed it, with
    // its family, so restore re-adds that rather than a reconstruction that
    // would silently drop `metric` and `proto`.
    expect(result.state).toEqual([
      `added ${WSL_PEER}/32 via 192.168.70.2 dev ens160`,
      'default -4 default via 192.168.70.2 dev ens160 proto dhcp src 192.168.70.128 metric 100',
    ])
  })

  it('is a no-op on a guest that has no default route', async () => {
    // Reached by a snapshot reverted mid-provision, by genuinely broken
    // networking, and by this script having already run. Must not error.
    const { result } = await run({
      script: enforceOfflineScript(),
      routes: '-4|192.168.70.0/24|dev ens160 proto kernel scope link\n',
      sshConnection: `${WSL_PEER} 54321 192.168.70.128 22`,
    })
    expect(result.code).toBe(0)
    expect(result.report.ok).toBe(true)
    expect(result.report.changed).toBe(false)
    expect(result.report.state).toBe('offline')
    // Nothing added, nothing recorded: the guard runs before any mutation.
    expect(result.ops).toEqual([])
    expect(result.state).toBeNull()
  })

  it('runs twice with the same result as running once', async () => {
    const first = await run({
      script: enforceOfflineScript(),
      routes: VMNET8,
      gets: `${WSL_PEER}|DEFAULT\n`,
      sshConnection: `${WSL_PEER} 54321 192.168.70.128 22`,
    })
    const second = await run(
      {
        script: enforceOfflineScript(),
        gets: `${WSL_PEER}|DEFAULT\n`,
        sshConnection: `${WSL_PEER} 54321 192.168.70.128 22`,
      },
      first.dir,
    )
    expect(second.result.code).toBe(0)
    expect(second.result.report.changed).toBe(false)
    // Still one add and one del in total: the second run mutated nothing.
    expect(second.result.ops).toEqual(first.result.ops)
    // And it still reports the preserve route, read back out of the state file
    // rather than from having just created it.
    expect(second.result.report.preserved).toEqual([
      `${WSL_PEER}/32 via 192.168.70.2 dev ens160`,
    ])
  })

  it('adds no route for an on-link peer, because dropping the default cannot affect it', async () => {
    // The arm that fires if it turns out Windows SNATs WSL's traffic to the
    // VMnet8 host adapter, putting the client on the guest's own subnet. Offline
    // mode is then simply free.
    const { result } = await run({
      script: enforceOfflineScript(),
      routes: VMNET8,
      gets: '192.168.70.1|ONLINK\n',
      sshConnection: '192.168.70.1 54321 192.168.70.128 22',
    })
    expect(result.ops).toEqual(['del -4 default'])
    expect(result.report.state).toBe('offline')
    expect(result.report.preserved).toEqual([])
    expect(result.report.notes.join('\n')).toContain('needs no route of its own')
  })

  it('leaves an existing host route alone rather than adopting it', async () => {
    // Restore must not delete a route this script did not create.
    const { result } = await run({
      script: enforceOfflineScript(),
      routes: `${VMNET8}-4|${WSL_PEER}/32|via 192.168.70.2 dev ens160\n`,
      gets: `${WSL_PEER}|DEFAULT\n`,
      sshConnection: `${WSL_PEER} 54321 192.168.70.128 22`,
    })
    expect(result.ops).toEqual(['del -4 default'])
    expect(result.report.notes.join('\n')).toContain('not recorded')
    expect(result.report.preserved).toEqual([])
    expect(result.state).toEqual([
      'default -4 default via 192.168.70.2 dev ens160 proto dhcp src 192.168.70.128 metric 100',
    ])
  })

  it('aborts with the default route intact when the preserve route cannot be added', async () => {
    // The one failure this script can actually protect against, and the reason
    // the add comes first. Continuing here would trade the app's control channel
    // for a habit device.
    const { result } = await run({
      script: enforceOfflineScript(),
      routes: VMNET8,
      gets: `${WSL_PEER}|DEFAULT\n`,
      sshConnection: `${WSL_PEER} 54321 192.168.70.128 22`,
      failAdd: `${WSL_PEER}/32`,
    })
    expect(result.code).toBe(1)
    expect(result.ops).toEqual([])
    expect(result.report.ok).toBe(false)
    expect(result.report.state).toBe('online')
    expect(result.report.changed).toBe(false)
    expect(result.report.defaultRoutes).toHaveLength(1)
    expect(result.report.internetRoute).not.toBeNull()
    expect(result.report.errors.join('\n')).toContain('control channel')
  })

  it('records the preserve route even when the default-route delete fails', async () => {
    // So restore can still take the spare host route back out. The recorded
    // state is what makes the leftover recoverable without the app.
    const { result } = await run({
      script: enforceOfflineScript(),
      routes: VMNET8,
      gets: `${WSL_PEER}|DEFAULT\n`,
      sshConnection: `${WSL_PEER} 54321 192.168.70.128 22`,
      failDel: 'default',
    })
    expect(result.code).toBe(1)
    expect(result.report.ok).toBe(false)
    expect(result.report.state).toBe('online')
    expect(result.report.errors.join('\n')).toContain('could not drop')
    expect(result.state).toContain(`added ${WSL_PEER}/32 via 192.168.70.2 dev ens160`)
  })

  it('drops an IPv6 default route too', async () => {
    // Otherwise a AAAA-only destination stays reachable and the habit device has
    // a hole in it.
    const { result } = await run({
      script: enforceOfflineScript(),
      routes: `${VMNET8}-6|default|via fe80::1 dev ens160 metric 100 pref medium\n`,
      gets: `${WSL_PEER}|DEFAULT\n`,
      sshConnection: `${WSL_PEER} 54321 192.168.70.128 22`,
    })
    expect(result.ops).toEqual([
      `add -4 ${WSL_PEER}/32 via 192.168.70.2 dev ens160`,
      'del -4 default',
      'del -6 default',
    ])
    expect(result.report.state).toBe('offline')
  })

  it('finds the peer through ss when SSH_CONNECTION is unset, as it is over vmrun', async () => {
    // vmrun runs the script from vmtoolsd, which has no ssh session. vmrun
    // itself needs no networking, but the xterm.js terminal bridge holds its own
    // ssh connection to the guest, and this is what keeps that alive.
    const { result } = await run({
      script: enforceOfflineScript(),
      routes: VMNET8,
      gets: `${WSL_PEER}|DEFAULT\n`,
      ssOut: `0      0      192.168.70.128:22      ${WSL_PEER}:41022`,
    })
    expect(result.ops).toEqual([
      `add -4 ${WSL_PEER}/32 via 192.168.70.2 dev ens160`,
      'del -4 default',
    ])
  })

  it('drops the default route with nothing preserved when no client is connected', async () => {
    // vmrun with no terminal open. There is no control channel over the network
    // to protect, so there is nothing to preserve — and this is exactly the case
    // that would lock ssh out until restore or a revert.
    const { result } = await run({
      script: enforceOfflineScript(),
      routes: VMNET8,
    })
    expect(result.ops).toEqual(['del -4 default'])
    expect(result.report.state).toBe('offline')
    expect(result.report.preserved).toEqual([])
  })
})

describe('restoreNetworkScript, executed', () => {
  it('is the inverse of enforce: default route back, then the spare route out', async () => {
    const first = await run({
      script: enforceOfflineScript(),
      routes: VMNET8,
      gets: `${WSL_PEER}|DEFAULT\n`,
      sshConnection: `${WSL_PEER} 54321 192.168.70.128 22`,
    })
    const { result } = await run({ script: restoreNetworkScript() }, first.dir)

    expect(result.code).toBe(0)
    expect(result.report.ok).toBe(true)
    expect(result.report.state).toBe('online')
    expect(result.report.changed).toBe(true)
    expect(result.report.enforced).toBe(false)
    // Ordering again, mirrored: the default route is back before the specific
    // one goes away, so the reply path is never worse than it already was. The
    // log is shared with the enforce run above, whose two ops come first.
    expect(result.ops).toEqual([
      `add -4 ${WSL_PEER}/32 via 192.168.70.2 dev ens160`,
      'del -4 default',
      'add -4 default via 192.168.70.2 dev ens160 proto dhcp src 192.168.70.128 metric 100',
      `del -4 ${WSL_PEER}/32`,
    ])
    // Back to the machine we started with, attributes included.
    expect(result.routes.sort()).toEqual(VMNET8.split('\n').filter((l) => l !== '').sort())
    expect(result.state).toBeNull()
    expect(result.report.internetRoute).not.toBeNull()
  })

  it('does nothing, and says so, when there is nothing recorded and a route out exists', async () => {
    const { result } = await run({ script: restoreNetworkScript(), routes: VMNET8 })
    expect(result.code).toBe(0)
    expect(result.report.ok).toBe(true)
    expect(result.report.changed).toBe(false)
    expect(result.report.state).toBe('online')
    expect(result.ops).toEqual([])
  })

  it('names the snapshot revert when there is no record and no default route', async () => {
    // The honest answer, rather than guessing at a gateway. Nothing inside the
    // guest can reconstruct a route it has no record of.
    const { result } = await run({
      script: restoreNetworkScript(),
      routes: '-4|192.168.70.0/24|dev ens160 proto kernel scope link\n',
    })
    expect(result.code).toBe(1)
    expect(result.report.ok).toBe(false)
    expect(result.report.state).toBe('offline')
    expect(result.report.errors.join('\n')).toContain('clean snapshot')
    expect(result.ops).toEqual([])
  })

  it('keeps the preserve route when the default route does not come back', async () => {
    const first = await run({
      script: enforceOfflineScript(),
      routes: VMNET8,
      gets: `${WSL_PEER}|DEFAULT\n`,
      sshConnection: `${WSL_PEER} 54321 192.168.70.128 22`,
    })
    const { result } = await run({ script: restoreNetworkScript(), failAdd: 'default' }, first.dir)

    // The mirror of enforce's abort. Deleting the host route here would leave the
    // guest with no default route AND no path to the ssh client — the one state
    // nothing inside the guest can repair — and it would do it on the failure this
    // module explicitly flags as unverified. So the route stays, the state file
    // stays so a retry is possible, and the call reports failure.
    expect(result.report.state).toBe('offline')
    expect(result.report.ok).toBe(false)
    expect(result.code).toBe(1)
    expect(result.report.errors.join('\n')).toContain('keeping the preserve route')
    expect(result.ops).toEqual([`add -4 ${WSL_PEER}/32 via 192.168.70.2 dev ens160`, 'del -4 default'])
    expect(result.routes).toContain(`-4|${WSL_PEER}/32|via 192.168.70.2 dev ens160`)
    // Kept, so a later restoreNetwork retries rather than meeting the
    // "no record of what removed it" branch.
    expect(result.state).not.toBeNull()
    expect(result.report.preserved).toEqual([`${WSL_PEER}/32 via 192.168.70.2 dev ens160`])
  })

  it('still removes the preserve route when something else already restored the default', async () => {
    // NetworkManager re-adding the route on a DHCP renewal is the case that makes
    // "did `ip route add` succeed" the wrong question: the add fails with `File
    // exists` and the guest is online anyway. The check is a read-back, so this
    // must not be confused with the failure above.
    const first = await run({
      script: enforceOfflineScript(),
      routes: VMNET8,
      gets: `${WSL_PEER}|DEFAULT\n`,
      sshConnection: `${WSL_PEER} 54321 192.168.70.128 22`,
    })
    const routesFile = join(first.dir, 'routes')
    await writeFile(
      routesFile,
      `${await readFile(routesFile, 'utf8')}-4|default|via 192.168.70.2 dev ens160 proto dhcp metric 100\n`,
      'utf8',
    )

    const { result } = await run({ script: restoreNetworkScript() }, first.dir)

    expect(result.code).toBe(0)
    expect(result.report.ok).toBe(true)
    expect(result.report.state).toBe('online')
    expect(result.report.notes.join('\n')).toContain('File exists')
    expect(result.ops).toEqual([
      `add -4 ${WSL_PEER}/32 via 192.168.70.2 dev ens160`,
      'del -4 default',
      `del -4 ${WSL_PEER}/32`,
    ])
    expect(result.state).toBeNull()
  })
})

describe('offlineStatusScript, executed', () => {
  it('reads the guest without changing it', async () => {
    const { result } = await run({
      script: offlineStatusScript(),
      routes: VMNET8,
      gets: `${WSL_PEER}|DEFAULT\n`,
    })
    expect(result.report.ok).toBe(true)
    expect(result.report.state).toBe('online')
    expect(result.report.enforced).toBe(false)
    expect(result.report.changed).toBe(false)
    expect(result.report.defaultRoutes).toEqual([
      'default via 192.168.70.2 dev ens160 proto dhcp src 192.168.70.128 metric 100',
    ])
    expect(result.ops).toEqual([])
    expect(result.routes).toEqual(VMNET8.split('\n').filter((l) => l !== ''))
  })

  it('names the preserve routes an enforcement it did not run left behind', async () => {
    const first = await run({
      script: enforceOfflineScript(),
      routes: VMNET8,
      gets: `${WSL_PEER}|DEFAULT\n`,
      sshConnection: `${WSL_PEER} 54321 192.168.70.128 22`,
    })
    const { result } = await run({ script: offlineStatusScript() }, first.dir)
    expect(result.report.state).toBe('offline')
    expect(result.report.enforced).toBe(true)
    expect(result.report.preserved).toEqual([`${WSL_PEER}/32 via 192.168.70.2 dev ens160`])
    expect(result.report.internetRoute).toBeNull()
    expect(result.ops).toEqual(first.result.ops)
  })
})
