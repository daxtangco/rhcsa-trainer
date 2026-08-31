# Fix dispatch B — the wrong-sentence sweep, plus three small real defects

Nine findings from the whole-branch review. They are batched because they are the same *kind* of work —
mostly correcting sentences that are measurably false, plus three small code fixes — and because none of
them needs design judgment. Transcribe carefully; do not redesign.

**Dispatch A landed before you** and touched the grading path: `expectedTotal`'s second witness,
`deriveRating`, note-only checkpoint ids, `checkCoverage` on the serving path, and the membership lists in
`src/engine/content/task.ts` and `src/engine/grading/verdict.ts`. **Read every file at current HEAD rather
than at any sha quoted below**, because line numbers in this brief were measured at `4312359` and A moved
some of them. Where a line number does not match what you find, trust the quoted *text* and search for it.

## Read these first

1. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/whole-branch-review.md` — **sections 3(d), 3(e), 4,
   5 and 6**, and finding rows 5, 7, 8, 9, 10, 11, 12 and 13 of the section 8 table. That report is your
   requirements.
2. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/whole-branch-parked.md` — the entries for **P5, P8,
   P20, P22, P25, P26, P27, P28, P30, P38, P39**. Several carry replacement text written out verbatim; use
   it. **Where the parked note and the review disagree, the review wins** — it re-measured, and P22's note
   in particular is wrong (see below).

## The three real code fixes

### F5 — P39: `SHELL_OPTION_LINE` rejects a valid anti-solution. Do this one first.

`src/cli/lint.ts:211` (measured at `4312359`): `const SHELL_OPTION_LINE = /^set\s+[-+]/`, applied by
`changesNothing` at `:225`. Start-anchored only, so the whole line is discarded once the prefix matches.
`MEASURED` — an anti-solution whose body is

```bash
#!/usr/bin/env bash
# expect-fail: fs-home-size
set -euo pipefail; sudo lvextend -L 12G /dev/rhel/home
```

is rejected as `nothing here but comments and shell options`, exit 1. **A fixture that does real work,
rejected, with the rule named in the message — telling its author the exact opposite of the truth.** This is
the only finding on the branch whose direction is the loud kind.

Fix: `/^set\s+[-+][^;]*$/`, or split each line on `;` before testing. Either is fine; pick one and say why.

**The constant's own comment at `:209` must change in the same edit.** It says the trailing `pipefail` needs
no clause of its own "because the whole line is what matches." Under the reading "the whole line must match"
that is false, and it is what let the defect through authoring. State what is actually true: the whole line
is *discarded* once the prefix matches.

Add a test with the one-liner body above, asserting it is **not** reported. And confirm the rule still fires
on none of the sixteen committed anti-solutions — that property was established in Task 25 and your change
must not break it in the other direction.

### F8 — P8/P30: `r1-probe.sh` prints "R1 CONFIRMED AS A PROBLEM" for outcomes that are not problems

`scripts/r1-probe.sh`. `MEASURED`: `tcp_outcome` can hold `open`, `unreachable`, `dropped`, `refused`,
`unknown` or the empty string. The `case` at `:236` has arms for only three of them, so **`dropped`,
`unknown` and `""` all fall through to `*)` at `:257`, which prints "R1 CONFIRMED AS A PROBLEM."**

Why this matters more than its size suggests: risk R1 (WSL2 → VMnet8 reachability) is still unverified, so
this script is plausibly **the first output the user ever sees from this project**, and for two of those
three classifications it is a false fail against their own network.

Add arms that say something true for each: `dropped` is a real signal but distinct from refused; `unknown`
and `""` mean **the probe did not determine an answer**, which is not the same as R1 being confirmed. Keep
`*)` as a genuine catch-all, and make its message say that an unrecognised outcome is a bug in the probe
rather than a verdict about the network.

This is a bash script under a shell that is not necessarily bash — check the shebang and match the style
already there. Do not run it against a VM; **no VM operations of any kind.**

### F9 — P5: a typo'd concept objective id passes every gate

`MEASURED`: a typo'd *concept* objective id gives `lint:content` exit 0, `coverage` exit 0, suite 433/433.
(A typo'd *task* objective id is caught by `npm run coverage` but not by `lint:content`. Dispatch A owns the
gate-disjointness half of that; you own validating concept objective ids.)

Objective ids are permanent scheduling keys, so a typo is silent content rot.

Validate concept objective ids against `objectives.yaml` the way task objective ids are validated, and add a
test that fails on a typo.

