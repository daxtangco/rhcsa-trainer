import { createServer, type Server } from 'node:http'
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { attachTerminal, bridge, type PtyLike } from '../../src/server/terminal.ts'
import type { VmConfig } from '../../src/engine/vm/config.ts'

function fakePty() {
  const written: string[] = []
  const resized: Array<[number, number]> = []
  let onData: (d: string) => void = () => {}
  let onExit: (code: number) => void = () => {}
  const pty: PtyLike = {
    write: (d) => written.push(d),
    resize: (cols, rows) => resized.push([cols, rows]),
    kill: () => onExit(0),
    onData: (cb) => {
      onData = cb
    },
    onExit: (cb) => {
      onExit = cb
    },
  }
  return { pty, written, resized, emit: (d: string) => onData(d), exit: (c: number) => onExit(c) }
}

function fakeSocket() {
  const sent: string[] = []
  let closed = false
  return {
    sent,
    get closed() {
      return closed
    },
    send: (d: string) => sent.push(d),
    close: () => {
      closed = true
    },
  }
}

describe('bridge', () => {
  it('forwards guest output to the socket', () => {
    const { pty, emit } = fakePty()
    const sock = fakeSocket()
    bridge(pty, sock)
    emit('[student@rhcsa ~]$ ')
    expect(sock.sent).toEqual(['[student@rhcsa ~]$ '])
  })

  it('forwards typed input to the guest', () => {
    const { pty, written } = fakePty()
    const sock = fakeSocket()
    const b = bridge(pty, sock)
    b.onMessage(JSON.stringify({ type: 'input', data: 'lsblk\r' }))
    expect(written).toEqual(['lsblk\r'])
  })

  it('forwards a resize', () => {
    const { pty, resized } = fakePty()
    const b = bridge(pty, fakeSocket())
    b.onMessage(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }))
    expect(resized).toEqual([[120, 40]])
  })

  it('ignores malformed frames instead of killing the session', () => {
    // A dropped keystroke is annoying. A terminal that dies mid-task loses work.
    const { pty, written } = fakePty()
    const b = bridge(pty, fakeSocket())
    b.onMessage('not json')
    b.onMessage(JSON.stringify({ type: 'nonsense' }))
    b.onMessage(JSON.stringify({ type: 'input' }))
    b.onMessage(JSON.stringify({ type: 'resize', cols: '80', rows: 24 }))
    b.onMessage('null')
    b.onMessage('[1,2,3]')
    expect(written).toEqual([])
  })

  it('closes the socket when the shell exits', () => {
    const { pty, exit } = fakePty()
    const sock = fakeSocket()
    bridge(pty, sock)
    exit(0)
    expect(sock.closed).toBe(true)
  })

  it('kills the shell when the socket closes', () => {
    const { pty } = fakePty()
    const sock = fakeSocket()
    let killed = false
    const b = bridge({ ...pty, kill: () => (killed = true) }, sock)
    b.onClose()
    expect(killed).toBe(true)
  })
})

const CFG = {
  vmx: '/vm/rhcsa.vmx',
  ip: '192.168.226.128',
  sshUser: 'student',
  sshPort: 22,
  sshKey: '/home/u/.ssh/rhcsa_lab',
  vmrun: '/vmrun.exe',
} satisfies VmConfig

/**
 * A real loopback HTTP server on an ephemeral port, torn down before the test
 * returns. A WebSocket upgrade cannot be exercised honestly without one: the
 * whole point of these tests is the handshake, and a fake socket would let the
 * origin gate pass by never reaching it.
 */
async function withServer(
  allowedOrigins: ReadonlySet<string>,
  fn: (port: number, spawned: Array<[number, number]>) => Promise<void>,
): Promise<void> {
  const spawned: Array<[number, number]> = []
  const server: Server = createServer()
  const wss = attachTerminal(server, {
    cfg: CFG,
    allowedOrigins,
    spawnPty: (_cfg, cols, rows) => {
      spawned.push([cols, rows])
      return fakePty().pty
    },
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0

  try {
    await fn(port, spawned)
  } finally {
    wss.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/** Resolves 'open' if the upgrade succeeded, 'refused' if the socket died. */
function connect(port: number, path: string, origin?: string): Promise<'open' | 'refused'> {
  return new Promise((resolve) => {
    const ws =
      origin === undefined
        ? new WebSocket(`ws://127.0.0.1:${port}${path}`)
        : new WebSocket(`ws://127.0.0.1:${port}${path}`, { origin })
    ws.on('open', () => {
      resolve('open')
      ws.close()
    })
    ws.on('error', () => resolve('refused'))
    ws.on('close', () => resolve('refused'))
  })
}

const ALLOWED = new Set(['http://localhost:5175', 'http://localhost:5173'])

describe('attachTerminal', () => {
  it('refuses an upgrade from a foreign origin and spawns no shell', async () => {
    // `student` has passwordless sudo in the guest, and a WebSocket upgrade is
    // not subject to the same-origin policy - so without this gate any page the
    // user visits gets an interactive root shell in the lab VM. Loopback
    // binding does not help: the request comes from the user's own browser.
    await withServer(ALLOWED, async (port, spawned) => {
      expect(await connect(port, '/ws/terminal', 'https://anywhere.example')).toBe('refused')
      expect(spawned).toEqual([])
    })
  })

  it('accepts an upgrade from an allowed origin and spawns the shell at the requested size', async () => {
    await withServer(ALLOWED, async (port, spawned) => {
      expect(
        await connect(port, '/ws/terminal?cols=90&rows=25', 'http://localhost:5173'),
      ).toBe('open')
      expect(spawned).toEqual([[90, 25]])
    })
  })

  it('accepts an upgrade with no Origin header at all', async () => {
    // Deliberate: a non-browser client such as wscat sends no Origin, and a
    // browser always sends one. This is the part that looks like a hole and
    // is not.
    await withServer(ALLOWED, async (port, spawned) => {
      expect(await connect(port, '/ws/terminal')).toBe('open')
      expect(spawned).toHaveLength(1)
    })
  })

  it('refuses an upgrade on any other path', async () => {
    await withServer(ALLOWED, async (port, spawned) => {
      expect(await connect(port, '/ws/nope')).toBe('refused')
      expect(spawned).toEqual([])
    })
  })
})
