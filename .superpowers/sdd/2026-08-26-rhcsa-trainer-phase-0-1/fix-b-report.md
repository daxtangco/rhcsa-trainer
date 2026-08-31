# Fix dispatch B report — the wrong-sentence sweep, plus three small real defects

**Status: COMPLETE.** All nine findings (F5, F7, F8, F9, F10, F11, F12, F13) and the
five-item doc-correction batch (P20, P22, P25, P26, P27) landed. All four gates pass.

**Commit:** `6e99c3e` — `fix: the wrong-sentence sweep, plus three small real defects`
(single commit, 14 files, staged by name).

## Baseline confirmation

Ran a clean `npx vitest run` before touching anything: **35 files / 455 tests / 0
skipped**, all passing. This matches the corrected baseline in the dispatch message
exactly (dispatch A's report never existed; the message said to trust 455/35/0 over
any report). It reproduced.

## F5 — `SHELL_OPTION_LINE` (`src/cli/lint.ts`)

Regex was start-anchored only (`/^set\s+[-+]/`), so `.test()` matched on the `set -`
prefix alone and `changesNothing` discarded the **whole line** — including a real
command joined on with `;` — as a no-op. Fixed to `/^set\s+[-+][^;]*$/` (anchored the
match to end-of-line, excluded `;`), per the brief's suggested regex option. Fixed the
adjacent comment, which asserted "the whole line is what matches" — true now, false
before the fix (the defect was exactly that the prefix alone matched while the rule
was authored believing the whole line had to). Added a test planting a
`set -euo pipefail; sudo lvextend …` anti-solution and asserting it is not flagged.
The existing "shipped bank" test (`lint(CONTENT)` asserting `r.err === ''`) already
covers all sixteen real anti-solutions, so a regression there would have failed it —
it did not.

**Assertion that trips:** the new test (`does not flag a set-options line joined to a
real command by a semicolon`) plus the untouched shipped-bank test, both now green,
where the shipped-bank test would have gone red first if the fix had over-widened.

## F7 — invariant (e), the four UI strings

