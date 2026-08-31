# Task 24 — mandated changes to the brief

Nine **required** changes. They override `task-24-brief.md` wherever they
conflict; everything else in the brief stands — the prompt-on-top-plus-rail
layout, hints opening below the terminal rather than in the rail, F2/F4/F8
instead of control keys, the fixed 100×30 terminal, `window.confirm` on Reset,
Reset not refunding the rung, the two-terminal dev setup with no combined `dev`
script, and the commit message.

**Read the measurement warning first, and read it as a correction to what this file
used to claim.** The earlier draft said every claim below was "a command I ran on
this host with the output pasted, or a line I quote from the Task 23 brief", and
tallied one wrong measurement. Both statements were false.

Task 22 alone produced **four** wrong claims of mine — including a mandate that
told its implementer a grader's `date -u` was load-bearing when the `-u` *was* the
bug, and a rationale I endorsed rather than measured for a failure mode that could
not occur. All four were caught by reviewers, none by me.

Worse, and specific to this file: **`COMMAND`, run at dispatch — `react`,
`react-dom`, `@testing-library/react`, `jsdom`, `tailwindcss` and `@xterm/xterm`
are all absent from `node_modules` right now.** Step 1 of this task installs them.
So five of the items in the section below are not measurements of anything; they
are me recalling how React, Testing Library and jsdom behave, for libraries that
are not on this machine. They are labelled `RECALLED` accordingly, and that is the
weakest label on the page. `vite@7.3.6` **is** installed, so the one item that
depends on it is checkable.

**Confirm anything you depend on with your own command, whatever the label. If your
measurement disagrees with mine, yours wins — say so in the report and act on
yours.** The earlier draft's instruction not to spend a review finding on these is
withdrawn: that sentence is what let Task 22's F1 through, and here it was guarding
claims about software that was not installed.

Two of these mandates (1 and 2) are about the same failure the whole project is
built to prevent: something reporting success while not doing what was asked.
Mandate 1 is a feature that can never fire whose test passes anyway; mandate 2
is a false pass arriving on the student's screen.

---

## Checked and believed fine — with the strength of each check named

I suspected each of these and checked it. The labels: `COMMAND` = I ran it and pasted
output. `READ` = I quote the Task 23 brief or a repo file by line. `RECALLED` = I am
recalling documented library behaviour **for a package that is not installed on this
host**, which is the weakest claim on this page and the one most worth your own
five-minute check once Step 1 has installed it. `TRACED` = I executed the logic by
hand. `DESIGN` = not a fact at all, but a decision of mine you may disagree with.

Thirteen items. The split — counted with a grep and `uniq -c`, because I got it wrong
by hand on the first attempt at this very sentence — is **4 `READ` / 7 `RECALLED` /
1 `TRACED` / 1 `DESIGN`**. Only the four `READ` items rest on something I can point at
in this repo. Nine of thirteen rest on my recall or my reasoning, which is not what
the previous version of this header told you.

- `READ` — **`TaskSummary` matches Task 23's `summary()` field for field** — id, title,
  chapter, scope, difficulty, timeBudget, weight, rebootCheck, transport,
  objectives (task-23-brief.md:1127-1140). All ten, same names, same order. The
  picker's `Math.round(t.timeBudget / 60)` will not render `NaN`.
- `READ` — **`StartedSession` matches the `POST /api/sessions` response field for
  field** — id, taskId, title, prompt, mode, rung, maxRung, checkpointTotal,
  timeBudget, rebootCheck, transport (task-23-brief.md:1233-1243). All ten. (The
  *meaning* of `transport` is wrong — that is mandate 1 — but the field is
  present and typed correctly.)
- `READ` — **The terminal wire protocol is correct in both directions.** I went looking
  for a `[object Blob]` bug and there isn't one. `spawnSshPipe` calls
  `child.stdout.setEncoding('utf8')` and `child.stderr.setEncoding('utf8')`
  before subscribing (task-23-brief.md:1563-1567), so `onData` yields **strings**,
  so `socket.send(d)` sends a **text** frame, so `String(ev.data)` in
  `TerminalPane` receives a string and never a Blob. `setEncoding` also means
  `StringDecoder` holds back partial multi-byte sequences instead of splitting a
  UTF-8 character across two frames. Server-side inbound is handled too:
  `ws.on('message', (data) => b.onMessage(data.toString()))`
  (task-23-brief.md:1601) converts the Buffer. **Do not add `binaryType`
  handling and do not change `String(ev.data)`.**
