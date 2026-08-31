# Task 25 — scoped re-review of fix rounds 1 and 2

Range `ccdba26..7880164` (`fe4b051` round 1, `7880164` round 2). Every conclusion below is
labelled `measured` or `reasoned`. All mutation work was done in `/tmp/t25rr` (a
`git archive 7880164 | tar -x` copy) and `/tmp/t25fe` (the same from `fe4b051`), with
`node_modules` symlinked back. The working tree was never mutated.

## Verdict: CHANGES REQUIRED

Thirteen of thirteen guards landed and **all thirteen bite** — every one was suppressed and
its test watched to die (`measured`). The seven round-1 items and the six round-2 rules are
all real, all derived from `bank.tasks` as instructed, and all three unrequested rules close
holes I reproduced at `fe4b051`. The report's numbers are accurate wherever I could check
them, including the three claims it had most to gain from.

It does not clear, on one finding in the section the brief singled out as its own blind
spot. `--allow-empty` does not suppress any of the six rules when each is tripped
individually (`measured`, ten mutations, exit 1 with and without the flag). But
`checkFixtureFloors` is reached only through `if (graders.length > 0)`, so in the one state
the flag exists to bless — zero graders — **every bank-derived rule becomes unreachable**,
and a content root whose bank still declares five tasks exits **0** with empty stderr. Rule
5 would have fired on all five. That is F1's own lesson behind the escape hatch, and the
comment defending the short-circuit states something measurably false. Both are one small
fix.

---

## Round 1 — seven items

| # | Item | Landed | Test bites |
|---|---|---|---|
| 1 | F1 zero-grader guard | yes | yes — suppressed, **exactly one** test died |
| 2 | F2 `ids` → `declared` with `id@phase` | yes | yes — suppressed, **3** tests died |
| 3 | F4 two lost checks restored | yes | n/a — checklist item, verified structurally |
| 4 | F5 `toHaveLength(5)` + pinned id | yes | cannot execute (VM-gated); `5` is derivable |
| 5 | F6 four `†` rows + footnote | yes | n/a — documentation |
| 6 | F7 `3 / 5` reattributed to check 9 | yes | n/a — documentation |
| 7 | F8 669 not 577 | yes | n/a — documentation |

### 1. F1 — the count is exactly one (`measured`)

Deleting the `graders.length === 0 && opts.allowEmpty !== true` push (`src/cli/lint.ts:429`,
rewritten to a throwaway array push so control flow is untouched) and running the full
suite: `Tests 1 failed | 422 passed (423)`. The one death is
`rhcsa lint fails when there is nothing to check > exits non-zero with a named problem on a
content root holding no grade.sh`. One and not zero means the guard is load-bearing; one and
not more means nothing depended on the old behaviour. Claim confirmed exactly.

### 2. F2 — all three phases survive as distinct rows (`measured`)

Fixture counts, measured against the committed file: `git diff --numstat` gives **81/81**;
**21** rows; **26** `declared` fields (= 26 headers); **0** stale `"ids"`; **7** `@post`
across **6** headers; **48** `@both`; **0** `@pre`. The 5 phase-less entries are exactly the
5 `unprobed-invariant` headers, which is the documented grammar (`parseUnprobed` splits on
commas and nothing else), not a leak.

Because committed content carries no `@pre`, I tested the round trip rather than reading it.
Rewriting one shipped header to `# expect-fail: fs-home-size@pre, home-from-lv@post,
persist-config@both` and running the lint prints:

```
  expect-fail: fs-home-size@pre, home-from-lv@post, persist-config@both
```

Three phases, three distinct suffixes, no collapse, exit 0 (correct — the header is legal
either way, which is why the fixture has to be the thing that notices). And the phases are
semantically distinct downstream, not merely printed distinctly: `expectedStatus` gives
`pre` = (fail, pass), `post` = (pass, fail), `both` = (fail, fail) across verdicts A and B.
**No phase collapses into another. F2 is closed on all three, not just `@post`.**

