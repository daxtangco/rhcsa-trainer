# Task 8 report: Grading sequence with the reboot check

## Summary

Implemented `src/engine/grading/grader.ts` (`GradeOptions`, `GradeResult`, `grade`, `finalVerdict`)
per the brief, with the three mandated deviations applied on top. Test file
`test/grading/grader.test.ts` contains the brief's 9 tests verbatim plus 6 new
tests covering the three deviations (15 total).

## Files changed

- `src/engine/grading/grader.ts` (new)
- `test/grading/grader.test.ts` (new)

## TDD evidence

**RED** — before writing the implementation, ran:

```
cd /home/daxtangco/rhcsa-trainer && npx vitest run test/grading/grader.test.ts
```

Output:

```
FAIL  test/grading/grader.test.ts [ test/grading/grader.test.ts ]
Error: Cannot find module '../../src/engine/grading/grader.ts' imported from
'/home/daxtangco/rhcsa-trainer/test/grading/grader.test.ts'
...
Test Files  1 failed (1)
     Tests  no tests
```

Genuine RED: module-not-found, exactly as the brief predicted.

**GREEN** — after writing `src/engine/grading/grader.ts`:

```
cd /home/daxtangco/rhcsa-trainer && npx vitest run test/grading/grader.test.ts
```

Output:

```
✓ test/grading/grader.test.ts (15 tests) 6ms

Test Files  1 passed (1)
     Tests  15 passed (15)
```

Full suite + typecheck:

```
cd /home/daxtangco/rhcsa-trainer && npm test
```

```
✓ test/scaffold.test.ts (2 tests)
✓ test/grading/verdict.test.ts (13 tests)
✓ test/fake-transport.test.ts (5 tests)
✓ test/grading/grader.test.ts (15 tests)
✓ test/content/objectives.test.ts (10 tests)
✓ test/content/task.test.ts (4 tests)
✓ test/content/concept.test.ts (6 tests)
✓ test/content/bank.test.ts (15 tests)

Test Files  8 passed (8)
     Tests  70 passed (70)
```

```
cd /home/daxtangco/rhcsa-trainer && npm run typecheck
> tsc --noEmit
```

No output — clean.

None of the brief's own 9 tests needed to be loosened or changed to accommodate
the deviations; they all pass unmodified because none of their fixtures
trigger the deviation code paths (no test has `rebootError` set with a
pre-existing pass, and no test has verdict B omitting an id or turning a pass
into a skip).

## How each deviation was implemented

**Deviation 1 — `rebootError` must not grade as a pass.**

`finalVerdict` now checks `r.rebootError !== undefined` first. When set, it
builds and returns a *new* `Verdict` by mapping over `r.verdictA.checkpoints`:
any checkpoint with `status === 'pass'` becomes `{ ...cp, status: 'fail',
detail: REBOOT_FAILED_DETAIL }`; every other checkpoint is copied via `{
...cp }` (untouched, but still a fresh object so nothing aliases the input).
`id`, `desc`, count, and order all come straight from `verdictA.checkpoints`
via the array map, so they're preserved automatically. `noise` is passed
through as `r.verdictA.noise`. No boot checkpoint is synthesized — the
checkpoint count is exactly `verdictA.checkpoints.length`, both by
construction and verified by an explicit test.

Verdict A is never mutated: the function only ever reads `cp.*` and produces
new objects; the original `verdictA` object and its checkpoint array are
never touched. Tested explicitly by asserting `verdictA.checkpoints[0].status`
is still `'pass'` after calling `finalVerdict`.

**Deviation 2 — verdict B must account for every checkpoint verdict A reported.**

Added `completeVerdictB(verdictA, verdictB)`: builds a `Set` of ids verdictB's
own grader run actually emitted, then walks `verdictA.checkpoints` in order
and pushes a synthesized `{ id, desc, status: 'fail', detail:
NOT_REPORTED_DETAIL }` for any id not in that set (looking up `desc` from A's
checkpoint object directly during the same loop — no separate id→desc map, no
cast needed since we're iterating `Checkpoint` objects that already have
`desc: string`). The synthesized checkpoints are appended after B's own
checkpoints, in A's original order. `grade()` calls this right after parsing
B's stdout and uses the completed result for both `verdictB` in the returned
`GradeResult` and for computing `regressions`.

**Deviation 3 — pass in A, skip in B is a regression too.**