- `READ` — **The stated test counts are right.** I counted the `it` blocks: **5** in
  `api.test.ts` (Step 6 says 5) and **11** in `rail.test.tsx` (Step 10 says 11).
  **Report the totals you observe anyway** — Tasks 21-23 are landing tests
  around you, and Task 21 has already moved the baseline to 246/23.
- `RECALLED` (Testing Library not installed) — **`screen.getByText('01:30 / 10:00')` works.** I checked how Testing Library
  matches: `getNodeText` joins only the **direct text-node children** of a node,
  and `{mmss(elapsedS)}`, `{' / '}`, `{mmss(session.timeBudget)}` are all direct
  text children of that one div, so its joined text is exactly
  `01:30 / 10:00`. The same reasoning is why the transport-mismatch and
  persistence-failure assertions match despite the `<code>` child and the
  multi-line JSX literal (the default normalizer collapses the newlines). Leave
  all of these as exact-string or regex as written.
- `RECALLED` (React not installed) — **`hint.getAttribute('disabled')` is the right assertion.** React renders a
  boolean attribute, so a disabled button yields `""` — falsy, but **not null**,
  which is what `not.toBeNull()` tests. Do not "improve" it to
  `toHaveAttribute` (that needs `@testing-library/jest-dom`, which is not
  installed and is not needed — every assertion here uses `toBeDefined()` or
  `getAttribute`). **Do not install jest-dom.**
- `RECALLED` (React not installed) — **Native `.click()` needs no `act()` here.** Both click tests pass `vi.fn()`
  handlers that update no React state, so there is no state update outside
  `act` to warn about. Do not convert them to `fireEvent` or `userEvent`.
- `RECALLED` (jsdom not installed) — **`vi.spyOn(window, 'confirm')` works in jsdom** — jsdom defines
  `window.confirm` (as a not-implemented stub), so it is spy-able and
  `mockReturnValue` replaces it.
- `RECALLED`, though `vite@7.3.6` is installed so you can check this one now — **`"types": ["node", "vite/client"]` is right, and no `declarations.d.ts` is
  needed.** `vite/client` is what declares `*.css` as a module. `vitest/globals`
  is *not* needed in `types` even though `globals: true` is set, because every
  test imports `describe`/`it`/`expect` from `'vitest'` explicitly —
  `globals: true` is there for Testing Library's auto-cleanup at runtime, which
  is exactly what the brief's comment says.
- `RECALLED` — **Step 1 before Step 2 is the correct order** — `"types": ["vite/client"]`
  fails outright until vite is installed, which is why Task 1 did not set it. (vite
  *is* installed now, so if you want this one measured, measure it.)
- `RECALLED` — **`res.ok` covers the 201 from `POST /api/sessions`** (200-299). This one
  is the fetch spec and I am not worried about it.
- `TRACED` — **The `working = busy !== undefined && busy !== null` guard is correct** and
  the brief's explanation of it is right: `busy` is optional, so an omitted prop
  arrives as `undefined`, and `undefined !== null` would disable every button
  for every caller that does not pass it — including the test's `props`.
- `DESIGN` — **Reset not refunding the rung is deliberate and correct**, and so is the
  expectation that the terminal dies with the revert. Do not add reconnection
  logic; that is Phase 2.

---

## 1. The transport-mismatch warning can never fire, and its test passes anyway

```tsx
  const mismatch =
    props.serverTransport !== undefined && props.serverTransport !== session.transport
```

`session.transport` comes from `POST /api/sessions`, which sets it to
`deps.runtime.transportKind` — **the server's** transport
(task-23-brief.md:1243). `props.serverTransport` comes from `/api/health`, which
returns `deps.runtime.transportKind` (task-23-brief.md:1166) — the same value.
So `mismatch` compares a value to itself and is **false for every real
session**. The banner telling the student to go work at the VMware console
because this task cannot be driven over ssh is unreachable code.

