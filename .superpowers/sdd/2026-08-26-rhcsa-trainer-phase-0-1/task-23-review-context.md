# Task 23 — task review (spec compliance + task quality)

Repo: `/home/daxtangco/rhcsa-trainer`, branch `phase-0-1`, HEAD `ab32303`.

Task 23 built the HTTP API, the disclosure-ladder content layer, and the browser
terminal bridge — the first code in this project that opens a listening socket and the
first that hands a browser a shell on a machine where `student` has passwordless
`sudo`. Task 24 builds the UI on top of it. **You are the gate before that happens.**

## Inputs

1. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-brief.md` — the
   requirements, extracted verbatim from the plan. Exact values live here.
2. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-mandates.md` — ten
   mandates I added on top of the brief, several of which correct the brief. Where the
   two disagree, **the mandates win** and the brief is the defect.
3. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-report.md` — 494 lines,
   the implementer's own account. Do not inherit its numbers; see "The bar."
4. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/review-9300d2b..ab32303.diff` —
   one commit, 82835 bytes. Read this, not `git diff`.

## Verdicts required — both, separately

1. **Spec compliance:** does the commit do what `task-23-brief.md` plus
   `task-23-mandates.md` require? Per-mandate disposition for mandates 1-10:
   MET / PARTIALLY MET / NOT MET.
2. **Task quality:** is the code good? Correctness, fail-open holes, test adequacy,
   naming, dead code, duplication.

A report missing either verdict is not accepted. Then one overall: **APPROVED** or
**CHANGES REQUIRED**.

## Scope

`9300d2b..ab32303` only. 14 files, 2101 insertions, 29 deletions (measured
`git diff --shortstat`). Everything under `content/`, `src/engine/` other than
`disclosure/`, and `src/cli/` was reviewed and approved in Tasks 1-22 — out of scope
unless this commit changed it.

## What to check, in priority order

### 1. The `at` walker in `test/server/app.test.ts`. Decide whether ~27 assertions are real.

This is the check I flagged as decisive, and it exists because the brief was wrong.
Hono's `res.json()` resolves to **`unknown`**, not `any`, so the brief's
`body.tasks[0].id` produced 40 `TS2571`/`TS18046` errors, and the brief's `start()`
helper contained an `as string` that mandate 3 forbids. The implementer replaced both
with four cast-free readers at `test/server/app.test.ts:111-150`: `at` returns
`unknown`, and `items`/`str`/`num` throw unless the value has the right runtime type.

`at`'s loop has three outcomes: array + numeric key → descend; record + string key →
descend, **but return `undefined` if `Object.hasOwn` is false**; anything else → throw
with the key and the container in the message.

**The hazard:** a walker that returned `undefined` for a *wrong path* as well as a
*missing property* would convert every masking assertion into a tautology —
`expect(at(body,'tasks',0,'prompt')).toBeUndefined()` would pass on a typo'd path just
as happily as on real masking. That is this project's defect class (a tool reporting
success without doing what was asked) relocated into a test helper, where it would be
invisible and permanent.

Measured, by me, in the session that wrote this file:

```
grep -cE '\b(at|items|str|num)\('  test/server/app.test.ts   → 45
occurrences: at( 34   items( 5   str( 7   num( 3
grep -nE 'expect\(at\(' test/server/app.test.ts | wc -l      → 27
grep -n 'toBeUndefined' test/server/app.test.ts              → 2 (lines 215, 375)
```

My reading is that the tautology risk is bounded to those two `toBeUndefined()` lines,
because the other 25 bare-`at` assertions compare against a concrete value that
`undefined` fails, and `items`/`str`/`num` throw on the wrong type. **Check that
reasoning rather than accepting it**, and specifically:

- Confirm the `undefined` arm is reachable **only** through the record+string branch,
  so a wrong-shaped path throws instead.
- For lines 215 and 375 — the two masking assertions, `prompt` omitted from
  `/api/tasks` summaries and `checkpoints` masked in exam mode — prove the path is
  otherwise correct: **mutate the property name to a deliberate typo and confirm the
  assertion still passes** (it will), then confirm the *un-typo'd* form fails when you
  delete the masking logic from `src/server/app.ts`. Only the second half proves the
  assertion has teeth. Do this in `/tmp`, not the repo.
