# Task 23 — re-review of fix round 4

Range `2cfbe8b..f65d0a4` (1 commit, 5 files, +925/−50) on `phase-0-1`.
Fresh reviewer: the round-3 reviewer authored two of round 4's fixes and could not
review its own design.

Every conclusion below is labelled **measured** (I ran it and read the output) or
**reasoned** (argued from code I read, not executed). Nothing is carried over from
the round-4 report on the report's authority; where I say the report is right, I
re-ran it myself.

---

## Verdict

**CHANGES REQUIRED.**

Round 4 is a real improvement and its central innovation — the differential oracle —
is a genuine instrument, not decoration. All eight rules R1–R8 are fixed as
specified. The reason for changes is not a regression in what round 4 aimed at; it
is that round 4's own disclosure of what it left unfixed is **false in the
direction that matters**, and the shape it declares unreachable is already present
in the text that gets counted.

Specifically (N8/N9): the `quoted-run-spanning-lines` divergence entry pins the
defect as a *loud over-count* on *double-quoted* runs that *no grader contains*.
Measured, all three claims are wrong. The natural arrangement of that shape is a
**silent under-count** (a false pass), single-quoted runs behave identically and
are what the bank actually contains, and `content/lib/assert.sh` — which
`harness.ts:65` prepends to every grader *before* counting — contains three
multi-line single-quoted awk programs. The entry also argues that carrying quote
state across lines would trade a loud over-count for a silent
swallow-the-rest-of-the-file mode; measured, that mode is already reachable today
through the heredoc queue instead.

The brief says a false disclosure is worse than no disclosure, because a grader
author reads it and concludes the shape is safe. That is the situation here, and
it is in the fail-open direction. Round 5 is warranted.

---

## Gates — re-run by me, not cited

| Gate | Result | How |
|---|---|---|
| `npm run typecheck` | exit 0 | measured |
| `npx vitest run` | 29 files, **345 tests**, 0 failed, 0 skipped | measured |
| `node src/cli/index.ts coverage` | exit 0, zero `problem:` lines, untaught concepts 0 | measured |
| Diff scope | 5 files; none under `content/`, `src/cli/`, `objectives.yaml`, `grader.ts`, `package.json` | measured |
| No `as`-casts added | only match is the English "Parsed as JSON" in a comment | measured |
| Repo clean | `git status --porcelain` = 0 lines before and after my pass, head `f65d0a4` | measured |

### The six invariants — unmoved (measured)

| Subject | standalone | assertLib + grade |
|---|---|---|
| `assert.sh` alone | 0 | — |
| `019` | 8 | 8 |
| `014` | 5 | 5 |
| `017` | 5 | 5 |
| `028` | 5 | 5 |
| `006` | 8 | 8 |

All six identical to their pre-round-4 values, and identical again under the round-5
prototype in the N8 section below. No grader's `expectedTotal` moves.

---

## R1–R8

Each row was checked by a targeted mutant (reverting the fix in a `/tmp` copy) and
confirmed killed by **both** a named unit test and, independently, the oracle table.
Mutant labels are mine and are defined in the mutation section.

| Rule | Status | Evidence |
|---|---|---|
| R1 — escape-aware closing double quote | **FIXED** | M-A and M-K both killed; both parities pinned; oracle agrees (measured) |
| R2 — `CK_BEFORE_QUOTE` word anchor | **FIXED** as specified | anchor present; behaviourally unobservable — see (c) (measured) |
| R3 — quoted-id truncation to one word | **FIXED** | M-C killed; prefix-collision probes show full ids survive (measured) |
| R4 — heredoc terminator rule | **FIXED** | M-D killed; `raw.trim()` regression caught (measured) |
| R5 — heredoc queue, not single opener | **FIXED** | M-E killed by the two-heredoc ordering test (measured) |
| R6 — `WORD_BREAK` membership | **FIXED**; the round-3 prose was wrong, the implementer is right | M-F and M-F2 both killed (measured — see below) |
| `$((` arithmetic residual | **FIXED** | M-G and M-G2 killed; the pin flipped 0→1 correctly (measured) |
| R7 — docstring / disclosure accuracy | **FIXED** for the items it names; **new false disclosure** introduced elsewhere (N9) | M-H killed (measured) |
| R8 — `restart()` clears `s.result` | **FIXED** | M-I killed by the new app test (measured) |