The test passes because it hand-builds `session({ transport: 'vmrun' })` against
`serverTransport="ssh"`, a state the server cannot produce. Nor can Task 23
catch it: its `TASK` fixture is `transport: 'ssh'` (line 782) and its fake
runtime is `transportKind: 'ssh'` (line 826), so `expect(body.transport)
.toBe('ssh')` passes under either meaning of the field. A green suite on both
sides of a dead feature.

**Fixed on the Task 23 side** — see `task-23-mandates.md` mandate 10, which adds
`taskTransport: task.transport` to the response alongside
`transport: deps.runtime.transportKind`, and requires a test that distinguishes
them. **Task 24's part:**

- Add `taskTransport: 'ssh' | 'vmrun'` to `StartedSession`.
- Change the comparison to the two things that can actually differ:
  ```tsx
    // The task's requirement against the server's reality. Comparing
    // session.transport here would compare the server's transport to itself:
    // both it and /api/health report runtime.transportKind.
    const mismatch =
      props.serverTransport !== undefined && session.taskTransport !== props.serverTransport
  ```
- Keep the existing test, and **add one that pins the negative**: a session
  whose `taskTransport` equals `serverTransport` must render no warning
  (`expect(screen.queryByText(/needs the vmrun transport/i)).toBeNull()`). A
  positive-only test is what let this through in the first place.
- The banner hardcodes the word "vmrun" in prose while interpolating
  `props.serverTransport`. Interpolate `session.taskTransport` too, so it stays
  true if the pair ever inverts.

If Task 23 landed without mandate 10 — check the actual `src/server/app.ts`, do
not assume — then **report it and stop rather than working around it**. A
Task 24-side workaround would mean re-fetching `/api/tasks/:id` purely to learn
a field the session response should have carried.

## 2. The truncated-grader false pass must reach the screen as words

Task 23 mandate 7 adds `incomplete: boolean` and `expectedTotal: number` to
`GradeReport`, because `reportFor` derives `total` from the checkpoints that
actually arrived: a grader that stopped partway (a 124 timeout, a wedged `lvs`,
an early `exit`) reports `passed: 3, total: 3, allPassed: true` while the
session's static `checkpointTotal` says 7.

As briefed, `GradeReportView` has neither field, so the rail renders
**"3 / 3 passed"** with no indication that four checkpoints never ran. The whole
point of computing `incomplete` server-side is lost at the last step.

**Required:**

- Add `incomplete: boolean` and `expectedTotal: number` to `GradeReportView`.
- Render it as prominently as the persistence failure, in the same style, above
  the tally — not as a badge:
  ```tsx
      {report?.incomplete === true ? (
        <div className="rounded border border-rose-800 bg-rose-950/40 p-2 text-xs text-rose-200">
          The grader reported {report.total} of {report.expectedTotal} checkpoints and then
          stopped. This is not a score: the ones that never ran are unknown, not passed.
        </div>
      ) : null}
  ```
- **Add one rail test**: a report with `incomplete: true`, `passed: 3`,
  `total: 3`, `expectedTotal: 7`, `allPassed: false` must render
  `/is not a score/i`, and must **not** be presented as a pass.

Same reasoning as the persistence message the brief already argues for: this is
one of the two outputs the design exists to produce, so it does not get to be a
subtle badge.

## 3. The Vite dev origin must be in the terminal's allowlist

Task 23 mandate 2 requires an `Origin` check on the `/ws/terminal` upgrade
(without it, any page the user visits can open a shell in a guest where
`student` has passwordless sudo). In dev, the page is served by Vite on
**`http://localhost:5173`** and the WebSocket is proxied to `:5175`. **A proxied
upgrade forwards the browser's `Origin`**, so if the allowlist only holds the
server's own origin, the terminal will never connect in development — and the
symptom will look exactly like the `ws: true` proxy bug the brief warns about at
Step 14, which is the wrong thing to go debug.

