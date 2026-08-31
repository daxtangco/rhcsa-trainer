# Task 21 review — first graded task, two concept cards, `rhcsa validate`

Range reviewed: `17b8cd4..8513019` (one commit, 17 files, +798/-5).

## Verdicts

**1. Spec compliance — PASS.** All eight mandates plus the addendum are
satisfied. Two of the mandates' own factual claims are wrong and I say so
below (F3, F4); neither changes what the implementer should have written.

**2. Task quality — APPROVE WITH CHANGES.** The design is sound: I walked all
six fixtures against the grader by hand and each lands on its declared verdict.
Two must-fixes are convention-level, which is why they matter out of proportion
to their size — Tasks 22-24 clone this directory's shape, so both defects would
be inherited 27 times and would each look like a bug in the individual task.

## Totals I measured

```
$ npx vitest run
 Test Files  23 passed (23)
      Tests  246 passed (246)

$ npm run typecheck
tsc --noEmit          (exit 0, no output)
```

246 passing / 23 files, typecheck clean. Baseline `17b8cd4` was 233 / 21. This
**matches the report exactly** (246/23, +13 tests, +2 files). No discrepancy.
`git status --porcelain` empty before and after this review; all mutation work
was done on a scratch copy at `/tmp/t21mut` with `node_modules` symlinked back.

## Mandate-by-mandate

### Mandate 1 — fail-closed size-target guard: SATISFIED, reproduced

`grade.sh:16-31`. I did not trust the report's paste; I reran all three failure
modes on a scratch copy.

