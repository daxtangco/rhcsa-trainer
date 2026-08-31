# Task 4 report: `ConceptSpec` loader

## What was implemented

- `src/engine/content/concept.ts` — `ConceptSpec` interface, `parseConcept(text, path)`, `loadConcept(path)`.
  Fields exactly as specified: `id, title, rhel, objectives, sources, prerequisites, body, path`.
  Uses `gray-matter` to split YAML front matter from body prose, and `ContentError`
  (imported, not redefined) to aggregate every validation problem before throwing once.
- Validation helpers `stringArray` and `intInRange` are copied with the same signature
  and behavior as `src/engine/content/task.ts`'s helpers (not reinvented), per the
  instruction to follow Task 3's idiom. `intInRange(fm.rhel, 'rhel', 9, 10, problems)`
  replaces the brief's literal inline rhel ternary+comparison — same error message
  (`rhel must be an integer 9-10`), same default-on-failure (9), verified equivalent for
  all inputs (number in range, number out of range, non-number, missing).
- `id` validated against `CONCEPT_ID_RE` (dotted lowercase, e.g. `storage.lvm-abstraction-stack`).
- `body` validated against `MIN_BODY_CHARS = 120` — the floor the brief calls out as
  the load-bearing requirement (an empty/stub card defeats the app's purpose of
  replacing the reference book).
- Test file: `test/content/concept.test.ts` (copied verbatim from the brief).
- Fixtures: `test/fixtures/concepts/good.md`, `bad.md`, `minimal.md` (copied verbatim
  from the brief).

## TDD evidence

**RED** — before `concept.ts` existed:

```
$ cd /home/daxtangco/rhcsa-trainer && npx vitest run test/content/concept.test.ts
 FAIL  test/content/concept.test.ts [ test/content/concept.test.ts ]
Error: Cannot find module '../../src/engine/content/concept.ts' imported from
'/home/daxtangco/rhcsa-trainer/test/content/concept.test.ts'
...
 Test Files  1 failed (1)
      Tests  no tests
```

This is the expected failure — the module under test doesn't exist yet, exactly as
the brief predicted.

**GREEN** — after implementing `concept.ts`:

```
$ npx vitest run test/content/concept.test.ts
 ✓ test/content/concept.test.ts (4 tests) 23ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

Full suite + typecheck:

```
$ npm test
 ✓ test/scaffold.test.ts (2 tests) 4ms
 ✓ test/fake-transport.test.ts (5 tests) 9ms
 ✓ test/content/task.test.ts (4 tests) 21ms
 ✓ test/content/concept.test.ts (4 tests) 24ms
 Test Files  4 passed (4)
      Tests  15 passed (15)

