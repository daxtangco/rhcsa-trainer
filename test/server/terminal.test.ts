import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { connect as netConnect, type Socket } from 'node:net'
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
  attachTerminal,
  bridge,
  type PtyLike,
  type TerminalDeps,
} from '../../src/server/terminal.ts'
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
  fn: (port: number, spawned: Array<[number, number]>, kills: () => number) => Promise<void>,
  over: { cfg?: VmConfig; realPty?: boolean; heartbeatMs?: number } = {},
): Promise<void> {
  const spawned: Array<[number, number]> = []
  let kills = 0
  const server: Server = createServer()
  const deps: TerminalDeps = { cfg: over.cfg ?? CFG, allowedOrigins }
  // Production's 30 s is longer than any test can wait for, which is exactly why
  // the whole heartbeat block used to delete with the suite green.
  if (over.heartbeatMs !== undefined) deps.heartbeatMs = over.heartbeatMs
  // `realPty` runs the production `spawnSshPipe`, which is the only way to
  // exercise the throw `sshArgs` raises on a config with no IP. It spawns
  // nothing: the throw happens before `spawn`.
  if (over.realPty !== true) {
    deps.spawnPty = (_cfg, cols, rows) => {
      spawned.push([cols, rows])
      return {
        ...fakePty().pty,
        kill: () => {
          kills += 1
        },
      }
    }
  }
  const wss = attachTerminal(server, deps)

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0

  try {
    await fn(port, spawned, () => kills)
  } finally {
    wss.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/**
 * Wait for something to become true, and name it when it does not. A bare
 * `await once(...)` on an event that never arrives fails as a five-second test
 * timeout with nothing in it; this says which behaviour went missing.
 */
async function until(pred: () => boolean, what: string, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
}

/**
 * A real handshake over a raw socket, so a test can send a frame the `ws`
 * client would never produce. Resolves once the server has answered 101.
 */
function rawUpgrade(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = netConnect(port, '127.0.0.1', () => {
      sock.write(
        'GET /ws/terminal HTTP/1.1\r\n' +
          `Host: 127.0.0.1:${port}\r\n` +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n` +
          'Sec-WebSocket-Version: 13\r\n\r\n',
      )
    })
    sock.on('error', reject)
    sock.once('data', (buf: Buffer) => {
      const head = buf.toString('latin1')
      if (head.startsWith('HTTP/1.1 101')) resolve(sock)
      else reject(new Error(`handshake failed: ${head.split('\r\n')[0]}`))
    })
  })
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

  it('survives a malformed frame, killing the shell and not the process', async () => {
    // Seven bytes with RSV1 set. `ws` reports a protocol error on the socket,
    // and with no 'error' listener that is an unhandled 'error' event: the
    // process exits and takes grading, sessions and the whole in-memory store
    // with it. `bridge` already says a malformed frame is not worth ending a
    // lab session over; this is the layer below it saying the same thing.
    await withServer(ALLOWED, async (port, spawned, kills) => {
      const sock = await rawUpgrade(port)
      expect(spawned).toHaveLength(1)

      const closed = new Promise<void>((resolve) => sock.on('close', () => resolve()))
      sock.write(Buffer.from([0xc1, 0x81, 0x00, 0x00, 0x00, 0x00, 0x61]))
      await closed

      // The shell behind the bad socket is gone...
      expect(kills()).toBeGreaterThanOrEqual(1)
      // ...and the server is still here to serve the next one.
      expect(await connect(port, '/ws/terminal')).toBe('open')
      expect(spawned).toHaveLength(2)
    })
  })

  it('terminates a socket that stops answering pings and kills the shell behind it', async () => {
    // A raw TCP socket never answers a ping, which is what a closed laptop or a
    // NAT timeout looks like: no FIN, no RST, just silence. Without the
    // heartbeat, `ssh -tt` and a guest PTY stay alive on the machine running the
    // trainer indefinitely. Two beats is the contract - the first ping goes out,
    // the second beat sees no pong and gives up.
    await withServer(
      ALLOWED,
      async (port, spawned, kills) => {
        const sock = await rawUpgrade(port)
        expect(spawned).toHaveLength(1)

        let closed = false
        sock.on('close', () => {
          closed = true
        })
        try {
          // Polled rather than awaited on one event: `terminate()` destroys the
          // socket and emits the server-side 'close' that kills the pty in a
          // separate turn, so asserting on the client's close alone raced it.
          await until(() => closed, 'the silent socket to be terminated')
          await until(() => kills() >= 1, 'the shell behind the dead socket to be killed')
        } finally {
          // The test cleans up its own socket rather than relying on the
          // behaviour under test. Without this, deleting the heartbeat leaves
          // this socket open, `server.close()` waits on it, and the failure
          // arrives as a bare 10 s timeout instead of the sentence above.
          sock.destroy()
        }
      },
      { heartbeatMs: 25 },
    )
  })

  it('leaves a socket that answers its pings alone', async () => {
    // The other half, and the reason the first test is not satisfied by an
    // interval that terminates everything it touches: `ws` answers a ping itself,
    // so an idle-but-live terminal must survive beat after beat.
    await withServer(
      ALLOWED,
      async (port, _spawned, kills) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal`)
        await new Promise<void>((resolve, reject) => {
          ws.on('open', () => resolve())
          ws.on('error', reject)
        })

        try {
          // Five beats' worth of silence from the user, all of them answered.
          await new Promise<void>((resolve) => setTimeout(resolve, 260))

          expect(ws.readyState).toBe(WebSocket.OPEN)
          expect(kills()).toBe(0)
        } finally {
          // Same reason as above: a failed assertion here must not leave a live
          // socket for `server.close()` to wait on.
          ws.close()
        }
      },
      { heartbeatMs: 50 },
    )
  })

  it('tells the client why the terminal cannot start instead of taking the API down', async () => {
    // `chooseTransport` falling back to vmrun is a supported setup, and there
    // `cfg.ip` is empty - so `sshArgs` throws inside handleUpgrade's callback,
    // which is on no promise chain. The endpoint stays attached and fails per
    // connection, because Task 24 renders the tab either way and a tab that
    // explains itself beats a tab that 404s. The message has to arrive over the
    // socket: the student is looking at the tab, not at the server's stderr.
    const noIp = { ...CFG, ip: '' } satisfies VmConfig
    await withServer(
      ALLOWED,
      async (port) => {
        const seen: string[] = []
        const code = await new Promise<number>((resolve) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal`)
          ws.on('message', (d) => seen.push(d.toString()))
          ws.on('close', (c: number) => resolve(c))
          ws.on('error', () => resolve(-1))
        })

        expect(seen.join('')).toMatch(/RHCSA_VM_IP/)
        expect(code).toBe(1011)
        // The handshake itself succeeds - that is what "attach and fail per
        // connection" means - and the endpoint is still there for the next
        // attempt rather than having ended the process on this one.
        expect(await connect(port, '/ws/terminal')).toBe('open')
      },
      { cfg: noIp, realPty: true },
    )
  })
})
