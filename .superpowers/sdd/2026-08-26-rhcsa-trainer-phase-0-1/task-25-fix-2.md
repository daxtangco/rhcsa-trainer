# Task 25 — fix round 2 of 5. One finding: the third silent-green channel. Yours, and you were right to surface it.

Base is `fe4b051`. Commit on `phase-0-1`, stage by name, identity inline.

Round 1 is accepted on every item. F1, F2, F4, F5, F6, F7 and F8 all landed; 413 / 35 / 0 skipped; both
mutations now fail measured, with the F2 inventory differing on exactly one row and source restored
sha256-identically. Two details I want to name because they are better than what I asked for: making F2 a
**rename** (`ids` → `declared`) rather than a widening, so the compiler flagged every comparison site
instead of leaving you to find them — that is the right instinct on a project with
`noUncheckedIndexedAccess` and no casts; and asserting the recovered F4 fragments are **inside** their
items rather than merely present, since adjacent-but-not-inside was F4's actual failure mode. The
mechanical 15-of-15 count with `9-11` and `12-13` expanded is exactly what "not from memory" meant.

## The finding: `antisolutions/` has no floor in the gate that runs

You found it, you measured it, you disclosed it instead of quietly fixing it outside scope, and you left
the call to me. That is the right sequence. **The call is: fix it.**

Your four measurements, which I am taking as given:

- deleting a task's `antisolutions/` → **exit 0**, 18 rows vs 21
- misspelling it `antisolutons` → **exit 0**, 18 rows
- renaming one anti-solution off `.sh` → **exit 0**, 20 rows
- deleting or renaming a `grade.sh` → exit 1, but only via a one-directional interlock
  (`no sibling grade.sh, so its "# expect-fail:" ids cannot be checked`)

This is F1's twin in the other half of the same command, and the brief's rejection of "the golden fixture
would catch it" as sufficient for F1 applies verbatim here. I am not going to accept for the twin an
argument I refused for the original.

## Why this is a port, not a duplication — which answers your own objection

You declined on the grounds that the fix is "a new validate-only rule duplicating what `loadBank` knows."
I checked, and the situation is better than that and also worse.

**The floors already exist.** `src/engine/validate/harness.ts:82` and `:85` push
`needs at least ${MIN_SOLUTIONS} solutions, found ${solutions}` and
`needs at least ${MIN_ANTISOLUTIONS} anti-solution, found ${antis}`. So the project already decided that a
missing-or-thin anti-solution set is a content defect. Nobody needs to re-litigate it.

**They live in the one gate that cannot run.** `harness.ts` is `npm run validate`, which needs a guest,
and which — established repeatedly on this branch — **has never run against a guest in this project's
history**, and cannot until the user downloads the ISO. Meanwhile `rhcsa lint` exists for precisely one
reason, stated in its own commit message `e50cd3e`: *"the content gate that needs no VM."*

So the two floors that matter are enforced only where they never execute, and the gate that executes on
every commit omits them. That is not duplication — it is **porting a floor from a gate that has never run
to the gate that always runs**, and importing `MIN_SOLUTIONS` / `MIN_ANTISOLUTIONS` rather than restating
the numbers is mandate 11's reuse principle, the same one that made you reuse `checkpointIds` instead of
writing a sixth regex.

There is a third piece of evidence that this class is real here rather than theoretical.
`docs/r1-findings.md:267` is a **troubleshooting row** whose diagnosis is *"the directory name is
misspelled; `readdir` failures are swallowed"* and whose remedy is *"check the spelling of `solutions/`
and `antisolutions/`."* Someone wrote that row because the mechanism exists and swallows silently. Its
documented remedy is a human checking spelling by hand. That is the definition of a gap a gate should
close. (Your characterisation of it as a record that the misspelling "already happened" overstates it
slightly — it is a documented failure mode with a diagnosis, not an incident log. The corrected version is
stronger for your case, not weaker, so use the corrected one.)

## What to implement

**Derive the expectation from the bank's task list, not from a filesystem walk.** This is the whole lesson
of F1 and of your third channel: a walk cannot notice what it did not find, so the set of things to check
must come from something that knows what *should* exist. `loadBank` knows the tasks. Iterate those.

