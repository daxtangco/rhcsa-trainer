# Task 11 report: Validation harness

## Summary

Implemented `src/engine/validate/harness.ts` and `test/validate/harness.test.ts` per
the brief, plus the six required deviations/additions. Commit `0d544a7`. Final
suite: **125 tests** (106 baseline + 19 new in `harness.test.ts`), all passing.
Typecheck clean.

## Step-by-step, with real commands and output

### Step 0: baseline confirmation

```
$ npm test
...
 Test Files  11 passed (11)
      Tests  106 passed (106)
```
Confirmed HEAD `73f4622`, 106 tests, before touching anything.

### Step 1: write the failing test

Created `test/validate/harness.test.ts` with the brief's 13 tests verbatim
(no assertion modified, weakened, or deleted), plus 6 additional tests for
the required changes (see below), for 19 tests total in the file.

### Step 2: run and confirm failure

```
$ npx vitest run test/validate/harness.test.ts
FAIL  test/validate/harness.test.ts [ test/validate/harness.test.ts ]
Error: Cannot find module '../../src/engine/validate/harness.ts' imported from
'/home/daxtangco/rhcsa-trainer/test/validate/harness.test.ts'
 Test Files  1 failed (1)
      Tests  no tests
```
Matches the brief's expected failure exactly.

### Step 3: implementation

Created `src/engine/validate/harness.ts`, following the brief's structure
(`loadTaskScripts`, `inventoryGate`, `checkVerdict`, `runFixture`,
`validateTask`) with the six modifications described below folded in as I
wrote it (not bolted on afterward).

### Step 4: run green

```
$ npx vitest run test/validate/harness.test.ts
 ✓ test/validate/harness.test.ts (19 tests) 15ms
 Test Files  1 passed (1)
      Tests  19 passed (19)

$ npm test
 Test Files  12 passed (12)
      Tests  125 passed (125)

$ npm run typecheck
> tsc --noEmit
(no output, exit 0)
```

### Step 5: commit

```
$ git log --oneline -1
0d544a7 feat(validate): add the fixture matrix harness
```
Committed with the identity `daxtangco <daxtangco@localhost>` as required.

## The six required changes, each with its locking test

### 1. A skip must not silently satisfy an expected failure

`checkVerdict` (src/engine/validate/harness.ts:114-140) now special-cases
`want === 'fail' && cp.status === 'skip'` before falling through to the
normal pass/fail collapse, and always reports it as its own problem:

```ts
if (want === 'fail' && cp.status === 'skip') {
  failures.push(
    `verdict ${label} ${cp.id}: expected fail, got skip (a skip does not prove the grader caught this)`,
  )
  continue
}
```

The `want === 'pass'` direction is untouched: a skip there still falls into
`got = cp.status === 'pass' ? 'pass' : 'fail'` → `'fail'` → mismatch →
reported as before, exactly as the brief said was already right.

Locking test: `change 1: does not let a skip silently satisfy a declared
failure` — an anti-solution declares `expect-fail: lv-var-size,
persist-config`, and a custom transport reports `lv-var-size` as `skip`
(not `fail`). Asserts `ok === false` and the failures match
`/lv-var-size: expected fail, got skip/`.

Break-and-revert: removed the `if (want === 'fail' && cp.status === 'skip')`
block (fell through to the plain `got = ... ; if (got !== want)` logic).
Ran `npx vitest run test/validate/harness.test.ts -t "change 1"`:

```
FAIL  ... > change 1: does not let a skip silently satisfy a declared failure
AssertionError: expected true to be false
- Expected: false
+ Received: true
 ❯ expect(results[0]?.ok).toBe(false)
```
Confirmed: without the special case, `skip` collapses to `'fail'`, matches
the declared `'fail'`, and the anti-solution is wrongly accepted as `ok:
true`. Reverted; full suite green again (125/125, typecheck clean).

### 2. Cross-check anti-solution declared ids against emitted checkpoints