**And fix the false sentence that travels with this finding.** `test/content/concept.test.ts:42` is named
*"a card with no objectives is unreachable from the disclosure ladder."* That is **measurably false**:
`concept.objectives` has **no consumer anywhere in `src/`** — card reachability runs through
`task.requiresConcepts`. A test name is a disclosure; it is the sentence the next author trusts about what
the test protects. Rename it to say what the test actually asserts, and if the test's own reason for
existing evaporates once the name is honest, say so in your report rather than deleting it. **P5 is real and
unguarded; its stated reason is not its reason** — do not carry the false reason into your commit message.

## The wrong sentences

Every item here is a sentence that claims something false. Fix the claim, do not delete the sentence unless
the parked note says to — a reader who remembers the wrong version needs to find the correction where the
wrong version was.

### F7 — invariant (e): four UI strings claim a rating is recorded when nothing records it

Nothing persists a rating: no scheduler in `src/`, zero disk writes from `src/server/`, sessions are an
in-memory `Map`. `docs/exit-criterion.md:226-229` says this correctly. The UI does not. **This is the only
wrong claim in the entire review that the *user* reads rather than the next author**, which is why it ranks
where it does despite being copy.

Four strings, two files:

1. `src/web/components/Rail.tsx:240` — "This attempt is finished and its rating is recorded."
2. `src/web/screens/App.tsx:279` — "Scheduler rating:"
3. `src/web/screens/App.tsx:291` — "was recorded against"
4. `src/web/screens/App.tsx:284` — **"Guided mode records no scheduler rating."**

**All four are in.** Number 4 was missing from the earlier list and is the subtle one: it is wrong *by
implication* rather than by assertion — it tells the student that other modes **do** record. Repairing three
and leaving it leaves the false belief fully intact. Number 3 is in because "was recorded **against**" names
a thing the rating was recorded against, inviting the student to believe a per-objective history exists; it
is the most likely of the four to be believed.

**Fix the copy; do not build persistence.** The strings should describe what actually happens: a rating
computed and shown for this attempt, in this session, not stored. If dispatch A introduced a withheld-rating
state, your copy must be true in that state too — check what A did before writing the words.

Do not soften into vagueness. "Rating (not saved)" is honest; "your progress is being tracked" is a new
false claim.

### F10 — P38: a comment asserts the rules ran on the one path where they did not

`src/cli/lint.ts:519-520` (at `4312359`): *"The rules ran unconditionally above and nothing here can
suppress them."* `checkFixtureFloors` is called at `:575`, **outside** the `try`/`catch` and gated on
`bank !== undefined`; inside the `catch`, `bank` is `undefined`. So on the only path that reaches this
sentence, the rules did not run and will not run.

The distinction the sentence draws is the one a reader needs — **do not delete it**, only its tense is
wrong. Something like: *"The rules above are not gated on this condition, and nothing here can suppress
them."* The residual paragraph below it is accurate and thorough; leave it alone.

### F11 — P28: the false comment at `test/server/checkpoint-oracle.ts:530-532`

Replacement text is written out verbatim in the parked file. Three-line mechanical edit.

### F12 — `03-wrong-lv.sh`'s header overstates its own protection

`content/tasks/storage/014-grow-home-lv/antisolutions/03-wrong-lv.sh`. Its author reached the no-op fixture
defect class independently, wrote the failure sentence almost verbatim, then concluded the exit-code check
closes it. It does not: the exit-code check catches a fixture that *errors*, not one that exits 0 having
done nothing, and not one whose command succeeds vacuously.

**Correct the header sentence. Do NOT add the related static rule** — "this anti-solution declares exactly
the grade script's `# baseline-fail:` set" fires on this same deliberate, defended fixture, so as an error
it is a **false fail on the shipped bank**. `rhcsa lint` has no warning tier and inventing one is a design
decision, not a fix. That rule is scheduled for Phase 2 paired with P35 shape B.

### The remaining doc-only corrections: P20, P22, P25, P26, P27

Loci and replacement text are in the parked file. Two things to get right:

- **P22 needs more than a mechanism swap.** Its file-list correction stands — `src/server/session.ts:286-292`
  and the `28ad7f0` commit message are **accurate and must not be "fixed."** But P22's own substantive claim
  is wrong: it says a partial deflation is unreachable "only because every heredoc fail-open zeroes the count
  rather than deflating it." **That is false**, `MEASURED` — a single injected `cat <<NOPE` swept across every
  insertion point in `019-httpd-alt-port/grade.sh` yields counts of 0 through 8 depending on position, and
  zeroing holds only when the swallowing line precedes the first `ck_*`. Dispatch A fixed the code; your job
  is to make P22's text stop asserting the false mechanism, and to say which direction it was wrong in — it
  **under-estimated the fail-open's reach**, three times, always in the same direction.
