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
 * Everything `serve` needs, assembled here so `hostname` cannot be dropped from
 * the one call that binds the socket. Testing `HOST` proved only that a test's
 * own `serve` call binds loopback; `index.ts` has four import-time side effects
 * and cannot be imported, so deleting `hostname: HOST` from *it* broke nothing.
 * With the options built here, the production line has no hostname of its own to
 * lose, and a test can assert on the object.
 */
export function serveOptions(fetch: FetchLike, port: number): ServeOptions {
  return { fetch, port, hostname: HOST }
}

/** Narrower than `@hono/node-server`'s `FetchCallback`, and enough for both callers. */
type FetchLike = (request: Request) => Response | Promise<Response>

export interface ServeOptions {
  fetch: FetchLike
  port: number
  hostname: string
}

/**
 * What the server should do about a bank whose cross-references do not resolve,
 * decided here rather than in `index.ts` for the same reason `serveOptions` is:
 * `index.ts` has import-time side effects and cannot be imported, so a rule
 * written inline there is a rule no test can reach.
 *
 * `checkCoverage` existed for the whole branch and **ran only in
 * `rhcsa coverage`**, a command nothing invokes on the way to serving. So a task
 * pointing at a concept id that does not exist reached the browser: rung 3 renders
 * `task.requiresConcepts.map(...)`, a missing id resolves to `undefined`, and
 * `contextFor` filters it out silently — the student asks for the concept card
 * that explains the thing they are stuck on and is handed a shorter list, with no
 * error anywhere. `deriveRating` then scores an attempt made without the
 * disclosure the ladder promised.
 *
 * Ruled between refuse-to-serve and log-loudly by **splitting on which list**, and
 * the split is forced by measurement rather than taste:
 *
 * - `problems` — refuse. Every entry is a dangling reference: an unknown concept
 *   id, an unknown objective id, an unknown prerequisite. Each one is a lie the
 *   content tells about itself, none is a judgement call, and the shipped bank has
 *   **zero** of them, so refusing costs a correct bank nothing and a broken one
 *   exactly the right amount.
 * - `uncoveredObjectives` / `untaughtConcepts` — log the counts. These are
 *   *incompleteness*, not incorrectness: 5 shipped tasks cannot cover 68 RHCSA
 *   objectives — 58 are uncovered today — and `rhcsa coverage --strict` is red on
 *   the shipped bank for that reason. Refusing on them would refuse to serve the
 *   bank this project ships, which is not a guard, it is a broken build.
 *
 * Returns the operator-facing message, or `undefined` to serve.
 */
export function refuseToServe(report: { problems: readonly string[] }): string | undefined {
  if (report.problems.length === 0) return undefined
  return [
    `the content bank has ${report.problems.length} unresolved reference(s), so it cannot be served:`,
    ...report.problems.map((p) => `  - ${p}`),
    'Run `rhcsa coverage` for the same report. A task pointing at a concept id that does not',
    'exist serves a hint ladder with a rung quietly missing, and scores the attempt anyway.',
  ].join('\n')
}

/**
 * The gap counts, for the startup banner. Said out loud on every boot because the
 * numbers are expected to be non-zero and an operator should still know them —
 * `rhcsa coverage --strict` is the gate that treats them as failures, and it is a
 * separate command on purpose.
 */
export function coverageBanner(report: {
  uncoveredObjectives: readonly string[]
  untaughtConcepts: readonly string[]
}): string {
  return (
    `  ${report.uncoveredObjectives.length} uncovered objective(s), ` +
    `${report.untaughtConcepts.length} untaught concept(s) — not errors; run \`rhcsa coverage\` for the list`
  )
}

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
