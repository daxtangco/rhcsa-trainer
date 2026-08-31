# Pre-flight consistency scan — Tasks 1–14 (Part 1, Engine core)

Plan: `docs/superpowers/plans/2026-08-26-rhcsa-trainer-phase-0-1.md`
Slice: header + Global Constraints + File Structure (lines 1–128) and Tasks 1–14 (lines 135–4050).
Method: every `import` in every code block traced to the task that creates the file and exports the symbol; every `it(` block counted mechanically and compared to the stated "Expected: N new tests"; every fixture handler hand-simulated against the implementation it is meant to exercise.

Verified counts (mechanical): T1 2/2, T2 5/5 (7 total ✓), T3 4/4, T4 4/4, T5 12/12, T6 4/4, **T7 9 actual vs 8 stated**, T8 9/9, **T9 15 actual vs 14 stated**, T10 13/13, T11 13/13, T12 5/5, T13 8/8, T14 5/5.
Erasable-syntax scan of lines 135–4050: no `enum`, `namespace`, or parameter property anywhere except the deliberate `export enum Bad { A }` guard probe in T1 Step 5 (line 262), which is meant to fail.
Import-path scan: every relative import resolves to a file some task in this slice creates. No orphan module paths.

---

## Table A — cross-task interface pairs (Tasks 1–14)

