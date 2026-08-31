# Task 23 — fix round 5 (FINAL ROUND: the breaker trips here)

Repo `/home/daxtangco/rhcsa-trainer`, branch `phase-0-1`, head **`f65d0a4`**.

**Read `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-rereview-4.md` first.** It is the
round-4 re-review and it is the requirements document for this round. This brief ranks its
recommendations, reverses one of my own earlier rulings, and tells you what not to touch.

**This is the last fix round on this task.** There is no round 6. Anything not closed here gets
adjudicated by me and either ruled on or parked as a disclosed risk. That changes your job in one
specific way: **a fix you are not confident in is worse than a disclosure you are confident in**,
because nothing downstream will catch a regression you introduce. Where you are unsure, land the
disclosure and say so.

## Context you need

`countCheckpoints` in `src/server/session.ts` decides how many checkpoints a grader *should* emit.
The harness compares that to how many actually arrived; a short count makes `incomplete` false, so a
grader that died partway looks complete and **a student who changed nothing is told the lab passed.**
Under-count = fail-open = false pass. Over-count = fail-closed = false fail. There is no harmless
miscount.

This function has now produced **six** defects across four rounds, and rounds 1-3 each introduced the
next one. Round 4 broke that chain by measuring against real `bash` instead of reasoning about a
regex, and the differential oracle it built is the reason round 5 is small and specific instead of
another guess. **The oracle is the most valuable thing on this branch — do not weaken it.**

## Ruling reversed: round 4's decision to leave multi-line quote state alone was wrong

Round 4 deliberately did not carry quote state across newlines. I ratified that, on the argument that
doing so would trade a loud over-count for a silent swallow-the-rest-of-the-file mode. **That cost
argument was inverted and I got it wrong.** Measured by the reviewer and independently by me at
`f65d0a4`:

```
awk-then-ck-same-line      bash=1 counter=0     <- assert.sh's own two idioms, composed
single-quoted-2line        bash=1 counter=0
double-quoted-2line        bash=1 counter=0
heredoc-inside-quoted-run  bash=2 counter=0     <- the swallow mode, already reachable
```

The natural arrangement is **under**-counting and **silent**, not over-counting and loud. The
swallow-the-rest-of-the-file mode the ruling feared is not a risk the fix introduces — it is a
behaviour the current code already has, via a `<<` on a middle line queueing a phantom heredoc.
And the shape is in the counted text today: `content/lib/assert.sh` has three multi-line
single-quoted `awk` programs (`:103-107`, `:150-153`, `:164-170`), and `harness.ts:65` prepends
`assert.sh` to every grader **before** counting. No checkpoint is lost today only because those three
closing lines happen not to carry a trailing `ck` — a line-break coincidence that nothing pins, while
`assert.sh:60` documents `some_condition; ck my-id "what was checked" $?` as *the* usage.

So: **do not reproduce round 4's reasoning here.** Carrying the quote state is now mandatory.

## Mandates, in the order the reviewer ranked them

### 1. Correct the `quoted-run-spanning-lines` disclosure (N9). Non-negotiable, docs-only.

The existing `ORACLE_DIVERGENCES` entry is false in three ways: it says the direction is `over`/loud
(the natural arrangement is `under`/silent), it says double-quoted (single-quoted behaves identically
and single is what the bank actually contains), and it says no grader has a multi-line string
(`assert.sh` has three, and it is prepended to all five). Its cost argument is the inverted one above.

This is the **N5/R7 class** — a disclosure that describes the wrong shape. That is worse than no
disclosure, because a grader author reads it and writes something unsafe on its authority. Two
earlier findings on this task were exactly this, so it is the third time. Fix the wording even if you
somehow cannot land mandate 2.

### 2. Land the N8 fix. The reviewer prototyped it at 31 lines — treat that as a cost estimate, not as code to paste.

Carry one bit across the newline: the quote character the previous line ended inside, if any. While a
run is open, suppress both `ck` recognition and heredoc registration until it closes.

**Expected test movement, and this is the trap:** the `quoted-run-spanning-lines` pin will fail,
because the divergence it pins now **agrees**. Do not "fix" that by adjusting its expected numbers.
**Convert it from a divergence into a regular `ORACLE_CASES` row** that proves agreement. A
divergence entry that agrees is not a divergence; leaving it as one, with numbers massaged to match,
would be a test asserting the bug is still there.

The reviewer measured its prototype at: tsc 0, six invariants unmoved, its four probe batteries
going **33 → 18** disagreements (15 fixed, 0 regressed, all 18 residuals pre-existing classes), and
it incidentally fixes the shape round 4 pinned as the loud over-count (counter 2 → 1 = bash).
Reproduce those numbers yourself; if yours differ, say so rather than reconciling to mine.

