# Task 14 — mandated changes to the brief

Five **required** changes. They override `task-14-brief.md` wherever they
conflict; everything else in the brief stands, including its five tests.

Environment facts, already verified — do not re-establish them:

- `pdftotext` is at `/home/daxtangco/.local/bin/pdftotext` (a rootless poppler
  wrapper) and is on PATH. Both PDFs exist and are readable.
- `pdftotext -layout` prints roughly 80 lines of
  `Syntax Error: Bad block header in flate stream` to **stderr** on these files
  and still **exits 0 with complete output** — 38954 lines for the RHCSA 9 PDF,
  24548 for the RHCSA 10 PDF. That noise is not a failure. `promisify(execFile)`
  rejects only on a non-zero exit, so the brief's `extract()` is fine as written.
- `execFile` takes an argv array, so the PDF paths' spaces and parentheses need no
  quoting.
- `corpus/` is already git-ignored (`.gitignore:8`).

## 1. The expected counts in Step 5 are wrong — replace the gate with a measurement

Step 5 expects `r9: 30 labs, 95 exercises`, `r10: 28 labs, 85 exercises`,
`cross-edition items: 112`, and tells you to stop and investigate on a mismatch.
Five of those six numbers are wrong. I measured the real PDFs directly:

| | r9 | r10 |
|---|---|---|
| unique lab ids | **32** | **33** |
| unique exercise ids | **96** | **87** |

Shared: **28 labs, 71 exercises → 99 cross-edition items.** Only the brief's "28
shared labs" figure was right, and its claim that r10 has fewer labs than r9 is
backwards.

Reproduce and confirm with (on the extracted text):

```bash
grep -oE '^\s*Lab +[0-9]+\.[0-9]+' r9.txt | tr -s ' ' | sed 's/^ //' | sort -u | wc -l
grep -oE '^\s*Exercise +[0-9]+-[0-9]+' r9.txt | tr -s ' ' | sed 's/^ //' | sort -u | wc -l
```

So: **run the extraction, record what you actually get, and compare against the
table above rather than the brief's numbers.** Expect your `findItems` output to
land on or very near those figures. A difference of one or two is worth a sentence
in the report — my grep and your regexes are not byte-identical, and change 2 below
will legitimately move body lengths (though not the id counts). A difference of
ten or more means the slicing logic is wrong; investigate that, do not paper over
it.

Do **not** edit the numbers in the brief file. Put your measured counts in the
report, and add a short comment in `scripts/extract-corpus.ts` recording the
measured baseline and the date, so a future change to the regexes has something to
regress against.

## 2. Fix the chapter terminator — it is dead in RHCSA 9's body (but not RHCSA 10's)

`const CHAPTER_RE = /^\s*Chapter +(\d+)[.\s]/` requires a character after the
digits, so it cannot match a line that is nothing but `Chapter 8`. **The two
editions open their body chapters differently, and that is the whole defect.**

I measured both texts directly. Do not re-derive this; confirm it and act on it.

**RHCSA 9 — the terminator never fires in the body.** All **28** matches of the
current regex are in the table of contents, lines **245-894**, and they use a
space rather than a period (`Chapter 1 Installing Red Hat Enterprise Linux`). A
real body chapter opening looks like this — form feed, bare `Chapter N`, blank
line, then the title on its own line (verbatim from line 9467, `cat -A` with the
trailing `$` stripped):

```
␌Chapter·8

Configuring·Networking
```

**RHCSA 10 — the terminator already works.** Its TOC *and* its body both use the
dotted form (`Chapter 9. Managing Software` at line 8041), and **52 of its 54**
matches fall before its last item heading. So the brief's comment ("RHCSA 9 uses
`Chapter 15 `, RHCSA 10 uses `Chapter 15.`") is right about RHCSA 10 and wrong
about RHCSA 9 — the space form it describes is RHCSA 9's *TOC*, not its body.

What the defect costs, in RHCSA 9 only: the last lab or exercise of each of ~26
chapters runs past its chapter's end into the next chapter's prose, bounded only
by `MAX_BODY_LINES`. Those are the end-of-chapter labs — the items an author
reaches for most.

**The bare `Chapter N` lines are safe to match. I checked, and this is the part
that matters.** An earlier draft of this mandate warned they might be running page
headers, in which case matching them would truncate every multi-page body at each
page break. **They are not page headers.** The evidence:

- r9 has 118 bare `Chapter N` lines: **31 carry a form feed** (the genuine body
  openings, lines 1722 → 29329) and **87 do not**. All 87 sit at line **29532 or
  later**, and every one is an **Appendix A answer-section heading** — line 29529
  is `␌  Appendix A`, followed by `Answers to the "Do I Know This Already?"
  Quizzes`, then one indented `Chapter N` per chapter, twice over. They are
  indented and carry no trailing whitespace, which is why the current regex
  misses them.
- r9's **last item heading is `Lab 26.1` at line 29134**, and its body cannot
  reach 29532 even at the full `MAX_BODY_LINES`. So all 87 are past every item.
- r10's bare `Chapter N` lines all sit at **22123+**, past its last item heading
  (`Lab 25.1` at **21747**). Also past everything.

So: add a bare-form alternative alongside the existing one. Something like

```ts
/** TOC in both editions, and RHCSA 10's body: `Chapter 15.` / `Chapter 15 Title`. */
const CHAPTER_RE = /^\s*Chapter +(\d+)[.\s]/
/** RHCSA 9's body: form feed, bare `Chapter 15`, blank, then the title. */
const CHAPTER_BARE_RE = /^\s*Chapter +(\d+)\s*$/
```

JS `\s` already includes `\f`, so `^\s*` covers the form feed without naming it.
Use whatever shape you prefer, but both forms must terminate a body.

Required order of work:

1. Confirm the measurements above with your own greps. If any disagree with mine,
   **your measurement wins** — say so in the report and act on yours.
2. Add a test using the **real RHCSA 9 body form** (`\fChapter 16` on its own
   line, blank, then a title on the next line). Keep the brief's existing
   dotted-form test — both forms occur and both must terminate.
3. Prove the new test locks the fix: revert the terminator to the brief's original
   single regex and confirm the new test fails.
4. Re-run the extraction. Report how the counts moved and paste a spot-checked
   end-of-chapter body before and after, since those are the items that change.
5. State in your report what you concluded about the bare lines. If your evidence
   contradicts mine and you decide to leave the terminator matching only the
   dotted form, that is acceptable — but say so explicitly with the evidence, and
   note that `MAX_BODY_LINES` is then the only bound on RHCSA 9's end-of-chapter
   items.

## 3. Lock longest-body-wins

The brief's test `deduplicates ids that appear in both a table of contents and the
body` asserts only the resulting **id list**, so it passes even if the
implementation kept the *first* match rather than the longest. The comparison
`item.text.length > existing.text.length` — the whole rule — survives deletion.

Extend that test (or add one beside it) asserting the **surviving body is the real
one**: the winning `Exercise 15-1` must contain `vgcreate vgdata`, and must not be
the one-line contents entry. Prove the lock by changing the comparison to keep the
first match (`if (!existing) best.set(...)`) and confirming your assertion fails.

## 4. Lock `MAX_BODY_LINES`

Nothing exercises the cap, so it survives deletion — and it is the only thing
between a missed heading and a body that swallows half a chapter. Add a test: one
heading followed by well over 120 lines with no subsequent heading and no chapter
line, asserting the extracted body is capped rather than running to the end of the
input. Assert on the line count, not on a magic character count.

Prove the lock by removing the `Math.min(..., start.index + 1 + MAX_BODY_LINES)`
bound and confirming your test fails.

## 5. Use `pathToFileURL` for the direct-invocation guard

The brief ends with

```ts
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
```

which is the same hand-built URL comparison replaced in Task 12. Use
`pathToFileURL` from `node:url`, matching what `src/cli/index.ts` now does:

```ts
const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
```

This is a house decision now; keep the two files consistent. Not runtime-testable
from inside vitest — the guard is false there by design — so add no test for it.
Its evidence is that Step 5's real `node scripts/extract-corpus.ts` invocation
works; paste that output into your report.

## Also worth doing while you are here

The brief's Step 5 spot-check is `l.find(i => i.id === 'Lab 15.1').text` and will
throw an unhelpful `TypeError` if the id is absent. Guard it, and spot-check **two**
bodies rather than one: `Lab 15.1` and one end-of-chapter item, since the latter is
what change 2 affects. Paste both into your report.

## Out of scope

- Do not commit anything under `corpus/`. It is git-ignored on purpose: it is
  regenerable and derived from copyrighted PDFs. Only the script and its test are
  committed.
- Do not touch the engine under `src/`. This is a standalone script.
- Do not "fix" the unused `(Lab)` / `(Exercise)` capture groups in the regexes.
  They make the match indices read oddly but are harmless, and renumbering them is
  a chance to introduce an off-by-one for no benefit.
