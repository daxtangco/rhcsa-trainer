import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { run } from '../../src/cli/index.ts'
import { checkpointIds } from '../../src/server/session.ts'

// A checker nobody has seen fail is a checker nobody has tested. `rhcsa lint` is
// a gate whose entire job is reporting whether the content bank is sound, in a
// project whose recurring defect is a tool reporting success for work it did not
// do — so a lint that passes because its pattern matched nothing is worse than no
// lint at all. Every check here plants a real defect into a copy of the real
// `content/` and requires a non-zero exit, and every plant asserts that the
// mutation actually landed before asserting what the lint said about it.

const CONTENT = fileURLToPath(new URL('../../content', import.meta.url))
const GRADER = 'tasks/storage/014-grow-home-lv/grade.sh'

const temps: string[] = []

afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

function capture() {
  const out: string[] = []
  const err: string[] = []
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err }
}

/** A throwaway copy of the real bank, so plants are made against real grader shapes. */
async function bankCopy(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rhcsa-lint-'))
  temps.push(dir)
  const root = join(dir, 'content')
  await cp(CONTENT, root, { recursive: true })
  return root
}

/**
 * Rewrite the storage grader. `mutate` receives its text and must return
 * something different — a plant that silently failed to apply would leave the
 * test asserting the lint's behaviour on unmodified content, which is the exact
 * false-green this file exists to rule out.
 */
async function plant(root: string, mutate: (text: string) => string): Promise<void> {
  const file = join(root, GRADER)
  const before = await readFile(file, 'utf8')
  const after = mutate(before)
  expect(after, 'the plant did not change grade.sh, so the test below proves nothing').not.toBe(before)
  await writeFile(file, after, 'utf8')
}

async function lint(root: string) {
  const c = capture()
  const code = await run(['lint', '--content', root], c.io)
  return { code, out: c.out.join('\n'), err: c.err.join('\n') }
}

describe('rhcsa lint on the shipped bank', () => {
  it('exits 0 and needs no VM, no .env.local and no network', async () => {
    // Every other content gate in this project goes through `rhcsa validate`,
    // which reverts a snapshot and reboots a guest. On a checkout with no ISO —
    // which is any fresh checkout — this is the only content gate that exists.
    const r = await lint(CONTENT)
    expect(r.err).toBe('')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/graders checked: 5/)
    expect(r.out).toMatch(/scripts with headers: 21/)
  })

  it('prints the inventory it checked, not just a verdict', async () => {
    const r = await lint(CONTENT)
    expect(r.out).toMatch(/baseline-fail: fs-home-size, lv-home-size/)
    expect(r.out).toMatch(/unprobed-invariant: var-intact/)
    expect(r.out).toMatch(/emits: fs-home-size, home-from-lv, lv-home-size, persist-config, var-intact/)
  })

  it('reports emitted-but-undeclared ids as notes on stdout, never as failures', async () => {
    // Getting this backwards would fail every task in the bank: a grader
    // legitimately emits invariants that pass at baseline and are therefore
    // absent from `# baseline-fail:` by design.
    const r = await lint(CONTENT)
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/note: .*home-from-lv is emitted but named by no header/)
    expect(r.err).not.toMatch(/home-from-lv/)
  })
})