**Required:** confirm by reading `src/server/terminal.ts` and
`src/server/index.ts` that the allowed set contains `http://localhost:5173` and
`http://127.0.0.1:5173`, and that the port is not hardcoded in two places. If it
is missing, add it in `index.ts` where the set is built — not in `terminal.ts`.
State in the report which file you checked and what the set contained. If
Task 23's origin check is absent entirely, **say so as a finding and do not
silently rely on its absence** — a working terminal is not evidence the check
exists.

Vite's dev server binds to localhost by default, so no change is needed in
`vite.config.ts`.

## 4. Three of the four new `as` casts are unnecessary — measured

The project has six `as` casts in `src/`, all guarded-union idioms parked for a
single later sweep, and the global constraint bans them. The brief adds four
sites. I measured three of them away.

**Two `as unknown as typeof fetch` in `test/web/api.test.ts` are not needed.**
The fake is directly assignable. Probe run under `strict`,
`noUncheckedIndexedAccess`, `erasableSyntaxOnly`, `verbatimModuleSyntax` and
`lib: ["ES2023","DOM","DOM.Iterable"]`:

```ts
  const impl: typeof fetch = async (input, init) => {
    const url = String(input)
    seen.push({ url, init })
    const [status, body] = handler(url, init)
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }
  const nonJson: typeof fetch = async () => new Response('<html>502</html>', { status: 502 })
```
```
$ tsc --noEmit -p tsconfig.json
CLEAN: no cast needed
```

Annotate the variable instead of casting the expression, and let the parameter
types be inferred — `RequestInfo` is `Request | string`, so the brief's explicit
`string | URL | Request` was already exactly right and simply did not need the
cast. Drop both.

**`(body as { error?: string }).error` is not needed.** Same probe, clean:

```ts
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
function errorMessage(body: unknown): string | undefined {
  if (isRecord(body) && typeof body['error'] === 'string') return body['error']
  return undefined
}
```

`src/engine/content/objectives.ts` already has an `isRecord` helper of exactly
this shape — copy it rather than importing engine code into the web layer.

**`return body as T` stays, as the single documented exception.** Comment it:

```ts
    // The one cast in the web layer. A generic JSON client cannot narrow to `T`
    // without a per-route validator, and five hand-written validators for a
    // single-user local app is a worse trade than one honest cast at the
    // deserialization boundary. Everything downstream of this line is trusted
    // only as far as the server is.
    return body as T
```

`Ruling: allow exactly one `as` cast in `src/web/api.ts` at the JSON
deserialization boundary, and eliminate the other three. The alternative that
truly removes it is a validator per route, which is Phase 2 work and buys little
against a server in the same repo; the alternative that hides it is letting
JSON.parse's `any` flow through unannotated, which is the same unsoundness with
none of the visibility. Cost if wrong: a malformed server response becomes a
runtime TypeError in the browser instead of a caught ApiError — annoying in
development, invisible to the student, and never a wrong grade.`

## 5. `SessionMode` is declared twice

`src/server/session.ts` declares `export type SessionMode = 'guided' | LadderMode`
(task-23-brief.md:541). The brief re-declares it in `src/web/api.ts` as a
hand-written `'guided' | 'practice' | 'drill' | 'exam'`. Two definitions of one
concept, and the client's copy is the one that will silently fail to notice a
new mode — while `TaskPicker`'s `MODES` array, which drives the actual buttons,
is a *third* place the list appears.

**Required:** import it, type-only, and re-export so the web layer still has one
name to use:

```ts
// Type-only, so `verbatimModuleSyntax` erases it and no server code reaches the
// bundle. One definition: a mode the ladder gains must not be a mode the picker
// silently cannot offer.
import type { SessionMode } from '../server/session.ts'
export type { SessionMode }
```

Then **prove the erasure** rather than asserting it: run `npm run build:web` and
show that the bundle contains no server code —
`grep -c "hono\|node:child_process" dist/assets/*.js` should be 0, or the build
should fail loudly if it is not. Paste it. Leave `TaskPicker`'s `MODES` array as
it is (the labels and blurbs are copy, not a type), but add a comment there
saying it must cover every `SessionMode`.

