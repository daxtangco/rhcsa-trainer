# Task 5 Review: Verdict parser (JSONL → checkpoints)

## Verdicts

- **Spec compliance verdict:** APPROVED
- **Task quality verdict:** APPROVED

## What I checked

- Read the brief (`task-5-brief.md`), the implementer's report (`task-5-report.md`), and the diff
  (`review-ea86ba3..25ed156.diff`) in full.
- Confirmed the diff is exactly what is checked out at HEAD (`git status` clean, `25ed156` at tip).
- Ran `npm test` and `npm run typecheck` myself.
- Wrote a throwaway adversarial script (`tmp-probe.ts`, deleted after use) importing `parseVerdict`,
  `allPassed`, `duplicateIds`, `statusById` directly and fed it 24 inputs beyond the brief's own
  test file.
- Diffed the delivered `verdict.ts`/`verdict.test.ts` byte-for-byte against the brief's Step 1/Step 3
  code blocks — they are verbatim copies, as the report claims.
- Compared idiom against `src/engine/content/task.ts` and `src/engine/content/errors.ts`.

## Actual command output observed

`npm test`:
```
✓ test/scaffold.test.ts (2 tests) 4ms
✓ test/fake-transport.test.ts (5 tests) 6ms
✓ test/grading/verdict.test.ts (12 tests) 11ms
✓ test/content/task.test.ts (4 tests) 18ms
✓ test/content/concept.test.ts (6 tests) 33ms

Test Files  5 passed (5)
     Tests  29 passed (29)
```
Exit code 0. No stray console output, no warnings — pristine.

`npm run typecheck` (`tsc --noEmit`): no output, exit code 0.

Both match the report's claims.

## Adversarial probe (24 inputs, 0 behaved wrongly)

| Input | Landed in | Correct? |
|---|---|---|
| `''` | neither (empty) | yes |
| only noise lines | `noise` (both) | yes |
| blank line (`'\n'`) | dropped silently (not even noise) | yes — matches brief's own test 2, which asserts `noise` excludes the blank line |
| trailing newline after valid JSON | `checkpoints` | yes |
| leading whitespace before JSON | `checkpoints` (trimmed) | yes |
| `[1,2,3]` (array) | `noise` | yes |
| `null` | `noise` | yes |
| `42` (number) | `noise` | yes |
| object missing `id` | `noise` | yes |
| object missing `status` | `noise` | yes |
| `status: "PASS"` (wrong case) | `noise` | yes |
| `status: "error"` (not in union) | `noise` | yes |
| `id: 123` (not a string) | `noise` | yes |
| `id: ""` (empty string id) | `noise` | yes — defensive guard not required verbatim by the brief but correctly prevents a phantom empty-id checkpoint |
| `weight: "3"` (wrong type) | `checkpoints`, weight field dropped | yes — malformed optional field does not kill an otherwise valid checkpoint |
| `weight: -1` | `checkpoints`, weight kept as -1 | acceptable — brief places no range constraint on weight |
| unrecognized extra field | `checkpoints`, extra field ignored | yes — graders may add fields later |
| truncated JSON **between** two valid checkpoints | truncated line → `noise`; both valid checkpoints kept | yes — this is failure mode #1 from the brief, the most important case, and it is not silently dropped |
| CRLF line endings | both checkpoints parsed correctly | yes — `\r` is stripped by `.trim()` before `JSON.parse` |
| 1,000,000-char noise line | `noise`, no crash | yes |
| `allPassed` on lone `skip` | `false` | yes |
| `allPassed` on `pass` + `skip` mixed | `false` | yes — skip never contributes to a "looks fully passed" result, consistent with the brief's stated worst failure mode |
| `statusById` on duplicate id (`pass` then `fail`) | `fail` (**last write wins**, `Map` built from array in order) | acceptable — `duplicateIds` is the documented gate a caller must check before trusting `statusById`; last-wins vs first-wins is moot once duplicates are rejected upstream, but this is undocumented in the code (non-blocking) |
| `duplicateIds` with an id repeated 3×  | `['a']` once | yes — not once per extra occurrence |
| `duplicateIds` with all-unique ids | `[]` | yes |

None of the 24 probed inputs produced a lost real checkpoint, a phantom checkpoint, or a thrown exception. The parser never throws on any input I could construct.

## allPassed vs skip

Brief's failure-mode framing: a lost/mis-scored checkpoint teaches the user the wrong lesson via the scheduler, and a false "passed" is explicitly the costlier error (masking a lab the user did not actually finish). `allPassed` should therefore require every checkpoint to be an affirmative `pass`; `skip` must not count toward completion, and an empty verdict (a grader that emitted nothing) must not vacuously pass. The implementation does exactly this: `checkpoints.length > 0 && checkpoints.every(status === 'pass')`. This agrees with the correct semantics and is covered by the brief's own tests plus my mixed pass+skip probe.

## statusById and duplicate ids