Suppression: reverting `declared` to bare ids killed **3** tests — the golden fixture drift
test, the pre-existing `prints the inventory it checked` test (now asserting `@both`), and
the new `prints the @phase of every declared checkpoint` test. Matches the report's three.

### 3. F4 — recount: 15 of 15 (`measured`)

I parsed `docs/exit-criterion.md` mechanically rather than reading it. The mapping table has
12 rows; expanding `9-11` and `12-13` yields check numbers 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15
— **15 distinct numbers, 1 through 15, none missing and none duplicated.**

Every target resolves. The eight `"The run" item N` targets all resolve against real
numbered items (items 1-8 exist). The three named-section targets all resolve against real
`##` headings: `## Second manual scenario, not yet run`, `## Fourth: reset, not yet run`,
`## Third: the foreign-origin refusal check, not yet run`.

The part that matters more — the fragments are **inside** their items, not merely somewhere
in the file. I bounded each item by the next item's line number and tested containment:

- item 1 contains `picker`, `chapter`, `ch15`, `ch22`, `supporting`, `TaskPicker.tsx:63-65`
  — all six inside.
- item 8 contains `derived`, `self-reported`, `App.tsx:281` — all three inside.

Adjacent-but-not-inside, F4's actual failure mode, does not occur.

**Second broken cross-reference: none found** (`measured`). Every numeric item reference in
the whole file is one of the eight mapping-table rows, and all eight are correct after
renumbering. The intro's "question 4 below" is gone, replaced by a reference by name. There
is no other `item N` / `question N` anywhere in the document.

### 4. F5 — `5` is derivable, and from two committed places (`reasoned` on `measured` inputs)

The test is VM-gated and has never executed, so this is a prediction. It is a sound one.
`content/tasks/storage/014-grow-home-lv/grade.sh` emits exactly five distinct checkpoint ids
via `checkpointIds` — `fs-home-size`, `home-from-lv`, `lv-home-size`, `persist-config`,
`var-intact` — and `fs-home-size` is among them (`measured`). The same five are independently
pinned as the `emitted` array for that grader in `test/fixtures/content-headers.golden.json`,
which an executing test compares. So both `toHaveLength(5)` and `toContain('fs-home-size')`
are derivable from committed content and are cross-checked by a gate that does run.

Residual risk, stated rather than hidden: the number is the count of ids the grader *emits*,
and the assertion is on the count the final report *reveals*. Those coincide only while the
report carries one entry per emitted checkpoint. That is a prediction about the report
shape, not about content, and it cannot be settled without a VM.

### 5. F6 — it was four, not five (`measured`)

`git show ccdba26:docs/exit-criterion.md | grep -c 'asserted by the e2e test'` = **4**, at
rows 4, 5, 7 and 8. There was no fifth row. The original finding said "five rows say
'asserted by the e2e test'" and over-counted by one; the fix marked all four that exist, so
the coverage is complete rather than short. The count changed because the finding was wrong,
not because the fix missed a row — the citation-proves-something-adjacent shape, occurring
in the review rather than in the fix.

The disclosure wording says what it means and is not the wrong-disclosure class: "**† The
assertion exists; it has never executed.** … is excluded unless `RHCSA_VM=1`, and no VM
exists, so a `†` row has a *written* assertion rather than a passing one." That is accurate,
it names the mechanism, and it states the condition for the marker to mean what the column
header implies. Seven `†` glyphs total: four table rows plus three in the footnote text.

### 6. F7 — correct (`measured`)

The new sentence reads "check 1's task count, check 7's `5 / 5`, check 9's partial `3 / 5`
tally in exam mode, and check 8's specific rating". Row 7 of the mapping table is
`F4 → reboot wait, then 5/5 named` and rows 9-11 are exam-mode masking, so `3 / 5` belongs
to check 9 and `5 / 5` to check 7. Each prediction is now attributed to the check that
carries it.

### 7. F8 — 669 confirmed (`measured`)

