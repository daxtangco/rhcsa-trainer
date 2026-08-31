# Task 9 Implementation Report

## Summary
Implemented the five-rung disclosure ladder and FSRS-derived rating system for the RHCSA Lab Trainer, with test-driven development following the brief precisely.

## Steps Taken

### Step 1: Write the failing tests
- Created `/home/daxtangco/rhcsa-trainer/test/disclosure/ladder.test.ts` with 15 test cases for ladder navigation, MAX_RUNG validation, and rating derivation logic.
- Created `/home/daxtangco/rhcsa-trainer/test/exam/limits.test.ts` with 1 test case validating the 70% passing score ratio.

### Step 2: Run tests to verify failure
Ran `npx vitest run test/disclosure/ladder.test.ts` and confirmed it fails with:
```
Error: Cannot find module '../../src/engine/disclosure/ladder.ts'
```
This is the expected failure mode.

### Step 3: Implement the code

#### `src/engine/disclosure/ladder.ts`
Implemented:
- `LadderMode` type (deliberately excludes 'guided' to prevent representing ladder states where spec says n/a)
- `Rung` type as literal union 1–5
- `MAX_RUNG` Record with per-mode caps: practice=5, drill=3, exam=2
- `LadderState` interface
- `startLadder(mode)` returns state starting at rung 1
- `canAdvance(s)` checks if rung is below MAX_RUNG for the mode
- `advance(s)` with the mandated deviation: uses `NEXT_RUNG` lookup table instead of `(s.rung + 1) as Rung`
- `Rating` type ('again' | 'hard' | 'good' | 'easy')
- `RatingInput` interface with all required fields
- `deriveRating(i)` implementing the priority cascade:
  1. hadRegression → 'again' (highest priority)
  2. rungUsed >= 4 → 'again' (command sketch or full solution needed)
  3. !passed && !anyPassed → 'again' (nothing passed)
  4. !passed → 'hard' (partial pass)
  5. rungUsed === 3 → 'hard' (concept card needed)
  6. rungUsed <= 1 && durationS <= timeBudgetS → 'easy' (cold solve within budget)
  7. default → 'good'

#### `src/engine/exam/limits.ts`
Implemented:
- `EXAM_DURATION_MINUTES = 150`
- `EXAM_TOTAL_SCORE = 300`
- `EXAM_PASSING_SCORE = 210`
All with the required comment marking these as UNCONFIRMED Phase 0 blockers.

### Step 4: Run tests to verify they pass
```bash
cd /home/daxtangco/rhcsa-trainer && npm test
```
Result:
```
Test Files  10 passed (10)
     Tests  89 passed (89)
```
All 89 tests pass, including:
- 15 new tests in test/disclosure/ladder.test.ts
- 1 new test in test/exam/limits.test.ts
- 73 existing tests (all still passing)

### Step 5: Typecheck
```bash
npm run typecheck
```
Result: No errors, clean compile.

### Step 6: Commit
Commit hash: `0890bbb`
Message: "feat(disclosure): add the five-rung ladder and derived FSRS rating"

## Mandated Deviation: NEXT_RUNG Lookup Table

The brief specified using `(s.rung + 1) as Rung` in the `advance` function. Per the requirements deviation, I instead implemented:

```ts
const NEXT_RUNG: Record<Rung, Rung | undefined> = { 1: 2, 2: 3, 3: 4, 4: 5, 5: undefined }

export function advance(s: LadderState): LadderState {
  const next = NEXT_RUNG[s.rung]
  if (!canAdvance(s) || next === undefined) {
    throw new Error(`rung ${s.rung} is the maximum in ${s.mode} mode`)
  }
  return { mode: s.mode, rung: next }
}
```

**Rationale:** This is the only module that defines `Rung`. Using a lookup table instead of a cast means if a rung 6 is ever added in the future:
- The table must be updated, or the code won't compile
- The cast approach would silently keep typechecking while being incorrect

