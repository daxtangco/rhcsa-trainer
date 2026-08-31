# Task 11 — fix round 1

Base: `0d544a7`. Files in scope: `test/validate/harness.test.ts` only. No source
change is expected — `src/engine/validate/harness.ts` is **correct as written**.
All three findings are "the behaviour is right but no test would notice if it
were wrong". A fix that changes `harness.ts` behaviour is a wrong fix.

Method for each: write the test, then **prove it locks the behaviour** by making
the mutation named below, running the suite, confirming your new test fails, and
reverting with `git checkout --`. Report the mutation output for each. A test you
did not mutate against is not evidence.

## F1 — `deps.reset()` ordering is unlocked (the important one)

`runFixture` calls `await deps.reset()` *before* `deps.transport.exec(scripts.setup)`.
That ordering is the whole point: reset must precede the work, not follow it.

The existing test `resets before every fixture so fixtures cannot contaminate
each other` (line 306) asserts only `resets).toBe(4)` — a **count**, which is
blind to position. Moving the `reset()` call to the end of `runFixture` leaves
all 125 tests green. Worse, at the end it is unreachable on both early-return
paths (failing `setup.sh`, anti-solution parse failure), so the next fixture
inherits the previous fixture's mutations.

Lock the **order**, not the count. Either approach is acceptable:

- Record a call sequence in the fake — push `'reset'`, `'setup'`, `'fixture'`,
  `'grade'` as they happen — and assert reset precedes setup within every
  fixture, e.g. that the sequence for four fixtures is
  `['reset','setup',...]` repeated, or at minimum that index 0 is `'reset'` and
  that no `'setup'` ever appears before its fixture's `'reset'`.
- Or assert observable clean state: have a solution fixture mutate the fake
  world, then assert the following fixture grades from baseline.

Prefer the sequence assertion; it also covers the early-return paths.
You may modify the existing line-306 test rather than adding a new one, but the
`toBe(4)` count assertion must survive somewhere.

**Mutation to prove it:** move `await deps.reset()` from before the `setup.sh`
exec to the end of `runFixture` (immediately before the final `return`).
Expected: your new assertion fails.

## F2 — the empty-checkpoints guard is unlocked

`checkVerdict` pushes `verdict ${label}: grader emitted no checkpoints` when
`verdict.checkpoints.length === 0`. Deleting that push leaves all 125 tests
green, and for a grader emitting zero checkpoints on a `rebootCheck: false`
task it is the **only** failure the solution fixtures produce — so without it,
both solution fixtures report `ok: true` for a grader that emitted nothing at
all.

Add a test: a task with `rebootCheck: false` whose grade script emits no
checkpoints at all, and assert the solution fixtures fail with
`/verdict A: grader emitted no checkpoints/`.

**Mutation to prove it:** delete the `failures.push(...)` inside the
`verdict.checkpoints.length === 0` branch. Expected: your new test fails.

## F3 — `duplicateIds` is scoped to verdict A only, unlocked

`duplicateIds(result.verdictA)` runs once per fixture against verdict A alone,
deliberately (the comment says why: checking inside `checkVerdict` would report
the same duplicate twice on any `rebootCheck: true` task). Moving the call into
`checkVerdict` leaves all 125 tests green.

The existing duplicate test (line 284) does not pin the count. Add — or extend
it with — an assertion that a `rebootCheck: true` task whose grader emits a
duplicate id reports the `grader emitted duplicate checkpoint ids` failure
**exactly once** per fixture.

**Mutation to prove it:** move the `duplicateIds` call and its push from
`runFixture` into `checkVerdict`. Expected: your new assertion fails (two
reports instead of one).

## Out of scope — do not fix, do not comment out

Two further findings were ruled forward to Task 21 and are **not** yours:

- An anti-solution declaring only `@pre` never verifies verdict B.
- The harness never requires that the union of anti-solution declarations cover
  every emitted checkpoint, so a grader hardcoding an *invariant* checkpoint to
  `pass` validates green. This is a content-gate rule, not a harness rule.

## Finish

1. `npm test && npm run typecheck` — both clean.
2. Commit with the inline git identity:

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add test/validate/harness.test.ts && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "test(validate): lock reset ordering, the empty-verdict guard and duplicate scope

All three behaviours were correct but survived mutation: the reset test counted
calls instead of asserting position, and nothing noticed when the
empty-checkpoints guard was deleted or when duplicate detection was moved into
checkVerdict."
```

3. Leave the working tree clean — every mutation reverted, no scratch files in
   the repo.
