# Task 8 independent review: grading sequence with the reboot check

Reviewer: independent (did not write this code). Diff under review:
`review-915bfc6..83c5c1f.diff` (commit `83c5c1f`).

- **Spec compliance verdict: APPROVED**
- **Task quality verdict: APPROVED**
- **Deviation 1: correct and complete**
- **Deviation 2: correct and complete** (two stated sub-requirements have no test — see F1, F2)
- **Deviation 3: correct and complete**

No blocking findings. All 13 assigned mutations were killed. The two false-pass
paths this task exists to close are closed, and I could not construct an input
to `grade` + `finalVerdict` where a broken or unverified machine yields
`allPassed(finalVerdict(r)) === true`.

---

## 1. Verified inputs

The files on disk match the diff byte-for-byte (I read
`src/engine/grading/grader.ts` and `test/grading/grader.test.ts` directly rather
than trusting the diff).

Confirmed independently in `src/engine/grading/verdict.ts:80-82`:

```ts
export function allPassed(v: Verdict): boolean {
  return v.checkpoints.length > 0 && v.checkpoints.every((cp) => cp.status === 'pass')
}
```

So a zero-checkpoint verdict is not a pass — this matters for the
`rebootError` + empty-A case (probe P3).

Confirmed the downstream stake is real. The plan's report builder
(`docs/superpowers/plans/2026-08-26-rhcsa-trainer-phase-0-1.md:9237-9245`) does:

```ts
const v = finalVerdict(result)
const report: GradeReport = {
  passed: v.checkpoints.filter((c) => c.status === 'pass').length,
  total: v.checkpoints.length,
  allPassed: allPassed(v),
  ...
```

`total` is `finalVerdict(...).checkpoints.length` and is compared against
`session.checkpointTotal`, which T22 derives statically by counting `ck` calls in
`grade.sh`. Deviation 1's ban on a synthesized "boot" checkpoint is therefore
load-bearing, not stylistic, and the implementation honours it.

## 2. Observed test and typecheck output

```
$ npm test
 ✓ test/scaffold.test.ts (2 tests) 2ms
 ✓ test/fake-transport.test.ts (5 tests) 3ms
 ✓ test/grading/verdict.test.ts (13 tests) 5ms
 ✓ test/grading/grader.test.ts (15 tests) 8ms
 ✓ test/content/objectives.test.ts (10 tests) 10ms
 ✓ test/content/task.test.ts (4 tests) 12ms
 ✓ test/content/concept.test.ts (6 tests) 30ms
 ✓ test/content/bank.test.ts (15 tests) 72ms

 Test Files  8 passed (8)
      Tests  70 passed (70)
   Duration  471ms

$ npm run typecheck
> tsc --noEmit
(no output, exit 0)
```

Output is pristine: no stray `console` writes, no unhandled-rejection warnings,
no skipped or todo tests. The implementer's reported numbers (15 new / 70 total,
clean typecheck) are accurate. Node 22.23.2, no build step, `vitest` 3.2.7.

Global constraints re-checked by hand on `grader.ts`:

- No `enum`, no parameter properties, no namespaces — `erasableSyntaxOnly` clean.
- `verbatimModuleSyntax`: `import type { TaskSpec }` / `import type { LabTransport }`
  plus inline `type Checkpoint` / `type Verdict` modifiers, matching `bank.ts`'s
  house style.
- All three relative imports carry explicit `.ts` extensions.
- **Zero `!` non-null assertions and zero `as` casts** in the new source file.
  This is the notable one: the place a cast was predicted to hide — looking up
  A's `desc` by id under `noUncheckedIndexedAccess` — was avoided structurally.
  `completeVerdictB` iterates `verdictA.checkpoints` directly and reads `cp.desc`
  off a `Checkpoint` value, so there is no indexed access and no id→desc map to
  dereference. That is the right shape, not a workaround.
- No new dependencies; `package.json` untouched.
- Tests use `FakeTransport` only; nothing in the suite needs a VM.

## 3. Mutation testing

Method: apply one mutation to `src/engine/grading/grader.ts`, run
`npx vitest run test/grading/grader.test.ts`, record failures, then
`git checkout -- src/engine/grading/grader.ts` and re-run. Every patch was
verified to have actually applied (a no-op replacement is reported as
PATCH-FAILED, not as a survivor). Post-revert suite confirmed green; working
tree confirmed clean with `git status --porcelain` (empty).

