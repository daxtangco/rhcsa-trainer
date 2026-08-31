# Task 5 Report: Verdict parser (JSONL → checkpoints)

## What was implemented

Created `src/engine/grading/verdict.ts`, exporting exactly the interfaces the
brief specifies:

- `type CheckpointStatus = 'pass' | 'fail' | 'skip'`
- `interface Checkpoint { id, desc, status, detail?, weight? }`
- `interface Verdict { checkpoints, noise }`
- `function parseVerdict(stdout: string): Verdict` — splits stdout into
  lines, trims each, skips blanks, JSON.parses each remaining line, and
  routes anything that isn't a well-formed `Checkpoint` (JSON parse failure,
  wrong shape, unknown status) into `noise` instead of throwing.
- `function duplicateIds(v: Verdict): string[]` — ids seen more than once
  across `v.checkpoints`.
- `function allPassed(v: Verdict): boolean` — true only if there is at least
  one checkpoint and every one has `status === 'pass'` (empty verdict and any
  `skip` both count as not-passed).
- `function statusById(v: Verdict): Map<string, CheckpointStatus>`.

Implementation and test file content are copied verbatim from the brief —
no renames, no added functions, no behavior changes.

## TDD evidence

**RED** — command: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/grading/verdict.test.ts`

```
FAIL  test/grading/verdict.test.ts [ test/grading/verdict.test.ts ]
Error: Cannot find module '../../src/engine/grading/verdict.ts' imported from '/home/daxtangco/rhcsa-trainer/test/grading/verdict.test.ts'
...
Test Files  1 failed (1)
     Tests  no tests
```

This failure is genuine but is the "module does not exist yet" flavor the
brief calls out as still valid — the test file was written and run before
any implementation file existed. No implementation code was written before
this run.

**GREEN** — command: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/grading/verdict.test.ts`

```
✓ test/grading/verdict.test.ts (12 tests) 64ms

Test Files  1 passed (1)
     Tests  12 passed (12)
```

Full suite + typecheck — commands: `npm test` and `npm run typecheck`

```
✓ test/scaffold.test.ts (2 tests)
✓ test/grading/verdict.test.ts (12 tests)
✓ test/fake-transport.test.ts (5 tests)
✓ test/content/task.test.ts (4 tests)
✓ test/content/concept.test.ts (6 tests)

Test Files  5 passed (5)
     Tests  29 passed (29)
```

`npm run typecheck` (`tsc --noEmit`) produced no output — clean.

Test output for the new file is pristine (no console noise, no warnings).

## Files changed

- `src/engine/grading/verdict.ts` (new)
- `test/grading/verdict.test.ts` (new)

Both committed in `25ed156 feat(grading): parse grader JSONL into verdicts`.

## Self-review findings

- Compared `verdict.ts` and `verdict.test.ts` line-for-line against the
  brief's Step 1 and Step 3 code blocks: identical, no renamed identifiers,
  no additional exports, no additional test cases.
- Confirmed `noUncheckedIndexedAccess` compliance: the implementation never
  indexes arrays or regex/match results directly — it uses `typeof` narrowing
  on `Record<string, unknown>` properties and `Array.every`/`Array.some`. The
  test file uses optional chaining (`v.checkpoints[0]?.detail`,
  `v.checkpoints[0]?.weight`) exactly as the brief specifies.
- Confirmed no new dependencies were added (`package.json` untouched).
- Confirmed relative imports use explicit `.ts` extensions
  (`'../../src/engine/grading/verdict.ts'`).
- Ran the full suite and typecheck after implementing — all 29 tests pass,
  zero typecheck errors, no stray console output.
- No files outside `src/engine/grading/` and `test/grading/` were touched;
  git status is clean after the commit.

## Concerns

None. The brief's test cases, implementation, and commit message were
internally consistent and matched the repo's existing style
(`src/engine/content/task.ts`) closely enough that no ambiguity arose.

## Review round 1 fix (2026-08-29)

Review verdict: APPROVED on spec compliance and quality, zero blocking
findings, 24/24 adversarial inputs handled correctly. Three non-blocking
findings addressed in this round.

### Finding 3 — mid-stream truncation test (done first, per instruction)

Added `does not let a truncated line between two checkpoints swallow either
one` to `test/grading/verdict.test.ts` (`parseVerdict` describe block).
Input is `a` (valid) / a truncated JSON line for `b` / `c` (valid), joined
by `\n`. Asserts, in one test:
- `v.checkpoints` equals `[{a...}, {c...}]` in order (both surrounding
  checkpoints present, nothing extra),
- `v.noise` equals exactly `['{"id":"b","desc":"B","status":"fail","det']`
  (the truncated line, and nothing else, landed in noise).

This passed on first run with no implementation change, confirming the
existing `JSON.parse` try/catch-per-line loop already isolates a malformed
line without affecting neighboring lines.

### Finding 1 — `isRecord` type-predicate idiom

`src/engine/content/task.ts:44` and `src/engine/content/concept.ts:26` each
define their own local (unexported) `isRecord(v: unknown): v is
Record<string, unknown>` predicate — the pattern is duplicated per-file in
this codebase already, not centralized. Since `isRecord` is not exported
from any location `verdict.ts` could import — and relocating/exporting it
across the content/grading boundary is explicitly the coordinator's call,
not mine — I followed the existing precedent and added the same local
predicate to `verdict.ts`, then used it in `asCheckpoint`:

```ts
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asCheckpoint(v: unknown): Checkpoint | undefined {
  if (!isRecord(v)) return undefined
  if (typeof v.id !== 'string' || v.id === '') return undefined
  ...
```

This removes the `const o = v as Record<string, unknown>` cast; `v` is now
narrowed by the predicate and used directly. No parsing behavior changed —
same three checks in the same order, same optional-field handling.

### Finding 2 — `statusById` last-wins comment

Added a doc comment above `statusById` explaining why last-wins-on-duplicate
is intentional and safe:

```ts
/**
 * Last-wins on a duplicate id. `duplicateIds` is the mandatory gate that
 * rejects a grader emitting an id twice, so this never has to arbitrate a
 * real conflict — last-wins is just the cheapest consistent rule.
 */
export function statusById(v: Verdict): Map<string, CheckpointStatus> {
```

No behavior change.

### Commands and output

`cd /home/daxtangco/rhcsa-trainer && npm test`

```
✓ test/scaffold.test.ts (2 tests)
✓ test/grading/verdict.test.ts (13 tests)
✓ test/fake-transport.test.ts (5 tests)
✓ test/content/task.test.ts (4 tests)
✓ test/content/concept.test.ts (6 tests)

Test Files  5 passed (5)
     Tests  30 passed (30)
```

`cd /home/daxtangco/rhcsa-trainer && npm run typecheck`

```
(no output — clean)
```

`verdict.test.ts` went from 12 to 13 tests (the added Finding 3 test); full
suite went from 29 to 30. No existing test's expected output changed.

### Scope check

Only `src/engine/grading/verdict.ts` and `test/grading/verdict.test.ts` were
touched (confirmed via `git diff --stat` before committing). No parsing
behavior changed — `git diff` on `verdict.ts` shows only the guard/cast
rewrite and two added comments; the control flow and checks are identical
in order and effect, which is why all 24 previously-run adversarial inputs
and all 29 previously-passing tests are unaffected, plus the 1 new test
passes.

### Commit

`079227f fix(grading): lock the mid-stream truncation invariant, match isRecord idiom`

Committed with the required inline git identity
(`GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost`),
touching only the two files listed above.