- **P20, P25, P26, P27 have measured wrong *directions*, and direction is the whole point.** P25: `arith`
  resets across the newline, and it is a silent **fail-open**, not fail-closed as both the note and the
  original disclosure said. P26: the arithmetic-context class is **current** syntax, not deprecated-only —
  five current contexts fail the same way. P27: a third `closingQuote` call site, already wrong. Verify each
  replacement sentence states the direction correctly before you commit it; these are the exact class you are
  here to fix, and getting a direction backwards in the correction is worse than leaving the original.

## One test to add

### F13 — no test anywhere exercises a rejecting transport

`MEASURED`: 43 `FakeTransport` references, **zero** with a rejecting or throwing handler. So the one failure
mode the real transports have that is not an exit code is never exercised in 433 tests.

The good news, and the reason this is a test and not a redesign: the path is **already correct**. A rejecting
`exec` throws out of `grade()`, `/grade` catches at `src/server/app.ts:276-281` and returns HTTP 500 with the
transport's message, and `App.tsx`'s `doGrade` catch deliberately clears the stale report with a comment
naming the false-pass screen it prevents. P31's predicted direction does **not** materialise.

Add a test that makes a `FakeTransport` handler reject and asserts the 500 path and the cleared report.

**Do not redesign the verdict-A-discard residual.** When the second `exec` rejects, verdict A ("it works
now") is thrown away because verdict B ("survives a reboot") failed to arrive. That is a real residual and it
is being left deliberately. Note it in your report; do not fix it.

## Explicitly out of scope

Do not touch these even if you see them. Each is ruled out for a stated reason and doing it here costs a
review round:

- **P18** (extract a shared `lexBash`) — the first item of the *next* round, alone.
- **P35 shape B** (baseline comparison in `harness.ts`) — Phase 2, bound to the first real `validate` run.
- **The static "declares exactly the baseline-fail set" rule** — false fail on the shipped bank, see F12.
- **P33** (deleting a whole task directory leaves lint at exit 0) — needs a manifest or a floor; a design
  decision, parked.
- **P34** (`coverage --strict` red with 58 uncovered objectives) — a Phase 2 content-plan threshold, not a
  defect.
- **P21** (property test over the oracle) — endorsed but not here; its generator must itself be validated or
  the test proves the oracle agrees with a generator nobody checked, and that is design work.
- **Anything in dispatch A's scope.** If a grading-path change looks necessary, report it; do not make it.
- **Do not create the `phase-1` tag.** It is deliberately the user's.

## Gates

All four, before you report: `npm run typecheck`, `npx vitest run`, `npm run build:web`,
`npm run lint:content`. Baseline was 433 tests / 35 files / 0 skipped before dispatch A; A adds tests, so
**read the current count from A's report or from a clean run rather than assuming**. Report your numbers and
confirm the skip count is 0 — a skipped test is not a passing test.

## Constraints

- Node >= 22.23.2, native TS execution, no build step. Erasable syntax only: never `enum`, `namespace`,
  parameter properties, or decorators. Relative imports carry the `.ts` extension. ESM only. No non-null `!`.
- **`sudo` cannot authenticate here — there is no TTY.** Never a step needing root on this host.
- **No VM operations of any kind** — no `vmrun`, no start/stop/snapshot, and do not run `scripts/provision.sh`
  (it powers on a VM and copies 10 GB). Do not leave a server listening.
- **Do not read or write any `.env*` file**, including `.env.local`, which holds a real password.
- `shellcheck` is not installed. Do not report its absence.
- Commit with the identity inline and **stage by name** — never `git add -A`, never `git commit -a`:
  `GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost git commit -m "..."`
- Do not tag, push, or merge.
- Shell notes: the shell is **zsh** — a failed glob is an error, not an empty expansion (use `find`); `grep`
  is ugrep so use `grep -nE "a|b"`; `ls` is eza (use `/bin/ls`); npm scripts run under dash. **`$?` after a
  pipeline is the last command's status** — the reviewer got a wrong answer from exactly that.
- **Never dispatch subagents.** Review arrives from the controller after your report.

## Report

Write the full report to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/fix-b-report.md`.

Return **only**: status; the commit shas; one line per item (F5, F7, F8, F9, F10, F11, F12, F13, and the
P20/P22/P25/P26/P27 doc batch) saying what you changed and — for the three code fixes — which assertion
trips; the four gate results with test and skip counts; and any concern, especially **anything in this brief
you believe is wrong**. Two claims in an earlier brief on this branch were confident, specific and
measurably false, and one of them was in the sentence that dispatched work. You will not be penalised for
contradicting me with a measurement.