Nothing is **NOT FIXED** and nothing is **REGRESSED**. The new findings are adjacent
to these rules, not reversals of them.

### R6: the correction runs the other way

The round-3 review's prose listed `}` among the characters that should break a word.
Measured against real `bash`, that prose was wrong on every instance it implied:

- `{ true; }#note` → **syntax error** (so `}#` is not a live shape to model)
- `${x}#tag` → prints `abc#tag`, i.e. **one word**
- `>#note` and `<#note` → **syntax errors**

Adding `}` to `WORD_BREAK` (mutant M-F2) is killed by the pinned test, and the test
documents why. The implementer was right to decline that item and right to pin the
reason. No change wanted.

### R8: the phase/result coupling is sound (measured)

`s.phase` is set to `'graded'` only by `finish()`. `/reset` answers 409 on a finished
session, so `restart()`'s `delete s.result` can never leave phase and result
inconsistent. After a reset-before-finish, `/finish` answers its existing
`'nothing has been graded yet'` 409 and reset-to-retry works. M-I (removing the
`delete`) is killed by the new `does not let a reset between grade and finish
launder the rating` test. The N6 ruling was not re-opened.

---

## (a) Is the differential oracle a real instrument?

**Verdict: VALID.** It measures what it claims to measure, it goes red when the
subject breaks, and it cannot pass vacuously. One limitation worth recording as
N12, but it does not undermine the round-4 numbers.

Priority 1 in the brief was to audit the instrument before the function, because
every expectation in round 4's table now derives from it. I did that first.

**It goes red when the subject breaks (measured).** In `/tmp/rr4` I changed
`countCheckpoints` to return `Math.max(0, ids.size - 1)`. Both oracle tests turned
red. The table is load-bearing, not advisory.

**All three vacuity modes fail loudly (measured).** I broke the instrument three
ways and confirmed each one is caught rather than silently passing:

| Sabotage | Result |
|---|---|
| `loadAssertLib()` returns `''` | `expected 0 to be greater than 60` |
| `spawn` points at `/nonexistent/bash` | `spawn /nonexistent/bash ENOENT` |
| `idsFrom()` always returns `[]` | `expected 0 to be greater than 60` |

So the anti-vacuity guards do their job: a table of `0 == 0` cannot pass.
`expect(rows).toHaveLength(ORACLE_CASES.length)` catches a silently-shortened case
list, and `expect(anchor?.bashIds).toEqual(['gamma'])` is the one row that compares
distinct ids to distinct ids rather than just counts.

**It compares distinct ids to distinct ids (measured).** `idsFrom` accumulates into
a `Set`; `countCheckpoints` returns `ids.size`. Both sides are de-duplicated, so a
grader that emits the same id twice is 1 on both sides. Correct.

**Every case is single-path (measured, and proven by the green table).** I read all
73. More usefully: the constraint is self-enforcing. `countCheckpoints` counts ids on
*all* paths, whereas a bash run emits only the taken path, so any `ck` sitting on an
untaken branch would show up as `counter > bash`. The table is green, therefore no
case has a `ck` on an untaken path. That is a stronger check than my reading.

**Not vacuous by construction (measured).** 72 of the 73 rows have `bash >= 1`. The
one 0/0 row is `pin-assert-usage-comment`, which is intentionally a
must-not-count case.

**Hygiene (measured).** `vitest.config.ts` has `include: ['test/**/*.test.ts']`, so
`checkpoint-oracle.ts` is a helper and is not collected as a test file — it cannot
pass by being empty. Temp files go to `os.tmpdir()` via `mkdtemp`, and the repo
stayed clean across every run.

This is the first round to verify against a reference implementation instead of
against the author's own reading of bash, and that is the right move. It is also
what let me find N8: I could only establish the multi-line defect because the
harness the implementer built made it cheap to measure.

---

## (b) The ANSI-C-quoting fail-open — recommendation

**Is there a reachable route to it today? No (measured).** I checked this first
because the brief says a reachable route outranks everything else.

`$'` appears in the counted text exactly 7 times, all in `content/lib/assert.sh`
(lines 17–21, 28, 32), and every one is a control-character literal such as `$'\t'`
with no escaped quote inside. I traced lines 17 and 28 by hand through `scanLine`
and confirmed the walk closes each run correctly. The six invariants are unmoved,
which independently confirms nothing in the bank hits this path.

