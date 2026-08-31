# Task 23 — scoped re-review 5 (final)

Reviewer: fresh instance. Branch `phase-0-1`, head `4ba3b01`, range `f65d0a4..4ba3b01`
(1 commit, 4 files, +643/−94). Every conclusion below is labelled **measured** or
**reasoned**. Nothing is carried over from an earlier review as established fact.

**Verdict: APPROVED**, with five findings parked as disclosed open risks — because
**none of them is reachable by the bank as it exists today** (measured), which is the
bar the brief set for overriding a tripped fix-loop breaker.

**The one thing to read first.** Round 5 is a large net improvement *and* it landed
**10 distinct new divergences from bash, 9 of them silent fail-opens** (measured:
they agree at `f65d0a4` and disagree at `4ba3b01`). Not one is reachable in the
counted text today, and the six pinned invariants are unmoved. But the pattern is
not random: it is precisely what round 3's own disclosure predicted about carrying
quote state across the newline —

> *"Carrying quote state across lines would trade this loud over-count for a silent
> under-count: one line the walk misreads would then swallow every line after it."*
> — `ORACLE_DIVERGENCES['quoted-run-spanning-lines'].why`, at `f65d0a4`

The lead reversed that ruling for round 5 and instructed the carried state be
landed. The implementer landed it, measured 19 shapes moving the right way, and the
trade the old disclosure warned about materialised in the shapes nobody enumerated.
Two of them (F1, F2) close together for **two lines of change**, which I measured:
11 divergences closed, 349/349 still green, no new disagreement anywhere in three
batteries. If the lead wants exactly one exception to the breaker, that is it — and
it is strictly cheaper and safer than the implementer's own nominated residual (N13).

---

## 1. The seven round-5 mandates

| # | Mandate | Status | Evidence |
|---|---|---|---|
| 1 | Correct the N9 disclosure | **ADDRESSED** | measured: the round-4 shape is promoted to `ORACLE_CASES` (`multiline-double-quoted`, formerly an under-count at `f65d0a4`, now agrees — H10 below) and no stale N9 prose survives in `ORACLE_DIVERGENCES`, which is down to four entries. |
| 2 | Land the N8 carried-quote fix; convert the divergence to an `ORACLE_CASES` row | **PARTIAL** | measured: the carried state is landed and real (H10, M11, M12 all move from disagree to agree; the `quoted-run-spanning-lines` over-count is gone). But the fix is incomplete in one argument (**F1**) and its ordering premise is false (**F2**), producing 9 new silent fail-opens. |
| 3 | Fix the oracle's guards: compare id sets, delete the "tautology", drop `why.length > 80` | **ADDRESSED**, with mandate 3's middle clause correctly **refused** | measured: id-set comparison on both lists; `why.length > 80` gone; `direction` re-derived from the **measured** row, which is strictly stronger than both the old form and deletion. See §2a. |
| 4 | Pin M-J | **ADDRESSED** | measured: `subst-closing-paren-is-not-a-word-break` and `subst-ck-inside-is-not-emitted` are present, carry no `counterIds` override, and both are single-path. |
| 5 | ANSI-C quoting fix preserving the `'it\'` asymmetry | **ADDRESSED**, with the prototype formula correctly **refused** | measured: M-M2 dies, and it dies in the fail-open direction the implementer claimed. See §2b. |
| 6 | `HEREDOC_START` — widen or disclose accurately | **PARTIAL** | measured: the widening is genuinely good — 20 of my 20 delimiter-word shapes agree, `<<<`, `$(( ))`/`(( ))` arithmetic, `<<-` tab-vs-space, two openers on one line, fd-numbered, subshell, tight redirect all agree, and M11/M12 move from disagree to agree. But it introduced one new fail-open (**F3**, `$[1 << 2]`), which contradicts the report's argument that widening "can only fail closed". |
| 7 | N13/N14: one accurate disclosure line each; leave M-B alone | **ADDRESSED** | measured: all four surviving `why` texts check out against measurement (§4). N14's numbers are the implementer's corrected ones and the pinned two-line form is accurate. M-B untouched and still genuinely unkillable (§4c). One wording inaccuracy is in the **report**, not the shipped disclosure (**F7**). |

---

## 2. The two refusals

### 2a. Mandate 3's "delete the tautology" — the implementer is right; the lead's instruction was wrong

