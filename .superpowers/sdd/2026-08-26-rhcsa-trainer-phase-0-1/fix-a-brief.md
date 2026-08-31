# Fix dispatch A — the grading-truth core

Five findings from the whole-branch review, chosen together because they are **one mechanism seen from
several angles**: the system trusts a single witness for how many checkpoints a grader should have emitted,
and every guard it has is derived from that same witness. Findings 1 and 6 are, in the reviewer's words,
"one finding seen from the type system and from the lexer." Fixing either alone leaves the composed path
open.

A second dispatch follows yours with the copy, comment and one-liner findings (F5, F7-F13). **Do not touch
those.** If you find yourself editing `src/cli/lint.ts`, `scripts/r1-probe.sh`, `src/web/screens/App.tsx`
copy, `content/**`, or any `docs/**` prose, stop — that is the other dispatch's diff and a collision here
costs a review round.

## Read these first

1. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/whole-branch-review.md` — **sections 2 and 7 in
   full**, plus finding rows 1, 2, 3, 4 and 6 of the section 8 table. That report is your requirements. It
   labels every claim `MEASURED` or reasoned; the measured ones are settled and you should not re-derive
   them, though you are welcome to re-run any of them and you should say so if one fails to reproduce.
2. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/whole-branch-parked.md` — P22, P24 and P29 only.
   Note that **P22's stated mechanism is wrong for the third time** and the review says so with a
   measurement; trust the review over the parked note where they disagree.

Everything else in the workspace is out of scope for you.

## What you are fixing

### F1 (S1, false pass) — partial deflation of `expectedTotal` reaches a clean pass

`MEASURED` in the review: sweeping one injected `cat <<NOPE` line across every insertion point in
`content/tasks/system/019-httpd-alt-port/grade.sh` makes `countCheckpoints` return **0, 1, 2, 3, 4, 5, 6, 7
or 8** depending on where the bad line lands. Zeroing holds only when the swallowing line precedes the first
`ck_*`; later, the lexer swallows the remainder of the file and the count lands at however many distinct ids
it had already seen.

Driven through the real `reportFor` with `expectedTotal = 3` and three passing arrivals, **every existing
signal reads clean**: `status.size < expectedTotal` false so `incomplete` is false; `status.size >
expectedTotal` false so mandate 10.5's `console.warn` never fires; `allPassed` true; `Rail.tsx:93`'s
`report.total > report.expectedTotal` false so `countSuspect` is false; `verdictFor` at `Rail.tsx:64`
returns `'pass'`. A grader that died three checkpoints into eight reports a clean pass on the screen and in
the rating.

**So the fix shape recorded in P24 — refuse to create a session at expected count 0 — is necessary and
insufficient. It closes the collapse and does not touch the deflation.** Do not ship only that.

**The sufficient shape, which the review derived and I am ruling in:** stop treating the lexer's count as a
lone witness. Cross-check it against the grader's own **declared header set** — the union of its
`# baseline-fail:` and `# unprobed-invariant:` ids. That is an independent source of truth, it already
exists, and `rhcsa lint` already computes exactly this reconciliation (which is why lint *does* catch
partial deflation: exit 1, 9 problems on the deflated `019` grader). A deflated lexer count disagrees with
the declared set; an honest count does not.

You own the design of how that second witness reaches the runtime path. Constraints on it:

- **Reuse, do not re-implement.** The header parsing exists (`declaredIds` / `parseUnprobed` in
  `src/cli/lint.ts` and whatever the engine already exposes). If the honest way to share it is to move a
  function into the engine and have the CLI import it, do that — but move it, do not copy it. A fourth
  hand-rolled parser in this repo is a finding, not a fix.
- **A grader legitimately may declare nothing.** Not every grader has headers. A missing declared set is not
  evidence of deflation; it is absence of a second witness, and the correct posture is "no cross-check
  available", not "suspect". Say in a comment which of those two you implemented and why.
- **The disagreement must reach the report as a field**, not only a `console.warn`. Mandate 10.5's warn is
  invisible to the rating path and to the client, and that invisibility is half of why this hole exists.

### F2 (S1, both directions) — `deriveRating` consults no suspicion signal

