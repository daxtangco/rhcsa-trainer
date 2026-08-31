# Task 25 — re-review of fix round 4 (`45344bd..4312359`)

**Verdict: APPROVED.**

Items 1, 2 and 3 all landed. All four claimed mutants reproduce with exactly the claimed kill counts and
exactly the claimed assertions. The eight-row item-1 table reproduces row for row. The four-row residual
table reproduces row for row. The item-3 rule fires on none of the sixteen committed anti-solutions, and it
handles all seven stripper edge cases the brief names. The single highest-value check — whether the false
comment had propagated verbatim into `test/cli/lint.test.ts` — **confirms round 4 is right**, and the quoted
text is exact.

Two low-severity findings, both in the *disclosure* class, neither load-bearing, neither justifying round 5.
One further measured widening outside the eight-row table, which I rule correct behaviour rather than a
defect.

## Method

All measurement in `/tmp` copies, never the shared working tree:

- `git archive 4312359 | tar -x -C /tmp/rr3new`, `git archive 45344bd | tar -x -C /tmp/rr3old`,
  `node_modules` symlinked back into each.
- Baseline sha256 matches round 4's stated hashes exactly:
  `f47f368a…` / `3d883730…` (`4312359` `lint.ts` / `lint.test.ts`),
  `2b0480f5…` / `20ba7db9…` (`45344bd`). Independent confirmation of its restore discipline.
- Pristine copies in `/tmp/rr3new/.pristine/`; after every mutation the file was restored and
  sha256-re-verified back to `f47f368a…`. Verified again at the end of the review.
- Fixture roots in `/tmp/rr3roots`, `/tmp/rr3strip`, `/tmp/rr3extra` — outside both trees.
- `/home/daxtangco/rhcsa-trainer`: `git status --porcelain` empty before and after; `git tag -l` empty
  before and after; `HEAD` still `4312359`. Nothing committed, merged, pushed or tagged. No VM operation,
  no `sudo`, no `.env.local`, no `npm run validate`, no `npm run test:vm`, no subagent, nothing read under
  `/home/daxtangco/sechelp-tools`.
- Every conclusion below is labelled `measured` or `reasoned`.

## Gates

| gate | result |
|---|---|
| `npm run typecheck` | exit 0 — `measured` |
| `npx vitest run` (`4312359`) | **433 passed / 35 files / 0 failed / 0 skipped**, exit 0 — `measured` |
| `npx vitest run` (`45344bd`) | **431 passed / 35 files**, exit 0 — baseline independently confirmed, so +2 is real — `measured` |
| `npm run build:web` | exit 0 (`run_in_background`; only the pre-existing 500 kB chunk warning) — `measured` |
| `npm run lint:content` | exit 0, **stderr 0 bytes**, `no problems in 5 grader(s)`, `graders checked: 5`, `scripts with headers: 21` — `measured` |

Skip count is 0 and not merely absent: `grep -ic 'skip\|todo'` over the whole vitest log returns **0**, and
the summary line reads `Tests 433 passed (433)` with no skipped bucket. `measured`.

`git tag -l` is empty. `measured`.

## Anchors

Verified before citing. `lint.ts`: guard `:569` ✓, `isFile` `:312` ✓, item-2 clause `:496-500` ✓ (the
`in common` line is `:498`), `changesNothing` `:222` ✓, applied at `:670` ✓.
`test/cli/lint.test.ts`: the twin comment at `:585` before / `:650` after ✓ (the `it(` line is `:584` /
`:650`; the comment body starts one line later).

Two anchor slips in the report, neither in code, neither with any consequence: `SHELL_OPTION_LINE` is at
**`:211`**, not `:213`; and the P32 site is `parseUnprobed` at **`:130`** (`return { ids: [], declared: [],
problems: [] }` when the header is absent), not `:159` — `:159` is inside the `nonLiteralIds` doc comment.
`measured`.

## Item 1 — NEW-3

**Landed. The test bites.**

Code, `src/cli/lint.ts:569`:

```ts
if (graders.length > 0 || (await isFile(join(root, 'objectives.yaml')))) {
```

Exactly the expected one-line widening. `isFile` is the round-3 `stat`-based helper at `:312`.
`measured` from source: **no walk was added, none substituted, `files.length > 0` was not used.** The only
walk-derived facts in the condition are `graders.length`, which was already there.

