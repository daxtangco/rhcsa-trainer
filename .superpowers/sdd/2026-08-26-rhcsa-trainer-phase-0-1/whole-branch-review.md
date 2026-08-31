# Whole-branch review — Phase 0 + Phase 1, RHCSA Lab Trainer

**Reviewed at** HEAD `4312359` (`git rev-parse HEAD` = `431235960e6e2c37313da8a2d3c05ff6c3036203`).
**Verdict: CHANGES REQUIRED.**

`git status --porcelain` was empty before this review and is empty after. `git tag -l` is empty
(correct — the `phase-1` tag is the user's to create). No file in the repository was created or
modified except this one. All mutation work was done in `/tmp/wbr`, created with
`git archive 4312359 | tar -x -C /tmp/wbr` and `node_modules` symlinked back; every mutant was
reverted from a saved pristine copy and the revert confirmed with `diff -q`.

Every conclusion below is labelled **MEASURED** (I ran a command and read its output) or
**REASONED** (I read code and inferred). Where I cite a mutant I state what it proves and nothing
more, because "a citation that proves something adjacent to its claim" is the third defect class
this branch has been worst at, and I committed one instance of it myself during this pass (recorded
in the appendix).

---

## 1. Gates

All four run at HEAD in the real tree (read-only commands only).

| gate | result | label |
|---|---|---|
| `npm run typecheck` | exit **0** | MEASURED |
| `npx vitest run` | **35 files / 433 tests / 0 skipped**, all passing, exit 0 | MEASURED |
| `npm run build:web` | exit **0** | MEASURED |
| `npm run lint:content` | exit **0**, "no problems in 5 grader(s)", **3 notes** | MEASURED |
| `npm run coverage` | 5 tasks / 10 concepts / 68 objectives, exit **0** | MEASURED |

The test and skip counts match the brief exactly: 433 tests, 35 files, **0 skipped**. No skipped
test is hiding behind the pass.

### Erasable-syntax and cast sweep

`enum`, `namespace`, decorators, parameter properties, non-null `!`, `as unknown as`: **zero
occurrences in `src/`** (MEASURED). No `require(` in `src/` — the one `grep` hit is `#require`, a
private method in `src/server/session.ts`, not CommonJS (MEASURED, inspected).

**Cast count: 16 cast expressions across 14 lines in 7 files.** How I counted, since the brief
requires the method and not just the number:

1. `grep -rnE '\bas\b[[:space:]]+[A-Za-z_$][A-Za-z0-9_$.]*' src --include='*.ts' --include='*.tsx'`.
2. That regex is wrong in one direction I caught only by inspection: it misses a cast to an inline
   object type. Widened with a second pass, `\bas\b[[:space:]]*[({[]`, which found
   `src/engine/vm/vmrun.ts:49` (`const err = e as {`).
3. **Printed and read every matched line individually.** This is the step whose omission produced
   the brief's three wrong counts, so it is the step I did not skip. It also caught one of my own
   errors: I first tallied 11 cast tokens in `task.ts` and the correct number is 10.

The token count, 16, agrees with the brief. **The file count does not: 7, not 6.** The brief's
per-class breakdown at target 6 names sites in `task.ts`, `concept.ts`, `objectives.ts`,
`verdict.ts`, `config.ts`, `api.ts` and `vmrun.ts` — seven files — while its prose says six. This is
a fourth instance of the counting error the target is a worked example of; it changes no conclusion,
and I record it only because the brief asked to be told what I got.

I agree with the brief that **there is no standalone cast finding**, and I re-derived that rather
than accepting it: every one of the 16 sites falls into the classes the brief describes, and the
class distribution it gives is accurate.

---

## 2. Target 1 — P24 + P29

**Disposition: the joint fix is NOT sufficient. A partial deflation of the expected count is
reachable, and the deflated cases are *less* guarded than the collapsed case the branch has been
tracking.**

### P24 is live at HEAD (MEASURED)

Every line the brief re-checked at `45344bd` is present and unchanged at `4312359`:

- `src/server/session.ts:569` — `const incomplete = status.size < expectedTotal`
- `src/server/session.ts:591` — `allPassed: allPassed(v) && !incomplete,`
- `src/engine/grading/verdict.ts:81` — `v.checkpoints.length > 0 && …` — still the only zero-guard
- `src/server/app.ts:316` — `rating = deriveRating({`
- `src/server/session.ts:611` — `#byId = new Map<string, SessionRecord>()`

So the brief's one claim whose staleness would move the whole agenda is not stale.

### The finding: partial deflation is reachable (MEASURED)

P22 records that a partial deflation is unreachable "only because every heredoc fail-open zeroes the
count rather than deflating it," and the brief says to test that claim. **The claim is false.**

Method: I swept a single injected `cat <<NOPE` line across **every** insertion point in
`content/tasks/system/019-httpd-alt-port/grade.sh` and recorded `countCheckpoints`' output at each
position. The result is not a constant 0. It takes the values **0, 1, 2, 3, 4, 5, 6, 7 and 8**
depending on where the bad line lands. The zeroing behaviour holds only when the swallowing line
precedes the first `ck_*` call; anywhere later, the lexer swallows the *remainder* of the file and
the count lands at however many distinct ids it had already seen.

Then I drove a deflated count through the real `reportFor` path. At `expectedTotal = 3` with three
passing arrivals:

- `status.size (3) < expectedTotal (3)` is false → **`incomplete` is false**
- `status.size (3) > expectedTotal (3)` is false → **mandate 10.5's `console.warn` does not fire**
- `allPassed(v) && !incomplete` → **`allPassed: true`**
- `Rail.tsx:93`'s `report.total > report.expectedTotal` is false → **`countSuspect` is false**
- `verdictFor` (`Rail.tsx:64`) therefore returns **`'pass'`**

A grader that died three checkpoints into eight reports a **clean pass**, on the screen and in the
rating, with no warning anywhere. **The collapse-to-0 case that P24 documents is the only member of
this class that trips any existing guard** — it trips two of them (`total > 0 == expectedTotal` makes
`countSuspect` true and fires the warn). Every partial deflation trips neither.

**Therefore: refusing to create a session at expected count 0 is a partial fix wearing a complete
one's clothes.** P22's reasoning is wrong a third time, and in the same direction as the first two —
it under-estimates the reach of the fail-open. The correct guard is the one P22 itself derived and
then argued was unreachable: `arrivals >= expectedTotal AND arrivals >= 1 AND every arrival passed
AND arrivals < real total`. Since `real total` is not available at runtime, the only sound runtime
posture is to stop trusting `expectedTotal` as a lone witness — see the recommendation below.

### What bounds it, honestly (MEASURED)

`rhcsa lint` **does** catch partial deflation, and it catches it for a good reason: header
reconciliation is an independent source of truth, so a swallowed `ck_pass` shows up as a declared id
that is never emitted. On the deflated `019` grader: **exit 1, 9 problems.**

I initially reported this as exit 0. That was wrong and the cause is worth recording: I read `$?`
after a pipeline under zsh, where it is `tail`'s status, not `node`'s. Re-measured as
`node … >/tmp/lint-mut.txt 2>&1; echo $?`. This is exactly the "citation proves something adjacent
to its claim" class, committed by me, mid-review, on the finding I care most about.

The residual gap is **note-only ids**. `README.md:168-170` documents that "an id named by no header
at all is legal and is reported as a note rather than an error." Measured consequence:

1. Add a checkpoint named by no `# baseline-fail:`, no `# unprobed-invariant:` and no anti-solution
   `# expect-fail:` → `lint:content` **exit 0, 0 problems, 1 note**.
2. Now swallow that same checkpoint with a heredoc fail-open → `lint:content` **exit 0, 0 problems,
   and the note simply vanishes.** Nothing reports that anything changed.

All three note-only ids in the bank today (`home-from-lv`, `persist-config`, `default-target`) happen
to be named by an anti-solution's `# expect-fail:`, so **the bank as shipped is guarded** (MEASURED).
The hole is latent and it is one content addition away — and it is the kind of content addition
Phase 2 is entirely made of.

### P29 (MEASURED)

The brief's trace is correct and I confirmed the single unguarded line. `src/server/app.ts:316-323`
passes `passed: report.allPassed` into `deriveRating` with no consultation of any suspicion signal.
`report.regressionCount > 0` and `report.passed > 0` come off the same suspect report, so a withhold
applied at the `passed` argument alone still lets a truncated run write a rating — the brief
anticipates this and it is right to.

I also confirm the brief's own correction to itself: nothing persists a rating. No scheduler in
`src/`, no disk writes from `src/server/`, sessions are an in-memory `Map`. P29's blast radius is one
line of displayed text in one finished attempt. It is still a wrong truth-claim and still belongs in
the joint fix; it is not unrecoverable, and nobody should "fix" it by building persistence.

### Sufficiency, stated plainly

The proposed shape — refuse at count 0, promote the warn into a report field, have the rating path
read that field — is **necessary and insufficient**. It closes the collapse. It does not touch the
deflation, because deflation produces a report in which *every* existing suspicion signal reads
clean. The minimum sufficient shape adds a second, independent witness to the expected count. The
cheapest one already exists in the repo and is not on the serving path: the grader's own declared
header set. A count derived from, or cross-checked against, `# baseline-fail:` +
`# unprobed-invariant:` disagrees with a deflated lexer count, and that disagreement is exactly what
`rhcsa lint` already computes.

**Can the refusal trap the student?** A refusal at session *creation* cannot, since no work exists
yet. A refusal at *grade* time must not disable Finish — the session must remain closable with the
verdict withheld, which is what `Rail.tsx` already does for `countSuspect`. Withhold the verdict and
the rating; never withhold the exit.

---

## 3. Target 2 — the five cross-cutting invariants

**(a) Objective ids as permanent scheduling keys — PARTIALLY GUARDED, one real hole.** MEASURED: a
typo'd *concept* objective id passes everything — `lint:content` exit 0, `coverage` exit 0, suite
433/433. A typo'd *task* objective id is caught by `npm run coverage` (exit 1) but **not** by
`lint:content` (exit 0) and not by the suite. The reason is structural: `checkCoverage`
(`src/engine/content/bank.ts:174-197`) is called from exactly one place, `src/cli/index.ts:87`.
`src/server/index.ts:24` calls only `loadBank`. **The two content gates are disjoint; neither is a
superset of the other; and only `lint:content` is the one README and `exit-criterion.md` foreground
as the no-hypervisor gate.** That asymmetry is the finding, not the typo.

P5's severity argument, however, rests on a false mechanism. `concept.objectives` has **no consumer
anywhere in `src/`** (MEASURED). Card reachability runs through `task.requiresConcepts`. So
`test/content/concept.test.ts:42`'s name — "a card with no objectives is unreachable from the
disclosure ladder" — is measurably false, and it is the sentence both the parked file and the brief
use to upgrade P5's severity. P5 is real and unguarded; its stated reason is not its reason.

**(b) The `@pre`/`@post`/`@both` phase chain — GUARDED end to end.** MEASURED with seven mutants:
three header mutations each kill both `content-headers-golden.test.ts` and
`lint.test.ts > prints the @phase of every declared checkpoint`; four `expectedStatus` mutations
(`src/engine/validate/expectations.ts:95-105`) are all killed. The phase never reaches the UI, so
there is no wrong-claim surface. No finding.

**(c) The disclosure ladder / exam-mode gating — GUARDED, and its documented weak point is
deliberate and honoured.** MEASURED: `rungContent` has exactly three call sites, all inside
`/hint`; `contextFor` (`app.ts:69`, the function that holds `solution`) has exactly one call site,
`app.ts:253`. `/api/concepts/:id` (`app.ts:108`) returns `concept.body` ungated, which is documented
as deliberate in two places, including `ladder.ts`'s `MAX_RUNG` docstring stating the obligation is
"the UI must not offer card links in exam mode — not an API gate." That obligation **is** honoured
at `Rail.tsx:114` (`session.mode !== 'exam' && …`) and the guard is mutation-killed. No finding.

**(d) Transport failure surfacing — GUARDED at both ends, with a real residual.** MEASURED, and this
contradicts P31's predicted direction. A rejecting `exec` throws out of `grade()` (which wraps only
`reboot()`, not either `exec`), `/grade` catches at `app.ts:276-281` and returns HTTP 500 with the
transport's message, and `App.tsx`'s `doGrade` catch **deliberately clears the stale report**, with a
comment naming the false-pass screen it prevents. The outcome is not "a report that looks like a
failed lab." Two residuals stand: verdict A is **discarded entirely** when the second `exec` rejects
(the "it works now" answer is thrown away because the "survives a reboot" answer failed to arrive),
and **zero tests exercise a rejecting handler** — 43 `FakeTransport` references, none rejecting
(MEASURED).

