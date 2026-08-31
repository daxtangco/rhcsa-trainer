# Final re-review — the fix round (`4312359..6e99c3e`)

**Verdict: CHANGES REQUIRED.**

Not because anything is broken. All thirteen findings and the doc batch are addressed, the
four gates are green at HEAD, and the two S1 findings are closed by mutation-verified
guards. The verdict is CHANGES REQUIRED because **this round introduced two new false
sentences of the branch's own defect class** (a citation that proves something adjacent
to its claim), left **one loud false fail live** that the brief under-specified, and left
**half of F6 undone** in exactly the direction the review predicted. Every one is small.
None needs design work. Three are one-line edits.

Every claim below is labelled `MEASURED` or `reasoned`. All measurement was done in
`/tmp/rr` (`git archive 6e99c3e | tar -x`), with mutants reverted against `/tmp/rr-pristine`
and confirmed by `diff -q`. The repository working tree was never touched: `git status
--porcelain` is empty and `git tag --list` is empty at HEAD `6e99c3e` (`MEASURED`).

---

## 1. Gates at HEAD `6e99c3e` — all four re-run (`MEASURED`)

| gate | result |
|---|---|
| `npm run typecheck` | exit **0** |
| `npx vitest run` | **35 files / 462 tests / 0 skipped**, exit **0** |
| `npm run build:web` | exit **0** (pre-existing >500 kB chunk warning, unrelated) |
| `npm run lint:content` | exit **0**, "no problems in 5 grader(s)", **3 notes** |

Skip count checked directly, not inferred: `grep -cE 'skipped|todo'` over the vitest
output is **0**. The 3 notes are the same three (`home-from-lv`, `persist-config` in 014,
`default-target` in 017) — unchanged from the `4312359` baseline, which is the correct
outcome given F3 changed the rules around them.

