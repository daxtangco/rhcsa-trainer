# Task 10 report: anti-solution expectation headers

## Status: DONE_WITH_CONCERNS

Concern up front (see "Test-count discrepancy" section below): the task states
"the brief's 13 plus your 5 additions should bring it to 108" total tests. The
real, verified number is **106** (90 baseline + 13 brief + 3 of my own). I did
not pad the suite with tests that don't lock a real behavioral defect to force
the number to 108. Details and reasoning below.

## Step 1: Write the failing tests

Created `test/validate/expectations.test.ts` with the brief's 13 tests
verbatim (no assertion text changed), plus 3 additions:

- `rejects an entry with more than one "@"` (locks fix 1)
- `rejects a second matching header line` (locks fix 2)
- `rejects an empty checkpoint id` (the brief's own untested branch)

## Step 2: Run tests to verify they fail

```
$ cd /home/daxtangco/rhcsa-trainer && npx vitest run test/validate/expectations.test.ts
 FAIL  test/validate/expectations.test.ts [ test/validate/expectations.test.ts ]
Error: Cannot find module '../../src/engine/validate/expectations.ts' imported from '/home/daxtangco/rhcsa-trainer/test/validate/expectations.test.ts'
...
 Test Files  1 failed (1)
      Tests  no tests
```

Matches the brief's expected failure exactly (`Cannot find module
'../../src/engine/validate/expectations.ts'`).

## Step 3: Implementation

Created `src/engine/validate/expectations.ts`, based on the brief's reference
implementation but with all four defects fixed.

### Fix 1 — `entry.split('@', 2)` silently truncated a malformed suffix

Before: `const [id = '', phaseRaw] = entry.split('@', 2)` — for
`"a@pre@post"` this returns `['a', 'pre']`, discarding `@post` and parsing as
the valid `{id:'a', phase:'pre'}`.

After:

```ts
const parts = entry.split('@')
if (parts.length > 2) {
  problems.push(`too many "@" in "${entry}"`)
  continue
}
const [idPart = '', phaseRaw] = parts
```

Locking test: `rejects an entry with more than one "@"`, asserting the
message matches `/too many "@" in "a@pre@post"/`.

### Fix 2 — `headerRe` used `exec` without the `g` flag

Before: a single `.exec(script)` call only ever finds the first matching
`# expect-fail:` line; a second header line is silently ignored with no
error, losing declarations.

After: count matches first with a `g`-flagged version of the same regex, and
throw if there is more than one, before doing the single-match extraction
that reads the body:

```ts
const matches = script.match(headerRe(header, 'gim'))
if (!matches || matches.length === 0) {
  throw new ContentError(where, [
    `must declare a "# ${header}:" header naming the checkpoint ids it expects to fail`,
  ])
}
if (matches.length > 1) {
  throw new ContentError(where, [`more than one "# ${header}:" header found`])
}
const match = headerRe(header, 'im').exec(script)
```

Locking test: `rejects a second matching header line`, asserting the message
matches `/more than one "# expect-fail:" header/`.

### Fix 3 — `phase as ExpectPhase` was an unchecked cast

Before: `PHASES` was `readonly string[]`, and
`PHASES.includes(phase) ? (phase as ExpectPhase) : ...` used a cast the
type checker could not verify against the `includes` guard.

After: `PHASES` is `readonly ExpectPhase[]`, and a local, unexported type
predicate replaces the cast:

```ts
const PHASES: readonly ExpectPhase[] = ['pre', 'post', 'both']

function isPhase(v: string): v is ExpectPhase {
  return PHASES.some((p) => p === v)
}
```

used as `if (!isPhase(phase)) { ... }`, after which `phase` is narrowed to
`ExpectPhase` with no cast at the `declared.push({ id: trimmedId, phase })`
site. Kept `isPhase` local/unexported, matching the `isRecord` precedent in
`task.ts`/`concept.ts`.

No dedicated new vitest test — this is a type-level defect with no
distinguishing runtime behavior (a bad cast doesn't change what the parser
does for any input the existing tests already cover). Locked at the
type-checker level instead — see "Break-and-revert evidence" below.

### Fix 4 — `headerRe` interpolated its argument into a `RegExp` unescaped

Before: `header: string = 'expect-fail'` — any string could reach
`new RegExp(...${name}...)`, including regex metacharacters.

After: `header: 'expect-fail' | 'baseline-fail' = 'expect-fail'`, and
`headerRe`'s own `name` parameter is typed the same way. This makes the
injection path unreachable at the type level rather than relying on runtime
escaping. Both real call sites (`parseExpectations(script, where)` for
anti-solutions, `parseExpectations(scripts.grade, where, 'baseline-fail')`
for graders, per Task 11's interface) type-check as literals of the union.

No dedicated new vitest test for the same reason as Fix 3 — see
"Break-and-revert evidence" below for the type-checker-based lock.

### The untested empty-checkpoint-id branch

The brief's own `if (trimmedId === '') { problems.push(...); continue }`
branch (reached by an entry like `@post`, with an empty id before the `@`)
had no test in the brief's 13, so deleting the push would leave the suite
green. Added:

```ts
it('rejects an empty checkpoint id', () => {
  const err = ...
  parseExpectations('# expect-fail: @post', 'a.sh')
  ...
  expect(err.problems.join('\n')).toMatch(/empty checkpoint id in "@post"/)
})
```

## Step 4: Run tests to verify green, and typecheck

```
$ npm test
 ✓ test/scaffold.test.ts (2 tests)
 ✓ test/exam/limits.test.ts (1 test)
 ✓ test/disclosure/ladder.test.ts (16 tests)
 ✓ test/fake-transport.test.ts (5 tests)
 ✓ test/grading/verdict.test.ts (13 tests)
 ✓ test/validate/expectations.test.ts (16 tests)
 ✓ test/content/objectives.test.ts (10 tests)
 ✓ test/grading/grader.test.ts (18 tests)
 ✓ test/content/task.test.ts (4 tests)
 ✓ test/content/concept.test.ts (6 tests)
 ✓ test/content/bank.test.ts (15 tests)

 Test Files  11 passed (11)
      Tests  106 passed (106)

$ npm run typecheck
> tsc --noEmit
(no output — clean)
```

Real numbers: **106 tests, all passing**; typecheck clean. Baseline was 90;
`expectations.test.ts` contributes 16 (13 from the brief + 3 of mine).

## Break-and-revert evidence (all five additions)

For each of the three new tests and the two type-level fixes, I introduced
the corresponding bug, confirmed the check (test or `tsc`) caught it, then
reverted to the fixed version and re-verified green/clean.

### 1. Fix 1 lock (`too many "@"` test)

Reverted `entry.split('@')` + length check back to the brief's
`entry.split('@', 2)`:

```
$ npx vitest run test/validate/expectations.test.ts -t "more than one \"@\""
 × parseExpectations > rejects an entry with more than one "@" 8ms
   → expected undefined to be an instance of ContentError
 Tests  1 failed | 15 skipped (16)
```

Reverted back to the fix. Confirmed green on rerun (see final verification
below).

### 2. Fix 2 lock (`second matching header line` test)

Reverted the match-counting block back to a single `.exec()` with no
duplicate-detection:

```
$ npx vitest run test/validate/expectations.test.ts -t "rejects a second matching header line"
 × parseExpectations > rejects a second matching header line 9ms
   → expected undefined to be an instance of ContentError
 Tests  1 failed | 15 skipped (16)
```

Reverted back to the fix.

### 3. Empty-checkpoint-id lock

Deleted the `if (trimmedId === '') { ... }` push+continue block (exactly the
scenario the brief's own note warns about — "deleting that push leaves the
suite green" was false once this test existed):

```
$ npx vitest run test/validate/expectations.test.ts -t "rejects an empty checkpoint id"
 × parseExpectations > rejects an empty checkpoint id 9ms
   → expected undefined to be an instance of ContentError
 Tests  1 failed | 15 skipped (16)
```

Reverted back to the fix.

### 4. Fix 3 lock (type predicate) — typecheck-based

Reverted `if (!isPhase(phase))` back to the brief's naive
`if (!PHASES.includes(phase))`, keeping `PHASES` typed as
`readonly ExpectPhase[]` (the fixed array type):

```
$ npm run typecheck
src/engine/validate/expectations.ts(77,26): error TS2345: Argument of type 'string' is not assignable to parameter of type 'ExpectPhase'.
src/engine/validate/expectations.ts(87,36): error TS2322: Type 'string' is not assignable to type 'ExpectPhase'.
```

This is exactly the failure the brief itself predicted ("`PHASES.includes(v)`
will not typecheck once `PHASES` is `readonly ExpectPhase[]`"). Reverted back
to `isPhase(phase)`; `npm run typecheck` clean again.

### 5. Fix 4 lock (header union type) — typecheck-based

Two checks:

a) Added a scratch file `src/engine/validate/_scratch-defect4-check.ts`
calling `parseExpectations('# expect-fail: a', 'a.sh', 'malicious-header')`
with the fixed union type in place:

```
$ npm run typecheck
src/engine/validate/_scratch-defect4-check.ts(4,47): error TS2345: Argument of type '"malicious-header"' is not assignable to parameter of type '"expect-fail" | "baseline-fail" | undefined'.
```

Confirms the union type rejects an arbitrary header literal at compile time.
Deleted the scratch file.

b) Reverted `header`'s type from the union back to plain `string` (the
brief's original defect) to confirm the protection is real, not vacuous:

```
$ npm run typecheck
src/engine/validate/expectations.ts(40,41): error TS2345: Argument of type 'string' is not assignable to parameter of type '"expect-fail" | "baseline-fail"'.
src/engine/validate/expectations.ts(50,26): error TS2345: Argument of type 'string' is not assignable to parameter of type '"expect-fail" | "baseline-fail"'.
```

(This errored at the internal `headerRe` call sites, since `headerRe`'s own
`name` parameter is still typed as the union — confirming the type discipline
is enforced end-to-end, not just at the public API boundary.) Reverted back
to the union type; `npm run typecheck` clean again.

## Final verification (post-revert, matches the committed state)

```
$ npm test
 Test Files  11 passed (11)
      Tests  106 passed (106)

$ npm run typecheck
(clean, no output)

$ git status --short
(clean — scratch file removed, only src/engine/validate/ and test/validate/ tracked)
```

## Test-count discrepancy

The task states the suite should reach 108 (13 brief + 5 additions on top of
90). My honest count is 106 (13 brief + 3 additions). I looked hard for two
more genuine, non-padding tests before concluding this:

- The task's own text only contains three explicit "add a test" /"add one"
  instructions: after defect 1, after defect 2, and the closing
  "One more test to add" for the empty-checkpoint-id branch. Defects 3 and 4
  are described only as code fixes (replace the cast with a predicate; type
  the parameter as a union) — no "add a test" instruction follows either.
- I could not find a runtime-observable behavioral difference for defects 3
  or 4 that a `vitest` test could catch. Both are purely type-level defects:
  a bad cast and an overly-wide parameter type don't change what the parser
  *does* for any input already covered by the 13 brief tests + my 3 — the
  unsound types only matter to the compiler, not to the interpreter. Writing
  a `vitest` test that always passes regardless of whether the cast/wide-type
  bug is present would be padding, not a lock, and the task explicitly warns
  against exactly that failure mode ("If it accepts a malformed declaration,
  the harness silently asserts the wrong thing").
- Instead, I locked defects 3 and 4 with `tsc`-based break-and-revert
  evidence (sections 4 and 5 above), which is the correct verification tool
  for a type-level defect and is exactly what the brief's own text points
  to for defect 3 ("`PHASES.includes(v)` will not typecheck once `PHASES` is
  `readonly ExpectPhase[]`").

If 108 was the intended real target, it likely requires two more `vitest`
tests I'm not seeing a legitimate basis for — happy to add them if pointed at
specific scenarios, but I did not want to inflate the count with assertions
that don't actually lock anything, per the task's own standard for what
counts as a real regression lock.

## Commit

```
73f4622 feat(validate): parse anti-solution expect-fail headers
```

Files changed: `src/engine/validate/expectations.ts` (new),
`test/validate/expectations.test.ts` (new). 290 insertions, 2 files.

Committed with:
```
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "..."
```

## No fifth defect found beyond the four specified

I did not find an additional (fifth) defect in the brief's implementation
beyond the four already specified in the task. The interfaces match Task
11's stated needs (`parseExpectations`, `expectedStatus`, `ExpectedFailure`,
three-parameter signature with `header` defaulting to `'expect-fail'`).
