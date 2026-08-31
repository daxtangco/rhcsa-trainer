# Task 23 — fix round 4

You are a **fresh implementer**. Three previous rounds by the same agent fixed real defects in
`countCheckpoints` (`src/server/session.ts`) and **each round introduced a new one**. Round 4 goes
to fresh eyes at the top tier because that is what the process requires when a fix loop reaches
round 4, not because the previous work was bad — it was good, and the reviews confirmed it.

Head is `2cfbe8b` on `phase-0-1`. Read these, in this order:

1. `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-rereview-3.md` — the review that
   produced R1-R8. Every finding is measured against real bash with the reproducing shape quoted.
   **This is your specification.**
2. `src/server/session.ts` — the docstrings above `CK_CALL`, `HEREDOC_START`, `CK_BEFORE_QUOTE` and
   `scanLine` are unusually good and explain three load-bearing orderings. Read them before you
   change anything; the previous rounds' reasoning is preserved there for you.

Commit discipline: stage by name, never `git add -A`, never `git commit -a`, explicit identity
inline (`GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost git commit -m "…"`).

---

## Mandate 1 — build the differential oracle FIRST, before you fix anything

This is the most important instruction in this brief. **The reason this function has broken five
times is that every round verified it by reasoning about shapes instead of measuring what bash
does.** An oracle is available and nobody has used it. I proved it works before writing this
brief, `MEASURED`:

```
script:            echo "it\"s ok"; ck real-id "desc" 0
bash emits:        1 distinct id (real-id)
countCheckpoints:  0
```

`ck` is pure bash string manipulation and `echo` — **no root, no VM, no network**. So for any
candidate grader text you can get ground truth by concatenating `content/lib/assert.sh` with the
snippet, running it under `bash`, and collecting the ids it actually prints:

```bash
{ cat content/lib/assert.sh; cat snippet.sh; } > /tmp/full.sh
bash /tmp/full.sh 2>/dev/null | grep -oE '"id":"[^"]*"' | sort -u
```

**Required:** add a test helper that, for a table of grader snippets, asserts
`countCheckpoints(snippet)` equals the number of distinct ids **real bash emits** from the same
snippet. Every snippet in the table must be single-path — no branches — so that "emitted" and
"declared" are the same set by construction, and note that constraint in the helper's docstring
along with why (`countCheckpoints` is static and counts ids on *all* paths, so a branching script
is not a valid oracle case).

Seed the table with every shape R1-R6 names, both parities where the review measured parities, plus
the shapes already pinned (the documented separator form, `&&`, `|`, the heredoc bodies, `<<<`, the
quoted id, the F17 collision, the comment forms). **If bash and the counter disagree on any shape
you did not set out to fix, stop and report it** — that is defect six and I want to know before you
build on top of it.

Run the oracle in `/tmp`. It must not write inside the repo, and `git status --porcelain` must stay
empty apart from your intended edits.

## Mandate 2 — R1, the fail-open regression. Blocking.

`HIGH`, fail-open, and **introduced by round 3**. The quote walk finds a closing quote with
`line.indexOf(ch, i + 1)`, which does not honour a backslash escape, so an odd number of `"` on a
line leaves the walk running inside the string and the rest of the line — including its `ck` — is
discarded. Measured: `echo "it\"s ok"; ck real-id "d" $?` → bash **1**, `b7c7f61` 1, `8083796` 1,
`2cfbe8b` **0**.

The failure scenario is the one that matters most on this branch: that line is the
`some_condition; ck my-id "…" $?` form `content/lib/assert.sh:60` documents as **the** usage. One
escaped quote in a description and the checkpoint vanishes from `expectedTotal`, a truncated run
matches the deflated total, `incomplete` stays `false`, and **a student who changed nothing is told
the task passed.**

Fix: honour `\` when scanning for the closing quote of a double-quoted run. Note that inside
**single** quotes bash does not process escapes at all — `'it\'` is a complete run — so the two
quote types do not behave the same and the fix must not pretend they do. Pin both parities and pin
the worse variant the review names: a `<<` *inside* the desynchronised string opening a phantom
heredoc that discards every remaining line.

## Mandate 3 — R2 and R3, the exception round 3 introduced. Fix them together.

`CK_BEFORE_QUOTE` keeps a quoted run when a `ck` token precedes it, because there the string is the
checkpoint id (`ck_pass 'home-from-lv' "…"`, a shape the bank uses). Two defects, both fail-closed:

- **R2** — it is not word-anchored, so any word ending in `ck` triggers it:
  `ck perm-check "checked; ck also-ran" $?` → bash 1, scanner **2**. `-check` is the natural RHCSA
  id suffix, so this is close to reachable.
- **R3** — the whole run is kept, so a separator inside it declares a second id:
  `ck "real-id; ck phantom" $?` → bash 1, scanner **2**.

