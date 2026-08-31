# Task 13 fix round 1 — report

Status: **DONE**. All eight findings closed in one commit,
`08cd2d908dafba3bd144f65ee5f3d36e4927918c` on `phase-0-1`. `npx vitest run` is
green, `npm run typecheck` clean, working tree clean with every mutation
reverted.

Both rulings noted and applied as given: the four `Manage software` objectives
stay, and the hyphen fold stays. I have removed the "disclosed deviation"
framing from my own notes accordingly — the fold is a recorded ruling now, and
the comment above `normalizeText` explains the reasoning without apologising for
it.

## Totals

| | before | after |
| --- | --- | --- |
| test files | 14 | **15** |
| tests | 147 | **150** |

The three new tests are one exact-count assertion for the rhel10 file (F1 added a
count test where that describe block had none) and two golden-fixture tests, one
per edition. `objectives-real.test.ts` goes from 9 to 10 tests; the new
`objectives-golden.test.ts` holds 2.

No pre-existing test was changed. Within my own `objectives-real.test.ts` I
changed only the rhel9 count assertion named in F1, added the rhel10 one, and
moved `.trim()` per F7.

## F3–F6 — the four permanent-id corrections

Applied in both files wherever the id appeared; seven occurrences in total. I
grepped `content/`, `test/` and `src/` first to confirm the full extent and that
no `#` comment named any of the four — none did, so no comment needed updating.

| old id | new id | files touched |
| --- | --- | --- |
| `pkg.dnf.repositories` | `pkg.rpm.repositories` | rhel10 only |
| `systemd.services.network` | `net.services.status` | both |
| `net.ssh.transfer` | `tools.ssh.transfer` | both |
| `tools.editor.vim` | `tools.editor.text-files` | both |

`pkg.rpm.install-remove` left alone as instructed. **No `text:` or `chapters:`
value was touched** — the rename was a line-anchored substitution on `  - id: …`
lines only, and the golden fixtures generated afterwards confirm every text and
chapter is byte-identical to before.

Two consequences worth confirming, since both could have broken a test silently:

- `systemd` survives as a top-level area in the rhel9 file, because
  `systemd.services.enable` (chapter 11) remains. The "covers every area" test
  still sees all 11 areas, and the `startsWith('systemd.')` assertion still
  passes. As F4 predicted, `systemd.services.*` now contains exactly one entry,
  which is the correct outcome.
- `pkg` survives as a rhel10 area via `pkg.rpm.repositories` and the other three
  `pkg.*` entries.

Counts are unchanged by the renames: still 68 / 62, and the shared-id count is
still 52 (the four renamed ids are either shared under both names or rhel10-only,
so no pairing changed).

## F2 — `content/objectives.yaml`'s `source:`

You were right, and the inversion was mine. The old string led with "read
visually with the Read tool; cross-checked against the PDF text layer", which
reverses what happened: the text layer was the transcription base and the visual
read was the check, covering four of the seven pages.

The field now reads (unchanged tail elided):

> RHCSA 9 Cert Guide 'Table 1 Coverage of RHCSA Objectives', PDF pages 39-45.
> Contrary to the plan this table is machine-readable text, not a rendered image:
> it was transcribed from the PDF text layer (pdftotext -layout, PDF pages 39-45)
> and then visually verified with the Read tool on PDF pages 39, 40, 44 and 45.
> The rows on PDF pages 41-43 rest on the text layer alone, corroborated by Red
> Hat's published page where those bullets survive into RHEL 10. Red Hat's
> published EX200 objectives page was reachable on 2026-08-30 but …

It keeps the Red-Hat-is-now-RHEL-10 note and the two imputed-chapter clauses
verbatim, states the machine-readable-not-image correction in the file itself
rather than only in a report, and names the exact pages that rest on the text
layer alone. `visually` supplies the `visual` substring, so test 2 still passes.

`objectives-rhel10.yaml`'s `source:` left untouched.

## F7 — normalizer trim order

`.trim()` moved to the end of the chain in `test/content/objectives-real.test.ts`,
after the trailing-punctuation strip. A text ending `" ."` now normalizes without
a trailing space. As you noted it could only ever have caused a false failure,
and no current text triggers it, so no assertion outcome changed.

## F1 — exact counts replace the 20–80 bound

Both describe blocks now assert an exact count: `toBe(68)` for rhel9, `toBe(62)`
for rhel10. The rhel10 block had no count assertion at all before, so this is a
new test rather than a replacement there.

The brief's 20–80 reasoning is kept as a comment, followed by the specific reason
it is insufficient — a merge takes 68 to 67 and stays inside the range — and by
the derivation of each number: `11+4+10+6+6+6+4+4+9+8 = 68` for RHCSA 9 Table 1's
rows, `11+4+4+10+6+5+6+4+4+8 = 62` for Red Hat's published bullets. The rhel10
comment records why 62 is the interesting number: it is simultaneously Red Hat's
count and this file's row count, and the two agree only if nothing was merged,
split or dropped.