Assembling the rung-3 body the way `src/engine/disclosure/content.ts:253` does —
`concepts.map(c => '## ' + c.title + '\n\n' + c.body.trim()).join('\n\n---\n\n')` — over
014's two required concept cards gives length **3669**, a margin of **669** over the 3000
floor. Trimmed card bodies are 1811 and 1766; `1811 + 1766 - 3000` = **577**, which is
exactly the superseded figure. Both numbers reproduced; 669 is right and the stated reason
for the discrepancy (the two `##` heading lines and the `\n\n---\n\n` separator) is the
whole of it.

---

## Round 2 — six rules

| Rule | Landed | Test bites | Kill set |
|---|---|---|---|
| 1 `antisolutions/` absent (and misspelled) | yes | yes | **2** |
| 2 below `MIN_ANTISOLUTIONS` | yes | yes | **2** (shared site with rule 3) |
| 3 below `MIN_SOLUTIONS` | yes | yes | **2** (shared site with rule 2) |
| 4 non-`.sh` under `antisolutions/` | yes | yes | **2** (shared site with rule 4′) |
| 4′ non-`.sh` under `solutions/` | yes | yes | **2** (shared site with rule 4) |
| 5 `grade.sh` required of every bank task | yes | yes | **1** |
| 6 graders reconciled back to the bank | yes | yes | **1** |
| — bank-did-not-load | yes | yes | **1** |

### Kill sets: 2, 2, 2, 1, 1, 1 across nine distinct tests — confirmed (`measured`)

Each guard's `problems.push` was rewritten to a throwaway array push, one at a time, and the
**full** suite re-run:

| guard site | tests that died |
|---|---|
| `:352` rule 1, absent directory | 2 — `catches a missing antisolutions/`, `catches antisolutions/ misspelled` |
| `:359` the floors (rules 2 + 3) | 2 — `below MIN_ANTISOLUTIONS`, `below MIN_SOLUTIONS` |
| `:362` non-`.sh` (rules 4 + 4′) | 2 — `a fixture renamed off .sh`, `a solution renamed off .sh` |
| `:334` rule 5, `grade.sh` | 1 — `reports a missing grade.sh from the bank` |
| `:379` rule 6, reconciliation | 1 — `reports a grader no bank task owns` |
| `:453` bank-did-not-load | 1 — `says so loudly when the bank will not load` |

Nine tests, all distinct, no shared kill. One correction to the brief's framing, which the
implementer's own table gets right: the six suppressible guards are not the same set as
"rules 1-6". Rules 2 and 3 are one code site parameterised over a `dirs` array, as are rules
4 and 4′, and the sixth row is the bank-did-not-load guard, which is not one of the numbered
rules. Rule 6 has its own site and its own single test.

**The sharing is not a coverage gap, which I checked rather than assumed** (`measured`).
Deleting the `solutions` entry from the `dirs` array killed 2 tests (`below MIN_SOLUTIONS`,
`a solution renamed off .sh`); deleting the `antisolutions` entry killed 4. So either half of
the parameterisation is independently guarded, which is stronger than the report claimed.

One suppression killed nothing: `:343`, the `unreadable` arm of `scanFixtureDir`, has **no
test** (`measured` — 423 passed with it suppressed). It fails closed, so there is no false
green in it. Noted below rather than raised as a finding.

### The `fe4b051` "before" column reproduces exactly (`measured`)

Every one of the report's before-figures, re-run from a clean `/tmp/t25fe`:

| mutation | at `fe4b051` | claimed | inventory vs baseline |
|---|---|---|---|
| `antisolutions/` removed | exit 0, 18 rows | 0, 18 | differs |
| renamed `antisolutons/` | exit 0, 18 rows | 0, 18 | differs |
| both of 006's anti-solutions removed | exit 0, 19 rows | 0, 19 | differs |
| one of 014's solutions removed | exit 0, 21 rows | 0, 21 | **byte-identical** |
| `03-wrong-lv.sh` → `.sh.bak` | exit 0, 20 rows | 0, 20 | differs |
| 006 solution → `.disabled` | exit 0, 21 rows | 0, 21 | **byte-identical** |
| 014's `task.yaml` removed | exit 0, 21 rows | 0, 21 | **byte-identical** |
| `grade.sh` **and** `antisolutions/` | exit 0, 17 rows | 0, 17 | — |

