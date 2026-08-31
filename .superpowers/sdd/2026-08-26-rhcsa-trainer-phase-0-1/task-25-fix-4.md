# Task 25 — fix round 4 of 5. You are a fresh implementer, one tier up. Read this whole file before touching anything.

Base is `45344bd` on branch `phase-0-1`, repo `/home/daxtangco/rhcsa-trainer`. Tree is clean, `git tag -l`
is empty and must stay empty. Commit on `phase-0-1`, stage **by name**, identity inline:

```
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost git commit -m "..."
```

Never `git add -A`, never `git commit -a`.

**You touch exactly two files: `src/cli/lint.ts` and `test/cli/lint.test.ts`.** Nothing else. Not
`harness.ts`, not `src/server/session.ts`, not `src/engine/grading/`, not `content/lib/assert.sh`, not
`objectives.yaml`, and **no content file** — every rule you add must still pass the committed bank unchanged.

## Where you are, in one paragraph

This is a web app that trains the user for the Red Hat RHCSA (EX200) exam. They do labs in a real RHEL 9 VM
and a bash grader inspects the resulting end state. `rhcsa lint` is the **static gate over the content bank**:
it is what stops a broken grader from ever reaching a student. Task 25 built it. Three review rounds have
found **five separate instances of one sentence** in it — *the gate reported agreement because it never
looked at the thing.* Round 3 closed four findings and every guard in it bites under suppression; the code is
right. The re-review then found that the **comment defending one of those fixes is false**, and that the
residual it justifies is materially wider than disclosed. That is round 4, plus two parked items consolidated
into it because they live in the same file and a round 4 now exists regardless.

The full round-3 re-review is at `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-25-rereview-2.md`.
**Read items 2, NEW-3 and NEW-4 in it** — it contains the measurements you are reproducing, and it did the
work of implementing and measuring item 1's fix already.

## The standard you are held to, and it is the whole reason this round exists

**The recurring defect class on this project is a tool reporting success when it did not do what was asked.**
`countCheckpoints` took eight defects across six rounds, every one silent. So:

- The question is never "does this read correctly." It is **"does the new test fail when the code is wrong."**
  **Suppress each guard you add and watch its test die.** Report the kill count per guard. A test that passes
  either way is worse than no test: it converts an open defect into a certified one.
- **A citation that proves something adjacent to its claim** has happened five times on this branch. When you
  cite a mutant, cite what it proves and nothing more. A mutant that changes two things at once proves neither.
- **A disclosure whose wording is wrong is worse than no disclosure**, because the next author acts on its
  authority. At least eleven occurrences on this branch. **Item 1 below is literally an instance of this
  class**, so do not create another one while fixing it.
- Label every conclusion `measured` or `reasoned`. Do not write `measured` for something you read.

All mutation work goes in a `/tmp` copy: `git archive <sha> | tar -x -C /tmp/<dir>` with `node_modules`
symlinked back. **Never measure the shared working tree** — a measurement was once taken on this branch
against a tree another agent was editing and produced a confident wrong answer. sha256-verify your restore.

## Item 1 — REQUIRED, the blocker. NEW-3: a false sentence, and the residual it defends is wider than it says.

Round 3 fixed NEW-1 by running `loadBank` and `checkFixtureFloors` unconditionally. Correct, and it bites.
But the bank-did-not-load **message** stays behind `if (graders.length > 0)` at `src/cli/lint.ts:497`, and the
comment defending that placement says:

> "and when `--allow-empty` says an unauthored root is expected, an unloadable bank is that assertion being
> true rather than a defect."

**That is false, twice over.** `--allow-empty` does not say the root is unauthored; it says *zero graders is
expected*. The flag's own message at `lint.ts:459-460` says so — "pass `--allow-empty` if an empty bank is
genuinely expected", an empty **bank**, meaning no `grade.sh`. It asserts nothing about `objectives.yaml`,
`concepts/` or `task.yaml`. So "an unloadable bank is that assertion being true" does not follow: it infers a
property of the **content** from a failure of the **loader**, which is structurally the same inference error
as the comment it replaced (which inferred a property of the bank from a result of the walk).

And the consequence, which the comment never states, is that **NEW-1's exact channel is still open whenever
the bank fails to load.** Measured by the re-reviewer:

