# Task 13 review — objective taxonomies

Reviewing commit `f14cc09` against `task-13-brief.md` as amended by
`task-13-mandates.md`.

## Verdicts

**Spec compliance: APPROVED WITH FINDINGS.** Every mandate is satisfied and the
transcription is verifiably exact in both files; the only compliance gap is a
`source:` string that claims a visual read of three pages that were read from the
text layer instead (F2), plus one disclosed deviation from mandate 4's normalizer
that needs the lead's ratification (F7).

**Task quality: APPROVED WITH FINDINGS.** The data — which is the whole
deliverable — is correct to the source with zero undisclosed deviations, which is
the best available outcome. The findings are in the *tests*, which mutation
testing showed do not lock transcription fidelity (F1, F8), and in a handful of
permanent ids that are free to fix today and expensive to fix after the first
content task lands (F3–F6).

Nothing here is blocking.

---

## 1. Transcription completeness and fidelity — RHEL 9

I did a genuine row-by-row reconciliation, not a spot check, and it is machine
checked rather than eyeballed.

**Method.** I parsed `/tmp/r9tab.txt` (the `-layout` text of PDF pages 38–46)
into structured rows: a row is a line whose objective / chapter-title / chapter
columns are all populated; a line immediately following a row is a continuation
and is joined into the column it sits under; a line that is one of the ten
published EX200 section headings is a heading; any other standalone line is a
data row with an empty chapter cell. I then parsed all `id`/`text`/`chapters`
triples out of `content/objectives.yaml` and compared the two sequences
positionally *and* as sets.

**Result.**

| check | outcome |
| --- | --- |
| Table 1 data rows parsed | **68** |
| YAML entries | **68** |
| `text` mismatches (positional, byte-exact) | **0** |
| `chapters` disagreements | **0** |
| rows in source with no YAML entry | **0** |
| YAML entries with no source row | **0** |
| duplicate source texts / duplicate YAML texts / duplicate ids | **0 / 0 / 0** |

The two files agree in the same order, one entry per row, byte for byte. No
bullet was merged, none was split, nothing was silently reworded, and every
chapter number is the table's own.

**Section groupings — the report's arithmetic is right.** Counting rows per
section heading directly out of the parsed source:

```
11  Understand and use essential tools
 4  Create simple shell scripts
10  Operate running systems
 6  Configure local storage
 6  Create and configure file systems
 6  Deploy, configure, and maintain systems
 4  Manage basic networking
 4  Manage users and groups
 9  Manage security
 8  Manage containers
```

`11+4+10+6+6+6+4+4+9+8 = 68`. The claim is exactly the table's actual section
structure, not a rationalisation after the fact. The ten headings are also
exactly Red Hat's ten published RHEL 9 section names, which is what lets the two
blank-chapter lines be identified as data rows rather than headings.

**The two blank-chapter rows and their imputed chapters both check out in the
book.** `pdftotext` of the RHCSA 9 PDF, chapter 7 opener (`Permissions
Management`) lists, verbatim:

```
The following RHCSA exam objectives are covered in this chapter:
    Manage default permissions
    List, set, and change standard ugo/rwx permissions
    Create and configure set-GID directories for collaboration
    Diagnose and correct file permission problems
```

and the chapter 22 opener (`Managing SELinux`) lists `Manage SELinux port labels`
verbatim among its six. So `files.permissions.umask → [7]` and
`selinux.ports.labels → [22]` come from the book, as claimed, and the `text:`
values correctly stay with Table 1's wording ("Manage default **file**
permissions") rather than the opener's.

**Page range.** `source:` says PDF pages 39–45. Verified: page 38 is the "Review
All Key Topics" prose plus the caption, pages 39–45 carry the table (seven
`Objective | Chapter Title | Chapter` page headers), page 46 is Figure Credits.

