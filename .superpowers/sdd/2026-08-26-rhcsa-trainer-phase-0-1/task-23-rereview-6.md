# Task 23 — scoped re-review of the round-6 breaker exception (`4ba3b01..28ad7f0`)

**Verdict: CHANGES REQUIRED** — for adjudication and parking, not a fix round.

Both shipped edits are correct and I could not break either one. The reason for the verdict is a
**new disclosure added by this commit whose stated direction is refuted by measurement**: the
`arith` half of the lexical-state lifetime split is a silent **fail-open**, the entry and the
`scanLine` docstring both call the split fail-closed, and only the fail-closed face is pinned —
against the oracle module's own written rule "where a shape has two faces, pin both". That is the
sixth consecutive round in which this function shipped a comment describing the wrong shape, and
the class the lead named as the worst one (a grader author writes something unsafe on a
disclosure's authority).

Everything below is labelled `measured` or `reasoned`. Every mutation and every probe ran in a
`/tmp` copy made with `git archive <sha> | tar -x` and `node_modules` symlinked back. The live
repo was never touched: `git status --porcelain` empty before and after, head `28ad7f0`
(`measured`).

---

## Gates — re-run, not cited

| Gate | Result | |
| --- | --- | --- |
| `npm run typecheck` | exit 0 | `measured` |
| `npx vitest run` | 29 files / **351 passed**, 0 failed, 0 skipped | `measured` |
| `node src/cli/index.ts coverage` | exit 0, **0** `problem:` lines, `untaught concepts: 0` | `measured` |
| Banned syntax | none. Every `as` / `!` / `enum` / `namespace` hit in the three files is inside a comment or prose string; no parameter properties, no decorators. Grepped the whole files, not the diff | `measured` |
| `git status --porcelain` | empty before; **`M package.json`, `M package-lock.json` after — not mine, see below** | `measured` |

**Shared-tree mutation during this pass, flagged because it is the exact hazard the assignment
warns about.** At 01:02 another worker ran an install into `/home/daxtangco/rhcsa-trainer`, adding
`react`, `react-dom`, `@xterm/xterm`, `tailwindcss`, `vite`, `@vitejs/plugin-react`, `jsdom`,
`@testing-library/{dom,react}` and the React types — i.e. **Task 24's dependency set**, which the
context file lists as "not installed; Task 24 owns them". I did not run `npm install`, did not touch
either file, and made no edit anywhere under the repo except this review (which is inside gitignored
`.superpowers/`, `\.gitignore:7`). **I have not reverted it** — it is not mine to revert, and Task 24
is presumably mid-flight.

It does bear on my evidence, because my `/tmp` copies symlink the shared `node_modules`. The install
floated `typescript` **5.8 → 5.9.3** inside its `^5.8.0` range; `vitest` stayed **3.2.7**. I re-ran
both compile-time gates against `/tmp/rr6/base` afterwards: **typecheck exit 0, 29 files / 351
passed, 0 failed, 0 skipped** — unchanged. So every measurement in this review stands. Nothing else
in this pass reads `node_modules`; the differential probes shell out to `/bin/bash` and import
`session.ts` through Node's native TS stripping.

### Six invariants — **unmoved** (`measured`)

Standalone and as `assertLib + grade.sh`, both columns identical:

```
assert.sh  standalone=0 prepended=0
019        standalone=8 prepended=8
014        standalone=5 prepended=5
017        standalone=5 prepended=5
028        standalone=5 prepended=5
006        standalone=8 prepended=8
```

---

## Mutation results (`measured`)

Per-row id-set comparison over all 117 `ORACLE_CASES`, plus both instruments under vitest. The one
persistent `SETDF` row in the raw output is `r3-separator-inside-quoted-id`, which carries a
legitimate `counterIds` override; my raw harness ignores overrides, the real gate honours it, and
the suite is green at `28ad7f0`.

| Mutant | Edit (verified as the literal single edit by `diff`) | Dies? | Discriminates? |
| --- | --- | --- | --- |
| **M-R** | `:292` `carried.quote, carried.quote === '"' \|\| carried.ansiC)` → `carried.quote, carried.ansiC)` | **yes**, both instruments | **yes** — exactly the 6 H-family rows, nothing else |
| **M-S** | `:465` `if (open !== undefined && quoted === undefined) {` → `if (open !== undefined) {` | **yes**, both instruments | **yes** — exactly the 5 A-family rows, nothing else |
| **M-T** | `:292` … → `carried.quote, true)` | **yes**, both instruments | **yes** — exactly **one** row, `carried-sq-keeps-backslash` |

M-R is a **faithful single-token revert**: `diff` shows the `quote` argument untouched and only the
`escapes` argument changed. The implementer's story about discarding a first attempt that also
altered `quote` is consistent with what shipped (`measured` on the artifact; the discarded attempt
itself is unauditable and I did not try to reconstruct it).

One nuance on M-T's "both instruments": at unit-test granularity M-T and M-R kill the *same* test
name (`honours an escaped quote inside a run that was already open…`), just different assertions
inside it. The oracle is what separates them by row. The claim is true; "both instruments" is doing
less work than it sounds like.

### Vacuity: does any promoted row survive reverting both edits?

**Yes — 7 of the 16.** M-RS (both edits reverted, one file, two lines) kills exactly the 6 H-family
+ 5 A-family rows; the 5 controls and 2 unrelated rows survive. That is what a control is for, so I
went further and asked whether each control discriminates *anything*:

| Control | Sole killer of | Verdict |
| --- | --- | --- |
| `carried-sq-keeps-backslash` | **M-T** | load-bearing |
| `carried-ansi-c-escaped-quote` | **M-U** (`carried.quote === '"'`, i.e. drop the `\|\| carried.ansiC` term) | load-bearing |
| `carried-dq-escaped-backslash` | nothing — M-V (`\` escapes only the quote char) is also killed by the pre-existing `r1-double-backslash-before-close`; both call sites share one `closingQuote`, so there is no carried-only backslash path to protect | redundant |
| `heredoc-body-suppressed-with-no-open-quote` | nothing — **shape-duplicate** of the pre-existing row at `checkpoint-oracle.ts:295` (`cat <<EOF` / `ck heredoc-id` / `EOF` / `ck real-id`), differing only in ids | vacuous |
| `heredoc-body-suppressed-after-closed-quote` | no single-token mutant of the shipped condition kills it alone; M-X (`quoted?.quote !== '"'`) is killed by `heredoc-opener-with-open-single-quote` instead | discrimination unproven |

All `measured`. No exact duplicate scripts in `ORACLE_CASES` (checked programmatically); the
duplication above is a shape duplicate.

---

## The six items

### 1. F2's unconditional precedence and the uncovered inverse nesting — **claim holds, and for a better reason than the report gives**

The report's justification is **factually wrong** (`measured`). It says "`quoted` is never set while
a body is pending, so the shape does not arise through this code path today." Instrumenting the loop
gives an immediate counterexample — on `cat <<EOF; x="a` / `b" ; ck one "d" 0` / `EOF` /
`ck two "d" 0`:

```
[trace] pending=0 quotedSet=false body=false line="cat <<EOF; x=\"a"
[trace] pending=1 quotedSet=true  body=false line="b\" ; ck one \"d\" 0"   <-- both at once
[trace] pending=1 quotedSet=false body=true  line="EOF"
```

The **actual** reason the inverse nesting cannot arise is stronger and is exactly what the lead
asked for: a heredoc body line **never reaches `scanLine`**, because the body branch at
`session.ts:465-473` `continue`s before the call. So body text can never open a carried quote. That
is a structural property of the code, not a statement about the contents of `content/`, so it does
**not** decay as the bank grows from 5 graders to 28 chapters (`reasoned`, from a one-line control-flow
fact; corroborated below).

And bash agrees with the code on the whole family — because bash does not lex a heredoc body for
quotes either. **15 inverse-nesting and interleaving probes, 0 differ** (`measured`): body holding an
unterminated `"`; body holding an unterminated `'`; body whose quote would swallow the delimiter
line (`say "hi` / `EOF"` / `EOF`); body whose quote closes after the delimiter; a `ck` inside a body
that also opens a quote; two openers with a carried quote across them; two openers on one line with
a carried quote; a quote that closes and reopens while a body is pending; an opener that falls
*inside* a carried run; `<<-` with a carried quote; a quoted delimiter with a carried quote; a
trailing-space delimiter with a carried quote; a second heredoc queued after the carried close; a
`ck` after the carried close on the same line.

**Disposition: no finding. Unconditional precedence is right, and the mechanism is structural.** The
report's stated reason should be replaced with the structural one, because the reason it gives is
the kind that expires and the real one does not.

#### 1a. The implementer's forwarded mechanism — structural half **confirmed**, inference half **over-claims**

The lead forwarded a second, sharper version of the argument and asked two specific questions.

**"`quoted` has exactly one assignment site, after the `continue`, so no other path can set it."
Confirmed (`measured`, by enumerating every read/write of the identifier in the file):**

| line | role |
|---|---|
| `:461` | `let quoted: OpenQuote \| undefined` — declaration, no initialiser |
| `:465` | read, in the body-branch guard `if (open !== undefined && quoted === undefined)` |
| `:474` | `continue` — inside that branch, **before** any write |
| `:479` | read, passed as `scanLine(raw, quoted)` |
| `:480` | `quoted = scanned.open` — **the only write** |

`open` itself has exactly three origins, all `return`s of `scanLine` (`:293` `open: carried`,
`:395` `open: { quote: ch, ansiC }`, `:410` `open: undefined`). There is no aliasing, no closure
capture, no destructuring write, and no second loop. So: **no other path can set `quoted`, and a
line consumed as heredoc body cannot set it at all.** That much is exactly as claimed.

**"Therefore the state pair has exactly one producer, and that is the A-family." The first clause is
right; the second is wrong (`reasoned` for the state machine, `measured` for the coverage).**

Write S for the pair *`pending` non-empty AND `quoted` set*, evaluated at the top of an iteration.
There are only two ways an iteration ends, so all transitions are enumerable:

- Top state (pending non-empty, `quoted` undefined) → body branch → `continue`. Neither variable is
  written. **S is unreachable from here.** This is the clause that kills the inverse nesting.
- Otherwise `scanLine` runs, and afterwards S holds iff `scanned.open !== undefined` **and**
  (`pending` was already non-empty **or** `scanned.heredocs` is non-empty).

So S is *entered* only by one `scanLine` call returning a non-empty `open` together with a non-empty
`heredocs` — one physical line that both queues a heredoc and leaves a quote open. That is the
implementer's point and it holds. **But S is not confined to that line.** The second disjunct means
S *persists*, and while it persists the pair can be recomposed: a later line may close the carried
run and open a different one, and may queue further heredocs, so the precedence rule can end up
arbitrating a quote that was never on the opener line and a body that was never the opener's body.
The A-family's five rows do not contain that arrangement, nor several others the grammar admits.

I built the whole producer class instead of trusting the enumeration. **18 further probes against
real bash; 17 agree on both id set and count, 1 differs on id spelling only** (`measured`):

- **Not in the A-family, all AGREE:** `$'…'` as the carried quote — the third quoting form, and the
  one F1's `escapes` term exists for (`cat <<EOF; x=$'a` / `b'` / `EOF` / `ck`); the same with an
  escaped `\'` inside; `$'…'` with `<<-`; three heredocs pending at once; the **second** delimiter
  swallowed by the run (`cat <<A <<B; x="a` / `A` / `b"` / `B` — both sides emit nothing); a `"…"`
  delimiter word; S entered on a continuation line while `pending` was empty at the start of the
  quoted run (`x="a` / `b" ; cat <<EOF; y="c` / `d"` / `EOF` / `ck`); the same with `$'…'`;
  **S recomposed** — carried run closes and a *new* quote plus a *new* heredoc open on the same line
  (`cat <<A; x="a` / `b" ; cat <<B; y='c` / `d'` / `A` / `B` / `ck`); openers behind `|`, `||`,
  `{ }` and `( )`; two quotes on the line after the opener; a quote that never closes before EOF
  (both sides emit nothing).
- **One count-neutral divergence, and it is not a finding:** `cat <<EOF; ck "real-id` / `x"` / `EOF`
  / `ck two-id "d" 0`. Bash's checkpoint id is the literal two-line string `real-id\nx`; the counter
  records `real-id`. **Cardinality agrees (2 = 2)**, and `countCheckpoints` returns only a size, so
  nothing downstream can see the difference. A checkpoint id containing a newline is also not a
  shape any grader author would write. Noted for completeness because the oracle compares id sets,
  and a future reviewer running this shape will see a `SETDIFF` that means nothing.

**Net for the lead's two questions.** No other path can set `quoted` — confirmed at the source, and
it is a control-flow property that does not decay with the bank. A single line *can* produce
arrangements the A-family does not cover, and I found at least nine, of which the `$'…'` carried
quote and the recomposed pair are the two that touch live code paths F1 and F2 respectively.
**Every one of them agrees with bash**, so the gap is in the *evidence*, not the behaviour: the five
A-family rows pin one arrangement of a class with at least ten, and the report presents the class as
if the rows exhausted it. That is a weaker version of the same problem as **F-F** (weak controls),
not a new defect. The implementer's named re-opening condition — a future change routing body lines
through `scanLine` — is the correct one, and I would add a second: any change that makes `quoted`
writable outside `:480`, since the whole argument rests on that single assignment.

### 2. The 16 promoted rows and 2 unit tests — **not 18 rows, and three of the five controls are weak**

`ORACLE_CASES` went **101 → 117: 16 rows**, not 18 (`measured`). Composition is 6 H-family +
5 A-family (A6 = `heredoc-delimiter-swallowed-by-open-quote`, correctly labelled fail-closed) +
**5** controls, not 7. `ORACLE_DIVERGENCES` 4 → 7. Tests 349 → 351 (+2) is correct. See finding
**F-E**; see the vacuity table above for the controls.

### 3. A6 and the zero-checkpoint hole — **the headline worry is refuted; the real hole is one step to its left**

`allPassed()` at `verdict.ts:81` is `v.checkpoints.length > 0 && v.checkpoints.every(pass)`. So the
pure zero case is **not** a false pass (`measured`, calling `reportFor` directly):

```
expectedTotal 0, grader emitted 0  -> {passed:0, total:0, incomplete:false, allPassed:FALSE}
expectedTotal 3, grader emitted 0  -> {passed:0, total:0, incomplete:true,  allPassed:false}
```

`expectedTotal === 0` is indeed **indistinguishable** from "no checkpoints were reached" on
`GradeReport` — the implementer is right about that — but a grader that silently grades nothing is
reported as a **fail**, not a pass. So item 3 does not outrank the lexer work.

#### 3a. "The false pass requires a PARTIAL collapse" is **wrong**, and it is the third ruling built on a mis-stated mechanism

The lead asked me to run their three rows through `reportFor` rather than read the code, and to say
so loudly if the middle row did not reproduce. **The middle row reproduces exactly. The
generalisation drawn from the three rows does not.** All rows below are `measured` through
`reportFor` at `28ad7f0`:

```
lead row 1: real 8, counter 0, 0 arrived        -> incomplete=false  allPassed=false
lead row 2: real 8, counter 1, that 1 passed    -> incomplete=false  allPassed=TRUE   <== false pass
lead row 3: real 8, counter 8, 1 arrived        -> incomplete=TRUE   allPassed=false
--- rows the three above do not cover ---------------------------------------------
            real 8, counter 0, 1 arrived+passed -> incomplete=false  allPassed=TRUE   <== false pass
            real 8, counter 0, 2 arrived+passed -> incomplete=false  allPassed=TRUE   <== false pass
            real 8, counter 0, 1 arrived+FAILED -> incomplete=false  allPassed=false
            real 8, counter 0, all 8 arrived    -> incomplete=false  allPassed=true   (correct, by luck)
            real 8, counter 2, 3 arrived+passed -> incomplete=false  allPassed=TRUE   <== false pass
```

A **total** collapse to 0 with one passing arrival is a false pass. So `allPassed` is not "the
backstop against a *total* collapse" — it is the backstop against **zero arrivals**, which is a
property of the *run*, not of the count. The collapse magnitude does not gate the false pass; it sets
the **threshold** `incomplete` compares against, and a lower threshold is strictly worse. A collapse
to 0 is the widest possible hole, not the safe one: it disarms `incomplete` for *every* nonzero
arrival count.

The correct mechanism, stated once so it can replace the wrong one everywhere it propagated:

> `incomplete` is the only guard against a grader that stopped part-way. It is disarmed whenever
> `expectedTotal <= arrivals`. A lexical collapse lowers `expectedTotal`; whether the grader also
> stopped part-way is an independent event. The false pass is exactly
> **`arrivals >= expectedTotal` AND `arrivals >= 1` AND every arrival passed AND `arrivals < real total`**.

The lead's row 1 conflates the two independent events — "counter collapsed to 0" *and* "nothing
arrived" — and it is the second conjunct alone that saves it. And the brief's sentence is wrong in a
narrower and more specific way than "wrong about the mechanism": **"died on its first command" is the
single arrival count `allPassed` catches.** Died on its *second*, having passed the first, is a false
pass. Measured end-to-end on a real collapse rather than a synthetic `expectedTotal` — an eight-`ck`
grader with `limit=$((` / `1 << 2 ))` at line 5, which is finding **F-A**'s shape:

```
real ck lines = 8   countCheckpoints = 2
  dies after ck one   (1 arrival, passing)  -> incomplete=true   allPassed=false
  dies after ck two   (2 arrivals, passing) -> incomplete=false  allPassed=TRUE   <== FALSE PASS
  dies before emitting anything             -> incomplete=true   allPassed=false
  runs to completion, all 8 pass            -> incomplete=false  allPassed=true
  runs to completion, ck five fails         -> incomplete=false  allPassed=false
```

Note the first row: a collapse to **2** still catches a 1-arrival death. A collapse to **0** would
not. That is the whole of it — deeper collapse, wider hole.

What *is* load-bearing is the adjacent case, and it is worse than the report frames it — see
finding **F-D**. `npm run validate` does catch a zero-emitting grader (`harness.ts:125`
`checkVerdict` pushes `verdict A: grader emitted no checkpoints`, applied to every fixture including
the `no-action` baseline), but only with a VM. `inventoryGate` is unrelated to checkpoint counts —
it counts solutions and anti-solutions — and, as the lead said, is only entered into `results` when
it fails (`harness.ts:308`).

### 4. The three new disclosures — **one of the three has the wrong direction for the class it names**

- `deprecated-arith-read-as-heredoc`: the mechanism sentence is accurate (`measured` — the counter's
  delimiter really is `2]`: adding a `2]` line recovers the count), and the refutation of round 5's
  "widening can only fail closed" argument is stated plainly as required. **But its reachability
  framing understates the class by a wide margin** — finding **F-C**.
- `subst-depth-resets-across-newline`: its pinned pair is correct, but its generalising prose and the
  new `scanLine` docstring paragraph both assign the class a direction that measurement refutes —
  finding **F-A**, the reason for the verdict.
- `continuation-glues-word-onto-ck`: `measured` correct in both direction and mechanism
  (`echo a\` + `ck real-id` → bash [], counter [real-id]; `true \` + `ck real-id` the same). Its
  prose fix to `continuation-between-ck-and-id` is `measured` correct too: `: \` and
  `test -f /etc/hosts \` both agree. One loose word — "all ten trailing-`\` lines in the counted
  text fall after a `ck` id, inside `ck_fail` and `printf` argument lists". There are exactly ten
  (`measured`: assert.sh 2, 017 1, 014 7), but `assert.sh:45` and `:48` are `printf` *format
  strings* inside the `ck` function body, not positions after a `ck` id. The material claim — no
  trailing `\` is followed by a line beginning with `ck`, so neither continuation shape is reachable
  — holds (`measured`, checked line-by-line). Not a finding; noted so nobody re-derives it.
- Unchanged disclosures re-verified (`measured`): `command-prefix-before-ck-negation` — all four
  named shapes are UNDER at `28ad7f0` (`! ck`, `LC_ALL=C ck`, `time ck`, `eval 'ck …'`);
  `brace-list-containing-ck` and `unquoted-sed-delimiter-holding-ck` unchanged and still directional
  as written. The `scanLine` docstring's "Every one of those is a silent **under**-count" is accurate
  for the five shapes it lists.
- F2's replacement docstring is **independently confirmed** (`measured`): bash emits only `real-id`,
  and `printf 'x=[%s]\n' "$x"` gives `x=[a⏎ck inside d 0⏎b]`. The docstring now records the
  measurement correctly.

### 5. F6 and F7 in-place report corrections — **F7 correct; F6 substantively right, still under-specified**

Both block quotes exist at the offending sentences (report lines 1419-1436 and 1471-1478).

**F7 — correct as written (`measured`).** Adding `!` to `CK_CALL`'s anchor class (`[;&|{()]` →
`[;&|{()!]`) makes `! ck real-id "d" 1` agree with bash, leaves `LC_ALL=C ck`, `time ck` and
`eval 'ck …'` all still UNDER, moves no invariant (8/5/5/5/8/0 unchanged), and leaves all 117
`ORACLE_CASES` agreeing. The only test that changes is the divergence pin for
`command-prefix-before-ck-negation`, which is that pin doing its job — it would need promoting. So
"three fail-opens, of which one closes for one character" is exactly right.

**F6 — see finding F-G.** M-P and M-Q reproduce verbatim, including the failure text the report
quotes. M-O's discriminating claim holds, but only under a fuller revert than the report's stated
edit describes.

### 6. F1's duplication — **there is a third call site, and it is already wrong**

The `lexBash` extraction is parked (P18) and I am not re-litigating it. I will say once that the
extraction is the right whole-branch move, and the reason is finding **F-B**: this is no longer a
latent drift shape with two instances, it is a **measured** drift with three call sites computing
`escapes` three different ways, one of which is a silent fail-open today. Two instances is a
pattern; three with a live defect is a defect the parking rationale was not written against.

Nothing else in this function is duplicated-by-necessity in the same manner (`measured`): `scanLine`
has exactly one call site, and no other helper in `session.ts` is called from more than one place
with a locally recomputed argument. `src/engine/disclosure/content.ts`'s twin `scanLine` is out of
scope by ruling.

---

## Findings, ranked by whether they can produce a wrong truth-claim to a student on the bank as it exists

### F-A — `subst-depth-resets-across-newline` assigns the wrong direction to the class it names; the fail-open face of the lifetime split is unpinned

**Severity: high (as a disclosure defect). Direction: the unpinned face is silent `under` — fail-open.
Introduced by this commit. Reaches the bank today: no. Load-bearing: not against today's bank; the
*wording* is load-bearing for the next grader author, which is this task's most-repeated defect
class.**

`measured`:

```
x=$((
1 << 2 ))
echo $x
ck real-id "d" 0
```

bash → `x=4`, reaches line 4, emits `real-id`. `countCheckpoints` → **0**. The trace shows why: on
line 2 `arith` has reset to 0, `<<` is read as a heredoc opener with delimiter `2`, and every
remaining line becomes body.

```
[trace] pending=0 ... line="x=$(("
[trace] pending=0 ... line="1 << 2 ))"
[trace] pending=1 ... body=true line="echo $x"
[trace] pending=1 ... body=true line="ck real-id \"d\" 0"
ids: []
```

`(( x =` / `1 << 2 ))` is the same, `measured`. bash confirmed independently: `x=4`,
`REACHED-LINE-4`.

The entry's `why` generalises over both pieces of state — "The `$( )` and `(( ))` nesting depths are
locals of `scanLine` and reset on every line" — and then concludes "**Fail-closed.**" The new
`scanLine` docstring paragraph goes further: "`subst-depth-resets-across-newline` **pins what that
costs**." It pins one third of what it costs. The `arith` third is a silent under-count that
collapses `expectedTotal` to 0, which is the direction the entry's framing rules out, and the
module docstring's own rule for this exact situation is "where a shape has two faces, pin both."

Reachability, `measured`: no multi-line `$(( ))` or `(( ))` in the counted text, so nothing today.
But `$(( ))` / `(( ))` appear **six times** in the counted text, including a `for (( i = 0; … ))` in
`assert.sh`, which is prepended to every grader in the bank. That makes this class strictly more
plausible than `$[ ]`, which the same list calls "the lowest in this list".

### F-B — `heredocDelimiter` is a third `closingQuote` call site with a third `escapes` formula, and the drift is measured, not latent

**Severity: medium. Direction: both faces measured; the fail-open one is `under`. Pre-existing.
Reaches the bank today: no. Load-bearing: no.**

Three call sites, three formulas (`measured`):

- `session.ts:190` (`heredocDelimiter`): `closingQuote(slice, i + 1, ch, ch === '"')` — no ansiC term
- `session.ts:292` (carried prologue): `carried.quote === '"' || carried.ansiC`
- `session.ts:380` (main loop): `ch === '"' || ansiC`

bash **does** apply ANSI-C quote removal to a heredoc delimiter word (direct bash measurement:
`<<$'EOF'` → delimiter `EOF`; `<<$'EO\'F'` → `EO'F`; `<<$'EOF\tX'` → `EOF<TAB>X`). `heredocDelimiter`
models none of it, and has no `dollar` state to model it with — it is a separate function over a
slice, so a real fix has to pass that state in. Measured divergences:

| Shape | bash | counter | Direction |
| --- | --- | --- | --- |
| `cat <<$'EOF'` / `ck phantom` / `EOF` / `ck real-id` | `[real-id]` | `[]` | **under, silent fail-open** (counter's delimiter is `$EOF`) |
| `cat <<-$'EOF'` / `<TAB>ck phantom` / `<TAB>EOF` / `ck real-id` | `[real-id]` | `[]` | **under, silent fail-open** |
| `cat <<$'EO\'F'` / `ck phantom` / `EOF` / `ck real-id` | `[]` | `[phantom, real-id]` | over, fail-closed |
| `cat <<$'EOF'` / `ck phantom` / `$EOF` / `ck real-id` | `[]` | `[real-id]` | over, fail-closed |

### F-C — five *current-syntax* arithmetic contexts holding `<<` are silent fail-opens; the disclosure frames the class as deprecated-only

**Severity: medium. Direction: `under`, silent fail-open. Pre-existing. Reaches the bank today: no.
Load-bearing: no.**

All `measured`, bash `[real-id]` vs counter `[]`:

- `a=(1 2 3 4 5); echo ${a[1 << 1]}`
- `i=1; echo ${a[i << 1]}`
- `declare -a a; a[1 << 1]=x`
- `s=abcdefgh; echo ${s: 1 << 1}`
- `echo ${s:0:1 << 1}`
- `a=([1 << 1]=x); echo ${a[2]}`

None is deprecated; all are current bash. `deprecated-arith-read-as-heredoc`'s closing sentence —
"`$[ ]` has been deprecated since bash 2 and measured absent from `content/`, so the reachability is
the lowest in this list" — is true of `$[ ]` and invites the reader to file the whole `arith` gap as
a museum piece. `assert.sh` already uses `${s:i:1}` and `${BASH_REMATCH[1]}` (`measured`), so the
syntactic forms are in the counted text; only a `<<` inside one is missing. Controls agree
(`$(( 1 << 2 ))`, `(( 1 << 2 ))`, `<<<`, `>>`, `let x=1\<\<2`, `$(( $[1 << 2] ))`).

### F-D — at `expectedTotal === 0` the guard is fully disarmed and the over-arrival backstop is off by design; one injected line takes a real bank grader from 8 to 0

**Severity: high as a consequence amplifier (it has no defect of its own — it is what every
fail-open in F-A/F-B/F-C cashes out to). Direction: false pass. Reaches the bank today: no.
Load-bearing: the mechanism, yes; the trigger, not today.**

Every unterminated-heredoc fail-open in this function discards *every remaining line*, so it does
not deflate `expectedTotal` — it zeroes it (`measured`):

```
  8  baseline 019/grade.sh
  0  019 + `echo ${a[1 << 1]}` inserted at line 5
  0  019 + `cat <<$'EOF'`      inserted at line 5
  0  019 + `echo $[1 << 2]`    inserted at line 5
  8  assert.sh + 019 (baseline)
  0  assert.sh with one `echo ${s: 1 << 2}` line + 019
```

The last row is the one that matters: a single line inside `assert.sh` — prepended to **every**
grader in the bank — takes 019 from 8 to 0.

And at 0, `reportFor` is not merely wrong by a bit, it is inverted (`measured`):

```
expectedTotal 0, emitted 1 pass  -> {passed:1, total:1, incomplete:FALSE, allPassed:TRUE}  + console.warn
expectedTotal 0, emitted 2 of 8  -> {passed:2, total:2, incomplete:FALSE, allPassed:TRUE}  + console.warn
```

Any nonzero prefix of passing checkpoints from a grader that died reports **`allPassed: true`**. The
only signal is a server-side `console.warn`, because `reportFor` deliberately refuses to fail a
grade on over-arrival — a decision that is correct in general and maximally costly at zero. Worth
the lead's attention as a candidate cheap guard for the whole-branch review: `expectedTotal === 0`
is never a legitimate state for a task in the bank, and refusing to create a session at 0 would
convert the entire fail-open class into a loud failure.

### F-E — the report's mandate-3 arithmetic is wrong

**Severity: low, documentation. No student-visible direction. Load-bearing: no.**

`measured`: 16 rows promoted (101 → 117), not 18; 6 H + 5 A + **5** controls, not 7. The `+2` unit
tests and the 349 → 351 test delta are correct. The context file inherited the wrong number, so the
overstatement has already propagated once.

### F-F — one promoted control is a shape-duplicate of a pre-existing row; two more are weak

**Severity: low, coverage. No direction. Load-bearing: no.** Detail in the vacuity table above.
`heredoc-body-suppressed-with-no-open-quote` adds nothing that `checkpoint-oracle.ts:295` did not
already assert.

### F-G — F6's stated edit is still under-specified, and "green (2/2)" is false under the narrow reading

**Severity: low, documentation. No direction. Load-bearing: no — but it is a milder recurrence of
the very defect F6 was told to fix.**

`measured`:

| State | test 1 (`ORACLE_CASES`) | test 2 (`ORACLE_DIVERGENCES`) |
| --- | --- | --- |
| M-O at `28ad7f0` | **red**, 115 of 117 rows named | **red** |
| M-O + case gate reverted to `rows.filter(r => r.bash !== r.counter)` | green | **red** (`zz-phantom` leaks into the divergence id sets) |
| M-O + all three f65d0a4 cardinality forms reverted (case gate, divergence pin `{name, bash, counter}`, in-loop `sameIds`) | green | green |

So the substance holds — M-O is a genuine compensating pair, cardinality-invisible, and the id-set
gate is what catches it. But "the gate reverted to the `f65d0a4` cardinality form" is three
assertions, not one, and under the natural narrow reading the "green (2/2)" claim is false. F6 was
the finding about naming a mutant by effect instead of by a fully specified edit.

### F-H — the report's stated reason for item 1's uncovered case is factually wrong

**Severity: low, documentation — but it inverts the news. Load-bearing: no.** Detail under item 1.
The report's reason ("`quoted` is never set while a body is pending") has a measured counterexample;
the true reason (body lines never reach `scanLine`) is structural rather than content-dependent, so
the gap does *not* decay as the bank grows.

### F-I — two smaller unpinned divergences, both fail-closed

**Severity: low. Direction: `over`, loud. Pre-existing. Reaches the bank today: no. Load-bearing: no.**

`measured`:

- `cat <<"EOF` / `EOF"` / `ck real-id "d" 0` → bash `[]`, counter `[real-id]`. Same with `<<'EOF`. An
  unterminated quote *inside the delimiter word*: `heredocDelimiter` returns `undefined` so no body
  is queued, then the main loop carries the quote and counts the line after it closes.
- `cat <<EOF; echo a\` / `EOF` / `ck real-id "d" 0` → bash `[]`, counter `[real-id]`. The
  continuation moves bash's body start one line later, so the counter consumes the delimiter early.

### F-J — the wrong-mechanism sentence shipped into the oracle module as a comment; **it is not in `session.ts`, and the lead is looking in the wrong file**

**Severity: medium as documentation — the sixth occurrence of the N5/R7/N9 false-disclosure class,
and this one is the sentence a future round would act on. Direction: none of its own. Reaches the
bank today: n/a. Load-bearing: no, but it is the artefact that turns a corrected mechanism back into
an uncorrected one.**

The lead reports that the brief's wrong sentence "propagated into the F1 code comment". `measured`,
it did not: `session.ts:286-292` stops at *"the walk stays inside the string, and every remaining
line of the grader is discarded"*, which is **accurate**. The commit message is also clean — it says
"silent fail-opens that discard every remaining line of a grader" and never states the `incomplete`
mechanism. The one place in the tree that carries it is the **H-family header comment this commit
added to the oracle module**, `test/server/checkpoint-oracle.ts:530-532`:

> *"The direction is the bad one: the walk stays **inside** the string, so `expectedTotal` collapses
> toward 0, `incomplete` goes false, and a grader that died on its first command reports the lab
> passed."*

Per §3a that final clause is **false**: at a collapse to 0, a grader that died on its first command
reports the lab **failed**, because `allPassed`'s `length > 0` guard fires. The claim is true of a
grader that died on its *second* command. So the comment overstates in the one direction this task
cannot afford — it tells a future reader that the zero case is already the worst case, when the zero
case is the single arrival count that is safe and every other one is not.

This matters more than a normal comment defect for the reason item 4 gives: `checkpoint-oracle.ts` is
the file a future lexer author reads to learn what the failure modes are, and its own stated rule is
"where a shape has two faces, pin both." Three surviving copies of the sentence outside the source
tree — `task-23-fix-6-exception.md:26-27`, `task-23-rereview-5.md:311-312`, `progress.md:6323` — are
already annotated as wrong at `whole-branch-parked.md:368-369`; the code comment is not.

### Noted, not a finding

`ck "real-id` / `more" 0` — bash emits the id `real-id⏎more`; the counter declares `real-id`
(`measured`). Cardinalities agree, so `expectedTotal` and `incomplete` are both correct and there is
no runtime consequence. It would fail the oracle's id-set gate if anyone promoted it as an
`ORACLE_CASE`, so it belongs in neither list as it stands.

---

## What I could not break

For the record, since the lead asked me to assume a sixth defect exists in the shipped edits: I
could not find one. Across 89 differential probes beyond the table, the two shipped edits agreed
with bash on every shape I could construct that exercises them — carried `"`/`'`/`$'…'` runs over
one, two and three lines; escaped quotes, escaped backslashes and `#` inside carried runs; quotes
that close and reopen; heredocs opened inside carried runs; `<<-`, quoted, spaced, trailing-space
and swallowed delimiters against a carried run; two and three pending bodies with a carried run
across them; and the entire inverse-nesting family. The three defects I did find are all *outside*
the two edits: one in a comment this commit added (F-A), one in a third call site the commit did not
touch (F-B), one in a disclosure's reachability framing (F-C). That is consistent with the
implementer's own concern #1: the edits are fine, and the artefacts around them are where this task
keeps bleeding. **F-J is the fourth** and it is the same shape again — a comment this commit added,
stating a mechanism that measurement contradicts.