| root | `--allow-empty` | exit | problems |
|---|---|---|---|
| stripped bank (5 `task.yaml`, 5 `setup.sh`, `concepts/`, valid `objectives.yaml`, 0 graders, 0 antisolutions) | yes | 1 | 10 |
| same root **+ broken `objectives.yaml`** | yes | **0** | **0, stderr 0 bytes** |
| same root **+ `concepts/` deleted** | yes | **0** | **0, stderr 0 bytes** |
| valid `objectives.yaml`, `tasks` is a regular **file** | yes | **0** | **0** |

So one ordinary YAML typo re-opens the channel round 3 was opened to close. NEW-1 is closed only for banks
that load.

### The fix, which has already been implemented and measured — reproduce it, do not redesign it

```
-    if (graders.length > 0) {
+    if (graders.length > 0 || (await isFile(join(root, 'objectives.yaml')))) {
```

`isFile` is at `lint.ts:283` — the helper **this round's predecessor added** — and `join` is already imported
at `lint.ts:3`. The re-reviewer's measurements, for you to reproduce:

| root | today | with the fix |
|---|---|---|
| bare directory (`mkdtemp` + `tasks/`) | exit 0 | **exit 0** — preserved |
| round 1's `emptyRoot()` (`tasks/…/setup.sh`, no bank file) | exit 0 | **exit 0** — preserved |
| bank loads, zero tasks | exit 0 | **exit 0** — preserved |
| broken `objectives.yaml`, 0 graders | exit 0, 0 problems | **exit 1**, reported with the parse error |
| `concepts/` deleted, 0 graders | exit 0, 0 problems | **exit 1**, reported |
| `tasks` is a file | exit 0 | **exit 1**, reported |
| stripped bank (loadable) | exit 1, 10 | exit 1, 10 — unchanged |
| committed bank | exit 0 | exit 0 — unchanged |
| full suite | 431 pass | **431 pass / 0 fail** |

**Two things about this fix are load-bearing and you must not "improve" either.**

1. **`objectives.yaml` is a fixed named path, and that is the entire point.** An earlier analysis named the
   trap precisely: phrase this condition as *"the walk found no `task.yaml`"* and it is **NEW-1's shape
   again, one artifact along** — a precondition computed from a walk of the very thing being validated. Phrase
   it as *"this named file is absent"* and it is a filesystem fact about a fixed path, which is safe. **The
   two read almost identically in English and are not the same check.** Do not replace, supplement or
   "strengthen" the `isFile` check with a walk for `task.yaml`. If you think a walk is needed, say why in the
   report and leave the code alone.
2. **The weaker candidate `files.length > 0` does not work** — round 1's `emptyRoot()` contains a `setup.sh`.
   Measured. Do not substitute it.

### Tests required for item 1

- The **flag's advertised use case landing on its blind spot**: a root with malformed `task.yaml` and no
  `grade.sh`, pinned at **exit 1 under `--allow-empty`**. This is the important one — `task.yaml` written
  first with a YAML error, before `grade.sh` and `antisolutions/` exist, is precisely the half-authored state
  the flag documents itself for.
- `--allow-empty` **still exits 0** on a bare directory and on round 1's `emptyRoot()`. **Confirm round 1's
  and round 3's existing exit-0 tests are genuinely unchanged** — weakening them is the cheapest way to make
  this look clean, and the re-reviewer already proved both are live (removing the guard outright kills exactly
  those two, both on `expect(err).toBe('')`).
- Suppression: report what dies when you revert the `|| await isFile(...)` clause.

### And rewrite the comment

Replace the false sentence with what is true. It must say: the guard is about the **message**, not the rules;
`--allow-empty` asserts **zero graders**, not an unauthored root; `objectives.yaml`'s presence is what
distinguishes "nobody authored a bank here" from "a bank is here and would not load"; and **what residual
remains after your fix** — state it plainly rather than leaving a reader to infer that nothing does. Keep the
"this used to say X, which was wrong" treatment: the previous author recorded its wrong version as wrong
rather than deleting it, the re-reviewer verified that note is accurate, and I endorse it. **Add yours the
same way.** A reader who remembers the old reasoning should learn it was wrong, not find it silently absent.

## Item 2 — REQUIRED, cheap. NEW-4: one clause.