The regression filter in `grade()` changed from `cp.status === 'fail'` to
`(cp.status === 'fail' || cp.status === 'skip')`, still gated on `before.get(cp.id)
=== 'pass'`. This also naturally covers Deviation 2's synthesized "missing"
checkpoints, since they're created with `status: 'fail'` and go through the
same filter against A's original `before` map — so a checkpoint that already
failed in A and vanished from B does not become a spurious regression.

## Self-review findings

- Checked for `!` assertions and `as` casts in the new file: none present
  (grep confirms the only matches are prose words like "as" inside comments,
  not casts).
- Confirmed all relative imports use explicit `.ts` extensions.
- Confirmed no other file in the repo yet imports from `grader.ts`, so there
  is no existing downstream consumer to reconcile with these deviations —
  the report builder and scheduler mentioned in the brief's motivation are
  future tasks.
- Confirmed `allPassed`'s semantics directly in `verdict.ts` before relying on
  it in deviation reasoning and in one test: `v.checkpoints.length > 0 &&
  v.checkpoints.every((cp) => cp.status === 'pass')`.
- Verified the "completion" and "downgrade" code paths each return a brand
  new object/array rather than mutating any input, matching the house
  convention (`verdict.ts`'s `parseVerdict`/`statusById` never mutate their
  argument either).
- Considered whether `finalVerdict` should also handle the hypothetical case
  where both `rebootError` and `verdictB` are set on a `GradeResult` — `grade()`
  itself never produces that combination (the `catch` branch that sets
  `rebootError` returns before verdict B is ever computed), but the interface
  technically allows a caller to construct such a value. I chose to have
  `rebootError` take precedence unconditionally, since Deviation 1's text says
  "when `r.rebootError` is set" with no exception — this seemed like the
  intended reading rather than an oversight, so I did not raise it as a
  blocker.

No brief test contradicted a deviation, so nothing needed to be flagged per
the "stop and report" instruction.

## Concerns

None outstanding. The three deviations are implemented as specified, are
independently tested, and none required weakening the brief's original test
expectations.

---

## Review fix pass (2026-08-30)

Review verdict: APPROVED on spec compliance and quality, all 13 mutations
(including reverting each of the three deviations) killed. Four cleanups
requested, all confined to `src/engine/grading/grader.ts` and
`test/grading/grader.test.ts`. Four other findings were explicitly parked by
the coordinator (non-`Error` rejection stringification, an unexpected id in
verdict B, an `exec` rejection on run B escaping `grade`, and rebootError's
precedence over a present verdictB) — none of those were touched.

### Finding 1 — synthesized checkpoint's `desc` was untested

**Problem:** `completeVerdictB` (grader.ts) builds each synthesized
"missing" checkpoint with `desc: cp.desc`, but no test asserted the value,
so `desc: ''` would still pass the suite.

**Fix:** added an assertion to the existing test `'completes verdict B when
it omits an id that passed in A, and reports it as a regression'`
(`test/grading/grader.test.ts`):

```ts
expect(bCheckpoint?.desc).toBe('B check')
```

**Break-and-revert evidence:**

1. Changed `grader.ts` line "`missing.push({ id: cp.id, desc: cp.desc, ...`"
   to `desc: ''`.
2. Ran `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/grading/grader.test.ts`.
   Result: 1 failed, 17 passed —
   ```
   × grade > completes verdict B when it omits an id that passed in A, and reports it as a regression
     AssertionError: expected '' to be 'B check' // Object.is equality
   ```
3. Reverted the line back to `desc: cp.desc`.
4. Re-ran the same command: 18/18 passed (confirmed again in the final full
   run below).

### Finding 2 — append order with 2+ missing ids was untested

**Problem:** both existing completion tests had exactly one missing id, so
`missing.reverse()` (or any reordering) would still pass.

**Fix:** added a new test, `'appends multiple checkpoints missing from B in
verdict A's original order, after B's own checkpoints'`. Verdict A reports
four checkpoints (`a, b, c, d`, all pass); verdict B's grader dies right
after reporting `a`. Asserts:

```ts
expect(r.verdictB?.checkpoints.map((cp) => cp.id)).toEqual(['a', 'b', 'c', 'd'])
```

This is sensitive to the append order (a reversed or sorted append would
produce `['a', 'd', 'c', 'b']` or similar) and to append-after-B's-own
(already covered by the existing single-missing-id tests, left unchanged).

### Finding 3 — completion path's `noise` pass-through was untested

**Problem:** `completeVerdictB`'s missing-checkpoints branch returns
`noise: [...verdictB.noise]`; no test exercised a verdict B run that itself
produced noise, so `noise: []` would still pass.

