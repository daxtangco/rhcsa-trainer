# Task 12 report — `rhcsa coverage` CLI

Commit: `2ff65ac55fe88bc7caa3aaf39e124e298fe51303` on branch `phase-0-1`.

Files touched (all in scope): `src/cli/index.ts`, `test/cli/coverage.test.ts`,
`test/fixtures/bank-unresolved/{objectives.yaml,concepts/storage/lvm-abstraction-stack.md,tasks/storage/001-grow-var/task.yaml}`.

## Arithmetic discrepancy in the mandates

The mandates doc's "Expected test count" section adds `5 + 1 + 1 + 2 + 1` and
writes the result as **9**. `5 + 1 + 1 + 2 + 1 = 10`, not 9. I trusted my
arithmetic per the mandate's own instruction and wrote **10** tests in
`test/cli/coverage.test.ts`:

1. reports counts and exits 0 when every reference resolves (brief, verbatim)
2. exits 1 under `--strict` while coverage gaps remain (brief, verbatim)
3. reports a `ContentError` legibly and exits 1 (brief, verbatim)
4. exits 2 with usage on an unknown command (brief, verbatim)
5. exits 2 with usage when no command is given (brief, verbatim)
6. exits 2 with usage on an unknown option (`--strick`) instead of silently ignoring it (mandate 1)
7. does not print the report when an unknown option is rejected (mandate 1)
8. exits 2 with usage when `--content` has no following value (mandate 2)
9. exits 2 with usage when `--content` is followed by a flag-shaped value (mandate 2)
10. reports an unresolved reference as a problem, with counts still on stdout (mandate 5)

All 10 pass; no other test in the suite regressed (138/138 total).

## Implementation notes vs. the brief

- Per your resolution of the brief's ambiguity, `flag()`/`option()` were
  **replaced**, not patched, by a single `parseCoverageArgs` doing one pass
  over `argv` with an explicit accept-list (`--content <dir>`, `--strict`);
  anything else returns `undefined`, which `coverage()` turns into `USAGE` +
  exit 2.
- Mandate 3: `let bank: Bank`, with `Bank` added as an inline type-only
  specifier on the existing value import: `import { checkCoverage, loadBank,
  type Bank } from '../engine/content/bank.ts'`. The brief had no prior
  type-only import from that module to extend, so I folded `Bank` into the
  same import statement via the inline `type` modifier rather than inventing
  a second import statement — reads as "the" import from that module, which
  is what the mandate seems to intend.
- Mandate 4: `pathToFileURL` from `node:url`, guard and inertness comment
  kept as specified.
- Mandate 5 fixture: `test/fixtures/bank-unresolved/`, modelled on
  `test/fixtures/bank/`: one objective (`storage.lvm.resize`), one valid
  concept (`storage.lvm-abstraction-stack`), one task
  (`storage/001-grow-var`) whose `requires_concepts` names
  `storage.nonexistent-concept`, which does not exist. `loadBank` accepts it
  cleanly; `checkCoverage` surfaces `storage/001-grow-var requires unknown
  concept: storage.nonexistent-concept` as a `problems` entry, which the CLI
  prefixes with `problem: ` on stderr. `test/fixtures/bank` was not touched.

## Mutation proof — mandate 1 (reject unknown options)

Reversion: removed the trailing `else { return undefined }` arm from
`parseCoverageArgs`, restoring "unknown flags are silently ignored."

```
 FAIL  test/cli/coverage.test.ts > rhcsa coverage > does not print the report when an unknown option is rejected
AssertionError: expected [ 32 strings ] to equal []
 ❯ test/cli/coverage.test.ts:70:19

 Test Files  1 failed | 12 passed (13)
      Tests  2 failed | 136 passed (138)
```

