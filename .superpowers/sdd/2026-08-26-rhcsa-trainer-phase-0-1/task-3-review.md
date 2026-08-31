# Task 3 Review: `TaskSpec` loader

Range: `23b0340..a70d166` (commit `a70d166`)

## Spec compliance: APPROVED

- All named files created: `src/engine/content/task.ts`, `test/content/task.test.ts`,
  `test/fixtures/tasks/{good,bad,minimal}/task.yaml`. No extra files.
- `TaskSpec` field list matches the brief's interface bullet exactly, same order:
  `id, title, chapter, scope, rhel, objectives, requiresConcepts, difficulty, timeBudget,
  weight, editions, rebootCheck, requiresDisks, claims, transport, prompt, dir`.
- snake_case→camelCase mapping verified name-by-name: `time_budget`→`timeBudget`,
  `requires_disks`→`requiresDisks`, `reboot_check`→`rebootCheck`,
  `requires_concepts`→`requiresConcepts`. Correct in both directions (read from raw YAML key,
  written to camelCase field).
- Ranges match brief's Step 3 code verbatim: chapter 1-28, rhel 9-10, difficulty 1-5,
  time_budget 30-3600, requires_disks 0-3 (`MAX_SPARE_DISKS = 3`, correctly left untightened
  per the ruled-on non-defect).
- `ContentError` is imported from `./errors.ts`, not redefined (confirmed by reading
  `src/engine/content/errors.ts` — unchanged in this range, class present there only).
- `parseTaskSpec(raw: unknown, dir: string): TaskSpec` and `loadTask(dir: string):
  Promise<TaskSpec>` signatures match the brief exactly.
- Test file is a byte-for-byte copy of the brief's Step 1 code (4 `it` blocks), matching the
  brief's stated count ("4 new tests PASS").
- No reference to `/home/daxtangco/sechelp-tools` anywhere in the diff.
- No `sudo`/root usage. Erasable-syntax constraints respected: no `enum`, no parameter
  properties, no decorators, no `namespace`. All relative imports carry `.ts`. `ContentError`
  imported as a value (correct, since it's used with `new`), consistent with
  `verbatimModuleSyntax`.

## Task quality: APPROVED

**Aggregation property — traced by hand against the `bad` fixture, not just by running the
test:**

```
id: Storage/BAD ID, title: "", chapter: 0, scope: extra-credit, rhel: 9, objectives: [],
difficulty: 9, time_budget: -1, weight: enormous, editions: [r9], reboot_check: yes-please,
requires_disks: 4, claims: [], transport: telnet, prompt: ""
```

Walking `parseTaskSpec` top to bottom: every field check runs unconditionally and pushes to
the shared `problems` array — there is no early `return`, no early `throw` inside the
per-field logic, and no `&&`-gated skip. The single early `throw` (`!isRecord(raw)`) only
fires when the YAML root isn't a mapping at all, which is a distinct failure mode (no fields
to check) and doesn't interact with the "every problem in one throw" property the `bad`
fixture is testing. `stringArray` and `intInRange` are helpers that push and return a safe
default rather than throwing, so a bad `objectives` value doesn't prevent `chapter` or
`weight` from being checked afterward. Confirmed by direct execution (below) that all 12
independent defects surface in one throw.

Converse also checked: `rhel: 9` (valid, in 9-10) and `editions: [r9]` / `claims: []` (valid
arrays) produce zero problems for those fields — no spurious noise. The `good` and `minimal`
fixtures pass with no exception, confirming valid input isn't penalized. Defaults land where
the brief specifies: `requiresConcepts`/`editions`/`claims` → `[]`, `transport` → `'ssh'`,
`rebootCheck` → `false`, `requiresDisks` → `0` (via `raw.requires_disks ?? 0`, per the brief's
own Step 3 code).

**Fixtures earn their keep:** `good` exercises full valid mapping + prompt content + `dir`
passthrough; `bad` exercises aggregation across 12 independent defects; `minimal` exercises
every omittable-field default in one place. No overlap between them.

**Tests are behavioral, not implementation mirrors:** all assertions go through the public
`loadTask` async entry point against real fixture files and inspect `TaskSpec` fields /
`ContentError.problems`, never touching internals.

**Nothing overbuilt:** implementation matches the brief's Step 3 code exactly — no extra
exports, no extra validation rules, no speculative fields.

**Minor, non-blocking observations (not counted as findings against the implementer, since
both originate in the brief itself, which the implementer was instructed to copy verbatim):**
- The brief's own "defaults the optional fields" test doesn't assert `requiresDisks` lands on
  `0` when omitted, even though the implementation (correctly, per the brief's Step 3 code)
  defaults it. A gap in the brief's test coverage, not something the implementer introduced.
- `SCOPES.includes(raw.scope as string)` / same pattern for `weight` and `transport` cast
  non-string values to `string` before the `.includes` check. Harmless in practice
  (`.includes` on a non-matching value still correctly returns `false`), but it's an unchecked
  cast rather than a `typeof` guard. Style nit, not a functional defect.

## TDD evidence: genuine

RED: `Cannot find module '../../src/engine/content/task.ts'` — the correct failure for a file
that doesn't exist yet, matching the brief's predicted failure exactly. Not a "wrong reason"
RED (it's not, e.g., a missing-rule failure masquerading as a missing-module failure, since at
RED time no implementation file exists at all).

GREEN: report claims 4/4 new tests passing, then 11/11 full-suite passing, then silent
`tsc --noEmit`.

## Independent verification performed

- `cd /home/daxtangco/rhcsa-trainer && npm test`: **3 test files, 11/11 tests passed**
  (`scaffold.test.ts` 2, `fake-transport.test.ts` 5, `task.test.ts` 4). Matches report exactly.
- `cd /home/daxtangco/rhcsa-trainer && npm run typecheck`: **exit 0, no output.** Matches
  report exactly.
- Independently invoked `loadTask` against the `bad` fixture directly (outside the test
  runner) and printed `err.problems`:

```
count: 12
1 id must look like "<area>/<nnn>-<slug>", lowercase
2 title must be a non-empty string
3 chapter must be an integer 1-28
4 difficulty must be an integer 1-5
5 time_budget must be an integer 30-3600
6 requires_disks must be an integer 0-3
7 scope must be one of: exam-objective, instrumental
8 weight must be one of: low, medium, high
9 transport must be one of: ssh, vmrun
10 reboot_check must be a boolean
11 objectives must list at least one objective id
12 prompt must be a non-empty string
```

  **Exactly 12 problems, identical list to the report's claim.** All 11 of the brief's regexes
  (`id`, `title`, `chapter`, `scope`, `objectives`, `difficulty`, `time_budget`, `weight`,
  `reboot_check`, `transport`, `prompt`) are present in this list, and `12 >= 11` satisfies the
  test's deliberate-slack threshold.

## Findings

None. No spec-compliance defects, no aggregation short-circuit, no spurious validation on
valid input, no redefinition of `ContentError`, no reference to the excluded path, no
tightening of `MAX_SPARE_DISKS`, no change to the `>=11` slack assertion. Both ruled-on
non-defects were left exactly as specified.