### Part A — the eight-row table, reproduced

All eight roots rebuilt from scratch and run against both `/tmp/rr3old` (`45344bd`) and `/tmp/rr3new`
(`4312359`). `--allow-empty` on every row except the committed bank. All `measured`.

| root | old (`45344bd`) | new (`4312359`) | required | verdict |
|---|---|---|---|---|
| bare directory (`mkdtemp` + `tasks/`) | exit 0, 0 problems, 0B stderr | exit 0, 0 problems, 0B | exit 0 preserved | ✅ |
| round 1's `emptyRoot()` (`tasks/…/setup.sh`, no bank file) | exit 0, 0 problems, 0B | exit 0, 0 problems, 0B | exit 0 preserved | ✅ |
| bank loads, zero tasks (valid `objectives.yaml`, empty `tasks/`, empty `concepts/`) | exit 0, 0 problems, 0B | exit 0, 0 problems, 0B | exit 0 preserved | ✅ |
| stripped bank + broken `objectives.yaml`, 0 graders | exit **0**, 0 problems, **0B** | **exit 1**, 1 problem, 268B — `missed comma between flow collection entries (2:8)` with the quoted source line | exit 1, parse error reported | ✅ |
| stripped bank + `concepts/` deleted, 0 graders | exit **0**, 0 problems, **0B** | **exit 1**, 1 problem, 258B — `cannot read directory …/concepts: ENOENT` | exit 1, reported | ✅ |
| `tasks` is a regular file | exit **0**, 0 problems, **0B** | **exit 1**, 1 problem, 219B — `ENOTDIR: not a directory, scandir …/tasks` | exit 1, reported | ✅ |
| stripped bank (loadable), 0 graders | exit 1, **10** problems, 1946B | exit 1, **10** problems, 1946B | unchanged | ✅ |
| committed bank, no flag | exit 0, `graders checked: 5`, `scripts with headers: 21` | exit 0, identical | unchanged | ✅ |

### Part B — named path, not a walk

**Confirmed: a fixed named-path check.** `isFile(join(root, 'objectives.yaml'))` is a `stat` on one
literal path. There is no `readdir`, no `shellScripts`, no `bank.tasks` and no `files.length` anywhere in
the condition or in `isFile`. The weaker `files.length > 0` was not substituted, and the reason is correct:
`emptyRoot()` at `test/cli/lint.test.ts` (old `:279-288`) writes a `setup.sh`, so `files.length` is 1
there, and that root must keep exiting 0 — which it does (row 2). `measured` from source and by
measurement.

### Part C — the replacement comment

Read adversarially, claim by claim, against the code rather than the diff's narrative.

Claims that check out, all verified:

- `--allow-empty` asserts zero graders, and its own message says so — true; the guard is
  `graders.length === 0 && opts.allowEmpty !== true` at `:486` and its text is quoted accurately.
  "forty lines above" is approximately right (`:487` to `:528`).
- `emptyRoot()` contains a `setup.sh` and no bank file — true, `measured` against `45344bd`.
- "A present but unreadable `objectives.yaml` does report: `stat` succeeds, so `isFile` is true" — true,
  `measured` (row 4 of the residual table below).
- The named-path-vs-walk paragraph states Part B's distinction correctly and warns against exactly the
  wrong turn.
- **The residual is stated, explicitly, and every claim in that paragraph reproduces.** See below.
- **Both wrong versions are recorded as wrong, numbered, with a measurement against the second, and
  neither historical note misstates what its version said.** `measured`:
  - version 1's quote `"a root the walk found no graders in has no task to iterate"` is a verbatim
    substring of `7880164:src/cli/lint.ts:435-436`;
  - version 2's quote `"when --allow-empty says an unauthored root is expected, an unloadable bank is that
    assertion being true rather than a defect"` is verbatim `45344bd`;
  - the measurement quoted against version 2 (five tasks declared, every `grade.sh` deleted, one YAML typo
    → exit 0 / 0 problems / stderr 0 bytes under `--allow-empty`) is row 4 of the eight-row table, old
    column: reproduced exactly.

**One claim that is false — FINDING 1, below.** "The rules ran unconditionally above and nothing here can
suppress them."

### The residual, reproduced

Stripped bank (five `task.yaml`, five `setup.sh`, `concepts/` intact), 0 graders, `--allow-empty`. All
`measured` on `/tmp/rr3new`.