**Rule 3's convenient claim holds** — the one the brief flagged for extra scrutiny because it
retroactively settles a refused argument. Removing one of 014's two solutions at `fe4b051`
gives exit 0 with an inventory **byte-identical** to the unmutated one. Solutions carry no
headers, so they cannot appear in a header inventory; the golden-fixture defence was not
merely insufficient here, it was **unavailable**. The claim survives scrutiny in full, and
the same is true of rule 4′ and rule 6.

### Rule 1 and 2's exact messages (`measured`)

Rule 1 exits 1 on `tasks/storage/014-grow-home-lv: antisolutions/ is missing. loadTaskScripts
swallows the readdir failure, …`, and the `antisolutons` misspelling produces the **identical**
string, as claimed — the directory the loader wants is gone either way. Rule 2:
`tasks/users/006-team-provisioning: needs at least 1 anti-solution, found 0`. Rule 3:
`tasks/storage/014-grow-home-lv: needs at least 2 solutions, found 1`. `MIN_SOLUTIONS` and
`MIN_ANTISOLUTIONS` are imported from `harness.ts` in both source and tests, and the tests
both assert against the imported value and pin the number.

### Both negative assertions are real, not vacuous (`measured`)

The brief asked me to confirm the `not.toMatch(/needs at least/)` half of the rule-4 and
rule-4′ tests. I raised `MIN_ANTISOLUTIONS` and `MIN_SOLUTIONS` to 3 in a `/tmp` copy. Both
tests then failed **specifically on the negative**:

```
→ expected 'problem: tasks/selinux/019-httpd-alt-…' not to match /needs at least/
```

So the negative fires. Its real value is scenario integrity: it pins that the rename leaves
the count above the floor, so the test keeps testing rule 4 rather than silently becoming a
second floor test if content counts or the floors ever move.

The double-deletion test's `not.toMatch(/no sibling grade\.sh/)` is also real, though the
report describes its role loosely. At `7880164`, deleting only `grade.sh` and **keeping** the
anti-solutions yields 3 `no sibling grade.sh` messages alongside 1 rule-5 message
(`measured`). So if the `rm -rf antisolutions` half of the plant ever failed to land, the
negative would fire — it is a mutation-did-not-land guard, which is exactly the right instinct
here. What the report calls "the load-bearing half" is more precisely: the *positive*
assertion is what discriminates rule 5 (the string exists only in rule 5's message, and
suppressing rule 5 kills the test), and the negative proves the old interlock's trigger
condition was genuinely absent. Both are worth keeping; the wording overstates which one
carries the proof.

### The double-deletion hole: closed (`measured`)

At `fe4b051`, `rm 014/grade.sh` + `rm -rf 014/antisolutions` → exit **0**, 17 rows, empty
stderr. Both halves gone, both silent, exactly as reported. At `7880164` the same mutation →
exit **1** with two problems:

```
problem: tasks/storage/014-grow-home-lv: storage/014-grow-home-lv is in the bank but has no grade.sh, so nothing about this task was checked
problem: tasks/storage/014-grow-home-lv: antisolutions/ is missing. loadTaskScripts swallows the readdir failure, …
```

and no `no sibling grade.sh`. The implementer's one-sentence judgement is correct: rule 1
fires on the anti-solutions being *absent* and the orphan message on them being *present*, so
before rule 5 the two covered the space only jointly and each rested on the other half's
files. Cosmetic only: the rule-5 message duplicates the path — `tasks/storage/014-grow-home-lv:
storage/014-grow-home-lv is in the bank …` — because `where` is the relative directory and
`task.id` already contains `area/task`.

### The bank-will-not-load behaviour (`measured`)

The brief asked three things about it. Exit code is **1**. `graders checked: 5` and `scripts
with headers: 21` do print, on stdout, while the problem goes to stderr. And critically, the
reassuring summary line is **withheld**: `grep -c 'no problems' stdout` = **0**, because
`no problems in N grader(s)` is emitted only on the exit-0 path.