**Measured, decisive.** I copied `f65d0a4` to `/tmp/rr5-base`, changed **exactly one
character sequence** — `direction: 'over'` → `direction: 'under'` on
`quoted-run-spanning-lines`, touching nothing else — and ran the suite:

```
× countCheckpoints against real bash > still disagrees with bash exactly where it is
  documented to, and no worse
AssertionError: expected 'under' to be 'over'
 ❯ test/server/checkpoint-oracle.test.ts:54:27
     54|       expect(d.direction).toBe(d.counter > d.bash ? 'over' : 'under')
 Test Files  1 failed (1)   Tests  1 failed | 1 passed (2)
```

Restored, green again (2/2).

**Ruling: the assertion was live, and deleting it would have removed a working
test.** The reason it is not a tautology is a composition the "tautology" reading
misses: lines 42–46 of the same test pin the *declared* `bash`/`counter` against the
*measured* row, and line 54 pins `direction` against the declared pair. Composed, the
label is bound to reality. Delete line 54 and a divergence can carry a `direction`
that contradicts its own measurement — and `direction` is the single field a reader
uses to decide fail-open versus fail-closed, i.e. whether a student gets a false pass
or a false fail. This is a review recommendation the lead ratified that would have
deleted a live check; saying so plainly is what the brief asked for.

The implementer did not merely refuse. It replaced the assertion with a strictly
stronger one (`checkpoint-oracle.test.ts:78-80`) that derives `direction` from the
measured row rather than the declared fields, and added a third variant `'both'` for
the compensating-pair case. That is the right outcome, reached by refusing the
instruction.

### 2b. Mandate 5's ANSI-C formula — the implementer is right

**Measured.** I applied M-M2 (`const ansiC = ch === "'" && line.charAt(i - 1) === '$'`,
i.e. the round-4 prototype) to a `/tmp` copy of HEAD:

```
× countCheckpoints > honours an escaped quote inside ANSI-C quoting but not inside a
  plain single-quoted run
× countCheckpoints against real bash > agrees with bash on every shape in the table
  + "ansi-c-escaped-dollar-is-not-ansi-c: bash 1 (real-id), counter 0 ()"
 Test Files  2 failed | 27 passed (29)   Tests  2 failed | 347 passed (349)
```

**M-M2 dies, and it discriminates**: HEAD passes 349/349, M-M2 fails, and the killing
row is exactly the one the implementer named. The measured direction on
`echo \$'a\'` is **bash 1 / counter 0** — a *fail-open*, so the implementer's claim
that the prototype "trades one fail-open for another" is correct and the deviation is
load-bearing, not gold-plating.

**Ruling: both refusals upheld.** Neither was an implementer declining review
feedback; both were measurements the review had not made.

---

## 3. The oracle instrument — re-audited by sabotage, not inspection

Every row below is **measured** on a `/tmp` copy; the real repo never ran a mutant
(`git status --porcelain` empty before and after — §7).

| Sabotage | Result |
|---|---|
| **S1** counter returns `[]` always | both oracle tests red (`expected […(100)] to deeply equal []`) |
| **S2** heredoc-body suppression dropped (subtle) | `ORACLE_CASES` gate red, 16 rows named |
| **S3** `loadAssertLib()` returns `''` | red on the anti-vacuity guard: `expected 0 to be greater than 60` |
| **S4** `spawn('bash')` → a binary that does not exist | red, `spawn bash-does-not-exist ENOENT`, error propagates rather than resolving to `''` |
| **S5** `idsFrom()` returns `[]` | red on the same anti-vacuity guard |
| **S6** `ORACLE_DIVERGENCES` emptied | red: `expected 0 to be greater than 0` |

All six fail **loudly**, and the two anti-vacuity guards (`totalBashIds > 60`, and the
`pin-separator-semicolon` → `['gamma']` anchor) are the things that catch the
collapse-to-zero class rather than the id comparison. That is the right design: with
S3/S5 the id sets would otherwise be `[]` on both sides for many rows.

### Does the id-set gate actually buy anything? Yes — measured, and it is the *only* instrument that does

The report claims M-O ("compensating pair") is killed by the new gate and survives the
old one, but **the report never states M-O's edit**, so the claim is unauditable as
written (**F6**). I reproduced it with my own compensating-pair mutant — rename the
first id in `checkpointIds` to `zz-phantom`, which loses one real id and gains one
phantom on every input while leaving cardinality identical:

