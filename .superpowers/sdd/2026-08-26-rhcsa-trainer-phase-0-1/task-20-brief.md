### Task 20: `content/lib/assert.sh` — the grader helper library

Every grader sources this. It is the contract between bash and the JSONL parser from Task 5.

**Files:**
- Create: `content/lib/assert.sh`
- Test: `test/lib/assert.test.ts` (shells out to real bash — the only honest way to test bash)

**Interfaces:**
- Consumes: nothing.
- Produces the emitters and helpers graders use:
  - `ck_pass ID DESC`, `ck_fail ID DESC DETAIL`, `ck_skip ID DESC DETAIL`
  - `ck ID DESC CONDITION_EXIT DETAIL` — emit pass or fail from an exit status
  - `to_bytes SIZE` — `2G`, `2048M`, `2GiB`, `1.5G` → bytes
  - `lv_size_bytes VG LV`, `mount_source PATH`, `fs_size_bytes PATH`
  - `within_pct ACTUAL EXPECTED PCT` — tolerance, because filesystems round
  - `is_persistent PATH` — fstab **or** a systemd mount unit
  - Each emitted line is one JSON object, exactly what `parseVerdict` consumes.

**Scope note.** Ten helpers, not thirty. Only what the five Phase 1 tasks need. Adding a helper no grader calls means shipping untested code into the one component whose correctness the whole app rests on.

**Design notes.**
- `to_bytes` uses `awk`, not bash arithmetic, because `1.5G` is a real thing a student will type into `lvextend` and bash cannot multiply floats.
- `within_pct` exists because a 2 GiB XFS filesystem never reports exactly 2 GiB — `df` shows usable space after metadata. An exact comparison would fail a correct answer, which is the worst failure mode a grader has.
- `is_persistent` accepts fstab **or** a systemd `.mount` unit, per spec §6.5 rule 1: grade the end state, not the mechanism.

- [ ] **Step 1: Write the failing test**

`test/lib/assert.test.ts`:

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { parseVerdict } from '../../src/engine/grading/verdict.ts'

const run = promisify(execFile)
const LIB = new URL('../../content/lib/assert.sh', import.meta.url).pathname

/** Run a snippet with assert.sh sourced, and return its stdout. */
async function sh(snippet: string): Promise<string> {
  const { stdout } = await run('bash', ['-c', `set -uo pipefail; . '${LIB}'; ${snippet}`])
  return stdout
}

describe('checkpoint emitters', () => {
  it('emits one JSON object per line that parseVerdict accepts', async () => {
    const out = await sh(`ck_pass lv-var-size "/var LV is 4 GiB"`)
    const v = parseVerdict(out)

    expect(v.noise).toEqual([])
    expect(v.checkpoints).toEqual([
      { id: 'lv-var-size', desc: '/var LV is 4 GiB', status: 'pass' },
    ])
  })

  it('carries detail on failures, since detail is what teaches', async () => {
    const v = parseVerdict(await sh(`ck_fail fs-var-size "/var fs is 4 GiB" "still 2.0G"`))
    expect(v.checkpoints[0]).toEqual({
      id: 'fs-var-size',
      desc: '/var fs is 4 GiB',
      status: 'fail',
      detail: 'still 2.0G',
    })
  })

  it('emits skip with a reason', async () => {
    const v = parseVerdict(await sh(`ck_skip containers "podman task" "not installed"`))
    expect(v.checkpoints[0]?.status).toBe('skip')
    expect(v.checkpoints[0]?.detail).toBe('not installed')
  })

  it('escapes quotes, backslashes, tabs and newlines so one bad path cannot corrupt the verdict', async () => {
    const v = parseVerdict(
      await sh(`ck_fail weird 'says "hi"' 'back\\slash and	tab'`),
    )
    expect(v.noise).toEqual([])
    expect(v.checkpoints[0]?.desc).toBe('says "hi"')
    expect(v.checkpoints[0]?.detail).toContain('back\\slash')
    expect(v.checkpoints[0]?.detail).toContain('\t')
  })

  it('ck turns an exit status into pass or fail', async () => {
    const pass = parseVerdict(await sh(`true; ck a "cond" $? "detail"`))
    expect(pass.checkpoints[0]?.status).toBe('pass')

    const fail = parseVerdict(await sh(`false; ck a "cond" $? "why it failed"`))
    expect(fail.checkpoints[0]?.status).toBe('fail')
    expect(fail.checkpoints[0]?.detail).toBe('why it failed')
  })

  it('emits nothing on stdout other than checkpoint lines', async () => {
    // Graders are parsed, not read. A stray echo becomes noise.
    const out = await sh(`ck_pass a "x"; ck_pass b "y"`)
    expect(out.trimEnd().split('\n')).toHaveLength(2)
  })
})

