# Task 7 scoped re-review (review-1b29a6d..915bfc6.diff)

Scope: `src/engine/content/bank.ts`, `test/content/bank.test.ts`, `test/fixtures/bank*/`.

## Verdict per finding

1. **ADDRESSED.** `test/content/bank.test.ts:165-180` ("does not let an objectives failure mask a simultaneous task failure") uses fixture `bank-objectives-and-task-malformed/` (malformed `objectives.yaml` + a task missing `prompt`). Asserts the single `ContentError`'s `problems` contains `objectives.yaml`, `tasks/x/001-y`, and `prompt must be a non-empty string` — i.e. one error naming both failures. Empirically re-verified: reinstating fail-fast on the objectives path (temporarily reverting to plain `await loadObjectives(...)`) makes this exact test fail with a raw `YAMLException` escaping, confirming the test is load-bearing, not decorative.

2. **ADDRESSED.** `git ls-files test/fixtures/` shows every fixture directory bank.test.ts depends on has at least one tracked file, including the previously-empty `bank-dupe/concepts/` (now has `storage/lvm-abstraction-stack.md`) and the two new fixtures from this round (`bank-dupe-concepts/concepts/{a,b}/dup.md`, `bank-multi-malformed-concepts/concepts/storage/{bad-id,short-body}.md`). `find test/fixtures/bank* -type d -empty` returns nothing. `bank-missing-tasks` intentionally has no `tasks/` dir (that's the point of the fixture) — correctly not "fixed."

3. **ADDRESSED.** Line ~199-201 now asserts `/cannot read directory .*[/\\]tasks: .*ENOENT/` instead of the vacuous `/tasks/`. I independently verified this is the real Node message shape (`readdir` ENOENT on a missing `tasks/` produces exactly `cannot read directory .../tasks: ENOENT: no such file or directory, scandir ...`). This would now fail if the reported problem were about `concepts/` instead.

4. **ADDRESSED.** New fixture `bank-dupe-concepts/` and test "rejects two concepts declaring the same id, naming both files" (lines 111-121) asserts both `concepts/a/dup.md` and `concepts/b/dup.md` are named alongside the duplicate id.

5. **ADDRESSED.** New fixture `bank-multi-malformed-concepts/` and test "reports both malformed concept files in a single ContentError" (lines 150-163) asserts both `bad-id.md` and `short-body.md`, with their distinct problem messages, appear in one aggregate.

6. **ADDRESSED, and the impossible case is genuinely inexpressible, not moved.** The `Outcome<T>` discriminated union (`{file, ok:true, value}` | `{file, ok:false, error}`) carries `file` on both branches, produced entirely inside `attempt()`'s `.then` success/failure handlers — there is no by-index lookup anywhere downstream, so there is no `file === undefined` state to guard against; the type has no such state to construct. I checked every throw site: `loadTask`/`loadConcept`/`loadObjectives` are `async function`s, so any synchronous throw inside them (e.g. `parseTaskSpec` throwing `ContentError` synchronously) is automatically converted to a promise rejection by JS semantics before `attempt` ever sees it — `attempt` never receives a synchronous throw, only a promise. `attempt`'s own `.then` handlers just build plain object literals from already-bound values (`file`, `value`/`error`) — they cannot throw. One theoretical (not practically reachable) gap: `dirname(file)` is evaluated in the `.map` callback *before* `attempt` is called; if it ever threw, that throw would bypass `attempt` — but `dirname` never throws on a string, so this is not a real hole.

## The `Promise.all` departure — UNSAFE reasoning is correct here, verified empirically

I broke the wrapper by editing `attempt` to drop its rejection handler entirely (`return promise.then((value) => ({file, ok:true, value}))`, no second handler), simulating the no-reject guarantee being violated by a future edit. Ran `npm test`:

- 3 of 15 `bank.test.ts` tests failed immediately: "reports both malformed task files...", "reports both malformed concept files...", "does not let an objectives failure mask a simultaneous task failure" — each because `Promise.all` fail-fasted on the first rejecting file and only the *first* file's `ContentError` (still technically a `ContentError`, since that's what `loadTask`/`loadConcept` happen to throw) escaped, so the aggregation assertions (naming both files) failed.
- All other 52 tests, including the plain valid-bank test and the "wraps a malformed objectives.yaml..." test, stayed green — confirming the objectives path (still `Promise.allSettled`, untouched) is unaffected by this mutation.
- Reverted the edit; `npm test` and `npm run typecheck` both back to clean/green.