`src/server/app.ts:316-323` passes `passed: report.allPassed` into `deriveRating` with nothing consulted
about whether the report is trustworthy. `report.regressionCount > 0` and `report.passed > 0` come off the
**same suspect report**, so guarding only the `passed` argument still lets a truncated or deflated run write
a rating.

Have the rating path read the new report field from F1. Withhold the rating when the report is suspect.

**Two hard constraints, both from the review, both non-negotiable:**

- **Withhold the verdict and the rating; never withhold the exit.** A refusal at grade time must leave the
  session closable — the student must always be able to finish. `Rail.tsx` already does exactly this for
  `countSuspect`; match that behaviour, do not invent a new one. A refusal at session *creation* cannot trap
  anyone because no work exists yet, so that one is safe.
- **Do not build persistence.** Nothing persists a rating today: no scheduler in `src/`, zero disk writes
  from `src/server/`, sessions are an in-memory `Map`. That is deliberate for this phase. A wrong rating's
  blast radius is one line of displayed text in one finished attempt, and it must stay that way. If you find
  yourself adding a write, you have misread the task.

**A test you do NOT need to write.** An earlier brief claimed `countSuspect` was untested and instructed the
fix dispatch to add coverage. That was false and is corrected. `MEASURED` twice independently: mutating
`Rail.tsx:93` to `const countSuspect = false` gives `2 failed | 18 passed` on `test/web/rail.test.tsx`. The
guard is covered from two directions. Spend the budget on the deflation class and on `deriveRating`, which
genuinely have none.

### F3 (S2, silent false pass) — a note-only checkpoint id can be swallowed with no signal at all

`README.md:168-170` documents that an id named by no header at all is legal and reported as a **note**
rather than an error. Measured consequence: add such a checkpoint and `lint:content` gives exit 0, 0
problems, 1 note; now swallow that same checkpoint with a heredoc fail-open and `lint:content` gives exit 0,
0 problems, **and the note silently vanishes**. Nothing reports that anything changed.

All three note-only ids in the bank today (`home-from-lv`, `persist-config`, `default-target`) happen to be
named by an anti-solution's `# expect-fail:`, so **the bank as shipped is guarded by coincidence**. The hole
is one content addition away, and Phase 2 is entirely made of content additions.

Close it — either make a note-only id an error, or reconcile the note set against emitted ids so a
disappearing note is itself reported. **Rule between those two yourself and say which you chose and why**,
because the first changes what content is legal (and `README.md:168-170` documents the current rule, so that
sentence changes with it) while the second does not.

### F4 (S2, false green on content) — `checkCoverage` never runs on the serving path

`src/engine/content/bank.ts:174` is called only from `src/cli/index.ts:87`. `src/server/index.ts:24` calls
only `loadBank`. The two content gates are disjoint, and the one the README foregrounds is the weaker of the
two. One call site. Make the serving path run the same coverage check the CLI does, and decide whether a
coverage failure should refuse to serve or log loudly — say which and why. Leaning refuse-to-serve is
defensible here precisely because there is no student mid-session at server start.

### F6 (S2, false pass by composition) — the membership lists

Four `readonly string[]` lists (`src/engine/content/task.ts:10,11,12`, `src/engine/grading/verdict.ts:17`)
should adopt the `Record<Union, true>` idiom **this project already documents twice**:
`src/engine/vm/config.ts:20-22` (`KINDS`) and `src/server/app.ts:29-31` (`MODES`, whose comment explicitly
cites the first as precedent). `src/server/app.ts:38-40`'s `isSessionMode` is the payoff — a real type
predicate narrows, so the four casts *and* the six `as string` coercions disappear together rather than
merely becoming safe. Transcribe that pattern; do not design a new one.

Why it is here and not parked: `MEASURED`, adding a fourth `CheckpointStatus` (the obvious future `'error'`)
with `STATUSES` stale leaves tsc at **0** and the suite at **433/433**, while `asCheckpoint` returns
`undefined` at `verdict.ts:27` and `parseVerdict` files the line under `noise` — a checkpoint silently
disappears from the verdict. Composed with F1's partial deflation, arrivals equal the deflated
`expectedTotal` and **every guard reads clean: silent false pass.** Alone it is a false *fail* (arrivals <
expected → `incomplete` → withheld), and the guard holds. The composition is the finding.

