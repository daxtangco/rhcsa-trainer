# Task 24 — the Lab screen. Implementation report

**Status: DONE_WITH_CONCERNS.** Every mandate is implemented or measured-and-refused
with the measurement pasted. The concerns are all of one kind: **no part of this task
has ever been rendered in a real browser**, and the fifteen Step-16 checks that would
render it need a RHEL 9 guest that does not exist on this host yet.

**Commit:** `7dbaaf4b01ff85be5060b887b730ac20f5a81f71` on `phase-0-1`, one commit, 15
files, +3512/-44, authored and committed as `daxtangco <daxtangco@localhost>`. Staged by
name (the brief's eight paths, which expand to those 15 files); no `git add -A`, no
`git commit -a`. `git status --porcelain` is empty.

Re-verified **after** committing, so the green run describes the committed tree and not
a dirty working copy:

```
typecheck exit: 0
vitest exit: 0
 Test Files  31 passed (31)
      Tests  379 passed (379)
=== deprecation scan ===
0
=== listening ports 5173/5175 ===
none listening
```

No dev server and no listening process were left behind; none was ever started.

---

## Headline: one defect I introduced and caught, worth reading first

I wrote this comment at the top of `test/web/api.test.ts`:

```ts
// Deliberately no `@vitest-environment jsdom` here. This file stays in the Node
// environment so `Response` and `fetch` are Node 22's real ones ...
```

**That comment switched the file to jsdom.** Vitest regex-scans the source for the
directive and does not care that the sentence around it is a denial. So the file
asserting it runs in Node was running in jsdom, and mandate 8's entire stated benefit
— "`test/web/api.test.ts` stays in the Node environment, where its `Response` and
`fetch` are Node 22's real ones rather than jsdom's" — was silently defeated by the
comment claiming it.

It was caught by the one assertion I added beyond the brief:

```ts
it('runs in the Node environment, not jsdom', () => {
  expect(typeof globalThis.window).toBe('undefined')
})
```

```
 FAIL  test/web/api.test.ts > createApi > runs in the Node environment, not jsdom
AssertionError: expected 'object' to be 'undefined' // Object.is equality
Expected: "undefined"
Received: "object"
```

It is fixed (the comment no longer names the directive, and says why not), and the
assertion stays. This is the project's recurring defect class exactly — a thing
reporting one state while being in another — and it was caught by measuring against
ground truth rather than by reasoning. Every "confirm X in the report" instruction in
the mandates should be read this way: I turned each into an assertion where I could,
because a confirmation I perform once decays and a confirmation the suite performs
does not.

---

## Test totals — observed, not quoted

```
$ git stash list ; npx vitest run          # at 28ad7f0, before any of my changes
 Test Files  29 passed (29)
      Tests  351 passed (351)
```

```
$ npm run typecheck ; echo $?
0
$ npx vitest run
 ✓ test/web/api.test.ts (8 tests) 61ms
 ✓ test/web/rail.test.tsx (20 tests) 419ms
 Test Files  31 passed (31)
      Tests  379 passed (379)
vitest exit: 0
```

Baseline **351 / 29** → **379 / 31**. I added **28** tests in **2** files: 8 in
`api.test.ts` (the brief's 5, plus the Node-environment pin, a non-string `error`
field, and an `ApiError.status` check) and 20 in `rail.test.tsx` (the brief's 11, plus
9 required by the mandates and by my own false-pass audit).

The brief's stated counts were right as stated: I counted 5 `it` blocks in the brief's
`api.test.ts` and 11 in its `rail.test.tsx`.

### The rail tests are load-bearing — mutation-tested, not asserted

The lead's warning was that a test which renders a component and checks it did not
crash is not a test. Rather than claim otherwise, I mutated `Rail.tsx` once per
guard and recorded which test caught it. Every mutation is caught by exactly the
intended test and nothing else:

```
### M1 revert mismatch to session.transport
   × Rail > warns when the task needs a transport the server is not using
      Tests  1 failed | 17 passed (18)

### M2 drop the incomplete box
   × Rail > refuses to call a truncated grader run a score
      Tests  1 failed | 17 passed (18)

### M7 drop finished from the disable conditions
   × Rail > disables hint, grade and reset once the attempt is finished
      Tests  1 failed | 17 passed (18)

### M10.1 drop the exam-mode concept gate
   × Rail > offers concept cards outside exam mode and hides them inside it
      Tests  1 failed | 17 passed (18)

### M10.5 drop countSuspect from the warning
   × Rail > warns when more checkpoints arrived than the script declares, and does not fail the run
   × Rail > warns on a declared count of zero even though the report says everything passed
      Tests  2 failed | 16 passed (18)

### M10.5 drop countSuspect from the verdict guard
   × Rail > warns when more checkpoints arrived ... and does not fail the run
   × Rail > warns on a declared count of zero even though the report says everything passed
      Tests  2 failed | 16 passed (18)
```

Two further mutations on the persistence guard I added myself:

```
### drop persistenceUntested from the verdict
   × Rail > withholds the pass when the reboot check never ran on a task that declares one
### drop the rebootCheck condition (fires on every task)
   × Rail > does not withhold the pass on a task with no reboot check
```

A third mutation was **not** caught on the first attempt, and this is the useful part:

```
### drop the allPassed condition from persistenceUntested
      Tests  20 passed (20)      <-- no test noticed
```

Dropping `&& report.allPassed` makes the rail print *"Every checkpoint that ran
passed, but the reboot check did not run"* over an 0/5 run — a sentence that is
simply false. I added the missing negative assertion to the existing
"surfaces a guest that never came back" test and re-ran:

```
### drop the allPassed condition from persistenceUntested   (after adding the assertion)
   × Rail > surfaces a guest that never came back
      Tests  1 failed | 19 passed (20)
### restored
      Tests  20 passed (20)
```

Note what this means: **my own new guard had an untested arm, and only the mutation
run found it.** Reasoning about the guard did not find it; measuring did.

---

## Answers to the three questions

### 1. Did any mandate turn out to be wrong?

**Yes — mandate 9's premise is false, though its conclusion is right. And the brief's
Step 1 install line does not resolve.**

**Mandate 9** says `GradeReportView.phase` "is always `undefined`" because `GradeReport`
has no `phase`, and tells me to remove it. `GradeReport` indeed has no `phase` — but
the **grade route** does:

```
src/server/app.ts:287-291
    return c.json({
      phase: s.phase,
      rung: s.rung,
      ...reportFor(s.mode, result, false, s.checkpointTotal),
    })
```

So `phase` (and `rung`) *do* arrive from `POST /api/sessions/:id/grade`. What is true
is that they do **not** arrive inside `finish`'s `report`. The mandate's conclusion —
get `phase?` off `GradeReportView` — is correct, because `GradeReportView` is the type
of both, and an optional field that arrives on one and never on the other is a claim
about the API that is wrong in both directions. Implemented as two types:
`GradeReportView` (the bare report, no `phase`) and
`interface GradeResponse extends GradeReportView { phase: string; rung: number }`,
which is what `grade()` returns. `finish()` returns
`interface FinishResponse extends SessionView { report: GradeReportView; rating: string | null }`,
which is `{...view(s), report, rating}` field for field.

**The brief's Step 1 install line fails outright.** Not a judgement call — measured:

```
npm error Conflicting peer dependency: vite@8.2.2
npm error   peer vite@"^8.0.0" from @vitejs/plugin-react@6.1.1
npm error   peerOptional vite@"^5.0.0 || ^6.0.0 || ^7.0.0-0" from @vitest/mocker@3.2.7
```

Unpinned, `@vitejs/plugin-react` resolves to 6.1.1, which peers `vite ^8`; installed
`vitest@3.2.7` peers `vite ^5||^6||^7.0.0-0`. There is no version of vite that
satisfies both, so the brief's line cannot succeed as written. I did **not** reach for
`--legacy-peer-deps` (that accepts a resolution npm has just told you is broken) or
upgrade vite to 8 (that breaks vitest, which the whole suite runs on). I pinned the
plugin to the last major that peers vite 7:

```
$ npm view @vitejs/plugin-react@5.1.0 peerDependencies --json
{ "vite": "^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0" }
$ npm install -D vite tailwindcss '@vitejs/plugin-react@^5.2.0' @tailwindcss/vite \
    @types/react @types/react-dom @testing-library/react @testing-library/dom jsdom
INSTALL_OK
vite/7.3.6 linux-x64 node-v22.23.2
```

Installed, all confirmed present (the mandates' `RECALLED` items were about packages
that were genuinely absent; they are present now and every one of them I depended on
is now exercised by a passing test rather than recalled):

```
├── @tailwindcss/vite@4.3.3      ├── react@19.2.8
├── @testing-library/dom@10.4.1  ├── react-dom@19.2.8
├── @testing-library/react@16.3.3├── tailwindcss@4.3.3
├── @types/react@19.2.18         ├── vite@7.3.6
├── @types/react-dom@19.2.5      ├── vitest@3.2.7
├── @vitejs/plugin-react@5.2.0   ├── jsdom@30.0.1
├── @xterm/xterm@6.0.0
```

**Mandates that were right and that I verified rather than took:** mandate 4's three
removable casts (measured clean — see below); the `working = busy !== undefined &&
busy !== null` guard; `vi.spyOn(window, 'confirm')` in jsdom; `getAttribute('disabled')`
returning `""` not `null`; native `.click()` needing no `act()`; `screen.getByText('01:30 / 10:00')`
matching on joined direct text children; `"types": ["node", "vite/client"]` making
`import './index.css'` type-check with no `declarations.d.ts`. All of those are now
proven by the 28 passing tests and a clean `tsc`, not by recall.

### 2. What on this screen could tell the user they passed when they did not?

Seven paths. Five were named by the mandates; **two I found by auditing, and one of
those was live.**

| Path | What stops it |
|---|---|
| Truncated grader: `passed: 3, total: 3` while 7 were declared | mandate 2's rose box, `/is not a score/i`, and `verdictFor` returns `null` — no pass claim |
| Counter under-count making `expectedTotal` 0, so `incomplete` is `0 < 0` = false and `allPassed` is `true` | 10.5(b)'s `countSuspect = total > expectedTotal` warning, and `verdictFor` withholds the verdict. Tested at `expectedTotal: 0` with a non-empty all-passing list |
| Grading again after finishing, changing the report under a recorded rating | mandate 7: `finished` disables Hint/Grade/Reset, **and** gates the F2/F4/F8 handler. Server-side `/grade` is 409 on a graded session too, so this is defence in depth |
| Empty verdict reading as "everything passed" | Already closed server-side: `allPassed` requires `checkpoints.length > 0` (`src/engine/grading/verdict.ts:81`). I checked rather than assumed |
| Persistence failure shown as a number | The brief's rose box, in words. Tested |
| **Stale report after a failed re-grade** (live defect, mine to fix) | See below |
| **`allPassed` with the reboot check never run** | See below |

**The live one.** `doGrade` set `busy`, called `api.grade`, and on failure set the
error — leaving the *previous* report on screen. So: grade to 5/5 green, break
something, re-grade into a 500, and the rail still says **"5 / 5 passed. All
checkpoints passed."** with a small error box beside it. That is a pass claim about a
machine state that was never graded. Fixed: `doGrade`'s catch now calls
`setReport(undefined)`, which also disables Finish — correct, since there is nothing
current to finish on.

**The reboot one.** `allPassed` can be `true` with `rebooted: false`. I traced
`src/engine/grading/grader.ts:92-116`: for a task with `rebootCheck: true`, `rebooted:
false` arises either when nothing passed (so `allPassed` is false anyway) or when
`reboot()` threw — which always sets `rebootError`. So today the amber "reboot check
could not run" box is always alongside, and the words "All checkpoints passed" would
sit right next to it. `verdictFor` now withholds the pass whenever
`session.rebootCheck && !report.rebooted && report.allPassed`, and says instead:
*"Every checkpoint that ran passed, but the reboot check did not run — so whether the
change survives a restart is untested, and that is what this task is for."* This is
belt-and-braces against the current grader and becomes load-bearing the moment the
grader gains another `rebooted: false` path. Both arms tested, including the control
(`rebootCheck: false` must **not** trigger it — a task with no reboot check has
`rebooted: false` legitimately).

The design principle underneath all of this: **`verdictFor` returns `null` as a real
answer.** Withholding is never converted into a failure — per 10.5(b), an over-arrival
means the counter is wrong, not the machine, and failing a correct run over a bad count
is the mistake `reportFor`'s warn-don't-fail guard exists to avoid. `persistenceUntested`
is consulted only after a genuine `fail` has already returned, so by construction it can
only ever suppress a pass.

### 3. Which change is most likely to be the first defect found in review?

**`doGrade`'s `setReport(undefined)`, and everything else in `App.tsx`** — because
`App.tsx` has no test at all. `createApi()` is called at module scope
(`const api = createApi()`), so the module cannot be given a fake fetch without
restructuring it, and I judged restructuring the component the brief specifies to be
outside this task. So every App-side mandate — 7's key-handler gate, `doFinish`'s
`setError(null)`, the concept fetch, the timer stopping at finish — is verified only by
`tsc` and by reading. The rail half is mutation-tested; the App half is not tested at
all. **That asymmetry is the honest headline risk of this task**, and the fix is an
`App.test.tsx` with an injectable api, which I did not add.

Second most likely: **the two changes I made beyond the brief that touch the build.**
`vite.config.ts` now imports `VITE_DEV_PORT` from `src/server/config.ts` instead of
spelling `5173` a second time, and `tsconfig.json`'s `include` grew
`"vite.config.ts", "vitest.config.ts"`. Both are measured (below) but both are
deviations, and a reviewer may reasonably want the frontend build config not to import
from `src/server/` at all.

---

## Per-mandate disposition

### 1. Transport mismatch — DONE. Task 23 landed its half.

Quoted from the actual file, as required:

```
src/server/app.ts:177-180
        /** What the task needs. `vmrun`-only tasks cannot be driven over ssh. */
        taskTransport: task.transport,
        /** What this server is actually using. */
        transport: deps.runtime.transportKind,
```

Task 23's mandate 10 landed. `StartedSession` gained `taskTransport: 'ssh' | 'vmrun'`;
the comparison is now
`props.serverTransport !== undefined && session.taskTransport !== props.serverTransport`;
the banner interpolates `session.taskTransport` rather than hardcoding "vmrun".

The negative test is added. More importantly, **the fixture change is what makes the
positive test bite**: the fixture now sets `transport: 'ssh'` (the server's value) and
varies `taskTransport`, so reverting the comparison to `session.transport` now breaks
the *positive* test — see mutation M1 above. Under the brief's fixture it would not
have.

### 2. Truncated-grader false pass, in words — DONE.

`incomplete: boolean` and `expectedTotal: number` added to `GradeReportView`, rendered
above the tally in the same rose style as the persistence failure, with the mandate's
copy verbatim: *"The grader reported 3 of 7 checkpoints and then stopped. This is not a
score: the ones that never ran are unknown, not passed."* Test asserts
`/is not a score/i`, asserts the interpolated numbers
(`/reported 3 of 7 checkpoints and then stopped/i`), and asserts it is **not**
presented as a pass (`queryByText(/all checkpoints passed/i)` is null). Per 10.4(a) the
units are distinct checkpoint ids: I read `reportFor` (searched for the symbol, not a
line number) and confirmed `total` is `statusById(v).size`, `passed` filters that same
map, and `expectedTotal` is `countCheckpoints`'s distinct-id count. I compute no tally
of my own from any array length.

### 3. / 10.4(b). Vite dev origin in the allowlist — CONFIRMED, no change needed.

Read **`src/server/config.ts`** (not `index.ts`, not `terminal.ts`), as 10.4(b)
redirected. The set, quoted:

```
src/server/config.ts:37-38, 70-77
/** Vite's default dev port, which Task 24's UI is served from. */
export const VITE_DEV_PORT = 5173
...
export function allowedOriginsFor(port: number, vitePort: number): ReadonlySet<string> {
  return new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    `http://localhost:${vitePort}`,
    `http://127.0.0.1:${vitePort}`,
  ])
}
```

All four present; both Vite entries interpolate the constant rather than spelling
`5173`. `index.ts:21` calls `allowedOriginsFor(PORT, VITE_DEV_PORT)` and `index.ts:50`
passes the set to `attachTerminal`. The check itself is present and enforced —
`terminal.ts:170-171` reads `req.headers.origin` and refuses when it is defined and not
in the set, with a missing `Origin` deliberately allowed for non-browser clients. Your
measurement was **not** stale; I confirmed it rather than relying on it.

One thing 10.4(b) could not know: `vite.config.ts` did not exist yet, and the brief has
it spell `port: 5173` — which would have made `5173` live in two places after all,
defeating the property you checked. I imported the constant instead:

```ts
import { VITE_DEV_PORT } from './src/server/config.ts'
...
  server: { port: VITE_DEV_PORT, ... }