$ npm run typecheck
> tsc --noEmit
(no output — clean)
```

`gray-matter` was already present in `package.json`/`node_modules` from an earlier
task; no install step was needed.

## Aggregating-validation check (no short-circuit)

Ran `bad.md` directly and printed every collected problem, not just what the tests
assert on:

```
$ node -e "import('./src/engine/content/concept.ts').then(async ({loadConcept}) => {
  try { await loadConcept('./test/fixtures/concepts/bad.md') }
  catch (e) { console.log('problem count:', e.problems.length); e.problems.forEach((p,i)=>console.log(i+1,p)) }
})"
problem count: 5
1 id must be dotted lowercase, e.g. storage.lvm-abstraction-stack
2 title must be a non-empty string
3 rhel must be an integer 9-10
4 objectives must be a list of strings
5 body must be at least 120 characters of prose
```

`bad.md` has five distinct problems (missing/invalid id, missing title, out-of-range
rhel, non-array objectives, and an empty body) and all five surface from one call —
confirming there is no early `throw`, early `return`, or short-circuiting `&&` chain
that would suppress later checks.

## Files changed

- `src/engine/content/concept.ts` (new)
- `test/content/concept.test.ts` (new)
- `test/fixtures/concepts/good.md` (new)
- `test/fixtures/concepts/bad.md` (new)
- `test/fixtures/concepts/minimal.md` (new)

Commit: `37f8d7a feat(content): add ConceptSpec loader with a body-length floor`

## Self-review findings

- Field names, interface shape, and function signatures match the brief verbatim.
- Error message wording matches the brief verbatim (`id must be dotted lowercase, e.g.
  storage.lvm-abstraction-stack`, `title must be a non-empty string`,
  `rhel must be an integer 9-10`, `objectives must be a list of strings`,
  `body must be at least 120 characters of prose`).
- `MIN_BODY_CHARS = 120` matches the brief's floor exactly, with the brief's own
  comment explaining the 200-300 word budget vs. the 120-char floor kept intact.
- Confirmed no short-circuit path: walked every branch in `parseConcept` — none of
  `id`, `title`, `rhel`, `objectives`, `sources`, `prerequisites`, or `body` return or
  throw early; all push into the same `problems` array before the single `throw` at
  the end. Verified concretely above (5/5 problems reported for `bad.md`).
- One deliberate deviation from the brief's literal code, called out above: I used
  the `intInRange` helper (copied from `task.ts`) for the `rhel` check instead of the
  brief's inline ternary+comparison. This was explicitly requested by the task
  context ("match that structure and its helper style... rather than inventing a
  second idiom") and I verified it produces an identical error message and identical
  behavior for every input class (in-range number, out-of-range number, non-number,
  missing) before making the substitution. No test assertions changed as a result.
- Noted but did not change: the `objectives` empty-list check
  (`if (objectives.length === 0 && Array.isArray(fm.objectives))`) only fires a
  "must list at least one objective id" problem when the author explicitly writes
  `objectives: []`; if the `objectives` key is omitted entirely, `stringArray` quietly
  defaults it to `[]` with no problem. This is exactly what the brief's own code does,
  and no fixture in the brief exercises the omitted-key case, so I implemented it
  verbatim rather than substituting my own judgment. Flagging it here in case the
  omitted-objectives silence is not actually intended.
- Tests assert on values (`c.id`, `c.rhel`, `c.objectives`, etc.) and on error-message
  regexes, not on implementation internals — they test behavior, not mirror the code.
- Nothing overbuilt: no extra fields, no extra helpers (`isRecord` was not needed
  since `gray-matter`'s `.data` is always an object for these fixtures, and adding an
  untested guard would be unjustified surface area), no extra validation beyond what
  the brief specifies.
- Test output is pristine: no console noise, no skipped tests, 15/15 green across the
  whole suite, typecheck silent.

## Concerns

- The one item above (silent omission of `objectives` key vs. explicit empty list) is
  worth a second look during the scheduled independent review, since it's a genuine
  behavioral asymmetry in the brief's own code, not something I introduced.

---

## Fix round (post-review)

The reviewer confirmed the self-flagged concern was a real defect and requested two
fixes to `src/engine/content/concept.ts`, both applied.

### Finding 1 (BLOCKING) — omitted `objectives` key passed validation

Changed:

```ts
if (objectives.length === 0 && Array.isArray(fm.objectives)) {
```

to exactly what the reviewer specified:

```ts
if (fm.objectives === undefined || (Array.isArray(fm.objectives) && objectives.length === 0)) {
```

Message text (`objectives must list at least one objective id`) unchanged. This now
flags both an omitted key and an explicit `objectives: []`, while the non-array case
(e.g. `objectives: "not-a-list"`) is still reported once, by `stringArray` alone —
`fm.objectives` is neither `undefined` nor an `Array` in that case, so this branch
stays silent and doesn't double-report.

**New fixtures** added under `test/fixtures/concepts/`:
- `missing-objectives.md` — valid `id`/`title`/`rhel`, valid long body, `objectives`
  key omitted entirely.
- `empty-objectives.md` — identical to the above but with `objectives: []` explicit.

**New tests** added to `test/content/concept.test.ts` (existing `bad.md` assertions
left untouched, not renumbered):
- `'rejects an omitted objectives key, because a card with no objectives is
  unreachable from the disclosure ladder'` — asserts `err.problems` equals exactly
  `['objectives must list at least one objective id']` for `missing-objectives.md`.
- `'rejects an explicit empty objectives list distinctly from the omitted-key case'`
  — same exact-equality assertion for `empty-objectives.md`.

### Finding 2 (NON-BLOCKING) — no `isRecord` guard on `parsed.data`

Copied `task.ts`'s exact idiom:

```ts
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
```

and, mirroring `task.ts`'s `if (!isRecord(raw)) throw new ContentError(..., ['file
must contain a YAML mapping'])` placed at the very top of `parseTaskSpec`, added the
matching guard at the top of `parseConcept`:

```ts
if (!isRecord(parsed.data)) {
  throw new ContentError(path, ['front matter must be a mapping'])
}
const fm = parsed.data
```

Same shape (`X must be a mapping`), same immediate single-problem throw before any
other field checks run — a content author now gets one accurate signal instead of
four misleading "missing field" problems when front matter is a list or scalar
instead of a mapping.

### Verification commands and real output

Focused test run after the fix:

```
$ npx vitest run test/content/concept.test.ts
 ✓ test/content/concept.test.ts (6 tests) 29ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

Direct problem-count check across all five fixtures (confirms the reviewer's exact
predictions — `bad.md` stays at 5, `good.md`/`minimal.md` stay clean, the two new
fixtures each produce exactly the one objectives problem):

```
$ node -e "import('./src/engine/content/concept.ts').then(async ({loadConcept}) => {
  for (const f of ['bad.md','good.md','minimal.md','missing-objectives.md','empty-objectives.md']) {
    try { const c = await loadConcept('./test/fixtures/concepts/' + f); console.log(f, 'OK', 'id=' + c.id) }
    catch (e) { console.log(f, 'problems:', e.problems.length, JSON.stringify(e.problems)) }
  }
})"
bad.md problems: 5 ["id must be dotted lowercase, e.g. storage.lvm-abstraction-stack","title must be a non-empty string","rhel must be an integer 9-10","objectives must be a list of strings","body must be at least 120 characters of prose"]
good.md OK id=storage.lvm-abstraction-stack
minimal.md OK id=systemd.enabled-versus-started
missing-objectives.md problems: 1 ["objectives must list at least one objective id"]
empty-objectives.md problems: 1 ["objectives must list at least one objective id"]
```

Direct check of the `isRecord` guard with non-mapping front matter (a YAML list
instead of a mapping):

```
$ node -e "import('./src/engine/content/concept.ts').then(async ({parseConcept}) => {
  const text = '---\n- one\n- two\n---\nbody text here that is long enough to pass the floor check easily for sure yes indeed.'
  try { parseConcept(text, '/tmp/nonmapping.md') }
  catch (e) { console.log('problems:', JSON.stringify(e.problems)) }
})"
problems: ["front matter must be a mapping"]
```

One accurate problem, not four false leads — confirms Finding 2's fix works as
intended.

Full suite and typecheck:

```
$ npm test
 ✓ test/scaffold.test.ts (2 tests) 4ms
 ✓ test/fake-transport.test.ts (5 tests) 6ms
 ✓ test/content/task.test.ts (4 tests) 18ms
 ✓ test/content/concept.test.ts (6 tests) 19ms
 Test Files  4 passed (4)
      Tests  17 passed (17)

$ npm run typecheck
> tsc --noEmit
(no output — clean)
```

### Files changed in this round

- `src/engine/content/concept.ts` (modified — both findings)
- `test/content/concept.test.ts` (modified — two new tests, existing tests
  untouched)
- `test/fixtures/concepts/missing-objectives.md` (new)
- `test/fixtures/concepts/empty-objectives.md` (new)

Nothing outside `concept.ts` and its test/fixtures was touched. `MIN_BODY_CHARS` was
left unchanged, per the coordinator's explicit instruction.

Commit: `ea86ba3 fix(content): flag omitted objectives and non-mapping front matter in ConceptSpec`