## 6. `TerminalPane`'s `onStatus` dependency reconnects the WebSocket on every render

```tsx
  }, [cols, rows, onStatus])
```

`App` does not pass `onStatus` today, so this is latent. The first caller that
passes an inline arrow — the natural way to write it — gets a new function
identity on every render, so the effect tears down the terminal, closes the
WebSocket, kills the guest-side `ssh -tt`, and reconnects. It would present as a
terminal that flickers and loses scrollback, and the cause would not be in
`TerminalPane`.

**Required:** hold the callback in a ref and drop it from the deps.

```tsx
  const statusRef = useRef(onStatus)
  // Kept in a ref so an inline arrow from a caller does not re-create the
  // terminal and reconnect the socket on every render. Only a real size change
  // should tear this down.
  statusRef.current = onStatus

  useEffect(() => {
    ...
    ws.onopen = () => statusRef.current?.('open')
    ...
  }, [cols, rows])
```

Also **narrow the effect's `cols`/`rows` justification in the comment**: they are
deps because a size change genuinely requires a new connection (`stty` runs once
at connect time), which is worth saying beside the dep array.

## 7. Nothing is disabled after Finish

Once `finish` returns, the attempt is over and a rating has been recorded from
it. But Hint, Grade and Reset stay enabled, and the F2/F4/F8 handler still
fires — so the student can grade again after finishing and watch the displayed
report change underneath a rating that describes an earlier state, or press
Reset and revert the VM on a closed session.

**Required:**

- Pass `finished={rating !== null}` to `Rail`, add `finished?: boolean` to
  `RailProps`, and fold it into the disable condition for Hint, Grade and Reset.
  Leave Finish itself disabled as it already is (`report === undefined || working`)
  and add `|| finished`.
- Gate the key handler: `if (session === undefined || rating !== null) return`,
  with `rating` added to its dep array.
- Render one line saying why the controls are inactive, next to the rating box
  that already appears — a disabled button with no explanation reads as a bug.
- Add a rail test: with `finished`, the Grade button is disabled.

Also, **`doFinish` is the only handler that does not `setError(null)` first**, so
a stale error from a previous grade stays on screen through a successful finish.
One line.

## 8. `environmentMatchGlobs` is deprecated in the installed Vitest

Measured: `vitest/3.2.7 linux-x64 node-v22.23.2`, and `package.json` pins
`"vitest": "^3.0.0"`. `environmentMatchGlobs` is deprecated in 3.x and removed
in 4.0. It works today; it emits a deprecation warning, and `^3.0.0` will not
carry you into 4.

Use the per-file docblock instead, which is version-proof and needs no config
mechanism at all. At the top of `test/web/rail.test.tsx`:

```tsx
// @vitest-environment jsdom
```

Then `vitest.config.ts` changes only in the ways it must: add the `react()`
plugin and add `'test/**/*.test.tsx'` to `include`. **Keep the `RHCSA_VM` gate,
`globals: true`, both `exclude` arms and `testTimeout` verbatim, along with the
brief's comments explaining each** — the brief is right that dropping the gate
makes `npm test` try to drive a hypervisor and dropping `globals` silently
disables DOM cleanup. Drop only `environmentMatchGlobs`.

This is also strictly better than the glob: `test/web/api.test.ts` stays in the
Node environment, where its `Response` and `fetch` are Node 22's real ones rather
than jsdom's. Confirm in the report that `api.test.ts` still passes in Node, and
paste whether any deprecation warning appears in the `npx vitest run` output.

## 9. `GradeReportView.phase` does not exist on the server's `GradeReport`

`GradeReport` is `{ passed, total, allPassed, rebooted, rebootError?,
regressionCount, checkpoints?, regressions? }` (task-23-brief.md:586-595) — no
`phase`. The view type's `phase?: string` is always `undefined`, and an optional
field that can never arrive is a claim about the API that is not true. Remove
it. (The phase does exist on `SessionView` and on `finish`'s wrapper; those are
correct.)

---

## Step 16 is deferred — all fourteen checks

