# Task 7 independent review: content bank loader and coverage report

Reviewer: independent (did not write this code). Commit under review: `1b29a6d`
(`8dffbf6..1b29a6d`). Working tree was clean before and after review; all
throwaway fixtures were built under `/tmp` and deleted.

- **Spec compliance verdict: APPROVED**
- **Task quality verdict: CHANGES REQUESTED** (test adequacy + one fixture
  determinism defect; the implementation itself is clean)
- **Deviation 1: implemented correctly and completely** (behaviour), but only
  partly locked by tests
- **Deviation 2: implemented correctly and completely**, and locked by a test

---

## 1. Observed test and typecheck output

```
$ npm test
 ✓ test/scaffold.test.ts (2 tests) 3ms
 ✓ test/fake-transport.test.ts (5 tests) 6ms
 ✓ test/grading/verdict.test.ts (13 tests) 12ms
 ✓ test/content/objectives.test.ts (10 tests) 22ms
 ✓ test/content/task.test.ts (4 tests) 24ms
 ✓ test/content/concept.test.ts (6 tests) 34ms
 ✓ test/content/bank.test.ts (12 tests) 107ms

 Test Files  7 passed (7)
      Tests  52 passed (52)
   Duration  1.01s

$ npm run typecheck
> tsc --noEmit
(no output, exit 0)
```

Node v22.23.2. No console noise, no warnings. The report's claimed output
matches what I observed.

## 2. Exported surface and global constraints

Verified against the brief, unchanged:

```ts
export interface Bank { root, objectives, tasks, concepts, tasksById, conceptsById }
export interface CoverageReport { problems: string[]; untaughtConcepts: string[]; uncoveredObjectives: string[] }
export async function loadBank(root: string): Promise<Bank>
export function checkCoverage(bank: Bank): CoverageReport
```

- No `!` non-null assertions and no `as` casts anywhere in
  `src/engine/content/bank.ts`. `grep -n '\bas\b\|[A-Za-z_)\]]!'` returns only
  prose inside doc comments (lines 32, 36, 47, 48). The `allSettled` narrowing
  is genuine (`result.status === 'fulfilled'` / `!== 'fulfilled'`), never a cast.
- `noUncheckedIndexedAccess` handled without casts: `taskFiles[i]` /
  `conceptFiles[i]` are guarded with `if (file === undefined) continue`.
- `import type { Dirent } from 'node:fs'` — `verbatimModuleSyntax` satisfied.
  All relative imports carry `.ts`. No `enum`, no parameter properties, no
  namespaces; `erasableSyntaxOnly` clean (typecheck confirms).
- No new dependencies. Only `node:fs`, `node:fs/promises`, `node:path` and the
  three sibling loaders. Nothing needs a VM; the whole suite runs offline.
- House idiom: `bank.ts` correctly does **not** define a local `isRecord`. It
  never touches raw YAML/front-matter — it consumes the already-typed results
  of `loadTask`/`loadConcept`/`loadObjectives`. The implementer's reasoning on
  this is correct and I confirm it is not a divergence. The aggregating-error
  idiom (accumulate into `problems: string[]`, throw one `ContentError`) is
  followed faithfully and is in fact extended one level up, which is the point
  of deviation 1.

## 3. Empirical proof of the `ContentError`-only invariant

Built 17 throwaway trees under `/tmp/bank-probe/trees` and called `loadBank`
on each, recording the constructor name of whatever came out.

