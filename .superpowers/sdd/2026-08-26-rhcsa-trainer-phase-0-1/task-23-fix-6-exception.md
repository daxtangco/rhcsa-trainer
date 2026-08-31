# Task 23 — fix round 6: a single, narrow exception to a tripped breaker

Repo `/home/daxtangco/rhcsa-trainer`, branch `phase-0-1`, head **`4ba3b01`**.

**The fix-loop breaker tripped at round 5. I am granting exactly one exception, and this brief is
its whole scope.** You are the round-5 implementer, resumed because the edits below are two tokens you
already have the context for and because the verification, not the edit, is the work.

Read `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-rereview-5.md` first — findings
**F1** and **F2**, and §10. It is the review of your own round-5 commit and it is APPROVED; these two
findings are regressions inside that approval.

## Why this exception exists, when nothing found is reachable in the bank today

I set the override bar at "reachable in the bank as it exists today", and the reviewer correctly
reports that **nothing meets it**. I am overriding my own bar for F1 and F2 on four grounds, and I
want you to know the reasoning because it bounds what you may change:

1. **F1 and F2 are regressions this round introduced**, not inherited debt. They agree at `f65d0a4`
   and break at `4ba3b01`. A breaker exists to stop unbounded iteration on a stubborn problem, not to
   lock in a regression that a measured two-line change reverses. Letting a round counter outrank a
   measurement is the wrong way to lose.
2. **F1 is R1 re-opened through the newline** — the same defect class round 3 introduced, round 4
   fixed, and round 5 re-created at a second call site of the same helper, six lines from a docstring
   warning about exactly this. Its direction is **silent fail-open, unbounded**: the walk stays inside
   the string and discards every remaining line of the grader, so `expectedTotal` collapses toward 0,
   `incomplete` goes false, and a grader that died on its first command reports the lab **passed** to
   a student who changed nothing.
3. **"Unreachable today" is the weakest guarantee available in this project.** The bank holds five
   graders; the curriculum this app exists to cover is 28 chapters. F1's distance to reachability is
   one authoring choice — an `awk` program or message string written with `"` instead of `'`, and awk
   programs routinely contain `\"`. The three carried runs in `assert.sh` are single-quoted, so
   `carried.ansiC === false` is correct **by accident**.
4. **The fix is measured, not proposed.** The reviewer applied both edits and reported: all six
   H-family shapes closed, all six A-family shapes closed **including the pre-existing over-count A6**,
   no new disagreement across three batteries, suite 349/349 green, six invariants unmoved.

## This is one shot. The stopping rule is absolute.

If either edit moves **any** of the six invariants, or introduces **any** new disagreement in your
batteries, or turns any test red that you cannot close by promoting an obsolete divergence pin:
**revert, report, and stop.** Do not iterate toward a fix. There is no round 7, and a seventh defect
introduced while closing the sixth is the exact chain rounds 1-3 established. Reporting "reverted, and
here is why" is a success outcome for this brief.

## Mandate 1 — F1, one token. `src/server/session.ts:282`

```ts
const close = closingQuote(line, 0, carried.quote, carried.ansiC)
```

`escapes` receives `carried.ansiC`, which is `false` for a carried double-quoted run — but bash
honours `\"` inside `"…"`. The main-loop call site at `:371` already gets this right
(`ch === '"' || ansiC`). Make the carried call agree with it:

```ts
carried.quote === '"' || carried.ansiC
```

Preserve the asymmetry that is R1's fix: `'…'` processes no escapes, `"…"` does, `$'…'` does.
Verify `echo 'it\'` still agrees.

## Mandate 2 — F2, one condition, plus a false docstring that must be corrected

`src/server/session.ts:449` checks `pending.at(0)` **before** `scanLine(raw, quoted)`. Change the
guard so a carried quoted run takes precedence over a pending heredoc body:

```ts
if (open !== undefined && quoted === undefined)
```

**And correct the docstring at `:441-445`, which is false.** It currently justifies the order with:

> *"It survives a heredoc body in between, which is bash's own order: `cat <<EOF; x="a` reads the body
> first and only then keeps reading the string."*

**Bash does the opposite**, measured by the reviewer: on `cat <<EOF; x="a` / `ck inside "d" 0` / `b"` /
`EOF` / `ck real-id "d" 0` bash emits `[real-id]` and **not** `inside` — it completes the unterminated
quoted word across the newline first, then gathers the heredoc body. The docstring's own example is one
of the failing cases. **Re-measure this yourself and write what you measure.** A disclosure that
states the wrong reason is the N5/R7/N9 class, which has now bitten this task three times, and this
one is worse than those because it is the stated justification for a line of control flow.

## Mandate 3 — promote the shapes that now agree

The reviewer's H1-H5, H9 and A1-A6 are named with their scripts in §6 of the review. Add them as
`ORACLE_CASES` rows, single-path, expectation derived from the shape as all your other rows are. A6 is
the pre-existing **over-count** that F2's condition closes — pin it too, and note it was fail-closed.
Any divergence entry these two edits make obsolete gets **promoted, not renumbered**.

## Mandate 4 — three disclosures, accurate, no fixes

Do **not** fix these. Disclose each as an `ORACLE_DIVERGENCES` entry with a measured id set and
direction:

- **F3** — `echo $[1 << 2]` reads `2]` as a heredoc delimiter and swallows the rest of the file.
  Silent **fail-open**. `$[ ]` has been deprecated since bash 2 and appears nowhere in `content/`.
  **State plainly that this contradicts round 5's argument that widening the delimiter parser could
  only fail closed** — the `arith === 0` guard covers `$((` and `((`, not `$[`.
- **F4** — `subst` and `arith` are `scanLine` locals and reset per line, while `quoted` now survives
  the newline; the two pieces of lexical state have different lifetimes. **Fail-closed.**
- **F5** — a trailing `\` immediately *before* a `ck` line glues the previous word onto it
  (`echo a\` + `ck real-id` → `echo ack real-id`). **Fail-closed, pre-existing at both commits.** The
  count is right; the gap is that `continuation-between-ck-and-id`'s `why` asserts "a continuation
  before the `ck` counts correctly", which is true of the two shapes it shows and false of this one.
  Fix the prose.

## Mandate 5 — two reporting defects in your own round-5 report

- **F6:** your report names **M-O, M-P and M-Q by effect, not by edit** ("compensating pair", "also
  kills M-P"). Every other mutant you documented states its mutation. Write the actual edits down. For
  a task whose discipline is "a pin that passes with its fix reverted proves nothing", a mutant without
  its edit is the same category of unfalsifiable evidence — and the reviewer had to reconstruct M-O
  itself to audit your claim.
- **F7:** report line ~1443 says the command-prefix family is "three fail-opens, one regex change".
  Measured by the reviewer: **one regex change (one character, adding `!` to `CK_CALL`'s anchor class)
  closes one of the three**; `VAR=x ck`, `time ck` and `eval 'ck …'` need real command-prefix
  modelling. Your shipped disclosure text is accurate — the report sentence is not, and it is the
  sentence a future round would act on.

## Do not touch anything else. Explicitly out of scope by ruling:

- **N13 / `! ck`.** Yes, the reviewer measured that one character closes it with zero collateral. It
  is inherited debt rather than this round's regression, and the exception is for regressions only.
  It stays disclosed and becomes the first candidate for any future work on this function.
- **M-B** — genuinely unkillable, honestly labelled, re-verified this round (349/349 with the anchor
  removed). Do not add a pin.
- **Extracting a shared `lexBash`** — parked by ruling for the whole-branch review. The reviewer added
  a datum I accept: F1 is a *drift* defect between two call sites of one helper, which is the failure
  mode a shared lexer removes by construction, and it is the second measured instance. That argument
  belongs in the branch review, not in this commit.
- **`src/engine/disclosure/content.ts`** — the twin `scanLine` stays separate; parking premise
  re-verified.
- The property test. Endorsed as the right follow-up and **not** part of this round — see below.
- Anything under `content/`, `src/cli/`, `objectives.yaml`, `content/lib/assert.sh`,
  `src/engine/grading/grader.ts`, `package.json`.

## On the property test — do not build it here

The reviewer endorses it and so do I, with its non-optional condition: **the generator must be
validated before its silence is believed.** Its own first fuzzer run produced 78% `bash -n` failures
and a wave of false verdicts because `>/dev/null` in the pool redirected the checkpoint JSONL away —
the same "looks measured, proves nothing" failure as your spaced M-N2 pin. And decisively: **its
fuzzer did not find F1 or F2.** Those came from reading the diff and asking which argument crosses the
newline. So a property test is a complement to that reading, not a substitute, and it is not what
makes this round safe. I am carrying it forward as a recommendation with the validation condition
attached: point it at `checkpointIds`, gate it behind an env var, require each run to report its
valid-case count, and mutation-test the generator itself.

## Gates — run them, do not cite this brief

- `npm run typecheck` → exit 0.
- `npx vitest run` → green, nothing skipped. Baseline **349 passed / 29 files**. The only acceptable
  red is an obsolete divergence pin, and the resolution is promotion.
- `node src/cli/index.ts coverage` → exit 0, zero `problem:` lines, `untaught concepts: 0`.
- **The six invariants must not move**, standalone and as `assertLib + grade.sh`:
  `countCheckpoints(content/lib/assert.sh) === 0`, 019=8, 014=5, 017=5, 028=5, 006=8. If one moves,
  the stopping rule applies.
- Re-run your three batteries and report the disagreement count before and after. The reviewer's
  number to beat is **11 divergences closed, 0 new**.
- **Mutation-test the two new pins** in a `/tmp` copy with `node_modules` symlinked back: revert F1's
  token and confirm the H-family pins go red; revert F2's condition and confirm the A-family pins go
  red. State each mutant's **edit**, not its effect — that is F6's whole lesson.
- No new `as` casts, non-null `!`, `enum`, `namespace`, parameter properties or decorators.
- `git status --porcelain` empty when you finish, work committed, staged **by name** — never
  `git add -A`, never `git commit -a`. Commit with the identity inline:

```
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "..."
```

## Prohibitions

No VM operations of any kind — no `vmrun`, no `scripts/provision.sh` (it powers on a VM and copies
10 GB), no snapshots. No `sudo`: it cannot authenticate here, there is no TTY. Do not run `ssh-keygen`
or write into `/home/daxtangco/.ssh/`. Do not create, read or modify `.env.local` — git-ignored, may
hold the user's real VM password. Do not read anything under `/home/daxtangco/sechelp-tools`;
unrelated project, holds secrets. Do not dispatch subagents. Do not leave a server listening. Do not
add npm dependencies. `shellcheck` is not installed; not a finding. `npm run validate` and
`npm run test:vm` need a VM; not findings.

## Environment

The Bash tool runs **zsh**, not bash — use `bash -s <<'EOF'` deliberately when measuring bash
semantics. `ls` is aliased to eza (use `/bin/ls`); a failed glob is an error, not an empty expansion;
`grep -nE` rather than `grep -n "a\|b"`; npm scripts run under dash. Node v22.23.2, vitest 3.2.7,
TypeScript 5.8. `124` means timed out.

## Report

Append to `task-23-report.md` under `## Fix round 6 (breaker exception)`. Return only: status, the
commit sha (or "reverted"), a one-line test summary, per-mandate disposition, your before/after
battery disagreement counts, and your concerns.

Two questions:

1. **Do you disagree with either edit?** You wrote the docstring that F2 contradicts, and you reasoned
   about bash's ordering and got it backwards — so re-measure it rather than accepting the review's
   word, and if the review is wrong, refuse the mandate with the measurement. Two of your three
   refusals last round were upheld and one correction of my brief's numbers was right; that record is
   why you were resumed rather than replaced.
2. **After this, what is the highest-severity thing still wrong with this function** — one item, with
   its direction and its cost to fix?
