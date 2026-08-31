# Task 24 review — the Lab screen

Repo `/home/daxtangco/rhcsa-trainer`, BASE `28ad7f0`, HEAD `7dbaaf4`. Reviewed against
`task-24-brief.md` and `task-24-mandates.md` (mandates win on conflict).

Every conclusion below is labelled **MEASURED** (I ran a command or a mutation and read the
output) or **REASONED** (I executed the logic by hand). All mutation work was done in a
throwaway tree at `/tmp/t24` created with
`git archive 7dbaaf4 | tar -x -C /tmp/t24` plus a `node_modules` symlink.
`git status --porcelain` in the real repo was empty before and after and is empty now — MEASURED.

---

## Verdicts

- **Spec compliance: APPROVED.** Every brief step and every mandate (1-9, 10.1-10.5) is
  implemented, with the exact values, component names, copy strings and test cases specified.
  All 11 brief-specified rail test names and all 5 brief-specified api test names are present
  verbatim. The two deviations that matter are disclosed and justified. Finding 1 below is a
  case of the *mandate* being wrong, not of the code failing to comply with it.
- **Task quality: CHANGES REQUIRED.** Two findings: one wrong claim rendered to the student on
  the guided path (F1, measured), and one mutation-proven test gap on the pass verdict (F2,
  measured). Both are small. Everything else I probed is correct, and the unmandated changes
  are all sound.

---

## Gates — run, not cited

| Gate | Result |
|---|---|
| `npm run typecheck` | exit 0, clean — MEASURED |
| `npx vitest run` | **379 tests / 31 files, 379 passed, 0 failed, 0 skipped** — MEASURED. Matches the report's claim; baseline was 351/29 |
| Deprecation warnings | **none.** The only stderr is `test/server/terminal.test.ts`'s deliberate malformed-frame line — MEASURED |
| `npm run build:web` | exit 0. `dist/assets/index-*.js` 744.75 kB / 206.17 kB gzip, with vite's >500 kB note (out of scope) — MEASURED |
| Bundle purity (mandate 5) | `grep -c "hono\|node:child_process\|node:fs\|allowedOriginsFor" dist/assets/*.js` → **0**. `grep -c 5173` → **0** — MEASURED |
| `git status --porcelain` | empty before and after — MEASURED |
| Cast census | exactly one new cast, `src/web/api.ts:192 return body as T`. No `as unknown` anywhere in `src/ test/ scripts/` — MEASURED |
| `enum` / `namespace` / decorators / parameter properties / non-null `!` / `require(` | none. (The only `require` hits are the private method `#require` in `session.ts`; the only `@post` hit is inside a comment string in `harness.test.ts`) — MEASURED |
| Stray listeners | nothing on 5173/5175/8123 — MEASURED |

---

## Findings

### F1 — Guided mode never sets `finished`, so mandate 7's whole guard is inert there, and the rail prints "over budget" on an attempt that already ended

- **Severity: Medium.** **Direction: false fail.** **Load-bearing: YES** — this happens on the
  app as it exists, in the mode a beginner starts in.
- **MEASURED**, with a test I wrote and ran (`/tmp/t24/test/web/app-probe3.test.tsx`, 2 tests,
  both pass against unmodified `7dbaaf4`).

`App.tsx:41` derives the flag from the rating:

```tsx
const finished = rating !== null
```

`src/server/app.ts:315` is `if (s.mode !== 'guided') { rating = deriveRating(...) }`, so
**`POST /finish` returns `rating: null` for every guided session**. `finished` therefore stays
`false` for the whole guided path, and so does the key-handler gate, which reads `rating !== null`
directly (`App.tsx:190`).

Measured consequences after a *successful* guided Finish:

1. Neither explanation renders — no "Attempt finished. Scheduler rating: …" box in the main pane
   and no "This attempt is finished and its rating is recorded" line in the rail. The student gets
   no confirmation the attempt closed at all.
2. Hint, Grade and Reset stay enabled; F2/F4/F8 stay live.
3. **The timer never stops.** `App.tsx:58-63` returns early on `finished`, which is never true
   here, so the clock keeps climbing and the rail eventually turns amber and prints **"over
   budget"** about an attempt that ended on time. The comment at `App.tsx:56-57` states this is
   exactly what the guard prevents; in guided mode that comment is false.