**(e) "Recorded"/"scheduler" UI copy — CONFIRMED, and there is a fourth string the brief does not
name.** Nothing persists a rating, so every string claiming one was "recorded" is a wrong
truth-claim to the student. The strings:

1. `Rail.tsx:240` — "This attempt is finished and its rating is recorded."
2. `App.tsx:279` — "Scheduler rating:"
3. `App.tsx:291` — "was recorded against"
4. **`App.tsx:284` — "Guided mode records no scheduler rating"** — not in the brief's list. It is
   wrong by implication rather than by assertion: it tells the student that *other* modes do record.
   A copy fix that repairs the three and leaves this one still leaves the false belief in place.

**Ruling on `App.tsx:291`: in.** "Was recorded against" is the most specific of the four — it names a
thing the rating was recorded *against*, which invites the student to believe a per-objective history
exists. It is the string most likely to be believed and the cheapest to fix. Ruling it out to save
one line in one file would be the wrong trade.

**Fix option: (i), change the copy — not (ii), build persistence.** The strings should describe what
actually happens: a rating computed and shown for this attempt, in this session, not stored. This is
the cheapest correct-a-wrong-claim on the branch and the only one in the category that the *user*
reads rather than the next author. It also has a second-order benefit: while the copy is honest about
non-persistence, nobody reads target 1's rating defect as a corrupted-schedule problem and
over-scopes the fix.