Both mandate-1 tests failed (exit-2 test and report-not-printed test), as
expected — a typo'd `--strick` ran the report normally instead of erroring.
Reverted with `git checkout -- src/cli/index.ts` (file was staged via `git
add` first, since it is a new file in a fresh repo with no prior commit to
restore from otherwise). Re-ran the full suite after reverting: back to
138/138 passing.

## Mutation proof — mandate 2 (missing/flag-shaped `--content` value)

Reversion: replaced the `if (value === undefined || value.startsWith('--'))
return undefined` guard with `root = value ?? root`, restoring "missing value
silently keeps the default; flag-shaped value is accepted as a literal root."

```
 FAIL  test/cli/coverage.test.ts > rhcsa coverage > exits 2 with usage when --content has no following value
AssertionError: expected 1 to be 2
 FAIL  test/cli/coverage.test.ts > rhcsa coverage > exits 2 with usage when --content is followed by a flag-shaped value
AssertionError: expected 1 to be 2

 Test Files  1 failed | 12 passed (13)
      Tests  2 failed | 136 passed (138)
```

Both mandate-2 tests failed, as expected — both routed to a real (but wrong)
`loadBank(root)` call, returning 1 from the missing-directory `ContentError`
path rather than 2 from usage. Reverted with `git checkout -- src/cli/index.ts`.
Full suite back to 138/138 after reverting.

## Mutation proof — mandate 5 (unresolved-reference problem branch)

Reversion: deleted the `if (report.problems.length > 0) { ... return 1 }`
block entirely.

```
 FAIL  test/cli/coverage.test.ts > rhcsa coverage > reports an unresolved reference as a problem, with counts still on stdout
AssertionError: expected +0 to be 1

 Test Files  1 failed | 12 passed (13)
      Tests  1 failed | 137 passed (138)
```

Exactly the one test the new fixture exists to lock failed (code came back 0
instead of 1, since with the branch gone `--strict` was off and there were no
other gaps to fail on). No other test broke, confirming the branch really was
otherwise dead — nothing else on disk reaches it, as the mandate says.
Reverted with `git checkout -- src/cli/index.ts`. Full suite back to 138/138.

## Mandates 3 and 4 — not runtime-testable, as the mandate says

- **Mandate 3** (`let bank: Bank`): purely type-level. `bank.typo` would
  compile before the fix (evolving `any`) and fails to compile after
  (`tsc --noEmit` catches it), but nothing distinguishes the two states at
  runtime — vitest can't see a type annotation. No test added for it, per
  the mandate's explicit instruction not to pad the suite. Confirmed
  `npm run typecheck` is clean with the annotation in place.
- **Mandate 4** (`pathToFileURL` guard): the guard's condition is false by
  construction inside vitest (the module is imported, not run as
  `process.argv[1]`), so no vitest test can exercise either branch of it.
  The brief's Step 5 — invoking the CLI directly with `node` — is the real
  evidence. Output:

```
$ node src/cli/index.ts coverage --content test/fixtures/bank; echo "exit=$?"
content root: test/fixtures/bank
tasks: 2
concepts: 2
objectives: 3
uncovered objectives: 1
  - autofs.maps.configure
untaught concepts: 1
  - storage.orphan-concept
exit=0

$ node src/cli/index.ts; echo "exit=$?"
usage: rhcsa <command> [options]

commands:
  coverage    report content coverage gaps

options:
  --content <dir>   content root (default: ./content)
  --strict          exit non-zero while coverage gaps remain
exit=2
```

This is only reachable if `import.meta.url === pathToFileURL(process.argv[1]).href`
evaluates true for a real direct invocation and the `pathToFileURL` form
produces a URL matching `import.meta.url` — both first-run and second-run
(no-args) print and exit correctly, so the guard fires as intended under real
invocation.

## Final numbers

- `npm test`: **138/138 passing**, 13 test files, no regressions.
- `npm run typecheck`: clean, no errors.
- Commit `2ff65ac` on branch `phase-0-1`, message verbatim from the brief.