**But the report's phrasing understates the exposure.** It says no `$'` appears in
any grader. Measured, `$'` *is* already in the counted text — it is in `assert.sh`,
and `harness.ts:65` builds `grade: ${assertLib}\n${gradeBody}`, so `assert.sh` is
prepended to all five graders before `countCheckpoints` runs. The construct is one
escaped apostrophe away from live, in a file every grader inherits. "No grader
contains it" and "the shared library every grader inherits contains seven of them"
are very different risk statements.

**Recommendation: fix it, in round 5 — but this is not by itself why round 5 should
happen.** N8 is. Bundle the ANSI-C fix into that round because I measured the cost
and it is genuinely small:

| Cost of the ANSI-C fix | Measured |
|---|---|
| Changed lines | **10** — generalise `closingDoubleQuote` to `closingQuote(line, open, quote)` and add `const ansiC = ch === "'" && i > 0 && line.charAt(i - 1) === '$'` |
| `tsc --noEmit` | exit 0 |
| Six invariants | unmoved |
| `'it\'` single-quote asymmetry | preserved (bash does not honour `\'` inside a plain single-quoted run, and neither does the fix) |
| Test movement | exactly one — the divergence pin fires because the divergence now agrees (counter 0 → 1) |

That last row is the pin behaving as documented: it exists to fail when the
divergence is fixed. The fix is 10 lines, changes no grader's total, and the only
red is the pin asking to be retired. There is no good argument for carrying this to
a sixth round.

---

## (c) Surviving mutant M-B — the distinguishing shape does not exist

**Verdict: M-B is unkillable. Honestly labelled, and acceptable.** The implementer's
reasoning is correct. I tried hard to falsify it and could not.

**Measured.** `fuzz-mb.mjs` compares the anchored `CK_BEFORE_QUOTE` against the
unanchored mutant over **419,328** generated lines — 28 leading contexts × 24
before-quote tokens (including `fsck `, `perm-check `, `lock `, `ckck `,
`ck_passck `, `a_ck `, `1ck `, `-ck `) × 2 quote characters × 24 bodies × 13 tails.
**0 differ.**

**Reasoned, which is the part that actually settles it.** The anchor can only change
behaviour when the character immediately before `ck` is in `[A-Za-z0-9_-]`. But
`CK_CALL` only matches a `ck` token preceded by start-of-string or one of
`;&|{()`. Those two conditions are mutually exclusive, so the anchored and
unanchored variants can differ only on runs that `CK_CALL` cannot match under
either variant. No input can distinguish them.

This means R2 is genuinely closed by R3's fix — truncating the quoted id to one word
removed the exploit that the anchor was added to block. The anchor is now defence in
depth against a future change to `CK_CALL`'s anchor set. Keeping it is right;
pinning it with a test is impossible. An unkillable mutant that is labelled
unkillable, with the argument recorded, is the correct outcome. **No change wanted.**

---

## New findings

Direction convention: **fail-open** = under-count → deflated `expectedTotal` → a
student passes a task they did not complete. **fail-closed** = over-count → a
student is failed for work they did.

### N8 — HIGH, fail-open, silent, unbounded. Shape present in the counted text today.

**A quoted run that spans lines silently loses every checkpoint on its closing
line, and if any middle line contains `<<`, it discards the entire rest of the
grader.**

`scanLine` walks one line at a time and carries no quote state across the newline.
When a line ends inside an open quote it stops, and the next line is read as fresh
code. Measured pairs:

| Snippet | bash | counter |
|---|---|---|
| `echo "a⏎b"; ck real-id "d" 0` | 1 | **0** |
| `echo 'a⏎b'; ck real-id "d" 0` | 1 | **0** |
| `awk 'BEGIN {⏎ exit 0⏎}'; ck fstab-checked "d" $?` | 1 | **0** |
| `awk 'BEGIN {⏎ exit 0⏎}'; ck one-id "d" $?; ck two-id "d" 0` | 2 | **0** |
| `msg="a⏎cat <<EOF⏎b"⏎ck real-id⏎ck two-id` | 2 | **0** |
| `msg='a⏎cat <<EOF⏎b'⏎ck real-id⏎ck two-id` | 2 | **0** |

The last two are the amplification: the `cat <<EOF` on a middle line is *string
content* to bash, but the counter reads it as code and queues a phantom heredoc
whose terminator never arrives, so every remaining line of the grader is swallowed.
The loss is not bounded to one line.