4. Pressing F4 again gets the server's 409, and `doGrade`'s (otherwise correct)
   `setReport(undefined)` **wipes the finished report**: "5 / 5 passed" reverts to
   "5 checkpoints" and is replaced by
   `session s1 is finished; start a new one to attempt it again`. A legitimately earned result is
   destroyed by a keypress the UI left live.

Reset is the one harm mandate 7 named that does *not* land: `app.ts:202` refuses a reset on a
`graded` session with a 409, so no VM is reverted. REASONED from `app.ts:202`.

**One-line failure scenario:** a beginner runs a lab in Guided mode, grades 5/5, presses F8, reads
the concept cards for six minutes, and the rail tells them they went over budget on an attempt
they finished in four.

**This is the wrong mandate.** Mandate 7 specifies `finished={rating !== null}` literally, and its
premise — "once `finish` returns … a rating has been recorded from it" — is false for guided mode.
The implementer complied exactly and did not catch it; the mandates' own instruction was to measure
and refuse. The report names only mandate 9's premise and the brief's Step 1 install line as wrong.

**Fix (small).** `FinishResponse extends SessionView`, so `done.phase` is already in hand and is
`'graded'` after a successful finish — derive the flag from the response rather than from the
rating, or hold a dedicated `const [finished, setFinished] = useState(false)` set in `doFinish`.
Then give the rating box a guided arm, because "Scheduler rating: null" must not render: guided
attempts are deliberately unrated and the copy should say so. Add the timer test — writing it is
what surfaces this.

### F2 — the pass verdict's copy is never distinguished from the fail verdict's, so swapping them survives the whole suite

- **Severity: Low-Medium** (test adequacy). **Direction: false fail** if it regresses.
  **Load-bearing: NO** — `Rail.tsx` is correct today.
- **MEASURED.** Mutant M8: replace
  `<div className="text-xs text-emerald-400">All checkpoints passed.</div>` (`Rail.tsx:186`) with
  the rose "Not all checkpoints passed." line. **All 28 web tests still pass.**

Cause: every *positive* assertion on the pass verdict is
`screen.getByText(/all checkpoints passed/i)` (`rail.test.tsx:329`, `:346`), and
"Not all checkpoints passed." satisfies that regex as a case-insensitive substring. The negative
assertions are fine — `queryByText(/all checkpoints passed/i)).toBeNull()` correctly rejects both
verdicts — so the gap is one-directional, in the only direction that tells a student who solved
the lab that they did not.

**Fix:** anchor the two positive assertions, e.g. `getByText('All checkpoints passed.')` or
`/^All checkpoints passed\.$/`. Two lines. (A case-sensitive `/All checkpoints passed/` is already
enough, since the fail copy spells it "Not all".)

### F3 — `TerminalPane.tsx` has no test of any kind

- **Severity: Low.** **Direction: neither.** **Load-bearing: NO.**
- MEASURED: no test file references `TerminalPane`; `test/web/` holds only `api.test.ts` and
  `rail.test.tsx`.

Mandate 6's `statusRef` fix is implemented correctly (`TerminalPane.tsx:20-28, 80`) and read
correctly, but it is unmeasured, and it is precisely a latent-caller bug — the class that only
shows up when someone later writes `onStatus={(s) => setStatus(s)}`. The brief did not ask for a
test here, so this is not a spec failure. It is worth one: a test that renders `<TerminalPane
onStatus={inline arrow} />` twice and asserts one `WebSocket` construction would pin the mandate.
The jsdom blockers are two stubs (see below), not a redesign.

### F4 — Finish stays enabled on a report the rail has just refused to score (informational)

- **Severity: Low.** **Direction: false fail**, into the scheduler rather than onto the screen.
  **Load-bearing: NO** on the "wrong truth-claim to the user" test.
- REASONED from `Rail.tsx:263` and `app.ts:312-324`.

When `verdictFor` returns `null` — a truncated run, or `total > expectedTotal` — the rail says "This
is not a score" and Finish is still enabled (`report === undefined || working || finished`). Finish
then derives a rating from `report.allPassed`, which is `false` for the truncated case, so a
grader that timed out records a `hard`-shaped rating against a lab the student may have solved.

I am **not** requiring a change. Disabling Finish there would trap the student in a session with no
way to close it, no mandate asked for it, and Phase 0/1 does not schedule off the rating yet. It
belongs in the whole-branch pile next to P24, since the real fix is a `countSuspect`-aware finish
path, and 10.5(b) explicitly parks that field.

---

## The seven directed targets — one line each

