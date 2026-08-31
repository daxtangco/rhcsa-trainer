# Task 6 review: Objectives taxonomy loader

Reviewed commit: `9c2febc` (on top of `079227f`), branch `phase-0-1`, working tree clean at review time.

## Verification run

```
$ npm test
 ✓ test/scaffold.test.ts (2 tests) 5ms
 ✓ test/fake-transport.test.ts (5 tests) 10ms
 ✓ test/grading/verdict.test.ts (13 tests) 11ms
 ✓ test/content/objectives.test.ts (4 tests) 20ms
 ✓ test/content/task.test.ts (4 tests) 24ms
 ✓ test/content/concept.test.ts (6 tests) 44ms

 Test Files  6 passed (6)
      Tests  34 passed (34)

$ npm run typecheck
> tsc --noEmit
(no output — clean)
```

Both match the report's claims exactly. Output is pristine — no console noise, no skipped tests.

Note on sibling test counts: the assignment brief for this review states task.ts's test file has "11" tests. Actual count is 4 `it()` blocks (one of those 4 asserts `problems.length >= 11`, i.e. 11+ *problems* surfaced from a single load — that's where the "11" comes from, not 11 test cases). Corrected baseline: task.ts = 4 tests, concept.ts = 6 tests, objectives.ts = 4 tests. This doesn't change the substance of the adequacy question below.

## Code identity vs diff

`src/engine/content/objectives.ts` on disk is byte-for-byte the code in the diff and in the brief's Step 3. `parseObjectives`/`loadObjectives`/`Objective`/`ObjectiveSet` match the required interfaces exactly. `isRecord` is a local, unexported predicate, textually identical to the one in `task.ts` and `concept.ts` — no idiom divergence. No `enum`, no parameter properties, no namespaces, explicit `.ts` extensions on relative imports, no new dependencies (`js-yaml` already used by `task.ts`).

`noUncheckedIndexedAccess` scan: the only `as` cast is `rawChapters as number[]`, applied only after every element has been validated via `.some(...)` — same validate-then-cast idiom as `task.ts`'s/`concept.ts`'s `stringArray`. No `!` non-null assertions anywhere in the file. The test's `set.byId.get('storage.fs.xfs')?.chapters` correctly uses optional chaining on a `Map.get` result. Clean on this axis.

## byId consistency (valid input)

Ran the fixture through `loadObjectives`: `objectives.length === 3 === byId.size`, and every objective in the array is reachable via `byId.get(o.id)` and is reference-equal to the array entry. Confirmed, not just asserted.

## Adversarial probe

Script: imported `parseObjectives`/`loadObjectives` directly and fed 24 inputs (20 in-memory `parseObjectives` calls + 4 file-based `loadObjectives` calls covering syntactically-invalid YAML, empty file, `---`-only file, and a nonexistent path).

| # | Input | Result | Correct? |
|---|---|---|---|
| 1 | two objectives, same id | `ContentError`: `["duplicate objective id: a.b"]` | Yes |
| 2 | three objectives, two share an id | `ContentError`: `["duplicate objective id: a.b"]` — reported **once**, not once per occurrence | Yes — concise, unambiguous |
| 3 | `objectives:` present but empty | `ContentError`: `["objectives must list at least one objective"]` | Yes |
| 4 | `objectives:` missing entirely | same message as #3 | Yes |
| 5 | `objectives:` a mapping, not a list | same message as #3 (message doesn't distinguish "not a list" from "empty list") | Behaviorally correct (rejected, no crash); message is slightly imprecise |
| 6 | entry is a bare string | `ContentError`: `["objectives[0] must be a mapping"]` | Yes |
| 7 | entry missing `id` | `["objectives[0].id must be dotted lowercase..."]` | Yes |
| 8 | entry missing `text` | `["objectives[0].text must be non-empty"]` | Yes |
| 9 | entry missing `chapters` | `["objectives[0].chapters must be integers 1-28, at least one"]` | Yes |
| 10 | `id` present but a number | same as #7 (type coalesced into "malformed") | Yes |
| 11 | `text` present but a list | same as #8 | Yes |
| 12 | `chapters` a single number, not a list | same as #9 | Yes |
| 13 | `chapters` a list of strings | same as #9 | Yes |
| 14 | `chapters` an empty list | same as #9 | Yes |
| 15 | `version` missing | `["version must be a non-empty string, e.g. rhel9"]` | Yes |
| 16 | `version` non-string | same as #15 | Yes |
| 17 | `source` missing | `["source must cite where the taxonomy was transcribed from"]` | Yes |
| 18 | `source` non-string | same as #17 | Yes |
| 19 | raw is an array, not a mapping | `["file must contain a YAML mapping"]` | Yes |
| 20 | raw is a bare scalar | same as #19 | Yes |
| 21 | 5 distinct problems in one call (missing version + missing source + malformed id + empty text + bad chapters) | all **5** returned in one `problems` array | Yes — aggregation confirmed for real, not just 2-3 |
| 22 | file: empty file | `load('')` → `undefined` → `["file must contain a YAML mapping"]` | Yes |
| 23 | file: `---` only | `load('---')` → `undefined` → same as #22 | Yes |
| 24 | file: syntactically invalid YAML | **threw a raw `YAMLException`**, not a `ContentError` | No — but see below |
| 25 | `loadObjectives` on nonexistent path | **threw a raw Node `Error` (ENOENT)**, not a `ContentError` | No — but see below |