```

`config.ts` is deliberately side-effect free and imports nothing, so this starts no
server. Verified without binding a socket, using vite's own config loader:

```
$ node -e "... loadConfigFromFile({command:'serve',mode:'development'}, './vite.config.ts') ..."
resolved server.port = 5173
resolved proxy keys = [ '/api', '/ws' ]
ws flag on /ws = true
```

### 4. Casts — DONE, all three removed, exactly one remains.

```
$ grep -rnE "\bas ([A-Z]|unknown|const\b)" src/web/ test/web/ | grep -v "as const"
src/web/api.ts:192:    return body as T
```

Exactly one new line, in `src/web/api.ts`, at the JSON deserialization boundary, with
the mandate's comment. No `as unknown as` anywhere in the repo. Your measurement of
the three removable ones was correct and I re-measured rather than trusting it: the two
fetch fakes are annotated (`const impl: typeof fetch = async (input, init) => {...}`)
with the parameter types inferred, and `errorMessage` uses a copied `isRecord` guard
of the same shape as `src/engine/content/objectives.ts:20-22`. `tsc --noEmit` is clean.

The `isRecord` guard is not only cast-avoidance: it turned into a test. A server that
sent `{ error: { code: 1 } }` would, under the cast, put `[object Object]` in the rail —
a message describing a failure the student did not cause and cannot act on. There is
now a test for that.

One note on grep hygiene: my first draft of `api.test.ts` explained the removal in a
comment that contained the literal string `as unknown as typeof fetch`, which made the
mandate's own census grep report a false positive. Reworded to describe it in words.

### 5. `SessionMode` declared once — DONE, and the erasure is proven.

```ts
import type { SessionMode } from '../server/session.ts'
export type { SessionMode }
```

Erasure proven rather than asserted:

```
$ npm run build:web
✓ 35 modules transformed.
dist/assets/index-DWqgY0lg.css   18.38 kB │ gzip:   4.67 kB
dist/assets/index-BYXfGMoP.js   744.75 kB │ gzip: 206.17 kB
✓ built in 2.59s