Step 16 drives the whole app in a browser against the real VM. **Neither
exists**: the RHEL 9 ISO is a user-owned blocker, and there is no browser on this
host. Ruling: mark Step 16 deferred, the same way Task 19's Step 5, Task 21's
Step 12, Task 22's Steps 9-10 and Task 23's Step 20 are.

**Three of its expectations are predictions about content, not assertions.** Do
not encode any of them in a test, and do not "fix" code to match them:

- "The picker lists **five** tasks" is true only after Task 22 lands.
- "`3 / 5 passed`" in check 9 depends on Task 21's final grader emitting exactly
  five checkpoints with exactly three passing on an untouched machine.
- "Expect a rating of `hard`" in check 8 depends on the rung reached.

Step 16 remains the real Phase 1 exit criterion — checks 4, 5 and 6 are the
moment the student learns the concept from a card and solves the lab without a
book — so it must survive into the acceptance checklist verbatim, with a note
that steps 12-13 (the persistence message) and 9-11 (masking) are the two that
would most easily rot unnoticed. Task 25 owns that checklist; say in the report
that you handed it over rather than dropping it.

In the report, list what each numbered check will prove when it runs, and state
plainly that **no part of this task has ever been rendered in a browser**. Every
`.tsx` file here is validated only by `tsc` and by jsdom, which is why Step 15's
`tsc --noEmit` is not optional and why the brief is right to say so.

## Out of scope

- **No VM operations.** Do not start, stop, snapshot, revert, or delete a
  snapshot on any VM. The user's Ubuntu and Windows 11 guests are unrelated.
- **No `sudo` on this WSL host** — there is no TTY and it cannot authenticate.
- **Do not run `scripts/provision.sh`** — it powers on a VM and copies 10 GB.
- **Do not create, read, or modify `.env.local`.** It may hold the user's real
  VM password. Do not run `ssh-keygen` or write anything into
  `/home/daxtangco/.ssh/`.
- **Do not start `npm run dev:server` or `npm run dev:web` and leave them
  running.** `dev:server` needs `RHCSA_VMX` and a guest. `vite build` is the
  only build you need, and mandate 5 requires it once.
- **Never** read or copy `.env`, `.env.sandbox`, or `.env.example` from
  `/home/daxtangco/sechelp-tools` — an unrelated project's real secrets.
- Do not modify anything under `src/engine/`. The only non-web files this task
  touches are `package.json`, `vitest.config.ts`, `tsconfig.json`, and — if and
  only if mandate 3 finds it missing — nothing: report it instead.
- Do not touch the parked `as` cast sites in `src/` or the parked
  `new URL(...).pathname` test files.
- Do not add `@testing-library/jest-dom`, a `declarations.d.ts`, or a combined
  `dev` script.
- Do not dispatch subagents.

## Verify before committing

1. Mandate 1: the new negative rail test, and a quote of the actual
   `taskTransport` line in `src/server/app.ts` proving Task 23 landed mandate 10.
2. Mandate 2: the new incomplete-report rail test.
3. Mandate 3: which file you read for the origin allowlist and what it contained.
4. Mandate 4: `grep -rnE "\bas ([A-Z]|unknown|const\b)" src/ test/ | grep -v "as const"`
   — pasted. Exactly one new line, in `src/web/api.ts`, and no
   `as unknown as` anywhere.
5. Mandate 5: `npm run build:web` plus the grep proving no server code in the
   bundle.
6. Mandate 8: the `npx vitest run` output including whether any deprecation
   warning appears, and confirmation that `api.test.ts` ran in the Node
   environment.
7. `npx vitest run` and `npm run typecheck` both clean. **Report the totals you
   observe**; read the baseline from `git log` and your own run, not from any
   number in this file — Task 21 already moved it to 246/23 and Tasks 22 and 23
   land before you.
8. `git status --porcelain` empty after committing, and stage **by name** —
   never `git add -A`, never `git commit -a`. Files outside this task's list are
   not yours: do not revert or commit them, just note them.

Report to `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-24-report.md`
as a real file, including every pasted run above, the observed totals, the
Step 16 deferral with what each of the fourteen checks will prove and the
handover to Task 25's checklist, and an explicit statement that nothing in this
task has been rendered in a real browser.

---

