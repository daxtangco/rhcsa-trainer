# Task 23 — scoped re-review of the round-6 breaker exception. Nothing here can trigger a fix round.

Repo `/home/daxtangco/rhcsa-trainer`, branch `phase-0-1`, head **`28ad7f0`**, range
`4ba3b01..28ad7f0` — 1 commit, 3 files, +256/−12 (`src/server/session.ts` +29/−? ,
`test/server/checkpoint-oracle.ts` +188, `test/server/session.test.ts` +51).

Read the diff from
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/review-4ba3b01..28ad7f0.diff` rather than running
`git diff`. The implementer's account is `task-23-report.md` under `## Fix round 6 (breaker exception)`
— a claim to test. Its requirements were `task-23-fix-6-exception.md`; the findings it was closing are
F1 and F2 in `task-23-rereview-5.md`.

## What this pass is and is not

The fix-loop breaker tripped at round 5. I granted **one narrowly-scoped exception** for two
regressions round 5 introduced, and that exception is now spent. **There is no round 7 and nothing you
find will be sent back for a fix.** Your findings come to me: I rule on each one and either close it or
park it into `whole-branch-parked.md` for the whole-branch review.

So do not write a fix plan. Write the evidence I need to rule, and **rank every finding by whether it
is load-bearing** — meaning it can produce a wrong truth-claim to a student on the bank as it exists,
not on a shape someone could write. This function's history is that **five consecutive reviews each
found a real defect that the whole test suite passed over**, which is the entire reason this pass
exists. Assume there is a sixth until you have tried hard and failed.

## Already verified by me at `28ad7f0` — confirm cheaply, do not re-derive

I measured all of this myself against a clean `git archive 28ad7f0` extracted to `/tmp` with
`node_modules` symlinked back:

- `npm run typecheck` exit 0; `npx vitest run` **29 files / 351 tests, 0 failed, 0 skipped** (baseline
  349); `node src/cli/index.ts coverage` exit 0, zero `problem:` lines, `untaught concepts: 0`.
- **Six invariants unmoved**, standalone and as `assertLib + grade.sh`: `assert.sh` 0, 019=8, 014=5,
  017=5, 028=5, 006=8.
- **Ten of my own bash-differential probes agree, 0 differ**, including the three shapes that were
  silent fail-opens at `4ba3b01` (`F2-docstring-own-example`, `F1-odd-1-escaped-dquote`,
  `F1-even-2-escaped-dquote`) and seven controls: plain 2-line `"…"` and `'…'` runs, the `echo 'it\'`
  ANSI-C asymmetry that is R1's fix, a multi-line single-quoted `awk` program followed by `ck` (N8), a
  heredoc followed by `ck`, and a two-`ck` baseline.
- Both edits are present: `session.ts:292` computes `carried.quote === '"' || carried.ansiC`;
  `session.ts:465` reads `if (open !== undefined && quoted === undefined)`.
- The diff touches nothing under `content/`, `src/cli/`, `objectives.yaml`, `content/lib/assert.sh`,
  `src/engine/grading/grader.ts`, or `package.json`. Tree clean.

**A methodological warning, because it cost me two wrong conclusions.** My first probe batch ran
against the live working tree while the implementer was still editing it, so I measured its in-progress
fix while believing I was measuring `4ba3b01`, and built a whole false hypothesis (that F1 needed an odd
number of escaped double-quotes) on top of it. `git status` caught it. **Measure only against
`git archive <sha>` in `/tmp`.** Never the shared tree.

## 1. F2's unconditional precedence — the implementer's own named uncovered case. Highest-value item.

The edit makes a carried quoted run take precedence over a pending heredoc body, **unconditionally**,
and the implementer says that was decided from five shapes. It then flagged its own gap: **the inverse
nesting — a heredoc body that itself contains an unterminated quote — is uncovered**, because it says
that shape cannot arise through this code path today and could not be built as a single-path oracle
case.

**Test that claim, and test the mechanism rather than the observation.** "Cannot arise today" is the
argument that decays as the bank grows from 5 graders to a 28-chapter curriculum, so I need to know
whether it rests on a structural property of the code or on the current contents of `content/`. Build
the shape against real bash and find out what each side does. If the direction is fail-open, it
outranks everything else in this pass.

## 2. The 18 promoted rows and 2 unit tests — are any of them vacuous?

Round 6 promoted 6 H-family + 5 A-family (with A6 labelled fail-closed) + 7 controls into
`ORACLE_CASES`, and added two unit tests so each edit is caught by two independent instruments.