$ grep -cE "hono|node:child_process" dist/assets/*.js
0
```

I widened the grep, because zero hits on two strings is weak evidence:

```
$ grep -oE "spawnSshPipe|SessionStore|countCheckpoints|reportFor|allowedOriginsFor|VITE_DEV_PORT|loadVmConfig|node:(fs|net|http|child_process)|@hono/node-server" dist/assets/*.js | sort -u
(no matches)
```

And a positive control, so a grep that matches nothing because it is looking in the
wrong file cannot pass as proof:

```
$ grep -oE "xterm|createRoot|ws/terminal|/api/sessions" dist/assets/*.js | sort -u
/api/sessions
createRoot
ws/terminal
xterm
```

`TaskPicker`'s `MODES` array is left as it is, with the comment the mandate asks for —
and the comment says plainly that it is a comment and not a guarantee: the array's type
catches a *wrong* mode id, not a *missing* one. A `Record<SessionMode, ...>` keyed
structure (the trick `src/server/app.ts:31` uses) would make a missing mode a type
error; the mandate said leave the array alone, so I did, and I am flagging the residual
gap rather than papering over it.

### 6. `TerminalPane` `onStatus` in a ref — DONE.

`statusRef.current = onStatus` on every render, all three handlers read
`statusRef.current?.(...)`, deps are `[cols, rows]`. The dep-array comment now states
the `cols`/`rows` justification beside it: a size change genuinely needs a new
connection because the server runs `stty` once at connect time and cannot resize the
guest afterwards.

I also confirmed the wire protocol against Task 23's real code rather than the brief's
quotes of it: `terminal.ts:179-180` reads `cols`/`rows` from the query string with the
same 100/30 defaults, and `terminal.ts:54` accepts `{ type: 'input', data: string }`.
Both match what `TerminalPane` sends. Per the mandate I did **not** add `binaryType`
handling and did not change `String(ev.data)`.

### 7. Nothing disabled after Finish — DONE, with one placement deviation.

`finished?: boolean` on `RailProps`, folded into Hint, Grade and Reset; Finish is
`report === undefined || working || finished`. `App` passes `finished={rating !== null}`.
The key handler is gated (`if (session === undefined || rating !== null) return`) with
`rating` in its dep array — a disabled button beside a live shortcut would be a hole
exactly the shape of the thing being prevented. `doFinish` now calls `setError(null)`
first, like every other handler.

**Deviation, stated:** the mandate says render the explanation "next to the rating box".
I put it in the **rail, immediately above the button group** — where the disabled
controls actually are, and where a jsdom test can assert it (it is now covered by the
mutation-tested "disables hint, grade and reset once the attempt is finished" test).
The App-side rating box also explains it, so both places a student might look are
covered; the rail line is the tested one. If you want it rail-side only or box-side
only, say which and I will collapse it.

### 8. `environmentMatchGlobs` dropped — DONE, and it mattered more than expected.

`vitest.config.ts` gained only `plugins: [react()]` and `'test/**/*.test.tsx'` in
`include`, and lost `environmentMatchGlobs`. The `RHCSA_VM` gate, `globals: true`, both
`exclude` arms and `testTimeout` are verbatim with their comments. `rail.test.tsx`
carries the per-file docblock.

