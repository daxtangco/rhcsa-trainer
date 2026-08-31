# Task 25 — scoped re-review of fix round 4. The last round on this task, and the last task gate on the branch.

Repo `/home/daxtangco/rhcsa-trainer`, branch `phase-0-1`, range **`45344bd..4312359`** — 1 commit,
`src/cli/lint.ts` (+118/-8) and `test/cli/lint.test.ts` (+77/-5), 182 insertions / 13 deletions. I verified
before writing this: exactly those two files, tree clean, `git tag -l` empty.

Read the diff from
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/review-45344bd..4312359.diff` rather than running
`git diff`. The
implementer's account is the `## Fix round 4` section of `task-25-report.md` — **a claim to test, not
evidence.** Its requirements were `task-25-fix-4.md`. The findings being closed are **NEW-3** and **NEW-4**
from `task-25-rereview-2.md`, plus the consolidated **P35 shape A** rule from `whole-branch-parked.md`.

## Why this round exists, and the one thing it is really about

Round 3 closed four findings and every guard in it bites. The re-review then found that the **comment
defending one of those fixes was false** — it claimed `--allow-empty` asserts "an unauthored root", when the
flag asserts *zero graders* — and that the residual that comment defended **re-opened round 3's own blocker**
for any bank that fails to load. One broken `objectives.yaml` took the stripped bank from exit 1 / 10 problems
back to exit 0 / 0 problems / empty stderr.

So this task has now produced **six** instances of one sentence across four rounds: *the gate reported
agreement because it never looked at the thing.* Round 4 is where that stops or does not.

**Round 4 of 5. The breaker trips at 5.** If you find something load-bearing, say so plainly — but distinguish
"this round did not do what it claimed" from "here is a further thing I noticed", because only the first
justifies spending the last round.

## The bar

The question is never "does this read correctly." It is **"does the new test fail when the code is wrong."**
**Suppress each guard and watch its test die.** Report kill counts per guard, and say **which assertion
tripped** — this branch has five occurrences of a mutant credited to the wrong assertion, including one that
tripped an *earlier* assertion in the same test. Label every conclusion `measured` or `reasoned`.

Two named shapes, both of which have cost this branch real time:

- **A citation that proves something adjacent to its claim.** When you cite a mutant, cite what it proves and
  nothing more. A mutant that changes two things at once proves neither.
- **A disclosure whose wording is wrong**, worse than no disclosure because the next author acts on its
  authority. At least eleven occurrences on this branch — **and item 1 of this round is itself a fix to one.**
  So the highest-value thing you can do on item 1 is read the *replacement* comment as adversarially as the
  re-reviewer read the one it replaces. A round that fixes a false comment by writing a second false comment
  has made things worse, and it would be the third consecutive round to do so.

## Item 1 — NEW-3. The blocker. Three parts, and the third is the one most likely to be wrong.

**Part A — the code.** Expected: `if (graders.length > 0 || (await isFile(join(root, 'objectives.yaml'))))`
at what was `src/cli/lint.ts:497`. Reproduce these, all measured by the round-3 re-reviewer:

| root | before | required after |
|---|---|---|
| bare directory (`mkdtemp` + `tasks/`) | exit 0 | exit 0 — **preserved** |
| round 1's `emptyRoot()` (`tasks/…/setup.sh`, no bank file) | exit 0 | exit 0 — **preserved** |
| bank loads, zero tasks | exit 0 | exit 0 — **preserved** |
| stripped bank + broken `objectives.yaml`, 0 graders | exit 0, 0 problems | **exit 1**, parse error reported |
| stripped bank + `concepts/` deleted, 0 graders | exit 0, 0 problems | **exit 1**, reported |
| `tasks` is a regular file | exit 0 | **exit 1**, reported |
| stripped bank (loadable) | exit 1, 10 | exit 1, 10 — unchanged |
| committed bank | exit 0 | exit 0 — unchanged |

