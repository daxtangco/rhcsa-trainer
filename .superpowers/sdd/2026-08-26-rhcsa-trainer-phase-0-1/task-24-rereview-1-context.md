# Task 24 — scoped re-review of fix round 1. Narrow by design.

Repo `/home/daxtangco/rhcsa-trainer`, branch `phase-0-1`, range **`7dbaaf4..d0ff66b`** — 1 commit,
5 files, 30469 bytes of diff. Tree clean.

Read the diff from `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/review-7dbaaf4..d0ff66b.diff`
rather than running `git diff`. The implementer's account is the `## Fix round 1` section of
`task-24-report.md` — **a claim to test, not evidence.** Its requirements were `task-24-fix-1.md`. The
findings it was closing are F1, F2 and F3 in `task-24-review.md`, whose verdicts were spec compliance
**APPROVED** and task quality **CHANGES REQUIRED**.

## What this pass is

Fix round 1 of 5. **Scoped:** you are checking that the six required items landed and that the fix did
not break or falsely certify anything. You are not re-reviewing Task 24. Everything already approved on
spec compliance stays approved unless this diff changed it.

## The six required items

1. **F1** — `finished` must no longer derive from `rating !== null`. `app.ts:315` returns
   `rating: null` for guided mode, so the old derivation made mandate 7's whole guard inert in guided:
   no confirmation box, Grade/Reset/F2/F4/F8 stayed live, the clock ran on until the rail said "over
   budget", and a second F4 hit the 409 whose `setReport(undefined)` wiped the earned "5 / 5 passed".
   My ruling required deriving from `phase === 'graded'`, **not** from a `mode === 'guided'` special
   case, so a mode added later cannot silently reopen the hole. The rating box needed a guided arm.
2. **F2** — both positive assertions on the pass verdict anchored, so the emerald
   `All checkpoints passed.` can no longer be satisfied by the rose `Not all checkpoints passed.`
3. **App item 1** — the key-handler gate: F2/F4/F8 do nothing once finished, **in guided mode**.
4. **App item 4** — the timer stops at finish. This is the assertion that catches F1 outright.
5. **App item 5** — the `setReport(undefined)` fix, with the test stating what it prevents: a stale
   passing verdict rendered against a new attempt.
6. **F3** — a `TerminalPane` test pinning mandate 6's `statusRef`: render with an inline arrow
   `onStatus` twice, assert **one** `WebSocket` construction.

## Claims to verify by measurement, not by reading

The implementer reports these. **Reproduce each one**; label every conclusion `measured` or `reasoned`.

- **M8 now dies** — replacing `Rail.tsx`'s emerald `All checkpoints passed.` with the rose
  `Not all checkpoints passed.` gives 3 failures where it previously gave **zero**.
- **The F1 probe dies** — reverting to `setFinished(done.rating !== null)` kills all three guided
  tests. Because all three die at the same early assertion, it isolated two narrower mutants:
  mutating the **timer gate alone** prints `expected '10:01 / 10:00' to be '00:04 / 10:00'` (the
  user-visible defect, on a lab graded 5/5), and mutating the **key gate alone** gives
  `expected 2 to be 1` (a second `finish()` getting through). Confirm both isolations — a single
  mutant that kills three tests at one shared assertion proves less than three that each die
  separately, and the isolation is the part of this story worth checking.
- **Putting `onStatus` back into `TerminalPane`'s deps opens 3 sockets where 1 is expected.**
- **Every mutated file was restored byte-identical.** Verify the tree is clean and matches `d0ff66b`.
- Test count **386 / 33 files, 0 skipped** (was 379/31). Confirm the count *and* the skip count.

## The one change nobody asked for — check it hardest

The implementer narrowed `SessionView.phase` and `GradeResponse.phase` from `string` to the server's
`SessionPhase`, via a type-only re-export, arguing that under `string` the mutation `=== 'gradedd'`
compiles clean and the guard silently never fires — the same never-fires shape as the defect itself.

That reasoning is good, and unrequested changes are still the highest-risk category in this project.
Check: is the re-export genuinely type-only (it must erase — `verbatimModuleSyntax` is on and there is
no build step for the server), does the narrowing break or newly-constrain any other consumer, and does
the bundle still contain no server code? The implementer claims a bundle grep proves erasure; run it.

## Gates — run them, do not cite the report

