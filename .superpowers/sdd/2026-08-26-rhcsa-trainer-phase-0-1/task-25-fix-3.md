# Task 25 — fix round 3 of 5. Three required, one cheap. The last round on this task, if it lands.

Base is `7880164`. Commit on `phase-0-1`, stage by name, identity inline. Round 3 review is at
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-25-rereview-1.md`.

**Verdict: CHANGES REQUIRED, on a diff where all thirteen guards landed and all thirteen bite.** The
re-reviewer suppressed every one and watched its test die. F1 killed exactly one test as you claimed; F2
killed three; kill sets 2/2/2/1/1/1 across nine **distinct** tests confirmed with no shared kill; the
double-deletion hole closed; F8's 669 reproduced (577 is the naive sum, 3669 assembled); all three phases
round-trip as distinct rows and `expectedStatus` gives three distinct verdict pairs — pre (fail, pass), post
(pass, fail), both (fail, fail); fifteen of fifteen recounted mechanically with every fragment *inside* its
item and no second stale cross-reference; restore sha256-verified byte-identical across all seven files;
zero casts introduced. **All three unrequested rules: keep.** 4′ closes a hole live for one task in five, 5
closes the double-deletion hole, and 6's `task.yaml` measurement holds.

Two things you were right about and I was wrong about, recorded so you do not have to defend them again:
**F6 was four rows, not five** — my original finding over-counted, and `ccdba26` had exactly four. And your
round-2 rule 3 claim about the fixture being *unavailable* rather than merely insufficient survived the
scrutiny I asked to be applied to it.

## 1. NEW-1 — REQUIRED, and it is the blocker. My blind spot was real; the shape was not what I guessed.

I asked whether `--allow-empty` suppresses the six new rules. It does **not** — ten mutations, exit 1 either
way. That part is clean.

The hole is one layer under it. **`checkFixtureFloors` sits behind `if (graders.length > 0)`**, so at zero
graders every bank-derived rule is unreachable — and `--allow-empty` is exactly the flag that makes zero
graders a non-error. Measured: a bank still declaring **five tasks**, with all `grade.sh` and all
`antisolutions/` gone, under `--allow-empty` → **exit 0, empty stderr, `no problems in 0 grader(s)`.`**
Rule 5 alone would have fired five times.

So the escape hatch did grow a blast radius, just not through the route I predicted: not by suppressing the
rules, but by never reaching them. That is worse, because it is invisible in the flag's own definition — you
can read `--allow-empty`'s implementation and see nothing wrong.

**Fix:** the bank-derived floors must run **independently of the grader count**. They are derived from
`bank.tasks`, not from the walk, so the grader count is not their precondition and must not gate them. The
guard's placement, not its logic, is the defect.

Then re-measure the exact case above — five declared tasks, no `grade.sh`, no `antisolutions/`,
`--allow-empty` — and confirm it exits non-zero with rule 5 firing five times. And confirm
`--allow-empty` still does what it was added for: an empty root with no bank tasks either still exits 0.

## 2. NEW-2 — REQUIRED. A comment defending the code with a claim that is measurably false.

The comment defending that short-circuit says, in substance, *"a root the walk found no graders in has no
task to iterate."* Measured false — the bank above declares five tasks with zero graders found.

This is two of this project's named defect classes in one line, which is why it is required rather than
tidy:

- It **infers a bank property from a walk result** — the exact class this round's rules 1-6 exist to close,
  restated in a comment that defends the code from being fixed.
- It is a **disclosure whose wording is wrong**, which is worse than no disclosure because the next author
  reads it and leaves the short-circuit alone on its authority. That class has six recorded occurrences on
  Task 23 and, counting this one, at least ten on the branch — including my own wrong mechanism shipping
  into committed source as a comment.

**Fix:** replace it with what is true. State that the grader count is a walk result, that `bank.tasks` is
the independent source, and that the floors therefore do not sit behind the count. Do not delete the comment
and leave nothing — the reason the floors are outside the short-circuit is exactly the kind of thing the next
author will otherwise "simplify" back.

## 3. `setup.sh` — REQUIRED, as agreed. Into `checkFixtureFloors` alongside rule 5.

Agreed last message: one line in the existing `bank.tasks` loop, no new import, same proof shape as rules
1-6. Measured basis already in hand — all five tasks ship a `setup.sh` so it fires on nothing today, and
deleting one currently gives `rhcsa lint` exit 0 with zero problems.

Note it inherits NEW-1's fix for free once the floors are outside the short-circuit; make sure your mutation
proof covers it **both** with and without `--allow-empty`, since that is now a live axis.