**On the pages the implementer did not read visually.** The report discloses that
pages 41, 42 and 43 were transcribed from the text layer only. I did not re-read
them as images either. Instead I closed the gap a different way: I checked those
rows against three independent sources, and every one of them is corroborated —
Red Hat's currently published page (fetched by me, below), the RHCSA 10 Table 1
images (read by me, below), and the RHCSA 9 chapter 7 opener. The rows unique to
RHEL 9 that only the text layer attests are `Install and update software packages
from Red Hat Network…` and `Restrict network access using firewall-cmd/firewall`;
both are the expected RHEL 9 wordings and both are named as *changed* in RHEL 10
by sources I did verify. I am satisfied the RHEL 9 transcription is faithful. The
wording of the `source:` field is a separate matter — see F2.

## 2. Transcription fidelity — RHEL 10, and the judgment call

I did not take the report's word for the RHEL 10 table. I extracted it and read
it.

**The six-JPEG / two-pages-per-image trap is real, exactly as reported.**
`pdfimages -list -f 42 -l 49` shows twelve image placements over six unique
XObjects — object IDs **1908, 1910, 1912, 1914, 1916, 1918**, precisely the six
the report names — each appearing on two consecutive PDF pages (1908 on 43+44,
1910 on 44+45, … 1918 on 48+49). Rendering pages loses rows at the seams;
extracting the six objects does not. I read all six.

**Caption and page range.** PDF page 42's text layer contains `Table 1 Coverage
of RHCSA Objectives` verbatim, above the images. `source:`'s "PDF pages 43-49" is
accurate (object 1918 does land on page 49).

**Reconciliation.** I transcribed all 58 Table 1 rows from the six images myself
and diffed them against `content/objectives-rhel10.yaml`:

- **58 Table 1 rows, all 58 present in the YAML.**
- **Zero chapter disagreements** across all 58.
- Exactly one text divergence: `List, create, and delete partitions on MBR and
  GPT disks` (Table 1) vs `…on GPT disks` (YAML). Disclosed in the report's
  disagreement table and in a `#` comment on the entry.
- Exactly four YAML entries absent from Table 1: the `Manage software` block.
- **Table 1 contains no Flatpak row anywhere.** Confirmed by reading all six
  images end to end. The report's central claim holds.
- Last data row is `Use Boolean settings to modify system SELinux settings |
  Managing SELinux | 22`, as reported; `Diagnose and address routine SELinux
  policy violations` is genuinely absent, and so is `Create and configure set-GID
  directories for collaboration`.
- `Configure privileged access` **is** in Table 1 (chapter 6), so the report's
  claim that Table 1 agrees with Red Hat on that rename is true.
- Both formerly blank chapter cells are filled in by the RHCSA 10 table
  (`Manage default file permissions → 7`, `Manage SELinux port labels → 22`), as
  the YAML comments say.

**I fetched Red Hat's published EX200 page independently** (`WebFetch`, same
URL). It returns ten sections and **62** bullets, with a `Manage software` section
containing the four RPM/Flatpak bullets and **no** `Manage containers` section.
Diffed positionally against the YAML:

> **62 Red Hat bullets vs 62 YAML entries: 0 mismatches, 0 missing, 0 extra.**

`content/objectives-rhel10.yaml` reproduces Red Hat's currently published
objectives exactly, in order, byte for byte, including section order (Manage
software second). Section counts `11+4+4+10+6+5+6+4+4+8 = 62` confirmed.

All six wording disagreements in the report's table are real and there are no
undisclosed ones. `Archive… using tar, gzip, and bzip2` and `Restrict network
access using firewalld and firewall-cmd` are correctly *absent* from that table,
because Table 1 and Red Hat agree on both.

**Corroborating checks:** RHCSA 10 has no containers chapter (TOC: chapter 26 is
`Final Preparation`, 27 `Theoretical Pre-Assessment Exam`); `podman` appears on 4
lines of the whole book, `flatpak` on 55 (the report said "57 occurrences" — same
thing counted per-occurrence rather than per-line, not a discrepancy);
`flatpak` appears 0 times in the RHCSA 9 book.

