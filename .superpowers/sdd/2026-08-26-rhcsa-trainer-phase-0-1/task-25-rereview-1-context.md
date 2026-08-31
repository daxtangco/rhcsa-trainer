# Task 25 — scoped re-review of fix rounds 1 and 2. The last task gate on the branch.

Repo `/home/daxtangco/rhcsa-trainer`, branch `phase-0-1`, range **`ccdba26..7880164`** — 2 commits
(`fe4b051` round 1, `7880164` round 2), 62 710 bytes of diff. Tree clean, `git tag -l` empty.

Read the diff from
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/review-ccdba26..7880164.diff` rather than
running `git diff`. The implementer's account is the `## Fix round 1` and `## Fix round 2` sections of
`task-25-report.md` — **a claim to test, not evidence.** Its requirements were `task-25-fix-1.md` and
`task-25-fix-2.md`. The findings being closed are F1, F2, F4, F5, F6, F7 and F8 in `task-25-review.md`,
plus a third silent-green channel the implementer found itself.

## What this pass is

Fix rounds 1-2 of 5, reviewed together. **Scoped:** you are checking that thirteen guards landed and that
each one **bites**. You are not re-reviewing Task 25 — its spec-compliance surface was approved except for
F4, and everything the original review confirmed stays confirmed unless this diff changed it. After you
there is one more gate on this branch, the whole-branch review, and then the branch is finished.

## The bar, and it is the whole point of this pass

**The recurring defect class in this project is a tool reporting success when it did not do what was
asked.** `countCheckpoints` took eight defects across six review rounds; every one was silent. `rhcsa lint`
joined that family the day it was written, with three separate instances found in a single review cycle.

So the question is never "does this read correctly." It is **"does the new test fail when the code is
wrong."** A test added to close a finding, which passes either way, is worse than the finding was — it
converts an open defect into a certified one. There are thirteen guards below and each one is a test.
Check that each bites, by suppressing the guard and watching the test die. Label every conclusion
`measured` or `reasoned`.

Three named shapes have each cost this branch real time. Look for them by name:

- **A gate that reported agreement because it never looked at the thing** — the unifying sentence behind
  all three silent-green channels found on this task.
- **A citation that proves something adjacent to its claim.** Four occurrences here, including a mutant
  that changed two things at once and a mutant that tripped an *earlier* assertion in the same test and
  was credited to the later one. When you cite a mutant, cite what it proves and nothing more.
- **A disclosure whose wording is wrong**, which is worse than no disclosure because the next author acts
  on its authority. Six occurrences on Task 23 alone.

## Round 1 — seven items. Verify each bites.

1. **F1** — `graders.length === 0` is a problem unless `--allow-empty`. Every check in `lintContent` is a
   loop over `graders`, so zero graders ran zero checks and exited **0**. Claim: deleting the guard kills
   **exactly one** test — the new one — so nothing depended on the old behaviour. Verify the count is
   exactly one.
2. **F2** — `HeaderRecord.ids` → `declared`, holding `id@phase`. Done as a **rename rather than a
   widening**, deliberately, so the compiler flagged every site comparing these against bare emitted ids.
   Claim: the fixture regenerated to 81/81 rows, 26 `declared`, **0** stale `"ids"`, 7 `@post`.
   **Test all three phases, not just `@post`.** The implementer's own mutation output shows a
   `home-from-lv@both` row, so `@both` is representable — confirm `@pre`, `@post` and `@both` each survive
   the round trip into the inventory and each produce a distinct row. A phase representation that collapses
   two of the three is F2 again.
3. **F4** — Task 24's check 1 (chapter numbers, `supporting` badge) restored as "The run" item 1, and check
   8's "derived, not self-reported" half restored as its second bullet. Claim: **15 of 15 traceable**,
   counted mechanically — mapping table parsed, `9-11` and `12-13` expanded, every item number resolved
   against a real numbered item and every named section against a real heading, 15 distinct numbers with
   none missing or duplicated. **Recount it yourself.** Then check the part that matters more: the
   fragments must be **inside** their items, not merely somewhere in the file, because
   adjacent-but-not-inside was F4's actual failure mode. Also verify the renumbering did not break another
   cross-reference — one was already caught ("question 4 below", now referred to by name); look for a
   second.
