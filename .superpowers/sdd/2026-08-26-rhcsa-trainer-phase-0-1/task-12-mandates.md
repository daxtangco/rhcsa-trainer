# Task 12 — mandated changes to the brief

These five changes are **required**, and they override the code in
`task-12-brief.md` wherever they conflict. Everything else in the brief —
including all five of its tests, verbatim — stands. Each change needs a test
that fails if the change is reverted; prove that by making the reversion,
running the suite, confirming the test fails, and reverting with
`git checkout --`. Report the mutation output for each.

## 1. Reject unknown options instead of ignoring them

`flag()` as written is `argv.includes('--strict')`. So `rhcsa coverage --strick`
runs with strictness silently **off** and exits 0 while coverage gaps remain —
indistinguishable from a pass. `--strict` is the gate that will eventually
enforce a complete bank; a typo must never disable it quietly.

Parse `coverage`'s arguments in one pass over `argv` with an explicit list of
what it accepts (`--content <dir>`, `--strict`). Anything else — an unknown
`--flag`, or a bare positional argument — prints `USAGE` to `io.err` and returns
**2**, matching how `run` already treats an unknown command.

Test: `run(['coverage', '--content', BANK, '--strick'], io)` returns 2 and
`io.err` matches `/usage: rhcsa/`. Add a second asserting the report was *not*
printed (`io.out` is empty), so the failure cannot be mistaken for a run.

## 2. A missing or flag-shaped option value is a usage error

`option()` as written has two false-success paths. `--content --strict` sets the
content root to the literal string `--strict`; `--content` as the final argument
silently reverts to the default `content` directory. In both cases the user
believes they pointed the tool at a bank they did not.

In the one-pass parser: if `--content` has no following argument, or the
following argument begins with `--`, print `USAGE` to `io.err` and return 2.

Tests: `['coverage', '--content']` → 2, and `['coverage', '--content', '--strict']`
→ 2, both with `/usage: rhcsa/` on stderr.

## 3. Annotate `bank`

`let bank` with no initializer and no annotation gets an evolving `any`, which
`noImplicitAny` does not flag — so `bank.typo` would compile in the very file
meant to be the typed boundary over the loader. Write
`let bank: Bank` and add `Bank` to the existing type-only import from
`../engine/content/bank.ts` (it is exported there).

This change is type-level; it has no runtime-observable behaviour, so **do not
invent a runtime test for it**. Note in your report that it is unlockable by a
runtime test and say why. (A previous task in this plan was right to refuse to
pad the suite for a type-level fix; the same applies here.)

## 4. Build the direct-invocation URL with `pathToFileURL`

Replace the hand-built comparison

```ts
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
```

with `pathToFileURL` from `node:url`:

```ts
import { pathToFileURL } from 'node:url'
// ...
const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
```

The manual form breaks on any path needing percent-encoding — a real hazard the
moment this repo lives under a directory with a space in its name, which is
already true of the `vmrun.exe` path this project shells out to. Keep the
`!== undefined` guard and keep the comment explaining that importing the module
in tests must stay inert.

Also type-level-adjacent: it is not runtime-testable from inside vitest, because
the guard is false there by design. Step 5 of the brief (invoking the CLI for
real with `node src/cli/index.ts`) is its verification — run it and paste the
output into your report. That output is the evidence for this change.

## 5. Make the `problems` branch reachable from disk, and test it

`if (report.problems.length > 0)` is the path where the CLI reports genuine
authoring bugs — a task requiring a concept that does not exist, a task mapping
to an unknown objective, a concept listing an unknown prerequisite. No fixture
on disk reaches it today: the existing banks either resolve cleanly or throw
during `loadBank`. Task 7 reached it only by mutating a `TaskSpec` in memory,
which the CLI cannot do. So the branch survives deletion, and it is the CLI's
only hard-error path.

Create a new fixture bank — **do not modify `test/fixtures/bank`**, whose exact
counts the brief's first test pins. Name it `test/fixtures/bank-unresolved`,
modelled on `test/fixtures/bank`: an `objectives.yaml`, at least one concept,
and one task whose `requires_concepts` names a concept id that does not exist.
`loadBank` accepts it (reference resolution is `checkCoverage`'s job, not the
loader's), so `checkCoverage` reports it as a problem.

Test: `run(['coverage', '--content', UNRESOLVED], io)` returns 1 and `io.err`
matches `/requires unknown concept/`. Note that the report lines still print to
`io.out` first, which is correct — the counts are useful context for the
problem — so assert stdout carries the counts too.

## Expected test count

The brief's 5, plus 1 (change 1, exit 2 on unknown flag), plus 1 (change 1,
report not printed), plus 2 (change 2), plus 1 (change 5) = **9** tests in
`test/cli/coverage.test.ts`. Changes 3 and 4 add none, for the reasons stated
above. If your arithmetic disagrees with mine, trust your arithmetic and say so
in the report — mine has been wrong before.

## Out of scope

- `rhcsa validate` — that is Task 21, once `chooseTransport` and `VmController`
  exist. Add no second command.
- Plan line 9202's magic `5` duplicating `MAX_RUNG.practice` — a later task owns
  `maxRungFor`.
- The pre-existing widening casts in `src/engine/grading/verdict.ts` and
  `src/engine/content/task.ts`. They belong to approved tasks and are already
  parked for the final review. **Do not tidy them.**