Fix both with one change, and make it the *minimal* form of the exception rather than a patch: the
exception exists solely to preserve a quoted **id**, and an id cannot contain a space or a
separator (`CK_CALL`'s class is `[A-Za-z0-9_-]`). So when a quoted run follows a word-anchored `ck`
token, emit **only the leading id-shaped prefix** of that run and drop the remainder. That preserves
`ck_pass 'home-from-lv'` exactly, and there is nothing left inside the run for `CK_CALL` to find.

## Mandate 4 — R4, R5, R6, and the `$(( ))` residual: make the scanner right rather than adding a fifth disclosure

The review's closing observation is the one I want you to act on: **"a phantom heredoc discards the
rest of the file" now has four distinct routes into it** (R1's string desync, R6's unrecognised
comment, R4/R5's mistracked bodies, and the disclosed `$(( 1 << shift ))`). It notes that
recognising `<<` only in redirect position would close several at once and is "worth costing before
disclosing them one at a time."

**Ruling: close them, do not disclose them. — Because this function is the sole source of
`expectedTotal`, every one of these is fail-open in the direction that tells a student they passed
when they did not, and the disclosure list has now been wrong twice (N5, R7) while the code has been
wrong five times. — Cost if wrong: a scanner slightly more complex than a hint-sketcher needs.**

Concretely:

- **R4** — the heredoc terminator is matched with `trim()`, so a tab-indented or trailing-space
  `EOF` ends a plain `<<EOF` body early and the printed text is then read as code (bash 1, scanner
  **2**). Match bash's rule: for `<<`, the line must equal the delimiter **exactly**; for `<<-`,
  strip **leading tabs only** (not spaces) before comparing.
- **R5** — only the first of several openers on a line is tracked, so `cat <<A <<B` reads `B`'s body
  as code (bash 1, scanner **2**). Hold pending delimiters in order and consume them in order.
- **R6** — a `#` begins a comment at any word start, which includes immediately after `;`, `)`, `}`,
  `&` and `|`; the walk requires whitespace or start-of-line. Measured both directions, including
  the fail-open `true;#uses <<EOF style` → **0**. Recognise a comment at those positions too.
- **The `$(( ))` residual** — track arithmetic depth (`$((` and `((`) in the same single walk and do
  not treat `<<` as a heredoc opener while inside it. This closes the disclosed miss rather than
  documenting it, and it is why `$(( 1 << shift ))` counted 0 while `$(( bytes << 3 ))` counted 1 —
  a distinction no grader author could be expected to hold in their head.

If any of these turns out to cost more than it is worth once you are in the code, **say so in your
report with the measurement that changed your mind** and disclose that one accurately instead. I
would rather have four closed and one honestly disclosed than five half-closed.

## Mandate 5 — R7, and retire the known-misses list rather than correcting it again

`session.ts:63-65` lists a `ck` after `then`, `do`, `else`, `{` or `(` as a known miss. The review
found the list is *still* wrong: a `case` label is a **closing** paren, so
`enabled) ck en-id "d" 0 ;;` counts **0** against bash's 1, and no reader gets that from "`(`".
This matters because `case` is already the bank's idiom —
`content/tasks/storage/014-grow-home-lv/grade.sh:44-46` and `content/lib/assert.sh:88-91` both
contain one, so the bank is one line from writing it.

That list has now been wrong twice. **Ruling: make `CK_CALL` accept the whole group — `then`, `do`,
`else`, `{`, `(`, `)` — instead of documenting it a third time. — Because the differential oracle
from mandate 1 makes widening the pattern verifiable in a way it was not in earlier rounds, and
every member of the list is a latent fail-open on a function whose miscounts are silent by
construction. — Cost if wrong: an over-count somewhere the oracle did not cover, which is
fail-closed and loud.**

Verify with the oracle, and verify the six invariants do not move. Keep whatever genuinely cannot be
handled as a disclosure, written accurately, with the shape spelled out the way R7 asks.

## Mandate 6 — R8, the rating laundering. Fail-open and reachable today.

`MEDIUM`, and the only finding here that a user can hit right now without writing an unusual
grader. Measured through the real app in exam mode with an injected clock:

| sequence | `startedAt` | `endedAt` | `allPassed` | `rating` |
|---|---|---|---|---|
| grade → finish | 0 | 1200000 | true | `good` |
| grade → **reset** → finish | 1200000 | 1200500 | true | **`easy`** |

`restart()` moves `startedAt` while `s.result` **survives** the VM revert, so `/finish` derives a
rating from a verdict measured on a machine that has since been wiped and re-`setup`'d, over a clock
saying the attempt took no time. A 20-minute solve on a 10-minute task is laundered into a cold
inside-budget one.

Round 3's new `/reset` comment states exactly the right principle — a reset must not make the report
describe an attempt that did not happen — but its guard keys on `phase === 'graded'`, i.e.
post-`/finish`, while the rating-relevant window is post-`/grade`, pre-`/finish`. Not a regression;
it predates round 3.

Fix as the review suggests: **`restart()` clears `s.result`.** A reverted machine has no valid
verdict, so `/finish` then correctly answers its existing 409 "nothing has been graded yet" instead
of grading a machine that no longer exists. This keeps reset-to-retry working, which a 409 on
`/reset`-after-grade would not. Pin the laundering sequence itself: grade → reset → finish must not
yield a rating derived from the pre-reset verdict.

## Do not change these

- **`/hint` stays open on a finished session.** Ruled, and the review confirmed it by driving all
  three modes: the rating is a local never stored, `/finish` is already 409 on a second call, and
  `MAX_RUNG` caps exam at 2 and drill at 3. In practice mode reaching rung 5 after your attempt is
  scored **is the product** — this app exists so its user never opens a book. Do not add a 409 there.
- `/reset`'s existing 409 on a graded session, `/grade`'s and `/finish`'s 409s, and the N4 route-table
  pin. All have teeth (the reviewer mutation-tested each).
- `/api/concepts/:id` stays ungated. Ruled.
- Anything under `content/`, `src/cli/`, `objectives.yaml`, `content/lib/assert.sh`, or
  `src/engine/grading/grader.ts`. `package.json` untouched.
- `src/engine/disclosure/content.ts`'s `scanLine` is the **twin** of the one you are fixing and must
  stay separate — a quoted id must survive in the counter and must **not** survive in the sketcher.
  One scanner cannot be right for both; the docstring explains this. If a fix applies to both, apply
  it to both deliberately and say so, but do not merge them.

## Gates — all must pass before you report

- `npm run typecheck` → exit 0.
- `npx vitest run` → all green, nothing skipped. Baseline **337 passed / 28 files**; it goes up.
- `node src/cli/index.ts coverage` → exit 0, zero `problem:` lines.
- **The six invariants, re-measured and pasted:** `countCheckpoints(content/lib/assert.sh)` → **0**,
  and 019=8, 014=5, 017=5, 028=5, 006=8, both standalone and as `assertLib + grade.sh`. If one moves,
  **report it rather than adjusting the expected number.** Four rounds running, these are the
  load-bearing check.
- **The differential oracle table passes in full**, and its output is pasted in your report.
- No new `as` casts, no non-null `!`, no `enum`/`namespace`/parameter properties/decorators. The gate
  is "this commit adds none" measured on your own diff — **ignore any absolute cast figure you find
  in an older document in this workspace; two of them are counts of a specific pattern, not of all
  casts, and one of my own greps for them was wrong.**
- `git status --porcelain` empty when you finish, with your work committed.

## Prohibitions

No VM operation, no `vmrun`, no `scripts/provision.sh` (it powers on a VM and copies 10 GB). Do not
run `ssh-keygen` or write into `/home/daxtangco/.ssh/`. Do not create or read `.env.local`
(git-ignored, may hold the user's real VM password). Do not read `.env`, `.env.sandbox` or
`.env.example` under `/home/daxtangco/sechelp-tools` — an unrelated project. No `sudo` (no TTY here).
No subagents. Do not leave a server listening. `shellcheck` is not installed — not a finding.

The Bash tool runs **zsh**: unquoted `$var` does not word-split, `grep --include='*.ts'` needs
quoting, plain `grep -n "a\|b"` errors under ugrep (use `grep -nE`), a failed glob is an error rather
than an empty expansion, and `bash -s <<'EOF'` gets you bash semantics — which you will need
constantly for mandate 1, so use it deliberately rather than assuming the shell is bash. `ls` is
aliased to **eza**; use `/bin/ls`. npm scripts run under `/bin/sh` → dash. Node **v22.23.2**,
vitest 3.2.7, TypeScript 5.8. `124` means timed out.

## Report

Append to `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-23-report.md` under a
`## Fix round 4` heading. Return only: per-finding disposition for R1-R8, the differential oracle
table with bash's count beside the counter's for every shape, the six invariant counts, the gate
results, the new test count, which tests you proved by reverting your own fix, and anything you
could not do.

Two things I specifically want in the report:

1. **Any shape where bash and the counter disagree that is not in R1-R8.** That is defect six, and
   finding it is worth more than finishing the round on time.
2. **Whether the scanner is now correct or merely more correct.** Four rounds have ended with a
   confident report and a defect still in it. If you finish with a shape you believe is wrong but
   could not close, name it as an open fail-open risk rather than a residual — the word matters,
   because a residual reads as accepted and this list has been re-litigated twice.

If you think one of the three rulings above is wrong, say so and implement it anyway unless it is a
correctness problem — in which case stop and tell me.