**1. `App.tsx` has no test; five mandate-required behaviours live only there.**
The disclosed blocker is **wrong, and I measured it**: `createApi()` at module scope is *not*
un-fakeable — `vi.mock('../../src/web/api.ts', () => ({ createApi: () => fake, ApiError: class
extends Error {} }))` hoists above the module-scope call and the fake reaches `App`. The real
blockers are jsdom's two gaps, and each is one stub: `window.matchMedia` (xterm's
`Terminal.open()` throws `this._parentWindow.matchMedia is not a function` without it) and
`WebSocket` (jsdom has none). With those, all five behaviours are testable today; I wrote and ran
tests for all five (`/tmp/t24/test/web/app-probe{,2,3}.test.tsx`, all passing against unmodified
`7dbaaf4`). Verdict on each:

| # | Behaviour | Correct? | Evidence |
|---|---|---|---|
| 1 | key-handler gate `if (session === undefined \|\| rating !== null) return`, deps `[session, rating, doHint, doGrade, doFinish]` | **Correct outside guided; broken in guided** (F1) | MEASURED: F2/F4/F8 fire before finish and are dead after it in practice mode; still live after finish in guided |
| 2 | `doFinish`'s `setError(null)` | **Correct** | MEASURED: a stale grade error is gone after a successful finish |
| 3 | the concept fetch — `api.task(s.taskId).concepts` in its own try/catch, `setConcepts([])` plus a "the lab is running, but…" message on failure | **Correct** | MEASURED: `api.task` called with the task id, the card buttons render in the rail. The `[]` on failure is the right choice — it collapses to no affordance rather than a broken one |
| 4 | timer stopping at finish, deps `[session, finished]` | **Correct outside guided; inert in guided** (F1) | MEASURED: clock frozen after finish in practice mode, +30 s changes nothing; keeps climbing to "over budget" in guided |
| 5 | `setReport(undefined)` in `doGrade`'s catch | **Correct, and load-bearing** | MEASURED: grade to 5/5, re-grade into a throw → "5 / 5 passed" and "All checkpoints passed." are both gone, replaced by "5 checkpoints" and the error |

**Which need a test required:** (5) and (1), unconditionally — (5) is the only unmandated false-pass
fix on the grade path and is the exact recurring class, and (1) is what stops the shortcuts being a
hole the shape of the thing mandate 7 prevents. (4) too, now: writing it is what exposes F1. (2) and
(3) are worth having but I would not block on them — a stale-but-wrong error box is never a claim
about the grade, and mandate 10.1's real gate lives in `Rail` where it is already mutation-tested.

**What would break (5) later:** anything that stops `doGrade` throwing — e.g. an `api.ts` change
that returns an error value instead of raising `ApiError`; and any change that moves Finish's
enable condition off `report === undefined`, since clearing the report is also what disables Finish.
It is already mis-firing on the guided path (F1 item 4), where it destroys a legitimate result.

