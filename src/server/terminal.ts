import { spawn } from 'node:child_process'
import type { Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { VmConfig } from '../engine/vm/config.ts'
import { sshArgs } from '../engine/vm/ssh.ts'

/**
 * The minimum a pseudo-terminal has to do. `spawnSshPipe` is the one
 * implementation — a plain pipe to `ssh -tt`, no native dependency, which
 * matters because this environment cannot install a compiler. The interface
 * exists so `bridge` can be tested against a fake instead of a subprocess.
 */
export interface PtyLike {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): void
  onExit(cb: (code: number) => void): void
}

export interface SocketLike {
  send(data: string): void
  close(): void
}

export interface Bridge {
  onMessage(raw: string): void
  onClose(): void
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Wire a terminal to a socket. Pure plumbing, no I/O of its own, which is why
 * every branch is testable without a guest.
 */
export function bridge(pty: PtyLike, socket: SocketLike): Bridge {
  pty.onData((d) => socket.send(d))
  pty.onExit(() => socket.close())

  return {
    onMessage(raw) {
      let msg: unknown
      try {
        msg = JSON.parse(raw)
      } catch {
        // A malformed frame is not worth ending a lab session over.
        return
      }
      if (!isRecord(msg)) return

      if (msg.type === 'input' && typeof msg.data === 'string') pty.write(msg.data)
      else if (
        msg.type === 'resize' &&
        typeof msg.cols === 'number' &&
        typeof msg.rows === 'number'
      ) {
        pty.resize(msg.cols, msg.rows)
      }
    },
    onClose() {
      pty.kill()
    },
  }
}

/**
 * A terminal over a plain pipe to `ssh -tt`. `-tt` forces a PTY on the *guest*
 * side, which is what vim, less and nmtui need; the local side does not need one
 * because xterm.js is the terminal. The cost is that resize is a no-op, so the
 * Lab screen fixes the terminal size (see Task 24).
 *
 * The ssh options come from `sshArgs`, the same list `SshTransport` uses, so the
 * terminal cannot end up trusting a different host key than the grader does.
 */
export function spawnSshPipe(cfg: VmConfig, cols: number, rows: number): PtyLike {
  // stty at connect time is the only chance to tell the guest the size.
  const remote = `stty cols ${cols} rows ${rows}; exec /bin/bash -l`
  const child = spawn('ssh', [...sshArgs(cfg), '-tt', remote], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let onData: (data: string) => void = () => {}
  let onExit: (code: number) => void = () => {}

  // A spawn failure - no `ssh` on PATH - emits 'error' and never 'exit'. With
  // no listener that is an unhandled 'error' event, which ends the whole
  // process: the first terminal click takes grading and every open session down
  // with it. Report it into the terminal instead, then end this pty only.
  child.on('error', (e: Error) => {
    onData(`\r\n[terminal] ssh could not start: ${e.message}\r\n`)
    onExit(1)
  })
  // Same reasoning one layer down: once the guest side is gone, the next
  // keystroke writes to a closed pipe and the stream emits EPIPE. A dropped
  // keystroke is the correct outcome; a dead API is not.
  child.stdin.on('error', () => {})

  return {
    write: (d) => void child.stdin.write(d),
    resize: () => {
      // Not possible without a local PTY. Deliberately silent: the client is
      // told the size is fixed when it connects.
    },
    kill: () => void child.kill(),
    onData: (cb) => {
      onData = cb
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', cb)
      child.stderr.on('data', cb)
    },
    onExit: (cb) => {
      onExit = cb
      child.on('exit', (code) => cb(code ?? 0))
    },
  }
}

/**
 * How often to ping an idle terminal, and how long a socket has to answer.
 * A connection that dies without FIN or RST - a closed laptop, a NAT timeout -
 * otherwise leaves `ssh -tt` and a guest PTY alive indefinitely, and this is a
 * tool that runs on one laptop next to the VM it drives.
 */
const HEARTBEAT_MS = 30_000

export interface TerminalDeps {
  cfg: VmConfig
  /**
   * Origins a browser is allowed to open the terminal from. Required, with no
   * default: this is the only authentication in front of an interactive shell,
   * and a default would make forgetting it fail open.
   */
  allowedOrigins: ReadonlySet<string>
  /** Injection point for the tests; production always gets `spawnSshPipe`. */
  spawnPty?: (cfg: VmConfig, cols: number, rows: number) => PtyLike
  /**
   * The second injection point, and it exists for the same reason as the first:
   * at 30 s no test can wait for a beat, so the entire heartbeat block - interval,
   * `pong` handler, `terminate` - deleted with the suite still green. Production
   * leaves this unset.
   */
  heartbeatMs?: number
}

/** Attach a WebSocket endpoint at /ws/terminal to an existing HTTP server. */
export function attachTerminal(server: Server, deps: TerminalDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })
  const spawnPty = deps.spawnPty ?? spawnSshPipe