### 3.1 The 13 assigned mutations — 13 applied, 13 killed, 0 survived

| # | Mutation | Result | Killed by |
|---|---|---|---|
| M1 | `finalVerdict` restored to `verdictB ?? verdictA` (deviation 1 fully undone) | **KILLED** | `downgrades every pass to fail…`; `only downgrades checkpoints that had already passed…` |
| M2 | deviation 1 downgrades only the *first* passing checkpoint | **KILLED** | `downgrades every pass to fail…` |
| M3 | deviation 1 mutates verdict A in place and returns it | **KILLED** | `downgrades every pass to fail…` (its "verdict A untouched" assertions) |
| M4 | deviation 1 also downgrades `skip` in A | **KILLED** | `only downgrades checkpoints that had already passed…` |
| M5 | deviation 1 appends a synthesized extra `boot` checkpoint (the forbidden approach) | **KILLED** | 3 tests, incl. `preserves the checkpoint count under the rebootError downgrade…` — **yes, the count is asserted** |
| M6 | deviation 2 completion removed (missing ids never appended) | **KILLED** | both `completes verdict B…` tests |
| M7 | deviation 2 appends missing ids with `status: 'pass'` | **KILLED** | both `completes verdict B…` tests |
| M8 | deviation 2 appends missing ids but excludes them from regressions | **KILLED** | `completes verdict B when it omits an id that passed in A…` |
| M9 | deviation 3 reverted to `fail`-only | **KILLED** | `counts a pass-to-skip transition as a regression` |
| M10 | `anythingPassed` guard removed | **KILLED** | `skips the reboot when nothing passed…` |
| M11 | `task.rebootCheck` guard removed | **KILLED** | `skips the reboot entirely when the task does not ask for one`; `falls back to verdict A…` |
| M12 | `reboot()` rejection propagates instead of becoming `rebootError` | **KILLED** | `records a reboot failure as a result rather than throwing` |
| M13 | `grade` respects the grader's exit code | **KILLED** | `ignores the grader exit code` |

Every mutation on deviations 1, 2 and 3 died. There is no surviving mutation on
either false-pass path.

### 3.2 Ten additional reviewer-invented mutations (detail-level)

| # | Mutation | Result |
|---|---|---|
| X1 | deviation 2: synthesized checkpoint loses A's `desc` (uses `''`) | **SURVIVED** |
| X2 | deviation 2: missing ids appended in *reverse* of A's order | **SURVIVED** |
| X3 | deviation 2: completion drops verdict B's `noise` | **SURVIVED** |
| X4 | deviation 2: synthesized checkpoint gets no `detail` | KILLED |
| X5 | deviation 1: drops verdict A's `noise` | KILLED |
| X6 | non-`Error` reboot rejection replaced by a constant string | **SURVIVED** |
| X7 | regression filter drops the "passed in A" guard | KILLED |
| X8 | deviation 1: downgraded checkpoint keeps A's original `detail` (no explanation) | KILLED |
| X9 | `rebootError` no longer takes precedence when `verdictB` is also present | **SURVIVED** |
| X10 | deviation 1: drops `weight` from downgraded checkpoints | **SURVIVED** |

Five survivors, all in the assigned list's blind spots and none of them a
false-pass path. They are written up as F1–F4 and F8 below.

## 4. Direct behavioural probes

Run with a throwaway Node script using `FakeTransport` only (no VM), importing
the real module. Verbatim results:

| Probe | Input | Observed |
|---|---|---|
| P1 | `rebootError` set, A all passing | `allPassed(finalVerdict) = **false**`, count 2 (unchanged), statuses `["fail","fail"]`, both carry the persistence detail, `verdictB` undefined, A's statuses still `["pass","pass"]` |
| P2 | `rebootError` set, A all failing | `allPassed = false`, count 2, statuses `["fail","fail"]`, details `["already broken", undefined]` — the already-failing checkpoint keeps its own detail and is not relabelled. Nothing odd. |
| P3 | `rebootError` set, A empty | returns `{ checkpoints: [], noise: ["stray"] }`; `allPassed = false`; a new object, not A |
| P4 | B omits **every** id from A | B completed to `[a:fail, b:fail]` both with the not-reported detail, `allPassed(B) = false`, `regressions = ["a","b"]`, `allPassed(finalVerdict) = false` |
| P5 | B contains an id A never had, all passing | silently accepted: B ids `["a","zz-new"]`, `allPassed(B) = true`, `regressions = []` |
| P5b | same but the unknown id fails | `allPassed(B) = false`, `regressions = []` |
| P6 | B repeats `a` (pass then fail) and omits `b` | B = `[a:pass, a:fail, b:fail]`; completion keys off a `Set` so no third `a` is synthesized; `regressions = [a:fail, b:fail]`; `allPassed(B) = false`. Duplicates lean strict. |
| P6b | A repeats `a` (pass then fail), B reports `a:fail` | `regressions = []` — `statusById` last-wins makes A's status `fail`, consistent with `verdict.ts`'s documented rule |
| P7 | `skip` in A → `pass` in B, and `fail` in A → `pass` in B | `regressions = []` for both. Confirmed: neither is a regression. |
| P8 | A empty, `rebootCheck: true` | reboot called 0 times, `exec` called once, `rebooted: false`, `verdictB` undefined, `allPassed(finalVerdict) = false`. Reboot correctly skipped. |
| P9 | `reboot()` rejects with `{ code: 'ETIMEDOUT', tries: 3 }` | `rebootError = "[object Object]"` — set, so the downgrade still fires and `allPassed(finalVerdict) = false`, but the string is useless to a user (F4) |
| P9b | `reboot()` rejects with `undefined` | `rebootError = "undefined"`, `!== undefined` so the downgrade fires; `allPassed = false`. Fails safe. |
| P10 | `transport.exec` rejects on run A | escapes `grade` as `Error: ssh: connection refused` |
| P10b | `transport.exec` rejects on run B, after a successful reboot | escapes `grade`; **verdict A is lost with it** (F7) |
| P11 | `finalVerdict` called twice on the same result | deep-equal outputs, different object identities, input verdict A byte-identical to its pre-call snapshot, `weight: 2` preserved on the downgraded checkpoint. **Pure.** |
| P11b | push onto the *returned* verdict's `noise` | `verdictA.noise` becomes `["n1","MUTATED-VIA-RETURNED-VERDICT"]` — the `noise` array is shared by reference (F5) |
| P12 | both `rebootError` and `verdictB` set | `rebootError` wins, final statuses `["fail"]`, `allPassed = false` |
| P13 | completion with unparseable output in B | B's `noise` (`["not json at all"]`) survives completion |
| P14 | synthesized checkpoint identity | a fresh object, not a reference to A's checkpoint; A's `b` still `pass` |

## 5. Findings

### F1 — NON-BLOCKING. Deviation 2's "A's `desc`" requirement has no test.
`src/engine/grading/grader.ts:45`. Mutation X1 replaces `desc: cp.desc` with
`desc: ''` and the whole suite still passes. The two `completes verdict B…`
tests assert ids, status, `detail` truthiness and regressions, but never `desc`.
Concrete failure this permits: the plan's report builder maps `desc` into
`report.checkpoints` for the user, so a regression to a blank `desc` would show
the student an unnamed failed checkpoint — the exact checkpoint the deviation
exists to surface. Add one assertion:
`expect(bCheckpoint?.desc).toBe('B check')`.

### F2 — NON-BLOCKING. Deviation 2's "append in A's original order" has no test.
`src/engine/grading/grader.ts:48`. Both completion tests have exactly **one**
missing id, so relative order among synthesized checkpoints is unconstrained;
mutation X2 (`...missing.reverse()`) survives. The "append *after* B's own
checkpoints" half *is* covered (test 8's `['a','b']` would become `['b','a']` if
prepended). Add a case with two missing ids.

