# Task 21 fix round 1 — F1 and F2

Fixing the two must-fix findings from `task-21-review.md` before Task 22
clones `content/tasks/storage/014-grow-home-lv/`'s shape. No VM exists and
`scripts/provision.sh` was not run; every check below is static
(`bash -n`, `grep`, `npx vitest run`, `npm run typecheck`).

## F2 — duplicated `# baseline-fail:` prose removed from `grade.sh`

`grade.sh:4-9` (as committed in `8513019`) carried mandate 8's legibility
paragraph a second time, quoting the literal `"# baseline-fail:"` mid-line —
in the one file whose comment headers `parseExpectations` actually parses.
The review measured that an ordinary reflow moving that literal to line-start
would make the task fail to load with `more than one "# baseline-fail:"
header found`.

Change: deleted the duplicated paragraph (the five lines between the
`READ-ONLY...` line and the `# Checkpoints that must fail...` line). The
canonical copy already lives at `src/engine/validate/harness.ts:60-64`
(review cites `content/harness.ts`; the real path is
`src/engine/validate/harness.ts` — same file, just a path typo in the review
doc), at the concatenation site where the literal is inert. That copy was not
touched.

`grade.sh` now reads:

```
#!/usr/bin/env bash
# Grader for storage/014-grow-home-lv.
#
# READ-ONLY. Changes nothing. Exit code is ignored; only the JSONL matters.
# assert.sh is prepended by loadTaskScripts (see harness.ts's loadTaskScripts),
# so its helpers are already here.
#
# Checkpoints that must fail before the student does anything. Everything not
# listed is an invariant and must PASS from the start.
# baseline-fail: lv-home-size, fs-home-size
```

Verified exactly one line now matches `/^#\s*baseline-fail:/m`:

```
$ grep -cE '^#\s*baseline-fail:' content/tasks/storage/014-grow-home-lv/grade.sh
1
$ grep -nE '^#\s*baseline-fail:' content/tasks/storage/014-grow-home-lv/grade.sh
10:# baseline-fail: lv-home-size, fs-home-size
```

## F1 — missing size precondition in `setup.sh`, and relative resize in solution 02

### Edit 1 — `solutions/02-lvextend-r-by-uuid.sh:7`

Changed `sudo lvextend -r -L +4G /dev/mapper/rhel-home` to
`sudo lvextend -r -L 12G /dev/mapper/rhel-home`. The relative `+4G` only
reaches the 12 GiB goal when `/home` starts at exactly 8 GiB (per
`docs/vm-build-checklist.md:74`); it was not one of solution 02's two
intended differences from solution 01 (`-r`, and the UUID fstab entry), so
there was no reason for it to be relative. `-r` and the UUID rewrite are
unchanged. No comment in the file referenced the `+4G` value, so nothing
else needed updating.

### Edit 2 — `setup.sh` new precondition

Added a check, after the existing "`/home` must be its own LV" case block
and before the VG-free-space check, that fails setup if `rhel/home` is
already 11.5 GiB or larger:

```bash
# lv-home-size and fs-home-size both grade "/home reached 12 GiB", so the one
# precondition they actually depend on is /home's *starting* size, not just
# that it is its own LV. docs/vm-build-checklist.md:74 specifies an 8 GB LV;
# if the guest was built at or near 12 GiB already, the checkpoints would
# pass with no action taken - a student-facing false pass, not a solved task.
# Threshold is 11.5 GiB, not 12 GiB: fs-home-size accepts within_pct(..., 2),
# a +-2% tolerance on the 12 GiB target, so a /home already at 11.76 GiB would
# satisfy that checkpoint at baseline. 11.5 GiB sits safely under that margin.
home_lv_bytes=$(sudo lvs --noheadings --nosuffix --units b -o lv_size rhel/home 2>/dev/null | tr -d ' ')
[[ -n $home_lv_bytes ]] || fail "could not read the size of the rhel/home logical volume"
if (( home_lv_bytes >= 12348030976 )); then
  fail "rhel/home is already ${home_lv_bytes} bytes (>= 11.5 GiB); docs/vm-build-checklist.md:74 specifies an 8 GB LV, so this guest was built wrong"
fi
```

