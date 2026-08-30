/**
 * The server's own configuration, separated from `index.ts` so it can be tested
 * without starting anything. Nothing in this module has a side effect: importing
 * `index.ts` runs `loadVmConfig`, `loadBank`, `chooseTransport` and `serve`,
 * which is why `HOST` — one character away from binding every interface — had no
 * test at all. Purity was never the obstacle; reachability was.
 */

/**
 * Same validation shape as `loadVmConfig`'s RHCSA_SSH_PORT: a typo would
 * otherwise reach `serve` as `NaN` and fail with something that names neither
 * the variable nor the value.
 *
 * Moved here verbatim, including the two acceptances it shares with
 * `loadVmConfig` (`'0x50'` is 80, `' 22 '` is 22). Changing the parsing shape
 * while extracting it is what would make the extraction unreviewable; both are
 * parked for the whole-branch review.
 */
export function readPort(raw: string | undefined): number {
  const port = Number(raw ?? 5175)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`RHCSA_PORT must be a port number, got ${JSON.stringify(raw)}`)
  }
  return port
}

/**
 * Loopback only. This is a single-user local trainer (spec section 1), and
 * `/ws/terminal` is an unauthenticated shell in a guest where `student` has
 * passwordless sudo — without a hostname, `serve` passes `undefined` to
 * `server.listen`, which binds `::` and hands that shell to every device that
 * can route here. Measured, not assumed, and pinned by a test that reads
 * `server.address()` back.
 */
export const HOST = '127.0.0.1'

/** Vite's default dev port, which Task 24's UI is served from. */
export const VITE_DEV_PORT = 5173

/**
 * The origins a browser may open `/ws/terminal` from. Loopback binding does not
 * cover this: a WebSocket upgrade is exempt from the same-origin policy, and a
 * page on any site can reach `ws://localhost` through the user's own browser.
 *
 * Exact strings, deliberately. Every near miss — a trailing slash, a different
 * scheme, a different case — is a different origin, and loosening any of them
 * would only add ways in.
 */
export function allowedOriginsFor(port: number, vitePort: number): ReadonlySet<string> {
  return new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    `http://localhost:${vitePort}`,
    `http://127.0.0.1:${vitePort}`,
  ])
}