**Part B — the phrasing, and this is a correctness requirement rather than a style note.** The guard must be a
**fixed named path** check. Phrased as *"the walk found no `task.yaml`"* it is NEW-1's shape one artifact
along — a precondition computed from a walk of the very thing being validated. Phrased as *"this named file is
absent"* it is a filesystem fact about a fixed path. **The two read almost identically in English and are not
the same check.** If the implementer replaced, supplemented or "strengthened" the `isFile` check with a walk,
that is a finding regardless of whether the tests pass. Also confirm the weaker `files.length > 0` was not
substituted — it does not work, because round 1's `emptyRoot()` contains a `setup.sh`.

**Part C — the replacement comment.** Check every factual claim against the code, not the diff's narrative.
Specifically: does it state **what residual remains after the fix**, or does it read as though nothing does?
And does it keep the "this used to say X, which was wrong" treatment for its own predecessor? Two rounds have
now used that treatment and both times the note was accurate; a third that quietly deletes the wrong version
instead is a regression in practice even if the code is right.

**Regression check on Part A that nobody has been asked for yet.** The old guard existed for a reason and the
re-reviewer proved it: removing `if (graders.length > 0)` outright kills exactly 2 tests, both on
`expect(err).toBe('')`. The new condition is a **widening** of that guard, so ask what it now lets through that
it should not: is there a root where `objectives.yaml` exists, the bank loads fine, and the new arm causes a
*message* to be printed that previously and correctly was not? A false fail on a good root is the direction
this fix could plausibly introduce, and no measurement above covers it.

## Item 2 — NEW-4. One clause. Confirm it is true, not merely different.

Was: *"the only input every rule in `checkFixtureFloors` reads."* False under the natural reading — `graders`
is a second input, the `grade.sh` rule reads it (`lint.ts:346`) and the orphan rule **iterates** it
(`lint.ts:406`). Confirm the new wording is true under both readings, and confirm those two line references
still describe what the code does after this round's edits.

## Item 3 — P35 shape A. A new rule, and the unrequested-adjacent category is where this task has been weakest.

The rule: strip comments, blank lines and `set -e…`-style lines from an anti-solution body; if nothing
remains, the fixture does nothing and that is a problem. Rationale, which matters for judging the
implementation: an anti-solution exists to prove the grader **detects a specific wrong answer**, and nothing in
`runFixture` establishes that applying it changed the machine — so one that leaves the machine at the unsolved
baseline passes, because the goal checkpoints fail there anyway. It is green because the task is unsolved.

Check, in this order:

1. **It fires on none of the sixteen committed anti-solutions.** `lint:content` exit 0, empty stderr. The
   thinnest three each carry exactly one real command (`014/01-forgot-growfs.sh`, `014/03-wrong-lv.sh`,
   `017/02-faked-the-end-state.sh`). A rule that fires on the shipped bank is a **false fail on content**, the
   worst direction for a content gate.
2. **The positive test's fixture must carry a `# expect-fail:` header.** Without one it trips the
   header rule instead and the new rule is untested no matter how green the suite is. This is the
   adjacent-credit trap in its most likely form here. Verify the test also asserts the *header* problem does
   **not** appear.
3. **What counts as "nothing remains" is where the bugs live.** Probe the stripper: a line that is only
   whitespace; a trailing comment after a real command (`ls  # note` — must NOT fire); `set -euo pipefail`
   variants (`set -e`, `set -eu`, `set -o pipefail`); a `#!` shebang; a comment containing a `#` inside a
   quoted string; CRLF line endings. Report which of these the implementation gets right. Both a false fire
   and a missed no-op matter, in opposite directions.
4. **Solutions must be out of scope.** A solution that does nothing fails its own grader, which is loud. If
   the rule was applied to `solutions/` too, that is unrequested scope — judge it rather than assume it is bad,
   but say so.

## Out of scope — do not report these

- **P32** (`# unprobed-invariant:` optional, absent and misspelled indistinguishable) — parked by ruling.
  Confirm only that it was not fixed.
- **P33** (a walk remains under rule 6, so deleting a whole task directory gives exit 0 and
  `no problems in 4 grader(s)`) — parked. **A walk cannot detect the absence of something it has no
  independent record of**; the honest fix is a committed expected-task-id manifest, a new artifact rather than
  a guard.