## 10. Four requirements produced by the Task 23 review, after these mandates were written

These arrive from Task 23's task review and its two fix rounds (`b7c7f61`,
`8083796`), all of which landed **after** mandates 1-9 above. Items 10.3 and 10.4
**correct** things written earlier in this file — where they disagree with mandate
2 or mandate 3, item 10 wins.

### 10.1 Exam mode must not surface concept-card links

`GET /api/concepts/:id` is ungated: it returns a full concept card with no
session, mode or rung check, one hop from the concept ids that
`/api/tasks/:area/:slug` already hands you. Task 23's reviewer reported this as
rung 3 being reachable in exam mode, which is true.

**I ruled the API stays open.** The user's stated purpose for this whole app is
that it *replaces the book*; a concept library reachable only by failing a hint
ladder is a worse book than the book. So the gate does not belong in the API —
**it belongs in your UI, and it is yours to build.**

**Required:** in `mode === 'exam'`, the session view must not render a link,
button or other affordance that opens a concept card. Not disabled-but-visible —
absent. The `MAX_RUNG` table (practice 5 / drill 3 / exam 2) already stops the
*hint* endpoint from handing over card content in exam mode; this closes the
other door, which is the student clicking through to the same card from the task
view.

- Add one rail/session test: the same task rendered with `mode: 'exam'` shows no
  concept-card affordance, and with `mode: 'practice'` shows them. Assert both
  arms — a test that only checks the exam arm passes on a component that never
  renders cards at all.
- Do **not** change `/api/concepts/:id`, and do not add a mode parameter to it.
  Typing the URL by hand in exam mode is a student choosing to self-sabotage one
  rehearsal, which is a fair thing to let them do.

### 10.2 A foreign-origin refusal check, in a real browser, in Step 16

Task 23's `Origin` allowlist is the only thing standing between any page the
student visits and a shell in a guest where `student` has passwordless `sudo`.
It is tested server-side against a real handshake, including the cross-origin
refusal arm — but **never through a browser**, and a browser is the only client
that sets `Origin` on its own.

**Required:** add one check to Step 16's deferred manual list (so it becomes
fifteen, not fourteen — say so explicitly rather than renumbering silently):

> Serve a one-line page from a *different* origin — `python3 -m http.server 8123`
> in an empty directory is enough — open `http://localhost:8123`, and in the
> console run `new WebSocket('ws://localhost:5175/ws/terminal')`. Expect the
> connection to fail and **no** terminal to attach. Record the console text
> verbatim. A successful connection here is a stop-the-line finding, not a note.

Write it into the checklist with the same "what this proves" framing as the other
checks. It is manual because the automated arm cannot set a foreign `Origin` the
way a browser does — say that in the checklist so a later reader does not
"simplify" it into a unit test.

### 10.3 `transport` names two different things — correction to what you will read

On the `/api/tasks` summaries (`src/server/app.ts:56`) `transport` is the
**task's** transport: which control plane that lab requires. On `/api/health`, on
the session response and in `view()`, `transport` is the **server's**: which
control plane is live. Task 23 chose this deliberately and its reviewer agreed
with the choice, so it is not a defect to fix in the server.

**It is a trap for you specifically**, because you read `/api/tasks` and will get
the other meaning of a field name you also see elsewhere. **Required:** in
`src/web/api.ts`, give the two a distinguishable name at the UI boundary —
`taskTransport` on the task summary type, or a comment at the field naming which
one it is if renaming ripples further than one line. Whichever you choose, state
it in the report. Do not silently rely on having guessed right.

### 10.4 `total`, `passed` and `expectedTotal` are distinct-id counts — and mandate 3's pointer moved

Two corrections to what mandates 2 and 3 above tell you:

**(a) The units in mandate 2's message are now distinct checkpoint ids, not
lines.** Task 23's review found that my own mandate 7 compared a line count to a
distinct-id count, so a grader emitting one id twice and then dying reported
`allPassed: true` for a checkpoint that never ran. Fixed in `session.ts`: inside
**`reportFor`**, `total` is now `statusById(v).size` and `passed` filters over
that same map, while `expectedTotal` is the distinct-id count `countCheckpoints`
produced before anything ran.

