# Task 21 — reviewer context

Read in this order: `task-21-brief.md`, then `task-21-mandates.md` (**eight
mandates plus an addendum; they override the brief wherever they conflict** —
spec compliance means compliance with the mandates, not with the brief's
original code), then `task-21-report.md`, then the review package diff you were
given.

## Two verdicts are required

Neither is optional and neither substitutes for the other:

1. **Spec compliance** — each of the eight mandates: satisfied, or not, with
   evidence. Name the file and line you checked.
2. **Task quality** — judge this as **the user sitting the lab at 9pm**, and as
   **the author of Tasks 22-24 copying these conventions**. This task authors
   the project's first real lab content. Twenty-seven more tasks will be written
   by imitating the shape of `content/tasks/storage/014-grow-home-lv/`, so a
   convention that is subtly wrong here is wrong twenty-eight times, and it will
   look like a bug in each individual task rather than in this one.

## Mandate 1 is the load-bearing one — check it first, and reproduce it

`to_bytes` failing leaves `TARGET` as the empty string, and **`[[ 5 -ge "" ]]`
returns 0** — bash treats an empty operand as zero and the comparison *passes*,
quoted or unquoted. I measured this. So a grader that could not compute its own
size targets emitted `ck_pass` on both goal checkpoints and told the student
they got it right. This is the project's signature defect (a check that passes
for the wrong reason) in its purest form, and worse than Task 20's, because
there the checkpoint vanished and here it actively asserts success.

The implementer was told to paste a stub-`to_bytes` run. **Reproduce it rather
than trusting it**, and then check four things the mandate does not spell out:

- **The five `ck_fail` ids in the guard must be exactly the ids `grade.sh` emits
  on its normal path, spelled identically, and must be the complete set.** A
  typo produces an id the harness reports as unknown; an omission means one
  checkpoint silently disappears from the failure verdict, and `allPassed` only
  needs `length > 0` plus all-pass, so a partial verdict has its own hazard.
  Diff the guard's id list against every `ck`/`ck_pass`/`ck_fail`/`ck_skip` id in
  the file.
- **The guard's `exit 0` must not make the run look successful.** Confirm for
  yourself how the grading path treats a grader's exit status versus its emitted
  checkpoints — five `"status":"fail"` lines must produce `allPassed: false`
  regardless of the `0`.
- **The normal path must be unchanged.** `TARGET=$(to_bytes 12G) || TARGET=`
  under `set -uo pipefail` — confirm the success case still assigns the real
  byte count and that `HOME_LV_MIN=$TARGET` is still ordered after it.
- **Three failure modes, not one.** The addendum verifies all three against the
  real `content/lib/assert.sh`: unparseable argument → `return 1`
  (`assert.sh:80-83`); library not prepended → 127; `awk` missing → 127, because
  line 94 is the function's last command so its status is the function's. If the
  implementer changed the guard's shape, all three need re-measuring, not just
  the stub.

## Mandates 2 and 3 — harness changes, and both need mutation testing

Both add a failure the harness previously swallowed. For each, the question is
not "is there a test" but "does the test fail when the check is removed":

- **Mandate 2** — `fixture.script`'s exit code was discarded while `setup.sh`
  twelve lines above got the opposite treatment with the reasoning spelled out.
  Check the new check covers **both** fixture kinds, and that the existing
  `test/validate/harness.test.ts` fixtures still pass. If the implementer
  loosened the check to accommodate an existing fixture that exits non-zero,
  that is a finding — the mandate told them to report and stop instead.
- **Mandate 3** — the skipped-verdict-B branch was guarded on
  `kind === 'solution'`, so an anti-solution with zero passes in verdict A had
  every `@post` id go unverified and unreported. Confirm the new `else if` keys
  on `declared.some(d => d.phase === 'post')` and that the message names the
  ids. **None of this task's three anti-solutions trips it** — it is a general
  harness hole — so the test is the only thing proving it works.

Mutation testing on a scratch copy is the technique that has worked best on this
branch: copy the tree to `/tmp` with `node_modules` symlinked back and mutate
there. It needs no write access to the repo and leaves `git status --porcelain`
empty.

