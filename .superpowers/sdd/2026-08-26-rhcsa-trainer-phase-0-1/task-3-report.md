# Task 3 Report: `TaskSpec` loader

## Summary

Implemented `src/engine/content/task.ts`: `TaskScope`, `TaskWeight`, `TaskTransport`
union types, the `TaskSpec` interface (snake_case YAML → camelCase fields:
`time_budget`→`timeBudget`, `requires_disks`→`requiresDisks`,
`reboot_check`→`rebootCheck`, `requires_concepts`→`requiresConcepts`),
`parseTaskSpec(raw, dir)` (aggregating validator, throws `ContentError`), and
`loadTask(dir)` (reads `task.yaml`, parses YAML via `js-yaml`, delegates to
`parseTaskSpec`).

Also created the three fixtures (`good`, `bad`, `minimal`) and
`test/content/task.test.ts`, all copied verbatim from the brief per its
instruction that field names, regexes, ranges, wording, and test cases are
requirements to use as-is.

`js-yaml` and `@types/js-yaml` were already present in `package.json` /
`node_modules` from prior task setup — no install needed.

## Implementation notes

- `MAX_SPARE_DISKS = 3` kept exactly as specified, with the brief's doc
  comment verbatim, per decision 1 in the task instructions (schema bound
  from spec section 4.1's VM design, not a claim that 3 disks are attached;
  Phase 1 declares `requires_disks: 0` everywhere).
- The `bad` fixture actually produces **12** problems (verified below); the
  test's `toBeGreaterThanOrEqual(11)` is deliberate slack per decision 2, not
  an off-by-one bug.
- All optional fields (`requires_concepts`, `editions`, `claims`,
  `transport`, `reboot_check`) default via `??` / helper defaults:
  `requiresConcepts`/`editions`/`claims` → `[]`, `transport` → `'ssh'`,
  `rebootCheck` → `false`.

## TDD evidence

### RED

Command:
```
cd /home/daxtangco/rhcsa-trainer && npx vitest run test/content/task.test.ts
```

Output (before `src/engine/content/task.ts` existed):
```
 FAIL  test/content/task.test.ts [ test/content/task.test.ts ]
Error: Cannot find module '../../src/engine/content/task.ts' imported from '/home/daxtangco/rhcsa-trainer/test/content/task.test.ts'
 ❯ test/content/task.test.ts:3:1
      1| import { describe, expect, it } from 'vitest'
      2| import { ContentError } from '../../src/engine/content/errors.ts'
      3| import { loadTask } from '../../src/engine/content/task.ts'
       | ^
...
 Test Files  1 failed (1)
      Tests  no tests
```

This matches the brief's predicted failure exactly ("Cannot find module
'../../src/engine/content/task.ts'") — confirms the test file and fixtures
were wired correctly before any implementation existed.

### GREEN

Command:
```
cd /home/daxtangco/rhcsa-trainer && npx vitest run test/content/task.test.ts
```

Output (after implementation):
```
 RUN  v3.2.7 /home/daxtangco/rhcsa-trainer

 ✓ test/content/task.test.ts (4 tests) 22ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

Full suite + typecheck:
```
cd /home/daxtangco/rhcsa-trainer && npm test && npm run typecheck
```
```
 ✓ test/scaffold.test.ts (2 tests) 3ms
 ✓ test/fake-transport.test.ts (5 tests) 6ms
 ✓ test/content/task.test.ts (4 tests) 15ms

 Test Files  3 passed (3)
      Tests  11 passed (11)

> rhcsa-trainer@0.1.0 typecheck
> tsc --noEmit
(silent — no output, exit 0)
```

### Extra verification: bad-fixture problem count

Ran `loadTask` against the `bad` fixture directly to confirm the aggregation
claim and the exact set of problems surfaced in one throw:

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

All 11 regexes asserted by the "reports every problem" test (`id`, `title`,
`chapter`, `scope`, `objectives`, `difficulty`, `time_budget`, `weight`,
`reboot_check`, `transport`, `prompt`) are present, and the count (12) is
above the `>=11` threshold with the deliberate slack the brief calls for.

## Files changed

- `src/engine/content/task.ts` (new)
- `test/content/task.test.ts` (new)
- `test/fixtures/tasks/good/task.yaml` (new)
- `test/fixtures/tasks/bad/task.yaml` (new)
- `test/fixtures/tasks/minimal/task.yaml` (new)

## Self-review

- Cross-checked every `TaskSpec` field against the brief's interface list
  (line 12): `id, title, chapter, scope, rhel, objectives, requiresConcepts,
  difficulty, timeBudget, weight, editions, rebootCheck, requiresDisks,
  claims, transport, prompt, dir` — all present, all correctly mapped from
  their snake_case source keys.
- Confirmed all field ranges match the brief's `Step 3` code exactly:
  chapter 1-28, rhel 9-10, difficulty 1-5, time_budget 30-3600,
  requires_disks 0-3 (`MAX_SPARE_DISKS`).
- Confirmed every validation problem the "reports every problem" test
  regex-matches is actually produced (verified via direct run above, not
  just by the test passing).
- Confirmed the tests exercise externally observable behavior (calling
  `loadTask` against fixture files, asserting on the resulting `TaskSpec`
  fields and `ContentError.problems`) rather than mirroring internal
  implementation details — this is the test code given verbatim by the
  brief, which follows that shape already.
- Erasable-syntax constraints respected: no `enum`, no parameter properties,
  no decorators; unions expressed as plain string literal unions with a
  `readonly string[]` const array for runtime membership checks.
- `.ts` extensions on all relative imports; `ContentError` imported as a
  value (not type-only) since it's used with `instanceof`/construction.
- No `sudo`/root usage, no filesystem writes outside the task's own new
  files, nothing touches `sechelp-tools`.
- Nothing overbuilt: implementation matches the brief's Step 3 code as
  written, no extra fields, no extra exports, no speculative validation
  rules beyond what the brief specifies.
- `npm test` output is pristine — 11/11 passing, no warnings; `npm run
  typecheck` produces no output (clean).

## Concerns

None. The brief's own decisions (MAX_SPARE_DISKS=3 as a schema bound, and
the `>=11` assertion slack) were implemented exactly as instructed, without
"correcting" them.