*Deliberately no line number here.* The `src/server/session.ts:171-177` this
paragraph used to cite is now the middle of `countCheckpoints`'s heredoc loop —
that function has been rewritten three times and the file has grown by roughly a
hundred lines since I wrote this mandate, with a fourth round in flight. Search
for `reportFor`. This is the fourth pointer of mine that a later fix round has
moved, so read every `file:line` in these mandates as a hint and the symbol name
as the real address.

**Mandate 2's copy is unchanged and still correct** — "reported 3 of 7
checkpoints and then stopped" is now genuinely 3 distinct checkpoints of 7. Keep
the wording; just do not "improve" it into anything that implies a line count,
and do not compute your own tally from a checkpoint array length.

**(b) Mandate 3 tells you to add the Vite origin "in `index.ts` where the set is
built". The set no longer lives there.** Task 23's fix round extracted it to a
side-effect-free `src/server/config.ts`; **`allowedOriginsFor(port, vitePort)`** is
the whole set and `index.ts` only calls it. I have since checked the set myself,
`MEASURED` and re-confirmed: it contains all four of `http://localhost:${port}`,
`http://127.0.0.1:${port}`, `http://localhost:${vitePort}`,
`http://127.0.0.1:${vitePort}`, with `VITE_DEV_PORT = 5173` declared once in
`config.ts` and not hardcoded twice — note both Vite entries interpolate the
constant rather than spelling `5173`, so changing it moves all of them.

*This paragraph said `config.ts:49` until I re-checked: round 3 inserted
`serveOptions` above it and the function is now twenty lines lower.* Same rule as
(a) — search for the symbol.
So mandate 3's requirement is **already satisfied** — your job there is reduced
to confirming it in `config.ts` (not `index.ts`, not `terminal.ts`) and saying so
in the report. If you find it otherwise, that is a finding and my measurement was
stale: report it rather than working around it.

### 10.5 A fifth requirement, produced by Task 23's round-6 review. Ruling, not a suggestion.

Two things about `GradeReport` that change what mandate 2 has to render. Both measured at `28ad7f0`.

**(a) Do not re-AND `allPassed` with `!incomplete`.** `session.ts:591` already computes
`allPassed: allPassed(v) && !incomplete`. The field you receive is the conjunction. Re-applying
`!incomplete` in the UI is harmless today but states a false thing about the contract, and the next person
to change one side will get a double negation. Read `allPassed` as final.

**(b) `incomplete` cannot be your only truncation signal, and this is the important half.**
`incomplete` is `status.size < expectedTotal` (`session.ts:569`). When a lexer defect makes
`expectedTotal` **0**, `incomplete` is `0 < 0` → **false**, and a grader that died a third of the way down
reports `allPassed: true`. Measured: one injected line takes grader 019's count from 8 to 0.

The runtime signature of that bug is the **opposite** comparison: more distinct ids arrived than were
declared. `session.ts:579-584` already detects it and calls `console.warn("… countCheckpoints
under-counted this grader")` — a signal that currently reaches a server log and nothing else.

**So: render a distinct, visible warning when `total > expectedTotal`**, separate from mandate 2's
truncation copy. Suggested words, and keep them about trust rather than blame — this is never the
student's fault: *"This lab's checkpoint count is wrong (N reported, M expected). The result may be
unreliable — please re-run."* Do **not** turn it into a failed verdict: `session.ts:571-578` deliberately
warns rather than fails, because an over-arrival means the counter is wrong, not the machine, and failing
a correct run over a bad count is the exact mistake that guard exists to avoid. Keep that property.

A `countSuspect` report field is parked for the whole-branch fix dispatch (P24). **Do not add it here** —
derive the condition from `total` and `expectedTotal`, which you already receive.

**Test both.** One test where `total > expectedTotal` renders the count warning and does **not** render a
failure verdict; one where `expectedTotal === 0` with a nonempty all-passing checkpoint list renders the
count warning even though `allPassed` is `true` and `incomplete` is `false`. That second test is the one
that would have caught this class, so do not let it assert only that the screen did not crash.