**2. The jsdom comment defect — fix holds, assertion bites, no siblings.**
MEASURED: re-inserting `// @vitest-environment jsdom` at the top of `test/web/api.test.ts` kills
exactly one test — "runs in the Node environment, not jsdom" — so `expect(typeof
globalThis.window).toBe('undefined')` genuinely bites. The fix (writing `<directive>` instead of
the literal, `api.test.ts:9-13`) holds. Sibling sweep, MEASURED: the directive string occurs
exactly twice repo-wide — `rail.test.tsx:1` (intended) and `vitest.config.ts:24`, which vitest
never scans because it is not matched by `include`; the fact that `api.test.ts` still runs in Node
is the proof. No `.only`, `.skip`, `.todo`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`,
`eslint-disable` or coverage-ignore pragma anywhere in `src/` or `test/`. Clean.

**3. Mandate 9 — resolution correct, and the type split holds against every consumer.**
MEASURED, field by field, against `app.ts` and `session.ts`. `GradeResponse extends
GradeReportView { phase; rung }` matches `app.ts:287-291` exactly; `FinishResponse extends
SessionView { report; rating }` matches `{...view(s), report, rating}` at `app.ts:326` exactly,
with `view()` (`app.ts:332-343`) supplying `phase` and an optional `endedAt`;
`SessionView` on `/reset` is right because `app.ts:226` returns `view(s)`, which does carry `phase`.
`TaskSummary` is 10/10 against `summary()`; `StartedSession` is 11/11 against `app.ts:165-180`
including `taskTransport: task.transport`; `CheckpointView.status` is exactly `CheckpointStatus`;
`RungContentView.kind` is exactly `RungKind`. **No type claims a field the server omits.** The two
narrowings (`TaskDetail` drops `objectives`, `ConceptCard` drops `sources`/`prerequisites`) omit
fields the server *does* send, which is the harmless direction, and both say so in a comment.

**4. The unmandated changes — all correct, none fires on a correct run, and the mutation-table row checks out.**
MEASURED, independently: the row the review context asked about is "drop the `allPassed` condition
from `persistenceUntested`". With `rail.test.tsx:137` present the mutant **dies** (killing exactly
"surfaces a guest that never came back"); with that single line deleted the mutant **survives** all
20 rail tests. The story is honest — the assertion is load-bearing, not padding.
On the "does it fire on a correct run" question: `persistenceUntested` cannot. REASONED from
`grader.ts:82-116` — `grade()` reaches `rebooted: false` only when (a) `!task.rebootCheck`, which
makes `session.rebootCheck` false, (b) nothing passed, which makes `allPassed(v)` false, or (c)
`reboot()` threw, which also sets `rebootError`. So the amber persistence line is unreachable
except alongside the reboot-error box, exactly as `Rail.tsx:96-101` claims. `verdictFor`,
`DOT` keyed by the status union, and `countSuspect` likewise only ever *withhold*, never fail.
`setReport(undefined)` is correct and load-bearing (see target 1 row 5), with the guided caveat in F1.
My 20-mutant sweep of `Rail.tsx`: **18 died, 2 survived.** One survivor is F2. The other is
re-ANDing `!incomplete` into the pass check, which survives because `report.incomplete` already
returns `null` one line above — i.e. the mutant is semantically equivalent, so mandate 10.5(a) is
satisfied as written and the survival is not a gap.

**5. `vite.config.ts` importing `VITE_DEV_PORT` from `src/server/config.ts` — acceptable, and it earns its keep.**
Ruling: allow it. It is what makes mandate 10.4(b)'s "not hardcoded twice" property actually true —
`config.ts:38` declares `VITE_DEV_PORT = 5173` once, `allowedOriginsFor` interpolates it, and now so
does the dev server, so moving the port moves all five places. To stay safe, `config.ts` must remain
side-effect-free and must never import from `index.ts`, `app.ts` or anything that touches
`node:net`/`@hono/node-server` at value level; its own header comment states that contract, and
`tsconfig.json`'s `include` now type-checks the config files so a broken import fails the gate.
Worth a one-line test asserting `config.ts` has no runtime imports if this ever grows.
**No port is bound anywhere in this diff** — MEASURED: `npx vitest run` completes in 4.6 s with no
socket, `vite build` binds nothing, and `ss -ltn` shows nothing on 5173/5175/8123.

**6. Mandate 10.5(b) — both tests bite, neither is a crash test, the warning is not a failure, no `countSuspect` field.**
MEASURED: deleting the warning box kills **both** required tests; deleting `countSuspect` from
`verdictFor` also kills both; changing `>` to `>=` kills three. The `expectedTotal === 0` test
(`rail.test.tsx:273-296`) asserts the exact interpolated numbers
(`/checkpoint count is wrong \(3 reported, 0 expected\)/`), asserts no pass verdict, **and** asserts
the truncation copy is absent — that is far more than "did not crash". The copy is about the count
("the number the grade is scored against is what is broken … Nothing here is your doing") and never
about the student failing, and no failure verdict renders: `queryByText(/all checkpoints passed/i)`
is null in both directions, which also excludes "Not all checkpoints passed." MEASURED: no
`countSuspect` field exists on `GradeReport` in `src/server/session.ts` — the UI derives it from
`total` and `expectedTotal`, as required.

**7. The six new dependencies — pin necessary, no flags, nothing extra, placement matches the brief.**
MEASURED against the live registry: `@vitejs/plugin-react@6.1.1` (current latest) peers
`vite: ^8.0.0`, while the installed `vite` is 7.3.6 as required by `vitest@3.2.7`'s tree — so the
brief's bare install cannot resolve and the `^5.2.0` pin is necessary, not cosmetic. `npm ls`
resolves the whole tree with every peer satisfied and no `UNMET`/`invalid` markers, which is the
positive evidence that no `--legacy-peer-deps` or `--force` was needed; `package-lock.json` shows
no override or peer-bypass entries. `@testing-library/dom` is not surplus — the brief's Step 1
installs it explicitly and RTL 16 declares it a peer. `package.json`'s
`dependencies`/`devDependencies` split matches the brief's two install lines exactly, including
`react`, `react-dom` and `@xterm/xterm` in `dependencies` (conventional for an app; the package is
`private: true` and never published, so nothing turns on it).

---

## Was any mandate wrong?

**Yes — mandate 7.** `finished={rating !== null}` is wrong for guided mode, because
`app.ts:315` deliberately returns `rating: null` there. See F1. This is the mandate the implementer
should have measured and refused, and it did not.

Also confirmed correct in the report and re-verified here: **mandate 9's premise is wrong**
(`/grade` does return `phase`, `app.ts:287-291`) while its conclusion is right, and **the brief's
Step 1 install line does not resolve** (target 7).

Mandates I checked and found right, MEASURED, that the mandates file itself only `RECALLED`:
mandate 3 / 10.4(b) is genuinely already satisfied — `allowedOriginsFor` at
**`src/server/config.ts:70-77`** returns all four of `http://localhost:${port}`,
`http://127.0.0.1:${port}`, `http://localhost:${vitePort}`, `http://127.0.0.1:${vitePort}`, with
`VITE_DEV_PORT = 5173` declared once at `config.ts:38` and interpolated, not respelled;
`src/server/index.ts:21` only calls it, and `terminal.ts` hardcodes no port. Mandate 4's three
removable casts are gone and one documented cast remains. Mandate 5's erasure is proven by the
bundle grep. Mandate 8's docblock leaves `api.test.ts` in Node, now pinned by an assertion.