> "`bank.tasks` is the independent record of what should exist, and it is the only input every rule in
> `checkFixtureFloors` reads."

True under the intended reading ("the one input *common to* every rule"), false under the natural reading
("each rule reads nothing but `bank.tasks`") — `graders` is a second input, the `grade.sh` rule reads it at
`lint.ts:346`, and the orphan reconciliation rule at `lint.ts:406` **iterates** it. Given this branch's
history, fix the wording. "the one input every rule has in common" says it. Comment only, no code change.

## Item 3 — REQUIRED. P35 shape A: an anti-solution whose body does nothing is certified as a working detector.

This is the sharpest item on the parked list and it is being handed to you because it is **statically
closable in the gate that already runs**, with no guest.

An anti-solution exists to prove the grader **detects a specific wrong answer**. `runFixture` resets, runs
`setup.sh`, runs the fixture, grades, and compares the verdict against the fixture's declared
`# expect-fail:` ids. **Nothing establishes that applying the anti-solution changed the machine.** So a
fixture that leaves the machine at the unsolved baseline passes: at baseline the goal checkpoints fail, which
is exactly what it declared. It is green because the task is unsolved, not because the grader caught anything.

**Shape A is the natural form of a half-written anti-solution.** The `# expect-fail:` header is itself a
comment, so the ordinary authoring order is: write the header and the explanatory paragraph, add the command
later. Every anti-solution in the bank is written in that style. A body of only comments (plus
`set -euo pipefail`) has a header, so it is not caught by the missing-header throw, and bash exits 0 having
done nothing.

**The rule:** strip comments, blank lines and `set -e…`-style lines from an anti-solution body; if nothing
remains, the fixture does nothing and that is a problem. Pure content inspection — no guest, no verdict.

Constraints, all of which matter:

- **It must fire on none of the sixteen anti-solutions in the committed bank.** Measured basis: the thinnest
  three each carry exactly one real command (`014/01-forgot-growfs.sh`, `014/03-wrong-lv.sh`,
  `017/02-faked-the-end-state.sh`); the rest carry three to fourteen. Verify this yourself — `lint:content`
  must stay exit 0 with empty stderr.
- **Do not add the shape-B signal.** There is a second static signal available — "this anti-solution declares
  exactly the grade script's `# baseline-fail:` set" — and it is **ruled out of this round**. It fires on
  `content/tasks/storage/014-grow-home-lv/antisolutions/03-wrong-lv.sh`, which is committed, deliberate and
  defended in writing by its author, so as an error it is a **false fail on the shipped bank**. Introducing a
  warning tier to accommodate it is a new concept in this command and is not this round's work.
- **Do not touch `03-wrong-lv.sh`.** Its header does overstate its protection (it claims the exit-code check
  closes this class; the exit-code check catches a fixture that *errors*, not one that exits 0 having done
  nothing). That correction is routed elsewhere. It is a content file. Leave it.
- Solutions are **not** in scope for this rule — a solution that does nothing fails its own grader, which is a
  loud failure rather than a silent green. Anti-solutions only.

Prove it bites: a fixture whose body is only comments plus `set -euo pipefail`, plus a header so it is not
caught by the header rule instead. **That second half is essential** — a test whose fixture trips an earlier
rule proves nothing about this one, and crediting a kill to the wrong assertion is a named defect class here.
Assert the specific message, and assert that the *header* problem does not appear.

## Not in scope, by standing ruling. Do not fix, do not report.

- **P32** — `# unprobed-invariant:` is optional, so absent and misspelled are indistinguishable. Parked.
- **P33** — a walk remains under rule 6, so deleting a whole task directory gives exit 0 and
  `no problems in 4 grader(s)`. Parked: unlike every other channel here there is no in-command source of
  truth being ignored, because `bank.tasks` is itself a walk. The honest fix is a committed expected-task-id
  manifest — a new content artifact with its own drift problem, not a guard. **A walk cannot detect the
  absence of something it has no independent record of.**
- **P34** — `coverage --strict` is already red on the shipped bank (58 uncovered objectives). Not yours.
- **P35 shape B** — a command that succeeds but is a no-op on this machine. Needs a `harness.ts` runtime
  check (require the anti-solution's verdict A to differ from the baseline's). Out of scope.