- Say whether you would accept this helper into the project's test conventions or
  require something stricter (e.g. an `expectMissing(root, ...path)` that asserts the
  container exists before asserting the key does not).

### 2. The terminal bridge — the highest-risk surface on the branch

`src/server/terminal.ts` (156 lines) hands a WebSocket client a guest PTY via
`ssh -tt`, on a guest where the sudoers drop-in gives `student` passwordless `sudo`.
There is no authentication. The controls are: bind address, Origin allow-list, and the
fact that both live in `src/server/index.ts` (83 lines) — **which no test executes.**

Mandate 2(a) required an explicit `hostname` on `serve`. The implementer measured
`@hono/node-server/dist/index.mjs:1305` as
`server.listen(options?.port ?? 3e3, options.hostname, …)` — so the default is **not**
loopback. Without `HOST = '127.0.0.1'` this endpoint would have listened on every
interface. **Verify that measurement yourself from the installed package**, because it
is the difference between a local tool and an open shell, and confirm the value
actually reaches `serve`.

Then adjudicate the Origin check at `terminal.ts:120-131`:

- A **missing** `Origin` is allowed on purpose (documented at `terminal.ts:127`), so
  `wscat` and other non-browser clients work. Is that the right call for an endpoint
  with no auth? Browsers always send `Origin` on `ws://`, so this admits only
  non-browser clients that already have local code execution — argue it either way,
  but argue it.
- `ALLOWED_ORIGINS` (`index.ts:49-53`) is four entries built from `PORT` and
  `VITE_DEV_PORT`. Check for a bypass: origin comparison case/trailing-slash
  sensitivity, `null` as a literal origin string, IPv6 loopback (`http://[::1]:PORT`)
  being absent, and whether `new URL(req.url ?? '/', 'http://localhost')` at
  `terminal.ts:120` can be steered.
- What happens to the spawned `ssh` process when the socket closes, when the client
  never sends anything, and when `spawnSshPipe` fails? Leaked PTYs on a laptop are a
  real cost.
- The implementer discloses that `wscat` sends no `Origin`, so **the browser path was
  never exercised** and cross-origin refusal was never observed. Say whether that gap
  should block Task 24 or be carried into it.

### 3. `session.ts`'s truncation guard — verify it cannot be the fail-open in reverse

Mandate 7 added `allPassed: allPassed(v) && !incomplete` at `src/server/session.ts:107`.
The mechanism: `parseVerdict` never throws on a transcript that stops mid-line — it
yields a **short** `checkpoints` array with the partial line routed to `noise` — and
`allPassed(v)` is `length > 0 && every(pass)`, so a grader killed after 2 of 5
checkpoints returned `true`. A student who broke the guest badly enough to kill the
grader was told they passed.

The implementer's break-and-revert produced exactly one failure
(`session.test.ts:168`, `expected true to be false`). I confirmed that mechanism
independently before dispatch. **Your job is the other direction:** can the new guard
report a *fail* where the state is *right*? `expectedTotal` comes from
`countCheckpoints` over `assertLib + grade.sh`. Check every way the two counts can
legitimately disagree — `ck_skip`, a `ck` inside a conditional branch that does not
run, a checkpoint id emitted twice, a `ck` call in a comment or a heredoc — and say
whether a healthy run can trip `incomplete`. A false `incomplete` on a correct
solution is worse for this app's purpose than the bug it fixed.

### 4. Disclosure ladder — the leak that unit tests cannot see

`src/engine/disclosure/content.ts` (194 lines, new) and mandate 4's `TOP_RUNG`/`RUNGS`
in `src/engine/disclosure/ladder.ts`.

The ladder's whole value is that rung 2 does not sell what rungs 4 and 5 sell. Rung 2
is **synthesized** from the objective `text` plus the concept card `title` — there is
no `nudge:` field in `task.yaml`. Verify:

- `maxRung` is enforced **server-side** in `src/server/app.ts`, not merely reported to
  the client. `MAX_RUNG` is practice 5 / drill 3 / exam 2. Try to obtain rung-4 or
  rung-5 content in exam mode through `/api/sessions/:id/hint` — repeated calls, a
  reset, a rung parameter in the body if one is accepted.