**No deprecation warning appears** in `npx vitest run` output:

```
$ grep -inE "deprecat|DeprecationWarning" /tmp/vitest-all.log
(no deprecation warnings)
```

**`api.test.ts` runs in the Node environment — now, and pinned.** As the headline
section says, it was *not* doing so until I fixed my own comment. This is the mandate
whose stated benefit was closest to being silently lost, and it is now enforced by an
assertion instead of by a claim in this report.

### 9. `GradeReportView.phase` — DONE, premise refuted, conclusion kept.

See question 1 above. `phase?: string` is gone from `GradeReportView`; `phase` and
`rung` live on `GradeResponse`, which is what the grade route actually returns.

### 10.1 No concept-card affordance in exam mode — DONE, and it required building the thing first.

The mandate warns that "a test that only checks the exam arm passes on a component that
never renders cards at all" — which was the starting state: nothing in the brief renders
a concept affordance anywhere. So this mandate is partly a feature request. Built:

- `api.task(id)` is typed `TaskDetail` (`{ id, title, concepts: ConceptRef[] }` — only
  the fields the screen reads, documented as a narrowing) instead of the brief's
  `call<unknown>`.
- `App` fetches the detail after `start` and passes `concepts` + `onConcept` to `Rail`.
- `Rail` renders a `concepts` section of title buttons **only** when
  `session.mode !== 'exam'`. Absent, not disabled.
