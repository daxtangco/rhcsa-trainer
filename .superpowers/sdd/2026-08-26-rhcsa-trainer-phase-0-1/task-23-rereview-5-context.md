# Task 23 — scoped re-review of fix round 5. The breaker has tripped: there is no round 6.

Repo `/home/daxtangco/rhcsa-trainer`, branch `phase-0-1`, head **`4ba3b01`**, range
`f65d0a4..4ba3b01` — 1 commit, 4 files, +643/−94.

Read `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/review-f65d0a4..4ba3b01.diff` rather than
running `git diff`. The implementer's account is `task-23-report.md` under `## Fix round 5` — a claim
to test. The requirements it worked from are `task-23-fix-5.md` (my brief) and
`task-23-rereview-4.md` (the round-4 review my brief ranked).

## What is different about this pass, and what I want from you

**Round 5 was the last fix round.** The fix-loop breaker has tripped, so nothing you find will be
sent back for a round 6. Your findings come to me for adjudication: I rule on each one and either
close it or park it as a disclosed open risk carried into the whole-branch review.

That changes what is useful from you. **Rank every finding by whether it is load-bearing** — meaning
it can produce a wrong truth-claim to a student on the bank as it exists, not merely on a shape
someone could write. Do not write a fix plan for a round that will not happen; write the evidence I
need to rule. If something is genuinely load-bearing and reachable, say so first and loudly, because
that is the one category that can override a tripped breaker.

## Already verified by me at `4ba3b01` — confirm cheaply and move on

Do not spend the pass re-deriving these. I ran them myself:

- typecheck exit 0; `npx vitest run` **29 files / 349 tests, 0 failed, 0 skipped** (baseline 345);
  `coverage` exit 0, zero `problem:` lines, `untaught concepts: 0`.
- **All six invariants unmoved**, standalone and as `assertLib + grade.sh`: `assert.sh` 0, 019=8,
  014=5, 017=5, 028=5, 006=8.
- Zero real `as` casts, non-null `!`, `enum`, `namespace`, parameter properties or decorators added —
  every `as` match on the diff is the English word in prose. `git status --porcelain` empty.
- Twelve of my own bash-differential probes agree at `4ba3b01`, including the two N8 shapes that were
  fail-open at `f65d0a4` (`awk … 'BEGIN {⏎…⏎}'; ck real-id "…" $?` now 1/1, and the phantom-heredoc
  swallow `msg="a⏎cat <<EOF⏎b"` now 2/2), all three widened heredoc delimiters
  (`<<EOF-1`, `<<\EOF`, `<<'END-OF-MSG'`), both natural command-substitution shapes, and the
  `'it\'` single-quote asymmetry.

So the headline work is confirmed. Spend the pass on the six things below.

## 1. The two refusals — the implementer refused two of my mandates with measurements. Rule on both.

I asked for refusals backed by measurement, so these are the intended behaviour, not defiance. But a
refusal is exactly where a wrong call hides, because it is the one place nothing else checked.

**(a) I told it to delete the oracle's direction assertion as a tautology. It refused.** My mandate
repeated round 4's review, which called
`expect(d.direction).toBe(d.counter > d.bash ? 'over' : 'under')` a check that derives the direction
from the author's own numbers and so can never fail. The implementer measured that flipping *only*
`direction` at `f65d0a4` **fails** the round-4 test, so it was not a tautology and deleting it would
have removed a live check. It re-sourced it from the measured row instead and extended it to express
`both` (equal counts, different ids).

**Test this claim directly** — check out or copy `f65d0a4` to `/tmp`, flip one divergence's
`direction` field and nothing else, and see whether the suite goes red. Then decide which framing is
right. My reading is that the pinned pair is itself asserted against a real bash run, so direction is
checked transitively and the round-4 review's "tautology" label was imprecise — but I want that
confirmed or corrected by someone who ran it. If the implementer is right, say so plainly: it means a
review I ratified would have deleted a working test.

**(b) I passed on the round-4 review's ANSI-C formula. It refused that too**, on the grounds that
`charAt(i - 1) === '$'` also fires on an **escaped** dollar — `echo \$'a\'` — creating a *new*
fail-open, and it tracked `$` state instead, with mutant M-M2 to prove the difference matters.
I have measured that `echo \$'a\'; ck real-id "d" 0` agrees at 1/1 at `4ba3b01`, so the outcome is
right. **Confirm M-M2 actually dies and that the mutant discriminates the two implementations** — a
mutant that passes under both formulas would mean the pin does not prove what the report says.

## 2. The new widening — `HEREDOC_START` became a bash-word parser. Hunt over-counts.

Mandate 6 gave the implementer the choice of widening or disclosing accurately, and it widened,
arguing that three of the six shapes were silent fail-opens discarding the rest of the grader, that
every shape is measurable against bash, and that no `<<` exists in the counted text so the invariants
provably cannot move.

