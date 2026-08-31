# Task 20 — mandated changes to the brief

Four **required** changes. They override `task-20-brief.md` wherever they
conflict; everything else in the brief stands — the ten-helper scope note, the
`to_bytes`/`within_pct` design notes, the test bodies, and the commit message.

**Read the measurement warning first.** I ran every claim below as a command on
this host and pasted the output. Six times in this project I have handed an
implementer a confident measurement; once it was wrong, and once a verification
instruction I wrote was impossible as stated. So: **confirm anything you depend
on with your own command. If your measurement disagrees with mine, yours wins —
say so in the report and act on yours.**

This file is the one component whose correctness the entire app rests on. Every
grader sources it, and a helper that returns the wrong answer does not crash — it
silently passes a student who got it wrong, or fails one who got it right. All
three substantive mandates below are instances of the defect class this project
keeps finding: **a check that passes for the wrong reason.**

## Measured as correct — do not "fix" these, and do not spend a review finding on them

I suspected all of these and measured them as fine:

- **`to_bytes` is correct on all twelve cases in the brief's table**, including
  `1T`. I specifically expected `awk`'s `printf "%d"` to overflow past 2³¹ and it
  does not: this host runs GNU Awk 5.3.2 and returned `1099511627776` for `1T` and
  `562949953421312` for 512T. `1.5G` → `1610612736` and `4.00g` → `4294967296`,
  both exact. The regex, the `${unit,,}` lowering, and the `awk` multiplication all
  behave. Leave `to_bytes` exactly as the brief writes it.
- **`to_bytes 'banana'` exits 1** and prints to stderr, so the brief's
  `rejects.toThrow()` test is genuine.
- **`allPassed` really does treat `skip` as not-passed.** The brief asserts this in
  a comment; I checked `src/engine/grading/verdict.ts:80-82` and it is
  `v.checkpoints.length > 0 && v.checkpoints.every((cp) => cp.status === 'pass')`.
  The comment is accurate.
- **All five of the brief's `is_persistent` cases pass** with the brief's own
  implementation, including the commented-out fstab line and the
  `/var/log`-does-not-satisfy-`/var` case. The bug in mandates 2 and 3 is in cases
  the brief does not test, not in the ones it does.

One environmental note, not a defect: these tests run `awk` on this **WSL host**,
while a real grader runs `awk` in the **RHEL 9 guest**. Both are GNU awk, so the
arithmetic above carries over, but the test suite does not prove that. Worth one
sentence in the report, not a code change.

## 1. `_json_escape` emits invalid JSON for any control character except tab, CR and LF — and an invalid line makes a checkpoint silently vanish

```bash
s=${s//$'\t'/\\t}
s=${s//$'\r'/\\r}
s=${s//$'\n'/\\n}
```

That is the complete set. Every other C0 control character — `0x01`, vertical tab
`0x0B`, form feed `0x0C`, and **ESC `0x1B`** — is passed through raw, and a raw
control character inside a JSON string literal is invalid JSON. Measured:

```
$ ck_fail id 'desc' "$(printf 'bell\001here')"
{"id":"id","desc":"desc","status":"fail","detail":"bellhere"}
$ node -e 'JSON.parse(...)'
INVALID JSON -> Bad control character in string literal at position 55
```

Now follow what happens to that line. `parseVerdict`
(`src/engine/grading/verdict.ts:50-52`) wraps `JSON.parse` in a `try/catch` and
pushes an unparseable line onto `noise`. So the checkpoint does not fail — **it
disappears from `v.checkpoints` entirely.** And `allPassed` returns true when
every *surviving* checkpoint passed. A grader that emits five checkpoints, four
passing and one failing with a control character in its `detail`, therefore
reports **`allPassed: true`**. The student is told they got it right.

That is the project's signature defect in its purest form: the tool reporting
success when it did not do what was asked. And `detail` is exactly where it will
happen, because `detail` is almost always captured command output — an ESC from
anything that colorizes, a form feed, or a filename a student created.

Extend the escaping to cover the whole C0 range. This version is measured
working, and its fast path means the per-character loop almost never runs:

```bash
_json_escape() {
  local s=$1
  s=${s//\\/\\\\}      # backslash first, or it doubles the others
  s=${s//\"/\\\"}
  s=${s//$'\t'/\\t}
  s=${s//$'\r'/\\r}
  s=${s//$'\n'/\\n}
  s=${s//$'\b'/\\b}
  s=${s//$'\f'/\\f}
  # Any C0 control left over would make the line invalid JSON, and parseVerdict
  # files an invalid line as noise - so the checkpoint would silently vanish from
  # the verdict instead of failing, and allPassed would ignore it. detail is
  # usually captured command output, which is where an ESC or a form feed comes
  # from. Escape the remainder as \uXXXX; the guard means the loop is skipped for
  # every normal string.
  if [[ $s == *[$'\x01'-$'\x1f']* ]]; then
    local out='' i ch
    for (( i = 0; i < ${#s}; i++ )); do
      ch=${s:i:1}
      if [[ $ch == [$'\x01'-$'\x1f'] ]]; then
        printf -v ch '\\u%04x' "'$ch"
      fi
      out+=$ch
    done
    s=$out
  fi
  printf '%s' "$s"
}
```

Measured: `bell\001vt\013ff\014esc\033[0m` now yields
`"bellvtff\fesc[0m"`, which `JSON.parse` accepts. And the
brief's own escaping test is unaffected — `says "hi"` and
`back\slash and<TAB>tab` still round-trip exactly as its assertions require.
Verify that yourself before anything else; this mandate must not weaken the test
the brief already has.

**Add a test**, because nothing in the brief covers this:

```ts
it('escapes control characters, so a stray ESC cannot delete a checkpoint', async () => {
  // An unparseable line becomes `noise` and the checkpoint vanishes from the
  // verdict — which would make a failing grader report allPassed. detail is
  // captured command output, so a control byte is a question of when, not if.
  const v = parseVerdict(await sh(`ck_fail boom "it failed" "$(printf 'esc\\033[0m bell\\001')"`))
  expect(v.noise).toEqual([])
  expect(v.checkpoints[0]?.status).toBe('fail')
})
```

**Then break it and watch it fail**: drop the `if [[ $s == *[...]* ]]` block,
confirm this test fails with a non-empty `noise` and no checkpoint, and restore
it. Report what the failure looked like. A test whose failure you have not seen
is not yet a test.

## 2. `is_persistent` accepts `noauto`, which does not mount at boot

The function's own contract is `-> exit 0 if it will mount at boot`. An fstab
entry with `noauto` will not. Measured against the brief's implementation:

```
fstab noauto (will NOT mount at boot)    rc=0  expect=1  <-- MISMATCH
```

A student who writes `noauto` gets a **pass** on the persistence checkpoint. The
reboot check in verdict B would eventually catch it, but that is not a reason to
leave it: the checkpoint says "persistent", it is the checkpoint whose entire job
is to read the configuration, and a task that runs only verdict A never gets the
second opinion.

Reject `noauto` in the options field:

```bash
        NF >= 2 && $2 == t && $4 !~ /(^|,)noauto(,|$)/ { found = 1 }
```

Measured: this rejects both `noauto` and `defaults,noauto`, while
`defaults,nofail` still passes (`nofail` does mount at boot — it only suppresses
the error if the device is missing), and a two-field fstab line still passes
because an absent `$4` is the empty string. Do not reject `nofail`; it is the
option `provision.sh` itself uses for the ISO mount.

## 3. `is_persistent` interpolates the mount point into a regex

```bash
grep -qE "^[[:space:]]*Where[[:space:]]*=[[:space:]]*${target}[[:space:]]*$" "$unit"
```

`$target` lands inside an extended regular expression unquoted, so any regex
metacharacter in a mount point changes the match. Measured:

```
regex metachar: target /var.d vs Where=/varXd    rc=0  expect=1  <-- MISMATCH
```

A `.` matched a different character and the helper reported that `/var.d` is
persistent on the evidence of a unit for `/varXd`. Note that the fstab half of
this same function already does the right thing — `$2 == t`, a literal string
comparison. The two halves disagree about how strict they are, and only one of
them is defensible.

Make the unit half literal too:

```bash
    for unit in "$unitdir"/*.mount; do
      [[ -r $unit ]] || continue
      # Compare the Where= value literally. Interpolating $target into a regex
      # would let a mount point containing '.' match some other path - and the
      # fstab branch above already compares literally, so this matches it.
      if awk -v t="$target" '
            /^[[:space:]]*Where[[:space:]]*=/ {
              v = substr($0, index($0, "=") + 1)
              gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
              if (v == t) found = 1
            }
            END { exit found ? 0 : 1 }' "$unit"; then
        return 0
      fi
    done
```