**One-line failure scenario.** A grader closes a multi-line `awk` program and checks
its exit status on the same line — `…}' /etc/fstab; ck persist-config "…" $?` — the
counter returns 0 for that checkpoint, `expectedTotal` is short by one, and a
student who never edited `/etc/fstab` is graded as complete.

**Does any grader in the bank reach it today? The shape does; the loss does not
— yet (measured).** `content/lib/assert.sh` contains three multi-line
single-quoted awk programs (lines 103–107, 150–153, 164–170), and that file is
prepended to all five graders before counting. No checkpoint is lost today only
because those three closing lines (107, 153, 170) happen not to carry a trailing
`ck`. Meanwhile `assert.sh:60` documents the canonical usage as
`some_condition; ck my-id "what was checked" $? "what to look at"` — i.e. a `ck` on
the same line as the condition it tests. **Composing the bank's own two documented
idioms produces the silent loss.** I confirmed this directly: `assert.sh`'s own
`is_persistent` awk body, inlined into a grader in the `then ck …` form, gives
bash 1 / counter 0.

So this is not a hypothetical about a shape nobody writes. It is a shape the shared
library already writes three times, kept harmless by a line-break coincidence that
no test pins and no lint enforces.

**Recommended fix — measured, not speculated.** I prototyped it. Carry exactly one
piece of state across the newline: the quote character the previous line ended
inside. While that state is set, the leading part of the next line is string
content — emit no `ck` from it and register no heredoc — and resume the normal walk
after the closing quote.

| Prototype cost | Measured |
|---|---|
| Changed lines | **31** |
| `tsc --noEmit` | exit 0 |
| Six invariants | **unmoved** (all six identical) |
| My four probe batteries | **33 → 18** disagreements with bash |
| Rows fixed / regressed | **15 fixed, 0 regressed** |
| Full suite | 344/345 pass; the single failure is the `quoted-run-spanning-lines` divergence pin, firing because the divergence now agrees |

Every one of the 18 residual disagreements is a pre-existing class (N10, N13, N14) —
the prototype introduces no new divergence. It also resolves the shape the report
pinned as the "loud over-count": `multiline-string-pinned-shape` goes from
counter 2 to counter 1, which equals bash.

The round-4 entry argues against this fix on the grounds that mis-reading a line as
opening a quoted run would then swallow every following line. That risk is real in
principle, but it is not a reason to prefer the status quo: **the swallow-the-rest-of-
the-file mode is already reachable today** via the phantom-heredoc path above, and
the prototype removes 15 divergences without adding one.

### N9 — HIGH as a disclosure defect. The `quoted-run-spanning-lines` entry is false.

This is the N5/R7 class exactly: a disclosure that is wrong is worse than absent,
because a grader author reads it and concludes the shape is safe. Three measured
errors and one inverted argument:

1. **Direction.** Pinned as `over` (loud, a false fail). The natural arrangement is
   `under` — silent, a false pass. Both faces exist; the entry documents only the
   one that cannot hurt a student.
2. **Quote type.** Says "double-quoted". Single-quoted runs behave identically
   (`echo 'a⏎b'; ck real-id` → bash 1, counter 0), and single-quoted is what the
   bank actually contains — all three `assert.sh` awk programs.
3. **Reachability.** Says "No grader in the bank contains a multi-line string".
   `content/lib/assert.sh` contains three, and it is prepended to every grader
   before counting.
4. **The cost argument is inverted**, as set out in N8.

**Required regardless of whether N8's code fix lands:** correct the entry, and move
the measured under-count pairs into `ORACLE_DIVERGENCES` so the silent face is
visible in the table rather than described in prose.

### N10 — MEDIUM, both directions. Unreachable today. `HEREDOC_START`'s delimiter class is narrower than bash's word.

`/^<<(-?)[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/` accepts less than bash does, and
fails in both directions depending on how it fails. Measured:

| Snippet | bash | counter | Direction |
|---|---|---|---|
| `cat <<EOF-1 … EOF-1` | 1 | **0** | fail-open — delimiter parsed as `EOF`, terminator never matches, rest of file discarded |
| `cat <<EOF.txt … EOF.txt` | 1 | **0** | fail-open — same |
| `cat <<E'OF' … EOF` | 1 | **0** | fail-open — same |
| `cat <<\EOF … EOF` | 1 | **2** | fail-closed — regex fails entirely, body read as code |
| `cat <<'END-OF-MSG' … END-OF-MSG` | 1 | **2** | fail-closed — same |
| `cat <<2EOF … 2EOF` | 1 | **2** | fail-closed — same |

