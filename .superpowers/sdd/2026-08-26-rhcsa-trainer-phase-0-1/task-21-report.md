# Task 21 report — first graded task, two concept cards, `rhcsa validate`

Baseline before this task: 233 passing / 21 test files, `npm run typecheck`
clean, tree clean, at `17b8cd4`.

Observed after this task: **246 passing / 23 test files**, `npm run
typecheck` clean. (233 → 246: +13 tests, +2 files — `test/validate/run.test.ts`,
`test/cli/validate.test.ts`.)

No fixture in this task has ever been executed against a real machine. The
RHEL 9 VM does not exist (the ISO is a user-owned blocker), so Step 12's
6/6-fixture acceptance run is deferred per the mandates' own ruling — see
"Step 12 — deferred" below. Everything else the mandates and Step 11 call
runnable on this host was run, and is pasted below.

## Files

Created:
- `content/tasks/storage/014-grow-home-lv/task.yaml`
- `content/tasks/storage/014-grow-home-lv/setup.sh`
- `content/tasks/storage/014-grow-home-lv/grade.sh`
- `content/tasks/storage/014-grow-home-lv/solutions/01-lvextend-then-growfs.sh`
- `content/tasks/storage/014-grow-home-lv/solutions/02-lvextend-r-by-uuid.sh`
- `content/tasks/storage/014-grow-home-lv/antisolutions/01-forgot-growfs.sh`
- `content/tasks/storage/014-grow-home-lv/antisolutions/02-removed-persistence.sh`
- `content/tasks/storage/014-grow-home-lv/antisolutions/03-wrong-lv.sh`
- `content/concepts/storage/lvm-abstraction-stack.md`
- `content/concepts/storage/why-xfs-cannot-shrink.md`
- `src/engine/validate/run.ts`
- `test/validate/run.test.ts`
- `test/cli/validate.test.ts`

Modified:
- `src/cli/index.ts` (added the `validate` command; fixed the `--content ""`
  hole in `parseCoverageArgs`; added a stdout assertion to the `--strict`
  test path)
