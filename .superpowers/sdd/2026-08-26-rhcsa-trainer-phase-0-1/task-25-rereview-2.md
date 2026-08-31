# Task 25 — scoped re-review of fix round 3

Range `7880164..45344bd`, 1 commit, `src/cli/lint.ts` + `test/cli/lint.test.ts`, 218 insertions / 21
deletions. Scoped to round 3.

**Verdict: CHANGES REQUIRED** — one finding, on item 2. All four items landed and every guard in the
diff bites under suppression; the code is right. What is not right is the comment defending it: its
load-bearing sentence is false, and it is false in the same structural shape as the comment it
replaced. The residual it justifies is also materially wider than disclosed, and a two-line
formulation closes it. The fix required is a comment edit; the residual fix is offered as measured
evidence, not demanded.

Method: all mutation work in `/tmp/t25rr2`, from `git archive 45344bd | tar -x` with `node_modules`
symlinked back. `src/cli/lint.ts` and `test/cli/lint.test.ts` sha256-verified against baseline after
every mutation (`2b0480f5…` / `20ba7db9…`). Repo working tree `git status --porcelain` empty before and
after; `HEAD` `45344bd`; `git tag -l` empty. Every conclusion below is labelled `measured` or
`reasoned`.

## Gates

| gate | result |
|---|---|
| `npm run typecheck` | exit 0 — `measured` |
| `npx vitest run` | **431 passed / 35 files / 0 failed / 0 skipped**, exit 0 (was 423, +8) — `measured` |
| `npm run build:web` | exit 0 — `measured` |
| `npm run lint:content` | exit 0, **stderr 0 bytes**, `no problems in 5 grader(s)`, `graders checked: 5`, `scripts with headers: 21` — `measured` |

Skip count confirmed by grepping the vitest log for `skip`/`todo`: no matches, and the summary line
reads `Tests 431 passed (431)` with no skipped bucket. `measured`.

Diff scope: `git diff --name-only 7880164..45344bd` returns exactly `src/cli/lint.ts` and
`test/cli/lint.test.ts`. `harness.ts` does **not** appear, nor do `src/server/session.ts`,
`src/engine/grading/`, `content/lib/assert.sh`, `content/`, or `objectives.yaml`. `measured`.

P32 confirmed not fixed: `src/cli/lint.ts:130` still returns an empty `ParsedHeader` when the
`# unprobed-invariant:` header is absent, so absent and misspelled remain indistinguishable.
`measured`.

## Item 1 — NEW-1. Landed. Test bites.

**Reproduced, both ends.** Fixture: `content/` copied, all five `grade.sh` deleted, all five
`antisolutions/` deleted, five `task.yaml` and five `setup.sh` intact.

| build | invocation | exit | problems |
|---|---|---|---|
| `7880164` | `--allow-empty` | **0** | 0, **stderr 0 bytes**, `no problems in 0 grader(s)` |
| `45344bd` | `--allow-empty` | **1** | **10** — grade.sh rule ×5, `antisolutions/ is missing` ×5 |
| `45344bd` | no flag | **1** | **11** — the same 10 plus `no grade.sh found, so nothing was checked` |

All `measured`. The claimed measurements reproduce exactly.

**`--allow-empty` still exits 0 on a genuinely empty root.** `mkdtemp` + `tasks/` only: exit 0, stderr
0 bytes. Without the flag: exit 1, 1 problem. `measured`.

**Round 1's test for that is genuinely unchanged.** The whole `describe('rhcsa lint fails when there
is nothing to check')` block — including `emptyRoot()` and
`it('exits 0 there when --allow-empty says the empty bank is expected')` — is **byte-identical**
between `7880164` and `45344bd`: sha256 `3ed21346…` on both, 62 lines each. No diff hunk touches that
range (hunks land at lines 1, 53, 415, 445). The `lint()` helper *was* changed to take `...extra`, but
that test calls `run()` directly and does not go through the helper, and with an empty `extra` the
helper is argument-identical anyway. `measured`. **The test was not weakened.**

**Suppression — Mutation A.** Single-site change, floors back behind the count:

```
-  if (bank !== undefined) await checkFixtureFloors(bank, new Set(graders), rel, problems)
+  if (bank !== undefined && graders.length > 0) await checkFixtureFloors(bank, new Set(graders), rel, problems)
```

