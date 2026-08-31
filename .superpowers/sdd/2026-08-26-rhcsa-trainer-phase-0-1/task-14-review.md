# Task 14 review — corpus extraction script

Commit reviewed: `4986837` (branch `phase-0-1`, parent `08cd2d9`).

## Verdict 1 — spec compliance

**Satisfied**, all five mandates plus the brief's five original tests plus the
brief's out-of-scope constraints.

- **Mandate 1 (void per team lead's ruling)** — not scored. For the record,
  the implementation's own measurement (r9 30 labs/95 exercises, r10 28/85,
  112 cross-edition = 28 shared labs + 84 shared exercises) reproduces exactly
  under independent commands run in this review (see Verification below), and
  matches the figures the team lead ratified. The report's root-cause
  diagnosis of the mandate's flawed grep pipeline (form-feed bytes surviving
  `tr -s ' '` / `sed 's/^ //'` and inflating `sort -u` counts) is correct and
  reproducible — confirmed independently in this review's own greps (see F5).
- **Mandate 2 (chapter terminator)** — satisfied. `CHAPTER_BARE_RE` was added
  and both regexes terminate a body (`scripts/extract-corpus.ts:84`). The
  safety argument (bare `Chapter N` lines cannot truncate a real item because
  they sit past every real heading in both editions) is independently
  reproduced in this review down to the exact line numbers: r9 has 31
  FF-prefixed bare-chapter matches (28 genuine chapter 1–28 openings at lines
  1722–29329, plus 3 stray artifacts at 29572/35430/36207) and 87 indented
  non-FF Appendix matches, all ≥29532 — both groups past r9's last item
  heading (`Lab 26.1` at 29134); r10's 88 bare matches all start at 22123,
  past its last item heading (`Lab 25.1` at 21747). The report's refinement of
  the mandate's "31 genuine" claim to "28 genuine + 3 stray" is correct.
- **Mandate 3 (longest-body-wins lock)** — satisfied and its mutation proof
  reproduces exactly (see Verification).
- **Mandate 4 (MAX_BODY_LINES lock)** — satisfied and its mutation proof
  reproduces exactly (see Verification).
- **Mandate 5 (pathToFileURL)** — satisfied (`scripts/extract-corpus.ts:178`),
  consistent with `src/cli/index.ts`. Correctly left untested per the
  mandate; real invocation confirmed working (Verification).
- Brief's five original tests: present and passing, all correctly retained.
- Out-of-scope constraints: nothing under `corpus/` is committed
  (`git ls-tree -r 4986837 --name-only | grep -c '^corpus/'` → `0`); `src/`
  untouched; the `(Lab)`/`(Exercise)` capture groups left alone.
- The `.gitignore` one-character change (`corpus/` → `/corpus/`) is exactly
  what the team lead already ratified, and is necessary for `test/corpus/` to
  be trackable — confirmed still correct (real output under `corpus/` at repo
  root is still ignored; `test/corpus/extract.test.ts` is tracked).

## Verdict 2 — task quality

**Good, with two real gaps in test adequacy** (F1/F2 below) that the
mutation-hunt turned up beyond the three the implementer already proved.
Everything else — clarity, house style, measurement rigor, the mandate-2
safety investigation — is solid work; the report's numbers and reasoning hold
up under independent reproduction, and the implementer went further than
required in refining the mandate's own claim rather than parroting it.

## Findings

**F1 — must fix now** (or at minimum, forward explicitly — see recommendation).
`scripts/extract-corpus.ts:93-94`, the `.replace(/\n{3,}/g, '\n\n')` and
`.trim()` calls on the extracted body text are completely unlocked. Deleting
both lines leaves all 8 tests in `test/corpus/extract.test.ts` green, and
deleting `.trim()` alone (keeping the collapse) also leaves all 8 green.
Verified: `npx vitest run test/corpus/extract.test.ts` → `8 passed (8)` in
both cases. No test's assertions (`toMatch`, `not.toMatch`, exact `toBe`
equality-checks that only assert non-equality, or line-count checks) touch
leading/trailing whitespace or runs of blank lines, so this normalization —
which matters a lot against real PDF text, where trailing blank lines before
the next heading are the common case — could silently regress and nothing
would notice. Fix: add an assertion pinning exact leading/trailing content,
e.g. extend the existing MAX_BODY_LINES-cap test (which already has no
trailing content to interfere) to assert `text.startsWith('Exercise 20-1')`
with no leading whitespace, and add a small case with 3+ blank lines between
heading and next heading asserting the body has no `\n\n\n` in it and doesn't
end in blank lines.