| `objectives.yaml` is… | claimed | measured | verdict |
|---|---|---|---|
| deleted | exit 0, 0B | exit **0**, 0 problems, **0B** | ✅ |
| a directory | exit 0, 0B | exit **0**, 0 problems, **0B** | ✅ |
| a broken symlink | exit 0, 0B | exit **0**, 0 problems, **0B** | ✅ |
| present but `chmod 000` | exit 1, 250B | exit **1**, 1 problem, **239B** — `EACCES: permission denied, open …/objectives.yaml` | ✅ |

The 239 vs 250 bytes is path-length: the message embeds the absolute root twice and my root path is
shorter than round 4's `/tmp/t25f4-roots/…`. Not a discrepancy.

**Do I accept the residual as adequately disclosed?** Yes, with the caveat in FINDING 1. Row 1 — an
authored, grader-less bank whose `objectives.yaml` was deleted, silently exit 0 — is named in the comment
in those terms, with the two adjacent shapes (directory, broken symlink), and with the honest framing that
the channel is narrowed from *any loader failure* to *the discriminator is itself the thing that is
missing*. I do **not** think row 1 needs more than a comment inside Task 25's scope: closing it requires
an independent record that a bank was meant to exist at this root, and the only such artifact is the
committed expected-task-id manifest already parked as the honest fix for **P33**. That is a new artifact,
not a guard, and it belongs to the whole-branch budget. "Add a walk" is ruled out by item 1's own
paragraph, and I agree with that ruling.

### The Part-A regression question — the direction nobody had measured

**Answer: no, and structurally it cannot.** `reasoned` from source, `measured` on the two roots that fit
the question exactly.

The widened condition sits inside `catch (e)` on `await loadBank(root)` (`:512-573`). If the bank loads,
the `catch` body never executes, so the new arm is never evaluated and cannot print anything. "The bank
loads fine" and "the new arm runs" are mutually exclusive by construction.

Measured confirmation on the two roots where `objectives.yaml` exists and the bank loads fine:

| root | old | new |
|---|---|---|
| committed bank (objectives.yaml present, loads, 5 graders) | exit 0, 0 problems, 0B | exit 0, 0 problems, 0B |
| valid `objectives.yaml`, empty `tasks/`, empty `concepts/` (loads, zero tasks) | exit 0, 0 problems, 0B | exit 0, 0 problems, 0B |

No false fail on a good root. The nearest thing to a widening is FINDING 3 below, which is a root where the
bank does **not** load.

## Item 2 — NEW-4

**Landed. Comment only, and correctly claims no kill count.** I am the gate, as round 4 says, and I read it.

New clause at `lint.ts:496-500`:

> `bank.tasks` … is the one input every rule in `checkFixtureFloors` has **in common** — not the only input
> any of them reads: `graders` is a second one, read by the `grade.sh` rule and iterated by the orphan
> reconciliation at the end.

**True under both readings.** `measured` from source:

- Every rule in `checkFixtureFloors` reads `bank.tasks`: the `grade.sh` rule, the `setup.sh` rule and the
  fixture-directory scan all iterate `for (const task of bank.tasks)`; the orphan reconciliation reads
  `new Set(bank.tasks.map((t) => t.dir))` at `:435`. So "in common" is exact.
- `graders` is genuinely a second input: read at **`:375`** (`!graders.has(join(task.dir, 'grade.sh'))` —
  the `grade.sh` rule) and iterated at **`:435`** (`for (const grader of graders)` — the orphan
  reconciliation). Both are what NEW-4 pointed at as `:346` and `:406` under `45344bd`; those two lines
  moved to `:375` and `:435` under this commit and **still describe exactly the same two constructs**.
  `measured` by diffing the old and new line numbers of both statements.

Round 4 correctly avoided putting line numbers in the comment itself, so this clause cannot go stale the
way the citation it replaces did. The claim "there is no mutant of it and no test that could hold it" is
correct: `changesNothing` aside, no assertion anywhere reads a comment.

## Item 3 — P35 shape A

**Landed. The test bites, and the kill is attributable.**

`SHELL_OPTION_LINE = /^set\s+[-+]/` at `:211`; `changesNothing` at `:222`; **exactly one call site**, at
`:670`, inside the loop that begins `if (!file.includes('/antisolutions/')) continue` at `:635`. Pure text
inspection: no guest, no verdict, no baseline run, no `harness.ts` in the diff.

