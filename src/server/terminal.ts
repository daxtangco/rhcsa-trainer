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

  return {
    write: (d) => void child.stdin.write(d),
    resize: () => {
      // Not possible without a local PTY. Deliberately silent: the client is
      // told the size is fixed when it connects.
    },
    kill: () => void child.kill(),
    onData: (cb) => {
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', cb)
      child.stderr.on('data', cb)
    },
    onExit: (cb) => child.on('exit', (code) => cb(code ?? 0)),
  }
}

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
}

/** Attach a WebSocket endpoint at /ws/terminal to an existing HTTP server. */
export function attachTerminal(server: Server, deps: TerminalDeps): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })
  const spawnPty = deps.spawnPty ?? spawnSshPipe

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
      const pty = spawnPty(deps.cfg, cols, rows)
      const b = bridge(pty, {
        send: (d) => {
          if (ws.readyState === ws.OPEN) ws.send(d)
        },
        close: () => ws.close(),
      })
      ws.on('message', (data) => b.onMessage(data.toString()))
      ws.on('close', () => b.onClose())
    })
  })

  return wss
}