  // This listener owns every upgrade the server receives: anything that is not
  // /ws/terminal is destroyed below. A second WebSocket endpoint added later
  // cannot simply call `server.on('upgrade')` too - its handshakes would be
  // destroyed by this one - so the two would have to share one listener that
  // dispatches on pathname.
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    // A WebSocket upgrade is not subject to the same-origin policy, so without
    // this any page the user visits could open an interactive shell in the lab
    // VM - where `student` has passwordless sudo. Loopback binding does not help
    // here: the request comes from the user's own browser.
    //
    // A *missing* Origin is allowed on purpose: a non-browser client such as
    // wscat sends none, and a browser always sends one. That is the part of this
    // check that looks like a hole and is not.
    const origin = req.headers.origin
    if (origin !== undefined && !deps.allowedOrigins.has(origin)) {
      socket.destroy()
      return
    }
    if (url.pathname !== '/ws/terminal') {
      socket.destroy()
      return
    }
    const cols = Number(url.searchParams.get('cols') ?? 100) || 100
    const rows = Number(url.searchParams.get('rows') ?? 30) || 30

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      const send = (d: string) => {
        if (ws.readyState === ws.OPEN) ws.send(d)
      }

      let pty: PtyLike
      try {
        pty = spawnPty(deps.cfg, cols, rows)
      } catch (e) {
        // `sshArgs` throws whenever `cfg.ip` is empty, which is exactly the
        // supported vmrun setup - and this callback is not on any promise
        // chain, so an escaping throw ends the process. The student is looking
        // at a terminal tab, not at the server's stderr, so the reason has to
        // arrive over the socket before it closes.
        send(`\r\n[terminal] cannot start: ${e instanceof Error ? e.message : String(e)}\r\n`)
        ws.close(1011, 'terminal unavailable')
        return
      }

      const b = bridge(pty, { send, close: () => ws.close() })
      ws.on('message', (data) => b.onMessage(data.toString()))

      // A malformed *frame* - as opposed to malformed JSON inside a valid one,
      // which `bridge` already swallows - makes `ws` emit 'error'. With no
      // listener that is an unhandled 'error' event and the process exits,
      // taking every session with it. Same policy as `bridge`: one bad frame
      // ends this terminal, not the trainer.
      ws.on('error', (e: Error) => {
        console.error(`[terminal] socket error, ending this terminal: ${e.message}`)
        b.onClose()
      })

      // Liveness, not politeness: `ws` answers a ping itself, so a socket that
      // misses a pong is one whose peer is gone without having said so.
      let alive = true
      ws.on('pong', () => {
        alive = true
      })
      const beat = setInterval(() => {
        if (!alive) {
          ws.terminate()
          return
        }
        alive = false
        ws.ping()
      }, deps.heartbeatMs ?? HEARTBEAT_MS)
      // An open terminal must not be the reason the process cannot exit.
      beat.unref()

      ws.on('close', () => {
        clearInterval(beat)
        b.onClose()
      })
    })
  })

  return wss
}