describe('to_bytes', () => {
  const cases: Array<[string, number]> = [
    ['512', 512],
    ['1K', 1024],
    ['1KiB', 1024],
    ['2M', 2 * 1024 ** 2],
    ['2G', 2 * 1024 ** 3],
    ['2GiB', 2 * 1024 ** 3],
    ['4.00g', 4 * 1024 ** 3],
    ['1.5G', 1.5 * 1024 ** 3],
    ['1T', 1024 ** 4],
    // lvs and df print a trailing unit letter in lower case; both must work.
    ['2g', 2 * 1024 ** 3],
    ['2048m', 2 * 1024 ** 3],
  ]

  for (const [input, expected] of cases) {
    it(`converts ${input}`, async () => {
      expect(Number(await sh(`to_bytes '${input}'`))).toBe(expected)
    })
  }

  it('exits non-zero on unparseable input rather than printing a wrong number', async () => {
    // Returning 0 here would silently pass a size check.
    await expect(sh(`to_bytes 'banana'`)).rejects.toThrow()
  })
})

describe('within_pct', () => {
  it('accepts a filesystem that is slightly smaller than its LV', async () => {
    // A 4 GiB XFS reports ~3.99 GiB usable. Exact equality fails correct work.
    const lv = 4 * 1024 ** 3
    const fs = Math.floor(lv * 0.995)
    const v = parseVerdict(await sh(`within_pct ${fs} ${lv} 2; ck a "size" $? "off by too much"`))
    expect(v.checkpoints[0]?.status).toBe('pass')
  })

  it('rejects a filesystem that was never grown', async () => {
    const v = parseVerdict(
      await sh(`within_pct ${2 * 1024 ** 3} ${4 * 1024 ** 3} 2; ck a "size" $? "not grown"`),
    )
    expect(v.checkpoints[0]?.status).toBe('fail')
  })

  it('is symmetric, so an over-shoot also fails', async () => {
    const v = parseVerdict(
      await sh(`within_pct ${8 * 1024 ** 3} ${4 * 1024 ** 3} 2; ck a "size" $? "too big"`),
    )
    expect(v.checkpoints[0]?.status).toBe('fail')
  })
})