4. **F5** — `Array.isArray([])` is true, so the unmask assertion passed on an empty reveal. Now
   `toHaveLength(5)` plus a pinned `fs-home-size`. This test is **VM-gated and has never executed**, so
   read it as a prediction: is `5` derivable from committed content, and from where?
5. **F6** — four "asserted by the e2e test" rows now carry `†` and a footnote saying that suite is excluded
   unless `RHCSA_VM=1` and has never executed. Check the wording says what it means — this is the
   wrong-disclosure class, and the original finding was that five rows read as covered. **Four rows are
   marked. Was it five?** If the count changed, find out why.
6. **F7** — the `3 / 5` tally is check 9's prediction, not check 7's.
7. **F8** — 669, not 577; the earlier figure omitted two `##` headings and the separator. Verify 669.

## Round 2 — six guards, three of them unrequested. Check the unrequested ones hardest.

I required four rules. The implementer shipped six. **Unrequested changes are the highest-risk category on
this project**, and three of the four mandates I have been wrong about on this branch were caught by an
implementer refusing or extending them — so extensions here are neither automatically good nor
automatically bad. Judge them.

Required, all derived from `bank.tasks` rather than from a filesystem walk:

- **Rule 1 — `antisolutions/` absent.** Claim: exits 1 with
  `antisolutions/ is missing. loadTaskScripts swallows the readdir failure…`, and the `antisolutons`
  misspelling produces the **identical** message because the directory the loader wants is gone either way.
  Both were exit 0 at `fe4b051`.
- **Rule 2 — below `MIN_ANTISOLUTIONS`**, imported not restated. Claim: exits 1 with
  `006-team-provisioning: needs at least 1 anti-solution, found 0`, reusing the harness's own wording.
- **Rule 3 — below `MIN_SOLUTIONS`**, imported. Claim: exits 1 with
  `014-grow-home-lv: needs at least 2 solutions, found 1`, and was previously exit 0 **with a
  byte-identical inventory, because solutions carry no headers** — so the golden-fixture defence was not
  merely insufficient here, it was *unavailable*. **Verify that specific claim carefully**, because it is
  the one that retroactively settles an argument I refused in round 1, and a claim that convenient deserves
  more scrutiny than a claim that costs the implementer something.
- **Rule 4 — a file under `antisolutions/` not ending in `.sh`.** Claim: exits 1 on
  `antisolutions/03-wrong-lv.sh.bak does not end in .sh…`, and the test *also* asserts no `needs at least`
  problem appears, so the floor is not silently doing rule 4's work. That second assertion is the right
  instinct; confirm it is real.

Unrequested:

- **Rule 4′ — the same `.sh` rule on `solutions/`.** Justified on the grounds that `006` is the one task
  with three solutions, so renaming one there leaves exactly `MIN_SOLUTIONS` and no floor fires. Check that
  arithmetic against the real counts (claimed: solutions 2/2/2/2/3, anti-solutions 5/3/3/3/2).
- **Rule 5 — `grade.sh` required of every bank task.**
- **Rule 6 — graders reconciled back against the bank.** This is the sharpest thing in the round and the
  reason to take it seriously: I instructed the implementer to derive expectations from the bank rather than
  from a walk, and it observed that **`bank.tasks` is itself built from a walk for `task.yaml`**. So
  removing a task's `task.yaml` made the task vanish from the bank, and the lint agreed with a bank that had
  silently shrunk — exit 0 with an identical inventory at `fe4b051`. That is the same defect one level up.
  **Verify it, and then push one level further: is there any walk left underneath rule 6?** If the answer is
  that the reconciliation bottoms out somewhere, say where and whether that floor can itself go silent.