Verify by sabotage in a `/tmp` copy, not by inspection. The named mutants and their stated edits:

- **M-R** — revert F1's single token (`carried.quote === '"' || carried.ansiC` → `carried.ansiC`).
  Claimed killed by all six H-family rows.
- **M-S** — revert F2's condition (drop `&& quoted === undefined`). Claimed killed by all five
  A-family rows.
- **M-T** — force `escapes` to `true`. Claimed killed, which is the evidence that testing the quote
  *character* rather than passing `true` is load-bearing.

Confirm each dies, and confirm each **discriminates** — a mutant that also dies under an unrelated row
does not prove what the report says. The implementer volunteers that its **first M-R attempt altered
the `quote` argument as well and it discarded that as not a faithful revert**; confirm that story, and
confirm the shipped M-R is a faithful single-token revert. A mutant that changes two things at once is
this task's recurring "looks measured, proves nothing" failure.

Also: does any promoted row still pass with **both** edits reverted? That is the vacuity test that
matters.

## 3. A6 and the zero-checkpoint hole. Possibly the real finding of this round.

The implementer's own closing concern, which was truncated in delivery and which I am having it resend:
**A6 now agrees with bash on a script that silently grades nothing**, and it doubts anything in scope
detects a grader that emits nothing.

Establish whether `expectedTotal === 0` is distinguishable from "no checkpoints were reached". If a
grader that emits zero checkpoints produces `incomplete === false` and a **passing** verdict, that is a
false pass reachable without any lexer defect at all — the highest-severity class in this project — and
it would be an argument I have to weigh even against a spent exception. Check `harness.ts`'s
`fixture-inventory` gate and the `no-action` synthetic baseline: per task a validate run's fixture count
is `1 + solutions + antisolutions`, and the gate enters results **only when it fails**.

## 4. The three new disclosures — wording against measurement

Round 6 disclosed rather than fixed: `deprecated-arith-read-as-heredoc` (`$[1 << 2]` read as a heredoc
opener, silent fail-open, and it is required to state plainly that this **refutes** round 5's argument
that widening the delimiter parser could only fail closed); `subst-depth-resets-across-newline`
(fail-closed — `subst`/`arith` are `scanLine` locals while `quoted` now survives the newline);
`continuation-glues-word-onto-ck` (fail-closed, split into its own entry because its direction is
opposite the one that previously mis-described it).

**N5, R7 and N9 were each a finding about a false disclosure rather than a missing fix** — a comment
describing the wrong shape, which is worse than no comment because a grader author writes something
unsafe on its authority. That is now four occurrences on this task, and F2's docstring was the fifth.
Check the *wording* of every surviving disclosure against your own measurement, including the ones round
6 did not touch.

## 5. The two in-place report corrections (F6/F7) — did they actually correct?

Round 6 was told to fix two defects in its own round-5 report and chose to add block quotes at the
offending sentences so a future round reading them sees the correction.

- **F6:** M-O/M-P/M-Q had been named by *effect* ("compensating pair", "also kills M-P") rather than by
  edit. It says it **re-derived them as stated edits and re-measured rather than reconstructing from
  memory**, and that M-O's discriminating claim holds (dies under the id-set gate, survives under
  `f65d0a4`'s cardinality gate). Confirm that re-measurement independently — this is the claim that the
  oracle's gate change bought something real.
- **F7:** the sentence "three fail-opens, one regex change" overstated N13. Confirm the correction says
  what is true: one character (adding `!` to `CK_CALL`'s anchor class) closes **only `! ck`**;
  `VAR=x ck`, `time ck` and `eval 'ck …'` need real command-prefix modelling.

## 6. F1 was fixed by duplicating the expression. Say whether the latent shape survives.

The extraction of a shared `lexBash` is **parked by ruling** (P18 in `whole-branch-parked.md`), so the
implementer made the two call sites agree by duplicating the expression. Its own concern is that this
leaves the same latent drift shape that produced F1 in the first place — F1 being drift between two call
sites of one helper inside a single function, six lines from a docstring warning about exactly that.

You may argue the extraction should happen in the whole-branch review; say so once, with a reason, and
move on. **Do not report the extraction itself as a new finding** — it is parked with two measured drift
instances already recorded. What I want from you is narrower: is there now a *third* place that must
compute `escapes` the same way, and is anything else in this function duplicated-by-necessity in the
same manner?

## Gates — run them, do not cite the report

Re-run typecheck, `npx vitest run`, and `node src/cli/index.ts coverage`. Re-measure the six invariants
yourself, standalone and prepended. Confirm no new `as` casts, non-null `!`, `enum`, `namespace`,
parameter properties or decorators — grep the files, not only the diff. Confirm
`git status --porcelain` is empty before and after: **do not mutate the repo.** All mutation work goes
in a `/tmp` copy with `node_modules` symlinked back.

## Out of scope — do not report these

**N13 / the command-prefix family** (P19, disclosed, declined for the exception by ruling because it is
inherited debt rather than a round-5 regression). **The `lexBash` extraction** (P18) and
`src/engine/disclosure/content.ts`'s twin `scanLine` (measured unreachable through the sketcher, since
`commandSketch` runs over `ctx.solution`). **M-B**, genuinely unkillable and honestly labelled — fuzzed
anchored against unanchored over 419,328 generated lines with 0 differences, and the reason is proved:
the anchor only matters when the preceding character is in `[A-Za-z0-9_-]`, but `CK_CALL` requires `^`
or one of `;&|{()` there. Do not re-open it and do not add a pin.

