# Task 23 — scoped re-review of fix round 4

Repo `/home/daxtangco/rhcsa-trainer`, branch `phase-0-1`, range **`2cfbe8b..HEAD`**.

## Why this pass exists

`countCheckpoints` in `src/server/session.ts` has produced **five** fail-open or fail-closed defects
across three fix rounds, and **each round's fix introduced the next**:

| round | fixed | introduced |
|---|---|---|
| 1 | F4 (compared a line count to a distinct-id count), F16 (missed `;`/`&&`/`\|` separators), heredoc over-count | N1, N2 |
| 2 | F17 (`ck lv_size` beside `ck lv` counted as one id) | — |
| 3 | N1 (unanchored, quote-blind heredoc opener), N2 (phantom id from a separator inside a string) | **R1** |
| 4 | R1-R8 + the `$((` residual — this commit | **you are here to find out** |

Everything this counter feeds is a truth claim made to a student about whether they passed. An
under-count deflates `expectedTotal`, so a grader killed partway matches it, `incomplete` stays
`false`, and **a student who changed nothing is told the task passed**. An over-count reports a
correct solution as incomplete. There is no third outcome in which a miscount is harmless.

## What is different about this round, and where the value of this review is

Round 4 does two things no earlier round did.

1. It **stops maintaining a list of disclosed fail-open misses and closes them in code** — comments
   after `;`/`)`/`}`/`&`/`|`, exact heredoc terminator matching, multiple heredocs per line,
   arithmetic `<<`, and a `ck` after `then`/`do`/`else`/`{`/`(`/`)`. Three rulings drove that, all
   recorded in the ledger. The scanner is therefore **wider** than it has ever been, and widening a
   pattern is the fail-*closed* direction: over-counting reports a correct solution as incomplete.
2. It introduces a **new instrument**: a differential test helper that runs a snippet through real
   `bash` with `content/lib/assert.sh` prepended and compares the ids bash actually emits against
   `countCheckpoints`. `ck` is pure bash string manipulation plus `echo`, so this needs no VM and no
   root.

**Priority 1 of this review is the instrument, not the function.** Every expectation in round 4's
test table now derives from that helper, so if the helper is wrong, a whole table of wrong numbers
looks measured. Attack it directly:

- **Is the oracle's own bash run valid?** `assert.sh` is prepended, so its `ck` definitions execute.
  Confirm `ck`'s argument contract is being honoured by the snippets (it takes an id, a description,
  a status/exit code, and an optional hint) and that a snippet is not passing something that makes
  `ck` emit nothing — a snippet whose ids bash *never* emits makes any counter look correct.
- **Is the single-path constraint actually respected?** `countCheckpoints` is static and counts ids on
  every path; a bash run emits only on the taken path. So a snippet containing a branch is not a
  valid oracle case, and one that slipped in would produce a "bash says 1, counter says 2" reading
  that is the harness's fault rather than the code's. Check every table row for branches.
- **Does the helper compare distinct ids to distinct ids?** `sort -u` on emitted ids against
  `Set.size`. A row comparing emitted *lines* to distinct ids is F4 again, one level up.
- **Does the helper actually fail when it should?** Break `countCheckpoints` deliberately in a `/tmp`
  copy and confirm the differential table goes red. A green oracle that cannot go red is worse than
  no oracle, because it launders reasoning as measurement — and "a tool reporting success when it did
  not do what was asked" is this project's recurring defect class.
- **Does it write inside the repo?** It must not. `git status --porcelain` stays clean.

## Priority 2 — attack the widened scanner in the fail-closed direction

Earlier reviews hunted under-counts. Round 4's rulings deliberately traded some disclosure risk for
pattern width, so this time **over-counts are the likelier defect**. Build your own shapes; do not
reuse only the implementer's table. Worth trying, plus anything you think of:

- Each newly accepted prefix used where it is *not* a call: `case` labels of every shape
  (`enabled)`, `*)`, `a|b)`), a `)` closing a subshell or `$( … )`, a `}` closing `${var}` or a
  function body, `{` opening a brace group, `then`/`do`/`else` appearing inside a string or a word
  (`nothen ck x`, `"do ck x"`).
- The word-anchored `ck`-before-quote exception: a word ending in `ck` (`perm-check`, `stack`,
  `lock`), and the id-prefix truncation — does `ck "real-id; ck phantom"` now yield exactly `real-id`,
  and does `ck_pass 'home-from-lv' "…"` still yield the full hyphenated id and not a truncated one?
  A too-eager prefix cut would silently shorten a real id, which is an under-count that still reports
  a plausible-looking number.