462 = 455 (dispatch B's measured pre-B baseline) + 7. Dispatch A added 22 over the
review's 433. Both arithmetic chains reconcile.

`$?` was read from each command directly, never through a pipeline.

---

## 2. Per-finding table

| # | Owner | Status | What settles it |
|---|---|---|---|
| **F1** partial deflation | A | **addressed** | `MEASURED`. Full insertion-point sweep of `cat <<NOPE` through the real `019-httpd-alt-port/grade.sh` reproduced the review's totals 0–8. The new guard fires at **36 of 36** deflating positions after the first `ck`, and correctly does **not** fire at the 4 positions after the last `ck`. All five shipped graders: `missingDeclared: []`, `crossChecked: true`. Mutant M1 (`missingDeclared: []` hardcoded) kills 3 tests including an end-to-end app-level one. |
| **F2** `deriveRating` | A | **addressed** | `MEASURED`. `app.ts:353` gates on `!reportSuspect(report)`. M2 (`reportSuspect` → `false`) and M3 (drop the `countDisputed` disjunct) each kill named tests. |
| **F3** note-only id | A | **addressed** | `MEASURED`. A hybrid ruling (§3 below). M4 kills 3 tests including "catches a renamed checkpoint id, which used to be two notes and exit 0". `README.md:168-170`'s sentence changed with the rule. Shipped bank still exit 0 / 3 notes. |
| **F4** `checkCoverage` on the serving path | A | **addressed** *(but see own-finding 2)* | `MEASURED`. Shipped bank → problems 0, uncovered 58, untaught 0 → **SERVES**. All four typo classes (concept objective, task objective, task `requiresConcepts`, concept prerequisite) → **REFUSES**. F4 composes safely with F9. |
| **F5** `SHELL_OPTION_LINE` | B | **addressed but incomplete** | `MEASURED`. The `;` false fail is gone; the rule still fires on a genuine no-op and on **none** of the sixteen shipped anti-solutions. **But `set -euo pipefail && sudo lvextend …` and the `\|\|` form are still flagged** with the identical message. See own-finding 1. |
| **F6** membership lists | A | **partially addressed** | `MEASURED`. The four `readonly string[]` sites converted correctly to `Record<Union, true>` + predicates; all casts and `as string` coercions gone; `TRANSPORTS` correctly exhaustive against `TaskTransport`, documented. **`RUNGS` (`ladder.ts:33`) and `PHASES` (`expectations.ts:10`) got no exhaustiveness assertion and no comment names the asymmetry.** Short `RUNGS` → tsc 0, 1 test fails. Short `PHASES` → tsc 0, 37 tests fail. See own-finding 3. |
| **F7** four UI strings | B | **addressed** *(but see own-finding 5)* | `MEASURED`. All three states verified truthful, including the new withheld-because-untrustworthy state. Nothing persists a rating anywhere: the only `writeFile` in `src/` outside `cli/` is `vmrun.ts:139` staging a script. The client's three-way derivation **is** documented as deliberate with a pointer to `reportSuspect`. "See the warning in the sidebar" is true for all three disjuncts — Rail renders a warning for each. |
| **F8** `r1-probe.sh` | B | **addressed** | `MEASURED`. All six assignable `tcp_outcome` values reach a named arm; `bash -n` clean; each arm's direction is correct (`dropped` = confirmed, `unknown`/`""` = inconclusive and says so, `*)` = probe bug not network verdict). |
| **F9** concept objective ids | B | **addressed** | `MEASURED`. M6 kills the named test; a typo'd concept objective id now refuses to serve via F4. The new loop correctly does **not** feed `coveredObjectives`, with a comment saying why. |
| **F10** `lint.ts` comment | B | **addressed** | `MEASURED` (structure) + reasoned (wording). `checkFixtureFloors` is at `:605`, outside the try/catch at `542-604`, gated on `bank !== undefined`; the replacement sentence is true. Thin, but the catch's emitted problem message states the floors' non-execution directly, so a reader is not left inferring it. |
| **F11** oracle comment | B | **addressed** | `MEASURED`. `allPassed` at `verdict.ts:100-102` does carry `v.checkpoints.length > 0`, so zero arrivals are caught; the corrected clause naming the **second** command as the false-pass producer is accurate. |
| **F12** `03-wrong-lv.sh` header | B | **addressed** | `MEASURED`. Header no longer claims the exit-code check closes the no-op class; the static "declares exactly" rule correctly **not** added. |
| **F13** rejecting transport | B | **addressed, now actually mutation-verified** | `MEASURED`. Dispatch B verified by reading only; I mutated. M7a, M7b, M7c and M7d each kill the corresponding named test. The verdict-A-discard residual is documented accurately. |
| **doc batch** P20/P22/P25/P26/P27 | B | **addressed, directions correct** | `MEASURED`. P25's and P27's new entries are pinned against **real bash**, and the test derives `direction` from the measurement (`row.counter > row.bash ? 'over' : 'under'`), so M13 (flip a direction) and M14 (claim agreement) both go red. P26's three current-bash contexts are comment-only, so I measured them myself: array subscript read, subscripted assignment target and substring offset each give bash `["real-id"]` / counter `[]` — under, fail-open, identical to `$[ ]`. The comment asserts **four measured** contexts and correctly does **not** repeat "five". |

Everything the brief listed as out of scope is untouched (`MEASURED`): no `lexBash`,
`harness.ts` and `disclosure/content.ts` unmodified, no "declares exactly" static rule,
nothing touching P33/P34/P21, no tag.

---

## 3. Dispatch A's two undocumented rulings, derived from the diff

Dispatch A committed all its work and was killed by a host credential failure before
writing `fix-a-report.md`, so both rulings have no written reasons. Derived from code and
comments, not taken on trust.

### F3 — error vs. reconcile: **A chose a hybrid neither option stated verbatim, and it was the right call.**

The brief offered "make a note-only id an error" **or** "reconcile the note set against
emitted ids". What shipped (`MEASURED`, from `lint.ts`'s new `resolveUndeclared` plus the
`undeclaredByTask`/`probedByTask` maps, deciding *after* the anti-solution loop):