So "could not check" does not read as "clean": there is no clean verdict anywhere, and the
exit code a CI step reads is 1. The count does sit on a different stream from the problem,
which means a log capturing only stdout shows `graders checked: 5`, 21 rows and the notes
with no verdict at all — ambiguous rather than reassuring. Minor, noted below.

---

## `--allow-empty` against the six new rules

**It suppresses none of them when each is tripped individually** (`measured`). Ten mutations,
each run twice:

| mutation | plain | `--allow-empty` |
|---|---|---|
| rule 1, `antisolutions/` absent | 1 | **1** |
| rule 1, misspelled `antisolutons/` | 1 | **1** |
| rule 2, anti-solution floor | 1 | **1** |
| rule 3, solution floor | 1 | **1** |
| rule 4, non-`.sh` anti-solution | 1 | **1** |
| rule 4′, non-`.sh` solution | 1 | **1** |
| rule 5, one `grade.sh` gone | 1 | **1** |
| rule 6, `task.yaml` gone | 1 | **1** |
| bank will not load | 1 | **1** |
| all five `grade.sh` gone | 1 | **1** — but see below |

The last row exits 1 for the wrong reason, and pulling that thread produces the finding
below. The flag's blast radius is not the six rules; it is the reachability of the block that
holds them.

---

## Findings

### NEW-1 — `--allow-empty` makes every bank-derived rule unreachable, silently

**Severity: Medium. Direction: false green on the bank. Load-bearing: yes for the flag's
stated scope and for the report's claim about it; no for the shipped bank or current CI.**

`checkFixtureFloors` is reached only inside `if (graders.length > 0)` (`src/cli/lint.ts:431`).
Zero graders is precisely the state `--allow-empty` exists to bless, so in that state every
one of rules 1-6 is skipped — not overridden, never run.

`measured`, on a copy of the real bank with all five `grade.sh` **and** all five
`antisolutions/` removed, `task.yaml` and `solutions/` left in place so the bank still loads
and still declares five tasks:

```
$ node src/cli/index.ts lint --content <root> --allow-empty
content root: <root>
graders checked: 0
scripts with headers: 0

no problems in 0 grader(s)
exit=0    stderr empty
```

Rule 5 would have fired on all five tasks. The `no problems in 0 grader(s)` line is the
reassuring count the round exists to eliminate, printed by a gate that ran zero of its own
rules over a bank that declares five tasks. Without the flag this root exits 1 on the F1
message — so the flag is doing the suppressing, and the ten-mutation table above shows why it
looked clean: every individual rule trip leaves at least one grader standing, which keeps the
block reachable.

This contradicts the report's "`--allow-empty` … does not suppress any rule added here." That
is true rule-by-rule and false as a general statement, which is the shape the brief warned
about: a disclosure whose wording is wrong, in the artifact the next author will trust.

The composition needed to reach it is narrow — an explicit operator flag plus every grader
gone — so it is not reachable from `npm run lint:content`, which passes no flag. It is still
the one hole the brief predicted, in the one place it predicted it.

**Fix, small:** load the bank and run `checkFixtureFloors` whenever the root is readable,
independent of grader count. `--allow-empty` then means what it says — "zero graders is
expected here" — and stays honest, because zero graders is only legitimate when the bank
declares no tasks either, and rule 5 is exactly the rule that knows the difference.

### NEW-2 — the comment defending the short-circuit states something measurably false

**Severity: Low as code, Medium as disclosure. Direction: false green on the bank.
Load-bearing: yes — it is the reason the next author will keep the short-circuit.**

Above `if (graders.length > 0)`:

> The floors are per-task, so a root the walk found no graders in has no task to iterate —
> and that case already has its own single, actionable message above.

Both halves are false. A root the walk found no graders in can have five tasks to iterate
(`measured`, NEW-1). And that case has its own message only when `--allow-empty` is absent;
with the flag there is no message at all. The sentence infers a property of the bank from a
result of the walk, which is the precise defect class this round closed one level up. Fix it
with NEW-1; leaving the comment while fixing the code would be worse than leaving both.