### 3. Fix the oracle's own guards (N12). This is the instrument — it outranks mandates 4-6.

Two defects, both of which should have caught N9 and structurally could not:

- The gate compares `r.bash !== r.counter`, i.e. **cardinalities**. A compensating pair — one phantom
  id gained, one real id lost — is invisible. Only one row compares ids. **Compare id sets, not
  counts**, everywhere it is possible to.
- `expect(d.direction).toBe(d.counter > d.bash ? 'over' : 'under')` derives the direction from the
  author's own numbers, so it can never catch a mis-characterised divergence. It is a tautology.
  **Delete it.** Likewise `why.length > 80` is a string-length check wearing the costume of a content
  check; either make it assert something real or drop it.

### 4. Pin M-J (N11).

Round 4 *introduced* `$(` tracking and no test covers it. Both directions are load-bearing and both
shapes are single-path, so they drop straight into `ORACLE_CASES`:

```
y=$(echo a)#tag; ck real-id      bash 1 / current 1 / with tracking deleted 0
x=$(ck phantom …); ck real-id    bash 1 / current 1 / with tracking deleted 2
```

Suppressing `ck` inside `$( )` is **correct, not approximate** — its JSONL goes into the captured
substitution, so the harness never sees it. Say that in the docstring.

### 5. The ANSI-C quoting fail-open. The reviewer costed the fix at 10 lines.

Generalise `closingDoubleQuote` → `closingQuote(line, open, quote)` and add an `ansiC` check, because
inside `$'…'` bash **does** honour `\'`, unlike a plain single-quoted run. **Preserve the `'it\'`
asymmetry** — that asymmetry is R1's fix and breaking it re-opens R1.

Reachability, measured: all 7 `$'` occurrences are `assert.sh:17-21,28,32`, control literals with no
escaped quote. So this is not why round 5 exists. But `$'` **is** already in the counted text via the
prepended library, so "no grader contains it" is the wrong risk statement, and it is cheap. Land it.

### 6. `HEREDOC_START` (N10): widen it or disclose it accurately. Your call, with a reason.

`[A-Za-z_][A-Za-z0-9_]*` is narrower than a bash word, and it fails in **both** directions:
`<<EOF-1`, `<<EOF.txt`, `<<E'OF'` → bash 1 / counter 0 (fail-open, rest of file discarded);
`<<\EOF`, `<<'END-OF-MSG'`, `<<2EOF` → bash 1 / counter 2 (fail-closed). Unreachable today — there is
no `<<` opener anywhere in the counted text, only a `<<<` herestring at `028/grade.sh:33`.
Pre-existing, not round 4's doing. But R4's "Bash's terminator rule" docstring claim holds **only for
parseable delimiters**, so if you disclose rather than fix, that sentence has to say so.

### 7. N13 and N14 get one accurate disclosure line each. Leave M-B alone.

