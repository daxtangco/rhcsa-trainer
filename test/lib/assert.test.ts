import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { parseVerdict } from '../../src/engine/grading/verdict.ts'

const run = promisify(execFile)
// fileURLToPath, not `.pathname`: `.pathname` percent-encodes, so a space or
// non-ASCII character in a parent directory would yield a path that does not
// exist on disk.
const LIB = fileURLToPath(new URL('../../content/lib/assert.sh', import.meta.url))

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

  it('escapes control characters, so a stray ESC cannot delete a checkpoint', async () => {
    // An unparseable line becomes `noise` and the checkpoint vanishes from the
    // verdict — which would make a failing grader report allPassed. detail is
    // captured command output, so a control byte is a question of when, not if.
    const v = parseVerdict(await sh(`ck_fail boom "it failed" "$(printf 'esc\\033[0m bell\\001')"`))
    expect(v.noise).toEqual([])
    expect(v.checkpoints[0]?.status).toBe('fail')
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

  it('rejects an fstab entry mounted noauto, since that will not mount at boot', async () => {
    const v = parseVerdict(
      await sh(`
        FSTAB=$(mktemp); UNITDIR=$(mktemp -d)
        echo '/dev/mapper/rhel-var /var xfs defaults,noauto 0 0' > "$FSTAB"
        is_persistent /var "$FSTAB" "$UNITDIR"; ck p "persistent" $? "noauto"
      `),
    )
    expect(v.checkpoints[0]?.status).toBe('fail')
  })

  it('still accepts nofail, which mounts at boot and only suppresses errors on a missing device', async () => {
    const v = parseVerdict(
      await sh(`
        FSTAB=$(mktemp); UNITDIR=$(mktemp -d)
        echo '/dev/mapper/rhel-var /var xfs defaults,nofail 0 0' > "$FSTAB"
        is_persistent /var "$FSTAB" "$UNITDIR"; ck p "persistent" $? "nofail"
      `),
    )
    expect(v.checkpoints[0]?.status).toBe('pass')
  })

  it('does not let a regex metacharacter in the mount point match a different unit', async () => {
    // Target /var.d must not match a unit written for /varXd: the '.' is
    // literal, not "any character".
    const v = parseVerdict(
      await sh(`
        FSTAB=$(mktemp); UNITDIR=$(mktemp -d)
        printf 'Where=/varXd\\n' > "$UNITDIR/var.mount"
        is_persistent /var.d "$FSTAB" "$UNITDIR"; ck p "persistent" $? "metachar mismatch"
      `),
    )
    expect(v.checkpoints[0]?.status).toBe('fail')
  })
})