### F3 — NON-BLOCKING. Completion's `noise` pass-through has no test.
`src/engine/grading/grader.ts:48`. X3 (`noise: []`) survives. The equivalent
assertion exists for deviation 1 (X5 was killed by test 13's `noise` check), so
this is an asymmetry rather than a design problem. Losing `noise` would only
degrade grader debuggability, never a verdict.

### F4 — NON-BLOCKING. The non-`Error` rejection branch is untested and its
output is unhelpful. `src/engine/grading/grader.ts:97`
(`e instanceof Error ? e.message : String(e)`). X6 survives because every test
rejects with a real `Error`. Probe P9 shows the live behaviour: an object
rejection yields `rebootError = "[object Object]"`. It fails *safe* — the value
is defined, so deviation 1's downgrade still fires and nothing grades as a pass
— but the string is surfaced verbatim to the user as `report.rebootError`.
Consider `JSON.stringify`-style fallback or at least a test pinning the branch.

### F5 — NON-BLOCKING. The returned verdict shares its `noise` array with the
input. `src/engine/grading/grader.ts:70` (`noise: r.verdictA.noise`) and
`:48` (`noise: verdictB.noise`). `finalVerdict` itself never mutates its
argument — deviation 1's letter is satisfied, and I verified it (P11) — but the
result aliases A's array, so a downstream `push` writes back into verdict A
(P11b). No current consumer mutates `noise`; `reportFor` only reads. Worth a
`[...noise]` for the same reason `Checkpoint`s are already copied.

### F6 — NON-BLOCKING. An id present in B but never in A is accepted silently,
and `duplicateIds` is never gated here. `src/engine/grading/grader.ts:105`.
Probe P5: B may carry ids A never reported; they enter the final verdict and
inflate `total`, which the app compares against a `checkpointTotal` derived
statically from `grade.sh`. I traced this for a false pass and it is safe: A's
ids are always completed first, so an unknown extra id can only *add* a
checkpoint, never conceal a lost one (P5b confirms a failing extra still sinks
`allPassed`). Similarly a duplicate id in A resolves last-wins (P6b), which
`verdict.ts:84-88` documents as fine because `validate` is the mandatory gate.
Both are grader-authoring bugs belonging to `validate`/T22, not runtime paths a
student can trigger. Recording as a boundary the next task should not assume is
already checked.

### F7 — NON-BLOCKING. An `exec` rejection on run B discards verdict A.
`src/engine/grading/grader.ts:101`. Probe P10b: the reboot succeeded (so
`reboot()`, whose contract is "resolves once it is reachable again", already
proved reachability), then `exec` threw and the exception escaped `grade`,
taking the perfectly good verdict A with it. This is a throw, not a pass, so it
is not a scoring bug — but it sits oddly next to the module's own stated
philosophy that a VM misbehaving is a result rather than a crash. The brief
specified `reboot` as the only injected failure, so this is scope-correct as
written; flagging it as the natural follow-up for whichever task owns
`VmController`.

### F8 — NON-BLOCKING. `rebootError`-takes-precedence is untested (X9 survives),
and `weight` preservation is untested (X10 survives). `grader.ts:63`. `grade`
never produces a result with both `rebootError` and `verdictB` set, so X9 is
unreachable in practice; the report reasons about this explicitly and reaches
the right conclusion (unconditional precedence — fail-safe). I agree with the
choice. `weight` is not named in deviation 1's preservation list; the
implementation preserves it anyway via `{ ...cp }`, which is correct.

### F9 — NON-BLOCKING (idiom). `e instanceof Error ? e.message : String(e)` at
`grader.ts:97` duplicates the identical expression in
`src/engine/content/bank.ts:27-29`, which factors it into an `errorMessage`
helper. That helper is module-private so there was nothing to import; noting it
only as a candidate for a shared util if a third copy appears. Note also `catch (e)`
here vs `catch (error)` in `bank.ts` — trivial, and there is no formatter or
lint script in the repo to enforce either way.

### Idiom and comment style — no finding
`grader.ts` matches the house style closely. Comments explain *why*, not what,
and each earns its place: `completeVerdictB`'s docblock names the concrete
scenario (a grader hitting `set -e` mid-run) and the consequence (a regression on
that id would otherwise be invisible to a filter that only looks at B);
`finalVerdict`'s explains that unverifiable is not the same as passing and that
the count is preserved because the app shows a masked total derived from the
script; the `anythingPassed` guard is justified in one line ("no point rebooting
to test persistence of work that was never done"); the exit-code line cites spec
6.5 rule 3. This is the same register as `verdict.ts:75-79` and
`bank.ts:31-51`. Two extracted `*_DETAIL` constants, `Set`-based lookup, and a
small private helper are all proportionate — no overbuilding.

### Scope discipline — no finding
Two files, both in the brief. No new exports beyond the four the brief
specifies. Nothing from the brief was silently dropped: all 9 brief tests are
present verbatim and pass unmodified, and the one interface comment that changed
(`regressions`, to say "failed or were skipped") changed because deviation 3
required it. The report's claim that no brief test needed loosening is true — I
diffed the brief's test bodies against the committed file.

## 6. Test adequacy

The 15 tests cover: (1) `rebootCheck: false` skips the reboot with a single
`exec`; (2) nothing-passed skips the reboot; (3) reboot fires once and grades
again, two `exec` calls; (4) pass→fail is named as a regression and carries B's
detail; (5) fail→fail is not a regression; (6) a rejecting `reboot` becomes
`rebootError` rather than a throw, with A intact and B absent; (7) a non-zero
grader exit is ignored; (8) B omitting a passing id is completed to `fail` with
a detail, in `['a','b']` position, and counted as a regression; (9) B omitting an
already-failing id is completed to `fail` but *not* counted as a regression;
(10) pass→skip is a regression; (11) `finalVerdict` returns B by identity after a
reboot; (12) returns A by identity without one; (13) `rebootError` downgrades
every pass to `fail` with a detail while preserving count, ids, descs and
`noise`, leaves verdict A unmutated, and makes `allPassed` false; (14) `fail`
and `skip` in A survive the downgrade untouched; (15) the checkpoint count is
preserved under the downgrade.

That is strong coverage of every branch, and the deviation tests were clearly
written to kill exactly the failure modes that matter — test 13 alone kills four
distinct deviation-1 mutations, and test 15 exists solely to pin the count.

**The most important untested behaviour is that a checkpoint synthesized for an
id missing from verdict B carries verdict A's `desc`** (F1). It is an explicit
requirement of deviation 2, a mutation to it survives the entire suite, and its
regression is directly user-visible: `reportFor` maps `desc` into the report, so
a blank `desc` names nothing on precisely the checkpoint that vanished after the
reboot. Second-most important: no test drives the case where B omits *every* id
from A (total post-reboot grader death). It exercises the same code path as
test 8 and I verified it works (probe P4: complete, all failing, all
regressions), so it is a cheap regression guard rather than a real gap.

## 7. Residual false-pass analysis

I enumerated every path by which `allPassed(finalVerdict(r))` can be `true` for
an `r` produced by `grade`:

1. `rebootCheck: false` and A all pass — correct; the task does not claim to
   test persistence.
2. A reboot happened with no `rebootError` and the *completed* B is all pass —
   sound, because completion guarantees every id A reported was re-verified
   after the reboot (P4).
3. `rebootError` set — impossible. No branch of the downgrade emits `'pass'`, so
   any pass in A becomes `fail`; an empty A yields zero checkpoints, which
   `allPassed` rejects (P1, P2, P3).
4. `rebootCheck: true` with nothing passed — the guard returns A, which by
   definition contains no pass, so `allPassed` is false (P8).

**No. There is no remaining input to `grade` + `finalVerdict` for which a broken
or unverified machine grades as a pass.** The only ways to reach a spurious pass
are outside this module's control: hand-constructing a `GradeResult` (F8) or a
grader that emits a duplicate id, which `verdict.ts` documents as `validate`'s
job (F6). A rejecting `transport.exec` throws rather than passing (F7).

## 8. Verdict

Both **APPROVED**. This is the cleanest module in the project so far: 13/13
assigned mutations killed, zero `!` or `as` under `noUncheckedIndexedAccess`,
`finalVerdict` verified pure, and both false-pass paths demonstrably closed by
direct probe rather than by assertion. The five surviving reviewer mutations are
all missing assertions on cosmetic or debug-only fields, not defects in
behaviour; F1 is the only one worth fixing before this module gains a consumer.
The implementer's report is accurate throughout — I found no claim in it that
did not hold up, including the ones about non-mutation, the absence of casts, and
no brief test needing to be loosened.