`<<\EOF` is a common idiom for a literal heredoc, and hyphenated delimiters are
ordinary style.

**One-line failure scenario.** A grader writes a config with `cat <<'END-OF-FILE'`;
the regex does not match, so the body is scanned as code and any `ck`-looking text
inside it is counted, failing a student for checkpoints that were never emitted.

**Does any grader reach it today? No (measured).** There is no `<<` heredoc opener
anywhere in the counted text — the only near miss is a `<<<` herestring at
`028/grade.sh:33`. This class is pre-existing, not introduced by round 4, but R4's
new docstring claims the code now implements "Bash's terminator rule", which is
true only for delimiters the regex can parse in the first place. Widening the
delimiter to a bash word, or disclosing the narrowing, would make that claim honest.

### N11 — MEDIUM, coverage gap. Surviving mutant M-J: the `subst` tracking round 4 introduced is unpinned.

Deleting the `$(` command-substitution depth tracking breaks **no test**. Round 4
added this mechanism, mutation-tested nine other mutants, and did not test this one.
The code is correct; the mechanism is undefended, so a later refactor can delete it
silently.

It is load-bearing in both directions, and the distinguishing shapes exist —
measured:

| Snippet | bash | current | M-J | Direction |
|---|---|---|---|---|
| `y=$(echo a)#tag; ck real-id "$y" 0` | 1 | 1 | **0** | fail-open |
| `x=$(ck phantom "d" 0)` ⏎ `ck real-id …` | 1 | 1 | **2** | fail-closed |

Both are single-path and drop straight into `ORACLE_CASES`. Worth stating explicitly
in the docstring: suppressing `ck` inside `$( )` is not an approximation, it is
correct — a `ck` there has its JSONL captured into the variable, so the harness
never receives it, and the counter must not count it. That is a deliberate
behaviour and deserves a pin.

### N12 — MEDIUM, limitation of the instrument. The oracle compares cardinalities, not id sets.

The gate's comparison is `r.bash !== r.counter`. Since `countCheckpoints` returns
only `ids.size`, a **compensating pair** — one phantom id gained and one real id
lost on the same input — is invisible to the whole table. Exactly one row
(`pin-separator-semicolon` → `['gamma']`) compares ids.

The `ORACLE_DIVERGENCES` guards are also weaker than they read:

- `expect(d.direction).toBe(d.counter > d.bash ? 'over' : 'under')` derives the
  direction from the author's own pinned numbers. It is a tautology over
  author-supplied data and can never catch a mis-characterised divergence.
- `expect(d.why.length).toBeGreaterThan(80)` is a string-length check, not a
  correctness check.

These are the two guards that should have caught N9, and structurally they cannot.
Both pinned `why` texts are measurably wrong on the facts while both guards are
green. **Recommend:** have `countCheckpoints` expose the id set to the oracle (or add
an internal id-returning helper the oracle can call) and compare sets, not counts.
That is the difference between an instrument that detects miscounting and one that
detects miscounting *unless the errors cancel*.

### N13 — LOW, fail-open, unreachable today. `CK_CALL`'s anchor set misses positions where bash does run a `ck`.

