# Task 7 report: content bank loader and coverage report

## Summary

Implemented `src/engine/content/bank.ts` (`loadBank`, `checkCoverage`, `Bank`,
`CoverageReport`) per the brief, with the two mandated deviations: `loadBank`
aggregates loader failures across files instead of failing on the first, and
a missing/unreadable content directory is reported as a problem instead of
silently producing an empty bank.

## Files changed (all new; no existing files modified)

- `src/engine/content/bank.ts` — implementation
- `test/content/bank.test.ts` — brief's 9 tests + 3 new tests for the deviations (12 total)
- `test/fixtures/bank/` — brief's fixture tree (objectives.yaml, two tasks, two concepts)
- `test/fixtures/bank-dupe/` — brief's duplicate-task-id fixture
- `test/fixtures/bank-multi-malformed/` — new: two task files, each malformed differently
- `test/fixtures/bank-bad-objectives/` — new: objectives.yaml with a YAML syntax error
- `test/fixtures/bank-missing-tasks/` — new: no `tasks/` directory at all

## TDD evidence

**RED**

```
$ cd /home/daxtangco/rhcsa-trainer && npx vitest run test/content/bank.test.ts
...
Error: Cannot find module '../../src/engine/content/bank.ts' imported from
'/home/daxtangco/rhcsa-trainer/test/content/bank.test.ts'
 FAIL  test/content/bank.test.ts [ test/content/bank.test.ts ]
 Test Files  1 failed (1)
      Tests  no tests
```

Module-not-found is genuine RED: the test file (including both deviation
tests) was written and fixtures created before `bank.ts` existed.

**GREEN**

```
$ cd /home/daxtangco/rhcsa-trainer && npx vitest run test/content/bank.test.ts
 ✓ test/content/bank.test.ts (12 tests) 56ms
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

Full suite + typecheck:

```
$ npm test
 ✓ test/scaffold.test.ts (2 tests)
 ✓ test/grading/verdict.test.ts (13 tests)
 ✓ test/fake-transport.test.ts (5 tests)
 ✓ test/content/objectives.test.ts (10 tests)
 ✓ test/content/task.test.ts (4 tests)
 ✓ test/content/concept.test.ts (6 tests)
 ✓ test/content/bank.test.ts (12 tests)
 Test Files  7 passed (7)
      Tests  52 passed (52)