`npm run typecheck`, `npx vitest run`, `npm run build:web`. Grep the **whole repo**, not just the diff,
for `enum`, `namespace`, decorators, parameter properties, non-null `!` and `as` casts — the claim is
**exactly one** cast remains, at `src/web/api.ts:201`, and no `as unknown as` anywhere. Confirm
`git status --porcelain` is empty before and after: **do not mutate the repo.** All mutation work goes
in a `/tmp` copy — `git archive d0ff66b | tar -x -C /tmp/<dir>` with `node_modules` symlinked back.

## Out of scope — do not report these

- **F4**, parked by ruling with P24: when `verdictFor` returns `null` the rail says "This is not a
  score" yet Finish stays enabled and derives a rating from `report.allPassed`. The real fix needs a
  `countSuspect`-aware finish path whose field mandate 10.5(b) explicitly parks. Confirm only that the
  implementer left it **untouched** and added no `countSuspect` field.
- **Step 16's fifteen manual checks** — all deferred on two blockers (no RHEL 9 guest, the user has not
  downloaded the ISO; no browser on this host). The handoff was already ruled good enough for Task 25.
  Confirm only that they are unchanged.
- `src/server/session.ts`, `src/engine/grading/`, `content/`, `objectives.yaml`,
  `content/lib/assert.sh` — Task 23 closed on `session.ts` after six rounds and one spent breaker
  exception. Confirm this diff does not touch them.
- Everything in `whole-branch-parked.md` (P4, P18, P22, P24, P25, P26, P27, P28) — the whole-branch
  review carries those. Do not re-derive them.
- Bundle size (744 kB / 206 kB gzipped, deliberate for a localhost single-user app), the terminal dying
  on `/reset` and needing a reload (the brief's own design ruling), and `report.regressions` ids going
  unrendered. All three accepted.
- `shellcheck` is not installed; not a finding. `npm run validate` and `npm run test:vm` need a VM;
  not findings.

## Prohibitions

No VM operations of any kind — no `vmrun`, no `scripts/provision.sh` (it powers on a VM and copies
10 GB), no snapshots. No `sudo`: it cannot authenticate here, there is no TTY. Do not run `ssh-keygen`
or write into `/home/daxtangco/.ssh/`. Do not create, read or modify `.env.local` — git-ignored, may
hold the user's real VM password. Do not read anything under `/home/daxtangco/sechelp-tools`. Do not
dispatch subagents. Do not leave a dev server or any listening process running — Hono's `app.request()`
is a full round-trip through the router, so API tests need no socket.

## Environment

The Bash tool runs **zsh**, not bash: unquoted `$var` does not word-split, `grep --include='*.ts'` needs
quoting, plain `grep -n "a\|b"` errors under ugrep (use `grep -nE`), and a failed glob is an error
rather than an empty expansion. `ls` is aliased to **eza** — use `/bin/ls`. npm scripts run under
`/bin/sh` → dash. Node **v22.23.2**, vitest **3.2.7**, TypeScript **5.8**. `124` means timed out. Run
`npm run build:web` with `run_in_background`.

Two jsdom notes from the implementer, so you do not mistake them for defects: jsdom prints a harmless
`HTMLCanvasElement's getContext()` "Not implemented" line on any file mounting `TerminalPane`, and
`window.location.host` is `localhost:3000` in jsdom.

## The bar

**The recurring defect class in this project is a tool reporting success when it did not do what was
asked** — `countCheckpoints` took eight defects across six review rounds and every one was silent. The
round-1 finding fit that class precisely: the one part of the diff the implementer called unmeasurable
was the one that shipped a load-bearing defect, in the mode a beginner uses first.

So the question for you is not "does this read correctly" but **"does the new test actually fail when
the code is wrong."** A test added to close a finding, which passes either way, leaves the project worse
than the finding did — it converts an open defect into a certified one. Every one of the six items above
is a test; check that each **bites**.

On this screen, direction matters: a **false pass** tells a student they solved a lab they did not; a
**false fail** tells a student who solved it that they did not. F1 was a false fail, and a false fail on
a correct answer teaches the wrong lesson as surely as a false pass. Classify anything you find.

## Report

Write the full review to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-24-rereview-1.md`.

Return **only**: the verdict (**APPROVED** / **CHANGES REQUIRED**); one line per required item 1-6
saying whether it landed **and whether its test bites**; whether M8, the F1 probe and both isolated
mutants die, measured; your ruling on the unrequested `SessionPhase` narrowing; whether the gates passed
with the observed test and skip counts; and any new finding with severity, direction and whether it is
load-bearing.