- Mandate 5's command-sketch redaction: `NOISE` keywords, the `COMMAND_SHAPE` regex
  `/^[A-Za-z_][A-Za-z0-9_.+-]*$/`, and the inner loop `break`ing at the command
  position. The implementer documents two residuals it chose not to fix —
  `for u in alice bob` emits `u`, and a `case` label emits `a` — on the grounds that
  the sketch is a hint, not a grader, mitigated by an authoring convention. **Rule on
  whether that mitigation is adequate**, and try your own shapes against the redactor:
  a pipeline, a `sudo` prefix, a `$(...)` substitution, an assignment
  (`VG=vg_home lvextend …`), a heredoc, and a line beginning with a variable
  expansion. A leak here silently converts a rung-2 nudge into a rung-5 answer.
- `TOP_RUNG` / `RUNGS` are consumed at `app.ts:5,229,230` and `session.ts:4,42,162`.
  Confirm nothing still spells `5` or `[1,2,3,4,5]` inline where the constant belongs.

### 5. `src/server/index.ts` has zero test coverage — disclosed unprompted. Rule on it.

The implementer states plainly that no test executes this file: running it needs
`.env.local` (off limits) and `chooseTransport` (real VM probes, prohibited).
Uncovered: `readPort`'s `RHCSA_PORT` validation (reasoned against `loadVmConfig`, not
executed), `HOST` reaching `serve`, the `instanceof Server` narrowing, and the
`ALLOWED_ORIGINS` contents.

This file holds two of the three security controls in item 2. Your call, and I want it
argued: is an untested 83-line entry point acceptable here, or should some of it be
extracted into a testable function (e.g. `readPort` and the origin-set construction
taking their inputs as arguments) so a test can pin the values that matter? If you say
extract, name the seam.

### 6. Mandates 1, 6, 8, 9, 10 and the rest of the brief

- **Mandate 1:** the `src/engine/vm/ssh.ts` refactor (+68/−29) and what happened to
  `test/vm/ssh.test.ts`. Existing behaviour must be unchanged; check the deletions.
- **Mandate 8:** `fileURLToPath` instead of `new URL(...).pathname`. Confirm the new
  files use it. Seven pre-existing test files still use `.pathname` and are **parked**
  for the whole-branch review — `bank.test.ts`, `coverage.test.ts`,
  `objectives-golden.test.ts`, `concept.test.ts`, `objectives-real.test.ts`,
  `task.test.ts`, `objectives.test.ts`. Do not report them. Note that
  `test/lib/assert.test.ts` and `test/cli/validate.test.ts` *mention* `.pathname` in a
  comment while already using `fileURLToPath` — a naive grep returns nine, not seven.
- **Mandate 9:** `readPort`'s validation shape, copied from `src/engine/vm/config.ts`
  (which this task does **not** modify). Check the copy is faithful and that
  `config.ts:35-55`'s empty-string-defeats-`??` defect was not copied along with it —
  that defect is parked for the whole-branch review, but a *new* instance of it is in
  scope.
- **Mandate 10:** the second fixture `TASK_VMRUN` (`troubleshooting/028`,
  `transport: 'vmrun'`, `rebootCheck: false`) exists so `taskTransport` and `transport`
  can disagree. Verify the API distinguishes them (`app.test.ts:270-271`) and that a
  `vmrun` task under an `ssh` control plane behaves correctly rather than coincidentally.
- The ten routes are at `app.ts:84,88,91,108,120,179,185,212,235,259`. For each, check
  the failure path: unknown id, malformed body, a task id containing `..` or a slash
  (`/api/tasks/:area/:slug` builds a path), a session id that is not a session, and a
  second `/grade` on a finished session.

### 7. Residuals the implementer disclosed. Confirm each is what it says.

- Non-`Error` rejection from the reboot path, and `exec` rejection on run B.
- Step 20 (the only manual check in the task) **deferred entirely** — no VM, no ISO,
  and starting a long-running server is prohibited. Its `tasks: 5` and
  `checkpointTotal: 5` are flagged as content predictions, deliberately not encoded in
  any test because Tasks 21/22 own the bank and both numbers move when content is
  added. Say whether you agree with that reasoning or think a test should pin them.
- FL2: the brief's Step 5 acceptance checks deferred.

## Gates — run them, do not read them

I ran all of these before dispatch; reproduce them rather than citing me:

- `npm run typecheck` → exit 0.
- `npx vitest run` → **301 passing / 27 files** (baseline before this task was
  246/23, so +55 tests / +4 files).
- `node src/cli/index.ts coverage` → exit 0, **0** lines matching `problem:`.
- Cast inventory, `as unknown|as const`-excluded: **src 5 / test 29 / scripts 0** —
  unchanged by this task. The 5 in `src/` (`config.ts:54`, `task.ts:96` ×2, `:101`,
  `:108`, `verdict.ts:29`) and the 29 in `test/` are **parked** for the whole-branch
  review; a *new* cast in this diff is a finding.
- **0** non-null assertions in `src/server/` and `src/engine/disclosure/content.ts`.
- No `enum`, no `namespace`, no parameter properties, no decorators (Node 22 native TS
  stripping, `erasableSyntaxOnly`).
- `git status --porcelain` **empty** before and after. **Do not mutate the repo** —
  mutation-test by copying the tree to `/tmp` with `node_modules` symlinked back.
- Out-of-scope check over `9300d2b..ab32303`: nothing under `content/`, `src/cli/`,
  `objectives.yaml`, or `content/lib/assert.sh`. `package.json`'s delta is in scope and
  is exactly four packages (`@hono/node-server ^2.1.1`, `hono ^4.13.5`, `ws ^8.21.3`,
  `@types/ws ^8.18.1`) plus the `dev:server` script and a reformat of `engines` —
  confirm nothing else moved.

## Prohibitions

No VM operation of any kind, no `vmrun`. Do not run `scripts/provision.sh` (it powers
on a VM and copies 10 GB). Do not run `ssh-keygen` or write anything into
`/home/daxtangco/.ssh/` — `provision.sh` resolves `RHCSA_SSH_KEY` against the real
`$HOME` and a previous reviewer created a real keypair there. Do not create or read
`.env.local` — it is git-ignored and may hold the user's real VM password. Do not read
`.env`, `.env.sandbox` or `.env.example` under `/home/daxtangco/sechelp-tools` — they
belong to an unrelated project. No `shellcheck` (not installed; six tasks have
confirmed it). No `sudo` (no TTY). No subagents. **Do not leave a server listening** —
Hono's `app.request()` is a full round-trip through the router, so API tests need no
socket. `npm run validate` cannot run without a VM and its absence is not a finding.

## Environment

The Bash tool runs **zsh**: unquoted `$var` does not word-split, `grep --include='*.ts'`
needs quoting, plain `grep -n "a\|b"` errors under ugrep (use `grep -nE`), and
`bash -s <<'EOF'` gets you bash semantics. `ls` is aliased to **eza** — use `/bin/ls`.
npm scripts run under `/bin/sh -> dash`. Host is Node **v22.23.2**, vitest 3.2.7,
TypeScript 5.8. `124` project-wide means "timed out". `react`, `react-dom`,
`@testing-library/react`, `jsdom`, `tailwindcss` and `@xterm/xterm` are **not
installed** — anything about them is reasoned, not measured, and Task 24 owns them.

## The bar

The defect class this project keeps producing is **a tool reporting success when it did
not do what was asked.** Across Tasks 1-22 that has been: a grader passing a wrong
date, a solution exiting 0 having done nothing, a setup that would have broken loopback
and reported success, five measurement extractors that matched a word where they should
have matched a call, and eleven rationales written for paths nobody executed. In this
task the same class is available in three new places: a test helper that returns
`undefined` too eagerly, a redactor that lets a command through, and a server that
listens on the wrong interface.

For every item, ask whether it can report a pass where the state is wrong, or a fail
where the state is right. **Label each of your own conclusions `measured` or
`reasoned`** — a "verified" label on reasoning is the failure that produced this
sequence. Build your own extractors; do not inherit a number from the report or from
me. Both of us have shipped wrong counts in this project, and mine cluster in exactly
the mechanical details this file is full of.

## Report

Write the full review to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-review.md`.

Return only: the two verdicts, the per-mandate table, every finding with a severity and
a one-line failure scenario, and your rulings on the four judgement calls I asked for
(the `at` helper's acceptability, the missing-`Origin` allowance, `index.ts`'s zero
coverage, and the redactor's residuals).

If one of my ten mandates is wrong, say so directly. Five of my claims have been wrong
in the last three tasks and every one was caught by a reviewer rather than by me.