### 1. Fires on none of the sixteen committed anti-solutions — confirmed, three ways

`measured`:

- `npm run lint:content` on the committed bank: exit 0, **stderr 0 bytes**. The rule pushes one problem per
  offending file, so 0 bytes is 0 firings.
- The loop genuinely ran on all sixteen, so this is not a vacuous pass: `grep -c 'antisolutions/'` over the
  printed inventory returns **16**, and `find … -path '*/antisolutions/*.sh' | wc -l` is **16**.
- Counted independently of the implementation, stripping comments/blanks/`set`-lines with `grep -vE`: the
  real-command count per fixture is `1, 1, 1, 3, 4, 4, 4, 6, 6, 12, 13, 13, 13, 13, 14, 14`. The three
  ones are exactly the three the brief names — `014/01-forgot-growfs.sh`
  (`sudo lvextend -L 12G /dev/rhel/home`), `014/03-wrong-lv.sh`
  (`sudo lvextend -r -L +4G /dev/rhel/root`), `017/02-faked-the-end-state.sh`
  (`sudo /usr/local/bin/rhcsa-stamp`) — and the other thirteen run 3 to 14, as claimed.

The authoring-order claim in the rule's comment is also true: `01-forgot-growfs.sh` is literally shebang,
explanatory paragraph, `# expect-fail:`, `set -euo pipefail`, command. `measured`.

### 2. The positive test's fixture carries a `# expect-fail:` header — confirmed

The planted body is `#!/usr/bin/env bash` / one comment / `# expect-fail: fs-home-size` /
`set -euo pipefail` / blank. The header is present and names an id the sibling grader really emits, and the
test asserts the adjacent rules stayed silent:

- `expect(r.err).not.toMatch(/must declare a "# expect-fail:" header/)`
- `expect(r.err).not.toMatch(/expect-fail names/)`
- `expect(countProblems(r.err, /01-forgot-growfs\.sh/)).toBe(1)`
- `expect(r.out).toMatch(/^ {2}expect-fail: fs-home-size@both$/m)` — the header was read, not skipped.

`measured`: under M3 and M4 the file contributes zero problems and the whole root exits 0, so the rule is
the sole reason it exits 1. Overwriting an existing fixture keeps the anti-solution count at 3, so the
fixture floors are not involved either.

### 3. The stripper — all seven edge cases handled

Fifteen probes, each a full bank copy with `01-forgot-growfs.sh` rewritten and the header kept intact, run
through the real CLI. All `measured`. "Fires" = the `nothing here but comments and shell options` problem
appears.

| # | probe | fires? | correct? |
|---|---|---|---|
| 1 | line that is only whitespace (`   \t  `) among no-op lines | yes | ✅ whitespace is not a command |
| 2 | trailing comment after a real command (`ls  # note`) | **no** | ✅ must not fire |
| 3 | `set -e` only | yes | ✅ |
| 3 | `set -eu` only | yes | ✅ |
| 3 | `set -o pipefail` only | yes | ✅ |
| 3 | `set +x` only | yes | ✅ (the `[-+]` clause) |
| 4 | `#!` shebang (+ header) only | yes | ✅ a shebang is not a command |
| 5 | real command with `#` inside a quoted string (`echo "# not a comment"`) | **no** | ✅ the risky direction, handled |
| 5 | comment containing a quoted `#` (`# says "hash # here"`) | yes | ✅ it is a comment |
| 6 | CRLF, all-no-op body | yes | ✅ `.trim()` eats the `\r` |
| 6 | CRLF, with a real command (`ls\r\n`) | **no** | ✅ both CRLF directions right |
| — | indented real command (`    ls`) | **no** | ✅ |
| — | `settings=1` (no whitespace after `set`) | **no** | ✅ the `\s+` is load-bearing |
| — | no trailing newline, command only | **no** | ✅ |
| — | **`set -euo pipefail; sudo lvextend -L 12G /dev/rhel/home`** on one line | **yes** | ❌ **FINDING 2** |

**All seven of the brief's named cases are correct.** The fifteenth probe is a false fire and is FINDING 2.

### 4. Solutions out of scope — confirmed

One call site, inside the anti-solutions-only loop. `measured`: a `solutions/` script rewritten to shebang
+ comment + `set -euo pipefail` gives exit 0, 0 problems, and the rule does not fire.

