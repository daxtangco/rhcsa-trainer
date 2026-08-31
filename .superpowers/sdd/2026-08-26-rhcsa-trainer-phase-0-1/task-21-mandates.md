# Task 21 — mandated changes to the brief

Eight **required** changes. They override `task-21-brief.md` wherever they
conflict; everything else in the brief stands — both design decisions (grow
`/home` not `/var`; `fs-home-size` checks size **and** source device), the two
solutions, the three anti-solutions, both concept cards, the `validateBank`
implementation, and the commit message.

**Read the measurement warning first.** Every claim below is a command I ran on
this host with the output pasted, or a file in this repo I quote by line. Seven
times in this project I have handed an implementer a confident measurement; once
it was wrong, and twice a verification instruction I wrote was impossible as
stated. So: **confirm anything you depend on with your own command. If your
measurement disagrees with mine, yours wins — say so in the report and act on
yours.**

This task is the first one that authors real content, and the grader it writes is
the one the user's flagship lab depends on. Mandates 1, 2 and 3 are all the same
defect class this project keeps finding — **a check that passes for the wrong
reason, or a failure reported as the wrong thing** — and mandate 1 is the worst
instance found in the project so far, alongside Task 20's `_json_escape`.

## Measured as correct — do not "fix" these, and do not spend a review finding on them

I suspected each of these and measured it as fine:

- **`storage.lvm.resize` exists in the committed taxonomy.** Step 10 warns that
  if `problem: ... maps to unknown objective: storage.lvm.resize` appears, Task
  13 used a different id. It does not appear: `content/objectives.yaml:135` is
  `- id: storage.lvm.resize`. Use the id exactly as the brief writes it in
  `task.yaml` and in both concept cards, and do **not** add an id to
  `objectives.yaml`.
- **The RHEL 9-vs-RHEL 10 taxonomy decision does not block this task.**
  `storage.lvm.resize` exists at the *same id* in both `content/objectives.yaml`
  (135) and `content/objectives-rhel10.yaml` (182). So authoring against
  `objectives.yaml` with `rhel: 9` / `editions: ['r9']` forecloses nothing, and
  the user's pending decision does not need to be answered here. Say so in your
  report; do not wait on it and do not raise it as a blocker.
- **The test fixture's `TaskSpec` shape matches the committed interface.** I
  checked all seventeen fields in `src/engine/content/task.ts:22-40` against the
  brief's `task()` helper: every field is present and correctly typed. Leave it
  as written apart from mandate 5.
- **Parked finding 6 (an unknown checkpoint id in verdict B) is already
  implemented.** `src/engine/validate/harness.ts:252-255` builds `statusById` from
  verdict A and pushes `` `${cp.id} appeared only after the reboot` `` for any id
  in B that A never emitted. Nothing to add. Do not re-implement it.
- **`# baseline-fail:` and `# expect-fail:` ids are already cross-checked against
  what the grader actually emits**, for both the baseline and the anti-solutions
  (`checkEmittedIds`, `harness.ts` in the `none` branch and the `antisolution`
  branch). Step 11's `comm -13` shell check is therefore belt-and-braces — keep
  it anyway, because it is the only half that runs **without a VM**, and it is the
  only check this task can actually execute today.
- **`coverage` really does print `tasks: N` on stdout**
  (`src/cli/index.ts:73`), so mandate 6's new assertion is valid.

## 1. An empty size target makes the goal checkpoints PASS — the grader's own failure mode is a false pass

```bash
TARGET=$(to_bytes 12G)
HOME_LV_MIN=$TARGET
VAR_MIN=$(to_bytes 2G)
...
if [[ ${lv_bytes:-0} -ge $HOME_LV_MIN ]]; then
  ck_pass lv-home-size ...
```

`grade.sh` deliberately has no `set -e` (correct — a grader that dies early emits
fewer checkpoints). `to_bytes` returns 1 and prints to stderr on failure. So if
`to_bytes` ever fails, `TARGET` is the **empty string** and the script carries on.
Measured on this host:

```
$ bash -c 'T=""; if [[ 5 -ge $T ]]; then echo "PASSED (empty treated as 0)"; fi'
PASSED (empty treated as 0)
$ bash -c 'T=""; [[ 5 -ge "$T" ]]; echo rc=$?'
rc=0
```

Quoted or unquoted, **`[[ n -ge "" ]]` is true.** So a grader that could not
compute its own target emits `ck_pass lv-home-size`, `ck_pass fs-home-size` (via
the `-ge $TARGET` arm) and `ck_pass var-intact`. Every size checkpoint passes,
including both goal checkpoints. The student is told they got it right, and
`allPassed` agrees.

