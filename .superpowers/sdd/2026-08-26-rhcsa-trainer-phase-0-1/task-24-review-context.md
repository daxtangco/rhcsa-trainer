# Task 24 review — the Lab screen. Both verdicts required.

Repo `/home/daxtangco/rhcsa-trainer`, branch `phase-0-1`, BASE **`28ad7f0`**, HEAD **`7dbaaf4`** —
1 commit, 15 files, **+3512/−44**. Tree clean.

**This is the screen the whole project exists to be.** The user is training for the Red Hat RHCSA
(EX200) exam and built this app specifically so they could learn hands-on instead of reading a book.
Twenty-three tasks built the engine, the content bank, the grader harness and the HTTP/WebSocket API.
Task 24 is the first task whose output the user actually looks at. A defect here is a defect in the
only surface they will ever see.

## Your three inputs

1. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-24-brief.md` (1179 lines) — the
   requirements, with the exact values, component names, copy strings and test cases.
2. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-24-mandates.md` (638 lines) — corrections
   I derived from the brief's own code blocks before dispatch. **Where these conflict with the brief,
   these win.** Mandates 1-9 plus 10.1-10.5.
3. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/review-28ad7f0..7dbaaf4.diff` (156668 bytes) —
   commit list, stat summary and full `-U10` diff. **Read this rather than running `git diff`.**

The implementer's account is `task-24-report.md` (718 lines). It is a **claim to test**, not evidence.

## Two verdicts, both required

- **Spec compliance** — does the code do what the brief and the mandates require, with the exact
  values and copy they specify?
- **Task quality** — is it correct, tested, and free of the defect classes below?

A report missing either verdict is not accepted.

## Global Constraints — these bind every task, and they are your attention lens

Copied verbatim from the plan:

- **Node >= 22.23.2.** `node file.ts` executes TypeScript directly — there is no build step and no
  `tsx`/`ts-node` dependency.
- **Erasable syntax only.** **Never** `enum`, `namespace`, parameter properties
  (`constructor(private readonly x: T)`), or decorators. Use `const` objects with `as const` plus
  union types instead of `enum`. `erasableSyntaxOnly: true` makes violations fail typecheck.
- **Relative imports carry the `.ts` extension.** `allowImportingTsExtensions: true`.
- **ESM only.** `"type": "module"`. No `require`.
- **`sudo` cannot authenticate in this environment — there is no TTY.**
- **Target exam version is RHEL 9.** Do not add RHEL 10 content in these phases.
- **SELinux stays `enforcing` in the VM.**
- **Graders are read-only and their exit code is ignored.** A grader that repairs state, or aborts on
  first failure, is a defect.
- **Graders never read shell history.** Grade end state, not commands.
- **Do not read or copy anything from `/home/daxtangco/sechelp-tools`** — unrelated project, `.env`
  secrets.

Project-local additions that are as binding: **no non-null `!`**, **no `as` casts** except where
genuinely unavoidable, `noUncheckedIndexedAccess` is on, and `verbatimModuleSyntax` is on.

## The bar, and the one defect class that matters most here

**The recurring defect class on this project is a tool reporting success when it did not do what was
asked.** `countCheckpoints` took eight defects across six review rounds; every one was silent, and
every one was caught by measuring against ground truth rather than by reasoning. Five consecutive
reviews of that function each found a real defect the whole test suite passed over.

So: **label every conclusion `measured` or `reasoned`**, and prefer sabotage to inspection. Copy the
tree to `/tmp` with `git archive 7dbaaf4 | tar -x -C /tmp/<dir>` and symlink `node_modules` back — the
real `git status --porcelain` must stay empty. Then revert a line and see whether a test dies.

On this screen the class has a specific shape: **anything that could tell the user they passed when
they did not.** The grade path is where to look hardest. Relevant mechanics, all measured:

- `GradeReport` (from `reportFor`, `src/server/session.ts:543-594`) carries `passed`, `total`,
  `expectedTotal`, `incomplete`, `allPassed`, `rebooted`, `regressionCount`. `allPassed` is already
  `allPassed(v) && !incomplete` at `:591` — **it must not be re-ANDed with `!incomplete` in the UI.**
- `allPassed(v)` (`src/engine/grading/verdict.ts:81`) is `checkpoints.length > 0 && every(pass)`.
- `incomplete` is `status.size < expectedTotal`. It is the only guard against a grader that stopped
  part-way, and it is **disarmed whenever `expectedTotal <= arrivals`**. The false pass is exactly
  `arrivals >= expectedTotal` AND `arrivals >= 1` AND every arrival passed AND `arrivals < real total`.
  A count collapsed to 0 is the **widest** hole, not the safe one. That is what mandate 10.5(b)'s
  `total > expectedTotal` warning exists to surface; `session.ts:579` already `console.warn`s the same
  condition to a log nobody reads.
- `total`, `passed` and `expectedTotal` are **distinct-id** counts, not array lengths.

## Directed targets — ranked. Item 1 is where I most expect a real finding.

### 1. `App.tsx` has no test, and five mandate-required behaviours live only there

This is the implementer's own concern 1 and the largest gap it disclosed: `createApi()` at module
scope makes the module un-fakeable without restructuring, so the key-handler gate, `doFinish`'s
`setError(null)`, the concept fetch, the timer stopping at finish, and its own `setReport(undefined)`
false-pass fix are all `tsc`-clean and **unmeasured**.

I did not send a fix round for this before review, deliberately — I want your judgment on which of
those five are load-bearing rather than a reflexive demand for coverage. **Read all five and say, for
each, whether it is correct.** Then say which ones a reviewer should require a test for. A
`setReport(undefined)` fix that is wrong is a stale passing verdict rendered against a new attempt,
which is the exact class above; if it is right, say so and say what would break it later.

### 2. The implementer's headline defect — verify the fix, and look for siblings

It wrote a comment saying "Deliberately no `@vitest-environment jsdom` here" and **the comment
switched the file to jsdom**, because vitest regex-scans the source and does not care that the
sentence around it is a denial. It was caught only by an assertion added beyond the brief
(`expect(typeof globalThis.window).toBe('undefined')`).

Confirm the fix holds, and confirm the assertion actually bites — mutate the file back and watch it
fail. Then **look for the sibling class**: any other place where prose in a comment, a string, or a
test name can change behaviour, and any other environment or config assumption asserted in prose
rather than in code.

### 3. Mandate 9 — my premise was wrong, and I want the resolution checked

I wrote that `GradeReportView.phase` doesn't exist. The implementer refuted it by measurement:
`/grade` **does** return `phase` (`src/server/app.ts:287-291` spreads `reportFor` and adds
`phase`/`rung`). It kept `phase` off `GradeReportView` and added
`GradeResponse extends GradeReportView { phase; rung }` plus `FinishResponse`. I have confirmed the
`app.ts` shape myself. **Check the type split against every consumer** — a response type that omits a
field the server sends is harmless; one that *claims* a field the server omits is a runtime
`undefined` the compiler blessed.

Three of my mandates on the previous task were wrong and the implementer's measured refusals saved
two new defects. **If any mandate here is wrong, measure it and refuse it** — a backed refusal is
worth more than compliance. Say explicitly whether you found one.

### 4. The unmandated changes — the highest-risk category, because nobody specified them

The report claims **two unmandated false-pass fixes** plus: `verdictFor` extracted, `DOT` re-keyed by
the status union removing a dead fallback, a `persistenceUntested` verdict with a `rebootCheck`
condition, and `setReport(undefined)`. Mutation-test each. The report's own mutation table shows one
mutant that only died **after** an assertion was added — find that row and confirm the story, because
"I added the assertion that makes my test bite" and "I added an assertion so the table looks full" are
indistinguishable from the table alone.

Also: does any of these change what the student sees on a *correct* run? A new verdict condition that
fires on every task is a false fail, and a false fail on a correct answer teaches the wrong lesson as
surely as a false pass.

### 5. `vite.config.ts` imports a value from `src/server/config.ts`

The implementer names this as the deviation most likely to be argued with: type-only in spirit but a
real value import, safe only because `config.ts` is side-effect free — a property a future edit could
break. Rule on whether that is acceptable, and if it is, say what would need to be true to keep it
safe. It verified the config loads via vite's own `loadConfigFromFile` **without binding a socket**;
confirm no test or check in this diff binds a port.

### 6. Mandate 10.5(b) — confirm both required tests bite, and that the warning is not a failure

The two required tests were: one where `total > expectedTotal` renders the warning **without** a
failure verdict, and one where `expectedTotal === 0` with a nonempty all-passing list renders it even
though `allPassed` is `true` and `incomplete` is `false`. The second is the one that would have caught
the class. **Neither may be a crash test.** Confirm the copy is about the *result* being untrustworthy
and never about the student having failed, and confirm no `countSuspect` field was added to the server
report type — that decision is parked for the whole-branch review and is not Task 24's to make.

### 7. The six new dependencies

`react`, `react-dom`, `@testing-library/react`, `jsdom`, `tailwindcss`, `@xterm/xterm` were all
genuinely absent before this commit; installing them is in scope. `@vitejs/plugin-react` was pinned to
`^5.2.0` because the brief's bare install does not resolve (6.1.1 peers vite ^8; vitest 3.2.7 peers
^5/^6/^7). Confirm the pin is necessary and that **no `--legacy-peer-deps` or `--force`** was used.
Check `package.json` for anything installed that the diff does not use, and confirm nothing landed in
`dependencies` that belongs in `devDependencies`.

## Gates — run them, do not cite the report

`npm run typecheck`, `npx vitest run`, `npm run build:web`. Baseline is **351 tests / 29 files**; the
report claims **379 / 31**. Confirm the count and confirm **0 skipped** — a skipped test is not a
passing test. Confirm zero deprecation warnings. Grep the **whole** repo, not just the diff, for
`enum`, `namespace`, decorators, parameter properties, non-null `!` and `as` casts; the report claims
exactly one cast remains (`src/web/api.ts:192: return body as T`) and no `as unknown as` anywhere.
Confirm `git status --porcelain` is empty before and after: **do not mutate the repo.**

## Out of scope — do not report these

- **`src/server/session.ts`, `src/engine/grading/`, `content/`, `objectives.yaml`,
  `content/lib/assert.sh`** — Task 23 closed on `session.ts` after six review rounds and one spent
  breaker exception. Not this task's to touch, and its residual defects are already parked.
- Everything in `whole-branch-parked.md`, which the final whole-branch review carries. In particular
  **P24** (a single injected line takes a real grader's expected count from 8 to 0), **P18** (extract
  a shared `lexBash`; three measured drift sites), **P22/P28** (a doc-only mechanism correction),
  **P25/P26/P27**, and **P4** (`waitForGuest` returns before boot completes). Do not re-derive them.
- **Step 16's fifteen manual checks.** All fifteen are deferred on two blockers: there is no RHEL 9
  guest (the user has not downloaded the ISO — user-owned and accepted) and no browser on this host.
  Deferral is correct; **the handoff is what you review.** Does the checklist say what each check
  proves, so Task 25 can run them without re-deriving intent? The report flags checks 12-13
  (persistence) and 9-11 (masking) as the ones that would rot unnoticed — is that the right pair to
  worry about?
- `shellcheck` is **not installed**; six tasks have confirmed it. Not a finding. This task adds no
  shell scripts anyway.
- `npm run validate` and `npm run test:vm` cannot run without a VM. Not findings.
- Bundle size 744 kB / 206 kB gzipped with vite's >500 kB warning — localhost single-user app,
  deliberate. Not a finding unless you can show it breaks something.
- The terminal dying on `/reset` and needing a page reload is the brief's own design ruling; no
  reconnection logic is Phase 2. Not a finding.

## Prohibitions

No VM operations of any kind — no `vmrun`, no `scripts/provision.sh` (it powers on a VM and copies
10 GB), no snapshots, no start/stop/revert on any VM including the user's unrelated Ubuntu one. No
`sudo` — it cannot authenticate, there is no TTY. Do not run `ssh-keygen` or write into
`/home/daxtangco/.ssh/`. Do not create, read or modify `.env.local` — git-ignored, may hold the user's
real VM password. Do not read anything under `/home/daxtangco/sechelp-tools`. Do not dispatch
subagents. Do not leave a dev server or any listening process running — Hono's `app.request()` is a
full round-trip through the router, so API tests need no socket.

## Environment

The Bash tool runs **zsh**, not bash: unquoted `$var` does not word-split, `grep --include='*.ts'`
needs quoting, plain `grep -n "a\|b"` errors under ugrep (use `grep -nE`), and a failed glob is an
error rather than an empty expansion. `ls` is aliased to **eza** — use `/bin/ls`. npm scripts run
under `/bin/sh` → dash. Beware nested heredocs: a bare `EOF` line inside a fenced code block will
terminate an outer heredoc early. Node **v22.23.2**, vitest **3.2.7**, TypeScript **5.8**. `124` means
timed out. Run `npm install` and `npm run build:web` with `run_in_background`.

## Report

Write the full review to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-24-review.md`.

Return **only**:

- the **spec-compliance verdict** (APPROVED / CHANGES REQUIRED) and the **task-quality verdict**
  (APPROVED / CHANGES REQUIRED) — both, separately;
- the seven directed targets above, one line of disposition each;
- each finding with severity, direction (**false pass** / **false fail** / neither), a one-line failure
  scenario, and whether it is **load-bearing** — meaning it can produce a wrong truth-claim to the
  user on the app as it exists, not on a shape someone could write;
- whether the gates passed, with the observed test count and skip count;
- whether any mandate turned out to be wrong;
- whether the Step-16 handoff is good enough for Task 25 to act on.