`statusById` builds a `Map` from the checkpoints array in emission order, so a later duplicate silently overwrites an earlier one (last-wins). This is not itself dangerous because `duplicateIds` is specified as the pre-check a caller must run before trusting `statusById`/count comparisons (per the brief: "Later tasks call it to reject such a grader"). The two functions are consistent in intent: `duplicateIds` is the tripwire, `statusById` is not expected to be relied on once a duplicate exists. Non-blocking: the last-wins choice is not documented in a comment, unlike the rest of the file's docstring style.

`duplicateIds` correctly reports each duplicated id once regardless of how many extra times it repeats (verified with 2× and 3× repetition), and returns `[]` for all-unique input — matches the brief's tests and my probe.

## Style comparison against task.ts / errors.ts

- `task.ts` defines a private, reusable `isRecord(v: unknown): v is Record<string, unknown>` type guard and uses it via `if (!isRecord(raw))`. `verdict.ts`'s `asCheckpoint` inlines the equivalent check (`typeof v !== 'object' || v === null || Array.isArray(v)`) and then does `v as Record<string, unknown>` instead of using a type predicate. Both are equally sound under `noUncheckedIndexedAccess` (verified: typecheck is clean, and property narrowing on `o.id`/`o.desc`/`o.status` works via ordinary control-flow narrowing, no unsafe assertions), but reusing the type-predicate idiom instead of a manual cast would have matched the established style more closely. NON-BLOCKING style divergence, not a defect — the file does not export `isRecord` from `task.ts` so duplicating rather than importing a private helper is defensible.
- `task.ts`/`errors.ts` use an aggregating-error, throw-based validation style (`ContentError` collecting all `problems`); `verdict.ts` deliberately never throws and routes bad input to `noise` instead. This divergence is justified and explained in the module's own docstring — the two modules have genuinely different contracts (authoring-time validation that should report everything at once, vs. runtime parsing of adversarial/noisy stdout that must never abort a session). Not a finding.
- Doc-comment density and tone (explaining *why*, not just *what*) matches `errors.ts`'s docstring quality.

## Casts and non-null assertions

Only two `as` occurrences in the whole file, both audited:
1. `v as Record<string, unknown>` (line 21) — reached only after `typeof v === 'object' && v !== null && !Array.isArray(v)` has already been checked; this is a standard narrowing cast, not one papering over a genuine `undefined`.
2. `o.status as CheckpointStatus` (line 26) — reached only after `typeof o.status === 'string' && STATUSES.includes(o.status)`; TS's `Array.includes` doesn't narrow a literal union on its own, so the cast is necessary and is guarded by a real runtime check immediately prior. Not a phantom-checkpoint risk.

No `!` non-null assertions anywhere in the file (confirmed by grep). No indexed-access site (`Checkpoint[]`/regex groups) is dereferenced without a guard in the implementation; the test file's `v.checkpoints[0]?.detail` / `[0]?.weight` use optional chaining as required by `noUncheckedIndexedAccess`.

## Test quality

Tests assert concrete expected values (specific ids, specific noise contents, specific boolean outcomes) rather than restating whatever the implementation happens to produce — they are behavior tests, not tautologies. Test output is pristine: no console noise, no warnings, 12/12 pass in 11ms.

One coverage gap, non-blocking because I independently verified correctness by hand: the shipped test suite (copied verbatim from the brief) does not include a case with a truncated/unparseable line **sandwiched between two valid checkpoints** — the single case that most directly exercises failure mode #1 ("a malformed line must never cause a later valid line to be dropped"). My adversarial probe confirms the implementation handles it correctly, but there is no regression test locking that behavior in for future refactors.

## Scope discipline

`verdict.ts` and `verdict.test.ts` are exact, byte-for-byte copies of the brief's Step 1 and Step 3 code blocks — no renamed identifiers, no added exports, no added test cases, no touched files outside `src/engine/grading/` and `test/grading/`. `package.json` untouched, no new dependencies. Nothing overbuilt, nothing silently dropped.

## Findings

1. **NON-BLOCKING** — `src/engine/grading/verdict.ts:20-21` — `asCheckpoint`'s inline object/array/null check plus `as Record<string, unknown>` cast duplicates the type-predicate idiom already established in `src/engine/content/task.ts:44` (`isRecord`). No behavioral defect (typecheck is clean and narrowing works correctly), but a private local `isRecord`-style predicate would match the codebase's established idiom more closely.
2. **NON-BLOCKING** — `src/engine/grading/verdict.ts:66-72` — `statusById`'s last-wins behavior on duplicate ids is correct and consistent with `duplicateIds` being the mandatory pre-check, but this design choice (last-wins vs first-wins) is undocumented in a comment, unlike the rest of the file.
3. **NON-BLOCKING** — `test/grading/verdict.test.ts` (whole file, copied from brief) — no test locks in the "truncated JSON line sandwiched between two valid checkpoints" case, which is the most direct test of the brief's stated failure mode #1. Verified correct by hand; recommend adding a regression test in a follow-up, not blocking this task.

No BLOCKING findings. The parser does not lose real checkpoints, does not promote noise to checkpoints, and correctly flags duplicate ids, across every input I could construct including the ones targeting each of the brief's three stated failure modes.