**Two traps, both measured, both of which turn a fix into a new defect:**

- **`task.ts:12`'s `TRANSPORTS` deliberately mirrors `TaskTransport` (`'ssh' | 'vmrun'`), NOT
  `TransportKind` (which also has `'fake'`).** Verified at `src/engine/content/task.ts:8-14`. The content
  schema excludes the test transport on purpose. Making it exhaustive against `TransportKind` would let a
  bank declare `transport: fake` and load, putting a task that never touches a VM into a graded session —
  a false pass by construction. Make it exhaustive against `TaskTransport` and say so in the comment.
- **The two `readonly Union[]` lists (`RUNGS`, `PHASES`) need a different and smaller fix, and
  `Record<Union, true>` is the wrong one for them.** They already get *element correctness* from the
  compiler (a typo inside `PHASES` is a `TS2820` at the list with a did-you-mean). What they lack is
  *completeness*: a short `RUNGS` compiles, `MEASURED` at tsc 0 with 1 test failing. But both are **ordered
  arrays and `RUNGS`' order is load-bearing at `src/server/app.ts:255`**, where it builds the full rung list
  served to the client — deriving it from a record's keys would make disclosure order depend on key
  insertion order. Add an exhaustiveness **assertion** alongside the ordered array instead. Do not convert
  them.

  Name this asymmetry in a comment. The reviewer's reason is worth quoting: otherwise the next author fixes
  four sites, believes the class closed, and leaves two that still fail silently in the direction where a
  short `RUNGS` means **disclosure content the student can never reach**.

## Testing

TDD, per the project's standing practice: for each finding, a test that fails before your change and passes
after. Say in your report which assertion trips for each.

The bar for F1 specifically: **a test that fails on a partially deflated count, not only on a collapsed
one.** A test that only covers collapse-to-0 reproduces the exact gap this finding is about. Build the
deflation the way the review measured it — a heredoc fail-open positioned *after* the first `ck_*` — rather
than by hand-writing an `expectedTotal`, so the test exercises the real lexer.

Gates before you report, all four: `npm run typecheck`, `npx vitest run`, `npm run build:web`,
`npm run lint:content`. Baseline at HEAD is **433 tests / 35 files / 0 skipped, all passing**; report your
numbers. A skipped test is not a passing test.

## Constraints

- Node >= 22.23.2, native TS execution, **no build step**. Erasable syntax only: never `enum`, `namespace`,
  parameter properties, or decorators. Relative imports carry the `.ts` extension. ESM only, no `require`.
  No non-null `!`. `noUncheckedIndexedAccess` is on.
- **`sudo` cannot authenticate here — there is no TTY.** Never a step needing root on this host.
- **No VM operations of any kind** — no `vmrun`, no start/stop/snapshot/revert, and do not run
  `scripts/provision.sh` (it powers on a VM and copies 10 GB). Do not leave a server listening; Hono's
  `app.request()` is a full round-trip through the router, so API tests need no socket.
- **Do not read or write any `.env*` file**, including `.env.local`, which holds a real password.
- `shellcheck` is not installed. Do not report its absence; seven tasks already have.
- Commit with the identity inline and **stage by name** — never `git add -A`, never `git commit -a`:
  `GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost git commit -m "..."`
- Do not create a tag. Do not push. Do not merge.
- Shell notes: the shell is **zsh** — a failed glob is an error, not an empty expansion (use `find`); `grep`
  is ugrep so use `grep -nE "a|b"`; `ls` is eza (use `/bin/ls`); npm scripts run under dash. `$?` after a
  pipeline is the *last* command's status — the reviewer got a wrong answer from exactly that, mid-review,
  on the finding it cared most about.
- **Never dispatch subagents.** Review arrives from the controller after your report.

## Report

Write the full report to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/fix-a-report.md`.

Return **only**: status (`DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` / `NEEDS_CONTEXT`); the commit shas; one
line per finding F1, F2, F3, F4, F6 saying what you did and which assertion trips; your two rulings (F3's
error-vs-reconcile choice, F4's refuse-vs-log choice) with reasons; the four gate results with the observed
test and skip counts; and any concern — especially **anything in this brief you believe is wrong**, since
two claims in the brief that preceded it were measurably false and one of them was in the sentence that
dispatched work.