**The property test** is endorsed with a non-optional condition and parked as P21 — the generator must
itself be mutation-tested and must assert a floor on `bash -n`-valid cases, because the round-5
reviewer's own first fuzzer run produced 78% invalid cases and false `OVER` verdicts by putting
`>/dev/null` in the pool applied to `ck` lines. And it did not find F1 or F2. Do not build it; do not
re-argue it.

Also out of scope: F7's `/api/concepts/:id` gating, F13/F14/F15, the `'0x50'`/`' 22 '` port parsing
(P15, cosmetic, deliberate), the seven pre-existing `.pathname` test files,
`src/engine/grading/grader.ts`, the N6 ruling (`/reset` refuses a finished session with 409, `/hint`
stays open — settled and verified across all three modes), and everything in
`whole-branch-parked.md` under "Residuals that are documented on purpose" and "Not findings".

## Prohibitions

No VM operations of any kind — no `vmrun`, no `scripts/provision.sh` (it powers on a VM and copies
10 GB), no snapshots. No `sudo`: it cannot authenticate here, there is no TTY. Do not run `ssh-keygen`
or write into `/home/daxtangco/.ssh/`. Do not read or create `.env.local` — git-ignored, may hold the
user's real VM password. Do not read anything under `/home/daxtangco/sechelp-tools`; unrelated project,
holds secrets. Do not dispatch subagents. Do not leave a server listening — Hono's `app.request()` is a
full round-trip through the router, so API tests need no socket. `shellcheck` is not installed; not a
finding. `npm run validate` and `npm run test:vm` cannot run without a VM; not findings either.

## Environment

The Bash tool runs **zsh**, not bash, and you will reason about bash lexing constantly — reach for
`bash -s <<'EOF'` deliberately, and beware nested heredoc delimiters (a bare `EOF` line inside a fenced
code block terminated one of my own appends early). Unquoted `$var` does not word-split;
`grep --include='*.ts'` needs quoting; plain `grep -n "a\|b"` errors under ugrep, use `grep -nE`; a
failed glob is an error, not an empty expansion. `ls` is aliased to **eza** — use `/bin/ls`. npm scripts
run under `/bin/sh` → dash. Node **v22.23.2** with native TS stripping and no build step, vitest 3.2.7,
TypeScript 5.8. `124` means timed out. `react`, `react-dom`, `@testing-library/react`, `jsdom`,
`tailwindcss` and `@xterm/xterm` are **not installed** — Task 24 owns them.

## The bar

Label every conclusion `measured` or `reasoned`. The recurring defect class in this project is **a tool
reporting success when it did not do what was asked**, and this function is where it keeps happening,
because a wrong count is silent by construction. Under-count = fail-open = a student who changed nothing
is told the lab passed. Over-count = fail-closed = a correct answer is called wrong. There is no harmless
miscount. The two most likely hiding places this round are **item 1** (F2's unconditional precedence and
its uncovered inverse nesting) and **item 3** (the zero-checkpoint hole, which needs no lexer defect at
all).

## Report

Write the full review to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-rereview-6.md`.

Return only: the verdict (**APPROVED** or **CHANGES REQUIRED**, understanding that the latter means I
adjudicate and park rather than dispatch a fix); each of the six items above with a one-line
disposition; each new finding with severity, direction, a one-line failure scenario, whether the bank
reaches it today, and whether it is load-bearing; whether the six invariants moved; whether M-R, M-S and
M-T each die and discriminate; and whether any promoted row survives reverting both edits.