- an emitted id named by **no header anywhere in the task** → **error**;
- an emitted id named **only** by a sibling anti-solution's `# expect-fail:` → stays a **note**.

This is strictly better than either offered option. Pure-error would have made the three
shipped note-only ids errors — a **false fail on the shipped bank**, the exact shape F12
was told not to create. Pure-reconcile leaves the note tier as a place ids can live
unreconciled. The hybrid closes the class completely: every emitted id must be named by
*some* header, and all three header kinds are reconciled against emitted ids, so a
disappearing note is now an error at its declaring sibling. `README.md:168-170` changed
with the rule, as the brief required (`MEASURED` — the README now names the three live
notes and states the new error rule).

**Right call.** The deciding evidence is that the shipped bank still gives exit 0 with the
same 3 notes while M4's renamed-id mutation now gives exit 1 where it previously gave
exit 0 with two notes.

### F4 — refuse vs. log: **A chose to split on which list, and it was the right call.**

`src/server/config.ts` refuses on `problems` and logs counts for
`uncoveredObjectives`/`untaughtConcepts`. The reasoning is derivable from the code alone
and is sound: every `problems` entry is a dangling reference — not a judgement call — and
the shipped bank has zero, so refusing costs a correct bank nothing. The two gap lists are
incompleteness, and refusing on them would refuse to serve the bank this project ships.

`MEASURED`: shipped bank → problems 0, uncovered **58**, untaught 0 → **SERVES**. All four
typo classes → **REFUSES**. So the composition of F4 (refuse on a coverage failure) with
F9 (validate concept objective ids, a new source of `problems`) is safe — the server boots
on the shipped bank, and a real typo does refuse. **This composition was never reviewed by
either dispatch and it holds.**

One structural choice deserves credit: the rule lives in `config.ts`, not `index.ts`,
with the stated reason that `index.ts` has import-time side effects and cannot be
imported, "so a rule written inline there is a rule no test can reach". `config.test.ts`
then asserts *by text* that `index.ts` calls `refuseToServe` before `serve(serveOptions`.
That is the correct answer to an untestable seam, and it is the opposite of this branch's
defect class — a guard that checks the thing it claims to check.

**Right call**, with one wrong sentence inside the ruling (own-finding 2).

---

## 4. My own findings, ranked

### 1. `S2` — F5's fix closes `;` and leaves `&&` and `||` open. Direction: **false fail, loud.** `MEASURED`.

`src/cli/lint.ts:179` — `const SHELL_OPTION_LINE = /^set\s+[-+][^;]*$/`.

The excluded character class stops at `;`. An anti-solution whose body is

```bash
set -euo pipefail && sudo lvextend -L 12G /dev/rhel/home
```

is still rejected as `nothing here but comments and shell options`, exit 1 — the
identical false fail F5 was raised to remove, with the rule named in the message, telling
the fixture's author the exact opposite of the truth. Same for the `||` form. `&&` is the
*more* idiomatic joiner of the two under `set -e`, so the residual arguably covers the
likelier authoring shape.

**Dispatch B is not at fault.** The brief offered only `/^set\s+[-+][^;]*$/` "or split each
line on `;`" — both `;`-only. B picked one, said why, and tested it. The gap is in the
review and the brief, which measured one separator and generalised.

Fix: `/^set\s+[-+][^;&|]*$/`, or better, test the line's first `;`/`&&`/`||`-delimited
segment. One line plus a test. The shipped-bank test already guards the other direction.

### 2. `S3` — `config.ts:85-86` asserts a task count and an objective total that are both wrong. Direction: **misleads the next author; also overstates the shipped bank's completeness by 5x.** `MEASURED`.

Inside F4's ruling docstring — the sentence that justifies the refuse/log split:

> *"These are incompleteness, not incorrectness: **25 tasks cannot cover all 58 RHCSA objectives**, and `rhcsa coverage --strict` is red on the shipped bank for that reason."*

Measured on the shipped bank at HEAD: **5 tasks**, **10 concepts**, **68 objectives
total**, **58 uncovered**, 10 covered. So the bank has 5 tasks, not 25, and 58 is the
*uncovered* count, not the total. `grep -rnE '25 task|twenty-five'` over `src/ docs/
content/ README.md` returns exactly this one line — the number is not a plan target
quoted from somewhere, it has no other source in the repo.

This is precisely the branch's class-3 shape and this round introduced it: the citation is
adjacent to its claim, in the sentence offered as *the measurement that forces the ruling*.
The ruling itself survives — 58 uncovered > 0 on the shipped bank is true, so refusing
would refuse the shipped bank, which is the load-bearing part. Only the quantifiers are
false. A reader who trusts them believes the bank is five times more complete than it is,
which is the wrong direction to be wrong in about a Phase-2 content threshold.

Fix: "5 shipped tasks cannot cover 68 RHCSA objectives — 58 are uncovered today".

### 3. `S3` — F6's second half is undone: no exhaustiveness assertion on `RUNGS`/`PHASES`, and no comment names the asymmetry. Direction: **misleads the next author into believing a class is closed; the underlying hole is a silent false pass on disclosure content.** `MEASURED`.

`src/engine/disclosure/ladder.ts:33` — `export const RUNGS: readonly Rung[] = [1, 2, 3, 4, 5]`.
`src/engine/validate/expectations.ts:10` — `const PHASES: readonly ExpectPhase[] = ['pre', 'post', 'both']`.

Both unchanged. Neither new docstring in `task.ts` or `verdict.ts` mentions them or the
ordered-array asymmetry, though the brief called for the assertion and said in as many
words: **"Name this asymmetry in a comment."**

Measured: a short `RUNGS` gives tsc **0** with **1** test failing; a short `PHASES` gives
tsc **0** with **37** tests failing. So `PHASES` is well fenced by tests even without the
assertion, and `RUNGS` — the one whose failure mode is *disclosure content the student can
never reach* — rests on a single test.

This is the outcome the review predicted verbatim: the next author fixes four sites,
believes the class closed, and leaves two. Right now the diff reads as if the class is
closed, because the four converted sites are the ones with the new documentation.

Fix: `const _rungsExhaustive: Record<Rung, true> = { 1: true, 2: true, 3: true, 4: true, 5: true }`
alongside the ordered array (same for `PHASES`), plus one sentence saying why these two
keep the array and the other four did not. **Do not** convert them — order is load-bearing
at `app.ts:255`.

### 4. `S3` — `session.ts:542-543` says a size comparison "would fail every grader in the bank". Direction: **misleads the next author into not revisiting a design choice; understates how close the rejected alternative was.** `MEASURED`.

> *"…so `emitted` legitimately exceeds `declared` and comparing sizes **would fail every grader in the bank**."*

Measured across all five shipped graders: 014 emitted 5 / declared 3; 017 emitted 5 /
declared 4; 019, 028 and 006 all **equal**. A size comparison would fail **2 of 5**, not 5
of 5.

The mechanism and the conclusion are both right — an invariant that passes at baseline is
emitted and declared by no header, so `emitted` can exceed `declared`, and containment is
the correct shape. Only the quantifier is false, and it is false in the direction that
makes the rejected alternative look more obviously wrong than it was. Same class-3 shape,
introduced by this round.

Fix: "would fail 2 of the 5 graders in the bank today, and any future grader with a
baseline-passing invariant".

### 5. `S3` — the same docstring's "(measured: exit 1, 9 problems)" is stale at HEAD. Direction: **misleads the next author; a number that no longer reproduces reads as a citation that was never checked.** `MEASURED`.

