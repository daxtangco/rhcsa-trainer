# Task 14 report — corpus extraction

Status: **DONE_WITH_CONCERNS** (concern: mandate 1's measured-count table appears
to be based on a flawed reproduction command; see below — nothing in the
implementation is in doubt, but the mandate's numbers should not be trusted
going forward).

Commit: `4986837` on branch `phase-0-1`.

Test summary: 16 files / 158 tests passing (150 baseline + 8 new in
`test/corpus/extract.test.ts`); `npm run typecheck` clean; `git status --porcelain`
empty after the final revert.

## Mandate 2 — chapter terminator: confirmed, with one refinement

I reproduced every one of the mandate's measurements independently before
touching code:

- r9: all 28 matches of the brief's `CHAPTER_RE` are in the TOC (lines 245-894,
  space form `Chapter 8 Configuring Networking`). Confirmed via
  `grep -noE '^\s*Chapter'` on `/tmp/r9.txt`.
- r9's real body chapter opening at line 9467 is exactly as quoted: form feed,
  bare `Chapter 8`, blank line, `Configuring Networking`. Confirmed with
  `sed -n '9465,9470p' | cat -A`.
- r10: 54 `CHAPTER_RE` matches, 52 at or before line 21747 (the last item
  heading, `Lab 25.1`); the two after it are at 21754/21919. Confirmed.
  RHCSA 10's body chapter opener (line 8041, `Chapter 9. Managing Software`)
  already matches the dotted form. Confirmed via `cat -A`.
- r9's last item heading is `Lab 26.1` at line 29134; r10's is `Lab 25.1` at
  line 21747. Both confirmed via grep.
- The bare `Chapter N` lines: I found **118** total in r9 (mandate: 118,
  confirmed) and **88** in r10, all at line 22123+ (past every item). For r9 I
  refined the mandate's "31 carry a form feed" claim: there are **31**
  FF-prefixed bare lines total, but only **28** of them are genuine chapter
  openings (one per chapter 1-28, all at or before line 29329). The other 3
  FF-prefixed bare lines are stray running-header artifacts deep in Appendix A
  (lines 29572, 35430, 36207 — e.g. line 35430 is a `Table 6-2` running header
  reusing the "Chapter 6" form-feed page-break marker). This doesn't change
  the mandate's conclusion or the required fix — all three stray lines sit
  well past the last real item heading (29134), so matching the bare form is
  still safe — but the true picture is "28 genuine + 3 harmless stray
  FF-matches + 87 harmless indented Appendix matches = 118," not a clean
  "31 genuine, 87 not."

Chosen terminator: added `CHAPTER_BARE_RE = /^\s*Chapter +(\d+)\s*$/` alongside
the brief's `CHAPTER_RE`; a body ends at the first line matching either. This
is the shape the mandate suggested, confirmed safe by the measurements above.

Mutation proof (mandate 2): reverted the terminator to the brief's single
`CHAPTER_RE` check. Result: exactly one test failed —
`terminates a body at RHCSA 9's bare form-feed chapter opening, not just at
the dotted form` — with the expected diff (the leaked "must not leak" prose
appeared in the body). All 7 other tests still passed. Reverted; `diff`
against the pre-mutation file showed no difference.

Spot-check, end-of-chapter item `Lab 6.2` (chapter 6, immediately before
Chapter 7 opens at line 8356) — before vs. after the fix, run directly against
the real extracted `/tmp/r9.txt`:

**Before** (unfixed terminator, 3421 chars): body ran straight through the
rest of Lab 6.2's two sentences and then swallowed all of Chapter 7's opening
— title, topics list, exam objectives, intro paragraph, and the first five
"Do I Know This Already?" quiz questions — stopped only because a later
heading (not the chapter boundary) eventually appeared.

**After** (fixed terminator, 176 chars):
```
Lab 6.2

Create a sudo configuration that allows user bill to manage user properties and passwords, but
which does not allow this user to change the password for the root user.
```

## Mandate 1 — measured counts: a real discrepancy, investigated and resolved

The real extraction run:
```
r9: 30 labs, 95 exercises
r10: 28 labs, 85 exercises
cross-edition items (durable core): 112
```

This **matches the brief's original Step 5 numbers exactly** (30/95, 28/85,
112) — it does **not** match mandate 1's table (32/96 r9, 33/87 r10, 99
cross-edition). The cross-edition delta is 13, which the mandate itself says
warrants investigation rather than a one-sentence note, so I investigated
rather than trusting either number blind.

Root cause, fully diagnosed: mandate 1's reproduction command
(`grep -oE '...' | tr -s ' ' | sed 's/^ //' | sort -u | wc -l`) has a
byte-level bug. `pdftotext -layout` prefixes some heading lines with a raw
form-feed byte (`\x0c`, a page break) instead of leading spaces. `tr -s ' '`
only squeezes the space character — it does not touch `\x0c` — and
`sed 's/^ //'` only strips a literal leading space, not a leading form feed.
So a line like `␌Lab 6.2` survives the pipeline as `\x0cLab 6.2`, a byte
string distinct from the plain `Lab 6.2` produced by the same id's other
occurrence (TOC entry or a differently-formatted body heading). `sort -u`
then counts these as two different ids instead of one.