$ npm run typecheck
> tsc --noEmit
(clean, no output)
```

No console output/warnings during the run.

## Tests implemented

Brief's 9 tests, unchanged and passing:
- `loadBank` discovers tasks/concepts recursively and indexes them
- `checkCoverage`: no problems on a clean bank; lists untaught concepts;
  lists uncovered objectives; unresolvable `requires_concepts` is a hard
  problem; unknown objective id on a task is a hard problem; unresolvable
  concept prerequisite is a hard problem; instrumental tasks excluded from
  coverage
- `loadBank` duplicate detection: two tasks declaring the same id

3 new tests for the deviations:
- `reports both malformed task files in a single ContentError` — asserts the
  single thrown `ContentError`'s `problems` mentions both `area-a` and
  `area-b`'s `task.yaml`, and both distinct problem messages (`id must look
  like`, `objectives must list at least one objective id`).
- `wraps a malformed objectives.yaml as a ContentError, not a raw
  YAMLException` — the fixture's `objectives.yaml` has an unterminated flow
  sequence, verified independently via `js-yaml`'s `load()` to throw a real
  `YAMLException` before `parseObjectives` even runs. Asserts the error
  escaping `loadBank` is `instanceof ContentError`, not that raw exception,
  and its `name` is not `'YAMLException'`.
- `treats a missing tasks/ directory as a problem, not an empty bank` — the
  fixture has no `tasks/` directory at all. Asserts `loadBank` *rejects*
  (never resolves to a bank with `tasks: []`), the rejection is a
  `ContentError`, and its `problems` mention `tasks`.

## How each deviation was implemented

**Deviation 1 (aggregate loader failures).** `loadBank` now:
- Wraps the single `loadObjectives` call in `Promise.allSettled([...])` using
  a one-element array literal — TypeScript's `Promise.allSettled` overload
  for `readonly unknown[] | []` infers this as a fixed-length tuple, so
  destructuring `const [objectivesResult] = ...` is not an indexed access
  and needs no non-null narrowing under `noUncheckedIndexedAccess`.
- Wraps `taskFiles.map(f => loadTask(...))` and `conceptFiles.map(f =>
  loadConcept(...))` in `Promise.allSettled`, then walks each settled array
  with `.entries()`, looking up the corresponding file by index with an
  explicit `if (file === undefined) continue` guard (real narrowing, no `!`
  or `as`).
- A shared `describeFailure(file, error)` helper renders each rejection: if
  `error instanceof ContentError`, each of its `problems` entries is
  prefixed with `error.where` (keeping it attributable to the specific file
  that failed); otherwise one line naming `file` and the error's `.message`
  is produced. This is what keeps a `YAMLException` or `ENOENT` from ever
  reaching `loadBank`'s caller unwrapped.
- All problems (loader failures, duplicate task/concept ids, unreadable
  directories) accumulate into one `problems: string[]`. The final check is
  `if (problems.length > 0 || objectivesResult.status !== 'fulfilled') throw
  new ContentError(root, problems)` — the second disjunct is redundant at
  runtime (a rejected objectives load always pushed at least one problem
  already) but is exactly what lets the type checker prove, without a cast,
  that `objectivesResult.value` is safe to dereference in the `return`
  below.

**Deviation 2 (report missing/unreadable directories).** `findFiles` and
`findMarkdown` now take a `problems: string[]` accumulator (unexported
helpers, so their signatures were free to change per the brief). Both
delegate to a new private `readDirEntries(root, problems)` that does the
`readdir(..., { recursive: true, withFileTypes: true })` and, on failure,
pushes `cannot read directory ${root}: ${message}` and returns `[]` instead
of silently swallowing the error. Since that pushed problem lands in the
same `problems` array `loadBank` aggregates, a missing `tasks/` (or
`concepts/`) directory always surfaces in the thrown `ContentError` rather
than producing a bank that looks like normal in-progress authoring.

## Self-review findings

- Read the full diff. No `!` non-null assertions or `as` casts in
  `bank.ts` (verified with `grep -n " as \| as$\|!\." src/engine/content/bank.ts`
  — the only matches are prose inside comments, e.g. "as attributable").
- No exported signatures changed: `Bank`, `CoverageReport`, `loadBank(root)`,
  `checkCoverage(bank)` are exactly as the brief defines them.
- `bank.ts` does not define its own `isRecord` — unlike task.ts/concept.ts/
  objectives.ts, it never parses a raw YAML/front-matter value into a typed
  record itself (it only calls the other three loaders and aggregates their
  typed results), so there is no unknown-shaped input needing that
  predicate. This is not a deviation from house style so much as house style
  not applying here; flagging it so the reviewer can confirm that reasoning.
- Verified the "excludes instrumental tasks from objective coverage" test:
  it mutates a fixture task's `scope` to `'instrumental'` after load and
  reruns `checkCoverage` on the mutated in-memory `Bank` — behavioral, not
  restating the implementation.
- Confirmed with `js-yaml` directly (outside the test) that the
  `bank-bad-objectives` fixture's YAML genuinely throws `YAMLException:
  unexpected end of the stream within a flow collection` from `load()`
  itself, before `parseObjectives`'s validation logic ever runs — so the
  deviation-1 test exercises a real non-`ContentError` rejection path, not a
  schema violation that already produced a `ContentError`.
- Ran `git add -n` across all new fixture paths to confirm what git would
  actually stage. One observation, not a defect: `test/fixtures/bank-dupe/concepts/`
  is empty (per the brief's own fixture spec) and git does not track empty
  directories, so a fresh clone would not recreate it. This is harmless
  precisely because of deviation 2 — `findMarkdown` on a missing `concepts/`
  now reports a problem instead of crashing, and the brief's own duplicate-id
  test only pattern-matches for `/duplicate task id/`, so an extra
  "cannot read directory .../concepts" problem line doesn't break it. No
  fixture change was made for this since it's the brief's fixture, not one
  of mine, and the brief's test still passes exactly as written.
- `npm test` and `npm run typecheck` both produced clean output — no stray
  console output or warnings.

## Concerns

None that block. The one thing worth a reviewer's eyes: my reading of
"Use Promise.allSettled for both, and for loadObjectives too" for a call
that is not naturally a list — I honored it literally via a one-element
array literal (`Promise.allSettled([loadObjectives(...)])`) rather than
falling back to try/catch, specifically so the mechanism is uniform across
all three loaders and so TypeScript's tuple-inference for `Promise.allSettled`
gives real (non-cast) narrowing on the destructured result. I believe this
matches the letter and spirit of the deviation; flagging the alternative
(try/catch) I considered and rejected in case the reviewer disagrees.

---

# Fix round: mutation-testing review response

Spec compliance was approved; quality review found seven findings via
mutation testing, all confined to `src/engine/content/bank.ts` and
`test/content/bank.test.ts`. This section addresses each, with the exact
commands and output used to verify.

## Finding 1 (BLOCKING) — objectives failure must not mask a task failure

**Root cause.** No test exercised `objectives.yaml` and a task file both
being malformed at once. The reviewer reinstated fail-fast after the
objectives load and 12/12 stayed green, meaning the deviation-1 invariant
was unlocked.

**Fix.** Added fixture `test/fixtures/bank-objectives-and-task-malformed/`:
- `objectives.yaml` — the same unterminated-flow-collection YAML syntax
  error used in `bank-bad-objectives` (verified independently via `js-yaml`
  to throw a real `YAMLException`, not a schema violation).
- `tasks/x/001-y/task.yaml` — valid except for a missing `prompt`.
- `concepts/storage/lvm-abstraction-stack.md` — valid, so the concept path
  contributes no noise to this test.

New test `does not let an objectives failure mask a simultaneous task
failure` (`test/content/bank.test.ts`) asserts the single `ContentError`'s
`problems` names both `objectives.yaml` and `tasks/x/001-y`, and includes the
task's specific validation message (`prompt must be a non-empty string`).

**Break-and-revert evidence (the assertion I have actually seen fail):**

I temporarily replaced the `Promise.allSettled` wrapping of the objectives
load in `src/engine/content/bank.ts` with a direct, fail-fast `await
loadObjectives(...)`:

```ts
// MUTATION-TEST SCRATCH (finding 1 break-and-revert): reinstate fail-fast.
const objectivesValueMutation = await loadObjectives(join(root, 'objectives.yaml'))
const objectivesResult = { status: 'fulfilled' as const, value: objectivesValueMutation }
```

Ran:
```
$ cd /home/daxtangco/rhcsa-trainer && npx vitest run test/content/bank.test.ts
```

Output (relevant excerpt):
```
 ❯ test/content/bank.test.ts (15 tests | 2 failed) 91ms
   ...
   × loadBank aggregates loader failures (deviation 1) > wraps a malformed objectives.yaml as a ContentError, not a raw YAMLException
     → expected YAMLException2{ …(5) } to be an instance of ContentError
   ...
   × loadBank aggregates loader failures (deviation 1) > does not let an objectives failure mask a simultaneous task failure
     → expected YAMLException2{ …(5) } to be an instance of ContentError

 Test Files  1 failed (1)
      Tests  2 failed | 13 passed (15)