---

## 4. Target 3 — first contact on a machine with no VM

**Disposition: the sequence holds. One parked item should be taken; the NOT RUN marking is honoured
in substance but the brief quotes it wrong.**

I read `README.md`, `docs/exit-criterion.md`, `scripts/provision.sh`'s documented contract and the
build checklist in order, as a person holding only this repo.

- **The dash trap is documented correctly and in the right place** (MEASURED, reproduced myself).
  Under `/bin/sh` = dash, an unquoted `RHCSA_VMX=/mnt/c/Program Files/VM/lab.vmx` prints one
  `not found`, leaves the variable **empty**, continues, and **exits 0**; `node
  --env-file-if-exists` reads the same line correctly. `README.md:86-100` names **which loader
  breaks** (`npm run test:vm`, sourcing under dash) and names both loaders explicitly at :102-105.
  It also notes that `provision.sh:34` says this too but reads like advice about one key. Honoured.
- **README step 4's numbers are exact** (MEASURED): five tasks, ten concepts, 68 objectives, exit 0.
- **Step 2 needs no `.env.local`** (MEASURED, by reading `scripts/r1-probe.sh`): it takes the vmx as
  a positional argument, so the documented order does not assume state it has not created.
- **Exam limits cannot mislead** (MEASURED): `src/engine/exam/limits.ts` has **zero consumers**. The
  150/300/210 numbers are marked UNCONFIRMED and are shown to no student, because nothing reads them.
  The marking is honest and the exposure is nil. No finding.