Measured: all five of the brief's cases still behave, `/var.d` against
`Where=/varXd` now fails, `Where = /var` with spaces around the `=` still passes,
and an exact `Where=/var.d` against target `/var.d` still passes.

**Add tests for mandates 2 and 3** in the brief's `is_persistent` describe block,
in its existing style — one for `noauto`, one for a metacharacter target, and one
asserting `nofail` still passes so nobody "fixes" mandate 2 into rejecting it.

## 4. Use `fileURLToPath`, not `new URL(...).pathname`

```ts
const LIB = new URL('../../content/lib/assert.sh', import.meta.url).pathname
```

`.pathname` is a URL path, not a filesystem path: it percent-encodes, so any
space or non-ASCII character in a parent directory yields a path that does not
exist. This repo lives under `/home/daxtangco/`, so it works today and is not a
live bug.

There are already **seven** test files using this idiom, and they are parked in
the ledger for a single sweep. Yours is a **new** file, so use the correct form
now rather than making that sweep eight:

```ts
import { fileURLToPath } from 'node:url'
const LIB = fileURLToPath(new URL('../../content/lib/assert.sh', import.meta.url))
```

Do not touch the seven existing files — they belong to closed tasks and to that
sweep.

## Out of scope

- Do not change `src/engine/grading/verdict.ts`. It is a closed task's file, and
  mandate 1 fixes the emitter rather than making the parser tolerant — a parser
  that accepted invalid JSON would hide exactly this class of bug. If you think
  `parseVerdict` should also surface a non-empty `noise` more loudly, say so in
  the report; the grading **runner** is Task 21's and that is where it belongs.
- **Do not add helpers beyond the ten the brief lists.** The scope note is a
  mandate in its own right: a helper no grader calls is untested code in the one
  component everything depends on.
- Do not unit-test `lv_size_bytes` or `mount_source`. They need `sudo lvs` and a
  real mount point; Task 21's fixture matrix covers them against the VM. The
  brief says so and is right.
- **No `sudo` on this WSL host** — there is no TTY and it cannot authenticate.
  `lv_size_bytes` calls `sudo` because it runs in the *guest*, where Task 19
  installs a NOPASSWD drop-in. Do not try to run it here.
- **No VM operations.** The RHEL VM does not exist yet; the user's Ubuntu and
  Windows 11 guests are unrelated to this project.
- Never read or copy `.env`, `.env.sandbox`, or `.env.example` from
  `/home/daxtangco/sechelp-tools` — an unrelated project's secrets. Do not create
  or modify `.env.local`.
- Graders are **read-only** and must never mutate the system they measure. Nothing
  in this library may write outside a caller-supplied temp path.
- Do not dispatch subagents.

## Verify before committing

1. `bash -n content/lib/assert.sh` clean. Note that `shellcheck` is **not**
   installed on this host — do not install it or chase it; say so in the report so
   a later pass knows this file has never been linted.
2. `npx vitest run` and `npm run typecheck` both clean. **Report the totals you
   observe.** The brief predicts 26 tests for this file, and I checked that
   arithmetic myself (6 emitter + 12 `to_bytes` + 3 `within_pct` + 5
   `is_persistent`); these mandates add four more, so expect about 30 in this
   file. The branch total depends on what landed before you — read it from your own
   run rather than from any number in this file.
3. Mandate 1's break-and-revert must actually have been run, with the observed
   failure described.
4. Run the brief's Step 5 round-trip by hand and paste it. It is the only check
   that bash's output and the TypeScript parser agree, which is the whole point of
   this task; expected `noise: []`, three checkpoints, `allPassed: false`.
5. `git status --porcelain` empty after committing. A concurrent reviewer may be
   working elsewhere in the tree — if you see modified files outside
   `content/lib/assert.sh` and `test/lib/`, they are not yours: do not revert or
   commit them, just note them.

Report to `.superpowers/sdd/2026-08-26-rhcsa-trainer-phase-0-1/task-20-report.md`
as a real file, including the pasted Step 5 round-trip, the observed totals, the
mandate-1 break-and-revert result, and the note that `shellcheck` was unavailable.