- `src/engine/validate/harness.ts` (mandates 2, 3, and 8's first item)
- `test/validate/harness.test.ts` (TDD tests for mandates 2 and 3)
- `test/cli/coverage.test.ts` (TDD test + assertion for mandate 6)

All `.sh` files created are `chmod +x`, confirmed with `ls -l` (see Step 11
below).

## Mandate 1 — the empty-target false-pass guard

Verified against the real `content/lib/assert.sh` (commit `c1b3b01`) exactly
as the addendum describes, before writing the guard: `to_bytes` returns 1 and
prints to stderr on an unparseable argument; if it's not sourced at all the
command substitution exits 127; and its last statement is the `awk` call, so a
missing `awk` also propagates as 127. All three make `TARGET=$(to_bytes 12G)
|| TARGET=` set `TARGET` to the empty string.

Measured, before adding the guard, that bash treats an empty comparison
operand as 0:

```
$ bash -c 'T=""; [[ 5 -ge "$T" ]]; echo rc=$?'
rc=0
```

Added the guard verbatim as specified (see `grade.sh` lines ~13-30), then
verified it by hand with a stubbed `to_bytes` sourced after the real
`assert.sh`:

```
$ bash -c '
source content/lib/assert.sh
to_bytes() { return 1; }
source content/tasks/storage/014-grow-home-lv/grade.sh
'
{"id":"lv-home-size","desc":"logical volume rhel/home is at least 12 GiB","status":"fail","detail":"grader could not compute its size targets: to_bytes failed, so assert.sh may not have been prepended or awk is missing"}
{"id":"fs-home-size","desc":"the filesystem on /home is at least 12 GiB","status":"fail","detail":"grader could not compute its size targets: to_bytes failed, so assert.sh may not have been prepended or awk is missing"}
{"id":"home-from-lv","desc":"/home is mounted from the rhel/home logical volume","status":"fail","detail":"grader could not compute its size targets: to_bytes failed, so assert.sh may not have been prepended or awk is missing"}
{"id":"var-intact","desc":"/var is untouched: still its own LV, still at least 2 GiB","status":"fail","detail":"grader could not compute its size targets: to_bytes failed, so assert.sh may not have been prepended or awk is missing"}
{"id":"persist-config","desc":"/home is configured to mount at boot","status":"fail","detail":"grader could not compute its size targets: to_bytes failed, so assert.sh may not have been prepended or awk is missing"}
```

Exactly five `fail` lines, all carrying the accurate detail. Then confirmed
the normal path is unchanged — `to_bytes` succeeds and the guard does not
fire:

```
$ bash -c '
source content/lib/assert.sh
TARGET=$(to_bytes 12G) || TARGET=
VAR_MIN=$(to_bytes 2G) || VAR_MIN=
echo "TARGET=$TARGET VAR_MIN=$VAR_MIN"
if [[ -z $TARGET || -z $VAR_MIN ]]; then echo "GUARD WOULD FIRE (unexpected)"; else echo "guard does not fire (expected)"; fi
'
TARGET=12884901888 VAR_MIN=2147483648
guard does not fire (expected)
```

12884901888 = 12 GiB and 2147483648 = 2 GiB — arithmetic checks out.

## Mandate 2 — a fixture script's exit code is now checked

Ran `test/validate/harness.test.ts` before touching `harness.ts`: 22/22
passing (none of them rely on a non-zero fixture-script exit — all existing
`FakeTransport` handlers return `code: 0` for every path they model). Nothing
to loosen.

Wrote two new failing tests first (TDD): a solution fixture whose script
exits non-zero, and an antisolution fixture whose script exits non-zero. Ran
them against the unmodified harness and got the "break-and-revert" evidence
the mandate asked for — the checkpoint-mismatch noise the mandate predicted,
verbatim:

```
FAIL  … mandate 2: fails a solution fixture whose script exits non-zero …
- Expected
+ Received
- ["solution script exited 5: lvextend: insufficient free space"]
+ [
+   "verdict A lv-var-size: expected pass, got fail",
+   "verdict A persist-config: expected pass, got fail",
+   "verdict B lv-var-size: expected pass, got fail",
+   "verdict B persist-config: expected pass, got fail",
+   "verdict B var-from-lv: expected pass, got fail",
+ ]
```

That is precisely the false diagnosis the mandate describes: five
checkpoint-mismatch lines pointing at "the grader is over-fitting," none of
which mention the real cause (`lvextend: insufficient free space`, exit 5).

Applied the fix — check `fixture.script`'s exit code the same way `setup.sh`'s
is already checked, for both `solution` and `antisolution` fixtures. Re-ran:
both new tests pass, all 26 tests in the file pass, one message each:

```
✓ mandate 2: fails a solution fixture whose script exits non-zero, naming the exit code, without a checkpoint mismatch
✓ mandate 2: fails an antisolution fixture whose script exits non-zero, naming the exit code
```

Applying the check to anti-solutions too is deliberate and closes the real
risk in `antisolutions/03-wrong-lv.sh`: its `# expect-fail:` set
(`lv-home-size, fs-home-size`) is byte-for-byte the same as `grade.sh`'s
`# baseline-fail:` set. Added one comment to `03`'s header recording that
this is intentional and only safe because the exit code is now checked (a
silently-failed `lvextend` there would otherwise reproduce the baseline
machine exactly and report `ok` while probing nothing). Did **not** implement
"reject an anti-solution declaring exactly the baseline" as a content rule —
per the mandate, `03` is a genuine detector, not a defect.

## Mandate 3 — an anti-solution's skipped verdict B is no longer silent

Wrote two failing tests first: one where an anti-solution declares an `@post`
id and verdict A has zero passes (so `grade()` skips the reboot per its
`anythingPassed` guard), and one where an anti-solution declares no `@post`
id in the same "nothing passed" situation (must NOT fire). Ran against the
unmodified harness:

```
× mandate 3: reports @post declarations as unverified …
  → expected 'verdict A var-from-lv: expected pass,…' to match /verdict B was skipped…/
✓ mandate 3: does not fire when the anti-solution declares no @post checkpoint
```

The first failed for the right reason (the message didn't exist yet); the
second already passed, confirming the "no @post declared" case was never
going to be a problem — consistent with retiring the `@pre`-only ledger
phrasing, which the mandate says would have wrongly rejected two of this
task's three anti-solutions.

Extended the `else if (fixture.kind === 'solution')` branch with an
`else if (declared.some((d) => d.phase === 'post'))` arm that reports the
unverified `@post` ids by name. Re-ran: both tests pass. None of this task's
three anti-solutions trip this branch — it is a general harness hole, not a
content bug in this task, exactly as the mandate says.

## Mandate 4 — `var-intact` recorded as a knowingly-unprobed invariant

Worked out the same coverage table the mandate gives: `lv-home-size` is
probed by the baseline and `03`; `fs-home-size` by the baseline, `01`,
`02@post`, and `03`; `home-from-lv` by `02@post`; `persist-config` by `02`;
`var-intact` by nothing. Did not write a fourth anti-solution and did not
implement the coverage-union check in `validateBank` (it never sees emitted
checkpoint ids — they live inside `runFixture`'s verdict A — so enforcing it
there means plumbing ids out through `FixtureResult`, more surgery than this
task should carry). **Enforcement is forwarded** to whichever later task adds
that plumbing. Instead added the `# unprobed-invariant: var-intact` header
directly above `var-intact`'s check in `grade.sh`, with the same reasoning
the mandate specifies (XFS cannot shrink; damaging `/var` risks a guest that
does not boot; the harness cannot tell "correctly broken" from "unbootable").
Nothing parses this header yet — it's a deadline this task is discharging
early, not a claim that it's enforced today.

## Mandate 5 — the `run.ts` test fixture's anti-solution has a real body

`test/validate/run.test.ts`'s `PASSING.fixtures` antisolution entry is
`{ kind: 'antisolution', name: '01.sh', script: '# expect-fail: goal\nWRONG' }`
— not `DO_WRONG`. Checked `WRONG` contains none of `DO`, `SETUP`, `GRADE`
(the three substrings `deps()`'s `FakeTransport` handler matches on), so it
executes as a genuine no-op against the fake world and the anti-solution's
`expect-fail: goal` declaration is actually exercised rather than trivially
satisfied by an empty script.

## Mandate 6 — two parked CLI items

**`--content ""`**: added the `value === ''` check to `parseCoverageArgs`
(TDD: wrote the failing test first — `exits 2 with usage when --content is
the empty string`; ran it, saw `expected 1 to be 2` because `loadBank('')`
was resolving against the process cwd; then added the guard and it passed).
Applied the identical guard in the new `parseValidateArgs` for both
`--content` and `--snapshot` (an empty snapshot name is exactly as wrong as
an empty content root — `controller.revert('')` is never intended).

**`--strict` stdout assertion**: added `expect(c.out.join('\n')).toMatch(/tasks: \d/)`
to the existing `--strict` test in `test/cli/coverage.test.ts`. It passed
immediately (the line already exists at `src/cli/index.ts:87` — verified by
running `coverage --content` above and seeing `tasks: 1` on stdout), which is
expected: this test is a regression guard, not a new-behavior test, so it
should be green from the moment it's added.

Also added a documentation-only row to the troubleshooting table below (per
mandate 8's second item, since the underlying `readdir(...).catch(() => [])`
swallow in `loadTaskScripts` belongs to a closed task and is legibility-only):

| `needs at least 2 solutions` when `solutions/` looks present | the directory name is misspelled; `readdir` failures are swallowed | check the spelling of `solutions/` and `antisolutions/` |

## Mandate 7 — `fileURLToPath`, not `.pathname`

Both new test files (`test/validate/run.test.ts`, `test/cli/validate.test.ts`)
were checked: `run.test.ts` needs no filesystem path at all (its `TaskSpec`
fixtures use a synthetic `dir` string), so there was nothing to get wrong.
`test/cli/validate.test.ts` does need real fixture paths, and uses
`fileURLToPath(new URL(...))`, not `.pathname`. Did not touch any of the
seven existing `.pathname` files (`test/cli/coverage.test.ts` is one of the
seven — it was only edited for mandate 6's additions, and neither edit
touched its existing `.pathname` lines).

## Mandate 8 — two legibility items

1. Added the comment at the `assertLib` concatenation site in
   `loadTaskScripts` (`src/engine/validate/harness.ts`), directly above
   `grade: \`${assertLib}\n${gradeBody}\``, explaining the "more than one
   header" failure mode and confirming `content/lib/assert.sh` does not
   contain the `# baseline-fail:` literal today.
2. Added the troubleshooting-table row above (mandate 6 section) rather than
   changing the swallowed-`readdir` behavior, which belongs to a closed task.

## Measured-as-correct items — not touched

Per the mandates' own "measured as correct" section, confirmed rather than
re-derived:
- `storage.lvm.resize` exists at `content/objectives.yaml:135` exactly as
  written — used verbatim in `task.yaml` and both concept cards, no id added
  to `objectives.yaml`.
- The RHEL 9/10 taxonomy question does not block this task (the id exists at
  the same string in `objectives-rhel10.yaml:182` too) — not raised as a
  blocker.
- The `TaskSpec` shape in the brief's test-fixture `task()` helper matches
  `src/engine/content/task.ts:22-40` field-for-field; left as written apart
  from mandate 5's script body.
- `checkEmittedIds` and the "appeared only after the reboot" check
  (`harness.ts` around lines 252-255 pre-edit) were already implemented;
  nothing added there beyond mandates 2 and 3's own changes.
- `coverage` prints `tasks: N` on stdout at `src/cli/index.ts:87` (line number
  shifted slightly from the mandate's `:73` after the new imports were
  added) — confirmed live in Step 10's run below.

## Step 10 — content loads, every reference resolves

```
$ node src/cli/index.ts coverage --content content; echo "exit=$?"
content root: content
tasks: 1
concepts: 2
objectives: 68
uncovered objectives: 67
  ... (67 ids, none of them storage.lvm.resize)
untaught concepts: 0
exit=0
```

No `problem:` line anywhere in stderr. `untaught concepts: 0` confirms both
concept cards are reachable through `requires_concepts`. `storage.lvm.resize`
does not appear in the uncovered list, confirming the objective is now
covered by this task and the id used matches the real taxonomy.

## Step 11 — bash syntax and declared-vs-emitted checkpoint ids

```
$ for f in content/tasks/storage/014-grow-home-lv/setup.sh \
           content/tasks/storage/014-grow-home-lv/grade.sh \
           content/tasks/storage/014-grow-home-lv/solutions/*.sh \
           content/tasks/storage/014-grow-home-lv/antisolutions/*.sh; do
  bash -n "$f" || echo "SYNTAX ERROR: $f"
done
echo "syntax pass complete"
syntax pass complete
```

No `SYNTAX ERROR` lines.

```
$ T=content/tasks/storage/014-grow-home-lv
$ emitted=$(grep -oE 'ck_(pass|fail|skip) [a-z0-9-]+' "$T/grade.sh" | awk '{print $2}' | sort -u)
$ declared=$(grep -hoE '^# (expect|baseline)-fail:.*' "$T/grade.sh" "$T"/antisolutions/*.sh \
  | sed 's/^# [a-z]*-fail://' | tr ',' '\n' | sed 's/@.*//' | tr -d ' ' | sort -u)
$ comm -13 <(echo "$emitted") <(echo "$declared")
$ echo "^ any id above is declared but never emitted"
^ any id above is declared but never emitted
```

No output above the marker line — every declared id is one the grader
actually emits. (Two of my own explanatory comments in `grade.sh` originally
matched this same `ck_(pass|fail|skip) <word>` grep pattern — e.g. "...would
report every size checkpoint as passing..." had briefly read "...emit
ck_pass for every size checkpoint...", which the regex parsed as `ck_pass
for`. Reworded both comments to avoid the literal `ck_pass`/`ck_fail` +
adjacent-word collision; this only ever polluted the diagnostic's `emitted`
set with harmless extra tokens (`for`, `with`) and never affected the
`comm -13` result, which only checks for declared-but-missing ids.)

`chmod +x` and `ls -l` confirmation for every `.sh` created:

```
.rwxr-xr-x  230 … antisolutions/01-forgot-growfs.sh
.rwxr-xr-x 675 … solutions/02-lvextend-r-by-uuid.sh
.rwxr-xr-x 599 … antisolutions/02-removed-persistence.sh
.rwxr-xr-x 794 … antisolutions/03-wrong-lv.sh
.rwxr-xr-x 5.4k … grade.sh
.rwxr-xr-x 1.5k … setup.sh
.rwxr-xr-x 170 … solutions/01-lvextend-then-growfs.sh
```

All executable.

`shellcheck` is not installed on this host (confirmed unavailable by four
prior tasks). Did not install it or chase it. These scripts — `setup.sh`,
`grade.sh`, both solutions, all three anti-solutions — have never been
linted.

## Step 12 — ACCEPTANCE — deferred

**Not run.** The RHEL 9 lab VM does not exist; the ISO is a user-owned
blocker, and no VM operation of any kind was performed (no `vmrun`, no
snapshot, no start/stop/revert, on this project's VM or on the user's
unrelated Ubuntu/Windows 11 guests). Per the mandates' explicit ruling, Task
22 does not wait for this — it proceeds on the content conventions
established here, and this 6/6 gate becomes a documented acceptance the user
runs once the VM boots, alongside Task 19's Step 5 and Task 25.

What each of the six fixtures will prove, once run:

1. **`none/no-action`** — proves the baseline is honest: `lv-home-size` and
   `fs-home-size` fail on an untouched system (declared in
   `# baseline-fail:`), while `home-from-lv`, `var-intact`, and
   `persist-config` all pass from the start as invariants.
2. **`solution/01-lvextend-then-growfs.sh`** — proves the two-step path
   (`lvextend` then `xfs_growfs`) makes every checkpoint pass, including
   after a reboot (fstab is untouched, so persistence was never broken).
3. **`solution/02-lvextend-r-by-uuid.sh`** — proves a mechanistically
   different but equally correct path (`lvextend -r`, UUID-based fstab
   entry) also makes every checkpoint pass — this is the fixture that would
   catch a grader over-fitted to `/dev/mapper/rhel-home` literal strings or
   to a separate `xfs_growfs` step.
4. **`antisolution/01-forgot-growfs.sh`** — proves `fs-home-size` correctly
   fails when the LV grew but the filesystem did not (`lv-home-size` passes,
   `fs-home-size` does not), in both verdicts.
5. **`antisolution/02-removed-persistence.sh`** — proves `persist-config`
   fails immediately, and that `home-from-lv` and `fs-home-size` pass in
   verdict A but fail in verdict B — the exact persistence signature the
   reboot check exists to catch.
6. **`antisolution/03-wrong-lv.sh`** — proves the grader is checking
   `rhel/home` specifically, not "did the VG shrink": growing `rhel/root`
   instead leaves `lv-home-size` and `fs-home-size` failing even though VG
   free space was consumed.

No fixture in this task has been executed against a real machine. Everything
above is a design claim to be confirmed by the deferred Step 12 run, not a
result already observed.

## Verify-before-committing checklist

1. `bash -n` clean on all seven scripts — Step 11 above. ✓
2. Step 11's `comm -13` check pasted, empty output. ✓
3. Mandate 1's stub-`to_bytes` run pasted — five `fail` lines, normal path
   unchanged. ✓
4. Mandate 2's break-and-revert, with the observed failure described. ✓
5. `node src/cli/index.ts coverage --content content` pasted, no
   `storage.lvm.resize` problem line. ✓
6. `npx vitest run` and `npm run typecheck` — 246 passing / 23 test files (up
   from 233/21), typecheck clean. ✓
7. `git status --porcelain` empty after committing (confirmed below).

## Files outside this task's scope

None observed modified or untracked outside the file list above at the time
of this report. Other agents' concurrent work was not touched.