### Verdict on the judgment call: **including the four `Manage software` objectives is right. Keep them. No test change is needed.**

The implementer nominated this for scrutiny and was scrupulous about the
counter-evidence. I checked both sides.

The quoted Chapter 9 opener is verbatim (`/tmp/r10full.txt`, RHCSA 10 PDF):

```
THE FOLLOWING RHCSA EXAM OBJECTIVE IS COVERED IN THIS CHAPTER:
   • Configure access to RPM repositories
   • Install and remove RPM software packages
   • Configure access to Flatpak repositories
   • Install and remove Flatpak software packages
   • Install and update software packages from Red Hat Content Delivery
     Network, a remote repository, or from the local file system
```

The counter-evidence is also all real — I confirmed each stale opener myself:
chapter 3 still says `tar, star, gzip, and bzip2`; chapter 6 still says
`Configure superuser access`; chapter 7 still lists `Create and configure set-GID
directories for collaboration`; chapter 12 still says `Schedule tasks using at and
cron`. The implementer was right to flag that "opener beats Table 1" is not a rule
it applied consistently.

But that honesty understates its own case, because the opener is not the load-
bearing source here:

1. **The brief's own source priority decides this.** Source #1 is "Red Hat's
   published EX200 objectives — the contractual statement of what is testable",
   ranked *above* the book's mapping table. Red Hat publishes those four bullets
   under their own heading. Including them is obeying the brief, not departing
   from it. Excluding them would mean the file contradicts its highest-priority
   source.
2. **The opener only supplies the chapter number, and Table 1 corroborates it.**
   Table 1's own `Install and update software packages from Red Hat Content
   Delivery Network…` row maps to `Managing Software / 9`. So `chapters: [9]` for
   the four does not rest on the opener alone.
3. **Table 1 is demonstrably behind Red Hat, independently of Flatpak.** It still
   says `MBR and GPT disks`, `multiuser` and `nondestructively` where Red Hat now
   says GPT-only, `multi-user` and `non-destructively`. Its silence on Flatpak is
   one more instance of the same lag, not evidence against.
4. **The count corroborates.** 58 + 4 = 62 = Red Hat's published count, and the
   62 match bullet for bullet. 58 alone matches nothing.

Mandate 2 therefore does not fire: the `flatpak` assertion passes on the source's
own authority, not because the YAML was bent to it. Mutation M9 (below) confirms
the assertion is load-bearing rather than vacuous.

## 3. The deviation from mandate 4's normalizer

`test/content/objectives-real.test.ts:66-73` adds `.replace(/-/g, '')` to the
lowercase / collapse-whitespace / strip-trailing-punctuation folding mandate 4
specified.

I checked the "masks nothing" claim adversarially by removing the fold and
running the test (mutation M5b). The result is exactly two divergences and both
are purely orthographic:

```
users.login.switch: rhel9 "…users in multiuser targets" vs rhel10 "…users in multi-user targets"
storage.swap.nondestructive: rhel9 "…swap to a system nondestructively" vs rhel10 "…swap to a system non-destructively"
```

The report's claim is accurate, including the consequence: fixing those the
mandate's way mints two more permanent ids and moves `shared` from 52 to 50,
still above the bound of 31.

Could hyphen folding hide something meaningful? I could not construct a plausible
case. The fold deletes hyphens rather than mapping them to spaces, which is what
makes `multi-user` ≡ `multiuser` work at all; mapping to a space would not. The
residual risk is English pairs distinguished only by a hyphen (`re-cover` /
`recover`), but a difference that *is* only the hyphen is by construction the
cosmetic case the mandate wants to pass. Every substantive RHEL 9→10 change in
this data differs by a whole word — `star`, `MBR`, `systemd timer units`,
`Content Delivery Network`, `firewalld`, `privileged` — and mutation M1 confirms a
word-level change is still caught with a fully actionable message.

**Recommendation: accept the deviation and keep the fold.** It serves the
mandate's stated intent ("a cosmetic rewording between editions passes while a
substantive one fails") better than the literal wording does, it is documented in
a comment at the point of deviation, and the alternative costs two permanent
scheduling keys for two hyphens. This is the lead's call to ratify, not a defect —
see F7, which also notes one small ordering nit in the same function.

## 4. Test quality — mutation testing

Ten mutations, each applied to the working tree, run, and reverted with
`git checkout`. Every one listed here was actually applied and actually run.

| # | mutation | caught? | by which test |
| --- | --- | --- | --- |
| M1 | rename rhel10 `pkg.dnf.install-cdn` → `pkg.dnf.install`, reusing the RHEL 9 id for the CDN-worded objective | **yes** | test 9 |
| M2 | delete the whole `containers.*` block from `objectives.yaml` (68→60) | **yes** | test 4 |
| M3 | drop "visually" from `objectives.yaml`'s `source:` | **yes** | test 2 |
| M4 | **merge** `tools.shell.prompt` + `tools.shell.redirection` into one `tools.shell.essentials` entry (68→67) | **NO** | — all 9 passed |
| M5b | remove `.replace(/-/g, '')` from the normalizer | **yes** | test 9 (2 divergences, both orthographic) |
| M6 | silently change `storage.lvm.resize` chapters `[15]` → `[14]` | **NO** | — all 9 passed |
| M7 | reword a *shared* rhel9 text (`Use grep and regular expressions…` → `Use grep, sed and awk…`) | **yes** | test 9 |
| M8 | reword a **rhel9-only** text (`Inspect container images` → `Push container images to a registry`) | **NO** | — all 9 passed |
| M9 | delete the four `Manage software` entries from the rhel10 file | **yes** | test 8 (flatpak) |
| M10 | duplicate an id inside `objectives.yaml` | **yes** | loader `ContentError`, all 5 rhel9 tests fail |

**Mandate 4's ninth test does lock what it claims, and its failure message is
excellent.** M1's output:

```
shared ids whose text diverges - give the RHEL 10 objective its own id:
pkg.dnf.install: rhel9 "Install and update software packages from Red Hat Network, …"
             vs rhel10 "Install and update software packages from Red Hat Content Delivery Network, …"