## Mutation results — all four reproduce exactly

Full-suite runs, one mutant at a time, restored and sha256-verified between each. All `measured`.

| mutant | claimed | measured | assertion that tripped |
|---|---|---|---|
| **M1** — `\|\| await isFile(...)` reverted | 1 kill, new item-1 test, on `r.code` | **1 killed / 432 passed**, `reports a bank that will not load at zero graders, which is the flag's own use case` | `test/cli/lint.test.ts:640:20` = **`expect(r.code).toBe(1)`**, `expected +0 to be 1` ✅ |
| **M2** — guard removed (`if (true)`) | 2 kills, round 1's and round 3's exit-0 tests, both on `expect(err).toBe('')` | **2 killed / 431 passed**: `exits 0 there when --allow-empty says the empty bank is expected` and `still exits 0 under --allow-empty on a root with no bank at all` | both `expected 'problem: …' to be ''` = **`expect(err).toBe('')`** ✅ reproduces Mutation F |
| **M3** — item-3 rule unreachable (`if (false && …)`) | 1 kill, on `r.code` | **1 killed / 432 passed**, `catches an anti-solution whose body is only comments, so it detects nothing` | `test/cli/lint.test.ts:238:20` = **`expect(r.code).toBe(1)`** ✅ |
| **M4** — `SHELL_OPTION_LINE.test(line)` dropped from the skip list | 1 kill, same test, same assertion; committed bank still exit 0 / 0B | **1 killed / 432 passed**, same test, same line `:238:20` | **`expect(r.code).toBe(1)`**; and `npm run lint:content` under M4: **exit 0, stderr 0 bytes** ✅ |

**On attribution, which is the named defect class here:** I agree with round 4's argument on M1. `:640:20`
is the *first* assertion after `const r = await lint(root, '--allow-empty')`, and it is on the integer exit
code, not on a message pattern — so the kill cannot be credited to a message match that happens to be
adjacent. The same holds for M3 and M4: `:238:20` is the first assertion in that test, on `r.code`, and the
`countProblems(...) === 1` assertion below it is what makes the *count* attributable rather than
coincidental. Four mutants, each changing exactly one thing, each with the tripped assertion named and
verified by line number. No adjacent-credit error in this round.

**Anti-weakening:** M2 is the check that matters for the widening, and it reproduces the re-reviewer's
Mutation F exactly — same count, same two tests, same assertion. The two exit-0 tests bite exactly as hard
after this change as before it, and neither was touched: the diff on `test/cli/lint.test.ts` has two hunks,
at `@@ -202,20 +202,60 @@` and `@@ -574,25 +614,54 @@`, and round 1's test at old `:300` is outside both
while round 3's appears only as unchanged context. `measured`.

## The propagated false comment — round 4's headline claim, and it is TRUE

`git show 45344bd:test/cli/lint.test.ts`, lines 584-588:

```
  it('does not let --allow-empty excuse a bank that will not load when graders exist', async () => {
    // The narrow half of the message rule: at zero graders an unloadable bank is the
    // flag's assertion being true, but with graders present the bank is a real bank
    // and no flag suppresses its failure to load. Widening that is the obvious wrong
    // turn, so it is pinned.
```

**Round 4's quote — "at zero graders an unloadable bank is the flag's assertion being true" — is verbatim
present**, modulo the line wrap. `measured`.

**And it is false**, for the reason item 1 establishes: `--allow-empty` asserts zero graders, not an
unauthored root. At zero graders an unloadable bank is not the flag's assertion coming true; it is an
orthogonal failure the flag says nothing about. Round 1's `emptyRoot()` and the stripped-bank rows in the
eight-row table are the two ends that prove it — one is legitimately silent, the other legitimately loud,
and both have zero graders.

So the wrong disclosure **had propagated into a second file**, and it survived three prior rounds and three
prior re-reviews of this task. That is the most important fact this round produced, it is a real instance of
this task's recurring sentence, and round 4 found it unprompted in a file it was allowed to touch but not
required to audit. Fixing item 1 in `lint.ts` while leaving this in place would have left the next reader an
authoritative false statement one file over — the exact failure mode the brief names. **The unrequested
scope was correct here.** The rewrite records the old claim as wrong and points at the new test as the other
half, which is the right treatment.

One accuracy note on how the report describes it — FINDING 4 below.

