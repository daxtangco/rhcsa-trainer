import { serve, type ServerType } from '@hono/node-server'
import { readFile } from 'node:fs/promises'
import { Server } from 'node:http'
import { join } from 'node:path'
import { loadBank } from '../engine/content/bank.ts'
import { loadTaskScripts } from '../engine/validate/harness.ts'
import { loadVmConfig } from '../engine/vm/config.ts'
import { chooseTransport } from '../engine/vm/select.ts'
import { VmController } from '../engine/vm/vmrun.ts'
import { createApp } from './app.ts'
import { createLabRuntime } from './lab.ts'
import { SessionStore } from './session.ts'
import { attachTerminal } from './terminal.ts'

/**
 * Same validation shape as `loadVmConfig`'s RHCSA_SSH_PORT: a typo would
 * otherwise reach `serve` as `NaN` and fail with something that names neither
 * the variable nor the value.
 */
function readPort(raw: string | undefined): number {
  const port = Number(raw ?? 5175)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`RHCSA_PORT must be a port number, got ${JSON.stringify(raw)}`)
  }
  return port
}

const PORT = readPort(process.env.RHCSA_PORT)
const CONTENT = process.env.RHCSA_CONTENT ?? 'content'
const SNAPSHOT = process.env.RHCSA_SNAPSHOT ?? 'clean'

/**
 * Loopback only. This is a single-user local trainer (spec section 1), and
 * `/ws/terminal` is an unauthenticated shell in a guest where `student` has
 * passwordless sudo — without a hostname, `serve` passes `undefined` to
 * `server.listen`, which binds `::` and hands that shell to every device that
 * can route here. Measured, not assumed.
 */
const HOST = '127.0.0.1'

/** Vite's default dev port, which Task 24's UI is served from. */
const VITE_DEV_PORT = 5173

/**
 * The origins a browser may open `/ws/terminal` from. Loopback binding does not
 * cover this: a WebSocket upgrade is exempt from the same-origin policy, and a
 * page on any site can reach `ws://localhost` through the user's own browser.
 */
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${VITE_DEV_PORT}`,
  `http://127.0.0.1:${VITE_DEV_PORT}`,
])

const cfg = loadVmConfig(process.env)
const bank = await loadBank(CONTENT)
const assertLib = await readFile(join(CONTENT, 'lib', 'assert.sh'), 'utf8')
const transport = await chooseTransport(cfg)
const controller = new VmController(cfg)

const app = createApp({
  bank,
  runtime: createLabRuntime({ transport, controller, snapshot: SNAPSHOT }),
  sessions: new SessionStore(),
  assertLib,
  loadScripts: loadTaskScripts,
  now: () => Date.now(),
})

const server: ServerType = serve({ fetch: app.fetch, port: PORT, hostname: HOST })

// `serve` returns `Server | Http2Server | Http2SecureServer`. Only the plain
// node:http server emits `upgrade` the way `attachTerminal` needs, and we never
// pass an http2 `createServer`, so this narrows rather than casts — a double cast
// through `unknown` here would be an admission that nobody checked.
if (!(server instanceof Server)) {
  throw new Error('expected a node:http server from serve(); the terminal cannot attach')
}
attachTerminal(server, { cfg, allowedOrigins: ALLOWED_ORIGINS })

console.log(`rhcsa-trainer api on http://${HOST}:${PORT} (transport: ${transport.kind})`)
console.log(`  ${bank.tasks.length} tasks, ${bank.concepts.length} concepts`)