### NEW-3 — the reconciliation bottoms out on a walk, and that walk can go silent

**Severity: Low-Medium. Direction: false green on the bank. Load-bearing: no for Task 25 —
rule 6 is strictly better than what preceded it — but the floor should be named and carried.**

Answering the brief's "push one level further". Rule 6 reconciles the grader walk against
`bank.tasks`, and `bank.tasks` comes from `loadBank` →
`findFiles(join(root,'tasks'), 'task.yaml')` → `readdir(root, {recursive: true})`. Both
directions of the reconciliation are therefore derived from walks of the **same tree**, so a
mutation that removes a task *entirely* is invisible to both at once.

`measured`, deleting `content/tasks/storage/014-grow-home-lv` outright:

```
lint exit=0   stderr empty
graders checked: 4
scripts with headers: 17
no problems in 4 grader(s)
```

Where the floor holds and where it does not:

- **`content/tasks/` itself gone** — not silent, exit 1 (`measured`). Though it reports via
  F1's zero-grader message, not via `loadBank`'s `cannot read directory`, because the
  short-circuit fires first.
- **One whole task gone** — silent in `rhcsa lint`. Caught by the golden-fixture drift test,
  which fails on `expected 17 to be greater than 20` (`measured`), so the anti-vacuity floor
  catches it before the `toEqual` even runs. That is the gate-resting-on-a-gate defence the
  brief rejected as insufficient for F1 — but unlike F1 and rule 3, here the fixture defence
  is genuinely *available*.
- **`coverage --strict` cannot help.** It is already red on the shipped bank — exit 1, 58
  uncovered objectives (`measured`) — so it does not discriminate. `coverage` without
  `--strict` is exit 0 both ways. Neither form is a floor here.

There is no manifest enumerating which tasks must exist, so the honest statement is: the
reconciliation bottoms out at "the set of `task.yaml` files a recursive `readdir` found under
`content/tasks/`", and for a whole-task deletion that floor goes silent in the lint's own exit
code while remaining visible to the vitest suite.

### Minor notes, not blocking

- The `unreadable` arm of `scanFixtureDir` (`:343`) is the only `problems.push` in
  `checkFixtureFloors` with **no test** (`measured` — suppressing it kills nothing). It fails
  closed, so no false green.
- Rule 5's message duplicates the task path (`tasks/storage/014-grow-home-lv:
  storage/014-grow-home-lv is in the bank …`). Cosmetic.
- In the bank-did-not-load state the count sits on stdout and the problem on stderr. The
  exit code is 1 and no clean verdict is printed, so this is not a false green; a stdout-only
  log is merely verdict-less. Echoing a `problems: N` counter to stdout would close it.

### Correction to the brief, for the whole-branch review

The brief states that exactly one `as` cast survives repo-wide, at `src/web/api.ts:201`.
`measured`: that is true **of the web layer** — the comment there reads "The one cast in the
web layer" — but repo-wide there are 9 casts in `src/` (`engine/content/concept.ts:36`,
`engine/content/objectives.ts:70`, `engine/content/task.ts:54,96,101,108`,
`engine/grading/verdict.ts:29`, `engine/vm/config.ts:54`, `web/api.ts:201`) and roughly 35
`as ContentError` casts in `test/`. None is in this diff: **the diff introduces zero casts**
(every `as` on an added line is prose in a comment), and there is **no `as unknown as`
anywhere in the repo**. Flagged so the whole-branch review does not inherit the wrong number.

---

## Gates — run, not cited

| Gate | Result |
|---|---|
| `npm run typecheck` | exit **0** |
| `npx vitest run` | **423 passed / 35 files / 0 skipped** — no skip line in the summary |
| `npm run build:web` | exit **0** (the >500 kB chunk warning is the accepted one) |
| `npm run lint:content` | exit **0**, **stderr empty** |
| `enum` / `namespace` / decorators | none |
| parameter properties | none |
| non-null `!` | none |
| `as unknown as` | none |
| `as` casts | see correction above; **zero introduced by this diff** |
| `git tag -l` | **empty** — correct, the `phase-1` tag is the user's |
| `git status --porcelain` | **empty** before and after |

### Scope and restore integrity

Seven files touched, and **none** of the out-of-scope paths: no `src/server/session.ts`, no
`src/engine/grading/`, no `content/lib/assert.sh`, no `content/`, no `objectives.yaml`
(`measured`, `git diff --name-only`). `src/engine/validate/harness.ts` is touched for the two
exports **only** — the complete change is `const` → `export const` on `MIN_SOLUTIONS` and
`MIN_ANTISOLUTIONS` plus a six-line doc comment, nothing else (`measured`, full hunk).

All content rules pass the committed bank unchanged: `lint:content` exit 0 with empty stderr,
and a test states it rather than leaving it implicit. **No content file was touched** by the
range. Fixture counts verified independently: solutions 2/2/2/2/3 (11 files), anti-solutions
5/3/3/3/2 (16 files), zero non-`.sh` entries under any fixture directory (`measured`).

Restore verified byte-identically by sha256 across all seven files — git `7880164`, the
`/tmp/t25rr` copy after every mutation, and the working tree all agree. `/tmp/t25rr/content`
diffs clean against the tree after the one experiment that mutated it. HEAD is
`7880164aa3eb41d0ce8c4b644eee995f2fea63cd`.

### Out-of-scope confirmations

The parked fourth channel (**P32**) was **not** fixed, as required: `# unproved-invariant:`
in 014's grader gives exit **0** with empty stderr and demotes `var-intact` to an
informational note (`measured`). `setup.sh` validation, F3/F9/F10 and everything in
`whole-branch-parked.md` are untouched and unreported here.