Mode 1 — stub `to_bytes() { return 1; }` sourced after the real `assert.sh`:
five `"status":"fail"` lines, all carrying the specified detail, exit 0.
Mode 1b — real `to_bytes` with an unparseable argument (`12G` → `12Q`, so
`assert.sh:80-83`'s `return 1` fires): identical five lines.
Mode 3 — `awk` shadowed to return 127: identical five lines. `_emit` uses only
`printf` and parameter expansion, so the guard survives a missing `awk`.
Mode 2 — see F3; it does **not** produce five lines, and the mandate is wrong
about that.

The four things the mandate does not spell out, all checked:

- **The five ids are exactly the complete set the normal path emits, spelled
  identically.** Guard block (`grade.sh:26-30`) = `{fs-home-size, home-from-lv,
  lv-home-size, persist-config, var-intact}`; normal path (`grade.sh:37-110`) =
  the same five. `diff` of the two sorted sets is empty. No sixth id, no typo,
  no omission. I also checked the `desc` strings pairwise: all five are
  byte-identical between guard and normal path, which matters because
  `verdict.ts`'s `finalVerdict` comment requires the masked checkpoint total and
  the verdict to agree on id *and* desc.
- **`exit 0` does not make the run look successful.** `grader.ts:85` —
  `// Exit code is deliberately ignored (spec section 6.5 rule 3)` — only
  `runA.stdout` is parsed. `allPassed` (`verdict.ts`) requires
  `checkpoints.length > 0 && every(pass)`, so five `fail` lines give
  `allPassed: false` regardless of the `0`.
- **Normal path unchanged.** `TARGET=$(to_bytes 12G) || TARGET=` assigns the
  real byte count on success (measured: `TARGET=12884901888`,
  `VAR_MIN=2147483648`; both exact powers-of-two multiples, arithmetic correct),
  and `HOME_LV_MIN=$TARGET` at `grade.sh:18` is ordered **after** it. Empty
  assignment is safe with no `set -u` in force in this script anyway.
- **All `ck` ids are literals.** No variable, no interpolation, no loop. No
  `ck_skip` and no bare `ck` are used at all. Confirmed by
  `grep -nE 'ck_(pass|fail|skip)' grade.sh` — 17 hits, every one a real call
  with a literal id (see F7 for why that grep is worth watching).

### Mandate 2 — fixture exit code checked: SATISFIED, mutation-tested

`harness.ts:192-205`. The check sits inside the single
`if (fixture.script.trim() !== '')` block that covers **both** solution and
anti-solution fixtures (the `none` fixture's script is `''`, so it is correctly
skipped). The message names the kind, the code, and stderr.

Existing `test/validate/harness.test.ts` fixtures all still pass — 26/26, and
none of them relied on a non-zero fixture script, so nothing was loosened to
accommodate one.

Mutation: I reverted the block to the old
`await deps.transport.exec(fixture.script)` on the scratch copy. Both new tests
fail, and they fail with exactly the red herring the mandate predicted:

```
- "antisolution script exited 5: lvextend: insufficient free space"
+ "verdict A persist-config: expected pass, got fail"
+ "verdict B persist-config: expected pass, got fail"
+ "verdict B var-from-lv: expected pass, got fail"
```

Five checkpoint-mismatch lines pointing at the grader, none mentioning
`lvextend: insufficient free space`. The tests assert `failures` with
`toEqual` on the exact one-element array, so a checkpoint mismatch cannot slip
past them. The test does fail when the check is removed.

`antisolutions/03-wrong-lv.sh` was **not** changed and the "reject an
anti-solution declaring exactly the baseline" content rule was **not**
implemented — correct per the mandate and the reviewer brief. The one-line
comment recording that `03`'s declared set equals the baseline set on purpose
is at `03-wrong-lv.sh:4-11` and states the reason accurately.

### Mandate 3 — skipped verdict B on an anti-solution: SATISFIED, mutation-tested

`harness.ts:245-256`. The new arm keys on
`declared.some((d) => d.phase === 'post')`, not on `kind`, and the message names
the ids. Mutation (`else if (false)`): the mandate-3 test fails. See **F4** —
the code is right, but what it closes is a diagnostic gap, not a false pass.

### Mandate 4 — `var-intact` declared unprobed: SATISFIED

`grade.sh:56-63`, immediately above the `var-intact` check, in `# baseline-fail:`
header style. I verified the accompanying comment says both things the reviewer
brief asked for: the real reason (XFS cannot shrink, so damaging `/var` means
`lvremove`, a reformat, or unmounting a filesystem RHEL 9 holds busy, and the
harness cannot tell "correctly broken" from "unbootable"), and plainly that
replacing this pass with an unconditional one would validate green across all
six fixtures — i.e. the gap was accepted, not overlooked.

No fourth anti-solution was written and the coverage-union check was not added
to `validateBank`. Correct. **Enforcement is forwarded**: `validateBank` never
sees emitted checkpoint ids (they live inside `runFixture`'s verdict A), so the
union check needs ids plumbed out through `FixtureResult`.

I confirmed the gap is real rather than taking it on faith. Running Step 11's
check in the opposite direction:

```
$ comm -23 <(echo "$emitted") <(echo "$declared")
var-intact
```

`var-intact` is the only id the grader emits that no `# expect-fail:` or
`# baseline-fail:` header names. That is exactly mandate 4's table. And
`# baseline-fail: lv-home-size, fs-home-size` correctly lists *only* the goal
checkpoints — `var-intact` is absent from it, which is required because the
`kind: 'none'` fixture asserts everything unlisted **passes** at baseline.

The `# unprobed-invariant: var-intact` header is deliberately unparsed. Not a
dead-code defect.

### Mandate 5 — `WRONG`, not `DO_WRONG`: SATISFIED, verified not eyeballed

`test/validate/run.test.ts:42`. `WRONG` contains none of `DO`, `SETUP`, `GRADE`.
I verified the trap is live rather than assuming it: mutating the fixture to
`DO_WRONG` on the scratch copy fails **both** `run.test.ts` tests, because
`script.includes('DO')` sets `done = true`, the grader returns `pass`, and the
fixture then contradicts its own `# expect-fail: goal`. See F6 for how much
this buys.

### Mandate 6 — two parked CLI items: SATISFIED, both mutation-tested

`--content ""` rejected in `parseCoverageArgs` (`src/cli/index.ts:52`) and in
the new `parseValidateArgs` (`src/cli/index.ts:501`), the latter for
`--snapshot` too, which is a reasonable extension. Mutations: removing
`value === ''` from `parseCoverageArgs` fails
`exits 2 with usage when --content is the empty string`; removing it from
`parseValidateArgs` fails the matching `validate` test.

`--strict` stdout assertion at `test/cli/coverage.test.ts:35`. Mutation:
deleting `io.out(\`tasks: ${bank.tasks.length}\`)` fails three tests, and the
`--strict` one is confirmed among them by name:

```
 × rhcsa coverage > exits 1 under --strict while coverage gaps remain
```

So the assertion is load-bearing, not decorative.

### Mandate 7 — `fileURLToPath`: SATISFIED

`test/cli/validate.test.ts:1,6-7` uses `fileURLToPath(new URL(...))` with a
comment explaining why. `test/validate/run.test.ts` needs no filesystem path.
The seven parked `.pathname` files were not touched (`test/cli/coverage.test.ts`
was edited only for mandate 6 and its existing `.pathname` line at 96 is
untouched).

### Mandate 8 — two legibility items: item 1 SATISFIED, item 2 misplaced

Item 1: the `assertLib` concatenation comment is at `harness.ts:60-64`, at the
site, and states the failure mode and that `assert.sh` does not contain the
literal today. Correct. But the same paragraph was *also* copied into
`grade.sh` — see **F2**, which is a must-fix.

Item 2: see **F5**. The troubleshooting row was written into the report file
rather than into a table anyone diagnosing a failure will read.

## Findings, ranked

### F1 — must-fix. `setup.sh` never verifies `/home`'s starting size, and solution 02 silently depends on it being exactly 8 GiB

`docs/vm-build-checklist.md:74` specifies `/home` as an **8 GB** LV.
`solutions/02-lvextend-r-by-uuid.sh:7` grows it with a *relative*
`lvextend -r -L +4G`, which reaches the 12 GiB target only from exactly 8 GiB.
`solutions/01-lvextend-then-growfs.sh:4` uses absolute `-L 12G` and is immune.

`setup.sh:12-18` has a precondition block whose stated job is to "verify the
machine it was promised". It checks that `/home` is its own LV and that VG
`rhel` has ≥ 5 GiB free — but **not** `/home`'s current size, which is the one
precondition both goal checkpoints depend on. Two failure directions follow,
and the brief's own Step 12 table mis-routes both:

- **Guest built slightly small** (e.g. the builder enters `8000 MiB`, or `8 GB`
  decimal = 8388608000 B, instead of 8 GiB): solution 02 lands at 12096 MiB <
  12 GiB, so `solution/02: lv-home-size: expected pass, got fail`. The Step 12
  table routes that to "**grader over-fitting** — the most valuable finding
  here … make the checkpoint mechanism-agnostic; **do not change the solution to
  suit the grader**." That is the wrong diagnosis, and it is the same
  red-herring shape mandate 2 exists to eliminate — reappearing on the content
  side, where the exit-code check cannot catch it because `lvextend` *succeeds*.
- **Guest built at or near 12 GiB**: `setup.sh` passes, the student reads
  "/home is almost full, make at least 12 GiB available", and the grader passes
  with no action taken. A student-facing false pass — the project's signature
  defect. Note `within_pct(..., 2)` gives `fs-home-size` a ±245 MiB tolerance,
  so an `/home` built at 11.8 GiB already satisfies `fs-home-size` at baseline.
  `validate`'s `no-action` fixture would catch this as `expected fail, got
  pass`, but Step 12 is deferred and has never run, so nothing catches it today.

Fix, and the reason it is worth doing before Task 22: add the missing
precondition to `setup.sh` (fail if `rhel/home` is already at or within
tolerance of the target, pointing at the checklist), and prefer an absolute
`-L 12G` in solution 02 — its two intended differences from solution 01 are
`-r` and the UUID fstab entry, neither of which needs the relative form. The
generalisable convention is the valuable part: **setup must verify every
precondition the goal checkpoints depend on, not only the ones needed to run.**
That sentence belongs in whatever Tasks 22-24 copy from.

### F2 — must-fix. `grade.sh` carries the literal `# baseline-fail:` in prose, one reflow away from breaking the header parse

`grade.sh:4-9` duplicates mandate 8's paragraph into the grader, quoting
`"# baseline-fail:"` mid-line. Mandate 8 asked for that comment at the
*concatenation site in `harness.ts`*, where it is inert. It is there. The copy
in `grade.sh` puts the literal into the one file whose headers are parsed.

Measured, on the combined `assertLib + '\n' + grade.sh` string that
`loadTaskScripts` actually builds:

```
# as committed
parsed: [{"id":"lv-home-size","phase":"both"},{"id":"fs-home-size","phase":"both"}]
lines matching /^#\s*baseline-fail:/m :
   >> # baseline-fail: lv-home-size, fs-home-size

# after reflowing the prose comment so the literal starts a line
THREW: more than one "# baseline-fail:" header found
lines matching /^#\s*baseline-fail:/m :
   >> # baseline-fail: header would trip the "more than one header" guard in
   >> # baseline-fail: lv-home-size, fs-home-size
```

As committed it is correct, because the quote sits mid-line and
`parseExpectations` anchors on `^#\s*`. But it is a tripwire in the template 27
more graders will be cloned from, and the trigger is an ordinary comment
rewrap. It fails **loudly** (a `ContentError`, the task stops loading), so this
is not a false pass — it is cheap-to-fix inherited fragility.

Fix: delete the duplicated paragraph from `grade.sh`; `harness.ts:60-64` already
carries it. If it must stay, write it without the literal.

### F3 — observation. Mandate 1's guard cannot speak in one of the three modes its own message names

Measured (`bash content/tasks/storage/014-grow-home-lv/grade.sh`, i.e.
`assert.sh` not prepended):

```
grade.sh: line 16: to_bytes: command not found
grade.sh: line 17: to_bytes: command not found
grade.sh: line 26: ck_fail: command not found
... (five ck_fail lines) ...
exit=0
```

Zero checkpoints on **stdout**. If `assert.sh` was not prepended then `ck_fail`
is undefined too, so the guard cannot emit the message that names that very
cause. The addendum states this mode "behaves as the message claims"; it does
not. Per the brief's rule, my measurement stands.

It is still fail-closed and still loud in the right places:
`parseVerdict('')` yields no checkpoints, `allPassed` requires `length > 0` so
it is `false`, and `checkVerdict` (`harness.ts:124-126`) reports
`verdict A: grader emitted no checkpoints`. And the two modes that *can* happen
in a working install — unparseable argument, missing `awk` — both emit all five
lines. So: no defect, but the detail string promises a diagnosis it cannot
deliver in one third of the cases it enumerates. Half a sentence in the comment
would stop a future reader hunting for a message that cannot appear.

### F4 — observation. Mandate 3's new arm improves a diagnostic; it does not close a false pass

`expectations.ts:expectedStatus` returns `'pass'` for a `@post`-declared id in
verdict A. So an anti-solution with zero passes in verdict A necessarily emits
that id as non-pass in A, and `checkVerdict` already reports
`verdict A <id>: expected pass, got fail`. Confirmed by the mutation run: with
the new arm disabled, the mandate-3 test's fixture is still `ok: false`, and the
failure is `"verdict A var-from-lv: expected pass, got fail"`. The same holds
if the id is `skip`ped (folded to `fail`) or not emitted at all (then
`checkEmittedIds` fires).

The mandate's framing — "the fixture passes green having tested half of what it
claims" — is therefore not reachable. The change is correct, cheap, and
produces a far better message, and the test does fail when it is removed. Worth
recording accurately so the ledger does not book an already-closed hole as
newly closed. Note also that in that test only the `toMatch` assertion is
load-bearing; `expect(ok).toBe(false)` passes either way.

### F5 — observation / forward-to-later. Mandate 8's troubleshooting row landed where nobody will read it

The `needs at least 2 solutions` row exists only in `task-21-report.md` (and in
`task-21-mandates.md`, where it was specified). Step 12's table in
`task-21-brief.md` is unchanged, and `docs/` has nothing. A row in a task
report does not help the person diagnosing a misspelled `solutions/` directory,
and Tasks 22-24 will not read it. Forward: put it in `docs/r1-findings.md` —
which the Step 12 table already cross-references — when Task 25 wraps
`npm run validate`.

### F6 — observation. Mandate 5 is satisfied to the letter but buys less than it appears to

`WRONG` is correct and demonstrably load-bearing (mutating it to `DO_WRONG`
fails both `run.test.ts` tests). But in `FakeTransport`'s world a script
matching none of the markers still changes nothing, so the anti-solution fixture
remains an empty attack surface — what it gained is that it now traverses
mandate 2's exit-code path rather than being skipped by
`fixture.script.trim() !== ''`. That is real value; it is just not "the
anti-solution now does something wrong". Don't credit it with more when Task 22
copies the pattern.

### F7 — observation / forward-to-later. Step 11's emitted-ids grep is prose-sensitive

`grep -oE 'ck_(pass|fail|skip) [a-z0-9-]+'` matches comment prose as readily as
code. The implementer reworded two `grade.sh` comments to avoid the collision
and documented it in the report. Harmless for `comm -13` (extra tokens only
inflate `emitted`, and the check looks for declared-but-missing ids), and I
confirmed no stray matches remain: all 17 hits in `grade.sh` are real calls.
But the convention now silently forbids writing `ck_pass <word>` in a grader
comment, which nothing states. Forward to whichever task derives the masked
checkpoint total by static inspection — that grep must skip comment lines, since
there a wrong total is worse than none.

### F8 — observation. Two small carry-overs from the brief in `validate()`

`src/cli/index.ts:534` — `const tasks = taskIds.length === 0 ? bank.tasks : []`
aliases `bank.tasks`. The following `tasks.push` is unreachable in that branch
today so it is safe, but a future edit that pushes outside the loop would mutate
the loaded bank. `src/cli/index.ts:553` — `const require = ...` shadows nothing
in ESM but reads like the CJS builtin. Both inherited verbatim from the brief;
neither is worth a change on its own.

## Grader contract — all four parts hold

- **Grades end state, not commands.** Every check reads current state:
  `lv_size_bytes` (`sudo lvs`), `mount_source` (`findmnt`), `fs_size_bytes`
  (`df -B1`), `is_persistent` (awk over `/etc/fstab` and `*.mount`). Nothing
  infers *how* the student got there. `persist-config` is explicitly
  mechanism-agnostic — fstab or a `.mount` unit, device path or UUID — which is
  what makes solution 02 a real over-fitting detector.
- **Read-only.** No `mount`, no `sed -i`, no `systemctl`, no writes of any kind,
  in `grade.sh` or in any helper it calls.
- **Idempotent.** No state is mutated, so two runs give the same verdict. This
  is also what makes verdict B meaningful.
- **Never reads shell history.** Confirmed. (`setup.sh:31` truncates
  `$HOME/.bash_history`, which is setup's prerogative, not the grader's.)

Plus: every `ck` id is a literal; `# baseline-fail:` lists exactly the two goal
checkpoints and correctly omits `var-intact`.

## Six-fixture walkthrough (by hand — none of this has run)

I traced each fixture against `grade.sh` and `assert.sh` on the layout in
`docs/vm-build-checklist.md` (`/` 12 GB, `/home` 8 GB, `/var` its own LV,
~15 GB free extents):

| fixture | verdict A | verdict B | matches declaration |
|---|---|---|---|
| `none/no-action` | lv,fs fail; home-from-lv, var-intact, persist pass | same | yes — `# baseline-fail: lv-home-size, fs-home-size` |
| `solution/01` | all five pass | all five pass | yes |
| `solution/02` | all five pass (fstab now `UUID=`; `is_persistent` compares field 2 literally and rejects only `noauto`) | all five pass | yes |
| `antisolution/01` | fs-home-size fail, rest pass | same | yes — `fs-home-size` |
| `antisolution/02` | persist fail; lv, fs, home-from-lv, var pass | home-from-lv + fs fail (`findmnt --target /home` now resolves to `/`, so the `home_on_lv == no` arm fires first — design decision 2 working), persist fail | yes — `persist-config, home-from-lv@post, fs-home-size@post` |
| `antisolution/03` | lv + fs fail, rest pass | same | yes — `lv-home-size, fs-home-size` |

Each anti-solution leaves at least one pass in verdict A, so `grade()`'s
`anythingPassed` guard lets the reboot run and none of them trips mandate 3's
new arm — as the mandate says.

**Step 12 is deferred and no fixture in this task has ever been executed
against a real machine.** Neither `lv_size_bytes` nor `mount_source` has run
against real LVM or a real mount. The table above is a design claim, not a
result. Noted, not billed — the RHEL 9 ISO is a user-owned blocker and the
ruling stands. F1 is the finding most likely to turn into a real Step 12
failure on the day the VM boots.

## Global constraints

No `as` casts and no non-null assertions added — I grepped all five changed TS
files; every hit was the word "as" in prose. No `enum`, no namespace, no
decorators, no parameter properties. Explicit `.ts` import extensions
throughout, `import type` used correctly for `verbatimModuleSyntax`, typecheck
clean under `noUncheckedIndexedAccess`. Nothing weakens SELinux. Exit code 124
is not used anywhere in this task. `content/lib/assert.sh` was not modified.
`verdict.ts`, `grader.ts` and `src/engine/content/*` are untouched.

## Confirmed as not-defects (measured, not assumed)

- `storage.lvm.resize` exists at `content/objectives.yaml:135`; Step 10 prints
  no `problem:` line and the id is absent from the 67-item uncovered list. No id
  was added to `objectives.yaml`.
- `untaught concepts: 0`, `tasks: 1`, `concepts: 2` — both cards are reachable
  through `requires_concepts`.
- `prerequisites:` on `why-xfs-cannot-shrink.md` is a real validated field
  (`concept.ts:11,86`) and is cross-checked against the bank
  (`bank.ts:193-195`), so it is not decorative.
- `within_pct ACTUAL EXPECTED PCT` — the call at `grade.sh:57` passes them in
  that order. Correct.
- `bash -n` clean on all seven scripts; all are mode 100755 in the commit.
- Step 11's `comm -13` is empty (no declared-but-never-emitted id).
- `shellcheck` is not installed; these scripts have never been linted. Recorded,
  not billed.

## Does anything block?

**No.** Tasks 22-24 can proceed on these conventions. But F1 and F2 should land
**before** Task 22 clones the directory, because both are convention-level: F1
would put a missing-precondition hole and a mis-routed diagnosis into all 28
tasks, and F2 would put a comment tripwire into all 28 graders. Fixing them
after the fact means 28 retrofits, which is the same argument mandate 4 used for
writing `# unprobed-invariant:` now.