So: **yes, the suite would notice** if the wrapper's no-reject guarantee broke, at least for the realistic failure mode (a loader throwing `ContentError`, now escaping single-file instead of aggregated). I did not additionally test the case where the underlying rejection is a *non*-`ContentError` raw error (e.g. `readFile` ENOENT on an individual task file) escaping past a broken wrapper — that path has no fixture in this suite, but by the same mechanism it would fail the `toBeInstanceOf(ContentError)` checks even harder (outright false, not just wrong content), so it would be caught too, arguably more decisively.

Current code's reasoning is sound: every promise passed into `attempt` is produced by an `async function` (`loadTask`/`loadConcept`), which by JS spec can never synchronously throw — only reject. `attempt` catches every rejection internally and only ever returns a fulfilled `Outcome`. `Promise.all` over such promises therefore cannot reject. `Promise.all` here is safe as implemented today, and the suite has meaningful (if indirect) coverage that would catch a regression in that guarantee.

## Finding-1 lock check and headline-invariant re-proof

Finding 1's lock test exists and asserts both failures by name (see above) — confirmed via break/revert.

Re-proved the `ContentError`-only invariant on the current (restructured) code with throwaway fixtures under `/tmp` (deleted afterward, working tree `git status` clean before and after):

| Case | Threw |
|---|---|
| valid bank | no throw (1 task, 1 concept) |
| invalid YAML in objectives.yaml | `ContentError` |
| absent objectives.yaml | `ContentError` |
| nonexistent root | `ContentError` (3 problems: objectives + tasks dir + concepts dir) |
| absent tasks/ | `ContentError` |
| absent concepts/ | `ContentError` |
| two malformed tasks | `ContentError` (2 problems) |
| one malformed task + one malformed concept | `ContentError` (6 problems — task + concept, concept fixture lacked front matter so multiple concept-field problems piled on) |
| malformed objectives + malformed task | `ContentError` (2 problems, both named) |
| duplicate id + malformed file | `ContentError` (2 problems) |
| empty task.yaml | `ContentError` |
| directory named `something.md` under concepts/ | **no throw** — `findMarkdown`'s `e.isFile()` filter correctly excludes the directory entry, so it's silently skipped (0 concepts contributed, 0 problems). Not one of the seven findings; noting as observed behavior only, not raising as a new finding.

12 cases, 0 raw/non-`ContentError` escapes, 10 threw `ContentError`, 2 (valid bank; `.md`-named directory) did not throw — both expected/benign, not `noUncheckedIndexedAccess` violations or crashes.

## Other checks

- Fixture tracking: every directory in use has a tracked file; no empty dirs under `test/fixtures/bank*`.
- No exported signature changes: `Bank`, `CoverageReport`, `loadBank(root)`, `checkCoverage(bank)` match the brief exactly.
- No `!` non-null assertions, no `as` casts introduced (`grep` only matches the word "as" inside comments/prose).
- Objectives load still uses the one-element-tuple `Promise.allSettled(...)`, untouched, as required.
- Original 9 brief tests: 8 unchanged (not touched by this diff at all); the 9th (duplicate-task-id test) was tightened from a vacuous `toMatch(/duplicate task id/)` to asserting both `tasks/a/001-x` and `tasks/b/001-x` are named — a strengthening, not a loosening (the old assertion still passes under the new behavior too).
- `npm test`: `Test Files 7 passed (7)`, `Tests 55 passed (55)`, pristine output, no stray console/warnings.
- `npm run typecheck`: clean, no output.

## Regressions / drift

None found within scope.

## OUT OF SCOPE

None serious enough to flag; the `.md`-named-directory-under-concepts silent-skip behavior noted above is a minor observation, not a defect worth raising.