```

It names the offending id, prints both texts, tells the reader what to do about
it, and aggregates rather than short-circuiting (M5b reports both divergences in
one run) — house style honoured.

**Three mutations were not caught, and all three are the same gap: nothing locks
transcription fidelity.** M4 is the important one, because the brief explicitly
claims its 20–80 bound "exists to catch merged or split bullets" and M4 proves it
does not. M6 and M8 show `chapters:` is unlocked entirely and that `text:` is only
locked for the 52 ids shared with the rhel10 file. See F1 and F8. The *data* is
correct — I verified that independently in sections 1 and 2 — so these are latent
regression risks for future edits, not present defects.

Test 2 also only requires the substring `visual` anywhere in `source:`, so a
`source:` that overstates its provenance passes (F11) — which is how F2 got
through.

## 5. Permanent-id soundness

All 78 distinct ids are the implementer's invention; the report says so plainly
and no source supplies ids. Overall they are consistent and mostly predictable:
one area prefix per topic, verb-free noun-phrase leaves, `-` only inside a
segment, all matching the required regex (the loader enforces it and M10 shows
that validation bites). The `sys.*` / `selinux.*` / `containers.*` / `storage.*`
groups are internally uniform and follow the brief's area comment.

Four exceptions, in descending order of how likely they are to be mis-guessed by
a later content-authoring task — F3, F4, F5, F6 below. All four are free to change
*today*, because nothing loads `objectives-rhel10.yaml` and no `content/tasks/`
or `content/concepts/` exists yet, so no scheduling history is keyed on any id.
After the first content task lands, they are permanent. That asymmetry is the
whole reason I am raising them at all.

**The `tools.shell.essentials` split is correct.** Table 1 page 39 has two
distinct rows, `Access a shell prompt and issue commands with correct syntax` and
`Use input-output redirection (>, >>, |, 2>, etc.)`, both chapter 2. Merging them
into the brief's example id would have been the exact merge the count bound is
supposed to catch — and M4 proves the bound would not have caught it. The
discipline mattered. The brief's example is itself defective (F9).

`users.login.switch`, `net.ssh.key-auth`, `systemd.services.network` and
`tools.script.*` are all defensible filings-by-topic; `tools.script.*` in
particular is internally uniform across its four ids and is the only reasonable
choice given the brief's area list has no scripts area (F10 asks for the plan to
record it).

## 6. Scope discipline — all clean

Verified from the diff and the repository:

- `git show --stat f14cc09` → **3 files, 664 insertions, 0 deletions**, all three
  `new file mode`. Nothing was modified, so no pre-existing test could have been
  changed.
- `git diff --name-only 2ff65ac f14cc09 | grep -c src/engine/content/objectives.ts`
  → **0**. Untouched, as the mandates require.
- `content/` contains exactly `objectives.yaml` and `objectives-rhel10.yaml`. No
  `content/tasks/`, no `content/concepts/`.
- `test/content/objectives-real.test.ts:4` keeps
  `new URL('../../content/', import.meta.url).pathname`. No sweep to
  `fileURLToPath`.
- No `enum`, `namespace`, decorator, parameter property, `as` cast or non-null
  assertion in the new test file; the local import carries `.ts`; ESM only.

## Findings

Ordered most-severe-first. "Defect in the work" vs "defect in the brief/mandates"
is marked on each; the latter are for the lead to rule on and are not charged
against the implementer.

### F1 — the count bound does not catch a merged bullet
**non-blocking · defect in the brief's tests**
`test/content/objectives-real.test.ts:17-23`.
Mutation M4 merged two Table 1 rows into a single YAML entry (68→67) and all nine
tests passed. The brief asserts at line 151 that this bound "exists to catch
merged or split bullets"; it does not — 20–80 has 60 units of slack around a
68-row table.
**Fix:** assert the exact count, `expect(set.objectives.length).toBe(68)`, with a
comment recording that 68 is RHCSA 9 Table 1's row count
(`11+4+10+6+6+6+4+4+9+8`); keep the 20–80 reasoning as the comment. Same for the
rhel10 file: `toBe(62)`, citing Red Hat's 62 published bullets. Both numbers are
independently verified in this review.

### F2 — `objectives.yaml`'s `source:` claims a visual read that was partly a text-layer read
**non-blocking · defect in the work**
`content/objectives.yaml:20`.
The string reads "PDF pages 39-45 (read visually with the Read tool;
cross-checked against the PDF text layer)". Per the report, pages 41–43 were not
read visually — those rows came from the text layer, with the visual read
covering 39, 40, 44 and 45. The order of the two clauses is therefore inverted
relative to what happened, and mandate 3 is explicit that this field "is the only
record of how authoritative its contents are" and must not claim provenance it
does not have. The transcription itself is correct — I reconciled all 68 rows and
corroborated the pages 41–43 rows against three other sources — so this is a
wording defect, not a data defect.
**Fix:** reword to state what happened, e.g. "…transcribed from the PDF text
layer (`pdftotext -layout`, PDF pages 39-45) and visually verified on pages 39,
40, 44 and 45 with the Read tool; contrary to the plan this table is
machine-readable text, not a rendered image." Must keep the substring `visual`
for test 2.

### F3 — `Manage software` id block is asymmetric between RPM and Flatpak
**non-blocking · defect in the work**
`content/objectives-rhel10.yaml:85-96`.
Flatpak gets a symmetric pair, `pkg.flatpak.repositories` /
`pkg.flatpak.install-remove`. RPM gets `pkg.dnf.repositories` /
`pkg.rpm.install-remove`, even though both RPM objective texts say "RPM". A later
author reasoning by symmetry with the Flatpak pair will guess
`pkg.rpm.repositories` and miss.
**Fix:** rename `pkg.dnf.repositories` → `pkg.rpm.repositories`. Free now
(nothing loads this file); permanent once content references it.

### F4 — two chapter-8 network-service objectives are filed under different areas
**non-blocking · defect in the work**
`content/objectives.yaml:97-99` and `176-178` (same pairing in the rhel10 file).
`Start, stop, and check the status of network services` → `systemd.services.network`;
`Configure network services to start automatically at boot` → `net.services.autostart`.
Both are Table 1 chapter 8 / `Configuring Networking`, both are about network
services, and they sit in different top-level areas. Nothing lets a later author
predict which prefix each got.
**Fix:** put both under one area — `net.services.status` +
`net.services.autostart` reads best and leaves `systemd.services.enable` (chapter
11, the generic services objective) as the sole `systemd.services.*`.

### F5 — `net.ssh.transfer` is a client objective under a server prefix
**non-blocking · defect in the work**
`content/objectives.yaml:100-102`.
`Securely transfer files between systems` is chapter 5 (`Connecting to Red Hat
Enterprise Linux`) and sits in the same Table 1 section as
`Access remote systems using SSH` → `tools.ssh.client`. The other `net.ssh.*` id,
`net.ssh.key-auth`, is chapter 20 (`Configuring SSH`) — server configuration. So
`net.ssh.*` means two different things.
**Fix:** `tools.ssh.transfer`, next to `tools.ssh.client`. Same free-now,
permanent-later argument as F3.

### F6 — `tools.editor.vim` names a tool its objective does not
**non-blocking · defect in the work**
`content/objectives.yaml:42-44`.
The objective is `Create and edit text files`; no editor is named, and the RHCSA
10 book covers nano alongside vim. Baking `vim` into a permanent scheduling key
for a tool-agnostic objective will read oddly to a later author.
**Fix (lowest priority of the id findings):** `tools.editor.text-files` or
`tools.text.edit`.

### F7 — hyphen folding beyond mandate 4, plus a trim-order nit
**non-blocking · disclosed deviation for the lead to rule on**
`test/content/objectives-real.test.ts:66-73`.
`.replace(/-/g, '')` is not one of mandate 4's three folds. I verified
adversarially that it masks nothing: with the fold removed the test reports
exactly two divergences and both are purely orthographic (`multiuser`/`multi-user`,
`nondestructively`/`non-destructively`), while every word-level change is still
caught (M1, M7). **My recommendation is to accept it** — it serves the mandate's
stated intent better than its literal text, and the alternative forks two
permanent FSRS keys over two hyphens. If the lead prefers the literal mandate,
mandate 4 says the fix goes in the YAML: two new rhel10 ids, `shared` 52→50,
still above the bound of 31.
Separately, `.trim()` runs *before* `.replace(/[.,;:!?]+$/, '')`, so a text
ending in `" ."` normalizes with a trailing space. Harmless in this data (it can
only cause a false failure, never a false pass), but **fix:** move `.trim()` to
the end of the chain.

### F8 — no test locks `chapters:`, and `text:` is only locked for shared ids
**non-blocking · defect in the brief's tests**
`test/content/objectives-real.test.ts`, whole file.
Mutation M6 silently changed a chapter number and mutation M8 silently reworded a
RHEL 9-only objective; both passed all nine tests. Fidelity to the source — the
one thing that matters for this artifact — is unenforced for anything not shared
with the rhel10 file, and unenforced entirely for chapter numbers.
**Fix (reasonable to defer to a later task):** a golden-fixture test asserting
the full `id → { text, chapters }` map for both files, so any future edit to
these YAMLs has to be deliberate and shows up as a fixture diff in review. F1's
exact-count assertion is the cheap 80% of this.

### F9 — the brief's worked example id does not match its own text
**non-blocking · defect in the brief**
`task-13-brief.md:34-36`. `id: tools.shell.essentials` is paired with
`text: Use grep and regular expressions to analyze text` and `chapters: [4]` —
that text is a `tools.text.grep`/chapter-4 objective, not a shell one. The
implementer correctly did not adopt the id, splitting it into
`tools.shell.prompt` / `tools.shell.redirection` because Table 1 has two separate
chapter-2 rows (I confirmed both). Do not charge the non-use of the example
against the implementer; fix the example in the plan.

### F10 — the brief's "both tables are images" premise is false, and its area list is not exhaustive
**non-blocking · defect in the brief**
`task-13-brief.md:3`, `20`, and the test-2 name/comment at `82-85`; mandate 1's
"Do not use `pdftotext`" at `task-13-mandates.md:33-34`.
The RHCSA 9 table is machine-readable text; only the RHCSA 10 one is an image
(the lead has independently confirmed this). The `/visual/i` assertion therefore
forces the word "visual" into a `source:` string describing a machine-readable
table, which is the pressure that produced F2. Two things worth recording in the
plan narrative: (a) the RHEL 9 table needs no visual-read budget, while the RHEL
10 one needs `pdfimages`, not page rendering, because six JPEGs are each placed
on two consecutive PDF pages and rendering clips rows at both seams; (b) the
brief's area list has no scripts area, so `tools.script.*` was minted here —
record it as part of the vocabulary so later tasks can find it.

### F11 — test 2 cannot detect an overstated `source:`
**non-blocking · defect in the brief's tests · informational**
`test/content/objectives-real.test.ts:12-15`. `toMatch(/visual/i)` passes for any
string containing "visual", including one that overstates provenance — exactly
what mandate 3 warns about, and how F2 got through. No mechanical test can fix
this; it is a review responsibility. Noting it so the plan does not mistake a
green test 2 for a provenance check.

## What I verified myself, and what I did not

**Ran or read directly:** the row-by-row RHEL 9 reconciliation (68/68, machine
diffed, positional and set-wise); the RHEL 9 section-count arithmetic from the
parsed source; the RHEL 9 chapter 7 and chapter 22 openers; the RHEL 9 table's
PDF page range; `pdfimages -list` for the RHEL 10 table (six unique objects, two
placements each, IDs as reported); all six RHEL 10 table images read whole; the
58-row RHEL 10 Table 1 → YAML diff (0 chapter disagreements, 1 disclosed text
divergence, 4 disclosed additions, no Flatpak row); an independent `WebFetch` of
Red Hat's EX200 page and a 62/62 byte-exact positional diff against the rhel10
file; the RHCSA 10 chapter 9 opener verbatim; all four stale-opener
counter-examples; the RHCSA 10 TOC (no containers chapter); `podman`/`flatpak`
occurrence counts in both books; ten mutations, each applied and reverted; the
diffstat and `git diff --name-only` for scope; `content/` directory contents; a
grep for banned TS constructs.

**Final state confirmed after all mutations were reverted:** `git status
--porcelain` empty, `npx vitest run` → **147 passed / 14 files**, `npm run
typecheck` → clean, no output. I ran both after the last revert, not before.

**Not verified:** whether the exam VM is RHEL 9 or RHEL 10 (out of scope, and the
report says the same); a visual re-read of RHEL 9 PDF pages 41–43 (I closed that
gap by external corroboration instead, as described in section 1); the RHEL 10
`Chapter Title` column beyond what I read while checking chapter numbers.

## On the report's own concerns

Concern 1 — that Red Hat now publishes the RHEL 10 set, so the plan's "RHEL 9 is
the target" premise deserves a re-decision before content authoring — is
**correct and I independently confirmed the fact behind it.** Red Hat's page has
no containers section and does have `Manage software`. The report is right that
this is a scope decision for the lead, not the implementer's, and right that
making the swap is far cheaper before content exists than after. It is the most
valuable thing this task discovered and it is not buried. Concerns 2, 3, 4, 5 and
6 are all accurate as far as I checked them; concern 3's migration-map advice is
well taken, and F3–F5 are in the same spirit — the cheapest moment to fix a
permanent id is now.