Kills **exactly 3** tests, as claimed, and each on a load-bearing assertion — I checked which
assertion tripped in each, because a kill credited to the wrong assertion has happened five times on
this branch:

1. `fires the grade.sh rule five times at zero graders, under --allow-empty` — trips on
   `expect(r.code).toBe(1)`, `expected +0 to be 1`. This is the strongest available kill: the mutant
   restores the exact NEW-1 exit-0.
2. `fires them at zero graders without the flag too` — trips on `expected +0 to be 5`, i.e. the
   `countProblems(/is in the bank but has no grade\.sh/)` assertion. The earlier `r.code` assertion
   **passed** (without the flag the empty-bank guard makes exit 1 regardless), so this kill is
   genuinely attributable to the rule-count assertion and not to an earlier one.
3. `fires the setup.sh rule at zero graders as well` — trips on the `has no setup\.sh` message match.

Two tests in the new block stay green under Mutation A (`still exits 0 … no bank at all`, and
`does not let --allow-empty excuse a bank that will not load when graders exist`) — correct, they pin
different properties, and both are shown to bite separately below. All `measured`.

### The fix's own edges

**Does a root with graders and an unloadable bank still reach the header checks and still exit 1?**
Yes. `content/` copy with `objectives.yaml` replaced by broken YAML: exit 1, stdout
`graders checked: 5` / `scripts with headers: 21`, stderr carries
`the bank did not load, so the per-task fixture floors were not checked — …`. With `--allow-empty`:
also exit 1, same message. `measured`. The `taskDirOf` split holds.

**Does `loadBank` running unconditionally introduce a new failure mode on a root that used to lint
fine?** No. `measured` + `reasoned`:

- Bank loads with **zero tasks** (valid `objectives.yaml`, empty `tasks/`, empty `concepts/`):
  `--allow-empty` → exit 0, stderr 0 bytes. `checkFixtureFloors` iterates nothing and the orphan loop
  iterates zero graders. Identical to pre-fix. `measured`.
- Enumerating the pre-fix exit-0 space: it required either (a) graders > 0 with everything clean —
  where `loadBank` already ran, so nothing changed — or (b) zero graders with `--allow-empty`. In (b)
  the new call either succeeds with `tasks: []` (exit 0, measured above), succeeds with tasks declared
  (exit 1 — the intended fix), or throws (message suppressed, exit 0 — the residual). So the only
  behaviour change on a previously-green root is the defect being closed. **No new false fail.**
  `reasoned`, with both exit-0 branches measured.

**Is there any root where `loadBank` now throws rather than reporting?** No. `reasoned`, and the
reasoning is closed rather than probabilistic: the `await loadBank(root)` sits inside a bare
`catch (e)` that handles `ContentError`, `Error` and non-`Error` alike, so nothing it can throw
escapes. Independently, `loadBank`'s own contract (`src/engine/content/bank.ts`, `describeFailure`)
folds every loader rejection, duplicate id and unreadable directory into `problems` and throws one
`ContentError` — "no raw, non-`ContentError` value ever escapes". `checkFixtureFloors` is the only
call outside the try, and its placement is **unchanged** from before this commit; its two filesystem
helpers (`isFile`, `scanFixtureDir`) both swallow into a return value. **No new crash path.**

One adversarial probe found a pre-existing fail-closed path worth recording as a non-finding: a
fixture directory at mode `000` makes `shellScripts` throw `EACCES` before `scanFixtureDir` is ever
reached, and `lint` in `src/cli/index.ts:159-165` catches it, prints
`EACCES: permission denied, scandir …` and returns 1. Fails closed, readable, pre-existing. `measured`.

## Item 2 — NEW-2. The comment. **This is the finding.**

The replacement is mostly true and in places precisely so. Claim by claim, each checked against the
code rather than the narrative:

| claim | verdict |
|---|---|
| "The floors run here, outside any test on `graders`" | **true** — `lint.ts:503` has no `graders` test. `measured` via Mutation A. |
| "`graders.length` is a **walk result**" | **true** — `lint.ts:441` filters the `shellScripts` walk. |
| "`bank.tasks` … is the only input every rule in `checkFixtureFloors` reads" | **misleading**; see NEW-4. |
| "a bank still declaring five tasks with every `grade.sh` deleted found zero graders, so the rule that exists to report exactly that never ran" | **true** — `measured` at `7880164`. |
| "Under `--allow-empty` … the whole command then exited 0 on a bank with no graders **and no anti-solutions at all**" | **true**, and commendably precise — the anti-solution qualifier is load-bearing and correct (with them present the bank-independent orphan check fires, exit 1, 16 problems). `measured`. |
| the "this used to say X" note | **accurate.** The quoted fragment "a root the walk found no graders in has no task to iterate" is **verbatim** what the old comment said (diff line 107), it is indeed false, and it did defend the short-circuit. `measured` against the old text. |
| "Reported only when the walk found a grader, and that condition is about the *message*, not about the rules" | **true.** |
| "With a grader present … a bank that will not load is a problem no flag suppresses" | **true** — `measured`, and the guard bites (Mutation E kills 2 tests). |
| "The header checks below still run either way" | **true** — `measured`, `graders checked: 5` on the broken-YAML root. |

### NEW-3 — the sentence that justifies the residual is false, and it is false in the shape this round was meant to close

> "and when `--allow-empty` says an unauthored root is expected, an unloadable bank is that assertion
> being true rather than a defect."

**Severity: medium. Direction: false green on the bank. Load-bearing: yes.**

Two things are wrong, and they compound:

1. **`--allow-empty` does not say the root is unauthored.** It says *zero graders is expected*. The
   flag's own message (`lint.ts:459-460`) is explicit: "pass `--allow-empty` if an empty bank is
   genuinely expected" — an empty *bank*, meaning no `grade.sh`. It asserts nothing whatsoever about
   `objectives.yaml`, `concepts/` or `task.yaml`.
2. **Therefore "an unloadable bank is that assertion being true" does not follow**, and measurably
   does not hold. It infers a property of the content ("unauthored") from a failure of the loader —
   which is structurally the *same* inference error as the comment it replaced, which inferred a
   property of the bank from a result of the walk. This is the wrong-disclosure class, in the round
   that was supposed to close it.

The measurement that shows it false — and this is the part that matters more than the wording:

| root | `--allow-empty` | exit | problems |
|---|---|---|---|
| stripped bank (5 `task.yaml`, 5 `setup.sh`, `concepts/`, valid `objectives.yaml`, 0 graders, 0 antisolutions) | yes | 1 | 10 |
| **same root + broken `objectives.yaml`** | yes | **0** | **0, stderr 0 bytes** |
| **same root + `concepts/` deleted** | yes | **0** | **0, stderr 0 bytes** |
| `objectives.yaml` valid, `tasks` is a regular **file** | yes | **0** | **0** |

All `measured`. So the residual does not merely hide a bank-load message on a bare directory: **it
re-opens NEW-1's exact channel.** A root with all five tasks declared and every `grade.sh` deleted
still exits 0 with empty stderr, provided one additional and entirely ordinary fault makes the bank
unloadable. NEW-1 is closed only for banks that load.

The comment also never states that consequence. It discloses *that* the message is guarded; it does
not disclose that the guard produces exit 0 with no output on an authored, broken, grader-less bank.
That is the half a next reader needs.

**The reviewer's question — does a formulation exist that keeps `--allow-empty` working on a bare
directory and still reports an unloadable bank? Yes, and it is two lines.** Distinguishing "no bank
file at all" from "a bank file that failed to load" separates the cases exactly as hypothesised. I
implemented and measured it:

```
-    if (graders.length > 0) {
+    if (graders.length > 0 || (await isFile(join(root, 'objectives.yaml')))) {
```

It reuses the `isFile` helper **this very round added**. Measured results:

| root | today | with the candidate |
|---|---|---|
| bare directory (`mkdtemp` + `tasks/`) | exit 0 | **exit 0** — preserved |
| round 1's `emptyRoot()` (`tasks/…/setup.sh`, no bank file) | exit 0 | **exit 0** — preserved |
| bank loads, zero tasks | exit 0 | **exit 0** — preserved |
| broken `objectives.yaml`, 0 graders | exit 0, 0 problems | **exit 1**, reported with the parse error |
| `concepts/` deleted, 0 graders | exit 0, 0 problems | **exit 1**, reported |
| `tasks` is a file | exit 0 | **exit 1**, reported |
| stripped bank (loadable) | exit 1, 10 | exit 1, 10 — unchanged |
| committed bank | exit 0 | exit 0 — unchanged |
| **full suite** | 431 pass | **431 pass / 0 fail** |