**The behaviour to scrutinise hardest in rule 6:** a bank that will not load is now reported as a problem
naming that the floors were skipped, *while the header checks still run and still print
`graders checked: 5`*. The stated principle is that **"could not check" must not read as "clean"** — which
is right, and is exactly F1's lesson. But check the implementation of it: is the exit code 1 in that state?
Does the printed `graders checked: 5` sit next to the problem or somewhere a reader will see it alone? A
partial run that prints a reassuring count is the shape this whole task has been about.

## The interaction nobody has tested: `--allow-empty` against the six new rules

`--allow-empty` was introduced in round 1 for one narrow purpose — letting F1's zero-grader guard be
bypassed deliberately. Round 2 then added six guards. **Does `--allow-empty` suppress any of them?**

If it short-circuits before the derived rules run, then a flag that was scoped to "I know this root has no
graders" now silently disables every floor on the bank, and the escape hatch has grown a blast radius
nobody authorised. My round-2 brief refused a second flag on the grounds that "one flag is a gate with a
documented override, two is a gate with a habit" — that reasoning only holds if the one flag stayed narrow.

Measure it: run with `--allow-empty` against a bank mutated to trip each of the six rules, and report
whether each still fails. This is my own instruction's blind spot and I want it checked rather than assumed.

## Claims to reproduce, by measurement

- **Kill sets of 2, 2, 2, 1, 1, 1 across nine distinct tests** when each of the six round-2 guards is
  suppressed one at a time. Confirm the counts and that the nine are distinct — a shared kill means two
  guards rest on one assertion.
- **The double-deletion hole.** At `fe4b051`, deleting `014`'s `grade.sh` **and** its `antisolutions/`
  together gave exit **0**, 17 rows — both halves of the interlock gone, both silent. The implementer's own
  one-sentence judgement, which I asked for and which confirms what I suspected: with rule 1 alone the
  `grade.sh` direction was still not independently guarded, because rule 1 fires on the anti-solutions being
  *absent* while the orphan message fires on them being *present*, so the two covered the space only
  jointly. Now claimed exit 1, with the test asserting stderr does **not** contain `no sibling grade.sh` —
  proving the problem came from the bank rather than from the interlock. **Reproduce both halves**: the
  exit-0 hole at `fe4b051` and its closure at `7880164`.
- **All rules pass the committed bank unchanged** — `lint:content` exit 0, empty stderr, and a test that
  states it rather than leaving it implicit. Verify no content file was touched.
- **Source restored byte-identically after every mutation**, sha256-verified. Confirm the tree matches
  `7880164`.
- Test count **423 / 35 files / 0 skipped** (413 after round 1, 408 before). Confirm the count *and* the
  skip count — a skipped test is not a passing test.

## Gates — run them, do not cite the report

`npm run typecheck`, `npx vitest run`, `npm run build:web`, `npm run lint:content`. Grep the **whole repo**
for `enum`, `namespace`, decorators, parameter properties, non-null `!` and `as` casts — exactly one cast
survives by ruling, at `src/web/api.ts:201`, and no `as unknown as` anywhere. Confirm `git tag -l` is still
**empty**: the `phase-1` tag is the user's, and its absence is correct. Confirm `git status --porcelain` is
empty before and after — **do not mutate the repo.** All mutation work goes in a `/tmp` copy:
`git archive 7880164 | tar -x -C /tmp/<dir>` with `node_modules` symlinked back. This is not a formality; a
measurement was once taken on this branch against a working tree another agent was editing, and it produced
a confident wrong answer.

## Out of scope — do not report these

- **The fourth channel**, `# unprobed-invariant:` being optional so absent and misspelled are
  indistinguishable. Measured by the implementer: `# unproved-invariant:` gives exit 0 and demotes
  `var-intact` from a declared invariant to an informational note. Parked by ruling as **P32** — nothing
  outside `src/cli/lint.ts` reads that header (grepped), so no verdict or student-visible number moves, and
  unlike F1 and rule 3 the golden fixture *does* catch it (measured, inventory differs). Confirm only that
  the implementer did not fix it.