New helper `checkEmittedIds` (src/engine/validate/harness.ts:100-112),
generalized from the baseline-only check the brief already had, parameterized
by header name (`'baseline-fail' | 'expect-fail'`) so the message shape is
identical for both callers:

```ts
function checkEmittedIds(
  declared: ExpectedFailure[],
  verdictA: Verdict,
  headerName: 'baseline-fail' | 'expect-fail',
  failures: string[],
): void {
  const emitted = new Set(verdictA.checkpoints.map((c) => c.id))
  for (const d of declared) {
    if (!emitted.has(d.id)) {
      failures.push(`${headerName} names ${d.id}, which the grader never emits`)
    }
  }
}
```

Called for the baseline header (line 224, replacing the brief's inline
version — no behavior change there, same message) and, newly, for
anti-solutions (line 230-235) right before `checkVerdict` runs on verdict A.

Locking test: `change 2: cross-checks anti-solution declared ids against
emitted checkpoints` — an anti-solution declares `expect-fail: typo-id`
(an id the grader never emits) while running the "forgot persistence"
script. Asserts the failures match
`/expect-fail names typo-id, which the grader never emits/`.

Break-and-revert: deleted the `if (fixture.kind === 'antisolution') {
checkEmittedIds(...) }` block. Ran the test:

```
FAIL ... > change 2: cross-checks anti-solution declared ids against emitted checkpoints
AssertionError: expected 'verdict A persist-config: expected pa…' to match
/expect-fail names typo-id, which the …/
+ Received:
"verdict A persist-config: expected pass, got fail
verdict B persist-config: expected pass, got fail
verdict B var-from-lv: expected pass, got fail"
```
This is exactly the danger the brief described: `ok` was still `false`
(other checkpoints happened to fail for unrelated reasons in this fixture),
but the harness never surfaced the undeclared-id problem — the specific
defect the cross-check exists to catch went unreported. Reverted; full
suite green again.

### 3. `reboot failed: ${result.rebootError}` untested

Locking test: `change 3: reports a failed reboot as its own failure` — a
solution fixture with `deps.reboot` overridden to `throw new Error('vm did
not come back')`. Asserts `ok === false` and failures match
`/reboot failed: vm did not come back/`.

Break-and-revert: emptied the `if (result.rebootError !== undefined) { ... }`
body. Ran the test:

```
FAIL ... > change 3: reports a failed reboot as its own failure
AssertionError: expected true to be false
```
`ok` silently became `true` — every checkpoint check still passed, so the
grader's failure to report the reboot outage vanished. Reverted; full suite
green again.

### 4. `${cp.id} appeared only after the reboot` untested

Locking test: `change 4: flags a checkpoint id that appears only after the
reboot` — a custom transport whose GRADE handler emits checkpoint `a` before
reboot and both `a` and `b` after. Fixture kind is `solution` (so the normal
checkVerdict comparisons all pass, since both are `pass`). Asserts `ok ===
false` and failures match `/b appeared only after the reboot/`.

Break-and-revert: commented out `if (!a.has(cp.id)) failures.push(...)`. Ran
the test:

```
FAIL ... > change 4: flags a checkpoint id that appears only after the reboot
AssertionError: expected true to be false
```
Without the check, a checkpoint id that only exists post-reboot is invisible
to the harness even though it changes the checkpoint count the app would
show a student. Reverted; full suite green again.

### 5. `verdict B was skipped: no checkpoint passed before the reboot` untested

Locking test: `change 5: reports verdict B skipped when a solution passes
nothing before the reboot` — a custom transport whose GRADE handler always
reports a single checkpoint `a` as `fail`, with a `solution`-kind fixture.
`grade()` sees `anythingPassed === false` and returns without rebooting, so
`verdictB` is `undefined` and `rebootError` is `undefined`. Asserts `ok ===
false` and failures match
`/verdict B was skipped: no checkpoint passed before the reboot/`.