describe('rhcsa lint fails on planted defects', () => {
  it('catches a baseline-fail id the grader never emits', async () => {
    const root = await bankCopy()
    await plant(root, (t) =>
      t.replace('# baseline-fail: lv-home-size, fs-home-size', '# baseline-fail: lv-home-size, fs-home-size, no-such-checkpoint'),
    )

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/baseline-fail names no-such-checkpoint, which the grader never emits/)
  })

  it('catches an expect-fail id the sibling grader never emits', async () => {
    // The anti-solution header is checked against grade.sh, not against itself:
    // an anti-solution emits no checkpoints, and `expectedStatus` defaults an
    // unrecognised id to 'pass', so a typo'd id silently agrees with whatever
    // the grader does for the checkpoint it was meant to name.
    const root = await bankCopy()
    const file = join(root, 'tasks/storage/014-grow-home-lv/antisolutions/01-forgot-growfs.sh')
    const before = await readFile(file, 'utf8')
    const after = before.replace('# expect-fail: fs-home-size', '# expect-fail: fs-home-typo')
    expect(after).not.toBe(before)
    await writeFile(file, after, 'utf8')

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/expect-fail names fs-home-typo, which the grader never emits/)
  })

  it('catches a duplicated header line', async () => {
    const root = await bankCopy()
    await plant(root, (t) => `${t}# baseline-fail: lv-home-size\n`)

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/more than one "# baseline-fail:" header found/)
  })

  it('catches a ck whose id is a variable, which countCheckpoints cannot see', async () => {
    const root = await bankCopy()
    await plant(root, (t) => `${t}id=late-check\ntest -f /etc/fstab; ck "$id" "variable id" $?\n`)

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/is not a literal/)

    // The other half of the claim: the counter really is blind to it, so this is
    // a fail-open the runtime `incomplete` guard cannot report as an authoring
    // error. That is why the check belongs in a static lint.
    const script = await readFile(join(root, GRADER), 'utf8')
    expect(checkpointIds(script)).not.toContain('late-check')
  })

  it('catches a ck whose id interpolates after a literal prefix', async () => {
    // The nastier half of the same defect: `CK_CALL`'s id class stops at the `$`,
    // so this does not vanish from the count — it lands as the truncated id
    // `size-`, which still looks like a kebab id and would pass a grammar check
    // alone.
    const root = await bankCopy()
    await plant(root, (t) => `${t}n=1\ntrue; ck "size-$n" "interpolated id" $?\n`)

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/is not a literal/)
  })

  it('catches an id that breaks the lowercase-kebab convention', async () => {
    const root = await bankCopy()
    await plant(root, (t) => `${t}true; ck LV_Size "uppercase and underscore" $?\n`)

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/LV_Size.*is not lowercase kebab-case/)
  })

  it('rejects a non-conforming id while countCheckpoints still counts both, permissively', async () => {
    // The collision that motivated the rule, with both halves asserted. With a
    // `[a-z0-9-]` id class the counter read `ck my_id` as the id `my`, collapsed
    // it into the neighbouring `ck my`, and landed `expectedTotal` one low — a
    // truncated run then read as complete and the student was told a checkpoint
    // passed that never ran. So the counter is wide on purpose (2 ids here) and
    // rejection lives in the lint (an error here). A test asserting only one of
    // those two documents half the design.
    const root = await bankCopy()
    await plant(root, (t) => `${t}true; ck my "first" $?\ntrue; ck my_id "second" $?\n`)

    const script = await readFile(join(root, GRADER), 'utf8')
    expect(checkpointIds(script)).toContain('my')
    expect(checkpointIds(script)).toContain('my_id')

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/my_id.*is not lowercase kebab-case/)
    expect(r.err).not.toMatch(/"my".*is not lowercase/)
  })

  it('reports every problem in one pass rather than stopping at the first file', async () => {
    // Content authoring is a loop; one-error-per-run makes that loop slow. Same
    // reason ContentError aggregates.
    const root = await bankCopy()
    await plant(root, (t) => `${t}true; ck LV_Size "one" $?\ntrue; ck Other_Id "two" $?\n`)

    const r = await lint(root)
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/LV_Size/)
    expect(r.err).toMatch(/Other_Id/)
    expect(r.err).toMatch(/^2 problem\(s\)$/m)
  })
})

describe('rhcsa lint does not flag ck-shaped text that is not a call', () => {
  it('ignores a variable id inside a heredoc body', async () => {
    // The mutation probe is what buys this: the candidate is rewritten to a
    // literal sentinel and `checkpointIds` is re-run, so the decision about
    // whether the site is code comes from the maintained scanner rather than
    // from this lint's own opinion about bash. A regex that only looked at the
    // line would report this, and reporting a grader's own printed help text as
    // a defect is how a gate stops being trusted.
    const root = await bankCopy()
    await plant(root, (t) => `${t}cat <<EOF\nck "$id" "printed, not run" 0\nEOF\n`)

    const r = await lint(root)
    expect(r.err).toBe('')
    expect(r.code).toBe(0)
  })

  it('ignores a variable id in a comment', async () => {
    const root = await bankCopy()
    await plant(root, (t) => `${t}# ck "$id" "explaining what not to write"\n`)

    const r = await lint(root)
    expect(r.err).toBe('')
    expect(r.code).toBe(0)
  })

  it('ignores ck-shaped text inside a quoted string', async () => {
    const root = await bankCopy()
    await plant(root, (t) => `${t}printf '%s\\n' "ok; ck \\$phantom d 0"\n`)

    const r = await lint(root)
    expect(r.err).toBe('')
    expect(r.code).toBe(0)
  })
})

describe('rhcsa lint argument handling', () => {
  it('exits 2 with usage on an unknown option instead of silently ignoring it', async () => {
    const c = capture()
    expect(await run(['lint', '--content', CONTENT, '--strick'], c.io)).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage: rhcsa/)
    expect(c.out).toEqual([])
  })

  it('exits 2 with usage when --content is the empty string', async () => {
    const c = capture()
    expect(await run(['lint', '--content', ''], c.io)).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage: rhcsa/)
  })

  it('exits 2 with usage when --content has no following value', async () => {
    const c = capture()
    expect(await run(['lint', '--content'], c.io)).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage: rhcsa/)
  })

  it('exits 2 with usage on a bare positional argument', async () => {
    // `lint` takes no task id. Accepting one silently would suggest it can lint
    // a single task, which it cannot.
    const c = capture()
    expect(await run(['lint', 'storage/014-grow-home-lv'], c.io)).toBe(2)
    expect(c.err.join('\n')).toMatch(/usage: rhcsa/)
  })

  it('exits 1 with a readable message when the content root does not exist', async () => {
    const c = capture()
    const code = await run(['lint', '--content', join(tmpdir(), 'rhcsa-no-such-root')], c.io)
    expect(code).toBe(1)
    expect(c.err.join('\n')).toMatch(/rhcsa-no-such-root/)
  })

  it('lists lint in the usage text', async () => {
    const c = capture()
    await run([], c.io)
    // Column-exact, because the usage block is a hand-aligned table and a
    // command added out of alignment is the kind of thing nobody fixes later.
    expect(c.err.join('\n')).toMatch(/^ {2}lint {18}static checks on grader headers/m)
  })
})