| Tasks | Produced | Consumed | Finding |
|---|---|---|---|
| T1 → T2–T14 | `npm test`, `npm run typecheck`, `rhcsa` scripts (L182–187); `include: ["src","test","scripts"]` (L221); ESM + `erasableSyntaxOnly` + `allowImportingTsExtensions` (L215–217) | every later task's Step 4 runs `npm test && npm run typecheck`; T12 relies on the `rhcsa` script; T14's test imports from `scripts/` | OK — `scripts` is in `include` (L221) so T14's `test/corpus/extract.test.ts` → `../../scripts/extract-corpus.ts` typechecks. See Finding 4 for the `src/` step-5 break and Finding 9 for the `engines` disagreement. |
| T1 → T14 | `.gitignore` gets `corpus/` (L246) | T14 Step 6 "corpus/ is git-ignored (Task 1)" (L4032) | OK — matches exactly. |
| T1 → T2, T17/T18 | `vitest.config.ts` `exclude: ['test/**/*.vm.test.ts']` (L237) | T2 Files block rationale (L293); File Structure L52 vs L121–122 | MISMATCH (doc-level) — L52 says the gate is `test/vm/**`; the code (L233–237) and L121–122 say it is the `*.vm.test.ts` filename. Finding 8. |
| T2 → T3 | `ContentError` (`src/engine/content/errors.ts`, L444–454) | `import { ContentError } from './errors.ts'` (L643); test L547 | OK — name, path, `.problems`, `.where` all match. |
| T2 → T4 | `ContentError` | L927, test L858 | OK. |
| T2 → T6 | `ContentError` | L1411, test L1320 | OK. |
| T2 → T7 | `ContentError` | L1765, test L1625 | OK. |
| T2 → T8 | `LabTransport`, `ExecResult` (L387–392); `FakeTransport` ctor `(handler, opts?)` (L417) | `import type { LabTransport } from '../vm/transport.ts'` (L2117); test uses `new FakeTransport(fn)` (L1963) | OK. |
| T2 → T10 | `ContentError` | L2630, test L2482 | OK. |
| T2 → T11 | `LabTransport` (L3094); `FakeTransport` + `.calls` (test L2773, L2839) | `HarnessDeps.transport: LabTransport` (L3113); tests reassign `bad.transport = new FakeTransport(...)` | OK for types. The T2 test at L327–330 advertises defaulting behaviour `FakeHandler` does not have — Finding 7. |
| T2 → T12 | `ContentError` | L3444 (`../engine/content/errors.ts`) | OK — path correct from `src/cli/`. |
| T3 → T7 | `loadTask`, `TaskSpec` (L780, L656–674) | `import { loadTask, type TaskSpec } from './task.ts'` (L1768) | OK. `TaskSpec.requiresConcepts`/`objectives`/`scope` are mutable, which T7's tests (L1669, L1681, L1707) require. |
| T3 → T8 | `TaskSpec` shape (17 fields) | test factory L1927–1948 supplies all 17 fields in the same names | OK — field-by-field match, including `requiresDisks`, `rebootCheck`, `timeBudget`, `dir`. |
| T3 → T11 | `TaskSpec` shape | test factory L2776–2797 | OK — identical 17 fields. |
| T4 → T7 | `loadConcept`, `ConceptSpec` (L998, L929–938); `MIN_BODY_CHARS = 120` (L948) | L1766; bank fixture concept bodies (L1599–1601, L1613–1615) are 190+ and 200+ chars | OK — both fixture cards clear the 120-char floor, so `loadBank` will not throw. |
| T5 → T8 | `parseVerdict`, `statusById`, `Checkpoint`, `Verdict` (L1037–1040) | L2118 | OK. |
| T5 → T11 | `duplicateIds`, `statusById`, `Verdict` | L3093 | OK — `duplicateIds` returns `string[]`, used as `dupes.join(', ')` (L3188). |
| T6 → T7 | `loadObjectives`, `ObjectiveSet` incl. `byId` (L1487, L1419–1424) | L1767; `bank.objectives.byId.has(oid)` (L1843), `bank.objectives.objectives` (L1866) | OK. |
| T6 → T12 | `ObjectiveSet.objectives.length` | `objectives: ${bank.objectives.objectives.length}` (L3490) → test `/objectives: 3/` (L3394) | OK — fixture has 3 (L1545–1554). |
| T6 → T13 | `loadObjectives`; `OBJECTIVE_ID_RE` (L1426); chapters 1–28 (L1468); required `version` + `source` | `test/content/objectives-real.test.ts` (L3640–3714); transcription rules L3625–3626 restate the same regex and range | OK — the rule text at L3625 is character-for-character the same grammar as L1426. `source` must match `/visual/i` (L3653) and the prescribed string (L3601) contains "read visually". |
| T7 → T12 | `loadBank`, `checkCoverage`, `Bank`, `CoverageReport` (L1526–1527) | L3443; report fields used at L3487–3494 | OK — `problems`/`untaughtConcepts`/`uncoveredObjectives` names match. |
| T7 fixtures → T12 tests | `test/fixtures/bank` (2 tasks, 2 concepts, 3 objectives), `test/fixtures/bank-dupe` (L1729–1751) | T12 test L3377, L3412 | OK — counts asserted at L3392–3398 (2/2/3/1/1) match the fixture tree exactly; `bank-dupe` yields `duplicate task id` from L1815. Empty `concepts/` dir in bank-dupe is safe because `findMarkdown` swallows ENOENT (L1796). |
| T8 → T11 | `grade(opts)`, `GradeResult` incl. `verdictA/verdictB/regressions/rebooted/rebootError` (L1910–1913) | L3092; used at L3250–3258, L3285, L3292 | OK — `grade` is called with exactly `{task, transport, gradeScript, reboot}`. |
| T9 → (in-slice) | `MAX_RUNG`, `startLadder`, `canAdvance`, `advance`, `deriveRating` | no consumer in Tasks 1–14 (T23 consumes it) | OK — self-contained; test/impl agree on every branch (hand-checked all 9 `deriveRating` cases). |
| T10 → T11 | `parseExpectations(script, where, header?)`, `expectedStatus`, `ExpectedFailure`, `ExpectPhase` (L2455–2458) | L3095 imports only `expectedStatus, parseExpectations`; `ExpectedFailure` is used as a type at L3211 | **MISMATCH — Finding 3.** `ExpectedFailure` is never imported, so `tsc --noEmit` fails with TS2304 at L3211. |
| T10 → T11 | `'baseline-fail'` alternate header name (L2533–2545, L2660) | `parseExpectations(scripts.grade, ..., 'baseline-fail')` (L3269); harness fixture `BASELINE` string (L2862) | OK — same grammar, `@post` suffix parsed identically. |
| T11 → T12/T21 | `loadTaskScripts`, `validateTask`, `FixtureResult` | T12 explicitly defers `rhcsa validate` to T21 (L3367) | OK — no in-slice consumer; nothing in T12 references validate. |
| T13 → T7/T21 | `content/objectives.yaml` id vocabulary | `loadBank` expects `<root>/objectives.yaml` (L1804) | OK — filename and location agree; `content/tasks` and `content/concepts` do not exist until T21/T22 but `findFiles` tolerates that (L1789). |
| T14 → nothing | `findItems`, `weightSignal`, `corpus/**` | test L3763 only | OK — standalone; `Interfaces` correctly says "Consumes: nothing from the engine". |