Widening is the **fail-closed** direction: an over-count reports a correct solution as incomplete,
which tells a student their right answer was wrong. So attack it that way, with your own shapes, not
only the report's table. Worth trying: `<<` where it is arithmetic rather than a redirect;
`<<<` herestrings (the only one in the bank is `028/grade.sh:33`); a delimiter word carrying `$`,
`{`, `!`, backslash-escapes, or adjacent quoting (`<<E'OF'`, `<<"E"OF`); `<<EOF>/dev/null` and other
shapes where a redirect follows the delimiter on the same line; `<<-` with tab versus space
indentation; a delimiter that is a legal bash word but not a legal filename; and two openers on one
line where only one delimiter ever terminates.

The implementer flagged one of its own: **`heredocDelimiter` returns `undefined` for an unclosed quote
inside the delimiter word**, where bash keeps reading. It called this fail-closed for the body and
unreachable, and said it could not build it as a single-path oracle case. Check the direction claim —
if it is actually fail-*open* it changes rank.

## 3. The implementer's own named seventh-defect candidate. This is the highest-value item.

Its words: the carried-quote prologue line `code = carried.quote + carried.quote` **synthesises text
that was never in the script**, so a continuation line's `code` is not a substring of the input. Id
sets stay correct, so neither the oracle nor the six invariants would notice if anything downstream
ever became positional.

**Establish whether anything downstream is positional today**, and whether anything nearby is one
edit from becoming so. `countCheckpoints` returns a number, so the counter itself is safe — but check
`checkpointIds` (newly exported this round), the twin `scanLine` in `src/engine/disclosure/content.ts`
which does column-sensitive work for hints, and any caller that uses an offset, index, slice or
`indexOf` against a scanned line. If nothing is positional, this is a latent trap worth a disclosure
and no more. If anything is, it is load-bearing and I need to know now.

## 4. The oracle's gate changed — re-audit the instrument, same as last round.

Round 5 moved the gate from comparing cardinalities to comparing **id sets** on both lists, exported
`checkpointIds`, and deleted the `why.length > 80` string-length check. The report claims mutant
**M-O is killed by the new id-set gate and survives the old cardinality gate** — that is its evidence
that mandate 3 bought something real.

Verify by sabotage, not inspection: break `countCheckpoints` in a `/tmp` copy and confirm the gate
goes red; confirm M-O dies under the new gate and lives under the old; confirm the anti-vacuity
guards still fail loudly (empty `assertLib`, missing bash, an `idsFrom` that returns `[]`); confirm
every case is still single-path; confirm the helper is still not collected by vitest; and confirm it
writes nothing inside the repo.

The report also volunteers that **M-N2 initially survived because its own first heredoc pin had a
space in it**, and that it fixed this by measuring `cat <<EOF>/dev/null` against bash and adding a
discriminating case. Confirm that story — a pin with a space in the wrong place is precisely the
"looks measured, proves nothing" failure this task keeps producing.

## 5. The disclosures that survive. This class has now bitten three times.

N5, R7 and N9 were each a finding about a **false disclosure**, not a missing fix — a comment
describing the wrong shape, which is worse than no comment because a grader author writes something
unsafe on its authority. Round 5 replaced N9's false entry with what it says are four measured
residual classes plus two agreement rows.

Check the *wording* of every surviving disclosure against measurement, and specifically:

- **N13's command-prefix family stayed disclosed rather than fixed** — `! ck id`, `VAR=x ck id`,
  `time ck id`, `eval 'ck id …'`, and a `ck \` line-continuation. The implementer names this as the
  residual it would fix first, calls it three silent fail-opens and one regex change, and reports it
  unreachable in the bank. **Verify the unreachability and the "one regex change" cost**, because if
  it is truly one regex and truly fail-open, that is the strongest candidate for overriding a tripped
  breaker and I will consider it.
- **N14's brace-expansion numbers.** My brief said `echo {ck one,two}` is 2 versus bash 1. The
  implementer measured it as bash **0** / counter 1 alone, with "1 vs 2" requiring the two-line form,
  and pinned the two-line shape. I have confirmed both readings myself — my brief was wrong and its
  correction is right. Confirm the *disclosure text* now states this accurately.
- **M-B stays untouched** by ruling: the round-4 reviewer fuzzed anchored against unanchored over
  419,328 generated lines with 0 differences and proved why (the anchor only matters when the
  preceding char is in `[A-Za-z0-9_-]`, but `CK_CALL` requires `^` or one of `;&|{()` there —
  mutually exclusive). Do not re-open it. Confirm only that it is still honestly labelled as
  unkillable rather than newly pinned by a vacuous test.

## 6. Shape, and the two things already parked

`session.ts` is now ~640 lines with a hand-rolled bash lexer that has produced six defects in five
rounds and has a divergent twin in `src/engine/disclosure/content.ts`. **Two items are already parked
by ruling and are not findings:** extracting a shared `lexBash` (I ruled it out of round 5 —
a refactor in the last round before the breaker has nothing downstream to catch its regressions), and
`content.ts`'s twin `scanLine` staying separate with R1's escape bug, measured unreachable through the
sketcher because `commandSketch` runs over `ctx.solution`.

You may argue the extraction should happen in the whole-branch review; say so once, with a reason, and
move on. Do not report either as a new finding.

The implementer also recommends a **property test** over the oracle — generate lines from the
grammar, run bash, compare id sets — arguing it would have caught all six historical defects and is
test-only. Give me your view on whether that is the right instrument to carry forward, since it is the
one recommendation that would change how this code is verified from here rather than what it does.

## Gates — run them, do not cite the report

Re-run typecheck, `npx vitest run`, and `node src/cli/index.ts coverage`. Re-measure the six
invariants yourself. Confirm nothing was modified under `content/`, `src/cli/`, `objectives.yaml`,
`content/lib/assert.sh`, `src/engine/grading/grader.ts`, or `package.json`. Confirm
`git status --porcelain` is empty before and after — **do not mutate the repo**; mutation work goes in
a `/tmp` copy with `node_modules` symlinked back.

## Out of scope — do not report these

F7 (`/api/concepts/:id` ungated, by ruling), F13/F14/F15, the `'0x50'`/`' 22 '` port parsing (P15,
cosmetic, deliberate), the seven pre-existing `.pathname` test files,
`src/engine/grading/grader.ts`, and everything in `whole-branch-parked.md` under "Residuals that are
documented on purpose" and "Not findings" — including the unquoted-delimiter redactor case, the
`for u in` / `case` label sketch noise, the `sh -c` wrapped-command sketch, and the `vmrun.ts:108`
argv exposure.

**The N6 ruling is settled and verified across all three modes:** `/reset` refuses a finished session
with 409, `/hint` stays open. Do not re-open it.

## Prohibitions

No VM operations of any kind — no `vmrun`, no `scripts/provision.sh` (it powers on a VM and copies
10 GB), no snapshots. No `sudo`: it cannot authenticate here, there is no TTY. Do not run `ssh-keygen`
or write into `/home/daxtangco/.ssh/`. Do not read or create `.env.local` — git-ignored, may hold the
user's real VM password. Do not read anything under `/home/daxtangco/sechelp-tools`; unrelated
project, holds secrets. Do not dispatch subagents. Do not leave a server listening — Hono's
`app.request()` is a full round-trip through the router, so API tests need no socket. `shellcheck` is
not installed; not a finding. `npm run validate` and `npm run test:vm` cannot run without a VM; not a
finding either.

## Environment

The Bash tool runs **zsh**, not bash, and you will reason about bash lexing constantly — reach for
`bash -s <<'EOF'` deliberately. Unquoted `$var` does not word-split; `grep --include='*.ts'` needs
quoting; plain `grep -n "a\|b"` errors under ugrep, use `grep -nE`; a failed glob is an error, not an
empty expansion. `ls` is aliased to **eza** — use `/bin/ls`. npm scripts run under `/bin/sh` → dash.
Node **v22.23.2** with native TS stripping and no build step, vitest 3.2.7, TypeScript 5.8. `124`
means timed out. `react`, `react-dom`, `@testing-library/react`, `jsdom`, `tailwindcss` and
`@xterm/xterm` are **not installed** — Task 24 owns them.

## The bar

Label every conclusion `measured` or `reasoned`. The recurring defect class in this project is **a
tool reporting success when it did not do what was asked**, and this function is where it keeps
happening, because a wrong count is silent by construction. **Four consecutive reviews of it have each
found a real defect that every test passed over.** Assume there is a fifth until you have tried hard
to find it and failed. The two most likely hiding places this round are the widened heredoc parser
(the only place a number could newly go up) and the synthesised prologue line in item 3.

## Report

Write the full review to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-rereview-5.md`.

Return only: the verdict (**APPROVED** or **CHANGES REQUIRED**); a table of the seven round-5
mandates each ADDRESSED / PARTIAL / NOT ADDRESSED; your ruling on each of the two refusals in item 1;
your verdict on the oracle's validity after its gate changed; whether anything downstream of the
synthesised prologue is positional; each new finding with severity, direction (fail-open = false pass,
fail-closed = false fail), a one-line failure scenario, whether the bank reaches it today, and
**whether it is load-bearing enough to override a tripped breaker**; whether the six invariants moved;
and your view on the property-test recommendation.