- The card **body** opens in the main pane next to the hints, never in the rail — same
  reason a hint does not live in the rail.
- One test, both arms, with `unmount()` between them so the two renders cannot see each
  other's DOM. Mutation M10.1 confirms the exam arm bites.
- `/api/concepts/:id` unchanged, no mode parameter added.

If the detail fetch fails the session still runs and the rail says which half failed
("the lab is running, but its concept cards could not be listed: …") rather than
implying the lab did not start.

### 10.2 Foreign-origin refusal check — HANDED TO TASK 25's CHECKLIST.

Written into the Step-16 list below as **check 15**, making the list **fifteen checks,
not fourteen** — stated explicitly rather than renumbered silently. It is marked manual
with the reason, so a later reader does not "simplify" it into a unit test: the
automated arm cannot set a foreign `Origin` the way a browser does, because a browser is
the only client that sets `Origin` on its own.

### 10.3 `transport` names two different things — RESOLVED BY COMMENT, and I am stating which option I took.

The mandate offered two options. I took the second: **the field name stays as the wire
spells it, with a comment naming which meaning it carries.** Reasoning, stated so you
can overrule it: `TaskSummary` is the wire shape of `summary()` in `app.ts`, which sends
`transport`. Renaming the *type's* field to `taskTransport` without remapping the
response would make the type describe a payload the server never sends — trading a
naming ambiguity for an outright false type. Where the ambiguity can actually cause a
bug is the comparison, and that is on `StartedSession`, which now carries **both**
fields under distinguishable names (`taskTransport` = what the task needs, `transport` =
what the server is using), each with a doc comment. `TaskSummary.transport` carries a
comment saying it is the task's and that the same name elsewhere means the opposite.
`health()` carries the same warning on its `transport`. Nothing in the UI compares
`TaskSummary.transport` to anything.

### 10.4(a) Distinct-id units — CONFIRMED, copy unchanged.

Read `reportFor` by symbol, not by line number. Mandate 2's copy is kept word for word.
The rail computes no tally of its own and never uses a checkpoint array's `length`.

### 10.4(b) — see mandate 3 above. Already satisfied; confirmed in `config.ts`.

### 10.5(a) `allPassed` is final — DONE.

Not re-ANDed with `!incomplete` anywhere. The field's doc comment in `api.ts` and
`verdictFor`'s docblock both say why, naming the double-negation trap.

### 10.5(b) Over-arrival warning — DONE, both tests, and neither is a crash test.

`countSuspect = report.total > report.expectedTotal`, derived from the two fields I
already receive. **No `countSuspect` report field added** — parked for P24 as instructed.
Copy, kept about trust rather than blame: *"This lab's checkpoint count is wrong (3
reported, 0 expected). The result may be unreliable — please re-run. Nothing here is
your doing: the number the grade is scored against is what is broken."*

Both required tests exist and both assert content, not survival:

- `total: 6, expectedTotal: 5, allPassed: true` → asserts the interpolated numbers
  `(6 reported, 5 expected)`, asserts **no** failure verdict (`/did not pass/i` and
  `/failed/i` both null — the run is not failed over a bad count), asserts **no** pass
  verdict either, and asserts the tally `6 / 6 passed` still shows so the numbers behind
  the warning are visible.
- `expectedTotal: 0, total: 3, allPassed: true, incomplete: false`, non-empty
  all-passing list → asserts `(3 reported, 0 expected)`, asserts no pass verdict, and
  asserts mandate 2's truncation copy does **not** appear (nothing was truncated; the
  declaration was). This is the test for the class you said would have caught it.

Plus a control test — counts agree and everything passed → the pass verdict **does**
appear. Without it, suppressing the verdict unconditionally would satisfy both tests
above.

---

## Step 16 — deferred, all fifteen checks, with what each will prove

Marked deferred the same way Task 19's Step 5, Task 21's Step 12, Task 22's Steps 9-10
and Task 23's Step 20 are. **Two independent blockers, neither of which I can remove:**
the RHEL 9 ISO is a user-owned blocker and the guest does not exist, and there is no
browser on this WSL host. I did not start `dev:server` or `dev:web`; no listening
process exists.

**Nothing in this task has ever been rendered in a browser.** Every `.tsx` file here is
validated only by `tsc --noEmit` and by jsdom. That is why Step 15's `tsc` is not
optional and why the brief is right to say so — it is the only thing between a typo in
`App.tsx` and a blank page, and `App.tsx` has no test.

Three of the brief's expectations are **predictions about content, not assertions**. I
encoded none of them in a test and changed no code to match them: "the picker lists five
tasks" (true only after Task 22 lands), "3 / 5 passed" in check 9 (depends on Task 21's
grader emitting exactly five checkpoints with exactly three passing on an untouched
machine), and "a rating of `hard`" in check 8 (depends on the rung reached).

