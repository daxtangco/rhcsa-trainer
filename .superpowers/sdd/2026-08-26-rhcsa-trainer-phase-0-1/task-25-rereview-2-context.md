# Task 25 — scoped re-review of fix round 3. The last task gate on the branch.

Repo `/home/daxtangco/rhcsa-trainer`, branch `phase-0-1`, range **`7880164..45344bd`** — 1 commit, 2 files
(`src/cli/lint.ts`, `test/cli/lint.test.ts`), 218 insertions / 21 deletions, 20 405 bytes of diff. Tree
clean, `git tag -l` empty.

Read the diff from `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/review-7880164..45344bd.diff`
rather than running `git diff`. The implementer's account is the `## Fix round 3` section of
`task-25-report.md` — **a claim to test, not evidence.** Its requirements were `task-25-fix-3.md`. The
findings being closed are **NEW-1** and **NEW-2** from `task-25-rereview-1.md`, plus the ruled-in `setup.sh`
rule and a test for `scanFixtureDir`'s `unreadable` arm.

## What this pass is, and why it is short

**Scoped to round 3 only.** Rounds 1 and 2 were reviewed and approved: all thirteen guards landed and all
thirteen bite, verified by suppression, with kill sets across nine distinct tests. Do not re-review them
except where this diff changed them. Four items here, and the diff is small. After you, the branch goes to
its whole-branch review and then it is finished.

## The bar

**The recurring defect class on this project is a tool reporting success when it did not do what was
asked** — `countCheckpoints` took eight defects across six rounds, every one silent. `rhcsa lint` has now
produced **five** instances of one sentence across three rounds: *the gate reported agreement because it
never looked at the thing.* NEW-1 was the fifth and it arrived in a new grammatical position — the gate
**could not** look, because it never ran.

So the question is never "does this read correctly." It is **"does the new test fail when the code is
wrong."** A test added to close a finding that passes either way is worse than the finding was: it converts
an open defect into a certified one. **Suppress each guard and watch its test die.** Label every conclusion
`measured` or `reasoned`.

Two shapes to look for by name, both of which have cost this branch real time:

- **A citation that proves something adjacent to its claim.** Five occurrences on this branch, including a
  mutant that changed two things at once and a mutant that tripped an *earlier* assertion in the same test
  and was credited to the later one. When you cite a mutant, cite what it proves and nothing more.
- **A disclosure whose wording is wrong**, which is worse than no disclosure because the next author acts on
  its authority. At least ten occurrences on this branch — including one of mine that shipped into committed
  source as a comment, and NEW-2 itself.

## Item 1 — NEW-1. The blocking finding. Verify the fix, and verify the fix's own edges.

The defect: `checkFixtureFloors` sat behind `if (graders.length > 0)`, so at zero graders every bank-derived
rule was unreachable — and `--allow-empty` is exactly the flag that makes zero graders a non-error. Measured
at `7880164`: five tasks still declared, all `grade.sh` and all `antisolutions/` gone, `--allow-empty` →
**exit 0, empty stderr, `no problems in 0 grader(s)`**, where rule 5 would have fired five times.

Claimed fix: `loadBank` and the floors now run **unconditionally**; only the bank-did-not-load *message*
stays behind the grader count.

Claimed measurements to reproduce:

- At `45344bd`, that same root with `--allow-empty` → **exit 1, 10 problems** (rule 5 ×5, rule 1 ×5).
  Without the flag → exit 1, 11.
- `--allow-empty` **still exits 0** on a genuinely empty root with no bank at all; exit 1 without the flag.
  Round 1's test for this is claimed unchanged and green — **confirm it is genuinely unchanged**, because
  weakening that test is the cheapest way to make this fix look clean.
- Suppression: putting the floors back behind the count kills **3** tests.

Then check the thing the fix creates rather than the thing it removed. `loadBank` now runs on every
invocation including against roots where it previously never ran. **Does that introduce a new failure mode
on a root that used to lint fine?** Specifically: a root with graders whose bank is unloadable used to reach
the header checks; does it still, and does it still exit 1? And is there any root where `loadBank` now
*throws* rather than reporting, turning a problem list into a stack trace? A gate that crashes instead of
reporting is not a false green, but it is a regression and it is in scope.

## Item 2 — NEW-2. A comment. Read it as carefully as you would read code.

The old comment claimed *"a root the walk found no graders in has no task to iterate"* — measurably false,
and it inferred a bank property from a walk result, which is the exact class rules 1-6 exist to close.

The implementer says it replaced the false claim with what is true — the count is a walk result, `bank.tasks`
is the independent record, so the count is itself one of the things the floors check — **and recorded the
wrong version as wrong rather than deleting it.** I endorse that treatment: a reader who remembers the old
reasoning learns it was wrong instead of finding it silently absent.

Your job is to check the new wording is **true**, not merely different. Three specific things:

1. Does every factual claim in the new comment hold? Check each against the code, not against the diff's
   narrative.
2. Does it describe the residual (below) honestly, or does it read as though the short-circuit is entirely
   gone when one piece of it remains?