---

## Ruling on the three unrequested rules — all three justified, keep all three

Unrequested changes are the highest-risk category on this project, so I judged each against a
hole I reproduced myself rather than against its rationale.

**Rule 4′ (`.sh` rule on `solutions/`) — justified.** The arithmetic checks out against real
counts (`measured`): 006 is the only task with three solutions, so renaming one leaves exactly
`MIN_SOLUTIONS` = 2 and no floor fires. At `fe4b051` that mutation gave exit 0, 21 rows, and a
**byte-identical** inventory — neither the floor nor the fixture caught it. A live hole for one
task in five, closed by a rule symmetric with rule 4 at no added cost, with a biting test whose
negative assertion I confirmed fires.

**Rule 5 (`grade.sh` required of every bank task) — justified, and the most valuable of the
three.** It closes the double-deletion hole, which I reproduced at `fe4b051` (exit 0, 17 rows)
and confirmed closed at `7880164`. Before it, the `grade.sh` direction rested on the
anti-solutions being present, so both halves of the interlock could vanish together in silence.
The one caveat is NEW-1: the rule is unreachable at zero graders.

**Rule 6 (reconcile graders back to the bank) — justified, and the sharpest thing in the
round.** Removing 014's `task.yaml` at `fe4b051` gives exit 0 with a byte-identical inventory
(`measured`): the task simply left the list that drives every other rule while its grader kept
being header-checked and its fixtures were counted by nobody. That is the same defect one level
up, correctly identified by the implementer against its own instruction to derive from the bank.
Its floor is NEW-3.

All three derive from `bank.tasks`, none touches content, each has a test that bites, and each
closes a hole demonstrated by measurement rather than argued from principle. This is the good
case of an implementer extending a mandate.

---

## To clear the verdict

One fix, two lines of consequence: run `checkFixtureFloors` whenever the content root is
readable rather than only when `graders.length > 0`, and correct the comment that currently
justifies the short-circuit with a false claim (NEW-1, NEW-2). Add the assertion that is
missing today — `--allow-empty` on a root whose bank declares tasks but has no `grade.sh` must
exit 1 — because without it the fix is unguarded in exactly the way this round was about.

NEW-3 wants a ruling rather than a fix, and belongs to the whole-branch review: the
reconciliation bottoms out on the `task.yaml` walk, a whole-task deletion is silent in the
lint's exit code, and the only gate that discriminates it is the golden-fixture drift test.
