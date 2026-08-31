# Task 6: Objectives taxonomy loader — Report

## What was implemented

Created `src/engine/content/objectives.ts`, exporting:

- `interface Objective { id: string; text: string; chapters: number[] }`
- `interface ObjectiveSet { version: string; source: string; objectives: Objective[]; byId: Map<string, Objective> }`
- `function parseObjectives(raw: unknown, where: string): ObjectiveSet` — aggregating validation of a parsed YAML mapping. Checks: `version` non-empty string; `source` non-empty string; `objectives` a non-empty list; each entry's `id` matches dotted-lowercase `OBJECTIVE_ID_RE`, is not a duplicate (`duplicate objective id: <id>`), `text` non-empty, `chapters` a non-empty list of integers 1-28. All problems are collected in one pass and thrown together as a single `ContentError`.
- `function loadObjectives(path: string): Promise<ObjectiveSet>` — reads the file, parses YAML with `js-yaml`'s `load`, and delegates to `parseObjectives`.

Implementation, fixture, and test file were taken verbatim from the brief (`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-6-brief.md`) with no renames or additions.

Before writing anything I read:
- `src/engine/content/errors.ts` — confirms `ContentError(where, problems)` shape and that `problems` is a public readonly string array.
- `src/engine/content/task.ts` and `src/engine/content/concept.ts` — confirmed the house idiom: aggregating validation (collect all problems, throw once), a local unexported `isRecord` type predicate per file (no cross-module import, no `as unknown` casts), and the pattern of narrowing an `unknown[]` to a typed array only after every element has been individually validated (e.g. `task.ts`'s `stringArray` returns `v as string[]` after `!v.some(x => typeof x !== 'string')`). The objectives loader's `chapters: bad ? [] : (rawChapters as number[])` follows that same established idiom, not a raw cast on unvalidated `unknown`.

## Files changed

- `src/engine/content/objectives.ts` (new)
- `test/content/objectives.test.ts` (new)
- `test/fixtures/objectives-good.yaml` (new)

## TDD evidence

**RED** — before the implementation existed:

```
cd /home/daxtangco/rhcsa-trainer && npx vitest run test/content/objectives.test.ts
```

```
 FAIL  test/content/objectives.test.ts [ test/content/objectives.test.ts ]
Error: Cannot find module '../../src/engine/content/objectives.ts' imported from '/home/daxtangco/rhcsa-trainer/test/content/objectives.test.ts'
...
Caused by: Error: Failed to load url ../../src/engine/content/objectives.ts (resolved id: ../../src/engine/content/objectives.ts) in /home/daxtangco/rhcsa-trainer/test/content/objectives.test.ts. Does the file exist?

 Test Files  1 failed (1)
      Tests  no tests
```

This is a genuine RED: the module simply didn't exist yet, exactly as the brief predicted ("Cannot find module"). No tests ran to completion, confirming the test file itself was in place and correctly wired before any implementation.

**GREEN** — after writing `src/engine/content/objectives.ts`:

```
cd /home/daxtangco/rhcsa-trainer && npx vitest run test/content/objectives.test.ts
```

```
 ✓ test/content/objectives.test.ts (4 tests) 12ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

Full suite + typecheck:

```
cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck
```

```
 ✓ test/scaffold.test.ts (2 tests) 6ms
 ✓ test/fake-transport.test.ts (5 tests) 10ms
 ✓ test/grading/verdict.test.ts (13 tests) 21ms
 ✓ test/content/objectives.test.ts (4 tests) 35ms
 ✓ test/content/task.test.ts (4 tests) 42ms
 ✓ test/content/concept.test.ts (6 tests) 52ms

 Test Files  6 passed (6)
      Tests  34 passed (34)
```

`npm run typecheck` (`tsc --noEmit`) produced no output — clean.

Test output was pristine in both runs: no console warnings, no stray output.

## Self-review

- Read the diff (`git status --porcelain`, three new files, nothing else touched).
- Confirmed `parseObjectives` never short-circuits: each of the three failing tests exercises multiple simultaneous problems (duplicate id; malformed id + empty text + bad chapter; missing version + missing source + empty objectives list) and all are asserted present together via `problems.join('\n')` regex matches — this is behavioral, not implementation-mirroring, since the assertions check the rendered problem strings a caller would actually see.
- Confirmed the happy-path test exercises real indexing behavior (`byId.get(...).chapters`, `byId.has(...)`) rather than just checking the loader didn't throw.
- Confirmed no `enum`, no parameter properties, no namespaces, explicit `.ts` extensions on the two relative imports (`./errors.ts`, and in the test `../../src/engine/content/errors.ts` / `../../src/engine/content/objectives.ts`).
- Confirmed `isRecord` is local and unexported, matching `task.ts` / `concept.ts` / `verdict.ts`, not imported from elsewhere.
- Confirmed no new dependencies were added (`js-yaml` already a dependency); `package.json`/`package-lock.json` untouched.
- Nothing was added beyond what the brief specified — no extra exports, no extra fields, no extra tests.

## Concerns

None. The brief's fixture, test, and implementation code were internally consistent, matched the sibling loaders' idioms exactly, and passed on the first implementation attempt with a clean typecheck and zero test-output noise.

---

## Review round 2 fix report

Spec compliance was APPROVED; quality review requested two changes: broaden test coverage in `test/content/objectives.test.ts`, and fix an ambiguous error message in `src/engine/content/objectives.ts`. Both addressed; nothing else touched. The reviewer's parked item (raw `YAMLException`/`Error` on invalid YAML or missing path in `loadObjectives`, matching `task.ts` and `concept.ts`) was deliberately left as-is per instruction — it's Task 7's concern.

### Finding 2 — ambiguous message when `objectives` is not a list

**Before:**

```ts
const list = Array.isArray(raw.objectives) ? raw.objectives : []
if (list.length === 0) problems.push('objectives must list at least one objective')
```

A mapping (or any non-array) for `objectives` collapsed to the same `list = []` as a genuinely empty array, so both produced "objectives must list at least one objective" — telling an author who wrote a mapping to add more objectives, which is the wrong fix.

**After** (`src/engine/content/objectives.ts:35-39`):

```ts
const list = Array.isArray(raw.objectives) ? raw.objectives : []
if (!Array.isArray(raw.objectives)) {
  problems.push('objectives must be a list of objectives')
} else if (list.length === 0) {
  problems.push('objectives must list at least one objective')
}
```

Both cases are still rejected; only the message is now distinct per cause. No other parsing behavior changed — the `list` variable and everything downstream (the entry loop, `objectives.push`, `byId` construction) is untouched.

### Finding 1 — six new tests added to `test/content/objectives.test.ts`

All six added in the reviewer's style (build a `raw` object, call `parseObjectives` inline in a try/catch IIFE cast to `ContentError`, assert on `err.problems`):

1. **`reports a three-way collision once and leaves the unique objective unaffected`** — three entries, two sharing `id: 'a.b'`, one unique `id: 'c.d'`. Asserts `err.problems.filter(p => /duplicate objective id: a\.b/.test(p))` has length 1 (not 2), and `err.problems` overall has length 1 (proving `c.d` produced zero problems).
2. **`rejects objectives being a mapping instead of a list`** — `objectives: { 'a.b': {...} }`. Asserts the problems match `/objectives must be a list/`, exercising the Finding 2 fix.
3. **`rejects an entry that is a bare string instead of a mapping`** — `objectives: ['storage.lvm.resize']`. Asserts `/objectives\[0\] must be a mapping/`.
4. **`rejects wrong JS types for id, text, and chapters`** — `{ id: 42, text: ['not', 'a', 'string'], chapters: 15 }` (a number id, an array text, a bare-number chapters instead of a list). Asserts all three existing messages (`id must be dotted lowercase`, `text must be non-empty`, `chapters must be integers 1-28`) still fire for type mismatches, not just malformed strings.
5. **`aggregates five distinct problems spanning top-level and nested fields in one call`** — `{ objectives: [{ id: 'Bad', text: '', chapters: [99] }] }` (no `version`, no `source`, plus a malformed id, empty text, and out-of-range chapter on the one entry). Asserts `err.problems` has length exactly 5 and each of the five expected substrings (`version`, `source`, `id must be dotted lowercase`, `text must be non-empty`, `chapters must be integers 1-28`) is present — proving the single-pass aggregation crosses top-level and nested-entry validation in one call.
6. **`indexes byId with the same size as objectives, and every objective reachable`** (added under `describe('loadObjectives', ...)`, next to the existing happy-path test) — loads the real fixture, asserts `set.byId.size === set.objectives.length` and that every `o` in `set.objectives` satisfies `set.byId.get(o.id) === o` (reference equality, not just presence).

### Commands run and output

Targeted file, after both changes:

```
cd /home/daxtangco/rhcsa-trainer && npx vitest run test/content/objectives.test.ts
```
```
 ✓ test/content/objectives.test.ts (10 tests) 19ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

Full suite + typecheck:

```
cd /home/daxtangco/rhcsa-trainer && npm test
```
```
 ✓ test/scaffold.test.ts (2 tests) 4ms
 ✓ test/fake-transport.test.ts (5 tests) 8ms
 ✓ test/grading/verdict.test.ts (13 tests) 14ms
 ✓ test/content/task.test.ts (4 tests) 20ms
 ✓ test/content/objectives.test.ts (10 tests) 20ms
 ✓ test/content/concept.test.ts (6 tests) 33ms

 Test Files  6 passed (6)
      Tests  40 passed (40)
```

```
cd /home/daxtangco/rhcsa-trainer && npm run typecheck
```
No output — clean.

No console warnings or stray output in any run.

### Scope check

Changed only `src/engine/content/objectives.ts` (Finding 2's four-line diff) and `test/content/objectives.test.ts` (six new tests, no edits to the four pre-existing tests). No renames, no other files touched, no changes to `loadObjectives`'s YAML/filesystem error behavior (left matching `task.ts`/`concept.ts` as instructed).

### Commit

```
8dffbf6 test(content): cover objectives edge cases, fix ambiguous list-type error
```