This is the project's signature defect in its purest form and it is worse here
than in Task 20, because there the checkpoint vanished and here it actively
asserts success. It is also the *default* direction of failure: the safe
direction would be to fail closed, and bash's arithmetic comparison fails open.

Add a guard immediately after the three assignments. A grader that cannot measure
must refuse to grade rather than approve:

```bash
TARGET=$(to_bytes 12G) || TARGET=
VAR_MIN=$(to_bytes 2G) || VAR_MIN=
HOME_LV_MIN=$TARGET

# Fail closed. bash treats an empty operand as 0, so `[[ n -ge "$TARGET" ]]` is
# TRUE when TARGET is empty - measured - which means a grader that could not
# compute its own targets would emit ck_pass for every size checkpoint and tell
# the student they got it right. There is no safe way to continue without these.
if [[ -z $TARGET || -z $VAR_MIN ]]; then
  detail='grader could not compute its size targets: to_bytes failed, so assert.sh may not have been prepended or awk is missing'
  ck_fail lv-home-size "logical volume rhel/home is at least 12 GiB" "$detail"
  ck_fail fs-home-size "the filesystem on /home is at least 12 GiB" "$detail"
  ck_fail home-from-lv "/home is mounted from the rhel/home logical volume" "$detail"
  ck_fail var-intact "/var is untouched: still its own LV, still at least 2 GiB" "$detail"
  ck_fail persist-config "/home is configured to mount at boot" "$detail"
  exit 0
fi
```

All five, not just the size ones: emitting a partial verdict would make the
harness report "appeared only after the reboot" style noise instead of the real
cause, and an empty verdict has its own hazard (`allPassed` requires
`length > 0`). Emitting five identical failures is loud, which is the point.

**Verify it by hand and paste the result:** run `grade.sh` with a stub
`to_bytes() { return 1; }` sourced after `assert.sh` and confirm you get five
`"status":"fail"` lines carrying that detail, then confirm the normal path is
unchanged. This is runnable on this host — no VM needed, since the guard fires
before any `lvs` or `findmnt` call.

## 2. A fixture script's exit code is discarded, so a solution that cannot run is reported as a grader defect

```ts
if (fixture.script.trim() !== '') await deps.transport.exec(fixture.script)
```

`src/engine/validate/harness.ts`. The result is **thrown away**. Twelve lines
above, `setup.sh` gets the opposite treatment, with the reasoning spelled out:

```ts
// A setup script that fails leaves the fixture measuring the wrong machine,
// so every downstream failure would be a red herring. Stop here instead.
const setupResult = await deps.transport.exec(scripts.setup)
if (setupResult.code !== 0) { ... return ... }
```

That reasoning applies word for word to a solution script. Every script this task
writes is `set -euo pipefail`, so any failing command aborts it — and
`solutions/01` runs `sudo lvextend -L 12G /dev/rhel/home`, which exits non-zero if
the volume group has no free extents. The machine then looks exactly like the
`no-action` fixture, the grader correctly reports the goal checkpoints failing,
and the harness prints `solution/01: lv-home-size: expected pass, got fail`. The
brief's own Step 12 troubleshooting table sends the reader to
"the grader is over-fitting to one command" — hunting a grader defect that does
not exist, when the real message was `lvextend: insufficient free space` on a
stderr nobody kept.

This is the same shape as Task 19 mandate 5: the neighbouring code already gets
it right, and the two disagree.

Treat it like `setup.sh` — for **both** fixture kinds:

```ts
  if (fixture.script.trim() !== '') {
    // Same reasoning as setup.sh above: a fixture script that aborts leaves the
    // grader measuring a machine nobody arranged, so its checkpoint mismatches
    // would be red herrings pointing at the grader. Every fixture here runs
    // `set -euo pipefail`; an anti-solution that deliberately models a command
    // erroring should say so with an explicit `|| true`.
    const fixtureResult = await deps.transport.exec(fixture.script)
    if (fixtureResult.code !== 0) {
      failures.push(
        `${fixture.kind} script exited ${fixtureResult.code}: ${fixtureResult.stderr.trim()}`,
      )
      return { taskId: task.id, kind: fixture.kind, name: fixture.name, ok: false, failures }
    }
  }
```