- **F3, F9, F10** from `task-25-review.md` — ruled to need nothing.
- `shellcheck` is **not installed**; seven tasks have confirmed it. Do not report it.
- `npm run validate` and `npm run test:vm` need a VM that does not exist yet. Do not attempt them.
- Do not create the `phase-1` tag — it is the user's. Do not soften a NOT-RUN marking or imply Phase 1's exit
  criterion was met. It was not and cannot be yet: the RHEL 9 ISO is not downloaded.

## Gates — run them, all four

`npm run typecheck`, `npx vitest run`, `npm run build:web` (use `run_in_background`), `npm run lint:content`.

Current baseline is **431 tests / 35 files / 0 skipped**. Report your count **and the skip count** — a
skipped test is not a passing test. `lint:content` must exit 0 with **empty stderr** and
`no problems in 5 grader(s)`, `graders checked: 5`, `scripts with headers: 21` on the committed bank.
`git status --porcelain` empty when you finish, work committed, `git tag -l` still empty.

## Prohibitions

No VM operations of any kind — no `vmrun`, no `scripts/provision.sh` (it powers on a VM and copies 10 GB), no
snapshots, no start/stop/revert on any VM including the user's unrelated Ubuntu and Windows 11 ones. **No
`sudo`** — it cannot authenticate here, there is no TTY, so do not reach for it even for a permissions
fixture. Do not run `ssh-keygen` or write anything into `/home/daxtangco/.ssh/`. Do not create, read or modify
`.env.local` — it is git-ignored and may hold the user's real VM password. **Do not read anything under
`/home/daxtangco/sechelp-tools`** — an unrelated project containing `.env` secrets. Do not dispatch
subagents, and do not dispatch a reviewer: review arrives after your report. Do not leave a dev server or any
listening process running. Do not commit anything but your two files. Do not merge, push or tag.

## Environment

The Bash tool runs **zsh**, not bash: unquoted `$var` does not word-split, `grep --include='*.ts'` needs
quoting, plain `grep -n "a\|b"` errors under ugrep (use `grep -nE`), and **a failed glob is an error rather
than an empty expansion** — use `find` instead of a glob that may match nothing. `ls` is aliased to **eza** —
use `/bin/ls`. **npm scripts run under `/bin/sh` → dash.** Beware nested heredocs: a bare `EOF` inside a
fenced code block terminates an outer heredoc early; this has bitten twice. Node **v22.23.2**, vitest
**3.2.7**, TypeScript **5.8**. `124` means timed out.

Style constraints that fail the build if broken: **no `enum`, no `namespace`, no parameter properties, no
decorators** (`erasableSyntaxOnly: true`); relative imports carry the **`.ts` extension**; ESM only; no
non-null `!`. Avoid `as` casts — there are thirteen in `src/`, every one guarded by a predicate immediately
above it, and that record is worth keeping. Note `vitest` **regex-scans source for `@vitest-environment`**,
so merely mentioning that directive in a comment activates it — even inside a sentence denying it.

## Direction

Classify every finding you make. A **false pass** tells the student they solved a lab they did not, and sends
an unprepared person into a $400 exam. A **false fail** tells a student who solved it that they did not. For
this task the live direction is the third: a **false green on the bank itself**, where the gate reports clean
content that is broken — which is how a bad grader reaches a student in the first place.

## Report

Append a `## Fix round 4` section to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-25-report.md`.

Return **only**: status; the commit sha; a one-line test summary with the skip count; one line per item 1-3
saying what landed **and what dies when you suppress it**; the reproduced item-1 table rows for the three
`exit 0 → exit 1` cases and the three preserved `exit 0` cases; confirmation that round 1's and round 3's
existing exit-0 tests are unchanged; confirmation that the item-3 rule fires on **none** of the sixteen
committed anti-solutions; and confirmation that `lint:content` still passes the committed bank unchanged.

One question, and answer it from the code rather than from this brief. Item 1's fix distinguishes *"this
named file is absent"* from *"a walk found nothing"*, and the whole argument for it is that those two are not
the same check despite reading identically in English. **Now that you have that distinction in hand, is there
anywhere else in `src/cli/lint.ts` where a named-path fact and a walk result are being used
interchangeably?** Round 3 swept for preconditions computed from the thing being validated and found the
benign shapes; this is the narrower, sharper version of that sweep. If you find none, say exactly what you
swept.