- **New id-set gate:** red. Both oracle tests fail. `Test Files 1 failed | 28 passed` —
  i.e. **the oracle is the sole instrument in all 29 files that sees it.**
- **Old cardinality gate** (I reverted the three comparisons to the `f65d0a4` form and
  kept the mutant): **`Test Files 1 passed (1) Tests 2 passed (2)` — it survives.**

**Ruling on the oracle's validity: sound, and mandate 3 bought a real and otherwise
undetectable class of defect.** Reasoned addendum on why it matters: nothing on
`GradeReport` can see a compensating pair either, because `expectedTotal` is a number,
so the two errors cancel and the `incomplete` guard is silently disarmed. That is a
fail-open with no instrument behind it before this round.

### The `counterIds` escape hatch

`checkpoint-oracle.test.ts:40` lets an `ORACLE_CASES` entry override the expected id
set. **Measured: exactly one entry uses it** (`r3-separator-inside-quoted-id`, with a
stated reason), and line 41 keeps `r.bash !== r.counter` **unconditional**, so an
override can license a permutation but never a miscount. Legitimate.

### Single-path discipline — audited across all 105 entries

**Measured by enumeration.** I grepped every entry for `||`, `&&`, `if`, `elif`,
`else`, `while`, `case`, `for` and for filesystem/environment contact, and inspected
all 14 hits:

- Nine are branch constructs whose condition is a **literal**: `true &&`, `false ||`,
  `if true`, `if false`, `for x in a`, `case enabled in … enabled)`. No untaken path.
- Three are `&&`/`||` **inside a quoted description**, not operators.
- Five touch the filesystem (`test -f /etc/fstab`, `grep … /etc/hosts`,
  `awk … /etc/fstab`, two `<<<` herestrings) — and in every one the `ck` runs after a
  **`;`** or on its own line, so the environment affects the checkpoint's *status*,
  never whether its id is emitted. `idsFrom` reads `id`, not `status`.