| # | Probe case | Outcome | Constructor / `.name` |
|---|---|---|---|
| 1 | entirely valid bank | resolved | — |
| 2 | `objectives.yaml` invalid YAML syntax | threw | `ContentError` / `ContentError` |
| 3 | `objectives.yaml` absent (ENOENT) | threw | `ContentError` / `ContentError` |
| 4 | root directory does not exist at all | threw | `ContentError` / `ContentError` |
| 5 | `tasks/` absent | threw | `ContentError` / `ContentError` |
| 6 | `concepts/` absent | threw | `ContentError` / `ContentError` |
| 7 | `tasks/` **and** `concepts/` absent | threw | `ContentError` / `ContentError` |
| 8 | two task files malformed differently | threw | `ContentError` / `ContentError` |
| 9 | malformed task **and** malformed concept | threw | `ContentError` / `ContentError` |
| 10 | malformed `objectives.yaml` **and** malformed task | threw | `ContentError` / `ContentError` |
| 11 | duplicate task id **and** malformed task | threw | `ContentError` / `ContentError` |
| 12 | `task.yaml` is an empty file | threw | `ContentError` / `ContentError` |
| 13 | `concepts/` entry is a **directory** named `notafile.md` | resolved | — |
| 14 | `concepts/` `chmod 000` (EACCES) | threw | `ContentError` / `ContentError` |
| 15 | symlink loop inside `tasks/` | resolved | — |
| 16 | `objectives.yaml` is a directory (EISDIR) | threw | `ContentError` / `ContentError` |
| 17 | `tasks/` is a file, not a directory (ENOTDIR) | threw | `ContentError` / `ContentError` |
| 18 | duplicate concept id | threw | `ContentError` / `ContentError` |

**Nothing other than `ContentError` escaped `loadBank` in any of the 18 probe
cases.** Raw `YAMLException` (case 2) and raw Node `ENOENT`/`EISDIR`/`ENOTDIR`/
`EACCES` (cases 3, 4, 5, 6, 7, 14, 16, 17) were all wrapped.

Key sub-results:

- **No `TypeError` from a missing `ObjectiveSet`.** Cases 2, 3, 4 and 16 all
  fail `loadObjectives` and all still reach `bank.ts:131` and throw the
  aggregate before `objectivesResult.value` is dereferenced at line 137.
  Proven, not assumed.
- **The objectives failure does not mask task failures** (case 10). Both are in
  one error:
  ```
  /tmp/.../obj-and-task: 2 problem(s)
    - /tmp/.../objectives.yaml: unexpected end of the stream within a flow collection (5:1)
  ...
    - /tmp/.../tasks/area-a/001-bad-id/task.yaml: id must look like "<area>/<nnn>-<slug>", lowercase
  ```
- **Nonexistent root gives three problems in one error**, which is the ideal
  message for a mistyped path: the missing `objectives.yaml`, the unreadable
  `tasks/`, and the unreadable `concepts/`.
- Cases 13 and 15 resolving is correct, not a bug: `findMarkdown` filters on
  `e.isFile()`, and Node's `readdir({recursive:true})` does not traverse
  symlinked directories, so the loop cannot hang. Worth knowing that a
  directory named `*.md` is silently ignored, but that is defensible.

**Attributability (case 8) is good.** Every merged problem carries the source
file, taken from `ContentError.where`, so the two differently-malformed task
files are individually identifiable:

```
/tmp/.../tasks/area-a/001-bad-id/task.yaml: id must look like "<area>/<nnn>-<slug>", lowercase
/tmp/.../tasks/area-b/002-bad-obj/task.yaml: objectives must list at least one objective id
```

Same for case 9, where five concept problems all stay pinned to
`concepts/storage/stub.md`. `describeFailure` (bank.ts:39) does exactly what
the ruling asked.

## 4. `checkCoverage` verified independently of `loadBank`

Constructed `Bank` objects by hand (no `loadBank`) and called `checkCoverage`:

| Case | `problems` | `untaughtConcepts` | `uncoveredObjectives` |
|---|---|---|---|
| all clean | `[]` | `[]` | `[]` |
| task → unknown concept | `["x/001-y requires unknown concept: k.missing"]` | `[]` | `[]` |
| task → unknown objective | `["x/001-y maps to unknown objective: nope.nope"]` | `[]` | `["a.b.c"]` |
| concept → unknown prerequisite | `["k.one lists unknown prerequisite: k.ghost"]` | `[]` | `[]` |
| concept no task references | `[]` | `["k.lonely"]` | `[]` |
| objective no task covers | `[]` | `[]` | `["d.e.f"]` |
| instrumental-only task | `[]` | `[]` | `["a.b.c"]` |
| empty bank | `[]` | `[]` | `[]` |
| task lists one valid + one ghost objective | ghost reported; valid one still covered | `[]` | `[]` |
| objective claimed by instrumental **and** exam task | `[]` | `[]` | `[]` (exam task covers it) |
| concept required only by an instrumental task | `[]` | `[]` (still counts as taught) | `[]` |
| same unknown concept in two tasks | reported once per task | `[]` | `[]` |