Applying it to anti-solutions too is deliberate, and it closes parked finding 3
("reject an anti-solution that declares exactly the baseline") in the only place
the real risk lives. `antisolutions/03-wrong-lv.sh` declares
`# expect-fail: lv-home-size, fs-home-size` — **byte-for-byte the same set as
`# baseline-fail: lv-home-size, fs-home-size`.** With the exit code discarded, an
`03` whose `lvextend` silently failed produces exactly the baseline machine,
matches its own declaration, and reports **ok** while probing nothing. With the
exit code checked, that cannot happen.

So **do not** implement "reject an anti-solution declaring exactly the baseline"
as a content rule. `03` is a genuine detector — it creates a different machine
(root grew, VG free space consumed) and would catch a grader that measured "did
the VG shrink" instead of `rhel/home` specifically, which is precisely what its
comment claims. The parked rule was written from the harness's side before any
content existed to test it against; the content disproves its strict form. Add
one line to `03`'s comment recording that its declared set equals the baseline
set on purpose, and that mandate 2's exit-code check is what makes that safe.

**Run the existing `test/validate/harness.test.ts` before and after.** If any
fixture there relies on a non-zero fixture script, report it and stop rather than
loosening this check to accommodate it. **Add a test**: a solution fixture whose
script exits non-zero must produce `ok: false` with a failure naming the exit
code, and must not report a checkpoint mismatch. Then break the check and watch
the test fail — report what the failure looked like.

## 3. An anti-solution's skipped verdict B is silent

```ts
    else if (task.rebootCheck && result.rebootError === undefined) {
      // No verdict B on a reboot-checking task means verdict A had no passes at
      // all, which a solution must never produce.
      if (fixture.kind === 'solution') {
        failures.push('verdict B was skipped: no checkpoint passed before the reboot')
      }
    }
```

`harness.ts:240-247`. The guard is `kind === 'solution'`, so for an
**anti-solution** whose verdict A has zero passes, `grade()` skips the reboot,
verdict B never exists, and every `@post` id the file declared goes **unverified
and unreported**. The fixture passes green having tested half of what it claims.

That is the real content of parked finding 2, and it is **not** what the ledger
summarised it as. The ledger says "reject a `@pre`-only anti-solution", which
would reject `01-forgot-growfs.sh` and `03-wrong-lv.sh` — both legitimate, and
both fine here because each leaves several checkpoints passing in A, so the reboot
does run. The condition that actually matters is "nothing passed in A", not "no
`@post` declared". Retire the `@pre`-only phrasing; it would have rejected two of
three good anti-solutions.

Extend the branch:

```ts
      if (fixture.kind === 'solution') {
        failures.push('verdict B was skipped: no checkpoint passed before the reboot')
      } else if (declared.some((d) => d.phase === 'post')) {
        // grade() skips the reboot when nothing passed in verdict A, so these
        // @post declarations were never actually verified. Passing green here
        // would mean the fixture tested half of what it claims.
        const ids = declared.filter((d) => d.phase === 'post').map((d) => d.id).join(', ')
        failures.push(
          `verdict B was skipped: no checkpoint passed before the reboot, so the @post declarations were never verified (${ids})`,
        )
      }
```

Add a test for it. None of this task's three anti-solutions trips it — this is a
general harness hole, not a content bug.

## 4. `var-intact` is an invariant that no anti-solution probes — declare it

Parked finding 1 requires that the union of anti-solution `# expect-fail:`
declarations cover every checkpoint the grader emits, because otherwise a grader
that hardcodes an invariant to `pass` validates green across every fixture. I
worked the union out for this task:

| checkpoint | probed by |
|---|---|
| `lv-home-size` | baseline, `03` |
| `fs-home-size` | baseline, `01`, `02@post`, `03` |
| `home-from-lv` | `02@post` |
| `persist-config` | `02` |
| **`var-intact`** | **nothing** |

Replace `ck_pass var-intact` with an unconditional `ck_pass` and all six fixtures
still report ok. That is exactly the false pass the rule exists to catch, and it
is live in this task's grader.

It also cannot be fixed the obvious way. Breaking `var-intact` means damaging
`/var` — XFS cannot shrink, so the only routes are `lvremove`, reformatting, or
unmounting a filesystem RHEL 9 holds busy. All of them risk a guest that does not
come back, which is the precise hazard the brief's own design decision 1 refuses,
and the harness cannot distinguish "correctly broken" from "unbootable".

So: **do not write a fourth anti-solution, and do not implement the union check
in `validateBank`.** `validateBank` never sees the emitted checkpoint ids — they
live inside `runFixture`'s verdict A — so enforcing it there means plumbing ids
out through `FixtureResult`, which is more surgery than this already-large task
should carry. Instead, record the gap where it is visible, in `grade.sh` beside
the checkpoint, in the same header style as `# baseline-fail:`:

```bash
# Knowingly unprobed: no anti-solution can break var-intact without risking a
# guest that does not boot. XFS cannot shrink, so damaging /var means lvremove,
# a reformat, or unmounting a filesystem RHEL 9 holds busy - and the harness
# cannot tell "correctly broken" from "unbootable" (see design decision 1).
# Replacing this ck_pass with an unconditional one would validate green across
# all six fixtures; that is the risk being accepted here, not overlooked.
# unprobed-invariant: var-intact
```

Nothing parses that header yet. It is a deadline, not decoration: writing it now
means every Phase 1 task already carries it when the check lands, instead of six
tasks needing retrofit. State in your report that enforcement is forwarded.

## 5. The test fixture's anti-solution has no body — and `DO_WRONG` is a trap

```ts
    { kind: 'antisolution', name: '01.sh', script: '# expect-fail: goal\n' },
```

Comment only, no command. It passes because `FakeTransport` sees a script
matching none of its markers, so `done` stays `false` and the grader reports
`fail` — the fixture validates green while executing nothing. That is the "empty
attack surface dressed as a real one" from parked finding 3, sitting in the test
that is supposed to demonstrate a healthy bank.

Give it a body:

```ts
    { kind: 'antisolution', name: '01.sh', script: '# expect-fail: goal\nWRONG' },
```

**Use `WRONG`, not `DO_WRONG` or `DONT`.** The fake matches with
`script.includes('DO')`, so any marker containing the substring `DO` sets
`done = true`, the grader returns `pass`, and the fixture fails its own
`expect-fail` declaration. I checked this against the brief's `deps()` helper
before writing the mandate. If you pick a different word, verify it contains
neither `DO`, `SETUP`, nor `GRADE`.

## 6. Two CLI items parked from Task 12's review

Both are small and both are in the file this task already modifies.

**`--content ""` is accepted.** `src/cli/index.ts:39-40` rejects a missing value
and a `--`-prefixed one, but `''.startsWith('--')` is `false`, so `root` becomes
the empty string and `loadBank('')` resolves against the process cwd. An empty
string is never a content root the user meant. Reject it in `parseCoverageArgs`
and in whatever parser you add for `validate`:

```ts
      if (value === undefined || value === '' || value.startsWith('--')) return undefined
```

Add a test asserting exit 2 and usage on `['coverage', '--content', '']`.

**The `--strict` test asserts only the exit code and stderr**
(`test/cli/*.test.ts:29-35`). A regression that stopped printing the report
entirely while still exiting 1 would pass it. Add the stdout assertion:

```ts
    expect(c.out.join('\n')).toMatch(/tasks: \d/)
```

`coverage` prints `tasks: ${bank.tasks.length}` at `src/cli/index.ts:73`, so this
matches today — I verified the line rather than guessing the format.

## 7. Use `fileURLToPath` in the new test file

`test/validate/run.test.ts` is new. `.pathname` is a URL path, not a filesystem
path — it percent-encodes, so a space in a parent directory yields a path that
does not exist. Seven existing test files use that idiom and are parked in the
ledger for a single sweep; do not make it eight, and **do not touch the seven**
(they belong to closed tasks). If your new file needs a path at all, write:

```ts
import { fileURLToPath } from 'node:url'
```

## 8. Two one-line legibility items

**Comment the `assertLib` concatenation site** in `loadTaskScripts` (parked
finding 5). `assertLib` is prepended before `grade.sh`, so `# baseline-fail:` is
parsed out of the combined string — an assertion library that ever contained that
literal would trip `more than one "# baseline-fail:" header`. Already ruled
acceptable because it fails loudly rather than silently; it just needs a comment
saying so at the site, so nobody has to rediscover it. Task 20's `assert.sh` does
not contain the literal today.

**Add one row to Step 12's troubleshooting table** (parked finding 4).
`readdir(...).catch(() => [])` in `loadTaskScripts` turns a misspelled
`solutions/` directory into the misleading `needs at least 2 solutions`. The
underlying code is a closed task's and degrades into an inventory-gate *failure*
rather than a pass, so it is legibility only — fix it in the table, not the code:

| `needs at least 2 solutions` when `solutions/` looks present | the directory name is misspelled; `readdir` failures are swallowed | check the spelling of `solutions/` and `antisolutions/` |

## Step 12 is deferred — and Task 22 does not wait for it