## Mandate 2 has a trap in the opposite direction — do not "fix" `03`

`antisolutions/03-wrong-lv.sh` declares `# expect-fail: lv-home-size,
fs-home-size`, **byte-for-byte the same set as `grade.sh`'s `# baseline-fail:`**.
That is deliberate and correct, not a defect. `03` creates a genuinely different
machine (root grew, VG free space consumed) and would catch a grader that
measured "did the VG shrink" instead of `rhel/home` specifically. The parked rule
"reject an anti-solution declaring exactly the baseline" was written from the
harness's side before any content existed to test it against, and the content
disproves its strict form — it would reject a real detector. The actual risk was
that `03` silently never runs, which is what mandate 2's exit-code check closes.
Do not recommend reinstating the content rule, and do not recommend changing
`03`'s declaration.

## Mandate 4 — the header is deliberately unparsed

`# unprobed-invariant: var-intact` is a comment nothing reads yet. **That is not
a dead-code defect** — enforcement is explicitly forwarded, because
`validateBank` never sees emitted checkpoint ids (they live inside `runFixture`'s
verdict A), so enforcing the coverage union there means plumbing ids out through
`FixtureResult`, which is more surgery than this task carries. Writing the header
now means every Phase 1 task already has it when the check lands, instead of six
tasks needing retrofit.

What *is* worth checking: that the accompanying comment states the real reason
(XFS cannot shrink, so breaking `/var` means `lvremove`, a reformat, or
unmounting a filesystem RHEL 9 holds busy — and the harness cannot tell
"correctly broken" from "unbootable"), and that it says plainly that replacing
`ck_pass var-intact` with an unconditional `ck_pass` would validate green across
all six fixtures. The point of the comment is that a future reader knows the gap
was accepted, not overlooked. **Do not ask for a fourth anti-solution** — it
risks a guest that does not come back, which is exactly what the brief's design
decision 1 refuses.

## Mandate 5 — verify the marker, do not eyeball it

The fixture body must be `WRONG`. `FakeTransport` matches with
`script.includes('DO')`, so `DO_WRONG` or `DONT` would set `done = true`, the
grader would return `pass`, and the fixture would fail its own `expect-fail`
declaration — a test passing for the wrong reason, again. If the implementer
chose a different word, check it contains none of `DO`, `SETUP`, `GRADE`.

## Content-quality lens for the grader itself

The grader contract, all four parts, on `grade.sh` specifically:

- **Grades end state, not commands.** Any check that infers *how* the student
  did something rather than *what is true now* is a finding.
- **Read-only.** No `mount`, no `sed -i`, no `systemctl`, nothing that changes
  the machine it measures.
- **Idempotent.** Running it twice must produce the same verdict.
- **Never reads shell history.**

Also: **every `ck` id must be a literal** — never a variable, never
interpolated, no loop generating ids. A later task derives the masked checkpoint
total by static inspection, and a wrong total is worse than none. And
`# baseline-fail:` must list exactly the goal checkpoints; an invariant like
`var-intact` must be **absent** from it, because the `kind: 'none'` baseline
fixture asserts that everything not listed **passes** at baseline
(`harness.ts:208-228`).

## Do not re-raise these — I measured them as NOT defects

Spending a finding on any of these is a false positive:

- **`storage.lvm.resize` exists**, at `content/objectives.yaml:135`. Step 10's
  warning about an unknown objective does not fire. No id should have been added
  to `objectives.yaml`.
- **The RHEL 9-vs-10 taxonomy decision does not block this task.**
  `storage.lvm.resize` is the same id in both `objectives.yaml` (135) and
  `objectives-rhel10.yaml` (182), so authoring against `rhel: 9` forecloses
  nothing. Not a blocker; do not raise it as one.
- **The test fixture's `TaskSpec` shape is correct.** I checked all seventeen
  fields in `src/engine/content/task.ts:22-40` against the brief's `task()`
  helper — every field present and correctly typed.