describe('is_persistent', () => {
  it('accepts an fstab entry', async () => {
    const v = parseVerdict(
      await sh(`
        FSTAB=$(mktemp); UNITDIR=$(mktemp -d)
        echo '/dev/mapper/rhel-var /var xfs defaults 0 0' > "$FSTAB"
        is_persistent /var "$FSTAB" "$UNITDIR"; ck p "persistent" $? "not persistent"
      `),
    )
    expect(v.checkpoints[0]?.status).toBe('pass')
  })

  it('accepts a systemd mount unit, because the mechanism is not what is graded', async () => {
    const v = parseVerdict(
      await sh(`
        FSTAB=$(mktemp); UNITDIR=$(mktemp -d)
        printf 'Where=/var\\n' > "$UNITDIR/var.mount"
        is_persistent /var "$FSTAB" "$UNITDIR"; ck p "persistent" $? "not persistent"
      `),
    )
    expect(v.checkpoints[0]?.status).toBe('pass')
  })

  it('rejects neither', async () => {
    const v = parseVerdict(
      await sh(`
        FSTAB=$(mktemp); UNITDIR=$(mktemp -d)
        is_persistent /var "$FSTAB" "$UNITDIR"; ck p "persistent" $? "no fstab, no unit"
      `),
    )
    expect(v.checkpoints[0]?.status).toBe('fail')
  })

  it('does not match a commented-out fstab line', async () => {
    const v = parseVerdict(
      await sh(`
        FSTAB=$(mktemp); UNITDIR=$(mktemp -d)
        echo '#/dev/mapper/rhel-var /var xfs defaults 0 0' > "$FSTAB"
        is_persistent /var "$FSTAB" "$UNITDIR"; ck p "persistent" $? "commented out"
      `),
    )
    expect(v.checkpoints[0]?.status).toBe('fail')
  })

  it('does not match /var when only /var/log is configured', async () => {
    // A prefix match here would pass a wrong answer.
    const v = parseVerdict(
      await sh(`
        FSTAB=$(mktemp); UNITDIR=$(mktemp -d)
        echo '/dev/mapper/rhel-varlog /var/log xfs defaults 0 0' > "$FSTAB"
        is_persistent /var "$FSTAB" "$UNITDIR"; ck p "persistent" $? "wrong mount point"
      `),
    )
    expect(v.checkpoints[0]?.status).toBe('fail')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/lib/assert.test.ts`
Expected: FAIL — bash cannot source `content/lib/assert.sh`.

- [ ] **Step 3: Write `content/lib/assert.sh`**

```bash
# Grader helper library. Sourced by every grade.sh.
#
# Contract with src/engine/grading/verdict.ts:
#   - one JSON object per line on stdout, nothing else
#   - the grader's own exit code is ignored
#   - graders are READ-ONLY: they never change the system they measure
#
# shellcheck shell=bash

# ------------------------------------------------------------------ output

# Escape a value for embedding in a JSON string.
_json_escape() {
  local s=$1
  s=${s//\\/\\\\}      # backslash first, or it doubles the others
  s=${s//\"/\\\"}
  s=${s//$'\t'/\\t}
  s=${s//$'\r'/\\r}
  s=${s//$'\n'/\\n}
  printf '%s' "$s"
}

_emit() {
  local status=$1 id=$2 desc=$3 detail=${4-}
  if [[ -n $detail ]]; then
    printf '{"id":"%s","desc":"%s","status":"%s","detail":"%s"}\n' \
      "$(_json_escape "$id")" "$(_json_escape "$desc")" "$status" "$(_json_escape "$detail")"
  else
    printf '{"id":"%s","desc":"%s","status":"%s"}\n' \
      "$(_json_escape "$id")" "$(_json_escape "$desc")" "$status"
  fi
}

ck_pass() { _emit pass "$1" "$2" "${3-}"; }
ck_fail() { _emit fail "$1" "$2" "${3-}"; }

# skip = could not be evaluated. NOT a pass: allPassed() treats it as not-passed.
ck_skip() { _emit skip "$1" "$2" "${3-}"; }

# ck ID DESC EXIT_STATUS [DETAIL]
# Usage:  some_condition; ck my-id "what was checked" $? "what to look at"
ck() {
  local id=$1 desc=$2 status=$3 detail=${4-}
  if [[ $status -eq 0 ]]; then
    ck_pass "$id" "$desc"
  else
    ck_fail "$id" "$desc" "$detail"
  fi
}

# ------------------------------------------------------------------- sizes

# to_bytes SIZE -> bytes on stdout, exit 1 if unparseable.
#
# Handles what lvs, df and a student's own typing produce: 2G, 2g, 2GiB,
# 2048M, 4.00g, 1.5G, bare bytes. awk does the arithmetic because bash cannot
# multiply 1.5.
to_bytes() {
  local raw=$1
  local num unit
  if [[ ! $raw =~ ^([0-9]+(\.[0-9]+)?)[[:space:]]*([KkMmGgTt]?)(i?[Bb])?$ ]]; then
    printf 'to_bytes: cannot parse %s\n' "$raw" >&2
    return 1
  fi
  num=${BASH_REMATCH[1]}
  unit=${BASH_REMATCH[3]}
  local mult=1
  case ${unit,,} in
    k) mult=1024 ;;
    m) mult=$((1024 ** 2)) ;;
    g) mult=$((1024 ** 3)) ;;
    t) mult=$((1024 ** 4)) ;;
    '') mult=1 ;;
  esac
  awk -v n="$num" -v m="$mult" 'BEGIN { printf "%d\n", n * m }'
}

# within_pct ACTUAL EXPECTED PCT -> exit 0 if |actual-expected| <= pct% of expected.
#
# Filesystems never report their exact device size: XFS metadata makes a 4 GiB
# LV report slightly less usable space. Exact comparison fails correct answers.
within_pct() {
  local actual=$1 expected=$2 pct=$3
  awk -v a="$actual" -v e="$expected" -v p="$pct" 'BEGIN {
    if (e == 0) exit 1
    d = a - e; if (d < 0) d = -d
    exit (d <= e * p / 100) ? 0 : 1
  }'
}

# ------------------------------------------------------------- system state

# lv_size_bytes VG LV -> size in bytes. Empty output + exit 1 if absent.
lv_size_bytes() {
  local vg=$1 lv=$2 out
  out=$(sudo lvs --noheadings --nosuffix --units b -o lv_size "$vg/$lv" 2>/dev/null | tr -d ' ') || return 1
  [[ -n $out ]] || return 1
  printf '%s\n' "$out"
}

# mount_source PATH -> the device currently backing PATH, exit 1 if not a mount point.
mount_source() {
  findmnt -no SOURCE --target "$1" 2>/dev/null || return 1
}

# fs_size_bytes PATH -> the filesystem's total size in bytes.
#
# df, not lvs: this is the number that reveals a forgotten xfs_growfs.
fs_size_bytes() {
  local out
  out=$(df -B1 --output=size "$1" 2>/dev/null | tail -n1 | tr -d ' ') || return 1
  [[ -n $out ]] || return 1
  printf '%s\n' "$out"
}

# is_persistent MOUNTPOINT [FSTAB] [UNITDIR] -> exit 0 if it will mount at boot.
#
# Accepts an fstab entry OR a systemd .mount unit. Per spec 6.5 rule 1 the end
# state is graded, not the mechanism, so a student who chose a mount unit is
# not penalised for it.
is_persistent() {
  local target=$1
  local fstab=${2:-/etc/fstab}
  local unitdir=${3:-/etc/systemd/system}

  # Field 2 must equal the target exactly. A prefix match would accept
  # /var/log as evidence for /var.
  if [[ -r $fstab ]] && awk -v t="$target" '
        /^[[:space:]]*#/ { next }
        NF >= 2 && $2 == t { found = 1 }
        END { exit found ? 0 : 1 }' "$fstab"; then
    return 0
  fi

  if [[ -d $unitdir ]]; then
    local unit
    for unit in "$unitdir"/*.mount; do
      [[ -r $unit ]] || continue
      if grep -qE "^[[:space:]]*Where[[:space:]]*=[[:space:]]*${target}[[:space:]]*$" "$unit"; then
        return 0
      fi
    done
  fi

  return 1
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /home/daxtangco/rhcsa-trainer && npx vitest run test/lib/assert.test.ts`
Expected: all 26 tests PASS. `to_bytes`, `within_pct`, `is_persistent` and the escaping tests need no VM — they run against real bash on the WSL host.

`lv_size_bytes` and `mount_source` are not unit-tested here: they need `sudo lvs` and a real mount. They are covered by Task 21's fixture matrix, which runs against the VM.

- [ ] **Step 5: Verify the round trip by hand**

The claim worth checking directly is that bash's output and the TypeScript parser agree:

```bash
cd /home/daxtangco/rhcsa-trainer
bash -c '. content/lib/assert.sh
  ck_pass a "all good"
  ck_fail b "size wrong" "found 2.0G, wanted 4.0G"
  ck_skip c "podman" "not installed"' | tee /tmp/v.jsonl

node --input-type=module -e "
import { readFileSync } from 'node:fs'
import { allPassed, parseVerdict } from './src/engine/grading/verdict.ts'
const v = parseVerdict(readFileSync('/tmp/v.jsonl', 'utf8'))
console.log(JSON.stringify(v, null, 2))
console.log('allPassed:', allPassed(v))
"
```
Expected: three checkpoints, `noise: []`, `allPassed: false`.

- [ ] **Step 6: Commit**

```bash
cd /home/daxtangco/rhcsa-trainer
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git add content/lib/assert.sh test/lib && \
GIT_AUTHOR_NAME=daxtangco GIT_AUTHOR_EMAIL=daxtangco@localhost \
GIT_COMMITTER_NAME=daxtangco GIT_COMMITTER_EMAIL=daxtangco@localhost \
git commit -m "feat(content): grader helper library

Ten helpers, only what the Phase 1 tasks need. Tested by shelling out to
real bash, so the JSONL that bash emits is checked against the parser that
consumes it rather than against an assumption. within_pct exists because an
exact size comparison fails a correct answer: XFS metadata means a 4 GiB LV
never reports 4 GiB usable. is_persistent accepts fstab or a systemd mount
unit, since the end state is graded and not the mechanism."
```

---

## Part 3 — The first real content and the thin UI (Tasks 21–25)

---