### The removed-lines claim — conclusive on two items at once, and it holds

Round 4's completion message asserts: *"The complete set of removed lines in the test file is the four
false comment lines and nothing else."* **True.** `measured`, straight from git rather than from the review
package:

```
$ git diff 45344bd..4312359 -- test/cli/lint.test.ts | grep '^-[^-]'
-    // The narrow half of the message rule: at zero graders an unloadable bank is the
-    // flag's assertion being true, but with graders present the bank is a real bank
-    // and no flag suppresses its failure to load. Widening that is the obvious wrong
-    // turn, so it is pinned.
```

Four lines, all comment, all inside the twin test. `git diff --numstat 45344bd..4312359` independently
gives `73 4` for `test/cli/lint.test.ts`, so four is the complete count and there is nothing outside that
listing. The full removal set across both files is 13 lines: those four, plus in `lint.ts` the two-line
item-2 clause, the six-line item-1 `catch` comment, and the single line `if (graders.length > 0) {`.

This settles two things at once, without further work:

- **The exit-0 tests cannot have been weakened**, because **nothing was removed from them at all** — not an
  assertion, not a helper, not a line of body. That is strictly stronger than the byte-identical sha256
  claims round 4 made for round 1's `describe` block and round 3's `still exits 0 under --allow-empty on a
  root with no bank at all`, so I did not re-derive those by hand. It also converges with M2 from the other
  direction: nothing removed, and both tests still kill a mutant.
- **The twin false comment was a four-line comment replacement, not a test edit.** The `it(...)` line, the
  `bankCopy()`, the `writeFile` and both assertions in that test are untouched context in the diff.

One trivial inconsistency, in round 4's favour on the claim that matters: the report's header line says
`src/cli/lint.ts (+118/-8)` and `test/cli/lint.test.ts (+77/-5)`. `git diff --numstat` gives **`109 9`** and
**`73 4`**. The `118`/`77` figures are `git diff --stat`'s *total changed lines* column (109+9, 73+4), not
insertions, and the `-8`/`-5` pair is an invented split of the correct 13 total. So the report's own header
disagrees with its stronger completion-message claim about the same file — and it is the **stronger claim
that is accurate**. Noted because this review is partly about citation discipline; it changes nothing, and
the same `+118/-8` notation appears in the review brief, so it is a shared convention slip rather than
something round 4 originated.

Also verified while I was there: the review package `review-45344bd..4312359.diff` differs from bare
`git diff 45344bd..4312359` only in context width — it was generated with a wider `-U`. Every `+` and `-`
line is identical. Reading the package rather than running `git diff`, as the brief instructs, loses
nothing. `measured`.

## The closing question — the `:375` symlink divergence

**Both ends reproduced.** `measured`, on a copy of the committed bank:

| substitution | result |
|---|---|
| `014-grow-home-lv/grade.sh` → symlink to a real script | **exit 1, `graders checked: 4`, 4 problems**: `storage/014-grow-home-lv is in the bank but has no grade.sh`, plus three `no sibling grade.sh` (`01-forgot-growfs.sh`, `02-removed-persistence.sh`, `03-wrong-lv.sh`) |
| `014-grow-home-lv/setup.sh` → symlink to a real script | **exit 0, 0 problems, `graders checked: 5`** |

Exactly as claimed, with the exact four messages. The mechanism is right: `shellScripts` filters on
`entry.isFile()` from `readdir(withFileTypes)`, which does not follow symlinks; `isFile` uses `stat`, which
does; and `loadTaskScripts` uses `readFile`, which follows — so `isFile`'s answer is the one matching the
runtime. **Identical on both `45344bd` and `4312359`**, so the divergence pre-dates round 4 and is not
introduced by it. `measured`.

**I accept the direction argument.** It is the sharpest reasoning in the report and it holds. NEW-1's shape
is a walk supplying the *expectation*, which makes the rule silently not fire — a false green nobody sees.
Here `bank.tasks` supplies the expectation independently and the walk supplies only the *observation*, so
an under-reporting walk makes the rule fire when it should not — a false fail, loud, and self-announcing.
Direction, not structure, separates them, and this site fails closed in every case I could construct.
`reasoned`. That makes it a parked item for the whole-branch review, **not a Task 25 blocker**, and per the
brief I do not treat it as a reason to fail this round.