Contrast: my own probe case `grep -q x /etc/hosts \` + `|| ck miss-id` **is** machine-
dependent, and I discarded it for that reason. The table has no such case.

### Hygiene

- **Not collected by vitest:** measured — `vitest.config.ts` sets
  `include: ['test/**/*.test.ts']`; `checkpoint-oracle.ts` does not match.
- **Writes nothing in the repo:** measured — the only write is one `writeFile` into a
  `mkdtemp(join(tmpdir(), 'rhcsa-ck-oracle-'))` removed in a `finally`. Repo
  `git status --porcelain` empty after every run.

### The M-N2 "space in my own pin" story — confirmed, and it is the round's most instructive finding

**Measured.** I applied M-N2 (drop `<>` from `WORD_END`) and measured the two pins
against real bash:

```
cat <<EOF>/dev/null   (tight — the pin as committed)   bash [real-id]  counter []   DISAGREE
cat <<EOF >/dev/null  (spaced — the first pin)         bash 1          counter 1    agree
```

M-N2 dies on the tight form and **survives the spaced form**, because the space had
already ended the word before `WORD_END` was consulted. The implementer's account is
exactly right, and its own framing is the correct one: this finding existed only
because the brief required mutating its own new pins. A pin with a space in the wrong
place is the "looks measured, proves nothing" failure this task keeps producing, and
the round-5 process caught one in the act.

---

## 4. The surviving disclosures, checked against measurement

Four `ORACLE_DIVERGENCES` entries remain. I measured each shape's direction and each
`why` claim.

### 4a. N13 — `command-prefix-before-ck-negation`

**Measured, all four named shapes reproduce exactly as disclosed:**

| shape | bash | counter |
|---|---|---|
| `! ck real-id "d" 1` | `[real-id]` | `[]` |
| `LC_ALL=C ck real-id "d" 0` | `[real-id]` | `[]` |
| `time ck real-id "d" 0` | `[real-id]` | `[]` |
| `eval 'ck real-id "d" 0'` | `[real-id]` | `[]` |

All fail-open, as disclosed. Independently, my grammar fuzzer surfaced the `time ck`
form five times over 419k+ lines, consistent with the disclosure.

**Unreachability: confirmed measured.** No grader in the counted text negates,
prefixes, times or evals a `ck`.

**The "one regex change" cost claim — measured, and it is half true.** I added `!` to
`CK_CALL`'s anchor class (`[;&|{()]` → `[;&|{()!]`), a **one-character** change:

- `! ck` closes; the only test that fails is the now-obsolete divergence pin itself,
  which would be promoted to `ORACLE_CASES`. `Tests 1 failed | 348 passed`.
- **Zero collateral**: `[[ ! -f x ]] && ck`, `[ "a" != "b" ] && ck`,
  `find … ! -name ck`, and every other shape in three batteries still agree.
- **`VAR=x ck`, `time ck`, `eval 'ck …'` stay open** — those genuinely need bash
  command-prefix modelling, not a character class.

So the **shipped disclosure text is accurate** ("recognising bash command prefixes
rather than punctuation… a larger change than the reachability justifies" — true of
the family). The **report's Question-2 summary is not**: "three fail-opens, one regex
change" overstates it, because one regex change closes one of the three (**F7**).

Reasoned: even so, `! ck` remains the best *pre-existing* candidate for a future
round — `! ck` is a plausible thing for a grader author to write and it fails silently.
It is second to F1+F2 only because those are regressions this round introduced.

### 4b. N14 — `brace-list-containing-ck`

**Measured: the disclosure text is now accurate.** The pinned row is the two-line
form, `bashIds: ['real-id']`, `counterIds: ['one', 'real-id']`, and the prose
correctly says bash prints `{ck one,two}` literally and emits nothing *from that
line* — the real id comes from the second line. The lead has already confirmed the
implementer's correction of the brief's "2 vs 1"; the shipped text does not repeat
the brief's error. Direction `over` (fail-closed) matches measurement.

### 4c. M-B — still honestly labelled unkillable

**Measured, not merely accepted.** I removed the word anchor from `CK_BEFORE_QUOTE`
against the full round-5 suite: **`Test Files 29 passed (29) Tests 349 passed
(349)`**. So round 5 added no vacuous pin claiming to cover it, and the round-4
label ("R2 is closed by R3's fix with the anchor as defence in depth") remains
honest. Not re-opened, per ruling.

### 4d. The other two divergences

`continuation-between-ck-and-id` (fail-open) and `unquoted-sed-delimiter-holding-ck`
(fail-closed): both `why` texts check out. **One gap** — see **F5**: the
continuation entry's prose asserts "A continuation *before* the `ck` counts
correctly", which is true of both shapes it shows and false of the shape it does not.

---

## 5. Is anything downstream of the synthesised prologue positional?

`scanLine`'s prologue sets `code = carried.quote + carried.quote`, so a continuation
line's emitted `code` is **not a substring of the input**. The implementer nominated
this as its own most likely seventh defect. I chased it.

**Answer: no. Nothing is positional today — measured.**

- `countCheckpoints` returns a **number**. One production caller:
  `src/server/app.ts:164`.
- `checkpointIds` has **zero** production callers. Its only consumer anywhere is
  `test/server/checkpoint-oracle.ts:692`.
- `scanned.code` is consumed only by `matchAll(CK_CALL)` reading `m[1]`. Grep for
  `.index`, `m.index`, and `scanned.code.{slice,indexOf,charAt,substring}` in
  `session.ts`: **no hits**.
- `src/engine/disclosure/content.ts` — the twin `scanLine` — is a **separate private
  function** with a different signature (`scanLine(line: string)`, one argument),
  called once at `content.ts:197`, and `content.ts` imports nothing from
  `session.ts`. Its column-sensitive work (`line.charAt(i - 1)` for the `#` rule)
  operates on the **raw input line**, not on any synthesised `code`.

**Ruling: a latent trap worth the docstring warning it already has, not a defect and
not load-bearing.** The implementer's instinct was sound; the reachability is not
there. The genuinely load-bearing defect is one line above it, in the same prologue —
F1.

---

## 6. Findings

All are **measured** unless stated. "Reaches the bank today" means the shape occurs in
the counted text (`content/lib/assert.sh` + the five `grade.sh`) as it exists now.

### F1 — HIGH — carried **double-quoted** run pairs `"` positionally across the newline

`src/server/session.ts:282`

```ts
const close = closingQuote(line, 0, carried.quote, carried.ansiC)
//                                                 ^^^^^^^^^^^^^^ false for a carried `"…"`
```

`escapes` receives `carried.ansiC`, which is `false` for a double-quoted carried run —
but bash honours `\"` inside `"…"`. The main-loop call site at line 371 gets it right
(`closingQuote(line, i + 1, ch, ch === '"' || ansiC)`). This is R1 — the defect round 3
introduced and round 4 fixed — **re-opened through the newline**, and the
`closingQuote` docstring six lines away warns that "collapsing any two of them
re-opens R1 in one direction or the other."

- **Direction: silent fail-open, unbounded.** The walk stays *inside* the string, so
  it discards every remaining line of the grader. `expectedTotal` collapses toward 0,
  `incomplete` goes false, and a grader that died on its first command reports the lab
  passed to a student who changed nothing.
- **One-line scenario:** a grader with a multi-line double-quoted message containing
  `\"` loses every checkpoint after it; the student is told the lab passed.
- **Measured shapes** (`bash` vs `counter`):

| | script | bash | counter |
|---|---|---|---|
| H1 | `x="a` / `b\"c"` / `ck real-id "d" 0` | `[real-id]` | `[]` |
| H2 | `echo "a` / `b\"" ; ck real-id "d" 0` | `[real-id]` | `[]` |
| H3 | `echo "a` / `b\""` / `ck real-id "d" 0` | `[real-id]` | `[]` |
| H4 | `grep -q "Listen 82` / `and \"quoted\"" /etc/hosts; ck listen-set "d" $?` | `[listen-set]` | `[]` |
| H5 | `msg="a` / `b \" c` / `d"` / `ck real-id` / `ck two-id` | `[real-id,two-id]` | `[]` |
| H9 | H1 then `cat <<EOF` / `body` / `EOF` / `ck real-id` / `ck two-id` | `[real-id,two-id]` | `[]` |

- **Controls that confirm the diagnosis, not a probe artifact:** `$'…'` (`ansiC` true)
  agrees; escaped-backslash (`b\\"`) agrees; the existing `ORACLE_CASES` row
  `multiline-double-quoted` (`echo "a` / `b"; ck real-id`, no escape) **agrees** — which
  is why it does not discriminate.
- **Regression or incomplete fix: both.** H1/H3/H5/H9 **agree at `f65d0a4`** and break
  at `4ba3b01`. H2/H4 were under-counting at `f65d0a4` for a different reason and were
  not fixed.
- **No test distinguishes the defect from the fix, in either direction:** 29 files /
  349 tests green *with* the defect and *with* the fix. The six pinned invariants are
  byte-identical either way (`assert.sh` 0, 019=8, 014=5, 017=5, 028=5, 006=8;
  standalone and as `assertLib + grade`).
- **Reaches the bank today: NO.** I re-implemented the committed line walk and reported
  every line of the counted text that hands an open quoted run to the next line. There
  are exactly three, all in `assert.sh` (`:103-107`, `:150-153`, `:164-170`), and **all
  three are plain single-quoted** awk programs — for which `carried.ansiC === false` is
  the correct value by accident. All five graders carry none. Zero carried
  double-quoted runs, and no backslash on any carried line.
- **Load-bearing enough to override the breaker: NO** by the brief's own definition
  (not reachable today). **But it is the strongest candidate for a single exception:**
  the fix is one token, `carried.quote === '"' || carried.ansiC`, and I measured it —
  closes all six shapes, adds no disagreement in three batteries, suite 349/349 green.
- Reasoned: the distance to reachability is one authoring choice. An awk or message
  string written with `"` instead of `'` — an entirely ordinary thing to write, and awk
  programs routinely contain `\"` — fires it silently.

### F2 — HIGH — a pending heredoc body preempts the carried quoted run, and the docstring's stated reason is false

`src/server/session.ts:449` checks `pending.at(0)` **before** `scanLine(raw, quoted)`.
The docstring at `:441-445` justifies that order:

> *"It survives a heredoc body in between, which is bash's own order: `cat <<EOF; x="a`
> reads the body first and only then keeps reading the string."*

**Bash does the opposite** — measured. On `cat <<EOF; x="a` / `ck inside "d" 0` / `b"` /
`EOF` / `ck real-id "d" 0`, bash emits **`[real-id]` and not `inside`**: it completes the
unterminated quoted word across the newline *first*, then gathers the heredoc body.
The docstring's own example, A2, is one of the failing cases.

- **Direction: silent fail-open.**
- **One-line scenario:** a grader that opens a heredoc and a multi-line string on the
  same line loses every checkpoint after it.
- **Measured, and a pure round-5 regression** — all five agree at `f65d0a4`:

| | script | `f65d0a4` | `4ba3b01` |
|---|---|---|---|
| A1/A2 | `cat <<EOF; x="a` / `b"` / `EOF` / `ck real-id` | agree 1/1 | bash `[real-id]`, counter `[]` |
| A3 | as above with `ck inside` inside the would-be body | agree 1/1 | bash `[real-id]`, counter `[]` |
| A4 | `&&` instead of `;` | agree 1/1 | bash `[real-id]`, counter `[]` |
| A5 | single-quoted variant | agree 1/1 | bash `[real-id]`, counter `[]` |
| A6 | `cat <<EOF; x="a` / `EOF` / `b"` / `ck real-id` | bash 0, counter 1 | bash `[]`, counter `[real-id]` (pre-existing, fail-closed) |

- **Reaches the bank today: NO.** Measured: there is **no `<<` heredoc opener anywhere
  in the counted text** — the only `<<` is two `<<<` herestrings at
  `028-restore-remote-access/grade.sh:33`, and `<<<` is handled correctly.
- **Fix measured:** one condition — `if (open !== undefined && quoted === undefined)`.
  Applied together with F1's token, this closes **all six A-family shapes including the
  pre-existing over-count A6**, all six H-family shapes, adds no disagreement in three
  batteries, and leaves the suite 349/349 green. Two lines, 11 divergences closed.
- **Load-bearing enough to override the breaker: NO** (unreachable). Ranked with F1.

### F3 — MEDIUM — `$[ … << … ]` (deprecated arithmetic) is read as a heredoc opener

`echo $[1 << 2]` / `ck real-id "d" 0`: **`f65d0a4` agreed 1/1; `4ba3b01` gives bash
`[real-id]`, counter `[]`.** The widened `heredocDelimiter` reads `2]` as a delimiter
and queues a phantom heredoc that swallows the rest of the file.

- **Direction: silent fail-open, unbounded.** This matters beyond its own severity: it
  **contradicts the report's argument for mandate 6**, that widening the delimiter
  parser can only move things in the fail-closed direction. The `arith === 0` guard
  covers `$((` and `((`, not `$[`.
- **Reaches the bank today: NO.** Measured: `grep -rn '\$\[' content/` → no hits.
- **Load-bearing: NO.** Reasoned: `$[ ]` has been deprecated since bash 2, so the
  probability a grader author writes it is very low.

### F4 — LOW — `$( )` / `(( ))` nesting depth resets per line while the carried quote crosses lines

`x=$(echo 'a` / `b'; ck phantom "d" 0)` / `ck real-id "d" 0`: **`f65d0a4` agreed 1/1;
`4ba3b01` gives counter 2 vs bash 1.** `subst` and `arith` are locals of `scanLine`,
so they reset every line, but `quoted` now survives the newline — the two pieces of
lexical state have different lifetimes.

- **Direction: fail-closed** (false fail — loud, student-reported).
- **Reaches the bank today: NO.** Measured: no multi-line `$( )` in the counted text.
- **Load-bearing: NO.**

### F5 — LOW — a line continuation immediately before a `ck` line is an undisclosed false hit

| script | bash | counter |
|---|---|---|
| `echo a\` / `ck real-id "d" 0` (joins to `echo ack real-id …`) | `[]` | `[real-id]` |
| `true \` / `ck real-id "d" 0` (`ck` becomes an argument) | `[]` | `[real-id]` |

- **Direction: fail-closed.** Pre-existing at **both** commits, not a regression.
- **The gap is in the disclosure, not the count.** `ORACLE_DIVERGENCES` pins only the
  *under*-count `continuation-between-ck-and-id`, and its `why` says "A continuation
  *before* the `ck` counts correctly" — true of the two shapes the docstring shows
  (`: \` + `; ck cont-id` and `test -f /etc/hosts \` + `&& ck cont-id`, both verified
  to agree), false when the continuation glues the previous word onto `ck`.
- **Reaches the bank today: NO.** Measured: there are 10 trailing-`\` lines in the
  counted text and **every one falls after the `ck` token and its id** (they are
  continuation lines inside `ck_fail …` and `printf …` calls). None precedes a `ck` line.
- **Load-bearing: NO.**

### F6 — PROCESS — three mutation claims in the report are unauditable as written

The report names **M-O, M-P and M-Q by effect, not by edit** ("compensating pair",
"also kills M-P"), so a reader cannot reproduce them. Every other mutant in the report
states its mutation. I reproduced M-O's *claim* independently (§3) and it holds, so
this is a reporting defect rather than a false claim. Reasoned: for a task whose whole
discipline is "a pin that passes with its fix reverted proves nothing", a mutant
without its edit written down is the same category of unfalsifiable evidence.

### F7 — PROCESS — the report overstates the N13 fix cost

Report line 1443: "the command-prefix family (`! ck`, `VAR=x ck`, `time ck`) — three
fail-opens, one regex change". **Measured: one regex change (one character) closes one
of the three.** The shipped disclosure in `checkpoint-oracle.ts` is accurate; the
report's summary is not, and it is the sentence a future round would act on.

### Pre-existing defects re-confirmed, unchanged by this round (measured, no action)

- `cat <<EO\` + `F` — delimiter line continuation: bash 1 / counter 0, **fail-open**,
  both commits.
- `y=$(echo 'a` / `b')#tag; ck real-id` — bash 1 / counter 0, **fail-open**, both
  commits.
- A6 above — bash 0 / counter 1, fail-closed, both commits (closed by F2's fix).

### Genuine improvements this round, measured against `f65d0a4`

The widening and the carried state are real work, not churn. Shapes that
**disagreed at `f65d0a4` and agree at `4ba3b01`**: `multiline-double-quoted`
(`echo "a` / `b"; ck real-id`), `cat <<E\ OF`, `cat <<E'OF'`, plus the report's 19
moved shapes. And 20 of 20 delimiter-word shapes I invented agree at HEAD (`<<$X`,
`<<${x}`, `<<!`, `<<{EOF}`, `<<'A>B'`, `<<"E"OF`, `<<'EOF'"MORE"`, `<<EOF#x`,
`<<EOF>/dev/null`, `0<<EOF`, `<<A <<B`, `<<EOF;echo x`, `<<EOF&`, `(cat <<EOF)`,
`<<-` with tab and with space, `<<<` bare and quoted, `1<<3`, `$((1 << 2))`,
`(( x = 1 << 2 ))`).

**`heredocDelimiter` returning `undefined` on an unclosed delimiter quote — the
implementer's direction claim is correct (measured).** `cat <<"EOF` / `EOF"` / `body` /
`EOF` / `ck real-id` gives bash `[]` / counter `[real-id]`: **fail-closed**, as claimed.
Reasoned: it is fail-closed in general, because bash absorbs the delimiter word across
the newline and can then never match a line-based terminator, so bash emits nothing
while the counter keeps counting. Pre-existing at both commits.

---

## 7. Gates

All **measured**, run rather than cited.

| Gate | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npx vitest run` | **29 files / 349 tests passed, 0 failed** |
| `node src/cli/index.ts coverage` | **exit 0**, `grep -c "problem:"` → **0**, `untaught concepts: 0` |
| Six invariants | `assert.sh` 0; 019=8, 014=5, 017=5, 028=5, 006=8 — standalone **and** as `assertLib + grade.sh`. **Unmoved.** |
| Protected paths | `git diff --name-only f65d0a4..4ba3b01 -- content/ src/cli/ objectives.yaml src/engine/grading/grader.ts package.json package-lock.json` → **empty** |
| Diff scope | 4 files, +643/−94: `src/server/session.ts`, `test/server/checkpoint-oracle.ts`, `test/server/checkpoint-oracle.test.ts`, `test/server/session.test.ts` |
| Banned syntax on the four files | none. Every `as`/`!` hit is prose in a comment or a test name ("as soon as", "as well as", "as an identifier"). No `enum`, `namespace`, decorator, or parameter property. |
| `git status --porcelain` | **empty before and after.** All mutation ran in `/tmp/rr5` (`git archive HEAD`) and `/tmp/rr5-base` (`git archive f65d0a4`), `node_modules` symlinked back. |

Not run, and not findings per the brief: `shellcheck` (not installed),
`npm run validate` / `npm run test:vm` (need a VM). No VM operation, no `sudo`, no
`.env.local`, no subagent, no listening server.

---

## 8. Shape, and the two items already parked

**Shape is good.** `heredocDelimiter` is a genuine improvement in kind over the regex
it replaced — it says what it is (read a bash word) instead of approximating it, and
its docstring explains why `WORD_END` and `WORD_BREAK` must differ by exactly `<>`.
The `closingQuote(line, from, quote, escapes)` generalisation is the right seam and its
docstring is the best in the file: it states all three quoting behaviours as measured
requirements and warns that collapsing any two re-opens R1. F1 is a defect *against*
that docstring, which is the most useful kind of docstring to have.

The `ORACLE_DIVERGENCES` entries are down from more to four, each carrying an id set
and a direction derived from measurement. That is a real tightening.

**`lexBash` extraction — arguing once, with a reason, as permitted.** I agree with
parking it, and I would add one datum to the whole-branch review rather than reopen it
here: F1 is a *drift* defect between two call sites of the same helper inside one
function (line 282 gets `escapes` wrong; line 371 gets it right, six lines from a
docstring warning about exactly this). That is the failure mode a shared lexer removes
by construction, and it is now the second measured instance (the first being
`content.ts`'s twin carrying R1). Worth carrying as evidence into the branch review;
not a finding here.

**`content.ts`'s twin `scanLine` — parked, confirmed not re-opened.** I verified only
that the parking premise still holds: it is a separate one-argument private function,
`content.ts` imports nothing from `session.ts`, and its positional work runs on the
raw line. No new argument.

---

## 9. The property-test recommendation

**Endorsed, and it is the right follow-up — with one condition that is not optional.**

Reasoned, but from direct experience this round: I built exactly that instrument (a
seeded grammar fuzzer over `SEP`/`LEAD`/`TRAIL`/`DELIM`/`WORDS`/`CMDS` pools with
optionally-unclosed quoted runs and computed heredoc delimiters, filtered by `bash -n`,
comparing id sets against real bash) and pointed it at `checkpointIds`. It found the
`time ck` family five times independently. It did **not** find F1 or F2 — because my
generator did not emit an escaped quote *inside* a carried run, nor a heredoc opener on
the same line as an unterminated string. Those came from reading the diff and asking
"which argument crosses the newline". So: the property test is the highest-value
follow-up on this function, and it would have found several of the six historical
defects, but it finds what the generator can generate. Grammar coverage is the whole
game.

**The non-optional condition: the generator must be validated before its silence is
believed.** My first fuzzer run produced 78% `bash -n` failures and a wave of false
`OVER` verdicts, because I had put `>/dev/null` in the pool applied to `ck` lines —
which redirects the checkpoint JSONL away so bash emits nothing while the counter
correctly counts it. That is a self-inflicted instance of exactly the "looks measured,
proves nothing" failure this task keeps producing, and it is the same failure as
M-N2's spaced pin. A property test that has not been mutation-tested — seed it against
a known-broken `countCheckpoints` and confirm it goes red, and assert a floor on the
proportion of generated cases that are `bash -n`-valid and emit at least one id — is a
green light with nothing behind it.

Concretely, and cheap: point it at `checkpointIds` (already the right seam, which
answers report Concern 1), gate it behind an env var so it does not slow `npm test`,
and require each run to report its valid-case count. Test-only, nothing under it to
break.

---

## 10. Summary of what the lead is being asked to rule on

1. **Both refusals: upheld** (measured). Mandate 3's "delete the tautology" would have
   removed a live check; mandate 5's prototype formula would have opened a new
   fail-open. Both refusals came with measurements the review had not made.
2. **The oracle is valid**, and mandate 3's move from cardinalities to id sets bought a
   real class of defect that **no other instrument in the suite can see** (measured).
3. **Nothing downstream of the synthesised prologue is positional** (measured).
4. **Nothing found is reachable in the bank today**, and the six invariants are
   unmoved. On the brief's own rule, **nothing overrides the tripped breaker**.
5. **But round 5 landed 10 new divergences, 9 of them silent fail-opens**, invisible to
   all 349 tests — the failure the round-3 disclosure predicted about carrying quote
   state across the newline. **F1 + F2 close for two lines**, measured: 11 divergences
   closed, three batteries clean, 349/349 green. If the lead grants one exception, this
   is the one, and it beats the implementer's own nomination (N13) on cost, on
   direction, and on the fact that F1/F2 are this round's regressions rather than
   inherited debt.