Step 12 runs the six-fixture matrix against the VM and says "Do not proceed to
Task 22 until this is 6/6." **The VM does not exist** — the RHEL 9 ISO is a
user-owned blocker. Ruling: mark Step 12 deferred, and Tasks 22-24 proceed on the
content conventions this task establishes. Blocking the remaining tasks on a
user-owned download would stop the run with three tasks of authorable work left
and buy nothing; the 6/6 gate becomes a documented acceptance the user runs on the
day the VM boots, alongside Task 19's Step 5 and Task 25.

In your report, list what each of the six fixtures will prove when it does run,
and state plainly that no fixture in this task has ever been executed. Everything
in mandates 1, 5, 6, 7 and Step 11 **is** runnable on this host — run all of it.

## Out of scope

- **No VM operations.** Do not start, stop, snapshot, revert, or delete a
  snapshot on any VM. The user's Ubuntu and Windows 11 guests are unrelated to
  this project.
- **No `sudo` on this WSL host** — there is no TTY and it cannot authenticate.
  The `sudo` calls in the solutions and anti-solutions are guest-side and correct.
- Do not add helpers to `content/lib/assert.sh`. Task 20's ten-helper scope note
  stands; mandate 1's guard is inline in `grade.sh`.
- Do not change `src/engine/grading/verdict.ts`, `grader.ts`, or
  `src/engine/content/*` beyond mandate 8's one comment. `harness.ts` changes are
  limited to mandates 2 and 3.
- Do not add an id to `content/objectives.yaml` or touch
  `content/objectives-rhel10.yaml`.
- **Never** read or copy `.env`, `.env.sandbox`, or `.env.example` from
  `/home/daxtangco/sechelp-tools` — an unrelated project's secrets. Do not create,
  read, or modify `.env.local`.
- Graders are **read-only**. Nothing in `grade.sh` may change the machine it
  measures — no `mount`, no `sed -i`, no `systemctl`.
- SELinux stays `enforcing`. No solution or anti-solution may weaken it.
- Do not dispatch subagents.

## Verify before committing

1. `bash -n` clean on `grade.sh`, `setup.sh`, both solutions and all three
   anti-solutions (Step 11). **`shellcheck` is not installed on this host** — do
   not install it or chase it; note in the report that these scripts have never
   been linted.
2. Step 11's declared-vs-emitted `comm -13` check, pasted. This is the one real
   check available without a VM.
3. Mandate 1's stub-`to_bytes` run, pasted — five `fail` lines, and the normal
   path unchanged.
4. Mandate 2's break-and-revert, with the observed failure described.
5. `node src/cli/index.ts coverage --content content` (Step 10) — paste it, and
   confirm no `problem:` line mentions `storage.lvm.resize`.
6. `npx vitest run` and `npm run typecheck` both clean. **Report the totals you
   observe**; read the baseline from `git log` and your own run rather than from
   any number in this file. Tasks 19 and 20 are landing around you.
7. `git status --porcelain` empty after committing. Concurrent agents may be
   working elsewhere in the tree — files outside this task's list are not yours:
   do not revert or commit them, just note them.

Report to `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-21-report.md`
as a real file, including every pasted run above, the observed totals, the
`shellcheck` note, the Step 12 deferral with what each fixture will prove, and an
explicit statement that no fixture has been executed against a real machine.

---

## Addendum — mandate 1 verified against the real `to_bytes`

These mandates were written before `content/lib/assert.sh` existed on disk.
Task 20 landed it at `c1b3b01`, so mandate 1's construction is now checkable
rather than assumed. I read the real function and it holds in all three failure
modes:

```bash
TARGET=$(to_bytes 12G) || TARGET=
```

- **Unparseable argument** — `to_bytes` prints `to_bytes: cannot parse %s` to
  stderr and `return 1` (`content/lib/assert.sh:80-83`), so the `||` fires and
  `TARGET` is empty.
- **`assert.sh` not prepended** — `to_bytes` is not a function, the command
  substitution exits 127, the `||` fires, `TARGET` is empty. This is the case the
  mandate's error message calls out and it behaves as the message claims.
- **`awk` missing** — line 94, `awk -v n="$num" -v m="$mult" 'BEGIN { printf
  "%d\n", n * m }'`, is the **last** command in the function, so its status is the
  function's. 127 propagates, the `||` fires, `TARGET` is empty.

So the `[[ -z $TARGET || -z $VAR_MIN ]]` guard catches all three, and the
`ck_fail` detail string the mandate specifies ("`assert.sh` may not have been
prepended or `awk` is missing") is accurate rather than speculative. Empty
assignment is also safe under `grade.sh`'s `set -uo pipefail`, since `TARGET=`
defines the variable.

Do not re-derive this. If you change the guard's shape, re-measure it.