- Escaped quotes at both parities, in single **and** double quotes — bash processes `\` inside `"…"`
  but **not** inside `'…'`, so a fix that treats them alike is wrong in one of the two.
- Heredocs: `<<-EOF` with a tab-indented terminator (must end) versus a **space**-indented one (must
  not); `<<EOF` with a trailing space on the terminator (must not end); an unterminated heredoc;
  `<<"EOF"`; `cat <<A <<B`; a `ck` on the same line before an opener.
- Arithmetic: `$(( 1 << shift ))`, `$(( bytes << 3 ))`, `(( x <<= 2 ))`, and a `<<` heredoc opener on
  a line that *also* contains `$(( ))` — the depth tracking must not swallow a real redirect.
- Comments: `#` after each of `;`, `)`, `}`, `&`, `|`, and `#` that is **not** a comment —
  `${lv_bytes#/}`, `${x##*/}`, a `#` inside a quoted run, a `#` mid-word (`sha#1`).

For each defect, state the direction (**fail-open** = under-count = false pass; **fail-closed** =
over-count = false fail) and whether any grader in the bank reaches it today.

**The six invariants must not move. Re-measure them yourself**, standalone and as
`assertLib + grade.sh`: `countCheckpoints(content/lib/assert.sh) === 0`, and 019=8, 014=5, 017=5,
028=5, 006=8. Four rounds running these have been the load-bearing check. If one moved, that outranks
everything else in this review — and note that a *widening* round is the one most likely to move
them, since `assert.sh` itself contains a `case` statement (`:88-91`) and `014/grade.sh:44-46` has
another.

## Priority 3 — R8, the rating path

`restart()` should now clear `s.result`. The laundering sequence to reproduce: grade → reset → finish
must not produce a rating derived from the pre-reset verdict. Before round 4, grade→finish gave
`startedAt 0, endedAt 1200000, rating good` while grade→reset→finish gave `1200000/1200500, rating
easy` — a 20-minute solve on a 10-minute task laundered into a cold inside-budget one.

Check the fix did not break **reset-to-retry**, which is the reason a 409 was rejected here: after a
reset the student must still be able to work and grade again. And check `/finish` after a reset now
answers its existing "nothing has been graded yet" 409 rather than grading a machine that was wiped.

## Priority 4 — do the new pins have teeth?

Mutation-test the new tests by copying the tree to `/tmp` with `node_modules` symlinked back; the real
repo stays clean. At minimum: revert the escaped-quote handling and confirm the R1 pins go red; revert
the id-prefix truncation and confirm R2/R3's pins go red; revert `restart()`'s clearing and confirm
R8's pin goes red; delete the arithmetic-depth tracking and confirm something fails. A pin that
passes with its fix reverted is the defect N3, N4 and N7 each named, re-committed.

## Priority 5 — the disclosures that remain

Round 4 was told: close these, and if one costs more than it is worth, say so with the measurement
and disclose it accurately instead. So some disclosures may survive legitimately. For each one left
in the docstrings, check the *wording* against measurement — **N5 and R7 were both findings about a
false disclosure, not a missing fix**, and a disclosure that describes the wrong shape is worse than
none, because a grader author trusts it and writes something unsafe. If the report calls something an
"open fail-open risk" rather than a residual, that wording was requested deliberately; say whether
you agree with the classification.

## Gates — run them, do not cite the report

- `npm run typecheck` → exit 0.
- `npx vitest run` → all green, nothing skipped. Baseline **337 passed / 28 files** at `2cfbe8b`; it
  goes up.
- `node src/cli/index.ts coverage` → exit 0, zero `problem:` lines.
- **No new `as` casts, no non-null `!`, no `enum`/`namespace`/parameter properties/decorators**,
  measured on this diff. **Ignore every absolute cast figure in every document in this workspace** —
  they count one specific pattern, not all casts, and a verifying grep run against them matched
  English prose in comments. The only claim to check is that this commit adds none.
- Nothing modified under `content/`, `src/cli/`, `objectives.yaml`, `content/lib/assert.sh`,
  `src/engine/grading/grader.ts`. `package.json` untouched.
- `src/engine/disclosure/content.ts`'s twin scanner must still be a separate function. If round 4
  applied a shared fix to both, check it was applied deliberately and that a quoted id still
  survives in the counter and still does **not** survive in the sketcher.
- `git status --porcelain` empty before and after. **Do not mutate the repo.**

## Out of scope — do not report these