```

Both the pre-existing "wraps a malformed objectives.yaml..." test and the
new lock test failed — a raw `YAMLException` escaped `loadBank` uncaught,
exactly the regression this deviation exists to prevent. I then reverted the
scratch edit back to the `Promise.allSettled` form and re-ran:

```
$ cd /home/daxtangco/rhcsa-trainer && npx vitest run test/content/bank.test.ts
 ✓ test/content/bank.test.ts (15 tests) 91ms
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

Confirmed with `git diff src/engine/content/bank.ts` that the objectives
block matches the pre-mutation source exactly (no leftover scratch code).
The new test now locks this invariant: an attempt to restore fail-fast
behaviour on the objectives path reproduces this exact failure.

## Finding 2 — untracked empty fixture directory

**Root cause.** `test/fixtures/bank-dupe/concepts/` was an empty directory.
Git does not track empty directories, so a fresh clone omits it; `loadBank`
then reports an extra `cannot read directory .../concepts: ENOENT` problem
that the working tree never showed. The existing test's assertion
(`toMatch(/duplicate task id/)`) was loose enough to pass either way, hiding
the divergence.

**Fix.** Added `test/fixtures/bank-dupe/concepts/storage/lvm-abstraction-stack.md`
— a valid concept card (referencing `storage.lvm.resize`, which exists in
that fixture's `objectives.yaml`) — so the directory is guaranteed to exist
after a clone, contributing zero problems, and the fixture still exercises
exactly what it was built for: duplicate task ids.

**Checked all other new fixtures for the same problem** with:
```
$ find test/fixtures/bank* -type d -empty
```
No output — none are empty (`bank-missing-tasks` intentionally has no
`tasks/` directory at all, which is the point of that fixture, not an
oversight).

**Verified with a real fresh clone**, not just `git add -n`:
```
$ git clone --quiet /home/daxtangco/rhcsa-trainer /tmp/fresh-clone-check
$ cd /tmp/fresh-clone-check && git checkout --quiet phase-0-1
$ find test/fixtures/bank-dupe -type d
test/fixtures/bank-dupe
test/fixtures/bank-dupe/tasks
test/fixtures/bank-dupe/concepts
test/fixtures/bank-dupe/tasks/b
test/fixtures/bank-dupe/tasks/a
test/fixtures/bank-dupe/concepts/storage
test/fixtures/bank-dupe/tasks/b/001-x
test/fixtures/bank-dupe/tasks/a/001-x
```
`concepts/storage` now exists in the clone. After `npm install` in that
clone:
```
$ npx vitest run test/content/bank.test.ts
 ✓ test/content/bank.test.ts (15 tests) 108ms
 Test Files  1 passed (1)
      Tests  15 passed (15)
```
And directly checked the problem count for the fixture that used to diverge:
```
$ node -e "import('./src/engine/content/bank.ts').then(async ({loadBank}) => {
  try { await loadBank('./test/fixtures/bank-dupe') }
  catch (e) { console.log('problem count:', e.problems.length); console.log(e.problems.join('\n')) }
})"
problem count: 1
duplicate task id: users/001-create-account (test/fixtures/bank-dupe/tasks/a/001-x and test/fixtures/bank-dupe/tasks/b/001-x)
```
One problem, in a genuine fresh clone — the divergence is closed. (Temp
clone removed afterward with `rm -rf /tmp/fresh-clone-check`.)

## Finding 3 — vacuous `/tasks/` regex

**Root cause.** `test/content/bank.test.ts` asserted
`toMatch(/tasks/)` against the aggregate problems, but the fixture root
itself is `bank-missing-tasks`, which contains the substring `tasks` — the
assertion would pass even if the reported problem were about `concepts/`
instead.

**Fix.** Confirmed the real Node error text first:
```
$ node -e "import('node:fs/promises').then(async ({readdir}) => {
  try { await readdir('.../bank-missing-tasks/tasks', {recursive:true, withFileTypes:true}) }
  catch (e) { console.log('MESSAGE:', e.message) }
})"
MESSAGE: ENOENT: no such file or directory, scandir '.../bank-missing-tasks/tasks'
```
Tightened the assertion to the actual message shape:
```ts
expect((result.error as ContentError).problems.join('\n')).toMatch(
  /cannot read directory .*[/\\]tasks: .*ENOENT/,
)
```
This fails if the reported problem is about any directory other than
`tasks/`, or if the `readDirEntries` message format changes without the
test being updated.

## Finding 4 — no coverage for duplicate-concept-id detection

**Fix.** Added fixture `test/fixtures/bank-dupe-concepts/` (objectives.yaml,
one valid task so `tasks/` is non-empty and tracked, two concept files
`concepts/a/dup.md` and `concepts/b/dup.md` both declaring
`id: storage.lvm-abstraction-stack`). New test `rejects two concepts
declaring the same id, naming both files` asserts the single `ContentError`
names the id and both file paths. Deleting the duplicate-concept-id check at
`bank.ts` (the `if (existing) { ... }` branch in the concepts loop) now
fails this test, closing the asymmetry with the task-side test.

## Finding 5 — no coverage for concept-loader aggregation

**Fix.** Added fixture `test/fixtures/bank-multi-malformed-concepts/`
(objectives.yaml, one valid task, and two malformed concept files:
`bad-id.md` with an id that violates `CONCEPT_ID_RE`, `short-body.md` with a
body under `MIN_BODY_CHARS`). New test `reports both malformed concept files
in a single ContentError` asserts both files and both distinct problem
messages appear in the one thrown `ContentError`. Reverting the concept
loop's `Promise.all`-over-`attempt` aggregation to a bare
`Promise.all(conceptFiles.map((f) => loadConcept(f)))` (fail-fast) now fails
this test, closing the asymmetry with the task-side test.

## Finding 6 — structural fix for file/result pairing

**Root cause.** `taskSettled.entries()` was zipped against `taskFiles[i]`
with an `if (file === undefined) continue` guard needed only to satisfy
`noUncheckedIndexedAccess` — a defensive guard against an index
misalignment that could never actually happen, in the one function whose
job is not losing problems. Deleting either guard line and reverting the
adjacent `Promise.allSettled` to `Promise.all` both survived the existing
suite.

**Fix.** Introduced a discriminated `Outcome<T>` type and an `attempt`
helper:
```ts
type Outcome<T> = { file: string; ok: true; value: T } | { file: string; ok: false; error: unknown }

function attempt<T>(file: string, promise: Promise<T>): Promise<Outcome<T>> {
  return promise.then(
    (value): Outcome<T> => ({ file, ok: true, value }),
    (error: unknown): Outcome<T> => ({ file, ok: false, error }),
  )
}
```
Each `Outcome` carries its own `file` on *both* the success and failure
branch, produced by wrapping each per-file promise's `.then`/`.catch`
handlers so the wrapped promise never itself rejects. Task and concept
loading now do:
```ts
const taskOutcomes = await Promise.all(taskFiles.map((file) => attempt(file, loadTask(dirname(file)))))
for (const outcome of taskOutcomes) {
  if (outcome.ok) tasks.push(outcome.value)
  else problems.push(...describeFailure(outcome.file, outcome.error))
}
```
There is no array to index back into and no "file went missing" branch to
guard — the type of `Outcome<T>` makes that case unrepresentable, not merely
unreached. (Concepts follow the identical pattern.) This is a deliberate,
disclosed departure from the literal words "use `Promise.allSettled`" in
the original deviation-1 ruling for the *task and concept* loops
specifically — `Promise.all` is correct here because every promise passed
to it is guaranteed to fulfill (the rejection path was moved inside
`attempt`'s `.then` handlers). The objectives load, which finding 6 did not
touch and which the reviewer's "not a finding" note explicitly asked me to
leave alone, still uses the one-element-tuple `Promise.allSettled` exactly
as before.

## Finding 7 — duplicate-id messages name only the second file

**Fix.** Changed both the task and concept duplicate-detection loops in
`loadBank` from "always overwrite the map and report only the incoming
file" to "look up the existing entry first; if present, report both the
existing and incoming file and do not overwrite":
```ts
const existing = tasksById.get(t.id)
if (existing) {
  problems.push(`duplicate task id: ${t.id} (${existing.dir} and ${t.dir})`)
} else {
  tasksById.set(t.id, t)
}
```
(identical shape for `conceptsById`/`c.path`). Updated the brief's own
duplicate-task-id test to assert both collision partners are named:
```ts
expect(joined).toMatch(/duplicate task id: users\/001-create-account/)
expect(joined).toMatch(/tasks\/a\/001-x/)
expect(joined).toMatch(/tasks\/b\/001-x/)
```
This is a tightening, not a loosening — the old assertion
(`toMatch(/duplicate task id/)`) would still pass; the new one additionally
requires both file paths to appear, and does so with the same fixture and
the same real duplicate-id scenario.

## Full verification

```
$ cd /home/daxtangco/rhcsa-trainer && npm test
 ✓ test/scaffold.test.ts (2 tests)
 ✓ test/fake-transport.test.ts (5 tests)
 ✓ test/grading/verdict.test.ts (13 tests)
 ✓ test/content/objectives.test.ts (10 tests)
 ✓ test/content/task.test.ts (4 tests)
 ✓ test/content/concept.test.ts (6 tests)
 ✓ test/content/bank.test.ts (15 tests)
 Test Files  7 passed (7)
      Tests  55 passed (55)

$ npm run typecheck
> tsc --noEmit
(clean, no output)
```

`bank.test.ts` grew from 12 to 15 tests (three new: finding 1's lock,
finding 4's duplicate-concept-id test, finding 5's concept-aggregation
test), plus two existing tests tightened (finding 3's directory-message
assertion, finding 7's duplicate-task-id message assertion) and one renamed
to reflect its strengthened assertion (`'rejects two tasks declaring the
same id, naming both files'`). No `!` assertions or `as` casts were
introduced or required — verified with:
```
$ grep -n " as \| as$\|!\." src/engine/content/bank.ts
```
which matches only prose inside comments (e.g. "as attributable"), same as
before.

## Files changed in this round

- `src/engine/content/bank.ts` — findings 6 and 7 (structural
  outcome-pairing; both-files duplicate-id messages)
- `test/content/bank.test.ts` — findings 1, 3, 4, 5, 7 (new/tightened tests)
- `test/fixtures/bank-dupe/concepts/storage/lvm-abstraction-stack.md` — finding 2 (new, tracked)
- `test/fixtures/bank-dupe-concepts/` — finding 4 (new fixture)
- `test/fixtures/bank-multi-malformed-concepts/` — finding 5 (new fixture)
- `test/fixtures/bank-objectives-and-task-malformed/` — finding 1 (new fixture)

## Concerns carried into this round

None blocking. Finding 6's fix trades the literal `Promise.allSettled` API
for `Promise.all` over never-rejecting promises in the task/concept loops
specifically (not the objectives load, which is untouched). I believe this
is the correct reading of "restructure however is cleanest" and produces
code where the impossible case is genuinely inexpressible rather than
guarded, but it is a visible departure from the letter of the original
deviation-1 instruction for those two loops, so flagging it explicitly for
the re-reviewer.