`canAdvance` remains the single source of truth for advanceability. The `next === undefined` branch is unreachable in normal execution (every `MAX_RUNG` value is ≤ 5) but exists for type narrowing.

The error message matches exactly what the tests expect: `rung ${s.rung} is the maximum in ${s.mode} mode`.

## Code Quality Notes

- No `!` non-null assertions used
- No `as` casts used (following erasableSyntaxOnly constraint)
- All exports from the brief are present and match the interface spec
- Relative imports use `.ts` extension as required
- No `enum`, `namespace`, parameter properties, or decorators used
- All test assertions from the brief are implemented unchanged

## No Additional Tests

No tests beyond the brief's specification were added. The brief's tests are comprehensive and lock all necessary behaviors.

## Final Verification

- npm test: 89 tests pass (16 new + 73 existing)
- npm run typecheck: clean compile
- Git commit: successful with proper author/committer configuration
- All files created in correct locations as specified in the brief

## Concerns

None. The implementation follows the brief precisely, including the mandated deviation from the `as Rung` cast to the `NEXT_RUNG` lookup table. All tests pass, typecheck is clean, and the code meets the erasableSyntaxOnly constraints.

---

## Post-Review Fix: Budget Boundary Coverage

### Issue
Code review identified that the test suite did not cover the boundary case where `durationS === timeBudgetS`. A mutation from `<=` to `<` in the deriveRating condition would silently pass all original tests but incorrectly rate at-budget solves as 'good' instead of 'easy', pulling cards into review sooner.

### Solution
Added test case to lock the boundary:

```ts
it('gives easy for solving cold exactly at the time budget', () => {
  // The boundary: finishing at exactly the limit is still competent, not rushed.
  expect(deriveRating({ ...base, durationS: base.timeBudgetS })).toBe('easy')
})
```

### Verification: Break and Revert

**Step 1: Confirm test passes before mutation**
```bash
cd /home/daxtangco/rhcsa-trainer && npm test
```
Output:
```
✓ test/disclosure/ladder.test.ts (16 tests) 4ms
 Test Files  10 passed (10)
      Tests  90 passed (90)
```

**Step 2: Mutate `<=` to `<` in src/engine/disclosure/ladder.ts line 67**
Changed from:
```ts
if (i.rungUsed <= 1 && i.durationS <= i.timeBudgetS) return 'easy'
```
To:
```ts
if (i.rungUsed <= 1 && i.durationS < i.timeBudgetS) return 'easy'
```

**Step 3: Run tests — confirm mutation fails**
```bash
npm test 2>&1 | grep -A 30 "test/disclosure/ladder.test.ts"
```
Output:
```
❯ test/disclosure/ladder.test.ts (16 tests | 1 failed) 12ms
   ...
   × deriveRating > gives easy for solving cold exactly at the time budget 6ms
     → expected 'good' to be 'easy' // Object.is equality
```
Test fails as expected. The mutation is caught.

**Step 4: Revert to `<=`**
```ts
if (i.rungUsed <= 1 && i.durationS <= i.timeBudgetS) return 'easy'
```

**Step 5: Confirm all tests pass again**
```bash
npm test
```
Output:
```
✓ test/disclosure/ladder.test.ts (16 tests) 4ms
 Test Files  10 passed (10)
      Tests  90 passed (90)
```

### Commit
```bash
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add test/disclosure/ladder.test.ts && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "test: lock the budget boundary in deriveRating

Finishing cold at exactly the time limit should earn 'easy', not 'good'.
The test with durationS === timeBudgetS was missing, leaving the <= operator
vulnerable to mutation. Added test pins this boundary: 'easy' on the tie,
'good' past it."
```
Commit: `66b9df9`

### Final State
- Test count: 90 (16 in ladder suite + 1 new boundary test)
- All tests pass
- typecheck clean
- Boundary case for time budget exactly-at-limit is now locked