- **Parked finding 6 is already implemented** at `harness.ts:252-255` (an id in
  verdict B that A never emitted is reported as "appeared only after the
  reboot"). If the implementer re-implemented it, *that* is the finding.
- **`# baseline-fail:` and `# expect-fail:` ids are already cross-checked
  against what the grader emits**, via `checkEmittedIds` in both the `none` and
  `antisolution` branches. Step 11's `comm -13` shell check is belt-and-braces
  and is kept on purpose — it is the only half that runs without a VM.
- **`coverage` really does print `tasks: N` on stdout** (`src/cli/index.ts:73`),
  so mandate 6's new stdout assertion is valid as written.

If you disagree with any of these, measure it and paste the command. Seven times
in this project I have handed an implementer a confident measurement; once it was
wrong, and twice a verification instruction I wrote was impossible as stated. **If
your measurement disagrees with mine, yours wins.**

## Step 12 is deferred — one sentence, not a finding

Step 12 runs the six-fixture matrix against the VM and says "do not proceed to
Task 22 until this is 6/6." **The VM does not exist** — the RHEL 9 ISO is a
user-owned blocker. Ruling already made: Step 12 is a documented acceptance the
user runs on the day the VM boots, alongside Task 19's Step 5 and Task 25, and
Tasks 22-24 proceed on the conventions this task establishes. So **no fixture in
this task has ever been executed against a real machine**, and neither
`lv_size_bytes` nor `mount_source` has ever run against real LVM or a real
mount. Note it; do not bill it.

Everything in mandates 1, 5, 6, 7 and Step 11 **is** runnable on this host. If
the report does not paste those runs, that is a finding.

## Out of bounds

- **No VM operations of any kind** — no start, stop, snapshot, revert, or
  delete, on this project's VM or on the user's unrelated Ubuntu and Windows 11
  guests.
- **No `sudo` on this WSL host** — there is no TTY and it cannot authenticate.
  The `sudo` calls inside the solutions and anti-solutions are guest-side and
  correct.
- **Do not run `scripts/provision.sh`** — it powers on a VM and copies 10 GB.
- **Do not create, read, or modify `/home/daxtangco/rhcsa-trainer/.env.local`.**
  It may hold the user's real VM password.
- **Do not run `ssh-keygen` or write anything into `/home/daxtangco/.ssh/`.**
  `provision.sh` resolves `RHCSA_SSH_KEY` against the real `$HOME`, not a
  scratch tree — Task 19's reviewer wrote a real keypair there by accident. It
  was deleted and the directory verified empty; do not repeat it.
- **Never read or copy** `.env`, `.env.sandbox`, or `.env.example` from
  `/home/daxtangco/sechelp-tools` — an unrelated project's real secrets.
- **`shellcheck` is not installed** and four tasks have confirmed it. Do not
  install it, do not chase it. "These scripts have never been linted" is already
  recorded — do not spend a finding on it.
- **SELinux stays `enforcing`.** No solution or anti-solution may weaken it.
- The seven test files using the `new URL(...).pathname` idiom are parked for a
  single sweep and belong to closed tasks. Mandate 7 only requires the **new**
  file to use `fileURLToPath`; do not ask for the seven.
- `src/engine/grading/verdict.ts`, `grader.ts`, and `src/engine/content/*`
  (beyond mandate 8's one comment) are out of scope and should be untouched.
- Do not add a helper to `content/lib/assert.sh` — Task 20's ten-helper scope
  note stands and that file is closed. Mandate 1's guard is inline in `grade.sh`.

## Baseline

`17b8cd4` was **233 passing / 21 files**, `npm run typecheck` clean, tree clean.
This task adds tests, so the total must go **up**. Run `npx vitest run` and
`npm run typecheck` yourself and **report the totals you observe** — if they
differ from the report's, that discrepancy is itself the finding.

Concurrent work: a read-only verification pass is looking at
`scripts/provision.sh` (Tasks 19's fix) and will not edit anything. Files
outside this task's list are not this task's leakage — do not revert them, do
not commit them, just note them.

## Report

Write the full review to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-21-review.md` and
return only: both verdicts, the findings ranked by severity, whether anything
blocks, and the totals you measured. Mark each finding **must-fix**,
**observation**, or **forward-to-later**.
