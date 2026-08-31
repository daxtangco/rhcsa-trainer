# Task 20 report — `content/lib/assert.sh`

Commit: `c1b3b0148e6815d81069c79aae37aac2c35f8717`

## What was built

- `content/lib/assert.sh` — the brief's Step 3 library with all three
  substantive mandates applied: `_json_escape` now escapes the full C0
  control range (`\b`, `\f`, then `\uXXXX` for any leftover `0x01`-`0x1f`),
  `is_persistent`'s fstab branch rejects `noauto` (but not `nofail`) in
  field 4, and its systemd-unit branch compares `Where=` literally via
  `awk` instead of interpolating `$target` into an extended regex.
- `test/lib/assert.test.ts` — the brief's test file plus mandate 4
  (`fileURLToPath` instead of `new URL(...).pathname`) and four new tests:
  control-character escaping, `noauto` rejection, `nofail` still-passes, and
  the regex-metacharacter mismatch.

Followed TDD order: wrote the test file, ran it and saw it fail (library
absent), wrote the library, ran it and saw it pass.

## Observed test/typecheck totals (this run, not the brief's or mandates')

- `npx vitest run test/lib/assert.test.ts` → **30 tests, 30 passed**, 1 file.
  (30 matches the mandates' own arithmetic: 6 emitter + 12 `to_bytes` + 3
  `within_pct` + 5 `is_persistent` from the brief, + 4 from the mandates —
  1 escaping test + noauto + nofail + metachar.)
- `npx vitest run` (whole branch) → **233 tests passed, 21 test files
  passed**, 0 failed.
- `npm run typecheck` (`tsc --noEmit`) → clean, no output, exit 0.
- `bash -n content/lib/assert.sh` → clean.

## Mandate 1 break-and-revert

Removed the control-character escaping block (the `if [[ $s ==
*[$'\x01'-$'\x1f']* ]]; then ... fi` loop and its comment) from
`_json_escape`, keeping only the `\b`/`\f` substitutions, then ran just the
new test:

```
npx vitest run test/lib/assert.test.ts -t "escapes control characters"
```

Observed failure:

```
FAIL  test/lib/assert.test.ts > checkpoint emitters > escapes control characters, so a stray ESC cannot delete a checkpoint
AssertionError: expected [ Array(1) ] to deeply equal []
- Expected
+ Received
- []
+ [
+   "{\"id\":\"boom\",\"desc\":\"it failed\",\"status\":\"fail\",\"detail\":\"esc[0m bell\"}",
+ ]
  at test/lib/assert.test.ts:61:21
    expect(v.noise).toEqual([])
```

`v.noise` held the one line (containing the raw, unescaped ESC and bell
bytes), and `v.checkpoints` was empty — exactly the "checkpoint silently
vanishes" failure mode the mandate describes, not a crash and not a
`status: 'fail'`. Restored the block via `cp` from a pre-break backup,
diffed identical, then reran the full file: 30/30 passed again.

## Step 5 round-trip (pasted verbatim)

```
$ bash -c '. content/lib/assert.sh
  ck_pass a "all good"
  ck_fail b "size wrong" "found 2.0G, wanted 4.0G"
  ck_skip c "podman" "not installed"' | tee /tmp/v.jsonl
{"id":"a","desc":"all good","status":"pass"}
{"id":"b","desc":"size wrong","status":"fail","detail":"found 2.0G, wanted 4.0G"}
{"id":"c","desc":"podman","status":"skip","detail":"not installed"}

$ node --input-type=module -e "..."
{
  "checkpoints": [
    { "id": "a", "desc": "all good", "status": "pass" },
    { "id": "b", "desc": "size wrong", "status": "fail", "detail": "found 2.0G, wanted 4.0G" },
    { "id": "c", "desc": "podman", "status": "skip", "detail": "not installed" }
  ],
  "noise": []
}
allPassed: false
```

Matches the expected shape exactly: three checkpoints, `noise: []`,
`allPassed: false`.

## Notes

- **`shellcheck` was not installed on this host.** Did not install it or
  chase it, per the mandates. This file has never been linted — a later
  pass should run shellcheck on it.
- Confirmed for myself (before writing any code) that
  `src/engine/grading/verdict.ts:80-82` really is
  `v.checkpoints.length > 0 && v.checkpoints.every((cp) => cp.status ===
  'pass')` and that an unparseable line goes to `noise` while the
  checkpoint disappears (`verdict.ts:41-58`) — matches the mandates'
  measurement, and is why mandate 1 matters as much as the mandates file
  says it does.
- Did not run or attempt `sudo` anywhere; `lv_size_bytes` and `mount_source`
  are untested here per the brief and mandates, deferred to Task 21's VM
  fixture matrix.
- Did not add any helper beyond the brief's ten.
- `git status --porcelain` was empty before I started except for my own two
  new paths (`content/lib/`, `test/lib/`), and empty again after commit —
  no concurrent reviewer changes were visible in the tree at any point I
  checked.
- One environmental caveat carried over from the mandates, not a defect:
  this test suite runs `awk`/bash on the WSL host; a real grader runs the
  same code in the RHEL 9 guest. Not verified identically here, only noted.
