# Task 13 — mandated changes to the brief

Four **required** changes. They override `task-13-brief.md` wherever they
conflict; everything else in the brief stands, including its eight tests.

This task is different from every task before it in this plan: its deliverable is
**transcribed fact, not code**. The ids you create are permanent — they are the
FSRS scheduling keys, so renaming one later orphans a user's entire review
history. A wrong transcription is therefore more expensive than a bug, and it is
invisible to the test suite. Accuracy to the source outranks green tests
throughout.

## 1. Find the mapping tables by content, not by the page numbers in the brief

The brief says to read `pages: "38-40"` of the RHCSA 9 PDF and page 42 of the
RHCSA 10 PDF. **Those are almost certainly the printed page numbers, not the PDF
page indices the `Read` tool takes.** A Cert Guide carries 20-40 pages of front
matter, so printed page 38 is likely PDF page 55-70.

Do this instead:

1. Read the PDF's table of contents (early PDF pages) to learn the offset between
   printed and PDF numbering, or read a small range and compare the printed folio
   in the page image to the index you requested.
2. Locate the mapping table by what it contains — a two- or three-column table of
   exam objectives against chapter numbers. Confirm you are looking at the
   objectives-to-chapters mapping and not the table of contents, which looks
   similar and is worthless here.
3. In your report, state the **actual PDF page indices** you read for each book,
   and quote the table's heading, so the reviewer can verify you read the right
   pages without re-reading the PDFs.

Do not use `pdftotext`; these pages are rendered images and it returns an empty
body. Use the `Read` tool with `pages:`.

If after a genuine search you cannot locate a table in either PDF, report
BLOCKED with the ranges you tried. Do **not** transcribe from a table you are
unsure is the right one, and do not fall back to your own knowledge of EX200
while presenting it as transcribed from the book.

## 2. The source wins over the RHEL 10 assertions — not the other way round

The brief's two RHEL 10 tests assert facts you are supposed to *discover*:

```ts
expect(areas.has('containers')).toBe(false)
expect(r10.objectives.some((o) => o.id.includes('flatpak'))).toBe(true)
```

and Step 4 pre-announces both ("Expect `containers.*` to be absent and a
`pkg.flatpak.*` area to be present"). That is backwards. `objectives-rhel10.yaml`
exists for exactly one reason — to enumerate risk R2, the possibility that the
exam has moved to RHEL 10 — and it is worthless if it records what the plan
guessed instead of what page 42 says.

**Transcribe the page. Then run the tests.** If either assertion fails:

- Keep the transcription. Change the test to match the source.
- Say so in your concerns, and make it the headline of your report. "The plan
  guessed wrong about the RHEL 10 delta" is the most valuable thing this task can
  discover, and it must not be buried.
- Never adjust the YAML to make a test green.

The same rule governs the `objectives.length` bound of 20-80 in the RHEL 9 tests:
the brief already says to re-read the source rather than widen the bound, and
that is right. But if the true published count genuinely falls outside 20-80,
report it rather than merging or splitting bullets to fit — merging and splitting
is the one thing the bound exists to catch.

## 3. Fallback when the Red Hat page cannot be fetched

Step 2 fetches
`https://www.redhat.com/en/services/training/ex200-red-hat-certified-system-administrator-rhcsa-exam`
and gives Red Hat's wording priority over the book's. If `WebFetch` fails —
network unavailable, page moved, content unreadable — do **not** report BLOCKED.
Proceed from the two books' tables, and make the `source:` string say plainly
that the Red Hat cross-check did not happen. For example:

```yaml
source: "RHCSA 9 Cert Guide mapping table, PDF p.<actual> (read visually; the table is a rendered image). Red Hat's published EX200 objectives page was NOT reachable at transcription time, so wording is the book's, not Red Hat's."
```

Two constraints on whatever you write:

- It must still contain the substring `visual` in some case, because
  `test/content/objectives-real.test.ts` asserts `source` matches `/visual/i`.
- It must not claim a cross-check that did not occur. This file's `source:` field
  is the only record of how authoritative its contents are; a `source` that
  overstates its provenance is worse than one that admits a gap, because the gap
  is what tells a future reader to re-verify.

If the fetch succeeds, keep the brief's wording rule (Red Hat's text in `text:`,
the book's number in `chapters:`) and note in a `#` comment any objective present
in one source and not the other, as the brief says.

## 4. Make the id-reuse rule enforceable

Step 4 says to "reuse the same ids wherever an objective is unchanged", but no
test checks that a shared id names the same objective. Reuse an id whose meaning
changed and the R2 delta silently *understates* the change.

Add a ninth test to `test/content/objectives-real.test.ts`, in the
`content/objectives-rhel10.yaml` describe block: for every id present in both
files, the two `text` values must match after normalization — lowercase, collapse
runs of whitespace to one space, strip trailing punctuation. Normalize rather
than compare exactly, so that a cosmetic rewording between editions passes while
a substantive one fails.

Write the normalizer as a small local function in the test file. Name the failing
id in the assertion message so a failure is actionable.

**If that test fails, the correct fix is in the YAML, not the test:** an objective
whose meaning changed between editions must get its own id in the RHEL 10 file
rather than reusing the RHEL 9 one, and a `#` comment should record what changed.
That is the R2 delta doing its job. Note that this can push the shared count
below the brief's existing bound
(`shared.length > r10.objectives.length / 2`) — if it does, that is a **real
conflict between two of the brief's own assertions**, not something to paper
over. Report it, keep the accurate transcription, and adjust the bound with a
comment explaining why the editions diverge more than the plan assumed.

## Out of scope

- Do not create placeholder `content/tasks/` or `content/concepts/` directories.
  After this task, `rhcsa coverage --content content` will fail to load because
  the bank has objectives but no tasks — that is correct and expected until the
  content-authoring tasks land. Do not "fix" it.
- Do not change `new URL(..., import.meta.url).pathname` to `fileURLToPath`. It
  is the established pattern in six approved test files; a house-wide sweep is
  parked for the final review.
- Do not touch `src/engine/content/objectives.ts`. The id regex and the
  chapters 1-28 range are already enforced there and already tested by Task 6.