- **`docs/exit-criterion.md` honours the standing ruling in substance**: a blank form, an explicit
  "not met", and the line "if you find it already filled in, something wrote answers it did not
  earn." The blocker is not softened into a caveat.
- **P8/P30 — take it.** MEASURED: `tcp_outcome` in `scripts/r1-probe.sh` can hold
  `open|unreachable|dropped|refused|unknown|""`, the `case` at `:236` has arms for only three of
  them, and `dropped`, `unknown` and the empty string all fall through to `*)` at `:257`, which
  prints **"R1 CONFIRMED AS A PROBLEM"**. R1 is still unverified, so this is plausibly the first
  output the user ever sees from this project, and for two of those three classifications it is a
  false fail against their own network. Cheap, loud, and on the first-contact path. **In dispatch.**

On the labelling question the brief invites: **"complete" is the wrong word** for a task whose only
real proof has never run, and the brief's own suggested vocabulary — `authored, unexecuted` — is the
honest label. I say it in one sentence as instructed and do not press it; it is a ledger-vocabulary
question, not a fix, and the artifacts themselves do not overclaim.

---

## 5. Target 4 — the two named defect classes, swept

**(a) A tool reporting success when it did not look at the thing.** Swept every gate, guard,
validator, golden fixture and drift detector on the branch. Three live instances:

1. **`checkCoverage` is absent from the serving path** — the gate exists and the server never calls
   it (invariant (a) above). It does not report false agreement; it reports nothing, which is the
   same failure with the volume turned down.
2. **Note-only ids vanish silently** — `lint:content` compares declared ids against emitted ids, and
   an id in neither set is compared against nothing. Its disappearance changes the output from "1
   note" to "0 notes" and the exit code not at all (target 1 above).
3. **P33** — deleting an entire task directory leaves `lint` at **exit 0** (MEASURED). The filter
   that could match nothing and exit 0 is the same shape as the two defects Task 25 already fixed;
   this is the third. It needs a manifest or a floor, which is a decision, not a one-liner.

**(b) A disclosure whose wording is wrong.** Four live instances, all confirmed by reading what the
sentence claims rather than that it exists:

1. **P38** (MEASURED, reproduced at HEAD): `src/cli/lint.ts:519-520` asserts "The rules ran
   unconditionally above and nothing here can suppress them" on the one path where they did not —
   `checkFixtureFloors` is at `:575`, outside the `catch`, gated on `bank !== undefined`. Third
   consecutive round to leave an inaccurate sentence in a comment it rewrote.
2. **P39** (MEASURED, reproduced at HEAD with a live false-fail message): `SHELL_OPTION_LINE =
   /^set\s+[-+]/` at `:211` is start-anchored only, so `changesNothing` at `:225` discards the whole
   line. An anti-solution whose body is `set -euo pipefail; sudo lvextend -L 12G /dev/rhel/home` is
   rejected as "nothing here but comments and shell options" — **with the rule named in the message,
   telling its author the exact opposite of the truth.** The constant's own comment at `:209` ("the
   whole line is what matches") is what let the defect through authoring and must change in the same
   edit.
