# Task 14 fix round 1 report — F1 and F2

Status: DONE

Commit: `b12b867` on `phase-0-1`.

Test summary: 16 files / 161 tests passing (158 baseline going into this
round + 3 new); typecheck clean; `git status --porcelain` empty; only
`test/corpus/extract.test.ts` was touched — `scripts/extract-corpus.ts` is
unchanged from commit `4986837`.

## F1 — body normalization (`.replace(/\n{3,}/g, '\n\n')` and `.trim()`)

Split into two tests, each isolating one operation so the two mutations
below don't conflate:

- `trims leading whitespace from an indented heading and trailing whitespace
  from the body` — an indented heading (`   Exercise 22-1 ...`) with two
  trailing blank lines and no following heading (so `.trim()`, not the
  chapter/next-heading bound, is what removes both). Asserts the body starts
  with the heading text exactly and ends with `step.`, not whitespace.
- `collapses three or more consecutive blank lines inside a body to a single
  blank line` — a 4-blank-line run *between* two real content lines within
  one item's body (not trailing, so `.trim()` can't be the one doing the
  work). Asserts no `\n{3,}` survives and the collapsed text reads
  `of body.\n\nline two`.

Mutation 1 — deleted `.replace(/\n{3,}/g, '\n\n')`, kept `.trim()`: ran
`npx vitest run test/corpus/extract.test.ts` → exactly one failure, `findItems
> collapses three or more consecutive blank lines inside a body to a single
blank line`, with the raw 5-newline run visible in the diff; the other 10
tests (including the new leading/trailing-whitespace test) stayed green.
Reverted; `git diff --exit-code scripts/extract-corpus.ts` clean.

Mutation 2 — deleted `.trim()`, kept `.replace(...)`: exactly one failure,
`findItems > trims leading whitespace from an indented heading and trailing
whitespace from the body` (`expected false to be true` on the `startsWith`
check); the other 10 stayed green. Reverted; `git diff --exit-code` clean.

## F2 — the final `.sort(...)` in `findItems`

Added `returns items sorted by id even when headings appear out of order in
the source text`: a fixture where `Exercise 24-2` appears in the source text
before `Exercise 24-1`. Asserts the returned array is still id-ordered
(`['Exercise 24-1', 'Exercise 24-2']`).

Mutation — changed `return [...best.values()].sort(...)` to
`return [...best.values()]`: exactly one failure, this new test, with the
diff showing insertion order (`['Exercise 24-2', 'Exercise 24-1']`) instead
of sorted order; the other 10 tests stayed green. Reverted; `git diff
--exit-code` clean.

## Nothing else changed

`scripts/extract-corpus.ts` was never modified in the final state — each
mutation above was applied, run, and reverted in place, confirmed byte-identical
to the pre-mutation file via `git diff --exit-code` each time. No behavior
change; this was a test-only round as instructed. F3 (the `noUncheckedIndexedAccess`
capture-group narrowing) was left untouched per your note — not rediscovered,
not touched.

Nothing blocks.

## Fix round 2 — F6

Status: DONE

Commit: `bddbe8f` on `phase-0-1`.

Test summary: 16 files / 161 tests passing (unchanged count — the F2 fixture
was replaced in place rather than adding a new test); typecheck clean;
`git status --porcelain` empty; `scripts/extract-corpus.ts` is byte-identical
to `4986837`/`b12b867`.

Replaced the F2 fixture (`Exercise 24-1`/`24-2`, which sort identically under
lexical and numeric collation) with `Exercise 9-1`/`Exercise 10-1`, placed in
the source with `Exercise 10-1` first. This ordering matches neither the
correct numeric-sorted result (`[9-1, 10-1]`) nor a plain lexical sort
result (`[10-1, 9-1]` — same as insertion order), so one assertion now
distinguishes all three possible implementations: correct numeric sort,
lexical-only sort, and no sort at all.

Mutation 1 — deleted `, 'en', { numeric: true }` from the `.sort(...)` call
(bare `a.id.localeCompare(b.id)`): exactly one failure —
`returns items sorted numerically by id even when headings appear out of
order in the source text`, with the diff showing lexical order
`['Exercise 10-1', 'Exercise 9-1']` instead of the expected numeric order.
The other 10 tests stayed green. Reverted; `git diff --exit-code
scripts/extract-corpus.ts` clean.

Mutation 2 — deleted the whole `.sort(...)` (`return [...best.values()]`):
exactly the same one test failed, with the same diff (insertion order
happens to coincide with lexical order for this pair, so the two mutations
produce an identical wrong answer — expected, since both leave the array in
non-numeric order). The other 10 tests stayed green. Reverted; `git diff
--exit-code scripts/extract-corpus.ts` clean.

Nothing blocks.