All `measured`. `objectives.yaml` is the right discriminator: it is the bank's root manifest, the one
file whose presence means somebody authored a bank here. Note the weaker candidate `files.length > 0`
does **not** work — round 1's `emptyRoot()` contains a `setup.sh`.

I also confirmed the implementer's stated reason for the guard is honest. Mutation F, removing
`if (graders.length > 0)` outright, kills 2 tests — round 1's
`exits 0 there when --allow-empty says the empty bank is expected` and round 3's
`still exits 0 under --allow-empty on a root with no bank at all`, both on `expect(err).toBe('')`.
`measured`. So "removing it breaks `--allow-empty` on a bare directory" is **true**. Removing was
simply not the only option, and the reviewer was right to press on that. This also proves the new
exit-0 test is live rather than a test that can never fail.

### NEW-4 — wording, minor

> "`bank.tasks` is the independent record of what should exist, and it is the only input every rule in
> `checkFixtureFloors` reads."

**Severity: low. Not load-bearing.** True under the intended reading ("`bank.tasks` is the one input
*common to* every rule"), which the surrounding argument makes clear. False under the natural reading
("each rule reads nothing but `bank.tasks`"): `graders` is a second input, the `grade.sh` rule reads
it (`lint.ts:346`), and the orphan reconciliation rule at `lint.ts:406` **iterates** it. Given this
branch's history with comment wording, worth a clause — "the one input every rule has in common"
would say it.

## Item 3 — the `setup.sh` rule. Landed. Test bites, on both properties.

- Added in the `bank.tasks` loop beside rule 5 (`lint.ts:362-366`). `measured`.
- **Does not fire on the committed bank** — `lint:content` exit 0, stderr 0 bytes, and all five tasks
  ship a `setup.sh` (`find … -name setup.sh` → 5). `measured`.
- **Mutation B** (the push made unreachable) kills **exactly 3** tests, as claimed:
  `reports a task with no setup.sh` and `reports a setup.sh that is a directory` both on
  `expect(r.code).toBe(1)` → `expected +0 to be 1` (so the rule is the *sole* reason those roots exit
  1 — the strongest form of kill), and `fires the setup.sh rule at zero graders as well` on the
  message match. `measured`.
- **Both axes of `--allow-empty` and both grader counts are genuinely pinned**: the zero-grader test
  loops `[[], ['--allow-empty']]` with an args label on the assertion, and Mutation A independently
  kills it. `measured`.
- **The `stat`-not-`access` detail holds, and is separately tested.** A directory named `setup.sh`
  does not pass. **Mutation B2** — `return (await stat(path)).isFile()` → `await stat(path); return true`,
  i.e. exactly `access` semantics — kills **exactly 1** test, `reports a setup.sh that is a directory
  rather than a file`, and nothing else. `measured`. That is a clean single-property mutant: the detail
  was not requested, it is correct, and it would not have survived silently.

## Item 4 — the `unreadable` arm. Landed. Test bites, and the message distinction holds in both directions.

- **Mutation C** (`if (isEnoent(e) || true)`, collapsing unreadable into absent) kills **exactly 1**
  test, on the positive assertion `/antisolutions\/ could not be read \(.*ENOTDIR/`. `measured`.
- **The two messages differ**, and — the claim the context asked me to check hardest — **each test
  fails if given the other's message.** Both directions measured, with the arm kept in place and only
  the string swapped, so each mutant changes one thing:
  - unreadable arm emits the **absent** string → kills 1 test (`reports a fixture directory it cannot
    read`). `measured`.
  - absent arm emits the **unreadable** string → kills **3** tests: `catches a missing antisolutions/
    directory`, `catches antisolutions/ misspelled as antisolutons/`, and the NEW-1 test's
    `countProblems(/antisolutions\/ is missing/)).toBe(5)`. `measured`.

  So neither arm can adopt the other's message without a test dying. The two are not collapsible, and
  neither is untested.
- The route choice is better than merely convenient. `EACCES` on a fixture directory never reaches
  `scanFixtureDir` at all — `shellScripts` throws first (measured above). A regular file named
  `antisolutions` is skipped by `shellScripts` (it is `isFile()` and does not end in `.sh`) and so
  does reach `readdir`, failing `ENOTDIR`. **ENOTDIR is effectively the only practical route into this
  arm**, which makes the no-sudo fixture the right one rather than a shortcut. `measured` + `reasoned`.

## The sweep — three claims spot-checked

I picked the two the context nominated plus one more.

**1. `validate` exits 1 on `tasks.length === 0` before `loadVmConfig` — CONFIRMED, and `measured`
without a guest.** `src/cli/index.ts:259-262` returns 1 with `no tasks found under <root>/tasks`;
`loadVmConfig(process.env)` is at line 264 and `chooseTransport` at 269. Ran it against a
valid-but-taskless root: exit 1, stderr exactly `no tasks found under /tmp/t25-zerotask/tasks`, stdout
**empty** — so line 270's `transport:` never printed. `.env.local` is absent in both the repo and the
copy and `loadVmConfig` throws on missing required env, so had the ordering been wrong I would have
seen a config throw rather than a VM operation. **The sweep did not need a guest to be conclusive on
this claim.**

**2. `coverage --strict` is floored by the loader — CONFIRMED, and floored three times over.**
`src/engine/content/objectives.ts:38-39` pushes `objectives must list at least one objective` on an
empty list and throws at line 73; `coverage` catches at `index.ts:80-82` and returns 1 at line 82,
before `checkCoverage` at 87. Measured with `objectives: []`: exit 1, the expected problem, and
**zero stdout lines** — so neither `checkCoverage` nor the printing block ran. I then pushed on the
half the claim does not mention, since `gaps` sums *two* filtered lists: emptying `concepts/` does
drive `untaughtConcepts` to 0 with no loader complaint, but `checkCoverage`'s
`requires unknown concept` problems fire and `report.problems.length > 0` returns 1 at `index.ts:100`
**before** `--strict` is consulted. And P34 independently keeps `gaps > 0` on the shipped bank
(measured: `uncovered objectives: 58`, `untaught concepts: 0`, exit 1). So the verdict holds; the
stated reasoning covers one of three independent floors, which is a completeness note and not a
finding.

**3. `inventoryGate` runs unconditionally in `validateTask` — CONFIRMED.**
`src/engine/validate/harness.ts:305`: `const gate = inventoryGate(task, scripts)` is the first
statement after `results` is initialised, with no precondition, ahead of the fixture loop.
`if (!gate.ok)` at line 315 gates only whether the result is *pushed*, not whether the check *runs*,
and pushing only failures is right — a passing gate is not a result. `reasoned` from source, and
unambiguous: one unconditional call. (`inventoryGate` counts from `scripts` rather than from the bank,
so it has P33's shape rather than NEW-1's — `harness.ts`, out of scope, and not what the claim was
about.)

On P35: I did not re-derive it and have no objection to the widening. Locating the culprit in the
absence of any baseline comparison rather than in `runFixture`'s `if (fixture.script.trim() !== '')`
is the stronger framing, since it explains why a comment-only anti-solution reaches the same place
without tripping that guard at all.

## Summary of findings

| id | severity | direction | load-bearing | summary |
|---|---|---|---|---|
| NEW-3 | medium | false green on the bank | **yes** | The comment sentence justifying the residual — "an unloadable bank is that assertion being true rather than a defect" — is false: `--allow-empty` asserts zero graders, not an unauthored root, and it infers content state from a loader failure, the same shape as the comment it replaced. The residual is correspondingly wider than disclosed: NEW-1's exact channel (5 tasks declared, 0 graders, exit 0, empty stderr) is still reachable whenever the bank fails to load, including from a single YAML typo or a missing `concepts/`. A measured two-line formulation (`|| await isFile(join(root, 'objectives.yaml'))`) closes it, preserves both `--allow-empty` tests, and passes 431/431. |
| NEW-4 | low | n/a | no | "the only input every rule in `checkFixtureFloors` reads" is true only under the common-input reading; `graders` is a second input and the orphan rule iterates it. |

Required for approval: correct the NEW-3 sentence, and state the residual's actual consequence and
actual breadth. The residual fix itself is the reviewer's call — the evidence says it is small, safe
and fully covered by the existing suite, so my recommendation is to take it now rather than pass it to
the whole-branch review.

Everything else in this round is sound, and the round's core work is genuinely done: thirteen-plus-four
guards, and every one of the four new ones dies when suppressed.