I confirmed this explains every single delta, exactly:

| | r9 labs | r9 exercises | r10 labs | r10 exercises |
|---|---|---|---|---|
| canonical unique ids (Python, capture-group id, matches `findItems`) | 30 | 95 | 28 | 85 |
| ids with an `\x0c`-prefixed variant (inflates naive `sort -u`) | 0 | 1 | 5 | 2 |
| naive grep `sort -u` count | 30 | 96 | 33 | 87 |
| mandate 1's table | 32 | 96 | 33 | 87 |

(r9 labs shows a further 2-id gap between the canonical count and the
mandate's 32 that traces to the same cause on two more ids, `Lab 1.1` and
`Lab 12.1`, whose only body occurrence is `\x0c`-prefixed.) I also directly
recomputed the cross-edition shared-exercise count as a raw Python set
intersection of canonical ids (not through `findItems` at all): **84**, not
71 — matching the script's output, not the mandate's.

Conclusion: my script's counts are correct (they agree with an independent,
`findItems`-free Python canonicalization); mandate 1's table is not, for a
diagnosed and reproducible reason. Per the mandate's own instruction that a
disagreeing measurement wins, I recorded **30/95 r9, 28/85 r10, 112
cross-edition (28 shared labs + 84 shared exercises)** as the baseline comment
in `scripts/extract-corpus.ts`, not the mandate's figures. I did not touch the
brief file. Nothing about this affected the terminator fix or any other code
change — id counts are insensitive to the chapter-terminator fix; only body
*content* for end-of-chapter items changes, as expected.

## Mandate 3 — lock longest-body-wins

Added a test asserting the *content* of the surviving `Exercise 15-1`
(`vgcreate vgdata`, and not equal to the one-line TOC string), beside the
brief's existing id-list dedup test.

Mutation proof: changed `if (!existing || item.text.length > existing.text.length)`
to `if (!existing)` (keep-first-match). Result: exactly the new test failed
(`expected 'Exercise 15-1 Creating a volume group' to match /vgcreate vgdata/`);
all 7 other tests passed. Reverted; full suite green afterward.

## Mandate 4 — lock MAX_BODY_LINES

Added a test: one heading, 200 filler lines, no further heading, no chapter
line. Asserts the exact expected line count (121 = heading + 120 capped
lines), not a character count, and that filler line 199 never appears.

Mutation proof: changed `let end = Math.min(nextHeading, start.index + 1 +
MAX_BODY_LINES)` to `let end = nextHeading`. Result: exactly the new test
failed (`expected 201 to be 121`); all 7 other tests passed. Reverted;
`diff` against the pre-mutation file showed no difference.

## Mandate 5 — pathToFileURL

Used `pathToFileURL(invokedPath).href` for the direct-invocation guard,
matching `src/cli/index.ts`. Not unit-tested (per the mandate, vitest never
takes this branch). Evidence is the real invocation above: `node
scripts/extract-corpus.ts` ran the full pipeline, wrote all three JSON files,
and exited 0.

## Spot-checks (brief's "Also worth doing" section)

Both via a guarded lookup that throws a clear `Error` (not a `TypeError`) on a
missing id — verified directly by looking up a nonexistent `Lab 999.9` and
confirming the message reads `spot-check failed: no item with id "Lab 999.9"
in corpus/r9/labs.json` rather than crashing.

- `Lab 15.1` (first 400 chars): the real end-of-chapter lab text (a 3-step
  logical-volume exercise), not a one-line TOC entry.
- `Lab 6.2`: before/after shown under mandate 2 above.

## Unplanned fix: `.gitignore`

`git add test/corpus` was refused — the existing `.gitignore` line `corpus/`
(no leading slash) matches any directory named `corpus` at any depth, so it
was also silently ignoring `test/corpus/`, which would have made this task's
required test file uncommittable. I anchored it to the repo root
(`/corpus/`) so it only ignores the top-level extraction-output directory.
Confirmed afterward that `corpus/` (real output, currently populated) is still
ignored and `test/corpus/` is now trackable. This was not called out in the
brief or mandates; flagging it explicitly since it's outside the five
mandates but was necessary for the deliverable to be committable at all.

## What a later task should inherit

- The measured baseline comment in `scripts/extract-corpus.ts` (30/95 r9,
  28/85 r10, 112 cross-edition) is the one to trust; do not resurrect mandate
  1's table without accounting for the form-feed dedup bug described above.
- `.gitignore`'s `corpus/` entry is now `/corpus/` (root-anchored). Any future
  task adding another directory literally named `corpus` anywhere under
  `test/` or elsewhere should be aware this no longer blanket-ignores it.
- The three stray FF-prefixed bare `Chapter N` lines in r9 (29572, 35430,
  36207) are harmless today only because they sit past the last real item
  heading. If a future PDF revision or a different edition moves real content
  past line ~29000, re-verify this assumption.
