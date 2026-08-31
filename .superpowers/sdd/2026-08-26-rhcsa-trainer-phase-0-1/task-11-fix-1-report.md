# Task 11 — fix round 1 — report

Base: `0d544a7`. Files touched: `test/validate/harness.test.ts` only.
`src/engine/validate/harness.ts` was not changed (verified `git status`/`git diff`
clean on it after every mutation revert). Three new tests added, inserted
directly after the existing "resets before every fixture" test (line 306) and
before the "Six changes I require" block.

## F1 — `deps.reset()` ordering

Added `resets each fixture before its own setup.sh, even right after an
earlier fixture failed setup.sh`. It instruments both `deps.reset` and
`deps.transport.exec` to record a `sequence` array of `'reset' | 'setup' |
'fixture' | 'grade'` tags, runs 3 solution fixtures where the middle one's
`setup.sh` fails (deliberately, to force the early-return path), then
asserts:
- exactly 3 `'reset'` tags (count)
- exactly 3 `'setup'` tags
- for every `'setup'` index `i`, `sequence[i - 1] === 'reset'` (position: reset
  must immediately precede its own fixture's setup)

Left the existing line-306 `toBe(4)` count test untouched, per the brief's
"the `toBe(4)` count assertion must survive somewhere."

**Mutation:** moved `await deps.reset()` from immediately before
`deps.transport.exec(scripts.setup)` to immediately before the final `return`
in `runFixture`.

**Result:** 1 test failed, all others green.

```
× validateTask > resets each fixture before its own setup.sh, even right after an earlier fixture failed setup.sh
  AssertionError: expected [ 'reset', 'reset' ] to have a length of 3 but got 2
  ❯ test/validate/harness.test.ts:362:55
    expect(sequence.filter((tag) => tag === 'reset')).toHaveLength(3)
 Test Files  1 failed (1)
      Tests  1 failed | 21 passed (22)
```

The reset count itself dropped from 3 to 2: with reset moved to the end, the
early return on the middle fixture's failing `setup.sh` skips the
now-unreachable reset entirely, exactly the "next fixture inherits the
previous fixture's mutations" defect the brief describes. Confirmed this was
the only failing test; all other 21 harness tests and the rest of the suite
were unaffected by this mutation (not re-run in full, but the harness file
alone shows 21/22 green, isolating the effect).

**Revert:** `git diff src/engine/validate/harness.ts` showed exactly the two
hunks (reset removed from top, added before final return); `git checkout --
src/engine/validate/harness.ts` restored it; `git diff --stat` on the file
was empty afterward.

## F2 — empty-checkpoints guard

Added `fails solution fixtures when the grader emits no checkpoints at all`.
Uses a `rebootCheck: false` task with a custom transport that returns empty
stdout for every `GRADE` exec (delegating to the fake world's handler for
everything else, i.e. `SETUP` and fixture scripts still behave normally). Runs
the default `scripts()` fixture set (no-action, 2 solutions, 1 antisolution)
and asserts every `kind === 'solution'` result has `ok: false` and a failure
matching `/verdict A: grader emitted no checkpoints/`.

**Mutation:** deleted the
`if (verdict.checkpoints.length === 0) { failures.push(...) }` block inside
`checkVerdict`.

**Result:** 1 test failed, all others green.

```
× validateTask > fails solution fixtures when the grader emits no checkpoints at all
  AssertionError: expected true to be false // Object.is equality
  ❯ test/validate/harness.test.ts:390:20
      expect(r.ok).toBe(false)
 Test Files  1 failed (1)
      Tests  1 failed | 21 passed (22)
```

Both solution fixtures now reported `ok: true` for a grader that emitted
nothing at all, confirming the brief's claim exactly.

**Revert:** `git diff` showed only the 3-line guard block removed from
`checkVerdict`; `git checkout -- src/engine/validate/harness.ts` restored it;
`git diff --stat` empty afterward.

## F3 — `duplicateIds` scope

Added `reports duplicate checkpoint ids exactly once per fixture, not once
per verdict`. Uses a `rebootCheck: true` task with a custom transport whose
`GRADE` handler always returns two checkpoints both named `dup`, both
`status: pass` (so `anythingPassed` is true and the harness reboots and grades
again, producing both verdict A and verdict B). Runs a single solution
fixture and asserts the fixture's `failures` array contains exactly one entry
matching `grader emitted duplicate checkpoint ids`.

**Mutation:** moved the `duplicateIds` call and its `failures.push(...)` from
`runFixture` (called once, against `result.verdictA`) into `checkVerdict`
(called once for verdict A and once for verdict B on any `rebootCheck: true`
task).

**Result:** 1 test failed, all others green.

```
× validateTask > reports duplicate checkpoint ids exactly once per fixture, not once per verdict
  AssertionError: expected [ …(2) ] to have a length of 1 but got 2
  ❯ test/validate/harness.test.ts:424:25
      expect(dupeReports).toHaveLength(1)
 Test Files  1 failed (1)
      Tests  1 failed | 21 passed (22)
```

The duplicate-id failure was reported twice instead of once, exactly the
double-report defect the brief and the existing code comment warn against.

**Revert:** `git diff` showed the `duplicateIds` check added inside
`checkVerdict` and removed from `runFixture` (net two hunks, moving the same
logic); `git checkout -- src/engine/validate/harness.ts` restored it;
`git diff --stat` empty afterward.

## Finish

- `npm test`: 128/128 passed (12 test files), after all three mutations were
  reverted.
- `npm run typecheck`: clean, no output from `tsc --noEmit`.
- `git status --short` before commit showed only `M test/validate/harness.test.ts`
  — `src/engine/validate/harness.ts` was never left modified.
- Committed as `40e89cf` with the exact inline-identity command and message
  from the brief. `git add`/`git commit` scoped to
  `test/validate/harness.test.ts` only.

## Out of scope

Did not touch the two findings ruled forward to Task 21 (anti-solution
declaring only `@pre` never verifying verdict B; the checkpoint-coverage
union rule). Did not modify `src/engine/validate/harness.ts` — all three
findings were test-only per the brief ("A fix that changes `harness.ts`
behaviour is a wrong fix").