Spot-check on the two sites round 4 records as clean, both sound:

- **`:436`, `taskDirOf(grader)` against `new Set(bank.tasks.map(t => t.dir))`** — two walk results compared
  to each other, no named-path fact involved, so not an instance of the interchange asked about. They agree
  by construction: `taskDirOf` is a pure string slice off a `shellScripts` path composed with `join` from
  `root`, and `task.dir` is `dirname(file)` off `findFiles(join(root, 'tasks'), 'task.yaml')` — same `root`
  string, `join` on both sides, no `realpath` and no renormalisation anywhere. `reasoned` from source, with
  `loadBank:103-105` and `taskDirOf:279-281` read directly.
- **`:639`, `emittedByTask.get(dirname(dirname(file)))`** — both sides derive from the same `files` walk, so
  they agree for the shape the bank uses. I reproduced the divergent case rather than taking it on trust: a
  nested anti-solution at `antisolutions/extra/09-nested.sh` gives **exit 1, 2 problems** — `antisolutions/extra
  does not end in .sh` from the fixture scan, and `no sibling grade.sh` for the nested file. Fails closed
  twice, exactly as claimed. `measured`.

## Findings

### FINDING 1 — the replacement comment asserts the floors ran, on the one path where they did not

**Severity: Low. Direction: understates a false-green residual to the next reader. Load-bearing: no.
Justifies round 5: no.**

`lint.ts:519-521`, inside the `catch`:

> This condition is about the **message**, not about the rules. The rules ran unconditionally above and
> nothing here can suppress them; all that is decided here is whether the loader's failure earns a line.

`checkFixtureFloors` is invoked at **`:573`**, *after* the `try`/`catch` closes, and only
`if (bank !== undefined)`. Inside the `catch`, `bank` is `undefined` — so on the only path where this
comment is ever reached, **the rules did not run and will not run.** `measured`:

- stripped bank + broken `objectives.yaml`, five `task.yaml` declared → exit 1 with **exactly one**
  problem, the `the bank did not load` line. Zero floor problems, though five tasks are declared and every
  `grade.sh` is missing.
- the same root with `objectives.yaml` deleted → **0 problems total**. Neither the floors nor the message.

The *intent* is true and I verified it: this condition governs only whether a line is pushed, and the
floors are not gated on `graders`, which was round 3's fix. The charitable reading of "above" is "at the
location the block comment above documents". But the indicative past tense — "the rules **ran**" — asserts
something that is false in that branch, and the inference a reader draws from it is precisely the one that
produced NEW-3: *the floors already reported on this root, so suppressing the message loses nothing.*

Mitigating, and the reason this is Low rather than a blocker: the same comment contradicts it twice, both
times correctly. Its own opening line is `"The floors could not be checked" is itself a problem`, and its
residual paragraph states the true outcome plainly — "the command exits 0 with empty stderr". A reader who
reads the whole comment gets the truth; only a reader who stops at that sentence does not. The residual
disclosure that Part C actually required is present, accurate and measured.

This is the third consecutive round to leave an inaccurate sentence in a comment it rewrote, so it is worth
naming as a pattern. But it is *"a further thing I noticed"*, not *"this round did not do what it
claimed"* — round 4 did what it claimed. The fix is one word: `The rules are not gated on this condition`,
or `The rules above are not gated on it, and nothing here can suppress them`.

### FINDING 2 — `SHELL_OPTION_LINE` false-fires on a `set`-plus-command one-liner

**Severity: Low. Direction: false fail on content. Load-bearing: no. Justifies round 5: no.**

`/^set\s+[-+]/` is anchored at the start only, so anything after the option prefix is discarded with the
line. `measured`: an anti-solution whose entire body is

```bash
#!/usr/bin/env bash
# expect-fail: fs-home-size
set -euo pipefail; sudo lvextend -L 12G /dev/rhel/home
```

is reported as `nothing here but comments and shell options`, exit 1 — a fixture that does real work,
rejected. This is the false-fail direction the brief flagged as item 3's unusual risk.

The constant's own comment is adjacent to the cause: "the trailing `pipefail` of `set -euo pipefail` needs
no clause of its own, because **the whole line is what matches**." Under the reading "the whole line must
match" that is false; what is true is that the whole line is *discarded* once the prefix matches, and that
is exactly the false fire. So this is FINDING 1's class as well as a code defect.