- **P34** (`coverage --strict` already red on the shipped bank, 58 uncovered objectives) — parked.
- **P35 shape B** (a command that succeeds but is a no-op on this machine) — needs a `harness.ts` runtime check
  requiring the anti-solution's verdict A to differ from the baseline's. Out of scope, and `harness.ts` must
  **not** appear in this diff.
- **The shape-B static signal** ("declares exactly the grade script's `# baseline-fail:` set") and **the
  `03-wrong-lv.sh` header correction** — both deliberately excluded from round 4 by ruling. The signal fires on
  a committed, deliberate, defended fixture, so as an error it is a false fail on the bank; and editing that
  content file in the same diff as a new content rule would create a rule tuned to its own fixture. If the
  implementer added either, that **is** a finding.
- **F3, F9, F10** from `task-25-review.md` — ruled to need nothing.
- **Everything else in `whole-branch-parked.md`** (P1-P36, with P36 now superseded by NEW-3). The whole-branch
  review carries all of them. Do not re-derive them.
- `shellcheck` is **not installed** — seven tasks have confirmed it. `npm run validate` and `npm run test:vm`
  need a VM that does not exist. The bundle size, the terminal dying on `/reset`, and `report.regressions` ids
  going unrendered are accepted. The `-gp` argv exposure at `src/engine/vm/vmrun.ts:108` is a documented limit.

## Gates — run them, do not cite the report

`npm run typecheck`, `npx vitest run`, `npm run build:web` (use `run_in_background`), `npm run lint:content`.
Baseline was **431 tests / 35 files / 0 skipped**; confirm the new count **and the skip count** — a skipped
test is not a passing test. `lint:content` must exit 0 with **empty stderr**, `no problems in 5 grader(s)`,
`graders checked: 5`, `scripts with headers: 21`. Confirm `git tag -l` is still **empty** — the `phase-1` tag
is the user's and its absence is correct.

Confirm `git status --porcelain` is empty before and after — **do not mutate the repo.** All mutation work in a
`/tmp` copy: `git archive <sha> | tar -x -C /tmp/<dir>` with `node_modules` symlinked back. This is not a
formality: a measurement was once taken on this branch against a working tree another agent was editing, and it
produced a confident wrong answer. **Restore sha256-verified after every mutation.**

## Prohibitions

No VM operations of any kind — no `vmrun`, no `scripts/provision.sh` (it powers on a VM and copies 10 GB), no
snapshots, no start/stop/revert on any VM including the user's unrelated ones. No `sudo`: it cannot
authenticate here, there is no TTY. Do not run `ssh-keygen` or write into `/home/daxtangco/.ssh/`. Do not
create, read or modify `.env.local` — git-ignored, and it may hold the user's real VM password. Do not read
anything under `/home/daxtangco/sechelp-tools`. Do not dispatch subagents. Do not leave a dev server or any
listening process running. Do not commit, merge, push or tag.

## Environment

The Bash tool runs **zsh**, not bash: unquoted `$var` does not word-split, `grep --include='*.ts'` needs
quoting, plain `grep -n "a\|b"` errors under ugrep (use `grep -nE`), and **a failed glob is an error rather
than an empty expansion** — use `find`. `ls` is aliased to **eza** — use `/bin/ls`. **npm scripts run under
`/bin/sh` → dash.** Beware nested heredocs: a bare `EOF` inside a fenced code block terminates an outer
heredoc early; this has bitten twice. Node **v22.23.2**, vitest **3.2.7**, TypeScript **5.8**. `124` means
timed out.

Two notes so you do not mistake them for defects: jsdom prints a harmless
`HTMLCanvasElement's getContext()` "Not implemented" line on any file mounting `TerminalPane`. And **vitest
regex-scans source for `@vitest-environment`**, so merely mentioning the directive in a comment activates it —
even inside a sentence denying it. That was Task 24's headline defect.

## Direction

