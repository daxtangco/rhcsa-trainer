# Task 20 — reviewer context

Read `task-20-brief.md` and `task-20-mandates.md` first. **The mandates override
the brief wherever they conflict** — four numbered required changes. Spec
compliance means compliance with the mandates, not with the brief's original
code. Then read `task-20-report.md` and the diff at
`review-ad8c0f2..c1b3b01.diff` (commit `c1b3b01`, "feat(content): grader helper
library" — `content/lib/assert.sh` + `test/lib/assert.test.ts`, 400 lines added).

## Two verdicts are required

Neither is optional and neither substitutes for the other:

1. **Spec compliance** — each of the four mandates: satisfied, or not, with
   evidence. Name the file and line you checked.
2. **Task quality** — judge this as the person who has to debug why a grader
   reported a checkpoint they know they satisfied. This library is the substrate
   every grader in the project sits on; a bug here is a bug in all 28 tasks at
   once, and it will look like a bug in the task.

## Mandate 1 is the load-bearing one — check it first

`_json_escape` escaped only tab, CR and LF, so any other C0 control byte
(`0x01`-`0x1f`) landed raw inside a JSON string literal. A raw control character
makes the line invalid JSON, and `src/engine/grading/verdict.ts:41-58` files an
unparseable line under `noise` — **the checkpoint does not become a failure, it
disappears entirely.** Since `allPassed` is
`v.checkpoints.length > 0 && v.checkpoints.every(cp => cp.status === 'pass')`
(`verdict.ts:80-82`), a vanished failing checkpoint can turn a run green. The
realistic trigger is ordinary: any command whose output carries an ANSI escape —
`systemctl`, `lvs`, `ls` — interpolated into a `ck_fail` detail string.

The implementer reports a break-and-revert that produced exactly this shape:
removing the escaping block left `v.noise` holding one line and `v.checkpoints`
empty, with the raw ESC and bell bytes present — not a crash, not a
`status: 'fail'`. **Reproduce it rather than trusting it.** Then satisfy yourself
the fix is complete rather than just sufficient for the test: check what happens
to `0x7f` (DEL) and to a literal backslash or double quote arriving in the same
string, and confirm the `\uXXXX` escapes it emits are the four-hex-digit form
JSON requires.

## Mandates 2 and 3 — same function, opposite failure directions

Both live in `is_persistent`, and they fail in opposite directions, which is the
thing to hold in mind while reading:

- **Mandate 2** — the fstab branch accepted `noauto` in field 4. `noauto` means
  "do not mount at boot", so the check passed for a mount that will not exist
  after a reboot. That is a **false pass on the exact property verdict B exists
  to measure.** The fix must reject `noauto` and must **not** reject `nofail`,
  which is a different option that does still mount at boot. Confirm both arms;
  a fix that rejects any field-4 substring starting `no` would pass a
  `noauto`-rejection test while breaking legitimate answers.
- **Mandate 3** — the systemd-unit branch interpolated the mount point into an
  extended regex, so a mount path containing a regex metacharacter matched the
  wrong thing or nothing. The fix compares `Where=` literally via `awk`.
  Check it against a path with a `.` in it (`.` matching any character is the
  quiet version of this bug) and confirm the comparison is anchored — a
  substring match would make `/var` satisfy `/var/log` or vice versa.

Mandates 2 and 3 are both *inversions* of the recurring defect in this project:
a check that passes for the wrong reason. Verify the fixes did not merely move
the wrong reason.

## Do not re-raise these — I measured them as NOT defects

Spending a finding on any of these is a false positive; they were measured during
the pre-flight, not assumed:

- **`to_bytes` is correct on all twelve cases in the brief's table, including
  `1T`.** I specifically expected `awk`'s `printf "%d"` to overflow past 2³¹ and
  **it does not** — this host runs GNU Awk 5.3.2 and returned `1099511627776` for
  `1T`, `562949953421312` for `512T`, `1610612736` for `1.5G`, `4294967296` for
  `4.00g`, all exact. **My overflow suspicion was wrong.** Leave `to_bytes`
  exactly as written. If you disagree, measure it and paste the command.
- `to_bytes 'banana'` exits 1 and prints to stderr, so the brief's
  `rejects.toThrow()` test is genuine.
- `allPassed` really does treat `skip` as not-passed; the brief's comment saying
  so is accurate (`verdict.ts:80-82`).
- All five of the brief's original `is_persistent` cases pass with the brief's
  own implementation, including the commented-out fstab line and the
  "`/var/log` does not satisfy `/var`" case. **The bugs in mandates 2 and 3 are
  in cases the brief does not test** — so "the existing tests pass" is not
  evidence about them.

## Environmental caveat — note it, don't bill it as a defect

These tests run `awk` and bash on the **WSL host**; a real grader runs the same
code in the **RHEL 9 guest**. Both are GNU awk, so the arithmetic above carries
over, but this suite does not prove that. The report notes it. One sentence in
your review is right; a finding is not.

`lv_size_bytes` and `mount_source` are untested here and that is correct — they
need real LVM and a real mount, deferred to Task 21's VM fixture matrix. Do not
treat their absence from the test file as a coverage gap.

## Out of bounds

- **No `sudo` on this WSL host** — there is no TTY and it cannot authenticate.
  Any `sudo` inside `assert.sh` is guest-side and correct.
- **No VM operations of any kind**, on this project's VM or the user's unrelated
  Ubuntu and Windows 11 guests. No start, stop, snapshot, revert, or delete.
- **Do not create, read, or modify `/home/daxtangco/rhcsa-trainer/.env.local`.**
  It may hold the user's real VM password.
- **Never read or copy** `.env`, `.env.sandbox`, or `.env.example` from
  `/home/daxtangco/sechelp-tools` — an unrelated project's secrets.
- **`shellcheck` is not installed** and three tasks have now confirmed it
  unavailable. Do not install it, do not chase it. "This file has never been
  linted" is already recorded — do not spend a finding on it.
- Do not add a helper beyond the brief's ten. `assert.sh` is deliberately only
  what Phase 1 needs.
- `src/` is out of scope for this task and was correctly left alone.
- **`scripts/provision.sh` is being edited concurrently** by a one-line fix to
  Task 19 (quoting a template value). It is not this task's leakage — do not
  revert it, do not commit it, and judge only the diff you were given.

## Baseline

`ad8c0f2` was **203 passing / 20 files**. Task 20 adds `test/lib/assert.test.ts`
with 30 tests, so the expected total is **233 passing / 21 files** — which is
what both the implementer and Task 19's reviewer independently measured. Run
`npx vitest run` and `npm run typecheck` yourself and **report the totals you
observe.** If they differ, that discrepancy is itself the finding. Check the
30 against the mandates' own arithmetic: 6 emitter + 12 `to_bytes` + 3
`within_pct` + 5 `is_persistent` from the brief, plus 4 from the mandates
(control-character escaping, `noauto` rejection, `nofail` still passes, regex
metacharacter mismatch).

Mutation testing on a scratch copy is the technique that has worked best on this
branch. Task 18's reviewer copied the tree to `/tmp` with `node_modules`
symlinked back and mutated there, which needs no write access to the repo and
leaves `git status --porcelain` empty — worth repeating here, and it composes with
the concurrent Task 19 fix.

## Report

Write the full review to
`.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-20-review.md` and
return only: both verdicts, the findings ranked by severity, whether anything
blocks, and the totals you measured. Mark each finding **must-fix**,
**observation**, or **forward-to-later**.