Not load-bearing: no committed fixture uses that style, the bank is clean on all sixteen, and the shape
requires an author to put `set` and a real command on one line — against the convention every fixture in the
bank follows. Fix is small: `/^set\s+[-+][^;]*$/`, or split each line on `;` before testing. Worth doing
whenever `lint.ts` is next touched; not worth the last round on its own.

### FINDING 3 — a measured widening the eight-row table does not cover; I rule it correct behaviour

**Severity: none (informational). Direction: nominally false fail. Not a defect.**

Two roots change from exit 0 to exit 1, and neither appears in the eight-row table. Both `measured`,
`--allow-empty`:

| root | old | new |
|---|---|---|
| `objectives.yaml` + `concepts/` authored, `tasks/` not created yet | exit 0, 0B | **exit 1**, `cannot read directory …/tasks: ENOENT` |
| `objectives.yaml` + empty `tasks/`, no `concepts/` | exit 0, 0B | **exit 1**, `cannot read directory …/concepts: ENOENT` |

I rule these **correct**, not regressions. They are the semantic the comment states: the manifest is
present, so a loader failure is reported; `--allow-empty` asserts zero graders and nothing about
`objectives.yaml`, `concepts/` or `task.yaml`. They are the same class as the approved row 5
(`concepts/` deleted → exit 1), differing only in which directory is missing. And the pre-authoring root
`--allow-empty` genuinely documents itself for — no `objectives.yaml` at all — still exits 0 in every form
tested (bare directory, `emptyRoot()`, `objectives.yaml` deleted). Recorded because they are the only
measured widenings outside the reproduced table, and because they answer "what does the widened guard now
let through that it should not" in the honest direction: the answer is *nothing that should have stayed
silent*.

### FINDING 4 — "verbatim" overstates the relationship between the two comment versions

**Severity: trivial (report accuracy only). Not load-bearing. Does not justify round 5.**

The report says the test-file comment "repeated the false sentence **verbatim**". The false *proposition*
propagated; the *sentences* differ. `lint.ts` at `45344bd` said "when `--allow-empty` says an unauthored
root is expected, an unloadable bank is that assertion being true rather than a defect"; the test file said
"at zero graders an unloadable bank is the flag's assertion being true". Round 4's quotation of the test
file is exact and its falsity judgment is correct, and the report's own text places the two versions side by
side, so nothing is concealed — but "verbatim" describes the quote's fidelity to the test file, not a
word-for-word repetition between the two files. Substance stands entirely; wording only.

### Confirmed not fixed / not present, per the standing rulings

`measured` from source and from the diff's file list (`src/cli/lint.ts`, `test/cli/lint.test.ts` — nothing
else):

- **P32** not fixed: `parseUnprobed` at `:130` still returns `{ ids: [], declared: [], problems: [] }` when
  the header is absent, so absent and misspelled remain indistinguishable.
- **P35 shape B** not added; `src/engine/validate/harness.ts` does **not** appear in the diff. The item-3
  comment's claims about it are true from source: `runFixture` (`harness.ts:154`) resets (`:189`), runs
  `setup.sh` (`:193`), runs the fixture (`:205`), grades (`:214`), and its only fixture check is
  `if (fixtureResult.code !== 0)` at `:206` — an *error*, not a no-op. Nothing compares against the
  baseline. `:199` even skips an entirely empty script outright.
- The **shape-B static signal** was not added. `content/tasks/storage/014-grow-home-lv/antisolutions/03-wrong-lv.sh`
  was **not** touched; no content file was modified; no warning tier was introduced.
- P33, P34, F3/F9/F10 not restated. `shellcheck` not raised.

## Summary

Round 4 did what it said it did, and it is the first round on this task whose report I could not break on
the numbers. Every mutant, every table row, every count, every quotation reproduces. It also found, without
being asked, that the false disclosure it was sent to fix had propagated into a second file — the check the
brief called the highest-value one in this review — and that claim is true.

The two findings are both in the disclosure class and both minor: one sentence in the new comment asserts
the floors ran on a path where they did not, contradicted correctly by the same comment two paragraphs on;
and the shell-option regex swallows a `set -e; command` one-liner, a false fail on a fixture style no
committed content uses. Neither is load-bearing. Neither justifies spending round 5. Both are one-line fixes
for whenever `src/cli/lint.ts` is next opened.

**APPROVED.**