`12348030976` = 11.5 * 1024^3, computed and hard-coded (setup.sh does not
source `content/lib/assert.sh`, which is a grade.sh-only library per its own
header comment, so `to_bytes` was not available; the raw-command style
matches the existing `free_extents=$(sudo vgs ... | tr -d ' ')` line
immediately below it rather than introducing a new helper-calling idiom).
The failure message names `docs/vm-build-checklist.md:74` per the
instruction. `sudo` usage, the `fail()` helper, and the message shape
(`"<subject> is <value>; <reference>"`) match the existing block.

### Edit 3 — convention comment

Added two lines above the precondition block's existing comment, stating the
generalisable rule for Tasks 22-24:

```bash
# --- preconditions ---------------------------------------------------------
# These are guarantees from docs/vm-build-checklist.md. If any is missing the
# task is unsolvable, and a checkpoint failure would be misleading.
#
# Convention for every task that clones this file: verify every precondition
# the goal checkpoints depend on, not only the ones needed for this script to
# run. A precondition that only guards the script leaves the checkpoints free
# to pass or fail for reasons that have nothing to do with the student.
```

## Verification

**1. `bash -n` on every touched script:**

```
$ bash -n content/tasks/storage/014-grow-home-lv/grade.sh && echo "grade.sh OK"
grade.sh OK
$ bash -n content/tasks/storage/014-grow-home-lv/setup.sh && echo "setup.sh OK"
setup.sh OK
$ bash -n content/tasks/storage/014-grow-home-lv/solutions/02-lvextend-r-by-uuid.sh && echo "solution02 OK"
solution02 OK
```

**2. `npx vitest run` — must stay 246/23:**

```
 Test Files  23 passed (23)
      Tests  246 passed (246)
   Start at  15:21:02
   Duration  911ms (transform 773ms, setup 0ms, collect 1.88s, tests 1.13s, environment 3ms, prepare 1.77s)
```

Unchanged from the review's baseline (246 passing / 23 files).

**3. `npm run typecheck`:**

```
> rhcsa-trainer@0.1.0 typecheck
> tsc --noEmit
```

Exit 0, no output. Clean. (No `.ts` files were touched by this fix round —
only three shell scripts — so this was expected to be a no-op; ran it anyway
per the instructions.)

**4. Emitted-vs-declared checkpoint ids after the `grade.sh` edit:**

```
$ grep -oE "ck_(pass|fail|skip) [a-z0-9-]+" content/tasks/storage/014-grow-home-lv/grade.sh | awk '{print $2}' | sort -u
fs-home-size
home-from-lv
lv-home-size
persist-config
var-intact
```

Exactly the five ids named in the task: `fs-home-size`, `home-from-lv`,
`lv-home-size`, `persist-config`, `var-intact`. Also re-ran the raw hit count
the review used (`grep -nE 'ck_(pass|fail|skip)' grade.sh | wc -l`): still
17, matching the review's F7 note that all 17 hits are real calls with no
stray comment-prose matches — the F2 deletion did not introduce or remove any
such collision.

**5. `# baseline-fail:` header count:**

```
$ grep -cE '^#\s*baseline-fail:' content/tasks/storage/014-grow-home-lv/grade.sh
1
```

Exactly one, as required.

## What was not verified, and why

- **No guest-side execution.** No VM exists, the RHEL 9 ISO is not
  downloaded, and `scripts/provision.sh` was not run (per the task's
  constraints). The new `setup.sh` precondition (`sudo lvs ... rhel/home`),
  the corrected `lvextend -r -L 12G`, and the six-fixture walkthrough in the
  review were not re-run against real LVM. Static checks only:
  `bash -n`, `grep`, and reading the code against `content/lib/assert.sh`'s
  actual function signatures (confirmed `lv_size_bytes`, `to_bytes`,
  `within_pct` exist as the review and this fix both assume).
- **Byte-math for the 11.5 GiB threshold** (`12348030976`) was checked by
  hand (`11.5 * 1024^3`), not by running `to_bytes 11.5G` on a live shell
  with `assert.sh` sourced, since `setup.sh` doesn't source that library.

## Files changed

- `content/tasks/storage/014-grow-home-lv/grade.sh`
- `content/tasks/storage/014-grow-home-lv/setup.sh`
- `content/tasks/storage/014-grow-home-lv/solutions/02-lvextend-r-by-uuid.sh`