| # | Check | What it proves |
|---|---|---|
| 1 | Picker lists the tasks with chapter numbers; the SELinux one is tagged `supporting` | `/api/tasks` reaches the browser and `scope: 'instrumental'` renders as a badge. Task-count is a prediction, not an assertion |
| 2 | Practice + `Grow /home to 12 GiB` + Start → ~15s, then prompt above a live shell | The whole spine: revert → setup → session → WebSocket → `ssh -tt` → xterm. The single check that proves the app exists |
| 3 | `df -h /home` reports ~8 GiB and nearly full | `setup.sh` really ran in the guest. The scenario is real rather than described |
| 4 | F2 → rung-2 nudge below the terminal, naming the objective and two cards, no commands | Disclosure rung 2, and that the nudge leaks no commands |
| 5 | F2 again → both concept cards in full | **Phase 1 exit criterion.** Everything needed to solve it is on screen and none of it came from a book |
| 6 | Solve it: `lvextend` then `xfs_growfs` | Terminal input reaches the guest and `sudo` works there |
| 7 | F4 → 60-90s reboot wait, then 5/5 with every checkpoint named and green | Grade round-trip, the reboot check, and practice-mode naming |
| 8 | F8 → rating, with the "derived, not self-reported" explanation | `finish` records once and the rating is derived. The specific value is a prediction |
| 9 | Exam + same task + immediate F4 → a partial tally, `which ones is not shown in this mode`, no names anywhere | **Masking. Would rot unnoticed.** The specific `3 / 5` is a prediction; "no names on screen" is the assertion |
| 10 | F2 twice in exam → second refused with `rung 2 is the maximum in exam mode` | `MAX_RUNG.exam`, and that a 409 reaches the rail as its server message |
| 11 | F8 in exam → names appear, with the rating | `revealed: true` unmasks only at finish |
| 12-13 | Practice, solve, then comment `/home` out of `/etc/fstab`, F4 → *"passed before the reboot and failed after it. That is a persistence failure"* | **The output the whole design exists to produce. Would rot unnoticed.** Verdict A vs B, regression detection, and the exact wording |
| 14 | Reset lab → confirmation naming both consequences, ~15s `reverting...`, timer at `00:00`, `df -h /home` back to 8 GiB, rung unchanged, open hints still open, terminal dropped | Reset reverts machine and clock but not disclosure |
| 15 | **(new, from 10.2)** `python3 -m http.server 8123` in an empty dir, open `http://localhost:8123`, console: `new WebSocket('ws://localhost:5175/ws/terminal')`. Expect failure and **no** terminal. Record the console text verbatim | The `Origin` allowlist against a real browser-set `Origin` — the only thing between any page the student visits and a shell in a guest where `student` has passwordless sudo. **Manual because the automated arm cannot set a foreign `Origin` the way a browser does; do not simplify it into a unit test.** A successful connection is a stop-the-line finding, not a note |

**Handed to Task 25**, which owns the acceptance checklist: this table verbatim,
including the note that checks 12-13 (persistence) and 9-11 (masking) are the two groups
that would most easily rot unnoticed, and that check 15 must stay manual. Not dropped.

## Checks I could not run, with the evidence

- **`shellcheck`** — not installed; `command -v shellcheck` finds nothing. No shell
  script in this task's file list anyway.
- **Anything needing the RHEL 9 guest** — the ISO is not downloaded. Known, accepted,
  user-owned. I ran no VM operation of any kind: no `vmrun`, no `scripts/provision.sh`,
  no snapshot.
- **Anything needing `sudo`** — no TTY on this host, cannot authenticate. Not needed.
- `.env.local` was not created, read or modified. No `ssh-keygen`, nothing written to
  `~/.ssh/`. Nothing under `/home/daxtangco/sechelp-tools` read. No subagents dispatched.
- Nothing under `content/`, `objectives.yaml`, `content/lib/assert.sh`,
  `src/engine/grading/` or `src/server/session.ts` modified — `git status --porcelain`
  below confirms it.

## Deviations from the brief, all deliberate, all measured

1. **`@vitejs/plugin-react` pinned to `^5.2.0`.** The unpinned line does not resolve.
   Measured; npm output pasted above.
2. **`GradeResponse` / `FinishResponse` added**; `phase` off `GradeReportView`.
   Mandate 9's conclusion, its premise refuted against `app.ts:287-291`.
3. **`api.task()` typed `TaskDetail`** instead of `unknown`, and **`health()` added** to
   the client, so the one place that does HTTP is the one place that does HTTP. `TaskDetail`
   is narrowed to what the screen reads, and says so.
4. **`DOT` keyed by `CheckpointView['status']`** instead of `Record<string, string>`,
   which removes the brief's dead `?? 'text-zinc-500'` fallback: with literal keys the
   lookup is `string`, not `string | undefined`, so there is nothing to fall back from.
   A fourth status becomes a type error instead of a silently grey dot.
5. **`verdictFor` extracted as a documented function.** It began as a four-deep nested
   ternary, which is not reviewable.
6. **The finished-explanation line is in the rail**, above the buttons, not only beside
   the rating box (mandate 7). Testable there; both places explain it.
7. **`vite.config.ts` imports `VITE_DEV_PORT`** rather than spelling `5173` a second
   time. Serves 10.4(b)'s "not hardcoded twice" property, which the brief's literal
   would have broken. Resolution verified with vite's own loader, no socket bound.
8. **`tsconfig.json` `include` gained the two config files.** The brief says only three
   `compilerOptions` move; this is `include`, so it is a deviation. Reason: after (7),
   `vite.config.ts` imports server source and nothing was type-checking it. Measured
   clean, and measured to actually bite:

   ```
   $ perl -pi -e 's/port: VITE_DEV_PORT/port: VITE_DEV_PORTT/' vite.config.ts && npx tsc --noEmit
   vite.config.ts(15,11): error TS2552: Cannot find name 'VITE_DEV_PORTT'. Did you mean 'VITE_DEV_PORT'?
   $ # restored
   $ npx tsc --noEmit ; echo $?
   0
   ```
9. **Three extra `api.test.ts` tests and nine extra `rail.test.tsx` tests** beyond the
   brief's 5 + 11.
10. **`setReport(undefined)` in `doGrade`'s catch**, and the `persistenceUntested`
    guard. Both close false-pass paths; neither was mandated. See question 2.

## Concerns