Confirmed: `problems` contains **only** unresolvable references;
`untaughtConcepts` and `uncoveredObjectives` are separate counted lists and are
never folded into `problems`. This matches the brief's design note exactly, and
the all-clean case yields three empty arrays. `checkCoverage` is pure, total,
and I found no input that makes it throw.

## 5. Test adequacy — mutation-tested

The 12 tests, and what each locks:

*Brief's 9 (verbatim, all passing):*
1. `loadBank` discovers/indexes tasks + concepts recursively — locks discovery,
   both `Map` indexes, `objectives.byId.size`.
2. clean bank → `problems: []`.
3. `untaughtConcepts` lists the orphan card.
4. `uncoveredObjectives` lists `autofs.maps.configure`.
5. unresolvable `requires_concepts` → hard problem.
6. unknown objective id on a task → hard problem.
7. unresolvable concept prerequisite → hard problem.
8. instrumental task excluded from coverage.
9. duplicate task id → `ContentError` with `/duplicate task id/`.

*3 new for the deviations:*
10. both malformed task files named in one `ContentError`.
11. malformed `objectives.yaml` wrapped as `ContentError`, not `YAMLException`.
12. missing `tasks/` rejects rather than resolving to an empty bank.

I mutated `bank.ts` in a scratch clone to see which behaviours are actually
locked:

| Mutation | Test suite result |
|---|---|
| M1: `throw` immediately after the objectives failure (restore fail-fast masking) | **12/12 pass — SURVIVES** |
| M2: delete the duplicate-**concept**-id detection (bank.ts:121) | **12/12 pass — SURVIVES** |
| M3: revert deviation 2 (`readdir` → swallow, return `[]`) | 1 failed — killed |
| M4: revert deviation 1 for **tasks** (`Promise.all`) | 1 failed — killed |
| M5: revert deviation 1 for **objectives** (bare `await`) | 1 failed — killed |
| M6: revert deviation 1 for **concepts** (`Promise.all`) | **12/12 pass — SURVIVES** |

Behaviours I probed above that **no test locks**: nonexistent root; absent
`objectives.yaml` (the ENOENT path, as distinct from bad YAML); absent
`concepts/`; both directories absent; malformed task + malformed concept
together; malformed `objectives.yaml` + malformed task together; duplicate task
id + malformed task together; empty `task.yaml`; a directory named `*.md`;
`EACCES`; duplicate concept id; concept-loader aggregation (M6).

**The most important untested behaviour: that a failed `loadObjectives` does not
short-circuit and mask task/concept failures.** M1 proves this: reinstating the
exact fail-fast behaviour that deviation 1 exists to eliminate leaves all 12
tests green. That single-line regression is the most likely future edit
("simplify: if objectives is broken there's no point continuing") and nothing
catches it.

Do the tests verify behaviour or restate the implementation? Mostly behaviour —
tests 5–8 mutate a loaded `Bank` in memory and re-derive the report, and
tests 10–12 assert on observable error content rather than on internals. Two
weak spots noted as findings below.

## 6. Fixtures

New fixture trees (`bank-multi-malformed`, `bank-bad-objectives`,
`bank-missing-tasks`) are minimal, purposeful, and each isolates one failure
mode; the malformed files differ in *kind* (bad id vs missing objectives),
which is what the aggregation test needs. The brief's original
`test/fixtures/bank/` and `bank-dupe/` were created exactly as specified.
`git show --name-status 1b29a6d` shows 19 files, all `A` — **no pre-existing
file was modified**, and all pre-task-7 fixtures (`test/fixtures/tasks/`,
`concepts/`, `objectives-good.yaml`) are untouched and their suites still pass.
One fixture hygiene defect, finding 1.

## 7. Findings

**1. BLOCKING — no test locks the "objectives failure must not mask later
failures" behaviour** (`test/content/bank.test.ts`, missing case; the code it
protects is `src/engine/content/bank.ts:83-85` + `:131`).
Reinstating fail-fast after the objectives load (mutation M1) leaves all 12
tests passing. This is the *core* of deviation 1 — the whole reason the ruling
replaced `Promise.all` — and it is the single edit most likely to be made by a
future simplifier. Concrete failure it causes: someone adds an early
`throw` for "clarity", CI stays green, and the author is back to one problem per
run whenever `objectives.yaml` is also broken. Fix: one test against a fixture
with a malformed `objectives.yaml` *and* a malformed task, asserting both
appear in the same `ContentError.problems`. My probe (case 10) shows the code
already behaves correctly, so this is purely a missing lock, not a code change.