Measured, each 0 against bash's 1: `! ck real-id "d" 1`, `LC_ALL=C ck real-id "d" 0`,
`time ck timed-id`, `eval 'ck eval-id "d" 0'`, and `ck \` + newline + id.

**One-line failure scenario.** A grader negates a check with `! ck …`; the checkpoint
is not counted, and `expectedTotal` is short by one.

**Reaches the bank? No (measured)** — no grader uses a negation, assignment prefix,
`time`, or `eval` before `ck`. The docstring's claim "and so does a continued bare
`ck`" is defensible under the reading where the continuation precedes `ck`
(`: \` + newline + `; ck cont-id` counts 1, measured), and the bank's real
continuations all fall after the id, where they count correctly. Worth one sentence
of precision in the docstring: a continuation that separates `ck` from its id is not
handled.

### N14 — LOW, fail-closed, unreachable today. Over-counts from unquoted metacharacter contexts.

Measured: `echo {ck one,two}` → counter 2 vs bash 1 (bash prints it literally; a
brace list containing a space is not expanded). `sed s|a|ck\ phantom|` → counter 2
vs bash 1. Pre-existing, not in the bank, and the unquoted-delimiter family is
parked per the brief for the sketcher. Noted for completeness; not blocking.

---

## Mutation battery — 13 mutants

Run in `/tmp/rr4` (a copy of the tree with `node_modules` symlinked back). The repo
was clean before and after.

**Killed by both a named unit test and, independently, the oracle table (measured):**
M-A (revert escape-aware closing quote), M-C (revert id truncation), M-D (revert
terminator to `trim()`), M-E (heredoc queue → first opener only), M-F
(`WORD_BREAK` → whitespace only), M-F2 (`WORD_BREAK` += `}`), M-G (delete arithmetic
guard), M-G2 (delete arithmetic depth tracking), M-H (revert `CK_CALL` to the
pre-round-4 pattern), M-I (revert `restart()`'s `delete s.result`), M-K (remove
backslash-outside-quotes handling).

**Survived:** M-B (unkillable, correctly labelled — see (c)) and **M-J** (a real
coverage gap round 4 did not name — see N11).

Being killed independently by the oracle matters: it means the table is not a
restatement of the unit tests but a second, differently-derived check on the same
behaviour.

---

## Is the shape defensible at 537 lines?

**Yes, with one reservation (reasoned).** `session.ts` now carries a hand-rolled bash
lexer — escape handling, a heredoc queue, arithmetic depth, command-substitution
depth, a word-break table — inside a file whose other job is session lifecycle. The
lexer is about 165 lines of that and has produced six defects across four rounds,
which is the signature of a component that wants to be its own module with its own
test file rather than a helper.

The reservation is not the length, it is the **twin**. `src/engine/disclosure/content.ts:91`
still has its own separate `scanLine`. Round 4 fixed one and not the other, which is
now a documented, deliberate decision rather than an oversight — I verified the
asymmetry holds and that R1's escape bug is unreachable through the sketcher (below).
But two divergent bash lexers in one codebase is a standing cost, and the natural
time to extract a shared `lexBash` module is the round that touches this code next.
I would not block on it, and I would not defer it past round 5's edits.

## The `content.ts` reachability claim — tested myself

**The report's disposition qualifies as deliberate (measured).** The twin `scanLine`
is still a separate function at `content.ts:91`. The asymmetry is real: the counter
keeps a quoted id and returns 1, while the sketcher yields `["ck_pass"]` and
`["sed"]`. The only odd-double-quote lines under `content/tasks` are
`028/setup.sh:41-42`, both of which are comments. And `commandSketch` (`content.ts:180`,
called at `:257`) runs over `ctx.solution`, not over grader text — so R1's escape bug
is not reachable through the sketcher. Leaving the twin alone in round 4 was correct.

## Docstring accuracy

R7's own items are fixed (M-H killed). Two remaining inaccuracies, both already
covered above: the `quoted-run-spanning-lines` divergence entry (N9 — false on
direction, quote type, and reachability, with an inverted cost argument), and the
"Bash's terminator rule" claim which holds only for delimiters `HEREDOC_START` can
parse (N10). The `$'` note is accurate as far as it goes but understates exposure by
saying no grader contains `$'` when the universally-prepended shared library
contains seven (see (b)). One-sentence precision is also wanted on the continued
bare `ck` (N13).

---

## What round 5 should contain

Ranked, with measured costs:

1. **Correct the `quoted-run-spanning-lines` disclosure** (N9). Docs-only,
   non-negotiable, and independent of everything below.
2. **Fix the multi-line quoted run** (N8). 31 lines measured; 15 divergences closed,
   0 regressed; invariants unmoved; retire the divergence pin it resolves.
3. **Compare id sets in the oracle, not cardinalities** (N12), and drop the
   tautological direction guard. This is what makes rounds 6+ cheaper to trust.
4. **Pin M-J** (N11) — two single-path rows added to `ORACLE_CASES`.
5. **Fix ANSI-C quoting** (b). 10 lines measured. Bundle it; do not carry it further.
6. **Widen or disclose `HEREDOC_START`'s delimiter** (N10).
7. Leave M-B alone, labelled unkillable, with the argument recorded (c).

N13 and N14 are LOW and unreachable; a disclosure line each is sufficient.