F7 (`/api/concepts/:id` stays ungated, by ruling), F13/F14/F15, the `'0x50'`/`' 22 '` port parsing,
the seven pre-existing `.pathname` test files, `src/engine/grading/grader.ts`, and everything in
`whole-branch-parked.md`'s "Residuals that are documented on purpose" and "Not findings" sections —
the unquoted-delimiter redactor case (`sed -i s\|a\|b\| /etc/hosts`), the `for u in` / `case` label
sketch noise, the `sh -c` wrapped-command sketch, and the `vmrun.ts:108` argv exposure.

**The N6 ruling is settled and was verified across all three modes by the previous reviewer:**
`/reset` refuses a finished session with 409, `/hint` stays open. Do not re-open it. In practice mode
reaching rung 5 after the attempt is scored is the product — this app exists so its user never opens
a book.

## Prohibitions

No VM operation, no `vmrun`, no `scripts/provision.sh` (it powers on a VM and copies 10 GB). Do not
run `ssh-keygen` or write into `/home/daxtangco/.ssh/`. Do not create or read `.env.local`
(git-ignored, may hold the user's real VM password). Do not read `.env`, `.env.sandbox` or
`.env.example` under `/home/daxtangco/sechelp-tools` — an unrelated project. No `sudo` (no TTY).
No subagents. Do not leave a server listening. `shellcheck` is not installed — not a finding.
`npm run validate` and `npm run test:vm` cannot run without a VM; their absence is not a finding.

## Environment

Bash tool runs **zsh**: unquoted `$var` does not word-split, `grep --include='*.ts'` needs quoting,
plain `grep -n "a\|b"` errors under ugrep (use `grep -nE`), a failed glob is an error not an empty
expansion, and `bash -s <<'EOF'` gets you bash semantics — which you need constantly here, so use it
deliberately rather than assuming the shell is bash. `ls` is aliased to **eza** — use `/bin/ls`. npm
scripts run under `/bin/sh` → dash. Node **v22.23.2**, vitest 3.2.7, TypeScript 5.8. `124` means
timed out. `react`, `react-dom`, `@testing-library/react`, `jsdom`, `tailwindcss`, `@xterm/xterm` are
**not installed** — Task 24 owns them.

## The bar

Label every conclusion `measured` or `reasoned`. The recurring defect class in this project is **a
tool reporting success when it did not do what was asked**, and this function is where it keeps
happening, because a wrong count is silent by construction. Three consecutive reviews of it each
found a real defect that every test passed over. Assume there is a fourth until you have tried hard
to find it and failed — and this time the most likely place for it is the oracle that is supposed to
prove there isn't one.

## Report

Write the full review to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-rereview-4.md`.

Return only: the verdict (**APPROVED** or **CHANGES REQUIRED**), a table of R1-R8 each
FIXED / NOT FIXED / REGRESSED, your verdict on the differential oracle's validity, each new finding
with severity + direction + a one-line failure scenario + whether the bank reaches it today, and
whether the six invariants moved.

---

# Addendum written after the round-4 report landed

Head is **`f65d0a4`**, range `2cfbe8b..f65d0a4`, 1 commit, 5 files, +925/−50.
Read `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/review-2cfbe8b..f65d0a4.diff`, not
`git diff`. The implementer's account is `task-23-report.md`, `## Fix round 4` — a claim to test.

**I have already reproduced these myself at `f65d0a4`, so do not spend the pass re-deriving them**
(confirm cheaply and move on): typecheck exit 0; **345 passed / 29 files**, 0 skipped; coverage exit
0 with 0 `problem:` lines; all six invariants unmoved standalone and combined; zero added casts,
non-null `!`, `enum`, `namespace`, parameter properties or decorators — the single `as` in the diff
is the English word inside a comment. I also built **my own** differential oracle, independent of the
implementer's helper, over 20 shapes covering every R1-R7 case plus both arithmetic parities: **all
20 agree with real bash.** And I probed specifically for a silent id truncation from R3's
prefix-cut, using prefix-collision pairs that make a shortened id count-visible
(`ck_pass 'home-from-lv'` beside `ck home`, `ck home-from`, `ck lv_home`): full hyphenated and
underscored ids survive intact.

So the cheap findings are gone. Spend the pass on the five things below.

## 1. The oracle is the instrument — audit it, per Priority 1 above

73 cases, 0 disagreements, in `test/server/checkpoint-oracle.ts` (helper, not collected) and
`checkpoint-oracle.test.ts` (the gate). The report says no expected number is encoded in the table,
every case is single-path, and there are anti-vacuity guards so a table of `0 == 0` cannot pass with
bash or `assert.sh` missing. **Verify all three claims by reading and by breaking it**, and confirm
the gate goes red when `countCheckpoints` is broken in a `/tmp` copy. A green oracle that cannot go
red launders reasoning as measurement, which is this project's defect class exactly.

## 2. Two disagreements the implementer found, disclosed rather than closed

Pinned in `ORACLE_DIVERGENCES` at their measured pairs. Judge both dispositions:

- **`quoted-run-spanning-lines`** — a double-quoted string continued across lines; the middle line
  reads as code. bash 1, counter 2, **fail-closed**. Left open deliberately: carrying quote state
  across lines would trade a loud over-count for the silent swallow-the-rest-of-the-file mode that
  four of this round's findings were instances of. No grader in the bank has a multi-line string.
- **`ansi-c-quoting-with-escaped-quote`** — `echo $'a\'b'; ck real-id "d" 0`. Inside `$'…'` bash
  *does* honour `\'`, unlike a plain single-quoted run, so the walk closes one quote early and
  desynchronises. bash 1, counter **0**, **fail-open**. This is R1 through a third quoting form.
  Reported as an **open fail-open risk**, not a residual, which is the wording I asked for.
  Measured unreachable: no `$'` in any grader, and the only `$'…'` under `content/` are `$'\t'`-style
  control literals with no escaped quote.

**The question I want answered on the second one: is it worth a round 5, or is disclosure right?**
The fix appears small and local — mirror the existing `closingDoubleQuote` for a `'` preceded by `$`
— which cuts against leaving a known fail-open in the counter. Against that: round 5 trips the
breaker, and R1 was also "unreachable today". Give me a recommendation with a cost, not a preference.
If you find a *reachable* route to it, that changes the answer and outranks everything else here.

## 3. A surviving mutant the implementer reported against itself

**M-B: removing the word anchor from `CK_BEFORE_QUOTE` breaks no test.** The argument is that R3's
fix makes the anchor unobservable — the retained text is `"` + an id-shaped prefix + `"`, which
contains no whitespace, and `CK_CALL` needs whitespace after `ck`, so a wrongly-triggered exception
can no longer smuggle a phantom id. The anchor was kept as defence in depth and the report says
plainly that no test proves it. **Try to construct the distinguishing shape.** If one exists, the
argument is wrong and R2 is not closed the way the report claims. If none does, say so — an
unkillable mutant that is honestly labelled is acceptable; one that is quietly pinned by a vacuous
test is not.

## 4. A correction the implementer made to the review's own prose — check it

Round 3's review, and my brief repeating it, listed `}` among the positions where bash starts a
comment. The implementer **refused it with a measurement**: `}` is not a bash metacharacter,
`{ true; }#note` is a syntax error, `${x}#tag` is a single word — so adding `}` to `WORD_BREAK`
would have *introduced* a fail-open, cutting `echo ${x}#tag; ck real-id "$y" 0` at the `#` and losing
a real checkpoint. It kept mutant **M-F2** (adding `}`) as the test that documents why. Verify the
measurement and the mutant. `<` and `>` were excluded on the same reasoning (`>#` needs a target).
If the implementer is right, my brief was wrong on that bullet and I want that stated in your review.

## 5. The twin scanner in `content.ts` was deliberately left alone

R1's escape bug exists in `src/engine/disclosure/content.ts`'s `scanLine` too, and the implementer
did not fix it, arguing reachability: `\"` occurs once under `content/`
(`content/lib/assert.sh:16`, even parity); the only odd-double-quote lines are two *comment* lines in
`028/setup.sh:41-42` and `commandSketch` runs over solutions, not setup scripts; no `$'…\'…'` exists
anywhere under `content/`. The asymmetry claimed is that the counter's copy is reachable through
`assert.sh`'s own documented usage line while the sketcher's is not. **Test that reachability claim
yourself** — it is the whole justification, and a sketch defect is a degraded hint rather than a
false pass, so the stakes differ. The brief forbade merging the two scanners and required
deliberateness either way; say whether this qualifies.

## Also worth your time

`session.ts` grew from 376 to 537 lines and the scanner is now a hand-rolled bash lexer with
escape handling, a heredoc queue, arithmetic depth and a word-break table. Judge whether the *shape*
is still defensible at this size and whether the docstrings — which two earlier rounds were spent
correcting, and which N5 and R7 were both findings about — are accurate now. A false disclosure is
worse than a disclosed miss.