**2. NON-BLOCKING — `test/fixtures/bank-dupe/` produces a different problem
list on a fresh clone than in the author's working tree.**
`bank-dupe/concepts/` is an empty directory, so git does not track it
(`git ls-files test/fixtures/bank-dupe` lists only three files). I verified by
cloning the repo to `/tmp`:

```
AUTHOR TREE: ["duplicate task id: users/001-create-account (.../tasks/b/001-x)"]
FRESH CLONE: ["cannot read directory .../bank-dupe/concepts: ENOENT: ...",
              "duplicate task id: users/001-create-account (.../tasks/b/001-x)"]
```

The test passes in both (its assertion is a loose `toMatch(/duplicate task
id/)`), and I confirmed 12/12 pass in the fresh clone. But this fixture now
carries a second, unintended defect that exists only off the author's machine.
Concrete failure it causes: the first person to tighten that assertion to
`toEqual([...])` or `toHaveLength(1)` gets a test that passes locally and fails
in CI, with a cause three commits upstream. The implementer identified this and
chose not to act because it is the brief's fixture; I disagree — deviation 2
changed the meaning of an empty `concepts/`, so the fixture needs to change with
it. Fix: add a valid concept card (or a `.gitkeep`) under
`test/fixtures/bank-dupe/concepts/`.

**3. NON-BLOCKING — vacuous assertion in the deviation-2 test.**
`test/content/bank.test.ts:145`:
`expect((result.error as ContentError).problems.join('\n')).toMatch(/tasks/)`.
The fixture root is `bank-missing-**tasks**`, so every problem string from that
tree contains `tasks` by virtue of its own path. I verified `/tasks/` matches
`"cannot read directory .../bank-missing-tasks/concepts: ENOENT"` — the
assertion cannot distinguish a `tasks/` problem from a `concepts/` one. The
`result.ok === false` half of this test is meaningful (and killed mutation M3),
so the test is not worthless, but line 145 buys nothing. Fix:
`toMatch(/cannot read directory .*[/\\]tasks:/)`.

**4. NON-BLOCKING — `bank.ts:121` duplicate concept id detection has zero test
coverage.** Deleting the line entirely leaves 12/12 green (mutation M2). The
behaviour is correct (probe 18), but a duplicated concept card — a plausible
authoring accident when copy-pasting a card across chapters — is unprotected.
Cheap to lock: a fixture with the same card in two paths.

**5. NON-BLOCKING — concept-loader aggregation is untested** (`bank.ts:101`).
Mutation M6 (reverting the concepts `Promise.allSettled` to `Promise.all`)
survives. The task path is locked by M4, the concept path is not, so the two
symmetric branches have asymmetric protection.

**6. NON-BLOCKING — `if (file === undefined) continue` silently drops a
rejection** (`bank.ts:92` and `:105`). The branch is unreachable —
`Promise.allSettled` preserves length and order — so it exists only to satisfy
`noUncheckedIndexedAccess` without a cast, which is the right trade against a
`!`. But the failure mode it chooses is *silent loss of a problem*, in a
function whose entire purpose is not losing problems. If the invariant were
ever broken, the author would see a bank load "successfully" while a file was
skipped. A stricter shape avoids the index entirely and cannot drop anything:
```ts
const taskResults = await Promise.allSettled(
  taskFiles.map(async (f) => ({ file: f, spec: await loadTask(dirname(f)) })),
)
```
(then `result.reason` still needs the filename, so alternatively map each
loader call through a local `try`/`catch` that returns a tagged union). Not
worth blocking; noting it because the current guard's else-branch is the one
place a problem can vanish.

**7. NON-BLOCKING — the duplicate-id message names only the second file.**
`bank.ts:115` / `:121` emit `duplicate task id: users/001-create-account
(/…/tasks/b/001-x)`. The author must grep the tree to find the *other* file in
the collision, which is the harder half of the job. This is verbatim from the
brief so it is not a deviation, but given that this error reporting is the tool
the user will spend hours inside, carrying the first-seen path
(`… also declared in /…/tasks/a/001-x`) would be a clear improvement. Flagging
for the brief author's attention rather than as a defect in this task.