---

## Step 16 handoff — good enough for Task 25 to act on

Yes, with one caveat about which checks to worry about.

The table at `task-24-report.md:621-636` gives all fifteen checks a "what it proves" column, states
plainly that nothing has been rendered in a browser, names the three brief expectations that are
content predictions rather than assertions and confirms none was encoded in a test, marks check 15
as new from 10.2, and carries the instruction that check 15 must stay manual because the automated
arm cannot set a foreign `Origin`. Task 25 can run it without re-deriving intent. (Bookkeeping nit:
checks 12 and 13 share one row, so the table has 14 rows for 15 checks — the count is stated in
prose, so nothing is lost.)

**Is 12-13 / 9-11 the right pair to worry about?** 12-13 (persistence), yes, unambiguously: the
exact wording is asserted only against a hand-built report, so any drift between the real grader's
regression output and that copy is invisible to the suite. For the second slot I would swap 9-11
for **checks 2 and 14**. Masking is enforced server-side by `namesCheckpoints(mode)` and `revealed`
and is unit-tested on that side, so it has a second line of defence. Checks 2 and 14 do not: the
terminal is the one component in this diff with **zero** automated coverage (F3), check 2 is the
only thing that ever proves the WebSocket → `ssh -tt` → xterm spine works at all, and check 14 is
the only thing that proves Reset reverts the machine and the clock but not the disclosure. Those
are the two that would rot without anything going red.

---

## Recipe for the App/TerminalPane tests, since the disclosed blocker is not real

```tsx
// @vitest-environment jsdom
vi.mock('../../src/web/api.ts', () => ({
  createApi: () => fake,                    // hoisted above App.tsx's module-scope createApi()
  ApiError: class ApiError extends Error {},
}))
Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) })
Object.defineProperty(globalThis, 'WebSocket', { writable: true, value: FakeWS })
const { App } = await import('../../src/web/App.tsx')
```

Two gotchas worth carrying over, both hit while writing this: `TaskPicker`'s Start button is
disabled for one render tick after the task list arrives (its `useEffect` sets `selected` after the
commit), so wait for `getAttribute('disabled')` to be null before clicking; and the mode buttons'
accessible name includes the blurb, so match `/^Guided /` rather than `/^Guided$/`.
Working versions of all three probe files are at `/tmp/t24/test/web/app-probe{,2,3}.test.tsx`.

---

## Required before approval

1. **F1** — derive `finished` from the finish response's `phase` (or a dedicated state) instead of
   `rating !== null`, give the rating box a guided arm, and add the timer test.
2. **F2** — anchor the two positive "All checkpoints passed." assertions.

Recommended, not blocking: **F3** (one `TerminalPane` test pinning mandate 6), and tests for
App.tsx items 1, 4 and 5 from target 1. **F4** belongs in the whole-branch pile with P24.