N13 (fail-open, unreachable): `! ck id`, `LC_ALL=C ck id`, `time ck id`, `eval 'ck id …'`, and a
`ck \` line-continuation all count 0 against bash's 1. N14 (fail-closed, unreachable, sketcher
family, already parked): `echo {ck one,two}` → 2 vs 1.

**M-B stays as it is.** The reviewer fuzzed anchored against unanchored over **419,328** generated
lines with 0 differences, and proved why: the anchor only matters when the character before `ck` is in
`[A-Za-z0-9_-]`, but `CK_CALL` requires `^` or one of `;&|{()` there — mutually exclusive. R2 is
genuinely closed by R3's fix and the anchor is defence in depth. An honestly-labelled unkillable
mutant is an acceptable outcome; manufacturing a test that appears to kill it is not.

## Do not do these

- **Do not extract a shared `lexBash`.** The reviewer is right that ~165 lines of hand-rolled lexer
  with six defects in four rounds and a divergent twin in `src/engine/disclosure/content.ts` wants
  extracting, and it explicitly said it would not block on it. **Ruling: not in this round.** Round 5
  is the last round before the breaker, so a regression introduced by a refactor has nothing
  downstream to catch it. Bundling a structural change with the correctness fix trades a measured win
  for an unmeasured risk. I am parking the extraction for the whole-branch review with this
  reasoning. Cost if wrong: the twin stays divergent and `content.ts` keeps R1's escape bug — which
  is measured unreachable through the sketcher, since `commandSketch` runs over `ctx.solution`.
- **Do not touch `src/engine/disclosure/content.ts`.** Its twin `scanLine` stays separate, at
  `content.ts:91`. The reviewer verified the asymmetry still holds and the disposition is deliberate.
- Do not modify anything under `content/`, `src/cli/`, `objectives.yaml`, `content/lib/assert.sh`,
  `src/engine/grading/grader.ts`, or `package.json`.
- Do not re-open the N6 ruling (`/reset` refuses a finished session with 409; `/hint` stays open) or
  F7 (`/api/concepts/:id` stays ungated).
- Do not change the port parsers (`'0x50'` → 80, `' 22 '` → 22). Parked as P15, cosmetic, deliberate.

## Gates — run them, do not cite this brief

- `npm run typecheck` → exit 0.
- `npx vitest run` → all green, nothing skipped. Baseline **345 passed / 29 files** at `f65d0a4`.
  Expect it to rise. If a test fails, the only acceptable failure is the divergence pin from mandate
  2, and the fix for that is conversion, not renumbering.
- `node src/cli/index.ts coverage` → exit 0, zero `problem:` lines, `untaught concepts: 0`.
- **The six invariants must not move**, standalone and as `assertLib + grade.sh`:
  `countCheckpoints(content/lib/assert.sh) === 0`, and 019=8, 014=5, 017=5, 028=5, 006=8. Five rounds
  have run these; they are the load-bearing check. If one moves, stop and report rather than adjusting
  a grader — no grader's `expectedTotal` may change as a result of this round.
- No new `as` casts, no non-null `!`, no `enum`/`namespace`/parameter properties/decorators, measured
  on your own diff. Note the two oracle files were untracked in round 4 and so did not appear in
  `git diff` — grep the files themselves, not only the diff.
- `git status --porcelain` empty when you finish (your work committed; `.superpowers/` is git-ignored).
- **Mutation-test your own new pins** by copying the tree to `/tmp` with `node_modules` symlinked
  back. A pin that passes with its fix reverted is the defect N3, N4, N7 and M-J each named.

## Prohibitions

No VM operations of any kind — no `vmrun`, no `scripts/provision.sh` (it powers on a VM and copies
10 GB), no start/stop/snapshot/revert. No `sudo`: it cannot authenticate here, there is no TTY. Do not
run `ssh-keygen` or write into `/home/daxtangco/.ssh/`. Do not create, read or modify `.env.local` —
it is git-ignored and may hold the user's real VM password. Do not read anything under
`/home/daxtangco/sechelp-tools`; that is an unrelated project holding secrets. Do not dispatch
subagents. Do not leave a server listening — Hono's `app.request()` is a full round-trip through the
router, so API tests need no socket. `shellcheck` is not installed; its absence is not a finding.
`npm run validate` and `npm run test:vm` cannot run without a VM; that is not a finding either.

Commit with the identity passed inline, and **stage by name** — never `git add -A`, never
`git commit -a`:

```
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "..."
```

## Environment

The Bash tool runs **zsh**, not bash — and you will be reasoning about bash lexing constantly, so
reach for `bash -s <<'EOF'` deliberately rather than assuming. Unquoted `$var` does not word-split,
`grep --include='*.ts'` needs quoting, plain `grep -n "a\|b"` errors under ugrep (use `grep -nE`),
and a failed glob is an error rather than an empty expansion. `ls` is aliased to eza — use `/bin/ls`.
npm scripts run under `/bin/sh` → dash. Node v22.23.2 with native TS stripping and no build step;
`erasableSyntaxOnly` and `verbatimModuleSyntax` are on, imports carry `.ts` extensions. vitest 3.2.7,
TypeScript 5.8. `124` means timed out. `react`, `react-dom`, `@testing-library/react`, `jsdom`,
`tailwindcss` and `@xterm/xterm` are **not installed** — Task 24 owns them, so do not add them.

## Report

Append your report to `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-report.md` under a
`## Fix round 5` heading. Return only: status, the commit sha, a one-line test summary, per-mandate
disposition, and your concerns.

Three questions I want answered explicitly, because this is the final round:

1. **Did any of the seven mandates turn out to be wrong?** Round 4's brief carried a wrong claim from
   round 3's review — that `}` starts a bash comment — and the implementer refused it with a
   measurement, which was the correct outcome and saved a new fail-open. If a mandate here is wrong,
   measure it and refuse it. That is worth more to me than compliance.
2. **After this round, is the scanner correct, or merely more correct?** Round 4 answered "merely more
   correct — a line-at-a-time static walk of a language whose lexer is not line-at-a-time." Mandate 2
   removes part of that gap. Say what is left, and name the residual you would fix first if there
   were a round 6.
3. **Which of your changes is most likely to be the seventh defect**, and what would catch it?
