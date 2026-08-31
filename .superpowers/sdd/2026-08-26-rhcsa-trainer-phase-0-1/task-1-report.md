# Task 1 Report: Project scaffold that typechecks and runs a test

## Summary

Implemented the project scaffold exactly as specified in the task brief: `package.json`, `tsconfig.json`, `vitest.config.ts`, an appended `.gitignore`, and `test/scaffold.test.ts`. Followed the brief's TDD steps in order (red probe with `npx --no vitest run`, write scaffold, install + green run, erasable-syntax guard, commit).

## What was implemented

- `test/scaffold.test.ts` — two assertions: TypeScript arithmetic under strict types, and `process.versions.node` major version >= 22. Written verbatim from the brief.
- `package.json` — `type: "module"`, `engines.node: ">=22.18.0"` (intentionally below the installed 22.23.2 per the brief's explicit instruction — this is the floor where `--experimental-strip-types` became default, not a typo), scripts (`test`, `test:watch`, `typecheck`, `rhcsa`), deps (`gray-matter`, `js-yaml`) and devDeps (`@types/js-yaml`, `@types/node`, `typescript`, `vitest`) for later tasks.
- `tsconfig.json` — `erasableSyntaxOnly: true`, `allowImportingTsExtensions: true`, `verbatimModuleSyntax: true`, `NodeNext` module/resolution, strict mode plus `noUncheckedIndexedAccess`/`noImplicitOverride`, `noEmit: true`.
- `vitest.config.ts` — `globals: true`, `include: ['test/**/*.test.ts']`, `exclude` gated on `RHCSA_VM=1` env var and on the `*.vm.test.ts` filename (not directory), `testTimeout: 10_000`.
- `.gitignore` — appended `corpus/` and `coverage/` to the existing file (which already had `node_modules/`, `dist/`, `*.db`, `*.sqlite`, `.env`, `.env.local`, `.superpowers/`).

No other files were touched. `src/` was created transiently only for the Step 5 guard probe and removed immediately after.

## TDD Evidence

### RED — Step 2

Command:
```
cd /home/daxtangco/rhcsa-trainer && npx --no vitest run
```
Output:
```
npm error npx canceled due to missing packages and no YES option: ["vitest@4.1.11"]
npm error A complete log of this run can be found in: /home/daxtangco/.npm/_logs/2026-08-29T13_59_08_563Z-debug-0.log
EXIT_CODE=1
```
Why expected: no `node_modules`/lockfile existed yet, so vitest was not installed locally. `--no` forces `npx` to refuse to fetch it from the registry rather than silently installing and passing — confirming there was genuinely no toolchain in place before the scaffold was written.

### GREEN — Step 4

`npm install` ran in background and completed with exit code 0 (produced `package-lock.json`, 1787 lines).

Command:
```
cd /home/daxtangco/rhcsa-trainer && npm test
```
Output:
```
> rhcsa-trainer@0.1.0 test
> vitest run

 RUN  v3.2.7 /home/daxtangco/rhcsa-trainer

 ✓ test/scaffold.test.ts (2 tests) 3ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  22:00:13
   Duration  585ms (transform 60ms, setup 0ms, collect 36ms, tests 3ms, environment 0ms, prepare 121ms)

TEST_EXIT=0
```
Pristine — no warnings, no stray output.

Command:
```
cd /home/daxtangco/rhcsa-trainer && npm run typecheck
```
Output:
```
> rhcsa-trainer@0.1.0 typecheck
> tsc --noEmit

TYPECHECK_EXIT=0
```
Exits 0 with no output, as expected.

### Erasable-syntax guard — Step 5

Command:
```bash
cd /home/daxtangco/rhcsa-trainer
mkdir -p src
printf 'export enum Bad { A }\n' > src/_guard.ts
npm run typecheck; echo "exit=$?"
rm src/_guard.ts
rmdir src 2>/dev/null || true
```
Output:
```
> rhcsa-trainer@0.1.0 typecheck
> tsc --noEmit

src/_guard.ts(1,13): error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.
exit=2
```
Confirms the compiler (not discipline) enforces the no-`enum` constraint. `typescript@5.8.0`+ (installed: check via `node_modules/typescript/package.json` — resolved per `^5.8.0` range) correctly fires TS1294. `src/` was verified absent afterward via `git status` (no untracked `src/` entries).

## Files changed (commit `ce3b225`)

```
 .gitignore            |    2 +
 package-lock.json     | 1787 +++++++++++++++++++++++++++++++++++++++++++++++++
 package.json          |   23 +
 test/scaffold.test.ts |   13 +
 tsconfig.json         |   19 +
 vitest.config.ts      |   21 +
 6 files changed, 1865 insertions(+)
```

Commit message:
```
chore: scaffold Node 22 + TypeScript + vitest, no build step

Type stripping runs .ts directly, so erasableSyntaxOnly is enabled to make
the no-enum/no-parameter-property constraint a compiler error rather than a
runtime surprise. VM-dependent suites are excluded unless RHCSA_VM=1 so the
default test run needs no hypervisor.
```

Author/committer: `daxtangco <daxtangco@localhost>` (passed inline per the global constraint, no repo git identity configured).

## Self-review

- Read `git status` after commit: working tree clean, nothing left uncommitted.
- Diffed each file against the brief's verbatim text: `package.json`, `tsconfig.json`, `vitest.config.ts` match byte-for-byte with the brief's code blocks. `.gitignore` append matches exactly (`corpus/`, `coverage/`).
- `test/scaffold.test.ts` matches the brief's code block exactly.
- No overbuilding: no extra scripts, no extra config keys, no `src/cli/index.ts` created (the `rhcsa` script references a file that doesn't exist yet — that's expected, it's for a later task; running `npm run rhcsa` now would fail, but nothing in this task exercises it).
- `npm test` output is pristine — no deprecation warnings, no console noise.
- `.gitignore` still correctly excludes `node_modules/`; `package-lock.json` was intentionally included per Step 6's explicit `git add` file list.
- Confirmed `engines.node` was left at `>=22.18.0` and not "corrected" to `>=22.23.2`, per Decision 1.
- Confirmed the erasable-syntax guard step included the `mkdir -p src` / `rmdir src` bracket, per Decision 2 — and it worked first try (the installed TypeScript version resolved from `^5.8.0` fires TS1294 without needing a version bump).
- Confirmed `npx --no vitest run` (not plain `npx vitest run`) was used for the red probe, per Decision 3.
- Confirmed `vitest.config.ts`'s `exclude` gates on `test/**/*.vm.test.ts` (filename), not `test/vm/**` (directory), and both branches restate `node_modules`/`dist`, per Decision 4.

## Concerns

None. All verification commands ran with the exact expected results; no ambiguity encountered in the brief.