## F8 — golden fixtures

New files:

- `test/fixtures/objectives-rhel9.golden.json` — 68 entries
- `test/fixtures/objectives-rhel10.golden.json` — 62 entries
- `test/content/objectives-golden.test.ts` — 2 tests

Both fixtures were **generated after the F3–F6 renames** by loading each YAML
through `loadObjectives` and serialising `id -> { text, chapters }` with
`Object.keys` sorted, so the diff is stable and no row was hand-transcribed. The
exact regeneration command is in a comment at the head of the test file, together
with an instruction never to hand-edit a fixture, since hand-editing would
reintroduce the copying risk the test exists to close.

The test aggregates rather than short-circuiting, per house style. It reports, in
one pass, each id that is in the YAML but not the fixture, each id in the fixture
but not the YAML, each text drift with both values, and each chapters drift with
both arrays. It also validates the fixture's own shape first, so a corrupt
fixture is reported as a corrupt fixture instead of surfacing as spurious drift
in every row. The final assertion is a deep equality of the whole map, as asked.

No `as` casts and no `!`. `JSON.parse`'s result is annotated `unknown` and
narrowed with two type predicates (`isRecord`, `isNumberArray`);
`noUncheckedIndexedAccess` is handled by the explicit `g === undefined` check and
by comparing `chapters` element-wise rather than indexing blind.

### The three mutations, run and reverted

Each was applied to `content/objectives.yaml`, the full suite was run, and the
file was restored from a `/tmp` backup with an `md5sum -c` check confirming the
restore. Baseline before each: 150 passed.

| mutation | result | who caught it |
| --- | --- | --- |
| **1. Changed chapter number** — `storage.lvm.resize` `chapters: [15]` → `[14]` | **1 failed / 149 passed** | golden test only |
| **2. Reworded a RHEL 9-only text** — `containers.images.inspect` → "Inspect container images and their layers" | **1 failed / 149 passed** | golden test only |
| **3. Merged a pair of bullets** — `storage.lvm.pv` + `storage.lvm.vg` collapsed into one entry, 68 → 67 | **3 failed / 147 passed** | golden test, F1's exact count, and mandate 4's shared-text test |

Mutations 1 and 2 are the important ones: in both, `objectives-real.test.ts`
passed all 10 of its tests, so the golden fixture is the only thing standing
between a silent transcription edit and a green suite. Mutation 2 slips past
mandate 4's test precisely because `containers.images.inspect` is RHEL 9-only and
so is never compared across editions — the gap you identified, reproduced and now
closed.

Mutation 3 is caught three ways because collapsing two entries changes a *shared*
id's text as well as the count. Worth noting that mandate 4's test firing here is
incidental to how I chose to merge; a merge of two RHEL 9-only bullets would have
been caught by F1's count and the golden test only.

The golden test's message is actionable. Verbatim, from mutation 3:

```
content/objectives.yaml has drifted from test/fixtures/objectives-rhel9.golden.json.
If the change was deliberate, re-verify it against the Cert Guide table and regenerate the fixture (see the header of this file). Divergences:
storage.lvm.pv: text drifted
    fixture: Create and remove physical volumes
    yaml:    Create and remove physical volumes and assign them to volume groups
storage.lvm.vg: in the fixture but not the YAML (removed, renamed or merged away)
```

Both divergences reported in one pass, both ids named.

## Verification actually run

- `npx vitest run` → **150 tests / 15 files, all passing**.
- `npm run typecheck` (`tsc --noEmit`) → clean, no output.
- `git status --porcelain` → only the six intended paths before commit; empty
  after. Every mutation reverted and verified by `md5sum -c` against a backup
  taken before the first one.
- The mutation table above records real runs, not predictions; each row is a full
  suite invocation.

## Concerns

Only one, and it is a carry-forward rather than anything in this round.

**The F3–F6 window closes with the next content task.** These renames were free
because nothing loads `objectives-rhel10.yaml` and no `content/tasks/` or
`content/concepts/` exists. The moment the first content task references an id,
all 78 become permanent. If any further id-shape review is wanted — and the four
placements I flagged as arguable in the original report are still arguable
(`users.login.switch` for an objective filed under Red Hat's "essential tools"
section, and the four `tools.script.*` ids in an area the brief's list does not
name) — it should happen before that task, not after.

Everything from the original report's concern list still stands unchanged, in
particular concern 1: Red Hat's published EX200 objectives are already the RHEL 10
set, so the choice of which file supplies the scheduling keys is still open and
still cheapest to make now.