Classify every finding. A **false pass** tells the student they solved a lab they did not, and sends an
unprepared person into a $400 exam. A **false fail** tells a student who solved it that they did not. For this
task the live direction is the third: a **false green on the bank itself**, where the gate reports clean
content that is broken — which is how a bad grader reaches a student in the first place. Note that item 3
carries a real risk in the *false fail* direction too, which is unusual for this task: a stripper that is too
aggressive rejects a legitimate anti-solution.

## Report

Write the full review to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-25-rereview-3.md`.

Return **only**: the verdict (**APPROVED** / **CHANGES REQUIRED**); one line per item 1-3 saying whether it
landed **and whether its test bites, with which assertion tripped**; the reproduced item-1 table (all eight
rows); whether the guard is phrased as a named-path check rather than a walk; whether the replacement comment
is true in every claim **and states the remaining residual**; your answer to the Part-A regression question
(can the widened guard print a message on a good root that previously and correctly printed none); which of
the seven stripper edge cases in item 3 the implementation handles; confirmation that the item-3 rule fires on
none of the sixteen committed anti-solutions; whether the gates passed with the observed test and skip counts;
and any new finding with severity, direction, whether it is load-bearing, and **whether it justifies spending
round 5**.

---

## What round 4 actually claims. Written after reading its report; these are the specific things to test.

Everything above was written before the report existed and describes what round 4 was *asked* to do. This
section is what it *says* it did. Treat each as a claim.

**Line numbers moved** — `lint.ts` grew ~72 lines above the guard. The item-1 guard is now at **`:569`**
(was `:497`), `isFile` at **`:312`** (was `:283`), the item-2 comment at **`:496-500`**, item 3's
`changesNothing` at **`:222`** with `SHELL_OPTION_LINE` at **`:213`**, applied in the anti-solutions loop at
**`:670`**. Verify the anchors before you cite them; a re-review that cites `:497` is reading the wrong file.

**Test count 431 → 433 (+2).** Two new tests, one per code item. Item 2 added none, correctly — it is a
comment. Round 4 says so explicitly and does **not** claim a kill count for it: *"There is no mutant of it and
no test that could hold it, which is precisely why the wrong wording survived a round — the only gate on a
comment is a reader."* That is the right answer and you are that reader. **Item 2 is yours to verify by
reading, since nothing else can.** Check the new clause against `lint.ts:346` and `:406` and confirm those two
line references still point at the `grade.sh` rule and the orphan reconciliation after this round's edits.

**Four mutants claimed, each said to kill exactly 1-2 tests:**

| mutant | claim | what to check |
|---|---|---|
| M1 — revert the `\|\| await isFile(...)` clause | kills exactly 1, the new item-1 test, on `expect(r.code).toBe(1)` | Confirm the kill is on the **exit code**, not a message match. Round 4 argues this makes it unattributable to an adjacent assertion — agree or disagree. |
| M2 — guard removed outright (`if (true)`) | kills exactly 2, round 1's and round 3's exit-0 tests, both on `expect(err).toBe('')` | This is the **anti-weakening** check and it reproduces the re-reviewer's Mutation F exactly. Confirm the count is 2 and the same two tests. |
| M3 — item-3 rule unreachable (`if (false && …)`) | kills exactly 1, on `expect(r.code).toBe(1)` | Confirm the rule is the *sole* reason that root exits 1. |
| M4 — the `SHELL_OPTION_LINE` skip clause dropped | kills exactly 1, same test, same assertion | The isolating mutant for the one non-obvious clause. Also confirm round 4's claim that under M4 the **committed bank still lints exit 0 / stderr 0 bytes**. |

**Two unrequested-but-in-scope things landed. Judge both; do not assume either is wrong.**

1. **A twin of the false comment, in the test file.** Round 4 reports that the comment on
   `it('does not let --allow-empty excuse a bank that will not load when graders exist')` — `test/cli/lint.test.ts:585`
   before, **`:650`** after — repeated the false sentence *verbatim* (*"at zero graders an unloadable bank is
   the flag's assertion being true"*), and that after the fix it describes behaviour the code no longer has.
   Rewritten the same way. **Verify the old text really was there and really was false** — this is the
   highest-value single check in this review, because if round 4 is right then the wrong disclosure had
   *propagated* into a second file and every prior round read past it. If round 4 is wrong about what the old
   comment said, that is itself a citation-adjacent finding. `git show 45344bd:test/cli/lint.test.ts` settles it.
2. **Both wrong comment versions are now recorded as wrong, numbered, with a measurement against the second.**
   Check the measurement quoted for it (five tasks declared, every `grade.sh` deleted, one YAML typo → exit 0
   / 0 problems / stderr 0 bytes) is true, and that neither historical note misstates what its version said.

**The residual, which is the part of item 1 most likely to be wrong.** Round 4 claims the fix **narrows** the
channel rather than closing it, and gives this table (stripped bank, 0 graders, `--allow-empty`):

| `objectives.yaml` is… | claimed exit | claimed stderr |
|---|---|---|
| deleted | **0** | 0 bytes |
| a **directory** | **0** | 0 bytes |
| a **broken symlink** | **0** | 0 bytes |
| present but `chmod 000` | 1 | 250 bytes — reported, because `stat` succeeds so `isFile` is true |

Reproduce all four. Then check the **comment** actually states this residual — Part C above requires it, and
this table is the specific thing it must state. Round 4's own framing: the channel goes from *any* loader
failure to *the discriminator is itself the thing that is missing*. Decide whether you accept that as
adequately disclosed or whether row 1 (an authored, grader-less bank with `objectives.yaml` deleted → silent
exit 0) needs more than a comment. Note round 4 argues closing it needs a walk, which its own paragraph rules
out — so if you think it must be closed, say what artifact closes it, because "add a walk" contradicts item 1.

**The closing question got a real answer, and it needs independent measurement.** Round 4 swept `lint.ts` and
reports **one** site where a named-path question is answered by a walk: **`!graders.has(join(task.dir, 'grade.sh'))` at `lint.ts:375`.**
The claimed divergence, both ends measured: `shellScripts` filters on `entry.isFile()`, which does **not**
follow symlinks; `isFile` uses `stat`, which does. So replacing a committed `grade.sh` with a symlink to a real
script gives `graders checked: 4`, exit 1, 4 problems (`014-grow-home-lv is in the bank but has no grade.sh`
plus three `no sibling grade.sh`), while the same substitution on `setup.sh` — checked by named path — gives
exit 0, 0 problems. And `loadTaskScripts` reads both with `readFile`, which follows symlinks, so `isFile`'s
answer is the one matching the runtime.

**Reproduce both symlink ends.** Then rule on the argument for why it is not a defect, which is the sharpest
reasoning in the report and the thing most worth adversarial attention: NEW-1's shape is a walk supplying the
**expectation**; here the expectation comes from `bank.tasks` and the walk supplies only the **observation**. A
walk that under-reports an observation against an independent expectation fires when it should not — a **false
fail**, loud. A walk that supplies the expectation does not fire at all — a false green, silent. **Direction,
not structure, is what separates them.** Do you accept that? If you do, it is a parked item for the
whole-branch review, not a Task 25 blocker, and say so. If you don't, say what the failure is and in which
direction. Round 4 also records two adjacent sites as clean — `taskDirOf(grader)` vs `bank.tasks` dirs at
`:436` (two walks compared to each other, agreeing by construction: both composed with `join` from the same
`root`, no `realpath` on either side) and `emittedByTask.get(dirname(dirname(file)))` at `:639` (fails closed
twice, measured on a nested fixture) — spot-check the reasoning on those two rather than re-deriving them.

**Do not treat the `:375` symlink divergence as a reason to fail this round.** Round 4 was asked to *answer a
question*, and a question answered with a measured divergence and a direction argument is the answer working.
Whether the divergence deserves a fix is a whole-branch call with a fix budget attached; Task 25's gate is
whether items 1-3 landed and bite.

**One thing round 4 was not asked and did not answer.** The Part-A regression question above — can the widened
guard print a message on a root where `objectives.yaml` exists and the bank loads fine, where previously and
correctly it printed none? The eight-row table does not cover it: every row either has zero graders or is
already exit 1. The `chmod 000` row is the closest thing to it and points the other way. **This is yours to
answer, and it is the only direction on item 1 that nobody has measured.**