3. Is the "this used to say X, which was wrong" note accurate about what X actually said?

A wrong comment defending a correct fix is still the wrong-disclosure class, and this is the round that was
supposed to close that class here.

## Item 3 — the `setup.sh` rule

Ruled in two rounds ago. Claimed: added in the existing `bank.tasks` loop beside rule 5, via an `isFile`
helper that **`stat`s rather than `access`es, so a directory named `setup.sh` does not pass**. That detail
was not requested and is the right call — verify it actually holds by creating a *directory* named
`setup.sh` and confirming the rule still fires.

Claimed mutation-proved on **both axes of `--allow-empty`** and at zero graders as well as five. Suppression
kills **3** tests. Confirm all of it, and confirm the rule does not fire on the committed bank — all five
tasks ship a `setup.sh`.

## Item 4 — the `unreadable` arm

Previously untested; it fails closed, so it was requested as cheap-if-cheap. Claimed closed by a neat route:
**a regular *file* named `antisolutions` makes `readdir` fail ENOTDIR, not ENOENT**, so no permissions
fixture and no `sudo`. Suppression kills 1 test.

The claim worth checking hardest: the test also pins the message as **distinct from the absent-directory
one**. That distinction is what stops rule 1 and this arm collapsing into each other — if both produce the
same string, one of them is untested no matter how many tests exist. Verify the two messages differ and that
each test would fail if given the other's message.

## The residual the implementer disclosed and explicitly did not defend

**The bank-load *message* is still behind `graders.length > 0`.** Measured cost: `--allow-empty` + zero
graders + **no anti-solutions either** + an unloadable bank → **exit 0, 0 problems**. With anti-solutions
present it is exit 1 either way (16 orphan rows); without the flag, exit 1. It survives because removing it
breaks `--allow-empty` on a bare directory.

Disclosing it rather than defending it was correct, and I am not asking for it to be fixed in this round.
**I am asking you to establish how narrow it actually is**, because that determines whether it ships or goes
to the whole-branch review:

- Reproduce the exit-0 state and confirm all four conditions are genuinely required.
- Is that state reachable from any plausible user action, or does it require deliberately building a
  directory that contains a bank file the loader rejects and nothing else?
- Is there a formulation that keeps `--allow-empty` working on a bare directory *and* reports an unloadable
  bank? The implementer says removing the guard breaks the former. Removing is not the only option — check
  whether distinguishing "no bank file at all" from "a bank file that failed to load" separates the two
  cases cleanly.

That third question is the one I most want answered. If the answer is yes and it is small, this residual
should not survive the branch.

## The sweep — audit it, do not take it

I asked whether other checks sit behind a precondition computed from the very thing they validate. The
implementer swept `src/cli/lint.ts`, all three commands in `src/cli/index.ts`, and
`src/engine/validate/harness.ts`, and reported everything else falls into benign shapes: four places that
compute from the input and then **report** rather than skip (`graders.length === 0`; `checkVerdict`'s
`checkpoints.length === 0`; `emitted === undefined`; `validate`'s `tasks.length === 0`, claimed to exit 1
**before** `loadVmConfig` so it needs no guest); `inventoryGate` running unconditionally in `validateTask`;
and `if (baseline)` / `if (result.verdictB)` in `runFixture` failing closed. It reports `coverage --strict`
was the best candidate anywhere — `gaps` filters lists drawn from the bank it validates — but that the
loader floors it, since `objectives: []` gives `objectives must list at least one objective` and exits 1
before `checkCoverage`.

**Spot-check three of those claims rather than all of them**, and pick the three you think are most likely
to be wrong. The `validate`-exits-before-`loadVmConfig` claim is worth one of your three, because if it is
wrong the sweep needed a guest to be conclusive and it did not have one. The `coverage --strict` claim is
worth another, because it is the one where the implementer had to reason about a gate that is **already red
on the shipped bank** (58 uncovered objectives — parked as P34), and a red gate is easy to reason about
carelessly.

## Out of scope — do not report these

- **P35** — an anti-solution that does nothing is certified as a working detector. This came out of the
  sweep, I have already ruled on it, and my write-up **widens** the implementer's framing: the culprit is
  not `runFixture`'s `if (fixture.script.trim() !== '')` but the absence of any baseline comparison, so a
  comment-only anti-solution bypasses that guard entirely and reaches the same place. Parked for the
  whole-branch review because it lives in `harness.ts` — outside this task's scope, in the gate that has
  never run. **Do not re-derive it and do not report it.** If you think my widening is wrong, say so in one
  sentence; that is worth hearing, but it is not this round's work.
- **P32** — `# unprobed-invariant:` optional, so absent and misspelled are indistinguishable. Parked by
  ruling. Confirm only that it was not fixed.
- **P33** — a walk remains under rule 6, so deleting a whole task directory gives exit 0 with
  `no problems in 4 grader(s)`. Parked by ruling: unlike every other channel on this task there is no
  in-command source of truth being ignored, because `bank.tasks` is itself a walk, and the honest fix is a
  committed expected-task-id manifest — a new artifact rather than a guard.