- **`setup.sh` validation** — an open question I have asked the implementer to resolve; do not pre-empt it.
- **F3, F9, F10** from `task-25-review.md` — ruled to need nothing.
- **Everything in `whole-branch-parked.md`**, now P1-P32, including **P24** (a grader's expected count
  collapsing to 0 reports a pass), **P29** (Task 24's F4), **P5** (a concept card's own `objectives:` list
  is validated nowhere), **P31** (a rejecting `exec` has no test in 423), **P18**, **P22**, **P28**, **P4**,
  **P19-P21**, **P25-P27**. The whole-branch review carries all of them. Do not re-derive them, and do not
  report the absence of a `countSuspect` field as a gap — it is parked by ruling.
- **`src/server/session.ts`, `src/engine/grading/`, `content/lib/assert.sh`, `content/`,
  `objectives.yaml`** — Task 23 closed on `session.ts` after six review rounds and one spent breaker
  exception. Confirm this diff does not touch them. Note that `src/engine/validate/harness.ts` *is* touched,
  for two exports only; check it is only that.
- `shellcheck` is **not installed**; seven tasks have confirmed it. `npm run validate` and
  `npm run test:vm` need a VM. The bundle size, the terminal dying on `/reset`, and `report.regressions`
  ids going unrendered are all accepted. The `-gp` argv exposure at `src/engine/vm/vmrun.ts:108` is a
  documented known limit.

## Prohibitions

No VM operations of any kind — no `vmrun`, no `scripts/provision.sh` (it powers on a VM and copies 10 GB),
no snapshots, no start/stop/revert on any VM including the user's unrelated ones. No `sudo`: it cannot
authenticate here, there is no TTY. Do not run `ssh-keygen` or write into `/home/daxtangco/.ssh/`. Do not
create, read or modify `.env.local` — git-ignored, and it may hold the user's real VM password. Do not read
anything under `/home/daxtangco/sechelp-tools`. Do not dispatch subagents. Do not leave a dev server or any
listening process running — Hono's `app.request()` is a full round-trip through the router, so API tests
need no socket. Do not commit, merge, push or tag.

## Environment

The Bash tool runs **zsh**, not bash: unquoted `$var` does not word-split, `grep --include='*.ts'` needs
quoting, plain `grep -n "a\|b"` errors under ugrep (use `grep -nE`), and **a failed glob is an error rather
than an empty expansion**. `ls` is aliased to **eza** — use `/bin/ls`. **npm scripts run under `/bin/sh` →
dash.** Beware nested heredocs: a bare `EOF` inside a fenced code block terminates an outer heredoc early;
this has bitten twice. Node **v22.23.2**, vitest **3.2.7**, TypeScript **5.8**. `124` means timed out. Run
`npm run build:web` with `run_in_background`.

Two notes so you do not mistake them for defects: jsdom prints a harmless
`HTMLCanvasElement's getContext()` "Not implemented" line on any file mounting `TerminalPane`. And **vitest
regex-scans source for `@vitest-environment`**, so merely mentioning the directive in a comment activates it
— even inside a sentence denying it. That was Task 24's headline defect.

## Direction

There is no harmless miscall here. A **false pass** tells the student they solved a lab they did not, and
sends an unprepared person into a $400 exam. A **false fail** tells a student who solved it that they did
not, which teaches the wrong lesson just as firmly. And for this task the third direction is the live one: a
**false green on the bank itself**, where the gate reports clean content that is broken — which is how a bad
grader reaches a student in the first place. Classify every finding.

## Report

Write the full review to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-25-rereview-1.md`.

Return **only**: the verdict (**APPROVED** / **CHANGES REQUIRED**); one line per round-1 item 1-7 and per
round-2 rule 1-6 saying whether it landed **and whether its test bites**; whether all three phases
(`@pre`/`@post`/`@both`) survive into the inventory as distinct rows; your recount of the fifteen checks;
your ruling on the three unrequested rules; **whether `--allow-empty` suppresses any of the six new
rules**; whether the double-deletion hole is closed and whether any walk remains underneath rule 6; whether
the gates passed with the observed test and skip counts; and any new finding with severity, direction and
whether it is load-bearing.