Break-and-revert: commented out the `failures.push('verdict B was
skipped...')` line. Ran the test:

```
FAIL ... > change 5: reports verdict B skipped when a solution passes nothing before the reboot
AssertionError: expected 'verdict A a: expected pass, got fail' to match
/verdict B was skipped: no checkpoint …/
```
`ok` was still `false` (the `checkVerdict` mismatch on checkpoint `a` still
fired), but the *specific* diagnostic the brief called for — "no reboot
happened at all because nothing passed" — disappeared, which matters
because a task author reading the failure list needs to know *why* B never
ran, not just that A had a failure. Reverted; full suite green again.

### 6. Anti-solution parse-failure early return untested

Locking test: `change 6: returns immediately with just the parse error for
a malformed anti-solution` — an anti-solution script with no `# expect-fail:`
header at all. Asserts `ok === false`, `failures.length === 1` (not just
non-empty), and that the single failure matches
`/must declare a "# expect-fail:" header/`. The length assertion is the
part that actually locks the *early return*, not just the presence of the
message.

Break-and-revert: changed the `catch (e) { return {...} }` to `catch (e) {
failures.push(...) }` (continuing execution instead of returning). Ran the
test:

```
FAIL ... > change 6: returns immediately with just the parse error for a malformed anti-solution
AssertionError: expected [ …(4) ] to have a length of 1 but got 4
```
Without the early return, the fixture went on to run setup/grade/checkVerdict
with `declared = []`, appending three more unrelated failures — confirming
the early return is what keeps a malformed anti-solution's report focused on
the one real problem (a broken declaration) instead of drowning it in
downstream noise from a `declared: []` fallback. Reverted; full suite green
again.

## Behaviour preserved exactly, as instructed

Verified by inspection and by the unmodified brief tests still passing:

- Fixture results are pushed in fixture order, gate pushed only when it
  fails, and pushed last (`validateTask`, lines 262-282). The headline test
  (`results.map(r => r.name)`) and the setup-failure test (`results[0]`)
  both depend on this and both pass.
- `deps.reset()` is called exactly once per fixture, at the very start of
  `runFixture`'s body (line 177) — confirmed by the "resets before every
  fixture" test counting exactly 4 resets for 4 fixtures.
- `duplicateIds` is checked once, against `result.verdictA` only (line 203),
  not inside `checkVerdict`.
- A failing `setup.sh` returns immediately (lines 182-185), before the
  anti-solution/baseline checks or grading ever runs.
- All failure collection is additive (`failures.push`, never a return except
  the two documented early-exit cases: setup failure and anti-solution parse
  failure) — every other path aggregates every problem found.

## Real test count vs. estimate

You predicted "near 125." The real number is **125** exactly: 106 baseline +
13 brief tests + 6 required additional tests = 125. No collapse — all six
required additions became real, independently failing-then-passing runtime
tests; none were type-level checks that TypeScript alone would enforce
without a test.

## Concerns / notes

- None of the six changes required touching `verdict.ts`, `task.ts`,
  `grader.ts`, or `expectations.ts` — all were confined to
  `src/engine/validate/harness.ts`, as scoped.
- No `!` non-null assertions or `as` casts were introduced anywhere in
  `harness.ts` or the test file.
- I did not find a seventh defect beyond the six specified. The
  "Analysis already done" note in the brief (the `@post`-only /
  no-passes-in-A case) checked out under direct inspection: `expectedStatus`
  returns `'fail'` for `@post` regardless of verdict label passed when
  `phase === 'both'`, and for `phase === 'post'` returns `'fail'` only for
  label `'B'` — so an all-fail verdict A with only `@post` declarations is
  still caught by `checkVerdict`'s zero-checkpoints-passed-yet-declared-A-pass
  default (`expectedStatus` defaults to `'pass'` for A on an undeclared-for-A
  id, and every checkpoint failed in A, so every one mismatches "expected
  pass, got fail" as claimed) — no additional handling was needed, matching
  the brief's claim exactly.