**8. NON-BLOCKING — degenerate aggregate message if a loader ever throws an
empty-`problems` `ContentError`** (`bank.ts:131-133`). `describeFailure`
returns `[]` for `ContentError{problems: []}`, so `problems` could stay empty
while `objectivesResult.status !== 'fulfilled'`; the throw then renders as
`"/root: 0 problem(s)\n  - "` (verified by constructing that `ContentError`
directly). No current loader can produce this — all three throw only when
`problems.length > 0` — so it is theoretical. Mentioned because the redundant
disjunct at line 131 is the only thing standing between it and a resolved bank
with an undefined `objectives`, which makes that "redundant" disjunct load-bearing
after all and worth keeping.

No overbuilding found: the file is 187 lines, has no speculative options, no
caching, no logging layer, no exported helpers beyond the brief's four. No
silently-dropped requirements: every element of the brief's `checkCoverage` and
`loadBank` contract is present and behaves as specified.

## 8. Judgment on the one-element-tuple `allSettled` for `loadObjectives`

`bank.ts:82`:

```ts
const [objectivesResult] = await Promise.allSettled([loadObjectives(join(root, 'objectives.yaml'))])
```

**It narrows correctly.** `Promise.allSettled<T extends readonly unknown[] | []>`
infers the array literal as the 1-tuple `[Promise<ObjectiveSet>]`, so the result
is `[PromiseSettledResult<ObjectiveSet>]`; destructuring index 0 of a
fixed-length tuple is a known element and `noUncheckedIndexedAccess` adds no
`| undefined`. The subsequent `status === 'rejected'` / `!== 'fulfilled'` checks
are real discriminated-union narrowing, with no cast and no `!`. `tsc --noEmit`
is clean and mutation M5 confirms the wrapping it provides is genuinely load-
bearing. So it is compliant with the ruling (which said `allSettled` for
`loadObjectives` too) and it is not a correctness problem.

**It does read as mildly contorted, and I would not have written it this way.**
Three costs: (a) the 102-character line needs a three-line comment explaining a
TypeScript *inference* rule rather than anything about content loading; (b) it
forces a second explanatory comment at line 131 about a runtime-redundant
disjunct existing for the type checker; (c) `allSettled` over one promise buys
no concurrency — and because this `await` precedes the two `readdir` calls,
objectives loading is serialized ahead of everything anyway, so the "settled"
machinery is purely notational. The plain alternative is shorter and needs no
commentary:

```ts
let objectives: ObjectiveSet | undefined
try {
  objectives = await loadObjectives(join(root, 'objectives.yaml'))
} catch (error) {
  problems.push(...describeFailure(join(root, 'objectives.yaml'), error))
}
// …
if (problems.length > 0 || objectives === undefined) throw new ContentError(root, problems)
```

That narrows just as genuinely, removes both comments, and makes finding 8's
degenerate case impossible to reason about wrongly. **Verdict: acceptable as
written, not a finding** — the ruling asked for `allSettled` and the
implementer honoured it with correct narrowing rather than a cast, which was the
part that actually mattered. If the ruling's intent was uniform *behaviour*
rather than uniform *mechanism*, the `try`/`catch` above would be the better
code, and I would support switching to it. I would not hold the task for it.

## 9. Summary

The implementation is genuinely good: both deviations are implemented correctly
and completely, the `ContentError`-only invariant holds across 18 adversarial
probes including four distinct raw-errno paths and a real `YAMLException`,
attribution survives merging, `checkCoverage` is correct on twelve hand-built
banks, and the file contains not one `!` or `as`. The report was accurate
throughout — I found no claim in it that did not hold up, and the two things it
self-flagged (the `isRecord` absence and the tuple `allSettled`) I judge in its
favour.

What holds it back is the test layer, not the code: mutation testing shows three
of the file's behaviours — including the central anti-masking property that
deviation 1 exists for — survive deliberate reversion. Fix finding 1 (one test),
and preferably findings 2–5 (one fixture file plus three cheap assertions), and
this is done.
