# Task 4 review: `ConceptSpec` loader (`src/engine/content/concept.ts`)

Reviewed diff `a70d166..37f8d7a` against `task-4-brief.md`, independent of `task-4-report.md`'s claims.

## Spec compliance verdict: CHANGES REQUESTED

- `ConceptSpec` interface fields, order, and types match the brief exactly: `id, title, rhel, objectives, sources, prerequisites, body, path`.
- `parseConcept(text, path)` and `loadConcept(path)` signatures match exactly.
- Test file and all three fixtures (`good.md`, `bad.md`, `minimal.md`) are byte-identical to the brief.
- `npm test` (15/15 passing, 4 in `concept.test.ts`) and `npm run typecheck` (silent) both actually pass — verified myself, not taken on trust.
- The one gap: the brief's own reference implementation has the `objectives`-omission bug described below, and it survives verbatim into the shipped code. Per your instruction this is already ruled a defect to fix, so it's the reason compliance isn't a clean APPROVED yet — the brief's acceptance criteria (a validator that "flags every problem") is not met for this one input class.

## Task quality verdict: APPROVED (modulo the one ruled fix)

Idiom match with `task.ts`/`errors.ts` is good: `stringArray` copied verbatim, `intInRange` substituted in for the brief's inline `rhel` ternary (a deliberate, correctly-reasoned improvement toward Task 3's idiom, verified behaviorally equivalent), `ContentError` used identically. Tests assert on values and regexes, not internals. No overbuilding, no dropped requirements. Test output is pristine (no console noise, no skipped tests).

## The ruled `objectives` finding: your reasoning is correct and the proposed fix is correct and complete

I reproduced the bug directly: a concept file that omits `objectives` entirely loads successfully with `objectives: []` and zero problems, while an explicit `objectives: []` correctly produces `"objectives must list at least one objective id"`. Confirmed empirically (fixtures in `/tmp/concept_probe`, now removed):
- omitted key → `OK objectives=[]` (bug)
- `objectives: []` → 1 problem, correct message

I then patched a scratch copy with your proposed condition —
`if (fm.objectives === undefined || (Array.isArray(fm.objectives) && objectives.length === 0))`
— and ran all relevant input classes through it:
- omitted key → now correctly flagged, 1 problem, no double-count
- explicit `[]` → still correctly flagged, 1 problem, unchanged
- `objectives: "not-a-list"` (the `bad.md` fixture) → still exactly 5 total problems, `objectives` flagged once (via `stringArray`'s "must be a list of strings"), the new clause does not fire a second time because `Array.isArray("not-a-list")` is `false`
- valid array → zero problems, unaffected
- `good.md` / `minimal.md` fixtures → unaffected, still pass

The fix is correct and complete for this file as written, and does not break the existing test suite (I re-ran all four `concept.test.ts` assertions conceptually against it and none depend on the omitted-key case, since no current fixture omits `objectives`). A new fixture/test for the omitted-key case, as you specified, is still needed — it does not exist in this diff.

## Findings

1. **BLOCKING** — `src/engine/content/concept.ts:167` (`if (objectives.length === 0 && Array.isArray(fm.objectives))`): omitting the `objectives` key entirely produces zero problems and a silently-loading `ConceptSpec` with `objectives: []`. This is the already-ruled finding; fix as specified above, plus a test/fixture covering the omitted-key case (none of `good.md`/`bad.md`/`minimal.md` in this diff exercise it — `minimal.md` still supplies `objectives`).

2. **NON-BLOCKING** — `src/engine/content/concept.ts:171-174` (`MIN_BODY_CHARS = 120`, raw `body.length` check): this measures raw character count only, so a 120+ character body consisting of markdown noise or filler with zero teaching content (e.g. a wall of `-` characters or lorem-ipsum padding) passes cleanly — the floor genuinely doesn't detect "too thin to teach anything," only "too short to be non-empty." This is not an implementation defect: the brief's own reference code (task-4-brief.md:139-141) specifies this exact floor with this exact caveat in its own comment ("a floor... without policing style"). Flagging because the user's framing calls a card that "passes validation while being too thin to teach anything" a product-level failure, and this floor does not prevent that — but the gap is inherited from the brief's design, not introduced by the implementer.

3. **NON-BLOCKING** — `src/engine/content/concept.ts:155` (`const fm = parsed.data as Record<string, unknown>`): unlike `task.ts:74-76`'s `isRecord(raw)` guard (which throws a clean `ContentError(['file must contain a YAML mapping'])` for non-mapping YAML), `concept.ts` has no equivalent guard on `gray-matter`'s `parsed.data`. I tested front matter that parses to a YAML list instead of a mapping (`/tmp/concept_probe/nonmap.md`, since removed) — it does not crash; property access on the array is simply `undefined` for every field, so validation still fires and correctly reports 4 problems (id/title/rhel/objectives all "missing"). So there's no silent-pass or crash risk, only a less specific error message than `task.ts`'s idiom would produce for the same malformed-file class. Minor idiom divergence, not a functional defect.

## Field-by-field validation audit

- **id**: catches omission (not a string → `''` → flagged) and invalid value (regex fails on `Storage.Bad Id`). Correct.
- **title**: catches omission and wrong type/empty string. Correct.
- **rhel**: `intInRange` (shared with `task.ts`) catches omission, non-number, non-integer, and out-of-range. Correct.
- **objectives**: catches wrong type (non-array/non-string-array); does **not** catch omission (finding #1, already ruled).
- **sources**, **prerequisites**: optional per brief (default to `[]`), catch wrong type via `stringArray`; correctly have no "must be non-empty" requirement, matching the brief's `minimal.md` expectation (`c.sources` / `c.prerequisites` equal `[]`). Correct.
- **body**: catches empty/omitted/short body via length floor; does not (and per brief is not required to) catch content-free-but-long filler (finding #2).

## Test/typecheck output observed

```
$ npm test
 ✓ test/scaffold.test.ts (2 tests) 4ms
 ✓ test/fake-transport.test.ts (5 tests) 9ms
 ✓ test/content/task.test.ts (4 tests) 23ms
 ✓ test/content/concept.test.ts (4 tests) 28ms
 Test Files  4 passed (4)
      Tests  15 passed (15)

$ npm run typecheck
> tsc --noEmit
(no output)
```

Independently re-derived `bad.md`'s problem count by importing `loadConcept` directly and printing `e.problems` (outside the test runner): **5 problems** — `id`, `title`, `rhel`, `objectives` (wrong type), `body` (too short) — matching the report's claim and the test's regex assertions exactly, no more, no fewer.
