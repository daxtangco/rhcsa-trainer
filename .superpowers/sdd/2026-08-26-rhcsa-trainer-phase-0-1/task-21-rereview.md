# Task 21 fix re-review — F1 and F2 (scoped)

Range: `8513019..aae2dca` (commit `aae2dca`, fix diff
`review-8513019..aae2dca.diff`). Scoped to F1 and F2 only, per the task-21
review (`task-21-review.md`) and the fixer's report (`task-21-fix-1-report.md`).
Read-only: no file in the repo was edited. All verification below is against
the tree as committed; any mutation testing used a `/tmp` scratch copy that
has since been removed. `git status --porcelain` was empty before this review
and is empty now.

## F2 — CLOSED

**Claim:** the duplicated `# baseline-fail:` prose paragraph is gone from
`grade.sh`, and `harness.ts:60-64` remains the sole carrier of that legibility
comment.

Verified directly against `content/tasks/storage/014-grow-home-lv/grade.sh` as
committed:

- Exactly one line in the file matches `/^#\s*baseline-fail:/m`:
  `grade.sh:10` — `# baseline-fail: lv-home-size, fs-home-size`.
- The literal string `# baseline-fail:` occurs nowhere else in the file
  (`grep -n 'baseline-fail'` returns only that one line).
- `harness.ts:60,64` still carry the canonical comment
  (`// assertLib is prepended before grade.sh's own text, so `# baseline-fail:`
  ... content/lib/assert.sh does not contain it today.`), untouched by the fix.

I did not stop at eyeballing. I built the exact string
`loadTaskScripts` constructs — `` `${assertLib}\n${gradeBody}` `` — by reading
`content/lib/assert.sh` and the current `grade.sh`, and ran the real
`parseExpectations(combined, where, 'baseline-fail')` from
`src/engine/validate/expectations.ts` against it (Node 22.23, native `.ts`
import via `--experimental-strip-types`, no compiled fixture, no hand
transcription of the parser's regex). Result:

```
parsed declared: [{"id":"lv-home-size","phase":"both"},{"id":"fs-home-size","phase":"both"}]
emitted ids (raw grep-style): ["fs-home-size","home-from-lv","lv-home-size","persist-config","var-intact"]
```

- Declared (`# baseline-fail:`) = exactly `lv-home-size, fs-home-size`, the
  two goal checkpoints — unchanged from before the fix, matches the review.
- Emitted = exactly the five ids `fs-home-size`, `home-from-lv`,
  `lv-home-size`, `persist-config`, `var-intact` — unchanged.
- `var-intact` is confirmed absent from the declared set. This is required:
  the `kind: 'none'` baseline fixture treats every undeclared id as expected
  to pass, and `var-intact` is the invariant that must pass unconditionally
  from the start.
- `content/lib/assert.sh` still does not contain the literal `# baseline-fail:`
  (confirmed by direct read), so the concatenation-order risk `harness.ts`'s
  comment describes remains theoretical, as designed.

The one thing the deleted paragraph said that the `harness.ts` copy still
needs to say — that an assertion library ever containing the literal would
trip the "more than one header" guard, and that this fails loudly rather than
silently — is present verbatim at `harness.ts:60-64`. Nothing load-bearing was
lost; only the duplicate copy (the one sitting in the parsed file) was removed.

**F2 is closed.** The tripwire the review found (an ordinary reflow of the
`grade.sh` prose moving the literal to line-start, breaking task load with a
`ContentError`) no longer exists, because the prose is gone from `grade.sh`
entirely.

## F1 — CLOSED

Three edits were required; all three are present and correct.

**1. Solution 02 uses an absolute resize.**
`solutions/02-lvextend-r-by-uuid.sh:7` reads `sudo lvextend -r -L 12G
/dev/mapper/rhel-home` (was `-L +4G`). `-r` and the UUID-based fstab rewrite
(`blkid` → `sed -i` delete old `/home` line → `tee -a` new `UUID=` line →
`systemctl daemon-reload`) are byte-for-byte unchanged from before the fix.
The file's header comment (lines 2-5) states the file's two intended
differences from solution 01 as "-r resizes the filesystem... the fstab entry
is re-expressed by UUID" — no comment anywhere in the file references `+4G`
or a relative form, so nothing was left stale.

**2. `setup.sh` gained the missing precondition, with correct arithmetic.**
New block at `setup.sh:24-36`, between the existing "/home must be its own
LV" case block and the pre-existing VG-free-space check:

```bash
home_lv_bytes=$(sudo lvs --noheadings --nosuffix --units b -o lv_size rhel/home 2>/dev/null | tr -d ' ')
[[ -n $home_lv_bytes ]] || fail "could not read the size of the rhel/home logical volume"
if (( home_lv_bytes >= 12348030976 )); then
  fail "rhel/home is already ${home_lv_bytes} bytes (>= 11.5 GiB); docs/vm-build-checklist.md:74 specifies an 8 GB LV, so this guest was built wrong"
fi
```

I computed the arithmetic independently rather than trusting the fixer's
report:

- `11.5 * 1024^3 = 12348030976` exactly. Matches the hardcoded literal.
- `fs-home-size`'s tolerance: `TARGET = to_bytes(12G) = 12,884,901,888` bytes
  (`grade.sh:12`), and `fs-home-size` accepts if `within_pct(fs_bytes, TARGET,
  2)` (`grade.sh:57`), i.e. `|actual - TARGET| <= TARGET * 2/100 =
  257,698,037.76` bytes (`assert.sh:101-108`, confirmed the formula from the
  actual function body, not from the fixer's paraphrase).
- That makes the pass boundary `TARGET - tolerance = 12,627,203,850.24` bytes
  = **11.76 GiB**, i.e. `/home` already at or above 11.76 GiB would satisfy
  `fs-home-size` at baseline with zero student action — exactly the
  false-pass shape F1 describes.
- `11.5 GiB (12,348,030,976 bytes) < 11.76 GiB (12,627,203,850.24 bytes)` —
  confirmed, with roughly 0.26 GiB of margin. So the chosen 11.5 GiB threshold
  sits safely on the correct side of the danger line, exactly as the code
  comment (`setup.sh:29-31`) and the fix report claim. The arithmetic is
  correct, independently verified, not just copied from the report.

**3. The convention comment for Tasks 22-24 is present.**
`setup.sh:14-17`, immediately above the existing "These are guarantees from
docs/vm-build-checklist.md" comment: "Convention for every task that clones
this file: verify every precondition the goal checkpoints depend on, not only
the ones needed for this script to run. A precondition that only guards the
script leaves the checkpoints free to pass or fail for reasons that have
nothing to do with the student." This states the generalisable rule the
review asked to have captured before Task 22 clones the directory.

**F1 is closed.** All three sub-fixes are in place and each checks out
independently.

## The `(( ))` fractional-value question — my independent judgement

**Is the new code consistent with the pre-existing convention?** Yes,
exactly. Three sites now share the identical pattern — same flags, same
post-processing, same comparison operator:

- `setup.sh`'s pre-existing `vgs` check: `sudo vgs --noheadings --nosuffix
  --units b -o vg_free rhel 2>/dev/null | tr -d ' '`, then `(( free_extents <
  5 * 1024 * 1024 * 1024 ))`.
- `setup.sh`'s new `lvs` check (this fix): `sudo lvs --noheadings --nosuffix
  --units b -o lv_size rhel/home 2>/dev/null | tr -d ' '`, then
  `(( home_lv_bytes >= 12348030976 ))`.
- `content/lib/assert.sh`'s pre-existing `lv_size_bytes()` helper
  (`assert.sh:113-118`), used by `grade.sh` itself (`grade.sh:31`,
  `grade.sh:84`): `sudo lvs --noheadings --nosuffix --units b -o lv_size
  "$vg/$lv" 2>/dev/null | tr -d ' '` — same flags again, though `grade.sh`
  then compares with `[[ ${lv_bytes:-0} -ge $HOME_LV_MIN ]]` (a `[[ ]]`
  arithmetic test, not `(( ))` — a different bash construct, but one that
  fails the same way: `[[ -ge ]]` throws `integer expression expected` on a
  non-integer operand, just as `(( ))` throws a syntax error).

So the new precondition is not a new pattern; it is the third call site in
this task alone using `lvs --units b --nosuffix` feeding a bash integer
comparison, and the grader itself (`grade.sh`) already depends on the same
assumption for its `lv-home-size` and `var-intact` checkpoints via
`lv_size_bytes`. If LVM's `--units b --nosuffix` output can ever be
fractional, that risk was already live in this task before this fix touched
anything, in at least two other places.

**Is this a shared pre-existing risk to forward, or a new defect?** A
shared pre-existing risk to forward, not a new defect. The new code did not
invent the pattern or introduce a new failure mode; it replicated an
established, already-relied-upon convention (`vgs` right below it in the same
file, and `assert.sh`'s `lv_size_bytes` used throughout `grade.sh`). Holding
the new line to a stricter standard than the code it sits next to and the
library the grader already depends on would be inconsistent. If this is a
real fragility, it is a pre-existing one that belongs on the "forward to
later" list for whoever eventually gets a VM and can observe real `lvs`
output — not something this fix round should have been blocked on.

**What I can and cannot establish about LVM's actual output.** I have no VM
and could not run `lvs` against real LVM, so I cannot confirm or rule out
that `--units b --nosuffix` ever emits a fractional value like
`8589934592.00`. I won't guess at LVM's behavior. What I can establish
without a VM: LVM allocates in whole logical extents (default 4 MiB), and the
`b` (bytes) unit is described in `lvs`/`lvdisplay` documentation as the
unscaled byte count with no implied rounding the way `g`/`m`/`t` units are —
which is suggestive that whole-extent-aligned volumes report as whole bytes
under `--units b`. But that is not something I measured; it's a documentation
inference, not a verified fact, and I'm flagging the difference. The correct
scoped conclusion is: consistent with existing convention, and a risk to
forward rather than something this fix introduced or should be blocked on.

## Regression checks

- **`npx vitest run`: 246 passing / 23 files.** Matches the required baseline
  exactly. Tail of the real run:

  ```
   Test Files  23 passed (23)
        Tests  246 passed (246)
     Start at  15:26:01
     Duration  928ms (transform 811ms, setup 0ms, collect 1.80s, tests 1.17s, environment 3ms, prepare 1.77s)
  ```

- **`npm run typecheck`: clean.** Output was only the script banner
  (`> rhcsa-trainer@0.1.0 typecheck` / `> tsc --noEmit`), no diagnostics, exit
  0. Expected — this fix touches only three shell scripts, no `.ts` files.

- **`bash -n` on all three modified scripts: clean.**

  ```
  grade.sh OK
  setup.sh OK
  solution02 OK
  ```

- **Style consistency of the new `setup.sh` block:** uses the same `fail()`
  helper defined at `setup.sh:8` (no new error-handling path introduced), the
  same message shape as the neighboring checks (`"<subject> is <value>...;
  <reference>"`, matching the VG-free-space check's `"VG rhel has only
  ${free_extents} bytes free; this task needs at least 5 GiB"` immediately
  below it), and the same explicit non-interactive `sudo lvs ...` invocation
  style as the pre-existing `sudo vgs ...` call right after it — same flags,
  same `tr -d ' '` post-processing, same bare `sudo` with no interactive
  prompt handling, consistent with a passwordless-sudo VM assumption already
  baked into every other privileged call in this file.

- **No `as` casts, no non-null `!`, no `enum`:** confirmed trivially — this
  diff touches only `.sh` files, which have no such constructs. Grepped all
  three modified scripts for `\bas\b`, `\benum\b`, and `!\w` as a sanity
  check; every hit was the English word "as" inside a comment (e.g. "a UUID
  is as good as a device path"), nothing resembling a TypeScript cast,
  non-null assertion, or enum.

- **`git status --porcelain`: empty before this review and empty now.**
  Confirmed both times. No file was edited during this re-review.

## New findings

None. Both F1 and F2 are fully closed, and I found no regression in the
surrounding code, the test suite, typecheck, or script syntax. The `(( ))`
fractional-value question is not a new finding introduced by this fix — it is
a pre-existing, already-shared assumption across `grade.sh`'s use of
`lv_size_bytes` and `setup.sh`'s pre-existing `vgs` check, and the new code
is consistent with that existing convention rather than deviating from it.

## Bottom line

**Nothing blocks.** F1 and F2 are both closed exactly as specified, nothing
regressed (246/23 tests, clean typecheck, clean `bash -n` on all three
touched scripts), and the repo is untouched by this review. Tasks 22-24 can
clone `content/tasks/storage/014-grow-home-lv/`'s shape without inheriting
either defect.