1. **`App.tsx` has no test.** The single biggest gap. `createApi()` at module scope
   makes the module un-fakeable without restructuring. Five mandate-required behaviours
   live only there: the key-handler gate, `doFinish`'s `setError(null)`, the concept
   fetch, the timer stopping at finish, and my `setReport(undefined)` fix. All are
   `tsc`-clean and read correctly; none is measured. Recommend an `App.test.tsx` with an
   injected api client as the first follow-up.
2. **Nothing rendered in a browser.** Stated again because it is the load-bearing
   caveat on everything above. Fifteen manual checks are the answer and they are blocked
   on the ISO.
3. **`MODES` coverage is a comment, not a guarantee** (mandate 5's instruction). A mode
   added to the ladder will type-check while being unofferable in the picker. The fix is
   a `Record<SessionMode, …>`-keyed structure; the mandate said leave the array alone.
4. **`vite.config.ts` importing from `src/server/`** is the deviation most likely to be
   argued with. It is type-only in spirit but a real value import; `config.ts` is
   side-effect free, which is what makes it safe, and that is a property a future edit to
   `config.ts` could quietly break.
5. **Bundle size: 744 kB / 206 kB gzipped**, with vite's >500 kB warning. All of it is
   React plus xterm, and this is a localhost single-user app, so I left it. Worth a
   `manualChunks` pass if it ever matters.
6. **The terminal dies on reset** and the page needs a reload, per the brief's design
   ruling. No reconnection logic added; that is Phase 2.
7. **`report.regressions` (the ids) is received and not rendered** — only
   `regressionCount` is, in words. Naming the regressed checkpoints in practice mode
   would be a strict improvement and is not in the brief.

---

# Fix round 1

**Status: DONE.** Both required fixes landed, all four required tests are written and every one of
them is mutation-proven, and the parked finding is untouched. The disclosure that blocked the App
tests in round 1 was wrong, and the correction is the most useful thing in this section.

**Commit:** `d0ff66beb81eae93fef8c1f1f2f87959592c890a` on `phase-0-1`, base `7dbaaf4`. Five files, staged by name.

## Gates, measured

```
$ npm run typecheck ; echo $?
0
$ npx vitest run
 Test Files  33 passed (33)
      Tests  386 passed (386)
vitest exit: 0
$ grep -icE "deprecat" <vitest output>
0
$ npm run build:web ; echo $?
✓ 35 modules transformed.
dist/assets/index-DWqgY0lg.css   18.38 kB │ gzip:   4.67 kB
dist/assets/index-DfV-uuQY.js   745.34 kB │ gzip: 206.34 kB
0
```

379/31 → **386/33**, 0 skipped, 0 todo. Seven new tests in two new files: `test/web/app.test.tsx`
(4) and `test/web/terminal-pane.test.tsx` (3).

Bundle still clean — `grep -cE "hono|node:child_process" dist/assets/*.js` → `0`, and no match for
`spawnSshPipe|SessionStore|countCheckpoints|reportFor|allowedOriginsFor|deriveRating|node:(fs|net|http|child_process)`.

Cast census unchanged, still exactly one line (its line number moved because `api.ts` gained a doc
comment):

```
$ grep -rnE "\bas ([A-Z]|unknown|const\b)" src/web/ test/web/ | grep -v "as const"
src/web/api.ts:201:    return body as T
```

No non-null `!`, no `enum`, no `namespace`, no parameter properties, no decorators. (The census
regex for decorators reports `src/web/index.css:1:@import 'tailwindcss';` — a CSS at-rule, not a
decorator. Noted so the next person running the same grep does not chase it.)

Nothing was left listening; `ss -ltnp | grep -E ':(5173|5175)'` → nothing. No VM operation, no
`sudo`, no `.env.local`, no subagents.

## F1 — the guided false fail. Fixed and measured.

`finished` is now a `useState(false)` set from the finish response's phase:

```ts
setFinished(done.phase === 'graded')
```

Three supporting changes, all necessary:

- **`SessionView.phase` and `GradeResponse.phase` are now `SessionPhase`**, re-exported type-only
  from `src/server/session.ts` beside `SessionMode`. This is a small deviation worth naming: they
  were `string`, and with `string` the comparison `done.phase === 'gradedd'` compiles and silently
  never matches — the same never-fires shape as the defect being fixed. Measured, so it is not a
  claim: mutating the literal to `'gradedd'` now gives
  `src/web/App.tsx(189,19): error TS2367: This comparison appears to be unintentional because the types 'SessionPhase' and '"gradedd"' have no overlap.`
  Under `phase: string` that same mutation type-checks clean and the guard simply never fires.
- **The key handler and its dep array read `finished`**, not `rating`.
- **`doReset` sets `setFinished(s.phase === 'graded')`** from the reset response rather than
  hardcoding `false`. `/reset` answers 409 on a graded session, so today that value is always
  `active`; reading it back means the screen keeps agreeing with the server if that rule changes.

The rating box is keyed to `finished` with two arms. The rated arm is the original copy; the guided
arm says *"Attempt finished. Guided mode records no scheduler rating: it hands you the solution, so
how fast you got there says nothing about whether you can do it cold. Run the same task in practice
or drill mode when you want one."* Both arms share the sentence explaining that Hint, Grade, Reset,
F2, F4 and F8 are inactive, reworded from "the report this rating was derived from" to "the report
this attempt was recorded against" — the old wording was false in guided mode, where there is no
rating.

**The F1 probe now dies.** Reverting the one line to the old derivation:

```
### F1 probe: revert to the rating-derived guard (App.tsx)
189:      setFinished(done.rating !== null)
   × App, guided mode > closes the attempt at finish even though guided produces no rating
   × App, guided mode > ignores F2, F4 and F8 once the attempt is finished
   × App, guided mode > stops the clock at finish, so a solved lab is never called over budget
      Tests  3 failed | 1 passed (4)
restored: identical
```

All three guided tests die, but they die at the same early assertion (the finished box never
appears), which does not prove the clock assertion itself is load-bearing. So I mutated the timer
gate **alone**, leaving the box intact:

```
### M-timer: drop finished from the timer gate only (line 64)
   × App, guided mode > stops the clock at finish, so a solved lab is never called over budget
     → expected '10:01 / 10:00' to be '00:04 / 10:00'
      Tests  1 failed | 3 passed (4)
restored: identical
```

`'10:01 / 10:00'` on a lab that was just graded 5/5 is the user-visible defect, printed by the
suite. And the key gate alone:

```
### M-keys: drop finished from the key-handler gate only (line 204)
   × App, guided mode > ignores F2, F4 and F8 once the attempt is finished
     → expected 2 to be 1        # a second finish() call got through
      Tests  1 failed | 3 passed (4)
restored: identical
```

## F2 — the pass verdict was indistinguishable from the fail verdict. Fixed, and M8 now dies.

Both positive assertions are anchored to the exact string, `getByText('All checkpoints passed.')`,
and the control test additionally asserts `queryByText('Not all checkpoints passed.')` is null.

```
### M8: pass verdict copy -> fail verdict copy (Rail.tsx:186)
186:              <div className="text-xs text-emerald-400">Not all checkpoints passed.</div>
   × Rail > does not withhold the pass on a task with no reboot check
   × Rail > says all checkpoints passed when the counts agree and everything passed
   × App, a rated mode > drops the stale tally when a re-grade fails, and shows the rating at finish
      Tests  3 failed | 32 passed (35)
restored: identical
```

Three tests now, where the reviewer measured zero. The third is the new App test, which caught it
independently — that is the value of anchoring rather than loosening.

## The four required tests

All four are mutation-proven; none of them is a render-and-survive test.

| Item | Test | Proven by |
|---|---|---|
| App 1 — key-handler gate, guided | `ignores F2, F4 and F8 once the attempt is finished` | M-keys kills it (`expected 2 to be 1`) |
| App 4 — clock stops at finish | `stops the clock at finish, so a solved lab is never called over budget` | M-timer kills it (`'10:01 / 10:00'`) |
| App 5 — `setReport(undefined)` | `drops the stale tally when a re-grade fails, and shows the rating at finish` | M8 kills it; the test states what it prevents — a green verdict left standing beside an error box, claiming a pass for a machine state that was never graded, on a machine the student has since changed |
| F3 — mandate 6's `statusRef` | `does not reconnect when the caller passes a fresh onStatus every render` (+ 2) | reverting the ref kills two of the three (`expected [ Array(3) ] to have a length of 1`) |

Two of the three `TerminalPane` tests are there to stop the first one from being satisfiable the
wrong way. `still reports status through the newest callback, not a frozen one` catches a ref set
once at mount — which would pass a construction count while reporting into a stale closure — and
`reconnects when the size changes` is the control that stops an empty dep array from satisfying
everything:

```
### F3: put onStatus back in the dep array (TerminalPane.tsx)
80:  }, [cols, rows, onStatus])
   × TerminalPane > does not reconnect when the caller passes a fresh onStatus every render
     → expected [ Array(3) ] to have a length of 1 but got 3
   × TerminalPane > still reports status through the newest callback, not a frozen one
     → expected [ Array(2) ] to have a length of 1 but got 2
      Tests  2 failed | 1 passed (3)
restored: identical
```

## F4 — untouched, as ruled

No change to the finish path, no `countSuspect` field on the server report type, nothing added to
`src/server/`. Step 16's fifteen checks are unchanged and unrenumbered. Bundle size, the terminal
dying on reset and unrendered `report.regressions` are all still as accepted.

## The question: did the recipe work as written?

**Yes, essentially verbatim, and both gotchas were real.** `vi.mock` hoisting over module-scope
`createApi()` works exactly as measured; `matchMedia` and `WebSocket` were the only two stubs
needed. The Start button really is disabled for one commit after the task list arrives, and the
mode buttons' accessible name really does include the blurb — I hit neither, because the recipe
said so first.

Three additions the next person copying this pattern will need, none of which contradicts it:

1. **jsdom prints `Not implemented: HTMLCanvasElement's getContext()`** on every file that mounts
   `TerminalPane` (xterm's renderer asks for a canvas). It is noise, not a failure — nothing is
   asserted against the canvas — but it will look like a broken test to whoever sees it first.
   Installing the `canvas` package to silence it would add a native build dependency to a project
   that does not otherwise have one, which is a bad trade for quieter output.
2. **`window.location.host` is `localhost:3000` in jsdom, not `localhost`.** My first
   `TerminalPane` assertion pinned the literal URL and failed on the port. Fixed by building the
   expected URL from `window.location.host` the way the component does — the assertion is about the
   `cols`/`rows` query string, not about which port jsdom pretends to serve.
3. **Type the fake against the real client.** `const shapeCheck: ReturnType<typeof createApi> = fake`
   (with `createApi` imported type-only) makes a route whose signature changes break the test file
   instead of letting the fake drift into describing an API that no longer exists. `vi.mock`'s
   factory is not checked against the module it replaces, so without this line the fake is free to
   be wrong in exactly the way that makes a green suite meaningless. It cost one line and it is the
   part of this pattern I would most want copied.

One more thing worth carrying: the fake echoes the requested `mode` back from `start`, and derives
`rating` from it the way `app.ts` does. That is why a test asking for guided cannot quietly be
handed a practice session — which is the shape of mistake that would have hidden F1 from a test
written to look for it.

## Round-1 disclosure that was wrong

Round 1's report said, twice and in bold, that `App.tsx` could not be tested without restructuring
it. That was a conclusion I reached by reading, not by trying, and it was wrong. The cost was
precise: the one part of the diff I declared unmeasurable is the one part that shipped a
load-bearing defect, in the mode a beginner uses first. `vi.mock` hoisting is documented behaviour
and one probe file would have found it.
