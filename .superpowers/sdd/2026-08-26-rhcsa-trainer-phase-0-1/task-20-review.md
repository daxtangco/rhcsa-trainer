# Task 20 review — `content/lib/assert.sh`

Commit reviewed: `c1b3b01` ("feat(content): grader helper library")

## Verdict 1 — Spec compliance (the four mandates)

All four mandates are satisfied.

1. **Control-character escaping (`content/lib/assert.sh:34-51`, in `_json_escape`).**
   `\b`/`\f` are substituted explicitly, then any remaining byte in
   `0x01`-`0x1f` is escaped via `\uXXXX` inside the `[[ $s == *[$'\x01'-$'\x1f']* ]]`
   guarded loop. Verified myself:
   - `printf 'bell\001'` → `"\u0001"` in the emitted JSON, parses cleanly.
   - `printf 'esc\033[0m'` → `"\u001b[0m"`, parses cleanly.
   - DEL (`0x7f`) is **not** escaped and comes through raw — I checked this
     against the actual JSON spec (RFC 8259 only mandates escaping
     `U+0000`-`U+001F`; `0x7f` is legal raw in a JSON string) and confirmed
     `JSON.parse` accepts it without complaint. Not a defect; the mandate's
     own "measured" fix only ever claimed the C0 range, and C0 is exactly what
     matters for `parseVerdict`.
   - Backslash + double quote + ESC + bell together in one `detail` string
     round-trip through `JSON.parse` byte-for-byte correct.
   - The `\uXXXX` form is confirmed four-hex-digit (`\u001b` for ESC, `\u0001` for bell), which
     is what JSON requires — `printf '\\u%04x'` guarantees this.
   - Break-and-revert: removing the block reproduces exactly the failure mode
     the mandate describes (`v.noise` gets one raw line, `v.checkpoints` is
     empty) — confirmed independently via mutation on a scratch copy, not just
     by trusting the report.

2. **`noauto` rejected, `nofail` still passes (`content/lib/assert.sh:169`).**
   `$4 !~ /(^|,)noauto(,|$)/`. Verified against `noauto`, `defaults,noauto`,
   `noauto,defaults` (all rejected, rc=1), and `defaults,nofail`, `nofail`,
   `defaults`, `noatime` (all accepted, rc=0). Also checked the substring trap
   named in the review-context: `xnoauto`, `noautofs`, `defaults,xnoauto,rw`
   all still pass — the anchor is on the *word* `noauto` bounded by
   comma/start/end, not a `no*` prefix, so it does not over-reject. A
   two-field fstab line (absent `$4`) still passes, matching the mandate's own
   prediction.

3. **Systemd-unit `Where=` compared literally (`content/lib/assert.sh:181-187`).**
   `awk` extracts everything after the first `=`, trims whitespace, and does
   `v == t` — string equality, not `grep -E`. Verified: target `/var.d`
   against `Where=/varXd` now correctly fails (rc=1) where the brief's
   original interpolated-regex version would have matched via `.` as
   wildcard; target `/var.d` against an exact `Where=/var.d` still passes;
   `Where = /var` with stray spaces around `=` still passes; and, checking the
   anchoring the review-context specifically asked about, `/var/log` against
   `Where=/var` correctly fails and `/var` against `Where=/var` correctly
   passes — no substring leakage in either direction.

4. **`fileURLToPath` used in the new test file (`test/lib/assert.test.ts:211`).**
   `const LIB = fileURLToPath(new URL('../../content/lib/assert.sh', import.meta.url))`.
   No `.pathname` idiom in this file. The seven pre-existing files using the
   old idiom were correctly left untouched (confirmed via `git status
   --porcelain` and the diff — this commit touches only
   `content/lib/assert.sh` and `test/lib/assert.test.ts`).

No mandate is partially done or worked-around; all four match both the
mandate text and my own independent measurement of the resulting behavior.

## Verdict 2 — Task quality

Good. I looked at this the way the brief asked — as the person debugging a
grader that reports a checkpoint wrong — and did not find a case where this
library would misreport pass/fail for a real Phase-1 grading scenario.

Supporting evidence beyond the mandate checks above:

- **Mutation testing** (scratch copy at `/tmp`, `node_modules` symlinked back,
  no write to the repo, `git status --porcelain` empty throughout and after):
  reverting mandate 1's escaping block, mandate 2's `noauto` guard, or
  mandate 3's literal-comparison awk *each* breaks exactly one test in
  `test/lib/assert.test.ts` and nothing else. That means each mandate has a
  genuine, load-bearing regression test — not a coincidentally-passing one.
- `to_bytes`, `within_pct`, and the untouched parts of `is_persistent` are
  unchanged from the brief and were already measured correct in the
  pre-flight; I did not re-spend findings on them, per the review context.
- The scope note held: exactly ten helpers, none added, `lv_size_bytes` and
  `mount_source` correctly left untested here.
- `bash -n content/lib/assert.sh` is clean. `shellcheck` remains unavailable
  on this host (confirmed again independently) — not this task's problem to
  solve, consistent with prior tasks' notes.
- `src/engine/grading/verdict.ts` is untouched, as mandated — the fix lives
  entirely in the emitter, which is the right side of the contract to fix.

Nothing I found rises to must-fix. Two small items worth carrying forward:

- **observation** — `_json_escape`'s C0-only escaping is correct for the
  actual defect (an unescaped `0x00`-`0x1f` byte is invalid JSON and vanishes
  a checkpoint), but the mandate's own prose in a few places blurs "control
  character" generally with "C0". DEL (`0x7f`) is untouched by design and that
  is fine — RFC 8259 does not require escaping it — but a future reader who
  greps for "control character" and expects DEL to be covered too could be
  briefly confused. Worth a one-line code comment eventually; not worth
  blocking this commit.
- **forward-to-later** — the WSL-vs-RHEL-9-guest `awk` gap is real but out of
  this task's power to close (no VM access here). Noted, not billed as a
  defect, consistent with the review context's instruction.

## Blocking

Nothing blocks. Spec compliance is 4/4 and task quality holds up under
mutation testing, not just the report's own claims.

## Totals I measured myself

- `npx vitest run test/lib/assert.test.ts` → **30 tests, 30 passed, 1 file** —
  matches the mandates' arithmetic (6 emitter + 12 `to_bytes` + 3 `within_pct`
  + 5 `is_persistent` from the brief, + 4 from the mandates) and matches the
  implementer's report.
- `npx vitest run` (whole branch) → **233 tests passed, 21 test files
  passed, 0 failed** — matches the stated baseline expectation exactly
  (`ad8c0f2` at 203/20 + this task's 30/1).
- `npm run typecheck` (`tsc --noEmit`) → clean, exit 0, no output.
- `bash -n content/lib/assert.sh` → clean.
- `shellcheck` → confirmed not installed on this host (independently
  re-checked, not just taken from the report).
- `git status --porcelain` in the live repo shows only ` M scripts/provision.sh`
  — the concurrent Task 19 fix noted in the review context, not this task's
  leakage. Nothing else outstanding.

No discrepancy between my measurements and the implementer's report.