For the record, and so it does not read as me having ignored your objection: you were architecturally right
that "which files must a task have" is a `loadTask` question. Round 2 crossed that boundary deliberately in
rules 5 and 6 with my endorsement, so this is consistent rather than a third stretch. The note that the
loader is the better long-term home for all three is recorded in the ledger; you do not need to carry it.

## 4. `scanFixtureDir`'s `unreadable` branch — cheap, take it if it is genuinely cheap.

The re-reviewer found this arm kills nothing when suppressed. It **fails closed**, so it is not a false
green and not blocking. But an untested arm in the one function this task exists to harden is worth a test
if it costs a few lines. If it turns out to need a permissions fixture or anything platform-dependent, skip
it and say so — do not reach for `sudo`, which cannot authenticate here anyway.

## 5. NEW-3 — do NOT fix. Parked as P33, and here is why, because the reasoning is not obvious.

A walk does remain underneath rule 6: both directions derive from walks of the same tree, so **deleting a
whole task directory gives lint exit 0 and `no problems in 4 grader(s)`**. The reviewer rated it Low-Medium
and not blocking, and noted that only the golden-fixture drift test discriminates it — and that
`coverage --strict` cannot serve as a second backstop because it is **already red on the shipped bank**
(58 uncovered objectives).

I am parking it, and this is not the fixture-defence I refused twice. The distinction is architectural
rather than a matter of taste: **a walk cannot detect the absence of something it has no independent record
of.** For F1 an in-command source of truth existed (`bank.tasks`) and was simply not used. Here there is
none — closing NEW-3 properly needs a **committed manifest of expected task ids**, which is a new content
artifact with its own regeneration story, not a guard. That is a feature decision, and it belongs to the
whole-branch review or to Phase 2, not to a fix round on a task that is otherwise done.

`Ruling: park NEW-3 as P33 rather than fix it in round 3 — why: unlike F1 there is no in-command source of
truth being ignored — the honest fix is a committed expected-task-id manifest, which is a new artifact with
its own drift problem rather than a guard, and inventing one inside a fix round is how a gate acquires a
second gate to maintain; the golden fixture does discriminate it today, and the exposure is a whole task
directory vanishing, which is a far louder event than a misspelled subdirectory — cost if wrong: deleting or
never-committing an entire task goes uncaught by the lint and is caught only by the fixture drift test.`

Note the `coverage --strict` observation is itself worth keeping and I have parked it separately: a gate that
is already red on the shipped bank cannot be anyone's backstop, and anything that currently reasons "well,
`coverage --strict` would catch it" is reasoning from a gate nobody can act on.

## Scope

Nothing else. Do not touch `src/server/session.ts`, `src/engine/grading/`, `content/lib/assert.sh`,
`objectives.yaml`, or any content file — every rule must still pass the committed bank unchanged. Do not
revisit F3, F9, F10, or P32 (`# unprobed-invariant:`), which stays unfixed by ruling. Do not touch anything
in `whole-branch-parked.md`, now P1-P34. Do not create the `phase-1` tag. Do not soften a NOT-RUN step or
imply Phase 1's exit criterion was met.

## Gates

`npm run typecheck`, `npx vitest run`, `npm run build:web`, `npm run lint:content` — all clean, **0
skipped**. Current is 423/35. `git tag -l` empty, `git status --porcelain` empty when you finish, work
committed. All mutation in `/tmp` copies via `git archive <sha> | tar -x -C /tmp/<dir>` with `node_modules`
symlinked back; never the working tree.

## Prohibitions

Unchanged: no VM operations, no `vmrun`, no `scripts/provision.sh`, no `sudo`, no `ssh-keygen`, nothing
written to `~/.ssh/`, no touching `.env.local`, nothing read under `/home/daxtangco/sechelp-tools`, no
subagents, nothing left listening, no Red Hat credentials anywhere.

## Report

Append a `## Fix round 3` section to `task-25-report.md`. Return only: status, the commit sha, a one-line
test summary, one line per item 1-4, the re-measured `--allow-empty` case (five declared tasks, no
`grade.sh`, no `antisolutions/`) with its exit code and problem count, confirmation that `--allow-empty`
still exits 0 on a genuinely empty root, and confirmation that every rule still passes the committed bank
unchanged.

One question. Across three rounds this task has produced four instances of one sentence — *the gate reported
agreement because it never looked at the thing* — and NEW-1 adds a fifth in a new grammatical position: the
gate **could not** look, because it never ran. So: **are there other checks in this lint, or in the
commands next to it, that sit behind a precondition computed from the very thing they are meant to
validate?** That is NEW-1's shape stated generally, and it is the one shape nobody has swept for. If you
find none, say what you swept.