3. **P28** — the false comment at `test/server/checkpoint-oracle.ts:530-532`. Replacement text is
   already written out in the parked file.
4. **`test/content/concept.test.ts:42`'s test name** — "a card with no objectives is unreachable
   from the disclosure ladder." Measurably false (`concept.objectives` has no consumer). A test name
   is a disclosure: it is the sentence the next author trusts about what the test protects.

**(c) A citation that proves something adjacent to its claim.** I committed one (the zsh pipeline
`$?`, recorded above and in the appendix) and caught two more of my own before they reached a
conclusion. I also found one in the brief and one in the parked file — see §8.

---

## 6. Target 5 — what the fix dispatch must carry

**Disposition: the list is nearly complete. One addition, one item I rule out of this dispatch, and
one ruling that reduces scope.**

- **Invariant (e)'s copy fix — in, with the fourth string added.** Four strings, two files.
- **P39 — in, first.** The only parked item whose direction is the loud kind, and the message names
  its own rule while being wrong.
- **P38 — in.** One-line comment correction in a file the dispatch already opens.
- **P28, P20, P22, P25, P26, P27 — in.** Doc-only. I verified the replacement sentences state their
  directions correctly, since these are precisely class (b). P22's file list correction stands:
  `src/server/session.ts:286-292` and the `28ad7f0` commit message are accurate and must not be
  "fixed." **But P22's own substantive claim about zeroing is wrong** and its replacement text must
  say so — see §2. That is an addition to P22's edit, not just a mechanism swap.
- **P36 — not carried.** Superseded and closed in round 4, as instructed. I checked round 4's guard
  and confirm it is a **named-path** check (`isFile(join(root, 'objectives.yaml'))`), not a walk, so
  the distinction the argument turns on is honoured.
- **P35 shape B — Phase 2, not this dispatch.** It is a `harness.ts` change in a gate that has never
  executed. Landing an unrunnable change to an unrun gate in the same dispatch as target 1's grading
  fix means neither can be verified against the other. It becomes load-bearing the first day
  `validate` runs, which is also the first day anyone trusts it — so it must be *scheduled*, not
  dropped, and the exit criterion for the first real `validate` run is the right place to bind it.
