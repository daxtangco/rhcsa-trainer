import { serve, type ServerType } from '@hono/node-server'
import { readFile } from 'node:fs/promises'
import { Server } from 'node:http'
import { join } from 'node:path'
import { checkCoverage, loadBank } from '../engine/content/bank.ts'
import { loadTaskScripts } from '../engine/validate/harness.ts'
import { loadVmConfig } from '../engine/vm/config.ts'
import { chooseTransport } from '../engine/vm/select.ts'
import { VmController } from '../engine/vm/vmrun.ts'
import { createApp } from './app.ts'
import {
  allowedOriginsFor,
  coverageBanner,
  HOST,
  readPort,
  refuseToServe,
  serveOptions,
  VITE_DEV_PORT,
} from './config.ts'
import { createLabRuntime } from './lab.ts'
import { SessionStore } from './session.ts'
import { attachTerminal } from './terminal.ts'

// Wiring only. Everything with a decision in it lives in config.ts, where a
// test can reach it without this module's four side effects.
const PORT = readPort(process.env.RHCSA_PORT)
const CONTENT = process.env.RHCSA_CONTENT ?? 'content'
const SNAPSHOT = process.env.RHCSA_SNAPSHOT ?? 'clean'
const ALLOWED_ORIGINS = allowedOriginsFor(PORT, VITE_DEV_PORT)

const cfg = loadVmConfig(process.env)
const bank = await loadBank(CONTENT)

// `loadBank` validates each file against its schema; it does not resolve the
// references between them. `checkCoverage` does, and until now it ran only in
// `rhcsa coverage` — a command nothing invokes on the way here — so a task
// pointing at a concept id that does not exist served a hint ladder with rung 3
// quietly short and scored the attempt anyway. The rule itself is in `config.ts`,
// where a test can reach it; see `refuseToServe` for why `problems` refuses and
// the two gap lists only report.
const coverage = checkCoverage(bank)
const refusal = refuseToServe(coverage)
if (refusal !== undefined) {
  console.error(`rhcsa-trainer: ${refusal}`)
  process.exit(1)
}

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

// The options come from `config.ts` so that `hostname` cannot be dropped here
// without a test noticing: this module has four import-time side effects and
// cannot be imported, so a test can only reach this line through `serveOptions`.
const server: ServerType = serve(serveOptions(app.fetch, PORT))

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
console.log(coverageBanner(coverage))