`src/server/session.ts:544-545`. Re-ran the measurement at HEAD — copied
`/tmp/rr/content`, injected `cat <<NOPE` after the first `ck` in
`content/tasks/selinux/019-httpd-alt-port/grade.sh`, ran `lintContent`: **15 problems, 3
notes** (6 `baseline-fail names X, which the grader never emits`, 1
`unprobed-invariant names selinux-enforcing`, 8 anti-solution `expect-fail names X`).

The substance holds — lint does catch partial deflation, loudly, exit 1. The number was
taken before F3 changed lint's rules **in this same round**, so it went stale between
dispatch A's measurement and dispatch A's own commit. This one is worth fixing precisely
because someone will re-run it: a citation that doesn't reproduce is how the last five
rounds started.

Fix: "exit 1, 15 problems", or drop the count and keep "exit 1".

### 6. `S3` — `App.tsx`'s `countDisputed` disjunct is untested. Direction: **degraded disclosure, bounded — cannot produce a false pass.** `MEASURED`.

`src/web/App.tsx:230-233`'s `reportUntrustworthy` reads all three disjuncts, but M10
(dropping `report.countDisputed` from it) leaves the web suite at **26/26 green** — the
App-level test for the third state uses `report.incomplete: true` instead. `Rail.tsx`'s
own `countDisputed` signal *is* tested (`rail.test.tsx`), and the server-side gate at
`app.ts:353` is tested twice, so the rating is still correctly withheld; only the pane's
*explanatory sentence* would silently regress to the "Should not happen" fallback.

The client duplication of `reportSuspect` is documented as deliberate with a pointer, and
the fallback branch bounds drift to vagueness rather than to a false claim — which is why
this is `S3` and not higher. Fix: one more case in `app.test.tsx` using `countDisputed`.

### Not a finding, noted: the third state's copy is slightly broader than its trigger. Reasoned.

"No rating: this run's checkpoint count could not be trusted" is also shown when the
trigger was `report.incomplete` (arrivals fewer than expected), where the *count* may be
perfectly sound and the *arrivals* are what fell short. It is true in the sense that
matters — the count/arrival relationship could not be trusted — and it is not a false
claim about persistence or about what was saved. Left as an observation, not a request.

---

## 5. Residuals — confirmed honestly disclosed, no fix requested

All four `MEASURED` as disclosed, in the right place, in the right direction:

- **The verdict-A-discard on a rejecting second exec** — documented in
  `test/grading/grader.test.ts`'s second new test, which asserts the discard rather than
  merely noting it.
- **A grader with no headers has no second witness** — stated plainly in
  `checkpointCount`'s docstring, with `crossChecked: false` as the machine-readable form,
  and the false-fail direction it avoids is named explicitly.
- **`vmrun.ts:108`'s `-gp` argv exposure** — unchanged and still disclosed.
- **P27's two further unpinned shapes** — dispatch B declined to assert them because it
  could not measure them in scope, and said so. That is the correct posture and the
  opposite of this branch's defect class.

---

## 6. What CHANGES REQUIRED means here

Six items, five of them one-line edits, one of them a one-line regex plus a test:

1. `lint.ts:179` — widen the exclusion to `&` and `|`, plus a test (`S2`, the only loud one).
2. `config.ts:85-86` — 5 tasks, 68 objectives, 58 uncovered.
3. `ladder.ts:33` / `expectations.ts:10` — add the two exhaustiveness assertions and name the asymmetry.
4. `session.ts:543` — "2 of the 5 graders", not "every grader".
5. `session.ts:544` — 15 problems, not 9.
6. `app.test.tsx` — one case driving `countDisputed`.

Nothing here reopens a design question, and nothing here is in dispatch A's or B's blind
spot for a reason either of them could have known: items 1 and 3 trace to the brief,
items 2, 4 and 5 are stale-or-invented numbers inside otherwise-correct reasoning, and
item 6 is a test that was written against the wrong one of three equivalent-looking
disjuncts.

The two S1 findings — the ones this whole branch has been about — are closed, and closed
by guards I broke and watched fail.