- **`03-wrong-lv.sh`'s header — correct the header text now, do not add the static rule.** The
  header overstates its own protection and that is class (b) sitting in committed content, so the
  sentence should be fixed. The related static signal ("this anti-solution declares exactly the
  grade script's `# baseline-fail:` set") fires on this same deliberate, defended fixture, so **as
  an error it is a false fail on the shipped bank.** `rhcsa lint` has no warning tier and inventing
  one is a design decision. Fix the sentence; leave the rule to Phase 2 paired with shape B.
- **P18 (`lexBash` extraction) — out of this dispatch. Stated plainly, as asked.** One dispatch
  cannot carry it safely alongside target 1's grading fix. The extraction touches the exact function
  whose defect history is eight defects across six review rounds; a shared lexer landing in the same
  diff as a change to how `expectedTotal` is trusted means that if the count moves, nobody can say
  which change moved it. **What it costs to defer:** three hand-rolled lexers in a project whose
  core gate is a lexer, with a known divergent twin at `src/engine/disclosure/content.ts:91`, and
  P19's command-prefix blindness left open because P18 is its only real fix. That cost is real and I
  am recommending paying it for one dispatch, not indefinitely. It should be the first item of the
  next one, alone.
- **P21 (property test over the oracle) — endorsed, and the condition is not optional.** If the
  dispatch adds it, the generator must itself be validated, or the test proves the oracle agrees
  with a generator nobody checked. That is the same defect class as the target it is testing.
- **P34 — record, do not fix.** `coverage --strict` is already red with 58 uncovered objectives.
  That is a threshold question about Phase 2's content plan, not a defect.

---

## 7. Target 6 — the six membership lists

**Disposition: I agree the four `readonly string[]` sites should adopt the `Record<Union, true>`
idiom the project already documents twice. It belongs in this dispatch. But the brief's ranking
within the target is inverted, and one cell of its table is wrong for the site it calls sharpest.**

### The convention

`src/engine/vm/config.ts:20-22` (`KINDS: Record<TransportKind, true>`) and
`src/server/app.ts:29-31` (`MODES: Record<SessionMode, true>`, explicitly citing the first as
precedent) are the in-repo template, and `app.ts:38-40`'s `isSessionMode` is the payoff: a real type
predicate narrows, so the four casts and the six `as string` coercions all disappear together rather
than merely becoming safe. Agreed, and it is the cheapest finding on the branch to close because the
pattern, its justifying comment and a working predicate are all already committed.

### What I measured, per direction

| mutation | tsc | suite | label |
|---|---|---|---|
| Add a 4th `CheckpointStatus`, `STATUSES` stays stale | **0** | **433/433** | MEASURED |
| Drop rung 4 from `RUNGS` (`readonly Rung[]`) | **0** | 1 failed / 432 | MEASURED |
| Typo inside `PHASES` (`readonly ExpectPhase[]`) | **2**, at the list, with a did-you-mean | — | MEASURED |
| Typo inside `SCOPES` (`readonly string[]`) | **0** | 39 failed / 394 | MEASURED |
| Rename a `TaskScope` member, `SCOPES` stale | **2** — 1 error, **0 in `src/`**, 1 in `test/` | — | MEASURED |
| Same, after fixing the one test literal tsc flagged | **0**, 0 errors, `SCOPES` still holds the dead string | — | MEASURED |
| Remove `'skip'` from `CheckpointStatus`, `STATUSES` stale | **2** — errors **in `src/`** at `grader.ts:113` and `harness.ts:140` | — | MEASURED |

### The brief's table cell is wrong for `verdict.ts`

The brief's row 3 says a *removed or renamed* member is "**silent**, and the cast it guards becomes a
lie," and it calls `verdict.ts` "the sharp one and worth a finding on its own, **in both
directions**."

Measured, the removal direction on `verdict.ts` is **not silent, and it is caught twice**. Removing
`'skip'` from `CheckpointStatus` produces `TS2367` no-overlap errors at two `src/` sites:
`src/engine/grading/grader.ts:113` (the regression filter's `cp.status === 'skip'` arm) and
`src/engine/validate/harness.ts:140` (the guard whose comment says a skip "must never silently
satisfy a declared failure"). A developer who follows the compiler and deletes both as dead then
trips two dedicated, precisely-named tests (MEASURED, one mutant each):

- `grade > counts a pass-to-skip transition as a regression`
- `validateTask > does not let a skip silently satisfy a declared failure`

So the sharp site is the best-defended one. Conversely, `task.ts` — which the brief calls "milder but
not cosmetic" — is the site where the removal direction **is** genuinely silent: the single error tsc
raises is in a test fixture, not in `src/`, and once the developer fixes that literal (which the
compiler tells them to), tsc goes green with `SCOPES` still holding a string no longer in the union.
The cast at `task.ts:96` then asserts a type the value does not inhabit, with no compile error and no
runtime error at the boundary. **The ranking is inverted: the brief's mild row is the silent one and
its sharp row is double-guarded.**

The direction that *is* silent on `verdict.ts` is the **addition** direction, and it is the one that
matters — see below.

### Does `verdict.ts` compose with P24 into a false pass? Yes — but through deflation, not collapse

MEASURED. Adding a fourth `CheckpointStatus` (the obvious future `'error'`) with `STATUSES` stale
leaves tsc at 0 and the suite at 433/433. `asCheckpoint` returns `undefined` at `verdict.ts:27`,
`parseVerdict` files the line under `noise`, and **a checkpoint silently disappears from the
verdict.** Composition, measured through `reportFor`:

- **Dropped checkpoint alone**: arrivals 7 < expectedTotal 8 → `incomplete` → verdict withheld. A
  false *fail*, and the guard holds.
- **Dropped checkpoint + collapse to 0**: `total > expectedTotal` → `countSuspect` fires → withheld.
- **Dropped checkpoint + partial deflation** (arrivals == deflated expectedTotal): every guard reads
  clean → **silent false pass.**

So the composition is real, and its route is the same deflation hole as target 1's. The two findings
are one finding seen from the type system and from the lexer. That is worth saying to the fix
dispatch explicitly, because fixing either alone leaves the composed path open.

### Do the two `readonly Union[]` lists need a different fix? Yes — a smaller one

MEASURED, and the asymmetry is clean. The `readonly Union[]` lists already get **element
correctness** from the compiler: a typo inside `PHASES` is a `TS2820` at the list itself, with a
did-you-mean. What they lack is **completeness**: a short `RUNGS` compiles. The four
`readonly string[]` lists have **neither** property — a typo inside `SCOPES` compiles (and then
breaks 39 tests at runtime, a loud false fail on the bank), and a stale member compiles.

So the middle row needs completeness only, and **`Record<Union, true>` is the wrong mechanical fix
for it**: both are ordered arrays and `RUNGS`' order is load-bearing at `app.ts:255`, where it builds
the full rung list served to the client. Converting it to `Object.keys` of a record would make
disclosure order depend on key insertion order. The shape there is an exhaustiveness *assertion*
alongside the ordered array, not a derivation from a record. **This must be named in the finding**,
or the next author fixes four sites, believes the class closed, and leaves two that still fail
silently in the direction where a short `RUNGS` means **disclosure content the student can never
reach**.

And the documented trap holds: `task.ts:12`'s `TRANSPORTS: readonly string[] = ['ssh', 'vmrun']`
correctly mirrors `TaskTransport`, **not** `TransportKind` (which also has `'fake'`). Verified at
`src/engine/content/task.ts:8-14`. Do not make it exhaustive against `TransportKind` — a bank that
could declare `transport: fake` and load would put a task that never touches a VM into a graded
session, which is a false pass by construction.

---

## 8. Ranked findings

Severity: **S1** = can make a wrong truth-claim to the student today. **S2** = can make one after a
plausible near-term change, or misleads the next author on a load-bearing mechanism. **S3** = real
but bounded.

| # | S | finding | direction | load-bearing | in dispatch |
|---|---|---|---|---|---|
| 1 | S1 | **Partial deflation of `expectedTotal` is reachable and trips no guard.** A heredoc fail-open after the first `ck_*` deflates 8→3 rather than to 0; `incomplete`, the 10.5 `console.warn` and `countSuspect` all read clean. | **false pass** | **yes** | **yes** |
| 2 | S1 | **`deriveRating` consults no suspicion signal** (`app.ts:316-323`). The screen withholds and the rating asserts, off one report. Both directions: truncated → false fail, deflated → false pass. | both | **yes** | **yes** |
| 3 | S2 | **A note-only checkpoint id can be swallowed with no signal at all** — `lint:content` goes from 1 note to 0 notes, exit 0 both times. The bank is guarded today only by coincidence (all three note-only ids happen to be named by an anti-solution). | **false pass** (silent) | **yes** | **yes** — make note-only ids an error or reconcile against emitted ids |
| 4 | S2 | **`checkCoverage` never runs on the serving path.** `bank.ts:174` is called only from `cli/index.ts:87`; `server/index.ts:24` calls only `loadBank`. The two content gates are disjoint and the one README foregrounds is the weaker. | false green on content | **yes** | **yes** — one call site |
| 5 | S2 | **P39: `SHELL_OPTION_LINE` is start-anchored, so a valid anti-solution is rejected as "nothing but comments and shell options"**, naming the rule while telling its author the opposite of the truth. The constant's comment must change in the same edit. | **false fail**, loud | yes | **yes** |
| 6 | S2 | **Adding a 4th `CheckpointStatus` silently drops checkpoints** (tsc 0, 433/433) and **composes with finding 1 into a silent false pass.** Four `readonly string[]` lists should adopt `Record<Union, true>`; the two `readonly Union[]` lists need an exhaustiveness assertion instead, because `RUNGS`' order is load-bearing. | false pass (composed) | **yes** | **yes** |
| 7 | S2 | **Invariant (e): four UI strings claim a rating is "recorded" by a "scheduler" when nothing persists** — `Rail.tsx:240`, `App.tsx:279`, `:291`, and the unlisted `:284`. The only wrong claim in this whole review that the **user** reads. | false claim to the student | yes | **yes** — copy only |
| 8 | S2 | **P8/P30: `r1-probe.sh`'s `*)` arm prints "R1 CONFIRMED AS A PROBLEM" for `dropped`, `unknown` and `""`** — plausibly the first output the user ever sees, and a false fail against their own network for two of the three. | **false fail** | yes | **yes** |
| 9 | S2 | **P5: a typo'd concept objective id passes every gate** (lint 0, coverage 0, suite 433/433). Confirmed unguarded — but P5's stated severity mechanism is false, and so is the test name that carries it (`concept.test.ts:42`). | silent content rot | yes | **yes** — validate concept objective ids |
| 10 | S3 | **P38: `lint.ts:519-520`'s comment asserts the rules ran unconditionally on the one path where they did not** (floors at `:575`, outside the catch, gated on `bank !== undefined`). Third round to leave a false sentence in a comment it rewrote. | misleads next author | no | **yes** |
| 11 | S3 | **P28 + `concept.test.ts:42`: two committed sentences that state a mechanism wrongly.** A test name is a disclosure. | misleads next author | no | **yes** |
| 12 | S3 | **`03-wrong-lv.sh`'s header overstates its own protection.** Fix the sentence; do **not** add the paired static rule, which fires on this same shipped fixture and would be a false fail on the bank. | misleads next author | no | **partly** — text yes, rule no |
| 13 | S3 | **A rejecting `exec` discards verdict A entirely**, and zero tests exercise a rejecting handler (43 `FakeTransport` refs, 0 rejecting). P31's predicted direction does **not** materialize — the 500 path and `App.tsx`'s clearing catch both hold. | lost information | no | test yes, redesign no |
| 14 | S3 | **P33: deleting a whole task directory leaves `lint` at exit 0.** Third instance of "the filter matched nothing and passed." Needs a manifest or floor — a decision, not a one-liner. | false green | no | no — decide first |
| 15 | S3 | **Three hand-rolled bash lexers with a known divergent twin** (`session.ts` vs `disclosure/content.ts:91`). P18 is the right fix and the wrong dispatch. | latent drift | no | **no** — first item of the next one |

---

## 9. The claim in this brief most likely to be wrong

> "`grep -rn countSuspect src/ test/` returns **five hits, all five in `Rail.tsx`, and none in
> `test/`.** The only guard currently standing between P24 and a student is an **untested**
> client-side derivation."

**The grep is accurate. The conclusion drawn from it is false** (MEASURED). Two independent mutants:

- `Rail.tsx:93` → `const countSuspect = false`
- `Rail.tsx:64` → drop `|| countSuspect` from `verdictFor`

Each one kills **the same two tests**:

- `Rail > warns when more checkpoints arrived than the script declares, and does not fail the run`
- `Rail > warns on a declared count of zero even though the report says everything passed`

The second is literally P24's measured shape. The guard is behaviourally covered from two directions.
The brief inferred absence of coverage from absence of an *identifier*, and a test that drives a
component through props and asserts on rendered output never mentions an internal variable's name.
This is the brief's own third defect class — a citation proving something adjacent to its claim —
committed in the sentence that dispatches remediation work.

**Why this one and not the others.** It is asserted as measured, it is about the single most important
guard on the branch, and it is the one that *misdirects the fix dispatch*: "that guard needs a test
whether or not it moves" would spend budget writing a test that already exists, while the things that
genuinely have no test — the deflation class of finding 1, and `deriveRating`'s indifference to any
suspicion signal — get none.

**What I would measure to settle it**, stated so it can be re-run against me: apply either mutant
above in a `/tmp` copy and run `npx vitest run test/web/rail.test.tsx`. If the suite stays at 20
passed, I am wrong and the brief is right. I got `2 failed | 18 passed` for both.

Two runners-up, both measured, both smaller:

- **Target 6's table cell** — "removed or renamed member → silent" is wrong for `verdict.ts`, the
  site the brief calls sharpest (tsc catches it at two `src/` sites; two named tests catch the
  behavioural consequence), and right for `task.ts`, which the brief calls milder. Settle it by
  removing `'skip'` from `CheckpointStatus` and running `tsc --noEmit`.
- **`docs/exit-criterion.md` is marked "NOT YET RUN", not "NOT RUN"** — zero occurrences of the
  quoted string (MEASURED). The substance is honoured well and the citation at `:226-229` is
  accurate, but the brief describes this marking as "confirmed byte-verbatim" while quoting a string
  that does not appear in the file. Settle it with `grep -c 'NOT RUN' docs/exit-criterion.md`.

---

## Appendix — errors I made during this review

Recorded because the brief asks reviewers to label their own citations, and because three of the
brief's own errors came from not doing this.

1. **Reported "LINT EXIT: 0" for the deflated grader.** Under zsh, `$?` after a pipeline is `tail`'s
   status, not `node`'s. Re-measured with output redirected: **exit 1, 9 problems** — the opposite
   conclusion. Corrected before it reached a finding.
2. **A cast regex that missed `vmrun.ts:49`** (a cast to an inline object type). Widened and
   re-inspected every match.
3. **Miscounted `task.ts`'s cast tokens as 11**; the answer is 10, which brings the total to 16 and
   agrees with the brief on tokens while disagreeing on files.
4. **Read `grep -c` returning 0 as a tool failure** when 0 was the answer I wanted (zero rejecting
   `FakeTransport` handlers).
5. **A heredoc injection that did not swallow what I intended.** Replaced the hand-placed probe with
   a full insertion-point sweep, which is what produced finding 1 — the single-position probe would
   have confirmed P22 rather than refuting it.

## Appendix — what I did not measure

Stated so nobody reads silence as clearance.

- Whether a **conditionally emitted** unique checkpoint id can make `incomplete` fire on a
  legitimately solved lab (a false fail). Settling it needs a guest, so it is REASONED at best.
- P21's generator-validation condition beyond endorsing it — no generator exists yet to check.
- P35 shape B's runtime behaviour: it lives in `npm run validate`, which is ISO-blocked and has
  never executed.
- Anything requiring the VM: `npm run validate`, `npm run test:vm`, `scripts/provision.sh`. Not run,
  by instruction, and none of them can run on this machine.