- **P34** — `coverage --strict` red on the shipped bank. Parked. Relevant to your spot-check above, not a
  finding.
- **F3, F9, F10** from `task-25-review.md` — ruled to need nothing.
- **Everything else in `whole-branch-parked.md`**, now **P1-P35**, including P24, P29, P5, P31, P18, P22,
  P28, P4, P19-P21, P25-P27. The whole-branch review carries all of them. Do not re-derive them.
- **`src/server/session.ts`, `src/engine/grading/`, `content/lib/assert.sh`, `content/`,
  `objectives.yaml`** — confirm this diff touches none of them. This round should touch exactly
  `src/cli/lint.ts` and `test/cli/lint.test.ts`; **`harness.ts` should NOT appear in this diff** (round 2
  touched it for two exports; round 3 should not need it — if it does, that is worth a line).
- `shellcheck` is **not installed**; seven tasks have confirmed it. `npm run validate` and
  `npm run test:vm` need a VM. The bundle size, the terminal dying on `/reset`, and `report.regressions`
  ids going unrendered are all accepted. The `-gp` argv exposure at `src/engine/vm/vmrun.ts:108` is a
  documented known limit.

## Gates — run them, do not cite the report

`npm run typecheck`, `npx vitest run`, `npm run build:web`, `npm run lint:content`. Expect **431 tests / 35
files / 0 skipped** (up from 423, +8) — confirm the count **and** the skip count, because a skipped test is
not a passing test. Confirm `lint:content` exits 0 with **empty stderr** and
`no problems in 5 grader(s)` on the committed bank, 21 scripts with headers. Confirm `git tag -l` is still
**empty** — the `phase-1` tag is the user's, and its absence is correct.

Confirm `git status --porcelain` is empty before and after — **do not mutate the repo.** All mutation work
goes in a `/tmp` copy: `git archive 45344bd | tar -x -C /tmp/<dir>` with `node_modules` symlinked back.
This is not a formality: a measurement was once taken on this branch against a working tree another agent
was editing, and it produced a confident wrong answer. **Restore sha256-verified after every mutation.**

## Prohibitions

No VM operations of any kind — no `vmrun`, no `scripts/provision.sh` (it powers on a VM and copies 10 GB),
no snapshots, no start/stop/revert on any VM including the user's unrelated ones. No `sudo`: it cannot
authenticate here, there is no TTY. Do not run `ssh-keygen` or write into `/home/daxtangco/.ssh/`. Do not
create, read or modify `.env.local` — git-ignored, and it may hold the user's real VM password. Do not read
anything under `/home/daxtangco/sechelp-tools`. Do not dispatch subagents. Do not leave a dev server or any
listening process running. Do not commit, merge, push or tag.

## Environment

The Bash tool runs **zsh**, not bash: unquoted `$var` does not word-split, `grep --include='*.ts'` needs
quoting, plain `grep -n "a\|b"` errors under ugrep (use `grep -nE`), and **a failed glob is an error rather
than an empty expansion** — use `find` instead of a glob that may match nothing. `ls` is aliased to
**eza** — use `/bin/ls`. **npm scripts run under `/bin/sh` → dash.** Beware nested heredocs: a bare `EOF`
inside a fenced code block terminates an outer heredoc early; this has bitten twice. Node **v22.23.2**,
vitest **3.2.7**, TypeScript **5.8**. `124` means timed out. Run `npm run build:web` with
`run_in_background`.

Two notes so you do not mistake them for defects: jsdom prints a harmless
`HTMLCanvasElement's getContext()` "Not implemented" line on any file mounting `TerminalPane`. And **vitest
regex-scans source for `@vitest-environment`**, so merely mentioning the directive in a comment activates
it — even inside a sentence denying it. That was Task 24's headline defect.

## Direction

Classify every finding. A **false pass** tells the student they solved a lab they did not, and sends an
unprepared person into a $400 exam. A **false fail** tells a student who solved it that they did not. For
this task the live direction is the third: a **false green on the bank itself**, where the gate reports
clean content that is broken — which is how a bad grader reaches a student in the first place.

## Report

Write the full review to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-25-rereview-2.md`.

Return **only**: the verdict (**APPROVED** / **CHANGES REQUIRED**); one line per item 1-4 saying whether it
landed **and whether its test bites**; the reproduced NEW-1 measurement with its exit code and problem
count, plus confirmation that `--allow-empty` still exits 0 on a genuinely empty root and that round 1's
test for that is unchanged; whether the new NEW-2 comment is true in every claim; whether `loadBank` running
unconditionally introduced any new failure mode or crash path; your finding on how narrow the disclosed
residual is **and whether a formulation exists that keeps `--allow-empty` working while still reporting an
unloadable bank**; which three sweep claims you spot-checked and what you found; whether the gates passed
with the observed test and skip counts; and any new finding with severity, direction and whether it is
load-bearing.