---

## Table B — per-task internal consistency

| Task | Files declared vs touched | Tests vs code | Finding |
|---|---|---|---|
| 1 | Declares create `package.json`, `tsconfig.json`, `vitest.config.ts`; modify `.gitignore`; test `test/scaffold.test.ts` (L137–140). Steps touch exactly those, **plus** `src/_guard.ts` (L262) which is created/removed and not declared. | 2 `it(` (L154, L159) vs "Expected: 2 tests PASS" (L253) ✓ | **Finding 4** — `printf … > src/_guard.ts` (L262) runs before any task creates `src/` (verified: the directory does not exist), so the redirection fails, typecheck exits 0, and L266 then tells the agent the TypeScript version is too old. Also Finding 10 (`npx vitest run` at L168) and Finding 9 (`engines` 22.18.0 vs constraint 22.23.2). |
| 2 | Declares `transport.ts`, `fake.ts`, `errors.ts` + `test/fake-transport.test.ts` (L292–293); Step 3 creates exactly those three; commit adds `src/engine` (L468) ✓ | 5 `it(` vs "5 new tests (7 total)" (L460) ✓. All five assertions satisfied by the implementation except the second. | **Finding 7** — L327–330 is titled "defaults a handler-omitted stream to empty and code to 0" but the handler supplies every field and `FakeTransport` has no defaulting code; the test asserts nothing about defaulting. Also Finding 8 (the L293 rationale contradicts T1's config). |
| 3 | Declares `src/engine/content/task.ts` + `test/content/task.test.ts` + fixtures (L483–484); steps create `good/`, `bad/`, `minimal/` fixtures and the module; commit adds all (L797) ✓ | 4 `it(` vs 4 stated (L789) ✓. Bad fixture produces 12 problems; all 11 `toMatch` patterns hit; `>= 11` holds; `difficulty must be an integer 1-5` and `requires_disks must be an integer 0-3` are produced verbatim by `intInRange` (L699). Minimal fixture defaults all five optional fields as asserted. | **Finding 11** — the comment at L601 says "11 distinct problems" where the fixture yields 12. Assertion still passes. |
| 4 | Declares `concept.ts` + `test/content/concept.test.ts` + `test/fixtures/concepts/` (L811–812); steps create `good.md`, `bad.md`, `minimal.md`; commit adds all (L1014) ✓ | 4 `it(` vs 4 stated (L1006) ✓. `bad.md` triggers all four asserted problems (id regex L964, missing title L967, `rhel: 11` L971, `objectives: "not-a-list"` L952) plus the body floor; `minimal.md` body is 240+ chars so it clears `MIN_BODY_CHARS`. | OK |
| 5 | Declares `grading/verdict.ts` + `test/grading/verdict.test.ts` (L1028–1029); commit adds `src/engine/grading test/grading` ✓ | 12 `it(` vs 12 stated (L1263) ✓. Hand-checked every case: noise partitioning, non-checkpoint JSON, unknown status, weight passthrough, duplicate ids, `skip` not a pass, empty verdict false. | OK |
| 6 | Declares `objectives.ts` + test + `test/fixtures/objectives-good.yaml` (L1286–1287); commit adds exactly those (L1503) ✓ | 4 `it(` vs 4 stated (L1495) ✓. Every asserted message string is produced verbatim (`duplicate objective id:` L1459, `id must be dotted lowercase` L1457, `text must be non-empty` L1464, `chapters must be integers 1-28` L1471, `version` L1438, `source` L1441, `at least one objective` L1444). | OK |
| 7 | Declares `bank.ts` + `test/content/bank.test.ts` + `test/fixtures/bank/` (L1518–1519); Step 2 additionally creates `test/fixtures/bank-dupe/` (L1729–1751), which the Files block does not mention (the commit at L1886 does add it). | **9 `it(` vs "8 new tests" stated (L1878).** Logic itself is consistent: all seven `checkCoverage` assertions and both `loadBank` assertions are satisfied by the implementation. | **Finding 5** (count). Files-block omission of `bank-dupe` is cosmetic since the commit line covers it. |
| 8 | Declares `grading/grader.ts` + `test/grading/grader.test.ts` (L1903–1904); commit adds exactly those ✓ | 9 `it(` vs 9 stated (L2186) ✓. Every branch traced: no-reboot short-circuit (L2156), nothing-passed short-circuit, reboot + regression diff (L2174–2177), reboot throw → `rebootError` (L2162–2169), exit code ignored (L2150), `finalVerdict` identity (`toBe`) holds because `verdictB`/`verdictA` are returned by reference. | OK |
| 9 | Declares `disclosure/ladder.ts` + `test/disclosure/ladder.test.ts` (L2209–2210); commit adds `src/engine/disclosure test/disclosure` ✓ | **15 `it(` vs "14 new tests" stated (L2423).** Every assertion satisfied: caps 5/3/2, immutability, both throw messages match `advance`'s template (L2384), and all 9 `deriveRating` expectations match the cascade at L2410–2416. | **Finding 6** (count). |
| 10 | Declares `validate/expectations.ts` + `test/validate/expectations.test.ts` (L2449–2450); commit adds `src/engine/validate test/validate` ✓ | 13 `it(` vs 13 stated (L2724) ✓. All nine parse cases verified against the regex (L2642) and the loop (L2678–2701), including the `# baseline-fail:` vs `# expect-fail:` non-confusion at L2547 (the anchored `^#\s*expect-fail:` cannot match `# baseline-fail:`). `expectedStatus` matrix matches the table at L2468–2472 exactly. | OK |
| 11 | Declares `validate/harness.ts` + `test/validate/harness.test.ts` (L2748–2749); commit adds exactly those ✓. `Interfaces` claims it consumes `ContentError` (L2752) but the module never imports it. | 13 `it(` vs 13 stated (L2334) ✓ — but **six of the thirteen cannot pass as written.** The `world()` handler's early `return` in the `GROW` branch means the `CORRECT` script never sets `persisted`, and the inventory gate occupies `results[0]` in every test that shrinks `fixtures`. `ExpectedFailure` is used un-imported. | **Findings 1, 2, 3** (all breaking), plus Findings 12, 14, 15, 16. |
| 12 | Declares `src/cli/index.ts` + `test/cli/coverage.test.ts` (L3358–3359); commit adds `src/cli test/cli` ✓ | 5 `it(` vs 5 stated (L3540) ✓. All four output patterns and both exit codes traced; `--strict` message (L3505) matches `/1 uncovered objective/`; `usage: rhcsa` (L3451) matches both usage tests; the direct-invocation guard (L3528) is correct for `node src/cli/index.ts` so Step 5 (L3547–3548) works and the `rhcsa` npm script from T1 resolves. | OK |
| 13 | Declares `content/objectives.yaml`, `content/objectives-rhel10.yaml`, `test/content/objectives-real.test.ts` (L3575–3576); steps create exactly those; commit adds exactly those ✓ | 8 `it(` vs 8 stated (L3720) ✓. The 11 areas asserted at L3667–3679 are exactly the 11 areas prescribed at L3610–3620; the `source` string prescribed at L3601 satisfies `/visual/i`; the 20–80 bound and the `containers`/`flatpak` R2 assertions are consistent with Steps 3–4. | OK |
| 14 | Declares `scripts/extract-corpus.ts` + `test/corpus/extract.test.ts` (L3746–3747); Steps 5–6 also produce `corpus/**`, correctly declared git-ignored ✓ | 5 `it(` vs 5 stated (L4008) ✓. Hand-simulated `findItems` over `SAMPLE`: starts at lines 3/7/10/14, chapter-heading termination trims `Lab 15.1` at the `Chapter 16.` line, `MAX_BODY_LINES` never binds, numeric collation yields the asserted orders, longest-body-wins dedup picks the real heading over the TOC line, and `['r10','r9']` is the correct ASCII sort. Stated real-run figures are internally consistent (28 shared labs + 84 shared exercises = 112, L4018/L4021). | **Finding 13** — the Step 5 spot-check (L4026) uses `require()`, which the ESM-only Global Constraint (L22) forbids. |

---

## Findings requiring a ruling

**1. HIGH — Task 11's fixture handler makes the `CORRECT` solution script impossible to satisfy, so the task's headline test fails.** (L2806–2833, L2854, L2883–2897)
`world()`'s handler is an if/`return` chain: `if (script.includes('GROW')) { state.grown = true; state.mounted = true; return … }` returns before the `PERSIST` branch is reached. `CORRECT = 'GROW\nPERSIST\n'` (L2854) therefore only ever sets `grown`, never `persisted`. Both `solution` fixtures in `scripts()` (L2870–2871) use `CORRECT`, so verdict A reports `persist-config: fail`, and the harness requires `pass` for every checkpoint of a solution (L3289) — the test at L2883 ("passes a well-formed task with correct solutions") fails with `verdict A persist-config: expected pass, got fail` for `01-lvextend.sh` and `02-mount-unit.sh`.
Smallest fix: make the two mutation branches non-exclusive, e.g.
```ts
if (script.includes('GROW')) { state.grown = true; state.mounted = true }
if (script.includes('PERSIST')) { state.persisted = true }
if (script.includes('GROW') || script.includes('PERSIST')) return { stdout: '', stderr: '', code: 0 }
```
Verified this does not disturb the other tests: `FORGOT_PERSIST` still grows without persisting (L2966, L2992), and L2976 still produces `lv-var-size: expected fail, got pass`.

**2. HIGH — Task 11's inventory gate is unshifted into `results[0]`, so five tests assert against the wrong result object.** (L3320–3321 vs L2966–2974, L2976–2990, L2992–3008, L3022–3038, L3040–3060)
`validateTask` pushes the gate *before* the fixture loop. Five tests replace `s.fixtures` with a single fixture, which trips the gate (`needs at least 2 solutions…`, `needs at least 1 anti-solution…`), so `results[0]` is `fixture-inventory`, not the fixture. `expect(results[0]?.ok).toBe(false)` passes for the wrong reason, and every following `expect(results[0]?.failures.join('\n')).toMatch(…)` fails, because the gate's failures never contain `persist-config: expected pass, got fail` (L2973), `lv-var-size: expected fail, got pass` (L2989), `var-from-lv: expected pass, got fail` (L3007), `declares @post but the task has reboot_check: false` (L3036) or `grader emitted duplicate checkpoint ids: dup` (L3059).
Smallest fix: move the gate push to after the loop in `validateTask` —
```ts
for (const fixture of scripts.fixtures) results.push(await runFixture(task, scripts, fixture, deps))
if (!gate.ok) results.push(gate)
return results
```
This keeps L3010's `results.find(r => r.kind === 'none' && r.name === 'fixture-inventory')` working, leaves L2883's exact `results.map(r => r.name)` list intact (the gate is `ok` there and never pushed), and leaves L2942's `results[0]` as the `no-action` fixture.

**3. HIGH — Task 11 uses the type `ExpectedFailure` without importing it; `npm run typecheck` fails.** (L3211 vs L3095)
`let declared: ExpectedFailure[] = []` references a type exported by `src/engine/validate/expectations.ts` (L2634), but the import at L3095 is `import { expectedStatus, parseExpectations } from './expectations.ts'`. Result: TS2304 "Cannot find name 'ExpectedFailure'", so Task 11 Step 4's "typecheck clean" can never be reached.
Smallest fix: `import { expectedStatus, parseExpectations, type ExpectedFailure } from './expectations.ts'` (inline `type` is required by `verbatimModuleSyntax`, L217).

**4. HIGH — Task 1 Step 5 writes into `src/`, which no task has created yet, so the erasable-syntax guard silently proves nothing and then misdirects the agent.** (L259–266)
Verified on disk: `/home/daxtangco/rhcsa-trainer/src` does not exist, and Task 1's own Files block (L138–140) creates only `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` and `test/scaffold.test.ts`. `printf 'export enum Bad { A }\n' > src/_guard.ts` therefore fails with ENOENT, no file is written, `npm run typecheck` exits 0 — and L266 instructs the agent to conclude "the TypeScript version is too old — raise it to `^5.8.0` and repeat", an infinite loop against a version that is already `^5.8.0` (L195). The trailing `rm src/_guard.ts` also fails.
Smallest fix: insert `mkdir -p src` before the `printf`, and `rmdir src 2>/dev/null || true` after the `rm` (or write the probe to `test/_guard.ts`, which is equally covered by `include`).

**5. MEDIUM — Task 7's stated test count is wrong: 8 claimed, 9 written.** (L1878 vs `it(` blocks at L1630, 1648, 1653, 1660, 1665, 1677, 1689, 1701, 1718)
An agent that treats "Expected: 8 new tests PASS" as an acceptance gate will believe it has mis-implemented something, or will delete a test to reach 8.
Smallest fix: change L1878 to "9 new tests PASS".

**6. MEDIUM — Task 9's stated test count is wrong: 14 claimed, 15 written.** (L2423 vs `it(` blocks at L2244, 2252, 2256, 2263, 2274, 2281, 2299, 2303, 2307, 2311, 2315, 2319, 2323, 2328, 2334)
Smallest fix: change L2423 to "15 new tests PASS".

**7. MEDIUM — Task 2's second test promises defaulting behaviour that neither the test nor `FakeTransport` implements, and "fixing" it would change a published type three tasks depend on.** (L327–330 vs L400, L417–425)
The test is named "defaults a handler-omitted stream to empty and code to 0", but its handler returns `{ stdout: 'ok', stderr: '', code: 0 }` — every field present — and asserts the identical object back. Nothing about defaulting is exercised; `FakeHandler` is typed `(script: string) => ExecResult | Promise<ExecResult>` (L400), which makes omission impossible. A TDD-following agent may reasonably widen `FakeHandler` to return `Partial<ExecResult>` and add defaults in `exec`, silently changing the type that T8 (L1963) and T11 (L2806) build their handlers against.
Smallest fix: rule one way and write it into the plan. Either (a) rename the test to "returns the handler's result unchanged" and leave `FakeHandler` alone, or (b) change `FakeHandler` to `=> Partial<ExecResult> | Promise<Partial<ExecResult>>`, have `exec` fill `{stdout:'',stderr:'',code:0}`, and change the test's handler to `() => ({ stdout: 'ok' })`. Option (a) is the smaller change and leaves T8/T11 untouched.

**8. LOW — the File Structure summary describes the VM test gate as directory-based, contradicting Task 1's config and Task 2's file choice.** (L52 vs L237, L121–122, L293)
L52 reads "`vitest.config.ts` test roots; `test/vm/**` needs `RHCSA_VM=1`". The actual config excludes `test/**/*.vm.test.ts` and its comment (L233–236) explicitly says "The gate is on the filename, not the directory: `test/vm/` also holds unit tests… and those must always run" — matching L121–122. Task 2's Files block (L293) repeats the wrong belief as its reason for naming the file `test/fake-transport.test.ts`. An agent implementing T17/T18 from the summary would write the wrong `exclude` and silently skip the fake-driven transport suites.
Smallest fix: change L52 to "`test/**/*.vm.test.ts` needs `RHCSA_VM=1`" and delete the stale rationale at L293 (keep the filename).

**9. LOW — `package.json` `engines.node` disagrees with the Global Constraint.** (L181 `">=22.18.0"` vs L19 "Node >= 22.23.2" and L9 "Node 22.23.2")
Not fatal (npm only warns), but it is the kind of discrepancy an agent will "correct" in either direction. 22.18.0 is presumably deliberate — it is where type stripping became on-by-default — in which case say so.
Smallest fix: keep `">=22.18.0"` and add a one-line comment in the plan explaining why it is lower than the installed 22.23.2, or raise it to `">=22.23.2"`.

**10. LOW — Task 1 Step 2's failure probe may install and pass, or block on an interactive prompt.** (L168–169)
`npx vitest run` with no `node_modules` will fetch vitest and run it; `test/scaffold.test.ts` needs no config and would then PASS, contradicting "Expected: FAIL". In a non-TTY agent shell npx may instead sit on its install confirmation. The plan hedges ("`npx` will either error or prompt"), but neither branch is a clean red test.
Smallest fix: use `npx --no vitest run` (exits non-zero immediately when vitest is not installed locally).

**11. LOW — Task 3's inline comment states a problem count the fixture does not produce.** (L601 vs the `bad` fixture at L523–541)
The fixture yields 12 problems (id, title, chapter, difficulty, time_budget, requires_disks, scope, weight, transport, reboot_check, objectives, prompt), not the "11 distinct problems" the comment claims. The assertion is `toBeGreaterThanOrEqual(11)` so nothing fails, but the comment will be committed as documentation of a wrong number.
Smallest fix: change the comment to 12, or say "at least 11 of the 12".

**12. LOW — Task 11 has a dead disjunct in the `@post`-without-reboot guard.** (L3225–3235)
The condition enters on `d.phase === 'post' || d.phase === 'both'`, but the body only collects `phase === 'post'` ids and then guards `if (ids !== '')`. A declaration containing only `@both` entries on a `reboot_check: false` task enters the branch and reports nothing, so the `|| 'both'` arm can never produce output. A reviewer will read this as a missing case.
Smallest fix: drop `|| d.phase === 'both'` from the `some()` (and then the `ids !== ''` guard is redundant too).

**13. LOW — Task 14's spot-check command uses `require()`, which the plan's own ESM-only constraint forbids.** (L4026 vs L22)
`node -e "const l=require('./corpus/r9/labs.json'); …"` does work (`-e` input is treated as CommonJS regardless of `"type": "module"`), but it directly contradicts "ESM only… No `require`", and an agent obeying the constraint will stall or rewrite it inconsistently.
Smallest fix: replace with `node --input-type=module -e "const l = JSON.parse(await (await import('node:fs/promises')).readFile('corpus/r9/labs.json','utf8')); console.log(l.find(i=>i.id==='Lab 15.1').text.slice(0,400))"`, or use `jq -r '.[]|select(.id=="Lab 15.1")|.text' corpus/r9/labs.json | head -c 400`.

**14. LOW — Task 11's `Interfaces` block lists a dependency the module does not have.** (L2752)
It claims `ContentError` (T2) is consumed, but `harness.ts` never imports it — it stringifies caught errors via `e instanceof Error ? e.message : String(e)` (L3221, L3271). Harmless at runtime; it misleads anyone using the Interfaces blocks to derive the dependency graph.
Smallest fix: delete `ContentError (T2)` from L2752, or add `statusById`-style accuracy by noting it is caught, not imported.

**15. LOW — Task 11 contains a duplicated test.** (L2925–2932 vs L2883–2897)
"accepts an invariant checkpoint that passes at baseline" builds the same `world()`, the same `scripts()` and the same `deps()` as the first test and asserts `none?.failures` is empty — which the first test already asserts for every fixture including `no-action`. It adds no coverage; it only doubles the cost of Finding 1.
Smallest fix: keep it but make it distinguishing (e.g. assert that `var-from-lv` is `pass` in verdict A while `lv-var-size` is `fail`), or delete it and reduce the stated count to 12.

**16. LOW — Task 11 reports grader duplicate ids twice on a reboot-checking task.** (L3186–3189, called at L3284–3285 and L3291–3292)
`checkVerdict` runs the `duplicateIds` check for verdict A and again for verdict B, so a task with `reboot_check: true` and a duplicated checkpoint id emits `grader emitted duplicate checkpoint ids: dup` twice in `failures`. The test at L3040 uses `rebootCheck: false` so it never sees it.
Smallest fix: hoist the duplicate check out of `checkVerdict` into `runFixture`, run it once on `result.verdictA`.

---

### Explicitly checked and found clean

- No `enum` / `namespace` / parameter property in any implementation code block in Tasks 1–14 (the only `enum` is T1's deliberate guard probe at L262).
- Every relative import carries `.ts`; every relative import path is created by a task in this slice; no import from a module no task creates.
- No config file in Tasks 1–14 is written twice: `package.json`, `tsconfig.json`, `vitest.config.ts` are created once (Task 1) and never re-emitted; `.gitignore` is appended to, not replaced, and the existing entries (`node_modules/`, `dist/`, `.env`, `.env.local`, `.superpowers/`) survive.
- `allowImportingTsExtensions` is paired with `noEmit` (both L215/L218), so tsconfig is internally valid.
- Task 12's direct-invocation guard (`import.meta.url === \`file://${process.argv[1]}\``) is correct for `node src/cli/index.ts`, so both the `rhcsa` npm script (L186) and Step 5 (L3547) work.
- Task 3/4/6/7 fixture data satisfies every validator the same task writes (id regexes, chapter/difficulty/time-budget ranges, the 120-char concept body floor).
- Tasks 5, 8, 9, 10, 12, 13, 14 are internally consistent: every assertion is satisfied by the implementation in the same task, and every stated count matches.