**F2 — forward to a later task** (lower severity than F1: affects output
order, not content correctness — a corpus consumer that looks up by `id`
is unaffected). `scripts/extract-corpus.ts:108`, the final
`.sort((a, b) => a.id.localeCompare(...))` in `findItems` is unlocked.
Deleting it (`return [...best.values()]`) leaves all 8 tests green — verified,
`8 passed (8)`. This passes only because the test fixtures' headings already
appear in the source text in id order, so `Map` insertion order happens to
coincide with sorted order. If a future edit to the sample data (or the real
PDFs) puts an out-of-order id before an in-order one, this would go
undetected. Fix: add a fixture where headings appear out of id order in the
source text and assert the returned array is nonetheless sorted.

**F3 — observation, not a defect.** `scripts/extract-corpus.ts:47-53`, the
regex capture-group accesses (`lab[2]`, `lab[3]`, `ex[2]`, `ex[3]`) are typed
`string | undefined` under `noUncheckedIndexedAccess` (RegExpExecArray is
indexed generically), but nothing narrows them — no `!`, no `as`, and no type
predicate either. This compiles silently only because the two consumers,
`Number(...)` and a template literal, both accept `undefined` without a type
error (producing `NaN` / the string `"undefined"` at runtime rather than a
compile-time signal). At runtime this is safe today: a capture group inside
a matched, non-optional regex is always defined when the overall match
succeeds, so `lab[2]`/`lab[3]` can't actually be `undefined` here. Not
recommending a change — the mandates explicitly warn against touching these
regexes for exactly this kind of no-benefit risk — but a genuine type
predicate (e.g. a small `isMatch` helper) would be the house-consistent way to
narrow this if a future task touches these functions again.

**F4 — observation, already correctly handled — flagging only because the
team lead asked for the one-sided-assertion pattern to be checked
everywhere.** The `stops an item body at the next heading` test
(`test/corpus/extract.test.ts:44-48`) asserts only `not.toMatch` (a one-sided
absence check), which is the same shape as the earlier task's stdout/stderr
blind spot. It is **not** a blind spot here: I mutated the next-heading bound
out of the body-end calculation (dropped `nextHeading` from the `Math.min`,
leaving only the cap and the chapter terminator) and this test caught it
immediately —
`expected 'Exercise 15-1 Creating a volume group…' not to match /Extending a logical volume/`
— because the swallowed content is exactly what the assertion checks for.
Reverted; `git diff --exit-code` clean afterward. No action needed; recorded
as evidence the one-sided-assertion pattern was checked and did not
reproduce here.

**F5 — sanity-check of a fact already ruled on, not a new finding.**
Independently reproduced the report's diagnosis of mandate 1's flawed
reproduction command: `grep -oE '^\s*Lab +[0-9]+\.[0-9]+' /tmp/r9.txt | tr -d
'\014' | ...` (stripping the form feed byte, per the team lead's corrected
command) yields exactly 30/95/28/85/112, matching the implementation. This
confirms the void ruling was correct and the implementation's baseline
comment (`scripts/extract-corpus.ts:36-44`) is trustworthy.

## Verification performed (all commands run in this review, not taken from the report)

- `npx vitest run` → `Test Files 16 passed (16)`, `Tests 158 passed (158)`.
- `npm run typecheck` → silent (no output beyond the npm script banner).
- `node scripts/extract-corpus.ts` → `r9: 30 labs, 95 exercises` /
  `r10: 28 labs, 85 exercises` / `cross-edition items (durable core): 112`,
  and `corpus/signal.json` shows 28 shared labs + 84 shared exercises = 112.
- Corrected grep reproduction on `/tmp/r9.txt` / `/tmp/r10.txt` (form feed
  stripped) → 30/95 and 28/85, matching exactly.
- Spot-checks: `Lab 15.1` (real 3-step end-of-chapter body, not a TOC line)
  and `Lab 6.2` (176-char sudo-configuration body, correctly stopped short of
  Chapter 7's opening prose) both confirmed by direct lookup against
  `corpus/r9/labs.json`.
- Mandate 2 mutation (single `CHAPTER_RE` check only): exactly 1 test failed
  (`terminates a body at RHCSA 9's bare form-feed chapter opening...`).
  Reverted; `git diff --exit-code scripts/extract-corpus.ts` clean.
- Mandate 3 mutation (`if (!existing)`): exactly 1 test failed (`keeps the
  real (longer) body...`, expected match `/vgcreate vgdata/`, got the
  one-line TOC string). Reverted; diff clean.
- Mandate 4 mutation (`let end = nextHeading`): exactly 1 test failed (`caps a
  body at MAX_BODY_LINES...`, expected `201` to be `121`). Reverted; diff
  clean.
- F1/F2/F4 mutations run and reverted as described above; final state
  confirmed with `git status --porcelain` (empty) and `git diff --exit-code`
  (clean, exit 0) after every mutation and at the end of the review.
- `git ls-tree -r 4986837 --name-only | grep -c '^corpus/'` → `0`.

## Blocking

None. Recommend F1 be addressed (even a small follow-up commit) since
whitespace/blank-line normalization is a real, currently-silent gap against
real PDF text; F2 and F3 are fine to forward; F4 is closed by this review's
own reproduction.