Fixed all four: `Rail.tsx:259` ("This attempt is finished and its rating is
recorded"), `App.tsx` "Scheduler rating:", "was recorded against", and "Guided mode
records no scheduler rating." None claim persistence now.

The important part is the third state your note added. `reportSuspect` (`session.ts`)
means `rating === null` off the wire is ambiguous between guided mode and an
untrustworthy report — I read `app.ts:352-353` and confirmed both directions collapse
to the same `null`. **No new API field was needed or added.** The client already has
everything required to tell the two apart: `session.mode` (from `view(s)`) and
`report.incomplete` / `report.countDisputed` / `report.total > report.expectedTotal`
(the exact three disjuncts of `reportSuspect`, already on `GradeReportView`). I added
a `reportUntrustworthy` boolean in `App.tsx` computed from those fields — the same
computation `Rail.tsx`'s own `countSuspect`/`verdictFor` already do independently —
and used it to add the third branch: "No rating: this run's checkpoint count could not
be trusted." Rail's `finished` sentence was made generic enough to be true regardless
of which state applies, since `Rail` never receives `rating` and I did not thread it
through (smallest change that stops the false claim).

Updated `test/web/app.test.tsx`'s two assertions that named the old strings, and added
a new test for the third state (practice mode, `report.incomplete: true`, asserting
the "checkpoint count could not be trusted" text and that neither the guided nor the
rating-shown text appears).

## F8 — `scripts/r1-probe.sh`

Split the old `*)` catch-all. `dropped` (a real drop, distinct from `refused`) now gets
its own arm carrying the same remediation list the catch-all used to print — that
case genuinely is "R1 CONFIRMED AS A PROBLEM." `unknown` and `""` share a new arm that
says the probe did not determine an outcome, explicitly not a network verdict. `*)`
is now a defensive true catch-all ("BUG: … no case arm above names") rather than the
thing two-thirds of it was actually reporting. No VM operations; verified with
`bash -n` only.

## F9 — concept objective ids (`src/engine/content/bank.ts`)

`checkCoverage`'s concept loop read only `prerequisites`; added a loop over
`concept.objectives` validated against `bank.objectives.byId`, mirroring the task
loop's pattern but — per the brief's warning about what it must *not* claim — never
adding to `coveredObjectives` (coverage is a property of exam-objective tasks, spec
6.4; a card teaches toward one, it does not cover it). Two new tests in
`test/content/bank.test.ts`: a typo'd concept objective id is a hard problem, and
pointing a card at the one currently-uncovered objective does not remove it from
`uncoveredObjectives`.

Renamed `test/content/concept.test.ts:42`'s test name. **Its stated reason evaporates,
its assertion does not.** The old name — "a card with no objectives is unreachable
from the disclosure ladder" — is false: `concept.objectives` has no consumer anywhere
in `src/`; reachability runs through `task.requiresConcepts`. What the test actually
protects is a real, separate rule: `parseConcept` requires the field to be non-empty
at authoring time so a card always declares what it teaches toward (which
`checkCoverage`'s new loop above can validate). Renamed to state that; did not delete
the test, since it still guards something real.

**Assertion that trips:** `test/content/bank.test.ts`'s new
`treats a typo'd objective id on a concept card as a hard problem`.

## F10 — `lint.ts:519-520` (now `549-552` after F5's edit shifted lines)

One-clause tense fix: "The rules ran unconditionally above and nothing here can
suppress them" → "The rules above are not gated on this condition, and nothing here
can suppress them." Comment-only; the surrounding paragraph (already accurate) is
untouched.

## F11 — `test/server/checkpoint-oracle.ts:530-532`

Replaced the final clause. Old: "a grader that died on its first command reports the
lab passed" — false; `allPassed`'s `length > 0` guard catches zero arrivals. New:
states that a grader dying before its first `ck` is still caught, and it is the
**second** command (having passed the first) that produces the false pass. Three-line
edit, no test changes needed (this is a comment inside a fixture-defining file, not
an assertion).

## F12 — `content/tasks/storage/014-grow-home-lv/antisolutions/03-wrong-lv.sh`

Corrected the header. It claimed the exit-code check (harness.ts, mandate 2) makes
this fixture "safe" against silently probing nothing; that is only true for `lvextend`
erroring outright. It does not, and cannot, prove `lvextend` grew anything — a run
that exits 0 having grown nothing, or a vacuous success, is unguarded by that check
and the header no longer claims otherwise. **Did not add the paired static rule**
("this anti-solution declares exactly the grade script's `baseline-fail:` set"), per
the explicit instruction — it would be a false fail on this same shipped, deliberate
fixture. No VM operations; the fixture's actual command is unchanged.

## F13 — rejecting transport, previously untested

Two tests in `test/grading/grader.test.ts`, using real `FakeTransport` with a
rejecting/throwing handler for the first time in the suite:

1. First `exec` rejects → `grade()` rejects with the transport's message
   (`no guest IP could be determined`), unswallowed — `grade()` wraps only
   `reboot()`, not either `exec` call, confirmed by reading `grader.ts:82-117`.
2. Second `exec` (post-reboot) rejects after a successful reboot → `grade()`
   rejects, discarding verdict A entirely. This documents the residual your brief
   named (**not fixed, per instruction**): verdict A ("it works now") is thrown away
   because verdict B ("survives a reboot") never arrived. No redesign attempted.

One more test in `test/server/app.test.ts`: a rejecting `gradeTask` at the HTTP layer
returns 500 with the transport's message via `/grade`'s existing catch, and does not
call `sessions.record` (checked via `sessions.get(id)?.result` staying `undefined`),
so a later request cannot see a stale result. This exercises the same catch the F13
finding names (`app.ts:300-306`) at the layer the app's own tests already mock
`LabRuntime` at, rather than duplicating grader-level coverage.

**Assertion that trips:** all three are new; each fails if the corresponding
try/catch is removed (verified by reading, not by mutating — mutation would have
cost more time than the finding's size justifies, and the brief did not ask for it).

## P20 / P22 / P25 / P26 / P27 — doc batch

- **P20/P25 (arith/subst newline reset):** `scanLine`'s docstring claimed
  `subst-depth-resets-across-newline` "pins what that costs" for the whole seam. It
  pinned one third — the `subst` half, which fails **closed** (a phantom id gained,
  real id kept). The `arith` half was entirely unpinned and fails **open** (the real
  id lost). Measured directly:
  `x=$((` / `1 << 2 ))` / `ck real-id "d" 0` → bash `["real-id"]`, counter `[]`.
  Added a new `ORACLE_DIVERGENCES` entry, `arith-depth-resets-across-newline`,
  alongside a scoping comment on the existing `subst` entry so neither is read as
  covering the other, and corrected `scanLine`'s docstring to name both and state
  the opposite directions.
- **P26 (arithmetic-context class, not deprecated-only):** measured all three named
  examples directly (array subscript read, subscripted assignment target, substring
  offset) — each gives bash `["real-id"]`, counter `[]`, matching the parked claim.
  Corrected the `deprecated-arith-read-as-heredoc` entry's `why` text and added a
  scoping comment; did **not** add three new pinned entries for those shapes (that
  would be new test coverage decisions, not a wording correction, and the brief
  frames P26 as a wording fix). I also did not repeat the parked note's "five current
  contexts" count — I measured three, plus the deprecated one is four; I could not
  independently verify a fifth, so I did not assert it.
- **P27 (third `closingQuote` site):** confirmed by reading — `heredocDelimiter`
  (`session.ts:200`, now shifted a few lines by other edits) computes `escapes` as
  `ch === '"'` alone, with no ANSI-C case, unlike the two sites in `scanLine`'s main
  loop and carried-run prologue, which both track `dollar`. Measured:
  `cat <<$'EOF'` / `ck phantom "d" 0` / `EOF` / `ck real-id "d" 0` → bash
  `["real-id"]`, counter `[]` — silent fail-open, matching the parked claim exactly.
  This finding had **no prior disclosure anywhere** (grepped the whole repo for "P27"
  and for the shape — zero hits), so there was no existing sentence to correct. I
  treated the false-by-omission claim ("residual classes are pinned in
  `ORACLE_DIVERGENCES`") as the thing to fix, and added a new pinned divergence entry
  (`heredoc-delimiter-ansi-c-quoted`) plus a residual note on `heredocDelimiter`'s own
  docstring, matching the existing pattern for the other two pinned lexer residuals.
  **Did not touch `heredocDelimiter`'s production code** — the real fix is giving it
  the same `dollar` tracking `scanLine` has, which is exactly the P18/`lexBash`
  territory the brief rules out of this dispatch.
- **P22:** re-verified the file list per your correction. The one **tracked-source**
  copy of the wrong mechanism is the `28ad7f0` oracle comment
  (`test/server/checkpoint-oracle.ts:530-532`), fixed under F11 above. I checked the
  other locus your note named — **`task-23-report.md` does not contain the sentence
  at all** (grepped for it and for looser variants; zero hits in that file). The
  actual occurrences outside `checkpoint-oracle.ts` are in `progress.md:6323,6503-6504`,
  `task-23-fix-6-exception.md:26-27`, and `task-23-rereview-5.md:311-312` — the three
  files your note itself rules as git-ignored scratch that "need no edit." So P22 is
  fully closed by F11; nothing further to change. `src/server/session.ts:286-292` and
  the `28ad7f0` commit message were confirmed accurate and left untouched, as
  instructed.

## Gates (all run at the final commit)

| gate | result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx vitest run` | **35 files / 462 tests / 0 skipped**, all passing |
| `npm run build:web` | exit 0 (pre-existing >500kB chunk-size warning, unrelated) |
| `npm run lint:content` | exit 0, "no problems in 5 grader(s)", 3 notes (unchanged from baseline) |

462 = 455 baseline + 7 new tests (F5: 1, F9: 2, F7: 1, F13: 3).

## Concerns / things worth a second look

1. **The brief's own line numbers for F10 and P27 had already drifted** by the time I
   read the file (other edits in this same dispatch shifted them further) — I found
   both by the quoted text, per the brief's own instruction, and both matched.
2. **P22's pointer to `task-23-report.md`** does not hold up — see above. This is the
   kind of citation slip the brief asked me to watch for; I'm flagging it rather than
   silently "fixing" a claim that turned out to need no fix.
3. **F13's app.ts-layer test is at the mocked-`LabRuntime` boundary, not a real
   `FakeTransport` through the full server stack.** `app.test.ts` already mocks
   `LabRuntime` entirely (no route in that file goes through a real `FakeTransport`),
   so matching that file's existing convention was the smallest correct addition. The
   engine-layer tests in `grader.test.ts` are the ones actually exercising
   `FakeTransport` rejecting.
4. **I did not attempt to independently discover or pin the "two further shapes" P27's
   parked note says fail closed** for the ANSI-C heredoc-delimiter defect — I could
   not verify them within this dispatch's scope and did not want to assert an
   unmeasured claim. Only the one fail-open shape I measured is pinned.
5. Nothing in this dispatch touched dispatch A's scope (grading path, `expectedTotal`,
   `deriveRating`, membership lists) or any of the explicitly out-of-scope items
   (P18, P35 shape B, the static baseline-fail-set rule, P33, P34, P21). No VM
   operations were run; no `.env*` file was read or written; no tag was created.