24/25 behaved correctly for the taxonomy-validation contract; the 2 that didn't (#24 invalid YAML syntax, #25 missing file) both leak a non-`ContentError` exception. I checked whether this is a regression specific to this task: `loadTask`/`parseTaskSpec` in `task.ts` and `loadConcept` in `concept.ts` have the exact same gap (verified live — `loadTask` on a nonexistent dir throws a raw `ENOENT` `Error`, not wrapped). This is a pre-existing house pattern across all three content loaders, not something this task introduced or should have been expected to fix unilaterally. Non-blocking for this task; worth a follow-up ticket against all three loaders together.

## Test adequacy (the specific concern flagged for this task)

The 4 tests in `test/content/objectives.test.ts` cover:
1. `loadObjectives` happy path + `byId` indexing (2 specific lookups, not full-set reachability).
2. Duplicate id rejected (single case: 2 objectives, exact duplicate).
3. Malformed id + empty text + bad chapters, all in **one** entry, in **one** call — proves 3-way aggregation within a single entry.
4. Missing `version` + missing `source` + empty `objectives` list — proves 3-way aggregation at the top level.

Failure modes from the brief with **no test at all**, despite behaving correctly in the probe above:
- Duplicate reported once vs. once-per-occurrence when 3+ entries collide (probe #2) — untested, and this is exactly the ambiguity the brief calls out by name.
- `objectives` as a non-list (mapping) rather than empty/absent (probe #5) — untested; the loader's error message here is also imprecise ("must list at least one objective" when the real problem is "not a list").
- A bare-string / non-mapping entry (probe #6) — untested.
- `id` as a non-string type, `text` as a non-string type, `chapters` as a non-list — only the "malformed-string/empty/out-of-range" variants are tested; the "wrong JS type entirely" variants (probe #10, #11, #12) are unverified by any test.
- Aggregation across **5** simultaneous distinct problems (probe #21) spanning both top-level and nested fields — the shipped tests max out at 3-in-one-call; nothing proves the loop doesn't short-circuit once top-level fields are already invalid plus an entry is also invalid.
- `byId` size/reachability invariant on valid data — the happy-path test checks 2 specific ids via `.get`/`.has`, never asserts `byId.size === objectives.length` or that every objective is reachable.
- Syntactically invalid YAML and nonexistent-path behavior (probe #24, #25) — untested, and, per above, do leak an un-wrapped exception type.

None of these are code defects — every one of them behaves correctly except #24/#25, which match the established sibling idiom. But the brief singles out test adequacy as a live question, and on that question the 4 tests materially under-cover the file's own three listed failure modes (duplicate handling, malformed-entry handling, aggregation) relative to what the file actually needs guarding against.

## Scope discipline

Implementation, fixture, and tests are verbatim from the brief — no renames, no extra exports, no extra fields. No overbuilding. Nothing from the brief was silently dropped: all four required exports exist with the specified signatures, `source` is required (matches the commit message's stated rationale), aggregation is real (not first-error).

## TDD evidence

Report's RED (`Cannot find module .../objectives.ts`) and GREEN (4 passed) transcripts are internally consistent with what a from-scratch loader module produces, and I independently reproduced the GREEN state (`npm test` above). No reason to doubt genuineness.

---

**Spec compliance verdict: APPROVED**
**Task quality verdict: CHANGES REQUESTED**

### Findings

1. **NON-BLOCKING** — `test/content/objectives.test.ts` (78 lines, 4 tests total): no test covers (a) duplicate-count semantics with 3+ colliding entries, (b) `objectives` as a non-list mapping, (c) a non-mapping entry, (d) wrong-JS-type `id`/`text`/`chapters` (as opposed to malformed-string/out-of-range variants), (e) 5-way aggregation across top-level + nested fields simultaneously, (f) `byId` size/reachability invariant. All of these behave correctly today (verified by direct probing), but none are guarded by a test, so a future refactor of `parseObjectives` (`src/engine/content/objectives.ts:24-77`) could silently break any of them and the suite would stay green. This is the concrete failure the gap causes.
2. **NON-BLOCKING** — `src/engine/content/objectives.ts:79-81` (`loadObjectives`): invalid YAML syntax or a nonexistent path throws a raw `YAMLException`/Node `Error`, not a `ContentError`. Confirmed this is a pre-existing pattern shared by `task.ts:152-155` and `concept.ts:95-97`, not something introduced by this task. Flagging for a cross-cutting follow-up, not blocking this task.
3. **NON-BLOCKING** — `src/engine/content/objectives.ts:35-36`: the error message for a non-list `objectives` value ("must list at least one objective") is the same message used for an empty list, slightly obscuring the real problem when `objectives:` is e.g. a mapping. Cosmetic only — the entry is still correctly rejected with a useful `where`.

### Failure-mode-to-test coverage

Of the three failure modes named in the brief: **(1) duplicate id** is well-tested for the 2-entry case but not for 3+-entry collision counting; **(2) malformed entry** is tested only for the "string present but invalid" shape, not "wrong type entirely" or "non-mapping entry/list"; **(3) aggregation** is tested up to 3-in-one-call, not verified at 5 or across nested+top-level combined. None of the three failure modes is fully covered; all three are partially covered.

### Adversarial probe summary

25 inputs tried (20 via `parseObjectives`, 5 via file-based `loadObjectives`, one of the 20 built specifically to hit 5 simultaneous distinct problems). 23/25 behaved exactly as required. 2/25 (invalid YAML syntax, nonexistent path) leaked a non-`ContentError` exception — matches the established sibling-loader pattern, not a regression, non-blocking.

Review file: `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-6-review.md`