**Fix:** added `'keeps verdict B's own noise when checkpoints are
completed'`: verdict B's raw stdout includes one non-JSON line
(`'WARNING: lvs emitted a stray line'`) alongside one checkpoint, and A
reports a second id that B never emits (forcing the completion branch to
run). Asserts:

```ts
expect(r.verdictB?.noise).toEqual(['WARNING: lvs emitted a stray line'])
```

This is symmetric to the pre-existing assertion in the `rebootError`
downgrade test (`expect(v.noise).toEqual(['stray warning'])`), which finding
3 pointed to as the model to match.

### Finding 4 — noise array aliasing between input and returned verdict

**Problem:** `finalVerdict`'s `rebootError` branch returned `noise:
r.verdictA.noise` (grader.ts:70, pre-fix) — the same array object exposed on
the input `GradeResult.verdictA`, so a caller pushing onto the returned
verdict's noise would silently mutate verdict A's noise too. `completeVerdictB`'s
missing-checkpoints branch had the same shape of problem with `noise:
verdictB.noise` (grader.ts:48, pre-fix).

**Fix:** both sites now copy the array before returning:

- `finalVerdict`: `noise: [...r.verdictA.noise]`
- `completeVerdictB`: `noise: [...verdictB.noise]`

**Covering tests:**

- Extended the existing `rebootError` downgrade test with:
  ```ts
  v.noise.push('injected by a caller')
  expect(verdictA.noise).toEqual(['stray warning'])
  ```
  This is the test that actually catches a reversion of this specific fix:
  reverting `finalVerdict`'s copy back to `noise: r.verdictA.noise` makes
  `verdictA.noise` pick up the pushed string and fail this assertion.
- Added `'does not let mutating a completed verdict B's noise reach verdict
  A's noise'` for the `completeVerdictB` path, pushing onto
  `r.verdictB.noise` and asserting `r.verdictA.noise` is unaffected. Note for
  the re-reviewer: verdict A and verdict B are parsed from independent
  stdout strings and never share an array in the first place, so this
  particular assertion holds regardless of whether `completeVerdictB` copies
  `verdictB.noise` or not — it documents the intended invariant between A and
  B's noise (as requested) but does not, by itself, kill a reversion of the
  `completeVerdictB` copy. What *would* kill that reversion is a test holding
  an independent reference to the raw, pre-completion `verdictB.noise` array
  and checking identity/mutation against the post-completion one; that
  requires exporting `completeVerdictB` (an internal, unexported function)
  or exposing the raw parse result, which the "no exported signature
  changes" constraint rules out. I made the defensive copy anyway since it
  was explicitly requested and is harmless, but flag this gap rather than
  claim the mutation is caught when it structurally cannot be through the
  public API as given.

### Verification commands and output

```
cd /home/daxtangco/rhcsa-trainer && npx vitest run test/grading/grader.test.ts
```
```
✓ test/grading/grader.test.ts (18 tests) 8ms

Test Files  1 passed (1)
     Tests  18 passed (18)
```

```
cd /home/daxtangco/rhcsa-trainer && npm test
```
```
✓ test/scaffold.test.ts (2 tests)
✓ test/fake-transport.test.ts (5 tests)
✓ test/grading/verdict.test.ts (13 tests)
✓ test/grading/grader.test.ts (18 tests)
✓ test/content/objectives.test.ts (10 tests)
✓ test/content/task.test.ts (4 tests)
✓ test/content/concept.test.ts (6 tests)
✓ test/content/bank.test.ts (15 tests)

Test Files  8 passed (8)
     Tests  73 passed (73)
```

```
cd /home/daxtangco/rhcsa-trainer && npm run typecheck
> tsc --noEmit
```
No output — clean.

### Constraint checks

- No exported signature changes: `GradeOptions`, `GradeResult`, `grade`,
  `finalVerdict` are unchanged; `completeVerdictB` remains internal and
  unexported.
- `grep -nE '[a-zA-Z0-9_)\]]!\.|[^=!<>] as [A-Za-z]' src/engine/grading/grader.ts`
  → only match is the word "as" inside a prose comment, no `!` assertions or
  `as` casts introduced.
- The nine brief tests (verified individually via `--reporter=verbose`) all
  still pass with their original, unmodified assertions.
- `git diff --stat` confirms only `src/engine/grading/grader.ts` and
  `test/grading/grader.test.ts` changed (10 lines net in the implementation,
  104 lines of new/extended tests).
- No existing assertion was weakened to accommodate the noise copy; the new
  assertions were added alongside the existing ones.

### Commit

`72ae25f` — "fix(grading): close review gaps in the reboot check completion
path"
