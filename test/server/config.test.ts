import { serve } from '@hono/node-server'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  allowedOriginsFor,
  HOST,
  readPort,
  serveOptions,
  VITE_DEV_PORT,
} from '../../src/server/config.ts'

describe('readPort', () => {
  it('defaults to 5175', () => {
    expect(readPort(undefined)).toBe(5175)
  })

  it('accepts a port in range', () => {
    expect(readPort('8080')).toBe(8080)
  })

  it('names the variable and quotes the value on anything it cannot use', () => {
    // The empty string is the interesting one: `?? 5175` does not apply to it,
    // so it reaches Number() as 0 and the range check is what catches it. Same
    // shape as loadVmConfig's RHCSA_SSH_PORT, on purpose.
    for (const raw of ['', 'abc', '0', '70000', '-1', '5175.5']) {
      expect(() => readPort(raw)).toThrow(/RHCSA_PORT must be a port number/)
      expect(() => readPort(raw)).toThrow(JSON.stringify(raw))
    }
  })
})

describe('allowedOriginsFor', () => {
  it('is exactly the four loopback origins the UI can be served from', () => {
    const origins = allowedOriginsFor(5175, VITE_DEV_PORT)
    expect([...origins].sort()).toEqual([
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5175',
      'http://localhost:5173',
      'http://localhost:5175',
    ])
  })

  it('admits no near miss', () => {
    // Exact matching is the point: every one of these is a different origin, and
    // this set is the only authentication in front of an interactive shell.
    const origins = allowedOriginsFor(5175, 5173)
    for (const bad of [
      'http://evil.com',
      'http://localhost:5175/',
      'https://localhost:5175',
      'HTTP://LOCALHOST:5175',
      'http://[::1]:5175',
      'null',
      '',
    ]) {
      expect(origins.has(bad)).toBe(false)
    }
  })
})

describe('HOST', () => {
  it('is loopback', () => {
    expect(HOST).toBe('127.0.0.1')
  })

  it('makes serve() bind loopback and return a node:http server', async () => {
    // The regression test for mandate 2(a), and the reason this module exists:
    // without `hostname`, @hono/node-server passes undefined to server.listen,
    // which binds `::` and hands an unauthenticated shell in a passwordless-sudo
    // guest to every device that can route here. Measured both ways; nothing in
    // the codebase would have failed if the argument were dropped.
    //
    // Built by `serveOptions`, not by a literal here: this way the test drives the
    // same object `index.ts` passes rather than a lookalike assembled in the test.
    const server = serve(serveOptions(() => new Response('ok'), 0))
    try {
      // `attachTerminal` needs the `upgrade` event, which only the plain
      // node:http server emits - so index.ts's narrowing has to hold.
      expect(server instanceof Server).toBe(true)

      if (server.address() === null) await once(server, 'listening')
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        throw new Error(`expected an AddressInfo, got ${JSON.stringify(addr)}`)
      }
      expect(addr.address).toBe('127.0.0.1')
      expect(addr.family).toBe('IPv4')
    } finally {
      // A listening socket must not outlive the test.
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('serveOptions', () => {
  it('names the hostname, so the caller has none of its own to forget', () => {
    const fetch = () => new Response('ok')
    expect(serveOptions(fetch, 5175)).toEqual({ fetch, port: 5175, hostname: '127.0.0.1' })
  })

  it('is what production actually calls', async () => {
    // The last link, and it has to be checked as text. `index.ts` runs
    // `loadVmConfig`, `loadBank`, `chooseTransport` and `serve` at import time, so
    // no test can import it - which is why deleting `hostname: HOST` from the one
    // line that binds the socket broke nothing, while the test above passed. This
    // fails if that line stops going through `serveOptions`, including by being
    // "simplified" back to an inline object literal.
    const src = await readFile(
      fileURLToPath(new URL('../../src/server/index.ts', import.meta.url)),
      'utf8',
    )
    expect(src).toContain('serve(serveOptions(app.fetch, PORT))')
    // And there is exactly one `serve(` call *with an argument*, so a second one
    // cannot appear beside it carrying its own options. The `[^)]` is what keeps
    // the empty `serve()` in the narrowing error's message out of the count.
    expect(src.match(/\bserve\([^)]/g)).toHaveLength(1)
  })
})