Per task, report a problem when:

1. the `antisolutions/` directory is **absent** — this also catches the `antisolutons` misspelling, since
   the correctly-spelled directory is then missing;
2. the anti-solution count is **below `MIN_ANTISOLUTIONS`** (import it; do not restate the number);
3. the solution count is **below `MIN_SOLUTIONS`** (same);
4. a file inside `antisolutions/` does **not** end in `.sh` — this catches your fourth case, the rename
   off `.sh`, as an unexpected file rather than as a silently missing expectation.

I verified the current bank satisfies all four, so none of them fires on committed content: five tasks,
every one with a `grade.sh`, anti-solution counts **5 / 3 / 3 / 3 / 2** (16 `.sh` files total), and
**zero** non-`.sh` files anywhere under an `antisolutions/`. `measured`. So these rules are safe to
require — they are a floor under today's content, not a change to it.

Do **not** add a second `--allow-empty`-style escape hatch for these. One flag on the whole command is a
gate with a documented override; two is a gate with a habit.

**Prove each of the four by mutation in a `/tmp` copy**, and for each, confirm the lint exits **non-zero
with a named problem** — not merely that a row count changed. Also confirm that deleting the guards one at
a time each kills a test, so none of the four is asserted by a test that passes either way.

## One thing to check while you are in there

Your interlock observation — that a missing `grade.sh` is caught only because the orphaned anti-solutions
produce `no sibling grade.sh, so its "# expect-fail:" ids cannot be checked`, and that **the interlock runs
one direction only** — deserves one sentence of your judgement in the report. With rule 1 in place, is the
`grade.sh` direction now guarded independently, or does it still rest on the orphans being there to
complain? A gate whose two halves each depend on the other half's content being present is a gate with a
shared single point of failure, and I would rather know that now than have the whole-branch review find it.

If it turns out `grade.sh` needs its own derived-from-the-bank check too, add it — it is the same rule
shape and the same import.

## Scope

Nothing else. Do not touch `src/server/session.ts`, `src/engine/grading/`, `content/lib/assert.sh`,
`objectives.yaml`, or any content file — these rules must pass against the bank exactly as it stands. Do
not revisit F3, F9 or F10. Do not touch anything in `whole-branch-parked.md`, which is now P1-P31 and
includes two new items (**P5**, a concept card's own `objectives:` list is validated nowhere; **P31**, a
rejecting `exec` has no test in 413) — both belong to the whole-branch review, not to you. Do not create
the `phase-1` tag. Do not soften a NOT-RUN step or imply Phase 1's exit criterion was met.

## Gates

`npm run typecheck`, `npx vitest run`, `npm run build:web`, `npm run lint:content` — all clean, **0
skipped**. Current is 413/35; your new tests raise it. `git tag -l` empty and `git status --porcelain`
empty when you finish, work committed. All mutation in `/tmp` copies via
`git archive <sha> | tar -x -C /tmp/<dir>` with `node_modules` symlinked back; never the working tree.

## Prohibitions

Unchanged: no VM operations, no `vmrun`, no `scripts/provision.sh`, no `sudo`, no `ssh-keygen`, nothing
written to `~/.ssh/`, no touching `.env.local`, nothing read under `/home/daxtangco/sechelp-tools`, no
subagents, nothing left listening, no Red Hat credentials anywhere.

## Report

Append a `## Fix round 2` section to `task-25-report.md`. Return only: status, the commit sha, a one-line
test summary, one line per rule 1-4 saying it is implemented **and** that its mutation now exits non-zero
with a named problem, your judgement on the `grade.sh` interlock, and confirmation that all four rules pass
against the committed bank unchanged.

One question, and it is the same one as last round because your answer to it was worth more than three of
the fixes: **is there a fourth channel?** You have now found that a walk can match nothing, that a
comparison can drop a field, and that an iteration can have no expected count. The unifying sentence is
*the gate reported agreement because it never looked at the thing.* You have also just been handed the
observation that the two halves of this lint interlock in one direction only. Look once more with both
sentences in hand. If there is nothing, say what you checked and I will take that as the answer.
